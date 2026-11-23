package executor

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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
	r := protocol.Run{ID: id, Attempt: 1, Type: kind, CLI: "claude", Model: "sonnet", TimeoutMinutes: 60, Prompt: prompt, SystemPrompt: "contract"}
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
	for _, want := range []string{"--model\nsonnet", "--mcp-config\n", "--append-system-prompt\ncontract", "--permission-mode\nbypassPermissions"} {
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
	head := gitIn(t, w.origin, "rev-parse", "HEAD")
	run := w.run("01rev", protocol.Review, "review", func(r *protocol.Run) {
		r.HeadSHA = &head
		r.TeardownCommand = str("touch " + filepath.Join(w.t.TempDir(), "teardown"))
	})
	e, status := w.execute(run)
	res := w.fake.State(run.ID).Result
	if status != protocol.Succeeded || *res.Verdict != "approve" || !strings.Contains(*res.Text, "No findings") {
		t.Fatalf("%q %+v", status, res)
	}
	if _, err := os.Stat(e.Summary().Dir); !os.IsNotExist(err) {
		t.Fatal("the worktree of a review goes after the run")
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
	run := w.run("01leak", protocol.Task, "leak werkbuch")
	if _, status := w.execute(run); status != protocol.Succeeded {
		t.Fatal(status)
	}
	texts := w.texts(run.ID)
	if strings.Contains(texts, "runtoken") || !strings.Contains(texts, "my token is [token]") {
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
		"**Verdict:** approve\n\nok":             "approve",
		"Verdict: changes\n- Important: x":       "changes",
		"## Changes\nsome":                       "changes",
		"I looked.\n\napprove":                   "approve",
		"Nothing to say about approvals in here": "",
	} {
		if got := Verdict(in); got != want {
			t.Errorf("%q: %q", in, got)
		}
	}
}
