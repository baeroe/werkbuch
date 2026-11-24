# Runner, Task 9: Ablauf der Agenten (WEBU-26) — Ticket-Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Schritte mit `- [ ]`, TDD je Schritt.

**Goal:** werkbuch führt die Arbeit eines Agenten an einem Item als Zustandsmaschine (Spec 7): Auslöser aus Item-Events und GitHub-Webhooks, Aufträge `task`, `correction`, `conflict`, `review`, `comment` mit Prompts aus Schichten und Modell nach Label → Projekt → Bot → Standard, CI je Head-Commit, Review, Merge durch werkbuch, Bremsen, Eingriffe von Personen, Epics nach Regel A.

**Architecture:** Ein neuer Event-Konsument `App\Agents\AgentConsumer` (Queue `default`) hört die Item-Events (`bot.assigned`, `bot.mentioned` aus Kommentaren, `work_item.assigned`, `work_item.state_changed`) und die eigenen (`agent_run.started`, `agent_run.finished`, `project.merge_guard_confirmed`) und ruft in seiner Claim-Transaktion nur Actions, die die Datenbank schreiben; alles, was GitHub fragt oder ändert (mergen, Review schreiben, bereit stellen, Mergebarkeit prüfen), läuft als Job nach dem Commit, der wiederum Actions ruft. Die GitHub-Seite hängt sich an `HandleGitHubDelivery` (Outcome `agent` von `SyncPullRequest`, `check_run`, `check_suite`, `push`). Reine Regeln in `App\Domain\Agents` (`Contract`, `RunPrompt`, `ModelChoice`, `Brakes`, `AgentModel`). Statuswechsel und Zuweisungen des Ablaufs nur mit `Actor::agent($bot)`; Events mit diesem Actor lösen nie etwas aus.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 7, 9, 10 (nur Daten), 11, 12, 14; Plan `2026-11-23-runner.md` Task 9.

## Global Constraints

- Alle Regeln aus `CLAUDE.md` (Actions/Domain, Events nur in Transaktionen, Sichtbarkeit, Rechte- und Routen-Matrix, OpenAPI-Vertrag, MCP-Parität und Budget, 100 % Zeilen, Doku beider Sprachen).
- Kein HTTP unter einer Sperre und nie in der Claim-Transaktion eines Konsumenten; Jobs `afterCommit`, nur IDs.
- Sperren: Organisation geteilt → Projekt geteilt → Item(s) nach ID → offene Aufträge des Strangs → Strang (`AgentFlow::lockStrand`, A592; wie `FinishRun`/`ClaimRun`, die Auftrag → Strang sperren: die Kreuzung wartet immer am Auftrag).
- Keine Oberfläche (`resources/js` bleibt; WEBU-27/32). Daten, REST und MCP vollständig.

## Datenmodell (Migration `2026_11_24_000400_create_agent_flow_tables`)

- `agent_rules` (`type` eindeutig, `body`, `updated_by`): nur abweichende Texte; ohne Zeile gilt der mitgelieferte Standard in der Sprache der Organisation. Ein Text, der einem Standard (en oder de) gleicht, wird nicht gespeichert: so erreicht ein neuer Standard genau die unveränderten Texte.
- `agent_project_settings` (je Projekt): `review_bot_id`, `instructions`, `models` (Typ → `cli:model`), `max_corrections` (3), `max_conflicts` (2), `review_person_prs` (an), `comment_on_pr` (an), `merge_method` (`squash`), `setup_command`, `teardown_command`. Ohne Zeile die Standards.
- `work_item_types.agent_guidance`, `labels.agent_model` (`cli:model`).
- `agent_threads`: `head_sha`, `pr_draft`, `review_sha`, `review_verdict`, `merge_sha` (Merge für diesen Head entschieden), `awaiting_pr_since`, `ready_requested_at`.
- `agent_runs`: `repository_github_id`, `pr_number` (Review eines PRs).
- `work_item_links.head_seen_at` (seit wann der Head-Commit steht: „ohne Checks nach zwei Minuten grün“).

## Schnittstellen (Produces)

- `App\Domain\Agents\ModelChoice::choose(AgentCli, RunType, list<{id, model}> $labels, list<…> $epicLabels, array $project, array $bot, string $botDefault): array{model, source, label_id}` (rein; der Plan nannte `for(AgentRun)`, Domain kennt keine Modelle, Ruling).
- `App\Domain\Agents\RunPrompt::build(RunType, string $contract, string $rules, ?string $guidance, ?string $project, string $job): array{system_prompt, prompt}`.
- `App\Domain\Agents\Contract::for(RunType)` (fest, englisch, REST liefert ihn mit den Regeln).
- REST: `GET /agent-rules`, `PUT /agent-rules/{kind}`, `GET|PUT /projects/{project}/agents`; MCP `agents:list-rules`, `agents:get-project-agents`, `manage-agents:save-rule`, `manage-agents:save-project-agents`; `agent_model` am Label, `agent_guidance` am Typ (REST und `manage-organization`).
- Claim: `system_prompt`, `prompt`, `setup_command`, `teardown_command`, Modell mit Herkunft und `model_label_id`.

