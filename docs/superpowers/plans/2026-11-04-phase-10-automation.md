# Phase 10: Vorlagen, Zeitpläne, Automatisierungen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jedes Projekt bekommt Vorlagen (Spec 4.12): Name, Typ, Titel mit Platzhaltern, Beschreibung mit Bildern, Felder und Property-Werte, Start und Due relativ zum Anlegen; von Hand im Anlegen-Dialog und über „Vorlage anwenden …“ in der Palette, und optional mit Zeitplan (täglich, wöchentlich, monatlich mit Tag, „letzter“ oder n-tem Wochentag, jährlich; Uhrzeit in der Zeitzone der Organisation; Ende nie, Datum oder nach N Läufen; Pause; nächste 5 Termine). Ein Scheduler legt fällige Items jede Minute als Standard-Bot an, protokolliert jeden Termin genau einmal, holt nach einem Ausfall genau den letzten verpassten Termin nach und meldet einen ungültigen Lauf an Lead und Ersteller (`template.run_failed`, Inbox `template_run_failed`). Dazu die vier Automatisierungen je Projekt (Spec 4.13: Auto-Archiv, Auto-Close, Eltern schließen, Assignee beim Start), alle anfangs aus, alle als Standard-Bot mit Grund in der History und mit Übergangsprüfung. Abnahme: Erfolgskriterium 3 und Flow 6.

**Architecture:** Reine Regeln ohne Laravel in `app/Domain/Schedule/` (Port von `recurrence.ts`, `placeholders.ts` und den Zonen-Regeln aus `tz.ts`: Termine auf dem Kalender der Organisation, dann je Tag die Wanduhrzeit; Lücke der Sommerzeit nach vorn, doppelte Stunde die erste) und `app/Domain/Automations/` (Schlüssel und Standards, „Eltern schließen“, „Assignee beim Start“, die Nachtstunde). Drei Tabellen `templates` (Payload als JSON, Zeitplan als JSON, dazu `next_run_at` als Index, `last_run_at`, `run_count`, `schedule_from`), `template_runs` (eindeutig `(template_id, scheduled_for)`, `scheduled_for` leer bei manuellen Läufen) und `automations` (eindeutig `(project_id, key)`), dazu `work_items.template_id`. Actions in `app/Actions/Templates/` und `app/Actions/Automations/`; Termine, Platzhalter und Offsets rechnet **nur der Server** (Vorschau- und Entwurfs-Endpunkte, A335). Ein Lauf liest und kopiert die Bilder der Vorlage vor jeder Sperre, sperrt dann Organisation (geteilt) → Projekt → Vorlage, legt die Laufzeile an und das Item über `CreateWorkItem` (Savepoint) als `Actor::template($t)` an; scheitert das Anlegen, bleibt die Laufzeile `failed` mit `template.run_failed`. Die Automatisierungen eines Zugs hängen an `TransitionWorkItem::move` (in derselben Transaktion, A341), die täglichen laufen als stündlicher Job, der um 03:00 Org-Zeit handelt. Im Browser portiert `features/templates/` den Klickdummy (13b: Editor, Zeitplan und Liste geteilt), die Projekteinstellungen bekommen den Abschnitt `automations`.

