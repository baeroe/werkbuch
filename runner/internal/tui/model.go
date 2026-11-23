// Package tui is the terminal UI of the runner (spec 8.5, WEBU-22): three tabs after the approved pictures of `/_tui`
// in the clickdummy (WEBU-18): Status (connection, instance, version, the slots from werkbuch, the load with its
// history, running and recent runs), Runs (the log of a run, live, and cancel) and Doctor (the checks and the equipment
// of the machine with a warning for a second way to werkbuch). Nothing is set up here except logging out: slots and
// setup commands live in werkbuch.
//
// It follows skilltri: Bubble Tea, Bubbles (the spinner), Lip Gloss with the 16 colours of the terminal, tabs in the
// header with the state on the right, key hints in the footer, `?` for help. Nothing in Update blocks: the daemon is
// read in commands every two seconds (Options.Every), the log of the chosen run as a stream, the checks once the
// Doctor tab is looked at; results come back as messages.
package tui

import (
	"context"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
)

// Tab identifies a tab.
type Tab int

const (
	TabStatus Tab = iota
	TabRuns
	TabDoctor
	numTabs
)

var tabNames = [numTabs]string{"Status", "Runs", "Doctor"}

// flashTTL is how long a message stays in the footer.
const flashTTL = 5 * time.Second

// Options configure the model; tests and the demo pass fakes.
type Options struct {
	Source Source
	// Socket is the path of the socket, named when no daemon answers.
	Socket string
	// LocalDoctor runs the checks in this process when no daemon answers (A500); nil shows only that none answers.
	LocalDoctor func(ctx context.Context) []socket.Check
	// Logout forgets the token like `werkbuch-runner logout` and says what it did; nil hides `l`.
	Logout func() (string, error)
	Tab    Tab
	Now    func() time.Time
	// Every is the interval of the polls (default 2 s).
	Every time.Duration
	// NoTick leaves polls and the spinner to the test.
	NoTick bool
}

// Model is the root Bubble Tea model.
type Model struct {
	opts   Options
	tab    Tab
	width  int
	height int

	// the last answer of the daemon
	st       *socket.Status
	stErr    error
	runs     []executor.Summary
	load     socket.LoadAnswer
	polledAt time.Time
	polled   bool // an answer (or its absence) came in
	polling  bool

	statusSel string // the run chosen on Status (by id)
	runSel    string // the run chosen on Runs
	stream    stream
	follow    bool
	full      bool // the log fills the body
	logTop    int  // the first line of the log shown while not following

	doctor doctorState

	modal modal

	flash    string
	flashErr bool
	flashAt  time.Time

	busy    string // work in flight (cancel, logout, doctor): the footer shows a spinner
	spin    spinner.Model
	spinOn  bool
	quiting bool
}

// stream is the log of the run shown on Runs.
type stream struct {
	id     string
	gen    int
	cancel context.CancelFunc
	events []protocol.Event
	ended  bool
	err    error
}

// modal is a dialog over the body; it gets every key while open.
type modal interface {
	update(m *Model, k tea.KeyMsg) (tea.Cmd, bool) // closed=true removes it
	view(m *Model, w, h int) string
	hints() []string
}

type (
	tickMsg   struct{}
	polledMsg struct {
		st    *socket.Status
		err   error
		runs  []executor.Summary
		load  socket.LoadAnswer
		at    time.Time
		asked bool // asked for with r (says so in the footer)
	}
	eventsMsg struct {
		gen    int
		events []protocol.Event
		done   bool
		err    error
		next   tea.Cmd // reads on while not done
	}
	canceledMsg struct {
		label string
		err   error
	}
	loggedOutMsg struct {
		text string
		err  error
	}
)

// New returns the model.
func New(opts Options) *Model {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.Every == 0 {
		opts.Every = 2 * time.Second
	}
	s := spinner.New(spinner.WithSpinner(spinner.MiniDot), spinner.WithStyle(warnStyle))
	m := &Model{opts: opts, tab: opts.Tab, follow: true, spin: s}
	return m
}

