package tui

import (
	tea "github.com/charmbracelet/bubbletea"

	"github.com/baeroe/werkbuch/runner/internal/socket"
)

// globalKeys are the keys of every tab (pairs: key, description).
var globalKeys = []string{
	"tab ⇧tab", "next / previous tab",
	"1-3", "jump to a tab",
	"↑↓ j k", "move",
	"?", "this help",
	"esc", "close the dialog",
	"q ctrl+c", "quit",
}

// helpModal is the "?" overlay: the global keys and those of the active tab.
type helpModal struct{}

func (h *helpModal) update(m *Model, k tea.KeyMsg) (tea.Cmd, bool) {
	switch k.String() {
	case "?", "esc", "q", "enter":
		return nil, true
	}
	return nil, false
}

func (h *helpModal) hints() []string { return []string{"esc", "close"} }

func (h *helpModal) view(m *Model, w, ht int) string {
	bw := min(w, 64)
	kw := 14
	section := func(title string, pairs []string) []string {
		l := []string{boldStyle.Render(title)}
		for i := 0; i+1 < len(pairs); i += 2 {
			l = append(l, keyStyle.Render(fit(pairs[i], kw))+dimStyle.Render(pairs[i+1]))
		}
		return l
	}
	lines := section("Everywhere", globalKeys)
	lines = append(lines, "")
	lines = append(lines, section(tabNames[m.tab], m.tabKeys())...)
	lines = append(lines, "", dimStyle.Render("Nothing is set up here: slots and setup commands live in werkbuch."))
	if len(lines) > ht-2 {
		lines = lines[:max(ht-2, 0)]
	}
	return modalBox("Keys", lines, bw, cAccent)
}

// tabKeys are the keys of the active tab for the help.
func (m *Model) tabKeys() []string {
	switch m.tab {
	case TabStatus:
		k := []string{"enter", "open the chosen run in Runs", "r", "ask the daemon now"}
		if m.opts.Logout != nil {
			k = append(k, "l", "log out (forget the token)")
		}
		return k
	case TabRuns:
		return []string{"enter", "full log", "f", "follow the log on / off", "g G", "top / end of the full log", "c", "cancel the chosen run", "esc", "back from the full log"}
	}
	return []string{"r", "run the checks again", "enter", "details of the chosen check"}
}

// confirmModal asks before something that cannot be undone.
type confirmModal struct {
	title string
	lines []string
	yes   string // the label of y (default "yes")
	no    string // the label of n (default "no")
	onYes func(m *Model) tea.Cmd
}

func (c *confirmModal) update(m *Model, k tea.KeyMsg) (tea.Cmd, bool) {
	switch k.String() {
	case "y", "enter":
		return c.onYes(m), true
	case "n", "esc", "q":
		return nil, true
	}
	return nil, false
}

func (c *confirmModal) hints() []string {
	yes, no := c.yes, c.no
	if yes == "" {
		yes = "yes"
	}
	if no == "" {
		no = "no"
	}
	return []string{"y", yes, "n esc", no}
}

func (c *confirmModal) view(m *Model, w, h int) string {
	return modalBox(c.title, append(append([]string{}, c.lines...), "", keyHints(c.hints()...)), min(w, 72), cYellow)
}

// detailModal shows a check in full.
type detailModal struct{ check socket.Check }

func (d *detailModal) update(m *Model, k tea.KeyMsg) (tea.Cmd, bool) {
	switch k.String() {
	case "esc", "enter", "q":
		return nil, true
	}
	return nil, false
}

func (d *detailModal) hints() []string { return []string{"esc", "close"} }

func (d *detailModal) view(m *Model, w, h int) string {
	bw := min(w, 76)
	lines := []string{mark(d.check.Level) + " " + boldStyle.Render(d.check.Level), ""}
	lines = append(lines, wrap(d.check.Detail, bw-4)...)
	color := cGreen
	switch d.check.Level {
	case levelWarn:
		color = cYellow
	case levelFail:
		color = cRed
	}
	if len(lines) > h-2 {
		lines = lines[:max(h-2, 0)]
	}
	return modalBox(d.check.Name, lines, bw, color)
}
