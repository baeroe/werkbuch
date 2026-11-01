# Phase 4: Work Items, Relationen, History – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work Items bauen: Anlegen mit Nummer und Key, Pflicht-Properties und zwei Ebenen, Ändern (zuletzt gewinnt, Beschreibung mit Konfliktschutz), Übergänge mit Resolution, Typwechsel, Archiv, Löschen, Mehrfachbearbeitung, Relationen über Projektgrenzen mit „verborgenes Item“, Beobachten und eine History aus `events`; dazu die Item-Prüfungen der Kataloge aus Phase 3 (Status-Zuordnung, Epic-Häkchen, Archiv statt Löschen), Rich Text als Tiptap-JSON mit Markdown hin und zurück, REST unter `/api/v1/work-items`, Demo-Daten und die portierten Bildschirme des Klickdummys (Item-Seite und Vorschau, Feld-Editoren mit Item-Befehlen und Kürzeln, Palette ohne Suche, Editor für Beschreibungen, Anlegen-Dialog, Aktivität ohne Kommentare, Status-Zuordnung).

**Architecture:** Wie Phase 3. Reine Regeln (Rang, Key, Hierarchie, Resolution, Zeitstempel eines Zugs, Werte je Feldtyp) liegen in `app/Domain/{WorkItems,Ranking,Properties}`; jede Änderung eines Items ist eine Action in `app/Actions/WorkItems/`, die in ihrer Transaktion in fester Reihenfolge sperrt (Organisation geteilt → Projekt → Item, P1), unter der Sperre prüft, schreibt und `work_item.*`-Events aufzeichnet. Die History liest nur `events` (`ListHistory`); was ein Leser von einem fremden Item sehen darf, entscheidet sie beim Lesen. Rich Text speichert `App\RichText\Document` als Tiptap-JSON, REST liest und schreibt Markdown oder JSON. Das Frontend bekommt `resources/js/api/{workItems,relations}.ts` mit den Signaturen des Klickdummys (Abweichungen nur nach P7, P8), optimistische Item-Mutationen (`useItemMutation`), den Editor unter `resources/js/editor`, die Feld-Editoren unter `components/fields`, die Palette ohne Suche (P14) und die Item-Bildschirme unter `features/{item-detail,create-item}`.

