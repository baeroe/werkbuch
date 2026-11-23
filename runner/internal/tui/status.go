package tui

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/load"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// recentOnStatus is how many ended runs Status lists (Runs has them all).
const recentOnStatus = 5

// configHint says where things are set up (spec 8.5: nothing is set up in the TUI).
const configHint = "Slots are set in werkbuch (Organization → Runners); MCP servers, skills, plugins on this machine."

func itoa(n int) string { return strconv.Itoa(n) }

// running says whether a run has not ended.
func running(r executor.Summary) bool { return r.Result == "" && r.Status != "finished" }

// runLabel names a run by its item, else its project.
func runLabel(r executor.Summary) string {
	if r.Item != "" {
		return oneLine(r.Item)
	}
	return oneLine(r.Project)
}

// statusRuns are the runs Status lists: every running one, then the last ended ones.
func (m *Model) statusRuns() []executor.Summary {
	var out []executor.Summary
	ended := 0
	for _, r := range m.runs {
		if running(r) {
			out = append(out, r)
		}
	}
	for _, r := range m.runs {
		if !running(r) && ended < recentOnStatus {
			out = append(out, r)
			ended++
		}
	}
	return out
}

func (m *Model) statusHints() []string {
	h := []string{"tab", "next tab", "1-3", "tabs"}
	if len(m.statusRuns()) > 0 {
		h = append(h, "enter", "open run")
	}
	h = append(h, "r", "refresh")
	if m.opts.Logout != nil {
		h = append(h, "l", "logout")
	}
	return h
}

func (m *Model) statusKey(k tea.KeyMsg) tea.Cmd {
	runs := m.statusRuns()
	switch k.String() {
	case "j", "down":
		m.statusSel = step(runs, m.statusSel, 1)
	case "k", "up":
		m.statusSel = step(runs, m.statusSel, -1)
	case "enter":
		if m.statusSel == "" {
			return nil
		}
		m.runSel = m.statusSel
		return m.switchTab(TabRuns)
	case "r":
		return m.poll(true)
	case "l":
		if m.opts.Logout == nil {
			return nil
		}
		m.modal = &confirmModal{
			title: "Log out?",
			lines: []string{
				"Forget the token of this runner on this machine?",
				"",
				dimStyle.Render("Revoke the runner in werkbuch, too (Organization → Runners)."),
				dimStyle.Render("A running daemon keeps its token until it stops."),
			},
			yes: "log out",
			onYes: func(m *Model) tea.Cmd {
				logout := m.opts.Logout
				return tea.Batch(m.startBusy("logging out …"), func() tea.Msg {
					text, err := logout()
					return loggedOutMsg{text: text, err: err}
				})
			},
		}
	}
	return nil
}

// step moves the chosen run by d within runs.
func step(runs []executor.Summary, id string, d int) string {
	if len(runs) == 0 {
		return ""
	}
	i := 0
	for j, r := range runs {
		if r.ID == id {
			i = j
		}
	}
	return runs[min(max(i+d, 0), len(runs)-1)].ID
}

