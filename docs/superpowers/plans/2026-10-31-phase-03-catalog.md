# Phase 3: Workflows, Typen, Properties, Kataloge – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kataloge der Organisation bauen: Workflows mit Status und Übergangsmatrix (Startstatus, mindestens ein Completed, Erreichbarkeit), Work-Item-Typen mit Properties, Properties mit acht Feldtypen und Optionen, Labels, Relationstypen und Resolutions; mitgelieferte Einträge per Migration; Projekte bekommen Workflow, aktivierte Typen und Standardtyp. Alles als Actions mit Events, über REST unter `/api/v1` und als portierte Bildschirme des Klickdummys (Organisation: Workflows, Typen, Properties, Labels, Relationstypen, Resolutions; Projekt: Workflow, Typen; Dialog „Neues Projekt“ mit Workflow und Typen).

**Architecture:** Wie Phase 2. Reine Regeln (Übergangsgraph, Kategorien, Töne, Property-Schlüssel, Standardwerte) liegen in `app/Domain/{Workflow,Catalog,Properties}`; jede Änderung eines Katalogs ist eine Action `Save<Katalog>`/`Delete<Katalog>` (ein Speichern legt an oder ersetzt ganz, wie `saveWorkflow` & Co. im Klickdummy), die die Organisationszeile sperrt (`App\Support\CatalogLock`, P1), validiert, schreibt und Events `<katalog>.created|updated|deleted` (ohne Webhook) aufzeichnet. Projekte verweisen per Fremdschlüssel auf Workflow und Standardtyp, die aktivierten Typen stehen in `project_types`. Der Wechsel des Workflows ist eine eigene Action `AssignWorkflow`; das Umschreiben der Items (Job `RemapStates`) kommt mit den Items in Phase 4 (P5). Das Frontend bekommt `resources/js/api/{workflows,workItemTypes,properties,catalog}.ts` mit den Signaturen des Klickdummys und portiert die Bildschirme in den Einstellungsrahmen aus Phase 2.

