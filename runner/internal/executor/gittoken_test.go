package executor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/fakegit"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

const firstToken = "ghs_firstfirstfirstfirstfirst0001"

func renewed(n int) string { return fmt.Sprintf("ghs_renewedrenewedrenewed%08d", n) }

// gitWorld is a world whose project has a repository on a fake GitHub remote that takes a token until it expires.
type gitWorld struct {
	*world
	remote *fakegit.Server
	url    string
	env    string

	mu     sync.Mutex
	issued []string
}

func newGitWorld(t *testing.T) *gitWorld {
	w := &gitWorld{world: newWorld(t)}
	fg, err := fakegit.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fg.Close)
	w.remote = fg
	if w.url, err = fg.Seed("origin"); err != nil {
		t.Fatal(err)
	}
	w.env = filepath.Join(t.TempDir(), "env")
	t.Setenv("FAKE_ENV", w.env)
	// no helper of the machine answers in a test
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(t.TempDir(), "gitconfig"))
	w.x.RenewRetry = 100 * time.Millisecond
	return w
}

// claim queues a run with git: the first token lives `life`, werkbuch renews it `before` its end.
func (w *gitWorld) claim(id, prompt string, life time.Duration) protocol.Run {
	expires := time.Now().Add(life)
	w.remote.Accept(firstToken, expires)
	return w.run(id, protocol.Task, prompt, func(r *protocol.Run) {
		r.Git = &protocol.Git{RepoURL: w.url, Token: firstToken, ExpiresAt: &expires}
	})
}

// renewEvery hands out a new token of the given life on every renewal, after `fail` answers of 503.
func (w *gitWorld) renewEvery(life time.Duration, fail int) {
	w.fake.RenewGit = func(_ string, n int) (*protocol.Git, int, string) {
		if n <= fail {
			return nil, 503, "github_unavailable"
		}
		token, expires := renewed(n), time.Now().Add(life)
		w.remote.Accept(token, expires)
		w.mu.Lock()
		w.issued = append(w.issued, token)
		w.mu.Unlock()
		return &protocol.Git{RepoURL: w.url, Token: token, ExpiresAt: &expires}, 0, ""
	}
}

// story logs (with -v) what happened, the tokens as labels: the requests of the remote, the lines werkbuch got and what
// the runner logged of the token.
func (w *gitWorld) story(id string, started time.Time) {
	w.t.Helper()
	label := func(token string) string {
		for i, t := range w.tokens() {
			if t == token {
				if i == 0 {
					return "token #1 (claim)"
				}
				return fmt.Sprintf("token #%d (renewed)", i+1)
			}
		}
		return "unknown token"
	}
	for _, r := range w.remote.Requests() {
		what, verdict := "fetch", "accepted"
		if r.Push {
			what = "push "
		}
		if !r.Allowed {
			verdict = "refused"
		}
		w.t.Logf("remote  +%5.2fs  %s  %-18s %s", r.At.Sub(started).Seconds(), what, label(r.Token), verdict)
	}
	for _, e := range w.fake.State(id).Events {
		if strings.Contains(e.Text, "git token") || strings.Contains(e.Text, "working in") {
			w.t.Logf("event   %s: %s", e.Kind, e.Text)
		}
	}
	for _, line := range strings.Split(w.log.String(), "\n") {
		if strings.Contains(line, "git token") || strings.Contains(line, "run ended") {
			w.t.Logf("runner  %s", line[strings.Index(line, "level="):])
		}
	}
}

func (w *gitWorld) tokens() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]string{firstToken}, w.issued...)
}

// leaks fails when any token shows in the log of the runner, the arguments or the environment of the CLI, or the
// events werkbuch got.
func (w *gitWorld) leaks(id string) {
	w.t.Helper()
	args, _ := os.ReadFile(w.args)
	env, _ := os.ReadFile(w.env)
	for _, token := range w.tokens() {
		for where, text := range map[string]string{"log": w.log.String(), "args": string(args), "env": string(env), "events": w.texts(id)} {
			if strings.Contains(text, token) {
				w.t.Fatalf("a git token in the %s", where)
			}
		}
	}
	for _, line := range strings.Split(string(env), "\n") {
		if strings.HasPrefix(line, "GH_TOKEN=") && line != "GH_TOKEN=" || strings.HasPrefix(line, "GITHUB_TOKEN=") && line != "GITHUB_TOKEN=" {
			w.t.Fatal("a token for gh in the environment of the CLI")
		}
	}
}