**Tech Stack:** wie Phase 3, dazu `ueberdosis/tiptap-php`, `league/commonmark`, `league/html-to-markdown` (Task 3), `fractional-indexing` (Task 2), die Tiptap-Erweiterungen für React (Task 17). Versionen unter „Paketversionen“.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterien 2.2/2.3, 4.4 Nummern, 4.5 Anlegen und Änderungen an benutzten Workflows, 4.6 Typ wechseln und Löschen, 4.7 Pflicht, Löschen, Speicherung, Resolution, 4.8, 4.9, 4.10 History und Beobachten, 4.16, 5.1–5.3, 6.1, 6.3 Ereignisse `work_item.*`, 7.2, 7.4; „Änderungen vom 2026-10-29“: zwei Ebenen, Anlegen-Dialog, `parent` am Item, Zugriff für Assignees; „Änderungen vom 2026-10-31 (Phase 3)“), Master-Plan `…/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus 2, Verträge, Phase 4), Rulings `…/plans/2026-10-30-werkbuch-app-rulings.md` (A1–A100; „Für spätere Phasen vorgemerkt“, Zeile Phase 4 → Tasks 13, 14, 18, 19, 25), Ledger `.superpowers/sdd/2026-10-30-werkbuch-app/progress.md` (Übertrag Phase 3 → 4 → Task 1), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{domain/{rank,hierarchy,resolution,progress,keys}.ts,api/{workItems,itemRules,values,relations,events,lookup,workflows}.ts,api/seed/{items,activity}.ts,components/fields/**,components/items/{ItemKey,ItemLink,BlockedHint}.tsx,features/{item-detail,create-item,editor,palette}/**,lib/{richtext,commands}.ts,app/{PeekHost,CreateHost}.tsx,hooks/{workItems,relations,mutation}.ts}`, Aufräumliste `…/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (Task 3, 5, 8, 9 und 13a des Klickdummys, soweit sie Items betreffen).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 4 entscheidend:

- Branch `feat/phase-04-work-items`. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Neue Pakete nur in den Tasks, die „Paketversionen“ nennt (2, 3, 17); `e2e/pnpm-lock.yaml` bleibt unverändert.
- Fachlogik nur in `app/Actions` und `app/Domain`. **Jede schreibende Action legt in ihrer Transaktion mindestens ein Event an, aber nur bei einer echten Änderung** (gleiche Eingabe → kein Schreiben, kein Event, kein neues `updated_at`). **Jede Action steht genau einmal in der Rechte-Matrix** (`tests/Feature/Access/matrix.php`), **jede Route genau einmal in der Routen-Matrix** (`tests/Feature/Api/routes.php`), beides im Commit, der sie anlegt.
- **Sperr-Reihenfolge (P1):** Organisation (geteilt, `CatalogLock::share()`, oder exklusiv, `CatalogLock::take()`) → Projekt (`MemberInput::lock`) → Item(s) (`ItemLock`, bei zwei Items nach ID). Jede schreibende Item-Action beginnt so; Katalog-Actions, die Items umschreiben, nehmen die Organisation exklusiv. Race-Tests nur über `Tests\Support\RaceConnections` in `tests/Integration/` für: `next_number` (Task 5), `description_version` (Task 7), Relationen gegen Doppelte (Task 11), `RemapStates` gegen gleichzeitige Übergänge (Task 13).
- **Unsichtbares ist 404, nie 403**, auch über den Key und über einen früheren Key (kein 301 für Items, die der Leser nicht sieht). Was ein Leser vom anderen Ende einer Relation nicht sehen darf, verlässt den Server nicht: weder Titel noch Key noch ID (P19).
- **Rang:** `work_items.rank` ist `ascii` mit Kollation `ascii_bin`; Ränge werden nur bytegenau verglichen, im Frontend mit `<`, nie mit `localeCompare` (P4).
- **ULIDs in Eingaben** über `Ids::normalize` und die Regel `ulid` (A96); Items nehmen zusätzlich den Key (`WEB-12`, Groß-/Kleinschreibung egal, frühere Kennungen auch), wo die Tabelle der REST-Routen es sagt. Regex-Muster enden auf `\z`, nie auf `$`.
- Die UI liest und schreibt nur über `/api/v1`. `resources/js/api/<ressource>.ts` exportiert Namen und Signaturen des Klickdummys (`listWorkItems`, `getWorkItem`, `listActivity`, `createWorkItem`, `updateWorkItem(id, patch, options)`, `transitionWorkItem(id, to_state_id, resolution_id?)`, `bulkUpdateWorkItems(ids, patch)`, `changeWorkItemType(id, type_id, values?)`, `archiveWorkItem`, `restoreWorkItem`, `deleteWorkItem`, `setSubscribed(id, on)`, `addRelation(source_id, type_id, target_id)`, `removeRelation(id)`); Abweichungen nur nach P7 (kein `getWorkItemMeta`) und P8 (schmale `ListWorkItemsArgs`). Komponenten rufen nur Hooks.
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`; Schlüssel ohne Ziffern und Bindestrich. Neue `reason`-Codes (nur `state_in_use`) in `Problem::REASONS` und `problem.reason.state_in_use` beider Sprachen zugleich. Zeiten und Tage in der Zeitzone der Organisation (`intlLocale()`, `useOrganization`), nie fest `Europe/Berlin` (13c).
- Abdeckung 100 % Zeilen PHP und Frontend (Vitest + Playwright zusammengeführt) **am Ende jeder Task**; keine unerreichbaren Zweige: Was erst mit Kommentaren, Anhängen, Erwähnungen (Phase 7), Benachrichtigungen (Phase 8), Automatisierungen und Vorlagen (Phase 10) oder Webhooks (Phase 11) Sinn ergibt, bleibt weg (P6, P22).
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert (großgeschriebene ULIDs und Keys, `"2026-10-31\n"` gegen `\z`, Ränge mit Groß-/Kleinbuchstaben, Race-Tests, die ohne Sperre durchliefen). Was `TrimStrings`/`ConvertEmptyStringsToNull` über REST putzen, prüft der Test an der Action (A80).
- Fokus und Tastatur in jedem Bildschirm: jeder Ablauf ohne Maus, Fokus nach Dialogen zurück auf den Auslöser (oder dessen Nachbarn), Feldfehler mit Fokus auf dem ersten ungültigen Feld. In Playwright nur `tabTo`/`arrowTo`/`pressMod`.
- e2e: Daten einer Spec leben in einem eigenen Projekt `E2E <variant> <runId>` (per API angelegt, Helfer aus Task 15), nie in WEB, APP, OPS; kein `networkidle`; kurze Namen mit `exact: true`; keine Änderung globaler Standards (A71).
- Demo- und Testdaten nur fiktiv (Feldwerk, die Daten aus `prototypes/clickdummy/src/api/seed/`, `@example.com`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Gleichzeitig anlegen** (Master Review Focus 2): Zwei Items im selben Projekt zur selben Zeit bekommen nie dieselbe Nummer; eine Anlage, die an einer Pflicht-Property scheitert, hinterlässt weder Item noch verbrauchte Nummer noch Event. → Task 5, `WorkItemNumberRaceTest` und „rolls back everything when a value is refused“.
- **Beschreibung still überschrieben:** Zwei Fenster bearbeiten dieselbe Beschreibung; das zweite Speichern bekommt 409 `description_conflict` mit dem aktuellen Stand und dem Namen der Person, „Meine Fassung übernehmen“ speichert mit der neuen Version, „Neu laden“ zeigt die fremde Fassung, und kein Tippen geht ohne Banner verloren. → Task 7 (`DescriptionVersionRaceTest`), Task 22 (Vitest und `item-description.spec.ts` mit zwei Browser-Kontexten).
- **Workflow wechseln, während jemand den Status setzt:** Kein Item landet in einem Status, der nicht zum Workflow seines Projekts gehört, und kein Übergang scheitert mit einem 500 an einem Fremdschlüssel. → Task 13, `RemapStatesRaceTest` (Übergang wartet auf die geteilte Sperre der Organisation und bekommt danach 422 bzw. arbeitet im neuen Workflow).
- **Datenleck über Relationen, History und Flags:** Eine Relation zu einem Item eines privaten Projekts zeigt Außenstehenden „verborgenes Item“ ohne ID, Key und Titel, in `…/relations`, im `include=relations` und in der History; ein früherer Key eines unsichtbaren Items antwortet 404, nicht 301. → Task 6 („does not redirect a former key the reader may not see“), Task 11 („blanks the hidden end“), Task 12 („names a hidden item only as hidden“).
- **Pflicht nachträglich:** Wird eine Property später Pflicht, lassen sich bestehende Items ohne Wert weiter ändern (Titel, Status, andere Werte), nur das Leeren eines gesetzten Pflichtwerts ist 422; der Typwechsel verlangt die Pflichtwerte des neuen Typs. → Task 7 („keeps an item valid that lacks a value which became required later“), Task 8.

## Gates

Am Ende jeder Task laufen die Gates, die die Task nennt; alle Ergebnisse grün.

- **G1 (PHP):** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Dazu `ddev artisan test --testsuite=Integration` in jeder Task mit Race-Test.
- **G2 (Frontend):** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt.
- **G3 (e2e, zusammengeführt):** gezielt während der Task `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <spec>` (gegen den normalen Build, `ddev exec pnpm build`); **einmal am Ende der Task** der volle Lauf `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle vier Playwright-Projekte grün, der Global-Teardown (`coverage:merge`) meldet 100 % Zeilen über `resources/js/**`. Vorher `ddev exec pnpm dev` beenden; während des Laufs keine anderen DDEV-Projekte starten oder stoppen.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/` oder `resources/js/shell/` anlegt oder ändert, nennt G3 und bringt Playwright-Specs (Abläufe, nur Tastatur) und Vitest-Tests (Lade-, Fehler- und Randzustände mit `mockApi`) mit, die ihre neuen Zeilen decken.

---

## Datenmodell

Eine Migration `2026_10_31_000800_create_work_items_tables.php` (Task 4). Alle Tabellen mit `ulid('id')->primary()` und Zeitstempeln.

| Tabelle | Spalten | Indizes, Fremdschlüssel |
|---|---|---|
| `work_items` | `project_id`, `number` unsigned int, `type_id`, `title` string(255), `description` json nullable, `description_text` mediumText nullable, `description_version` unsigned int (1), `state_id`, `resolution_id` nullable, `assignee_id` nullable, `priority` string(8) (`none`), `start_date` date nullable, `due_date` date nullable, `parent_id` nullable, `rank` string(128) `charset ascii` `collation ascii_bin`, `created_by`, `started_at`, `closed_at`, `archived_at` (alle nullable) | unique (`project_id`, `number`); FKs `project_id` cascade, `type_id` → `work_item_types` restrict, `state_id` → `workflow_states` restrict, `resolution_id` → `resolutions` restrict, `assignee_id`/`created_by` → `users` restrict, `parent_id` → `work_items` nullOnDelete; Index (`project_id`, `rank`), (`project_id`, `state_id`), (`assignee_id`), (`type_id`), (`parent_id`) |
| `work_item_values` | `work_item_id`, `property_id`, `position` unsigned small int, `value_string` string(2048), `value_number` decimal(24,4), `value_date` date, `value_bool` bool, `value_user_id`, `value_option_id`, `value_json` json (alle Werte nullable) | FKs `work_item_id` cascade, `property_id` cascade, `value_user_id` → `users` restrict, `value_option_id` → `property_options` restrict; unique (`work_item_id`, `property_id`, `position`); Index (`property_id`, `value_option_id`), (`property_id`, `value_user_id`), (`property_id`, `value_number`), (`property_id`, `value_date`) |
| `work_item_labels` | `work_item_id`, `label_id` | FKs cascade; unique (`work_item_id`, `label_id`) |
| `work_item_relations` | `type_id`, `source_id`, `target_id` | FKs `type_id` → `relation_types` cascade, `source_id`/`target_id` → `work_items` cascade; unique (`type_id`, `source_id`, `target_id`); Index (`target_id`) |
| `work_item_subscribers` | `work_item_id`, `user_id`, `reason` string(16) (`created`, `assigned`, `manual`), `unsubscribed_at` nullable | FKs `work_item_id` cascade, `user_id` → `users` restrict; unique (`work_item_id`, `user_id`) |

Der Key ist nie gespeichert: `WorkItem::$key` = Kennung des Projekts + `-` + `number` (P20). Ein Wert je Zeile, Mehrfachauswahl als mehrere Zeilen mit `position` 0, 1, …; Text und URL in `value_string`, Zahl in `value_number`, Dropdown in `value_option_id`, Personen in `value_user_id`, Rich Text in `value_json` (P9). `projects.next_number` (Phase 2) zählt die Nummern.

**Sperren (P1):**

| Action | Organisation | Projekt | Item |
|---|---|---|---|
| `CreateWorkItem` | `share()` | `MemberInput::lock` (für `next_number`, Rang) | – |
| `UpdateWorkItem`, `TransitionWorkItem`, `ChangeWorkItemType`, `ArchiveWorkItem`, `RestoreWorkItem`, `DeleteWorkItem`, je Item in `BulkUpdateWorkItems` | `share()` | `sharedLock` (frisch, 404 in Löschung) | `ItemLock::take` |
| `AddRelation`, `RemoveRelation` | `share()` | beide `sharedLock` nach ID | `ItemLock::pair` (nach ID) |
| `SetSubscription` | – | – | `ItemLock::take` ohne Organisation |
| `AssignWorkflow`, `SaveWorkflow` (mit Status-Zuordnung), Katalog-Löschungen mit Items | `take()` | `MemberInput::lock` bzw. keins | Items über `UPDATE … WHERE` |

---

## Dateistruktur nach Phase 4

| Ort | Inhalt |
|---|---|
| `app/Domain/WorkItems/` | `Priority`, `ItemKey`, `Hierarchy`, `HierarchyRefusal`, `ResolutionRule`, `ResolutionChoice`, `MoveStamps`, `DateRange` |
| `app/Domain/Ranking/Rank.php` | Port von `fractional-indexing` 4.0 |
| `app/Domain/Properties/` | neu `ItemValue`, `PropertyShape`; `DefaultValue` nutzt `ItemValue` |
| `app/RichText/` | `Document`, `Schema`, `RichTextInput`, `MarkdownContext`, `InvalidDocument` |
| `app/Actions/WorkItems/` | `ListWorkItems`, `GetWorkItem`, `CreateWorkItem`, `UpdateWorkItem`, `TransitionWorkItem`, `ChangeWorkItemType`, `ArchiveWorkItem`, `RestoreWorkItem`, `DeleteWorkItem`, `BulkUpdateWorkItems`, `ListRelations`, `AddRelation`, `RemoveRelation`, `ListHistory`, `ListSubscribers`, `SetSubscription`, `RemapStates` |
| `app/Actions/Workflows/ListStateUsage.php` | Items je Status (für die Status-Zuordnung) |
| `app/Models/` | `WorkItem`, `WorkItemValue`, `WorkItemLabel` (Pivot), `WorkItemRelation`, `WorkItemSubscriber` |
| `app/Support/` | `ItemInput`, `ItemValues`, `ItemLock`; `CatalogLock::share()` |
| `app/Access/Assignable.php`, `app/Policies/WorkItemPolicy.php` | wer Items übernimmt; Rechte an Items |
| `app/Http/Controllers/Api/` | `WorkItemsController`, `RelationsController`, `SubscribersController`, `HistoryController`, `StateUsageController` |
| `app/Http/Controllers/ItemPageController.php`, `app/Http/Middleware/RedirectFormerItemKey.php` | `/items/{key}`; 301 für frühere Keys |
| `app/Http/Resources/` | `WorkItemResource`, `RelationEntryResource`, `HistoryEntryResource` |
| `database/seeders/Demo/{ItemsSeeder,ActivitySeeder}.php` | Items, Werte, Relationen, History, Beobachter |
| `resources/js/domain/` | `rank`, `hierarchy`, `resolution`, `progress`, `keys` (Port mit Tests) |
| `resources/js/lib/{richtext,commands}.ts` | Hilfen für Tiptap-JSON; Register der Palette |
| `resources/js/api/{workItems,relations}.ts`, `resources/js/hooks/{workItems,relations}.ts`, `hooks/mutation.ts` (`useItemMutation`) | Datenschicht |
| `resources/js/editor/` | `RichTextEditor`, `RichTextView`, `presets`, `editor.css` |
| `resources/js/components/fields/` | `Picker`, die Feld-Editoren, `ResolutionPrompt`, `ItemDialogs`, `format`, `itemData`, `property/` (Werte), `commands/` (Item-Befehle, geteilt) |
| `resources/js/components/items/` | `ItemKey`, `ItemLink`, `BlockedHint` |
| `resources/js/features/palette/` | Befehlspalette ohne Suche |
| `resources/js/features/item-detail/` | `ItemPage`, `ItemPeek`, `ItemBody`, `shared`, `FieldsPanel`, `Description`, `Children`, `Relations`, `header/`, `activity/` |
| `resources/js/features/create-item/` | `CreateItemDialog`, `CreateForm`, `ItemFields`, `PropertyInputs`, `draft.ts` |
| `resources/js/features/settings/catalog/{StateMappingDialog.tsx,mapping.ts}` | die eine Status-Zuordnung (R26) |
| `resources/js/shell/{PeekHost,CreateHost,PaletteHost}.tsx`, `resources/js/pages/Items/Show.tsx` | Wirte und Seite |

## Paketversionen

| Paket | Version | Task | Hinweis |
|---|---|---|---|
| `ueberdosis/tiptap-php` | `^2.2` | 3 | zieht `spatie/shiki-php`; Phase 4 nutzt keine Hervorhebung (Phase 7, Code ohne Shiki, P15) |
| `league/commonmark` | `^2.10` | 3 | GFM: Tabellen, Aufgabenlisten, Durchgestrichen, Autolinks |
| `league/html-to-markdown` | `^5.2` | 3 | mit `TableConverter` |
| `fractional-indexing` (npm) | `^4.0.0` | 2 | Root-`dependencies`; im Klickdummy schon da |
| `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-list`, `@tiptap/extension-table`, `@tiptap/extensions` | `3.32.0` (genau, wie `@tiptap/core`) | 17 | `@tiptap/suggestion`, `extension-mention`, `extension-image`, `extension-file-handler`, `extension-code-block-lowlight`, `lowlight` erst Phase 7 |

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 4 | Ziel | Task |
|---|---|---|
| `domain/{rank,hierarchy,resolution,progress,keys}.ts` (+ Tests) | `app/Domain/{Ranking,WorkItems}` (PHP) und `resources/js/domain/` | 2, 16 |
| Regeln aus `api/{itemRules,workItems,values,relations,events}.ts` (ohne Benachrichtigungen, Automatisierungen, Erwähnungen, Anhänge) | `app/Actions/WorkItems/*`, `app/Support/{ItemInput,ItemValues}.php` | 5–12 |
| `api/workflows.ts` (`state_mapping`, `rewriteState`, `assignWorkflow`) | `RemapStates`, `AssignWorkflow`, `SaveWorkflow` | 13 |
| `api/seed/{items,activity}.ts` (Items, Werte, Relationen, Events, Beobachter; ohne Kommentare und Anhänge) | `database/seeders/Demo/{ItemsSeeder,ActivitySeeder}.php` | 15 |
| `api/{workItems,relations}.ts` (Signaturen), `hooks/{workItems,relations}.ts`, `useItemMutation` aus `hooks/mutation.ts`, `lib/richtext.ts` (ohne `mentionedIds`, `attachmentIds`) | `resources/js/{api,hooks,lib}/` | 16 |
| `features/editor/{RichTextEditor.tsx,presets.ts,editor.css}` ohne `mentions`, `slashMenu`, `pasteImages`, `codeBlocks` | `resources/js/editor/` | 17 |
| `components/fields/{Picker,format,itemData,StatePicker,AssigneePicker,PriorityPicker,LabelsPicker,TypePicker,ParentPicker,ResolutionPrompt,ItemDialogs}.ts(x)`, `components/items/{ItemKey,ItemLink,BlockedHint}.tsx` | `resources/js/components/{fields,items}/` | 18 |
| `components/fields/{DateField,PropertyField}.tsx` (geteilt) | `components/fields/{DateField.tsx,property/}` | 19 |
| `components/fields/commands.ts` (geteilt), `lib/commands.ts`, `features/palette/*` (ohne Suchtreffer) | `components/fields/commands/`, `lib/commands.ts`, `features/palette/` | 20 |
| `features/item-detail/{ItemPage,ItemPeek,ItemBody,shared,FieldsPanel,ItemHeader}.tsx`, `app/PeekHost.tsx` | `features/item-detail/`, `features/item-detail/header/`, `shell/PeekHost.tsx` | 21 |
| `features/item-detail/{Description,Children,Relations}.tsx` | `features/item-detail/` | 22 |
| `features/item-detail/Activity.tsx` ohne Kommentare, Reaktionen, Composer | `features/item-detail/activity/` | 23 |
| `features/create-item/CreateItemDialog.tsx` (geteilt, ohne Vorlage und Uploads), `app/CreateHost.tsx` | `features/create-item/`, `shell/CreateHost.tsx` | 24 |
| `settings/org/StateMappingDialog.tsx`, `settings/project/{mapping,StateMappingDialog}.ts(x)` (zu einem zusammengeführt, R26) | `features/settings/catalog/` | 25 |

Nicht in Phase 4: `features/item-detail/{Attachments,CommentComposer}.tsx`, die Kommentarteile von `Activity.tsx`, `features/editor/{mentions,slashMenu,pasteImages,codeBlocks}.ts(x)` (Phase 7); `features/items/**`, `components/items/{ItemCard,ItemRowBase}.tsx`, `useFilterContext`, `useInfiniteWorkItems`, Filter, Board, Timeline, Tabelle (Phase 5); Suchtreffer der Palette und `features/palette`-Suche (Phase 6); Benachrichtigungen (Phase 8); Vorlage im Anlegen-Dialog, Automatisierungen (Phase 10).

## Abdeckung über die Tasks

- **PHP:** G1 am Ende jeder Task. Jede Task, die eine Action oder Route anlegt, ergänzt im selben Commit ihre Zeilen in `matrix.php` und `routes.php`. G1 läuft auch in jeder Task, die `lang/*.json` ändert (`TranslationKeysTest`).
- **Frontend, Vitest:** G2 ab Task 2 (die Fixture-Datei des Rangs). Neue Schwellen (100 % Zeilen) in `vitest.config.ts`: `resources/js/editor/**` (17), `resources/js/components/fields/**`, `resources/js/components/items/**` (18), `resources/js/features/palette/**` (20), `resources/js/features/item-detail/**` (21), `resources/js/features/create-item/**` (24). `api/`, `hooks/`, `domain/`, `lib/`, `features/settings/catalog/**`, `features/settings/project/**`, `features/settings/org/workflows/**` haben ihre Schwellen schon.
- **Frontend, zusammengeführt:** G3 in den Tasks 15 (E2e-Seeder, Helfer), 19 (Property-Einstellungen), 20–25. Neue Specs in `e2e/tests/`: `palette.spec.ts` (20), `items.spec.ts` (21), `item-sections.spec.ts`, `item-description.spec.ts` (22), `item-activity.spec.ts` (23), `create-item.spec.ts` (24), `state-mapping.spec.ts` (25); jede läuft in allen vier Projekten.

---
### Task 1: Übertrag aus Phase 3 (Seeder, Katalog, Einladung, URL, A96, Abdeckungs-Stash)

**Modell: sonnet**

**Files:**
- Modify: `database/seeders/Demo/ProjectsSeeder.php`, `app/Actions/Setup/EnsureCatalog.php` (Zeile ~200), `app/Actions/Invitations/InviteUser.php`, `app/Domain/Properties/DefaultValue.php`, `e2e/fixtures.ts`, `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A96)
- Test: `tests/Feature/DemoSeederTest.php`, `tests/Feature/Catalog/EnsureCatalogTest.php`, `tests/Feature/Api/InvitationsApiTest.php` (bzw. der bestehende Test von `InviteUser`), `tests/Unit/Domain/DefaultValueTest.php`

**Interfaces:**
- Consumes: Phase 3
- Produces: keine neuen Namen. `ProjectsSeeder` setzt `workflow_id`, `enabled_type_ids` und `default_type_id` nur beim Anlegen eines Projekts (`firstOrNew` → nur wenn `! $project->exists`), sonst lägen Items nach einem zweiten Seeden auf Status eines fremden Workflows.

- [ ] **Step 1: Failing Tests schreiben**
  - `DemoSeederTest`: „keeps the workflow of a project when seeding again“ — `DemoSeeder` laufen lassen, APP per `AssignWorkflow` (mit leerer Zuordnung, es gibt noch keine Items) auf den Standard-Workflow stellen, `DemoSeeder` erneut → `APP.workflow_id` ist weiter der Standard-Workflow (Gegenprobe: heute stellt der Seeder Agentur-Freigabe zurück).
  - `EnsureCatalogTest`: „never takes a built-in relation type of another kind for a missing one“ — `duplicates` umbenannt in „blockiert“, `blocks` gelöscht (Datenbank direkt); `EnsureCatalog::run()` → `duplicates` hat weiter `built_in = 'duplicates'`, ein neuer Typ mit `built_in = 'blocks'` entsteht mit dem Namen „blockiert 2“ (der Name ist vergeben; Zähler ab 2, bis er frei ist), Event `relation_type.created`.
  - `InviteUser`: „accepts project ids in capitals“ — `projects: [['project_id' => strtoupper($web->id), 'role' => 'member']]` → 201, die Einladung nennt `$web->id` klein (Gegenprobe: heute 422 `field.projects.unknown`).
  - `DefaultValueTest`: Datensatz `url` mit `"https://example.com/\u{200B}x"` (Zero Width Space, `\p{Cf}`) → `url_invalid`; `"https://example.com/\u{00AD}"` (weiches Trennzeichen) → `url_invalid`.

- [ ] **Step 2: Rot, umsetzen, grün** — `ProjectsSeeder` (`firstOrNew`), `EnsureCatalog` (`->whereNull('built_in')` auf der Suche nach dem gleichnamigen eigenen Typ; vergebener Name → `"{$name} {$n}"`), `InviteUser` (`$input['projects'][*]['project_id']` über `Ids::normalize`, vor dem Validator), `DefaultValue::url` (`/[\s\p{Z}\p{Cc}\p{Cf}]/u`). `ddev artisan test --filter='DemoSeederTest|EnsureCatalogTest|InviteUser|DefaultValueTest'`.

- [ ] **Step 3: A96 präzisieren** — vorher im Code nachlesen, wie Route-Bindings (`{workflow}`, `{workItemType}`, `{property}`, `{label}`, `{relationType}`, `{resolution}`, `{token}`, `{user}`) und `GET /api/v1/tokens?user_id=` mit großgeschriebenen ULIDs und Nicht-ULIDs umgehen, und genau das in A96 ergänzen (kein Verhaltenswechsel; weicht es von „nur echte ULIDs, sonst die Feldmeldung bzw. 404“ ab, die Abweichung benennen und als offenen Punkt unter „Für spätere Phasen vorgemerkt“, Phase 12, eintragen).

- [ ] **Step 4: Abdeckungs-Stash sichtbar scheitern lassen** — in `e2e/fixtures.ts` schreibt der `pagehide`-Handler in `try/catch`; ein `QuotaExceededError` (der Editor ab Task 17 vergrößert `__coverage__`) wird `console.error('coverage stash exceeds sessionStorage: …')`, den die Fixture als unerlaubten Konsolenfehler meldet: der Test wird rot statt die Abdeckung still zu verlieren. Prüfen: `pnpm --dir e2e test -- login` grün.

- [ ] **Step 5: Gates G1**

- [ ] **Step 6: Commit** — `fix: keep seeded workflows, built-in relation types and capital project ids, refuse format characters in URLs`.

---

### Task 2: Reine Regeln: Rang, Key, Priorität, Hierarchie, Resolution, Zeitstempel, Daten, Werte

**Files:**
- Create: `app/Domain/Ranking/Rank.php`, `app/Domain/WorkItems/{Priority,ItemKey,Hierarchy,HierarchyRefusal,ResolutionRule,ResolutionChoice,MoveStamps,DateRange}.php`, `app/Domain/Properties/{ItemValue,PropertyShape}.php`, `scripts/rank-fixtures.mjs`, `tests/Support/rank-fixtures.json` (erzeugt), `tests/Unit/Domain/{RankTest,ItemKeyTest,PriorityTest,HierarchyTest,ResolutionRuleTest,MoveStampsTest,DateRangeTest,ItemValueTest}.php`
- Modify: `app/Domain/Properties/DefaultValue.php` (nutzt `ItemValue`), `package.json`, `pnpm-lock.yaml` (`fractional-indexing`)

**Interfaces:**
- Consumes: `FieldType`, `NormalizedValue`, `StateCategory` (Phase 3)
- Produces (alles ohne `Illuminate` und Carbon, `ArchTest`):
  - `final class Rank`: `public const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'`; `public static function between(?string $before, ?string $after): string`; `public static function nBetween(?string $before, ?string $after, int $n): list<string>`; `public static function isValid(string $key): bool`. `between` wirft `InvalidArgumentException` bei gleichen Nachbarn, bei `$before >= $after` und bei ungültigen Keys. Port 1:1 von `node_modules/fractional-indexing/src/index.js` 4.0 (`midpoint`, `validateInteger`, `getIntegerLength`, `getIntegerPart`, `validateOrderKey`, `incrementInteger`, `decrementInteger`, `generateKeyBetween`, `generateNKeysBetween`), Vergleiche mit `strcmp`.
  - `enum Priority: string` (`Urgent = 'urgent'`, `High`, `Medium`, `Low`, `None = 'none'`); `const ORDER = [self::Urgent, …, self::None]`.
  - `final class ItemKey { public const PATTERN = '/^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,10})\z/'; public const MAX_NUMBER = 4294967295; public static function parse(string $input): ?array /* array{identifier: string, number: int} */ }` — trimmt, Kennung groß; Nummer 1…`MAX_NUMBER` (unsigned int der Spalte, P28).
  - `final class Hierarchy { public static function canHaveChildren(bool $isEpic): bool; public static function canHaveParent(bool $isEpic): bool; public static function typeChangeRefusal(bool $hasChildren, bool $hasParent, bool $targetIsEpic): ?HierarchyRefusal }`; `enum HierarchyRefusal: string { case HasChildren = 'has_children'; case HasParent = 'has_parent'; public function reason(): string }` (`has_children` → `parent_not_epic`, `has_parent` → `epic_has_no_parent`, die `reason`-Codes aus `Problem::REASONS`).
  - `final readonly class ResolutionChoice { __construct(public string $id, public ?StateCategory $defaultFor, public int $position, public bool $archived) }`; `final class ResolutionRule { public static function after(StateCategory $from, StateCategory $to, ?string $current, ?string $chosen, list<ResolutionChoice> $resolutions): ?string }` (Port von `resolutionAfterTransition`).
  - `final class MoveStamps { public static function after(StateCategory $from, StateCategory $to, ?DateTimeImmutable $startedAt, ?DateTimeImmutable $closedAt, DateTimeImmutable $now): array /* array{started_at: ?DateTimeImmutable, closed_at: ?DateTimeImmutable} */ }` — `started_at` beim ersten Eintritt in Started, danach nie geändert; `closed_at` `null` beim Wechsel in eine offene Kategorie, `$now` beim Eintritt in Completed/Canceled aus einer offenen oder der anderen geschlossenen Kategorie, sonst unverändert (Regeln von `moveItem`).
  - `final class DateRange { public const DAY = '/^\d{4}-\d{2}-\d{2}\z/'; public static function isDay(string $value): bool; public static function startAfterDue(?string $start, ?string $due): bool }`.
  - `final readonly class PropertyShape { __construct(public FieldType $type, public int $decimals, public bool $multiple, /** @var list<string> */ public array $activeOptionIds) }`.
  - `final class ItemValue { public const TEXT_MAX = 255; public const URL_MAX = 2048; public static function normalize(PropertyShape $shape, mixed $value, mixed $current = null): NormalizedValue; public static function isEmpty(mixed $value): bool; public static function isBlankDoc(array $doc): bool }` — wie `values.ts`: `text` getrimmt ≤ 255 (`text`); `number` wie `DefaultValue` (`number`); `dropdown` aktive Option **oder** eine schon gesetzte (`$current`), einfach: kein Array (`single`), mehrfach: Liste ohne Doppelte (`option`); `boolean` (`boolean`); `date` (`date`); `url` wie `DefaultValue` plus ≤ 2048 (`url`, `url_invalid`); `member` ULID-förmige Zeichenkette bzw. Liste ohne Doppelte (`member`; ob die Konten passen, prüft `ItemValues` mit `Assignable`), einfach: kein Array (`single`); `rich_text` Array mit `type === 'doc'` (`rich_text`; das Schema prüft `Document`). `isEmpty`: `null`, Text nach `trim` leer, leere Liste, leeres Dokument (nur leere Absätze); Zahlen und Booleans nie.
  - `DefaultValue::normalize` behält Signatur und Fehlercodes, ruft für `text`, `number`, `dropdown`, `boolean`, `date`, `url` `ItemValue::normalize` (ohne `$current`), `member`/`rich_text` mit Wert bleibt `none` (Vormerkung „`DefaultValue` auch für Item-Werte nutzen“: eine Regel für beide).

- [ ] **Step 1: Fixture des Rangs erzeugen** — `ddev exec pnpm add fractional-indexing@^4.0.0`; `scripts/rank-fixtures.mjs` schreibt `tests/Support/rank-fixtures.json`: `{between: [[before|null, after|null, result], …], nBetween: [[before, after, n, [results]], …], invalid: [key, …]}` mit (a) den Randfällen `null/null`, Anfang, Ende, (b) 200 Einfügungen an Positionen aus einem festen PRNG (`mulberry32(4)`), (c) 100 Einfügungen immer an derselben Stelle, (d) `nBetween` mit n = 1, 3, 10, (e) ungültigen Keys `''`, `'a'`, `'a00'` (Null am Ende), `'A00000000000000000000000000'`, `'a0 '`. `ddev exec node scripts/rank-fixtures.mjs` → Datei committet. `scripts/rank-fixtures.test.mjs` (Vitest, `scripts/**` ist im `include`) prüft, dass die Datei dem Skript entspricht (gleiches JSON beim erneuten Erzeugen).

- [ ] **Step 2: Failing Tests schreiben**
  - `RankTest`: „matches fractional-indexing for every case of the fixture“ (jeder `between`- und `nBetween`-Fall gleich; jeder `invalid`-Key: `isValid` falsch und `between($key, null)` wirft); dazu die Fälle aus `src/domain/rank.test.ts` mit gleichem Namen: „50 random inserts between neighbours stay strictly sorted and unique“ (`strcmp`), „gives a first rank for an empty list“ (`'a0'`), „sorts after the last and before the first rank“, „keeps working when items are always inserted at the same spot“, „refuses two neighbours with the same rank“; Gegenprobe „sorts by bytes, not by letters“: `strcmp('Zz', 'a0') < 0`, und ein Rang zwischen `'Zz'` und `'a0'` liegt bytegenau dazwischen.
  - `ItemKeyTest`: die Fälle aus `keys.test.ts` (Groß/Klein und Leerraum, ohne Strich, zu kurze Kennung, 2–10 Zeichen, Ziffer vorn, Nummern `0`, `-1`, `1.5`, Text drumherum), dazu `'WEB-4294967296'` → `null`, `"WEB-12\n"` → `['identifier' => 'WEB', 'number' => 12]` (trim), aber `'WEB-12\nx'` → `null`.
  - `PriorityTest`: Werte gleich der Union `Priority` in `resources/js/types.ts` (Regex über `repo_path()`), `ORDER` urgent … none.
  - `HierarchyTest`: die Fälle aus `hierarchy.test.ts` (Epic-Häkchen, nicht der Name; Ablehnungen mit `has_children` vor `has_parent`; unbekannter Typ); `HierarchyRefusal::HasChildren->reason() === 'parent_not_epic'`.
  - `ResolutionRuleTest`: jeder Fall aus `resolution.test.ts` mit gleichem Namen (Standard je Kategorie, Wahl vor Standard, Leeren beim Wiederöffnen, Bleiben in derselben geschlossenen Kategorie, Wechsel zwischen den geschlossenen, offene Wechsel, archivierte/unbekannte Wahl ignoriert, archivierter Standard übersprungen; Standard nach `position`).
  - `MoveStampsTest`: Backlog → In Progress setzt `started_at`; In Progress → Pending behält es; Done → In Progress leert `closed_at`, behält `started_at`; Todo → Done setzt `closed_at = $now`; Done → Cancelled setzt ein neues `closed_at`; Done → Done2 (beide Completed) behält es.
  - `DateRangeTest`: `isDay('2026-10-31')`, nicht `'2026-02-30'`, `'31.10.2026'`, `"2026-10-31\n"`; `startAfterDue('2026-11-02', '2026-11-01')` wahr, gleich falsch, `null` auf einer Seite falsch.
  - `ItemValueTest` (Datensätze): `dropdown` einfach archivierte Option mit `$current` gleich ihr → gültig, ohne `$current` → `option`; mehrfach `['opt_a', 'opt_a']` → `['opt_a']`; `member` `'01jbz…'` gültig (ULID-Form), `'mara'` → `member`, einfach mit Liste → `single`; `rich_text` `['type' => 'doc', 'content' => []]` gültig, `'text'` → `rich_text`; `url` mit 2049 Zeichen → `url`; `isEmpty` je Fall (`'  '`, `[]`, `['type' => 'doc', 'content' => [['type' => 'paragraph']]]` leer; `0`, `false` nicht leer). `DefaultValueTest` bleibt unverändert grün.

- [ ] **Step 3: Rot, implementieren, grün** — `ddev artisan test --filter='RankTest|ItemKeyTest|PriorityTest|HierarchyTest|ResolutionRuleTest|MoveStampsTest|DateRangeTest|ItemValueTest|DefaultValueTest|ArchTest'`; `ddev exec pnpm test -- scripts/rank-fixtures`.

- [ ] **Step 4: Gates G1, G2**

- [ ] **Step 5: Commit** — `feat: add the pure rules of ranks, item keys, priorities, two levels, resolutions, move stamps and item values`.

---

### Task 3: Rich Text: `Document` mit Standard-Knoten, Markdown hin und zurück, `RichTextInput`

**Files:**
- Create: `app/RichText/{Document,Schema,RichTextInput,MarkdownContext,InvalidDocument}.php`, `tests/Unit/RichText/{DocumentJsonTest,MarkdownRoundTripTest}.php`, `tests/Feature/RichText/RichTextInputTest.php`, `tests/Support/RichTextFixtures.php`
- Modify: `composer.json`, `composer.lock`, `lang/en.json`, `lang/de.json`, `tests/Unit/ArchTest.php` (`App\RichText` gehört nicht zu `App\Domain`; die Regel „Domain ohne Illuminate“ bleibt, `App\RichText` darf `App\Models\Project` im `MarkdownContext` nennen)

**Interfaces:**
- Consumes: nichts
- Produces (Vertrag „Rich Text“ des Master-Plans; Phase 7 ergänzt Erwähnung, Verweise, Anhang, Mail-HTML):
  - `final class Schema { public const NODES = ['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell']; public const MARKS = ['bold', 'italic', 'strike', 'code', 'link']; public const HEADING_LEVELS = [1, 2, 3]; public const MAX_BYTES = 262144; public const MAX_DEPTH = 32; }` (die Knoten der Stufe `page` aus `presets.ts`; die Stufen schränken der Editor ein, der Server speichert jede).
  - `final class Document`: `public static function fromJson(array $json): self` (prüft Form, Knoten, Marken, Tiefe, Größe; wirft `InvalidDocument` mit `code` `shape|node|mark|depth|size`; Links nur `http`, `https`, `mailto` — andere `href` verlieren still die Marke, P27); `public static function fromMarkdown(string $markdown, MarkdownContext $ctx): self` (commonmark GFM → HTML → Vorverarbeitung im DOM: GFM-Aufgabenlisten werden `ul[data-type=taskList] > li[data-type=taskItem][data-checked]`, Code-Sprache aus `class="language-…"` → tiptap-php `Editor` → JSON → `fromJson`); `public function toJson(): array`; `public function toMarkdown(): string` (tiptap-php HTML → html-to-markdown mit `TableConverter`, ATX-Überschriften, `-` für Listen, Aufgaben als `- [x] `/`- [ ] `, Codeblöcke mit Zaun und Sprache); `public function toText(): string` (Blöcke durch `\n` getrennt, für `description_text`); `public function toHtml(): string` (tiptap-php; Phase 7 baut daraus Mail-HTML); `public function isEmpty(): bool`.
  - `final readonly class MarkdownContext { public function __construct(public ?Project $project = null) {} }`.
  - `final class RichTextInput { public static function given(array $input, string $field): bool; public static function from(array $input, string $field, MarkdownContext $ctx): ?Document }` — nimmt `$field` (Markdown-Zeichenkette) **oder** `"{$field}_json"` (Objekt); beide → `ValidationException` an `$field` (`field.rich_text.both`); `null`, `''` und ein leeres Dokument → `null` (leert); `InvalidDocument` → 422 an `"{$field}_json"` (`field.rich_text.invalid`, Größe: `field.rich_text.too_long`); kein Feld → `null` (der Aufrufer fragt vorher `given`).
- Texte: `field.rich_text.both` „Schicke entweder Markdown oder JSON, nicht beides.“, `field.rich_text.invalid` „Der Text hat eine Form, die werkbuch nicht kennt.“, `field.rich_text.too_long` „Der Text ist zu lang.“

- [ ] **Step 1: Pakete** — `ddev composer require ueberdosis/tiptap-php:^2.2 league/commonmark:^2.10 league/html-to-markdown:^5.2`.

- [ ] **Step 2: Failing Tests schreiben**
  - `tests/Support/RichTextFixtures.php`: `web47Steps(): array` (Tiptap-JSON wie `web47Steps` in `seed/items.ts`: Absatz und nummerierte Liste mit drei Punkten), `everyNode(): array` (je Knoten und Marke aus `Schema` einmal, mit Tabelle 2×2 mit Kopfzeile, Aufgabenliste mit einem erledigten Punkt, Code-Block `php`, Link `https://example.com`).
  - `DocumentJsonTest`: „keeps a document of every standard node as it is“ (`fromJson(everyNode())->toJson() == everyNode()`); „refuses an unknown node“ (`mention` → `InvalidDocument` `node`; Phase 7 nimmt ihn auf); „refuses an unknown mark“ (`underline` → `mark`); „refuses a document that is not a doc“ (`['type' => 'paragraph']` → `shape`); „refuses deep nesting“ (33 Ebenen Blockquote → `depth`); „refuses more than 256 KB“ (`size`); „drops a javascript link but keeps the text“ (`href: 'javascript:alert(1)'` → Text bleibt, Marke weg; Gegenprobe `HTTPS://example.com` bleibt); „writes plain text block by block“ (`toText()` von `web47Steps()` = drei Zeilen nach dem Absatz, ohne Markdown-Zeichen); „knows an empty document“ (`[['type' => 'paragraph']]` → `isEmpty()`).
  - `MarkdownRoundTripTest` (Datensätze Markdown → `fromMarkdown` → `toMarkdown` gleich der Eingabe): `# Titel` bis `### Titel`; `**fett** *kursiv* ~~weg~~ \`code\``; `[Link](https://example.com)`; verschachtelte Liste `- a\n  - b`; `1. eins\n2. zwei`; `- [x] erledigt\n- [ ] offen`; `> Zitat`; Code-Zaun ` ```php ` mit zwei Zeilen; Tabelle `| a | b |\n| --- | --- |\n| 1 | 2 |`; harter Umbruch (zwei Leerzeichen am Zeilenende → `hardBreak`); `---` (`horizontalRule`). Dazu JSON → Markdown → JSON: `web47Steps()` und `everyNode()` kommen gleich zurück. Und „keeps HTML in Markdown as text“: `<script>alert(1)</script>` wird Text eines Absatzes, nie ein Knoten (Spec 4.16: Nutzer-HTML wird nie ausgegeben).
  - `RichTextInputTest` (Feature, wegen `__()`): Markdown-Feld → Dokument; JSON-Feld → Dokument; beide → 422 an `description`; `description_json` mit unbekanntem Knoten → 422 an `description_json`; `''`, `null`, leeres Dokument → `null`; `given` ohne beide Felder falsch.

- [ ] **Step 3: Rot, implementieren, grün** — `ddev artisan test --filter='DocumentJsonTest|MarkdownRoundTripTest|RichTextInputTest|ArchTest|TranslationKeysTest'`. Weicht eine Rundreise in einer Kleinigkeit ab (Leerzeilen, `*` statt `-`), die Normalisierung in `toMarkdown` festlegen, nie den Test lockern.

- [ ] **Step 4: Gates G1**

- [ ] **Step 5: Commit** — `feat: store rich text as Tiptap JSON and read and write it as Markdown`.

---

### Task 4: Datenmodell, Modelle, Rechte, Sperren

**Files:**
- Create: `database/migrations/2026_10_31_000800_create_work_items_tables.php`, `app/Models/{WorkItem,WorkItemValue,WorkItemLabel,WorkItemRelation,WorkItemSubscriber}.php`, `database/factories/{WorkItemFactory,WorkItemRelationFactory}.php`, `app/Policies/WorkItemPolicy.php`, `app/Access/Assignable.php`, `app/Support/ItemLock.php`, `tests/Feature/WorkItems/WorkItemModelsTest.php`, `tests/Feature/Access/WorkItemPolicyTest.php`, `tests/Feature/Access/AssignableTest.php`, `tests/Integration/ItemLockTest.php`
- Modify: `app/Support/CatalogLock.php` (`share()`), `app/Models/Project.php` (`workItems()`), `app/Providers/AppServiceProvider.php` (Morph-Map `work_item`, Policy), `app/Events/EventType.php`, `tests/Unit/EventTypeTest.php`, `tests/Feature/MorphMapTest.php`, `tests/Support/RaceConnections.php` (`expectLockWait` mit `$sqlEnd`), `tests/Feature/Access/MatrixWorld.php` (`item()`), `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Architektur: Items, Sperren, `ItemLock`, Rang-Kollation)

**Interfaces:**
- Consumes: Task 2 (`Rank`, `ItemKey`, `Priority`), Phase 2/3 (`Visibility`, `Authorize`, `MemberInput`, `CatalogLock`)
- Produces:
  - Migration nach „Datenmodell“; `down()` in umgekehrter Reihenfolge.
  - `WorkItem` (final, `HasUlids`, `HasFactory`, `@property`-Block): Casts `priority` → `Priority`, `description` → `array`, `start_date`/`due_date` → `date:Y-m-d`, `started_at`/`closed_at`/`archived_at` → `datetime`, `number`/`description_version` int; Beziehungen `project()`, `type()`, `state()` (`WorkflowState`), `resolution()`, `assignee()`, `creator()` (`created_by`), `parent()`, `children()` (nach `rank`, `id`), `labels()` (`BelongsToMany` über `WorkItemLabel` mit ULID, Reihenfolge `labels.id`), `values()` (`HasMany<WorkItemValue>` nach `property_id`, `position`), `outgoing()`/`incoming()` (`HasMany<WorkItemRelation>` über `source_id`/`target_id`), `subscriptions()`; Accessor `key` (`"{$this->project->identifier}-{$this->number}"`); `public bool $resolved_by_former_identifier = false` (nie gespeichert, wie P32 bei Projekten); `public static function findByReference(string $ref): ?self` (ULID, auch groß geschrieben; sonst `ItemKey::parse` → aktuelle Kennung oder `project_identifiers` → Item mit der Nummer; frühere Kennung setzt die Marke; ohne Sichtbarkeit); Scope `visibleTo(Builder $q, User $user)` (`whereIn('project_id', Visibility::projectIds($user))`); Scope `withComputed(Builder $q)` → `children_total`, `children_done` (Kinder in Completed/Canceled, über `workflow_states.category`), `is_blocked` (eine Relation des eingebauten Typs `blocks` mit diesem Item als Ziel, beide Enden offen), `is_blocking` (umgekehrt) als Unterabfragen; Items ohne Kinder haben `children_total = 0`.
  - `WorkItemValue` (`value_*`-Casts), `WorkItemLabel extends Pivot` (`HasUlids`, `$incrementing = false`), `WorkItemRelation` (`type()`, `source()`, `target()`), `WorkItemSubscriber` (`unsubscribed_at` datetime).
  - Factories: `WorkItemFactory` — Projekt `Project::factory()`, Typ der Standardtyp, Status der Startstatus des Workflows, `number` = `++next_number` des Projekts (in `afterMaking` über `increment`), `rank` = `Rank::between(<höchster Rang im Projekt>, null)`, `created_by` ein Mitglied; Zustände `closed()` (erster Completed-Status, `closed_at`, Standard-Resolution), `archived()` (zusätzlich `archived_at`), `epic()` (ein Typ mit `is_epic`, im Projekt aktiviert), `childOf(WorkItem $parent)`, `inState(string $name)`. `WorkItemRelationFactory` (Typ `relates`, zwei Items).
  - `EventType` ergänzt: `WorkItemSubscribed = 'work_item.subscribed'`, `WorkItemUnsubscribed = 'work_item.unsubscribed'`, beide `webhook() === false` (P6). Die übrigen `work_item.*` gibt es seit Phase 2.
  - `final class Assignable { public static function check(User $user, Project $project): bool }` — Port von `canTakeWork`: aktiv und (Mitglied des Projekts oder Person mit Org-Rolle Admin); der Standard-Bot nur als ausdrückliches Mitglied (P30).
  - `WorkItemPolicy`: `view(User, WorkItem)` (Projekt sichtbar, sonst `denyAsNotFound`), `create(User, Project)` (`item.create`, Satz `problem.detail.items_members_only`), `update(User, WorkItem)` (`item.edit`, gleicher Satz), `delete(User, WorkItem)` (`item.delete`, `problem.detail.items_delete_admins_only`), `watch(User, WorkItem)` (Bots: `problem.detail.bots_dont_watch`, sonst wie `view`). Jede Ablehnung eines unsichtbaren Projekts ist `denyAsNotFound`.
  - `CatalogLock::share(): void` — `Organization::query()->sharedLock()->sole()`.
  - `final class ItemLock { public static function take(WorkItem $item, bool $catalog = true): WorkItem; public static function pair(WorkItem $a, WorkItem $b): array /* array{0: WorkItem, 1: WorkItem} in der Reihenfolge der Argumente */ }` — `take`: `CatalogLock::share()` (außer `$catalog = false`), Projekt frisch mit `sharedLock` (in Löschung → `Problem::notFound()`), Item frisch mit `lockForUpdate` (weg → `Problem::notFound()`), `project` gesetzt. `pair`: Organisation geteilt, beide Projekte geteilt und beide Items exklusiv, jeweils nach ID sortiert.
  - `RaceConnections::expectLockWait(mixed $outcome, string $table, ?string $sqlStart = null, string $sqlEnd = 'for update'): void`.
  - `MatrixWorld::item(string $column, array $state = []): WorkItem` — ein frisches Item in `project($column)`, angelegt vom Projekt-Admin der Welt.
- Texte: `problem.detail.items_members_only` „Items anlegen und ändern dürfen nur Member und Admins des Projekts.“, `problem.detail.items_delete_admins_only` „Items löschen dürfen nur Admins des Projekts.“, `problem.detail.bots_dont_watch` „Bots beobachten keine Items.“

- [ ] **Step 1: Failing Tests schreiben**
  - `WorkItemModelsTest`: „spells the key from the current identifier“ (Kennung WEB → `WEB-1`, nach Umbenennen in NEW → `NEW-1`); „finds an item by ULID, by key and by a former key“ (ULID groß geschrieben, `web-1`, `OLD-1` mit Marke; `WEB-0`, `WEB-4294967296`, `WEB-99` (fehlt), `XYZ-1` → `null`); „orders ranks by bytes“ (Ränge `'a1'`, `'Zz'`, `'a0'` → `orderBy('rank')` gibt `Zz`, `a0`, `a1`; Gegenprobe: mit `utf8mb4_unicode_ci` käme `Zz` zuletzt); „counts closed children and open blockers“ (`withComputed`: Epic mit zwei Kindern, eines Done → `children_total 2`, `children_done 1`; `blocks`-Relation A→B, beide offen → A `is_blocking`, B `is_blocked`; A schließen → beide falsch; Typ `relates` zählt nie); „removes values, labels, relations and subscriptions with the item and keeps its children“ (Kind hat danach `parent_id` `null`; Relation in beide Richtungen weg); „removes the items with their project row“ (Kaskade).
  - `WorkItemPolicyTest` (Datensätze über die Rollen der `MatrixWorld`): `view` für alle außer Außenstehenden des privaten Projekts (404); `create`/`update` Admin, Member, Org-Admin, Standard-Bot; Viewer und Außenstehende des öffentlichen Projekts 403 mit `problem.detail.items_members_only`; `delete` nur Admins (`items_delete_admins_only`); `watch` Personen mit Lesezugriff, der Standard-Bot 403 `bots_dont_watch`.
  - `AssignableTest`: Mitglied (Person, Bot) ja; Org-Admin ohne Mitgliedschaft ja; Org-Member ohne Mitgliedschaft nein; Standard-Bot ohne Mitgliedschaft nein, als Mitglied ja; deaktiviertes Mitglied nein.
  - `tests/Integration/ItemLockTest.php`: „waits for a change of the catalog“ (`hold(fn () => CatalogLock::take())`, `second(fn () => ItemLock::take($item))` → `expectLockWait($outcome, 'organization', null, 'lock in share mode')`); „lets two item changes share the catalog“ (zwei `ItemLock::take` auf verschiedenen Items laufen ohne Warten); „answers 404 for an item deleted meanwhile“ (`releaseBeforeLock('work_items')` nach Löschen → `Problem` 404); „locks a pair in id order“ (`pair($b, $a)` gegen ein gehaltenes `pair($a, $b)` wartet auf `work_items`, ohne Deadlock).
  - `EventTypeTest`/`MorphMapTest`: die zwei neuen Typen ohne Webhook; `work_item` in der Morph-Map.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='WorkItemModelsTest|WorkItemPolicyTest|AssignableTest|EventTypeTest|MorphMapTest|ArchTest'`; `ddev artisan test --testsuite=Integration --filter=ItemLockTest`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: add work items with values, labels, relations and subscriptions, their policy and their locks`.

---

### Task 5: Items anlegen, `WorkItemResource`, `POST /api/v1/work-items`

**Files:**
- Create: `app/Actions/WorkItems/CreateWorkItem.php`, `app/Support/{ItemInput,ItemValues}.php`, `app/Http/Resources/WorkItemResource.php`, `app/Http/Controllers/Api/WorkItemsController.php`, `tests/Feature/WorkItems/CreateWorkItemTest.php`, `tests/Feature/WorkItems/ItemValuesTest.php`, `tests/Feature/Api/WorkItemsApiTest.php`, `tests/Integration/WorkItemNumberRaceTest.php`
- Modify: `routes/api.php` (`Route::bind('item', …)`, `POST work-items`), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2, 3, 4
- Produces:
  - `CreateWorkItem::handle(Actor $actor, array $input): WorkItem` — Eingabe: `project_id` (ULID oder Kennung, auch eine frühere), `type_id` (Standard: Standardtyp des Projekts), `title`, `description` | `description_json`, `assignee_id`, `priority`, `label_ids`, `start_date`, `due_date`, `parent_id` (ULID oder Key), `values` (Map Schlüssel → Wert). `state_id` kommt mit Task 8. Ablauf: Projekt über `Project::findByReference` (unbekannt oder unsichtbar → `Problem::notFound()`), `Authorize::check($actor, 'create', WorkItem::class, $project)`, archiviertes Projekt → `Problem::conflict('project_archived', [], __('problem.detail.project_archived'))`; `DB::transaction`: `CatalogLock::share()`, `MemberInput::lock($project)`, `ItemInput::create($input, $project)` (Feldregeln) und `ItemValues::check(…, 'create')` sammeln alle Feldfehler in **einer** `ValidationException`; danach die zwei Ebenen (Typ ist ein Epic → `Problem::unprocessable('epic_has_no_parent', ['parent_id' => [__('problem.reason.epic_has_no_parent')]])`, Eltern-Item ist kein Epic → dasselbe mit `parent_not_epic`; `Hierarchy::canHaveParent`/`canHaveChildren`); dann `next_number` + 1, Rang `Rank::between(<höchster Rang im Projekt>, null)`, Item, Labels, Werte, `description_text`, Beobachter (Ersteller als Person mit Grund `created`; Assignee mit Grund `assigned`), Event `work_item.created` mit `changes.title = {old: null, new}`.
  - `final class ItemInput`: `public static function create(array $input, Project $project): array` und `public static function patch(array $input, WorkItem $item): array` (Task 7) — Regeln und Feldmeldungen: `title` getrimmt 1–255 (`field.title.required`, `field.title.max`); `priority` in `Priority` (`field.priority.invalid`); `label_ids` Liste, vorhandene Labels, Doppelte entfernt (`field.label_ids.unknown`); `start_date`/`due_date` `DateRange::isDay` (`field.date.invalid`), Start nach Due → an `due_date` `field.due_date.before_start`; `assignee_id` `Assignable::check` (`field.assignee_id.invalid`, auch für unbekannte); `parent_id` ein Item desselben Projekts, nicht das Item selbst (`field.parent_id.unknown`, `field.parent_id.project`, `field.parent_id.self`); `type_id` im Projekt aktiviert und aktiv (`field.type_id.disabled`, `field.type_id.archived`). ULIDs über `Ids::normalize`, Keys über `WorkItem::findByReference`.
  - `final class ItemValues`: `public static function check(Project $project, WorkItemType $type, array $input, array $existing, string $mode): array` (`'create'` | `'update'`; Port von `checkValues`: unbekannter Schlüssel → `values.<key>` `field.values.unknown`; leerer Wert entfernt, außer Pflicht (beim Anlegen immer, beim Ändern nur, wenn vorher gesetzt) → `field.values.required` „:label ist ein Pflichtfeld.“; sonst `ItemValue::normalize` mit `PropertyShape` aus der Property, Fehler `field.values.<code>` mit `:label`; `member`: neue Konten über `Assignable::check`, schon gesetzte müssen nur existieren; `rich_text`: Objekt oder Markdown-Zeichenkette über `Document`; beim Anlegen fehlende Pflichtwerte nach dem Standardwert der Property); `public static function store(WorkItem $item, array $values, array $before): void` (ersetzt nur geänderte Schlüssel); `public static function of(WorkItem $item): array` (Schlüssel → Wert aus geladenen `values.property`; Zahl auf die Nachkommastellen, `int` bei 0; Mehrfach als Liste in `position`). Beim Anlegen gilt der Standardwert einer Property, wenn kein Wert kommt (Spec 4.7 „Standardwert“).
  - `WorkItemResource` (eine Darstellung für REST, später MCP, Webhook, Live): `id`, `project_id`, `number`, `key`, `type_id`, `title`, `description` (Markdown oder `null`), `description_json`, `description_version`, `state_id`, `resolution_id`, `assignee_id`, `priority`, `label_ids`, `start_date`, `due_date`, `parent_id`, `parent` (`{id, key, title}` oder `null`), `rank`, `values`, `values_markdown` (nur `rich_text`-Properties, Schlüssel → Markdown), `created_by`, `created_at`, `updated_at`, `started_at`, `closed_at`, `archived_at`, `template_id` (immer `null` bis Phase 10, P22), `children_progress` (`{done, total}` oder `null` ohne Kinder), `blocked`, `blocking`, `subscribed` (beobachtet das anfragende Konto). Erwartet `withComputed` und geladene `project`, `parent.project`, `labels:id`, `values.property`; `public static function loadForResource(Collection|WorkItem $items): void` am Modell `WorkItem` lädt alles mit einer festen Liste (die berechneten Felder über eine Abfrage `WorkItem::query()->withComputed()->whereKey($ids)`, deren Spalten sie auf die Modelle setzt), damit `toArray` keine Abfrage stellt.
  - REST: `POST /api/v1/work-items` → 201 `{data}`; `Route::bind('item', fn (string $ref) => WorkItem::findByReference($ref) ?? throw Problem::notFound())` für alle folgenden Tasks.
  - Matrix: `'CreateWorkItem'` (`run` mit `project_id` von `project($column)`, Titel; `allowed` `$itemWriters = ['org_admin', 'project_admin', 'project_member', 'default_bot']`, `hidden` `['outsider_private']`, `event` `WorkItemCreated`). Routen: `'create a work item' => ['POST', '/api/v1/work-items', 'body' => ['project_id' => 'WEB', 'title' => 'Matrix']]`.
- Texte: alle `field.*` oben (deutsch nach `itemRules.ts`: „Der Titel darf nicht leer sein.“, „Der Titel darf höchstens 255 Zeichen haben.“, „Das Datum ist ungültig (JJJJ-MM-TT).“, „Das Start-Date liegt nach dem Due-Date.“, „Nur aktive Mitglieder des Projekts und Org-Admins können Items übernehmen.“, „Das Eltern-Item muss im selben Projekt liegen.“, „Dieser Typ ist im Projekt nicht aktiviert.“, „Dieser Typ ist archiviert, es lassen sich keine neuen Items anlegen.“ …), `problem.detail.project_archived` „Das Projekt ist archiviert und schreibgeschützt.“

- [ ] **Step 1: Failing Tests schreiben**
  - `CreateWorkItemTest`: „numbers the items of a project and never reuses a number“ (drei Items → 1, 2, 3; das dritte per `DB::table` entfernen, nächstes → 4); „counts per project“ (WEB-1 und OPS-1); „puts a new item after the last one“ (`strcmp($second->rank, $first->rank) > 0`); „takes the default type of the project“; „refuses a type the project has not switched on or that is archived“; „trims the title and refuses an empty or too long one“; „sets no priority by default and refuses an unknown one“; „drops duplicate labels and refuses unknown ones“; „refuses a start after the due date, at the due date“; „refuses an impossible day“ (`2026-02-30`, `"2026-10-31\n"`); „lets members and org admins take the item, but no other bot and no deactivated member“ (Datensätze mit `Assignable`); „refuses a parent of another project“; „refuses a parent that is no epic and an epic with a parent, with their reasons“ (`parent_not_epic`, `epic_has_no_parent`, 422, Fehler an `parent_id`); „requires the required properties and names each at its key“ (`values.customer`); „uses the default value of a property when none is sent“; „refuses a property of another type“; „takes Markdown or JSON for the description“ (Markdown → `description_json`, `description_text`); „answers 404 for a project the actor does not see, also by identifier“; „refuses viewers with the sentence of the rule“ (403); „answers 409 in an archived project“; „answers 404 for a project that is being deleted“; „makes the creator and the assignee watch, but no bot“; „records the creation with its title“ (`eventsOf(EventType::WorkItemCreated, $item)` genau eins, `changes.title.new`); „rolls back everything when a value is refused“ (Review Focus 1: ungültiger Pflichtwert → keine Zeile, `next_number` unverändert, kein Event); „finds the parent by key, in capitals as well“ (`'web-1'`).
  - `ItemValuesTest`: je Feldtyp ein gültiger und ein abgelehnter Wert über `check` (Meldung an `values.<key>` mit Label); Mehrfach-Dropdown speichert drei Zeilen mit `position`; `of()` liest sie in Reihenfolge; Zahl `'3,46'` bei einer Stelle → `3.5`, bei 0 Stellen `int`; `member` mit einem Bot, der nicht Mitglied ist → Fehler; `store` mit nur einem geänderten Schlüssel lässt die anderen Zeilen (IDs) unverändert.
  - `WorkItemsApiTest` (Anlegen): 201 mit allen Feldern der Resource (`key` `WEB-1`, `parent` `null`, `children_progress` `null`, `blocked` falsch, `subscribed` wahr für den Ersteller, `description` Markdown und `description_json`); `project_id: 'web'` (Kennung klein) klappt; ein Token mit `read` bekommt 403; 422 mit `errors` an `title` und `values.customer` in einer Antwort.
  - `tests/Integration/WorkItemNumberRaceTest.php` (Review Focus 1): „makes the second creation wait for the project“ (`hold(fn () => CreateWorkItem::run(actor($a), $input))`, `second(fn () => CreateWorkItem::run(actor($b), $input))` → `expectLockWait($outcome, 'projects')`); „gives the second item the next number“ (`releaseBeforeLock('projects')` → zwei Items mit 1 und 2, zwei verschiedene Ränge).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='CreateWorkItemTest|ItemValuesTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`; `ddev artisan test --testsuite=Integration --filter=WorkItemNumberRaceTest`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: create work items with numbers, ranks, values and watchers`.

---

### Task 6: Items lesen: Liste, Einzelnes, Einbetten, frühere Keys

**Files:**
- Create: `app/Actions/WorkItems/{ListWorkItems,GetWorkItem}.php`, `app/Http/Middleware/RedirectFormerItemKey.php`, `tests/Feature/WorkItems/{ListWorkItemsTest,GetWorkItemTest}.php`
- Modify: `app/Http/Controllers/Api/WorkItemsController.php` (`index`, `show`), `app/Http/Resources/WorkItemResource.php` (Einbettungen), `routes/api.php` (die Middleware per Klassenname an der Gruppe der `{item}`-Routen, kein Alias), `tests/Feature/Api/WorkItemsApiTest.php`, `matrix.php`, `routes.php`

**Interfaces:**
- Consumes: Task 5
- Produces:
  - `ListWorkItems::handle(Actor $actor, array $query): ListResult` — `filter[project]` (Referenz; unbekannt oder unsichtbar → 404), `filter[parent]` (ULID oder Key; unsichtbar → 404), `filter[q]` (ein Key → genau dieses Item; sonst Titel enthält den Text, `%` und `_` maskiert), `include_archived` (bool; ohne: weder archivierte Items noch Items archivierter Projekte), `cursor`, `per_page` (über `PageArgs`); Ordnung `rank`, `id`; immer `visibleTo`, nie Projekte in Löschung (P8).
  - `GetWorkItem::handle(Actor $actor, WorkItem|string $ref): WorkItem` — Zeichenkette über `findByReference` (setzt die Marke), unsichtbar/unbekannt/Projekt in Löschung → 404; lädt für die Resource.
  - `WorkItemResource` bettet auf Wunsch ein (`?include=children,type,workflow`, durch Komma getrennt, Unbekanntes → 422 an `include`): `children` (Liste `WorkItemResource` nach Rang), `type` (`WorkItemTypeResource`), `workflow` (`WorkflowResource`); `relations` ergänzt Task 11 (P7).
  - `RedirectFormerItemKey` (auf allen Routen mit `{item}`): bei `GET`/`HEAD` und gebundenem Item mit `resolved_by_former_identifier` **und** sichtbarem Projekt → 301 mit `Location` auf denselben Pfad mit dem aktuellen Key und derselben Query; sonst weiter (Schreibzugriffe wirken auf das Item, P20).
  - REST: `GET /api/v1/work-items` (`ApiList::respond`), `GET /api/v1/work-items/{item}`. Matrix: `'ListWorkItems'` (alle, `hidden` `['outsider_private']` mit `filter[project]` = `project($column)`), `'GetWorkItem'` (alle außer `hidden` `['outsider_private']`). Routen: `'list work items'`, `'show a work item'` (`params` → frisches Item von WEB, als Key).

- [ ] **Step 1: Failing Tests schreiben**
  - `ListWorkItemsTest`: „lists the items the account sees in manual order“ (Ränge per Hand gesetzt, Ergebnis nach Rang); „filters by project, by identifier and by a former one“; „answers 404 for a project the account does not see“; „hides archived items and the items of archived projects unless asked“; „lists the children of an item“; „finds by key or by part of the title, with % taken literally“ (`'100%'` findet nur „100% Abdeckung“, nicht „1000 …“); „pages with a cursor and counts the total“; „never lists items of a project that is being deleted“.
  - `GetWorkItemTest`: „finds an item by key, id and former key“ (Marke gesetzt); „answers 404 for an item the account does not see“ (auch per früherem Key); „loads what the resource needs“ (keine Abfrage beim Rendern: `DB::enableQueryLog` zählt nach `GetWorkItem` 0 Abfragen in `toArray`).
  - `WorkItemsApiTest` (Lesen): Liste mit `meta.total`; `?include=children,type,workflow` liefert die drei, `?include=comments` → 422 an `include`; „redirects a former key with 301“ (`/api/v1/work-items/OLD-1?include=children` → `Location` `…/work-items/NEW-1?include=children`); „does not redirect a former key the reader may not see“ (Review Focus 4: Außenstehender → 404, keine `Location`); `PATCH` mit früherem Key wirkt ohne Umleitung (kommt mit Task 7: hier nur `GET`/`HEAD` prüfen); `children_progress` eines Epics mit Kindern.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ListWorkItemsTest|GetWorkItemTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: list and show work items by id, key and former key`.

