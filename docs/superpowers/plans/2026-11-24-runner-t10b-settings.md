# Runner-Plan Task 10, Teil 2: Arbeitsregeln, Vorgehen je Typ, Modelle, Projekt → Agenten (WEBU-32)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: erst der Test, dann der Code.

**Goal:** Die Oberfläche der Einstellungen, deren Daten WEBU-26 anlegt, nach dem freigegebenen Klickdummy (WEBU-18): Organisation → Agenten (Arbeitsregeln je Auftragstyp mit Vertrag und „So entsteht der Prompt“), „Vorgehen für Agenten“ im Typ-Dialog, „Modell für Agenten“ im Label-Dialog, Projekt → Agenten vollständig (Merge-Methode, Review-Agent, PRs von Personen, Kommentar am PR, Worktree-Befehle, Bremsen, Modelle je Auftragstyp mit den Modell-Labels, Projekttext) und am Bot → Agent die Modelle je Auftragstyp und die Projekte des Agenten.

**Architecture:** `api/agents.ts` bekommt `listAgentRules`, `saveAgentRule`, `getProjectAgents`, `saveProjectAgents`; `hooks/agents.ts` die Hooks mit den Keys `qk.agentRules`, `qk.projectAgents`; Live lädt `agent_rules.updated` und `project.agent_settings_updated`. Gemeinsame Teile unter `features/settings/agents/` (`RulesEditor`, `ModelField`/`ModelChoice`, `SaveBar`, `runTypes.ts` mit Namen und Hinweisen je Auftragstyp). Der Abschnitt `agents` der Organisation steht in „Betrieb“ (Recht `org.manage_catalog`, Mitglieder lesen), wie im Klickdummy. Projekt → Agenten wird ein Formular mit einer Leiste zum Speichern: Repo und Einstellungen gehen in zwei Aufrufen, nur was sich änderte.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 7.3, 7.7, 10.3–10.5. Rulings ab A620.

## Backend-Ergänzungen (klein)

- `AgentRuleResource` nennt `standard_body` (der Standard in der Sprache der Organisation): „Standard wiederherstellen“ zeigt ihn vor dem Speichern, und der Browser vergleicht ohne eigene Kopie (A620).
- `AgentProjectSettingsResource` nennt `bots`: die Bots, die im Projekt Review-Agent sein könnten (Mitglieder, ohne Standard-Bot, aktiv, dazu der gespeicherte Review-Agent), je `{bot_id, enabled, reviews, cli, model, models}`. Projekt-Admins sind nicht immer Org-Admins und lesen `GET /bots/{bot}/agent` nicht; der Review-Agent und „Wie beim Bot (sonnet)“ brauchen es (A621).
- OpenAPI (`AgentSchemas`), Body-Echos `readOnly`; MCP bleibt im Budget (readOnly fällt in `tools/list` weg).

## Tasks

- [ ] **1 Backend:** Tests in `AgentRulesTest`/`ProjectAgentsTest` (Vertrag), Resources, Schemas.
- [ ] **2 Daten:** Typen (`AgentRule`, `ProjectAgents`, `Label.agent_model`, `WorkItemType.agent_guidance`, `Project.members`), API mit `mockApi`, Hooks, Keys, Live.
- [ ] **3 Regeln:** `domain/agents.ts` (`RUN_TYPES`, `modelOf`/`modelValue` für `cli:model`, `isModelLabel`, `botModelText`), Tests.
- [ ] **4 Organisation → Agenten:** `org/agents/AgentRules.tsx` mit `PromptOrder`, `RulesEditor` (Reiter je Typ, Punkt für eigenen Text, Vertrag aufklappbar, Standard wiederherstellen mit Rückgängig), Speichern je geändertem Typ, `LeaveGuard`, Lesen für Mitglieder.
- [ ] **5 Kataloge:** „Vorgehen für Agenten“ im Typ-Dialog (fehlend bleibt, leer leert), „Modell für Agenten“ im Label-Dialog mit Namensvorschlag und Badge in der Liste.
- [ ] **6 Projekt → Agenten:** ein Formular, Leiste zum Speichern (klebend bei Änderungen), Repository samt Merge-Methode, Review-Agent, Schaltern; Worktree; Schritte (lesend); Bremsen; Modelle mit Modell-Labels; Projekttext.
- [ ] **7 Bot → Agent:** Modelle je Auftragstyp („Wie Standard (…)“), Karte „Projekte“ mit Grund je Projekt.
- [ ] **8 Tastatur und axe:** `A11Y_PAGES` (Abschnitt `agents` der Organisation, Typ- und Label-Dialog mit Feld, Projekt-Agenten), FLOWS und e2e ohne Maus.
- [ ] **9 Doku (knapp), CLAUDE.md, Rulings, Proof.**