**Tech Stack:** wie Phase 9; keine neuen Composer- oder npm-Pakete (siehe „Paketversionen“).

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterium 3; 2 „Nicht in v1: Vorlagen mit Unteraufgaben“; 4.3 Rechte „Items, Wiki und Vorlagen lesen“, „Vorlagen und Zeitpläne verwalten“ (Member), „Automatisierungen“ (Projekt-Admin); 4.4 archivierte Projekte; 4.8 zwei Ebenen; 4.12 komplett; 4.13 komplett; 4.14 „fehlgeschlagene Vorlage“; 4.16 Anhänge; 4.17 Palette; 5.2 Projektbereich „Vorlagen“, Projekteinstellungen; 6.1 „Projekte, … Automatisierungen“, „Vorlagen (auch ‚jetzt ausführen‘, Terminvorschau)“; 6.3 `template.run_failed`; 7.4 `templates`, `template_runs`, `automations`, `work_items.template_id`; „Änderungen vom 2026-10-29“ zu Vorlagen: Wochentage 0 = Sonntag, Wochenintervalle ab Montag, `{week}` und `{month}` zweistellig, ein Plan, der nach N Läufen endet, holt höchstens bis N nach), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus 2 und 4, Verträge „Actor“ (`Actor::template`), „Events und Outbox“, „Uhr“, „Queues“, Phase 10), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A30, A39, A61, A75, A106, A121, A136, A154, A215, A229–A239, A261, A267–A277, A279–A282, A289, A290, A298, A304, A324; „Für spätere Phasen vorgemerkt“, Zeile Phase 10 → Tasks 4, 6, 9, 10, 11, 15, 17, 18, 19), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{domain/{recurrence,placeholders,tz}.ts (+ Tests),api/{templates,automations}.ts,api/itemRules.ts (moveItem, assignOnStart, closeParent, MAX_PARENT_CHAIN 5),api/seed/{workspace,config,inbox,items}.ts,hooks/{templates,automations}.ts,features/templates/**,features/settings/project/{Automations.tsx,automationRules.ts},features/create-item/CreateItemDialog.tsx (applyTemplate),types.ts (Schedule, Template, TemplateRun, Automation),e2e/flows.spec.ts (Flow 6)}`, Aufräumliste `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (13b „Vorlagen-Editor teilen“; 13c „Wiederholschutz für ⌘⏎ im Vorlagen-Editor“, „Automatisierungen können doppelt speichern“, „template editors outside UploadOwnerContext“, „duplicate watchLostFocus“, „Auto-Close reason link“, „failed-template notifications bypass preferences“, „template-command refusal toasts for viewers without a next step“, „search stale after template runs“ → Tasks 15–19).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 10 entscheidend:

- Branch `feat/phase-10-templates` von `main` nach dem Merge von Phase 9. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Keine neuen Pakete; `pnpm-lock.yaml`, `composer.lock` und `e2e/pnpm-lock.yaml` bleiben unverändert.
- **Uhr und Zeitzone (Master-Vertrag „Uhr“, Review Focus 4):** Code liest die Zeit nur über `now()`; Domain-Klassen bekommen sie als `DateTimeImmutable` (kein Carbon in `app/Domain`, `ArchTest`). Termine rechnen immer auf dem Kalender der **Organisation** (`Organization::current()->timezone`), nie in UTC und nie fest Berlin; Monatsnamen in der **Sprache der Organisation** (Schlüssel `schedule.month.<name>`, A353). Tests stellen die Uhr mit `$this->travelTo()` (in UTC angeben) und prüfen Berlin, New York und Kolkata, 2026-10-25 und 2027-03-28.
- **Ein Termin, ein Item (Erfolgskriterium 3):** `template_runs` ist eindeutig `(template_id, scheduled_for)`; ein Lauf sperrt Organisation (geteilt, `CatalogLock::share()`) → Projekt (`MemberInput::lock`) → Vorlage (`lockForUpdate`) → Items, in dieser Reihenfolge, und rechnet den fälligen Termin unter der Vorlagensperre neu. Ein zweiter gleichzeitiger Lauf desselben Termins findet die Zeile und tut nichts; eine `UniqueConstraintViolationException` ist „schon erledigt“, nie ein 500.
- **Rich Text vor jeder Sperre:** Beschreibung und Rich-Text-Werte einer Vorlage liest `SaveTemplate` vor jeder Sperre (`RichTextInput::from` mit `RichTextRules::context`, Fallstrick aus Phase 4); Bilder einer Vorlage kopiert ein Lauf bzw. `CreateWorkItem` vor der Transaktion (A337).
- **Sichtbarkeit (Global Constraint):** Vorlagen, Läufe, Vorschau und Bilder einer Vorlage sieht, wer ihr Projekt sieht (`Visibility::projectIds`, nie in Löschung); `Template::scopeVisibleTo` baut nur darauf. Unsichtbares ist 404, nie 403.
- **Automatisierungen handeln als Standard-Bot** (`Actor::automation($reason)`, Grund-Codes `auto_archive`, `auto_close`, `close_parent`, `assign_on_start`), halten die erlaubten Übergänge ein (`TransitionWorkItem::move` mit `checkTransition: true`) und schreiben ihre Events wie jede Action; was eine Person auslöst, trägt `meta.on_behalf_of` (A342). Vorlagen handeln als `Actor::template($t)` (Standard-Bot, `via` `template`, Grund `template`).
- Fachlogik nur in `app/Actions` und `app/Domain`; Controller, Jobs, Commands und Konsumenten rechnen nicht und schreiben keine Modelle (`ArchTest`). **Jede Action steht genau einmal in der Rechte-Matrix** (`tests/Feature/Access/matrix.php`; System-Actions mit `system`), **jede Route unter `api/v1` genau einmal in der Routen-Matrix** (`tests/Feature/Api/routes.php`), beides im Commit, der sie anlegt. Neue Morph-Typen `template` und `automation` in die Morph-Map.
- **Jede schreibende Action schreibt ihr Event** in der Transaktion: neu `template.created|updated|deleted` und `automation.updated` (ohne Webhook, A346), `template.run_failed` (mit Webhook, steht schon in `EventType`). Ein erfolgreicher Lauf schreibt nur `work_item.created` (mit `meta.template`, A352).
- **Konsumenten idempotent (A39):** Benachrichtigungen schreiben `template_run_failed` über `insertOrIgnore` (`dedupe_key` `event:<id>`), Live sendet nur IDs, die Suche übergeht `template.*` und `automation.updated`.
- **Abfragezahlen fest:** Vorlagenliste, Laufprotokoll und Automatisierungen fragen für 5 und für 50 Einträge gleich oft (Tests in den Tasks 4, 7, 10); der Scheduler fragt je Lauf eine feste Zahl, nicht je Vorlage eine Liste.
- Die UI liest nur über `/api/v1`. `resources/js/api/templates.ts`, `api/automations.ts`, `hooks/templates.ts`, `hooks/automations.ts` exportieren die Namen und Signaturen des Klickdummys (`listTemplates`, `saveTemplate`, `deleteTemplate`, `runTemplateNow`, `listTemplateRuns`; `listAutomations`, `saveAutomation`; `useTemplates`, `useSaveTemplate`, `useDeleteTemplate`, `useRunTemplateNow`, `useTemplateRuns`, `useAutomations`, `useSaveAutomation`); Abweichungen nur nach den Rulings dieses Plans (A335: `previewSchedule`/`useSchedulePreview` und `templateDraft` statt `domain/recurrence.ts` und `domain/placeholders.ts` im Browser; A338: `TemplateRun.scheduled_for` nullable, `ran_at`, `triggered_by`; A349: `TemplatePayload.description` ist Markdown, der Editor liest `description_json`).
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`, unter `templates.*`, `schedule.*`, `automations.*`; Problem-Sätze unter `problem.detail.*` (`templates_members_only`, `automations_admins_only`), Feldmeldungen unter `field.*`; Schlüssel ohne Ziffern (Monate und Wochentage als Wörter: `schedule.month.january`, `schedule.weekday.monday`), Plural `.one`/`.other`.
- Kürzel nur über den Katalog (A7): neu `template.save` (mod+enter, Bereich `detail`, Gruppe `shortcuts.group.template`); in `SHARED` von `catalog.test.ts` als Paar mit `settings.save` und `wiki.save` (A324: nie auf demselben Bildschirm). Danach `ddev exec pnpm shortcuts:doc`.
- Abdeckung 100 % Zeilen PHP und Frontend; Vitest-Schwelle neu für `resources/js/features/templates/**` (100 % Zeilen) in `vitest.config.ts`.
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert (RED zuerst belegen).
- **e2e (Lehren aus Phase 8 und 9):** Daten einer Spec leben in eigenen Projekten `E2E <variant> <runId>`, `finally` räumt über `removeE2eProject` ab; der Server lässt sich in e2e nicht anhalten: fällige Läufe stellt eine Spec über `artisanEval` her (Zeilen der eigenen Vorlage in die Vergangenheit) und löst sie mit `artisan('app:run-templates', '--now')` bzw. `artisan('app:run-automations', '--now')` aus (beide fassen nur Fälliges an, auch anderer Specs; das geht nur mit `workers: 1`, wie `app:send-notification-mails`). Termine prüft e2e nur mit einem Zeitplan, der in der Zukunft beginnt (A351). Keine festen Wartezeiten; Tastaturwege über `tabTo`/`arrowTo`/`pressMod`.
- **Demo-Projekte bekommen Automatisierungen** (WEB: Auto-Archiv und Assignee beim Start, APP: Auto-Close und Eltern schließen, wie der Klickdummy): Specs, die Items in WEB oder APP bewegen, sehen jetzt deren Wirkung. Jede Task, die den `DemoSeeder` ändert, läuft die betroffenen Specs gezielt mit (Task 13 nennt sie).
- Demo- und Testdaten nur fiktiv (Feldwerk, `prototypes/clickdummy/src/api/seed/{workspace,config}.ts`, `@example.com`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Zeitzonen und Kalenderränder (Review Focus 4 des Master-Plans):** Ein Zeitplan „monatlich am 31.“ läuft am 30.04. und 28.02. (29.02.2028), „letzter“ am Monatsende; täglich 09:00 bleibt 09:00 Wanduhr über 2026-10-25 und 2027-03-28; 02:30 am Tag der Umstellung im Frühjahr läuft um 03:30, im Herbst einmal (die erste); ein Wechsel der Zeitzone der Organisation rechnet `next_run_at` neu und erzeugt **keinen** zusätzlichen Lauf für einen Termin des alten Kalenders (`schedule_from`, A339). → Tasks 1, 8.
- **Doppelt oder gar nicht (Erfolgskriterium 3):** Zwei Scheduler-Läufe gleichzeitig, ein manueller „Jetzt ausführen“ während eines geplanten Laufs und ein Job, der nach einem Absturz erneut läuft, ergeben je Termin genau ein Item; nach drei verpassten Terminen genau eines für den letzten, danach weiter mit dem nächsten künftigen; ein Zeitplan, der nach 3 Läufen endet und 5 verpasst hat, legt höchstens bis 3 an; Speichern, Fortsetzen nach Pause oder Wiederherstellen des Projekts erzeugt nie einen Lauf für einen Termin vor diesem Moment. → Tasks 7, 8 (`tests/Integration/TemplateRunRaceTest.php`).
- **Vorlage zur Laufzeit ungültig:** Assignee kein Mitglied mehr, Typ deaktiviert oder archiviert, neue Pflicht-Property ohne Wert, Eltern-Item gelöscht oder kein Epic: der Lauf scheitert mit lesbarem Grund in der Sprache der Organisation, das Protokoll hält ihn fest, Lead und Ersteller (nur aktive Personen mit Zugriff, gemäß ihren Einstellungen) bekommen `template_run_failed`, die Vorlage bleibt aktiv und läuft beim nächsten Termin wieder; gelöschte Labels und Werte von Properties, die der Typ nicht mehr hat, fallen still weg (A340). → Tasks 7, 9.
- **Eltern schließen gleichzeitig:** Schließen zwei Personen gleichzeitig die letzten beiden offenen Kinder eines Epics (eines Completed), geht das Epic genau einmal in den ersten erlaubten Completed-Status; ist kein Übergang erlaubt, bleibt es offen; Bots lösen „Assignee beim Start“ nie aus; die auslösende Person bekommt keine Benachrichtigung über die Folge ihrer eigenen Handlung (A342). → Task 11 (`tests/Integration/CloseParentRaceTest.php`).
- **Datenlecks und Rechte:** Vorlagen, Läufe, Entwürfe, Vorschau und Bilder einer Vorlage eines privaten Projekts erreichen niemanden ohne Zugriff (Palette „Vorlage anwenden …“ eingeschlossen); Viewer lesen Vorlagen und Protokoll, speichern, löschen und führen nicht aus (403 `templates_members_only`); Automatisierungen ändern nur Projekt-Admins (403 `automations_admins_only`); ein Item aus einer Vorlage besitzt **Kopien** der Bilder, Löschen der Vorlage nimmt ihm nichts. → Tasks 3–6, 10, 15, 18.

## Gates

Regel A249 (seit Phase 7):

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %` (enthält `tests/Integration`, braucht `meilisearch`); `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Gezielt `ddev artisan test --testsuite=Integration --filter=<Name>` in jeder Task mit Race-Test.
- **G2 (Frontend), je Task mit `resources/js`:** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt (bei VM-Last `--maxWorkers=3`).
- **G3 gezielt, je Task mit Frontend oder e2e:** gegen den normalen Build (`ddev exec pnpm build`, vorher `pnpm dev` beenden) `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <specs>` mit den Specs, die die Task nennt (alle vier Projekte, sofern die Task nichts anderes sagt). Nach PHP-Änderungen am Live-Konsumenten vorher `ddev restart`. **Kein voller Coverage-Lauf am Ende einzelner Tasks.**
- **G3 voll, genau einmal je Phase:** nach der letzten Task (Task 21), im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle vier Playwright-Projekte grün, `coverage:merge` meldet 100 % Zeilen über `resources/js/**`. Befunde gehen in die finale Fix-Welle. Während des Laufs keine anderen DDEV-Projekte starten oder stoppen.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/` oder `resources/js/shell/` anlegt oder ändert, bringt Playwright-Abläufe (nur Tastatur, wo es geht) und Vitest-Tests (Lade-, Fehler- und Randzustände mit `mockApi`) mit, die ihre neuen Zeilen decken; sie nennt die Specs für ihren gezielten G3.

---

## Datenmodell

Migration `database/migrations/2026_11_05_001300_create_templates_tables.php`:

| Tabelle | Spalten |
|---|---|
| `templates` | `id` ULID; `project_id` Fremdschlüssel `cascadeOnDelete`; `name` string(120); `payload` JSON (siehe unten); `schedule` JSON nullable (Normalform von `Schedule::toArray()`); `schedule_from` timestamp(6) nullable (seit wann der Zeitplan gilt, A339); `next_run_at` timestamp nullable; `last_run_at` timestamp nullable (der letzte **geplante** Termin, der lief); `run_count` unsigned int Standard 0 (geplante Läufe, `created` oder `failed`); `created_by` Fremdschlüssel auf `users` `restrictOnDelete`; `created_at`, `updated_at`. Indizes: (`next_run_at`), (`project_id`, `name`) |
| `template_runs` | `id` ULID; `template_id` Fremdschlüssel `cascadeOnDelete`; `scheduled_for` timestamp nullable (der Termin; `null` bei „Jetzt ausführen“, A338); `ran_at` timestamp(6); `status` string(16) `created`/`failed`; `work_item_id` Fremdschlüssel `nullOnDelete` nullable; `error` text nullable (Satz in der Sprache der Organisation); `triggered_by` Fremdschlüssel auf `users` `restrictOnDelete` nullable (wer „Jetzt ausführen“ drückte). Eindeutig (`template_id`, `scheduled_for`) (mehrere `null` erlaubt); Index (`template_id`, `ran_at`) |
| `automations` | `id` ULID; `project_id` Fremdschlüssel `cascadeOnDelete`; `key` string(32); `enabled` boolean Standard `false`; `settings` JSON; `created_at`, `updated_at`. Eindeutig (`project_id`, `key`) |
| `work_items` (ändern) | `template_id` ULID nullable, Fremdschlüssel auf `templates` `nullOnDelete`, Index |

- **Payload** (Normalform, `App\Support\TemplateInput::payload()`): `{type_id, title, description (Tiptap-JSON|null), priority, assignee_id|null, label_ids[], values {key: Wert, Rich Text als Tiptap-JSON}, parent_id|null, start_offset_days|null, due_offset_days|null}`; Offsets ganze Zahlen 0–3650, `due_offset_days ≥ start_offset_days`, wenn beide gesetzt.
- Modelle `App\Models\Template` (`HasUlids`, `HasFactory`, Morph-Map `template`; Casts `payload` `array`, `schedule` `array`, Stempel `immutable_datetime`; `project()`, `creator()`, `runs()` nach `ran_at` absteigend, `attachments()` (morphMany); Scope `visibleTo($user)`; `schedule(): ?Schedule` über `Schedule::read`; öffentlich, nie gespeichert, `?RichTextNames $rich_names`; `Template::loadForResource($templates, $reader)` mit fester Zahl Abfragen), `App\Models\TemplateRun` (`$timestamps = false`, `template()`, `workItem()`, `trigger()`), `App\Models\Automation` (Morph-Map `automation`; Casts `settings` `array`, `enabled` bool, `key` `AutomationKey`), `WorkItem::template()`.
- Factories `TemplateFactory` (Task im Standardtyp, Titel „Wartung KW {week}“, ohne Zeitplan; `scheduled(array $schedule)` setzt `schedule`, `schedule_from` = jetzt und `next_run_at` über `TemplateSchedule::nextRunAt`), `TemplateRunFactory` (`failed($error)`), `AutomationFactory` (`for($project)->key($key)->enabled($settings)`).

## REST

| Route | Action | Antwort |
|---|---|---|
| `GET /api/v1/templates` | `ListTemplates` | `{data: Template[], links, meta}` aller sichtbaren Projekte (Palette), nach Projektkennung, Name, ID; `?project=` (Referenz) grenzt ein |
| `GET /api/v1/projects/{project}/templates` | `ListTemplates` | dieselbe Liste für ein Projekt (archivierte Projekte lesbar) |
| `POST /api/v1/projects/{project}/templates` | `SaveTemplate` | 201 `{data: Template}`; Body `{name, payload, schedule}` (alle Pflicht, `schedule` darf `null` sein, A75) |
| `GET /api/v1/templates/{template}` | `GetTemplate` | `{data: Template}` |
| `PUT /api/v1/templates/{template}` | `SaveTemplate` | `{data: Template}`; ersetzt ganz (A75), gleicher Stand → kein Event |
| `DELETE /api/v1/templates/{template}` | `DeleteTemplate` | 204 |
| `GET /api/v1/templates/{template}/draft` | `DraftFromTemplate` | `{data: TemplateDraft}`: die Felder eines Items, wie es jetzt entstünde (A335) |
| `POST /api/v1/templates/{template}/run` | `RunTemplate` | `{data: {run: TemplateRun, item: WorkItem\|null}}` (200, auch gescheitert, A350) |
| `GET /api/v1/templates/{template}/runs` | `ListTemplateRuns` | `{data: TemplateRun[], links, meta}` neueste zuerst (`ran_at`, `id`) |
| `POST /api/v1/templates/preview` | `PreviewSchedule` | `{data: {runs: string[], title: string\|null}}`; Body `{schedule, title?, run_count?}`; Lese-POST (`token_ability` `read`) |
| `GET /api/v1/projects/{project}/automations` | `ListAutomations` | `{data: Automation[]}`: immer vier, in der Reihenfolge von `AutomationKey::cases()` (A346) |
| `PUT /api/v1/projects/{project}/automations/{key}` | `SaveAutomation` | `{data: Automation}`; Body `{enabled, settings}` |

- `TemplateResource` `{id, project_id, name, payload: {type_id, title, description (Markdown für den Leser), description_json, priority, assignee_id, label_ids, values, values_markdown, parent_id, start_offset_days, due_offset_days}, schedule, run_count, last_run_at, next_run_at, created_by, created_at, updated_at}`; `TemplateRunResource` `{id, template_id, scheduled_for, ran_at, status, work_item_id, error, triggered_by}`; `TemplateDraftResource` `{project_id, template_id, type_id, title, description, description_json, priority, assignee_id, label_ids, values, parent_id, start_date, due_date}`; `AutomationResource` `{id (null ohne Zeile), project_id, key, enabled, settings}`. Keine Resource fragt etwas (K5).
- `Route::bind('template')` in `routes/api.php` nur per ULID (auch groß), sonst 404, ohne Sichtbarkeit. `{key}` der Automatisierung ist ein Wert von `AutomationKey`, sonst 404. Die Web-Route nennt ihren Parameter `{templateId}` (Fallstrick: globale Bindungen).
- Feldmeldungen: `field.name.required`, `field.name.max` (`:max` 120), `field.title.required`/`field.title.max` an `payload.title` (die längste Füllung der Platzhalter zählt, A349), `field.type_id.disabled`/`.archived`, `field.assignee_id.invalid`, `field.label_ids.unknown`, `field.parent_id.unknown`/`.project` sowie `epic_has_no_parent`/`parent_not_epic` an `payload.parent_id`, `field.offset.invalid` an `payload.start_offset_days`/`payload.due_offset_days`, `field.due_offset.before_start`, `field.values.*` an `payload.values.<key>` (ohne Pflichtprüfung), Rich Text an `payload.description`/`payload.description_json`, `field.schedule.<code>` an `schedule.<feld>` (`shape`, `frequency`, `interval`, `weekdays`, `month_day`, `nth_weekday`, `yearly_date`, `time`, `starts_on`, `ends`, `never_runs`), `field.template_id.unknown` (Anlegen eines Items), `field.settings.days` (1–3650), `field.settings.state_id` (ein Canceled-Status des Workflows; Pflicht, um Auto-Close einzuschalten), `field.boolean`. Problem: 403 `forbidden` mit `problem.detail.templates_members_only` („Vorlagen verwalten nur Member und Admins des Projekts.“) bzw. `problem.detail.automations_admins_only` („Automatisierungen ändern nur Admins des Projekts.“), 409 `project_archived`.

## Termine (`App\Domain\Schedule`, Port von `recurrence.ts`)

| Regel | Wert |
|---|---|
| Kalender | Tage `Y-m-d` in der Zone der Organisation; jeder Tag bekommt die Wanduhrzeit `time` (`WallClock::at`) |
| Lücke (Frühjahr) | eine Uhrzeit, die es nicht gibt, rückt um die Länge der Lücke vor (02:30 → 03:30) |
| Doppelte Stunde (Herbst) | die erste gewinnt (02:30 MESZ) |
| täglich | alle N Tage ab `starts_on` |
| wöchentlich | alle N Wochen ab der Woche (Montag–Sonntag) von `starts_on`; Tage dieser Woche vor `starts_on` entfallen; ohne Wochentage der Wochentag von `starts_on`; Wochentage 0 = Sonntag |
| monatlich | alle N Monate ab dem Monat von `starts_on`; `nth_weekday` (1–4, −1 = letzter) gewinnt vor `month_day` (1–31 oder `last`); ein Tag über der Länge des Monats wird der letzte |
| jährlich | alle N Jahre; `yearly_date` `MM-DD` (Standard: Monat und Tag von `starts_on`); 29.02. in Jahren ohne ihn → 28.02. |
| Ende | `never`, `on` (letzter erlaubter Tag, eingeschlossen), `count` (höchstens N − `run_count` weitere) |
| Pause | keine Termine, kein Nachholen |
| Nachholen | von allen Terminen nach `since` = max(`last_run_at`, `schedule_from`) bis `now` genau der letzte (A339); keiner, wenn `count` erschöpft |
| Vorschau | die nächsten 5 nach `now` (Pause und erschöpfte Zeitpläne: keine) |

## Automatisierungen (`App\Domain\Automations`, A341–A345)

| Schlüssel | Auslöser | Wirkung | Grund |
|---|---|---|---|
| `assign_on_start` | Zug eines Items **durch eine Person** aus einer nicht gestarteten in eine Started-Kategorie, Item ohne Assignee | Assignee = die Person, sie beobachtet (`assigned`); `work_item.assigned` des Standard-Bots mit `meta.on_behalf_of` | `assign_on_start` |
| `close_parent` | Zug eines Kindes in Completed/Canceled | sind alle Kinder des Eltern-Items geschlossen und mindestens eins Completed, geht es in den ersten Completed-Status (Reihenfolge des Workflows), zu dem der Übergang erlaubt ist; sonst bleibt es; wirkt höchstens `CloseParentRule::MAX_CHAIN` 5 Ebenen nach oben | `close_parent` |
| `auto_archive` | täglich 03:00 Org-Zeit | archiviert Items in Completed/Canceled mit `closed_at ≤ now − days` (Standard 30) | `auto_archive` |
| `auto_close` | täglich 03:00 Org-Zeit | Items in Backlog/Unstarted, deren letzte Aktivität (`updated_at` oder letzter Kommentar, A344) `≤ now − days` (Standard 90) ist → `settings.state_id` (Canceled), dann Bot-Kommentar `automations.auto_close.comment`; nicht erlaubter Übergang → übersprungen, kein Kommentar | `auto_close` |

## Live

| Event | Kanal | Nachricht |
|---|---|---|
| `template.created`, `template.updated`, `template.deleted`, `template.run_failed`, `automation.updated` | `private-project.{project_id}` | die sieben Schlüssel wie bisher (`page_id`, `item_id`, `comment_id` `null`), nur IDs (A279) |

Browser (`useLiveSync`): `template.*` → `qk.templates.all`, `qk.templateRuns.all`; `automation.updated` → `qk.automations.all`; `work_item.created` zusätzlich `qk.templates.all`, `qk.templateRuns.all` (ein Lauf ändert `last_run_at` und das Protokoll). Vorlagen liest der Browser nur als Liste je Projekt (A347): eine von anderen gelöschte Vorlage fällt aus der Liste, keine Abfrage fragt sie einzeln.

## Dateistruktur nach Phase 10

| Ort | Inhalt |
|---|---|
| `app/Domain/Schedule/` | `Frequency`, `ScheduleEnd`, `Schedule`, `WallClock`, `Recurrence`, `Placeholders`, `Offsets` |
| `app/Domain/Automations/` | `AutomationKey`, `CloseParentRule`, `AssignOnStartRule`, `NightlyRun` |
| `app/Models/{Template,TemplateRun,Automation}.php`, `database/factories/*` | Modelle |
| `app/Policies/TemplatePolicy.php`, `app/Policies/ProjectPolicy.php` (`manageAutomations`) | Rechte |
| `app/Support/{TemplateInput,TemplateSchedule,TemplateAttachments,TemplateRunError,ProjectAutomations}.php` | Eingaben, Termine, Kopien, Fehlertexte, gelesene Einstellungen |
| `app/Actions/Templates/` | `ListTemplates`, `GetTemplate`, `SaveTemplate`, `DeleteTemplate`, `DraftFromTemplate`, `PreviewSchedule`, `RunTemplate`, `RunScheduledTemplate`, `RunDueTemplates`, `RescheduleTemplates`, `ListTemplateRuns` |
| `app/Actions/Automations/` | `ListAutomations`, `SaveAutomation`, `FollowWorkflow`, `RunMoveAutomations`, `RunDailyAutomations` |
| `app/Jobs/{RunTemplateJob,RunDailyAutomationsJob}.php`, `app/Console/Commands/{RunTemplatesCommand,RunAutomationsCommand}.php`, `routes/console.php` | Scheduler |
| `app/Http/Controllers/Api/{TemplatesController,AutomationsController}.php`, `app/Http/Resources/{TemplateResource,TemplateRunResource,TemplateDraftResource,AutomationResource}.php` | dünne Schicht |
| `app/Http/Controllers/TemplatesPageController.php`, `resources/js/pages/Templates/Index.tsx` | Web-Route `/projects/{identifier}/templates/{templateId?}` |
| `database/seeders/Demo/{TemplatesSeeder,AutomationsSeeder}.php` | Demo |
| `resources/js/api/{templates,automations}.ts`, `resources/js/hooks/{templates,automations}.ts` | Datenschicht |
| `resources/js/features/templates/` | `TemplatesScreen`, `TemplateList`, `TemplateRow`, `TemplateEditor`, `TemplateFields`, `TitleField`, `TemplateProperty`, `ScheduleEditor`, `ScheduleFields`, `TimeField`, `NextRuns`, `RunLog`, `scheduleText.ts`, `scheduleForm.ts`, `format.ts`, `rights.ts`, `applyTemplate.tsx` |
| `resources/js/features/settings/project/{Automations.tsx,automationRules.ts}` | Projekteinstellungen |
| `docs/{en,de}/concepts/{templates,automations}.md` | Doku |

## Paketversionen

Geprüft am 2026-11-04 im Root-`pnpm-lock.yaml` und `composer.lock`: keine neuen Pakete.

| Paket | Version (installiert) | Task | Hinweis |
|---|---|---|---|
| `spatie/laravel-medialibrary` | 11 | 6 | `Media::copy($model, 'file')` für die Bildkopien (A337) |
| `@tiptap/*` | 3.32.0 | 16 | Stufe `description` im Vorlagen-Editor |
| PHP `DateTimeZone`/`DateTimeImmutable` | PHP 8.4 | 1 | Lücke vorwärts und doppelte Stunde „erste“ sind PHP-Verhalten; Tests halten es fest (kein ext-intl nötig, A353) |

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 10 | Ziel | Task |
|---|---|---|
| `domain/recurrence.ts` (+ Tests), `domain/placeholders.ts` (+ Tests), `toUtc` aus `domain/tz.ts` | `App\Domain\Schedule\*`, `tests/Unit/Schedule/*` (gleiche Testnamen) | 1 |
| `api/itemRules.ts` (`assignOnStart`, `closeParent`) | `App\Domain\Automations\*`, `App\Actions\Automations\RunMoveAutomations` | 2, 11 |
| `api/templates.ts` (Regeln, `failureText`, `runTemplateNow`) | `App\Actions\Templates\*`, `TemplateRunError` | 4–8 |
| `api/automations.ts` | `ListAutomations`, `SaveAutomation` | 10 |
| `api/seed/workspace.ts` (drei Vorlagen, sieben Läufe), `api/seed/config.ts` (Automatisierungen) | `TemplatesSeeder`, `AutomationsSeeder` | 13 |
| `api/templates.ts`, `api/automations.ts`, `hooks/{templates,automations}.ts` (Signaturen) | `resources/js/api/*`, `resources/js/hooks/*` | 14 |
| `features/templates/TemplatesScreen.tsx`, `RunLog.tsx`, `format.ts` | `TemplatesScreen`, `TemplateList`, `TemplateRow`, `RunLog` (13b geteilt) | 15 |
| `features/templates/TemplateEditor.tsx` | `TemplateEditor`, `TemplateFields`, `TitleField`, `TemplateProperty` (13b; 13c Wiederholschutz, Uploads im `UploadContext`) | 16 |
| `features/templates/ScheduleEditor.tsx`, `scheduleText.ts`, `scheduleForm.ts` | `ScheduleEditor`, `ScheduleFields`, `TimeField`, `NextRuns` (Termine vom Server) | 17 |
| `features/create-item/CreateItemDialog.tsx` (`applyTemplate`), „Vorlage anwenden …“ | `CreateForm` (Feld „Vorlage“), `features/templates/applyTemplate.tsx` | 18 |
| `features/settings/project/Automations.tsx`, `automationRules.ts` | gleiche Namen (13c kein doppeltes Speichern) | 19 |
| `features/templates/templates.test.tsx`, `e2e/flows.spec.ts` Flow 6 | Vitest in `features/templates/*.test.tsx`, `e2e/tests/{templates,templates-acceptance,automations}.spec.ts` | 15–20 |

Nicht in Phase 10: Vorlagen mit Unteraufgaben (Spec 2); Webhook-Zustellung von `template.run_failed` (Phase 11, `data` = `TemplateRunResource` samt Vorlage); MCP-Tools `templates`/`manage-templates`, `automations`/`manage-automations` (Phase 13); Scheduler-Container im Image (Phase 14).

## Abdeckung über die Tasks

- **PHP:** G1 in jeder PHP-Task. Neue Actions und Routen bekommen im selben Commit ihre Matrix-Zeilen (`MatrixWorld::template($column)`: eine frische Vorlage im Projekt der Spalte, vom Projekt-Admin). Vorlagen lesen: alle Spalten mit Sicht, `hidden ['outsider_private']`; verwalten und ausführen: Org-Admin, Projekt-Admin, -Member, Standard-Bot mit Event, Viewer und Außenstehende öffentlicher Projekte 403, `outsider_private` 404. Automatisierungen: lesen wie Vorlagen, ändern nur Org-Admin, Projekt-Admin und Standard-Bot. System-Actions (`RunScheduledTemplate`, `RunDueTemplates`, `RescheduleTemplates`, `RunMoveAutomations`, `RunDailyAutomations`, `FollowWorkflow`) mit `system`.
- **Frontend, Vitest:** neue Schwelle `resources/js/features/templates/**` (100 % Zeilen); `features/settings/project/**`, `features/create-item/**`, `features/inbox/**`, `features/item-detail/**`, `api/`, `hooks/` haben Schwellen.
- **Frontend, Playwright:** neue Specs `e2e/tests/{templates,templates-acceptance,automations}.spec.ts`; Ergänzungen in `create-item.spec.ts` (Vorlage im Dialog), `palette.spec.ts` („Vorlage anwenden …“), `settings-project.spec.ts` bzw. `projects.spec.ts` (Abschnitt Automatisierungen), `inbox.spec.ts` (Zeile einer fehlgeschlagenen Vorlage führt zur Vorlage).

---

### Task 1: Termine und Platzhalter als reine Regeln

**Modell:** opus

**Files:**
- Create: `app/Domain/Schedule/{Frequency,ScheduleEnd,Schedule,WallClock,Recurrence,Placeholders,Offsets}.php`, `tests/Unit/Schedule/{ScheduleTest,WallClockTest,RecurrenceTest,PlaceholdersTest,OffsetsTest}.php`

**Interfaces:**
- Produces:
  - `enum Frequency: string { Daily = 'daily'; Weekly = 'weekly'; Monthly = 'monthly'; Yearly = 'yearly'; }`
  - `final readonly class ScheduleEnd { public string $type /* never|on|count */; public ?string $date; public ?int $count; }`
  - `final readonly class Schedule` mit `frequency`, `interval` (≥ 1), `weekdays` (`list<int>` 0–6, sortiert, ohne Doppelte), `monthDay` (`int|'last'|null`), `nthWeekday` (`?array{n: 1|2|3|4|-1, weekday: int}`), `yearlyDate` (`?string` `MM-DD`), `time` (`HH:MM`), `startsOn` (`Y-m-d`), `ends`, `paused`; `static parse(mixed $json): self` (streng, wirft `App\Domain\Filter\InvalidInput` mit Pfaden relativ zur Wurzel: `''` `shape`, `frequency`, `interval` (ganze Zahl 1–`MAX_INTERVAL` 999), `weekdays`, `month_day`, `nth_weekday`, `yearly_date` (auch 02-30, 04-31), `time` (`/^([01]\d|2[0-3]):[0-5]\d\z/`), `starts_on` (echter Tag), `ends` (`on` mit Tag ≥ `starts_on`, `count` 1–`MAX_COUNT` 9999); Felder, die die Frequenz nicht braucht, fallen weg), `static read(array $stored): ?self` (nachsichtig, `null` für Unlesbares), `toArray(): array` (Normalform, `parse(toArray())` ergibt dasselbe).
  - `final class WallClock { static at(string $day, string $time, DateTimeZone $zone): DateTimeImmutable /* UTC; Lücke vorwärts, doppelte Stunde die erste */; static day(DateTimeImmutable $instant, DateTimeZone $zone): string; }`
  - `final class Recurrence { static next(Schedule $s, DateTimeImmutable $after, int $count, DateTimeZone $zone, int $runCount = 0): list<DateTimeImmutable>; static catchUp(Schedule $s, ?DateTimeImmutable $since, DateTimeImmutable $now, DateTimeZone $zone, int $runCount = 0): ?DateTimeImmutable; }` (Semantik wie `nextOccurrences`/`missedRunToCatchUp`, `since` statt `lastRunAt`; Rückgaben in UTC).
  - `final class Placeholders { public const NAMES = ['date', 'week', 'month', 'month_name', 'quarter', 'year']; static render(string $title, DateTimeImmutable $at, DateTimeZone $zone, array $monthNames /* 1..12 => Name */): string; static longest(string $title, array $monthNames): int /* Länge mit der längsten Füllung jedes Platzhalters, mb_strlen */; }` (`{week}` ISO-Woche zweistellig, `{month}` zweistellig, Unbekanntes bleibt Text).
  - `final class Offsets { static day(string $today, ?int $offset): ?string; }`
- Consumes: `App\Domain\Filter\InvalidInput` (Phase 5).

- [ ] **Step 1: Failing Tests** — `RecurrenceTest` portiert jeden Fall von `recurrence.test.ts` mit gleichem Namen (Berlin; „stays at 09:00 local time across the end of summer time (2026-10-25)“, „… start of summer time (2027-03-28)“, „moves a wall-clock time that does not exist (02:30 on 2027-03-28) forward …“, „takes the first of a wall-clock time that happens twice …“, wöchentlich mit Sonntag als letztem Wochentag, monatlich mit n-tem und letztem Wochentag, 31. → 30.04./28.02./29.02.2028, „last“, jährlich 29.02., Ende `on`/`count` mit `runCount`, Pause; `catchUp`: drei verpasste → der letzte, ohne `since` ab `starts_on`, „nothing due yet today“, `count` erschöpft → `null`). Zusätzlich: „gives the five runs of Monatsbericht after 2026-10-28 10:00 Berlin“ → `2026-11-02`, `2026-12-07`, `2027-01-04`, `2027-02-01`, `2027-03-01` je 09:00 (Flow 6); „counts in New York and in Kolkata“ (Zone mit halber Stunde); „never returns an instant before since“. `PlaceholdersTest` portiert `placeholders.test.ts` (zweistellig, ISO-Woche 53 am 2026-12-31, Monatsname aus der übergebenen Liste, der Tag in der Zone: 2026-10-31 23:30 UTC ist in Berlin der 1. November, unbekannter Platzhalter bleibt) und `longest` („{date} counts ten characters“). `ScheduleTest`: je Code ein Fall mit Pfad, „drops the fields its frequency does not use“, Rundreise `parse(toArray())`, `read` gibt `null` für eine kaputte Zeile. `WallClockTest`: Lücke, doppelte Stunde, Kolkata. `OffsetsTest`: `null`, 0, 14 über einen Monatswechsel.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ScheduleTest|WallClockTest|RecurrenceTest|PlaceholdersTest|OffsetsTest|ArchTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: port the recurrence and placeholder rules of templates`.