---

### Task 7: Items ändern, Beschreibung mit Konfliktschutz

**Files:**
- Create: `app/Actions/WorkItems/UpdateWorkItem.php`, `tests/Feature/WorkItems/UpdateWorkItemTest.php`, `tests/Integration/DescriptionVersionRaceTest.php`
- Modify: `app/Support/ItemInput.php` (`patch`), `WorkItemsController` (`update`), `routes/api.php`, `WorkItemsApiTest`, `matrix.php`, `routes.php`, `lang/*.json`

**Interfaces:**
- Consumes: Task 4–6
- Produces:
  - `UpdateWorkItem::handle(Actor $actor, WorkItem $item, array $input): WorkItem` — Recht zuerst (A85), archiviertes Projekt 409 `project_archived`; `DB::transaction`: `ItemLock::take`, archiviertes Item → `Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => …]))`; `apply(...)`; Rückgabe für die Resource geladen.
  - `public static function apply(Actor $actor, WorkItem $locked, array $input, ?string $reason = null): bool` (ohne Recht und Sperre, für `BulkUpdateWorkItems`; `true`, wenn sich etwas geändert hat) — Felder `title`, `description` | `description_json` mit `base_description_version`, `priority`, `label_ids`, `start_date`, `due_date` (gegen den jeweils anderen gespeicherten Wert geprüft), `parent_id`, `values` (nur die gesendeten Schlüssel, `ItemValues::check(…, 'update')`), `rank` (`Rank::isValid`, sonst `field.rank.invalid`), `assignee_id`. Alles wird vor der ersten Änderung geprüft. Danach: Beschreibung geändert → `description_version` + 1, `description_text`; geänderte Felder → **ein** `work_item.updated` mit `changes` nur der echten Änderungen (`values.<key>`, `label_ids` als Listen, `description` als `{old, new}` Tiptap-JSON, `rank`); geänderter Assignee → eigenes `work_item.assigned` mit `changes.assignee_id`, der neue Assignee beobachtet (Grund `assigned`, eine Abmeldung hebt das auf, Spec 4.10); `updated_at` nur bei einer Änderung.
  - Konflikt (P3): `base_description_version` gesendet, Beschreibung geändert, gespeicherte Version anders → `Problem::conflict('description_conflict', ['current' => WorkItemResource-Array], __('problem.detail.description_conflict', ['name' => <Actor des letzten Events mit changes.description, sonst „Jemand“>]))`. Ohne `base_description_version` gilt zuletzt gewinnt (REST-Nutzer ohne Versionsangabe, Spec 4.8).
  - REST: `PATCH /api/v1/work-items/{item}` (Body mit `base_description_version`). Matrix `'UpdateWorkItem'` (`$itemWriters`, `hidden` `['outsider_private']`, `event` `WorkItemUpdated`, `run` ändert den Titel); Route `'change a work item'`.
