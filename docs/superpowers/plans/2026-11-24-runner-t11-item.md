# Runner-Plan Task 11: Aufträge und Pull Requests am Item (WEBU-28)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: erst der Test, dann der Code.

**Goal:** Am Item sieht man, was Agenten daran tun, und greift ein: jeder Auftrag ist eine Zeile der Aktivität (Typ, Agent, Modell und Herkunft, Runner, Dauer, Status mit Grund bei `waiting`, Ergebnis), aufgeklappt das Protokoll, das während des Laufs live wächst; „Abbrechen“, „Erneut starten“, „Wieder <Bot> zuweisen“ und „Weitermachen“ (nach dem Trennen von GitHub). Unter dem Titel der Chip „<Bot> arbeitet“ und die Hinweise (Bremse, gescheitert, Runner offline, kein Runner mit dem CLI, eigenmächtiger Merge, Bot ohne Agent). Neben den Relationen der Abschnitt „Pull Requests“ mit Zustand, Checks und Urteil des Reviews. Port des freigegebenen Klickdummys (WEBU-18: `features/item-detail/{RunLine,AgentNotice,PullRequests,runFocus}.tsx`, `Activity.tsx` mit Filter „Aufträge“).

**Architecture:** Lesen über vorhandene REST-Routen (`GET /runs?filter[work_item_id]=`, `GET /runs/{run}/events`, `include=links` am Item) und zwei Ergänzungen am Server: `include=agent` am Item (Strang, Grund, warum der Bot der Zuweisung kein Agent ist, Bremsen, Repo, Wächter) und `filter[after]` am Protokoll (nur neue Zeilen). Das Protokoll wächst live über eine gedrosselte Nachricht `agent_run.log` auf dem Kanal des Items (`private-work-item.{id}`, höchstens eine je Auftrag und Sekunde, die letzte kommt nach). „Weitermachen“ ist eine neue Action `ResumeThread` (`POST /work-items/{item}/agent/resume`, MCP `manage-agents:resume-thread`). Im Browser: `api/runs.ts`, `hooks/runs.ts` (Keys unter `qk.runs`), Komponenten in `features/item-detail/agents/`.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 6.4, 7.2, 7.5, 10.6, 11.3. Rulings ab A640.

## Grenzen

- Nicht hier: Einstellungen der Agenten (WEBU-32 in `features/settings/…`), große Doku (WEBU-29). Gemeinsame Dateien (`api/agents.ts`, `hooks/keys.ts`, `lang/*.json`, `types.ts`) nur ergänzen.
- Kein Chip in Listen und Board: Klickdummy und Spec 10.6 zeigen „Agent arbeitet“ nur am Kopf des Items.
- Kein Link „Aus einem Auftrag“ an Kommentaren der Bots: Kommentare tragen keine Auftrags-ID (der Klickdummy hat sie).

## Dateien

- Backend: `app/Actions/WorkItems/GetWorkItem.php` (`agent`), `app/Support/ItemAgentState.php`, `app/Http/Resources/WorkItemResource.php`, `App\OpenApi\WorkItemSchemas` (Einbettung `agent`), `app/Actions/AgentRuns/ListRunEvents.php` (`after`), `app/Actions/AgentRuns/RecordRunEvents.php` → `app/Live/RunLog.php` + Job `SendRunLog`, `app/Live/LiveMessage.php` (`runLog`), `app/Actions/Agents/ResumeThread.php`, `routes/api.php`, Controller, MCP `ManageAgentsTool`, `AgentRunResource` (`runner_last_seen_at`), Matrix, Docs-Tabellen (`api.md`, `mcp.md`), Tests.
- Browser: `types.ts`, `api/runs.ts`, `api/workItems.ts` (`include=links,agent`), `hooks/runs.ts`, `hooks/live.ts` (`agent_run.log`, `agent_run.*` lädt das Item), `features/item-detail/agents/{RunLine,RunLog,AgentNotice,PullRequests,runFocus,runParts}.tsx`, `features/item-detail/activity/Activity.tsx` (Filter „Aufträge“), `ItemBody.tsx`.
- `lang/{en,de}.json`, `vitest.config.ts`, `e2e/a11y-pages.ts`, `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs`, `e2e/helpers.ts` (falscher Runner), `e2e/tests/item-runs.spec.ts`, `database/seeders/E2eSeeder.php`.
- Doku knapp: `docs/{en,de}/bots.md` (Abschnitt „Am Item“), `CLAUDE.md`, Rulings.

## Tasks

- [x] **1 Server: Zustand des Agenten am Item** (`include=agent`): Strang (offen oder pausiert, mit Grund, Zählern, PR), Grund, warum der zugewiesene Bot hier kein Agent ist (`AgentFlow::refusal`), Bremsen des Projekts, Repo ja/nein, Wächter (Branch, SHA, ob er von diesem Item kam). OpenAPI, Vertrag, MCP `work-items:get`.
- [x] **2 Server: Protokoll ab einer Zeile** (`filter[after]`) und live (`agent_run.log` gedrosselt auf dem Kanal des Items); `runner_last_seen_at` am Auftrag.
- [x] **3 Server: Weitermachen** (`ResumeThread`, Route, Matrix, OpenAPI, MCP, Doku-Tabellen).
- [x] **4 Daten im Browser:** Typen, `api/runs.ts`, Hooks (`useItemRuns`, `useRunLog` hängt neue Zeilen an, `useRetryRun`, `useResumeThread`), Live.
- [x] **5 Aufträge in der Aktivität:** `RunLine` mit Protokoll (`role="log"`), Abbrechen mit Rückfrage, Erneut starten, Wieder zuweisen; Filter „Aufträge“; Fokus nach Aktionen (`runFocus`).
- [x] **6 Unter dem Titel:** Chip „<Bot> arbeitet“ (zeigt den Auftrag), Hinweise (Bremse, keine Änderung, gescheitert/abgebrochen, wartet auf Runner, kein CLI, Wächter, GitHub getrennt mit „Weitermachen“, Bot ohne Agent mit Weg zur Einrichtung).
- [x] **7 Pull Requests:** Abschnitt mit Zustand, CI, Checks, Urteil, Autor, Branches, „schließt beim Merge“; Hinweis ohne PR in Projekten mit Repo.
- [x] **8 Tastatur, axe, e2e:** Zustände in `A11Y_PAGES`, Abläufe in FLOWS mit Tests ohne Maus; `item-runs.spec.ts` mit falschem Runner über `/api/runner/*` (claim, events, heartbeat mit `cancel`, result; Abbrechen und Erneut starten nur mit der Tastatur).
- [x] **9 Doku, CLAUDE.md, Rulings, Proof.**

## Review PR #77 (CHANGES_REQUESTED)

- [x] Live: `agent_run.queued|started|finished|canceled` mit `item_id` laden die Details der Items; `work_item.checks_changed` (A648) über `work_item.*`
- [x] `ResumeThread`: Archiv und `AgentFlow::refusal` unter der Sperre, 409 mit dem Code (A647); `default_bot`, `disabled` eigene Codes
- [x] Protokoll ohne `aria-live`, Status „:count neue Zeilen“ höchstens alle 5 s
- [x] `comments.run_id`, Link „Ergebnis eines Auftrags“ (A643)
- [x] „Weitermachen“ wartet 4 s (A645); `github` mit Person: erst zuweisen
- [x] Log fragt nach dem Löschen nichts; Protokoll klappt beim Start auf; `useItemRuns` nur mit `agent.runs` > 0
- [x] e2e „Weitermachen“, a11y `item with agent stopped by GitHub`; Summary von `manage-agents:resume-thread` kürzer
