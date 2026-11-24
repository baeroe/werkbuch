# Runner-Plan Task 8: PR-Verknüpfung für alle PRs (WEBU-25)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: erst der Test, dann der Code.

**Goal:** Jeder Workflow kennt seine Agenten-Schritte (In Arbeit, In Review, Korrektur, Gemergt), PRs im Repo eines Projekts verknüpfen sich über feste Wörter, Keys und den Branch-Namen mit Items, Checks hängen an den Verknüpfungen, und PRs von Personen schalten den Status („In Review“ beim Öffnen bzw. bereit, „Gemergt“ beim Merge eines schließenden PRs ohne anderen offenen PR); die App schreibt einen Kommentar je PR, das Item bekommt Events, REST (`include=links`) und MCP lesen die Verknüpfungen.

**Architecture:** reine Regeln in `App\Domain\GitHub` (`LinkKeywords`, `KeywordHit`, `CiState`) und `App\Domain\Workflow\AgentStep`. Die Webhooks `pull_request` und `check_run` gehen aus `HandleGitHubDelivery` an `App\Actions\Links\SyncPullRequest` bzw. `SyncChecks`; HTTP nie unter einer Sperre: der Kommentar am PR läuft als Job nach dem Commit (`PostPullRequestComment` → `App\Actions\Links\PostLinkback`, je PR nacheinander über `WithoutOverlapping`). Agenten-PRs (die App hat sie geöffnet oder ihr Head-Branch ist der Branch eines Strangs) werden verknüpft, ihre Wirkung überlässt `SyncPullRequest` WEBU-26 (`App\Support\AgentPullRequests`).

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 7.2 (Übergangsprüfung, Kommentar), 7.4, 10.6 (Daten des Abschnitts „Pull Requests“), 12. Rulings ab A540.

## Grenzen

- Keine Oberfläche (WEBU-27 Workflow-Editor, WEBU-28 Abschnitt am Item). Der Workflow-Editor schickt `agent_states` nicht mit: ein fehlendes `agent_states` lässt die Schritte stehen.
- Kein Review, keine Korrektur, kein Merge durch werkbuch, keine Wirkung für Agenten-PRs (WEBU-26). `check_suite` bleibt `ignored` (das „grün ohne Checks nach zwei Minuten“ braucht WEBU-26).
- Der Schalter „Kommentar am PR“ je Projekt kommt mit den Agenten-Einstellungen des Projekts (WEBU-26); bis dahin immer an.
- Statuswechsel als `Actor::automation('pr_link')` (der Review-Agent des Projekts gibt es erst mit WEBU-26).

## Dateien

- Migration `2026_11_24_000200_add_agent_states_to_workflows` (`workflows.agent_states` JSON nullable), `2026_11_24_000300_create_work_item_links` (`work_item_links`, `work_item_link_checks`, `github_pull_request_comments`).
- Domain: `App\Domain\Workflow\AgentStep`, `App\Domain\GitHub\{LinkKeywords, KeywordHit, CiState}`.
- Models `WorkItemLink`, `WorkItemLinkCheck`, `GitHubPullRequestComment`; `Workflow::agentState()`, `agentStepsComplete()`; `WorkItem::links()`.
- `WorkflowInput` (`agent_states`), `SaveWorkflow` (Kategorie, `state_mapping`, Snapshot), `WorkflowResource`, `CatalogSchemas::workflow`.
- Actions `App\Actions\Links\{SyncPullRequest, SyncChecks, PostLinkback}`, Job `PostPullRequestComment`, `App\Support\AgentPullRequests`, `GitHubApi::{comment, updateComment}`, `HandleGitHubDelivery`.
- Events `work_item.link_added`, `work_item.link_merged` (ohne Webhook, live über `work_item.*`, Benachrichtigung `item_changed` mit Feld `pull_request`).
- `GetWorkItem::INCLUDES` + `links`, `WorkItemLinkResource`, `WorkItemSchemas::itemPatches`, MCP `work-items:get` (`include`).
- Tests: `tests/Unit/Domain/GitHub/{LinkKeywordsTest,CiStateTest}.php`, `tests/Unit/Domain/Workflow/AgentStepTest.php`, `tests/Feature/Workflows/AgentStatesTest.php`, `tests/Feature/GitHub/{PullRequestLinksTest,LinkChecksTest,LinkbackTest,PullRequestFlowTest}.php`, `FakeGitHub::pullRequest()`/`checkRun()`, Matrix-Zeilen.

## Tasks

- [ ] **1 Agenten-Schritte am Workflow:** Spalte, `AgentStep` (Kategorien: In Arbeit und In Review Started, Korrektur Backlog/Unstarted, Gemergt Completed), `WorkflowInput` liest `agent_states` (Schritt → Schlüssel eines Status der Eingabe oder `null`, fehlend = wie gespeichert), `SaveWorkflow`: 422 `agent_states.<step>` (unbekannt, falsche Kategorie), ein gespeicherter Schritt auf einem Status, der bleibt und seine Kategorie wechselt, 422 am Status; ein entfernter Status folgt `state_mapping`, wenn das Ziel passt, sonst leer; Event mit `changes.agent_states`. Resource, Schema, MCP-Budget.
- [ ] **2 Wörter:** `LinkKeywords::parse($title, $body, $branch, $identifiers)` mit Tabelle aus Spec 12; Tests aller Formen, Groß/klein, Doppelpunkt, Komma/`and`, Code-Blöcke (Zaun, Inline, HTML-Kommentar), fremde und frühere Kennung, Branch, `skip` gewinnt.
- [ ] **3 Datenmodell:** Migration, Models, Factories.
- [ ] **4 SyncPullRequest:** Repo → Projekt, Keys → Items, Verknüpfungen anlegen/aktualisieren/löschen (`skip`), Events, Agenten-PR erkennen, Status-Regeln (Entwurf nichts, aktiv → In Review aus Backlog/Unstarted, Merge in den Basis-Branch → Gemergt nur mit `closes` und ohne anderen offenen PR, Übergangsprüfung mit Kommentar, ohne Schritte nur verknüpfen), Linkback-Job nach dem Commit.
- [ ] **5 SyncChecks:** `check_run` je Verknüpfung mit dem Head-Commit, alte Commits fallen weg, `CiState`.
- [ ] **6 PostLinkback:** ein Kommentar je PR (anlegen, dann aktualisieren, nur bei geändertem Text), Sprache der Organisation, Keys mit Link, „schließt beim Merge“; Fehler von GitHub wiederholt der Job.
- [ ] **7 Lesen:** `include=links` samt Checks und `ci`, OpenAPI, MCP.
- [ ] **8 Abnahme:** Folge aufgezeichneter Webhooks eines Personen-PR (`opened` als Entwurf, `ready_for_review`, `closed` gemergt) mit `Fixes WEBU-n` gegen das falsche GitHub, zweiter offener PR, `skip`, Code-Block.
- [ ] **9 Matrix, Doku (`api.md`, `mcp.md`, `concepts/workflows.md`), CLAUDE.md, Rulings, Proof.**
