package executor

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/fakewerkbuch"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

const runToken = "01m84h89mdknggbar3ynnhd99n|wb_runtokenruntokenruntoken42"

type world struct {
	t      *testing.T
	fake   *fakewerkbuch.Server
	x      *Executor
	log    *syncBuffer
	origin string
	args   string
	seen   []string
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}
func (s *syncBuffer) String() string { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

func fakeCLI(t *testing.T) string {
	p, err := filepath.Abs("../../testdata/claude")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func newWorld(t *testing.T) *world {
	w := &world{t: t, fake: fakewerkbuch.New(), log: &syncBuffer{}}
	w.fake.Heartbeat = 0 // keep the interval of the test
	t.Cleanup(w.fake.Close)
	w.origin = filepath.Join(t.TempDir(), "origin")
	os.MkdirAll(w.origin, 0o755)
	gitIn(t, w.origin, "init", "--quiet", "-b", "main")
	os.WriteFile(filepath.Join(w.origin, "README.md"), []byte("hi\n"), 0o644)
	gitIn(t, w.origin, "add", ".")
	gitIn(t, w.origin, "commit", "--quiet", "-m", "first")
	w.args = filepath.Join(t.TempDir(), "args")
	t.Setenv("FAKE_ARGS", w.args)
	cli := fakeCLI(t)
	w.x = &Executor{
		Client:    client.New(w.fake.URL, fakewerkbuch.Token, "1.0.0"),
		Git:       &git.Manager{Data: t.TempDir()},
		Repos:     func() map[string]string { return map[string]string{"WEB": w.origin} },
		Log:       slog.New(redact.Handler{Next: slog.NewTextHandler(w.log, nil)}),
		Werkbuch:  func(s string) { w.seen = append(w.seen, s) },
		Grace:     300 * time.Millisecond,
		Flush:     50 * time.Millisecond,
		Heartbeat: 100 * time.Millisecond,
		Retry:     time.Second,
		LookPath: func(name string) (string, error) {
			if name == "claude" {
				return cli, nil
			}
			return "", exec.ErrNotFound
		},
	}
	return w
}

func str(s string) *string { return &s }

func (w *world) run(id, kind, prompt string, edit ...func(*protocol.Run)) protocol.Run {
	r := protocol.Run{ID: id, Attempt: 1, Type: kind, CLI: "claude", Model: "sonnet", TimeoutMinutes: 120, Prompt: prompt, SystemPrompt: "contract"}
	r.Project = protocol.ProjectRef{ID: "01p", Identifier: "WEB"}
	r.Item = &protocol.ItemRef{ID: "01i", Key: "WEB-1", Title: "A thing"}
	r.Thread = &protocol.Thread{ID: "thread-" + id, Branch: str("agent/WEB-1-a-thing"), BaseBranch: str("main")}
	r.CommitIdentity = protocol.Identity{Name: "Kira", Email: "kira@users.noreply.werkbuch.example.com"}
	r.Werkbuch = protocol.MCP{MCPURL: w.fake.URL + "/mcp", ServerName: "werkbuch-run", Token: runToken}
	for _, f := range edit {
		f(&r)
	}
	w.fake.Queue(r)
	a, err := w.x.Client.Claim(context.Background(), protocol.Report{})
	if err != nil || a.Run == nil {
		w.t.Fatalf("claim %v %v", a, err)
	}
	return *a.Run
}

func (w *world) execute(run protocol.Run) (*Execution, string) {
	e := NewExecution(run)
	return e, w.x.Run(context.Background(), e)
}

func (w *world) texts(id string) string {
	var out []string
	for _, e := range w.fake.State(id).Events {
		out = append(out, e.Kind+":"+e.Text)
	}
	return strings.Join(out, "\n")
}

func TestTaskRun(t *testing.T) {
	w := newWorld(t)
	run := w.run("01task", protocol.Task, "commit please")
	e, status := w.execute(run)
	if status != protocol.Succeeded {
		t.Fatalf("status %q\n%s", status, w.log.String())
	}
	res := w.fake.State(run.ID).Result
	pushed := gitIn(t, w.origin, "rev-parse", "agent/WEB-1-a-thing")
	if res.Commit == nil || *res.Commit != pushed || *res.Summary != "Done: the change is pushed." || *res.SessionID != "sess-new" || res.Usage.Input != 1500 || res.Usage.Output != 450 || res.Attempt != 1 {
		t.Fatalf("result %+v", res)
	}
	author := gitIn(t, w.origin, "log", "-1", "--format=%an <%ae>", "agent/WEB-1-a-thing")
	if author != "Kira <kira@users.noreply.werkbuch.example.com>" {
		t.Fatalf("author %s", author)
	}
	texts := w.texts(run.ID)
	for _, want := range []string{"system:working in", "system:session started with fake-model", "text:step 1", "text:step 3", "tool:Bash: git status", "result:Done"} {
		if !strings.Contains(texts, want) {
			t.Fatalf("events lack %q:\n%s", want, texts)
		}
	}
	args, _ := os.ReadFile(w.args)
	for _, want := range []string{"--model\nsonnet", "--mcp-config\n", "--append-system-prompt-file\n", "--permission-mode\nbypassPermissions"} {
		if !strings.Contains(string(args), want) {
			t.Fatalf("args lack %q:\n%s", want, args)
		}
	}
	if strings.Contains(string(args), "--strict-mcp-config") || strings.Contains(string(args), "--resume") {
		t.Fatalf("args %s", args)
	}
	mcp := strings.Split(strings.SplitAfter(string(args), "--mcp-config\n")[1], "\n")[0]
	if _, err := os.Stat(mcp); !os.IsNotExist(err) {
		t.Fatalf("mcp config %s stays", mcp)
	}
	if s := e.Summary(); s.Status != "finished" || s.Result != protocol.Succeeded || s.Item != "WEB-1" {
		t.Fatalf("summary %+v", s)
	}
	// the worktree of the strand stays for the next run of the strand
	if _, err := os.Stat(filepath.Join(e.Summary().Dir, "work.txt")); err != nil {
		t.Fatal("worktree went")
	}
}

func TestCorrectionResumesTheSession(t *testing.T) {
	w := newWorld(t)
	run := w.run("01corr", protocol.Correction, "fix", func(r *protocol.Run) { r.Thread.SessionID = str("sess-old") })
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatal(status)
	}
	args, _ := os.ReadFile(w.args)
	if !strings.Contains(string(args), "--resume\nsess-old") || *w.fake.State(run.ID).Result.SessionID != "sess-old" {
		t.Fatalf("args %s", args)
	}
	if w.fake.State(run.ID).Result.Commit != nil {
		t.Fatal("no new commit, none reported")
	}
}

func TestCancelFromWerkbuch(t *testing.T) {
	w := newWorld(t)
	run := w.run("01cancel", protocol.Task, "sleep")
	go func() {
		for !strings.Contains(w.texts(run.ID), "git status") {
			time.Sleep(20 * time.Millisecond)
		}
		w.fake.Cancel(run.ID)
	}()
	start := time.Now()
	_, status := w.execute(run)
	res := w.fake.State(run.ID).Result
	if status != protocol.Canceled || res.Status != protocol.Canceled || time.Since(start) > 5*time.Second {
		t.Fatalf("%q %+v after %v", status, res, time.Since(start))
	}
}

func TestLocalCancel(t *testing.T) {
	w := newWorld(t)
	run := w.run("01local", protocol.Task, "sleep")
	e := NewExecution(run)
	go func() {
		for len(w.fake.State(run.ID).Events) == 0 {
			time.Sleep(20 * time.Millisecond)
		}
		e.Cancel()
		e.Cancel()
	}()
	if status := w.x.Run(context.Background(), e); status != protocol.Canceled {
		t.Fatal(status)
	}
}

func TestTimeLimitKillsAStubbornCLI(t *testing.T) {
	w := newWorld(t)
	run := w.run("01slow", protocol.Task, "stubborn", func(r *protocol.Run) {
		d := time.Now().Add(700 * time.Millisecond)
		r.DeadlineAt = &d
		r.TimeoutMinutes = 1
	})
	start := time.Now()
	_, status := w.execute(run)
	if status != protocol.TimedOut || time.Since(start) > 5*time.Second {
		t.Fatalf("%q after %v", status, time.Since(start))
	}
	if !strings.Contains(w.log.String(), "reason=timed_out") {
		t.Fatal(w.log.String())
	}
}

func TestReplacedRunStopsWithoutResult(t *testing.T) {
	w := newWorld(t)
	run := w.run("01lost", protocol.Task, "sleep")
	go func() {
		for len(w.fake.State(run.ID).Events) == 0 {
			time.Sleep(20 * time.Millisecond)
		}
		w.fake.Replace(run.ID)
	}()
	e, status := w.execute(run)
	if status != "" || w.fake.State(run.ID).Result != nil || e.Summary().Result != "replaced" {
		t.Fatalf("%q %+v", status, w.fake.State(run.ID).Result)
	}
}

func TestFailedRun(t *testing.T) {
	w := newWorld(t)
	run := w.run("01fail", protocol.Task, "fail")
	if _, status := w.execute(run); status != protocol.Failed {
		t.Fatal(status)
	}
	if res := w.fake.State(run.ID).Result; !strings.Contains(*res.Error, "the tests do not pass") || *res.SessionID != "sess-new" {
		t.Fatalf("%+v", res)
	}
}

func TestReview(t *testing.T) {
	w := newWorld(t)
	gitIn(t, w.origin, "checkout", "--quiet", "-b", "feature")
	os.WriteFile(filepath.Join(w.origin, "feature.txt"), []byte("the feature\n"), 0o644)
	gitIn(t, w.origin, "add", ".")
	gitIn(t, w.origin, "commit", "--quiet", "-m", "add the feature")
	head := gitIn(t, w.origin, "rev-parse", "HEAD")
	gitIn(t, w.origin, "checkout", "--quiet", "main")
	kept := t.TempDir()
	t.Setenv("FAKE_CONTEXT", kept)
	prompt := filepath.Join(t.TempDir(), "prompt")
	t.Setenv("FAKE_PROMPT", prompt)
	torn := filepath.Join(w.t.TempDir(), "teardown")
	run := w.run("01rev", protocol.Review, "review", func(r *protocol.Run) {
		r.HeadSHA = &head
		r.TeardownCommand = str("touch " + torn)
	})
	e, status := w.execute(run)
	res := w.fake.State(run.ID).Result
	if status != protocol.Succeeded || *res.Verdict != "approve" || !strings.Contains(*res.Text, "No findings") {
		t.Fatalf("%q %+v", status, res)
	}
	if _, err := os.Stat(e.Summary().Dir); !os.IsNotExist(err) {
		t.Fatal("the worktree of a review goes after the run")
	}
	if _, err := os.Stat(torn); err == nil {
		t.Fatal("a review has no teardown (and no setup)")
	}
	// no shell for a review: the runner hands it the diff and the log of the pull request
	diff, _ := os.ReadFile(filepath.Join(kept, "pull-request.diff"))
	log, _ := os.ReadFile(filepath.Join(kept, "pull-request-log.txt"))
	if !strings.Contains(string(diff), "+the feature") || !strings.Contains(string(log), "add the feature") {
		t.Fatalf("context %q %q", diff, log)
	}
	asked, _ := os.ReadFile(prompt)
	if !strings.Contains(string(asked), "pull-request.diff") || !strings.Contains(string(asked), "there is no shell") {
		t.Fatalf("prompt %q", asked)
	}
	args, _ := os.ReadFile(w.args)
	if !strings.Contains(string(args), "--setting-sources\nuser") || strings.Contains(string(args), "Bash") && !strings.Contains(string(args), "--disallowedTools\nBash") {
		t.Fatalf("args %s", args)
	}
}

func TestReviewWithoutVerdictFails(t *testing.T) {
	w := newWorld(t)
	run := w.run("01noverdict", protocol.Review, "just talk")
	if _, status := w.execute(run); status != protocol.Failed {
		t.Fatal(status)
	}
}

func TestCommentWithoutRepository(t *testing.T) {
	w := newWorld(t)
	w.x.Repos = nil
	run := w.run("01comment", protocol.Comment, "answer", func(r *protocol.Run) { r.Thread = nil })
	e, status := w.execute(run)
	res := w.fake.State(run.ID).Result
	if status != protocol.Succeeded || *res.Text != "Done: the change is pushed." || res.Commit != nil {
		t.Fatalf("%q %+v", status, res)
	}
	if !strings.Contains(e.Summary().Dir, filepath.Join("work", "run-01comment")) {
		t.Fatal(e.Summary().Dir)
	}
}

func TestSecretsNeverLeave(t *testing.T) {
	w := newWorld(t)
	run := w.run("01leak", protocol.Task, "leak second-access")
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatal(status)
	}
	texts := w.texts(run.ID)
	if strings.Contains(texts, "runtoken") || !strings.Contains(texts, "my token is [token], env unset") {
		t.Fatalf("events:\n%s", texts)
	}
	if strings.Contains(w.log.String(), "runtoken") || strings.Contains(w.log.String(), fakewerkbuch.Token) {
		t.Fatalf("log:\n%s", w.log.String())
	}
	if len(w.seen) != 1 || w.seen[0] != "skilltri" || !strings.Contains(texts, "skilltri reaches werkbuch") {
		t.Fatalf("seen %v", w.seen)
	}
}

