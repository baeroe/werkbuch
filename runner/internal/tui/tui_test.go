package tui

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
)

// fake is a daemon in memory.
type fake struct {
	mu        sync.Mutex
	st        *socket.Status // nil: no daemon answers
	runs      []executor.Summary
	load      socket.LoadAnswer
	events    map[string][]protocol.Event
	live      map[string]chan protocol.Event // streamed after the past lines until closed
	streams   []string
	stopped   int // streams whose context ended
	canceled  []string
	cancelErr error
	checks    []socket.Check
	doctorErr error // the answer of /doctor while the daemon answers
	doctors   int
}

var errDown = errors.New("dial unix /tmp/wr.sock: connect: no such file or directory")

func (f *fake) Status(ctx context.Context) (socket.Status, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.st == nil {
		return socket.Status{}, errDown
	}
	return *f.st, nil
}

func (f *fake) Runs(ctx context.Context) ([]executor.Summary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]executor.Summary(nil), f.runs...), nil
}

func (f *fake) Load(ctx context.Context) (socket.LoadAnswer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.load, nil
}

func (f *fake) Events(ctx context.Context, id string, each func(protocol.Event)) error {
	f.mu.Lock()
	f.streams = append(f.streams, id)
	past, live := f.events[id], f.live[id]
	f.mu.Unlock()
	if f.st == nil {
		return errDown
	}
	for _, ev := range past {
		each(ev)
	}
	if live == nil {
		return nil
	}
	for {
		select {
		case ev, open := <-live:
			if !open {
				return nil
			}
			each(ev)
		case <-ctx.Done():
			f.mu.Lock()
			f.stopped++
			f.mu.Unlock()
			return nil
		}
	}
}

func (f *fake) Cancel(ctx context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.canceled = append(f.canceled, id)
	return f.cancelErr
}

func (f *fake) Doctor(ctx context.Context) ([]socket.Check, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.st == nil {
		return nil, errDown
	}
	f.doctors++
	if f.doctorErr != nil {
		return nil, f.doctorErr
	}
	return f.checks, nil
}

// harness drives a Model: commands run at once, a command that blocks (the live log) waits in pending.
type harness struct {
	t       *testing.T
	f       *fake
	m       *Model
	now     time.Time
	pending []chan tea.Msg
	logouts int
}

var now0 = time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)

func ptr[T any](v T) *T { return &v }

func demoStatus() *socket.Status {
	places := &protocol.Places{Total: 2, PerRepo: 1, Light: 2}
	places.Used.Total = 1
	return &socket.Status{
		Instance: "https://werkbuch.example.com", System: "darwin/arm64", Version: "0.4.0", Connected: true,
		LastContact: now0.Add(-2 * time.Second), Places: places, Running: 1, Started: now0.Add(-2 * time.Hour),
		Load: &protocol.Load{CPU: 31, GPU: ptr(12.0), RAMUsed: 38.2, RAMTotal: 64, DiskFree: 182, DiskTotal: 994},
		CLIs: []protocol.CLI{{CLI: "claude", Installed: true, LoggedIn: true}},
		Equipment: &protocol.Equipment{MCPServers: []string{"werkbuch-mara", "context7"}, Skills: []string{"ops:runbook"},
			WerkbuchAccess: []string{"werkbuch-mara"}},
	}
}

func demoRuns() []executor.Summary {
	return []executor.Summary{
		{ID: "01run51", Type: "task", CLI: "claude", Model: "sonnet", Project: "WEB", Item: "WEB-51", Title: "Cookie-Banner auf Consent v2 umstellen",
			Status: "running", Branch: "agent/WEB-51-cookie-banner", Session: "4f2c9e1a77", Dir: "/home/demo/.local/share/werkbuch-runner/worktrees/WEB-51", Started: now0.Add(-6*time.Minute - 12*time.Second)},
		{ID: "01run44", Type: "review", Model: "opus", Project: "WEB", Item: "WEB-44", Title: "Footer-Links prüfen", Status: "finished", Result: "succeeded",
			Started: now0.Add(-22 * time.Minute), Ended: now0.Add(-11 * time.Minute)},
		{ID: "01run53", Type: "task", Model: "haiku", Project: "OPS", Status: "finished", Result: "timed_out",
			Started: now0.Add(-110 * time.Minute), Ended: now0.Add(-50 * time.Minute)},
	}
}