func (m *Model) statusView(w, h int) string {
	var b []string
	add := func(l ...string) { b = append(b, l...) }
	now := m.opts.Now()
	if !m.polled {
		return "\n  " + dimStyle.Render("asking the daemon …")
	}
	if m.st == nil {
		add("",
			"  "+warnStyle.Render("○ No daemon answers")+dimStyle.Render(" on "+m.opts.Socket),
			"",
			"  Start it with "+codeStyle.Render("werkbuch-runner daemon")+" (the installer sets it up as a service).",
			"  This view fills as soon as it answers.",
			"",
			"  "+dimStyle.Render(configHint))
		return strings.Join(b, "\n")
	}
	st := m.st
	const lw = 12
	add("")
	add("  " + kv("instance", oneLine(st.Instance), lw))
	runner := oneLine(st.System) + "   " + oneLine(st.Version)
	if st.ExpectedVersion != "" && st.ExpectedVersion != st.Version {
		runner += "   " + warnStyle.Render("werkbuch expects "+oneLine(st.ExpectedVersion))
	}
	if st.Update != "" {
		runner += dimStyle.Render("   update " + oneLine(st.Update))
	}
	add("  " + kv("runner", runner, lw))
	conn := connection(st, false)
	if st.Connected {
		conn += dimStyle.Render("   last contact " + ago(st.LastContact, now) + ", daemon up " + clock(now.Sub(st.Started)))
	}
	add("  " + kv("connection", conn, lw))
	if p := st.Places; p != nil {
		add("  " + kv("slots", slots(p.Used.Total, p.Total)+"   "+dimStyle.Render("per repo ")+fmt.Sprintf("%d of %d", p.Used.PerRepo, p.PerRepo)+
			"   "+dimStyle.Render("light (reviews, answers) ")+slots(p.Used.Light, p.Light)+"   "+dimStyle.Render("(from werkbuch)"), lw))
	} else {
		add("  " + kv("slots", dimStyle.Render("werkbuch names them on the first contact"), lw))
	}
	add("")
	add(m.loadLines(w)...)
	add("")
	add("  " + boldStyle.Render("Running"))
	runs := m.statusRuns()
	n := 0
	for _, r := range runs {
		if !running(r) {
			continue
		}
		n++
		line := fmt.Sprintf("  %s  %s  %s  %s   %s", fit(runLabel(r), 8), fit(oneLine(r.Type), 10), fit(oneLine(r.Model), 7),
			accentStyle.Render(fit(stateMark(r)+" "+clock(now.Sub(r.Started)), 10)), oneLine(r.Title))
		add(m.row(line, r.ID, w))
		var strand []string
		if r.Branch != "" {
			strand = append(strand, oneLine(r.Branch))
		}
		if r.Session != "" {
			strand = append(strand, "session "+oneLine(short(r.Session)))
		}
		if r.Dir != "" {
			used := 12 + width(strings.Join(strand, "   ")) + 3 + len("worktree ")
			strand = append(strand, "worktree "+middle(tildify(oneLine(r.Dir), m.opts.Home), max(w-used-1, 12)))
		}
		if len(strand) > 0 {
			add("            " + dimStyle.Render(strings.Join(strand, "   ")))
		}
	}
	if n == 0 {
		add("  " + dimStyle.Render("none: the runner waits for werkbuch to hand out a run"))
	}
	if len(runs) > n {
		add("")
		add("  " + boldStyle.Render("Recent"))
		for _, r := range runs[n:] {
			when := r.Started.Local().Format("15:04")
			if !r.Ended.IsZero() {
				when += "–" + r.Ended.Local().Format("15:04")
			}
			line := fmt.Sprintf("  %s  %s  %s  %s %s   %s", fit(runLabel(r), 8), fit(oneLine(r.Type), 10), fit(oneLine(r.Model), 7),
				fit(resultMark(r), 13), fit(when, 11), oneLine(r.Title))
			add(m.row(line, r.ID, w))
		}
	}
	add("")
	add("  " + dimStyle.Render(configHint))
	return strings.Join(b, "\n")
}

// row highlights the chosen run on Status.
func (m *Model) row(line, id string, w int) string {
	if id == m.statusSel {
		return highlightRow(line, w)
	}
	return line
}

// tildify shows paths under home with ~.
func tildify(p, home string) string {
	home = strings.TrimSuffix(home, "/")
	if home != "" && (p == home || strings.HasPrefix(p, home+"/")) {
		return "~" + p[len(home):]
	}
	return p
}

// middle shortens plain text to w cells by cutting out its middle (good for paths).
func middle(s string, w int) string {
	r := []rune(s)
	if len(r) <= w {
		return s
	}
	right := (w - 1) * 2 / 3
	return string(r[:w-1-right]) + "…" + string(r[len(r)-right:])
}