func TestUnknownOrMissingCLI(t *testing.T) {
	w := newWorld(t)
	run := w.run("01codex", protocol.Task, "x", func(r *protocol.Run) { r.CLI = "codex" })
	if _, status := w.execute(run); status != protocol.Failed || !strings.Contains(*w.fake.State(run.ID).Result.Error, "codex is not installed") {
		t.Fatal(status)
	}
	run = w.run("01other", protocol.Task, "x", func(r *protocol.Run) { r.CLI = "gemini" })
	if _, status := w.execute(run); status != protocol.Failed {
		t.Fatal(status)
	}
}

func TestSubscribe(t *testing.T) {
	e := NewExecution(protocol.Run{ID: "x"})
	past, ch, stop := e.Subscribe()
	e.add([]protocol.Event{{Kind: "text", Text: "a"}})
	if len(past) != 0 || (<-ch).Text != "a" {
		t.Fatal("live line")
	}
	stop()
	stop()
	e.finish("succeeded")
	past, ch, _ = e.Subscribe()
	if _, open := <-ch; open || len(past) != 1 || !e.Finished() {
		t.Fatal("after the end")
	}
}

func TestVerdict(t *testing.T) {
	for in, want := range map[string]string{
		"**Verdict:** approve\n\nok":                    "approve",
		"Verdict: changes\n- Important: x":              "changes",
		"## Changes\nsome":                              "changes",
		"I looked.\n\napprove":                          "approve",
		"Nothing to say about approvals in here":        "",
		"Approved after a careful look":                 "approve",
		"Changes I looked at:\n- x\n\nVerdict: approve": "approve",
		"## Approve?\nVerdict: **changes**":             "changes",
	} {
		if got := Verdict(in); got != want {
			t.Errorf("%q: %q", in, got)
		}
	}
}