func TestRenewsTheGitTokenWhileTheAgentWorks(t *testing.T) {
	w := newGitWorld(t)
	w.x.RenewBefore = 1500 * time.Millisecond
	w.renewEvery(2*time.Second, 1)
	t.Setenv("FAKE_PUSH_DELAY", "2.5")
	started := time.Now()
	run := w.claim("01renew", "awaitrenew commit", 2*time.Second)
	e, status := w.execute(run)
	w.story(run.ID, started)
	if status != protocol.Succeeded {
		t.Fatalf("status %q\n%s", status, w.log.String())
	}
	// the CLI started with the first token and pushed after it ran out: git asked the helper, the helper read the file
	branch := "agent/WEB-1-a-thing"
	if w.remote.Head("origin", branch) == "" {
		t.Fatalf("not pushed to the remote of werkbuch\n%s", w.log.String())
	}
	var pushes, refused int
	for _, r := range w.remote.Requests() {
		if !r.Push {
			continue
		}
		if !r.Allowed {
			refused++
			continue
		}
		pushes++
		if r.Token == firstToken || !r.At.After(started.Add(2*time.Second)) {
			t.Fatalf("pushed with the first token or before it ran out (%v)", r.At.Sub(started))
		}
	}
	if pushes == 0 || refused != 0 {
		t.Fatalf("pushes %d, refused %d", pushes, refused)
	}
	// a local repository of config.yaml (A491) is only the fallback without git
	if out, _ := exec.Command("git", "-C", w.origin, "rev-parse", "--verify", "--quiet", branch).Output(); len(out) > 0 {
		t.Fatal("pushed to the local repository")
	}
	if st := w.fake.State(run.ID); st.Renewals < 3 {
		t.Fatalf("renewals %d (one 503, then at least two)", st.Renewals)
	}
	if !strings.Contains(w.texts(run.ID), "system:git token renewed, valid until ") {
		t.Fatalf("no line of the renewal:\n%s", w.texts(run.ID))
	}
	if !strings.Contains(w.log.String(), "git token renewal failed, again") {
		t.Fatal("the 503 was not tried again")
	}
	w.leaks(run.ID)
	env, _ := os.ReadFile(w.env)
	file := ""
	for _, line := range strings.Split(string(env), "\n") {
		if v, ok := strings.CutPrefix(line, "WERKBUCH_GIT_TOKEN_FILE="); ok {
			file = v
		}
	}
	if !strings.Contains(file, "werkbuch-run-") || filepath.Base(file) != "git-token" {
		t.Fatalf("token file %q", file)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("the token file outlived the run")
	}
	if !strings.Contains(string(env), "GH_CONFIG_DIR="+filepath.Join(filepath.Dir(file), "gh")+"\n") {
		t.Fatal("gh does not read the token of the run")
	}
	if e.Summary().Result != protocol.Succeeded {
		t.Fatalf("%+v", e.Summary())
	}
}

func TestReplacedOnRenewalStopsTheRun(t *testing.T) {
	w := newGitWorld(t)
	w.x.RenewBefore = 700 * time.Millisecond
	w.fake.RenewGit = func(string, int) (*protocol.Git, int, string) { return nil, 409, "run_replaced" }
	started := time.Now()
	run := w.claim("01gone", "sleep", time.Second)
	e, status := w.execute(run)
	w.story(run.ID, started)
	if status != "" || w.fake.State(run.ID).Result != nil || e.Summary().Result != replaced {
		t.Fatalf("status %q, result %v, summary %+v", status, w.fake.State(run.ID).Result, e.Summary())
	}
	w.leaks(run.ID)
}

func TestOtherRefusalsOnlyEndTheRenewal(t *testing.T) {
	for _, reason := range []string{"no_repository", "repository_unavailable", "run_canceling", "merge_guard_open"} {
		t.Run(reason, func(t *testing.T) {
			w := newGitWorld(t)
			w.x.RenewBefore = 5900 * time.Millisecond
			w.fake.RenewGit = func(string, int) (*protocol.Git, int, string) { return nil, 409, reason }
			started := time.Now()
			run := w.claim("01"+strings.ReplaceAll(reason, "_", ""), "nap commit", 6*time.Second)
			_, status := w.execute(run)
			w.story(run.ID, started)
			if status != protocol.Succeeded {
				t.Fatalf("status %q\n%s", status, w.log.String())
			}
			if n := w.fake.State(run.ID).Renewals; n != 1 {
				t.Fatalf("renewals %d", n)
			}
			if !strings.Contains(w.texts(run.ID), "error:git token not renewed: 409 "+reason) {
				t.Fatalf("no line:\n%s", w.texts(run.ID))
			}
			// the push of the nap went with the first token, still valid
			if w.remote.Head("origin", "agent/WEB-1-a-thing") == "" {
				t.Fatal("not pushed")
			}
			w.leaks(run.ID)
		})
	}
}

