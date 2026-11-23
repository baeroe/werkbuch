package tui

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// wideMin is the terminal width from which Runs shows the list and the log side by side.
const wideMin = 90

// width is the display width (grapheme aware, ANSI escapes ignored).
func width(s string) int { return ansi.StringWidth(s) }

// fit truncates s to w cells (with an ellipsis) and pads it with spaces to exactly w cells.
func fit(s string, w int) string {
	if w <= 0 {
		return ""
	}
	if width(s) > w {
		s = ansi.Truncate(s, w, "…")
	}
	if d := w - width(s); d > 0 {
		s += strings.Repeat(" ", d)
	}
	return s
}

// padLeft right-aligns s in w cells.
func padLeft(s string, w int) string {
	if w <= 0 {
		return ""
	}
	if width(s) > w {
		return ansi.Truncate(s, w, "…")
	}
	return strings.Repeat(" ", w-width(s)) + s
}

// spread puts left and right on one line of w cells, right ending one cell before the edge.
func spread(left, right string, w int) string {
	gap := w - width(left) - width(right) - 1
	if gap < 1 {
		return fit(left, w)
	}
	return left + strings.Repeat(" ", gap) + right + " "
}

// san makes external text (titles, logs, errors) safe to print: ANSI escapes are removed, tabs become spaces and
// other control characters are shown as "?". Newlines are kept.
func san(s string) string {
	s = ansi.Strip(s)
	if !strings.ContainsFunc(s, func(r rune) bool { return r < 0x20 && r != '\n' || r == 0x7f || (r >= 0x80 && r < 0xa0) }) {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\t':
			b.WriteString("    ")
		case r == '\n':
			b.WriteRune(r)
		case r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0):
			b.WriteRune('?')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// oneLine is san plus all whitespace collapsed (for table cells).
func oneLine(s string) string { return strings.Join(strings.Fields(san(s)), " ") }

// wrap breaks plain text into lines of at most w cells (on spaces when possible).
func wrap(s string, w int) []string {
	if w <= 0 {
		return nil
	}
	var out []string
	for _, para := range strings.Split(san(s), "\n") {
		line, start := "", len(out)
		for _, word := range strings.Fields(para) {
			for width(word) > w {
				if line != "" {
					out = append(out, line)
					line = ""
				}
				cut := ansi.Truncate(word, w, "")
				if cut == "" {
					cut = string([]rune(word)[:1])
				}
				out = append(out, cut)
				word = string([]rune(word)[len([]rune(cut)):])
			}
			switch {
			case word == "":
			case line == "":
				line = word
			case width(line)+1+width(word) <= w:
				line += " " + word
			default:
				out = append(out, line)
				line = word
			}
		}
		if line != "" || len(out) == start {
			out = append(out, line)
		}
	}
	return out
}

// highlightRow renders a selected row with a background over the full width.
func highlightRow(line string, w int) string {
	line = fit(line, w)
	line = strings.ReplaceAll(line, "\x1b[0m", "\x1b[0m"+selectedBG)
	line = strings.ReplaceAll(line, "\x1b[m", "\x1b[m"+selectedBG)
	return selectedBG + line + "\x1b[0m"
}

// clampLines makes s exactly h lines of at most w cells.
func clampLines(s string, w, h int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > h {
		lines = lines[:h]
	}
	for len(lines) < h {
		lines = append(lines, "")
	}
	for i, l := range lines {
		if width(l) > w {
			lines[i] = fit(l, w)
		}
	}
	return strings.Join(lines, "\n")
}

// overlay draws fg centered over bg (w x h); the background is dimmed and stripped of colors.
func overlay(bg, fg string, w, h int) string {
	src := strings.Split(bg, "\n")
	plain := make([]string, h)
	out := make([]string, h)
	for i := range h {
		l := ""
		if i < len(src) {
			l = src[i]
		}
		plain[i] = fit(ansi.Strip(l), w)
		out[i] = dimStyle.Render(plain[i])
	}
	fl := strings.Split(fg, "\n")
	fw := 0
	for _, l := range fl {
		fw = max(fw, width(l))
	}
	fw = min(fw, w)
	x := max(0, (w-fw)/2)
	y := max(0, (h-len(fl))/2)
	for i, l := range fl {
		row := y + i
		if row >= h {
			break
		}
		left := fit(ansi.Truncate(plain[row], x, ""), x)
		right := padLeft(ansi.TruncateLeft(plain[row], x+fw, ""), w-x-fw)
		out[row] = dimStyle.Render(left) + fit(l, fw) + dimStyle.Render(right)
	}
	return strings.Join(out, "\n")
}

// modalBox draws a bordered box of width w for overlays.
func modalBox(title string, lines []string, w int, color lipgloss.Color) string {
	bc := lipgloss.NewStyle().Foreground(color)
	inner := w - 2
	t := " " + ansi.Truncate(title, max(inner-3, 0), "…") + " "
	fill := max(inner-1-width(t), 0)
	var b strings.Builder
	b.WriteString(bc.Render("╭─") + lipgloss.NewStyle().Bold(true).Foreground(color).Render(t) + bc.Render(strings.Repeat("─", fill)+"╮") + "\n")
	for _, l := range lines {
		b.WriteString(bc.Render("│") + " " + fit(l, inner-2) + " " + bc.Render("│") + "\n")
	}
	b.WriteString(bc.Render("╰" + strings.Repeat("─", inner) + "╯"))
	return b.String()
}

// keyHints renders "k desc  k desc".
func keyHints(pairs ...string) string {
	var parts []string
	for i := 0; i+1 < len(pairs); i += 2 {
		parts = append(parts, keyStyle.Render(pairs[i])+" "+dimStyle.Render(pairs[i+1]))
	}
	return strings.Join(parts, "  ")
}

// kv renders a label column of width lw and a value.
func kv(label, value string, lw int) string { return labelStyle.Render(fit(label, lw)) + value }

// bar is a gauge of w cells for a share between 0 and 1.
func bar(share float64, w int) string {
	full := int(math.Round(math.Min(math.Max(share, 0), 1) * float64(w)))
	return accentStyle.Render(strings.Repeat("█", full)) + dimStyle.Render(strings.Repeat("░", w-full))
}

var sparks = []rune("▁▂▃▄▅▆▇█")

// spark draws the last w values (0–100) as a line of block characters.
func spark(values []float64, w int) string {
	if len(values) > w {
		values = values[len(values)-w:]
	}
	var b strings.Builder
	for _, v := range values {
		i := int(math.Round(math.Min(math.Max(v, 0), 100) / 100 * float64(len(sparks)-1)))
		b.WriteRune(sparks[i])
	}
	return accentStyle.Render(b.String())
}

// clock is a duration as m:ss or h:mm:ss.
func clock(d time.Duration) string {
	d = max(d, 0).Truncate(time.Second)
	h, m, s := int(d.Hours()), int(d.Minutes())%60, int(d.Seconds())%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}

// ago is t relative to now ("now", "30s ago", "5m ago", "3h ago", "never").
func ago(t, now time.Time) string {
	if t.IsZero() {
		return "never"
	}
	d := now.Sub(t)
	switch {
	case d < 2*time.Second:
		return "now"
	case d < time.Minute:
		return fmt.Sprintf("%ds ago", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	}
	return fmt.Sprintf("%dd ago", int(d.Hours()/24))
}

// plural is "1 problem", "2 problems".
func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}