func demoHistory() []protocol.Load {
	var h []protocol.Load
	for i := range 60 {
		h = append(h, protocol.Load{CPU: float64(i), GPU: ptr(5.0), RAMUsed: 30, RAMTotal: 64, DiskFree: 200, DiskTotal: 994})
	}
	return h
}

func newHarness(t *testing.T, f *fake, opts Options) *harness {
	t.Helper()
	h := &harness{t: t, f: f, now: now0}
	opts.Source, opts.NoTick, opts.Socket, opts.Home = f, true, "/tmp/wr.sock", "/home/demo"
	opts.Now = func() time.Time { return h.now }
	if opts.Logout == nil {
		opts.Logout = func() (string, error) {
			h.logouts++
			return "Forgot the token of this runner. Revoke the runner in werkbuch, too.", nil
		}
	}
	h.m = New(opts)
	h.send(tea.WindowSizeMsg{Width: 120, Height: 34})
	h.run(h.m.Init())
	return h
}

func (h *harness) send(msg tea.Msg) {
	h.t.Helper()
	_, cmd := h.m.Update(msg)
	h.run(cmd)
}

func (h *harness) key(keys ...string) {
	h.t.Helper()
	for _, k := range keys {
		var msg tea.KeyMsg
		switch k {
		case "enter":
			msg = tea.KeyMsg{Type: tea.KeyEnter}
		case "esc":
			msg = tea.KeyMsg{Type: tea.KeyEsc}
		case "tab":
			msg = tea.KeyMsg{Type: tea.KeyTab}
		case "shift+tab":
			msg = tea.KeyMsg{Type: tea.KeyShiftTab}
		case "ctrl+c":
			msg = tea.KeyMsg{Type: tea.KeyCtrlC}
		default:
			msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
		}
		h.send(msg)
	}
}

// run executes a command; one that does not answer within 200 ms waits in pending.
func (h *harness) run(cmd tea.Cmd) {
	h.t.Helper()
	if cmd == nil {
		return
	}
	ch := make(chan tea.Msg, 1)
	go func() { ch <- cmd() }()
	select {
	case msg := <-ch:
		h.deliver(msg)
	case <-time.After(200 * time.Millisecond):
		h.pending = append(h.pending, ch)
	}
}

func (h *harness) deliver(msg tea.Msg) {
	h.t.Helper()
	switch msg := msg.(type) {
	case nil, tea.QuitMsg:
	case tea.BatchMsg:
		for _, c := range msg {
			h.run(c)
		}
	default:
		h.send(msg)
	}
}

// settle delivers what pending commands answer within d.
func (h *harness) settle(d time.Duration) {
	h.t.Helper()
	deadline := time.After(d)
	for len(h.pending) > 0 {
		waiting := h.pending
		h.pending = nil
		progressed := false
		for _, ch := range waiting {
			select {
			case msg := <-ch:
				progressed = true
				h.deliver(msg)
			case <-deadline:
				h.pending = append(h.pending, ch)
			}
		}
		if !progressed {
			return
		}
	}
}

func (h *harness) view() string { return ansi.Strip(h.m.View()) }

func (h *harness) sees(parts ...string) {
	h.t.Helper()
	v := h.view()
	for _, p := range parts {
		if !strings.Contains(v, p) {
			h.t.Fatalf("missing %q in\n%s", p, v)
		}
	}
}

func (h *harness) misses(parts ...string) {
	h.t.Helper()
	v := h.view()
	for _, p := range parts {
		if strings.Contains(v, p) {
			h.t.Fatalf("unexpected %q in\n%s", p, v)
		}
	}
}