func TestTheLeaseHoldsThroughALongSetupAndADelayedResult(t *testing.T) {
	w := newWorld(t)
	w.fake.Lease = 400 * time.Millisecond
	w.fake.FailResults = 2
	run := w.run("01longsetup", protocol.Task, "answer", func(r *protocol.Run) { r.SetupCommand = str("sleep 1.2; echo set up") })
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatalf("%q\n%s", status, w.log.String())
	}
	st := w.fake.State(run.ID)
	if st.Lost != 0 || st.Beats < 5 || !strings.Contains(w.texts(run.ID), "setup: set up") {
		t.Fatalf("lost %d, beats %d\n%s", st.Lost, st.Beats, w.texts(run.ID))
	}
}

func TestWithoutHeartbeatsTheLeaseRunsOut(t *testing.T) {
	// the counter-check of the fake: a setup longer than the lease without heartbeats loses the run
	w := newWorld(t)
	w.x.Heartbeat = 5 * time.Second
	w.fake.Lease = 300 * time.Millisecond
	run := w.run("01silent", protocol.Task, "answer", func(r *protocol.Run) { r.SetupCommand = str("sleep 0.8") })
	if _, status := w.execute(run); status != "" || w.fake.State(run.ID).Lost != 1 {
		t.Fatalf("%q %+v", status, w.fake.State(run.ID))
	}
}