---

### Task 2: Reine Regeln der Automatisierungen

**Modell:** sonnet

**Files:**
- Create: `app/Domain/Automations/{AutomationKey,CloseParentRule,AssignOnStartRule,NightlyRun}.php`, `tests/Unit/Automations/{AutomationKeyTest,CloseParentRuleTest,AssignOnStartRuleTest,NightlyRunTest}.php`

**Interfaces:**
- Produces:
  - `enum AutomationKey: string { AutoArchive = 'auto_archive'; AutoClose = 'auto_close'; CloseParent = 'close_parent'; AssignOnStart = 'assign_on_start'; public function defaults(): array /* auto_archive ['days' => 30], auto_close ['days' => 90, 'state_id' => null], sonst [] */; public function daily(): bool; }` (`MIN_DAYS` 1, `MAX_DAYS` 3650).
  - `final class CloseParentRule { public const MAX_CHAIN = 5; static closes(list<StateCategory> $children, StateCategory $parent): bool /* Eltern offen, alle Kinder geschlossen, mind. eins Completed */; static target(list<array{id: string, category: StateCategory}> $statesInOrder, string $fromId, TransitionGraph $graph): ?string; }`
  - `final class AssignOnStartRule { static applies(bool $actorIsPerson, ?string $assigneeId, StateCategory $from, StateCategory $to): bool; }`
  - `final class NightlyRun { public const HOUR = 3; static isDue(DateTimeImmutable $hourUtc, DateTimeZone $zone): bool; }`
- Consumes: `App\Domain\Workflow\{StateCategory,TransitionGraph}` (Phase 3).

- [ ] **Step 1: Failing Tests** — `CloseParentRuleTest`: „closes when every child is closed and one is completed“, „stays open when all children are canceled“, „stays open while a child is open“, „does nothing for a closed parent“, „takes the first completed state the workflow allows“ (Agentur-Freigabe: erster Completed nicht erlaubt, zweiter erlaubt), „answers null when no completed state is reachable“. `AssignOnStartRuleTest`: Person startet ohne Assignee → ja; Bot → nein; schon zugewiesen → nein; Started → Started → nein; Backlog → Completed → nein. `NightlyRunTest`: 02:00 UTC ist im Berliner Winter 03:00 → ja, 01:00 UTC im Sommer → ja; New York; Kolkata 21:30 UTC; Tag der Umstellung. `AutomationKeyTest`: Standards, `daily()`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Automations|ArchTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: add the pure rules of the project automations`.

---

### Task 3: Datenmodell, Rechte, Actor der Vorlage

**Modell:** opus

**Files:**
- Create: `database/migrations/2026_11_05_001300_create_templates_tables.php`, `app/Models/{Template,TemplateRun,Automation}.php`, `database/factories/{TemplateFactory,TemplateRunFactory,AutomationFactory}.php`, `app/Policies/TemplatePolicy.php`, `tests/Feature/Templates/{TemplateModelTest,TemplatePolicyTest}.php`
- Modify: `app/Models/WorkItem.php` (`template()`), `app/Support/Actor.php` (`template()`, `onBehalfOf()`), `app/Policies/ProjectPolicy.php` (`manageAutomations`), `app/Providers/AppServiceProvider.php` (Morph-Map `template`, `automation`), `tests/Feature/Access/MatrixWorld.php` (`template()`), `tests/Unit/ActorTest.php` (oder wo `Actor` getestet wird), `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - Tabellen und Modelle wie „Datenmodell“; `Template::scopeVisibleTo(Builder $q, User $user)` = `whereIn('templates.project_id', Visibility::projectIds($user))`.
  - `Actor::template(Template $t): self` = `new self(User::defaultBot(), self::VIA_TEMPLATE, 'template')` (A30); `Actor::onBehalfOf(User $person): self` (derselbe Actor, neues Feld `public ?string $onBehalfOf`; `meta()` gibt `on_behalf_of` nur, wenn gesetzt; `withReason` behält es).
  - `TemplatePolicy`: `viewAny(User, Project)`, `view(User, Template)` (Projekt sichtbar über `Visibility::roleIn`, sonst `denyAsNotFound`), `create(User, Project)`, `update(User, Template)` (Speichern, Löschen, Ausführen): erst Sichtbarkeit, dann `Visibility::can($user, Permission::TemplateManage, $project)`, sonst `Response::deny(__('problem.detail.templates_members_only'))`. `ProjectPolicy::manageAutomations(User, Project)`: Sichtbarkeit, dann `project.manage`, sonst `problem.detail.automations_admins_only`.
  - `MatrixWorld::template(string $column): Template`.
