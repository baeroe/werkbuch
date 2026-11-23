package tui

import (
	"context"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// listW is the width of the list of runs beside the log.
const listW = 44

func (m *Model) runsHints() []string {
	if m.full {
		return []string{"j/k", "scroll", "g/G", "top/end", "f", "follow", "esc", "back"}
	}
	h := []string{"j/k", "move", "enter", "full log", "f", "follow log"}
	if r := m.runByID(m.runSel); r != nil && running(*r) {
		h = append(h, "c", "cancel")
	}
	return h
}

func (m *Model) runsKey(k tea.KeyMsg) tea.Cmd {
	switch k.String() {
	case "j", "down":
		return m.chooseRun(step(m.runs, m.runSel, 1))
	case "k", "up":
		return m.chooseRun(step(m.runs, m.runSel, -1))
	case "enter":
		if m.runSel != "" {
			m.full = true
		}
	case "f":
		m.toggleFollow()
	case "r":
		return m.poll(true)
	case "c":
		return m.askCancel()
	}
	return nil
}

// chooseRun shows the log of another run.
func (m *Model) chooseRun(id string) tea.Cmd {
	if id == m.runSel {
		return nil
	}
	m.runSel, m.follow = id, true
	return m.openStream()
}

func (m *Model) toggleFollow() {
	m.follow = !m.follow
	if !m.follow {
		m.logTop = max(len(m.logLines(m.logWidth()))-m.logHeight(), 0)
	}
}

// fullLogKey handles the keys of the full log; ok=false hands the key on (tabs, help, quit, cancel).
func (m *Model) fullLogKey(k tea.KeyMsg) (tea.Cmd, bool) {
	n := len(m.logLines(m.logWidth()))
	h := m.logHeight()
	last := max(n-h, 0)
	top := m.logTop
	if m.follow {
		top = last
	}
	scroll := func(to int) {
		m.logTop = min(max(to, 0), last)
		m.follow = m.logTop == last && running(m.selected())
	}
	switch k.String() {
	case "esc":
		m.full = false
	case "j", "down":
		scroll(top + 1)
	case "k", "up":
		scroll(top - 1)
	case "pgdown", " ", "ctrl+d":
		scroll(top + h)
	case "pgup", "ctrl+u":
		scroll(top - h)
	case "g", "home":
		scroll(0)
	case "G", "end":
		m.logTop, m.follow = last, true
	case "f":
		m.toggleFollow()
	default:
		return nil, false
	}
	return nil, true
}

func (m *Model) selected() executor.Summary {
	if r := m.runByID(m.runSel); r != nil {
		return *r
	}
	return executor.Summary{}
}

func (m *Model) askCancel() tea.Cmd {
	r := m.runByID(m.runSel)
	if r == nil {
		return nil
	}
	if !running(*r) {
		m.setFlash(runLabel(*r)+" has ended", true)
		return nil
	}
	label, id := runLabel(*r), r.ID
	m.modal = &confirmModal{
		title: "Cancel " + label + "?",
		lines: []string{
			"Stop the " + oneLine(r.Type) + " run of " + label + " now?",
			"",
			dimStyle.Render("The agent ends (its process group gets SIGTERM, after 10 s SIGKILL);"),
			dimStyle.Render("werkbuch hears canceled, as with Cancel on the item."),
		},
		yes: "cancel the run",
		no:  "keep it",
		onYes: func(m *Model) tea.Cmd {
			src := m.opts.Source
			return tea.Batch(m.startBusy("canceling "+label+" …"), func() tea.Msg {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				return canceledMsg{label: label, err: src.Cancel(ctx, id)}
			})
		},
	}
	return nil
}

// logHeight is the number of log lines the body shows.
func (m *Model) logHeight() int {
	h := m.height
	if h <= 0 {
		h = 30
	}
	return max(h-2-3, 1) // header, footer; a blank line, the title of the log, a blank line at the end
}

func (m *Model) logWidth() int {
	w := m.width
	if w <= 0 {
		w = 104
	}
	if m.full || w < wideMin {
		return max(w-4, 10)
	}
	return max(w-listW-5, 10)
}

// logLines renders the log of the shown run: the time since its start, then the text, wrapped to w.
func (m *Model) logLines(w int) []string {
	r := m.selected()
	var out []string
	last := ""
	for _, ev := range m.stream.events {
		at := "+" + clock(ev.At.Sub(r.Started))
		if ev.At.IsZero() || r.Started.IsZero() {
			at = ""
		}
		stamp := fit(at, 7)
		if at == last {
			stamp = fit("", 7)
		}
		last = at
		style := func(s ...string) string { return strings.Join(s, " ") }
		switch ev.Kind {
		case protocol.KindError:
			style = badStyle.Render
		case protocol.KindResult:
			style = boldStyle.Render
		case protocol.KindSystem:
			style = dimStyle.Render
		}
		for i, l := range wrap(ev.Text, max(w-8, 4)) {
			if i > 0 {
				stamp = fit("", 7)
			}
			out = append(out, dimStyle.Render(stamp)+" "+style(l))
		}
	}
	return out
}

func (m *Model) runsView(w, h int) string {
	if !m.polled {
		return "\n  " + dimStyle.Render("asking the daemon …")
	}
	if m.st == nil {
		return "\n  " + warnStyle.Render("○ No daemon answers") + dimStyle.Render(": runs show once it does (see Status).")
	}
	if len(m.runs) == 0 {
		return "\n  " + dimStyle.Render("No runs yet: werkbuch hands one out when an item is assigned to an agent of this runner.")
	}
	if m.full {
		return m.logView(w, h, 2)
	}
	if w < wideMin {
		return m.listView(w, h)
	}
	list := strings.Split(m.listView(listW, h), "\n")
	log := strings.Split(m.logView(w-listW-1, h, 1), "\n")
	var b []string
	for i := range h {
		l, r := "", ""
		if i < len(list) {
			l = list[i]
		}
		if i < len(log) {
			r = log[i]
		}
		b = append(b, fit(l, listW)+dimStyle.Render("│")+" "+r)
	}
	return strings.Join(b, "\n")
}

// listView lists the runs, running first.
func (m *Model) listView(w, h int) string {
	head := []string{"", "  " + dimStyle.Render(fit("RUN", 26)+"STATUS")}
	var rows []string
	sel := 0
	for i, r := range m.runs {
		line := "  " + fit(runLabel(r)+" "+fit(oneLine(r.Type), 10)+" "+oneLine(r.Model), 26) + resultMark(r)
		if r.ID == m.runSel {
			sel = i
			line = highlightRow("  "+selStyle.Render(fit(runLabel(r)+" "+fit(oneLine(r.Type), 10)+" "+oneLine(r.Model), 26))+resultMark(r), w)
		}
		rows = append(rows, line)
	}
	// the list scrolls with the chosen run
	return strings.Join(append(head, window(rows, sel, max(h-len(head), 1))...), "\n")
}

// logView shows the log of the chosen run with a title line; indent is the left margin.
func (m *Model) logView(w, h, indent int) string {
	r := m.selected()
	pad := strings.Repeat(" ", indent)
	now := m.daemonNow()
	took := now.Sub(r.Started)
	if !r.Ended.IsZero() {
		took = r.Ended.Sub(r.Started)
	}
	title := pad + dimStyle.Render("LOG") + "  " + runLabel(r) + " " + oneLine(r.Type) + ", " + oneLine(r.Model) + ", " + clock(took)
	if r.Title != "" {
		title += dimStyle.Render("  " + oneLine(r.Title))
	}
	lines := m.logLines(m.logWidth())
	body := []string{"", title}
	switch {
	case len(lines) == 0 && m.stream.err != nil:
		body = append(body, pad+badStyle.Render("the log is not available: "+oneLine(m.stream.err.Error())))
	case len(lines) == 0 && m.stream.ended:
		body = append(body, pad+dimStyle.Render("no lines"))
	case len(lines) == 0:
		body = append(body, pad+dimStyle.Render("waiting for the first line …"))
	}
	room := max(h-len(body)-1, 1)
	top := m.logTop
	if m.follow {
		top = max(len(lines)-room, 0)
	}
	top = min(top, max(len(lines)-room, 0))
	shown := lines[top:min(top+room, len(lines))]
	for _, l := range shown {
		body = append(body, pad+l)
	}
	if m.follow && running(r) && !m.stream.ended && len(lines) > 0 && len(shown) < room {
		body = append(body, pad+fit("", 7)+" "+accentStyle.Render("▍"))
	}
	if !m.follow && top+room < len(lines) {
		body = append(body, pad+dimStyle.Render("… "+plural(len(lines)-top-room, "more line")+" (G: to the end)"))
	}
	return strings.Join(body, "\n")
}