func short(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

// slots draws used of total as squares (up to 12), then the numbers.
func slots(used, total int) string {
	n := ""
	if total <= 12 {
		n = accentBold.Render(strings.Repeat("■", min(used, total))) + strings.Repeat("□", max(total-used, 0)) + "  "
	}
	return n + fmt.Sprintf("%d of %d", used, total)
}

// loadLines are the gauges and the history of the load (spec 8.6).
func (m *Model) loadLines(w int) []string {
	l := m.load.Last
	if l == nil {
		l = m.st.Load
	}
	hist := m.load.History
	sparkW := min(len(hist), max(w-58, 0), 60)
	title := "  " + boldStyle.Render("Load")
	if sparkW > 0 {
		title = fit(title, 56) + dimStyle.Render(span(time.Duration(sparkW)*load.Interval))
	}
	out := []string{title}
	if l == nil {
		return append(out, "  "+dimStyle.Render("not measured yet"))
	}
	series := func(f func(protocol.Load) float64) []float64 {
		v := make([]float64, 0, len(hist))
		for _, s := range hist {
			v = append(v, f(s))
		}
		return v
	}
	line := func(label string, share float64, value string, values []float64) string {
		s := "  " + labelStyle.Render(fit(label, 10)) + bar(share, 20) + "   " + fit(value, 20)
		if sparkW > 0 && values != nil {
			s += " " + spark(values, sparkW)
		}
		return s
	}
	out = append(out, line("cpu", l.CPU/100, fmt.Sprintf("%.0f %%", l.CPU), series(func(s protocol.Load) float64 { return s.CPU })))
	if l.GPU != nil {
		out = append(out, line("gpu", *l.GPU/100, fmt.Sprintf("%.0f %%", *l.GPU), series(func(s protocol.Load) float64 {
			if s.GPU == nil {
				return 0
			}
			return *s.GPU
		})))
	} else {
		out = append(out, "  "+labelStyle.Render(fit("gpu", 10))+dimStyle.Render("not available on this machine without root"))
	}
	out = append(out, line("memory", share(l.RAMUsed, l.RAMTotal), fmt.Sprintf("%s of %s GB", num(l.RAMUsed), num(l.RAMTotal)), series(func(s protocol.Load) float64 {
		return share(s.RAMUsed, s.RAMTotal) * 100
	})))
	out = append(out, line("disk", share(l.DiskTotal-l.DiskFree, l.DiskTotal), fmt.Sprintf("%s of %s GB free", num(l.DiskFree), num(l.DiskTotal)), series(func(s protocol.Load) float64 {
		return share(s.DiskTotal-s.DiskFree, s.DiskTotal) * 100
	})))
	return out
}

// span names the time a history covers ("last 5 minutes").
func span(d time.Duration) string {
	if d < 2*time.Minute {
		return fmt.Sprintf("last %d seconds", int(d.Seconds()))
	}
	return fmt.Sprintf("last %d minutes", int(d.Round(time.Minute).Minutes()))
}

func share(part, whole float64) float64 {
	if whole <= 0 {
		return 0
	}
	return part / whole
}

// num prints a number of GB with one decimal under 100, else whole.
func num(v float64) string {
	if v < 100 && v != float64(int(v)) {
		return fmt.Sprintf("%.1f", v)
	}
	return fmt.Sprintf("%.0f", v)
}

// stateMark is the state of a running run.
func stateMark(r executor.Summary) string {
	switch r.Status {
	case "starting":
		return "◌"
	case "stopping":
		return "◌"
	}
	return "●"
}

// resultMark is the outcome of an ended run, coloured.
func resultMark(r executor.Summary) string {
	switch r.Result {
	case protocol.Succeeded:
		return goodStyle.Render("✓ done")
	case protocol.Failed:
		return badStyle.Render("✗ failed")
	case protocol.TimedOut:
		return badStyle.Render("✗ timed out")
	case protocol.Canceled:
		return dimStyle.Render("– canceled")
	case "":
		switch r.Status {
		case "starting":
			return accentStyle.Render("◌ starting")
		case "stopping":
			return accentStyle.Render("◌ stopping")
		}
		return accentStyle.Render("● running")
	}
	return dimStyle.Render(oneLine(r.Result))
}
