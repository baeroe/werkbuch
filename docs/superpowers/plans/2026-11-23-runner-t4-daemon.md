# Runner, Task 4: Runner-Daemon in Go (WEBU-21)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `runner/` (eigenes `go.mod`, `github.com/baeroe/werkbuch/runner`) ist ein Daemon, der sich per Einmal-Code mit werkbuch verbindet, über `/api/runner/*` pollt (auch ohne freien Platz, mit Bericht), Aufträge in einem Worktree je Strang mit Claude Code oder Codex headless ausführt, Ereignisse, Heartbeat und Ergebnis meldet, Abbruch und Zeitlimit durchsetzt, sich selbst aktualisiert und der TUI (WEBU-22) eine Socket-API gibt.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` auf `main` (6, 7.7, 7.8, 8, 9, 11.1, 11.2, 14). Plan: `2026-11-23-runner.md` Task 4. **Server-Referenz:** PR #65 (WEBU-20), `routes/runner.php`, `RunnerProtocolController`, `ClaimRun`, `RecordHeartbeat`, `RecordRunEvents`, `FinishRun`, `RunnerProtocol`, `Protocol`, Rulings A472–A487. Nicht hier: TUI (WEBU-22), Installer, Downloads, Image, Dienst-Dateien (WEBU-23), GitHub-Tokens (WEBU-24), Prompts (WEBU-26).

**Rulings:** ab A488 in `2026-10-30-werkbuch-app-rulings.md`.

## Entscheidungen

### Protokoll (wie PR #65)

Jede Anfrage: `X-Werkbuch-Runner-Version`, `X-Werkbuch-Protocol: 1`, außer `pair` `Authorization: Bearer wbr_…`.

| Anfrage | Body | Antwort |
|---|---|---|
| `POST /api/runner/pair` | `code`, `name` (Host), `os`, `arch`, `version` | 201 `{runner, token, places, version, protocol, heartbeat_seconds}` |
| `POST /api/runner/claim` | Bericht `load`, `clis`, `equipment` | 200 `{run \| null, places, version, protocol, heartbeat_seconds}` |
| `POST /api/runner/runs/{id}/heartbeat` | `attempt`, Bericht | `{cancel, lease_expires_at, deadline_at, places, version, …}` |
| `POST /api/runner/runs/{id}/events` | `attempt`, `events [{kind, text, at}]` (≤ 100) | `{stored, dropped}` |
| `POST /api/runner/runs/{id}/result` | `attempt`, `status`, `session_id`, `verdict`, `text`, `commit`, `summary`, `usage {input, output}`, `error` | `{run: {id, status}}` |

Fehler sind Problem Details (`reason`): 401 `unauthenticated` (Token widerrufen), 404, 409 `run_replaced` (Versuch ersetzt: Prozess sofort beenden, kein Ergebnis), 422 mit `errors`.

### Aufbau

`runner/main.go` (Befehle), `runner/internal/`:

- `paths` (Config `~/.config/werkbuch-runner`, Zustand `~/.local/state/werkbuch-runner`, Daten `~/.local/share/werkbuch-runner`, Socket; Env-Overrides für Tests)
- `config` (YAML: `instance`, dazu bis WEBU-24 `repos` als Entwicklungs-Hilfe, A488)
- `keyring` (Dienst `werkbuch-runner`, Konto = Instanz-URL; in Tests `keyring.MockInit`)
- `redact` (Tokens wie `App\Support\Secrets` → `[token]`; slog-Handler, der jede Ausgabe filtert)
- `client` (Protokoll, Problem Details als `*ProblemError`, Downloads)
- `load` (CPU, RAM, Speicher über gopsutil v4 ohne cgo, GPU über `ioreg` bzw. `nvidia-smi`, alle 5 s)
- `clis` (`claude`/`codex` im `PATH`: Pfad, Version, Anmeldung)
- `equipment` (MCP-Server per `claude mcp list`, Skills, Plugins; Server, die die Instanz erreichen → `werkbuch_access`)
- `adapters` (Schnittstelle, `claude`, `codex`: Aufruf, stream-json/JSONL → Ereignisse, Session, Nutzung, Antwort)
- `mcpconfig` (je Auftrag `werkbuch-run` in privatem Temp-Ordner, 0700/0600, nach dem Lauf gelöscht)
- `git` (bare Klon mit `origin/*` je Repo, Worktree je Strang bzw. je Review, Token nur in der Umgebung)
- `hooks` (Setup/Teardown aus dem Claim, `sh -c` im Worktree, mit Zeitlimit)
- `executor` (ein Auftrag: Arbeitsordner, Hooks, MCP, Prozessgruppe, Ereignisse gebündelt ≤ 1/s, Heartbeat, Abbruch/Zeitlimit SIGTERM → 10 s → SIGKILL, Ergebnis)
- `daemon` (Polling 3 s/10 s, Plätze aus werkbuch, Bericht, Läufe, Selbst-Update, Aufräumen)
- `socket` (HTTP über Unix-Socket 0600: `GET /status`, `GET /runs`, `GET /runs/{id}/events` als NDJSON-Stream, `POST /runs/{id}/cancel`, `GET /load`, `POST /update`; Client für `status`)
- `update` (Download, SHA-256, atomarer Tausch, Neustart per `exec`)
- `doctor` (Config, Keychain, Instanz, Token, Git, CLIs, Ausstattung mit Warnung, Datenordner)

