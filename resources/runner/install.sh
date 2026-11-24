#!/bin/sh
# The installer of the werkbuch runner (spec 8.2), served by the instance at /runner/install.sh with its address set in
# WERKBUCH_URL. It downloads the runner of this instance, checks its SHA-256 sum, puts it into ~/.local/bin, pairs it
# with the one-time code from Settings → Runners and makes it a service of this user (launchd on macOS, systemd on
# Linux). Never as root and never with sudo: the agents run with the rights of the user who installs the runner.
#
#   curl -fsSL <instance>/runner/install.sh | sh -s -- --code <CODE> [--name <name>] [--prefix <dir>] [--no-service]
#
#   --code <CODE>    the one-time code (ten minutes, once)
#   --name <name>    the name of the runner in werkbuch (default: the host name)
#   --prefix <dir>   install into <dir>/bin (default: ~/.local)
#   --no-service     write the launchd plist or the systemd unit, but neither load nor start it
#
# Running it again with a new code pairs the runner again and replaces the service (one service, the new token).

# everything in functions: piped into sh, nothing runs before the whole script has arrived
set -eu

WERKBUCH_URL='__WERKBUCH_URL__'

setup_colors() {
    if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
        esc=$(printf '\033')
        bold="${esc}[1m" dim="${esc}[2m" green="${esc}[32m" red="${esc}[31m" app="${esc}[1;35m" reset="${esc}[0m"
    else
        bold='' dim='' green='' red='' app='' reset=''
    fi
}

info() { printf '  %s%-12s%s %s\n' "$dim" "$1" "$reset" "$2"; }
ok() { printf '%s✓%s %-12s %s\n' "$green" "$reset" "$1" "$2"; }
fail() { printf '%s✗%s %-12s %s%s%s\n' "$red" "$reset" "$1" "$red" "$2" "$reset" >&2; }

# die <step> <sentence>: the failed step, then nothing more happens
die() {
    fail "$1" "$2"
    exit 1
}

usage() {
    cat <<'USAGE'
Installs the werkbuch runner from this instance and pairs it.

  curl -fsSL <instance>/runner/install.sh | sh -s -- --code <CODE> [--name <name>] [--prefix <dir>] [--no-service]

  --code <CODE>    the one-time code from Settings → Runners → Connect runner
  --name <name>    the name of the runner in werkbuch (default: the host name)
  --prefix <dir>   install into <dir>/bin (default: ~/.local)
  --no-service     write the launchd plist or the systemd unit, but neither load nor start it
USAGE
}

# shown <path>: the path with ~ for the home folder
shown() {
    case $1 in
        "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;;
        *) printf '%s' "$1" ;;
    esac
}