func connected() *fake {
	return &fake{st: demoStatus(), runs: demoRuns(), load: socket.LoadAnswer{Last: demoStatus().Load, History: demoHistory()},
		events: map[string][]protocol.Event{
			"01run51": {
				{Kind: protocol.KindTool, Text: "Read resources/js/consent/banner.ts", At: now0.Add(-6*time.Minute - 12*time.Second + 31*time.Second)},
				{Kind: protocol.KindText, Text: "Das Banner setzt nur ein Cookie „consent=1“.", At: now0.Add(-6*time.Minute - 12*time.Second + 44*time.Second)},
			},
			"01run44": {{Kind: protocol.KindResult, Text: "changes requested (2 findings)", At: now0.Add(-11 * time.Minute)}},
		},
		checks: []socket.Check{
			{Name: "version", Level: "ok", Detail: "0.4.0"},
			{Name: "keychain", Level: "ok", Detail: "runner token for https://werkbuch.example.com (werkbuch-runner)"},
			{Name: "codex", Level: "warn", Detail: "/opt/homebrew/bin/codex 0.40.0 is not signed in: run `codex login` once and sign in"},
			{Name: "equipment", Level: "ok", Detail: "MCP servers: werkbuch-mara, context7; skills: 1; plugins: none"},
			{Name: "werkbuch access", Level: "warn", Detail: "the MCP server werkbuch-mara reaches werkbuch.example.com past the run token: switch it off for the user of the runner"},
		},
	}
}

func TestWithoutADaemon(t *testing.T) {
	f := &fake{}
	h := newHarness(t, f, Options{LocalDoctor: func(context.Context) []socket.Check {
		return []socket.Check{{Name: "config", Level: "ok", Detail: "/home/demo/.config/werkbuch-runner/config.yaml"}, {Name: "daemon", Level: "warn", Detail: "no daemon runs"}}
	}})
	h.sees("werkbuch-runner", "1 Status", "2 Runs", "3 Doctor", "○ no daemon", "No daemon answers on /tmp/wr.sock", "werkbuch-runner daemon", "Slots are set in werkbuch")
	h.key("r")
	h.sees("no daemon answers")
	h.key("2")
	h.sees("No daemon answers: runs show once it does")
	h.key("3")
	h.sees("checked by this terminal", "config", "1 warning")
	if f.doctors != 0 {
		t.Fatal("asked a daemon that is not there")
	}
}

func TestWithoutADaemonNorLocalChecks(t *testing.T) {
	h := newHarness(t, &fake{}, Options{Tab: TabDoctor})
	h.sees("No daemon answers: start it")
}

func TestStatus(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{})
	h.sees("● connected · 1/2 slots",
		"instance    https://werkbuch.example.com",
		"darwin/arm64   0.4.0",
		"last contact 2s ago, daemon up 2:00:00",
		"■□  1 of 2", "per repo 0 of 1", "light (reviews, answers) □□  0 of 2", "(from werkbuch)",
		"Load", "last 5 minutes", "31 %", "12 %", "38.2 of 64 GB", "182 of 994 GB free",
		"Running", "WEB-51", "sonnet", "● 6:12", "Cookie-Banner auf Consent v2 umstellen",
		"agent/WEB-51-cookie-banner   session 4f2c9e1a   worktree ~/.local/share/werkbuch-runner/worktrees/WEB-51",
		"Recent", "WEB-44", "✓ done", "OPS", "✗ timed out",
		"Slots are set in werkbuch", "polled now", "enter open run", "l logout")
	if !strings.ContainsAny(h.view(), "▁▂▃") {
		t.Fatal("no history")
	}

	// the version werkbuch expects and the update
	f.st.ExpectedVersion, f.st.Update = "0.5.0", "pending"
	f.st.Load.GPU = nil
	f.load.Last = f.st.Load
	h.key("r")
	h.sees("werkbuch expects 0.5.0", "update pending", "not available on this machine", "refreshed")

	f.st.Connected, f.st.LastError = false, "Get https://werkbuch.example.com: timeout"
	h.key("r")
	h.sees("○ offline", "○ not connected: Get https://werkbuch.example.com: timeout")
	f.st.Unauthorized = true
	h.key("r")
	h.sees("✗ token refused", "pair the runner again")

	f.st = nil
	h.key("r")
	h.sees("○ no daemon")
}