- Consumes: Task 1 (`Schedule::read` in `Template::schedule()`).

- [ ] **Step 1: Failing Tests** — `TemplateModelTest`: „keeps one run per template and term, and any number of manual runs“ (zwei `scheduled_for = null` gehen, zwei gleiche Termine verletzen den Index); „takes templates, runs and automations with the project“ (Kaskade); „keeps the item when its template goes“ (`template_id` wird `null`); „keeps one automation per project and key“. `TemplatePolicyTest` je Spalte von `MatrixWorld`: lesen (Viewer, Außenstehender eines öffentlichen Projekts ja, privat 404, Projekt in Löschung 404), verwalten (Viewer 403 mit `templates_members_only`, Member, Org-Admin, Standard-Bot ja); `manageAutomations` (Member 403 `automations_admins_only`, Projekt-Admin ja). `ActorTest`: „acts for a template as the default bot via template“, „notes on_behalf_of in the meta and keeps it with another reason“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Template|Actor|MorphMap|ArchTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Abschnitt „Vorlagen: Datenmodell und Rechte“ (Tabellen, Modelle, Policy, `Actor::template`, `onBehalfOf`); Fallstrick: `{template}` global gebunden, Web-Parameter `{templateId}`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add templates, template runs and automations with their rights`.

---

### Task 4: Vorlagen lesen, anlegen, ändern, löschen (REST)

**Modell:** opus

**Files:**
- Create: `app/Support/{TemplateInput,TemplateSchedule}.php`, `app/Actions/Templates/{ListTemplates,GetTemplate,SaveTemplate,DeleteTemplate}.php`, `app/Http/Controllers/Api/TemplatesController.php`, `app/Http/Resources/TemplateResource.php`, `tests/Feature/Templates/{ListTemplatesTest,SaveTemplateTest,DeleteTemplateTest}.php`, `tests/Feature/Api/TemplatesApiTest.php`
- Modify: `app/Events/EventType.php` (`TemplateCreated`, `TemplateUpdated`, `TemplateDeleted`, ohne Webhook), `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `TemplateInput::validate(array $input, Project $project, User $writer, ?Template $current): array{name: string, payload: array, documents: array<string, ?Document>, schedule: ?Schedule}` — Pflichtschlüssel `name`, `payload`, `schedule` (A75), alle Feldfehler in **einer** 422 (Meldungen wie „REST“); Typ aktiviert und aktiv (ein schon gespeicherter archivierter darf bleiben), Assignee `Assignable::check`, Labels vorhanden, Eltern ein Epic des Projekts (über `ItemInput`-Regeln ohne Item), Werte über `ItemValues::check($project, $type, $values, [], 'update')` (keine Pflichtprüfung, A349), Titel getrimmt 1–255 und `Placeholders::longest` ≤ 255 (`field.title.max`), Offsets; Rich Text (`payload.description` Markdown oder `payload.description_json`, Rich-Text-Werte) **vor** jeder Sperre über `RichTextInput::from` mit `RichTextRules::context($project, $writer, <vorige Fassung>)`.
  - `TemplateSchedule::nextRunAt(?Schedule $s, ?DateTimeImmutable $since, int $runCount, DateTimeImmutable $now): ?DateTimeImmutable` (Zone der Organisation; Pause → `null`); `TemplateSchedule::monthNames(string $locale): array<int, string>` (`__('schedule.month.<name>', [], $locale)`, inline, damit `TranslationKeysTest` sie findet).
  - `ListTemplates::handle(Actor $actor, Project|string|null $project, array $query): ListResult` (sichtbare Projekte, ohne Projekte in Löschung; `PageArgs`), `GetTemplate::handle(Actor, Template): Template`, `SaveTemplate::handle(Actor $actor, Project|string|null $project, array $input, ?Template $template = null): Template` (Transaktion: `MemberInput::lock($project)` → archiviertes Projekt 409 → bei `$template` die Zeile `lockForUpdate` frisch (weg → 404) → speichern; ändert sich der Zeitplan (Normalform verglichen) oder wird er fortgesetzt, `schedule_from` = jetzt (A339), `next_run_at` neu; `AttachmentLinks::link($template, $project, $writer, $texts)`; `template.created` mit `changes.name` bzw. `template.updated` mit `CatalogInput::changes` über `name`, `payload`, `schedule` nur bei echter Änderung), `DeleteTemplate::handle(Actor, Template): void` (siehe Task 5 für die Anhänge; hier: Zeile weg, `template.deleted` mit `meta.name`).
  - `TemplateResource` nach „REST“; `Template::loadForResource` setzt `rich_names` über `ReaderNames::of`.
- Consumes: Tasks 1, 3; `ItemInput`, `ItemValues`, `RichTextInput`, `RichTextRules`, `AttachmentLinks`, `ReaderNames`, `CatalogInput::changes`.

- [ ] **Step 1: Failing Tests** — `SaveTemplateTest`: „creates a template with schedule and works out its next run“ (`travelTo` 2026-10-28 09:00 UTC, Monatsbericht → `next_run_at` 2026-11-02 08:00 UTC); „refuses every field at once“ (Name leer, Typ nicht aktiviert, Label unbekannt, Zeitplan `time` 25:00 → eine 422 mit allen Pfaden); „allows a required property without a value“; „refuses a title that placeholders would make longer than 255“; „keeps a schedule paused without next run“; „sets schedule_from when the schedule changes or resumes, not when only the name changes“; „writes no event for the same template sent back“ (`PUT` mit der eigenen Antwort); „refuses an archived project with 409“; „reads Markdown before any lock“ (Abfrage-Log: keine `for update` vor dem Lesen, wie `UpdatePage`). `ListTemplatesTest`: „lists the templates of every project the reader sees“ (privat fremd fehlt), „asks the database as often for 50 templates as for 5“. `DeleteTemplateTest`: Zeile und Läufe weg, Event mit `meta.name`, Items behalten sich mit `template_id` `null`. `TemplatesApiTest`: Formen, `{template}` per ULID groß und klein, Text → 404, Lese-Token liest, schreibt nicht.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Templates|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Abschnitt „Vorlagen: REST und Speichern“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: read, save and delete templates over REST`.

---

### Task 5: Bilder in Vorlagen: Besitzer `template`, Lesen, Übergeben, Aufräumen

**Modell:** opus

**Files:**
- Modify: `app/Support/AttachmentTexts.php` (`OWNERS` + `template`; `namers` liest `payload.description` und Rich-Text-Werte aller Vorlagen des Projekts; neuer Parameter `array $exceptTemplates = []`), `app/Policies/AttachmentPolicy.php` (Besitzer `template`: wer das Projekt sieht), `app/Actions/Templates/DeleteTemplate.php` (`ReadCommitted::run`, Anhänge `for update`, `handOverOrRemove(…, exceptTemplates: [$id])`), `tests/Feature/Attachments/{ShowAttachmentTest,PruneTest}.php`, `tests/Feature/Templates/DeleteTemplateTest.php`, `tests/Integration/AttachmentLinkRaceTest.php`, `CLAUDE.md`

**Interfaces:**
- Produces: `AttachmentTexts::namers(string $projectId, ?array $only = null, array $exceptItems = [], array $exceptComments = [], bool $lenient = false, array $exceptPages = [], array $exceptTemplates = []): array` (Vorlagen in Blöcken über einen Index von `project_id`, nie ein Scan aller Projekte); `AttachmentFactory::forTemplate(Template $t)`.
- Consumes: Task 4.

- [ ] **Step 1: Failing Tests** — `ShowAttachmentTest`: „shows the image of a template to everyone who sees its project, 404 to others“. `DeleteTemplateTest`: „hands an image a description still shows over to that item and removes the rest after the commit“. `PruneTest`: „keeps an image only a template shows“; „prunes an image of a template that no text shows any more“. `AttachmentLinkRaceTest`: „a save that copies an image of a template waits for its deletion“ (zwei Verbindungen, `releaseBeforeLock('attachments')`). Dazu: das Löschen eines Items, dessen Bild eine Vorlage zeigt, gibt es an die Vorlage.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Attachment|Prune|DeleteTemplate'`; `ddev artisan test --testsuite=Integration --filter=AttachmentLinkRaceTest`.
- [ ] **Step 3: `CLAUDE.md`** — „Anhänge“: Besitzer `template` (`OWNERS`, `namers`, Policy).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: own images in templates and hand them over on delete`.

---

### Task 6: Vorlage anwenden: Entwurf, Vorschau, Anlegen mit Kopie der Bilder

**Modell:** opus

**Files:**
- Create: `app/Support/TemplateAttachments.php`, `app/Actions/Templates/{DraftFromTemplate,PreviewSchedule}.php`, `app/Http/Resources/TemplateDraftResource.php`, `tests/Feature/Templates/{DraftFromTemplateTest,PreviewScheduleTest,ApplyTemplateTest}.php`
- Modify: `app/Actions/WorkItems/CreateWorkItem.php` (`template_id`), `app/Support/ItemInput.php` (`template_id` prüfen), `app/Http/Resources/{WorkItemResource,HistoryEntryResource}.php` (`template_id`, `template`), `app/Actions/WorkItems/ListHistory.php` (falls `meta.template` dort durchgereicht wird), `app/Http/Controllers/Api/TemplatesController.php`, `routes/api.php`, Matrizen, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `DraftFromTemplate::handle(Actor $actor, Template $template): array` (Recht `view` **und** `Authorize::check($actor, 'create', WorkItem::class, $project)`, weil der Entwurf zum Anlegen dient; Titel über `Placeholders::render` mit `now()` in Zone und Sprache der Organisation, `start_date`/`due_date` über `Offsets::day` ab heute (`OrgCalendar::today()`), sonst der Payload; die Beschreibung mit den Original-IDs der Bilder).
  - `PreviewSchedule::handle(Actor $actor, array $input): array{runs: list<string>, title: ?string}` (`schedule` über `Schedule::parse` (422 an `schedule.<feld>`), `title` optional (Text bis 255, gerendert am ersten Termin, sonst jetzt), `run_count` optional 0–9999; die fünf nächsten Termine nach `now()` als ISO-UTC; braucht nur ein aktives Konto, Lese-POST).
  - `TemplateAttachments::copy(Template $template, array $texts /* Schlüssel → ?Document */, User $writer): array` — **vor** jeder Transaktion: jedes Bild und jede Datei der Texte, die die Vorlage besitzt (`attachable` = diese Vorlage), wird ein neuer Anhang ohne Besitzer (`uploaded_by` = Schreiber, gleiche `kind`, `filename`, `mime`, `size`) mit `Media::copy($neu, 'file')`; die Texte bekommen die neuen IDs (`Document::withNodes`); was die Vorlage nicht besitzt, bleibt unverändert (A337).
  - `CreateWorkItem`: `template_id` (ULID einer Vorlage **dieses** Projekts, sonst 422 `field.template_id.unknown`) → nach `ItemInput::documents` `TemplateAttachments::copy`, dann wie bisher (`AttachmentLinks` verknüpft die Kopien); speichert `work_items.template_id`; `work_item.created` bekommt `meta.template` = `{id, name}` (A352).
  - `WorkItemResource.template_id` aus der Spalte; `HistoryEntryResource.template` = `meta.template` oder `null`.
- Consumes: Tasks 1, 4, 5.

- [ ] **Step 1: Failing Tests** — `DraftFromTemplateTest`: „fills the title and the dates of today in the zone of the organisation“ (`travelTo` 2026-10-31 23:30 UTC, Berlin: `{date}` → 2026-11-01, Due +2 → 2026-11-03); „names the month in the language of the organisation“ (de „November“, en „November“, de „März“); „answers 403 to a viewer, 404 to someone who does not see the project“. `PreviewScheduleTest`: „gives the five runs of Monatsbericht“ (Flow 6, `travelTo` 2026-10-28 09:00 UTC); „gives none for a paused schedule“; „refuses a schedule it cannot read“; „renders the title at the first run“; Lese-Token. `ApplyTemplateTest`: „creates an item with copies of the template's images“ (zwei Anhänge, neue IDs im Text, Besitzer das Item, Dateien vorhanden, die Vorlage behält ihre); „keeps the copies when the template goes“; „leaves an image the template does not own as it is“; „refuses a template of another project“; „notes the template in the history“ (`meta.template`, `HistoryEntryResource.template`); „a refused item leaves its copies without owner for the hourly prune“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='DraftFromTemplate|PreviewSchedule|ApplyTemplate|CreateWorkItem|History|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — „Items anlegen und ausgeben“: `template_id`, Kopien; „Vorlagen“: Entwurf, Vorschau.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: apply a template with its images copied, draft and schedule preview`.

---

### Task 7: Läufe: „Jetzt ausführen“, Protokoll, Fehler zur Laufzeit

**Modell:** opus