Befehle: `login <url> --code <CODE> [--name]`, `daemon`, `status`, `doctor`, `logout`, `update`, `version`; ohne Argumente ein Hinweis (die TUI kommt mit WEBU-22).

### Ablauf eines Auftrags

1. Arbeitsordner: mit Repo (Claim `git.repo_url` bzw. `repos[KENNUNG]`) Worktree `worktrees/<strang>` auf `thread.branch` (vorhanden: `origin/<branch>`, sonst neu von `origin/<base_branch>`), ein Review ohne Strang `worktrees/run-<id>` am `head_sha`; ohne Repo `work/<strang>`. Nach dem Anlegen Setup-Befehl; Teardown merkt sich der Ordner in `.werkbuch-runner.json` daneben.
2. MCP-Config `werkbuch-run` (HTTP, Bearer Run-Token) zusätzlich zur Ausstattung der Maschine (Claude `--mcp-config` ohne `--strict-mcp-config`; Codex `-c mcp_servers.werkbuch-run.*` mit `bearer_token_env_var`).
3. CLI in eigener Prozessgruppe, Prompt über stdin, Umgebung mit Commit-Identität und (später) Git-Token.
4. Ereignisse gebündelt (≤ 1/s, ≤ 100 je Anfrage), Heartbeat alle `heartbeat_seconds`, Abbruch über die Antwort, Zeitlimit über `deadline_at`; `run_replaced`/404 beendet sofort ohne Ergebnis.
5. Ergebnis: `succeeded` bei Exit 0 und Ergebnis ohne Fehler, sonst `failed` mit Grund; `canceled`, `timed_out`; `session_id`, Nutzung, bei Code-Läufen der neue `HEAD` und die Zusammenfassung, bei `review` Urteil und Befunde, bei `comment` die Antwort.

## Tasks

### 1. Gerüst, Pfade, Config, Keyring, Redact
- [x] Tests `paths_test.go`, `config_test.go`, `keyring_test.go`, `redact_test.go`.
- [x] Umsetzung, `Makefile`, `main.go` mit `version`.
- [x] Commit.

### 2. Client und falscher Server
- [x] `internal/fakewerkbuch` (httptest, Protokoll wie PR #65, Zustand für Tests), `client_test.go` (Header, Problem, 204/409/401, kein Token im Fehlertext).
- [x] Commit.

### 3. Bericht: Auslastung, CLIs, Ausstattung
- [x] Tests mit falschem `PATH` und falschen Befehlen (`ioreg`, `claude`), Parser getrennt testbar.
- [x] Commit.

### 4. Adapter, MCP-Config, Git, Hooks
- [x] Tests: Argumente (`--model`, `--resume`, `--mcp-config` ohne `--strict-mcp-config`), Parser von stream-json und Codex-JSONL, Urteil, MCP-Datei 0600 und weg nach dem Lauf, Worktree je Strang wiederverwendet, Review am Commit, Token nie in `.git/config`.
- [x] Commit.

### 5. Executor und Daemon
- [x] Tests mit falschem CLI (`testdata/fake-claude`, Shell): Claim → Lauf → Ereignisse → Ergebnis; Abbruch; Zeitlimit (SIGTERM ignoriert → SIGKILL, `timed_out`); Lease-Verlust (409) ohne Ergebnis; Resume; Polling ohne Auftrag; Geheimnisse nie im Log.
- [x] Commit.

### 6. Socket, Update, Doctor, Befehle
- [x] Tests: Socket-API über einen Temp-Socket, Update (Summe falsch → alter bleibt; richtig → ersetzt), Doctor (Warnung bei weiterem werkbuch-Zugang), `login`/`logout` mit falschem Server.
- [x] Commit.

### 7. CI, Doku, Abnahme
- [x] Job `runner` in `tests.yml` (gofmt, vet, `go test -race`), `WorkflowsTest` „checks the runner in a job of its own“; `CLAUDE.md` Abschnitt „Runner (Go)“, `runner/README.md`, Rulings.
- [x] Abnahme gegen das DDEV des Worktrees mit falschem CLI und lokalem Repo; Nachweis.

## Abweichungen und Stand (nach der Umsetzung)

- PR #65 schickt im Claim noch kein `git` und keine Setup-/Teardown-Befehle (`null`); der Runner nimmt beide Formen (WEBU-24 liefert `git {repo_url, token, expires_at}`), bis dahin `repos` aus A488. Die Erneuerung des Git-Tokens (`POST runs/{id}/git-token`) kommt mit WEBU-24.
- Adapter: statt `Session(events)` ein `Stream` je Lauf (`Feed`, `Outcome`), weil Session, Nutzung und Antwort beim Lesen anfallen.
- Codex kommt im ersten Wurf mit (Aufruf und Parser getestet, kein echter Lauf).
- Die Abnahme mit Claude Code selbst ist Teil von WEBU-29; hier lief der Runner gegen das DDEV des Worktrees mit dem falschen CLI und einem lokalen Repo.
