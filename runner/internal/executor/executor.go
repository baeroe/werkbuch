// Package executor runs one run of werkbuch on this machine (spec 6.4, 7.8, 8.1): the working folder (worktree of the
// strand), the setup command, the MCP configuration with `werkbuch-run`, the CLI in a process group of its own, its log
// in batches (at most about once a second), a heartbeat, cancel and time limit (SIGTERM, after the grace SIGKILL), and
// the result. A run that werkbuch gave away (409 `run_replaced`, 404) stops at once and reports nothing (A475).
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
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

// RunTokenEnv carries the run token to CLIs that read their MCP token from the environment (Codex).
const RunTokenEnv = "WERKBUCH_RUN_TOKEN"

// Executor holds what every run needs.
type Executor struct {
	Client *client.Client
	Git    *git.Manager
	// Repos maps a project identifier to a repository for projects werkbuch sends none for (A488).
	Repos  func() map[string]string
	Report func() protocol.Report
	Log    *slog.Logger
	// Werkbuch hears of an MCP server other than werkbuch-run that offered werkbuch's tools (A492).
	Werkbuch func(server string)
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

	once  sync.Once
	pulse atomic.Int64
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

	sender := newSender(x, e)
	result, reason := x.execute(ctx, e, sender, log)
	sender.close(reason != replaced)

	status := ""
	if reason != replaced && reason != shutdown {
		result.Attempt = run.Attempt
		if x.deliver(ctx, run.ID, result, log) {
			status = result.Status
		}
	}
	log.Info("run ended", "status", result.Status, "reason", reason, "reported", status != "")
	e.finish(firstNonEmpty(status, reason, result.Status))
	return status
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

func (x *Executor) repo(run protocol.Run) (string, string) {
	if run.Git != nil && run.Git.RepoURL != "" {
		return run.Git.RepoURL, run.Git.Token
	}
	if x.Repos != nil {
		if r := x.Repos()[run.Project.Identifier]; r != "" {
			return r, ""
		}
	}
	return "", ""
}

func (x *Executor) workspace(ctx context.Context, run protocol.Run) (*git.Workspace, error) {
	repo, token := x.repo(run)
	spec := git.Spec{Repo: repo, Token: token, Name: "run-" + run.ID}
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
	ws, err := x.Git.Prepare(ctx, spec)
	if err == nil && spec.Name == "run-"+run.ID {
		ws.Temporary = true
	}
	return ws, err
}

func (x *Executor) teardown(ctx context.Context, dir, command string) {
	if _, err := hooks.Run(ctx, dir, command, nil); err != nil {
		x.Log.Warn("teardown failed", "dir", dir, "err", err)
	}
}

func (x *Executor) execute(ctx context.Context, e *Execution, s *sender, log *slog.Logger) (protocol.Result, string) {
	run := e.Run
	adapter := adapters.For(run.CLI)
	if adapter == nil {
		return failed("the runner does not know the CLI " + run.CLI), ""
	}
	binary, err := x.LookPath(run.CLI)
	if err != nil {
		return failed(run.CLI + " is not installed on the runner"), ""
	}

	ws, err := x.workspace(ctx, run)
	if err != nil {
		return failed("working folder: " + err.Error()), ""
	}
	e.mu.Lock()
	e.dir = ws.Dir
	e.mu.Unlock()
	if ws.Temporary {
		defer x.Git.Remove(context.WithoutCancel(ctx), ws.Dir, x.teardown)
	}
	s.add(protocol.Event{Kind: protocol.KindSystem, Text: "working in " + ws.Dir, At: time.Now().UTC()})
	if ws.Created && run.SetupCommand != nil && *run.SetupCommand != "" {
		out, err := hooks.Run(ctx, ws.Dir, *run.SetupCommand, ws.Env)
		if out != "" {
			s.add(protocol.Event{Kind: protocol.KindSystem, Text: adapters.Cut("setup: "+out, protocol.EventTextMax), At: time.Now().UTC()})
		}
		if err != nil {
			return failed("setup command: " + err.Error()), ""
		}
	}

	mcp, err := mcpconfig.Write(run)
	if err != nil {
		return failed("mcp config: " + err.Error()), ""
	}
	defer mcp.Remove()

	cmd := adapter.Command(adapters.Job{Run: run, Binary: binary, Dir: ws.Dir, MCPConfig: mcp.Path, TokenEnv: RunTokenEnv})
	cmd.Env = append(os.Environ(), ws.Env...)
	cmd.Env = append(cmd.Env,
		RunTokenEnv+"="+run.Werkbuch.Token,
		"WERKBUCH_RUN_ID="+run.ID,
		"GIT_AUTHOR_NAME="+run.CommitIdentity.Name, "GIT_AUTHOR_EMAIL="+run.CommitIdentity.Email,
		"GIT_COMMITTER_NAME="+run.CommitIdentity.Name, "GIT_COMMITTER_EMAIL="+run.CommitIdentity.Email,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return failed(err.Error()), ""
	}
	stderr := &tail{max: 8192}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return failed("start " + run.CLI + ": " + err.Error()), ""
	}
	e.set("running")
	log.Info("cli started", "cli", run.CLI, "model", run.Model, "dir", ws.Dir, "resume", run.SessionID() != "")

	stream := adapter.Stream()
	read := make(chan struct{})
	go func() {
		defer close(read)
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
		for sc.Scan() {
			events := stream.Feed(sc.Bytes())
			for i := range events {
				events[i].Text = redact.String(events[i].Text)
			}
			s.add(events...)
		}
		io.Copy(io.Discard, stdout)
	}()
	waited := make(chan error, 1)
	go func() {
		<-read
		waited <- cmd.Wait()
	}()

	reason := x.watch(ctx, e, s, waited, cmd.Process.Pid, log)
	exitErr := <-waited
	if reason == replaced || reason == shutdown {
		return protocol.Result{}, reason
	}

	outcome := stream.Outcome()
	for _, server := range outcome.Werkbuch {
		if x.Werkbuch != nil {
			x.Werkbuch(server)
		}
	}
	res := protocol.Result{Status: protocol.Succeeded}
	if outcome.SessionID != "" {
		id := outcome.SessionID
		res.SessionID = &id
	}
	res.Usage = outcome.Usage
	switch {
	case reason == protocol.Canceled || reason == protocol.TimedOut:
		res.Status = reason
		msg := map[string]string{protocol.Canceled: "canceled", protocol.TimedOut: fmt.Sprintf("time limit of %d minutes", run.TimeoutMinutes)}[reason]
		res.Error = &msg
		return res, reason
	case exitErr != nil || outcome.IsError:
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
	x.complete(ctx, &res, run, ws, outcome)
	return res, ""
}

var verdictRe = regexp.MustCompile("(?im)^[\\s>*_#`-]*(?:verdict\\b[\\s*_`]*[:=-]?[\\s*_`]*)?(approve|changes)\\b")

// Verdict reads the verdict of a review out of its answer: the first line that starts with `approve` or `changes`
// (Markdown marks and a leading "Verdict:" allowed), else none (A495).
func Verdict(answer string) string {
	m := verdictRe.FindStringSubmatch(answer)
	if m == nil {
		return ""
	}
	return strings.ToLower(m[1])
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

// watch waits for the CLI and keeps the heartbeat; it stops the CLI on cancel, time limit, a replaced run or the end
// of ctx and returns why ("" when the CLI ended by itself).
func (x *Executor) watch(ctx context.Context, e *Execution, s *sender, waited chan error, pid int, log *slog.Logger) string {
	run := e.Run
	deadline := run.Deadline(e.Started)
	limit := time.NewTimer(time.Until(deadline))
	defer limit.Stop()
	interval := x.heartbeat()
	beat := time.NewTimer(interval)
	defer beat.Stop()

	stopWith := func(reason string) string {
		e.set("stopping")
		log.Info("stopping the cli", "reason", reason)
		x.terminate(pid, waited)
		return reason
	}
	for {
		select {
		case err := <-waited:
			waited <- err
			return ""
		case reason := <-e.stop:
			return stopWith(reason)
		case reason := <-s.gone:
			return stopWith(reason)
		case <-limit.C:
			return stopWith(protocol.TimedOut)
		case <-ctx.Done():
			return stopWith(shutdown)
		case <-beat.C:
			a, err := x.Client.Heartbeat(ctx, run.ID, run.Attempt, x.Report())
			switch {
			case client.Replaced(err) || client.Unauthorized(err):
				return stopWith(replaced)
			case err != nil:
				log.Warn("heartbeat failed", "err", err)
			default:
				if a.Cancel {
					return stopWith(protocol.Canceled)
				}
				if a.DeadlineAt != nil && !a.DeadlineAt.Equal(deadline) {
					deadline = *a.DeadlineAt
					limit.Reset(time.Until(deadline))
				}
				if a.HeartbeatSeconds > 0 {
					interval = time.Duration(a.HeartbeatSeconds) * time.Second
				}
			}
			beat.Reset(interval)
		}
	}
}

// terminate sends SIGTERM to the process group of the CLI and SIGKILL after the grace (spec 6.4).
func (x *Executor) terminate(pid int, waited chan error) {
	syscall.Kill(-pid, syscall.SIGTERM)
	select {
	case err := <-waited:
		waited <- err
		return
	case <-time.After(x.Grace):
	}
	syscall.Kill(-pid, syscall.SIGKILL)
}

// deliver sends the result until werkbuch takes it, refuses it as replaced, or Retry is spent.
func (x *Executor) deliver(ctx context.Context, id string, res protocol.Result, log *slog.Logger) bool {
	until := time.Now().Add(x.Retry)
	wait := time.Second
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