**Files:**
- Create: `app/Support/TemplateRunError.php`, `app/Actions/Templates/{RunTemplate,ListTemplateRuns}.php`, `app/Http/Resources/TemplateRunResource.php`, `tests/Feature/Templates/{RunTemplateTest,ListTemplateRunsTest,TemplateRunErrorTest}.php`, `tests/Integration/TemplateRunRaceTest.php`
- Modify: `app/Http/Controllers/Api/TemplatesController.php`, `routes/api.php`, Matrizen, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `RunTemplate::handle(Actor $actor, Template $template): array{run: TemplateRun, item: ?WorkItem}` (Recht `update`; ruft `RunTemplate::run($template, null, $actor->user)`; Antwort mit `loadForResource` des Items).
  - `RunTemplate::run(Template $template, ?DateTimeImmutable $scheduledFor, ?User $trigger): ?array{run: TemplateRun, item: ?WorkItem}` (öffentlich statisch, ohne Recht, auch für Task 8): (1) ohne Sperre: Eingabe aus dem Payload (`TemplateRunError::input`: Titel gerendert am Termin bzw. jetzt, Daten ab dem Tag des Termins; gelöschte Labels und Werte von Properties, die der Typ nicht hat, fallen weg, A340), `TemplateAttachments::copy` mit dem Standard-Bot als Schreiber; (2) `DB::transaction(…, 3)`: `CatalogLock::share()` → `MemberInput::lock($project)` (in Löschung → `null`, nichts) → Vorlage `lockForUpdate` frisch (weg → `null`) → archiviertes Projekt: manuell 409 `project_archived`, geplant `null` → bei `$scheduledFor`: `Recurrence::catchUp` unter der Sperre neu, anderer oder kein Termin → `next_run_at` neu, `null` → Laufzeile (`insert`; `UniqueConstraintViolationException` → `null`) → `App::setLocale(<Org-Sprache>)` für die Dauer → `CreateWorkItem::run(Actor::template($t), $input)` als Savepoint; `ValidationException`/`Problem` → Zeile `failed` mit `TemplateRunError::text($e, $payload, $catalog)` und `template.run_failed` (Subjekt Vorlage, `changes` `null`, `meta` `{run_id, error, scheduled_for, author_id}`); sonst `created` mit `work_item_id`; bei geplanten Läufen `last_run_at` = Termin, `run_count + 1`, `next_run_at` neu (manuelle ändern nichts davon, A338).
  - `TemplateRunError::text(ValidationException|Problem $e, array $payload, Collection $properties): string` (Port von `failureText`: fehlende Pflicht-Properties als `templates.run.required_missing` mit `:properties` (Labels in der Reihenfolge des Typs, durch Komma, die letzten zwei mit `templates.run.and`); sonst die erste Feldmeldung bzw. `detail`), `TemplateRunError::input(Template $t, DateTimeImmutable $at): array`.
  - `ListTemplateRuns::handle(Actor, Template, array $query): ListResult` (Recht `view`; `ran_at` roh als `ran_cursor` mit Mikrosekunden, dann `id`, absteigend).
- Consumes: Tasks 1, 3, 4, 6; `CreateWorkItem`.

- [ ] **Step 1: Failing Tests** — `RunTemplateTest`: „creates the item as the default bot via template, now“ (`created_by` = Standard-Bot, `template_id`, Event `via` `template`, Titel „Wartung KW 45“ am 2026-11-02); „fails when the assignee is no member any more, logs it in the language of the organisation and stays active“; „fails for a disabled type, an archived type, a missing required property (‚Pflicht-Property Umgebung fehlt‘), a deleted parent“; „drops a deleted label and a value of a property the type lost, and creates the item“; „writes template.run_failed with the run in the meta“; „a manual run changes neither run_count nor last_run_at nor next_run_at“; „refuses a viewer with 403 and an archived project with 409“; „copies the images for each run anew“. `ListTemplateRunsTest`: neueste zuerst, gleiche Sekunde, feste Abfragezahl. `TemplateRunRaceTest` (Integration, `RaceConnections`): „two runs of the same term create one item“ (`hold` sperrt die Vorlage, `second` wartet, findet die Zeile); „a run waits on the project while an item is being created there“; „a unique violation reads as done, not as a 500“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RunTemplate|TemplateRun|RightsMatrixTest|RouteMatrixTest'`; `ddev artisan test --testsuite=Integration --filter=TemplateRunRaceTest`.
- [ ] **Step 3: `CLAUDE.md`** — Abschnitt „Vorlagen: Läufe“ (Sperr-Reihenfolge Organisation → Projekt → Vorlage, Kopie vor der Sperre, Fehlertext, Zähler).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: run a template now with its run log and failures`.

---

### Task 8: Scheduler: fällige Termine, Nachholen, Zeitzonenwechsel

**Modell:** opus

**Files:**
- Create: `app/Actions/Templates/{RunScheduledTemplate,RunDueTemplates,RescheduleTemplates}.php`, `app/Jobs/RunTemplateJob.php`, `app/Console/Commands/RunTemplatesCommand.php`, `tests/Feature/Templates/{ScheduledRunsTest,RescheduleTemplatesTest}.php`, `tests/Feature/Console/RunTemplatesCommandTest.php`
- Modify: `routes/console.php`, `app/Actions/Organization/UpdateOrganization.php` (Zeitzone geändert → `RescheduleTemplates`), `app/Actions/Projects/ArchiveProject.php` (Wiederherstellen → `schedule_from` der Vorlagen = jetzt), Matrizen, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `RunDueTemplates::handle(Actor $actor, bool $inline = false): int` — Vorlagen mit `next_run_at <= now()`, nicht pausiert, Projekt weder archiviert noch in Löschung, höchstens `BATCH` 500, älteste zuerst; je Vorlage `RunTemplateJob::dispatch($id)` auf `default` bzw. mit `$inline` im eigenen Prozess (`RunScheduledTemplate::run`); gibt die Zahl zurück.
  - `RunScheduledTemplate::handle(Actor $actor, string $templateId): ?TemplateRun` — liest die Vorlage, `Recurrence::catchUp($schedule, max(last_run_at, schedule_from), now(), $zone, run_count)`, ohne Termin nur `next_run_at` neu (eigene kleine Transaktion mit Sperre), sonst `RunTemplate::run($t, $termin, null)`.
  - `RescheduleTemplates::handle(Actor $actor): int` — in der Transaktion von `UpdateOrganization` (nach dem Speichern der Zone): `schedule_from` = jetzt und `next_run_at` neu für jede Vorlage mit Zeitplan (A339); ohne Event je Vorlage (die Organisation schreibt `organization.updated`).
  - `RunTemplateJob(string $templateId)` (Queue `default`, `tries` 3, `backoff` 60/300 s; idempotent über Sperre und Index), `app:run-templates {--now}` (ohne `--now` stellt er Jobs ein, mit `--now` läuft er im Prozess und gibt „Ran N templates.“ aus), geplant `Schedule::command('app:run-templates')->everyMinute()->withoutOverlapping(5)`.
- Consumes: Tasks 1, 7.

- [ ] **Step 1: Failing Tests** — `ScheduledRunsTest` (Erfolgskriterium 3, Uhr gestellt): „runs on time“ (Montag 09:00:30 Berlin → ein Item, Titel der Woche, Standard-Bot); „runs a term once, however often the command runs“; „after an outage of three weeks catches up the last Monday only, then waits for the next“; „ends after N runs and catches up at most up to N“; „never runs a term before the schedule was saved or resumed“ (Vorlage am Mittwoch mit Start im Vergangenen gespeichert: kein Lauf für den letzten Montag); „skips archived projects and catches up nothing from before the restore“; „monthly on the 31st runs on 30 April“; „daily 02:30 runs at 03:30 on 2027-03-28 and once on 2026-10-25“; „counts in the zone of the organisation, not in UTC“ (New York). `RescheduleTemplatesTest`: „moves next_run_at when the organisation changes its zone and runs no extra term of the old calendar“ (Berlin 16:00 → New York: der 09:00-Termin New York von heute läuft nicht nachträglich). `RunTemplatesCommandTest`: `--now`, ohne `--now` (Jobs in `jobs` mit `config(['queue.default' => 'database'])`), Ausgabe.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ScheduledRuns|RescheduleTemplates|RunTemplatesCommand|UpdateOrganization|ArchiveProject'`.
- [ ] **Step 3: `CLAUDE.md`** — „Vorlagen: Scheduler“ (Kehrer jede Minute, Nachholen, `schedule_from`, Zeitzonenwechsel); Kommandos: `app:run-templates [--now]`; `routes/console.php`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: run due templates every minute and catch up the last missed term`.

---

### Task 9: Benachrichtigungen und Live für Vorlagen

**Modell:** opus

**Files:**
- Modify: `app/Domain/Notifications/{EventFacts,Recipients}.php` (`templateAuthorId`, `causedBy`), `app/Support/NotificationFacts.php` (`TELLING` + `template.run_failed`; `causedBy` aus `meta.on_behalf_of` für jedes Event), `app/Actions/Notifications/{NotifyRecipients,SendNotificationMail}.php` (Sammlung `template:<id>`), `app/Mail/NotificationDigest.php`, `resources/views/mail/notifications/{template,template-text}.blade.php` (neu), `app/Live/{LiveConsumer,LiveMessage}.php` (`template.*`, `automation.updated`), `tests/Unit/Domain/Notifications/RecipientsTest.php`, `tests/Feature/Notifications/{NotifyRecipientsTest,SendNotificationMailTest}.php`, `tests/Feature/Live/LiveConsumerTest.php`, `tests/Integration/NotificationMailTest.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `EventFacts` bekommt `public ?string $templateAuthorId = null`, `public ?string $causedBy = null` (letzte Konstruktor-Parameter mit Standard); `Recipients::of`: `template.run_failed` → `template_run_failed` an `leadId` und `templateAuthorId` (sonst niemand); `causedBy` fällt wie der Actor heraus (A342).
  - `NotificationFacts::of`: `template.run_failed` liest Projekt und Lead, `meta.author_id`; `data` = `{template_id, error}`; `work_item_id` `null`.
  - Mail: Zeilen ohne Item mit Art `template_run_failed` kommen in die Sammlung `template:<template_id>`; `SendNotificationMail` prüft sie wie jede Zeile (Person aktiv, `Notification::visibleTo`, ungelesen, Mail an) und überspringt sie, wenn die Vorlage fehlt; `NotificationDigest` rendert sie mit Betreff `mail.notifications.template.subject` („[:identifier] Vorlage „:name“: Lauf fehlgeschlagen“), dem Satz des Fehlers und dem Link `APP_URL/projects/<KENNUNG>/templates/<id>` (A348).
  - `LiveConsumer`: `template.*` und `automation.updated` → `private-project.{project_id}` (Payload unverändert, A347).
- Consumes: Tasks 3, 7.

- [ ] **Step 1: Failing Tests** — `RecipientsTest`: „tells the lead and the author of a template about a failed run“, „tells nobody twice when the lead wrote the template“, „leaves out who the automation acted for“. `NotifyRecipientsTest` (`consumers(NotificationConsumer::class)`): echter gescheiterter Lauf → zwei Inbox-Zeilen mit `data.template_id`/`error`; ein Lead ohne Zugriff (privates Projekt, deaktiviert) bekommt nichts; die Einstellung „template_run_failed: inbox aus“ gilt (13c „failed-template notifications bypass preferences“). `SendNotificationMailTest`: Mail mit Betreff und Link (Mail für die Art eingeschaltet), keine Mail nach Löschen der Vorlage (`skipped`). `LiveConsumerTest`: `template.updated` an den Projektkanal, `automation.updated` ebenso, Suche übergeht beide. `NotificationMailTest` (Integration, Mailpit): die Vorlagen-Mail kommt an.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Recipients|NotifyRecipients|SendNotificationMail|LiveConsumer|SearchConsumer'`; `ddev artisan test --testsuite=Integration --filter=NotificationMailTest`; danach `ddev restart`.
- [ ] **Step 3: `CLAUDE.md`** — „Benachrichtigungen: Regeln/Mail“ (`template_run_failed`, Sammlung `template:<id>`, `causedBy`), „Live: Konsument“ (`template.*`, `automation.updated`).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: tell the lead and the author about failed template runs`.

---

### Task 10: Automatisierungen einstellen (REST) und dem Workflow folgen

**Modell:** opus

**Files:**
- Create: `app/Support/ProjectAutomations.php`, `app/Actions/Automations/{ListAutomations,SaveAutomation,FollowWorkflow}.php`, `app/Http/Controllers/Api/AutomationsController.php`, `app/Http/Resources/AutomationResource.php`, `tests/Feature/Automations/{SaveAutomationTest,FollowWorkflowTest}.php`, `tests/Feature/Api/AutomationsApiTest.php`
- Modify: `app/Events/EventType.php` (`AutomationUpdated`, ohne Webhook), `app/Actions/Projects/AssignWorkflow.php`, `app/Actions/Workflows/SaveWorkflow.php`, `routes/api.php`, Matrizen, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `ProjectAutomations::of(string $projectId): array<string, Automation>` (eine Abfrage; fehlende Schlüssel als ungespeicherte Modelle mit `AutomationKey::defaults()`, `enabled` false), `ProjectAutomations::enabled(string $projectId, AutomationKey $key): ?Automation`.
  - `ListAutomations::handle(Actor, Project|string): list<Automation>` (Recht `view` am Projekt), `SaveAutomation::handle(Actor $actor, Project|string $project, string $key, array $input): Automation` (Recht `manageAutomations`; `enabled` boolean, `settings.days` 1–3650 für `daily()`, `settings.state_id` ein Canceled-Status des Workflows des Projekts, Pflicht zum Einschalten von Auto-Close; Transaktion mit `MemberInput::lock`; `upsert` über (`project_id`, `key`); `automation.updated` mit `changes` `{enabled, days, state_id}` nur bei Änderung, Subjekt die Automatisierung; ein archiviertes Projekt bleibt für Admins änderbar).
  - `FollowWorkflow::handle(Actor $actor, Project $locked, array $stateMap, Workflow $workflow, string $reason): void` (Auto-Close: `state_id` → `stateMap[alt]`, wenn das ein Canceled-Status ist, sonst der erste Canceled-Status des Workflows, sonst `enabled` false und `state_id` `null`; `automation.updated` mit `meta.reason` `workflow_changed` bzw. `state_removed`), gerufen von `AssignWorkflow` (vor `project.updated`) und von `SaveWorkflow` für jedes Projekt des Workflows, dessen Auto-Close-Status entfällt.
- Consumes: Tasks 2, 3.

- [ ] **Step 1: Failing Tests** — `SaveAutomationTest`: „lists four automations, all off, for a new project“; „switches Auto-Archive on with 30 days and writes one event“; „refuses days below 1 and a state that is not canceled“; „refuses to switch Auto-Close on without a state“; „lets a member read, not change (403 automations_admins_only)“; „writes no event when nothing changes“. `FollowWorkflowTest`: Zuordnung auf einen Canceled-Status übernommen; Zuordnung auf Completed → erster Canceled-Status; Workflow ohne Canceled → aus; `SaveWorkflow` entfernt den Status → folgt, Events mit Grund. `AutomationsApiTest`: Formen, unbekannter `{key}` 404, Lese-Token.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Automation|AssignWorkflow|SaveWorkflow|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Abschnitt „Automatisierungen: Einstellungen“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: switch project automations and follow a workflow change`.

---

### Task 11: Automatisierungen eines Zugs: Assignee beim Start, Eltern schließen

**Modell:** opus

**Files:**
- Create: `app/Actions/Automations/RunMoveAutomations.php`, `tests/Feature/Automations/{AssignOnStartTest,CloseParentTest}.php`, `tests/Integration/CloseParentRaceTest.php`
- Modify: `app/Actions/WorkItems/TransitionWorkItem.php` (`move(…, int $chain = 0)` ruft nach einem Statuswechsel `RunMoveAutomations::run`), Matrizen, `CLAUDE.md`