- Texte: `problem.detail.item_archived` „:key ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.“, `problem.detail.description_conflict` „:name hat die Beschreibung inzwischen geändert.“, `field.rank.invalid` „Der Rang ist ungültig.“, `field.parent_id.self` „Ein Item kann nicht sein eigenes Eltern-Item sein.“

- [ ] **Step 1: Failing Tests schreiben** — `UpdateWorkItemTest`: „changes only what is sent and records old and new“ (Titel und Priorität → ein Event mit genau zwei Schlüsseln); „records nothing when nothing changes“ (gleicher Titel, Labels in anderer Reihenfolge → kein Event, `updated_at` gleich); „counts the version of the description up and keeps its text for search“; „refuses a description edited on an old version with the current item and the name of the editor“ (409 `description_conflict`, `extensions.current.description_version` 2, `detail` nennt Ida); „lets the last write win without a version“; „keeps an item valid that lacks a value which became required later“ (Review Focus 5: Property nachträglich Pflicht, Titel ändern klappt; Wert setzen klappt; den Wert danach leeren → 422 `values.customer`); „changes only the values it is sent“; „checks a new start date against the stored due date“; „records a change of the assignee as its own event and makes them watch“ (auch wenn sie sich vorher abgemeldet hatten); „takes an empty assignee“; „refuses an archived item“ (409 `archived`); „refuses a parent that is the item itself“; „moves an item by rank and refuses a malformed rank“ (`'a00'` → 422); „answers 403 to a viewer and 404 to an outsider of a private project“; „acts on an item named by a former key“ (REST `PATCH /work-items/OLD-1` → 200, kein 301).
  - `tests/Integration/DescriptionVersionRaceTest.php` (Review Focus 2): „makes a second edit of the description wait for the item“ (`hold` mit `UpdateWorkItem` und `base_description_version: 1`, `second` dasselbe → `expectLockWait($outcome, 'work_items')`); „refuses the second edit on the old version once the first is saved“ (`releaseBeforeLock('work_items')` → `Problem` 409 `description_conflict`, gespeichert ist die erste Fassung, Version 2).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='UpdateWorkItemTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`; `ddev artisan test --testsuite=Integration --filter=DescriptionVersionRaceTest`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: change work items field by field and refuse description edits on an old version`.

---

### Task 8: Übergänge mit Resolution, Anlegen in einem anderen Status, Typwechsel

**Files:**
- Create: `app/Actions/WorkItems/{TransitionWorkItem,ChangeWorkItemType}.php`, `tests/Feature/WorkItems/{TransitionWorkItemTest,ChangeWorkItemTypeTest}.php`
- Modify: `CreateWorkItem` (`state_id`), `UpdateWorkItem` (`state_id`, `resolution_id`), `WorkItemsController` (`transition`, `changeType`), `routes/api.php`, `WorkItemsApiTest`, `matrix.php`, `routes.php`, `lang/*.json`

**Interfaces:**
- Consumes: Task 2 (`ResolutionRule`, `MoveStamps`, `Hierarchy`), Task 5–7
- Produces:
  - `TransitionWorkItem::handle(Actor $actor, WorkItem $item, array $input): WorkItem` (`to_state_id`, `resolution_id` optional) — Recht `update`, archiviertes Projekt 409; Transaktion mit `ItemLock::take`; `move(...)`.
  - `public static function move(Actor $actor, WorkItem $locked, string $toStateId, ?string $resolutionId, ?string $reason = null, bool $checkTransition = true): bool` — archiviertes Item → 409 `archived`; Ziel nicht im Workflow des Projekts → 422 `state_id` `field.state_id.unknown`; `$checkTransition` und `TransitionGraph::canTransition` falsch → `Problem::conflict('transition_not_allowed', [], __('problem.detail.transition_not_allowed', ['from' => …, 'to' => …, 'workflow' => …]))`; gewählte Resolution unbekannt oder archiviert → 422 `resolution_id`; Resolution über `ResolutionRule::after`, Zeitstempel über `MoveStamps::after`; gleicher Status und gleiche Resolution → nichts (`false`); gleicher Status, neue Resolution → `work_item.updated` mit `changes.resolution_id`; sonst `work_item.state_changed` mit `changes.state_id` (und `resolution_id`, wenn sie sich ändert), `meta.reason = $reason`.
  - `CreateWorkItem`: `state_id` (Standard: Startstatus). Das Item entsteht im Startstatus; ein anderes Ziel ist ein Zug von dort: vorher geprüft (409 mit `problem.detail.transition_from_start` „Ein neues Item startet in „:initial“. Von dort nach „:target“ ist im Workflow „:workflow“ nicht erlaubt.“), danach `move()` nach dem `work_item.created` (die History zeigt beides, P32).
  - `UpdateWorkItem::apply`: `state_id` und `resolution_id` → nach den Feldänderungen `move($actor, $locked, $state ?? current, $resolution, $reason)` wie `patchItem`.
  - `ChangeWorkItemType::handle(Actor $actor, WorkItem $item, array $input): WorkItem` (`type_id`, `values` optional) — gleicher Typ → nichts; Typ nicht aktiviert/archiviert → 422 `type_id`; `Hierarchy::typeChangeRefusal(hat Kinder, hat Eltern, Ziel ist Epic)` → `Problem::unprocessable($refusal->reason(), ['type_id' => [__('items.hierarchy.'.$refusal->value, ['key' => $item->key])]])`; Werte: nur Properties des neuen Typs bleiben, `values` aus der Eingabe dazu, `ItemValues::check(…, 'create')` (Pflichtwerte des neuen Typs, 422 `values.<key>`); ein `work_item.updated` mit `changes.type_id` und `values.<key>` je verlorenem (`{old, new: null}`) und neuem Wert.
  - REST: `POST /api/v1/work-items/{item}/transition` → 200 `{data}`, `PUT /api/v1/work-items/{item}/type` → 200 `{data}`. Matrix: `'TransitionWorkItem'` (`$itemWriters`, `event` `WorkItemStateChanged`, `run` nach In Progress), `'ChangeWorkItemType'` (`$itemWriters`, `event` `WorkItemUpdated`, `run` auf Bug). Routen: `'move a work item'`, `'change the type of a work item'`.
- Texte: `problem.detail.transition_not_allowed` „Von „:from“ nach „:to“ ist im Workflow „:workflow“ nicht erlaubt.“, `items.hierarchy.has_children` „:key hat Kind-Items. Nur Epics können Kind-Items haben.“, `items.hierarchy.has_parent` „:key hat ein Eltern-Item. Epics haben kein Eltern-Item.“, `field.state_id.unknown` „Diesen Status gibt es im Workflow nicht.“, `field.resolution_id.unknown` „Diese Resolution gibt es nicht.“, `field.resolution_id.archived` „Diese Resolution ist archiviert. Wähle eine andere.“

- [ ] **Step 1: Failing Tests schreiben**
  - `TransitionWorkItemTest`: „refuses a transition the workflow does not allow and allows a listed one“ (Erfolgskriterium 2.3: Agentur-Freigabe Todo → Done 409 `transition_not_allowed` mit beiden Namen im `detail`, Todo → In Progress klappt); „sets the default resolution of Completed and of Canceled“; „takes a chosen resolution and refuses an archived one“; „clears the resolution when the item is reopened“; „changes only the resolution of a closed item that stays“ (`work_item.updated`); „does nothing when state and resolution stay“; „stamps the first start and the closing, and clears the closing on reopening“; „refuses a state of another workflow“ (422); „refuses an archived item“; „records the move with old and new state“.
  - `CreateWorkItemTest` (ergänzt): „creates in another state when the start state may move there“ (frei: Done → Item in Done mit Resolution Done, `closed_at`, History `created` dann `state_changed`); „refuses to create in a state the start state may not reach“ (409 mit `transition_from_start`, keine Zeile, keine Nummer verbraucht).
  - `UpdateWorkItemTest` (ergänzt): „moves an item with state_id in a patch, after its fields“ (Titel und `state_id` → zwei Events `updated` und `state_changed`); „refuses the whole patch when the move is not allowed“ (Titel unverändert).
  - `ChangeWorkItemTypeTest`: „drops the values the new type lacks and keeps them in the history“ (Bug mit `effort` → Task: `values.effort` `{old: 2.5, new: null}`); „requires the required values of the new type“ (422 `values.customer`, nichts geändert); „takes the values sent with the change“; „keeps two levels“ (Epic mit Kindern → Task: 422 `parent_not_epic` an `type_id` mit dem Satz; Kind → Epic: 422 `epic_has_no_parent`); „refuses a type the project has not switched on“; „does nothing for the same type“.
  - `WorkItemsApiTest`: `POST …/transition` 409 als Problem Details mit `reason`; `PUT …/type` 200.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='TransitionWorkItemTest|ChangeWorkItemTypeTest|CreateWorkItemTest|UpdateWorkItemTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: move work items through their workflow with resolutions and change their type`.

---

### Task 9: Archivieren, Wiederherstellen, Löschen, Beobachten

**Files:**
- Create: `app/Actions/WorkItems/{ArchiveWorkItem,RestoreWorkItem,DeleteWorkItem,ListSubscribers,SetSubscription}.php`, `app/Http/Controllers/Api/SubscribersController.php`, `tests/Feature/WorkItems/{ArchiveWorkItemTest,DeleteWorkItemTest,SubscriptionTest}.php`
- Modify: `WorkItemsController` (`archive`, `restore`, `destroy`), `routes/api.php`, `tests/Feature/Projects/PurgeProjectTest.php`, `WorkItemsApiTest`, `matrix.php`, `routes.php`, `lang/*.json`

**Interfaces:**
- Consumes: Task 4–8
- Produces:
  - `ArchiveWorkItem::handle(Actor, WorkItem): WorkItem` — Recht `update`, archiviertes Projekt 409; nur in Completed/Canceled, sonst `Problem::conflict('not_closed', [], __('problem.detail.not_closed'))`; schon archiviert → nichts; Event `work_item.archived` mit `changes.archived_at`.
  - `RestoreWorkItem::handle(Actor, WorkItem): WorkItem` — nicht archiviert → 409 `not_archived` (`problem.detail.not_archived` „:key ist nicht archiviert.“); Event `work_item.restored`.
  - `DeleteWorkItem::handle(Actor, WorkItem): void` — Recht `delete`, archiviertes Projekt 409; Transaktion mit `ItemLock::take`; je Kind ein `work_item.updated` mit `changes.parent_id = {old, new: null}` und `meta.reason = 'parent_deleted'`; je Relation ein `work_item.relation_removed` beim anderen Ende (Form wie Task 11); dann Löschen (Werte, Labels, Relationen, Beobachter per Kaskade); `work_item.deleted` mit `meta.key`, `meta.title`. Die Events des Items bleiben (wie A26, P12).
  - `ListSubscribers::handle(Actor, WorkItem): Collection<User>` (aktive Beobachter ohne `unsubscribed_at`, nach Name).
  - `SetSubscription::handle(Actor $actor, WorkItem $item, bool $on): WorkItem` — Recht `watch` (Bots 403); ohne Organisationssperre (`ItemLock::take($item, false)`); an: Zeile mit Grund `manual`, `unsubscribed_at` leer; aus: `unsubscribed_at = now()` (bleibt als Abmeldung stehen); Events `work_item.subscribed`/`work_item.unsubscribed` nur bei Änderung (ohne Webhook, nicht in der History, P13); im archivierten Projekt erlaubt (P21).
  - `PurgeProject` (Phase 2) löscht Items per Kaskade mit; Relationen zu Items anderer Projekte verschwinden ohne Event (A26).
  - REST: `POST …/archive`, `POST …/restore` (200 `{data}`), `DELETE /api/v1/work-items/{item}` (204), `GET …/subscribers` (`{data: UserResource[]}`), `PUT …/subscription` und `DELETE …/subscription` (200 `{data}` mit `subscribed`). Matrix: `'ArchiveWorkItem'` (`$itemWriters`, Item `closed`, `event` `WorkItemArchived`), `'RestoreWorkItem'` (`$itemWriters`, Item `archived`, `event` `WorkItemRestored`), `'DeleteWorkItem'` (`$projectAdmins`, `event` `WorkItemDeleted`), `'ListSubscribers'` (alle, `hidden` `['outsider_private']`), `'SetSubscription'` (`allowed` alle Personen mit Lesezugriff: `['org_admin', 'project_admin', 'project_member', 'project_viewer', 'outsider_public']`, `hidden` `['outsider_private']`, `event` `WorkItemSubscribed`). Routen: `'archive a work item'`, `'restore a work item'`, `'delete a work item'`, `'list the subscribers of a work item'`, `'watch a work item'`, `'stop watching a work item'`.
- Texte: `problem.detail.not_closed` „Nur geschlossene Items (Completed oder Canceled) lassen sich archivieren.“