func TestStatusWithoutRunsOrPlaces(t *testing.T) {
	f := connected()
	f.runs, f.st.Places, f.st.Load, f.load = nil, nil, nil, socket.LoadAnswer{}
	h := newHarness(t, f, Options{})
	h.sees("werkbuch names them on the first contact", "not measured yet", "none: the runner waits")
	h.misses("Recent", "enter open run")
	h.key("enter", "j")
	if h.m.tab != TabStatus {
		t.Fatal("enter without a run left Status")
	}
}

func TestEnterOpensTheChosenRun(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{})
	if h.m.statusSel != "01run51" {
		t.Fatal(h.m.statusSel)
	}
	h.key("j", "j", "j", "k")
	if h.m.statusSel != "01run44" {
		t.Fatal(h.m.statusSel)
	}
	h.key("enter")
	if h.m.tab != TabRuns || h.m.runSel != "01run44" {
		t.Fatalf("%v %s", h.m.tab, h.m.runSel)
	}
	h.sees("LOG  WEB-44 review, opus, 11:00", "changes requested (2 findings)")
	h.misses("c cancel")
}

func TestRunsLogLive(t *testing.T) {
	f := connected()
	live := make(chan protocol.Event, 10)
	f.live = map[string]chan protocol.Event{"01run51": live}
	h := newHarness(t, f, Options{Tab: TabRuns})
	h.sees("RUN", "STATUS", "WEB-51 task", "● running", "WEB-44 review", "✓ done", "✗ timed out",
		"LOG  WEB-51 task, sonnet, 6:12", "+0:31   Read resources/js/consent/banner.ts", "+0:44   Das Banner", "▍",
		"following WEB-51", "c cancel")
	live <- protocol.Event{Kind: protocol.KindTool, Text: "Edit tests/js/consent.test.ts", At: now0.Add(-5 * time.Minute)}
	live <- protocol.Event{Kind: protocol.KindError, Text: "3 failed, 2 passed", At: now0.Add(-5 * time.Minute)}
	h.settle(2 * time.Second)
	h.sees("+1:12   Edit tests/js/consent.test.ts", "3 failed, 2 passed")

	// another run: the stream of WEB-51 ends, the log of WEB-44 shows
	h.key("j")
	h.sees("LOG  WEB-44 review", "changes requested")
	h.misses("Edit tests/js")
	h.settle(time.Second)
	if f.stopped != 1 {
		t.Fatalf("the stream of WEB-51 is still open: %d", f.stopped)
	}
	// a late line of the closed stream is dropped
	h.send(eventsMsg{gen: 1, events: []protocol.Event{{Text: "late line"}}})
	h.misses("late line")

	// leaving the tab closes the stream, coming back opens it again
	h.key("k")
	h.key("1")
	h.settle(time.Second)
	if f.stopped != 2 {
		t.Fatalf("stream open after leaving Runs: %d", f.stopped)
	}
	h.key("2")
	if n := len(f.streams); n != 4 || f.streams[n-1] != "01run51" {
		t.Fatalf("%v", f.streams)
	}
	close(live)
	h.settle(time.Second)
}

func TestRunsFullLogScrolls(t *testing.T) {
	f := connected()
	var evs []protocol.Event
	for i := range 80 {
		evs = append(evs, protocol.Event{Kind: protocol.KindText, Text: "line " + itoa(i), At: now0.Add(-6*time.Minute + time.Duration(i)*time.Second)})
	}
	f.events["01run51"] = evs
	h := newHarness(t, f, Options{Tab: TabRuns})
	h.sees("line 79")
	h.misses("line 20 ")
	h.key("enter")
	h.sees("j/k scroll", "esc back", "line 79")
	h.key("g")
	h.sees("line 0", "more lines (G: to the end)")
	h.misses("line 79", "following WEB-51")
	h.key("j", "j")
	h.sees("line 2")
	h.misses("line 1 ")
	h.key("G")
	h.sees("line 79", "following WEB-51")
	h.key("k")
	h.misses("following WEB-51")
	h.key("f")
	h.sees("following WEB-51")
	h.key("f")
	h.misses("following WEB-51")
	h.key("esc")
	h.sees("j/k move", "f follow log")
	h.key("f")
	h.sees("following WEB-51")
	h.key("f")
	h.misses("following WEB-51")
}