**Interfaces:**
- Produces: `RunMoveAutomations::handle(Actor $actor, WorkItem $locked, WorkflowState $from, WorkflowState $to, int $chain = 0): void` (System-Action in der Transaktion des Zugs; öffentlich statisch `run` mit denselben Parametern):
  - `assign_on_start` (über `AssignOnStartRule`, nur Personen als Actor, Konto `Assignable` im Projekt): `assignee_id` = Person, `updated_at`, Beobachter `assigned` (Abmeldung aufgehoben, wie `UpdateWorkItem`), `work_item.assigned` mit `changes.assignee_id` durch `Actor::automation('assign_on_start')->onBehalfOf($person)`.
  - `close_parent` (Kategorie geschlossen, `parent_id`, `$chain < CloseParentRule::MAX_CHAIN`, Automatisierung im Projekt des Eltern-Items an): Eltern-Item frisch `lockForUpdate` (archiviert → nichts), dann die Kinder **mit `sharedLock`** samt Kategorie, `CloseParentRule::closes`, `target`, dann `TransitionWorkItem::move(Actor::automation('close_parent')->onBehalfOf(<Person, falls der Actor eine ist, sonst dessen onBehalfOf>), $parent, $target, null, chain: $chain + 1)`.
  - Kein Lauf für `RemapStates` (Workflow-Umbau ist keine Arbeit am Item) und nicht für gleiche Status.
- Consumes: Tasks 2, 10 (`ProjectAutomations::enabled`).

- [ ] **Step 1: Failing Tests** — `AssignOnStartTest`: „a person who starts an item nobody has becomes its assignee“ (Event des Standard-Bots, Grund, `on_behalf_of`, Person beobachtet); „not for a bot, not when assigned, not when off, not from started to started“; „also from the board's bulk move“ (`BulkUpdateWorkItems`). `CloseParentTest`: „closes the epic when its last open child is done“ (erster erlaubter Completed-Status, History des Epics mit Grund); „not when all children are canceled“; „not when the workflow forbids the move, the epic stays open“; „not for an archived epic“; „not when off“; „closing a child by Auto-Close counts too“; Benachrichtigung: die Person, die das letzte Kind schloss, bekommt keine `state_changed` des Epics, ein anderer Beobachter schon (`consumers(NotificationConsumer::class)`). `CloseParentRaceTest` (Integration): „two people closing the last two children at once close the epic exactly once“ (zwei Verbindungen; Deadlock oder Warten, Ergebnis: ein `work_item.state_changed` am Epic).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='AssignOnStart|CloseParent|TransitionWorkItem|BulkUpdate|RightsMatrixTest'`; `ddev artisan test --testsuite=Integration --filter='CloseParentRaceTest|ItemTransactionRetryTest'`.
- [ ] **Step 3: `CLAUDE.md`** — „Status, Resolution und Typ“: `move(…, chain)` und die Automatisierungen eines Zugs; Sperr-Reihenfolge Kind → Eltern-Item → Kinder geteilt.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: assign on start and close the parent when its children are done`.

---

### Task 12: Tägliche Automatisierungen: Auto-Archiv, Auto-Close

**Modell:** opus

**Files:**
- Create: `app/Actions/Automations/RunDailyAutomations.php`, `app/Jobs/RunDailyAutomationsJob.php`, `app/Console/Commands/RunAutomationsCommand.php`, `tests/Feature/Automations/{AutoArchiveTest,AutoCloseTest,DailyAutomationsTest}.php`, `tests/Feature/Console/RunAutomationsCommandTest.php`
- Modify: `routes/console.php`, Matrizen, `lang/{en,de}.json` (`automations.auto_close.comment`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `RunDailyAutomations::handle(Actor $actor, CarbonImmutable $hourUtc, bool $force = false): array{archived: int, closed: int, skipped: int}` — ohne `$force` nur, wenn `NightlyRun::isDue($hourUtc, <Org-Zone>)`; je Projekt (weder archiviert noch in Löschung) mit der Automatisierung an, Kandidaten per `chunkById` in Blöcken zu `BLOCK` 200, je Item eine `DB::transaction(…, 3)` mit `ItemLock::take` und erneuter Prüfung: Auto-Archiv über `ArchiveWorkItem::apply(Actor::automation('auto_archive'), …)`; Auto-Close über `TransitionWorkItem::move(Actor::automation('auto_close'), …, $stateId, null)` (409 `transition_not_allowed` → `skipped`, nichts geschrieben), danach `AddComment::run` als derselbe Actor mit `__('automations.auto_close.comment', ['days' => $days], <Org-Sprache>)` (A344). Letzte Aktivität für Auto-Close = `greatest(work_items.updated_at, max(comments.created_at))`.
  - `RunDailyAutomationsJob(CarbonImmutable $hourUtc)` (Queue `bulk`, Middleware `WithoutOverlapping('daily-automations')`), geplant stündlich wie `SendDueRemindersJob` (mit `now()->utc()->startOfHour()`); `app:run-automations {--now}` (im Prozess, `force`), Ausgabe „Archived N, closed N, skipped N.“.
- Consumes: Tasks 2, 10, 11.

- [ ] **Step 1: Failing Tests** — `AutoArchiveTest`: „archives items closed for 30 days, not 29“; „leaves open items, archived projects and projects being deleted alone“; History mit Grund. `AutoCloseTest`: „cancels a backlog item untouched for 90 days and comments why“ (Kommentar des Standard-Bots in der Sprache der Organisation, Event-Reihenfolge Zug vor Kommentar); „counts a comment as activity“; „skips an item the workflow does not let move, without comment“; „leaves started items alone“; „closing the last open child closes the epic when close_parent is on“. `DailyAutomationsTest`: „acts at 03:00 in the zone of the organisation only“ (Berlin Winter 02:00 UTC ja, 03:00 UTC nein; New York); „a second run the same night changes nothing“. `RunAutomationsCommandTest`: `--now`, Ausgabe.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='AutoArchive|AutoClose|DailyAutomations|RunAutomationsCommand|RightsMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — „Automatisierungen: täglich“; Kommandos `app:run-automations [--now]`; `routes/console.php`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: archive and close items every night at 03:00 in the organisation's zone`.

---

### Task 13: Web-Route, Demo-Daten, e2e-Helfer

**Modell:** sonnet

