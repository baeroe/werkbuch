# Status in a terminal of about 80 columns: the short slots line, the keys stay in the footer.
Output ".vhs/narrow.gif"
Set Shell bash
Set FontFamily "Menlo"
Set FontSize 15
Set Width 800
Set Height 560
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 20ms
Set CursorBlink false

Hide
Type 'export HOME="$WR_DEMO_HOME" PATH="$WR_DEMO_PATH" WERKBUCH_RUNNER_SOCKET="$WR_DEMO_SOCKET" TZ=Europe/Berlin && echo "$(tput cols)x$(tput lines)" >"$WR_DEMO_SIZE" && clear' Enter
Sleep 300ms
Type "werkbuch-runner" Enter
Sleep 3s
Show
Sleep 300ms
Screenshot "docs/screenshots/narrow.png"
Sleep 300ms
