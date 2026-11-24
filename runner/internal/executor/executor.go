// Package executor runs one run of werkbuch on this machine (spec 6.4, 7.8, 8.1): the working folder (worktree of the
// strand), the setup command, the private files (MCP configuration with `werkbuch-run`, system prompt), the CLI in a
// process group of its own, its log in batches (at most about once a second) and the result. From the claim until
// werkbuch took the result, a lease keeps the heartbeat going and stops the run on cancel, time limit (SIGTERM, after the
// grace SIGKILL, descendants outside the group included) or when werkbuch gave the attempt away (409 `run_replaced`,
// 404: the run stops at once and reports nothing, A475). Two runs of one strand never work in its folder at once.
package executor

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/adapters"
	_ "github.com/baeroe/werkbuch/runner/internal/adapters/claude"
	_ "github.com/baeroe/werkbuch/runner/internal/adapters/codex"
	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/hooks"
	"github.com/baeroe/werkbuch/runner/internal/mcpconfig"
	"github.com/baeroe/werkbuch/runner/internal/procs"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

// RunTokenEnv carries the run token to Codex, which reads its MCP token from the environment.
const RunTokenEnv = "WERKBUCH_RUN_TOKEN"

// Drain is how long the runner reads the output of a CLI that ended while a descendant still holds it.
const Drain = 2 * time.Second

// Executor holds what every run needs.
type Executor struct {
	Client *client.Client
	Git    *git.Manager
	// Repos maps a project identifier to a repository for projects werkbuch sends none for (A491).
	Repos  func() map[string]string
	Report func() protocol.Report
	Log    *slog.Logger
	// Werkbuch hears of an MCP server other than werkbuch-run that offered werkbuch's tools (A495).
	Werkbuch func(server string)
	// Procs is the folder of the records of running CLIs ("" keeps none).
	Procs string
	// Grace is the time between SIGTERM and SIGKILL (spec 6.4: 10 s).
	Grace time.Duration
	// Flush is how often the log goes to werkbuch (spec 6.4: at most about once a second).
	Flush time.Duration
	// Heartbeat is the interval of heartbeats until werkbuch names one.
	Heartbeat time.Duration
	// Retry is how long the runner tries to deliver a result.
	Retry time.Duration
	// LookPath finds the binary of a CLI (tests point it at a fake).
	LookPath func(string) (string, error)
	// RenewBefore is how long before its expiry the git token of a run is renewed (WEBU-31: 10 min).
	RenewBefore time.Duration
	// RenewRetry is the first pause after a failed renewal (5 s, doubling up to a minute).
	RenewRetry time.Duration

	once    sync.Once
	pulse   atomic.Int64
	slotsMu sync.Mutex
	slots   map[string]*slot // working folder name → its turn (one run at a time), gone when nobody waits
}

type slot struct {
	turn  chan struct{}
	users int
}

// SetHeartbeat changes the interval of heartbeats (werkbuch names it in every answer).
func (x *Executor) SetHeartbeat(d time.Duration) { x.pulse.Store(int64(d)) }

func (x *Executor) heartbeat() time.Duration {
	if d := time.Duration(x.pulse.Load()); d > 0 {
		return d
	}
	return x.Heartbeat
}

func (x *Executor) defaults() { x.once.Do(x.setDefaults) }

func (x *Executor) setDefaults() {
	if x.Grace == 0 {
		x.Grace = 10 * time.Second
	}
	if x.Flush == 0 {
		x.Flush = time.Second
	}
	if x.Heartbeat == 0 {
		x.Heartbeat = 15 * time.Second
	}
	if x.Retry == 0 {
		x.Retry = 2 * time.Minute
	}
	if x.RenewBefore == 0 {
		x.RenewBefore = 10 * time.Minute
	}
	if x.RenewRetry == 0 {
		x.RenewRetry = 5 * time.Second
	}
	if x.LookPath == nil {
		x.LookPath = exec.LookPath
	}
	if x.Log == nil {
		x.Log = slog.New(redact.Handler{Next: slog.NewTextHandler(io.Discard, nil)})
	}
	if x.Report == nil {
		x.Report = func() protocol.Report { return protocol.Report{} }
	}
}

// stop reasons besides the statuses canceled and timed_out
const (
	replaced = "replaced"
	shutdown = "shutdown"
)