**Files:**
- Create: `app/Http/Controllers/TemplatesPageController.php`, `resources/js/pages/Templates/Index.tsx` (rendert bis Task 15 nur ein Skelett mit der Überschrift „Vorlagen“; Task 15 setzt `TemplatesScreen` ein), `database/seeders/Demo/{TemplatesSeeder,AutomationsSeeder}.php`, `tests/Feature/Pages/TemplatesPageTest.php`, `tests/Feature/Seeders/{TemplatesSeederTest,AutomationsSeederTest}.php`
- Modify: `routes/web.php` (`GET /projects/{identifier}/templates/{templateId?}`, Name `projects.templates`), `database/seeders/DemoSeeder.php`, `database/seeders/Demo/{ItemsSeeder,NotificationsSeeder}.php` (`template_id`), `e2e/helpers.ts` (`createE2eTemplate`, `makeTemplateDue`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `TemplatesPageController`: wie `WikiPageController` (frühere Kennung → 301 mit `no-store`, unsichtbar/unbekannt → `Errors/NotFound`), Props `identifier` (kanonisch), `templateId` (`new`, eine ULID klein, sonst der Text; ohne `null`).
  - `TemplatesSeeder` (nach `ItemsSeeder`): die drei Vorlagen aus `workspace.ts` (Wöchentliche Wartung, Monatsbericht, Zertifikate prüfen; `rt(…)` als Tiptap-JSON), `schedule_from` = `created_at`, `run_count`, `last_run_at`, `next_run_at` über `TemplateSchedule::nextRunAt` zur Zeit des Seedens; die sieben Läufe (`ItemsSeeder::at()`, Items per Key); setzt `template_id` von WEB-34, -38, -46, -52, APP-4, -8, wo es leer ist; legt nur fehlende (Projekt, Name) an (wie K13). `AutomationsSeeder`: WEB `auto_archive` (30) und `assign_on_start` an, APP `auto_close` (90, Cancelled der Agentur-Freigabe) und `close_parent` an, OPS alles aus; nur fehlende Zeilen. `NotificationsSeeder`: `template_run_failed` bekommt `template_id` von „Zertifikate prüfen“.
  - `createE2eTemplate(page, projectId, { name, title, schedule?, type?, assignee_id?, description_json? }): Promise<{ id }>`; `makeTemplateDue(id, termUtc: string)` (über `artisanEval`: `schedule_from` und `last_run_at` davor, `next_run_at` = Termin).
- Consumes: Tasks 3–8, 10.

- [ ] **Step 1: Failing Tests** — `TemplatesPageTest`: kanonisch, 301 bei früherer Kennung, 404 privat fremd, `templateId` `new`/ULID/Text. `TemplatesSeederTest` (liest `workspace.ts`): Namen, Titel, Zeitpläne, Läufe, `template_id` der sechs Items, zweiter Lauf ändert nichts. `AutomationsSeederTest` (liest `config.ts`).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='TemplatesPage|Seeder'`; `ddev artisan migrate:fresh --seed --seeder=DemoSeeder`.
- [ ] **Step 3: Bestehende e2e gegen die neuen Demo-Automatisierungen** — `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test board items items-list bulk inbox live` (Projekt `chromium`); was jetzt anders ist, prüft die Spec ausdrücklich oder verlegt sie in ein `E2E`-Projekt (Global Constraints).
- [ ] **Step 4: `CLAUDE.md`** — „Seeder“ (`TemplatesSeeder`, `AutomationsSeeder`), e2e-Helfer.
- [ ] **Step 5: Gates G1**
- [ ] **Step 6: Commit** — `feat: add the templates page route, demo templates and automations`.

---

### Task 14: Frontend-Datenschicht: Vorlagen, Läufe, Automatisierungen, Live

**Modell:** sonnet

**Files:**
- Create: `resources/js/api/{templates,automations}.ts` (+ `.test.ts`), `resources/js/hooks/{templates,automations}.ts` (+ Tests in `hooks/data.test.tsx` oder eigene)
- Modify: `resources/js/types.ts` (`TemplatePayload.description` Markdown + `description_json`, `values_markdown`; `TemplateRun` mit `scheduled_for: string | null`, `ran_at`, `triggered_by`; `TemplateDraft`; `SchedulePreview`; `HistoryEntry.template`; `WorkItem.template_id`-Kommentar), `resources/js/hooks/live.ts` (Keys aus „Live“), `resources/js/test/fixtures.ts` (`makeTemplate`, `monatsbericht`, `makeTemplateRun`, `makeAutomation`), `CLAUDE.md`

**Interfaces:**
- Produces: `listTemplates(project_id?)`, `saveTemplate(input: TemplateInput)` (ohne `id` `POST /projects/<id>/templates`, sonst `PUT /templates/<id>`; Beschreibung als `description_json`), `deleteTemplate(id)`, `runTemplateNow(id)` → `{run, item}`, `listTemplateRuns(template_id)` (alle Seiten), `templateDraft(id)` → `TemplateDraft`, `previewSchedule({ schedule, title?, run_count? })` → `{runs, title}`; `listAutomations(project_id)`, `saveAutomation({ project_id, key, enabled, settings })`. Hooks: `useTemplates(projectId?)` (`qk.templates.list({ project })`, alle Seiten), `useTemplateRuns(templateId)`, `useSchedulePreview(input | null)` (`qk.templates.preview(input)`, `keepPreviousData`, Pause 250 ms über `useAsked`-Muster), `useSaveTemplate`, `useDeleteTemplate`, `useRunTemplateNow` (machen `templates`, `templateRuns`, `workItems`, `activity`, `search` ungültig; 13c „search stale after template runs“), `useAutomations(projectId)`, `useSaveAutomation` (je Schlüssel einer zur Zeit, Mutation-Key `qk.automations.save(project, key)`).
- Consumes: REST der Tasks 4, 6, 7, 10.

- [ ] **Step 1: Failing Tests** — API: Pfade, Bodies, `PUT` ohne `id` im Body, `scheduled_for` `null`; Hooks: Invalidierung, `useSchedulePreview` fragt nichts für `null` und nur die letzte Eingabe; `useLiveSync`: `template.updated` → `qk.templates.all`, `automation.updated` → `qk.automations.all`, `work_item.created` → zusätzlich `qk.templateRuns.all`.
- [ ] **Step 2: Rot, implementieren, grün; Gates G2**
- [ ] **Step 3: Commit** — `feat: add the templates and automations data layer`.

---

### Task 15: Vorlagen I: Bildschirm, Liste, Löschen, Seitenleiste

**Modell:** opus

**Files:**
- Create: `resources/js/features/templates/{TemplatesScreen,TemplateList,TemplateRow,RunLog}.tsx`, `resources/js/features/templates/{format,rights,scheduleText}.ts`, `resources/js/features/templates/{screen,scheduleText}.test.ts(x)`, `e2e/tests/templates.spec.ts`
- Modify: `resources/js/pages/Templates/Index.tsx`, `vitest.config.ts` (Schwelle `features/templates/**`), `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces: `TemplatesScreen({ identifier, templateId })` (Projekt über `useProject`, 404 → `NotFound` `templates.not_found.*`, Kennung kanonisch per `router.replace`), Liste nach Name (`Intl.Collator(intlLocale())`) mit Typ-Glyph, Name als Link (`paths.templates(identifier, id)`), `describeSchedule` (Port `scheduleText.ts`, Texte `schedule.*`, Wochentage und Monate über `t`), nächster Lauf (`next_run_at`, `formatMoment` in der Zone der Organisation), „Pausiert“ (nur, was `TemplateResource` trägt; kein Protokoll je Zeile, P4), leer `templates.empty.*` mit „Neue Vorlage“ (nur mit `template.manage`), Skelett, Fehler mit „Erneut versuchen“; Löschen über `runWithUndo` (5 s, Zeile sofort weg, Fokus auf die Nachbarzeile, sonst „Neue Vorlage“, sonst die Überschrift). `useTemplateRights(projectId)` (wartet auf die Rechte wie `useOrgRight`). `RunLog({ templateId })` (Liste `role="list"` „Läufe“, je Lauf Zeit, „geplant“/„von Hand von :name“, Ergebnis mit Link auf das Item bzw. Fehler; leer, Skelett, Fehler). Palette: `templates.create` („Neue Vorlage“, mit Recht).
- Consumes: Task 14.

- [ ] **Step 1: Failing Tests** — Vitest: Liste mit drei Demo-Vorlagen (Satz „Jeden Monat am ersten Montag um 09:00“), pausiert, Viewer ohne „Neue Vorlage“ mit Lesehinweis, Löschen mit ⌘Z und Fehler (Zeile zurück, „Erneut versuchen“), Fokus nach dem Löschen. `scheduleText.test.ts` portiert `scheduleText.test.ts` (Texte über Schlüssel). e2e `templates.spec.ts` (eigenes Projekt): „lists templates and deletes one with undo, keyboard only“.
- [ ] **Step 2: Rot, implementieren, grün; Gates G2, G3 gezielt** (`templates shell`)
- [ ] **Step 3: Commit** — `feat: list the templates of a project`.

---

### Task 16: Vorlagen II: Editor, Platzhalter, Speichern mit ⌘⏎, Jetzt ausführen

**Modell:** opus

**Files:**
- Create: `resources/js/features/templates/{TemplateEditor,TemplateFields,TitleField,TemplateProperty}.tsx`, `resources/js/features/templates/editor.test.tsx`
- Modify: `resources/js/lib/shortcuts/{catalog.ts,catalog.test.ts}` (`template.save`, `SHARED`), `docs/{en,de}/keyboard.md` (über `shortcuts:doc`), `e2e/tests/templates.spec.ts`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces: `TemplateEditor({ project, template | null, denied })`: Name, Typ (aktiviert, aktiv; ein archivierter gespeicherter bleibt mit Hinweis), Titel mit Platzhalter-Chips (`TitleField`: fügt an der Einfügemarke ein) und Vorschau „So heißt das nächste Item: …“ aus `useSchedulePreview` (Titel am nächsten Termin, ohne Zeitplan jetzt), Beschreibung (`RichTextEditor` `description` mit `projectId`, in einem eigenen `UploadContext`; 13c), Priorität, Assignee (`useProjectPeople`), Labels, Eltern (Epics, ausgeblendet bei Epic-Typ), Start/Due als „+N Tage“ (`OffsetField`, 0–3650), Properties des Typs über `PropertyValueInput` (Pflicht ohne Wert markiert: „Ein Lauf schlägt fehl, solange … fehlt“), dann der Zeitplan (Task 17) und das Protokoll. Speichern ausdrücklich (A336): Knopf „Speichern“/„Anlegen“, Kürzel `template.save` (Katalog; gehaltene Taste speichert einmal, 13c), ein Druck je Aufruf, `LeaveGuard` (`what` `templates.leave`); 422 je Pfad am Feld mit Fokus (`payload.title`, `payload.values.<key>`, `schedule.<feld>`), andere 4xx als Banner, 5xx als `notifyError` mit „Erneut versuchen“; neue Vorlage → `router.visit(paths.templates(identifier, id), { replace: true })` und Fokus auf die Überschrift (`focusWhenLost`, ersetzt `watchLostFocus`, 13c). „Jetzt ausführen“ (gesperrt mit Grund bei ungespeicherten Änderungen oder ohne Recht): Toast „:key angelegt“ mit „Öffnen“ (`openPeek`) bzw. „Lauf gescheitert“ mit dem Satz; Palette `template.run`, `template.delete`. Viewer lesen alles schreibgeschützt.
- Consumes: Tasks 14, 15.

- [ ] **Step 1: Failing Tests** — Vitest: Felder je Typ, Platzhalter an der Einfügemarke, Vorschau des Titels, „held mod+enter saves once“, Speichern mit 422 am Titel und an `schedule.time`, Verlassen fragt, „Jetzt ausführen“ (Erfolg, gescheitert, gesperrt bei ungespeichert), Viewer. e2e: „creates a template with the keyboard and runs it now“ (Item von „Automation“ in der Vorschau).
- [ ] **Step 2: Rot, implementieren, grün; `ddev exec pnpm shortcuts:doc`; Gates G2, G3 gezielt** (`templates`)
- [ ] **Step 3: Commit** — `feat: edit templates with placeholders and run them now`.

---

### Task 17: Zeitplan-Editor mit den nächsten fünf Terminen

**Modell:** opus

**Files:**
- Create: `resources/js/features/templates/{ScheduleEditor,ScheduleFields,TimeField,NextRuns}.tsx`, `resources/js/features/templates/scheduleForm.ts`, `resources/js/features/templates/schedule.test.tsx`
- Modify: `resources/js/features/templates/TemplateEditor.tsx`, `e2e/tests/templates.spec.ts`, `lang/{en,de}.json`

**Interfaces:**
- Produces: `ScheduleEditor({ schedule, onChange, readOnly, runCount, errors })` (Port, geteilt): Schalter „Wiederholen“, Frequenz, „alle N …“ (`WholeNumber`), Wochentage (Toggle-Knöpfe Montag zuerst, Werte 0 = Sonntag), monatlich „am Tag“ (1–31, „letzter“) oder „am n-ten Wochentag“, jährlich Datum, Uhrzeit (`TimeField`, `normalizeTime`: „9“, „9:5“, „0930“), Zeitzone der Organisation als Text, Beginn, Ende (nie, am, nach N Läufen), Pause. `NextRuns({ schedule, runCount, title })` aus `useSchedulePreview` (Liste `role="list"` „Nächste Termine“, Tag und Uhrzeit in der Zone der Organisation; pausiert/keine/ungültig mit Satz; Skelett beim ersten Laden, danach bleibt die alte Liste bis zur Antwort). `scheduleForm.ts` (`defaultSchedule(today)`, `withFrequency`).
- Consumes: Tasks 14, 16.

- [ ] **Step 1: Failing Tests** — Vitest: jede Frequenz baut die erwartete Normalform; Wochentag-Knöpfe; „letzter“; n-ter Wochentag; Zeit-Eingaben; Vorschau zeigt die Antwort des Servers (`mockApi` `POST /api/v1/templates/preview`), fragt nach einer Pause einmal, zeigt „Pausiert: keine Termine“. e2e (Flow 6, A351): „shows the next five runs of a monthly schedule on the first Monday“ — Zeitplan monatlich, erster Montag, 09:00, Beginn 2036-11-01 → 03.11.2036, 01.12.2036, 05.01.2037, 02.02.2037, 02.03.2037 (in der Sprache der e2e-Organisation formatiert).
- [ ] **Step 2: Rot, implementieren, grün; Gates G2, G3 gezielt** (`templates`)
- [ ] **Step 3: Commit** — `feat: edit a template's schedule with its next five runs`.

---

### Task 18: Vorlage anwenden: Anlegen-Dialog, Palette, Inbox, Aktivität

**Modell:** opus

**Files:**
- Create: `resources/js/features/templates/applyTemplate.tsx` (+ Test)
- Modify: `resources/js/features/create-item/{CreateForm,draft}.ts(x)`, `resources/js/features/create-item/create.test.tsx`, `resources/js/shell/bindings.tsx` (Befehl registrieren), `resources/js/features/inbox/{NotificationRow,notifications}.ts(x)` (`hrefOf`), `resources/js/features/item-detail/activity/{phrases,EventLine}.tsx` (Gründe `auto_archive`, `auto_close`, `close_parent`, `template`; „aus Vorlage „:name““), `e2e/tests/{create-item,palette,inbox}.spec.ts`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `CreateForm`: Feld „Vorlage“ (`Select`, Vorlagen des gewählten Projekts aus `useTemplates(projectId)`; „Keine Vorlage“, „Lädt …“, „Keine im Projekt“); die Wahl holt `templateDraft(id)` (Fehler: Toast mit „Erneut versuchen“), füllt Typ, Titel, Beschreibung, Felder, Daten, Werte und `templateId` und sagt per Toast „Vorlage „:name“ angewendet“; ein Projektwechsel leert `templateId`; `defaults.template_id` wendet einmal an; „Anlegen“ schickt `template_id`. `draft.ts` kennt `templateId` (Parken und „Rückgängig“ behalten ihn).
  - `applyTemplate.tsx`: Palette-Befehl `items.apply_template` „Vorlage anwenden …“ (A215) mit Unterliste aller Vorlagen aus `useTemplates()` in Projekten mit `item.create` (je Vorlage mit Projekt), Wahl → `openCreate({ project_id, template_id })`; ist keine anwendbar, sagt ein Toast warum (keine Vorlagen bzw. nur in Projekten, in denen du nicht anlegen darfst, mit nächstem Schritt, 13c).
  - Inbox: `template_run_failed` mit `template_id` → `paths.templates(identifier, template_id)`, sonst die Liste der Vorlagen des Projekts.
  - Aktivität: Gründe als `items.activity.reason.<code>`, `via` `template` mit `event.template?.name`.
- Consumes: Tasks 6, 14, 15.

- [ ] **Step 1: Failing Tests** — Vitest: Dialog wendet an, Projektwechsel leert, Rückgängig behält die Vorlage, Fehler beim Entwurf; Palette mit und ohne anwendbare Vorlage (Viewer: Toast mit Grund); Inbox-Link; Aktivität „Automation hat den Status von … geändert. Automatisierung: Eltern schließen“. e2e: `create-item.spec.ts` „applies a template in the dialog and creates the item with a copy of its image“; `palette.spec.ts` „Vorlage anwenden … opens the dialog with the template“; `inbox.spec.ts` Zeile einer fehlgeschlagenen Vorlage führt zur Vorlage.
- [ ] **Step 2: Rot, implementieren, grün; Gates G2, G3 gezielt** (`create-item palette inbox`)
- [ ] **Step 3: Commit** — `feat: apply templates from the create dialog and the palette`.

---

### Task 19: Projekteinstellungen: Automatisierungen

**Modell:** opus

**Files:**
- Create: `resources/js/features/settings/project/{Automations.tsx,automationRules.ts}` (+ Tests), `e2e/tests/automations.spec.ts`
- Modify: `resources/js/features/settings/project/{ProjectSettings,Workflow}.tsx` (Abschnitt `automations`, Hinweis im Dialog „Workflow wechseln“), `resources/js/features/settings/catalog/StateMappingDialog.tsx` (optional `notice`), `resources/js/features/settings/project/project.test.tsx` (der Test „unknown section“ nimmt einen anderen Namen), `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces: `Automations({ project })` (Port): vier Zeilen mit Schalter (wirkt sofort), Beschreibung, Tage (`parseDays`, Enter oder Verlassen übernimmt) und Canceled-Status für Auto-Close (`cancelTargets`; ohne einen ist der Schalter gesperrt mit Grund); Banner „Auto-Close überspringt Items in …“ (`skippedByAutoClose`); Toast „:name gespeichert“, 422 am Feld, sonst `notifyError`; **kein doppeltes Speichern** (13c): je Automatisierung ein Aufruf zur Zeit, ein zweiter Commit desselben Werts entfällt, ein anderer wartet (`inTurn`); wer nicht verwaltet, liest im Lese-Look mit `ReadOnlyBanner`. Im Dialog „Workflow wechseln“ ein `Banner role="status"`, wenn Auto-Close an ist: „Auto-Close nimmt danach „:state““ bzw. „Auto-Close wird ausgeschaltet: … hat keinen Canceled-Status“ (A345).
- Consumes: Tasks 10, 14.

- [ ] **Step 1: Failing Tests** — Vitest: Schalter, Tage (Enter + Blur speichert einmal), Status, gesperrt ohne Canceled-Status, Lese-Look für Members, Hinweis im Workflow-Wechsel. e2e `automations.spec.ts` (eigenes Projekt, Erik Admin): „switches Assignee beim Start on with the keyboard; a person who starts an item becomes its assignee“; „Eltern schließen closes the epic when its last child is done“; „Auto-Archiv archives an item closed long ago“ (`artisanEval` setzt `closed_at` zurück, `artisan('app:run-automations', '--now')`, History „Automatisierung: Auto-Archiv“).
- [ ] **Step 2: Rot, implementieren, grün; Gates G2, G3 gezielt** (`automations projects`)
- [ ] **Step 3: Commit** — `feat: switch project automations in the settings`.

---

### Task 20: Abnahme: Erfolgskriterium 3, Flow 6, Lauf mit Fehler

**Modell:** opus

**Files:**
- Create: `tests/Feature/Api/TemplatesAcceptanceTest.php`, `e2e/tests/templates-acceptance.spec.ts`
- Modify: `CLAUDE.md` (e2e)

**Interfaces:**
- Produces:
  - `TemplatesAcceptanceTest` (REST, Uhr gestellt, `consumers(NotificationConsumer::class)`): ein Token von Mara legt eine Vorlage „Wartung KW {week}“ mit Zeitplan wöchentlich Montag 09:00 und einem Bild (Markdown `![x](attachment:…)`) an; Montag 09:00:30 `app:run-templates --now` → genau ein Item „Wartung KW 45“ von „Automation“ mit Kopie des Bilds; zweiter Lauf → keins; drei Wochen ohne Scheduler → genau eins für den letzten Montag; Assignee aus dem Projekt entfernt → nächster Lauf `failed`, Inbox von Lead und Mara mit `template_run_failed`; `GET …/runs` zeigt alle Läufe; die Vorlage ist weiter aktiv (`next_run_at` gesetzt).
  - `templates-acceptance.spec.ts` (eigenes Projekt, `inbox-<variante>` als Lead): „Erfolgskriterium 3: a due template creates its item once, as the default bot“ (`createE2eTemplate`, `makeTemplateDue`, zweimal `artisan('app:run-templates', '--now')` → ein Item in der Liste, History „Automation“, Protokoll ein Lauf); „a template that fails at run time tells the lead live“ (Pflicht-Property ohne Wert, Lauf → Badge und Inbox-Zeile ohne Neuladen, Klick führt zur Vorlage mit dem Fehler im Protokoll).
- Consumes: alles Vorige.

- [ ] **Step 1: Tests schreiben, laufen lassen** — `ddev artisan test --filter=TemplatesAcceptanceTest`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test templates-acceptance` (alle vier Projekte).
- [ ] **Step 2: Gates G1, G3 gezielt** (`templates-acceptance templates automations create-item palette inbox`)
- [ ] **Step 3: Commit** — `test: accept scheduled templates, catch-up and failed runs end to end`.

---

### Task 21: Doku, `CLAUDE.md`, Rulings, Spec

**Modell:** opus

**Files:**
- Create: `docs/{en,de}/concepts/{templates,automations}.md`
- Modify: `docs/.vitepress/config.ts`, `docs/{en,de}/concepts/{notifications,permissions,work-items}.md` (fehlgeschlagene Vorlage, Rechte, `template_id`), `docs/{en,de}/keyboard.md` (nur über `shortcuts:doc`), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md`

**Interfaces:**
- Produces:
  - `concepts/templates` (en + de, gleiche Überschriften, `DocsTest`): Vorlage anlegen, Platzhalter (Tabelle mit Beispielen, Sprache der Organisation), Offsets, Bilder (Kopie beim Anwenden), anwenden (Dialog, Palette), Zeitplan (Frequenzen, Uhrzeit in der Zone der Organisation, Sommerzeit, 31./„letzter“, Ende, Pause, nächste Termine), Ausführung (pünktlich, ein Item je Termin, Nachholen nur des letzten, nach Speichern/Fortsetzen nichts rückwirkend, Zeitzonenwechsel), Fehler und Protokoll, Rechte, REST mit `curl` (anlegen, Vorschau, Entwurf, jetzt ausführen, Läufe). `concepts/automations`: die vier, Grund in der History, Übergangsprüfung, 03:00, „letzte Aktivität“, Workflow-Wechsel, REST.
  - `CLAUDE.md`: „Stand“ (Phase 10 umgesetzt, als Nächstes Phase 11), Architektur, Kommandos (`app:run-templates`, `app:run-automations`), Fallstricke (Uhr in Tests über `travelTo` in UTC; e2e kann die Uhr des Servers nicht stellen; Demo-Automatisierungen in WEB und APP).
  - Rulings `A335`–`A354` (Liste unten, Anpassungen aus der Umsetzung); „Für spätere Phasen vorgemerkt“: Zeile Phase 10 entfernen; Phase 11 (Webhook-`data` für `template.run_failed` = `TemplateRunResource` samt Vorlage; `actor` Standard-Bot; `meta.on_behalf_of` nie ausgeben), Phase 13 (MCP-Tools `templates`/`manage-templates` mit `run`, `preview`, `draft`; `automations`/`manage-automations`), Phase 14 (Scheduler-Container: `app:run-templates` jede Minute, `RunDailyAutomationsJob` stündlich; Worker auf `default` und `bulk`), Phase 15 (Last: viele Vorlagen mit Zeitplan zur selben Minute, Auto-Close über 50 000 Items, Kopien vieler Bilder je Lauf).
  - Spec „Änderungen vom <Tag> (Phase 10)“ zur Bestätigung: A336, A337, A338, A339, A340, A342, A344, A348.
- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 2: Abnahme der Phase** (ohne vollen G3)

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev restart
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build
E2E_COVERAGE=0 pnpm --dir e2e exec playwright test templates-acceptance templates automations create-item palette inbox board
ddev exec pnpm --dir docs build
```

Expected: alles grün. Von Hand: `/projects/APP/templates` → „Monatsbericht“ zeigt fünf erste Montage; „Jetzt ausführen“ legt „Monatsbericht November 2026“ als „Automation“ an; `/projects/OPS/templates` → „Zertifikate prüfen“ mit dem gescheiterten Lauf; Mara bekommt nach „Jetzt ausführen“ von „Zertifikate prüfen“ eine Inbox-Zeile, die dorthin führt; in APP ein Kind eines Epics auf Done → das Epic folgt mit „Automatisierung: Eltern schließen“.

- [ ] **Step 3: Commit** — `docs: add templates and automations, update CLAUDE.md, the rulings and the spec for phase 10`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und **parallel im Hintergrund der volle G3**; beide Ergebnisse gehen in die eine finale Fix-Welle.

---

## Vorschläge für neue Rulings (ab A335)

- **A335 · Termine, Platzhalter und Offsets rechnet nur der Server.** Der Browser bekommt die nächsten Termine und den Titel über `POST /api/v1/templates/preview`, die Felder einer angewendeten Vorlage über `GET /api/v1/templates/{id}/draft`; `recurrence.ts`, `placeholders.ts` und `tz.ts#toUtc` werden nicht nach `resources/js` portiert, nur der Text eines Zeitplans (`scheduleText.ts`). *Grund:* eine Regel an einer Stelle; zwei Ports (PHP und TS) liefen bei Sommerzeit, 31. und Monatsnamen auseinander, und was die Vorschau zeigt, muss genau das sein, was der Scheduler tut. *Falls falsch:* TS-Port mit geteilten Fixtures (wie `emoji-fixtures.json`) und Vorschau ohne Netz.
- **A336 · Der Vorlagen-Editor speichert ausdrücklich** (Knopf, ⌘⏎ einmal je Druck, Verlassen-Schutz) wie der Klickdummy und die Einstellungen, ohne Autosave und ohne `usePageSave`; zwei gleichzeitige Bearbeitungen: die letzte Speicherung gewinnt (ganzes `PUT`, A75). Überstimmt die Vormerkung aus Phase 9. *Grund:* eine halb getippte Vorlage mit Zeitplan liefe sonst schon los, und Spec 4.12 kennt weder Versionen noch Konflikte für Vorlagen. *Falls falsch:* `usePageSave` mit `updated_at` als Basis und 409 `template_conflict`.
- **A337 · Bilder werden beim Anwenden wirklich kopiert,** vor jeder Sperre als neue Anhänge ohne Besitzer des Schreibers (beim Lauf des Standard-Bots), die `AttachmentLinks` dann dem Item gibt; ein abgelehntes Anlegen hinterlässt Kopien, die der stündliche Job nach 24 h abräumt (A239). *Grund:* Spec 4.12 („Anhänge werden beim Anwenden kopiert“); geteilte Bilder (A233) hingen sonst an der Vorlage, und Dateien kopieren darf nie unter der Projektsperre laufen. *Falls falsch:* Items zeigen das Bild der Vorlage mit (A233), Löschen der Vorlage übergibt es.
- **A338 · Manuelle Läufe zählen nicht zum Zeitplan.** „Jetzt ausführen“ schreibt eine Laufzeile mit `scheduled_for = null` und `triggered_by`, ändert weder `run_count` noch `last_run_at` noch `next_run_at` und läuft als Standard-Bot (Recht `template.manage`); „endet nach N Läufen“ zählt geplante Läufe, auch gescheiterte. *Grund:* ein Test-Lauf darf den nächsten geplanten Termin nicht verschlucken; eindeutig bleibt `(template_id, scheduled_for)`. Der Klickdummy setzte `last_run_at` auch von Hand. *Falls falsch:* manuelle Läufe zählen und verschieben das Nachholen.
- **A339 · Nachgeholt wird nur, was nach dem Setzen des Zeitplans fällig wurde.** `schedule_from` = Zeitpunkt des Speicherns eines geänderten Zeitplans, des Fortsetzens nach Pause, des Wiederherstellens des Projekts und eines Zeitzonenwechsels der Organisation; nachgeholt wird der letzte Termin nach max(`last_run_at`, `schedule_from`). *Grund:* sonst legte eine neue Vorlage mit Beginn in der Vergangenheit sofort ein Item an, eine fortgesetzte Pause holte einen alten Termin nach, und ein Zeitzonenwechsel erzeugte für denselben Tag ein zweites Item. *Falls falsch:* der Klickdummy (ab `starts_on` bzw. `last_run_at`).
- **A340 · Veraltete Teile einer Vorlage fallen beim Lauf still weg, Fehlendes lässt ihn scheitern.** Gelöschte Labels und Werte von Properties, die der Typ nicht (mehr) hat, entfallen; Assignee ohne Zugang, Typ deaktiviert oder archiviert, Pflicht-Property ohne Wert, archivierte Option, Eltern-Item weg oder kein Epic, ein Titel über 255 lassen den Lauf scheitern. Der Satz steht in der Sprache der Organisation im Protokoll und in der Benachrichtigung. *Grund:* Spec 4.12 nennt genau die Fälle, in denen etwas fehlt; ein gelöschtes Label ließe sonst jeden Lauf für immer scheitern. *Falls falsch:* jede Abweichung scheitert.
- **A341 · Die Automatisierungen eines Zugs laufen in seiner Transaktion** (`TransitionWorkItem::move`), nicht über einen Konsumenten: „Eltern schließen“ sperrt das Eltern-Item nach dem Kind und liest die Kinder geteilt gesperrt; ein Deadlock zweier letzter Kinder löst die Wiederholung (`DB::transaction(…, 3)`) auf, das Epic schließt genau einmal. Höchstens 5 Ebenen (heute wirkt wegen zwei Ebenen nur eine). *Grund:* der Klickdummy wirkt sofort, die History zeigt Zug und Folge zusammen, und ein Konsument sähe Zwischenstände. *Falls falsch:* Konsument `automations` auf der Queue `default` (Folge kommt Sekunden später).
- **A342 · Was eine Person auslöst, trägt `meta.on_behalf_of`.** „Assignee beim Start“ und „Eltern schließen“ handeln als Standard-Bot (History „Automation … Automatisierung: …“), Benachrichtigungen lassen die auslösende Person aus wie einen Actor (`Actor::onBehalfOf`, `EventFacts::$causedBy`); Webhooks geben das Feld nie aus. *Grund:* Spec 4.14 („nie die Person, die die Änderung selbst ausgelöst hat“); der Klickdummy schickte ihr keine Zuweisung. *Falls falsch:* die Person bekommt „X hat dich zugewiesen“ über sich selbst.
- **A343 · Tägliche Automatisierungen um 03:00 Org-Zeit über einen stündlichen Job,** „seit N Tagen“ als Zeitpunkt minus N × 24 h; ein verpasster Lauf holt sich am nächsten Tag von selbst (die Schwelle bleibt erfüllt). Archivierte Projekte und Projekte in Löschung übergehen sie. *Grund:* gleiche Mechanik wie die Erinnerungen (A275, K10), eine Zeitzone je Organisation. *Falls falsch:* `dailyAt('03:00')->timezone(...)` im Scheduler.
- **A344 · Auto-Close zählt Kommentare als Aktivität** und schreibt seinen Bot-Kommentar nach dem Zug in der Sprache der Organisation; ein nicht erlaubter Übergang überspringt das Item ohne Kommentar. *Grund:* ein Item mit laufender Diskussion ist nicht „liegen geblieben“, und Kommentare ändern `updated_at` nicht (P1 aus Phase 7). *Falls falsch:* nur `updated_at` zählt (Spec-Wortlaut „nicht geändert“).
- **A345 · Workflow-Wechsel zieht Auto-Close nach:** der zugeordnete Status, wenn er Canceled ist, sonst der erste Canceled-Status, sonst wird Auto-Close ausgeschaltet; der Dialog „Workflow wechseln“ sagt es vorher. *Grund:* Vormerkung aus Phase 3/4; ein Status eines fremden Workflows ließe jeden Lauf ins Leere gehen. *Falls falsch:* Wechsel mit Auto-Close an wird abgelehnt, bis ein Status gewählt ist.
- **A346 · Automatisierungen in der API:** immer vier Einträge (fehlende Zeile = aus mit Standardwerten 30/90 Tage), `PUT …/automations/{key}` ersetzt Schalter und Einstellungen, Event `automation.updated` ohne Webhook; `template.created|updated|deleted` ebenfalls ohne Webhook (Spec 6.3 nennt nur `template.run_failed`). *Grund:* der Bildschirm zeigt immer vier Schalter; jede schreibende Action schreibt ein Event. *Falls falsch:* Zeilen beim Anlegen eines Projekts anlegen; Webhooks für Vorlagen.
- **A347 · Vorlagen live und nur als Liste:** `template.*` und `automation.updated` gehen an `project.{id}` (nur IDs); der Browser liest Vorlagen nur als Liste je Projekt, ein fremdes Löschen nimmt die Vorlage aus der Liste, ohne dass eine Abfrage 404 bekommt. *Grund:* A279, A298; ein offener Editor einer gelöschten Vorlage zeigt „Diese Vorlage gibt es nicht mehr“ statt eines Konsolenfehlers. *Falls falsch:* Detail-Abfrage mit `markLiveGone(id, 'template')`.
- **A348 · Mail für eine fehlgeschlagene Vorlage** sammelt je Person und Vorlage (`template:<id>`, 5 Minuten wie Items), Betreff mit Projektkennung und Vorlagenname, Link auf die Vorlage; standardmäßig aus (A267, `mailByDefault`). *Grund:* Spec 4.14 (Kanäle je Ereignis), Inbox und Mail gruppieren nach Item, eine Vorlage ist hier das Item. *Falls falsch:* keine Mail für diese Art (Spalte gesperrt).
- **A349 · Speichern prüft eine Vorlage wie ein Item ohne Pflicht-Properties.** Typ, Assignee, Labels, Eltern, Werte und Rich Text werden geprüft wie beim Anlegen eines Items; fehlende Pflichtwerte sind erlaubt (der Editor markiert sie); der Titel darf auch mit der längsten Füllung der Platzhalter 255 Zeichen nicht überschreiten. In der API heißt die Beschreibung `payload.description` (Markdown) und `payload.description_json`. *Grund:* Spec 4.12 („zur Laufzeit ungültig … schlägt fehl“) setzt voraus, dass die Vorlage beim Speichern gültig war; Pflichtwerte kommen oft erst später. *Falls falsch:* Pflichtwerte beim Speichern verlangen.
- **A350 · „Jetzt ausführen“ antwortet immer 200 `{run, item}`,** auch gescheitert (`item: null`, Lauf `failed`, Benachrichtigung wie geplant); 409 nur für ein archiviertes Projekt. *Grund:* der Lauf ist protokolliert und die Vorlage bleibt aktiv; ein 422 hieße, nichts sei passiert. *Falls falsch:* 422 mit dem Lauf in `extensions`.
- **A351 · Flow 6 prüft e2e mit einem Zeitplan in der Zukunft;** Pünktlichkeit, Nachholen und die Termine bei gestellter Uhr 2026-10-28 prüft Pest. *Grund:* die Uhr des Servers lässt sich in e2e nicht stellen; ein Zeitplan ab 2036-11-01 hat feste Termine. *Falls falsch:* eine Test-Uhr per Env für e2e (`APP_TEST_NOW`), die nur in `local` gilt.
- **A352 · Die History nennt die Vorlage:** `work_item.created` aus einer Vorlage trägt `meta.template` `{id, name}` (Name als Schnappschuss), `HistoryEntryResource.template` zeigt es, die Aktivität sagt „aus Vorlage „…““. *Grund:* der Master-Vertrag nennt „aus Vorlage Monatsbericht“ als Grund; der Name bleibt lesbar, wenn die Vorlage umbenannt oder gelöscht wird. *Falls falsch:* nur `work_items.template_id`.
- **A353 · Monatsnamen aus den Sprachdateien** (`schedule.month.<name>` in der Sprache der Organisation), die Domain bekommt sie als Liste; kein ext-intl. *Grund:* die Domain bleibt ohne Laravel und Erweiterungen, und `{month_name}` folgt laut Spec der Sprache der Organisation. *Falls falsch:* `IntlDateFormatter` mit dem Locale der Organisation.
- **A354 · Zeitpläne als JSON in der Normalform von `Schedule::toArray()`,** dazu `next_run_at` (Index des Schedulers), `last_run_at`, `run_count`, `schedule_from`; ein Zeitplan, den der Server nicht lesen kann, ist 422 an `schedule.<feld>`, einer ohne einen einzigen Termin `field.schedule.never_runs`. *Grund:* Spec 7.4 lässt „Zeitplan-Spalten“ offen; eine Normalform macht `PUT` mit der eigenen Antwort zum No-op. *Falls falsch:* eigene Spalten je Einstellung.

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** Vorlagennamen sind je Projekt nicht eindeutig (wie Views, K27); höchstens 120 Zeichen.
- **P2** Offsets 0–3650 Tage, nie negativ (ein Item startet nicht vor seinem Anlegen); Due vor Start ist 422.
- **P3** Der Scheduler stellt je fällige Vorlage einen Job auf `default` ein (`app:run-templates`), Auto-Archiv und Auto-Close laufen auf `bulk`; beide Kommandos haben `--now` für Betrieb und e2e.
- **P4** Die Vorlagenliste zeigt den letzten gescheiterten Lauf nicht je Zeile (das wären Abfragen je Vorlage); das Protokoll im Editor und die Inbox sagen es.
- **P5** Ein Viewer sieht Vorlagen und Protokoll schreibgeschützt; „Vorlage anwenden …“ zeigt nur Projekte mit `item.create`.
- **P6** Vorlagen stehen nicht im Suchindex; die Palette liest sie über `GET /api/v1/templates`.
- **P7** Die auslösende Person einer Zug-Automatisierung ist die Person des Actors bzw. dessen `onBehalfOf` (eine Kette bleibt bei der Person).

## Nicht in Phase 10 (vorgemerkt in Task 21)

- Phase 11: Webhook-`data` für `template.run_failed` (`TemplateRunResource` mit Vorlage), `meta.on_behalf_of` nie ausgeben.
- Phase 13: MCP-Tools `templates`/`manage-templates` (`run`, `preview`, `draft`) und `automations`/`manage-automations` über dieselben Actions.
- Phase 14: Scheduler-Container mit `app:run-templates` und `RunDailyAutomationsJob`; Worker auf `default` und `bulk`.
- Phase 15: Last mit vielen Vorlagen zur selben Minute und Auto-Close über 50 000 Items; Kopien großer Bilder je Lauf (Speicher).
