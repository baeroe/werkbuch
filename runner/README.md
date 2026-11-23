# werkbuch-runner

Runs agents of a [werkbuch](https://werkbuch.dev) instance on your own machine. The runner polls the instance over
HTTPS (no open port), runs Claude Code or Codex headless in a git worktree per strand and reports the log, heartbeats
and the result back. Name, places and the setup commands of projects are set in werkbuch; the runner keeps only the
instance URL (`~/.config/werkbuch-runner/config.yaml`) and its token (in the keychain).

## Commands

```sh
werkbuch-runner login https://werkbuch.example.com --code ABCD-EFGH   # pair (the code comes from Settings → Runners)
werkbuch-runner daemon    # poll and run (launchd/systemd units come with the installer)
werkbuch-runner status    # what the daemon does now
werkbuch-runner doctor    # CLIs, keychain, instance, token, git, equipment
werkbuch-runner update    # update to the version the instance expects
werkbuch-runner logout    # forget the instance and its token
werkbuch-runner version
```

The daemon listens on `~/.local/state/werkbuch-runner/runner.sock` (`GET /status`, `GET /runs`,
`GET /runs/{id}/events`, `POST /runs/{id}/cancel`, `GET /load`, `POST /update`) for the TUI.

## Development

```sh
make test                      # gofmt, go vet, go test -race
make build VERSION=0.3.2       # bin/werkbuch-runner, static, without cgo
```

Tests run against a fake werkbuch (`internal/fakewerkbuch`) and a fake Claude Code (`testdata/claude`, a shell script
that writes stream-json). The design is in `docs/superpowers/specs/2026-11-23-runner-design.md`.