func TestGhCalledByItsPathGetsTheTokenOfTheRun(t *testing.T) {
	w := newGitWorld(t)
	dir := t.TempDir()
	gh, seen := filepath.Join(dir, "gh"), filepath.Join(dir, "seen")
	// a fake gh as gh reads its token: GH_TOKEN, GITHUB_TOKEN, else hosts.yml of GH_CONFIG_DIR
	os.WriteFile(gh, []byte("#!/bin/sh\ntok=${GH_TOKEN:-$GITHUB_TOKEN}\n[ -z \"$tok\" ] && tok=$(sed -n 's/^    oauth_token: //p' \"$GH_CONFIG_DIR/hosts.yml\")\nprintf '%s' \"$tok\" > "+seen+"\n"), 0o700)
	t.Setenv("FAKE_GH", gh)
	// gh of the machine is logged in as someone else
	t.Setenv("GH_TOKEN", "gho_machinetokenmachinetoken0001")
	t.Setenv("GITHUB_TOKEN", "gho_machinetokenmachinetoken0002")
	run := w.claim("01gh", "usegh", time.Hour)
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatalf("status %q\n%s", status, w.log.String())
	}
	got, _ := os.ReadFile(seen)
	if string(got) != firstToken {
		t.Fatal("gh did not get the token of the run")
	}
	// an hour of life: nothing to renew yet
	if n := w.fake.State(run.ID).Renewals; n != 0 {
		t.Fatalf("renewals %d", n)
	}
	w.leaks(run.ID)
}

func TestALightRunGetsNeitherTheGitTokenNorGh(t *testing.T) {
	w := newGitWorld(t)
	listing := filepath.Join(t.TempDir(), "ls")
	t.Setenv("FAKE_LS", listing)
	expires := time.Now().Add(time.Hour)
	w.remote.Accept(firstToken, expires)
	run := w.run("01look", protocol.Review, "review", func(r *protocol.Run) {
		r.Git = &protocol.Git{RepoURL: w.url, Token: firstToken, ExpiresAt: &expires}
	})
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatalf("status %q\n%s", status, w.log.String())
	}
	// the runner cloned with the token
	fetched := false
	for _, r := range w.remote.Requests() {
		fetched = fetched || r.Token == firstToken && r.Allowed
	}
	env, _ := os.ReadFile(w.env)
	files, _ := os.ReadFile(listing)
	if !fetched || strings.Contains(string(env), "WERKBUCH_GIT_TOKEN_FILE") || strings.Contains(string(env), "GH_CONFIG_DIR") {
		t.Fatalf("fetched %v, env of the light run:\n%s", fetched, env)
	}
	if len(files) == 0 || strings.Contains(string(files), "git-token") || strings.Contains(string(files), "gh") {
		t.Fatalf("the light run may read %q", files)
	}
	w.leaks(run.ID)
}

func TestATokenRunningOutIsRenewedBeforeTheClone(t *testing.T) {
	w := newGitWorld(t)
	w.renewEvery(time.Hour, 0)
	issue := w.fake.RenewGit
	w.fake.RenewGit = func(id string, n int) (*protocol.Git, int, string) {
		time.Sleep(300 * time.Millisecond) // GitHub takes its time: a clone in the background would be faster
		return issue(id, n)
	}
	// the claim's token runs out at once (a run that waited long for its slot)
	expires := time.Now().Add(50 * time.Millisecond)
	w.remote.Accept(firstToken, expires)
	run := w.run("01late", protocol.Task, "commit", func(r *protocol.Run) {
		r.Git = &protocol.Git{RepoURL: w.url, Token: firstToken, ExpiresAt: &expires}
	})
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatalf("status %q\n%s", status, w.log.String())
	}
	requests := w.remote.Requests()
	if len(requests) == 0 || requests[0].Token != renewed(1) || w.remote.Head("origin", "agent/WEB-1-a-thing") == "" {
		t.Fatalf("the clone went with the old token or nothing was pushed (%d requests)", len(requests))
	}
	if n := w.fake.State(run.ID).Renewals; n != 1 {
		t.Fatalf("renewals %d", n)
	}
	w.leaks(run.ID)
}

func TestARenewalThatKeepsFailingEndsAfterTheExpiry(t *testing.T) {
	w := newGitWorld(t)
	w.x.RenewBefore = 90 * time.Millisecond
	w.x.RenewRetry = time.Millisecond
	w.renewEvery(time.Hour, 1000) // GitHub answers 503 for good
	run := w.claim("01down", "sleep", 100*time.Millisecond)
	w.remote.Accept(firstToken, time.Now().Add(time.Hour)) // the clone still works, only werkbuch's expiry counts here
	e := NewExecution(run)
	done := make(chan string, 1)
	go func() { done <- w.x.Run(context.Background(), e) }()
	line := fmt.Sprintf("error:git token not renewed: %d failures after it ran out, last: 503 github_unavailable", GiveUpAfter)
	for until := time.Now().Add(15 * time.Second); !strings.Contains(w.texts(run.ID), line); time.Sleep(20 * time.Millisecond) {
		if time.Now().After(until) {
			t.Fatalf("no line:\n%s\n%s", w.texts(run.ID), w.log.String())
		}
	}
	n := w.fake.State(run.ID).Renewals
	time.Sleep(300 * time.Millisecond)
	if w.fake.State(run.ID).Renewals != n {
		t.Fatal("asked again after giving up")
	}
	// the run went on with the token it had
	if e.Finished() {
		t.Fatal("giving up ended the run")
	}
	e.Cancel()
	if status := <-done; status != protocol.Canceled {
		t.Fatalf("status %q", status)
	}
	w.leaks(run.ID)
}