func TestCancelAndTimeLimitDuringSetup(t *testing.T) {
	w := newWorld(t)
	run := w.run("01cancelsetup", protocol.Task, "answer", func(r *protocol.Run) { r.SetupCommand = str("sleep 30") })
	go func() {
		time.Sleep(300 * time.Millisecond)
		w.fake.Cancel(run.ID)
	}()
	start := time.Now()
	if _, status := w.execute(run); status != protocol.Canceled || time.Since(start) > 5*time.Second {
		t.Fatalf("%q after %v", status, time.Since(start))
	}
	run = w.run("01slowsetup", protocol.Task, "answer", func(r *protocol.Run) {
		r.Thread.ID, r.Thread.Branch = "thread-other", str("agent/other")
		r.SetupCommand = str("sleep 30")
		d := time.Now().Add(400 * time.Millisecond)
		r.DeadlineAt = &d
	})
	start = time.Now()
	if _, status := w.execute(run); status != protocol.TimedOut || time.Since(start) > 5*time.Second {
		t.Fatalf("%q after %v", status, time.Since(start))
	}
}

func TestTwoRunsOfOneStrandTakeTurns(t *testing.T) {
	w := newWorld(t)
	a := w.run("01napa", protocol.Correction, "nap", func(r *protocol.Run) { r.Thread.ID = "thread-shared" })
	b := w.run("01napb", protocol.Comment, "nap", func(r *protocol.Run) { r.Thread.ID = "thread-shared" })
	var wg sync.WaitGroup
	statuses := make([]string, 2)
	for i, run := range []protocol.Run{a, b} {
		wg.Add(1)
		go func(i int, run protocol.Run) {
			defer wg.Done()
			_, statuses[i] = w.execute(run)
		}(i, run)
	}
	wg.Wait()
	if statuses[0] != protocol.Succeeded || statuses[1] != protocol.Succeeded {
		t.Fatalf("%v\n%s\n%s", statuses, w.texts(a.ID), w.texts(b.ID))
	}
}

