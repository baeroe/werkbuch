# Runner, Task 3: Server – Runner, Aufträge, Protokoll, Run-Tokens (WEBU-20)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** werkbuch kennt Runner, Agenten-Konfigurationen, Aufträge, Stränge und das Protokoll des Runners unter `/api/runner/*`; Aufträge lassen sich anlegen (`EnqueueRun`), von genau einem passenden Runner abholen, mit Heartbeat, Ereignissen und Ergebnis führen, abbrechen, erneut starten; Run-Tokens des Bots sind hart gesperrt; REST unter `/api/v1` und MCP (`agents`/`manage-agents`) lesen und verwalten das alles.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` (5, 6, 7.5, 8.4, 8.6–8.8, 9, 11.2, 13), Plan `2026-11-23-runner.md` Task 3. Nicht hier: GitHub (WEBU-24), PR-Verknüpfung und Agenten-Schritte am Workflow (WEBU-25), Auslöser, Zustandsmaschine, Prompts, Modell aus Label und Projekt (WEBU-26), Oberfläche (WEBU-27/28), Go-Runner (WEBU-21).

**Rulings:** A472–A486 in `2026-10-30-werkbuch-app-rulings.md` (unten zusammengefasst).

## Entscheidungen

### Datenmodell (Migration `2026_11_23_000100_create_runner_tables`)

- `runners`: `name` (64), `token_hash` (sha256, eindeutig), `os`, `arch`, `version`, `protocol`, `slots_total` (2), `slots_per_repo` (1), `slots_light` (2), `load` json, `clis` json, `equipment` json, `last_seen_at`, `revoked_at`, `created_by`, Stempel. Ein widerrufener Runner bleibt als Zeile (Aufträge zeigen ihn), seine Name ist frei.
- `runner_pairing_codes`: `code_hash` (eindeutig), `expires_at`, `redeemed_at`, `runner_id`, `created_by`, `created_at`.
- `agent_configs`: je Bot eine Zeile (`bot_id` eindeutig): `enabled`, `runner_ids` json (leer = alle Runner), `cli`, `model`, `models` json (Typ → Modell).
- `agent_threads`: `bot_id`, `project_id` (Kaskade), `work_item_id` (Kaskade), `runner_id`, `branch`, `base_branch`, `worktree`, `session_id`, `pr_number`, `status` (`open`, `paused`, `merged`, `closed`), `pause_reason`, `corrections`, `conflicts`.
- `agent_runs`: `type`, `status`, `waiting_reason` (`no_cli`, `runner_offline`), `bot_id`, `cli`, `model`, `model_source` (`label`, `project`, `bot`, `default`), `model_label_id`, `runner_id`, `project_id` (Pflicht, Kaskade), `work_item_id` (nullable, `nullOnDelete`), `thread_id` (`nullOnDelete`), `head_sha`, `trigger_event_id`, `context` json, `attempt`, `lease_expires_at`, `started_at`, `finished_at`, `result` json (`verdict`, `text`, `commit`, `summary`), `session_id`, `usage` json, `error`, `canceled_by`, `events_dropped`, Stempel. Indizes für die Vergabe (`status`, `type`) und je Runner (`runner_id`, `status`).
- `agent_run_events`: `run_id` (Kaskade), `attempt`, `kind` (`system`, `text`, `tool`, `result`, `error`), `text`, `bytes`, `at` (timestamp(6)).
- `personal_access_tokens.agent_run_id` (nullable, `nullOnDelete`, Index): kennzeichnet ein Run-Token.

### Domain (`app/Domain/Agents/`, rein)

`RunType` (Enum, `light()`, `timeoutMinutes()` 60/60/30/20/10 (seit WEBU-26 120/120/30/20/10, A605), `urgent()` für conflict/correction/review, `abilities()`), `RunStatus` (Enum, `active()`, `finished()`, `retryable()`), `AgentCli` (Enum `claude`, `codex`, `models()`, `defaultModel()`), `Protocol` (`VERSION` 1, `LEASE_SECONDS` 60, `TAKEOVER_MINUTES` 30), `Places` (freie Plätze aus Einstellung und Belegung, leichte nur im eigenen Topf), `Contract` (Vertrag je Typ, englisch, bis WEBU-26 auch der Platzhalter des Prompts).

### Protokoll (`routes/runner.php`, Präfix `api/runner`, ohne Middleware-Gruppe)