// Run executes the run until it ends and reports its result; it returns the status werkbuch heard ("" when none).
func (x *Executor) Run(ctx context.Context, e *Execution) string {
	x.defaults()
	run := e.Run
	log := x.Log.With("run", run.ID, "attempt", run.Attempt, "type", run.Type)
	redact.Hold(run.Werkbuch.Token)
	defer redact.Release(run.Werkbuch.Token)
	if run.Git != nil {
		redact.Hold(run.Git.Token)
		defer redact.Release(run.Git.Token)
	}

	tok := &gitToken{}
	defer tok.release()

	l := newLease(ctx, x, e, log)
	sender := newSender(x, e, l)
	result, reason := x.execute(l, e, sender, tok, log)
	sender.close(reason != replaced && reason != shutdown)

	status := ""
	switch reason {
	case replaced, shutdown:
	case protocol.Canceled, protocol.TimedOut:
		result = stoppedResult(reason, run, result)
		fallthrough
	default:
		result.Attempt = run.Attempt
		if x.deliver(ctx, run.ID, result, log) {
			status = result.Status
		}
	}
	l.stop()
	log.Info("run ended", "status", result.Status, "reason", reason, "reported", status != "")
	e.finish(firstNonEmpty(status, reason, result.Status))
	return status
}

func stoppedResult(reason string, run protocol.Run, from protocol.Result) protocol.Result {
	msg := "canceled"
	if reason == protocol.TimedOut {
		msg = fmt.Sprintf("time limit of %d minutes", run.TimeoutMinutes)
	}
	return protocol.Result{Status: reason, Error: &msg, SessionID: from.SessionID, Usage: from.Usage}
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func failed(msg string) protocol.Result {
	msg = adapters.Cut(redact.String(msg), protocol.ErrorMax)
	return protocol.Result{Status: protocol.Failed, Error: &msg}
}

// repo is the repository of a run: the one of werkbuch's `git`, else (only then, A491) a local one of `config.yaml`.
func (x *Executor) repo(run protocol.Run) string {
	if run.Git != nil && run.Git.RepoURL != "" {
		return run.Git.RepoURL
	}
	if x.Repos != nil {
		return x.Repos()[run.Project.Identifier]
	}
	return ""
}

// spec says where a run works: the strand's worktree (its name or ID), else a folder of the run.
func (x *Executor) spec(run protocol.Run) git.Spec {
	spec := git.Spec{Repo: x.repo(run), Name: "run-" + run.ID}
	if run.TeardownCommand != nil {
		spec.Teardown = *run.TeardownCommand
	}
	if run.HeadSHA != nil {
		spec.Head = *run.HeadSHA
	}
	if run.Thread != nil && run.Type != protocol.Review {
		spec.Name = run.Thread.ID
		if run.Thread.Worktree != nil && *run.Thread.Worktree != "" {
			spec.Name = *run.Thread.Worktree
		}
		if run.Thread.BaseBranch != nil {
			spec.Base = *run.Thread.BaseBranch
		}
		spec.Branch = "agent/" + run.Thread.ID
		if run.Thread.Branch != nil && *run.Thread.Branch != "" {
			spec.Branch = *run.Thread.Branch
		}
	}
	return spec
}

// slot takes the working folder of a run for it alone; a second run of the strand waits (its heartbeat goes on). The
// wait counts against its time limit: werkbuch hands out at most one run per strand anyway, so this only guards (A497).
func (x *Executor) slot(ctx context.Context, name string) (func(), error) {
	x.slotsMu.Lock()
	if x.slots == nil {
		x.slots = map[string]*slot{}
	}
	sl := x.slots[name]
	if sl == nil {
		sl = &slot{turn: make(chan struct{}, 1)}
		x.slots[name] = sl
	}
	sl.users++
	x.slotsMu.Unlock()
	leave := func() {
		x.slotsMu.Lock()
		if sl.users--; sl.users == 0 {
			delete(x.slots, name)
		}
		x.slotsMu.Unlock()
	}
	select {
	case sl.turn <- struct{}{}:
		return func() { <-sl.turn; leave() }, nil
	case <-ctx.Done():
		leave()
		return nil, ctx.Err()
	}
}

// TrySlot takes the working folder of a run without waiting (the sweep, A497): false while a run has it or waits for it.
func (x *Executor) TrySlot(name string) (func(), bool) {
	x.slotsMu.Lock()
	defer x.slotsMu.Unlock()
	if x.slots == nil {
		x.slots = map[string]*slot{}
	}
	if sl := x.slots[name]; sl != nil {
		return nil, false
	}
	sl := &slot{turn: make(chan struct{}, 1), users: 1}
	sl.turn <- struct{}{}
	x.slots[name] = sl
	return func() {
		<-sl.turn
		x.slotsMu.Lock()
		if sl.users--; sl.users == 0 {
			delete(x.slots, name)
		}
		x.slotsMu.Unlock()
	}, true
}

// slotCount is the number of working folders with a run or a waiting one (tests).
func (x *Executor) slotCount() int {
	x.slotsMu.Lock()
	defer x.slotsMu.Unlock()
	return len(x.slots)
}

// GroupGrace is how long what a CLI left running in its group gets after the CLI ended by itself.
const GroupGrace = 2 * time.Second

// Teardown runs the teardown command of a folder before it goes (also for the sweep of the daemon).
func (x *Executor) Teardown(ctx context.Context, dir, command string) {
	if _, err := hooks.Run(ctx, dir, command, nil); err != nil {
		x.Log.Warn("teardown failed", "dir", dir, "err", err)
	}
}

// execute runs the CLI; the reason is why the run stopped before the CLI ended by itself ("" when it did: a decision
// of the lease after that changes nothing).
func (x *Executor) execute(l *lease, e *Execution, s *sender, tok *gitToken, log *slog.Logger) (protocol.Result, string) {
	run := e.Run
	ctx := l.ctx
	adapter := adapters.For(run.CLI)
	if adapter == nil {
		return failed("the runner does not know the CLI " + run.CLI), ""
	}
	binary, err := x.LookPath(run.CLI)
	if err != nil {
		return failed(run.CLI + " is not installed on the runner"), ""
	}

	spec := x.spec(run)
	name, err := git.Name(spec.Name)
	if err != nil {
		return failed(err.Error()), ""
	}
	release, err := x.slot(ctx, name)
	if err != nil {
		return protocol.Result{}, l.reason()
	}
	defer release()

	// the token of git lives in a private folder of its own from the clone on (not in the one a light run may read, A531)
	if run.Git != nil && run.Git.RepoURL != "" && run.Git.Token != "" {
		secret, err := mcpconfig.Folder()
		if err != nil {
			return failed("git token: " + err.Error()), ""
		}
		defer secret.Remove()
		tok.file = git.NewTokenFile(secret.Dir, run.Git.RepoURL)
		if err := tok.file.Write(run.Git.Token); err != nil {
			return failed("git token: " + err.Error()), ""
		}
		spec.Auth = tok.file
		r := x.newRenewer(l, run, tok, s, log)
		floor := time.Duration(0)
		// a token that is (nearly) out already is renewed before the clone; a failure that may pass goes on in the background
		if r.due() {
			switch r.try(ctx) {
			case giveUp:
				if ctx.Err() != nil {
					return protocol.Result{}, l.reason()
				}
				r.expires = nil
			case tryAgain:
				floor = x.RenewRetry
			}
		}
		defer r.start(floor)()
	}

	ws, err := x.Git.Prepare(ctx, spec)
	if ctx.Err() != nil {
		if ws != nil && (ws.Temporary || spec.Name == "run-"+run.ID) {
			x.Git.Remove(context.WithoutCancel(ctx), ws.Dir, x.Teardown)
		}
		return protocol.Result{}, l.reason()
	}
	if err != nil {
		return failed("working folder: " + err.Error()), ""
	}
	e.mu.Lock()
	e.dir = ws.Dir
	e.mu.Unlock()
	if ws.Temporary || spec.Name == "run-"+run.ID {
		defer x.Git.Remove(context.WithoutCancel(ctx), ws.Dir, x.Teardown)
	}
	s.add(protocol.Event{Kind: protocol.KindSystem, Text: "working in " + ws.Dir, At: time.Now().UTC()})
	if ws.Created && run.SetupCommand != nil && *run.SetupCommand != "" {
		out, err := hooks.Run(ctx, ws.Dir, *run.SetupCommand, ws.Env)
		if out != "" {
			s.add(protocol.Event{Kind: protocol.KindSystem, Text: adapters.Cut("setup: "+out, protocol.EventTextMax), At: time.Now().UTC()})
		}
		if ctx.Err() != nil {
			return protocol.Result{}, l.reason()
		}
		if err != nil {
			return failed("setup command: " + err.Error()), ""
		}
	}

	private, err := mcpconfig.Write(run)
	if err != nil {
		return failed("mcp config: " + err.Error()), ""
	}
	defer private.Remove()
	job := adapters.Job{Run: run, Binary: binary, Dir: ws.Dir, MCPConfig: private.Path}
	if run.SystemPrompt != "" {
		if job.SystemPromptFile, err = private.Put("system-prompt.md", run.SystemPrompt); err != nil {
			return failed("system prompt: " + err.Error()), ""
		}
	}
	if run.CLI == "codex" {
		job.TokenEnv = RunTokenEnv
	}
	if protocol.Light(run.Type) {
		job.Private = private.Dir
		if head, err := x.prepareContext(ctx, private, ws, run.Type, spec.Base); err != nil {
			return failed("context: " + err.Error()), ""
		} else if head != "" {
			job.Run.Prompt = head + job.Run.Prompt
		}
	}
	cmd := adapter.Command(job)
	// a light run pushes nothing: the token is the runner's for clone and fetch; its CLI gets neither file nor gh of the
	// run, and git and gh fail closed instead of using the logins of the machine (A531)
	cmd.Env = append(os.Environ(), ws.Env...)
	if protocol.Light(run.Type) {
		empty, err := mcpconfig.Folder()
		if err != nil {
			return failed("gh: " + err.Error()), ""
		}
		defer empty.Remove()
		cmd.Env = append(os.Environ(), git.ClosedEnv(empty.Dir)...)
	}
	cmd.Env = append(cmd.Env,
		"WERKBUCH_RUN_ID="+run.ID,
		"GIT_AUTHOR_NAME="+run.CommitIdentity.Name, "GIT_AUTHOR_EMAIL="+run.CommitIdentity.Email,
		"GIT_COMMITTER_NAME="+run.CommitIdentity.Name, "GIT_COMMITTER_EMAIL="+run.CommitIdentity.Email,
	)
	if job.TokenEnv != "" {
		cmd.Env = append(cmd.Env, job.TokenEnv+"="+run.Werkbuch.Token)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// stdout and stderr are pipes of their own (files, no copying in os/exec): Wait ends with the CLI, never waits for
	// a descendant that keeps them open
	out, in, err := os.Pipe()
	if err != nil {
		return failed(err.Error()), ""
	}
	errOut, errIn, err := os.Pipe()
	if err != nil {
		out.Close()
		in.Close()
		return failed(err.Error()), ""
	}
	closeAll := func() { out.Close(); in.Close(); errOut.Close(); errIn.Close() }
	cmd.Stdout, cmd.Stderr = in, errIn
	stderr := &tail{max: 8192}
	if ctx.Err() != nil {
		closeAll()
		return protocol.Result{}, l.reason()
	}
	if err := cmd.Start(); err != nil {
		closeAll()
		return failed("start " + run.CLI + ": " + err.Error()), ""
	}
	in.Close()
	errIn.Close()
	pid := cmd.Process.Pid
	if err := procs.Note(x.Procs, run.ID, pid); err != nil {
		log.Warn("no record of the cli", "err", err)
	}
	defer procs.Forget(x.Procs, run.ID)
	e.set("running")
	log.Info("cli started", "cli", run.CLI, "model", run.Model, "dir", ws.Dir, "resume", run.SessionID() != "")

	stream := adapter.Stream()
	read := make(chan struct{})
	readErr := make(chan struct{})
	go func() {
		defer close(read)
		sc := bufio.NewScanner(out)
		sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for sc.Scan() {
			s.add(stream.Feed(sc.Bytes())...)
		}
	}()
	go func() {
		defer close(readErr)
		io.Copy(stderr, errOut)
	}()
	waited := make(chan error, 1)
	exited := make(chan struct{})
	go func() {
		err := cmd.Wait()
		close(exited)
		drain := time.After(Drain)
		for _, done := range []chan struct{}{read, readErr} {
			select {
			case <-done:
			case <-drain:
			}
		}
		out.Close()
		errOut.Close()
		<-read
		<-readErr
		waited <- err
	}()

	// the reason is fixed when the CLI ends: a cancel or time limit after its own end changes nothing, only a run
	// werkbuch gave away stays unreported
	stoppedBy := ""
	select {
	case <-exited:
	case <-l.decided:
		stoppedBy = l.reason()
		e.set("stopping")
		procs.Stop(pid, x.Grace, func() bool {
			select {
			case <-exited:
				return true
			default:
				return false
			}
		})
	}
	// what the CLI left running in its group (a dev server started with &) goes with it
	procs.Stop(pid, GroupGrace, func() bool { return syscall.Kill(-pid, 0) != nil })
	exitErr := <-waited
	if l.reason() == replaced {
		stoppedBy = replaced
	}
	if r := stoppedBy; r != "" {
		o := stream.Outcome()
		res := protocol.Result{Usage: o.Usage}
		if o.SessionID != "" {
			res.SessionID = &o.SessionID
		}
		return res, r
	}

	outcome := stream.Outcome()
	for _, server := range outcome.Werkbuch {
		if x.Werkbuch != nil {
			x.Werkbuch(server)
		}
	}
	res := protocol.Result{Status: protocol.Succeeded, Usage: outcome.Usage}
	if outcome.SessionID != "" {
		id := outcome.SessionID
		res.SessionID = &id
	}
	if exitErr != nil || outcome.IsError {
		msg := outcome.Error
		if msg == "" {
			msg = strings.TrimSpace(stderr.String())
		}
		if msg == "" && exitErr != nil {
			msg = exitErr.Error()
		}
		f := failed(run.CLI + ": " + msg)
		f.SessionID, f.Usage = res.SessionID, res.Usage
		return f, ""
	}
	x.complete(context.WithoutCancel(ctx), &res, run, ws, outcome)
	return res, ""
}

// prepareContext writes what a light run would ask git for into its private folder (it has no shell, A493) and returns
// the head of the prompt that names the files.
func (x *Executor) prepareContext(ctx context.Context, private *mcpconfig.File, ws *git.Workspace, kind, base string) (string, error) {
	files := x.Git.Context(ctx, ws, kind, base)
	if len(files) == 0 {
		return "", nil
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	head := "The runner prepared these files for this run (read them with the Read tool; there is no shell):\n"
	for _, name := range names {
		path, err := private.Put(name, files[name])
		if err != nil {
			return "", err
		}
		head += "- " + path + "\n"
	}
	return head + "\n", nil
}

var (
	verdictLine = regexp.MustCompile("(?im)^[\\s>*_#`-]*verdict\\b[\\s*_`]*[:=-]?[\\s*_`]*(approved?|changes)\\b")
	verdictLead = regexp.MustCompile("(?im)^[\\s>*_#`-]*(approved?|changes)\\b")
)

// Verdict reads the verdict of a review out of its answer: an explicit line `Verdict: approve|approved|changes` first,
// else the first line that starts with one of the words (Markdown marks allowed), else none (A498).
func Verdict(answer string) string {
	m := verdictLine.FindStringSubmatch(answer)
	if m == nil {
		m = verdictLead.FindStringSubmatch(answer)
	}
	if m == nil {
		return ""
	}
	if v := strings.ToLower(m[1]); v != "changes" {
		return "approve"
	}
	return "changes"
}

func (x *Executor) complete(ctx context.Context, res *protocol.Result, run protocol.Run, ws *git.Workspace, o adapters.Outcome) {
	answer := redact.String(o.Answer)
	switch {
	case run.Type == protocol.Review:
		v := Verdict(answer)
		if v == "" {
			*res = failed("the review gave no verdict (approve or changes)")
			return
		}
		text := adapters.Cut(answer, protocol.TextMax)
		res.Verdict, res.Text = &v, &text
	case run.Type == protocol.Comment:
		text := adapters.Cut(answer, protocol.TextMax)
		res.Text = &text
	case protocol.Codes(run.Type):
		if answer != "" {
			summary := adapters.Cut(answer, protocol.SummaryMax)
			res.Summary = &summary
		}
		if head := x.Git.Head(ctx, ws); head != "" && head != ws.StartHead {
			res.Commit = &head
		}
	}
}

// deliver sends the result until werkbuch takes it, refuses it, or Retry is spent; the lease beats meanwhile.
func (x *Executor) deliver(ctx context.Context, id string, res protocol.Result, log *slog.Logger) bool {
	until := time.Now().Add(x.Retry)
	wait := 500 * time.Millisecond
	for {
		err := x.Client.Result(context.WithoutCancel(ctx), id, res)
		if err == nil {
			return true
		}
		var p *client.ProblemError
		if errors.As(err, &p) && p.Status < 500 && p.Status != 429 {
			log.Warn("result refused", "err", err)
			return false
		}
		if time.Now().After(until) {
			log.Error("result not delivered", "err", err)
			return false
		}
		log.Warn("result failed, again", "err", err)
		time.Sleep(wait)
		if wait < 15*time.Second {
			wait *= 2
		}
	}
}

// tail keeps the end of what is written to it.
type tail struct {
	mu  sync.Mutex
	max int
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > t.max {
		t.buf = t.buf[len(t.buf)-t.max:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}