- [ ] **Step 1: Failing Tests schreiben**
  - `ArchiveWorkItemTest`: „archives a closed item only“ (offen → 409 `not_closed`); „does nothing for an archived item“; „restores an archived item and refuses one that is not“; „keeps an archived item read-only until it is restored“ (`UpdateWorkItem`, `TransitionWorkItem`, `ChangeWorkItemType` → 409 `archived`).
  - `DeleteWorkItemTest`: „lets only project admins delete“ (Member 403 `items_delete_admins_only`); „turns the children into items without parent and says so in their history“; „records the removed relation at the other end, also in another project“; „keeps the events of the deleted item“; „removes values, labels and subscriptions“.
  - `SubscriptionTest`: „lets a viewer watch an item“; „refuses bots“; „keeps somebody who stopped watching out until a new assignment“ (aus, dann `UpdateWorkItem` mit ihm als Assignee → beobachtet wieder; ein neuer Titel tut das nicht); „records only real changes“ (zweimal an → ein Event); „lists the active watchers only“.
  - `PurgeProjectTest` (ergänzt): „removes the items of the project with their values, labels, relations to other projects and subscriptions, and keeps the events“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ArchiveWorkItemTest|DeleteWorkItemTest|SubscriptionTest|PurgeProjectTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: archive, restore, delete and watch work items`.

---

### Task 10: Mehrfachbearbeitung

**Files:**
- Create: `app/Actions/WorkItems/BulkUpdateWorkItems.php`, `tests/Feature/WorkItems/BulkUpdateWorkItemsTest.php`
- Modify: `WorkItemsController` (`bulk`), `routes/api.php` (vor `{item}`), `WorkItemsApiTest`, `matrix.php`, `routes.php`

**Interfaces:**
- Consumes: Task 7–9 (`UpdateWorkItem::apply`, `TransitionWorkItem::move`, Archiv-Regeln)
- Produces:
  - `BulkUpdateWorkItems::handle(Actor $actor, array $input): array /* array{updated: list<string>, rejected: list<array{id: string, reason: string}>} */` — `ids` (1–100, ULIDs oder Keys, Doppelte zusammengefasst; sonst 422 an `ids`), `patch` mit `state_id`, `resolution_id`, `assignee_id`, `priority`, `label_ids`, `add_label_ids`, `remove_label_ids`, `start_date`, `due_date`, `archived` (bool). Die Form des Patches wird einmal vorab geprüft (422, nichts geändert). Dann **je Item eine eigene Transaktion** (P10): finden (unbekannt/unsichtbar → `not_found`), Recht (`forbidden`), archiviertes Projekt (`project_archived`), `ItemLock::take`; `archived: true` verlangt den Zustand nach dem Patch geschlossen (`not_closed`); `archived: false` verlangt ein archiviertes Item (`not_archived`) und prüft den Patch vor dem Wiederherstellen; Labels: Basis (`label_ids` oder die eigenen) + `add` − `remove`; ein `state_id` außerhalb des Workflows des Items → `validation_failed`. Jede `Problem`- oder `ValidationException` wird `{id: <gesendete Referenz>, reason}` und rollt nur dieses Item zurück; jede andere Exception bricht ab (500). `updated` nennt die IDs (ULIDs).
  - REST: `POST /api/v1/work-items/bulk` → 200 `{updated, rejected}` ohne `data`. Matrix `'BulkUpdateWorkItems'` (`allowed` alle Spalten, ohne `event`: ein abgelehntes Item ist kein 403, P10). Route `'change many work items'`.

- [ ] **Step 1: Failing Tests schreiben** — „changes every item by its own rules and names the refusals“ (drei Items: eines Agentur-Freigabe Todo, zwei Standard; `state_id` Done des Standard-Workflows → zwei `updated`, eines `rejected` mit `validation_failed`; dazu ein Item in Agentur-Freigabe mit erlaubtem Status); „names transition_not_allowed per item“ (zwei Items eines Matrix-Workflows, nur eines darf); „archives only closed items, also after the patch closed them“ (`state_id` Done + `archived: true` → archiviert); „restores before changing and keeps a refused item archived“; „adds and removes labels“; „refuses forbidden and invisible items one by one“ (Viewer: `forbidden`; privates Projekt: `not_found` mit der gesendeten Referenz); „leaves a refused item as it was“ (Titel- und Prioritätsänderung mit verbotenem Übergang → Priorität unverändert); „refuses more than 100 ids and a malformed patch before changing anything“; „records an event per changed item and none for refused ones“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='BulkUpdateWorkItemsTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: change many work items at once, each by its own rules`.

---

### Task 11: Relationen

**Files:**
- Create: `app/Actions/WorkItems/{ListRelations,AddRelation,RemoveRelation}.php`, `app/Http/Resources/RelationEntryResource.php`, `app/Http/Controllers/Api/RelationsController.php`, `tests/Feature/WorkItems/RelationsTest.php`, `tests/Integration/RelationRaceTest.php`
- Modify: `WorkItemResource` (`include=relations`), `routes/api.php` (`Route::bind('relation', …)` per ULID), `WorkItemsApiTest`, `matrix.php`, `routes.php`, `lang/*.json`

**Interfaces:**
- Consumes: Task 4–6, 9
- Produces:
  - `ListRelations::handle(Actor, WorkItem): list<array{relation: WorkItemRelation, other: ?WorkItem, direction: 'outward'|'inward', hidden: bool}>` (Ordnung: Typ, dann Key des anderen Endes; verborgene zuletzt).
  - `RelationEntryResource`: `{relation: {id, type_id, source_id, target_id}, other: WorkItemResource|null, direction, hidden}` — bei `hidden` ist die ID des verborgenen Endes `''` und `other` `null` (P19).
  - `AddRelation::handle(Actor $actor, WorkItem $source, array $input): WorkItemRelation` (`type_id`, `target_id` als ULID oder Key) — Recht `update` auf `$source`, archiviertes Projekt 409; Ziel unbekannt oder unsichtbar → 422 `target_id` `field.target_id.unknown` (verrät nichts); Transaktion mit `ItemLock::pair($source, $target)`; Typ unbekannt → 422 `type_id`; Item mit sich selbst → 422 `target_id` `field.target_id.self`; dasselbe Paar mit demselben Typ (bei symmetrischen Typen auch umgekehrt) → 422 `target_id` `field.target_id.duplicate`; eine `UniqueConstraintViolationException` wird dieselbe 422 (Rückfall). Zwei Events `work_item.relation_added`, je Ende mit `changes.relation = {old: null, new: {relation_type_id, direction, label, item_id}}` (Beschriftung der Richtung aus Sicht dieses Endes, als Schnappschuss; P11).
  - `RemoveRelation::handle(Actor, WorkItemRelation): void` — die Relation ist sichtbar, wenn der Actor eines der Enden sieht; Recht `update` an einem sichtbaren Ende, das er bearbeiten darf (sonst 403; sieht er keines: 404); zwei Events `work_item.relation_removed` mit `changes.relation.old` wie oben.
  - `withComputed` (Task 4) liefert `blocked`/`blocking` jetzt aus echten Relationen; auch ein unsichtbarer offener Blocker zählt (ein Boolean, P19).
  - REST: `GET /api/v1/work-items/{item}/relations` (`{data: RelationEntryResource[]}`), `POST /api/v1/work-items/{item}/relations` → 201 `{data: RelationEntryResource}`, `DELETE /api/v1/relations/{relation}` → 204; `?include=relations` an `GET …/{item}`. Matrix: `'ListRelations'` (alle, `hidden` `['outsider_private']`), `'AddRelation'` (`$itemWriters`, `event` `WorkItemRelationAdded`), `'RemoveRelation'` (`$itemWriters`, `event` `WorkItemRelationRemoved`). Routen: `'list the relations of a work item'`, `'add a relation'`, `'remove a relation'`.
- Texte: `field.target_id.unknown` „Dieses Item gibt es nicht oder du darfst es nicht sehen.“, `field.target_id.self` „Ein Item kann nicht mit sich selbst in Relation stehen.“, `field.target_id.duplicate` „Diese Relation gibt es schon.“, `field.type_id.unknown_relation` „Diesen Relationstyp gibt es nicht.“

- [ ] **Step 1: Failing Tests schreiben**
  - `RelationsTest`: „relates items across projects“; „refuses an item with itself and the same pair twice“; „counts the other direction of a symmetric type as the same pair, but not of a directed one“ (`relates` B→A nach A→B → 422; `blocks` B→A klappt); „blanks the hidden end“ (Review Focus 4: Relation WEB → OPS-Item, Leser ohne OPS: `hidden` wahr, `other` `null`, `target_id` `''`, kein Key und kein Titel irgendwo in der JSON-Antwort, `assertDontSee` mit Key, Titel und ULID; auch in `?include=relations`); „does not tell whether a hidden target exists“ (unsichtbares und unbekanntes Ziel → dieselbe 422); „records the relation at both ends with the label of each side“ („blockiert“ und „wird blockiert von“); „marks blocked and blocking items while both are open“ (über die Resource); „counts a hidden open blocker“ (Leser ohne OPS sieht `blocked` wahr); „removes a relation from the end the actor may edit“ (Ida darf in OPS nicht schreiben, entfernt die Relation von WEB aus: 204; Außenstehender beider Enden: 404); „answers 403 to viewers“.
  - `tests/Integration/RelationRaceTest.php`: „makes a second relation between the same items wait“ (`hold` `AddRelation` A→B `relates`, `second` `AddRelation` B→A → `expectLockWait($outcome, 'work_items')`); „refuses the second one as a duplicate once the first is saved“ (`releaseBeforeLock('work_items')` → `ValidationException` an `target_id` mit `field.target_id.duplicate`, genau eine Zeile).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RelationsTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`; `ddev artisan test --testsuite=Integration --filter=RelationRaceTest`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: relate work items across projects without showing hidden ends`.

---

### Task 12: History aus `events`

**Files:**
- Create: `app/Actions/WorkItems/ListHistory.php`, `app/Http/Resources/HistoryEntryResource.php`, `app/Http/Controllers/Api/HistoryController.php`, `tests/Feature/WorkItems/ListHistoryTest.php`
- Modify: `routes/api.php`, `WorkItemsApiTest`, `matrix.php`, `routes.php`

**Interfaces:**
- Consumes: Task 5–11
- Produces:
  - `ListHistory::handle(Actor $actor, WorkItem $item, array $query): ListResult` — Events mit Subjekt dieses Items und Typ `work_item.*`, ohne `work_item.subscribed`/`unsubscribed` und ohne `work_item.updated`, deren einzige Änderung `rank` ist (P5); Ordnung `occurred_at`, `id` (älteste zuerst); `cursor`, `per_page`.
  - `HistoryEntryResource`: `{id, type, actor_id, subject: {type, id}, project_id, changes, reason, via, occurred_at}` (`reason`/`via` aus `meta`) — `changes.relation.old|new` wird je Leser `{label, item_id, key}` (anderes Ende sichtbar: aktueller Key) oder `{label, hidden: true}` (unsichtbar oder gelöscht); `label` aus dem aktuellen Relationstyp in der gespeicherten Richtung, ohne Typ der Schnappschuss.
  - REST: `GET /api/v1/work-items/{item}/history` (`ApiList::respond`). Matrix `'ListHistory'` (alle, `hidden` `['outsider_private']`). Route `'show the history of a work item'`.
  - Das Zusammenfassen „derselben Person in wenigen Minuten“ macht die Anzeige (Task 23, 5 Minuten, P5); die REST-History liefert jedes Event einzeln.

- [ ] **Step 1: Failing Tests schreiben** — „shows every change with old and new value, oldest first“ (Anlegen, Titel, Priorität, Labels, Werte, Status mit Resolution, Assignee, Typwechsel, Archiv, Wiederherstellen → in Reihenfolge mit `changes`); „names who did it, how and why“ (`via` `api` mit Token, `reason` `parent_deleted` beim Kind eines gelöschten Items); „names a hidden item only as hidden“ (Review Focus 4: Relation zu einem OPS-Item, Leser ohne OPS → `{label, hidden: true}` ohne `item_id` und `key`); „shows the current key of a renamed project“ (Kennung WEB → NEW: `key` `NEW-…`); „names a deleted item as hidden“; „leaves out watching and pure reordering“; „pages with a cursor“; „answers 404 for an item the account does not see“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ListHistoryTest|WorkItemsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: read the history of a work item from its events`.

---

### Task 13: Status-Zuordnung: `RemapStates`, Workflow wechseln, Status entfernen, Belegung

**Files:**
- Create: `app/Actions/WorkItems/RemapStates.php`, `app/Actions/Workflows/ListStateUsage.php`, `app/Http/Controllers/Api/StateUsageController.php`, `tests/Feature/WorkItems/RemapStatesTest.php`, `tests/Feature/Catalog/StateUsageTest.php`, `tests/Integration/RemapStatesRaceTest.php`
- Modify: `app/Actions/Projects/AssignWorkflow.php`, `app/Actions/Workflows/SaveWorkflow.php`, `app/Support/WorkflowInput.php` (`mappingErrors` mit Pflicht und Übersetzung), `app/Exceptions/Problem.php` (`state_in_use`), `tests/Feature/Projects/AssignWorkflowTest.php`, `tests/Feature/Catalog/SaveWorkflowTest.php`, `tests/Integration/CatalogLockRaceTest.php`, `matrix.php`, `routes.php`, `lang/*.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2 (`ResolutionRule`, `MoveStamps`), Task 4, 8; Phase 3 (`WorkflowInput`, `AssignWorkflow`, `SaveWorkflow`)
- Produces:
  - `RemapStates::handle(Actor $actor, array $projectIds, array $mapping, string $reason): int` — für alle Items der Projekte, deren `state_id` ein Schlüssel von `$mapping` (alte Status-ULID → neue Status-ULID) ist: neuer Status ohne Übergangsregeln, Resolution über `ResolutionRule::after` (ohne Wahl), Zeitstempel über `MoveStamps::after`, je Item ein `work_item.state_changed` mit `changes.state_id` (und `resolution_id`) und `meta.reason` (`workflow_changed` bzw. `state_removed`). Läuft in der Transaktion des Aufrufers (eigenes `DB::transaction` als Savepoint, ArchTest), in Blöcken zu 500 Items; keine Sperre und kein Recht: die Aufrufer halten die Organisation exklusiv (P1, P2). Rückgabe: Zahl der umgeschriebenen Items.
  - `AssignWorkflow` (Phase 3): jeder Status des alten Workflows, den ein Item des Projekts (auch archiviert) trägt, braucht in `mapping` ein Ziel im neuen Workflow, sonst 422 an `mapping.<state_id>` (`field.mapping.required` „Für „:name“ fehlt ein Status im neuen Workflow.“) mit `extensions.states = [{state_id, name, items}]`; danach `RemapStates` mit `workflow_changed` vor dem `project.updated`.
  - `SaveWorkflow` (Phase 3): ein entfernter Status mit Items (in irgendeinem Projekt dieses Workflows) ohne Ziel in `state_mapping` → `Problem::conflict('state_in_use', ['states' => [{state_id, name, items}]], __('problem.detail.state_in_use'))`; die Ziele von `state_mapping` sind Schlüssel der Eingabe (lokale IDs neuer Status oder ULIDs bleibender, wie `initial_state_id`) und werden nach dem Speichern in ULIDs übersetzt; ein Schlüssel, der kein entfernter Status ist, bleibt 422 (strenger als der Klickdummy, P17); dann `RemapStates` mit `state_removed` für alle Projekte des Workflows, vor dem Löschen der Status.
  - `ListStateUsage::handle(Actor $actor, array $query): array /* list<array{state_id: string, items: int}> */` — `project` (Referenz; unsichtbar → 404) **oder** `workflow` (ULID; zählt in allen Projekten des Workflows, die der Actor sieht); zählt auch archivierte Items; Status ohne Items fehlen.
  - REST: `GET /api/v1/state-usage?project=WEB` bzw. `?workflow=<id>` → `{data: [{state_id, items}]}`. Matrix: `'ListStateUsage'` (alle, `hidden` `['outsider_private']` mit `project`), `'RemapStates'` (`'system' => true`, `event` `WorkItemStateChanged`, `run` mit einem Item der Welt und einer Zuordnung auf den nächsten Status). Route `'count the items per state'`.
- Texte: `problem.reason.state_in_use` „Für entfernte Status mit Items fehlt ein neuer Status.“, `problem.detail.state_in_use` (gleich), `field.mapping.required`.

- [ ] **Step 1: Failing Tests schreiben**
  - `RemapStatesTest`: „moves items without asking the transitions“ (Matrix-Workflow ohne den Übergang → Item wechselt trotzdem); „sets the resolution and the stamps like a move“ (In Progress → Done: Standard-Resolution, `closed_at`; Done → Todo: Resolution leer); „records each item with the person and the reason“; „leaves items of other projects and unmapped states alone“; „remaps archived items as well“.
  - `AssignWorkflowTest` (ergänzt): „requires a new state for every state in use and names them“ (422 an `mapping.<id>` mit `extensions.states` und den Zahlen; ohne Items reicht `mapping: {}` weiter); „switches the workflow and remaps the items in one go“ (danach kein Item mit einem Status des alten Workflows; `project.updated` nach den `state_changed`); „takes a mapping of an unused state without complaint“.
  - `SaveWorkflowTest` (ergänzt): „refuses to remove a state with items without a new one“ (409 `state_in_use` mit `extensions.states`, nichts gespeichert); „maps removed states to new states by the keys of the input“ (Ziel `st_new` (lokale ID) → nach dem Speichern die ULID des neuen Status); „remaps the items of every project of the workflow“; „still refuses a mapping of a state that stays“ (422).
  - `StateUsageTest`: „counts the items per state of a project, archived ones too“; „counts per workflow over the projects the account sees“ (ein Org-Member ohne OPS zählt OPS nicht); „answers 404 for a project the account does not see“.
  - `tests/Integration/RemapStatesRaceTest.php` (Review Focus 3): „makes a move wait while the workflow of the project changes“ (`hold(fn () => AssignWorkflow::run(...))`, `second(fn () => TransitionWorkItem::run(actor($member), $item, ['to_state_id' => $oldInProgress]))` → `expectLockWait($outcome, 'organization', null, 'lock in share mode')`); „moves in the new workflow once the switch is through“ (`releaseBeforeLock('organization')` → der Zug zum alten Status ist 422 `state_id`, das Item trägt den zugeordneten Status des neuen Workflows; nie ein `QueryException`); dasselbe für `SaveWorkflow` mit entferntem Status („a move into a state that is being removed fails cleanly“).
  - `CatalogLockRaceTest`: die bestehenden Fälle bleiben grün.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RemapStatesTest|AssignWorkflowTest|SaveWorkflowTest|StateUsageTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`; `ddev artisan test --testsuite=Integration --filter='RemapStatesRaceTest|CatalogLockRaceTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: remap the states of work items when a project switches workflow or a state goes`.

---

### Task 14: Kataloge gegen Items: Epic-Häkchen, Archiv statt Löschen, Zählungen

**Modell: sonnet**

**Files:**
- Modify: `app/Actions/WorkItemTypes/{SaveWorkItemType,DeleteWorkItemType}.php`, `app/Actions/Properties/{SaveProperty,DeleteProperty}.php`, `app/Actions/Labels/DeleteLabel.php`, `app/Actions/RelationTypes/DeleteRelationType.php`, `app/Actions/Resolutions/DeleteResolution.php`, `app/Support/{PropertyInput,WorkflowInput}.php`, `app/Support/ClientKeys.php` (neu: die gemeinsame `new:`-Logik), die zugehörigen Tests unter `tests/Feature/Catalog/`, `lang/*.json`
- Test: `tests/Feature/Catalog/{WorkItemTypesTest,PropertiesTest,CatalogsTest}.php` (bestehende Dateien, ergänzt), `tests/Unit/ClientKeysTest.php`

**Interfaces:**
- Consumes: Task 4–11
- Produces:
  - `SaveWorkItemType`: `is_epic` aus → 422 `is_epic` `field.is_epic.has_children` „Items dieses Typs haben Kind-Items. Nur Epics können Kind-Items haben.“, wenn ein Item des Typs Kinder hat; an → 422 `field.is_epic.has_parent` „Items dieses Typs haben ein Eltern-Item. Epics haben kein Eltern-Item.“, wenn eines ein Eltern-Item hat (Spec 4.8, unter `CatalogLock`).
  - `DeleteWorkItemType`: trägt ein Item den Typ, wird er archiviert (`archived_at = now()`, `work_item_type.updated` mit `changes.archived_at`) und die Antwort ist `{outcome: 'archived'}`, sonst gelöscht wie bisher (Spec 4.6).
  - `DeleteResolution`: trägt ein Item die Resolution → archiviert, `{outcome: 'archived'}` (Standard bleibt 409 `is_default`).
  - `SaveProperty`: eine ausgelassene Option, die ein Item trägt, wird archiviert statt gelöscht (Spec 4.7 „benutzte Optionen werden archiviert“); `DeleteProperty` löscht die Werte mit (Kaskade) und antwortet `{affected_items: <Zahl der Items mit Wert>}`; die History behält die alten Werte (keine Events je Item, wie A77).
  - `DeleteLabel` → `{affected_items}` (Items, die das Label trugen; die Zuordnung geht per Kaskade); `DeleteRelationType` (eigene) → `{affected_relations}`.
  - `PropertyInput`: Feldfehler der Grundfelder und der Optionen in **einer** Antwort (aufgeschoben aus Phase 3); `ClientKeys` (`final class ClientKeys { public static function keyOf(array $row, int $index): string; public static function resolve(array $keys, array $ids, string $key): ?string }`) ersetzt die doppelte `new:<index>`-Logik von `WorkflowInput` und `PropertyInput` (Verhalten gleich, `ClientKeysTest` hält es fest).

- [ ] **Step 1: Failing Tests schreiben** — je Regel ein Fall und eine Gegenprobe: „refuses to take the Epic mark from a type whose items have children“ / „lets it go when none has“; „refuses the Epic mark for a type whose items have a parent“; „archives a type in use instead of deleting it“ (`outcome` `archived`, Typ bleibt, neue Items 422 `type_id.archived`) / „deletes an unused type“ (`outcome` `deleted`); „archives a resolution in use“; „archives an option in use and deletes an unused one“; „counts the items whose values a deleted property took along“ (zwei Items → `affected_items` 2, Werte weg, History-Event mit `values.customer` bleibt); „counts the items of a deleted label“; „counts the relations of a deleted relation type“; „reports the errors of the fields and of the options in one answer“ (leeres Label und leere Option → beide Schlüssel in `errors`); `ClientKeysTest`: `keyOf` mit und ohne `id`, `resolve` lokal und ULID.

- [ ] **Step 2: Rot, umsetzen, grün** — `ddev artisan test --filter='WorkItemTypesTest|PropertiesTest|CatalogsTest|ClientKeysTest|WorkflowsTest|TranslationKeysTest'`; `ddev artisan test --testsuite=Integration --filter=CatalogLockRaceTest`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `feat: check the catalogs against work items, archive what items use and count what a deletion takes`.

---

### Task 15: Demo- und e2e-Daten

**Modell: sonnet**

**Files:**
- Create: `database/seeders/Demo/{ItemsSeeder,ActivitySeeder}.php`, `tests/Feature/Seeders/ItemsSeederTest.php`
- Modify: `database/seeders/DemoSeeder.php`, `database/seeders/E2eSeeder.php`, `tests/Feature/DemoSeederTest.php`, `e2e/helpers.ts`, `CLAUDE.md` (Seeder)

