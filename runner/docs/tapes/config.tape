# Shared settings, included by the other tapes (Source). Run the tapes through docs/screenshots.sh: it builds the
# runner and the demo daemon (docs/demo), starts the demo on a socket and exports the sandbox the TUI reads.
Set Shell bash
Set FontFamily "Menlo"
Set FontSize 15
Set Width 1180
Set Height 700
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 20ms
Set CursorBlink false

# the sandbox of docs/screenshots.sh: HOME, PATH and the socket of the demo daemon
Hide
Type 'export HOME="$WR_DEMO_HOME" PATH="$WR_DEMO_PATH" WERKBUCH_RUNNER_SOCKET="$WR_DEMO_SOCKET" TZ=Europe/Berlin && echo "$(tput cols)x$(tput lines)" >"$WR_DEMO_SIZE" && clear' Enter
Sleep 300ms
Show