func TestRunsNarrow(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{Tab: TabRuns})
	h.send(tea.WindowSizeMsg{Width: 70, Height: 24})
	h.sees("WEB-51 task", "● running")
	h.misses("LOG")
	h.key("enter")
	h.sees("LOG  WEB-51", "Read resources/js")
	h.key("esc")
	h.misses("LOG")
}

func TestSelectionStaysWithItsRun(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{Tab: TabRuns})
	h.key("j")
	if h.m.runSel != "01run44" {
		t.Fatal(h.m.runSel)
	}
	f.runs = append([]executor.Summary{{ID: "01run60", Type: "comment", Item: "WEB-60", Status: "running", Started: now0}}, f.runs...)
	h.key("r")
	if h.m.runSel != "01run44" {
		t.Fatal("the choice moved with the list")
	}
	f.runs = f.runs[:1]
	streams := len(f.streams)
	h.key("r")
	if h.m.runSel != "01run60" || len(f.streams) != streams+1 {
		t.Fatalf("%s %v", h.m.runSel, f.streams)
	}
	f.runs = nil
	h.key("r")
	h.sees("No runs yet")
}

func TestTheLogComesBackWithTheDaemon(t *testing.T) {
	f := connected()
	f.st = nil
	h := newHarness(t, f, Options{Tab: TabRuns})
	f.st = demoStatus()
	h.key("r")
	h.sees("+0:31")
	// a stream that fails says so
	h.send(eventsMsg{gen: h.m.stream.gen, done: true, err: errors.New("no such run")})
	h.m.stream.events = nil
	h.sees("the log is not available: no such run")
	f.events["01run51"] = nil
	h.key("r")
	h.sees("no lines")
}

func TestCancel(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{Tab: TabRuns})
	h.key("c")
	h.sees("Cancel WEB-51?", "Stop the task run of WEB-51 now?", "werkbuch hears canceled", "y cancel the run", "n esc keep it")
	h.key("n")
	h.misses("Cancel WEB-51?")
	if len(f.canceled) != 0 {
		t.Fatal("canceled without a yes")
	}
	h.key("c", "y")
	if len(f.canceled) != 1 || f.canceled[0] != "01run51" {
		t.Fatalf("%v", f.canceled)
	}
	h.sees("WEB-51: cancel sent, werkbuch hears it")

	f.cancelErr = errors.New("no such run running")
	h.key("c", "enter")
	h.sees("WEB-51: no such run running")

	// an ended run is not canceled
	h.key("j", "c")
	h.sees("WEB-44 has ended")
	h.misses("Cancel WEB-44?")
	// keys of the modal do not reach the tab
	h.key("k", "c", "j")
	if h.m.runSel != "01run51" {
		t.Fatal("j moved under the dialog")
	}
	h.key("esc")
	h.misses("Cancel WEB-51?")
	// the flash goes after its time
	h.now = h.now.Add(10 * time.Second)
	h.misses("has ended")
}