**Interfaces:**
- Consumes: Task 4–12
- Produces:
  - `ItemsSeeder` (`WithoutModelEvents`, ohne Actions, A86): jede Zeile von `rows` und `relations` aus `prototypes/clickdummy/src/api/seed/items.ts` als PHP-Array übertragen (Key, Typ, Titel, Status, Priorität, Assignee, Labels, Start/Due, Eltern, Werte, Ersteller, Zeitpunkte nach den Regeln der Datei: `started_at` aus `started` oder dem Start-Date, Resolution der Zeile oder der Standard, `closed_at`, `archived_at`; Beschreibungen als Tiptap-JSON), Ränge über `Rank::nBetween(null, null, n)` je Projekt in Reihenfolge der Zeilen, `next_number` = höchste Nummer; `updateOrCreate` über (`project_id`, `number`), ein zweiter Lauf ändert nichts. IDs der Klickdummy-Daten (`opt_nordlicht`, `t_wish`, `u_ida` …) über die stabilen Schlüssel des `CatalogSeeder`/`PeopleSeeder` auflösen (Optionslabel, Typname, Handle).
  - `ActivitySeeder`: die Events aus `seed/activity.ts` (ohne Kommentare und Anhänge, Phase 7) direkt als `events`-Zeilen mit `dispatched_at = occurred_at` (nie verteilt, P23), Relationsänderungen in der Form aus Task 11; die Beobachter („who watches which item“) als `work_item_subscribers`.
  - `E2eSeeder`: unverändert bis auf die Reihenfolge (E2E-Projekte mit ihren Items vor den Katalogeinträgen löschen).
  - `e2e/helpers.ts`: `createE2eProject(page: Page, name: string, options?: { workflow?: string; types?: string[] }): Promise<{ id: string; identifier: string }>` (per API, Kennung aus der Lauf-Kennung), `createItem(page: Page, input: Record<string, unknown>): Promise<{ id: string; key: string }>`, `removeE2eProject(page: Page, identifier: string): Promise<void>` (für `finally`).

- [ ] **Step 1: Failing Tests schreiben** — `ItemsSeederTest`: „seeds every row of the clickdummy“ (Zahl der `key: '`-Zeilen in `seed/items.ts`, per Regex über `repo_path()`, gleich der Zahl der Items; jeder Key aus der Datei existiert); „seeds WEB-47 like the moodboard“ (Typ Bug, Status In Progress, Priorität Urgent, Assignee Jonas, Labels Formulare und Produktion, Start 2026-10-27, Due 2026-10-31, Werte `customer` Studio Nordlicht, `effort` 3.5, `environment` Produktion, `browser` „Safari 18 (iOS)“, `steps` als Rich Text mit nummerierter Liste; Beschreibung als Text, in dem „@mara“ und „WEB-42“ Text bleiben; History: angelegt von Ida, gestartet von Jonas, zugewiesen vom Standard-Bot mit Grund `assign_on_start`, Priorität high → urgent von Ida); „seeds the relations, also across projects“; „keeps two levels“ (jedes Item mit Eltern hat ein Epic als Eltern, kein Epic hat Eltern); „changes nothing when run twice“ (Zahl der Items, Events und Ränge gleich); `DemoSeederTest`: Items nach Projekten (WEB, APP, OPS) gezählt.

- [ ] **Step 2: Rot, umsetzen, grün** — `ddev artisan test --filter='ItemsSeederTest|DemoSeederTest|E2eSeederTest'`; `ddev artisan migrate:fresh --seed --seeder=DemoSeeder` läuft ohne Fehler.

- [ ] **Step 3: Gates G1, G3** (die Helfer laufen ab Task 20 in Specs; hier `pnpm --dir e2e test -- projects onboarding` grün)

- [ ] **Step 4: Commit** — `feat: seed the work items, relations, history and watchers of the clickdummy`.

---
### Task 16: Frontend-Datenschicht und reine Regeln im Browser

**Files:**
- Create: `resources/js/domain/{rank,hierarchy,resolution,progress,keys}.ts` (+ `*.test.ts`), `resources/js/lib/richtext.ts` (+ Test), `resources/js/api/{workItems,relations}.ts` (+ Tests), `resources/js/hooks/{workItems,relations}.ts` (+ Tests)
- Modify: `resources/js/types.ts`, `resources/js/hooks/mutation.ts` (`useItemMutation`), `resources/js/hooks/keys.ts` (Kommentar), `resources/js/hooks/{workflows,catalog,workItemTypes,properties}.ts` (Antworten `outcome`/`affected_*` der Löschungen typisieren), `resources/js/api/{workflows,catalog,workItemTypes,properties}.ts`, `resources/js/test/fixtures.ts` (Items, Relationen, History), `resources/js/lib/i18n.ts`-Schlüssel in `lang/*.json`

**Interfaces:**
- Consumes: REST aus Task 5–14
- Produces:
  - `types.ts` (Form der REST-Antwort, P3, P7): `WorkItem` bekommt `description: string | null` (Markdown), `description_json: RichText | null`, `values_markdown: Record<string, string>`, `children_progress: { done: number; total: number } | null`, `blocked: boolean`, `blocking: boolean`, `subscribed: boolean`; `subscriber_ids` entfällt aus `WorkItemRecord`; `ItemEvent` bekommt `via: string`; `WorkItemDetail.subscribed` liest `item.subscribed`; `WorkItemMeta` entfällt; `StateUsage = { state_id: string; items: number }`; `CatalogDeleteOutcome = { outcome: 'deleted' | 'archived' }`.
  - `domain/rank.ts` (`rankBetween(before, after)`, Port mit Test), `domain/hierarchy.ts` (`canHaveChildren`, `canHaveParent`, `typeChangeRefusal(hasChildren, hasParent, target): 'has_children' | 'has_parent' | null`, `childTypeId(project, types)`; die Sätze sind Schlüssel `items.hierarchy.*`, keine Konstanten), `domain/resolution.ts` (`resolutionAfterTransition`), `domain/progress.ts` (`childProgress`), `domain/keys.ts` (`parseKey`); Tests mit den Fällen und Namen des Klickdummys.
  - `lib/richtext.ts`: `plainText`, `docToText`, `textDoc`, `isPlainDoc`, `plainDocText`, `isBlankDoc` (ohne `mentionedIds`, `attachmentIds`: Phase 7).
  - `api/workItems.ts`: `export interface ListWorkItemsArgs extends PageArgs { project_id?: string; parent_id?: string; q?: string; include_archived?: boolean }` (P8; Phase 5 erweitert auf `view_id`, `filter`, `sort`), `listWorkItems(args?: ListWorkItemsArgs): Promise<Page<WorkItem>>` (`filter[project]`, `filter[parent]`, `filter[q]`), `getWorkItem(keyOrId: string): Promise<WorkItemDetail>` (ein Aufruf mit `include=children,relations,type,workflow`; `state` aus `workflow.states`, `attachments: []` bis Phase 7), `listActivity(itemRef: string, args?: PageArgs): Promise<Page<ActivityEntry>>` (History als `{kind: 'event'}`; Kommentare Phase 7), `createWorkItem(input: CreateWorkItemInput)`, `updateWorkItem(id, patch: WorkItemPatch, options?: { base_description_version?: number })`, `transitionWorkItem(id, to_state_id, resolution_id?)`, `bulkUpdateWorkItems(ids, patch: BulkPatch): Promise<BulkResult>`, `changeWorkItemType(id, type_id, values?)`, `archiveWorkItem(id)`, `restoreWorkItem(id)`, `deleteWorkItem(id): Promise<void>`, `setSubscribed(id, on): Promise<WorkItem>`, `listStateUsage(args: { project?: string; workflow?: string }): Promise<StateUsage[]>`. `CreateWorkItemInput`/`WorkItemPatch` wie im Klickdummy (`description: RichText | null` wird als `description_json` gesendet; `template_id`, `attachment_ids` entfallen bis Phase 7/10).
  - `api/relations.ts`: `addRelation(source_id, type_id, target_id): Promise<Relation>` (Signatur des Klickdummys; liest `data.relation` der Antwort), `removeRelation(id): Promise<void>`.
  - `hooks/mutation.ts`: `useItemMutation<TVars, TData>(options: { mutationFn; ids: (vars) => string[]; apply: (item: WorkItem, vars) => WorkItem; failureTitle: TranslationKey })` — Port: optimistisch in jeder gecachten Liste und jedem Detail (Treffer über ID **und** Key, auch einen früheren Key nach `parseKey`, 13c), Rücknahme mit Fehler-Toast, „Erneut versuchen“ nur bei 5xx oder ohne Antwort, ein 409 mit `current` bleibt dem Aufrufer; `parent` folgt der Änderung wie im Klickdummy.
  - `hooks/workItems.ts`: `useWorkItems(args, options)`, `useWorkItem(keyOrId, options)`, `useActivity(itemId, args)`, `useCreateWorkItem`, `useUpdateWorkItem`, `useTransitionWorkItem`, `useBulkUpdateWorkItems`, `useChangeWorkItemType`, `useArchiveWorkItem`, `useRestoreWorkItem`, `useDeleteWorkItem`, `useSetSubscribed` (optimistisch über `subscribed`), `useStateUsage(args)`; `hooks/relations.ts`: `useAddRelation`, `useRemoveRelation` (machen `workItems` und `activity` ungültig). Optimistische Zeitstempel (`archived_at`) mit `new Date().toISOString()`; die App hat keine Demo-Uhr, die Antwort des Servers ersetzt den Wert.
  - Katalog-Hooks: `useDeleteWorkItemType`, `useDeleteResolution` liefern `CatalogDeleteOutcome`; `useDeleteProperty`/`useDeleteLabel` `{affected_items}`, `useDeleteRelationType` `{affected_relations}`.

