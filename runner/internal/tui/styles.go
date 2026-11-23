package tui

import "github.com/charmbracelet/lipgloss"

// Colors come from the terminal's 16-color ANSI palette, so the runner follows the terminal theme (as skilltri and
// tussh do).
var (
	cRed     = lipgloss.Color("1")
	cGreen   = lipgloss.Color("2")
	cYellow  = lipgloss.Color("3")
	cMagenta = lipgloss.Color("5")
	cCyan    = lipgloss.Color("6")
	cWhite   = lipgloss.Color("15")

	cAccent = cCyan

	dimStyle    = lipgloss.NewStyle().Faint(true)
	boldStyle   = lipgloss.NewStyle().Bold(true)
	accentStyle = lipgloss.NewStyle().Foreground(cAccent)
	accentBold  = lipgloss.NewStyle().Foreground(cAccent).Bold(true)
	selStyle    = lipgloss.NewStyle().Foreground(cAccent).Bold(true)
	goodStyle   = lipgloss.NewStyle().Foreground(cGreen)
	badStyle    = lipgloss.NewStyle().Foreground(cRed)
	warnStyle   = lipgloss.NewStyle().Foreground(cYellow)
	keyStyle    = lipgloss.NewStyle().Foreground(cAccent).Bold(true)
	labelStyle  = lipgloss.NewStyle().Faint(true)
	codeStyle   = lipgloss.NewStyle().Foreground(cWhite).Bold(true)
	tabActive   = lipgloss.NewStyle().Bold(true).Foreground(cAccent).Reverse(true).Padding(0, 1)
	tabInactive = lipgloss.NewStyle().Faint(true).Padding(0, 1)
	alertChip   = lipgloss.NewStyle().Bold(true).Foreground(cWhite).Background(cRed).Padding(0, 1)
	appName     = lipgloss.NewStyle().Bold(true).Foreground(cMagenta)
)

// selectedBG is the SGR sequence of the selected-row background (ANSI bright black).
const selectedBG = "\x1b[100m"