## Tasks

- [ ] 1. Migration, Modelle, Factories (`AgentRule`, `AgentProjectSettings`), Felder an Label, Typ, Strang, Auftrag, Verknüpfung.
- [ ] 2. Domain: `Contract` (ganz: Verbote, Ausgabeformat, Schwelle), `RunPrompt`, `ModelChoice`, `Brakes`, `AgentModel`; Standards `resources/agents/rules/{en,de}/{task,correction,conflict,review,comment}.md`. Unit-Tests.
- [ ] 3. `App\Support\AgentRules` (Text je Typ), `RunModels` (Stufen aus Item, Epic, Projekt, Bot), `RunPrompts` (Schichten und Auftrag je Typ). `EnqueueRun` nimmt `RunModels`, `ClaimRun` die Prompts und die Befehle des Projekts.
- [ ] 4. Regeln und Projekt-Einstellungen: Actions, REST, Schemas, MCP, Matrix, Doku-Tabellen. Katalogfelder in `SaveLabel`/`SaveWorkItemType`, Resources, `CatalogSchemas` (Budget `manage-organization`).
- [ ] 5. Ablauf: `AgentConsumer`, `FollowEvent`, `StartTask` (Epic, Anhängen, Fortsetzen), `StartCorrection`, `StartConflict`, `StartReview`, `StartComment`, `PauseThread`, `HandleRunResult`, `ResumeAfterGuard`; Hilfen `AgentFlow` (Eignung, Status, Zuweisung, Kommentar).
- [ ] 6. GitHub: `GitHubApi` (PR lesen, mergen, Review, bereit stellen, Branch löschen), Jobs (`MergeAgentPullRequest`, `PostReviewVerdict`, `MarkPullRequestReady`, `CheckMergeability`), Actions `HandleAgentPullRequest`, `HandleCheckResult`, `HandleMergeability`, `ApproveAndMerge`, `MergeThread`; `HandleGitHubDelivery` (Outcome `agent`, `check_run`, `check_suite`, `push`); Schalter `comment_on_pr` in `SyncPullRequest`.
- [ ] 7. `SweepAgentThreads` (jede Minute): Strang ohne PR zwei Minuten nach einem erfolgreichen `task` scheitert; PR ohne jeden Check zwei Minuten nach dem Push gilt als grün.
- [ ] 8. Abnahme ohne Rafael: `tests/Feature/Agents/AgentFlowTest.php` (falscher Runner über `/api/runner/*`, `FakeGitHub` mit aufgezeichneten Zustellungen): Durchlauf aus Spec 14, Konflikt, Epic mit zwei Kindern (eins einer Person), Frage per Erwähnung, Bremsen, PR einer Person, Nachholen nach dem Bestätigen; `tests/Integration/MergeDecisionRaceTest.php` (zwei Verbindungen entscheiden den Merge, einer zählt).
- [ ] 9. Doku (`docs/{en,de}/api.md`, `mcp.md`), Rulings ab A560, `CLAUDE.md` (Abschnitt „Ablauf der Agenten“, Stand).

## Tests (Namen verbindlich, Auszug aus dem Epic-Plan)

- `it runs an item from assignment through a red CI, a correction, a green CI and a review to the merge` (Spec 14)
- `it cancels a review when a push comes and an approve frees only its own commit`
- `it pauses the strand at the brake without ending it and the owner gets the item`
- `it continues a paused strand when a person assigns the bot again`
- `it starts nothing for a comment of a bot or a change with the actor agent`
- `it runs a conflict before the review`
- `it works an epic by rule A and leaves the child of a person to her`
- `it reviews the PR of a person, approves it on GitHub and neither corrects nor merges`
- `it chooses the model label before the project before the bot, the label of the epic for a child, the first label in catalog order`
- `it skips a stage whose model the CLI does not know`
- `it starts nothing without the agent steps of the workflow`
- `it reaches only unchanged texts with a new standard of the rules`
- `it reviews with the bot of the strand without a review agent and leaves PRs of persons then`
- `it answers a question by mention as a comment of the bot`
- `it picks up the work the guard held back once a project admin confirms`
- `it merges a thread once when two decide at the same time` (zwei Verbindungen)
