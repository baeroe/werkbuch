package tui

import (
	"context"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/baeroe/werkbuch/runner/internal/socket"
)

// Levels of a check (as doctor has them).
const (
	levelOK   = "ok"
	levelWarn = "warn"
	levelFail = "fail"
)

// accessCheck is the name doctor gives the warning for a second way to werkbuch (spec 8.7, A495).
const accessCheck = "werkbuch access"

// doctorState holds the last checks.
type doctorState struct {
	asked   bool
	running bool
	gen     int
	cancel  context.CancelFunc
	checks  []socket.Check
	local   bool // no daemon answered: this process checked
	at      time.Time
	sel     int
}

type doctorMsg struct {
	gen    int
	checks []socket.Check
	local  bool
}

// runDoctor asks the daemon for the checks (it checks with its own environment, A500) and checks here when none
// answers.
func (m *Model) runDoctor() tea.Cmd {
	if m.doctor.running {
		return nil
	}
	m.doctor.asked, m.doctor.running = true, true
	m.doctor.gen++
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	m.doctor.cancel = cancel
	gen, src, local := m.doctor.gen, m.opts.Source, m.opts.LocalDoctor
	return tea.Batch(m.startBusy("checking …"), func() tea.Msg {
		defer cancel()
		checks, err := src.Doctor(ctx)
		if err == nil {
			return doctorMsg{gen: gen, checks: checks}
		}
		if local == nil {
			return doctorMsg{gen: gen, local: true}
		}
		return doctorMsg{gen: gen, checks: local(ctx), local: true}
	})
}

func (m *Model) applyDoctor(msg doctorMsg) {
	if msg.gen != m.doctor.gen {
		return
	}
	m.doctor.running, m.doctor.cancel = false, nil
	m.doctor.checks, m.doctor.local, m.doctor.at = msg.checks, msg.local, m.opts.Now()
	m.doctor.sel = min(m.doctor.sel, max(len(m.doctorItems())-1, 0))
	if m.busy == "checking …" {
		m.endBusy()
	}
}

// doctorItems are the checks in the order the tab lists them: the checks, then the warnings about werkbuch access
// (shown below the equipment). The summary line "equipment" gives way to the equipment of the status.
func (m *Model) doctorItems() []socket.Check {
	var main, access []socket.Check
	for _, c := range m.doctor.checks {
		switch {
		case c.Name == accessCheck:
			access = append(access, c)
		case c.Name == "equipment" && m.st != nil && m.st.Equipment != nil:
		default:
			main = append(main, c)
		}
	}
	return append(main, access...)
}

func (m *Model) doctorHints() []string {
	h := []string{"j/k", "move", "r", "run again"}
	if len(m.doctorItems()) > 0 {
		h = append(h, "enter", "details")
	}
	return h
}

func (m *Model) doctorKey(k tea.KeyMsg) tea.Cmd {
	items := m.doctorItems()
	switch k.String() {
	case "j", "down":
		m.doctor.sel = min(m.doctor.sel+1, max(len(items)-1, 0))
	case "k", "up":
		m.doctor.sel = max(m.doctor.sel-1, 0)
	case "r":
		return m.runDoctor()
	case "enter":
		if m.doctor.sel < len(items) {
			c := items[m.doctor.sel]
			m.modal = &detailModal{check: c}
		}
	}
	return nil
}

func mark(level string) string {
	switch level {
	case levelOK:
		return goodStyle.Render("✓")
	case levelWarn:
		return warnStyle.Render("!")
	}
	return badStyle.Render("✗")
}

func (m *Model) counts() (fails, warns int) {
	for _, c := range m.doctor.checks {
		switch c.Level {
		case levelFail:
			fails++
		case levelWarn:
			warns++
		}
	}
	return fails, warns
}

// doctorCount is the footer's summary ("1 problem 2 warnings").
func (m *Model) doctorCount() string {
	if !m.doctor.asked || m.doctor.checks == nil {
		return ""
	}
	fails, warns := m.counts()
	var parts []string
	if fails > 0 {
		parts = append(parts, badStyle.Render(plural(fails, "problem")))
	}
	if warns > 0 {
		parts = append(parts, warnStyle.Render(plural(warns, "warning")))
	}
	if len(parts) == 0 {
		return goodStyle.Render("all checks passed")
	}
	return strings.Join(parts, " ")
}

func (m *Model) doctorView(w, h int) string {
	b := []string{""}
	add := func(l ...string) { b = append(b, l...) }
	if m.doctor.checks == nil {
		switch {
		case m.doctor.running:
			add("  " + dimStyle.Render("checking the CLIs, the keychain, the instance and the equipment …"))
		case m.doctor.local:
			add("  " + warnStyle.Render("○ No daemon answers") + dimStyle.Render(": start it with werkbuch-runner daemon, then press r."))
		}
		return strings.Join(b, "\n")
	}
	if m.doctor.local {
		add("  "+warnStyle.Render("No daemon answers:")+dimStyle.Render(" checked by this terminal with its own PATH and keychain, not the daemon's."), "")
	}
	const nw = 16
	items := m.doctorItems()
	row := func(i int, c socket.Check) string {
		line := "  " + mark(c.Level) + " " + fit(c.Name, nw) + oneLine(c.Detail)
		if i == m.doctor.sel {
			return highlightRow(line, w)
		}
		return line
	}
	i := 0
	for ; i < len(items) && items[i].Name != accessCheck; i++ {
		add(row(i, items[i]))
	}
	add("", "  "+boldStyle.Render("Harness")+dimStyle.Render(" (set up on this machine for the user of the runner)"))
	const lw = 15
	if m.st != nil && m.st.Equipment != nil {
		eq := m.st.Equipment
		add("  "+kv("mcp servers", join(eq.MCPServers)+dimStyle.Render(" + werkbuch-run with the token of each run"), lw),
			"  "+kv("skills", join(eq.Skills), lw),
			"  "+kv("plugins", join(eq.Plugins), lw))
	} else {
		add("  " + dimStyle.Render("known once the daemon has reported it (see the check equipment)"))
	}
	for ; i < len(items); i++ {
		add(row(i, items[i]))
		add("    " + strings.Repeat(" ", nw) + dimStyle.Render("Turn it off for the runner, or run the runner under its own macOS user."))
	}
	add("")
	fails, warns := m.counts()
	switch {
	case fails > 0:
		add("  " + alertChip.Render(plural(fails, "problem")) + dimStyle.Render("  Runs fail or never come until it is fixed; enter shows the details."))
	case warns > 0:
		add("  " + warnStyle.Render(plural(warns, "warning")) + dimStyle.Render("  Runs stay possible; enter shows the details."))
	default:
		add("  " + goodStyle.Render("✓ all checks passed"))
	}
	add("  " + dimStyle.Render("checked "+ago(m.doctor.at, m.opts.Now())+"; r runs the checks again."))
	return strings.Join(b, "\n")
}

func join(v []string) string {
	if len(v) == 0 {
		return "none"
	}
	out := make([]string, len(v))
	for i, s := range v {
		out[i] = oneLine(s)
	}
	return strings.Join(out, ", ")
}