func TestCommentGetsLogAndStatus(t *testing.T) {
	w := newWorld(t)
	kept := t.TempDir()
	t.Setenv("FAKE_CONTEXT", kept)
	run := w.run("01ask", protocol.Comment, "answer")
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatal(status)
	}
	logText, _ := os.ReadFile(filepath.Join(kept, "git-log.txt"))
	status, _ := os.ReadFile(filepath.Join(kept, "git-status.txt"))
	if !strings.Contains(string(logText), "first") || !strings.Contains(string(status), "On branch") {
		t.Fatalf("%q %q", logText, status)
	}
	if w.x.slotCount() != 0 {
		t.Fatal("the turn of a folder stays after its runs")
	}
}

func TestANaturalEndKeepsItsStatusAndEndsTheGroup(t *testing.T) {
	w := newWorld(t)
	bg := filepath.Join(t.TempDir(), "bg")
	t.Setenv("FAKE_BG", bg)
	// the CLI ends at once, but what it left in its group ignores SIGTERM: ending it takes the group grace, and the
	// time limit passes meanwhile; the run stays succeeded
	run := w.run("01bg", protocol.Task, "background", func(r *protocol.Run) {
		d := time.Now().Add(800 * time.Millisecond)
		r.DeadlineAt = &d
	})
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatalf("%q\n%s", status, w.log.String())
	}
	data, _ := os.ReadFile(bg)
	pid := 0
	fmt.Sscan(string(data), &pid)
	if pid == 0 {
		t.Fatal("no background process")
	}
	if syscall.Kill(pid, 0) == nil {
		syscall.Kill(pid, syscall.SIGKILL)
		t.Fatal("the background process of the CLI outlived it")
	}
}

