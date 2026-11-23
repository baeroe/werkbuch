#!/usr/bin/env bash
# Regenerates the screenshots of the TUI in docs/screenshots/ from the VHS tapes in docs/tapes/ (A502).
#
#   bash docs/screenshots.sh           # all tapes
#   bash docs/screenshots.sh runs      # only docs/tapes/runs.tape
#
# Needs go and vhs (brew install vhs; pulls ttyd and ffmpeg), optionally oxipng. Everything runs in a throwaway
# sandbox: the TUI talks to the demo daemon (docs/demo) on a socket under /tmp and never to a real daemon, instance,
# config or keychain. The demo data are those of the clickdummy (`/_tui`), the instance is werkbuch.example.com.
set -euo pipefail

runner=$(cd "$(dirname "$0")/.." && pwd)
cd "$runner"

sandbox=$(mktemp -d /private/tmp/wrdemo.XXXXXX)
demo_pid=""
cleanup() {
	local status=$?
	trap - EXIT INT TERM HUP
	[ -n "$demo_pid" ] && kill "$demo_pid" 2>/dev/null && wait "$demo_pid" 2>/dev/null
	rm -rf "$sandbox" "$runner/.vhs"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

for v in $(env | sed -n 's/^\(WERKBUCH_RUNNER_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
mkdir -p "$sandbox/home/.local/bin" "$sandbox/bin"
go build -trimpath -ldflags '-X main.version=0.4.0' -o "$sandbox/home/.local/bin/werkbuch-runner" .
go build -trimpath -o "$sandbox/bin/demo" ./docs/demo

export WR_DEMO_HOME="$sandbox/home"
export WR_DEMO_PATH="$sandbox/home/.local/bin:/usr/bin:/bin"
export WR_DEMO_SOCKET="$sandbox/r.sock"
export WR_DEMO_SIZE="$sandbox/size"
HOME="$WR_DEMO_HOME" "$sandbox/bin/demo" -socket "$WR_DEMO_SOCKET" &
demo_pid=$!
for _ in $(seq 50); do [ -S "$WR_DEMO_SOCKET" ] && break; sleep 0.1; done

tapes=("$@")
[ ${#tapes[@]} -eq 0 ] && tapes=(status runs cancel doctor narrow)
for t in "${tapes[@]}"; do
	vhs "docs/tapes/$t.tape"
	echo "$t: terminal $(cat "$WR_DEMO_SIZE")"
done
if command -v oxipng >/dev/null; then
	oxipng -q -o 4 --strip safe docs/screenshots/*.png
fi