// Init polls the daemon and starts the clock.
func (m *Model) Init() tea.Cmd {
	return tea.Batch(m.poll(false), m.tick(), m.activated())
}

func (m *Model) tick() tea.Cmd {
	if m.opts.NoTick {
		return nil
	}
	return tea.Tick(m.opts.Every, func(time.Time) tea.Msg { return tickMsg{} })
}

// poll reads status, runs and load in one command; a poll in flight is not started twice.
func (m *Model) poll(asked bool) tea.Cmd {
	if m.polling {
		return nil
	}
	m.polling = true
	src, now := m.opts.Source, m.opts.Now
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		msg := polledMsg{asked: asked}
		st, err := src.Status(ctx)
		if err != nil {
			msg.err, msg.at = err, now()
			return msg
		}
		msg.st = &st
		msg.runs, _ = src.Runs(ctx)
		msg.load, _ = src.Load(ctx)
		msg.at = now()
		return msg
	}
}

// setFlash shows text in the footer for flashTTL.
func (m *Model) setFlash(text string, isErr bool) {
	m.flash, m.flashErr, m.flashAt = text, isErr, m.opts.Now()
}

// startBusy shows a spinner with text until endBusy.
func (m *Model) startBusy(text string) tea.Cmd {
	m.busy = text
	if m.spinOn || m.opts.NoTick {
		return nil
	}
	m.spinOn = true
	return m.spin.Tick
}

func (m *Model) endBusy() { m.busy = "" }

// Update handles a message.
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case tickMsg:
		return m, tea.Batch(m.poll(false), m.tick())
	case spinner.TickMsg:
		if m.busy == "" && !m.doctor.running {
			m.spinOn = false
			return m, nil
		}
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd
	case polledMsg:
		return m, m.applyPoll(msg)
	case eventsMsg:
		return m, m.applyEvents(msg)
	case doctorMsg:
		m.applyDoctor(msg)
		return m, nil
	case canceledMsg:
		m.endBusy()
		if msg.err != nil {
			m.setFlash(msg.label+": "+oneLine(msg.err.Error()), true)
		} else {
			m.setFlash(msg.label+": cancel sent, werkbuch hears it", false)
		}
		return m, m.poll(false)
	case loggedOutMsg:
		m.endBusy()
		if msg.err != nil {
			m.setFlash("logout: "+oneLine(msg.err.Error()), true)
		} else {
			m.setFlash(oneLine(msg.text), false)
		}
		return m, nil
	case tea.KeyMsg:
		return m, m.key(msg)
	}
	return m, nil
}

func (m *Model) applyPoll(msg polledMsg) tea.Cmd {
	m.polling = false
	m.polled = true
	m.polledAt = msg.at
	m.st, m.stErr = msg.st, msg.err
	if msg.err != nil {
		m.runs, m.load = nil, socket.LoadAnswer{}
		if msg.asked {
			m.setFlash("no daemon answers", true)
		}
		return nil
	}
	m.runs, m.load = msg.runs, msg.load
	if msg.asked {
		m.setFlash("refreshed", false)
	}
	m.statusSel = keep(m.statusSel, m.statusRuns())
	before := m.runSel
	m.runSel = keep(m.runSel, m.runs)
	if m.tab == TabRuns && (m.runSel != before || m.stream.id != m.runSel) {
		return m.openStream()
	}
	if m.tab == TabRuns && m.stream.id == m.runSel && m.stream.ended && m.stream.err != nil {
		return m.openStream() // the daemon came back
	}
	return nil
}

// keep keeps the chosen run while it is listed, else takes the first.
func keep(id string, runs []executor.Summary) string {
	for _, r := range runs {
		if r.ID == id {
			return id
		}
	}
	if len(runs) > 0 {
		return runs[0].ID
	}
	return ""
}