func TestDoctor(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{})
	h.key("3")
	if f.doctors != 1 {
		t.Fatal("no checks")
	}
	h.sees("✓ version", "✓ keychain", "! codex", "not signed in",
		"Harness", "mcp servers     werkbuch-mara, context7 + werkbuch-run with the token of each run", "skills          ops:runbook", "plugins         none",
		"! werkbuch access", "Turn it off for the runner", "2 warnings  Runs stay possible", "checked now")
	h.misses("! equipment", "✓ equipment")
	// back and forth does not check again; r does
	h.key("1", "3")
	if f.doctors != 1 {
		t.Fatal("checked again")
	}
	f.checks = append(f.checks, socket.Check{Name: "agents", Level: "fail", Detail: "no CLI is installed and signed in: the runner gets no runs"})
	h.key("r")
	h.sees("✗ agents", "1 problem   Runs fail", "1 problem 2 warnings")

	// details of the chosen check, j/k clamp
	h.key("k", "j", "j")
	h.key("enter")
	h.sees("╭─ codex", "run `codex login` once and sign in", "esc close")
	h.key("esc")
	h.misses("╭─ codex")
	for range 10 {
		h.key("j")
	}
	h.key("enter")
	h.sees("╭─ werkbuch access")
	h.key("esc")

	f.checks = []socket.Check{{Name: "git", Level: "ok", Detail: "git version 2.47.1"}}
	h.key("r")
	h.sees("✓ all checks passed")

	// without equipment in the status the check line stays
	f.st.Equipment = nil
	f.checks = append(f.checks, socket.Check{Name: "equipment", Level: "ok", Detail: "MCP servers: none"})
	h.key("r")
	h.send(tickMsg{})
	h.sees("✓ equipment", "known once the daemon has reported it")
}

func TestDoctorIgnoresAnOldRun(t *testing.T) {
	h := newHarness(t, connected(), Options{Tab: TabDoctor})
	h.send(doctorMsg{gen: 0, checks: []socket.Check{{Name: "stale", Level: "ok"}}})
	h.misses("stale")
}

func TestLogout(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{})
	h.key("l")
	h.sees("Log out?", "Forget the token of this runner on this machine?", "Revoke the runner in werkbuch")
	h.key("esc")
	if h.logouts != 0 {
		t.Fatal("logged out on esc")
	}
	h.key("l", "y")
	if h.logouts != 1 {
		t.Fatal("no logout")
	}
	h.sees("Forgot the token of this runner")

	h2 := newHarness(t, f, Options{Logout: func() (string, error) { return "", errors.New("not paired") }})
	h2.key("l", "y")
	h2.sees("logout: not paired")
}

func TestHelpAndTabs(t *testing.T) {
	h := newHarness(t, connected(), Options{})
	h.key("?")
	h.sees("Keys", "Everywhere", "jump to a tab", "Status", "open the chosen run in Runs", "log out", "Nothing is set up here")
	h.key("q") // closes the help, does not quit
	if h.m.quiting {
		t.Fatal("q quit under the help")
	}
	h.key("tab")
	h.key("?")
	h.sees("cancel the chosen run")
	h.key("esc", "tab")
	h.key("?")
	h.sees("details of the chosen check")
	h.key("?", "shift+tab")
	if h.m.tab != TabRuns {
		t.Fatal(h.m.tab)
	}
	h.key("1", "1")
	if h.m.tab != TabStatus {
		t.Fatal(h.m.tab)
	}
	h.key("q")
	if !h.m.quiting || h.m.View() != "" {
		t.Fatal("q did not quit")
	}
}

func TestCtrlCQuitsUnderADialog(t *testing.T) {
	h := newHarness(t, connected(), Options{Tab: TabRuns})
	h.key("c", "ctrl+c")
	if !h.m.quiting {
		t.Fatal("ctrl+c did not quit")
	}
}