Header jeder Anfrage: `Authorization: Bearer wbr_…` (außer Pairing), `X-Werkbuch-Runner-Version`, `X-Werkbuch-Protocol`.

| Route | Action | Antwort |
|---|---|---|
| `POST pair` | `PairRunner` | 201 `{runner: {id, name}, token, places, version, protocol}` |
| `POST claim` | `ClaimRun` | 200 `{run: … \| null, places, version, protocol}` |
| `POST runs/{run}/heartbeat` | `RecordHeartbeat` | 200 `{cancel, lease_expires_at, deadline_at, places, version}` |
| `POST runs/{run}/events` | `RecordRunEvents` | 200 `{stored, dropped}` |
| `POST runs/{run}/result` | `FinishRun` | 200 `{run: {id, status}}` |

- Runner-Token `wbr_` + 48 Zeichen, gespeichert als sha256 (A472); Middleware `AuthenticateRunner` (401 Problem `unauthenticated`, auch widerrufen). Drosseln `runner` (3000/min je Runner, sonst je Adresse 60) und `runner-pair` (10/min je Adresse).
- Bericht (claim, heartbeat): `load {cpu, gpu, ram_used, ram_total, disk_free, disk_total}`, `clis [{cli, installed, version, logged_in, path}]`, `equipment {mcp_servers, skills, plugins, werkbuch_access}`; gespeichert wird der letzte Stand samt `last_seen_at`, Version, Protokoll.
- Lease 60 s, Heartbeat-Empfehlung 15 s (A474). Versuch (`attempt`) in Heartbeat, Ereignissen, Ergebnis; ein anderer oder ein Auftrag, der nicht mehr diesem Runner gehört, ist 409 `run_replaced`.
- Zu altes Protokoll: `run: null`.

### Vergabe (`ClaimRun`)

Transaktion: Runner `for update` (eine Vergabe je Runner zur Zeit), Belegung zählen, Kandidaten ohne Sperre lesen (`queued`, `waiting`; geordnet `conflict`/`correction`/`review` vor `task`/`comment`, dann Priorität des Items, dann Alter = ULID), je Kandidat in PHP prüfen (Agent an, Runner im Pool oder Pool leer, CLI installiert und angemeldet, Plätze, Strang-Bindung), den ersten passenden `for update` neu lesen und erneut prüfen, dann `running`, Lease, Start, Run-Token. Strang: `review` geht an jeden Runner; sonst an den Runner des Strangs, nach 30 min offline (oder widerrufen) zieht der Strang um (Session leer). Plätze je Repo = je Projekt bis Task 7 (Repo und Projekt 1:1, A476).

### Ende eines Auftrags

`FinishRun` (Runner), `CancelRun` (Person), `ReapLostRuns` (jede Minute), `RevokeRunner`: Endstatus setzt `finished_at`, nimmt Lease, widerruft das Run-Token, schreibt `agent_run.finished` mit Status. Verlust (A475): erstes Mal zurück auf `queued` mit `attempt + 1`, zweites Mal Endstatus `lost`. Zeitlimit: Start + Limit + Lease vorbei → `timed_out`. Warten (A486): `ReapLostRuns` setzt `waiting` mit Grund `no_cli` bzw. `runner_offline` und hebt ihn auf, wenn er nicht mehr gilt.

### Run-Tokens und Sperre (A477)

`RunTokens::issue` (persönliches Token des Bots, Fähigkeiten nach Typ, Ablauf = Limit + 10 min, `agent_run_id`, kein Event), `revoke`. `ListTokens` und `RevokeToken` übergehen Run-Tokens. `RunTokenGuard`: `Authorize::check` und `allows` fragen ihn zuerst; eine Fähigkeit außerhalb der Erlaubt-Liste ist 403 `agent_forbidden`. Dazu ausdrücklich in `TransitionWorkItem`, `ChangeWorkItemType`, `ArchiveWorkItem`, `RestoreWorkItem`, `BulkUpdateWorkItems`, `RemoveRelation`, `SetSubscription`, und `UpdateWorkItem` mit anderen Schlüsseln als Beschreibung und Werten. Rechte-Matrix: Spalte `run_token` (der Agent-Bot, Mitglied von WEB, mit Run-Token eines `task`).

### Ereignisse (A478)