- [ ] **Step 1: Failing Tests schreiben** — Domain: die Tests des Klickdummys mit gleichen Namen (`rank.test.ts` mit `fractional-indexing` und Stringvergleich `<`, `hierarchy.test.ts` mit Codes statt Sätzen, `resolution.test.ts`, `progress.test.ts`, `keys.test.ts`); `richtext.test.ts`. `api/workItems.test.ts` mit `mockApi`: jede Funktion ruft Methode, Pfad und Query wie oben (`listWorkItems({ project_id: 'WEB', q: 'kontakt' })` → `GET /api/v1/work-items?filter[project]=WEB&filter[q]=kontakt`; `updateWorkItem` schickt `description_json` und `base_description_version`; `getWorkItem('WEB-47')` → `include=children,relations,type,workflow` und baut `state`; `bulkUpdateWorkItems` gibt die Antwort ohne `data` weiter; `deleteWorkItem` 204). `hooks/workItems.test.tsx`: `useUpdateWorkItem` ändert Liste und Detail sofort, nimmt bei 422 zurück und meldet ohne „Erneut versuchen“, bei 503 mit; trifft ein gecachtes Detail unter einem früheren Key (`OLD-1` → Item `NEW-1`); `useSetSubscribed` setzt `subscribed`; Fehler 409 `description_conflict` bleibt beim Aufrufer (kein Toast).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/domain resources/js/api resources/js/hooks resources/js/lib/richtext`.

- [ ] **Step 3: Gates G2** (bestehende Bildschirme kompilieren mit den geänderten Typen; G1 für `lang/*.json`)

- [ ] **Step 4: Commit** — `feat: add the work item data layer of the interface with optimistic changes`.

---

### Task 17: Editor für Beschreibungen

**Files:**
- Create: `resources/js/editor/{RichTextEditor.tsx,RichTextView.tsx,presets.ts,editor.css,editor.test.tsx}`
- Modify: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`allowBuilds`: verlangt eines der Pakete ein Build-Skript, mit `false` eintragen; Tiptap braucht keins), `vitest.config.ts` (`resources/js/editor/**`), `lang/*.json`

**Interfaces:**
- Consumes: Task 16 (`lib/richtext.ts`, `RichText`)
- Produces:
  - `RichTextEditor(props: RichTextEditorProps)` mit den Props des Klickdummys ohne Uploads und Erwähnungen: `value: RichText | null`, `onChange(doc: RichText | null)`, `preset: EditorPreset`, `label?`, `placeholder?`, `autoFocus?`, `readOnly?`, `onSubmit?` (⌘⏎), `onEscape?`, `invalid?`, `describedBy?`, `editorRef?: RefObject<Editor | null>`; `isEmptyDoc(doc)`; `preloadEditor(): Promise<void>` (lädt Tabellen nach, wie der Klickdummy).
  - `RichTextView({ value, preset, className })` (schreibgeschützt, gleiches Schema).
  - `presets.ts`: `PRESETS` und Typ `EditorPreset` wie der Klickdummy; `PRESET_LABEL` und `PRESET_PLACEHOLDER` als Schlüssel (`editor.label.*`, `editor.placeholder.*`; Platzhalter ohne „/“, „@“, „#“, bis Phase 7 sie bringt: „Beschreibung schreiben …“, P15).
  - Schema: StarterKit (Absatz, Überschriften 1–3 je Stufe, Listen, Zitat, Code-Block ohne Hervorhebung, Link mit `http`/`https`/`mailto`, harter Umbruch, waagerechte Linie nur `page`), `TaskList`/`TaskItem` (ab `description`), Tabellen (ab `description`), `Placeholder`. Markdown-Kürzel beim Tippen kommen mit StarterKit. Kein `/`-Menü, keine Erwähnungen, Verweise, Uploads (Phase 7).

- [ ] **Step 1: Pakete** — `ddev exec pnpm add @tiptap/react@3.32.0 @tiptap/starter-kit@3.32.0 @tiptap/extension-list@3.32.0 @tiptap/extension-table@3.32.0 @tiptap/extensions@3.32.0`.

- [ ] **Step 2: Failing Tests schreiben** (`editor.test.tsx`, Fälle aus `features/editor/editor.test.tsx` des Klickdummys, die Phase 4 betreffen, nach `await preloadEditor()`): „shows a document and reports changes as Tiptap JSON“; „knows an empty document“ (`isEmptyDoc` für `null`, leeren Absatz, Leerzeichen); „turns Markdown shortcuts into blocks while typing“ (`## ` → Überschrift, `- ` → Liste, `[ ] ` → Aufgabe in `description`, nicht in `comment`); „keeps tables and checklists of a description but not of a comment“ (ein Dokument mit Tabelle in `comment` zeigt den Text ohne Tabelle, in `description` die Tabelle); „submits on mod+enter and leaves on escape“; „names the editor and marks it invalid“ (`aria-label`, `aria-invalid`, `aria-describedby`); „refuses links other than http, https and mailto“; „shows a read-only view“.

- [ ] **Step 3: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/editor`.

- [ ] **Step 4: Gates G2**

- [ ] **Step 5: Commit** — `feat: add the rich text editor with the levels of comments, descriptions and pages`.

---

### Task 18: Feld-Editoren I: Picker, Status, Assignee, Priorität, Labels, Typ, Eltern, Resolution, Dialoge

**Files:**
- Create: `resources/js/components/fields/{Picker,format,itemData,StatePicker,AssigneePicker,PriorityPicker,LabelsPicker,TypePicker,ParentPicker,ResolutionPrompt,ItemDialogs}.ts(x)`, `resources/js/components/items/{ItemKey,ItemLink,BlockedHint}.tsx`, `resources/js/components/fields/fields.test.tsx`, `resources/js/components/items/items.test.tsx`
- Modify: `resources/js/components/ui/PriorityIcon.tsx` (Name über `priority.*`, Vormerkung), `vitest.config.ts` (`components/fields/**`, `components/items/**`), `lang/*.json`

**Interfaces:**
- Consumes: Task 16
- Produces (Namen und Props des Klickdummys; Texte als Schlüssel `items.fields.*`, `priority.*`):
  - `Picker`, `PickerOption`, `PickerLook`, `PickerExtras`, `triggerClass`, `PendingMark`, `withTooltip`, `ReadOnlyTrigger`.
  - `format.ts`: `formatDay`, `formatShortDay`, `formatWeekdayDay`, `relativeDay`, `addDays`, `daysBetween`, `formatNumber`, `formatPropertyValue`, `botWord` — `Intl` über `intlLocale()`, Zeitzone der Organisation (13c: nie fest Berlin).
  - `itemData.ts`: `useEditReason(item)` (Recht `item.edit`, archiviertes Item, archiviertes Projekt), `useItemWorkflow(item)`, `useToday()` (Org-Zeitzone), `useUserMap()`, `projectPeople`, `useProjectPeople(projectId)` (über `listMembers(project)` plus Org-Admins, mit `canTakeWork`).
  - `StatePicker` (nur erlaubte Ziele über `allowedTargets`; ein Ziel der Kategorie Completed/Canceled öffnet `askResolution`), `AssigneePicker` + `personOption`, `PriorityPicker` + `PRIORITY_OPTIONS`, `LabelsPicker` + `labelOption`, `TypePicker` + `TypeGlyph` (Wechsel über `askTypeChange` mit Hinweis auf verlorene Werte und Pflichtfeldern), `ParentPicker` + `parentCandidates`, `NO_PARENT_OPTION`, `parentOption`, `noParentText`, `useProjectItems(projectId)` (über `useWorkItems({ project_id })`, alle Seiten), `ResolutionPrompt` (vorbelegt mit dem Standard der Kategorie), `ItemDialogs`: `askResolution`, `askTypeChange`, `ItemDialogsHost`.
  - `components/items`: `ItemKey`, `ItemLink` (Inertia-`<Link>` über `paths.item`), `BlockedHint` (liest `blocked`/`blocking` am Item und die Relationen des Details).
  - `PriorityIcon` nennt sich „Priorität: :name“ über `priority.label` und `priority.<p>` (die Namen bleiben in beiden Sprachen Urgent … None, P16).

- [ ] **Step 1: Failing Tests schreiben** (`fields.test.tsx`, aus `components/fields/fields.test.tsx` des Klickdummys mit `mockApi` statt Fake-DB; dazu die Lücken aus 13c): „offers only the states the workflow allows from here“ (Agentur-Freigabe Todo: In Progress, Cancelled; nicht Done); „asks for the resolution on the way into a closed state, with the default chosen“; „takes the assignee from the people of the project and offers me first“ (Lücke „assignee filtering“: kein fremder Bot, kein deaktiviertes Konto, Org-Admin ja); „refuses a type change that would break two levels, with the sentence“ (Lücke „type-change 422“); „names lost values before a type change and asks for the required ones“; „offers only epics of the project as parent and says why there is none“; „shows the reason instead of the picker when the item is read-only“ (Viewer, archiviertes Item); „rolls a refused change back with a toast“; „formats days in the time zone of the organisation“ (Organisation `America/New_York`: `relativeDay` um 23:30 UTC); `PriorityIcon`: `aria-label` „Priorität: Urgent“ bzw. „Priority: Urgent“. `items.test.tsx`: `ItemKey`, `ItemLink` (Pfad über `paths.item`), `BlockedHint` (blockiert, blockiert andere, nichts).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/components/fields resources/js/components/items resources/js/components/ui`.

- [ ] **Step 3: Gates G1 (Texte), G2**

- [ ] **Step 4: Commit** — `feat: port the field editors of work items with their pickers and dialogs`.

---

### Task 19: Feld-Editoren II: Daten, Properties, Standardwerte über dieselben Editoren

**Files:**
- Create: `resources/js/components/fields/DateField.tsx`, `resources/js/components/fields/property/{PropertyField,PropertyValueInput,inputs,parse}.ts(x)`, `resources/js/components/fields/property/property.test.tsx`
- Modify: `resources/js/features/settings/org/properties/{PropertyDialog,DefaultValueField}.tsx` (Standardwert über `PropertyValueInput`), `resources/js/features/settings/org/properties/properties.test.tsx`, `lang/*.json`
- Delete: was von `DefaultValueField.tsx` danach übrig bleibt (die Datei entfällt, wenn der Dialog `PropertyValueInput` direkt nutzt)

**Interfaces:**
- Consumes: Task 16, 17 (`RichTextEditor` für Rich-Text-Properties), Task 18
- Produces:
  - `DateField({ item, field: 'start_date' | 'due_date', look, shortcut, ...extras })`, `DatePopover`, `DayValue`, `useOverdue(item)` (heute in Org-Zeitzone).
  - `property/PropertyField({ item, property, required, hideLabel })` (Item-Feld mit Speichern, Fehlern am Feld, Hinweis „fehlt (Pflicht)“ für Items ohne Wert einer später zur Pflicht gewordenen Property, Spec 4.7), `property/PropertyValueInput(props: PropertyValueInputProps)` (ein Editor je Feldtyp; meldet nur Werte, die sich lesen lassen; Rich Text nur als schlichte Absätze, reichere Dokumente schreibgeschützt mit „Im Editor bearbeiten“, R17), `property/parse.ts` (`parseNumber(text, decimals)`: Komma und Punkt, „0.500“ ist 0,5 und nicht 500 (13c: führende Null), Tausenderpunkte nur mit Komma als Dezimalzeichen), `isEmptyValue`.
  - Ja/Nein: ein Schalter, `false` und kein Wert lesen sich gleich (A89, Vormerkung); gespeichert wird, was gesetzt ist.
  - `PropertyDialog` nimmt `PropertyValueInput` für den Standardwert (Vormerkung „`DefaultValueField` gegen die Feld-Editoren tauschen“); Personenauswahl und Rich Text ohne Standardwert bleiben (A69).

- [ ] **Step 1: Failing Tests schreiben** — `property.test.tsx`: je Feldtyp anzeigen, ändern, leeren (Text, Zahl mit `'3,46'` → 3,5 und `'0.500'` → 0,5, Dropdown einfach und mehrfach mit archivierter gesetzter Option, Ja/Nein, Datum, Personen, Rich Text schlicht und schreibgeschützt, URL); „refuses to empty a required value, at the field“ (422 `values.customer` erscheint am Feld, Fokus bleibt); „marks a required value that an older item lacks“; „does not save a number it cannot read“; `DateField`: „marks an overdue day“, „refuses a start after the due date at the field“. `properties.test.tsx` (ergänzt): der Standardwert eines Dropdowns und einer Zahl über `PropertyValueInput`, gesendet wie bisher.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/components/fields resources/js/features/settings/org/properties`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3** (die Property-Einstellungen sind ein Bildschirm: `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test types-properties`, dann der volle Lauf)

- [ ] **Step 4: Commit** — `feat: port the date and property editors and use them for default values`.

---

### Task 20: Item-Befehle, Kürzel und Palette ohne Suche

**Files:**
- Create: `resources/js/lib/commands.ts` (+ Test), `resources/js/features/palette/{CommandPalette,EntryRow,Highlight,model}.ts(x)` (+ `palette.test.tsx`, `model.test.ts`), `resources/js/components/fields/commands/{index,context,options,actions,register,useItemCommands,PreviewItemCommands}.ts(x)` (+ `commands.test.tsx`), `resources/js/shell/PaletteHost.tsx`, `e2e/tests/palette.spec.ts`
- Modify: `resources/js/lib/shortcuts/catalog.ts`, `resources/js/shell/{Shell,bindings}.tsx`, `vitest.config.ts` (`features/palette/**`), `lang/*.json`

**Interfaces:**
- Consumes: Task 16, 18, 19
- Produces:
  - `lib/commands.ts`: `CommandOption`, `CommandSubpage`, `CommandDef`, `registerCommand(def): () => void`, `useCommand(def, deps)`, `useCommands()`, `SHELL_COMMAND_GROUPS` (Port).
  - `features/palette/CommandPalette` (⌘K, in Listen-Kontext `/` erst Phase 5): Gruppen der Bildschirme zuerst, dann Navigation (`g i`, `g m`, `g v`, `g p` als Befehle), „Neues Item“ (`c`), Theme; Unterlisten der Befehle (`openPalette(commandId)` startet darin); Hervorhebung des Treffers; **keine Suchtreffer** (Items, Projekte, Personen: Phase 6, P14); ohne Treffer „Keine Befehle gefunden“.
  - `components/fields/commands/` (geteilt aus `commands.ts`, 13b): `index.ts` (Wiederexport: `useItemCommands`, `PreviewItemCommands`, `registerItemCommands`, Typen), `context.ts` (`ItemCommandContext`, `ItemCommandSource`, Ziele nach Regel 1–5 des Klickdummys), `options.ts` (Unterlisten: Status, Assignee, Priorität, Labels, Typ, Eltern), `actions.ts` (`apply`, Mehrfach über `bulkUpdateWorkItems` mit Toast der Ablehnungen, Archivieren bzw. Löschen mit 5 s Rückgängig), `register.ts` (`registerItemCommands(source): () => void`), `useItemCommands.ts` (`useItemCommands(options: ItemCommandsOptions)`, Mounts mit Rang `detail` > `list`), `PreviewItemCommands.tsx`.
  - Katalog-Einträge (`catalog.ts`, P25): `shell.palette` `mod+k`, `item.create` `c`, `item.state` `s`, `item.assignee` `a`, `item.assign_me` `i`, `item.priority` `p`, `item.labels` `l`, `item.type` `t`, `item.due` `d`, `item.start` `shift+d`, `item.parent` `shift+p`, `item.relation` `r`, `item.title` `e`, `item.remove` `mod+backspace`; Gruppe `shortcuts.group.item`. Die Befehle binden ihre Kürzel nur über diese IDs.

- [ ] **Step 1: Failing Tests schreiben** — `model.test.ts` (Port: Rangfolge der Treffer, Gruppen, Unterliste); `palette.test.tsx`: „opens on mod+k with the commands of the screen first“; „starts in the sub-list of a command“; „runs a navigation command and closes“; „says when nothing matches“; „restores the focus on escape“. `commands.test.tsx` (aus `commands.test.tsx` des Klickdummys): „acts on the item of the page“; „acts on the previewed item while the focus is in the preview“; „says why a key does nothing without the right“ (Toast mit Grund für Viewer); „waits for the catalogs instead of acting“ („Einen Moment“) und „offers a retry when they failed“; „assigns me with i at once“; „archives a closed item and deletes an open one with undo“ (Rückgängig ruft nichts; nach 5 s `DELETE`); „names the refused items of a bulk change“; „registers once when a list and the preview are mounted“ (je Taste ein Eintrag in der Hilfe). `catalog.test.ts` (Phase 1) bleibt grün: keine Taste doppelt im selben Bereich.
  - `e2e/tests/palette.spec.ts`: „opens the palette with the keyboard and goes to the projects“ (`pressMod(page, 'k')`, Text „Projekte“, Enter → `/projects`); „lists the shortcuts of the palette in the help“ (`?` nennt ⌘K).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/lib/commands resources/js/features/palette resources/js/components/fields/commands resources/js/lib/shortcuts`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test palette shell`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: add the item commands with their shortcuts and the command palette without search`.

---

### Task 21: Item-Seite und Vorschau: Kopf, Felder, Wirte, `/items/{key}`

**Files:**
- Create: `app/Http/Controllers/ItemPageController.php`, `resources/js/pages/Items/Show.tsx`, `resources/js/features/item-detail/{ItemPage,ItemPeek,ItemBody,shared,FieldsPanel}.tsx`, `resources/js/features/item-detail/header/{ItemHeader,ItemTitle,ItemMenu,ItemPath,ArchivedNote,useItemRemoval}.ts(x)`, `resources/js/shell/PeekHost.tsx`, `resources/js/features/item-detail/detail.test.tsx`, `tests/Feature/Pages/ItemPageTest.php`, `e2e/tests/items.spec.ts`
- Modify: `routes/web.php`, `resources/js/shell/Shell.tsx`, `vitest.config.ts` (`features/item-detail/**`), `lang/*.json`, `CLAUDE.md` (Frontend: Item-Seite, Wirte)

**Interfaces:**
- Consumes: Task 6–12 (REST), 16–20
- Produces:
  - Web: `GET /items/{key}` (`auth`, Name `items.show`; Parameter nie `{item}`, sonst bindet `routes/api.php` ihn) → `ItemPageController`: `GetWorkItem` mit der Referenz als Text; frühere Kennung → 301 auf `/items/<aktueller Key>` mit `Cache-Control: no-store`; unsichtbar oder unbekannt → `Errors/NotFound` (404); sonst Inertia `Items/Show` mit `itemKey` (kanonisch). Die Seite rendert nur `ItemPage`.
  - `ItemPage({ itemKey })` (Schlüssel aus den Props statt `useParams`; ein Item, das inzwischen anders heißt, ersetzt die Adresse per `router.replace`), `ItemPeek({ itemId, panel })`, `ItemBody`, `ItemDetailProvider`, `shared.tsx` (`DetailSurface`, `DetailContext`, `useDetail`, `useChildType`, `isGone` (nur 404/403, nie 5xx: „verborgenes Item“ nur bei echtem Verlust, 13c), `SectionHeading`, `Section`, `focusWhenLost`), `FieldsPanel` (Status, Resolution, Assignee, Priorität, Labels, Typ, Eltern, Start-, Due-Date, dann die Properties des Typs mit „Pflicht“; Zeiten in Org-Zeitzone).
  - `header/` (aus `ItemHeader.tsx` geteilt, 13b): `ItemTitle` (`e`, Enter speichert, Esc verwirft, ≤ 255), `ItemMenu` (Link kopieren, Beobachten an/aus, Kind-Item anlegen — gesperrt mit Grund als Eintrag, nicht per Toast (13c), Archivieren/Wiederherstellen, Löschen mit 5 s Rückgängig), `ItemPath` (Projekt, Eltern-Kette), `ArchivedNote`, `useItemRemoval`.
  - `shell/PeekHost` (Port, ohne React Router: schließt bei Inertia-`navigate`), in `Shell.tsx` gemountet; Esc im Feld verlässt erst das Feld (R14).
  - Ohne Item-Listen (Phase 5) erreicht man Items über die Adresse, den Toast „Öffnen“ des Anlegen-Dialogs (Vorschau, Task 24), „Als Seite öffnen“ der Vorschau und die Links in Kindern, Relationen und Eltern-Pfad.

- [ ] **Step 1: Failing Tests schreiben**
  - `ItemPageTest` (Pest): „renders the page of an item by key“ (`assertInertia` mit `itemKey` `WEB-1`); „redirects a former key to the current one without caching“ (301, `Location` `/items/NEW-1`, `no-store`); „shows the 404 page for an item the person may not see, also by a former key“; „shows the 404 page for something that is no key“.
  - `detail.test.tsx` (aus `features/item-detail/detail.test.tsx` des Klickdummys, die Teile ohne Kommentare und Anhänge): „shows key, title, type tab and fields of an item“; „edits the title with e and keeps it on escape“; „changes the status and asks for the resolution“; „says why a viewer cannot change anything“ (Felder im Lese-Look mit Grund); „marks an archived item read-only and restores it“; „deletes with undo and goes back“; „copies the link“; „watches and stops watching“; „shows the 404 page for a gone item and an error with retry on 5xx“ (13c); „replaces the address when the key changed“; „opens and closes the preview, escape leaves a field first“; „shows the time of the organisation, not of Berlin“.
  - `e2e/tests/items.spec.ts` (Projekt per `createE2eProject`, Items per `createItem`, nur Tastatur, in allen vier Projekten): „sets a closing status with the resolution prefilled“ (Flow 1 über die Item-Seite: `s`, „done“ tippen, Enter → Dialog mit vorgewählter Resolution „Done“, Enter → Status Done, Resolution Done); „offers only allowed states in a restricted workflow“ (Erfolgskriterium 2.3 in der UI: Projekt mit Agentur-Freigabe, Item in Todo: die Unterliste von `s` nennt Done nicht, In Progress ja und setzt ihn); „changes assignee and priority with a and p“ (am Handy: Status und Assignee über die Felder, Spec 5.1); „edits the title with e“; „archives a done item and restores it“; „deletes an item with mod+backspace and undoes it with mod+z“; „opens a former key at the current address“ (Projekt umbenennen per API, `/items/OLD-1` → URL `/items/NEW-1`).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter=ItemPageTest`; `ddev exec pnpm test -- resources/js/features/item-detail resources/js/shell`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test items`.

- [ ] **Step 3: Gates G1, G2, G3**

- [ ] **Step 4: Commit** — `feat: port the page and the preview of a work item with its header and fields`.

---

### Task 22: Beschreibung mit Konfliktbanner, Kinder, Relationen

**Files:**
- Create: `resources/js/features/item-detail/{Description,Children,Relations}.tsx`, `resources/js/features/item-detail/sections.test.tsx`, `e2e/tests/item-sections.spec.ts`, `e2e/tests/item-description.spec.ts`
- Modify: `resources/js/features/item-detail/ItemBody.tsx`, `lang/*.json`

**Interfaces:**
- Consumes: Task 16, 17, 20, 21
- Produces:
  - `Description({ detail })` — Port ohne „Beschreibungskonflikt simulieren“ (nur Klickdummy): Editor `description`, Speichern nach 1200 ms Pause und auf ⌘⏎ mit `base_description_version`; Zustand „Gespeichert“ für Screenreader nicht versteckt; 409 `description_conflict` → Banner „:name hat die Beschreibung inzwischen geändert.“ mit „Neu laden“ (zeigt die fremde Fassung, der eigene Entwurf ist weg, die History hat beide) und „Meine Fassung übernehmen“ (speichert den Entwurf mit der Version aus `current`); Tippen während des Speicherns geht nicht verloren (der nächste Speichervorgang nimmt den neuesten Entwurf, 13c); ein fehlgeschlagenes Speichern (5xx) behält den Entwurf und bietet „Erneut versuchen“.
  - `Children({ detail })` — Fortschritt (geschlossene von allen, `children_progress`), Kinder mit Status, Assignee, Key; „Kind-Item“ öffnet den Anlegen-Dialog mit Eltern und `childTypeId` (gesperrt mit Grund `NO_CHILD_TYPE`); nur bei Epics.
  - `Relations({ detail })` — Gruppen je Relationstyp und Richtung (`relationLabel`), „verborgenes Item“ ohne Titel und ohne Entfernen; `r` und „Relation hinzufügen“: Typ und Richtung wählen, Ziel per Suche über `useWorkItems({ q, per_page: 20 })` (Key oder Titel, über Projekte); Entfernen mit Rückgängig; Fehler 422 (`duplicate`, `self`) am Feld.

- [ ] **Step 1: Failing Tests schreiben** — `sections.test.tsx`: Beschreibung: „saves after a pause with the version it is based on“; „shows the conflict banner and takes my version over“ (zweiter Aufruf mit `base_description_version` aus `current`); „reloads the other version“; „keeps what was typed while saving“; „keeps the draft after a failed save and retries“. Kinder: „shows the progress and opens the create dialog with the parent“; „says why no child can be created“. Relationen: „groups by type and direction“; „shows a hidden item without title and without remove“; „adds a relation found by key with r“; „shows a duplicate at the field“; „removes with undo“.
  - `e2e/tests/item-sections.spec.ts`: „relates two items with r and removes the relation again“; „creates a child item of an epic from its children section“.
  - `e2e/tests/item-description.spec.ts` (zwei Browser-Kontexte mit `signedInContext`, Review Focus 2): „warns the second editor of a description and keeps both versions“ (Kontext A und B öffnen dasselbe Item, A tippt und speichert, B tippt → Banner mit A's Namen; „Meine Fassung übernehmen“ → B's Text steht; Reload in A zeigt B's Text; die History nennt beide Änderungen); „writes a heading and a checklist with Markdown shortcuts“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/item-detail`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test item-sections item-description`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: port the description with its conflict banner, the children and the relations of an item`.

---

### Task 23: Aktivität (History)

**Files:**
- Create: `resources/js/features/item-detail/activity/{Activity.tsx,timeline.ts,phrases.tsx,EventLine.tsx,when.ts}`, `resources/js/features/item-detail/activity/activity.test.tsx`, `e2e/tests/item-activity.spec.ts`
- Modify: `resources/js/features/item-detail/ItemBody.tsx`, `lang/*.json`

**Interfaces:**
- Consumes: Task 12, 16, 21
- Produces (aus `Activity.tsx` geteilt, 13b; ohne Kommentare, Reaktionen, Composer):
  - `timeline.ts`: `export const GROUP_WINDOW_MS = 5 * 60_000` (Spec 13, Master-Plan: 5 Minuten), `ActivityFilter`, `TimelineEntry`, `buildTimeline(entries, filter, windowMs?)` (Port; Ereignisse derselben Person mit demselben `via` und `reason` innerhalb von 5 Minuten werden eine Zeile).
  - `phrases.tsx`: `phrasesOf(event, ctx)`, `fieldPhrase(field, change, ctx)` mit `FIELD_ORDER` — jede Feldänderung als „Alt → Neu“: Titel, Status, Resolution, Assignee, Priorität, Labels, Start-/Due-Date, Eltern, Typ, Werte (Label der Property, sonst der Schlüssel einer gelöschten), Beschreibung („hat die Beschreibung geändert“), Archiv, Relation („blockiert WEB-12“ bzw. „verborgenes Item“), Gründe als `items.activity.reason.<code>` (`parent_deleted`, `workflow_changed`, `state_removed`, `assign_on_start`; ein unbekannter Code erscheint wörtlich).
  - `when.ts`: `formatWhen(iso, today, timeZone)` mit der Zeitzone der Organisation (13c).
  - `Activity({ detail })`: Filter „Alles“, „Änderungen“ (die Option „Kommentare“ kommt mit Phase 7), alle Seiten laden („Mehr laden“), Ladefehler mit „Erneut versuchen“.

- [ ] **Step 1: Failing Tests schreiben** — `activity.test.tsx`: `buildTimeline` (Port der Fälle: zusammen innerhalb 5 Minuten, getrennt danach, getrennt bei anderer Person, getrennt bei anderem Grund); „says every field change as old and new“ (je Feld ein Datensatz); „names a deleted property by its key“; „shows a hidden related item without key“; „shows why the default bot acted“; „shows the time in the time zone of the organisation“; „loads more and retries after an error“.
  - `e2e/tests/item-activity.spec.ts`: „shows the changes of an item with old and new value“ (Titel und Priorität per Tastatur ändern, Aktivität nennt beide in einer Zeile); „names the reason of a remapped status“ (Workflow des Projekts per API wechseln, Zeile „Workflow gewechselt“).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/item-detail/activity`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test item-activity`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: show the history of a work item with old and new values`.

---

### Task 24: Anlegen-Dialog

**Files:**
- Create: `resources/js/features/create-item/{CreateItemDialog,CreateForm,ItemFields,PropertyInputs}.tsx`, `resources/js/features/create-item/draft.ts`, `resources/js/shell/CreateHost.tsx`, `resources/js/features/create-item/create.test.tsx`, `e2e/tests/create-item.spec.ts`
- Modify: `resources/js/shell/{Shell,bindings}.tsx` (`c`), `resources/js/features/items/MyItemsEmpty.tsx` (zweiter Knopf „Neues Item“ neben dem Link zu den Projekten, öffnet `openCreate()`; ohne Recht zum Anlegen in irgendeinem Projekt gesperrt mit Grund), `vitest.config.ts` (`features/create-item/**`), `lang/*.json`

**Interfaces:**
- Consumes: Task 16–21
- Produces (aus `CreateItemDialog.tsx` geteilt, 13b; ohne Vorlage und Uploads):
  - `CreateItemDialog({ open, defaults, onOpenChange })` (Vertrag mit `CreateHost`), `CreateForm` (Projekt, Typ, Titel zuerst mit Fokus, Beschreibung im Editor `description`, `ItemFields`, `PropertyInputs`), `ItemFields` (Status nur Startstatus und von dort erlaubte, Assignee, Priorität, Labels, Eltern, Daten), `PropertyInputs` (Properties des Typs über `PropertyValueInput`, Pflicht markiert), `draft.ts` (`Draft`, `hasContent`, `park`, `parkedToRestore`: Schließen mit Inhalt fragt nichts, ein Toast bringt den Entwurf zurück, auch per ⌘Z; ein Entwurf bleibt erhalten, wenn ein Katalog beim Neuladen scheitert, 13c).
  - „Weitere anlegen“: Projekt, Typ, Status und Felder bleiben, Titel, Beschreibung und Properties leeren sich, Fokus wieder im Titel. ⌘⏎ legt an, einmal je Druck (kein Doppel). Erfolg: Toast „:key angelegt“ mit „Öffnen“ (Vorschau). Feldfehler (422) am Feld, Fokus auf das erste; ein veralteter Serverfehler verschwindet beim Ändern des Felds (13c); Schließen während des Speicherns parkt keinen Entwurf eines angelegten Items (13c).
  - `shell/CreateHost` (lazy, bleibt gemountet); `c` (`item.create`) öffnet ihn, auf einer Projektseite mit dem Projekt vorbelegt (`useUiStore.openCreate`).

- [ ] **Step 1: Failing Tests schreiben** — `create.test.tsx` (Port der Fälle des Klickdummys): „starts in the title“; „marks a missing required property at its field and keeps the dialog open“ (Flow 3); „creates with mod+enter once and offers to open the item“; „keeps project, type and fields for another item“; „offers only the start state and the states it may reach“; „brings a closed draft back with undo“; „keeps the draft when a catalog fails to reload“; „clears a stale server error when the field changes“; „does not park the draft of an item that was created while closing“; „says why a viewer cannot create items here“.
  - `e2e/tests/create-item.spec.ts` (Projekt mit Agentur-Freigabe und Typ Kundenwunsch per API): „asks for the customer before it creates a wish“ (Flow 3: `c`, Typ Kundenwunsch, Titel, ⌘⏎ → Fehler am Feld Kunde; Kunde wählen, ⌘⏎ → Toast mit `<KENNUNG>-1`, Status Backlog per API); „creates an item of a type with a required property“ (Erfolgskriterium 2.2 in der UI); „creates several items in a row with another one“; „opens the new item in the preview from the toast“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/create-item resources/js/shell`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test create-item`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: port the create dialog with required properties and another one`.

---

### Task 25: Kataloge mit Items in der Oberfläche: Status-Zuordnung, Archiv-Antworten, Epic-Häkchen

**Files:**
- Create: `resources/js/features/settings/catalog/{StateMappingDialog.tsx,mapping.ts,mapping.test.ts,stateMapping.test.tsx}`, `e2e/tests/state-mapping.spec.ts`
- Modify: `resources/js/features/settings/project/Workflow.tsx`, `resources/js/features/settings/org/workflows/WorkflowEditor.tsx`, `resources/js/features/settings/org/types/{Types,TypeDialog}.tsx`, `resources/js/features/settings/org/catalogs/{Resolutions,Labels,RelationTypes}.tsx`, `resources/js/features/settings/org/properties/{Properties,OptionRows}.tsx`, die zugehörigen Tests, `lang/*.json`

**Interfaces:**
- Consumes: Task 13, 14, 16
- Produces:
  - `mapping.ts`: `rowsFor(usage: StateUsage[], from: State[], to: State[]): MappingRow[]` (`MappingRow = { state: State; items: number; target: string | null }`; Vorschlag: gleicher Name, sonst erster Status gleicher Kategorie, sonst keiner), `effectsOf(rows, to): MappingEffect[]` (wie viele Items schließen sich, öffnen sich wieder, verlieren die Resolution), `complete(rows): boolean`.
  - `StateMappingDialog({ title, description, usage, from, to, onConfirm(mapping), onClose, finalFocus })` — **ein** Dialog für „Workflow wechseln“ und „Status entfernen“ (R26): je benutztem Status eine Zeile mit Zahl und Zielauswahl, darunter die Effekte, Bestätigen erst, wenn jede Zeile ein Ziel hat (sonst nennt der Knopf per `disabledReason`, welche fehlt); 422 an `mapping.<id>` bzw. 409 `state_in_use` markiert die Zeile.
  - Projekt → Workflow: die Karte sagt wieder „Status im nächsten Schritt zuordnen“ (A95); Wechsel lädt `useStateUsage({ project })`; ohne Items bleibt es die einfache Bestätigung.
  - Workflow-Editor: Speichern mit entfernten Status lädt `useStateUsage({ workflow })`; hat ein entfernter Status Items, öffnet der Dialog mit den bleibenden und neuen Status als Ziele (lokale IDs), `state_mapping` geht mit.
  - Typen und Resolutions: `outcome: 'archived'` → Toast „Typ archiviert: Items tragen ihn noch.“ bzw. „Resolution archiviert: …“, die Zeile bleibt als archiviert (P28 von Phase 3 eingelöst); Typ-Dialog zeigt 422 `is_epic` am Schalter „Epic“ mit Fokus; Properties: eine ausgelassene benutzte Option kommt archiviert zurück; Labels, Relationstypen, Properties: die Löschantwort zählt (`affected_items`, `affected_relations`) und der Rückgängig-Toast nennt die Zahl („Label gelöscht, bei 3 Items entfernt.“). Die Bestätigung vor dem Löschen nennt die Zahl erst ab Phase 5 (A61).

- [ ] **Step 1: Failing Tests schreiben** — `mapping.test.ts`: Vorschläge, Effekte, `complete`; `stateMapping.test.tsx`: „lists every state in use with its items“; „proposes a state of the same name or category“; „holds the confirmation until every row has a target“; „marks the row of a 422“; Projekt-Workflow: „switches without a dialog when no item uses a state“, „sends the mapping of the dialog“; Workflow-Editor: „asks for a new state when a removed one has items“, „sends local ids as targets“; Typen: „keeps a type in use as archived and says so“, „shows a refused Epic mark at the switch“; Resolutions, Labels, Relationstypen, Properties wie oben.
  - `e2e/tests/state-mapping.spec.ts` (Projekt mit zwei Items in Todo und In Progress, eigener Workflow `E2E … Ziel` per API): „switches the workflow of a project and maps its states“ (Projekteinstellungen → Workflow → Ziel wählen → Dialog mit zwei Zeilen → Ziele per Tastatur → ⌘⏎ → per API tragen die Items die neuen Status, die Aktivität nennt den Wechsel); „asks for a new state when a used one is removed“ (Workflow-Editor, Status mit Item entfernen, Speichern → Dialog → Ziel → gespeichert).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test state-mapping workflows types-properties catalogs project-catalog`.

- [ ] **Step 3: Gates G1 (Texte), G2, G3**

- [ ] **Step 4: Commit** — `feat: map the states of items when a workflow changes and show what catalog deletions do to items`.

---

### Task 26: Doku, `CLAUDE.md`, Rulings, Spec, Abnahme

**Files:**
- Create: `docs/en/concepts/work-items.md`, `docs/de/concepts/work-items.md`
- Modify: `docs/.vitepress/config.ts` („Work items“/„Work Items“), `docs/{en,de}/concepts/{workflows,types-and-properties}.md` (Status-Zuordnung mit Items, Archiv statt Löschen, Epic-Häkchen), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Phase 6: die Palette steht, Phase 6 bringt ihre Suche; Phase 4: `RemapStates` synchron, P2)

**Interfaces:**
- Consumes: alles Vorige
- Produces:
  - `concepts/work-items` (en + de, gleiche Überschriften, `DocsTest`): Felder und Key (Nummern nie wieder vergeben, frühere Kennungen leiten um), Typ und Typwechsel (verlorene Werte, Pflichtwerte), Status und Resolution (Übergänge, Anlegen in einem anderen Status), Eltern und Kinder (zwei Ebenen, Fortschritt), Relationen (über Projekte, „verborgenes Item“, nur „blockiert“ wirkt), Beobachten, Archiv und Löschen (Rückgängig, Kinder ohne Eltern), Mehrfachbearbeitung, gleichzeitige Änderungen (zuletzt gewinnt, Beschreibung mit Konflikt), History; REST-Beispiele: `POST /api/v1/work-items` mit Markdown-Beschreibung, `PATCH` mit `base_description_version` und 409, `POST …/transition` mit 409 `transition_not_allowed`, `POST /api/v1/work-items/bulk` mit `rejected`, `GET …/history`, 301 eines früheren Keys.
  - `CLAUDE.md`: „Stand“ (Phase 4 umgesetzt, als Nächstes Phase 5), Architektur (Items: Tabellen, Sperr-Reihenfolge, `ItemLock`, `ItemInput`/`ItemValues`, Rang `ascii_bin`, Resource-Felder, `include`, Events und History, `RemapStates`, `ListStateUsage`; Rich Text; Frontend: Editor, Felder, Befehle, Palette, Item-Seite, Wirte), Fallstricke (Rang nie mit `localeCompare` und nie mit der Standardkollation; `{key}` statt `{item}` auf Web-Routen; `Route::bind('item')` gilt global; 301 nur für sichtbare Items; Seeder-Events mit `dispatched_at`; Tiptap-Tests nach `preloadEditor()`; der Abdeckungs-Stash scheitert laut). Die Tasks haben ihre Teile schon eingetragen; hier ordnen und prüfen.
  - Rulings `A101` ff. (je mit Grund und „Falls falsch“): P1–P32 dieses Plans, soweit sie über die Phase hinaus gelten; A96 ist präzisiert (Task 1); „Für spätere Phasen vorgemerkt“: Zeile Phase 4 entfernen (erledigt), neu: Phase 5 (`ListWorkItemsArgs` auf Filter, Sicht und Sortierung erweitern, Zählungen „bei N Items“ in den Bestätigungen, Ja/Nein-Filter liest `false` und leer gleich, Item-Listen und Vorschau aus Listen), Phase 6 (Suchtreffer in der Palette, `filter[q]` der Relationen-Suche durch die Suche ersetzen), Phase 7 (Erwähnungen und Verweise in Beschreibungen der Demo-Daten als Knoten, Kommentare in `listActivity`, `attachments` im Detail, `/`-Menü, Hervorhebung), Phase 8 (Beobachter benachrichtigen; die Abmeldung hebt nur eine neue Erwähnung oder Zuweisung auf), Phase 10 (`template_id`, Automatisierungen „Assignee beim Start“ und „Eltern schließen“ an `TransitionWorkItem::move`), Phase 11 (`bot.assigned`, `bot.mentioned`; ein Feed oder Webhook für Katalog-Events filtert `meta.projects`/`meta.types` und die Projektlisten der 409 über `Visibility`). Erledigt und aus den Vormerkungen zu streichen: „Phase 4–7: sessionStorage-Grenze für `__coverage__`“ (Task 1, Step 4) und unter Phase 6 „das Hilfe-Overlay nennt `mod+k`, bevor es die Palette gibt“ (Task 20).
  - Spec „Änderungen vom 2026-10-31 (Phase 4)“ zur Bestätigung: Status-Zuordnung synchron in derselben Transaktion statt als Job (P2, weicht von 4.5 ab); Beschreibung ohne Versionsangabe: zuletzt gewinnt (P3); REST `description` Markdown und `description_json`, Rich-Text-Properties mit `values_markdown` (P3, P9); `blocked`/`blocking` zählen auch Blocker, die der Leser nicht sieht (P19); Bots beobachten nicht (P13); im archivierten Projekt darf man beobachten (P21); ein gelöschtes Item hinterlässt bei seinen Kindern und den Enden seiner Relationen einen Eintrag in der History (P12); Prioritäten heißen in beiden Sprachen Urgent … None (P16, offene Frage bleibt); Zuordnung eines bleibenden Status ist 422 (P17).

- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.

- [ ] **Step 2: Abnahme der Phase**

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build
ddev exec pnpm --dir docs build
```

Expected: alles grün, PHP `Total: 100.0 %`, Frontend zusammengeführt 100 %. Von Hand (Master-Abnahme, Erfolgskriterium 2.2 und 2.3): Mara legt in der UI einen Typ mit Pflicht-Property an und ein Item dieses Typs (ohne Wert: Fehler am Feld); dasselbe per `curl -H "Authorization: Bearer <Token>" -H 'Content-Type: application/json' -X POST https://werkbuch.ddev.site/api/v1/work-items -d '{"project_id":"APP","type_id":"<id>","title":"Test","values":{"customer":"<option>"}}'`; in Agentur-Freigabe wird Todo → Done in der UI nicht angeboten und per `POST …/transition` mit 409 `transition_not_allowed` abgelehnt, Todo → In Progress klappt in beiden; `/items/WEB-47` zeigt die History mit Alt → Neu für jede Feldänderung; nach Umbenennen von WEB führt `/items/WEB-47` auf den neuen Key und `GET /api/v1/work-items/WEB-47` antwortet 301; Lene (Viewer) liest alles und ändert nichts.

- [ ] **Step 3: Commit** — `docs: add the work items page, update CLAUDE.md, the rulings and the spec for phase 4`.

---

## Entscheidungen dieses Phasenplans

- **P1 Sperr-Reihenfolge Organisation → Projekt → Item.** Item-Änderungen nehmen die Organisationszeile geteilt (`CatalogLock::share()`), Katalog-Änderungen, die Items betreffen (Status-Zuordnung, Workflow-Wechsel, Löschen mit Archiv), exklusiv; dann das Projekt (beim Anlegen exklusiv für `next_number`, sonst geteilt) und zuletzt die Items nach ID. Grund: Ein Übergang prüft gegen den Workflow, den eine Katalog-Änderung gerade umschreibt; ohne gemeinsame Sperre landet ein Item auf einem Status eines fremden Workflows oder scheitert mit 500 an einem Fremdschlüssel. Geteilte Sperren lassen Item-Änderungen nebeneinander laufen. Falls falsch (Last bei vielen Katalog-Änderungen): eine Sperrzeile je Workflow statt der Organisation.
- **P2 `RemapStates` läuft synchron in der Transaktion von `AssignWorkflow` bzw. `SaveWorkflow`** (Blöcke zu 500 Items, ein Event je Item), nicht als Job (weicht von Spec 4.5 „läuft als Job“ ab). Grund: Ein Job ließe ein Fenster, in dem Items Status des alten Workflows tragen, während das Projekt den neuen hat; der Klickdummy schreibt ebenfalls sofort um; ein Projekt hat auch im Lastszenario (50.000 Items in 20 Projekten) wenige tausend Items. Falls falsch: Job mit einer Sperrmarke am Projekt, die Item-Schreibzugriffe bis zum Ende mit 409 ablehnt.
- **P3 Beschreibung:** REST liest `description` (Markdown) und `description_json` (Tiptap-JSON) und schreibt eins von beiden; der Konfliktschutz greift, wenn der Client `base_description_version` mitschickt (die UI tut das immer), ohne gilt zuletzt gewinnt; 409 `description_conflict` trägt `current` (die Resource) und nennt im `detail` die Person der letzten Änderung. Im Frontend heißt das Feld `description_json`, `WorkItemPatch.description` bleibt wie im Klickdummy und wird als `description_json` gesendet. Grund: Vertrag „Rich Text“, Spec 4.16; REST-Nutzer ohne Version sollen nicht ausgesperrt sein. Falls falsch: `base_description_version` verpflichtend für jede Änderung der Beschreibung.
- **P4 Rang:** Port von `fractional-indexing` 4.0 in PHP, identisch per Fixture; Spalte `ascii_bin`; neue Items ans Ende ihres Projekts; der Client schickt einen fertigen `rank`, der Server prüft nur die Form. Grund: gleiche Keys in Browser und Server, Spec 13 lässt den Algorithmus offen. Falls falsch: Server berechnet den Rang aus `before`/`after`-IDs.
- **P5 History:** `GET …/history` liefert jedes Event einzeln, ohne Beobachten und ohne reine Rang-Änderungen; das Zusammenfassen derselben Person innerhalb von 5 Minuten (bei gleichem `via` und Grund) macht die Anzeige. Relationsänderungen speichern Typ, Richtung, Beschriftung und die ID des anderen Items und werden beim Lesen je Leser aufgelöst. Grund: REST-Nutzer brauchen jedes Event; Keys ändern sich mit der Kennung. Falls falsch: Zusammenfassen serverseitig mit `?grouped=1`.
- **P6 Events der Phase:** `work_item.created|updated|state_changed|assigned|archived|restored|deleted|relation_added|relation_removed` (mit Webhook, Phase 11) und `work_item.subscribed|unsubscribed` (ohne). `bot.assigned`, `bot.mentioned` kommen mit Phase 11, Benachrichtigungen mit Phase 8, die Automatisierungen eines Zugs („Assignee beim Start“, „Eltern schließen“) mit Phase 10. Grund: keine Zweige ohne Konsumenten. Falls falsch: die Events jetzt schreiben, ohne dass sie jemand liest.
- **P7 Detail in einem Aufruf:** `GET /work-items/{item}?include=children,relations,type,workflow`; `children_progress`, `blocked`, `blocking` und `subscribed` stehen am Item, `getWorkItemMeta` entfällt, `subscriber_ids` auch (`GET …/subscribers` listet sie). Grund: README des Klickdummys „Wo die echte API andockt“; eine Anfrage statt vier. Falls falsch: eigene Detail-Route.
- **P8 Listen-Endpunkt bis Phase 5:** `GET /api/v1/work-items` mit `filter[project]`, `filter[parent]`, `filter[q]` (Key oder Titelteil), `include_archived`, Ordnung nach Rang; `ListWorkItemsArgs` im Frontend nur mit diesen Feldern. Grund: Eltern-Auswahl, Kinder und Relationen-Suche brauchen Listen, die Filter-Engine kommt mit Phase 5. Falls falsch: Phase 5 ändert die Signatur ohnehin.
- **P9 Werte:** eine Zeile je Wert mit einer Spalte je Werttyp (Mehrfachauswahl mehrere Zeilen), `values` nach Schlüssel, Rich-Text-Werte zusätzlich als `values_markdown`; eine Änderung prüft nur die gesendeten Schlüssel, darum bleibt ein Item ohne Wert einer später zur Pflicht gewordenen Property änderbar; der Standardwert einer Property gilt beim Anlegen. Grund: Spec 4.7. Falls falsch: Pflicht bei jeder Änderung prüfen (blockiert Alt-Items).
- **P10 Mehrfachbearbeitung je Item in eigener Transaktion**, höchstens 100 IDs, Ablehnungen als `{id, reason}` mit den `reason`-Codes; die Form des Patches wird vorab einmal geprüft. In der Rechte-Matrix ohne Event, weil eine Ablehnung kein 403 ist. Grund: Spec 4.8 „für jedes Item gelten seine Regeln“. Falls falsch: alles oder nichts.
- **P11 Relationen:** Ziel per ULID oder Key, ein unsichtbares Ziel ist dieselbe 422 wie ein unbekanntes; symmetrische Typen zählen die Gegenrichtung als dasselbe Paar; Entfernen darf, wer ein sichtbares Ende bearbeiten darf; die Beschriftung jeder Seite steht als Schnappschuss im Event. Grund: Spec 4.9, Aufräumliste Task 3 (Entfernen von der eingehenden Seite). Falls falsch: Entfernen nur von der Quelle.
- **P12 Löschen hinterlässt Spuren bei den anderen:** Kinder bekommen `work_item.updated` (`parent_id` → `null`, Grund `parent_deleted`), die Enden der Relationen `work_item.relation_removed`; die Events des gelöschten Items bleiben. `PurgeProject` löscht Items per Kaskade ohne Events (A26). Grund: „History ohne Lücken“ (Anti-Ziele). Falls falsch: Kinder still lösen.
- **P13 Beobachten:** Personen mit Lesezugriff (auch Viewer), keine Bots (403); Ersteller und Assignee automatisch; wer sich abmeldet, bleibt abgemeldet, bis eine neue Zuweisung (ab Phase 7 auch eine Erwähnung) ihn wieder anmeldet; die Events stehen nicht in der History. Grund: Spec 4.10, Klickdummy `addSubscriber`. Falls falsch: Bots beobachten lassen (für Phase 11 egal, `bot.*` hat eigene Events).
- **P14 Palette ohne Suche in Phase 4:** Die Item-Kürzel (`s`, `a`, `p`, `l`, `t`, `d`, ⇧D, ⇧P) öffnen wie im Klickdummy eine Unterliste der Palette; darum kommen Register, Palette, Navigation, „Neues Item“ und Theme schon jetzt, die Suchtreffer mit Phase 6. Grund: Flow 1 und die Kürzel aus 5.3 brauchen sie; doppelte Wege (Feld-Popover jetzt, Palette später) wären Wegwerfarbeit. Falls falsch: Kürzel öffnen bis Phase 6 das Feld der Seite.
- **P15 Editor in Phase 4:** Stufen, StarterKit mit Markdown-Kürzeln, Aufgabenlisten, Tabellen, Links; kein `/`-Menü, keine Hervorhebung, keine Erwähnungen, Verweise und Uploads (Phase 7, Master-Plan). Platzhalter ohne Hinweis auf `/`, `@`, `#`. Grund: Master-Plan Phase 4/7. Falls falsch: `/`-Menü vorziehen (klein, aber ohne Bild-Eintrag).
- **P16 Prioritäten** heißen in beiden Sprachen Urgent, High, Medium, Low, None (Spec 4.8, offene Frage im README des Klickdummys); `PriorityIcon` sagt „Priorität: Urgent“ über Schlüssel. Falls falsch: deutsche Namen in `lang/de.json`, sonst nichts.
- **P17 `state_mapping`/`mapping` bleiben streng:** ein Schlüssel, der kein entfernter bzw. alter Status ist, ist 422; Ziele sind Schlüssel der Eingabe und werden übersetzt. Grund: Vormerkung „prüfen“; ein Tippfehler soll nicht still ignoriert werden. Falls falsch: unbekannte Schlüssel ignorieren wie der Klickdummy.
- **P18 Kataloge gegen Items:** benutzte Typen, Resolutions und Optionen werden archiviert statt gelöscht (`outcome: 'archived'`); Properties, Labels und eigene Relationstypen lassen sich mit Items löschen und nennen die Zahl (`affected_items`, `affected_relations`), ohne Event je Item (wie A77), die History behält die alten Werte; das Epic-Häkchen prüft bestehende Items. Grund: Spec 4.6–4.9, A60. Falls falsch: je Item ein `work_item.updated`.
- **P19 Verborgenes:** Ein Ende, das der Leser nicht sieht, erscheint als `hidden` ohne ID, Key und Titel, in Relationen und History; `blocked`/`blocking` zählen auch solche Blocker (ein Boolean verrät nichts Benanntes). Grund: Spec 4.9, Anti-Ziel Datenlecks; ein blockiertes Item soll den Hinweis behalten. Falls falsch: nur sichtbare Blocker zählen.
- **P20 Key und frühere Keys:** Der Key wird nie gespeichert; `GET`/`HEAD` mit einem früheren Key antworten 301 (REST) bzw. leiten um (`/items/OLD-12`, `no-store`), aber nur bei sichtbaren Items; Schreibzugriffe wirken direkt. Grund: Spec 4.4, Master-Plan; ein 301 auf `PATCH` würde zum `GET`. Falls falsch: 308 auch für Schreibzugriffe.
- **P21 Archiviertes Projekt:** Item-Schreibzugriffe nach der Rechteprüfung 409 `project_archived`; Beobachten bleibt erlaubt. Grund: Spec 4.4 „schreibgeschützt“ betrifft Projektdaten, Beobachten ist persönlich. Falls falsch: auch Beobachten sperren.
- **P22 Was spätere Phasen füllen:** `template_id` ist bis Phase 10 `null`, `attachments` im Detail `[]` bis Phase 7, die Aktivität zeigt bis Phase 7 nur Events. Grund: Vertrag der Resource bleibt stabil. Falls falsch: die Felder erst mit ihrer Phase ausgeben.
- **P23 Demo-Daten:** `ItemsSeeder` und `ActivitySeeder` schreiben direkt (A86), die History-Events aus `seed/activity.ts` mit `dispatched_at` (sie werden nie verteilt); Erwähnungen und Verweise in Beschreibungen bleiben bis Phase 7 Text; Gründe als Codes (`assign_on_start`). Grund: die History von WEB-47 ist Teil des Moodboards. Falls falsch: keine Seed-Events.
- **P24 Belegung der Status über `GET /api/v1/state-usage`** (`project` oder `workflow`, zählt archivierte mit, nur sichtbare Projekte). Grund: Der Zuordnungs-Dialog braucht die Zahlen, bevor er etwas schickt; die Filter-Engine (Phase 5) gibt es noch nicht. Falls falsch: die Zahlen aus der 422/409 des ersten Versuchs lesen.
- **P25 Item-Kürzel im Katalog** unter `item.*` (A7), mit denselben Tasten wie der Klickdummy; `c` ist global. Falls falsch: nichts.
- **P26 Typwechsel in der UI** über `askTypeChange`: der Dialog nennt verlorene Werte und fragt die Pflichtwerte des neuen Typs ab, bevor er sendet. Grund: Spec 4.6. Falls falsch: Server-422 allein.
- **P27 Rich-Text-Grenzen:** höchstens 256 KB JSON und 32 Ebenen, nur bekannte Knoten und Marken (sonst 422), Links nur `http`, `https`, `mailto` (andere verlieren still die Marke), HTML im Markdown bleibt Text. Grund: Spec 4.16 „Nutzer-HTML wird nie ausgegeben“, Schutz der API. Falls falsch: Grenzen in `Schema` anpassen.
- **P28 Nummern bis 4294967295** (unsigned int); `ItemKey::parse` lehnt größere ab. Falls falsch: `bigint`.
- **P29 Zeiten in der Zeitzone der Organisation** in Feldern, Aktivität und Kopf statt fest Berlin (13c). Falls falsch: Zeitzone der Person (ab Phase 8 ohnehin für Erinnerungen).
- **P30 Wer Items übernimmt:** aktive Mitglieder (Personen und Bots) und aktive Personen mit Org-Rolle Admin; der Standard-Bot nur als ausdrückliches Mitglied (`App\Access\Assignable`, gleich `canTakeWork` im Browser; Spec „Änderungen vom 2026-10-29“). Gilt auch für Personen-Properties. Falls falsch: alle mit Lesezugriff.
- **P31 Mehrfachbearbeitung über Workflows hinweg:** Ein `state_id`, den der Workflow eines Items nicht hat, ist für dieses Item `validation_failed`; die UI bietet bei gemischten Workflows nur Status, die alle Ziele kennen. Falls falsch: Zuordnung über die Kategorie.
- **P32 Anlegen in einem anderen Status** schreibt `work_item.created` im Startstatus und danach `work_item.state_changed`, wie ein Zug (Aufräumliste Task 3). Falls falsch: ein Event mit dem Zielstatus.

## Nicht in Phase 4 (vorgemerkt in Task 26)

- Phase 5: Item-Listen, Board, Tabelle, Timeline, Filter-Engine, `ListWorkItemsArgs` mit `view_id`, `filter`, `sort`; die Vorschau aus Listen; Zählungen „bei N Items“ in Bestätigungen (A61); Ja/Nein-Filter liest `false` und leer gleich; ⇧P eine Darstellung zu spät auf Boards (13c).
- Phase 6: Suchtreffer in der Palette, die Relationen-Suche über die Suche statt `filter[q]`, `/` in Listen.
- Phase 7: Kommentare in der Aktivität, Reaktionen, Composer (`m`), Anhänge und Dateiliste, Erwähnungen, Verweise, `/`-Menü, Code-Hervorhebung, Uploads im Editor und im Anlegen-Dialog; Erwähnungen und Verweise der Demo-Beschreibungen als Knoten.
- Phase 8: Benachrichtigungen an Beobachter, Lead und Assignee.
- Phase 10: Vorlage im Anlegen-Dialog, `template_id`, Automatisierungen eines Zugs.
- Phase 11: `bot.assigned`, `bot.mentioned`; Filter der Katalog-Events über `Visibility`.