func TestSetupRunsInEveryCodeRunOfAStrandAndTeardownStaysForLightOnes(t *testing.T) {
	w := newWorld(t)
	counter := filepath.Join(t.TempDir(), "setups")
	torn := filepath.Join(t.TempDir(), "torn")
	same := func(r *protocol.Run) {
		r.Thread.ID = "strand"
		r.SetupCommand = str("echo x >> " + counter)
		r.TeardownCommand = str("touch " + torn)
	}
	w.execute(w.run("01a", protocol.Task, "answer", same))
	e, _ := w.execute(w.run("01b", protocol.Correction, "answer", same))
	dir := e.Summary().Dir
	// a light run in the worktree of the strand: no setup, and it does not erase the teardown
	w.execute(w.run("01c", protocol.Comment, "answer", same))
	if data, _ := os.ReadFile(counter); strings.Count(string(data), "x") != 2 {
		t.Fatalf("setup ran %q times for task, correction and comment", data)
	}
	if err := w.x.Git.Remove(context.Background(), dir, w.x.Teardown); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(torn); err != nil {
		t.Fatal("the teardown did not run when the worktree of the strand went")
	}
}

func TestStopRunsAfterEveryCodeRunAndNeverAfterALightOne(t *testing.T) {
	w := newWorld(t)
	counter := filepath.Join(t.TempDir(), "stops")
	stop := func(r *protocol.Run) {
		r.Thread.ID = "strand"
		r.StopCommand = str("echo x >> " + counter)
	}
	w.execute(w.run("01a", protocol.Task, "answer", stop))
	w.execute(w.run("01b", protocol.Correction, "fail", stop))
	w.execute(w.run("01c", protocol.Comment, "answer", stop))
	w.execute(w.run("01d", protocol.Review, "answer", stop))
	data, _ := os.ReadFile(counter)
	if strings.Count(string(data), "x") != 2 {
		t.Fatalf("stop ran %q times for task, failed correction, comment and review", data)
	}
	if !strings.Contains(w.texts("01a"), "stop:") {
		t.Fatalf("no stop in the log:\n%s", w.texts("01a"))
	}
}

func TestAFailedSetupEndsTheRunWithItsMessage(t *testing.T) {
	w := newWorld(t)
	run := w.run("01bad", protocol.Task, "answer", func(r *protocol.Run) { r.SetupCommand = str("echo broken; exit 3") })
	w.execute(run)
	res := w.fake.State(run.ID).Result
	if res.Status != protocol.Failed || !strings.Contains(w.texts(run.ID), "setup: broken") {
		t.Fatalf("%+v\n%s", res, w.texts(run.ID))
	}
}

func TestOutcome(t *testing.T) {
	for answer, want := range map[string]string{
		"Outcome: blocked\n\nWhat I need": "blocked",
		"**Outcome:** Blocked":            "blocked",
		"Outcome: done":                   "done",
		"no line at all":                  "done",
		"Summary\nOutcome: blocked":       "done",
		"\n\nOutcome: blocked":            "blocked",
	} {
		if got := Outcome(answer); got != want {
			t.Errorf("Outcome(%q) = %s, want %s", answer, got, want)
		}
	}
}

func TestTheRunEndsWithTheFirstResult(t *testing.T) {
	w := newWorld(t)
	envFile := filepath.Join(t.TempDir(), "env")
	t.Setenv("FAKE_ENV", envFile)
	start := time.Now()
	_, status := w.execute(w.run("01lr", protocol.Task, "lateresult", func(*protocol.Run) {}))
	if status != protocol.Succeeded || time.Since(start) > 20*time.Second {
		t.Fatalf("%q after %s", status, time.Since(start))
	}
	if log := w.texts("01lr"); !strings.Contains(log, "result:Done: the change is pushed.") || strings.Contains(log, "late wake-up") {
		t.Fatalf("the first result is not the one reported:\n%s", log)
	}
	if env, _ := os.ReadFile(envFile); !strings.Contains(string(env), "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1") {
		t.Fatal("background tasks are not switched off for claude")
	}
}