# the address of the instance: https, http only for this machine (like the runner, A499); never a user in it (an @ would
# make the host what follows it, `http://localhost@evil.example` is evil.example)
check_instance() {
    authority=${WERKBUCH_URL#*://}
    authority=${authority%%/*}
    case $authority in
        *@*) die instance "the address of the instance names a user: $WERKBUCH_URL" ;;
    esac
    case $WERKBUCH_URL in
        https://?*) proto='=https' ;;
        http://?*)
            case $authority in
                \[::1\] | \[::1\]:*) ;;
                *)
                    host=${authority%:*}
                    case $host in
                        localhost) ;;
                        127.*)
                            case $host in *[!0-9.]*) die instance "werkbuch is reached over https (http only on this machine): $WERKBUCH_URL" ;; esac
                            ;;
                        *) die instance "werkbuch is reached over https (http only on this machine): $WERKBUCH_URL" ;;
                    esac
                    ;;
            esac
            proto='=http,https'
            ;;
        *) die instance "the instance has no address: $WERKBUCH_URL" ;;
    esac
}

detect_system() {
    case $(uname -s) in
        Darwin) os=darwin ;;
        Linux) os=linux ;;
        *) die system "the runner runs on macOS and Linux, not on $(uname -s)" ;;
    esac
    case $(uname -m) in
        arm64 | aarch64) arch=arm64 ;;
        x86_64 | amd64) arch=amd64 ;;
        *) die system "the runner runs on arm64 and amd64, not on $(uname -m)" ;;
    esac
    # a shell under Rosetta says x86_64 on Apple silicon: take the native runner
    if [ "$os" = darwin ] && [ "$arch" = amd64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
        arch=arm64
    fi
}

fetch() { # <url> <file>
    curl -fsSL --proto "$proto" --retry 2 -o "$2" "$1" </dev/null
}

sha256() { # <file>
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{ print $1 }'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{ print $1 }'
    else
        die checksum "neither sha256sum nor shasum is installed"
    fi
}

main() {
    code='' name='' prefix='' service=1
    while [ $# -gt 0 ]; do
        case $1 in
            --code) [ $# -ge 2 ] || { usage >&2; exit 2; }; code=$2; shift 2 ;;
            --code=*) code=${1#*=}; shift ;;
            --name) [ $# -ge 2 ] || { usage >&2; exit 2; }; name=$2; shift 2 ;;
            --name=*) name=${1#*=}; shift ;;
            --prefix) [ $# -ge 2 ] || { usage >&2; exit 2; }; prefix=$2; shift 2 ;;
            --prefix=*) prefix=${1#*=}; shift ;;
            --no-service) service=0; shift ;;
            -h | --help) usage; exit 0 ;;
            *) printf 'unknown option %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
        esac
    done
    setup_colors
    printf '\n%swerkbuch-runner%s installer\n\n' "$app" "$reset"
    if [ -z "$code" ]; then
        die code "--code is missing: copy the command from werkbuch, Settings → Runners → Connect runner"
    fi
    if [ "$(id -u)" = 0 ]; then
        die user "do not run the installer as root or with sudo: the agents run with the rights of the user who installs the runner"
    fi
    : "${HOME:?HOME is not set}"
    [ -n "$prefix" ] || prefix="$HOME/.local"
    case $prefix in /*) ;; *) prefix="$(pwd)/$prefix" ;; esac
    bindir="$prefix/bin"

    check_instance
    detect_system
    info system "$os/$arch"
    info instance "$WERKBUCH_URL"

    # the download waits next to its place, not in /tmp: /tmp may be mounted noexec, and the binary runs before it moves
    mkdir -p "$bindir"
    tmp=$(mktemp -d "$bindir/.werkbuch-runner.XXXXXX")
    trap 'rm -rf "$tmp"' EXIT
    trap 'exit 130' INT TERM
    url="$WERKBUCH_URL/runner/download/$os/$arch"

    fetch "$url" "$tmp/werkbuch-runner" || die downloaded "could not download $url"
    bytes=$(wc -c <"$tmp/werkbuch-runner" | tr -d ' ')
    ok downloaded "werkbuch-runner $os/$arch $dim($(awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b / 1000000 }'))$reset"

    # the sum before the binary runs at all
    fetch "$url.sha256" "$tmp/werkbuch-runner.sha256" || die checksum "could not download $url.sha256"
    expected=$(awk '{ print tolower($1); exit }' "$tmp/werkbuch-runner.sha256")
    actual=$(sha256 "$tmp/werkbuch-runner")
    if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
        die checksum "sha256 $actual does not match $expected: nothing was installed"
    fi
    ok checksum "sha256 $(printf '%s' "$actual" | cut -c 1-4)…$(printf '%s' "$actual" | cut -c 61-64) matches"

    chmod 755 "$tmp/werkbuch-runner"
    version=$("$tmp/werkbuch-runner" version </dev/null 2>/dev/null) || die installed "the downloaded runner does not start on this machine"
    # a new file renamed into place (same folder): a running daemon keeps its old binary until it starts again
    mv -f "$tmp/werkbuch-runner" "$bindir/werkbuch-runner"
    runner="$bindir/werkbuch-runner"
    ok installed "$(shown "$runner") $dim($version)$reset"

    set -- login "$WERKBUCH_URL" --code "$code"
    if [ -n "$name" ]; then
        set -- "$@" --name "$name"
    fi
    if out=$("$runner" "$@" </dev/null 2>&1); then
        ok paired "$(printf '%s\n' "$out" | sed -n '1{s/^Paired //;s/"//g;s/\.$//;p;}')"
    else
        fail paired "$(printf '%s\n' "$out" | tail -n 1 | sed 's/^werkbuch-runner: //')"
        printf '\nCreate a new code in werkbuch: %sSettings → Runners → Connect runner%s, then run the command again.\n' "$bold" "$reset"
        printf 'The runner is in %s; no service was set up.\n\n' "$(shown "$runner")"
        exit 1
    fi

    if [ "$service" = 1 ]; then
        if out=$("$runner" service install </dev/null 2>&1); then
            ok service "$out"
        else
            fail service "$(printf '%s\n' "$out" | tail -n 1 | sed 's/^werkbuch-runner: //')"
            printf '\nThe runner is paired but does not run. Start it yourself: %s%s daemon%s\n\n' "$bold" "$(shown "$runner")" "$reset"
            exit 1
        fi
    else
        out=$("$runner" service install --no-start </dev/null 2>&1) || die service "$(printf '%s\n' "$out" | tail -n 1 | sed 's/^werkbuch-runner: //')"
        ok service "$out"
    fi

    printf '\n'
    if [ "$service" = 1 ]; then
        printf 'The runner polls for runs now, for every project. Slots and setup commands come from werkbuch;\n'
    else
        printf 'The runner is paired but does not run yet: start it with %s%s service install%s or %s%s daemon%s.\n' "$bold" "$(shown "$runner")" "$reset" "$bold" "$(shown "$runner")" "$reset"
        printf 'Slots and setup commands come from werkbuch;\n'
    fi
    printf 'MCP servers, skills and plugins are set up on this machine.\n'
    case ":${PATH:-}:" in
        *":$bindir:"*) printf 'Open the TUI with %swerkbuch-runner%s.\n\n' "$bold" "$reset" ;;
        *) printf '%s is not in your PATH: add it, then open the TUI with %swerkbuch-runner%s.\n\n' "$(shown "$bindir")" "$bold" "$reset" ;;
    esac
}

main "$@"