`runner.paired|updated|revoked`, `agent_config.updated`, `agent_run.queued|started|canceled|finished`; Subjekt Runner, Konfiguration bzw. Auftrag (`meta.item_id`), ohne Webhook; `agent_run.*` live an den Projektkanal. Das Protokoll geht nicht durch die Outbox.

### REST und MCP (A482, A483)

| Route | Action |
|---|---|
| `GET runners`, `GET runners/{runner}` | `ListRunners`, `GetRunner` |
| `PATCH runners/{runner}` | `UpdateRunner` (Name, Plätze) |
| `DELETE runners/{runner}` | `RevokeRunner` → `{canceled}` |
| `POST runner-pairings` (Sitzung), `GET runner-pairings/{pairing}` (Sitzung) | `CreatePairingCode`, `GetPairingCode` |
| `GET runs`, `GET runs/{run}`, `GET runs/{run}/events` | `ListRuns`, `GetRun`, `ListRunEvents` |
| `POST runs/{run}/cancel`, `POST runs/{run}/retry` | `CancelRun`, `RetryRun` |
| `GET bots/{user}/agent`, `PUT bots/{user}/agent` | `GetAgentConfig`, `SaveAgentConfig` |

MCP: `agents` (`list-runners`, `get-runner`, `list-runs`, `get-run`, `run-events`, `get-config`) und `manage-agents` (`update-runner`, `revoke-runner`, `cancel-run`, `retry-run`, `save-config`); Pairing nur Sitzung (A397).

## Tasks

### 1. Schema, Modelle, Domain
- [ ] Tests: `tests/Unit/Domain/Agents/*` (Typen, Status, CLIs, Plätze, Vertrag), `tests/Feature/Agents/AgentModelsTest.php` (Kaskaden, Casts, Morph-Map).
- [ ] Migration, Modelle `Runner`, `RunnerPairingCode`, `AgentConfig`, `AgentThread`, `AgentRun`, `AgentRunEvent` mit Factories; Morph-Map `runner`, `agent_config`, `agent_run`.
- [ ] Commit.

### 2. Actor, Run-Tokens, Sperre
- [ ] Tests: `RunTokensTest` (`it revokes the run token when the run ends in any status`, `it leaves run tokens out of the token list`), `RunTokenGuardTest` (`it refuses state changes, assignment, archive and delete through a run token with agent_forbidden`), Matrix-Spalte `run_token`.
- [ ] `Actor::agent`, `RunTokens`, `RunTokenGuard`, Aufrufe in `Authorize` und den Item-Actions, `ListTokens`/`RevokeToken`.
- [ ] Commit.

### 3. Pairing und Protokoll
- [ ] Tests: `tests/Feature/Runners/PairingTest.php`, `RunnerProtocolTest.php`, `tests/Feature/AgentRuns/ClaimRunTest.php`, `RunLifecycleTest.php`, `tests/Integration/ClaimRaceTest.php` (alle Testnamen des Epic-Plans).
- [ ] `CreatePairingCode`, `GetPairingCode`, `PairRunner`, `EnqueueRun`, `ClaimRun`, `RecordHeartbeat`, `RecordRunEvents`, `FinishRun`, `ReapLostRuns`, `PruneRunEvents`, `AuthenticateRunner`, `routes/runner.php`, Drosseln, Jobs und Scheduler.
- [ ] Commit.

### 4. Verwaltung
- [ ] Tests: `RunnerAdminTest`, `AgentConfigTest`, `CancelRetryTest`, Zeilen der Rechte-Matrix.
- [ ] `ListRunners`, `GetRunner`, `UpdateRunner`, `RevokeRunner`, `ListRuns`, `GetRun`, `ListRunEvents`, `CancelRun`, `RetryRun`, `GetAgentConfig`, `SaveAgentConfig`.
- [ ] Commit.

### 5. REST, OpenAPI, MCP, Doku
- [ ] Controller, Resources, `AgentSchemas`, Routen-Matrix, `tests/Feature/Api/AgentsApiTest.php`, MCP-Tools und Zeilen, `api.md`/`mcp.md` beider Sprachen, Budget messen.
- [ ] Commit.

### 6. Abschluss
- [ ] CLAUDE.md (Architektur „Runner und Aufträge“, Fallstricke, Kommandos), Rulings, volle Prüfung (Pest mit 100 %, Larastan, Pint, OpenAPI/Docs), Protokoll mit `curl` gegen DDEV, Nachweis.
