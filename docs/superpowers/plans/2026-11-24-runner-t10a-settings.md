# Runner-Plan Task 10, Teil 1: Einstellungen von Runner, GitHub, Agenten-Schritten und Bots (WEBU-27)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: erst der Test, dann der Code.

**Goal:** Die Oberfläche der Backends, die schon stehen (WEBU-20, WEBU-24, WEBU-25), nach dem freigegebenen Klickdummy (WEBU-18): Organisation → Betrieb → Runner und GitHub, der Abschnitt „Agenten“ im Workflow-Editor, Bot → Agent und Projekt → Agenten (Repo, Schritte lesend, Wächter gegen eigenmächtige Merges). Die schlichte Blade-Seite `/github` geht.

**Architecture:** API-Module `api/runners.ts`, `api/agents.ts`, `api/github.ts` mit Hooks in `hooks/runners.ts`, `hooks/agents.ts`, `hooks/github.ts` (Keys `qk.runners`, `qk.pairings`, `qk.agentConfigs`, `qk.runs`, `qk.github`, `qk.repository`). Bildschirme als Port des Klickdummys: `features/settings/org/runners/`, `features/settings/org/github/`, `features/settings/org/bots/` (Bot → Agent als Ansicht `?agent=<id>` des Abschnitts Bots, wie das Protokoll eines Webhooks), `features/settings/org/workflows/AgentSteps.tsx`, `features/settings/project/Agents.tsx`; reine Regeln der Schritte in `domain/agentSteps.ts` (Port von `prototypes/clickdummy/src/domain/agents.ts`, gleiche Kategorien wie `App\Domain\Workflow\AgentStep`). Der Manifest-Flow postet aus dem Browser ein Formular an GitHub; die Rückwege `/github/manifest` und `/github/setup` führen auf `/settings/github`, `/github/install` auf die Installation mit `state`.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 6.2, 7.4, 8.4, 8.6, 8.8, 10.1–10.4, 11.3. Rulings ab A580.

## Grenzen

- Nicht hier (WEBU-32 nach WEBU-26): Arbeitsregeln je Auftragstyp, Vertrag, Modelle je Auftragstyp und am Label, Merge-Methode, Review-Agent, Bremsen, Projekttext, Worktree-Befehle, die Liste „Projekte“ des Agenten, „noch nicht eingerichtet“ je Projekt. Bot → Agent zeigt das Standard-Modell (der `PUT` verlangt es) und schickt die Modelle je Auftragstyp unverändert zurück.
- Kein Backend von WEBU-26 (`app/Agents`, `app/Actions/Agents`, `app/Actions/AgentRuns`) anfassen.
- Online/offline eines Runners ist eine Frage der Zeit (letzter Kontakt vor höchstens einer Minute), kein Event: die Liste lädt sich, solange sie offen ist, alle 15 s neu, der Pairing-Dialog fragt den Code alle 2 s (A580).

## Dateien

- `resources/js/types.ts`: `Runner`, `RunnerPairing`, `AgentConfig`, `AgentRun` (schlank), `GitHubStatus`, `ProjectRepository`, `Workflow.agent_states`.
- `api/{runners,agents,github}.ts`, `hooks/{runners,agents,github}.ts`, `hooks/keys.ts`, `hooks/live.ts` (`agent_run.*`, `project.repository_changed`, `project.merge_guard_*` laden Runner und Repo).
- `domain/agentSteps.ts` (+ Test).
- `features/settings/org/sections.ts` (`runners`, `github` in „Betrieb“ vor System), `OrgSettings.tsx`, `org/runners/*`, `org/github/*`, `org/Bots.tsx` (Zeile „Agent“, Link „Agent einrichten“), `org/bots/BotAgent.tsx`.
- `features/settings/org/workflows/{draft.ts,WorkflowEditor.tsx,AgentSteps.tsx}`, `features/settings/project/{ProjectSettings.tsx,Agents.tsx,Workflow.tsx}`, `features/settings/catalog/StateMappingDialog.tsx` (`aside` mit den Schritten nach dem Wechsel).
- `features/inbox/NotificationRow.tsx` (Link auf `…/settings/agents`), `App\Mail\NotificationDigest` (`projectUrl` auf `…/settings/agents`).
- Backend: `routes/web.php`, `GitHubPageController` (Redirects, `install`), Blade `github.blade.php` weg, `lang/*.json` `github.page.*` weg, Tests.
- `lang/{en,de}.json`, `vitest.config.ts` (Schwellen der neuen Ordner), `e2e/a11y-pages.ts`, `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs` (FLOWS), e2e-Specs `runners.spec.ts`, `github.spec.ts`, `agents.spec.ts`.
- Doku `docs/{en,de}/runner.md` (knapp: verbinden, Plätze, widerrufen), `docs/{en,de}/github.md` (knapp: verbinden, Repos, Wächter), Seitenleiste.

## Tasks

- [ ] **1 Daten:** Typen, API-Module (Tests mit `mockApi`), Hooks, Keys, Live-Zuordnung.
- [ ] **2 Regeln der Schritte:** `domain/agentSteps.ts` mit `STEP_CATEGORIES`, `suggestSteps`, `missingSteps`, `boundStateErrors`, `stepsComplete`; Tests der Fälle des Klickdummys.
- [ ] **3 Runner:** Abschnitt mit Karten (online/offline, System, Version, Plätze, Auslastung, CLIs, Ausstattung, Aufträge mit „Abbrechen“), „Runner verbinden“ (Code, Befehl, Ablauf, „Neuer Code“, wartet und sagt „verbunden“), Plätze, Umbenennen, Widerrufen; leere Liste; Fokus nach Widerrufen/Abbrechen.
- [ ] **4 GitHub:** Verbinden (Organisation optional, Formular an GitHub), Zustand der App, Installationen, Repos mit Projekt und Ruleset, „Repos bei GitHub ändern“, „Neu einlesen“, Trennen mit Rückfrage; Rückwege, Blade weg.
- [ ] **5 Bots:** Zeile „Agent“ und Link je Bot; Bot → Agent (an/aus, Runner-Pool, CLI mit Verfügbarkeit je Runner, Standard-Modell), „kann kein Agent sein“.
- [ ] **6 Workflow-Editor:** Abschnitt „Agenten“ (vier Schritte, Vorschlag übernehmen, Hinweis bei entferntem Status, Fehler am Status mit Schritt), `agent_states` im Speichern; Workflow-Wechsel im Projekt sagt, was aus den Schritten wird.
- [ ] **7 Projekt → Agenten:** Repo und Basis-Branch, GitHub nicht verbunden, Schritte lesend mit Link, Banner „Eigenmächtiger Merge erkannt“ mit „Bestätigen und fortsetzen“ (nur Projekt-Admins); Link der Benachrichtigung.
- [ ] **8 Tastatur und axe:** `A11Y_PAGES` je Abschnitt und Dialog, FLOWS und Tests ohne Maus.
- [ ] **9 Doku, CLAUDE.md, Rulings, Proof.**