func (m *Model) key(k tea.KeyMsg) tea.Cmd {
	if k.String() == "ctrl+c" {
		return m.quit()
	}
	if m.modal != nil {
		cmd, closed := m.modal.update(m, k)
		if closed {
			m.modal = nil
		}
		return cmd
	}
	if m.tab == TabRuns && m.full {
		if cmd, ok := m.fullLogKey(k); ok {
			return cmd
		}
	}
	switch k.String() {
	case "q":
		return m.quit()
	case "?":
		m.modal = &helpModal{}
		return nil
	case "tab":
		return m.switchTab((m.tab + 1) % numTabs)
	case "shift+tab":
		return m.switchTab((m.tab + numTabs - 1) % numTabs)
	case "1", "2", "3":
		return m.switchTab(Tab(k.String()[0] - '1'))
	}
	switch m.tab {
	case TabStatus:
		return m.statusKey(k)
	case TabRuns:
		return m.runsKey(k)
	default:
		return m.doctorKey(k)
	}
}

func (m *Model) switchTab(t Tab) tea.Cmd {
	if t == m.tab {
		return nil
	}
	if m.tab == TabRuns {
		m.closeStream()
		m.full = false
	}
	m.tab = t
	return m.activated()
}

// activated starts what the active tab needs once it is looked at: the log on Runs, the checks on Doctor.
func (m *Model) activated() tea.Cmd {
	switch m.tab {
	case TabRuns:
		if m.runSel != "" && m.stream.id != m.runSel {
			return m.openStream()
		}
	case TabDoctor:
		if !m.doctor.asked {
			return m.runDoctor()
		}
	}
	return nil
}

func (m *Model) quit() tea.Cmd {
	m.closeStream()
	if m.doctor.cancel != nil {
		m.doctor.cancel()
	}
	m.quiting = true
	return tea.Quit
}

// openStream reads the log of the chosen run (only one at a time).
func (m *Model) openStream() tea.Cmd {
	m.closeStream()
	if m.runSel == "" {
		return nil
	}
	gen := m.stream.gen + 1
	ctx, cancel := context.WithCancel(context.Background())
	m.stream = stream{id: m.runSel, gen: gen, cancel: cancel}
	m.logTop = 0
	ch := make(chan protocol.Event, 512)
	res := &streamResult{}
	src, id := m.opts.Source, m.runSel
	go func() {
		res.err = src.Events(ctx, id, func(ev protocol.Event) {
			select {
			case ch <- ev:
			case <-ctx.Done():
			}
		})
		close(ch)
	}()
	return waitEvents(gen, ch, res)
}

type streamResult struct{ err error }

// waitEvents blocks for the next lines of the log and takes what else is there already.
func waitEvents(gen int, ch chan protocol.Event, res *streamResult) tea.Cmd {
	return func() tea.Msg {
		ev, open := <-ch
		if !open {
			return eventsMsg{gen: gen, done: true, err: res.err}
		}
		evs := []protocol.Event{ev}
		for len(evs) < executor.Keep {
			select {
			case ev, open := <-ch:
				if !open {
					return eventsMsg{gen: gen, events: evs, done: true, err: res.err}
				}
				evs = append(evs, ev)
			default:
				return eventsMsg{gen: gen, events: evs, next: waitEvents(gen, ch, res)}
			}
		}
		return eventsMsg{gen: gen, events: evs, next: waitEvents(gen, ch, res)}
	}
}

func (m *Model) closeStream() {
	if m.stream.cancel != nil {
		m.stream.cancel()
	}
	m.stream = stream{gen: m.stream.gen}
}

func (m *Model) applyEvents(msg eventsMsg) tea.Cmd {
	if msg.gen != m.stream.gen || m.stream.id == "" {
		return nil // an older stream
	}
	m.stream.events = append(m.stream.events, msg.events...)
	if over := len(m.stream.events) - executor.Keep; over > 0 {
		m.stream.events = m.stream.events[over:]
		m.logTop = max(m.logTop-over, 0)
	}
	if msg.done {
		m.stream.ended, m.stream.err = true, msg.err
		return nil
	}
	return msg.next
}