**Tech Stack:** wie Phase 2. Keine neuen Composer- oder npm-Pakete (dnd-kit, Base UI und Lucide sind da).

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (4.4–4.7, 4.9, 5.2, 6.1, 7.4; „Änderungen vom 2026-10-29“: Status-Icons statt Farbe, sechs Typ-Töne, Labels ohne Standard, „wird blockiert von“, Epic-Regeln), Master-Plan `…/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus, Verträge, Phase 3), Rulings `…/plans/2026-10-30-werkbuch-app-rulings.md` (A1–A55, „Für spätere Phasen vorgemerkt“ → Task 1), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{domain/workflow.ts,api/{workflows,workItemTypes,properties,catalog,values}.ts,api/seed/{config,people}.ts,features/settings/org/*,features/settings/project/{Workflow,Types,mapping,StateMappingDialog}.ts(x),features/projects/CreateProjectDialog.tsx,hooks/*}`, Aufräumliste `…/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (Task 11 und 12 des Klickdummys: Workflow-Editor, Matrix, Relationstypen).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 3 entscheidend:

- Branch `feat/phase-03-catalog`. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Keine neuen Pakete; `composer.lock`, `pnpm-lock.yaml` und `e2e/pnpm-lock.yaml` bleiben unverändert.
- Fachlogik nur in `app/Actions` und `app/Domain`. **Jede schreibende Action legt in ihrer Transaktion mindestens ein Event an, aber nur bei einer echten Änderung** (gleiche Eingabe → kein Schreiben, kein Event). **Jede Action steht genau einmal in der Rechte-Matrix** (`tests/Feature/Access/matrix.php`), **jede Route genau einmal in der Routen-Matrix** (`tests/Feature/Api/routes.php`, Platzhalter über `'params' => fn (MatrixWorld $w) => […]`). Die Setup-Actions `EnsureCatalog` und `LinkProjectsToCatalog` sind wie die übrigen ausgenommen (Migrationen, ohne Actor; ihre Events schreiben sie als Standard-Bot mit Grund `setup`).
- **Gleichzeitigkeit:** Wo eine Regel über mehrere Zeilen oder Tabellen gilt (genau ein Standard-Workflow, genau ein Standard je Resolution-Kategorie, Status-Reihenfolge, „Workflow wird benutzt“, „Typ ist Standardtyp“, eindeutige Namen und Schlüssel), nimmt die Action zuerst `CatalogLock::take()` (Organisationszeile `lockForUpdate`, wie A45) und prüft darunter; Reihenfolge immer Organisation → Projekt (`MemberInput::lock`). Jede solche Action hat einen Fall in `tests/Integration/CatalogLockRaceTest.php` (zwei Verbindungen, `innodb_lock_wait_timeout = 1`, `getSql()` der `QueryException` endet auf `for update` an `organization`).
- **Unsichtbares ist 404, nie 403** (Projekt-Endpunkte). Rechte prüfen Actions über `Authorize::check()`; Kataloge ändern nur Org-Admins (`org.manage_catalog`, P8), lesen darf jedes Konto.
- **ULIDs in Eingaben** werden kleingeschrieben, aber nur Werte, die wie eine ULID aussehen (`App\Support\Ids::normalize`); lokale IDs neuer Status und Optionen bleiben, wie sie kamen (P3). Regex-Muster enden auf `\z`, nie auf `$`.
- Die UI liest und schreibt nur über `/api/v1`. `resources/js/api/<ressource>.ts` exportiert Namen und Signaturen des Klickdummys (`listWorkflows`, `saveWorkflow(spec, options)`, `deleteWorkflow`, `assignWorkflow(project_id, workflow_id, mapping)`, `listWorkItemTypes`, `saveWorkItemType`, `deleteWorkItemType`, `listProperties`, `saveProperty`, `deleteProperty`, `listLabels`, `saveLabel`, `deleteLabel`, `listRelationTypes`, `saveRelationType`, `deleteRelationType`, `listResolutions`, `saveResolution`, `deleteResolution`); Abweichung nur: jede `list…` nimmt optional `PageArgs`. Die Hooks laden alle Seiten (`allPages`, A50): Editoren, Auswahllisten und Projekteinstellungen brauchen ganze Kataloge.
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`; Schlüssel ohne Ziffern und ohne Bindestrich (`three-quarter` → `three_quarter`, `relation-types` → `relation_types`, darum feste Zuordnungen statt gebauter Schlüssel, P21). Neue `reason`-Codes in `Problem::REASONS` und `problem.reason.<code>` beider Sprachen zugleich.
- Abdeckung 100 % Zeilen PHP und Frontend (Vitest + Playwright zusammengeführt) **am Ende jeder Task**; keine unerreichbaren Zweige (lieber weglassen als `@codeCoverageIgnore`): Was erst mit Items Sinn ergibt (Zählungen, „benutzt“ → archivieren, Status mit Items), kommt mit Phase 4 bzw. 5 (P5, P6).
- Tests müssen rot werden können: Zu jeder Regel gehört ein Fall, der ohne die Regel scheitert (Gegenprobe), etwa großgeschriebene ULIDs, `"customer\n"` gegen `\z`, Race-Tests, die ohne Sperre durchliefen.
- Neue Test-Helfer stehen als Closures in ihrer Testdatei oder in `tests/Support/` (Klassen) bzw. `tests/Pest.php`, nie als globale Funktion in einer Testdatei (Task 1).
- Fokus und Tastatur in jedem Bildschirm: jeder Ablauf ohne Maus, Fokus nach Dialogen zurück auf den Auslöser (oder, wenn der weg ist, auf die Überschrift bzw. den Nachbarn), Feldfehler mit Fokus auf dem ersten ungültigen Feld. Base UI setzt den Fokus einen Animation-Frame später: in Playwright nur `tabTo`/`arrowTo`.
- e2e: alle Daten einer Spec heißen `E2E <variant> <runId>`, Aufräumen per API im `finally`, der `E2eSeeder` entfernt Reste früherer Läufe (Task 9); kurze Namen (`Done`, `Bug`, `UX`) mit `exact: true`; kein `networkidle`; **keine Änderung globaler Standards** (Standard-Workflow, Standard-Resolutions) in e2e (P18).
- Demo- und Testdaten nur fiktiv (Feldwerk, die Daten aus `prototypes/clickdummy/src/api/seed/`, `@example.com`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Katalog gleichzeitig ändern:** Zwei Admins, die zur selben Zeit je einen anderen Workflow (bzw. eine andere Resolution) zum Standard machen, hinterlassen genau einen Standard; ein Workflow, den gerade ein Projekt bekommt, lässt sich nicht im selben Moment löschen; ein Typ, der gerade Standardtyp wird, nicht archivieren. → Task 5–8, `CatalogLockRaceTest`.
- **Lokale IDs:** Neue Status und Optionen kommen mit IDs des Clients; der Server vergibt ULIDs und übersetzt Startstatus, Übergänge, Standardwert und Zuordnungen. Eine ID, die zu einem anderen Workflow (einer anderen Property) gehört, wird nie übernommen, sondern ist eine neue Zeile; Befunde (`extensions.issues`) nennen die IDs der Eingabe, damit die UI die Zeile findet. → Task 5, 6.
- **Flow 7 in allen Schichten:** „Agentur-Freigabe“ ohne den Übergang nach Review wird abgelehnt (Domain: `unreachable_state` für Review, Kundenfreigabe, Done; REST: 422 `invalid_workflow`, nichts gespeichert; UI: „Review ist vom Startstatus aus nicht erreichbar“, Fokus auf der Befundliste). → Task 2, 5, 13.
- **Nichts verliert seinen Bezug:** `projects.workflow_id` und `projects.default_type_id` sind Fremdschlüssel; der Standard-Workflow und ein benutzter Workflow lassen sich nicht löschen (409), ein Standardtyp weder löschen noch archivieren (409 `default_type`), ein gelöschter Typ verschwindet aus den aktivierten Typen, eine gelöschte Property aus den Typen. → Task 5, 6, 8.
- **Projekt-Endpunkte verraten nichts:** `PUT /projects/{project}/workflow` und `PATCH` mit Typen sind für Außenstehende eines privaten Projekts 404 ohne `detail`, für Viewer und Member 403 mit dem Satz der Policy. → Task 8, Rechte-Matrix.
- **Events nur bei echter Änderung:** Gleiches Speichern schreibt nichts; Standard-Wechsel schreibt je betroffenem Eintrag ein `updated`. → alle REST-Tasks.

## Gates

Am Ende jeder Task laufen die Gates, die die Task nennt; alle Ergebnisse grün.

- **G1 (PHP):** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`.
- **G2 (Frontend):** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt.
- **G3 (e2e, zusammengeführt):** `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle vier Playwright-Projekte grün, der Global-Teardown (`coverage:merge`) meldet 100 % Zeilen über `resources/js/**`. Vorher `ddev exec pnpm dev` beenden; während des Laufs keine anderen DDEV-Projekte starten oder stoppen.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/` oder `resources/js/shell/` anlegt oder ändert, nennt G3 und bringt Playwright-Specs (Abläufe, nur Tastatur) und Vitest-Tests (Lade-, Fehler- und Randzustände mit `mockApi`) mit, die ihre neuen Zeilen decken.

---

## Datenmodell

Neue Migrationen sortieren nach den bestehenden (`2026_10_31_0007xx_…`). Alle Tabellen mit `ulid('id')->primary()` und Zeitstempeln.

| Tabelle | Spalten | Indizes, Fremdschlüssel |
|---|---|---|
| `workflows` | `name` string(60), `description` text, `is_default` bool (false), `is_free` bool (true), `initial_state_id` ulid nullable | `name` unique; `initial_state_id` **ohne** Fremdschlüssel (P13) |
| `workflow_states` | `workflow_id`, `name` string(40), `icon` string(16), `category` string(16), `position` unsigned small int | FK `workflow_id` cascade; Index (`workflow_id`, `position`), kein Unique (die Sperre hält die Reihenfolge, P1) |
| `workflow_transitions` | `workflow_id`, `from_state_id`, `to_state_id` | FKs cascade (alle drei, auf `workflows` bzw. `workflow_states`); unique (`from_state_id`, `to_state_id`) |
| `work_item_types` | `name` string(60), `icon` string(40), `tone` string(16), `description` text, `is_epic` bool (false), `archived_at` nullable | `name` unique |
| `properties` | `key` string(40), `label` string(60), `field_type` string(16), `help` text, `default_value` json nullable, `settings` json | `key` unique |
| `property_options` | `property_id`, `label` string(60), `color` string(16), `position` unsigned small int, `archived_at` nullable | FK cascade; Index (`property_id`, `position`) |
| `type_properties` | `type_id`, `property_id`, `required` bool, `position` unsigned small int | FKs cascade; unique (`type_id`, `property_id`) |
| `project_types` | `project_id`, `type_id` | FKs cascade; unique (`project_id`, `type_id`) |
| `labels` | `name` string(60), `color` string(16) | `name` unique |
| `relation_types` | `name` string(60), `outward_label` string(60), `inward_label` string(60) nullable (null = symmetrisch), `built_in` string(16) nullable | `name` unique, `built_in` unique |
| `resolutions` | `label` string(60), `default_for` string(16) nullable (`completed`/`canceled`), `position` unsigned small int, `archived_at` nullable | `label` unique, `default_for` unique |
| `projects` (geändert, Task 8) | `workflow_id`, `default_type_id` werden NOT NULL | FK `workflow_id` → `workflows` restrict, FK `default_type_id` → `work_item_types` restrict |

Namen und Schlüssel sind über die Kollation der Datenbank (`utf8mb4_unicode_ci`) eindeutig, also ohne Groß- und Kleinschreibung; die Actions trimmen vorher (P12). Listen ordnen nach `id` (ULID, also Anlagereihenfolge; die Migration legt Task, Bug, Epic nacheinander an), Resolutions nach `position`, dann `id` (P19).

---

## Dateistruktur nach Phase 3

| Ort | Inhalt |
|---|---|
| `app/Domain/Workflow/` | `StateCategory`, `StateIcon`, `State`, `TransitionGraph`, `WorkflowIssue`, `IssueCode` |
| `app/Domain/Catalog/` | `Tone`, `TypeIcon` |
| `app/Domain/Properties/` | `FieldType`, `PropertyKey`, `DefaultValue`, `NormalizedValue` |
| `app/Actions/{Workflows,WorkItemTypes,Properties,Labels,RelationTypes,Resolutions}/` | `List…`, `Save…`, `Delete…` je Katalog |
| `app/Actions/Projects/AssignWorkflow.php`, `app/Actions/Setup/{EnsureCatalog,LinkProjectsToCatalog}.php` | Workflow wechseln; mitgelieferter Katalog; Projekte aus Phase 2 an den Katalog binden |
| `app/Models/` | `Workflow`, `WorkflowState`, `WorkflowTransition`, `WorkItemType`, `TypeProperty`, `Property`, `PropertyOption`, `Label`, `RelationType`, `Resolution`, `ProjectType` |
| `app/Support/` | `CatalogLock`, `Ids`, `WorkflowInput`, `PropertyInput`, `TypeInput`, `CatalogInput` |
| `app/Enums/Catalog.php` | die sechs Kataloge mit dem Ablehnungssatz je Katalog |
| `app/Http/Controllers/Api/` | `WorkflowsController`, `WorkItemTypesController`, `PropertiesController`, `LabelsController`, `RelationTypesController`, `ResolutionsController` |
| `resources/js/api/`, `resources/js/hooks/` | `workflows`, `workItemTypes`, `properties`, `catalog` |
| `resources/js/domain/workflow.ts` | Port mit Test |
| `resources/js/features/settings/catalog/` | gemeinsame Teile: `choices.ts`, `ToneSelect.tsx`, `StateMappingDialog.tsx`, `mapping.ts` (R26) |
| `resources/js/features/settings/org/{workflows,types,properties,catalogs}/` | die Bildschirme der Kataloge |
| `resources/js/features/settings/project/{Workflow,Types}.tsx` | Projekt-Abschnitte |

## Paketversionen

Keine neuen Pakete. Benutzt werden die vorhandenen: `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0 (über `components/ui/SortableList`), `@base-ui/react` ^1.9.0 (Radio, RadioGroup, Menu, Select), `lucide-react` ^1.62.0 (die 20 Typ-Icons aus `components/ui/TypeTab.tsx`).

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 3 | Ziel | Task |
|---|---|---|
| `domain/workflow.ts` (+ Test), Teile von `domain/fixtures.ts` (Workflows, Resolutions) | `app/Domain/Workflow/` (PHP-Port) und `resources/js/domain/workflow.ts`; Fixtures in `tests/Support/WorkflowFixtures.php` und `resources/js/test/fixtures.ts` | 2, 10 |
| Regeln aus `api/{workflows,workItemTypes,properties,catalog}.ts`, aus `api/values.ts` nur die Prüfung je Feldtyp (für Standardwerte) | `app/Actions/*`, `app/Support/*Input.php`, `app/Domain/Properties/DefaultValue.php` | 5–7 |
| `api/{workflows,workItemTypes,properties,catalog}.ts` (Signaturen), `hooks/{workflows,workItemTypes,properties,catalog}.ts` | `resources/js/api/`, `resources/js/hooks/` | 10 |
| `api/seed/config.ts` (Workflows, Typen, Properties, Labels, Relationstypen), Projekt-Zuordnungen aus `api/seed/people.ts` | `database/seeders/Demo/CatalogSeeder.php`, `ProjectsSeeder.php` | 9 |
| `settings/org/{catalog,parts(ToneMenu)}.ts(x)` | `features/settings/catalog/{choices.ts,ToneSelect.tsx}` | 11 |
| `settings/org/{Labels,RelationTypes,Resolutions}.tsx` | `features/settings/org/catalogs/` | 11 |
| `settings/org/{Types,Properties}.tsx` (geteilt: Dialog, Icon-Auswahl, Optionen, Standardwert, `keyFrom`) | `features/settings/org/{types,properties}/` | 12 |
| `settings/org/{Workflows,WorkflowEditor,TransitionMatrix,StateMappingDialog,localId}.ts(x)`, `settings/project/{mapping,StateMappingDialog}.ts(x)` (die beiden Dialoge zusammengeführt, R26) | `features/settings/org/workflows/`, `features/settings/catalog/` | 13 |
| `settings/project/{Workflow,Types}.tsx`, Workflow und Typen in `features/projects/CreateProjectDialog.tsx` | `features/settings/project/`, `features/projects/` | 14 |

Nicht in Phase 3: `settings/org/usage.ts` und alle Zählungen „bei N Items“ (Filter-Engine, Phase 5, P6), `settings/project/useProjectItems.ts` (Phase 4/5), der Auto-Close-Hinweis im Wechsel-Dialog und `automationRules.ts` (Phase 10), `components/fields/PropertyField.tsx` (Phase 4; Standardwerte bekommen eigene schlichte Felder, P15), `api/values.ts` als Ganzes (Phase 4).

## Abdeckung über die Tasks

- **PHP:** G1 am Ende jeder Task. Jede Task, die eine Action oder Route anlegt, ergänzt im selben Commit ihre Zeilen in `matrix.php` und `routes.php` (die Wächter sind sonst rot) und ihre Fälle in `CatalogLockRaceTest`. G1 läuft auch in jeder Task, die `lang/*.json` ändert (`TranslationKeysTest`).
- **Frontend, Vitest:** G2 ab Task 10. Neue Schwelle (100 % Zeilen) in `vitest.config.ts`: `resources/js/features/settings/catalog/**` (Task 11). `api/`, `hooks/`, `domain/`, `features/settings/project/**`, `features/projects/**` haben ihre Schwellen schon. Die Bildschirme unter `features/settings/org/**` haben (wie in Phase 2) keine eigene Schwelle; ihre Zeilen decken Vitest und Playwright zusammen.
- **Frontend, zusammengeführt:** G3 in den Tasks 9 (E2e-Seeder, `e2e/helpers.ts`), 11, 12, 13, 14. Neue Specs in `e2e/tests/`: `catalogs.spec.ts` (11), `types-properties.spec.ts` (12), `workflows.spec.ts` (13), `project-catalog.spec.ts` (14); jede läuft in allen vier Projekten.

---

### Task 1: Vormerkungen aus Phase 2 (Test-Helfer, Seeder, `runId`)

**Files:**
- Modify: `tests/Pest.php`, `tests/Feature/Access/AuthorizeTest.php`, `tests/Feature/Access/SyncRolesTest.php`, `tests/Unit/DocsTest.php`, `tests/Feature/DemoSeederTest.php`, `database/seeders/E2eSeeder.php`, `database/seeders/Demo/FavoritesSeeder.php`, `database/seeders/Demo/TokensSeeder.php`, `e2e/helpers.ts`, `CLAUDE.md` (Regeln: Test-Helfer als Closures oder in `tests/Pest.php`, keine globalen Funktionen in neuen Testdateien), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (Zeile „Phase 3“ unter „Für spätere Phasen vorgemerkt“ entfernen; Task 15 nennt sie als erledigt)

**Interfaces:**
- Consumes: Phase 2
- Produces:
  - `tests/Pest.php`: `function refusal(User $user, string $ability, mixed ...$arguments): Problem` (aus `AuthorizeTest`, um `...$arguments` erweitert, damit Task 3 `manageCatalog` mit Katalog prüfen kann) und `function docsPages(string $language): array` (aus `DocsTest`, unverändert). Beide mit Doc-Kommentar.
  - `SyncRolesTest`: `storedRoles()`/`grantedRoles()` werden Closures in der Datei (`$storedRoles = function (): array { … };`, in den Tests per `use ($storedRoles, $grantedRoles)`).
  - `E2eSeeder::person(string $email, string $name, OrgRole $role = OrgRole::Member, array $extra = []): User` — ruft `setOrgRole` genau einmal mit der Rolle; Erik entsteht mit `OrgRole::Admin` (die zweite Zuordnung entfällt).
  - Seeder ohne Morph-Literale: `FavoritesSeeder` und `TokensSeeder` nehmen `(new Project)->getMorphClass()` bzw. `(new User)->getMorphClass()` statt `'project'`/`'user'`.
  - `DemoSeederTest`: der Rollen-Lookup liest die Rolle aus dem eigenen Treffer (`foreach ($people as $match) { [, $name, $handle] = $match; $role = $match[3] ?? 'member'; … }`) statt über `array_search`.
  - `e2e/helpers.ts` `runId()`: ohne `padStart` (`Date.now().toString(36)` hat mindestens acht Zeichen, `slice(-5)` gibt immer fünf).

- [ ] **Step 1: Umbauen.** Keine neuen Tests; die bestehenden halten das Verhalten fest. Gegenprobe für die Rollen: der Fall „makes Erik an org admin and everybody else of the e2e accounts a member“ in `E2eSeederTest` bleibt grün, weil Erik jetzt direkt mit `OrgRole::Admin` entsteht.

- [ ] **Step 2: Gates G1** und `pnpm --dir e2e test -- login projects` → grün (die Lauf-Kennung hat weiter fünf Zeichen).

- [ ] **Step 3: Commit** — `test: move shared test helpers out of test files, assign each e2e role once, drop morph literals from seeders`.

---

### Task 2: Reine Regeln: Übergangsgraph, Kategorien, Töne, Schlüssel, Standardwerte

**Files:**
- Create: `app/Domain/Workflow/{StateCategory,StateIcon,State,TransitionGraph,WorkflowIssue,IssueCode}.php`, `app/Domain/Catalog/{Tone,TypeIcon}.php`, `app/Domain/Properties/{FieldType,PropertyKey,DefaultValue,NormalizedValue}.php`, `tests/Support/WorkflowFixtures.php`, `tests/Unit/Domain/{TransitionGraphTest,PropertyKeyTest,DefaultValueTest,CatalogChoicesTest}.php`

**Interfaces:**
- Consumes: nichts (reines PHP, kein `Illuminate`, keine Carbon; `ArchTest` prüft es)
- Produces:
  - `enum StateCategory: string` (`Backlog = 'backlog'`, `Unstarted`, `Started`, `Completed`, `Canceled = 'canceled'`); `const ORDER = [self::Backlog, …, self::Canceled]` (Board und Listen, `CATEGORY_ORDER`); `isClosed(): bool` (Completed, Canceled).
  - `enum StateIcon: string` (`dashed`, `circle`, `half`, `three-quarter`, `pause`, `check`, `cross`).
  - `final readonly class State { public function __construct(public string $id, public string $name, public StateIcon $icon, public StateCategory $category, public int $position) }`.
  - `enum IssueCode: string` (`NoInitialState = 'no_initial_state'`, `NoCompletedState = 'no_completed_state'`, `UnreachableState = 'unreachable_state'`); `final readonly class WorkflowIssue { __construct(public IssueCode $code, public ?string $stateId = null); toArray(): array{code: string, state_id?: string} }` (ohne `state_id`, wenn `null`).
  - `final readonly class TransitionGraph`: `__construct(list<State> $states, list<array{0: string, 1: string}> $transitions, bool $isFree, ?string $initialStateId)`; `statesInOrder(): list<State>` (nach `position`); `canTransition(string $from, string $to): bool` (gleich → `true`; Ziel kein Status → `false`; frei → `true`; sonst nur gelistete Paare); `allowedTargets(string $from): list<State>` (in Reihenfolge, ohne `$from`); `issues(): list<WorkflowIssue>` (wie `validateWorkflow`: Startstatus fehlt → nur `no_initial_state` zur Erreichbarkeit; kein Completed → `no_completed_state`; nicht frei → Breitensuche ab Start über Übergänge zu bekannten Status, jeder nicht erreichte Status in Reihenfolge `unreachable_state`).
  - `enum Tone: string` (`sky`, `ochre`, `moss`, `plum`, `sand`, `slate`).
  - `final class TypeIcon { public const NAMES = ['square-check', 'bug', 'zap', 'layers', 'message-square-heart', 'book-open', 'clipboard-list', 'file-text', 'flag', 'flask-conical', 'lightbulb', 'megaphone', 'package', 'palette', 'rocket', 'shield', 'star', 'target', 'users', 'wrench']; public static function isKnown(string $name): bool }` (die Schlüssel von `TYPE_ICONS` in `components/ui/TypeTab.tsx`, P13).
  - `enum FieldType: string` (`text`, `number`, `dropdown`, `boolean`, `date`, `member`, `rich_text`, `url`); `hasOptions(): bool` (dropdown), `allowsMultiple(): bool` (dropdown, member), `hasDecimals(): bool` (number), `hasDefault(): bool` (alle außer member, rich_text, P14).
  - `final class PropertyKey { public const PATTERN = '/^[a-z][a-z0-9_]{0,39}\z/'; public const CORE = ['id', 'key', 'project', 'type', 'title', 'description', 'state', 'state_category', 'resolution', 'assignee', 'priority', 'label', 'labels', 'start_date', 'due_date', 'parent', 'created_by', 'created_at', 'updated_at', 'started_at', 'closed_at', 'archived', 'archived_at', 'rank']; isValid(string): bool; isCore(string): bool }` (Liste aus `api/properties.ts`).
  - `final readonly class NormalizedValue { __construct(public mixed $value, public ?string $error = null); ok(): bool }`; `final class DefaultValue { public const TEXT_MAX = 255; public static function normalize(FieldType $type, int $decimals, bool $multiple, list<string> $optionIds, mixed $value): NormalizedValue }` — `null` ist immer gültig (kein Standard). Sonst je Feldtyp: `text` Zeichenkette, getrimmt, höchstens 255 (Fehler `text`); `number` int, float oder Zeichenkette nach `/^-?\d+([.,]\d+)?\z/`, gerundet auf `$decimals` (Fehler `number`; `INF`/`NAN` sind Fehler); `dropdown` eine ID aus `$optionIds` (Fehler `option`), bei `$multiple` eine Liste solcher IDs ohne Doppelte (eine einzelne ID wird zur Liste, wie `values.ts`), ohne `$multiple` eine Liste → Fehler `single`; `boolean` nur `true`/`false` (Fehler `boolean`); `date` `YYYY-MM-DD` nach `/^\d{4}-\d{2}-\d{2}\z/` und `checkdate` (Fehler `date`); `url` getrimmt, Schema `http`/`https` und Host (`parse_url`), sonst Fehler `url`; `member`, `rich_text` mit Wert → Fehler `none`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/Support/WorkflowFixtures.php` (`namespace Tests\Support; final class WorkflowFixtures`): `standard(): TransitionGraph` und `agency(): TransitionGraph` mit den IDs und Paaren aus `src/domain/fixtures.ts` (`std_backlog` …, `app_backlog` …, 14 Übergänge), `withoutTransitionsInto(TransitionGraph $g, string $stateId): TransitionGraph`, dazu `standardInput(string $name = 'Standard'): array` und `agencyInput(string $name = 'Agentur-Freigabe'): array` in der Form der REST-Eingabe (Status mit lokalen IDs, `initial_state_id`, `transitions`) für die Feature-Tests und die Rechte-Matrix ab Task 5.

`TransitionGraphTest.php` portiert jeden Fall aus `src/domain/workflow.test.ts` mit demselben Namen:
- `canTransition`: „rejects a transition the matrix does not list (todo to done in Agentur-Freigabe)“, „allows a listed transition (Kundenfreigabe to done)“, „allows an open status to move to cancelled“, „allows every transition in a free workflow“, „treats staying in the same status as an allowed no-op“, „reopens a closed item only through the listed transitions“, „rejects a target that is not a status of the workflow, even in a free workflow“.
- `allowedTargets`: „lists the statuses reachable from review, in the order of the workflow, without review itself“ (`['app_progress', 'app_approval', 'app_cancelled']`), „offers only the listed transitions of todo (progress and cancelled)“, „offers every other status in a free workflow“, „orders by position, not by the order of the states array“ (Status umgekehrt übergeben).
- `issues`: „finds nothing wrong with the shipped workflows“, „reports a workflow without a completed status“, „reports a status that no transition leads to as unreachable“, „reports everything behind the unreachable status as unreachable too“ (Review, Kundenfreigabe, Done ja, In Progress nein), „reports an initial status that is not part of the workflow, and nothing else about reachability“ (genau `[no_initial_state]`), „does not check reachability in a free workflow“, „ignores transitions that point at statuses which no longer exist“.
- `isClosed`: „is true for completed and canceled only“ (`[false, false, false, true, true]` über `StateCategory::ORDER`), dazu „lists the categories in the order of boards and lists“.
- `WorkflowIssue::toArray()`: „leaves the state out of an issue without one“ (`['code' => 'no_completed_state']`, kein `state_id`-Schlüssel).

`PropertyKeyTest.php`: gültig `customer`, `effort`, `a`, `target_quarter_2`; ungültig `Customer`, `1st`, `_x`, `a-b`, `ä`, 41 Zeichen, `"customer\n"` (Gegenprobe zu `\z`: mit `$` ginge er durch); `isCore('title')`, `isCore('labels')` wahr, `isCore('customer')` falsch.

`DefaultValueTest.php` mit Datensätzen je Feldtyp: `text` `' Safari '` → `'Safari'`, 256 Zeichen → `text`; `number` `3.46` bei 1 Stelle → `3.5`, `'3,46'` → `3.5`, `'abc'` → `number`, `'1e3'` → `number`, `INF` → `number`, `7` bei 0 Stellen → `7`; `dropdown` einfach `opt_a` ✓, `opt_x` → `option`, `['opt_a']` → `single`; mehrfach `opt_a` → `['opt_a']`, `['opt_a', 'opt_a', 'opt_b']` → `['opt_a', 'opt_b']`, `['opt_x']` → `option`; `boolean` `false` ✓, `'yes'` → `boolean`, `1` → `boolean`; `date` `'2026-10-31'` ✓, `'2026-02-30'` → `date`, `'31.10.2026'` → `date`, `"2026-10-31\n"` → `date`; `url` `'https://example.com/x'` ✓, `'ftp://example.com'` → `url`, `'example.com'` → `url`; `member` `['u_1']` → `none`, `rich_text` `['type' => 'doc']` → `none`; `null` bei jedem Typ ✓.

`CatalogChoicesTest.php` (Unit, liest Dateien über `repo_path()`): `Tone` gleich der Union `TypeTone` in `resources/js/types.ts`; `StateIcon` gleich `StateIcon`; `FieldType` gleich `FieldType`; `StateCategory` gleich `StateCategory`; `TypeIcon::NAMES` gleich den Schlüsseln von `TYPE_ICONS` in `resources/js/components/ui/TypeTab.tsx` (Reihenfolge egal); `PropertyKey::CORE` gleich `CORE_KEYS` aus `prototypes/clickdummy/src/api/properties.ts`. Ein Regex je Datei, die Liste sortiert verglichen.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='TransitionGraphTest|PropertyKeyTest|DefaultValueTest|CatalogChoicesTest|ArchTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: add the pure rules of workflows, tones, type icons, property keys and default values`.

---

### Task 3: Datenmodell, Modelle, Events, Rechte, Katalog-Sperre

**Files:**
- Create: `database/migrations/2026_10_31_000700_create_catalog_tables.php`, `app/Models/{Workflow,WorkflowState,WorkflowTransition,WorkItemType,TypeProperty,Property,PropertyOption,Label,RelationType,Resolution,ProjectType}.php`, `database/factories/{WorkflowFactory,WorkItemTypeFactory,PropertyFactory,LabelFactory,RelationTypeFactory,ResolutionFactory}.php`, `app/Enums/Catalog.php`, `app/Support/{CatalogLock,Ids}.php`, `tests/Feature/Catalog/CatalogModelsTest.php`, `tests/Unit/IdsTest.php`
- Modify: `app/Models/Project.php` (`workflow()`, `types()`), `app/Providers/AppServiceProvider.php` (Morph-Map), `app/Events/EventType.php`, `tests/Unit/EventTypeTest.php`, `tests/Feature/MorphMapTest.php`, `app/Policies/OrganizationPolicy.php`, `tests/Feature/Access/AuthorizeTest.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Architektur: Kataloge, Sperre, `Ids`)

**Interfaces:**
- Consumes: Task 2
- Produces:
  - Migration `…_000700`: alle Tabellen der Tabelle „Datenmodell“ außer der Änderung an `projects` (Task 8); `down()` löscht in umgekehrter Reihenfolge.
  - Modelle (alle `final`, `HasUlids`, `HasFactory` wo eine Factory existiert, `#[Fillable]` wie `Project`, `@property`-Blöcke für Larastan):
    - `Workflow`: `states(): HasMany` (`orderBy('position')->orderBy('id')`), `transitions(): HasMany`, `static default(): self` (`where('is_default', true)->sole()`), `graph(): TransitionGraph` (aus geladenen `states`/`transitions`; IDs der Status), Casts `is_default`, `is_free` bool.
    - `WorkflowState` (Casts `icon` → `StateIcon`, `category` → `StateCategory`, `position` int), `WorkflowTransition` (`from_state_id`, `to_state_id`).
    - `WorkItemType`: `typeProperties(): HasMany<TypeProperty>` (nach `position`), `archived_at` datetime, `tone` → `Tone`; `TypeProperty` (`type_id`, `property_id`, `required` bool, `position` int).
    - `Property`: `options(): HasMany` (nach `position`, `id`), Casts `field_type` → `FieldType`, `default_value` → `json`, `settings` → `array`; `PropertyOption` (`color` → `Tone`, `archived_at` datetime).
    - `Label` (`color` → `Tone`), `RelationType`, `Resolution` (`archived_at` datetime, `position` int).
    - `ProjectType extends Illuminate\Database\Eloquent\Relations\Pivot` mit `HasUlids`, `$incrementing = false`, `$table = 'project_types'`.
    - `Project`: `workflow(): BelongsTo<Workflow>`, `types(): BelongsToMany<WorkItemType>` (`project_types`, `project_id`, `type_id`, `->using(ProjectType::class)->withTimestamps()->orderBy('work_item_types.id')`; `sync()` legt die Pivot-Zeilen über die Pivot-Klasse an, also mit ULID).
  - Morph-Map in `AppServiceProvider::boot()` ergänzt: `workflow`, `work_item_type`, `property`, `label`, `relation_type`, `resolution` (Subjekte der Katalog-Events).
  - `EventType` ergänzt, alle `webhook() === false` (Spec 6.3 kennt sie nicht, P7): `WorkflowCreated = 'workflow.created'`, `WorkflowUpdated`, `WorkflowDeleted`, `WorkItemTypeCreated = 'work_item_type.created'`, `WorkItemTypeUpdated`, `WorkItemTypeDeleted`, `PropertyCreated = 'property.created'`, `PropertyUpdated`, `PropertyDeleted`, `LabelCreated = 'label.created'`, `LabelUpdated`, `LabelDeleted`, `RelationTypeCreated = 'relation_type.created'`, `RelationTypeUpdated`, `RelationTypeDeleted`, `ResolutionCreated = 'resolution.created'`, `ResolutionUpdated`, `ResolutionDeleted`. Archivieren und Wiederherstellen sind `…updated` mit `changes.archived_at`.
  - `enum App\Enums\Catalog: string` (`Workflows = 'workflows'`, `WorkItemTypes = 'work_item_types'`, `Properties = 'properties'`, `Labels = 'labels'`, `RelationTypes = 'relation_types'`, `Resolutions = 'resolutions'`) mit `deniedDetail(): string` (ein `match` mit festen Schlüsseln, damit der Scan sie findet): `problem.detail.workflows_admins_only` „Workflows ändern nur Org-Admins.“, `problem.detail.types_admins_only` „Typen ändern nur Org-Admins.“, `problem.detail.properties_admins_only` „Properties ändern nur Org-Admins.“, `problem.detail.labels_admins_only` „Labels ändern nur Org-Admins.“, `problem.detail.relation_types_admins_only` „Relationstypen ändern nur Org-Admins.“, `problem.detail.resolutions_admins_only` „Resolutions ändern nur Org-Admins.“
  - `OrganizationPolicy::manageCatalog(User $user, Catalog $catalog): Response` — `Visibility::can($user, Permission::OrgManageCatalog)` → allow, sonst `deny($catalog->deniedDetail())`. Aufruf aus Actions: `Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Workflows)` (Laravel nimmt den Klassennamen zur Policy-Suche und übergibt den Rest).
  - `final class App\Support\CatalogLock { public static function take(): void }` — `Organization::query()->lockForUpdate()->sole()`; die Aufrufer stehen immer in ihrer Transaktion (ohne eigene Prüfung: in Feature-Tests wäre ein solcher Zweig unerreichbar).
  - `final class App\Support\Ids { public static function normalize(mixed $value): mixed }` — Zeichenkette, die `Str::isUlid` erfüllt → klein; Liste → elementweise; Map (assoziatives Array) → Schlüssel und Werte so; alles andere unverändert.
  - Factories: `WorkflowFactory` (`name` eindeutig, `description` '', `is_default` false, `is_free` true; `configure()->afterCreating` legt drei Status an — Backlog/`dashed`/backlog, Doing/`half`/started, Done/`check`/completed — und setzt den ersten als Start; Zustand `matrix(list<array{0: int, 1: int}> $pairs)` setzt `is_free` false und legt die Übergänge zwischen den Positionen an), `WorkItemTypeFactory` (Name eindeutig, `icon` `square-check`, `tone` `sky`, `description` '', `is_epic` false, `archived_at` null; `archived()`, `epic()`), `PropertyFactory` (Schlüssel `fake()->unique()->lexify('prop_????')`, `text`; `dropdown(list<string> $labels, bool $multiple = false)` mit Optionen), `LabelFactory`, `RelationTypeFactory`, `ResolutionFactory` (`position` = max + 1).

- [ ] **Step 1: Failing Tests schreiben**

`CatalogModelsTest.php`: „orders the states of a workflow by position and builds its graph“ (`Workflow::factory()->matrix([[0, 1], [1, 2]])` → `graph()->canTransition(<doing>, <done>)` wahr, `<done>`→`<backlog>` falsch, `issues()` leer); „deletes states and transitions with their workflow“; „deletes the options and the type assignments with a property“; „takes a deleted type out of the projects that had it switched on“ (`$project->types()->sync([$type->id])`, `ProjectType` hat eine ULID; Typ löschen → `project_types` leer); „refuses a second transition between the same pair and a second built-in type of one kind“ (`UniqueConstraintViolationException` für `workflow_transitions` und `relation_types.built_in`; ebenso `resolutions.default_for`, `properties.key`, `labels.name` als Datensatz); „casts tones, icons, categories and field types to their enums“; „keeps the settings of a property as an array, empty as well“.

`IdsTest.php` (Unit): `01JBXYZ…` (26 Zeichen, groß) → klein; `st_ABC` bleibt; `['01JB…', 'x']` → `['01jb…', 'x']`; `['01JB…' => '01JC…']` → beide klein; `7`, `null`, `true` unverändert.

`EventTypeTest`: „has no webhook for the events of the catalogs“ (alle 18 neuen `webhook()` falsch, `group()` `workflow`, `work_item_type`, …). `MorphMapTest`: die sechs neuen Aliasse lösen auf. `AuthorizeTest`: Datensatz über `Catalog::cases()` — Org-Admin und Standard-Bot erlaubt, Member 403 mit `detail` gleich `__(…)` des Katalogs (`refusal($member, 'manageCatalog', Organization::class, $catalog)`); Gegenprobe: zwei Kataloge haben verschiedene Sätze.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='CatalogModelsTest|IdsTest|EventTypeTest|MorphMapTest|AuthorizeTest|TranslationKeysTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: add the tables, models and events of the catalogs, the catalog lock and the right to change them`.

---

### Task 4: Mitgelieferter Katalog per Migration

**Files:**
- Create: `app/Actions/Setup/EnsureCatalog.php`, `database/migrations/2026_10_31_000710_create_builtin_catalog.php`, `tests/Feature/Catalog/BuiltInCatalogTest.php`
- Modify: `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Architektur: mitgelieferter Katalog; Fallstricke: Tests, die Katalogeinträge zählen, rechnen mit dem mitgelieferten; Konsumenten vertragen auch die Events der Migration `…_000710`, Actor ist der Standard-Bot, wie A39)

**Interfaces:**
- Consumes: Tasks 2, 3, `User::defaultBot()` (Migration `…_000500`)
- Produces:
  - `final class EnsureCatalog { use AsAction; public function handle(): void }` (Setup: ohne Actor-Parameter, nicht in der Matrix). Eine Transaktion mit `CatalogLock::take()`; Sprache `Organization::current()->locale->value`; Events mit `Actor::system(User::defaultBot(), 'setup')`, Subjekt der neue Eintrag, `project` `null`, `changes` `{name|label: {old: null, new}}`. Legt nur an, was fehlt (idempotent):
    - kein Workflow → „Standard“ (`catalog.builtin.workflow.name`, Beschreibung `catalog.builtin.workflow.description`), `is_default`, `is_free`, Status in dieser Reihenfolge: Backlog (`dashed`, backlog), Todo (`circle`, unstarted), In Progress (`half`, started), Pending (`pause`, started), Done (`check`, completed), Cancelled (`cross`, canceled); Start Backlog (Spec 4.5; die Statusnamen sind in beiden Sprachen englisch wie in der Spec).
    - kein Typ → Property `effort` (eine vorhandene mit diesem Schlüssel wird benutzt; Label `catalog.builtin.property.effort.label` „Aufwand (h)“/„Effort (h)“, `number`, `settings` `{decimals: 1}`, Hilfe `catalog.builtin.property.effort.help`), dann Task (`square-check`, `sky`), Bug (`bug`, `ochre`, Property `effort` optional an Position 0), Epic (`zap`, `moss`, `is_epic`), Beschreibungen aus `catalog.builtin.type.{task,bug,epic}.description` (R6; Namen englisch wie in der Spec).
    - keine Resolution → Done (`default_for` completed, Position 0), Won't do (canceled, 1), Duplicate (2), Cannot reproduce (3).
    - je fehlendem `built_in` aus `blocks`, `duplicates`, `relates` → Relationstyp mit `catalog.builtin.relation.<kind>.name|outward|inward` (`relates` ohne `inward`, symmetrisch).
  - Migration `…_000710` ruft `EnsureCatalog::run()`, `down()` leer (die Zeilen gehen mit den Tabellen).
  - Texte (en / de): `catalog.builtin.workflow.name` „Standard“/„Standard“; `.workflow.description` „The default workflow: every status can be reached from anywhere.“/„Der Standard-Workflow: Jeder Status ist von überall erreichbar.“; `.type.task.description` „A task somebody gets done.“/„Eine Aufgabe, die jemand erledigt.“; `.type.bug.description` „A defect that needs fixing.“/„Ein Fehler, der behoben werden muss.“; `.type.epic.description` „A larger undertaking that breaks down into items. Shows on the timeline.“/„Ein größeres Vorhaben, das in Items zerfällt. Erscheint in der Timeline.“; `.property.effort.label`, `.property.effort.help` „Estimated hours, to one decimal place.“/„Geschätzte Stunden, auf eine Nachkommastelle.“; `.relation.blocks.name` „blocks“/„blockiert“, `.outward` „blocks“/„blockiert“, `.inward` „is blocked by“/„wird blockiert von“; `.relation.duplicates.name` „Duplicate“/„Duplikat“, `.outward` „duplicates“/„ist Duplikat von“, `.inward` „is duplicated by“/„hat Duplikat“; `.relation.relates.name` „related“/„verwandt“, `.outward` „relates to“/„verwandt mit“.

- [ ] **Step 1: Failing Tests schreiben**

`BuiltInCatalogTest.php` (die Migration lief schon über `RefreshDatabase`):
- „ships the standard workflow as the default, free, with six states and Backlog to start“ (Namen, Icons, Kategorien in Reihenfolge; `Workflow::default()->graph()->issues()` leer).
- „ships Task, Bug and Epic in this order, Bug with an optional effort and Epic as the epic type“.
- „ships the four resolutions with Done and Won't do as the defaults“.
- „ships blocks, duplicates and related as built-in relation types, related symmetric“ (in der Sprache der Migration: `en` → „blocks“/„is blocked by“).
- „records what it created as the default bot, without webhooks“ (je Eintrag ein Event, `actor_id` Standard-Bot, `meta.reason` `setup`, `meta.via` `system`).
- „creates nothing twice“ (zweiter `EnsureCatalog::run()` → gleiche Zahlen, keine neuen Events).
- „names the built-in entries in the language of the organization“: Relationstypen und Workflows löschen (`RelationType::query()->delete()`, `Workflow::query()->delete()`; es gibt im Test keine Projekte), `Organization::current()->update(['locale' => 'de'])`, `EnsureCatalog::run()` → „blockiert“, „wird blockiert von“, „Der Standard-Workflow: …“. Gegenprobe: mit `en` heißen sie anders.
- „adds a missing built-in relation type only“ (`duplicates` löschen, Lauf → nur er kommt wieder, die anderen behalten ihre ID).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='BuiltInCatalogTest|TranslationKeysTest'`, dann die ganze Suite (Tests, die Konten oder Events zählen, filtern schon nach Typ; Zählungen von Katalogeinträgen gibt es noch keine).

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: ship the standard workflow, Task, Bug and Epic, the resolutions and the built-in relation types`.

---

### Task 5: Workflows über REST

**Files:**
- Create: `app/Actions/Workflows/{ListWorkflows,SaveWorkflow,DeleteWorkflow}.php`, `app/Support/WorkflowInput.php`, `app/Http/Resources/WorkflowResource.php`, `app/Http/Controllers/Api/WorkflowsController.php`, `tests/Feature/Api/WorkflowsApiTest.php`, `tests/Integration/CatalogLockRaceTest.php`
- Modify: `routes/api.php`, `app/Exceptions/Problem.php` (`REASONS`, `unprocessable()`), `tests/Feature/ProblemTest.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (REST: Kataloge; Problem: `unprocessable`)

**Interfaces:**
- Consumes: Tasks 2–4
- Produces:
  - `Problem::unprocessable(string $reason, array $errors, array $extensions = [], ?string $detail = null): self` (422 mit eigenem Reason, A31-Muster). `REASONS` ergänzt: `invalid_workflow`, `default_workflow`, `default_type`, `built_in`, `is_default` (`in_use` gibt es); `problem.reason.<code>` in beiden Sprachen („Der Workflow lässt sich so nicht speichern.“, „Das ist der Standard-Workflow.“, „Das ist ein Standardtyp eines Projekts.“, „Das ist mitgeliefert.“, „Das ist ein Standard.“).
  - `final class WorkflowInput` (Regeln, Meldungen, Normalisieren; schreibt nichts):
    - `const NAME_MAX = 60`, `STATE_NAME_MAX = 40`, `DESCRIPTION_MAX = 2000`, `STATES_MAX = 30`, `KEY_MAX = 64`.
    - `static normalize(array $input): array` — trimmt `name`, `description`, Statusnamen; `Ids::normalize` auf `initial_state_id`, `states.*.id`, `transitions`, `state_mapping` (nur ULIDs).
    - `static validate(array $input, ?Workflow $existing): array{name: string, description: string, is_default: bool, is_free: bool, initial_state_id: string, states: list<array{key: string, existing: ?string, name: string, icon: StateIcon, category: StateCategory}>, transitions: list<array{0: string, 1: string}>, state_mapping: array<string, string>}` — `Validator::make` mit `$messages` (P9): `name` required, string, max, eindeutig (`Rule::unique('workflows')->ignore($existing?->id)`; `field.name.taken` „Diesen Namen gibt es schon.“), `description` nullable string max, `is_default`, `is_free` boolean, `description` (fehlend: beim Anlegen `false`, `true` bzw. `''`, beim Ändern der gespeicherte Wert), `states` required array 1–30 (`field.states.required` „Ein Workflow braucht mindestens einen Status.“, `field.states.max` „Ein Workflow hat höchstens :max Status.“), `states.*.name` required string max (`field.states.name_required` „Jeder Status braucht einen Namen.“, `field.states.name_max`), `states.*.icon` `Rule::enum(StateIcon)` (`field.states.icon` „Ein Status hat ein unbekanntes Icon.“), `states.*.category` `Rule::enum(StateCategory)` (`field.states.category` „Ein Status hat eine unbekannte Kategorie.“), `states.*.id` nullable string max 64, untereinander verschieden (`field.states.duplicate_id` „Zwei Status haben dieselbe ID.“), `initial_state_id` required string, `transitions` array von Paaren aus zwei Zeichenketten (`field.transitions.invalid` „Ein Übergang ist ein Paar aus zwei Status.“), `state_mapping` sometimes array. Danach: jeder Status bekommt `key` = gesendete `id` oder, ohne `id`, `new:<index>`; `existing` = die `id`, wenn sie ein Status **dieses** Workflows ist, sonst `null` (eine fremde ULID ist eine neue Zeile, Review Focus); Übergänge mit unbekannten Schlüsseln oder `from === to` fallen weg, doppelte Paare einmal (wie der Klickdummy).
    - `static graph(array $valid): TransitionGraph` — mit den Schlüsseln der Eingabe als IDs, Position = Index.
    - `static refuse(list<WorkflowIssue> $issues, array $valid): never` — `Problem::unprocessable('invalid_workflow', $errors, ['issues' => array_map(toArray, $issues)], __('problem.detail.invalid_workflow'))`; `$errors` je Code eine Liste: `field.workflow.no_initial_state` „Der Workflow braucht einen Startstatus.“, `field.workflow.no_completed_state` „Der Workflow braucht mindestens einen Status der Kategorie Completed.“, `field.workflow.unreachable_state` „:name ist vom Startstatus aus nicht erreichbar.“ (je Status, Name aus der Eingabe).
    - `static mappingErrors(string $field, array $mapping, list<string> $from, list<string> $to): array<string, list<string>>` — Schlüssel müssen in `$from`, Werte in `$to` liegen; Fehler unter `<field>.<id>` (`state_mapping` hier, `mapping` in Task 8): `field.mapping.unknown_state` „Diesen Status gibt es hier nicht.“, `field.mapping.target` „Diesen Status gibt es im neuen Workflow nicht.“ (auch von Task 8 benutzt).
  - `ListWorkflows::handle(Actor $actor, array $input): ListResult` — jedes Konto; `Workflow::query()->with(['states', 'transitions'])->orderBy('id')`, `PageArgs::from($input)`.
  - `SaveWorkflow::handle(Actor $actor, ?Workflow $workflow, array $input): Workflow` — `Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Workflows)`; normalisieren; Transaktion: `CatalogLock::take()`; ein bestehender Workflow wird frisch mit `states`, `transitions` gelesen (inzwischen gelöscht → `Problem::notFound()`); `validate`; `graph()->issues()` nicht leer → `refuse` (nichts geschrieben); `is_default` false für den bisherigen Standard ohne anderen → 422 `is_default` (`field.is_default.required` „Einer der Workflows muss der Standard-Workflow sein.“); `state_mapping` nur auf Form geprüft (`mappingErrors` gegen wegfallende bzw. bleibende Status; wirksam ab Phase 4, P5). Schreiben: Workflow anlegen bzw. Felder setzen, Status anlegen/ändern (Name, Icon, Kategorie, Position = Index), wegfallende löschen, Übergänge ersetzen (Schlüssel → ULID), `initial_state_id` setzen. `is_default` true → jeder andere Standard verliert die Marke und bekommt sein eigenes `workflow.updated` (`changes.is_default`). Events: neu → `workflow.created` (`changes.name`); geändert → `workflow.updated` mit nur den geänderten Feldern aus `name`, `description`, `is_default`, `is_free`, `initial_state_id`, `states` (alte und neue Liste `[{id, name, icon, category}]` in Reihenfolge, nur wenn verschieden), `transitions` (Paare sortiert, nur wenn verschieden); nichts geändert → kein Schreiben, kein Event. Rückgabe mit geladenen `states`, `transitions` (`load()`, nie `fresh()`: `wasRecentlyCreated` macht das 201).
  - `DeleteWorkflow::handle(Actor $actor, Workflow $workflow): void` — Recht wie oben; Transaktion mit `CatalogLock::take()`, frisch lesen (weg → 404); Standard → `Problem::conflict('default_workflow', detail: __('problem.detail.default_workflow'))` „Der Standard-Workflow lässt sich nie löschen.“; von Projekten benutzt (auch archivierte und solche in Löschung, die Zeile hält den Fremdschlüssel bis zum Purge) → `Problem::conflict('in_use', ['projects' => [Kennungen nach Name]], __('problem.detail.workflow_in_use', ['projects' => 'WEB, OPS']))` „Der Workflow wird noch von :projects benutzt.“; Event `workflow.deleted` (`meta` `{name}`), dann löschen.
  - `WorkflowResource`: `{id, name, description, is_default, is_free, initial_state_id, states: [{id, name, icon, category, position}], transitions: [[from, to], …]}` (Paare nach Position von `from`, dann `to`).
  - REST: `GET /api/v1/workflows`, `POST /api/v1/workflows` → 201, `PUT /api/v1/workflows/{workflow}`, `DELETE /api/v1/workflows/{workflow}` → 204 (implizites Binding per ULID; unbekannt oder kein ULID → 404 ohne `detail`).
  - Rechte-Matrix (`$catalogAdmins = ['org_admin', 'default_bot']`): `ListWorkflows` (alle), `SaveWorkflow` (`SaveWorkflow::run($a, null, WorkflowFixtures::standardInput('Matrix'))`, `$catalogAdmins`, Event `WorkflowCreated`), `DeleteWorkflow` (`Workflow::factory()->create()`, `$catalogAdmins`, `WorkflowDeleted`). Routen: `list workflows`, `create a workflow`, `change a workflow` (`params` → `['workflow' => Workflow::factory()->create()->id]`), `delete a workflow` (ebenso).

- [ ] **Step 1: Failing Tests schreiben**

`WorkflowsApiTest.php` (als Org-Admin per `actingAs`, wo nicht anders gesagt):
- „lists the workflows with their states in order and their transitions“ (Standard zuerst, `transitions` `[]`).
- „creates a workflow with a matrix, giving the new states ids of their own“ (`agencyInput()` mit lokalen IDs `app_*`: 201, alle IDs der Antwort ULIDs, `initial_state_id` = ULID von Backlog, 14 Paare übersetzt, Event `workflow.created`).
- „refuses Agentur-Freigabe without the transition into Review and saves nothing“ (Flow 7: 422 `reason` `invalid_workflow`, `errors.unreachable_state` enthält `__('field.workflow.unreachable_state', ['name' => 'Review'])`, `extensions.issues` = `[{unreachable_state, app_review}, {…, app_approval}, {…, app_done}]` mit den IDs der Eingabe, `Workflow::count()` unverändert, kein Event).
- „refuses a workflow without a completed status or without its start among the states“ (Datensatz, je `errors.no_completed_state` bzw. `errors.no_initial_state`).
- „checks names, icons, categories and the number of states“ (Datensatz: Name leer, 61 Zeichen, vorhandener Name in anderer Schreibweise `STANDARD`, Status ohne Namen, Icon `square`, Kategorie `done`, 31 Status, keine Status, doppelte Status-ID, Übergang `['a']` → je 422 am erwarteten Feld mit dem Satz).
- „keeps the ids of the states it is sent back, renames and reorders them“ (PUT: gleiche ULIDs, neue Positionen, `changes.states` alt/neu).
- „drops transitions that lead nowhere or to the same status, and pairs sent twice“.
- „takes a state id of another workflow as a new state“ (ID eines Status von Standard im neuen Workflow → neue ULID, Standard unverändert).
- „finds the ids of its states also in capitals“ (Gegenprobe zu `Ids`: PUT mit großgeschriebenen ULIDs in `states.*.id`, `initial_state_id`, `transitions` → dieselben Zeilen bleiben, keine neuen ULIDs).
- „records nothing when nothing changes“ (PUT mit der eigenen Antwort → 200, kein Event, `updated_at` gleich).
- „makes one workflow the default and takes the mark from the other“ (zwei `workflow.updated`, genau ein `is_default`).
- „refuses to leave the organization without a default workflow“ (422 `is_default`).
- „checks a state mapping against the states that go and the ones that stay“ (422 `state_mapping.<id>` für einen bleibenden Schlüssel bzw. ein gelöschtes Ziel; ein passendes Mapping geht durch).
- „deletes an unused workflow with its states and transitions“ (204, Event `workflow.deleted` mit `meta.name`).
- „never deletes the default workflow“ (409 `default_workflow`, `detail`).
- „refuses to delete a workflow a project uses, naming the projects“ (`Project::factory()->create(['workflow_id' => $wf->id])`, 409 `in_use`, `projects` `['WEB']`).
- „lets every account read the workflows and only org admins change them“ (Member: `GET` 200, `POST`/`PUT`/`DELETE` 403 mit `__('problem.detail.workflows_admins_only')`).
- „answers an unknown workflow with 404 and no detail“.

`ProblemTest`: `unprocessable()` rendert 422 mit `reason`, `errors`, Erweiterungen.

`CatalogLockRaceTest.php` (Muster `ProjectIdentifierRaceTest`, Helfer als Closures in der Datei): „makes every change of the catalog wait for the lock of the organization“ mit Datensatz der Änderungen (diese Task: `SaveWorkflow` neu, `SaveWorkflow` ändern, `DeleteWorkflow`; Tasks 6–8 ergänzen) — Verbindung 1 hält `CatalogLock::take()` in offener Transaktion, Verbindung 2 läuft in den Lock-Timeout, `getSql()` beginnt mit `select * from \`organization\`` und endet auf `for update`; „lets only one of two workflows become the default“ (Verbindung 1 macht A zum Standard und hält die Transaktion; Verbindung 2 will B → wartet; nach dem Commit läuft B durch und genau B ist Standard, A hat ein `workflow.updated`).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='WorkflowsApiTest|ProblemTest|CatalogLockRaceTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: manage workflows with states and transition matrix over REST, refusing unreachable states`.

---

### Task 6: Typen und Properties über REST

**Files:**
- Create: `app/Actions/Properties/{ListProperties,SaveProperty,DeleteProperty}.php`, `app/Actions/WorkItemTypes/{ListWorkItemTypes,SaveWorkItemType,DeleteWorkItemType}.php`, `app/Support/{PropertyInput,TypeInput,CatalogInput}.php`, `app/Http/Resources/{PropertyResource,WorkItemTypeResource}.php`, `app/Http/Controllers/Api/{PropertiesController,WorkItemTypesController}.php`, `tests/Feature/Api/{PropertiesApiTest,WorkItemTypesApiTest}.php`
- Modify: `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Integration/CatalogLockRaceTest.php`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Tasks 2–5
- Produces:
  - `final class CatalogInput` (gemeinsam für Task 6 und 7): `NAME_MAX = 60`, `DESCRIPTION_MAX = 2000`, `HELP_MAX = 500`; `static trim(array $input, list<string> $fields): array`; `static name(string $table, ?Model $own, string $column = 'name'): list<mixed>` (required, string, max, `Rule::unique` mit `ignore`); `static tone(): list<mixed>` (`Rule::enum(Tone::class)`); `static archivedAt(): list<mixed>` (`['sometimes', 'nullable', 'string']`); `static messages(string $field): array` (`field.name.required`, `field.name.max`, `field.name.taken`, `field.label.required` „Das Label darf nicht leer sein.“, `field.label.max`, `field.label.taken`, `field.color.unknown` „Diese Farbe gibt es nicht.“, `field.tone.unknown` (gleicher Satz), `field.description.max`, `field.help.max` „Der Hilfetext darf höchstens :max Zeichen haben.“).
  - `final class PropertyInput`: `OPTIONS_MAX = 100`, `OPTION_LABEL_MAX = 60`; `static normalize(array $input): array` (trimmt `key`, `label`, `help`, Optionslabels; `Ids::normalize` auf `options.*.id` und `default_value`); `static validate(array $input, ?Property $existing): array{key: string, label: string, field_type: FieldType, help: string, settings: array{multiple?: bool, decimals?: int}, options: list<array{key: string, existing: ?string, label: string, color: Tone, archived: bool}>, default_value: mixed}`:
    - Neu: `key` required, `PropertyKey::isValid` (`field.key.format` „Der Schlüssel besteht aus Kleinbuchstaben, Ziffern und _ und beginnt mit einem Buchstaben.“), nicht `isCore` (`field.key.core` „Der Schlüssel gehört einem Kernfeld.“), frei (`field.key.taken` „Diesen Schlüssel gibt es schon.“); `field_type` `Rule::enum(FieldType)` (`field.field_type.unknown` „Diesen Feldtyp gibt es nicht.“).
    - Bestehend: ein gesendetes `key` ≠ gespeichert → `field.key.immutable` „Der Schlüssel lässt sich nicht mehr ändern.“; `field_type` ≠ gespeichert → `field.field_type.immutable` „Der Feldtyp lässt sich nicht mehr ändern.“; `settings.multiple` von wahr auf falsch → `field.settings.multiple_back` „Von Mehrfach- auf Einfachauswahl lässt sich nicht zurückwechseln.“ (ein fehlendes `key`/`field_type` gilt als unverändert: wer das Objekt ohne sie schickt, bekommt kein 422).
    - `label` required, max 60; `help` nullable, max 500 (→ `''`).
    - `settings` sometimes array: `multiple` boolean nur bei `allowsMultiple()`, `decimals` integer 0–4 nur bei `hasDecimals()` (`field.settings.decimals` „Nachkommastellen: 0 bis 4.“), andere Schlüssel oder ein Schlüssel am falschen Feldtyp → `field.settings.invalid` „Diese Einstellung gibt es für diesen Feldtyp nicht.“; gespeichert nur die erlaubten, Zahl mit `decimals` Standard 0.
    - `options` sometimes array max 100; nur bei `dropdown` nicht leer (`field.options.dropdown_only` „Nur ein Dropdown hat Optionen.“); je Option `label` required max 60 (`field.options.label_required` „Jede Option braucht ein Label.“), `color` Tone, `archived_at` nullable, `id` nullable string max 64 und verschieden (`field.options.duplicate_id` „Zwei Optionen haben dieselbe ID.“); `existing` wie bei Status (nur Optionen **dieser** Property); ein Dropdown braucht mindestens eine nicht archivierte Option (`field.options.required` „Ein Dropdown braucht mindestens eine Option.“).
    - `default_value`: `DefaultValue::normalize($type, $decimals, $multiple, <Schlüssel der nicht archivierten Optionen der Eingabe>, $value)`; Fehler → `field.default_value.<fall>` über ein festes `match` (`text` „Der Standardwert darf höchstens 255 Zeichen haben.“, `number` „Der Standardwert muss eine Zahl sein.“, `option` „Diese Auswahl gibt es nicht.“, `single` „Der Standardwert erlaubt genau eine Auswahl.“, `boolean` „Der Standardwert ist Ja oder Nein.“, `date` „Der Standardwert ist ein Datum (JJJJ-MM-TT).“, `url` „Der Standardwert muss mit http:// oder https:// beginnen.“, `none` „Für diesen Feldtyp gibt es keinen Standardwert.“).
  - `final class TypeInput`: `static normalize(array $input): array` (trimmt `name`, `icon`, `description`, `Ids::normalize` auf `properties.*.property_id`); `static validate(array $input, ?WorkItemType $existing): array{name: string, icon: string, tone: Tone, description: string, is_epic: bool, properties: list<array{property_id: string, required: bool}>, archived: ?bool}` — `name` eindeutig; `icon` required, `TypeIcon::isKnown` (`field.icon.unknown` „Wähle ein Icon aus der Liste.“); `tone`; `description` nullable max; `is_epic` boolean (Standard false); `properties` array, `property_id` vorhanden (`field.properties.unknown` „Mindestens eine Property gibt es nicht.“) und ohne Doppelte (`field.properties.duplicate` „Eine Property ist doppelt zugeordnet.“), `required` boolean (Standard false); `archived_at` fehlt → `null` (unverändert), `null` → `false`, Zeichenkette → `true` (der Server stempelt die Zeit selbst).
  - `ListProperties` / `ListWorkItemTypes::handle(Actor $actor, array $input): ListResult` — jedes Konto; mit `options` bzw. `typeProperties`, nach `id`. Archivierte Typen gehören dazu (Items behalten sie).
  - `SaveProperty::handle(Actor $actor, ?Property $property, array $input): Property` — Recht `Catalog::Properties`; Transaktion mit `CatalogLock::take()`, Bestehendes frisch mit `options`; validieren; Optionen: bestehende behalten ID (Label, Farbe, Position = Index, `archived_at`: archiviert → behält den alten Stempel oder `now()`, sonst `null`), neue bekommen ULIDs, ausgelassene werden gelöscht (Phase 4: benutzte werden archiviert, P5); `default_value` mit Options-Schlüsseln → ULIDs übersetzt. Events `property.created` (`changes.key`, `changes.label`) bzw. `property.updated` mit nur den geänderten Feldern aus `label`, `help`, `default_value`, `settings`, `options` (Liste `[{id, label, color, archived}]`); nichts geändert → nichts.
  - `DeleteProperty::handle(Actor $actor, Property $property): int` — Recht; Sperre; frisch lesen (weg → 404); Event `property.deleted` (`meta` `{key, label}`), löschen (Optionen und Typ-Zuordnungen per Kaskade); Rückgabe die Zahl der Items mit Wert, in Phase 3 immer `0` (es gibt keine Werte; Phase 4 zählt, P5).
  - `SaveWorkItemType::handle(Actor $actor, ?WorkItemType $type, array $input): WorkItemType` — Recht `Catalog::WorkItemTypes`; Sperre; frisch mit `typeProperties`; validieren; `archived` wahr bei einem Typ, der Standardtyp eines Projekts ist → `Problem::conflict('default_type', ['projects' => […]], __('problem.detail.default_type', ['projects' => …]))` „Der Typ ist Standardtyp von :projects. Wähle dort zuerst einen anderen.“ (P11); Zuordnungen ersetzen (Position = Index); Events `work_item_type.created` (`changes.name`) bzw. `…updated` mit den geänderten Feldern aus `name`, `icon`, `tone`, `description`, `is_epic`, `properties` (`[{property_id, required}]`), `archived_at`. Das Häkchen „Epic“ prüft Phase 4 gegen Items (P5).
  - `DeleteWorkItemType::handle(Actor $actor, WorkItemType $type): array{outcome: string}` — Recht; Sperre; frisch lesen; Standardtyp eines Projekts → 409 `default_type` wie oben; Event `work_item_type.deleted` (`meta` `{name}`), löschen (`project_types` und `type_properties` per Kaskade); Rückgabe `['outcome' => 'deleted']` (Phase 4: `archived`, wenn Items ihn tragen).
  - `PropertyResource`: `{id, key, label, field_type, help, default_value, settings, options: [{id, label, color, position, archived_at}]}`; `settings` als JSON-Objekt, auch leer (`(object) $property->settings`, sonst käme `[]`). `WorkItemTypeResource`: `{id, name, icon, tone, description, is_epic, properties: [{property_id, required, position}], archived_at}`.
  - REST: `GET|POST /api/v1/properties`, `PUT|DELETE /api/v1/properties/{property}` (DELETE → 200 `{affected_items}` ohne `data`); `GET|POST /api/v1/work-item-types`, `PUT|DELETE /api/v1/work-item-types/{workItemType}` (DELETE → 200 `{outcome}`). Der Platzhalter heißt nie `{type}` oder `{project}` (globales `Route::bind`).
  - Matrix: die sechs Actions (`Save…` legt neu an, `Delete…` mit frischer Factory-Zeile, `$catalogAdmins`, Events `PropertyCreated`, `PropertyDeleted`, `WorkItemTypeCreated`, `WorkItemTypeDeleted`); Routen je eine Zeile mit `params`. `CatalogLockRaceTest`: die vier schreibenden Actions im Datensatz.

- [ ] **Step 1: Failing Tests schreiben**

`PropertiesApiTest.php`:
- „lists the properties with their options in order, settings as an object“ (`effort` aus der Migration: `settings` `{"decimals":1}`; eine neue Textproperty liefert im Rohtext `"settings":{}`; Gegenprobe ohne Cast `[]`).
- „creates a dropdown with options and a default among them, giving the new options ids“ (Optionen mit lokalen IDs `opt_a`, `opt_b`, `default_value` `opt_b` → ULID von B; Event `property.created`).
- „refuses a key of a core field, a malformed key and a key that exists“ (Datensatz: `title`, `labels`, `Title`, `1x`, `"customer\n"`, 41 Zeichen, `effort` → je 422 an `key` mit dem Satz).
- „keeps key and field type once saved, only single may become multiple choice“ (422 `key`, `field_type`, `settings`; einfach → mehrfach geht, der Standard `opt_a` wird `['opt_a']`).
- „answers an object without key and field type as unchanged“ (PUT ohne `key`/`field_type` → 200).
- „checks the default value against the field type“ (Datensatz aus `DefaultValueTest`, über REST, je 422 an `default_value` mit dem Satz).
- „refuses settings and options that the field type does not have“ (Text mit `decimals`, Zahl mit `multiple`, Zahl mit `decimals` 5, Text mit Optionen, Dropdown nur mit archivierten Optionen).
- „drops the options it is no longer sent and keeps the others with their ids“.
- „deletes a property and takes it off the types“ (`effort` von Bug: 200 `{affected_items: 0}`, Bug ohne Zuordnung, Event `property.deleted` mit `meta.key`).
- „records nothing when nothing changes“.
- „lets members read the properties and refuses changes with the sentence of the catalog“.

`WorkItemTypesApiTest.php`:
- „lists Task, Bug and Epic first, archived types included“.
- „creates a type with a required property, in the order it is sent“ (Erfolgskriterium 2.2 ohne Item, REST: Property `customer` required an Position 0, `effort` optional an 1).
- „refuses an unknown icon or tone and a property that is missing or twice“ (Datensatz).
- „archives and restores a type through archived_at, stamping the time itself“ (`archived_at` `'2000-01-01'` → gespeichert ist `now()` (`$this->travelTo`), `null` → wieder aktiv; Events `work_item_type.updated` mit `changes.archived_at`).
- „refuses to archive or delete the default type of a project, naming the project“ (`Project::factory()->create(['default_type_id' => $task->id])` mit Kennung `WEB`: 409 `default_type`, `projects` `['WEB']`).
- „deletes an unused type and takes it out of the projects that had it switched on“ (`$project->types()->sync([$bug->id, $epic->id])`, Epic löschen → `{outcome: 'deleted'}`, Projekt hat nur noch Bug).
- „records nothing when nothing changes“, „lets members read the types and refuses changes“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='PropertiesApiTest|WorkItemTypesApiTest|CatalogLockRaceTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: manage work item types and properties over REST`.

---

### Task 7: Labels, Relationstypen und Resolutions über REST

**Files:**
- Create: `app/Actions/Labels/{ListLabels,SaveLabel,DeleteLabel}.php`, `app/Actions/RelationTypes/{ListRelationTypes,SaveRelationType,DeleteRelationType}.php`, `app/Actions/Resolutions/{ListResolutions,SaveResolution,DeleteResolution}.php`, `app/Http/Resources/{LabelResource,RelationTypeResource,ResolutionResource}.php`, `app/Http/Controllers/Api/{LabelsController,RelationTypesController,ResolutionsController}.php`, `tests/Feature/Api/{LabelsApiTest,RelationTypesApiTest,ResolutionsApiTest}.php`
- Modify: `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Integration/CatalogLockRaceTest.php`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Tasks 3–6 (`CatalogInput`)
- Produces:
  - Labels: `ListLabels` (nach `id`), `SaveLabel::handle(Actor $actor, ?Label $label, array $input): Label` (`name` eindeutig, `color` Tone; Events `label.created`/`label.updated` mit `name`, `color`), `DeleteLabel::handle(Actor $actor, Label $label): int` (Event `label.deleted` mit `meta.name`; Rückgabe `0` bis Phase 4, P5). REST `GET|POST /api/v1/labels`, `PUT|DELETE /api/v1/labels/{label}` (DELETE → 200 `{affected_items}`). Keine Standard-Markierung (R23).
  - Relationstypen: `ListRelationTypes` (nach `id`: die drei mitgelieferten zuerst), `SaveRelationType::handle(Actor $actor, ?RelationType $type, array $input): RelationType` (`name` eindeutig, `outward_label` required max 60 (`field.outward_label.required` „Beschrifte die Richtung.“), `inward_label` nullable; eine leere Zeichenkette statt `null` → `field.inward_label.required` „Beschrifte die Gegenrichtung oder lasse die Relation symmetrisch.“; `built_in` aus der Eingabe wird nie übernommen, ein mitgelieferter bleibt mitgeliefert und lässt sich umbenennen), `DeleteRelationType::handle(Actor $actor, RelationType $type): int` (mitgeliefert → `Problem::conflict('built_in', detail: __('problem.detail.built_in', ['name' => …]))` „„:name“ ist mitgeliefert und lässt sich nicht löschen.“; Event `relation_type.deleted`; Rückgabe `0` bis Phase 4). REST `…/relation-types`, `…/relation-types/{relationType}` (DELETE → 200 `{affected_relations}`).
  - Resolutions: `ListResolutions` (nach `position`, `id`), `SaveResolution::handle(Actor $actor, ?Resolution $resolution, array $input): Resolution`: `label` eindeutig; `default_for` nullable `in:completed,canceled` (`field.default_for.unknown` „Das ist keine Kategorie mit Resolution.“); `archived_at` wie bei Typen; Standard und archiviert zugleich → `field.archived_at.default` „Ein Standard lässt sich nicht archivieren.“; keine Änderung darf eine Kategorie ohne Standard lassen (der Standard für Completed wird `null` oder `canceled`, ohne dass eine andere Completed übernimmt) → `field.default_for.last` „Jede Kategorie braucht einen Standard. Mache zuerst eine andere Resolution zum Standard.“ (P20); `position` aus der Eingabe wird ignoriert (neu: max + 1). Ein neuer Standard nimmt dem alten die Marke, der alte bekommt sein eigenes `resolution.updated` (`changes.default_for`). Events `resolution.created`/`…updated`. `DeleteResolution::handle(Actor $actor, Resolution $resolution): array{outcome: string}` — Standard → `Problem::conflict('is_default', detail: __('problem.detail.default_resolution', ['label' => …, 'category' => …]))` „„:label“ ist der Standard für :category. Bestimme zuerst einen anderen.“; sonst Event `resolution.deleted`, löschen, `['outcome' => 'deleted']` (Phase 4: `archived`, wenn Items sie tragen). REST `…/resolutions`, `…/resolutions/{resolution}` (DELETE → 200 `{outcome}`).
  - Alle Save- und Delete-Actions: `Authorize::check(…, Catalog::…)`, Transaktion mit `CatalogLock::take()`, frisch lesen, Events nur bei echter Änderung.
  - Resources: `LabelResource {id, name, color}`, `RelationTypeResource {id, name, outward_label, inward_label, built_in}`, `ResolutionResource {id, label, default_for, position, archived_at}`.
  - Matrix: neun Zeilen (Save legt neu an; Delete auf einer frischen, nicht mitgelieferten bzw. nicht standardmäßigen Factory-Zeile); Routen zwölf Zeilen; Race-Datensatz die sechs schreibenden Actions, dazu der Fall „keeps exactly one default per category when two resolutions take it at once“ (Verbindung 1 macht Duplicate zum Standard für Completed und hält; Verbindung 2 will Cannot reproduce → wartet; danach ist genau Cannot reproduce Standard, Duplicate und Done haben ihr `resolution.updated`).

- [ ] **Step 1: Failing Tests schreiben**

`LabelsApiTest.php`: anlegen, umbenennen, Farbe ändern (Events); „refuses a name that exists in another case and a tone that does not exist“; „deletes a label and answers how many items had it“ (`{affected_items: 0}`, Event); „records nothing when nothing changes“; Member 403 mit Satz.

`RelationTypesApiTest.php`: „lists the built-in types first with blocks and is blocked by“; „creates a symmetric type with a null inward label and refuses an empty one“; „renames a built-in type but keeps it built in“ (Eingabe `built_in: null` ändert nichts); „never deletes a built-in type“ (409 `built_in`, `detail` mit Namen); „deletes an own type“ (`{affected_relations: 0}`).

`ResolutionsApiTest.php`: „lists the resolutions by position“; „appends a new resolution and ignores the position it is sent“; „makes a resolution the default of its category and takes the mark from the old one“ (zwei Events); „refuses to leave a category without a default“; „refuses to archive a default“; „archives and restores a resolution, stamping the time itself“; „never deletes a default“ (409 `is_default`); „deletes an unused resolution“ (`{outcome: 'deleted'}`); Member 403.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='LabelsApiTest|RelationTypesApiTest|ResolutionsApiTest|CatalogLockRaceTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: manage labels, relation types and resolutions over REST`.

---

### Task 8: Projekte mit Workflow und Typen

**Files:**
- Create: `database/migrations/2026_10_31_000720_link_projects_to_catalog.php`, `app/Actions/Setup/LinkProjectsToCatalog.php`, `app/Actions/Projects/AssignWorkflow.php`, `tests/Feature/Api/ProjectWorkflowApiTest.php`, `tests/Feature/Api/CatalogFlowTest.php`, `tests/Integration/LinkProjectsToCatalogTest.php`
- Modify: `app/Actions/Projects/{CreateProject,UpdateProject,ListProjects,GetProject}.php`, `app/Support/ProjectInput.php`, `app/Policies/ProjectPolicy.php`, `app/Http/Resources/ProjectResource.php`, `app/Http/Controllers/Api/ProjectsController.php`, `app/Models/Project.php` (`@property string $workflow_id`, `string $default_type_id`), `database/factories/ProjectFactory.php`, `database/seeders/Demo/ProjectsSeeder.php` (alle drei vorerst mit Standard-Workflow, allen aktiven Typen und Task als Standard, sonst scheitert `DemoSeederTest` am NOT NULL; Task 9 setzt APP auf Agentur-Freigabe), `routes/api.php`, `tests/Feature/Api/{ProjectsApiTest,DeleteProjectTest,ProjectRightsTableTest}.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Integration/CatalogLockRaceTest.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Projekte: Workflow, Typen, Fremdschlüssel; der Satz „bis Phase 3 keinen Fremdschlüssel“ und „bis Phase 3 `workflow_id: null` …“ entfallen)

**Interfaces:**
- Consumes: Tasks 3–7, Phase 2 (`CreateProject`, `UpdateProject`, `MemberInput::lock`)
- Produces:
  - `App\Actions\Setup\LinkProjectsToCatalog::handle(): void` (Setup wie `EnsureCatalog`, ohne Actor-Parameter, nicht in der Matrix, idempotent): jedes Projekt ohne `workflow_id` bekommt den Standard-Workflow, jedes ohne aktivierte Typen alle nicht archivierten, jedes ohne `default_type_id` den ersten aktivierten; je geändertem Projekt `project.updated` mit den Feldern als `Actor::system(User::defaultBot(), 'setup')`. Migration `…_000720` ruft sie und macht danach `workflow_id`, `default_type_id` NOT NULL (`->change()`) mit Fremdschlüsseln `restrictOnDelete` (P23); `down()` nimmt die Fremdschlüssel weg und macht die Spalten wieder nullable. So steht kein schreibendes `DB::table` außerhalb von Actions.
  - `ProjectPolicy::changeWorkflow(User $user, Project $project): Response` — unsichtbar → `denyAsNotFound`, sonst `project.manage`, Satz `problem.detail.project_workflow_admins` „Den Workflow wechseln nur Admins des Projekts.“
  - `ProjectInput`: `normalize` wendet `Ids::normalize` auf `workflow_id`, `enabled_type_ids`, `default_type_id`, `mapping` an; neue Regeln `workflow()` (`Rule::exists('workflows', 'id')`, `field.workflow_id.unknown` „Diesen Workflow gibt es nicht.“), `types()` (array, min 1, distinct; `field.enabled_type_ids.required` „Mindestens ein Typ muss aktiviert sein.“, `field.enabled_type_ids.unknown` „Mindestens einen dieser Typen gibt es nicht.“, `field.enabled_type_ids.archived` „Ein archivierter Typ lässt sich nicht neu aktivieren.“), `field.default_type_id.enabled` „Der Standardtyp muss aktiviert sein.“, `field.default_type_id.archived` „Ein archivierter Typ kann nicht Standardtyp sein.“, `field.workflow_id.separate` „Den Workflow wechselst du mit einer Zuordnung der Status (PUT /api/v1/projects/{project}/workflow).“
  - `CreateProject`: nimmt `workflow_id` (Standard: der Standard-Workflow), `enabled_type_ids` (Standard: alle nicht archivierten Typen in Katalog-Reihenfolge, P10; jeder muss existieren und aktiv sein), `default_type_id` (Standard: der erste aktivierte; muss aktiviert sein). Alles unter der schon vorhandenen Sperre der Organisationszeile. Speichert `workflow_id`, `default_type_id`, `types()->sync()`. Das Event `project.created` bleibt (`changes.identifier`).
  - `UpdateProject`: nimmt `enabled_type_ids` und `default_type_id`; mit einem der beiden (oder `identifier`) nimmt es zuerst `CatalogLock::take()` (dieselbe Organisationszeile), dann wie bisher `MemberInput::lock`. Neu aktivierte Typen müssen aktiv sein, bereits aktivierte archivierte dürfen bleiben (P11); der Standardtyp (gesendet oder bisheriger) muss in der neuen Liste stehen und aktiv sein. `workflow_id` im Patch: gleich dem aktuellen → still übergangen (wer das ganze Objekt zurückschickt, bekommt kein 422), sonst 422 `workflow_id` mit `field.workflow_id.separate` (P9). `changes.enabled_type_ids` (`{old, new}` als Listen in Katalog-Reihenfolge) und `changes.default_type_id` nur bei echter Änderung.
  - `AssignWorkflow::handle(Actor $actor, Project $project, array $input): Project` — `Authorize::check($actor, 'changeWorkflow', $project)`; normalisieren; Transaktion: `CatalogLock::take()`, `MemberInput::lock($project)` (in Löschung → 404), frisch lesen; `workflow_id` required und vorhanden; `mapping` sometimes array, Schlüssel Status des bisherigen, Werte Status des neuen Workflows (`WorkflowInput::mappingErrors`, Fehler unter `mapping.<state_id>`; nur die Form, P5); gleicher Workflow → keine Änderung, kein Event; sonst `workflow_id` setzen, Event `project.updated` mit `changes.workflow_id`. Phase 4 ergänzt: Pflicht-Zuordnung für Status mit Items und den Job `RemapStates`.
  - `ProjectResource`: `workflow_id`, `enabled_type_ids` (IDs in Katalog-Reihenfolge aus `types`), `default_type_id`; `ListProjects` und `GetProject` laden `types:id` mit (eine Abfrage je Seite).
  - `ProjectsSeeder` (vorläufig): `workflow_id`, `default_type_id` und `types()->sync()` wie die Standardwerte von `CreateProject`.
  - `ProjectFactory`: `workflow_id` = `Workflow::default()->id`, `default_type_id` = erster nicht archivierter Typ; `configure()->afterCreating` aktiviert alle nicht archivierten Typen, wenn das Projekt noch keine hat.
  - REST: `PUT /api/v1/projects/{project}/workflow` → `ProjectResource` (`ProjectsController::assignWorkflow`).
  - Matrix: Zeile `AssignWorkflow` (`AssignWorkflow::run($a, $w->project($column), ['workflow_id' => Workflow::factory()->create()->id, 'mapping' => []])`, `$projectAdmins`, `hidden` `outsider_private`, Event `ProjectUpdated`); Route `switch the workflow of a project` (`params` WEB). Race: `AssignWorkflow` und `UpdateProject` mit `enabled_type_ids` in den Datensatz; dazu „never deletes a workflow that a project switches to meanwhile“ (Verbindung 1 weist WEB einen neuen Workflow zu und hält; Verbindung 2 `DeleteWorkflow` wartet; nach dem Commit 409 `in_use`).

- [ ] **Step 1: Failing Tests schreiben**

`ProjectsApiTest.php`: der Fall „takes no workflow and no types before Phase 3“ wird zu „takes the workflow and the types it is given“ (Agentur-Workflow aus `Workflow::factory()`, `[bug, epic]`, Standard `epic` → genau so in der Antwort und in `project_types`); neu „gives a new project the default workflow, every active type and the first as default“ (ein archivierter Typ fehlt); „refuses an unknown workflow, no types, an archived or unknown type and a default that is not enabled“ (Datensatz, je 422 am Feld; großgeschriebene ULIDs gehen durch: Gegenprobe zu `Ids`); „switches types on and off and moves the default“ (PATCH, Event mit `enabled_type_ids` und `default_type_id`); „keeps an archived type that was switched on, but switches on no archived one“; „passes the own workflow back without complaint and refuses another one in a patch“; der Fall „creates a project whose creator becomes its admin and lead“ erwartet `workflow_id` = Standard-Workflow, `enabled_type_ids` = Task, Bug, Epic und `default_type_id` = Task statt `null`.

`ProjectWorkflowApiTest.php`: „switches the workflow of a project and records it“ (200, `data.workflow_id`, Event `project.updated` `changes.workflow_id`); „records nothing when the workflow stays“; „checks the mapping against the old and the new states“ (422 `mapping.<id>`); „refuses an unknown workflow“; „hides a private project from outsiders and refuses members“ (404 ohne `detail` bzw. 403 mit `problem.detail.project_workflow_admins`); „answers 404 for a project that is being deleted“.

`DeleteProjectTest.php`: nach dem Purge sind auch die `project_types` des Projekts weg. `ProjectRightsTableTest.php`: Zeile `PUT workflow` je Rolle (Org-Admin ✓, Admin ✓, Member 403, Viewer 403, Nicht-Mitglied öffentlich 403, privat 404).

`tests/Integration/LinkProjectsToCatalogTest.php` (`DatabaseMigrations`): „links every project of phase 2 to the default workflow and the active types“ — `$this->artisan('migrate:rollback', ['--step' => 1])` (Spalten wieder nullable), ein Projekt ohne Workflow und Typen per `DB::table('projects')->insert(…)` anlegen (die Factory würde Typen aktivieren), `$this->artisan('migrate')`; danach Standard-Workflow, Task/Bug/Epic aktiviert, Task Standard, ein `project.updated` mit Grund `setup`; ein zweiter Lauf von `LinkProjectsToCatalog::run()` schreibt nichts; Gegenprobe Fremdschlüssel: `Workflow::default()->delete()` wirft `QueryException`.

`CatalogFlowTest.php` (Erfolgskriterium 2.1 und 2.2 ohne Item, REST mit einem Token `read`+`write` von Mara über `apiToken`): Workflow mit Matrix ohne Todo → Done anlegen (201); Projekt anlegen und per `PUT …/workflow` zuordnen (200); Property `customer` (Dropdown, zwei Optionen) und Typ „Kundenwunsch“ mit ihr als Pflicht anlegen (201), im Projekt aktivieren und zum Standard machen (200); `GET /api/v1/projects/{id}` zeigt beides. Die Hälfte „dann ein Item dieses Typs“ und 2.3 folgen in Phase 4 (Kommentar im Test).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ProjectsApiTest|ProjectWorkflowApiTest|DeleteProjectTest|ProjectRightsTableTest|CatalogFlowTest|LinkProjectsToCatalogTest|CatalogLockRaceTest|RightsMatrixTest|RouteMatrixTest'`, dann die ganze Suite (jede Factory-Projektzeile hat jetzt Workflow und Typen).

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: give projects a workflow, enabled types and a default type, and switch workflows over REST`.

---

### Task 9: Demo- und e2e-Daten

**Files:**
- Create: `database/seeders/Demo/CatalogSeeder.php`
- Modify: `database/seeders/DemoSeeder.php` (Reihenfolge: Organization, People, Bots, **Catalog**, Projects, Favorites, Tokens), `database/seeders/Demo/ProjectsSeeder.php`, `database/seeders/E2eSeeder.php`, `tests/Feature/DemoSeederTest.php`, `tests/Feature/E2eSeederTest.php`, `CLAUDE.md` (Seeder: Katalog, Aufräumen der `E2E`-Katalogeinträge)

**Interfaces:**
- Consumes: Tasks 3–8
- Produces:
  - `CatalogSeeder` (`WithoutModelEvents`, `updateOrCreate` über stabile Schlüssel: Workflow-Name, Typ-Name, Property-`key`, Label-Name, `built_in` bzw. Name der Relationstypen; zweimal laufen ändert nichts):
    - Texte der mitgelieferten Einträge auf den deutschen Stand des Klickdummys (`src/api/seed/config.ts`, `src/domain/fixtures.ts`): Beschreibung des Standard-Workflows, der Typen („Ein Fehler, der behoben werden muss. Die Umgebung, in der er auftritt, ist Pflicht.“), Property `effort` „Aufwand (h)“, Relationstypen „blockiert“/„wird blockiert von“, „Duplikat“, „verwandt“.
    - Workflow „Agentur-Freigabe“ mit den sieben Status und 14 Übergängen aus `src/domain/fixtures.ts` (`agency`).
    - Properties `customer` (Dropdown: Studio Nordlicht `sky`, Hafenkontor `ochre`, Gärtnerei Moos `moss`), `environment` (Produktion, Staging, Lokal), `browser` (Text), `ticket_url` (URL), `approved` (Boolean, Standard `false`), `reviewer` (Personenauswahl), `steps` (Rich Text), `target_quarter` (Q4 2026, Q1 2027, Q2 2027), je mit Label und Hilfetext aus dem Seed.
    - Typen: Task (`customer`, `effort`), Bug (`customer`, `effort`, `environment` Pflicht, `browser`, `steps`), Epic (`target_quarter`, `customer`), Kundenwunsch (`message-square-heart`, `plum`; `customer` Pflicht, `ticket_url`, `approved`, `reviewer`).
    - Labels: UX, Formulare, Produktion, Performance, SEO, Barrierefreiheit, Backend, Design mit ihren Tönen; Relationstyp „testet“/„wird getestet von“.
  - `ProjectsSeeder`: WEB und OPS mit Standard, Task/Bug/Epic, Standard Task; APP mit Agentur-Freigabe, Task/Bug/Epic/Kundenwunsch, Standard Task (`src/api/seed/people.ts`).
  - `E2eSeeder`: nach dem Entfernen der `E2E`-Projekte entfernt er die Katalogeinträge früherer Läufe, deren Name bzw. Label mit `E2eSeeder::PROJECT_PREFIX` (`E2E `) beginnt — über die Delete-Actions mit `Actor::automation('e2e_reset')` (Reihenfolge: Typen, Properties, Workflows, Labels, Relationstypen, Resolutions; keiner davon ist Standard, P18).

- [ ] **Step 1: Failing Tests schreiben**

`DemoSeederTest.php`: „seeds the catalog of the clickdummy“ — Property-Schlüssel und Label-Namen gleich denen aus `prototypes/clickdummy/src/api/seed/config.ts` (per Regex wie `clickdummySeed()`, als Closure in der Datei), Workflows `['Standard', 'Agentur-Freigabe']`, Agentur-Freigabe mit 14 Übergängen und ohne Befunde (`graph()->issues()`), Typen `['Task', 'Bug', 'Epic', 'Kundenwunsch']` mit Pflicht-Properties (Bug: `environment`, Kundenwunsch: `customer`), vier Relationstypen; „gives WEB, APP and OPS their workflow and types“; „seeds the catalog again without duplicates“ (zweimal `DemoSeeder` → gleiche Zahlen, gleiche IDs).

`E2eSeederTest.php`: „removes the catalog entries of earlier runs and keeps the demo ones“ (je ein `E2E …`-Workflow, -Typ, -Property, -Label, -Relationstyp, -Resolution vor dem Lauf → danach weg; Agentur-Freigabe, Kundenwunsch, UX bleiben).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='DemoSeederTest|E2eSeederTest'`; `ddev artisan migrate:fresh --seed --seeder=DemoSeeder` läuft ohne Fehler.

- [ ] **Step 3: Gates G1, G3** (der `E2eSeeder` läuft im Global-Setup).

- [ ] **Step 4: Commit** — `feat: seed the workflows, types, properties and catalogs of the clickdummy and clean up e2e catalog entries`.

---

### Task 10: Frontend-Datenschicht

**Files:**
- Create: `resources/js/api/{workflows,workItemTypes,properties,catalog}.ts`, `resources/js/api/{workflows,workItemTypes,properties,catalog}.test.ts`, `resources/js/hooks/{workflows,workItemTypes,properties,catalog}.ts`, `resources/js/domain/workflow.ts`, `resources/js/domain/workflow.test.ts`
- Modify: `resources/js/types.ts` (`Project.workflow_id: string`, `default_type_id: string`, Kommentare ohne „bis Phase 3“), `resources/js/api/projects.ts` (`CreateProjectInput` mit `workflow_id?`, `enabled_type_ids?`, `default_type_id?` wie der Klickdummy; Kommentare), `resources/js/test/fixtures.ts`, `resources/js/hooks/data.test.tsx`, `resources/js/features/projects/projects.test.tsx` und `resources/js/features/settings/project/project.test.tsx` (nur Fixtures, falls sie `null` erwarten)

**Interfaces:**
- Consumes: REST aus Tasks 5–8
- Produces:
  - `api/workflows.ts`: `export type WorkflowInput = Omit<Workflow, 'id' | 'states'> & { id?: string; states: (Omit<State, 'id'> & { id?: string })[] }`; `listWorkflows(args: PageArgs = {}): Promise<Page<Workflow>>` (`getPage('/workflows', args)`); `saveWorkflow(spec: WorkflowInput, options: { state_mapping?: Record<string, string> } = {}): Promise<Workflow>` (mit `id` → `PUT /workflows/{id}`, sonst `POST /workflows`; Körper `{ ...spec, ...options }` ohne `id`); `deleteWorkflow(id: string): Promise<void>`; `assignWorkflow(project_id: string, workflow_id: string, mapping: Record<string, string>): Promise<Project>` (`PUT /projects/{ref}/workflow`, Referenz escaped wie `projectPath`). Kein `STATE_ICONS` hier (Konstanten: `features/settings/catalog/choices.ts`, Task 11).
  - `api/workItemTypes.ts`: `export type WorkItemTypeInput = Omit<WorkItemType, 'id' | 'archived_at'> & { id?: string; archived_at?: string | null }`; `listWorkItemTypes(args?)`, `saveWorkItemType(input)`, `deleteWorkItemType(id): Promise<{ outcome: 'deleted' | 'archived' }>`.
  - `api/properties.ts`: `export type PropertyInput = Omit<Property, 'id' | 'options'> & { id?: string; options: (Omit<PropertyOption, 'id' | 'archived_at'> & { id?: string; archived_at?: string | null })[] }`; `listProperties(args?)`, `saveProperty(input)`, `deleteProperty(id): Promise<{ affected_items: number }>`.
  - `api/catalog.ts`: `type SaveInput<T extends { id: string }> = Omit<T, 'id'> & { id?: string }`; `listLabels(args?)`, `saveLabel(input)`, `deleteLabel(id): Promise<{ affected_items: number }>`, `listRelationTypes(args?)`, `saveRelationType(input)`, `deleteRelationType(id): Promise<{ affected_relations: number }>`, `listResolutions(args?)`, `saveResolution(input)`, `deleteResolution(id): Promise<{ outcome: 'deleted' | 'archived' }>`.
  - Hooks (Query-Keys aus `keys.ts`, Listen über `allPages`): `useWorkflows()`, `useSaveWorkflow()` (Variablen `{ workflow, options? }`, invalidiert `'all'`), `useDeleteWorkflow()` (`[qk.workflows.all]`), `useAssignWorkflow()` (`{ project_id, workflow_id, mapping }`, `'all'`); `useWorkItemTypes()`, `useSaveWorkItemType()` (`[qk.workItemTypes.all]`), `useDeleteWorkItemType()` (`[qk.workItemTypes.all, qk.projects.all]`); `useProperties()`, `useSaveProperty()` (`[qk.properties.all]`), `useDeleteProperty()` (`[qk.properties.all, qk.workItemTypes.all]`); `useLabels()`, `useSaveLabel()`, `useDeleteLabel()`, `useRelationTypes()`, `useSaveRelationType()`, `useDeleteRelationType()`, `useResolutions()`, `useSaveResolution()`, `useDeleteResolution()` (je der eigene Schlüssel). Die Invalidierung von Items, Views und Vorlagen kommt mit deren Phasen.
  - `domain/workflow.ts`: wörtlicher Port (`CATEGORY_ORDER`, `isClosedCategory`, `statesInOrder`, `canTransition`, `allowedTargets`, `WorkflowIssue`, `validateWorkflow`).
  - `test/fixtures.ts`: `standard`, `agency` (IDs `std_*`/`app_*` wie im Klickdummy), `resolutions`, `types` (`t_task`, `t_bug`, `t_epic`, `t_wish`), `properties` (`pr_customer` Dropdown, `pr_effort` Zahl, `pr_environment`), `labels`, `relationTypes`; `project()` setzt `workflow_id: 'wf_standard'`, `enabled_type_ids: ['t_task', 't_bug', 't_epic']`, `default_type_id: 't_task'`.

- [ ] **Step 1: Failing Tests schreiben**

`domain/workflow.test.ts`: Port von `src/domain/workflow.test.ts`, Fixtures aus `@/test/fixtures`.

API-Tests mit `mockApi`: „lists the workflows of one page and passes the cursor“; „creates a workflow with POST and changes one with PUT, the state mapping in the body“ (Körper ohne `id`); „deletes a workflow“; „switches the workflow of a project by its escaped reference“ (`assignWorkflow('WEB/x', …)` → `PUT /api/v1/projects/WEB%2Fx/workflow`); „answers the outcome of deleting a type unwrapped“ (`{outcome}` ohne `data`); ebenso für Properties, Labels, Relationstypen, Resolutions. Hooks in `data.test.tsx`: „follows next_cursor for every catalog list“ (zwei Seiten → sechs Hooks liefern beide Seiten), „reloads the types and the projects after deleting a type“ (Invalidierung über `queryClient.isFetching` bzw. die Aufrufe in `mockApi.calls`).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/api resources/js/hooks resources/js/domain`.

- [ ] **Step 3: Gates G2**

- [ ] **Step 4: Commit** — `feat: add the frontend data layer of workflows, types, properties and catalogs`.

---

### Task 11: Katalog-Abschnitte der Organisation, gemeinsame Teile, Labels, Relationstypen, Resolutions

**Files:**
- Create: `resources/js/features/settings/catalog/{choices.ts,ToneSelect.tsx,localId.ts,catalog.test.tsx}`, `resources/js/features/settings/org/catalogs/{Labels,RelationTypes,Resolutions}.tsx`, `resources/js/features/settings/org/catalogs/catalogs.test.tsx`, `e2e/tests/catalogs.spec.ts`
- Modify: `resources/js/features/settings/org/{sections.ts,OrgSettings.tsx}`, `resources/js/features/settings/org/org.test.tsx` (Abschnittsliste), `vitest.config.ts` (`resources/js/features/settings/catalog/**` 100 %), `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Einstellungen der Organisation: Gruppe Kataloge, `catalog/`)

**Interfaces:**
- Consumes: Task 10, Einstellungsrahmen (`frame/*`), `components/ui/{FormDialog,IconButton,Switch,Select,EmptyState,Menu}`, aus `frame/parts` `Panel`, `Rows`, `Row`, `Badge`, `Loaded`, `RowsSkeleton`, `SectionHeader`
- Produces:
  - `sections.ts`: `SectionSlug` um `'workflows' | 'types' | 'properties' | 'labels' | 'relation-types' | 'resolutions'` erweitert (die drei ersten mit Task 12 und 13; in dieser Task nur `labels`, `relation-types`, `resolutions`), `SectionGroup = 'organization' | 'catalogs'`, `GROUP_NAMES.catalogs = 'settings.org.group.catalogs'` („Kataloge“); `SectionDef` bekommt `labelKey: TranslationKey` (feste Zuordnung, `relation-types` → `settings.org.section.relation_types`, P21), `sectionLabel` liest `labelKey`. Kataloge: `permission: 'org.manage_catalog'`, `members: 'read'`. Reihenfolge in der Liste wie der Klickdummy: Workflows, Typen, Properties, Labels, Relationstypen, Resolutions (spätere Tasks fügen an ihrer Stelle ein).
  - `catalog/choices.ts` (eine Quelle, 13b „STATE_ICONS duplicated“): `TONES: readonly TypeTone[]`, `TONE_LABELS: Record<TypeTone, TranslationKey>` (`settings.catalog.tone.sky` „Himmel“ …); `STATE_ICONS`, `STATE_ICON_LABELS: Record<StateIcon, TranslationKey>` (`settings.catalog.state_icon.three_quarter` „Dreiviertel gefüllt“ …); `CATEGORY_LABELS`, `CATEGORY_HINTS: Record<StateCategory, TranslationKey>`; `FIELD_TYPES`, `FIELD_TYPE_LABELS`, `FIELD_TYPE_HINTS: Record<FieldType, TranslationKey>`; `TYPE_ICON_LABELS: Record<TypeIconName, TranslationKey>` (`settings.catalog.type_icon.square_check` „Häkchen im Quadrat“ …). Feste Records statt gebauter Schlüssel, damit der Scan sie findet.
  - `catalog/localId.ts`: `localId(prefix: string): string` (Port aus `settings/org/localId.ts`; IDs für neue Status und Optionen, bevor der Server sie kennt, P3).
  - `catalog/ToneSelect.tsx`: `ToneSelect({ value, onChange, label, disabled? })` — Port von `ToneMenu` aus `settings/org/parts.tsx` (Menü mit Radio-Einträgen, Farbpunkt `ToneDot`, Name aus `TONE_LABELS`; Trigger nennt den gewählten Ton).
  - `catalogs/Labels.tsx`: Liste (`Panel`, `Rows`), Dialog „Label anlegen/bearbeiten“ (`FormDialog`, Name mit Fokus, `ToneSelect`; 422 am Feld, nicht platzierte Meldungen per `noticeOf`), Löschen über `useRemoval` mit Rückgängig, Toast „Label „:name“ gelöscht“ (ohne Zahl, P6); leerer Zustand mit „Label anlegen“.
  - `catalogs/RelationTypes.tsx`: Liste mit beiden Beschriftungen bzw. „symmetrisch“, Badge „Mitgeliefert“, Löschen mitgelieferter gesperrt mit Grund (`disabledReason` „„:name“ ist mitgeliefert und lässt sich nicht löschen.“); Dialog mit Name, Richtung, Switch „Symmetrisch“ (aus → Feld Gegenrichtung erscheint und bekommt den Fokus), leerer Zustand **mit** „Relationstyp anlegen“ (13c-Befund).
  - `catalogs/Resolutions.tsx`: Liste nach Position mit Badges „Standard für Completed/Canceled“ und „Archiviert“; Löschen eines Standards gesperrt mit Grund; Dialog (Label, „Standard für“ als `Select` mit „Kein Standard“, Switch „Archiviert“ nur beim Bearbeiten, gesperrt für einen Standard mit Hinweis); `{outcome: 'archived'}` zeigt den Toast „Resolution „:label“ ist archiviert“ (Phase 4 liefert ihn; Vitest prüft ihn schon).
  - Alle drei: Members lesen (`ReadOnlyNotice`, keine Schaltflächen), Lade- (`Loaded` mit `RowsSkeleton`) und Fehlerzustand (`SettingsError` mit „Erneut versuchen“), Dialoge geben den Fokus an den Auslöser zurück, nach dem Löschen geht er an den Nachbarn (`useRemoval`).
  - Texte unter `settings.org.group.catalogs`, `settings.org.section.{labels,relation_types,resolutions}`, `settings.catalog.*`, `settings.labels.*`, `settings.relation_types.*`, `settings.resolutions.*`.

- [ ] **Step 1: Failing Tests schreiben**

`catalog.test.tsx`: `ToneSelect` wählt per Tastatur (Pfeile, Enter) und nennt den Ton; `localId('st')` gibt verschiedene IDs mit Präfix; jede `choices`-Zuordnung zeigt auf einen vorhandenen Schlüssel (`t()` liefert nicht den Schlüssel zurück).

`catalogs.test.tsx` (`mockApi`): Labels — Fehler beim Laden mit erneutem Versuch, leerer Zustand mit Knopf, 422 `name` am Feld mit Fokus, Löschen scheitert → Zeile kommt zurück mit Fehler-Toast, Member ohne Knöpfe; Relationstypen — mitgeliefert ohne Löschen mit Grund, Symmetrisch-Schalter, 409 `built_in` als Toast mit `detail`, leerer Zustand mit Knopf; Resolutions — Standard-Badges, Standard nicht löschbar, Archiv-Schalter für Standard gesperrt, `outcome: 'archived'` → Toast, 422 `default_for` mit Text im Dialog.

`e2e/tests/catalogs.spec.ts` (als Erik, nur Tastatur, Namen `E2E <variant> <runId> …`, Aufräumen per `api()` im `finally`):
- „creates, renames and deletes a label with undo“ (Abschnitt über die Navigation der Einstellungen, „Label anlegen“, Name, Ton per `ToneSelect`, Enter; umbenennen; Löschen → Zeile weg, ⌘Z bzw. „Rückgängig“ → wieder da; erneut löschen und auslaufen lassen → per API weg).
- „creates a symmetric relation type and cannot delete a built-in one“ (Löschen bei „blocks“ gesperrt, Tooltip nennt den Grund).
- „creates a resolution and archives it“ (kein Standardwechsel, P18).
- „lets a member read the catalogs only“ (Lene über `signedInContext`: `/settings/labels` zeigt den Lesehinweis, kein „Label anlegen“).
- „shows the error of a list that fails to load and loads it again“ (`page.route('**/api/v1/labels*', 503)` einmal, dann „Erneut versuchen“).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings`; `pnpm --dir e2e test -- catalogs settings-organization`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: port the catalog sections of the organization settings with labels, relation types and resolutions`.

---

### Task 12: Typen und Properties in den Einstellungen

**Files:**
- Create: `resources/js/features/settings/org/types/{Types,TypeDialog,IconPicker}.tsx`, `resources/js/features/settings/org/properties/{Properties,PropertyDialog,OptionRows,DefaultValueField,keyFrom}.ts(x)`, `resources/js/features/settings/org/types/types.test.tsx`, `resources/js/features/settings/org/properties/{properties.test.tsx,keyFrom.test.ts}`, `e2e/tests/types-properties.spec.ts`
- Modify: `resources/js/features/settings/org/{sections.ts,OrgSettings.tsx}`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Tasks 10, 11 (`choices.ts`, `ToneSelect`), `components/ui/{SortableList,TypeTab,Checkbox,Switch,Select,Input,Textarea,AlertDialog}`
- Produces:
  - Abschnitte `types` (Icon `Shapes`) und `properties` (Icon `SlidersHorizontal`) in `sections.ts`.
  - `types/Types.tsx`: Liste mit `TypeTab`, Badges „In der Timeline“ (Epic) und „Archiviert“, Chips der Properties (Pflicht markiert); Aktionen je Zeile: Bearbeiten; aktiv → Löschen über `useRemoval` (Antwort `archived` → Toast „Typ „:name“ ist archiviert“ mit „Wiederherstellen“; 409 `default_type` → Fehler-Toast mit `detail`, Zeile kommt zurück); archiviert → Wiederherstellen (`saveWorkItemType` mit `archived_at: null`). Ohne Zählung „Bei N Items“ (P6).
  - `types/TypeDialog.tsx`: Name (Fokus), `IconPicker`, `ToneSelect`, Beschreibung, Switch „Epic“ (Hinweis „Items dieses Typs erscheinen in der Timeline und können Kind-Items haben.“), Properties: `SortableList` der zugeordneten mit Checkbox „Pflicht“ und Entfernen, darunter `Select` „Property hinzufügen“ mit den nicht zugeordneten; Vorschau des Reiters (`TypeTab`). 422 am Feld (`name`, `icon`, `tone`, `properties`), sonst als Hinweis.
  - `types/IconPicker.tsx`: Radiogruppe der 20 Icons (Base UI `RadioGroup`, Pfeiltasten), Namen aus `TYPE_ICON_LABELS`.
  - `properties/keyFrom.ts`: `keyFrom(label: string): string` (Port samt Umlauten, Ziffer vorn → `p_…`, höchstens 40 Zeichen).
  - `properties/Properties.tsx`: Liste mit Feldtyp, Schlüssel (`translate="no"`), Optionen als Chips; Löschen über eine Bestätigung (`AlertDialog`, Spec 4.7 „mit Bestätigung“) mit dem Text „Die Werte der Items verschwinden. Die History behält sie. Aus Typen, Views und Vorlagen verschwindet die Property auch.“ (ohne Zahl, P6), danach Toast; Fokus nach dem Löschen auf den Nachbarn.
  - `properties/PropertyDialog.tsx`: Port (Label → Schlüssel folgt, bis jemand ihn tippt; Schlüssel und Feldtyp beim Bearbeiten schreibgeschützt mit Schloss und Hinweis; Nachkommastellen für Zahl; Switch „Mehrfachauswahl“ für Dropdown und Personenauswahl (Spec 4.7; der Klickdummy zeigt ihn nur beim Dropdown), beim Bearbeiten nur von aus nach an; `OptionRows`; `DefaultValueField` bzw. der Hinweis „Für :type gibt es keinen Standardwert. Das Feld beginnt leer.“). Neue Optionen bekommen eine lokale ID (`localId('opt')` aus `catalog/localId.ts`, Task 11), damit der Standardwert sie nennen kann (P3). Ein Standardwert, der auf eine archivierte oder entfernte Option zeigt, wird vor dem Senden geleert (wie der Klickdummy).
  - `properties/OptionRows.tsx`: `SortableList` der Optionen mit Label, `ToneSelect`, Archivieren/Wiederherstellen für gespeicherte, Entfernen für neue; „Option hinzufügen“ fokussiert das neue Label.
  - `properties/DefaultValueField.tsx`: `DefaultValueField({ property, value, onChange, error })` — Text/URL: `Input`; Zahl: `Input` mit `inputMode="decimal"`, nimmt Komma und Punkt (der Befund „0.500 wird 500“ aus 13b gilt hier nicht: kein Tausendertrennzeichen); Dropdown einfach: `Select` mit „Kein Standardwert“; mehrfach: Checkbox-Gruppe; Boolean: `Switch`; Datum: `Input type="date"` (P15).
  - Texte unter `settings.types.*`, `settings.properties.*`, `settings.org.section.{types,properties}`.

- [ ] **Step 1: Failing Tests schreiben**

`keyFrom.test.ts`: „Prüfstufe (intern)“ → `pruefstufe_intern`; „Größe“ → `groesse`; „2. Kunde“ → `p_2_kunde`; 60 Zeichen → 40 ohne `_` am Ende; „  “ → `''`.

`types.test.tsx`: Dialog legt einen Typ mit Pflicht-Property an (Körper `properties: [{property_id, required: true}]` in Reihenfolge), sortiert per Tastatur (Leertaste, Pfeil, Leertaste), 422 `icon` am Icon-Feld, 409 `default_type` beim Löschen → Toast mit `detail` und Zeile zurück, Antwort `archived` → Toast mit „Wiederherstellen“, archivierter Typ → Wiederherstellen sendet `archived_at: null`, Member ohne Aktionen, Ladefehler.

`properties.test.tsx`: Schlüssel folgt dem Label bis zur eigenen Eingabe; 422 `key` (`field.key.core`) am Feld mit Fokus; Dropdown mit zwei neuen Optionen und Standard auf der zweiten → Körper nennt deren lokale ID; Optionen archivieren; Feldtyp-Wechsel leert den Standard; Personenauswahl ohne Standard mit Hinweis; Zahl „3,5“ wird `3.5`; Löschen erst nach Bestätigung, Abbrechen lässt die Zeile; Ladefehler.

`e2e/tests/types-properties.spec.ts` (Erik, Tastatur, Aufräumen im `finally`):
- „creates a dropdown property and a type that requires it“ (Erfolgskriterium 2.2 ohne Item, UI: Property „E2E … Kunde“ mit zwei Optionen; Typ „E2E … Wunsch“, Icon per Pfeiltasten, Property hinzufügen, „Pflicht“ an, ⌘⏎; die Zeile zeigt „… (Pflicht)“; per API geprüft: `required: true`).
- „refuses the key of a core field at the field“ (Label „Title“ → Schlüssel `title`, Fehler am Schlüsselfeld, Fokus dort).
- „restores an archived type“ (Typ per API mit `archived_at` angelegt, „Wiederherstellen“ per Tastatur, Badge weg).
- „deletes a property after confirming“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings/org`; `pnpm --dir e2e test -- types-properties`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: port the types and properties sections of the organization settings`.

---

### Task 13: Workflows in den Einstellungen (Liste, Editor, Übergangsmatrix, Status-Zuordnung)

**Files:**
- Create: `resources/js/features/settings/org/workflows/{Workflows,WorkflowEditor,StateRows,IssueList,TransitionMatrix,draft}.ts(x)`, `resources/js/features/settings/org/workflows/{workflows.test.tsx,matrix.test.tsx,draft.test.ts}`, `resources/js/features/settings/catalog/{StateMappingDialog.tsx,mapping.ts,mapping.test.ts}`, `e2e/tests/workflows.spec.ts`
- Modify: `resources/js/features/settings/org/{sections.ts,OrgSettings.tsx}`, `resources/js/features/settings/catalog/catalog.test.tsx`, `resources/js/lib/links.ts` (+ Test), `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Workflow-Editor als Ansicht mit Query, Status-Zuordnung einmal)

**Interfaces:**
- Consumes: Tasks 10, 11, `components/ui/{SortableList,StatusIcon,Menu,Switch,Select,Input,Textarea,Banner,EmptyState}`, `frame/LeaveGuard`, `domain/workflow.ts`
- Produces:
  - `lib/links.ts`: `paths.workflow(id: string)` → `/settings/workflows?workflow=<id>`, `paths.newWorkflow(from?: string)` → `/settings/workflows?workflow=new[&from=<id>]`; `useSearchParam(name: string): string | null` (liest `usePage().url`). Der Editor ist eine Ansicht des Abschnitts (P17): Zurück, Vor und Links funktionieren, der Server rendert dieselbe Seite.
  - Abschnitt `workflows` (Icon `Workflow`) in `sections.ts`, an erster Stelle der Kataloge.
  - `workflows/draft.ts` (rein): `Draft`, `DraftState`, `draftOf(workflow)`, `copyDraftOf(workflow)` (neue lokale Status-IDs, Übergänge folgen, Name „:name (Kopie)“, nie Standard), `blankDraft()` (fünf Status wie der Klickdummy, frei), `comparable(draft)`, `toInput(draft, id?)`, `allPairs(states)`, `toWorkflow(draft, id)`.
  - `workflows/Workflows.tsx`: Liste der Karten (Name, Badge „Standard“, „Frei“ bzw. „Mit Übergangsmatrix“, Beschreibung, Status als Chips mit `StatusIcon`, Startstatus, „Benutzt von“ mit `ProjectBadge`-Links aus `useProjects({ include_archived: true })`); Aktionen „Bearbeiten“/„Ansehen“ (Link), „Duplizieren“ (Link), „Löschen“ gesperrt mit Grund (Standard bzw. „WEB, OPS benutzen ihn noch. Wechsle dort zuerst den Workflow.“), sonst über `useRemoval` mit Rückgängig; „Workflow anlegen“. Mit `?workflow=` zeigt der Abschnitt den Editor; eine unbekannte ID zeigt „Diesen Workflow gibt es nicht“ mit Link zur Liste; ein Member mit `?workflow=new` bekommt den Lesehinweis und den Link zur Liste statt eines leeren Formulars (13c-Befund).
  - `workflows/WorkflowEditor.tsx` (die Hülle, 13b: Datei geteilt): Formular mit Name, Beschreibung, Switch „Standard-Workflow“ (beim Standard gesperrt mit Hinweis), Startstatus (`Select`), `StateRows`, Switch „Freie Übergänge“ (aus → Matrix startet mit `allPairs`), `TransitionMatrix`, `IssueList`; ⌘⏎ und Enter in einem Feld senden (`useSaveShortcut`), der Knopf bleibt aktiv; mit Befunden speichert ein Senden nichts und setzt den Fokus auf die `IssueList`. Antworten: 422 `invalid_workflow` → Befunde aus `extensions.issues` (Status per Eingabe-ID gefunden); 422 an `name` → Feld mit Fokus; andere 422 → Hinweis mit allen Meldungen (13b „422 non-name swallowed“); 409 `state_in_use` (ab Phase 4) → `StateMappingDialog` und erneutes Speichern mit `state_mapping`. Nach dem Anlegen `router.visit(paths.workflow(id), { replace: true })` und Toast „Workflow „:name“ gespeichert“, Fokus auf die Überschrift. `LeaveGuard` mit `what` „den Workflow“ (einer je Bildschirm). Members sehen alles schreibgeschützt (`readOnly`).
  - `workflows/StateRows.tsx`: `SortableList` der Status mit Form (`Menu` mit `STATE_ICONS`), Name, Kategorie (`Select` mit Hinweis), Entfernen; „Status hinzufügen“ fokussiert den neuen Namen. Eine Trennlinie läuft über die ganze Zeile (13b „truncated divider lines“).
  - `workflows/IssueList.tsx`: Liste der Befunde aus `validateWorkflow` mit Satz und Abhilfe („Review ist vom Startstatus aus nicht erreichbar“ / „Erlaube in der Matrix einen Übergang von einem erreichbaren Status in diesen.“), `role="alert"` erst nach einem Senden, vorher als Status-Region; `tabIndex={-1}` für den Fokus; ohne Befunde „Der Workflow ist vollständig“.
  - `workflows/TransitionMatrix.tsx`: Port mit den drei Zugänglichkeitsregeln des Klickdummys (ein Tab-Stopp, Pfeile, Home/End, Strg+Home/End, Leertaste/Enter schalten, Diagonale nicht schaltbar, Zellen „Von :from nach :to“, Kopfspalte bleibt stehen); dazu die 13b-Befunde: der Effekt hängt an einer per `useMemo` stabilen Statusliste, der Scroll-Container hat `scroll-pr-2` (Fokusring am rechten Rand), unerreichbare Zeilen sind markiert.
  - `catalog/mapping.ts` (R26, eine Zuordnung für beide Fälle): `suggestTarget(state: State, targets: State[], initialStateId: string): State` (Port von `bestMatch` mit `NEIGHBOURS`), `suggestMapping(from: State[], to: Workflow): Record<string, string>`, `countByState(items)`, `mappingEffects(from, to, mapping, counts)`.
  - `catalog/StateMappingDialog.tsx`: `StateMappingDialog({ open, onOpenChange, title, description, rows: { state: State; count: number }[], targets: State[], initialStateId, submitLabel, pending, notice, effects?, emptyText?, onConfirm(mapping), finalFocus? })` — eine Zeile je Status mit Zahl und `Select` des Ziels (Vorschlag aus `suggestTarget`), Banner für wieder geöffnete bzw. geschlossene Items aus `effects`, ohne Zeilen `emptyText`; `FormDialog` (⌘⏎ über `dialog.submit`). Während `pending` lässt sich der Dialog nicht schließen (der Dialog reicht `onOpenChange(false)` dann nicht weiter, „Abbrechen“ ist gesperrt; `FormDialog` selbst bleibt unverändert), danach geht der Fokus an `finalFocus` oder, wenn der Auslöser gesperrt ist, an die Überschrift (13b „Escape during workflow switch“).
  - Texte unter `settings.workflows.*`, `settings.catalog.mapping.*`, `settings.org.section.workflows`.

- [ ] **Step 1: Failing Tests schreiben**

`draft.test.ts`: Kopie mit neuen IDs und folgenden Übergängen, nie Standard; `comparable` ignoriert Reihenfolge der Übergänge und Leerzeichen; `toInput` setzt Positionen; `allPairs` ohne Diagonale.

`mapping.test.ts`: Port von `settings/project/mapping.test.ts` plus „suggests a state of the same category for a removed state, else the start“.

`matrix.test.tsx`: Port von `settings/org/matrix.test.tsx` (Tastatur im Raster, Diagonale, Strg+Enter geht durch); der Quelltext-Test liest die Datei per `?raw` statt `readFileSync`.

`workflows.test.tsx` (`mockApi`): Liste mit Sperrgründen beim Löschen; Editor zeigt die Befunde live und setzt nach ⌘⏎ mit Befunden den Fokus auf die Liste, ohne zu senden; 422 `invalid_workflow` vom Server markiert den Status per Eingabe-ID; 422 an `description` erscheint als Hinweis; 409 `state_in_use` öffnet die Zuordnung und sendet `state_mapping`; Anlegen führt auf `?workflow=<id>`; unbekannte ID; Member mit `?workflow=new`; Duplizieren übernimmt Status mit neuen IDs; Verlassen mit Änderungen fragt (`LeaveGuard`); Ladefehler.

`catalog.test.tsx`: `StateMappingDialog` mit Zeilen, Vorschlag, geänderter Auswahl, Effekt-Bannern, leerem Zustand, gesperrtem Schließen während `pending`.

`e2e/tests/workflows.spec.ts` (Erik, Tastatur):
- „refuses Agentur-Freigabe without the transition into Review (flow 7)“ — Workflows → „Bearbeiten Agentur-Freigabe“; in der Matrix per Pfeiltasten zur Zelle „From In Progress to Review“, Leertaste; die Befundliste nennt `tr('en', 'settings.workflows.issue.unreachable', { name: 'Review' })` (auch Kundenfreigabe, Done); ⌘⏎ → Fokus auf der Befundliste, kein `PUT` (`page.on('request')` zählt), per API unverändert 14 Übergänge; Verlassen → Frage → „Verwerfen“. Ändert nichts Gespeichertes, läuft also parallel in allen Projekten.
- „creates a workflow with a transition matrix“ (Name `E2E … Flow`, „Freie Übergänge“ aus, zwei Zellen ab, ⌘⏎, Toast, Adresse `?workflow=<ulid>`, in der Liste „Mit Übergangsmatrix“).
- „duplicates a workflow and deletes the copy with undo“.
- „asks before leaving unsaved changes“ (Browser-Zurück).
- „shows a member the workflows read-only“ (Lene).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings resources/js/lib/links`; `pnpm --dir e2e test -- workflows`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: port the workflows section with editor, transition matrix and one state mapping dialog`.

---

### Task 14: Projekt: Workflow, Typen und „Neues Projekt“

**Files:**
- Create: `resources/js/features/settings/project/{Workflow,Types}.tsx`, `e2e/tests/project-catalog.spec.ts`
- Modify: `resources/js/features/settings/project/{ProjectSettings.tsx,project.test.tsx}`, `resources/js/features/projects/{CreateProjectDialog.tsx,projects.test.tsx}`, `e2e/helpers.ts` (`createProjectFromSidebar` wartet, bis Workflow und Typen geladen sind), `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Projekteinstellungen: Abschnitte Workflow und Typen; Dialog „Neues Projekt“)

**Interfaces:**
- Consumes: Tasks 10, 13 (`StateMappingDialog`, `mapping.ts`), `frame/*`
- Produces:
  - `ProjectSettings`: `SECTIONS = ['general', 'members', 'workflow', 'types']` (Automatisierungen mit Phase 10).
  - `project/Workflow.tsx`: Karte „Aktueller Workflow“ (Name als fokussierbare Überschrift, Beschreibung, Status, Satz zu Übergängen und Startstatus; für Org-Admins der Link „Organisation, Workflows“ auf `paths.workflow(id)`), Karte „Workflow wechseln“ (`Select` der anderen, Zusammenfassung des gewählten, „Workflow wechseln …“ gesperrt mit Grund aus `usePermissions` bzw. „Wähle zuerst den neuen Workflow.“) → `StateMappingDialog` mit `rows = []` bis Phase 4 (es gibt keine Items; `emptyText` „Das Projekt hat noch keine Items, es gibt nichts zuzuordnen. Neue Items starten im Startstatus „:state“.“), `onConfirm` ruft `assignWorkflow` mit `suggestMapping` (alle Status, damit Phase 4 nichts am Aufruf ändert). Danach Toast „Workflow gewechselt“, Fokus auf die Überschrift. Ohne andere Workflows der Hinweis aus dem Klickdummy.
  - `project/Types.tsx`: Port ohne Zählungen (P6): Checkbox je Typ (Reihenfolge der Organisation; archivierte nur, wenn aktiviert, mit Chip „Archiviert“), Radio „Standard“ nur für aktivierte; der letzte aktivierte lässt sich nicht abwählen; der Standard folgt, wenn sein Typ abgewählt wird; Speichern sendet nur Geändertes über `updateProject`; 422 an `enabled_type_ids`/`default_type_id` → Fehler unter der Liste, Fokus auf die Radiogruppe; ein `LeaveGuard` mit eigenem `what`; Lesende sehen alles gesperrt.
  - `CreateProjectDialog`: Workflow (`Select`, Standard vorgewählt, Beschreibung als Hinweis) und Typen (Checkboxen mit Icon und Ton, alle aktiven vorgewählt, P10; „Standardtyp ist :name, der oberste angehakte.“); sendet `workflow_id`, `enabled_type_ids`, `default_type_id` (der erste angehakte); Feldfehler am Feld, andere als Banner; der Dialog wartet mit dem Formular, bis Workflows und Typen geladen sind (Skelett, Fehler mit „Erneut versuchen“), der Fokus startet danach im Namen. Den Zweig „Es gibt keinen Workflow“ des Klickdummys gibt es nicht (der Standard-Workflow existiert immer).
  - Texte unter `settings.project.section.{workflow,types}`, `settings.project.workflow.*`, `settings.project.types.*`, `projects.create.{workflow,types,…}`.

- [ ] **Step 1: Failing Tests schreiben**

`project.test.tsx`: Workflow — Ladefehler der Workflows, Knopf gesperrt ohne Auswahl und ohne Recht, Dialog ohne Items mit dem Text, Wechsel sendet `PUT …/workflow` mit vollständigem Vorschlag, Toast und Fokus auf die Überschrift, Fehler-Toast bei 5xx mit „Erneut versuchen“, 422 `mapping.<id>` erscheint als Hinweis im Dialog (`notice`; ohne Items gibt es keine Zeile, die Zeilenfehler prüft Task 13 am Dialog selbst); Typen — Standard folgt dem Abwählen, letzter Typ gesperrt, 422 → Fokus auf die Radiogruppe, nichts zu speichern → Hinweis, Lesende gesperrt.

`projects.test.tsx`: Dialog sendet Workflow und Typen, Standard ist der oberste angehakte, 422 `enabled_type_ids` an der Typliste, Ladefehler von Workflows oder Typen mit „Erneut versuchen“.

`e2e/tests/project-catalog.spec.ts` (Erik, Tastatur, Projekte `E2E …`):
- „creates a project with the agency workflow and the types it picks“ (Dialog: Workflow per Tastatur auf Agentur-Freigabe, Kundenwunsch abwählen, ⌘⏎; per API: `workflow_id` ist Agentur-Freigabe, `enabled_type_ids` enthält Task, Bug, Epic und nicht Kundenwunsch — nie Gleichheit der ganzen Liste: parallele Läufe legen `E2E`-Typen an, die der Dialog mit vorwählt).
- „assigns a workflow with restricted transitions to a project“ (Erfolgskriterium 2.1 in der UI: Workflow `E2E … Matrix` im Editor anlegen (Matrix, ein Übergang weniger), dann Projekteinstellungen → Workflow → wählen → „Workflow wechseln …“ → ⌘⏎; Toast, Überschrift nennt ihn).
- „switches a type on and makes it the default“.
- `projects.spec.ts` und `onboarding.spec.ts` bleiben grün (der Helfer wartet auf das Formular).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings/project resources/js/features/projects`; `pnpm --dir e2e test -- project-catalog projects onboarding`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: port the workflow and types sections of the project settings and pick them when creating a project`.

---

### Task 15: Doku, `CLAUDE.md`, Rulings, Spec, Abnahme

**Files:**
- Create: `docs/en/concepts/{workflows,types-and-properties}.md`, `docs/de/concepts/{workflows,types-and-properties}.md`
- Modify: `docs/.vitepress/config.ts` (Seiten und Titel: „Workflows“/„Workflows“, „Types and properties“/„Typen und Properties“), `docs/en/concepts/projects.md` und `docs/de/concepts/projects.md` (Workflow und Typen eines Projekts, Verweis), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md` („Änderungen vom 2026-10-31 (Phase 3)“)

**Interfaces:**
- Consumes: alles Vorige
- Produces:
  - `concepts/workflows`: Status mit Icon-Form und Kategorie (Tabelle der fünf Kategorien und was sie bedeuten), Startstatus, „mindestens ein Completed“, Erreichbarkeit mit Beispiel (Flow 7), frei oder Matrix, Standard-Workflow, Workflow eines Projekts wechseln (Zuordnung der Status; Hinweis, dass das Umschreiben der Items ohne Übergangsregeln läuft), Löschen nur ungenutzt, REST-Beispiele (`POST /api/v1/workflows` mit lokalen Status-IDs, 422 `invalid_workflow` mit `issues`, `PUT /api/v1/projects/WEB/workflow`).
  - `concepts/types-and-properties`: Typen (Icon, sechs Töne, Epic, Properties mit Pflicht und Reihenfolge, Archiv statt Löschen, Standardtyp eines Projekts), Properties (Schlüssel-Regeln samt Kernfeldern, Tabelle der acht Feldtypen mit Einstellungen und Standardwert, Optionen mit Archiv, Einfach → Mehrfach), Labels, Relationstypen (drei mitgeliefert, „wird blockiert von“), Resolutions (Standards je Kategorie). Beide Sprachen mit gleichen Dateinamen und Überschriften (`DocsTest`).
  - `CLAUDE.md`: „Stand“ (Phase 3 umgesetzt, als Nächstes Phase 4), Architektur (Kataloge: Tabellen, `CatalogLock`, `Ids`, lokale IDs, `Save…`/`Delete…`, mitgelieferter Katalog über `EnsureCatalog`, Events ohne Webhook, Projekte mit Fremdschlüsseln, `AssignWorkflow`; Frontend: `features/settings/catalog`, Editor als Query-Ansicht), Fallstricke (`settings` als `(object)`; 201 nur mit `wasRecentlyCreated`: nach dem Speichern `load()`, nie `fresh()`; Platzhalter nie `{type}`/`{project}`; Sperr-Reihenfolge Organisation → Projekt; e2e ändert keine globalen Standards; Tests, die Katalogeinträge zählen, rechnen die mitgelieferten mit). Die Tasks haben ihre Teile schon eingetragen; hier ordnen und prüfen.
  - Rulings `A56` ff. (je mit Grund und „Falls falsch“): P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, P14, P17, P18, P20, P22 (erweitert den Vertrag „Fehler“ um `Problem::unprocessable`, wie A31), P23 dieses Plans; „Für spätere Phasen vorgemerkt“: Phase 3 als erledigt entfernt (Task 1), neu für Phase 4: `RemapStates` mit Pflicht-Zuordnung benutzter Status (`AssignWorkflow`, `SaveWorkflow` mit 409 `state_in_use`), Häkchen „Epic“ gegen Items, Archiv statt Löschen benutzter Typen, Optionen und Resolutions, `affected_items`/`affected_relations` zählen, `DefaultValueField` gegen die Feld-Editoren tauschen; für Phase 5: Zählungen „bei N Items“ in den Katalog-Bildschirmen und in den Projekt-Typen; für Phase 10: Auto-Close-Hinweis im Wechsel-Dialog und Automatisierungen beim Workflow-Wechsel.
  - Spec „Änderungen vom 2026-10-31 (Phase 3)“ zur Bestätigung: Namen je Katalog eindeutig ohne Groß- und Kleinschreibung (P12); mitgelieferte Texte in der Sprache der Organisation, Status-, Typ- und Resolution-Namen englisch (P2); Typ-Icons aus einer festen Liste (P13); Personenauswahl und Rich Text ohne Standardwert, Optionen nur bei Dropdown (P14); ein Standardtyp lässt sich weder löschen noch archivieren, archivierte Typen lassen sich nicht neu aktivieren (P11); ein neues Projekt bekommt ohne Angabe alle aktiven Typen (P10); jede Resolution-Kategorie behält einen Standard (P20); der Workflow eines Projekts wechselt nur mit Zuordnung (`PUT …/workflow`), nicht per `PATCH` (P9).

- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.

- [ ] **Step 2: Abnahme der Phase**

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev artisan test --coverage --min=100
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build
ddev exec pnpm --dir docs build
```

Expected: alles grün, PHP `Total: 100.0 %`, Frontend zusammengeführt 100 %. Von Hand (Master-Abnahme, Erfolgskriterium 2.1 und 2.2 ohne Item): Mara legt in der UI einen Workflow mit Matrix an und weist ihn einem Projekt zu; dasselbe per `curl -H "Authorization: Bearer <Token>" -H 'Content-Type: application/json' -X POST https://werkbuch.ddev.site/api/v1/workflows -d @workflow.json` und `-X PUT …/api/v1/projects/OPS/workflow -d '{"workflow_id":"<id>","mapping":{}}'`; ein Typ mit Pflicht-Property entsteht in UI und REST; Agentur-Freigabe ohne den Übergang nach Review wird in UI und REST abgelehnt; Lene liest alle Kataloge, ändert nichts.

- [ ] **Step 3: Commit** — `docs: add the workflows and types and properties pages, update CLAUDE.md, the rulings and the spec for phase 3`.

---

## Entscheidungen dieses Phasenplans

- **P1 Eine Katalog-Sperre: die Organisationszeile.** Jede schreibende Katalog-Action, `CreateProject`, `UpdateProject` (mit Kennung oder Typen) und `AssignWorkflow` nehmen zuerst `CatalogLock::take()` und prüfen darunter; danach ggf. die Projektzeile. Grund: Standard-Workflow, Standard-Resolutions, „benutzt“, „Standardtyp“ und Status-Reihenfolge gelten über mehrere Zeilen, kein Index hält sie; Katalogänderungen sind selten (nur Org-Admins), eine Sperre ist billig und folgt A45. Falls falsch (Last): eine eigene Sperrzeile je Katalog.
- **P2 Mitgelieferter Katalog per Migration über `EnsureCatalog`** (idempotent, Events als Standard-Bot mit Grund `setup`); Beschreibungen und Relations-Beschriftungen in der Sprache der Organisation beim Migrieren, Status-, Typ- und Resolution-Namen englisch wie in der Spec. Grund: Spec 4.5–4.9 „mitgeliefert“, A40 (Setup schreibt Events), eine englische Instanz soll keine deutschen Beschriftungen bekommen. Falls falsch: Texte fest deutsch oder fest englisch.
- **P3 Lokale IDs neuer Status und Optionen.** Der Client nennt neue Zeilen mit eigenen IDs (bis 64 Zeichen), der Server vergibt ULIDs und übersetzt Startstatus, Übergänge, Standardwert und Zuordnungen; nur Status bzw. Optionen **dieser** Zeile behalten ihre ID, alles andere ist neu; Befunde nennen die IDs der Eingabe. `Ids::normalize` schreibt nur ULIDs klein. Grund: `localId` des Klickdummys („the real one will map them“), sichere Kopien, kein Übernehmen fremder Zeilen. Falls falsch: zweistufiges Speichern (erst Status anlegen, dann Übergänge).
- **P4 Speichern ersetzt ganz (`PUT`).** Workflow mit Status und Übergängen, Typ mit Properties, Property mit Optionen; ausgelassene Status und Optionen werden gelöscht. Grund: dieselbe Form wie `saveWorkflow` & Co.; ein Formular schickt alles. Falls falsch: Teil-Endpunkte je Status/Option.
- **P5 Die Item-Seite kommt mit Phase 4.** Phase 3 hat keine Items: `RemapStates`, 409 `state_in_use`, die Pflicht-Zuordnung benutzter Status, die Prüfung des Häkchens „Epic“, Archiv statt Löschen benutzter Typen, Optionen und Resolutions und die Zählungen `affected_items`/`affected_relations` (in Phase 3 `0`) folgen dort; `state_mapping` und `mapping` prüft Phase 3 nur auf ihre Form. Grund: keine toten Zweige, kein Job ohne Arbeit; der Master-Plan sagt es für die Prüfungen schon. Falls falsch: Phase 4 hat etwas mehr zu tun.
- **P6 Keine Zählungen „bei N Items“ in Phase 3.** Der Klickdummy zählt über die Filter-Engine (`usage.ts`, Phase 5); die Bildschirme zeigen bis dahin keine Zahl und die Bestätigung beim Löschen einer Property einen Satz ohne Zahl. Grund: ohne Items gäbe es nur „0“, ohne Engine keine richtige Zahl. Falls falsch: ein einfacher Zähl-Endpunkt in Phase 4.
- **P7 Events der Kataloge: `<katalog>.created|updated|deleted`, ohne Webhook, Subjekte über die Morph-Map, `project_id` `null`;** Archivieren ist `updated` mit `changes.archived_at`; ein Standardwechsel schreibt je betroffenem Eintrag ein `updated`. Projekte: `project.updated` mit `workflow_id`, `enabled_type_ids`, `default_type_id`. Grund: jede schreibende Action hat ein Event, Spec 6.3 kennt keine Katalog-Webhooks, wenige Typen genügen. Falls falsch: eigene `archived`/`restored`-Typen.
- **P8 Rechte: `OrganizationPolicy::manageCatalog(User, Catalog)` mit einem Satz je Katalog, lesen darf jedes Konto; `ProjectPolicy::changeWorkflow`** für den Wechsel. Grund: Spec 4.3, die Sätze des Klickdummys. Falls falsch: eine Policy je Modell.
- **P9 Kein Endpunkt `projects/{id}/types`; Typen über `PATCH /projects/{project}`, Workflow über `PUT /projects/{project}/workflow`.** Ein `workflow_id` im Patch gleich dem aktuellen wird übergangen, ein anderer ist 422. Grund: Klickdummy-Signaturen (`updateProject` mit Typen, `assignWorkflow` mit Zuordnung); ein Wechsel ohne Zuordnung soll es nicht geben. Falls falsch: `PUT /projects/{project}/types` als Alias.
- **P10 Ein neues Projekt bekommt ohne Angabe den Standard-Workflow, alle aktiven Typen und den ersten als Standardtyp;** der Dialog wählt genauso vor. Grund: Der Klickdummy nimmt feste IDs (`t_task` …), die App kennt keine „Starter“-Marke; alle aktiven ist die einfachste Regel ohne neue Spalte. Falls falsch: eine Spalte `is_starter` an Typen.
- **P11 Standardtypen und archivierte Typen:** Ein Typ, der Standardtyp eines Projekts ist, lässt sich weder löschen noch archivieren (409 `default_type`); neu aktivieren lassen sich nur aktive Typen, schon aktivierte archivierte dürfen bleiben; der Standardtyp ist aktiviert und aktiv. Grund: Neue Items brauchen einen Standardtyp, der sie annimmt (4.6 „keine neuen Items dieses Typs“). Falls falsch: beim Archivieren den Standard des Projekts auf den nächsten Typ setzen.
- **P12 Namen und Längen:** Namen (Workflow, Typ, Label, Relationstyp, Resolution) und Property-Schlüssel sind je Katalog eindeutig nach der Kollation (ohne Groß-/Kleinschreibung), getrimmt; Längen Name 60, Status 40, Beschreibung 2000, Hilfetext 500, Option 60; höchstens 30 Status und 100 Optionen. Grund: der Klickdummy vergleicht klein geschrieben; Grenzen gegen Missbrauch der API. Falls falsch: Grenzen anpassen (eine Migration).
- **P13 Startstatus ohne Fremdschlüssel; Typ-Icons aus einer festen Liste.** `workflows.initial_state_id` hat keinen Fremdschlüssel (die Kaskade beim Löschen eines Workflows träfe die eigene Zeile), die Action sichert ihn; Icons nur aus `TypeIcon::NAMES` = `TYPE_ICONS` der UI (Test vergleicht). Grund: zirkuläre Fremdschlüssel; ein unbekanntes Icon kann die UI nicht zeigen. Falls falsch: Fremdschlüssel mit `nullOnDelete` und Löschen in zwei Schritten; freie Lucide-Namen mit Rückfall-Icon.
- **P14 Standardwerte:** geprüft in `App\Domain\Properties\DefaultValue` (Regeln von `values.ts`), Zahlen auf die Nachkommastellen gerundet, eine einzelne Option bei Mehrfachauswahl wird zur Liste; Personenauswahl und Rich Text haben keinen Standardwert (der Dialog des Klickdummys bietet keinen an); Optionen nur bei Dropdown, Einstellungen nur, wo der Feldtyp sie hat; `settings` antwortet als Objekt. Falls falsch: Standard für Personen (aktive Konten) nachrüsten.
- **P15 Standardwert-Felder in Phase 3 schlicht** (`DefaultValueField`: Input, Select, Checkbox-Gruppe, Switch, `type="date"`). Grund: `PropertyValueInput` hängt an den Feld-Editoren der Items (Phase 4). Falls falsch: Phase 4 tauscht ihn gegen die Feld-Editoren (vorgemerkt).
- **P16 Eine Status-Zuordnung für beide Fälle (R26):** `features/settings/catalog/StateMappingDialog` und `mapping.ts` dienen dem Workflow-Wechsel eines Projekts und dem Löschen von Status im Editor. Grund: 13b „Doppeltes zusammenführen“. Falls falsch: zwei schmale Dialoge.
- **P17 Der Workflow-Editor ist eine Ansicht des Abschnitts** (`/settings/workflows?workflow=<id>|new[&from=<id>]`), gelesen aus `usePage().url`. Grund: Adressen wie im Klickdummy (README „Routen“), Zurück und Links funktionieren, keine neue Route. Falls falsch: eigene Route `/settings/workflows/{id}`.
- **P18 e2e ändert keine globalen Standards** (Standard-Workflow, Standard-Resolutions): Die vier Playwright-Projekte laufen parallel gegen eine Datenbank und würden sich gegenseitig die Marke nehmen. Diese Fälle decken Pest (inkl. Race) und Vitest; alle e2e-Katalogdaten heißen `E2E …` und der `E2eSeeder` räumt sie weg. Falls falsch: ein serielles Playwright-Projekt nur für globale Einstellungen.
- **P19 Reihenfolge der Listen:** nach `id` (Anlagereihenfolge; die Migration legt Task, Bug, Epic nacheinander an), Resolutions nach `position`; keine Umsortieren-Funktion für Typen, Labels, Resolutions (der Klickdummy hat keine). Falls falsch: `position`-Spalten nachrüsten.
- **P20 Genau ein Standard je Resolution-Kategorie:** Unique-Index auf `default_for` plus Sperre; ein neuer Standard nimmt dem alten die Marke, den letzten Standard einer Kategorie nimmt nur ein neuer weg (422 `default_for`). Ebenso genau ein Standard-Workflow (422 `is_default`). Grund: der Klickdummy sagt „Pro Kategorie gibt es genau einen Standard“, setzt es aber nicht durch; ohne Standard hinge jeder Übergang an einer Auswahl. Falls falsch: Kategorien ohne Standard zulassen.
- **P21 Schlüssel ohne Bindestrich über feste Zuordnungen:** Abschnitte bekommen `labelKey`, Icons, Töne, Kategorien und Feldtypen feste `Record`s. Grund: Schlüsselschema `[a-z_]+` und der Scan der benutzten Schlüssel. Falls falsch: nichts.
- **P22 `invalid_workflow` als 422 mit eigenem Reason** (`Problem::unprocessable`), `errors` je Befund-Code, `extensions.issues` mit den IDs der Eingabe. Grund: Klickdummy-Vertrag, die UI markiert die Zeile. Falls falsch: `validation_failed` mit Pfaden `states.<n>`.
- **P23 Bestehende Projekte werden in einer Migration an den Katalog gebunden** (`LinkProjectsToCatalog`) (Standard-Workflow, alle aktiven Typen, erster als Standard) und danach sind `workflow_id`/`default_type_id` NOT NULL mit Fremdschlüssel `restrict`. Grund: Dev-Datenbanken haben Projekte aus Phase 2; ohne Fremdschlüssel könnte ein gelöschter Workflow ein Projekt verwaisen lassen. Falls falsch: Spalten nullable lassen und die App mit `null` umgehen lassen.

## Nicht in Phase 3 (vorgemerkt in Task 15)

- Phase 4: `RemapStates` und die Pflicht-Zuordnung benutzter Status; 409 `state_in_use`; Häkchen „Epic“ gegen Items; Archiv statt Löschen benutzter Typen, Optionen, Resolutions; `affected_items`, `affected_relations`; `DefaultValueField` gegen die Feld-Editoren.
- Phase 5: Zählungen „bei N Items“ (Typen, Labels, Properties, Projekt-Typen, Bestätigung beim Löschen).
- Phase 10: Auto-Close im Wechsel-Dialog und das Nachziehen der Automatisierungen beim Workflow-Wechsel.
