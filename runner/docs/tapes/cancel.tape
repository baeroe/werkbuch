# Runs: c asks before it cancels the running run.
Output ".vhs/cancel.gif"
Source "docs/tapes/config.tape"

Hide
Type "werkbuch-runner" Enter
Sleep 2s
Type "2"
Sleep 2s
Type "c"
Sleep 500ms
Show
Sleep 300ms
Screenshot "docs/screenshots/cancel.png"
Sleep 300ms