// View renders the screen.
func (m *Model) View() string {
	if m.quiting {
		return ""
	}
	w, h := m.width, m.height
	if w <= 0 || h <= 0 {
		w, h = 104, 30
	}
	bh := max(h-2, 1)
	var body string
	switch m.tab {
	case TabStatus:
		body = m.statusView(w, bh)
	case TabRuns:
		body = m.runsView(w, bh)
	default:
		body = m.doctorView(w, bh)
	}
	body = clampLines(body, w, bh)
	if m.modal != nil {
		body = overlay(body, m.modal.view(m, w, bh), w, bh)
	}
	return fit(m.header(w), w) + "\n" + body + "\n" + m.footer(w)
}

func (m *Model) header(w int) string {
	tabs := ""
	for i, n := range tabNames {
		label := string(rune('1'+i)) + " " + n
		if Tab(i) == m.tab {
			tabs += tabActive.Render(label)
		} else {
			tabs += tabInactive.Render(label)
		}
	}
	return spread(" "+appName.Render("werkbuch-runner")+"  "+tabs, m.chips(), w)
}

// chips is the state on the right of the header.
func (m *Model) chips() string {
	switch {
	case !m.polled:
		return dimStyle.Render("connecting …")
	case m.st == nil:
		return dimStyle.Render("○ no daemon")
	}
	c := connection(m.st, true)
	if p := m.st.Places; p != nil {
		c += dimStyle.Render(" · ") + itoa(p.Used.Total) + "/" + itoa(p.Total) + " slots"
	}
	return c
}

// connection is the state of the link to werkbuch.
func connection(st *socket.Status, short bool) string {
	switch {
	case st.Unauthorized:
		if short {
			return badStyle.Render("✗ token refused")
		}
		return badStyle.Render("✗ werkbuch refuses the token: pair the runner again (werkbuch-runner login)")
	case !st.Connected:
		if short {
			return warnStyle.Render("○ offline")
		}
		t := "○ not connected"
		if st.LastError != "" {
			t += ": " + oneLine(st.LastError)
		}
		return warnStyle.Render(t)
	}
	return goodStyle.Render("● connected")
}

func (m *Model) hints() []string {
	if m.modal != nil {
		return m.modal.hints()
	}
	var h []string
	switch m.tab {
	case TabStatus:
		h = m.statusHints()
	case TabRuns:
		h = m.runsHints()
	default:
		h = m.doctorHints()
	}
	return append(h, "?", "help", "q", "quit")
}

// footer shows the key hints on the left and the status line on the right.
func (m *Model) footer(w int) string {
	left := " " + keyHints(m.hints()...)
	status := ""
	switch {
	case m.busy != "":
		status = warnStyle.Render(m.spin.View() + " " + m.busy)
	case m.flash != "" && m.opts.Now().Sub(m.flashAt) < flashTTL:
		if m.flashErr {
			status = badStyle.Render(m.flash)
		} else {
			status = goodStyle.Render(m.flash)
		}
	default:
		status = m.tabStatus()
	}
	if status == "" {
		return fit(left, w)
	}
	if width(left)+width(status)+3 > w { // the status wins over the hints while it is shown
		return fit(" "+status, w)
	}
	return spread(left, status, w)
}

// tabStatus is the quiet right side of the footer.
func (m *Model) tabStatus() string {
	switch m.tab {
	case TabRuns:
		if r := m.runByID(m.runSel); r != nil && running(*r) && m.follow {
			return accentStyle.Render("following " + runLabel(*r))
		}
	case TabDoctor:
		return m.doctorCount()
	}
	if !m.polled {
		return ""
	}
	if m.st == nil {
		return dimStyle.Render("asked " + ago(m.polledAt, m.opts.Now()))
	}
	return goodStyle.Render("polled " + ago(m.polledAt, m.opts.Now()))
}

func (m *Model) runByID(id string) *executor.Summary {
	for i := range m.runs {
		if m.runs[i].ID == id {
			return &m.runs[i]
		}
	}
	return nil
}