func TestEveryLineFitsTheTerminal(t *testing.T) {
	for _, size := range [][2]int{{120, 34}, {104, 30}, {80, 24}, {60, 16}} {
		f := connected()
		f.checks = append(f.checks, socket.Check{Name: "agents", Level: "fail", Detail: strings.Repeat("long detail ", 20)})
		h := newHarness(t, f, Options{})
		h.send(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		for _, keys := range [][]string{{"1"}, {"2"}, {"enter"}, {"esc", "3"}, {"?"}, {"esc", "1", "l"}} {
			h.key(keys...)
			lines := strings.Split(h.m.View(), "\n")
			if len(lines) != size[1] {
				t.Fatalf("%v %v: %d lines", size, keys, len(lines))
			}
			for _, l := range lines {
				if w := ansi.StringWidth(l); w > size[0] {
					t.Fatalf("%v %v: %d cells: %q", size, keys, w, ansi.Strip(l))
				}
			}
		}
	}
}

func TestSpinnerWhileBusy(t *testing.T) {
	f := connected()
	m := New(Options{Source: f, Now: func() time.Time { return now0 }})
	cmd := m.startBusy("checking …")
	if cmd == nil || m.startBusy("again") != nil {
		t.Fatal("the spinner ticks once")
	}
	_, next := m.Update(cmd())
	if next == nil {
		t.Fatal("the spinner stopped while busy")
	}
	m.endBusy()
	if _, next := m.Update(next()); next != nil || m.spinOn {
		t.Fatal("the spinner goes on without work")
	}
	if !strings.Contains(ansi.Strip(m.View()), "connecting …") {
		t.Fatal(m.View())
	}
	if m.Init() == nil {
		t.Fatal("no first poll")
	}
}

func TestHelpers(t *testing.T) {
	if clock(-time.Second) != "0:00" || clock(3723*time.Second) != "1:02:03" {
		t.Fatal(clock(3723 * time.Second))
	}
	if ago(time.Time{}, now0) != "never" || ago(now0.Add(-90*time.Second), now0) != "1m ago" || ago(now0.Add(-3*time.Hour), now0) != "3h ago" || ago(now0.Add(-72*time.Hour), now0) != "3d ago" {
		t.Fatal("ago")
	}
	if span(90*time.Second) != "last 90 seconds" || span(5*time.Minute) != "last 5 minutes" {
		t.Fatal(span(90 * time.Second))
	}
	if got := wrap("a\tb\x1b[31mc\x07 "+strings.Repeat("x", 12), 5); strings.Join(got, "|") != "a bc?|xxxxx|xxxxx|xx" {
		t.Fatalf("%q", got)
	}
	if fit("abc", 0) != "" || padLeft("abcdef", 3) != "ab…" || padLeft("a", 3) != "  a" || padLeft("a", 0) != "" {
		t.Fatal("fit")
	}
	if slots(3, 20) != "3 of 20" || num(64) != "64" || num(38.25) != "38.2" || share(1, 0) != 0 {
		t.Fatal(slots(3, 20))
	}
	if resultMark(executor.Summary{Result: "lost"}) == "" || ansi.Strip(resultMark(executor.Summary{Status: "starting"})) != "◌ starting" ||
		ansi.Strip(resultMark(executor.Summary{Status: "stopping"})) != "◌ stopping" || ansi.Strip(resultMark(executor.Summary{Result: "failed"})) != "✗ failed" ||
		ansi.Strip(resultMark(executor.Summary{Result: "canceled"})) != "– canceled" || stateMark(executor.Summary{Status: "starting"}) != "◌" {
		t.Fatal("marks")
	}
	if step(nil, "x", 1) != "" || keep("x", nil) != "" {
		t.Fatal("step")
	}
}

func sizeMsg(w, h int) tea.WindowSizeMsg { return tea.WindowSizeMsg{Width: w, Height: h} }

func TestMiddle(t *testing.T) {
	if middle("short", 10) != "short" || middle("~/.local/share/werkbuch-runner/worktrees/WEB-51", 20) != "~/.loca…trees/WEB-51" {
		t.Fatal(middle("~/.local/share/werkbuch-runner/worktrees/WEB-51", 20))
	}
}

// manyRuns are 18 running runs and 5 ended ones, WEB-1 … WEB-23.
func manyRuns() []executor.Summary {
	var runs []executor.Summary
	for i := 1; i <= 23; i++ {
		r := executor.Summary{ID: fmt.Sprintf("01run%02d", i), Type: "task", Model: "sonnet", Item: fmt.Sprintf("WEB-%d", i), Title: "Item " + itoa(i),
			Status: "running", Branch: "agent/WEB-" + itoa(i), Started: now0.Add(-time.Minute)}
		if i > 18 {
			r.Status, r.Result, r.Ended = "finished", "succeeded", now0
		}
		runs = append(runs, r)
	}
	return runs
}

func TestListsScrollWithTheChoice(t *testing.T) {
	for _, size := range [][2]int{{80, 24}, {60, 16}} {
		for _, tab := range []Tab{TabStatus, TabRuns} {
			f := connected()
			f.runs = manyRuns()
			h := newHarness(t, f, Options{Tab: tab})
			h.send(sizeMsg(size[0], size[1]))
			h.sees("WEB-1 ")
			for i := 2; i <= 23; i++ {
				h.key("j")
				label := fmt.Sprintf("WEB-%d ", i)
				if !strings.Contains(h.view(), label) {
					t.Fatalf("%v tab %d: %s chosen but not shown:\n%s", size, tab, label, h.view())
				}
			}
			h.misses("WEB-1 ")
			for range 22 {
				h.key("k")
			}
			h.sees("WEB-1 ")
		}
	}
}

func TestTheFooterKeepsTheKeys(t *testing.T) {
	f := connected()
	h := newHarness(t, f, Options{Tab: TabRuns})
	h.send(sizeMsg(80, 24))
	footer := func() string { l := strings.Split(h.view(), "\n"); return l[len(l)-1] }
	if !strings.Contains(footer(), "? help") || strings.Contains(footer(), "following") {
		t.Fatalf("%q", footer())
	}
	h.key("1")
	if !strings.Contains(footer(), "? help") {
		t.Fatalf("%q", footer())
	}
	// a message wins while it is shown, then the keys come back
	h.key("j", "j", "2", "c")
	h.key("esc", "j", "c")
	if !strings.Contains(footer(), "has ended") {
		t.Fatalf("%q", footer())
	}
	h.now = h.now.Add(10 * time.Second)
	if !strings.Contains(footer(), "? help") {
		t.Fatalf("%q", footer())
	}
	// wide enough: keys and the quiet status
	h.send(sizeMsg(160, 30))
	h.key("k")
	if !strings.Contains(footer(), "? help") || !strings.Contains(footer(), "following WEB-51") {
		t.Fatalf("%q", footer())
	}
}

func TestShortSlotsInANarrowTerminal(t *testing.T) {
	h := newHarness(t, connected(), Options{})
	h.send(sizeMsg(80, 30))
	h.sees("■□  1 of 2   per repo 0/1   light 0/2")
	h.misses("(from werkbuch)")
}

func TestTimesComeFromTheDaemonsClock(t *testing.T) {
	f := connected()
	f.st.Now = now0.Add(time.Minute)
	h := newHarness(t, f, Options{})
	h.sees("● 7:12", "last contact 1m ago")
}

func TestErrorsAreRedacted(t *testing.T) {
	f := connected()
	f.st.Connected, f.st.LastError = false, "POST https://werkbuch.example.com/api/runner/claim: Authorization: Bearer wbr_abcdefghijklmnopqrstuvwxyz0123 refused"
	f.runs[0].Title = "leaks wb_abcdefghijklmnopqrstuvwxyz"
	h := newHarness(t, f, Options{})
	h.sees("[token]")
	h.misses("wbr_abc", "wb_abc")
}

func TestDoctorSaysWhyThisTerminalChecked(t *testing.T) {
	local := func(context.Context) []socket.Check {
		return []socket.Check{{Name: "git", Level: "ok", Detail: "git version 2.47.1"}}
	}
	f := connected()
	f.doctorErr = &socket.StatusError{Code: 404, Message: "Not Found"}
	h := newHarness(t, f, Options{Tab: TabDoctor, LocalDoctor: local})
	h.sees("The daemon has no checks (an older version, update it):", "checked by this terminal", "✓ git")
	h.misses("No daemon answers")

	f.doctorErr = &socket.StatusError{Code: 500, Message: "boom"}
	h.key("r")
	h.sees("The daemon did not answer the checks (boom):")

	f.doctorErr = context.DeadlineExceeded
	h.key("r")
	h.sees("The daemon did not answer the checks (context deadline exceeded):")

	h2 := newHarness(t, f, Options{Tab: TabDoctor})
	h2.sees("The daemon did not answer the checks", "press r to ask again")
}
