# Phase 6: Suche und Suchtreffer in der Befehlspalette – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Omni-Suche bauen: Scout mit Meilisearch für Items (Key, Titel, Klartext der Beschreibung), Projekte, Personen und Bots, indexiert als Event-Konsument in der Queue `search`, gelesen über `GET /api/v1/search` immer mit dem Filter aus `Visibility` und mit Key-Sprung (auch über eine frühere Kennung); dazu die Suchtreffer in der Befehlspalette (nach Art gruppiert, ein Key führt), `/` außerhalb von Listen, sichtbare Einstiege in die Suche, die Relationen-Suche über die Suche, die vollständige Hilfe und die aus dem Katalog erzeugte Tastatur-Doku; außerdem die Überträge aus Phase 5 (Outbox-Wiederholungen, Katalog-Hygiene, kollisionsfreie e2e-Kennungen).

**Architecture:** Die drei Modelle `WorkItem`, `Project`, `User` tragen Scouts `Searchable` nur für ihre Dokumente (`toSearchableArray`, `searchableAs`); Scouts Modell-Beobachter sind aus. Geschrieben wird der Index ausschließlich vom Konsumenten `App\Search\SearchConsumer` (Queue `search`, idempotent über die Outbox) über `App\Search\SearchIndexer`; Neuaufbau und Einstellungen über `app:search-import` und `app:search-sync`. Gelesen wird nur über die Action `App\Actions\Search\QuerySearch`: Meilisearch liefert IDs unter dem Filter `project_id IN Visibility::projectIds(…)`, danach liest die Action die Treffer neu aus der Datenbank durch dieselben Scopes wie jede Liste (`ItemQuery::for`, `Project::visibleTo`), so kann ein veralteter Index nichts verraten. Der Browser spricht nie mit Meilisearch; die Palette fragt `/api/v1/search` 150 ms nach der letzten Taste und zeigt Befehle, dann Treffer.

**Tech Stack:** wie Phase 5, dazu `laravel/scout` und `meilisearch/meilisearch-php` (Task 3), Meilisearch v1.56.0 als Dienst in DDEV (steht schon) und in der CI. Versionen unter „Paketversionen“.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterium 2.6 und 6, 2 Anti-Ziel Datenlecks, 3 Entscheidungen „Suche“, 4.4 Archivieren, 4.17 komplett, 5.1 „Tastatur zuerst“, 5.3 Kürzel `⌘K`, `/`, `?`, 7.2 Outbox und Queues, 7.5 Tests auf Datenlecks, 8.2 `MEILISEARCH_KEY`, 8.3 DDEV, 10 Doku „Tastatur“), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus 3 „Suche filtert zur Abfragezeit“, Verträge, Phase 6), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A7, A114, A139, A159–A198; „Für spätere Phasen vorgemerkt“, Zeile Phase 6 → Tasks 2, 4, 5, 10, 12, 13, 14, 15), Ledger `.superpowers/sdd/2026-10-30-werkbuch-app/progress.md` (Übertrag „createE2eProject kollisionsfrei“ → Task 1), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{api/search.ts,hooks/search.ts,features/palette/**,app/{bindings,Sidebar,Shell,PageStates}.tsx,lib/shortcuts/**}`, Aufräumliste `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (13c: „search stale ≤10 s“ → Task 9; Palette-Befehle `projects.create`/`views.create` → Task 12; „stale comments … held g cancels g i“ → Task 14).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 6 entscheidend:

- Branch `feat/phase-06-search`. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Neue Pakete nur in Task 3 (`laravel/scout`, `meilisearch/meilisearch-php`); keine neuen npm-Pakete; `e2e/pnpm-lock.yaml` bleibt unverändert.
- **Der Browser spricht nie mit Meilisearch** (Spec 4.17). Kein Meilisearch-Schlüssel, kein Host und kein Index-Name verlässt den Server.
- **Sichtbarkeit zur Abfragezeit, nie im Index** (Master Review Focus 3, P2): Jede Suche filtert in Meilisearch mit `project_id IN Visibility::projectIds($user)` (Projekte mit `id IN …`) **und** liest die Treffer danach neu aus der Datenbank durch `App\Views\ItemQuery::for()` bzw. `Project::visibleTo()`. Ein Dokument, das noch im Index steht (Item gelöscht, Projekt in Löschung, Zugriff entzogen), erscheint nie. Kein Name, kein Key und keine Zahl eines unsichtbaren Items verlässt den Server, auch nicht über den Key-Sprung (A139).
- **Den Index schreibt nur der Konsument** (`App\Search\SearchConsumer` über `SearchIndexer`) und der Neuaufbau (`app:search-import`, Seeder). Scouts Modell-Beobachter sind für alle drei Modelle aus (`disableSearchSyncing()`), `scout.queue` ist `false` (die Arbeit läuft schon in der Queue `search`). `App\Search` schreibt weder Modelle noch Events noch per `DB::table` (`ArchTest`).
- Fachlogik nur in `app/Actions` und `app/Domain`; `app/Search` übersetzt Modelle in Dokumente und spricht mit der Engine. **Jede Action steht genau einmal in der Rechte-Matrix** (`tests/Feature/Access/matrix.php`), **jede Route genau einmal in der Routen-Matrix** (`tests/Feature/Api/routes.php`), beides im Commit, der sie anlegt.
- Meilisearch ist in `tests/Integration` Pflicht wie MariaDB (DDEV-Dienst `meilisearch`, in der CI ein Service im Job `tests` und im Job `e2e`); Feature-Tests laufen gegen die Fake-Engine `Tests\Support\ArraySearchEngine` (P10). Index-Präfix in Tests `testing_` (`phpunit.xml`, `force`), damit `ddev artisan test` den Dev-Index nicht leert.
- Der CI-Pflicht-Job heißt `tests` und bleibt so; Task 3 gibt ihm nur einen Meilisearch-Service.
- Die UI liest nur über `/api/v1`. `resources/js/api/search.ts` exportiert `search(q, options?)` wie der Klickdummy (`search(q)`), Abweichungen nach P5. Komponenten rufen nur Hooks.
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`; Schlüssel ohne Ziffern und Bindestrich, Platzhalter `:name`. Zahlen über `tn()` und `intlLocale()`.
- Kürzel nur über den Katalog (`resources/js/lib/shortcuts/catalog.ts`, A7); die Tastatur-Doku entsteht aus ihm (Task 15), Handarbeit an `docs/*/keyboard.md` scheitert am Test.
- Abdeckung 100 % Zeilen PHP und Frontend (Vitest + Playwright zusammengeführt) **am Ende jeder Task**; keine unerreichbaren Zweige (Kommentare im Index Phase 7, Wiki-Seiten Phase 9, „Vorlage anwenden …“ Phase 10, MCP-Tool `search` Phase 13 bleiben weg).
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert (ein Dokument, das nach dem Löschen noch im Index steht; ein Konto, das seine Mitgliedschaft verlor; ein Key mit früherer Kennung; ein Key eines unsichtbaren Items; ein Projekt, dessen `PurgeProject` vor dem Konsumenten lief).
- e2e: Daten einer Spec leben in eigenen Projekten `E2E <variant> <runId>` (per API, `createE2eProject`), nie in WEB, APP, OPS; Suchtreffer einer Spec tragen ein eigenes Wort je Lauf und Variante (`searchToken()`, Task 8), weil alle Varianten einen Index teilen; vor dem Suchen `waitForSearch()` (der Index folgt asynchron); kein `networkidle`; Tastaturwege nur über `tabTo`/`arrowTo`/`pressMod`.
- Demo- und Testdaten nur fiktiv (Feldwerk, `prototypes/clickdummy/src/api/seed/`, `@example.com`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Datenleck über einen veralteten Index:** Ein Item, das gelöscht ist, dessen Projekt in Löschung ist oder dessen Projekt der Leser inzwischen nicht mehr sieht (aus dem privaten Projekt entfernt, Projekt privat gestellt, Konto deaktiviert), steht noch im Index, weil der Konsument erst später läuft; die Suche zeigt es trotzdem nicht. → Task 6 („shows no item the index still holds after it was deleted“, „…of a project being deleted“, „…of a project the reader was removed from“, „finds nothing for a deactivated account“).
- **Key-Sprung als Orakel:** `OPS-12` eines Items, das der Leser nicht sieht, antwortet genau wie `ZZZ-1` (kein `key_match`, keine Umleitung, kein Titel); eine frühere Kennung springt nur für Sichtbares. → Task 6 („answers the key of an item the reader may not see like an unknown key“, „jumps over a former identifier only to items the reader sees“), Task 11 (e2e mit Ida).
- **Meilisearch fällt aus oder hinkt hinterher:** Ohne Antwort von Meilisearch sagt die Suche 503 `search_unavailable` statt 500; die Palette zeigt den Fehler mit „Erneut versuchen“, ein getippter Key springt trotzdem; der Konsument wiederholt mit eigenem Abstand und meldet am Ende, welches Event verloren ging; `app:search-import` repariert. → Task 2 („reports which consumer gave up on which event“), Task 5 („retries with its own tries and backoff“), Task 6 („answers 503 search_unavailable when the engine fails“), Task 10 („shows the error with Try again and still jumps to a typed key“).
- **Kennungswechsel und Löschen:** Nach `WEB` → `WWW` findet die Suche „WWW-47“ als Key-Sprung und im Index, „WEB-47“ springt weiter; nach dem Löschen eines Projekts verschwinden Projekt und Items aus dem Index, auch wenn `PurgeProject` (Queue `bulk`) vor dem Konsumenten (Queue `search`) lief. → Task 5 („updates the keys of every item when the identifier of the project changes“, „removes a deleted project and its items, also after the purge ran“), Task 11 (e2e Key-Sprung über die frühere Kennung).
- **Tippen schneller als die Antwort:** Eine späte Antwort auf „kon“ überschreibt die Treffer zu „kontakt“ nicht; Enter auf einen getippten Key springt, bevor die Suche antwortet; Enter während „Suche läuft …“ führt aus, was die Liste gerade zeigt. → Task 10 („keeps the hits of the newer query when an older answer arrives late“, „jumps to a typed key with Enter before the search answers“).

## Gates

Am Ende jeder Task laufen die Gates, die die Task nennt; alle Ergebnisse grün.

- **G1 (PHP):** `ddev artisan test --coverage --min=100` → `Total: 100.0 %` (enthält `tests/Integration` und braucht den laufenden DDEV-Dienst `meilisearch`, `ddev describe`); `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Gezielt `ddev artisan test --testsuite=Integration --filter=<Name>` in jeder Task mit Meilisearch-, Race- oder Lasttest.
- **G2 (Frontend):** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt.
- **G3 (e2e, zusammengeführt):** gezielt während der Task `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <spec>` (gegen den normalen Build, `ddev exec pnpm build`); **einmal am Ende der Task** der volle Lauf `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle vier Playwright-Projekte grün, der Global-Teardown (`coverage:merge`) meldet 100 % Zeilen über `resources/js/**`. Vorher `ddev exec pnpm dev` beenden; während des Laufs keine anderen DDEV-Projekte starten oder stoppen.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/` oder `resources/js/shell/` anlegt oder ändert, nennt G3 und bringt Playwright-Specs (Abläufe, nur Tastatur) und Vitest-Tests (Lade-, Fehler- und Randzustände mit `mockApi`) mit, die ihre neuen Zeilen decken.

---

## Index (Meilisearch)

Keine neue Migration: der Index lebt nur in Meilisearch. `searchableAs()` ist der Name ohne Präfix, Scout setzt `scout.prefix` davor (`SCOUT_PREFIX`, in Tests `testing_`).

| Index (`searchableAs`) | Modell | Dokument (`toSearchableArray`) | `searchableAttributes` (Reihenfolge = Gewicht) | `filterableAttributes` | weitere Einstellungen |
|---|---|---|---|---|---|
| `work_items` | `WorkItem` | `id`, `project_id`, `key` (`WEB-47`, aktuelle Kennung), `number` (int), `title`, `description` (`description_text ?? ''`), `type_id`, `state_category`, `assignee_id` (`?string`), `label_ids` (Liste, Katalog-Reihenfolge), `archived` (bool), `updated_at` (Unix-Sekunden) | `key`, `title`, `description` | `project_id`, `archived`, `type_id`, `state_category`, `assignee_id`, `label_ids` | `rankingRules`: `words`, `typo`, `proximity`, `attribute`, `sort`, `exactness`, `updated_at:desc`; `typoTolerance.disableOnAttributes`: `key` |
| `projects` | `Project` | `id`, `identifier`, `former_identifiers` (Liste aus `project_identifiers`), `name`, `description` (`?? ''`), `archived` (bool) | `identifier`, `former_identifiers`, `name`, `description` | `id`, `archived` | `typoTolerance.disableOnAttributes`: `identifier`, `former_identifiers` |
| `users` | `User` | `id`, `name`, `handle`, `type` (`person`/`bot`), `disabled` (bool) | `name`, `handle` | `disabled`, `type` | `typoTolerance.disableOnAttributes`: `handle` |

`shouldBeSearchable()`: `Project` ohne `deleting_at`; `WorkItem` und `User` immer (Archiv und Deaktivierung sind Felder). `makeAllSearchableUsing()` lädt mit: `WorkItem` → `project:id,identifier`, `labels:labels.id`, `state:id,category`; `Project` → `formerIdentifiers` (die Beziehung zu `project_identifiers`, Name in Task 3 nach dem Modell prüfen). Kommentare (Spec 4.17) kommen mit Phase 7 in `description` hinzu, Wiki-Seiten mit Phase 9 als eigener Index.

## Konsument (`SearchConsumer`, Queue `search`)

| Event (`EventType`) | Wirkung |
|---|---|
| `work_item.created`, `.updated`, `.state_changed`, `.assigned`, `.archived`, `.restored` | `upsertItem(subject_id)` (frisch aus der DB; fehlt das Item → `removeItem`) |
| `work_item.deleted` | `removeItem(subject_id)` |
| `project.created`, `.archived`, `.restored` | `upsertProject(subject_id)` |
| `project.updated` | `upsertProject`; mit `changes.identifier` zusätzlich `ReindexWorkItems::dispatch([$projectId])->afterCommit()` |
| `project.deleted` | `removeProject(subject_id)`: das Projekt-Dokument und per Filter alle Item-Dokumente mit `project_id` (`RemovesWhere`), auch wenn die Zeilen schon weg sind |
| `user.created`, `.updated`, `.role_changed`, `.deactivated`, `.reactivated`, `bot.created` | `upsertUser(subject_id)` (`bot.created` der Migration `…_000500` eingeschlossen) |
| `workflow.updated` | `ReindexWorkItems::dispatch(<IDs der Projekte mit diesem Workflow>)->afterCommit()` (die Kategorie eines Status kann sich ohne Item-Events ändern) |
| `label.deleted` | `ReindexWorkItems::dispatch(null)->afterCommit()` (alle Items; die Zuordnung ging per Kaskade ohne Item-Events) |
| alle anderen (Relationen, Beobachten, Favoriten, Tokens, Mitglieder, Kataloge, Views, Passwort, zweiter Faktor …) | nichts (P21) |

Mitgliedschaften und Sichtbarkeit lösen nichts aus: die Suche filtert zur Abfragezeit (P2). `ReindexWorkItems` (Queue `search`) liest in Blöcken per `chunkById(500)` und ruft `searchable()`; er ist idempotent und darf doppelt laufen.

## REST

| Route | Action | Antwort |
|---|---|---|
| `GET /api/v1/search` | `QuerySearch` | `{data: {items: WorkItemResource[] (schlank), projects: ProjectResource[], people: UserResource[], views: ViewResource[], key_match: string \| null}}` |

Query: `q` (Pflicht, `Str::trim`, 1–255 Zeichen; `field.q.required` / `field.q.max` an `q`), `types` (durch Komma oder `types[]=`; Teilmenge von `items`, `projects`, `people`, `views`; Standard alle; sonst `field.types.unknown` mit `:name`, `:allowed` an `types`), `limit` (ganze Zahl 1–`QuerySearch::MAX_LIMIT` 50, Standard `QuerySearch::DEFAULT_LIMIT` 20, je Art; sonst `field.limit.invalid`), `include_archived` (Werte von Laravels `boolean`, sonst `field.include_archived.invalid`); alle Feldfehler in einer 422; andere Schlüssel werden übergangen (wie `GET /work-items`). Nicht angefragte Arten sind leere Listen. Ein Token mit `read` darf suchen. Fällt die Engine aus: 503 `search_unavailable` (Problem Details).

---

## Dateistruktur nach Phase 6

| Ort | Inhalt |
|---|---|
| `config/scout.php` | Scout-Konfiguration mit Index-Einstellungen der Tabelle „Index“ |
| `app/Search/` | `MeilisearchEngine` (Scouts Engine mit `RemovesWhere`), `RemovesWhere`, `SearchIndexer`, `SearchConsumer`, `SearchResults` |
| `app/Actions/Search/QuerySearch.php` | die eine Suche |
| `app/Jobs/ReindexWorkItems.php` | Item-Dokumente blockweise neu |
| `app/Events/{RetriesConsumption,ConsumerGaveUp}.php` | Wiederholungen je Konsument, Meldung am Ende |
| `app/Console/Commands/{SearchSyncCommand,SearchImportCommand}.php` | `app:search-sync`, `app:search-import` |
| `app/Http/Controllers/Api/SearchController.php`, `app/Http/Resources/SearchResultsResource.php` | REST |
| `tests/Support/{ArraySearchEngine,Meili}.php` | Fake-Engine, Helfer für echte Meilisearch |
| `resources/js/api/search.ts`, `resources/js/hooks/search.ts` | Datenschicht |
| `resources/js/features/palette/{model.ts,EntryRow.tsx,CommandPalette.tsx}` | Treffer in der Palette |
| `resources/js/shell/{SearchButton.tsx,Sidebar.tsx,MobileBar.tsx,bindings.tsx}` | Einstiege in die Suche |
| `resources/js/lib/shortcuts/widgets.ts` | Tasten der Widgets für die Doku |
| `scripts/shortcuts-doc.mjs` (+ Test), `docs/{en,de}/keyboard.md` (erzeugt), `docs/{en,de}/search.md` | Doku |

## Paketversionen

Geprüft am 2026-11-02 mit `ddev composer show -a` (Packagist).

| Paket | Version | Task | Hinweis |
|---|---|---|---|
| `laravel/scout` | `^11.9` (v11.9.0) | 3 | `illuminate/* ^13.0` erlaubt, PHP `^8.0`; `meilisearch/meilisearch-php ^1.0` als Vorschlag |
| `meilisearch/meilisearch-php` | `^1.17` (v1.17.0) | 3 | 2.0 ist noch Beta (wie A1); braucht `php-http/discovery ^1.7` (Plugin in `composer.json` schon erlaubt) und `psr/http-client` |
| HTTP-Client | – | 3 | `guzzlehttp/guzzle` 7.16.1 und `guzzlehttp/psr7` 2.13.2 sind schon installiert (PSR-18-Client und PSR-17-Fabriken über `GuzzleHttp\Psr7\HttpFactory`, die `php-http/discovery` findet); **kein** `http-interop/http-factory-guzzle`. Task 3 belegt das mit dem Integrationstest gegen Meilisearch. |
| Meilisearch (Dienst) | `getmeili/meilisearch:v1.56.0@sha256:1f578fa865f8251894b3bf38d6668d6209a3f451f8f65ab953e129d4c1db5ef4` | 3, 8 | dieselbe Digest wie `.ddev/docker-compose.meilisearch.yaml`, in beiden CI-Jobs |

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 6 | Ziel | Task |
|---|---|---|
| `api/search.ts` (Bedeutung: alle Wörter, Titel vor Text, Key führt, nur sichtbare Projekte, ohne Archiv) | `App\Actions\Search\QuerySearch` + Meilisearch-Einstellungen | 3–7 |
| `hooks/search.ts` | `resources/js/hooks/search.ts` | 9 |
| `features/palette/{model.ts,EntryRow.tsx,CommandPalette.tsx}` (Treffer, Sprung, Suchzustände) | `resources/js/features/palette/` | 10 |
| `app/bindings.tsx` (`shell.search`, `shell.help`, `shell.sidebar` als Befehle), `app/Sidebar.tsx` (`SearchButton`, Rail), `app/Shell.tsx` (Suchen in der mobilen Leiste), `app/PageStates.tsx` („Suchen“ auf der 404-Seite), `features/{projects/ProjectsScreen,views-overview/ViewsScreen}.tsx` (`projects.create`, `views.create`) | `resources/js/shell/`, `features/{projects,views}/` | 12 |

Nicht in Phase 6: Seiten-Treffer (Phase 9), „Vorlage anwenden …“ (Phase 10, P17), Kommentare im Index (Phase 7), Meilisearch-Status auf der System-Seite (Phase 8), MCP-Tool `search` (Phase 13).

## Abdeckung über die Tasks

- **PHP:** G1 am Ende jeder Task. `App\Search\MeilisearchEngine` und die echten Einstellungen deckt nur `tests/Integration` (Meilisearch Pflicht, auch in der CI). Jede Task, die eine Action oder Route anlegt, ergänzt im selben Commit ihre Zeilen in `matrix.php` und `routes.php`.
- **Frontend, Vitest:** G2 ab Task 9. Bestehende Schwellen decken `api/`, `hooks/`, `lib/`, `features/palette/`, `features/item-detail/`, `features/projects/`, `features/views/`, `shell/sidebar/`; keine neue Schwelle nötig. `shell/SearchButton.tsx` liegt unter `shell/` (keine Schwelle, K22): Playwright deckt ihn.
- **Frontend, zusammengeführt:** G3 in den Tasks 8, 10–13. Neue Spec `e2e/tests/search.spec.ts` (8, 11, 12), dazu Ergänzungen in `shell.spec.ts` (12), `item-sections.spec.ts` (13), `palette.spec.ts` (10), `e2e-helpers.spec.ts` (1).

---

### Task 1: e2e: kollisionsfreie Projekt-Kennungen

**Modell:** sonnet (mechanisch, Code vollständig)

**Files:**
- Modify: `e2e/helpers.ts` (`createE2eProject`, neu `e2eIdentifier`)
- Create: `e2e/tests/e2e-helpers.spec.ts`

**Interfaces:**
- Consumes: `runId()`, `variant()`, `VARIANT_CODE`, `api()`, `ensureCsrfCookie()`, `removeE2eProject()`
- Produces: `export function e2eIdentifier(name: string, attempt: number): string` (Versuch 0 = die bisherige Kennung, damit Läufe stabil bleiben); `createE2eProject` versucht bis `MAX_IDENTIFIER_ATTEMPTS` 10 Kennungen und nimmt die nächste, solange die Antwort 422 mit einem Fehler an `identifier` ist (P20). Die Kennung bleibt 10 Zeichen (`E` + 5 + 1 + 3), vorn ein Buchstabe.

- [ ] **Step 1: Failing Test schreiben** — `e2e/tests/e2e-helpers.spec.ts`:

```ts
import { expect, test } from '../fixtures';
import { api, createE2eProject, e2eIdentifier, removeE2eProject, runId, variant } from '../helpers';

// The helpers of the specs themselves: an identifier that is taken already (a hash collision of two names in one run
// and variant) does not stop createE2eProject.

test('creates a project although the identifier of its name is taken', async ({ page }) => {
  await page.goto('/my-items');
  const name = `E2E helpers ${variant()} ${runId()}`;
  const taken = e2eIdentifier(name, 0);
  const blocker = await api(page, 'POST', '/api/v1/projects', { name: `E2E blocker ${variant()} ${runId()}`, identifier: taken });
  expect(blocker.status(), await blocker.text()).toBe(201);
  try {
    const project = await createE2eProject(page, name);
    expect(project.identifier).toBe(e2eIdentifier(name, 1));
    expect(project.identifier).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
    await removeE2eProject(page, project.identifier);
  } finally {
    await removeE2eProject(page, taken);
  }
});
```

- [ ] **Step 2: Rot belegen** — `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test e2e-helpers --project=desktop-light` → FAIL (`e2eIdentifier` fehlt; mit einem Stub, der die alte Formel liefert: `createE2eProject` scheitert mit 422 „This identifier is already taken.“).

- [ ] **Step 3: Implementieren** in `e2e/helpers.ts`:

```ts
/** How many identifiers createE2eProject tries for one name before it gives up. */
const MAX_IDENTIFIER_ATTEMPTS = 10;

/**
 * The identifier of the `attempt`-th try for a project name: `E<run><variant>` and three Base36 characters of a hash of
 * the name (and the attempt from the second try on). Ten characters at most, a letter first.
 */
export function e2eIdentifier(name: string, attempt: number): string {
  const hash = createHash('sha1').update(attempt === 0 ? name : `${name}#${attempt}`).digest('hex').slice(0, 8);
  return `E${runId()}${VARIANT_CODE[variant()]}${parseInt(hash, 16).toString(36).toUpperCase().slice(-3).padStart(3, '0')}`;
}
```

`createE2eProject` baut den Body wie bisher und schickt ihn in einer Schleife `for (let attempt = 0; attempt < MAX_IDENTIFIER_ATTEMPTS; attempt++)` mit `identifier: e2eIdentifier(name, attempt)`; 201 → zurückgeben; 422 und `(await response.json()).errors?.identifier` gesetzt → nächster Versuch; jede andere Antwort → `expect(response.status(), await response.text()).toBe(201)`. Nach dem letzten Versuch `throw new Error(\`createE2eProject: no free identifier for "${name}" after ${MAX_IDENTIFIER_ATTEMPTS} tries\`)`. Den Doc-Kommentar von `createE2eProject` anpassen („tries the next identifier while the one before is taken: three characters of a hash collide now and then within a run and variant“).

- [ ] **Step 4: Grün** — dieselbe Zeile → PASS; dann `pnpm --dir e2e typecheck`.

- [ ] **Step 5: Gates** — G3 gezielt: `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test e2e-helpers projects table`.

- [ ] **Step 6: Commit** — `test: try the next identifier when an e2e project collides`.

---

### Task 2: Outbox: Wiederholungen je Konsument und Meldung am Ende

**Modell:** sonnet (mechanisch, Code vollständig)

**Files:**
- Create: `app/Events/RetriesConsumption.php`, `app/Events/ConsumerGaveUp.php`, `tests/Support/PatientConsumer.php`
- Modify: `app/Jobs/ConsumeEvent.php`, `app/Events/EventConsumer.php` (Kommentar: `RetriesConsumption`, `ConsumerGaveUp`), `CLAUDE.md` (Events und Outbox)
- Test: `tests/Feature/Events/ConsumeEventTest.php`

**Interfaces:**
- Consumes: `Outbox`, `EventConsumer`
- Produces:
  - `interface RetriesConsumption { public function tries(): int; /** @return list<int> seconds */ public function backoff(): array; }` — ein Konsument, der es implementiert, bestimmt Versuche und Abstand seiner `ConsumeEvent`-Jobs.
  - `ConsumeEvent`: Konstanten `TRIES = 5`, `BACKOFF = [10, 60, 300]`; Methoden `tries(): int` und `backoff(): array` (aus dem Konsumenten, sonst die Konstanten; die Eigenschaften `$tries`/`$backoff` entfallen, damit Laravel die Methoden liest); `failed(?Throwable $exception): void` ruft `report(new ConsumerGaveUp($this->eventId, $this->consumer, $exception))`.
  - `final class ConsumerGaveUp extends RuntimeException { __construct(public readonly string $eventId, public readonly string $consumer, ?Throwable $previous) }` mit der Meldung `"Consumer {$consumer} gave up on event {$eventId} after its last try; it waits in failed_jobs for queue:retry."`.

- [ ] **Step 1: Failing Tests schreiben** — `ConsumeEventTest`:
  - „puts the tries and the backoff of the consumer into the payload“: `config(['queue.default' => 'database'])`, `consumers(PatientConsumer::class)` (`tests/Support/PatientConsumer.php`: `RetriesConsumption` mit `tries()` 8, `backoff()` `[10, 60, 300, 900, 3600]`, Queue `search`, `consume` leer), ein Event per `EventRecorder` in einer Transaktion, `app(Outbox::class)->dispatch($event->id)`; die Zeile in `jobs` mit `queue = 'search'` trägt im JSON-`payload` `maxTries` 8 und `backoff` `'10,60,300,900,3600'`.
  - „keeps five tries for a consumer without its own“: dasselbe mit `RecordingConsumer` → `maxTries` 5, `backoff` `'10,60,300'`.
  - „reports which consumer gave up on which event“: `Exceptions::fake()`; `(new ConsumeEvent('01jbz…', RecordingConsumer::class))->failed(new RuntimeException('down'))` → `Exceptions::assertReported(fn (ConsumerGaveUp $e) => $e->eventId === '01jbz…' && $e->consumer === RecordingConsumer::class && $e->getPrevious()?->getMessage() === 'down')`.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ConsumeEventTest|OutboxTest'`.

- [ ] **Step 3: `CLAUDE.md`** — unter „Events und Outbox“: „`ConsumeEvent` liest Versuche und Abstand aus dem Konsumenten (`App\Events\RetriesConsumption`, sonst 5 Versuche, 10/60/300 s); nach dem letzten meldet `failed()` ein `ConsumerGaveUp` mit Event und Konsument.“

- [ ] **Step 4: Gates G1**

- [ ] **Step 5: Commit** — `feat: let consumers choose their retries and report the event a consumer gave up on`.

---

### Task 3: Scout und Meilisearch: Pakete, Dokumente, Engine, Testumgebung

**Modell:** opus

**Files:**
- Modify: `composer.json`, `composer.lock`, `app/Models/{WorkItem,Project,User}.php` (`Searchable`), `app/Providers/AppServiceProvider.php` (Engine, `disableSearchSyncing`), `phpunit.xml` (`SCOUT_PREFIX`), `.env.example` (`SCOUT_PREFIX=` leer, Kommentar), `.github/workflows/tests.yml` (Job `tests`: Service `meilisearch`, Warten auf `/health`, Env), `tests/Pest.php` (`searchEngine()`), `tests/Unit/ArchTest.php` (`App\Search` schreibt nichts), `CLAUDE.md` (Tech Stack, Fallstricke)
- Create: `config/scout.php`, `app/Search/{MeilisearchEngine,RemovesWhere}.php`, `tests/Support/{ArraySearchEngine,Meili}.php`, `tests/Feature/Search/SearchDocumentsTest.php`, `tests/Integration/MeilisearchEngineTest.php`

**Interfaces:**
- Consumes: `WorkItem` (`key`, `description_text`, `labels`, `state`), `Project` (frühere Kennungen), `User`
- Produces:
  - `config/scout.php` aus `ddev artisan vendor:publish --tag=scout-config`, angepasst: `driver` `env('SCOUT_DRIVER', 'meilisearch')`, `prefix` `env('SCOUT_PREFIX', '')`, `queue` `false`, `after_commit` `false`, `soft_delete` `false`, `identify` `false`, `chunk` `searchable`/`unsearchable` 500, `meilisearch.host`/`key` aus `MEILISEARCH_HOST`/`MEILISEARCH_KEY`, `meilisearch.index-settings` nach der Tabelle „Index“ (Schlüssel `WorkItem::class`, `Project::class`, `User::class`).
  - `WorkItem`, `Project`, `User` mit `use Searchable;`, `searchableAs()` (`work_items`, `projects`, `users`), `toSearchableArray()` nach der Tabelle „Index“ (Werte genau so typisiert: `archived`/`disabled` `bool`, `number`/`updated_at` `int`, `label_ids` `list<string>`), `shouldBeSearchable()` (nur `Project`: `deleting_at === null`), `makeAllSearchableUsing(Builder $query): Builder` (Eager Loads der Tabelle).
  - `AppServiceProvider::boot()`: `WorkItem::disableSearchSyncing(); Project::disableSearchSyncing(); User::disableSearchSyncing();` (P1) und `resolve(EngineManager::class)->extend('meilisearch', fn (Application $app) => new MeilisearchEngine($app->make(\Meilisearch\Client::class), (bool) config('scout.soft_delete')))`.
  - `interface RemovesWhere { /** Removes every document of the model's index whose `$field` equals `$value`. */ public function removeWhere(Model $model, string $field, string $value): void; }`
  - `final class MeilisearchEngine extends \Laravel\Scout\Engines\MeilisearchEngine implements RemovesWhere` — `removeWhere` ruft `$this->meilisearch->index($model->indexableAs())->deleteDocuments(['filter' => sprintf('%s = "%s"', $field, addcslashes($value, '"\\'))])`.
  - `tests/Support/ArraySearchEngine` (`extends Laravel\Scout\Engines\Engine implements RemovesWhere, Laravel\Scout\Contracts\UpdatesIndexSettings`): hält Dokumente je Index im Speicher (`documents(string $index): array<string, array<string, mixed>>`), `update`/`delete`/`flush`/`removeWhere` wirken darauf, `search`/`paginate`/`mapIds`/`map`/`lazyMap`/`getTotalCount` wie Scouts `CollectionEngine`, aber über die Dokumente: ein Treffer enthält jedes Wort der Anfrage (klein, Teilwort) in einem der `searchableAttributes` des Index (aus `config('scout.meilisearch.index-settings')`), `wheres` vergleichen gleich (bool wie gespeichert), `whereIns` per `in_array(…, true)`; Reihenfolge = Einfügereihenfolge; `limit` aus dem Builder; `failWith(?Throwable $error)` lässt jede Suche und jedes Schreiben werfen; `updatedSettings(string $index): ?array`; `writes(): int` (Zahl der schreibenden Aufrufe `update`/`delete`/`flush`/`removeWhere`); `createIndex`/`deleteIndex` als No-op; `$builder->callback` und `$builder->options` werden übergangen (sie gelten Meilisearch).
  - `tests/Pest.php`: `function searchEngine(): ArraySearchEngine` (neue Instanz, `app(EngineManager::class)->extend('array', fn () => $engine)`, `config(['scout.driver' => 'array'])`, `app(EngineManager::class)->forgetDrivers()`; gibt sie zurück).
  - `tests/Support/Meili` (für `tests/Integration`): `static use(): \Meilisearch\Client` (setzt `scout.driver` `meilisearch`, vergisst die Treiber, löscht die Indizes `testing_work_items`, `testing_projects`, `testing_users`, wartet), `static settle(): void` (wartet, bis keine Aufgabe mehr `enqueued`/`processing` ist, höchstens 10 s, sonst `RuntimeException` mit den offenen Aufgaben), `static ids(string $index, string $q, ?string $filter = null): list<string>`.
  - CI (`tests.yml`, Job `tests`): Service `meilisearch` mit der Digest aus „Paketversionen“, `MEILI_MASTER_KEY: ci-werkbuch-master-key`, `MEILI_NO_ANALYTICS: 'true'`, Port `7700:7700`; Job-Env `MEILISEARCH_HOST: http://127.0.0.1:7700`, `MEILISEARCH_KEY: ci-werkbuch-master-key` (echte Env-Variablen schlagen `.env`); Step „Meilisearch“ vor Pest: `curl -fsS --retry 30 --retry-delay 1 --retry-all-errors http://127.0.0.1:7700/health`. Job-ID und Name `tests` bleiben.
  - `phpunit.xml`: `<env name="SCOUT_PREFIX" value="testing_" force="true"/>`; `SCOUT_DRIVER` bleibt `null`.

- [ ] **Step 1: Pakete** — `ddev composer require laravel/scout:^11.9 meilisearch/meilisearch-php:^1.17`; `ddev artisan vendor:publish --tag=scout-config`. Prüfen, dass `Laravel\Scout\Contracts\UpdatesIndexSettings` und `Meilisearch\Exceptions\{ApiException,CommunicationException}` in `vendor/` stehen (sonst Plan-Abweichung melden).

- [ ] **Step 2: Failing Tests schreiben**
  - `SearchDocumentsTest` (mit `searchEngine()`): „builds the document of an item“ (`WorkItem::factory()` in WEB mit zwei Labels, Assignee, Beschreibung → `toSearchableArray()` gleich `['id' => …, 'project_id' => …, 'key' => 'WEB-1', 'number' => 1, 'title' => …, 'description' => <Klartext>, 'type_id' => …, 'state_category' => 'backlog', 'assignee_id' => …, 'label_ids' => [<Katalog-Reihenfolge>], 'archived' => false, 'updated_at' => <int>]`; ein archiviertes → `archived` `true`); „builds the document of a project with its former identifiers“ (Kennung WEB → WWW → `identifier` `WWW`, `former_identifiers` `['WEB']`); „builds the document of a person and of a bot“ (deaktivierte Person → `disabled` `true`, Bot → `type` `bot`); „leaves a project being deleted out“ (`shouldBeSearchable()` falsch); „never writes the index when a model is saved“ (`consumers()` leer, Item anlegen, ändern, löschen über die Actions → `$engine->documents('testing_work_items')` leer, P1).
  - `MeilisearchEngineTest` (`tests/Integration`, `Meili::use()`): „stores documents and filters them by project“ (zwei Items in zwei Projekten über `->searchable()`, `scout:sync-index-settings`-Äquivalent: `Artisan::call('scout:sync-index-settings')`, `Meili::settle()`; `WorkItem::search('')->whereIn('project_id', [$web->id])->keys()` nennt nur das WEB-Item); „removes every document of a project by filter“ (`removeWhere(new WorkItem, 'project_id', $web->id)` → nur das andere bleibt); „talks to Meilisearch through the installed HTTP client“ (`app(\Meilisearch\Client::class)->health()` → `['status' => 'available']`).
  - `ArchTest`: „keeps App\Search free of writes“ (kein `EventRecorder`, kein `DB::table(...)->insert|update|delete`, kein `->save(`/`->update(`/`->delete(` auf Modellen; wie die Regel für `App\Views`).

- [ ] **Step 3: Rot, implementieren, grün** — `ddev artisan test --filter='SearchDocumentsTest|ArchTest|ConfigTest'`; `ddev artisan test --testsuite=Integration --filter=MeilisearchEngineTest`.

- [ ] **Step 4: `CLAUDE.md`** — Tech Stack: `laravel/scout` 11, `meilisearch/meilisearch-php` 1.17, Meilisearch v1.56; Fallstricke: „Scouts Modell-Beobachter sind aus (`disableSearchSyncing` in `AppServiceProvider`): ein `save()` ändert den Index nie; den Index schreibt nur der Konsument“, „`tests/Integration` braucht Meilisearch (DDEV-Dienst, CI-Service); Präfix `testing_`; nach jedem Schreiben `Meili::settle()` (Meilisearch arbeitet Aufgaben asynchron ab)“.

- [ ] **Step 5: Gates G1** (lokal und mit `act` nicht nötig; die CI zeigt den Service im PR).

- [ ] **Step 6: Commit** — `feat: add Scout with Meilisearch, the search documents and a fake engine for tests`.

---

### Task 4: Indexer, Neuaufbau und Einstellungen (`app:search-sync`, `app:search-import`)

**Modell:** opus

**Files:**
- Create: `app/Search/SearchIndexer.php`, `app/Console/Commands/{SearchSyncCommand,SearchImportCommand}.php`, `app/Jobs/ReindexWorkItems.php`, `tests/Feature/Search/SearchIndexerTest.php`, `tests/Feature/Console/SearchCommandsTest.php`, `tests/Integration/SearchSettingsTest.php`
- Modify: `database/seeders/DemoSeeder.php` (am Ende `app(SearchIndexer::class)->rebuild()`), `database/seeders/E2eSeeder.php` (am Ende ebenso, nach dem Aufräumen), `tests/Feature/Seeders/*` (falls ein Test die Engine erreicht), `CLAUDE.md` (Kommandos)

**Interfaces:**
- Consumes: Task 3 (Modelle, `RemovesWhere`, `config/scout.php`)
- Produces:
  - `final class SearchIndexer { __construct(EngineManager $engines) }` mit
    - `upsertItem(string $id): void` (liest `WorkItem` frisch mit den Eager Loads aus `makeAllSearchableUsing`; fehlt es → `removeItem($id)`),
    - `removeItem(string $id): void` (`$engine->delete(new EloquentCollection([(new WorkItem)->forceFill(['id' => $id])]))`),
    - `upsertProject(string $id): void` (fehlt oder `deleting_at` → nur das Projekt-Dokument entfernen),
    - `removeProject(string $id): void` (Projekt-Dokument entfernen; wenn die Engine `RemovesWhere` ist: `removeWhere(new WorkItem, 'project_id', $id)`),
    - `upsertUser(string $id): void`,
    - `reindexItems(?array $projectIds): void` (`WorkItem::query()` (mit `whereIn('project_id', …)`, wenn nicht `null`) → `makeAllSearchableUsing` → `chunkById(500, fn ($chunk) => $chunk->searchable())`),
    - `syncSettings(): void` (je Klasse aus `scout.meilisearch.index-settings`: nur wenn die Engine `UpdatesIndexSettings` ist, `$engine->updateIndexSettings((new $class)->indexableAs(), $settings)`),
    - `rebuild(): void` (`syncSettings()`, dann je Modell `$engine->flush(new $class)` und `$class::makeAllSearchable()`, P18).
  - `ReindexWorkItems` (`ShouldQueue`, Queue `search`, `__construct(public ?array $projectIds)`, `handle(SearchIndexer $indexer)` → `reindexItems`).
  - `app:search-sync` (ruft `syncSettings()`, gibt „Search settings synced.“ aus) und `app:search-import` (ruft `rebuild()`, gibt die Zahl je Index aus: „Indexed 71 work items, 3 projects, 9 accounts.“; Exitcode 0). Beide schreiben weder Modelle noch rechnen sie (`ArchTest` für Commands bleibt grün).

- [ ] **Step 1: Failing Tests schreiben**
  - `SearchIndexerTest` (mit `searchEngine()`): „upserts an item from the database and removes it once it is gone“; „removes a project and every document of its items, also when the rows are gone“ (zwei Items in WEB, `PurgeProject`-Weg: Zeilen per `DeleteProject` + `PurgeProject::run` weg, dann `removeProject` → Index ohne Projekt und Items; Items anderer Projekte bleiben); „removes a project being deleted instead of updating it“; „reindexes the items of the projects named, or of all“ (Titel per `DB::table` geändert → nach `reindexItems([$web->id])` nur WEB neu; `null` → alle); „rebuilds every index from scratch“ (ein Dokument, dessen Item fehlt, ist danach weg; Einstellungen kamen an: `$engine->updatedSettings('testing_work_items')['filterableAttributes']` enthält `project_id`); „skips settings for an engine without them“ (`config(['scout.driver' => 'null'])` → `syncSettings()` wirft nicht).
  - `SearchCommandsTest`: „syncs the settings“ (`artisan('app:search-sync')` → Ausgabe, Exitcode 0, Einstellungen gesetzt); „imports everything and says how much“ (Zahlen in der Ausgabe gleich den Zeilen).
  - `tests/Integration/SearchSettingsTest.php` (`Meili::use()`): „syncs the settings of the three indexes into Meilisearch“ (`artisan app:search-sync`, `settle`, `getSettings()` des Index `testing_work_items`: `searchableAttributes` `['key', 'title', 'description']`, `rankingRules` endet auf `updated_at:desc`, `typoTolerance.disableOnAttributes` `['key']`); „rebuilds an index that holds a stale document“.
  - `DemoSeeder` in Tests: die bestehenden Seeder-Tests laufen mit `SCOUT_DRIVER=null` weiter (Neuaufbau ist dort ein No-op); dazu „fills the search index after seeding“ (`searchEngine()`, `seed(DemoSeeder::class)` → 71 Item-Dokumente, drei Projekte).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='SearchIndexerTest|SearchCommandsTest|DemoSeederTest|E2eSeederTest|ArchTest'`; `ddev artisan test --testsuite=Integration --filter=SearchSettingsTest`.

- [ ] **Step 3: `CLAUDE.md`** — Kommandos: `ddev artisan app:search-sync` (Index-Einstellungen), `ddev artisan app:search-import` (Index neu aufbauen; der Reparaturweg, wenn der Konsument etwas verlor); „erster Start“ endet mit `ddev artisan app:search-import`; der `DemoSeeder` baut den Index am Ende neu.

- [ ] **Step 4: Gates G1**

- [ ] **Step 5: Commit** — `feat: index, rebuild and configure the search with app:search-sync and app:search-import`.

---

### Task 5: Der Such-Konsument

**Modell:** opus

**Files:**
- Create: `app/Search/SearchConsumer.php`, `tests/Feature/Search/SearchConsumerTest.php`
- Modify: `config/werkbuch.php` (`event_consumers` → `[SearchConsumer::class]`), `tests/TestCase.php` (`setUp()` setzt `werkbuch.event_consumers` auf `[]`, P11), `tests/Feature/ConfigTest.php` (Standard), `tests/Support/SearchConsumer.php` → umbenennen in `tests/Support/QueueSearchConsumer.php` (Namenskonflikt; `OutboxTest` zieht mit), `CLAUDE.md` (Konsumenten, Fallstrick „Events der Migration 000500“)

**Interfaces:**
- Consumes: Task 2 (`RetriesConsumption`), Task 4 (`SearchIndexer`, `ReindexWorkItems`), `Event` (`type`, `subject_id`, `changes`)
- Produces: `final class SearchConsumer implements EventConsumer, RetriesConsumption` mit `key()` `'search'`, `queue()` `'search'`, `tries()` 8, `backoff()` `[10, 60, 300, 900, 3600]` (rund 80 Minuten bis `failed_jobs`, P12), `consume(Event $event)` nach der Tabelle „Konsument“. Der Konsument ruft `SearchIndexer` direkt (seine Arbeit läuft in der Claim-Transaktion; Index-Schreiben ist idempotent) und stellt `ReindexWorkItems` mit `->afterCommit()` ein.

- [ ] **Step 1: Failing Tests schreiben** — `SearchConsumerTest` (`consumers(SearchConsumer::class)`, `searchEngine()`; Queue `sync`, die Events laufen nach dem Commit durch):
  - „indexes an item when it is created, changed, moved, assigned, archived and restored“ (je Schritt über die Action, danach das Dokument mit dem neuen Feld: Titel, `state_category`, `assignee_id`, `archived`).
  - „removes a deleted item“.
  - „updates the keys of every item when the identifier of the project changes“ (`UpdateProject` WEB → WWW → Dokumente `WWW-1`, `WWW-2`; Projekt-Dokument mit `former_identifiers` `['WEB']`).
  - „removes a deleted project and its items, also after the purge ran“ (`DeleteProject` mit `Queue::fake([ConsumeEvent::class])`, dann `PurgeProject::run`, dann das gefangene `ConsumeEvent` von Hand ausführen → keine Dokumente von WEB).
  - „indexes people and bots and marks deactivated accounts“ (`CreateBot`, `DeactivateUser`, `ReactivateUser`).
  - „indexes the default bot from the event of migration 000500“ (das `bot.created`-Event der Migration per `eventsOf(EventType::BotCreated)->first()` an `app(Outbox::class)->consume(…, SearchConsumer::class)` → Dokument des Standard-Bots; A39).
  - „reindexes the items of a workflow's projects after the workflow changed“ (Kategorie eines Status per `SaveWorkflow` geändert → `state_category` der Items neu); „reindexes every item after a label was deleted“ (`DeleteLabel` → `label_ids` ohne das Label).
  - „ignores events that change no document“ (Relation, Beobachten, Favorit, Token, Mitglied → `$engine->writes()` (Zähler der Fake-Engine) bleibt 0).
  - „consumes an event once“ (zweimal `Outbox::consume` → ein Schreiben).
  - „retries with its own tries and backoff“ (`(new ConsumeEvent($id, SearchConsumer::class))->tries()` 8, `backoff()` wie oben).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='SearchConsumerTest|OutboxTest|ConfigTest'`; danach die ganze Suite einmal (`ddev artisan test`), weil `TestCase::setUp` jetzt die Konsumenten leert.

- [ ] **Step 3: `CLAUDE.md`** — Architektur „Suche“ (Konsument, Tabelle der Events in Kurzform, `ReindexWorkItems`, Konsumenten in Tests aus, `consumers()` schaltet zu); Fallstrick „Konsumenten vertragen die Events der Migrationen (`bot.created` aus `…_000500`, Katalog-Events aus `…_000710`): der Such-Konsument indexiert den Standard-Bot und übergeht die Katalog-Events“.

- [ ] **Step 4: Gates G1**

- [ ] **Step 5: Commit** — `feat: keep the search index in step with the events`.

---

### Task 6: `QuerySearch` und `GET /api/v1/search`

**Modell:** opus

**Files:**
- Create: `app/Actions/Search/QuerySearch.php`, `app/Search/SearchResults.php`, `app/Http/Controllers/Api/SearchController.php`, `app/Http/Resources/SearchResultsResource.php`, `tests/Feature/Search/QuerySearchTest.php`, `tests/Feature/Api/SearchApiTest.php`, `tests/Integration/SearchFlowTest.php`
- Modify: `routes/api.php`, `app/Exceptions/Problem.php` (`search_unavailable` in `REASONS`, Fabrik `unavailable(string $reason)` → 503), `lang/{en,de}.json`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `CLAUDE.md` (Architektur „Suche“)

**Interfaces:**
- Consumes: Task 3–5; `Visibility::projectIds`, `ItemQuery::for`, `ItemQueryInput::ofFilter(Filter::empty(), bool)`, `WorkItem::{findByReference,loadForResource}`, `ItemKey::parse`, `Authorize::allows`, `Project::visibleTo`, `View`
- Produces:
  - `final readonly class SearchResults { /** @param EloquentCollection<int, WorkItem> $items … */ public function __construct(public EloquentCollection $items, public EloquentCollection $projects, public EloquentCollection $people, public EloquentCollection $views, public ?string $keyMatch) }`.
  - `QuerySearch::handle(Actor $actor, array $query): SearchResults` mit `TYPES = ['items', 'projects', 'people', 'views']`, `DEFAULT_LIMIT = 20`, `MAX_LIMIT = 50`, `Q_MAX = 255`. Ablauf:
    1. Eingabe nach „REST“ prüfen (alle Fehler in einer `ValidationException`, Meldungen über `$messages`).
    2. `$visible = Visibility::projectIds($user)`; ohne `include_archived` ohne archivierte Projekte (`Project::query()->whereKey($visible)->whereNull('archived_at')->pluck('id')`), P3.
    3. **Key-Sprung** (P4): `ItemKey::parse($q)` gesetzt → `WorkItem::findByReference($q)`; nur wenn `Authorize::allows($actor, 'view', $item)` (sichtbar, Projekt nicht in Löschung; Archiv egal) wird es `keyMatch` und steht an erster Stelle von `items`.
    4. **Items** (wenn angefragt und `$scope` nicht leer): `WorkItem::search($q)->options(['matchingStrategy' => 'all'])->whereIn('project_id', $scope)` (+ `->where('archived', false)` ohne `include_archived`) `->take($limit)->keys()`; dann `ItemQuery::for($actor, ItemQueryInput::ofFilter(Filter::empty(), $includeArchived))->whereKey($ids)->get()` in der Reihenfolge der IDs; der Key-Treffer davor, ohne Doppelte, auf `$limit` gekürzt; `WorkItem::loadForResource($items, $user, lean: true)`.
    5. **Projekte**: `Project::search($q)->options(['matchingStrategy' => 'all'])->whereIn('id', $scope)` (+ `archived` `false`) → `Project::visibleTo($user)->with(['media', 'types:work_item_types.id'])->whereKey($ids)` in Index-Reihenfolge.
    6. **Personen**: `User::search($q)->options(['matchingStrategy' => 'all'])->where('disabled', false)->take($limit)->keys()` → `User::query()->with('media')->whereKey($ids)->whereNull('disabled_at')` in Index-Reihenfolge (P7).
    7. **Views** (P6): jedes Wort (`preg_split('/\s+/u')`) als `name like %…%` (`\`, `%`, `_` maskiert), `orderBy('name')->orderBy('id')->limit($limit)`.
    Jedes Wort der Anfrage muss treffen (`matchingStrategy: all`, wie der Klickdummy, P13); kennt Scouts `Builder` kein `options()`, setzt ein Callback (`fn ($index, $query, $options) => $index->search($query, [...$options, 'matchingStrategy' => 'all'])`) den Wert.
    8. Wirft die Engine `Meilisearch\Exceptions\ApiException`, `Meilisearch\Exceptions\CommunicationException` oder `Psr\Http\Client\ClientExceptionInterface` → `report($e)` und `throw Problem::unavailable('search_unavailable')` (P12).
  - `SearchResultsResource` → `{items: WorkItemResource::collection, projects: ProjectResource::collection, people: UserResource::collection, views: ViewResource::collection, key_match}`; `SearchController::__invoke(Request $request)` → `['data' => new SearchResultsResource(QuerySearch::run(Actor::fromRequest($request), $request->query()))]`.
  - Route `Route::get('search', SearchController::class)->name('api.search')` in der Gruppe `auth:sanctum` (GET = `read`).
  - Matrix: `'QuerySearch' => ['action' => QuerySearch::class, 'run' => fn (Actor $a, MatrixWorld $w, string $column) => QuerySearch::run($a, ['q' => 'Matrix']), 'allowed' => $everyone]`. Routen: `'search' => ['GET', '/api/v1/search?q=Matrix']` (Platzhalter in der Query werden nicht gefüllt; prüfen, dass `RouteMatrixTest` eine Query im Pfad verträgt, sonst `'query' => ['q' => 'Matrix']` als neuen Schlüssel einführen).
  - Texte (de wörtlich, en): `field.q.required` „Gib einen Suchbegriff ein.“ / „Enter something to search for.“, `field.q.max` „Höchstens :max Zeichen.“ / „At most :max characters.“, `field.types.unknown` „„:name“ gibt es nicht. Möglich: :allowed.“ / „There is no "\:name". Possible: :allowed.“, `field.limit.invalid` „Eine ganze Zahl von 1 bis :max.“ / „A whole number from 1 to :max.“, `problem.reason.search_unavailable` „Die Suche ist gerade nicht erreichbar. Versuch es gleich noch einmal.“ / „The search is not available right now. Try again in a moment.“

- [ ] **Step 1: Failing Tests schreiben** — `QuerySearchTest` (`searchEngine()`, Dokumente über `app(SearchIndexer::class)->rebuild()` nach dem Anlegen; `MatrixWorld` oder eigene Projekte mit privatem OPS):
  - Sichtbarkeit (Review Focus 1): „finds items of the projects the reader sees and nothing of a private project“ (Member von WEB, OPS privat: gleiches Wort in beiden Titeln → nur WEB); „finds items of a public project for a non-member“; „shows no item the index still holds after it was deleted“ (Item per `DeleteWorkItem` weg, Dokument bleibt (Konsumenten aus) → kein Treffer); „shows no item of a project being deleted“ (`deleting_at` gesetzt); „shows no item of a project the reader was removed from“ (`RemoveMember` nach dem Index); „finds nothing for a deactivated account“ (Items, Projekte leer).
  - Archiv (P3): „leaves archived items and the items of archived projects out unless include_archived“; „lists archived projects only with include_archived“.
  - Key-Sprung (P4, Review Focus 2): „puts the item of a typed key first and names it in key_match“ (`web-47` klein, Titel ohne das Wort); „jumps over a former identifier only to items the reader sees“ (`OLD-12` nach Umbenennung → `key_match` = ULID, `items[0].key` = `NEW-12`; dasselbe als Außenstehender eines privaten Projekts → `null`); „answers the key of an item the reader may not see like an unknown key“ (Antwort für `OPS-1` gleich der für `ZZZ-1`: `key_match` `null`, `items` ohne OPS); „finds an archived item by its key without include_archived“; „lists the key match once and keeps the limit“ (`limit` 1).
  - Arten: „finds projects by identifier, former identifier and name“; „finds people and bots, never deactivated accounts“; „finds views by every word of their name, taking % and _ literally“; „searches only the types asked for“ (`types=projects` → `items` leer, die Engine wurde für Items nicht gefragt).
  - Eingabe: „refuses an empty query, an unknown type, a limit outside 1–50 and a non-boolean include_archived in one answer“ (vier Fehlerpfade); „keeps the order of the index“ (die Fake-Engine liefert B vor A → `items` B, A); „answers 503 search_unavailable when the engine fails“ (`Exceptions::fake()`, `$engine->failWith(new CommunicationException('down'))` → `Problem` 503, Grund `search_unavailable`, `Exceptions::assertReported(CommunicationException::class)`).
  - Abfragen: „asks the database a fixed number of times“ (Zahl der Abfragen mit 2 und mit 20 Treffern gleich).
  - `tests/Integration/SearchFlowTest.php` (Erfolgskriterium 2.6 per REST; echte Meilisearch, `consumers(SearchConsumer::class)`, `Meili::use()`, `app:search-sync`): „finds an item created over REST, and no longer once it is archived or deleted“ (`POST /api/v1/work-items` mit Token, `Meili::settle()`, `GET /api/v1/search?q=<Titelwort>` → das Item; archivieren → nicht ohne `include_archived`, mit schon; löschen → nicht).
  - `SearchApiTest`: „searches with a read token“ (200, Form `{data: {items, projects, people, views, key_match}}`, Items ohne `description`); „answers 422 in the language of the account“ (Mara `de` → `field.q.required` deutsch); „answers 503 as problem details“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='QuerySearchTest|SearchApiTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest|ProblemTest'`; `ddev artisan test --testsuite=Integration --filter=SearchFlowTest`.

- [ ] **Step 3: `CLAUDE.md`** — Architektur „Suche“: `QuerySearch` (Ablauf in einem Satz je Schritt), Antwortform, `key_match`, Archiv-Regel, Views per Datenbank, 503.

- [ ] **Step 4: Gates G1**

- [ ] **Step 5: Commit** — `feat: search items, projects, people and views through GET /api/v1/search`.

---

### Task 7: Relevanz mit echter Meilisearch

**Modell:** opus

**Files:**
- Create: `tests/Integration/SearchRelevanceTest.php`
- Modify: `config/scout.php` (nur wenn ein Test eine Einstellung der Tabelle „Index“ widerlegt; dann die Tabelle in diesem Plan und `docs/*/search.md` mitziehen)

**Interfaces:**
- Consumes: Task 3–6 (`Meili`, `SearchIndexer::rebuild`, `QuerySearch`)
- Produces: keine neuen Namen; hält die Einstellungen der Tabelle „Index“ gegen echtes Verhalten fest.

- [ ] **Step 1: Tests schreiben** (`Meili::use()`, `app:search-sync`, eigene Items über die Factory, `rebuild()`, `Meili::settle()`, gesucht über `QuerySearch::run(actor($admin), …)`):
  - „finds Kontaktformular by kontakt“ (Präfix des letzten Worts; Flow 1).
  - „ranks a hit in the title before a hit in the description“.
  - „puts the newer of two equal hits first“ (gleiche Titel, `updated_at` verschieden).
  - „tolerates a typo in a title word, not in a key or an identifier“ (`kontaktfromular` findet; `WBE-47` liefert kein Item über den Index, Projekt `WBE` findet WEB nicht).
  - „finds Über by uber and über by UBER“ (Meilisearch normalisiert Akzente und Groß-/Kleinschreibung).
  - „needs every word of the query“ (zwei Wörter, nur ein Item hat beide → nur dieses, wie der Klickdummy; hält `matchingStrategy: all` aus Task 6 fest: ohne sie liefert Meilisearch auch Items mit nur einem Wort).
  - „filters by project and archive in Meilisearch, not only in the database“ (`Meili::ids('testing_work_items', 'kontakt', 'archived = false')` ohne archivierte).

- [ ] **Step 2: Laufen lassen** — `ddev artisan test --testsuite=Integration --filter=SearchRelevanceTest`. Ein Fall, der rot ist, wird durch die Einstellung bzw. `matchingStrategy` grün, nicht durch Lockern des Tests; jede solche Änderung kommt als P-Zusatz in Task 16.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit** — `test: pin the relevance of the search against Meilisearch`.

---

### Task 8: e2e und CI mit echter Suche

**Modell:** sonnet (mechanisch, Code vollständig)

**Files:**
- Modify: `e2e/ci.env` (`SCOUT_DRIVER=meilisearch`, `MEILISEARCH_HOST=http://127.0.0.1:7700`, `MEILISEARCH_KEY=ci-werkbuch-master-key`), `.github/workflows/tests.yml` (Job `e2e`: Service `meilisearch` wie in `tests`; Step „Meilisearch“ (`curl … /health`) vor „Migrate“; Step „Search settings“ `php artisan app:search-sync` nach „Migrate“; Queue-Worker `--queue=default,notifications,search`), `e2e/helpers.ts` (`searchToken`, `waitForSearch`)
- Create: `e2e/tests/search.spec.ts` (erster Test)

**Interfaces:**
- Consumes: Task 6 (`GET /api/v1/search`), `api()`, `ensureCsrfCookie()`
- Produces:
  - `export function searchToken(): string` — acht Kleinbuchstaben aus `sha1(\`${runId()}:${variant()}\`)` (Ziffern auf Buchstaben abgebildet: `hex.replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)])`), damit Meilisearch es als ein Wort liest und zwei Varianten nie um nur einen Tippfehler auseinanderliegen.
  - `export async function waitForSearch(page: Page, q: string, found: (data: SearchData) => boolean, timeout = 20_000): Promise<SearchData>` — fragt `GET /api/v1/search?q=` alle 250 ms, bis `found` stimmt; sonst scheitert es mit der letzten Antwort. `SearchData` = `{ items: { id: string; key: string; title: string }[]; projects: { id: string; identifier: string }[]; people: { id: string }[]; views: { id: string }[]; key_match: string | null }`.

- [ ] **Step 1: Failing Test schreiben** — `e2e/tests/search.spec.ts`:

```ts
import { expect, test } from '../fixtures';
import { createE2eProject, createItem, removeE2eProject, runId, searchToken, variant, waitForSearch } from '../helpers';

// The search with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Every item of a
// spec carries the search token of its run and variant: all variants share one index.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

test('indexes a new item for the search', async ({ page }) => {
  await page.goto('/my-items');
  const { id, identifier } = await createE2eProject(page, name('search index'));
  try {
    const item = await createItem(page, { project_id: id, title: `E2E Kontaktformular ${searchToken()}` });
    const data = await waitForSearch(page, `kontakt ${searchToken()}`, (answer) => answer.items.some((hit) => hit.id === item.id));
    expect(data.items[0].key).toBe(item.key);
  } finally {
    await removeE2eProject(page, identifier);
  }
});
```

- [ ] **Step 2: Rot belegen** — vor den Helfern: `pnpm --dir e2e typecheck` → FAIL (`searchToken`, `waitForSearch` fehlen). Nach den Helfern lokal `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test search` → PASS (DDEV hat Meilisearch und den Worker auf `search`); dass Service, `app:search-sync` und Worker der CI greifen, belegt der Lauf des Jobs `e2e` im PR (ohne die Änderung an `tests.yml` scheitert der Test dort mit „waitForSearch … after 20000 ms“).

- [ ] **Step 3: Implementieren** — `ci.env`, `tests.yml`, Helfer wie oben. Kommentar im Job `e2e`: „the search consumer works in the queue `search`; Meilisearch as in the job `tests`“.

- [ ] **Step 4: Gates** — G3 gezielt: `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test search`; `pnpm --dir e2e typecheck`.

- [ ] **Step 5: Commit** — `ci: run the e2e suite against Meilisearch with a search worker`.

---

### Task 9: Frontend-Datenschicht der Suche

**Modell:** sonnet (mechanisch, Code vollständig)

**Files:**
- Create: `resources/js/api/search.ts`, `resources/js/api/search.test.ts`, `resources/js/hooks/search.ts`
- Modify: `resources/js/types.ts` (`SearchResults`, `SearchType`), `resources/js/hooks/data.test.tsx` (Hook-Tests), `resources/js/test/api.ts` (Standard-Route `GET /api/v1/search`), `resources/js/test/fixtures.ts` (`emptySearch`, `searchResults(partial)`)

**Interfaces:**
- Consumes: `get` aus `api/http.ts`, `one()`, `qk.search`
- Produces:
  - `types.ts`: `export type SearchType = 'items' | 'projects' | 'people' | 'views';` und `export interface SearchResults { items: ListedItem[]; projects: Project[]; people: User[]; views: View[]; /** The id of the item a typed key names, also over a former identifier (`OLD-12`). */ key_match: string | null }` (ersetzt die bisherige Form mit `pages`; Seiten kommen mit Phase 9).
  - `api/search.ts`: `export interface SearchOptions { types?: SearchType[]; limit?: number; include_archived?: boolean }` und `export function search(q: string, options: SearchOptions = {}): Promise<SearchResults>` → `one(get<{ data: SearchResults }>('/api/v1/search', { q, types: options.types?.join(','), limit: options.limit, include_archived: options.include_archived }))` (nur gesetzte Werte in der Query).
  - `hooks/search.ts`: `export function useSearch(q: string, options: SearchOptions = {}, hook: HookOptions = {})` → `useQuery({ queryKey: qk.search.list({ q: q.trim(), ...options }), queryFn: () => search(q.trim(), options), enabled: q.trim() !== '' && (hook.enabled ?? true), placeholderData: keepPreviousData, staleTime: 0, gcTime: 30_000 })` (P14: jede neue Palette fragt neu, statt dass Mutationen `qk.search` ungültig machen; der Index folgt ohnehin asynchron, 13c erledigt).
  - `test/api.ts`: antwortet `GET /api/v1/search` mit `{ data: emptySearch }`, solange ein Test die Route nicht selbst setzt (Palette-Tests anderer Bildschirme tippen in die Wurzelliste).

- [ ] **Step 1: Failing Tests schreiben** — `api/search.test.ts`: „asks the search with the query and only the options given“ (`calls[0].url` = `/api/v1/search?q=kontakt` bzw. `…&types=items%2Cprojects&limit=20&include_archived=1` nach der Kodierung von `http.ts`); „unwraps data“. `hooks/data.test.tsx`: „does not search for an empty query or spaces“ (keine Anfrage); „keeps the last hits while the next query is on its way“ (`placeholderData`); „asks again when the palette opens again“ (zweiter Mount → zweite Anfrage, `staleTime` 0).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/api/search resources/js/hooks/data`.

- [ ] **Step 3: Gates G2**

- [ ] **Step 4: Commit** — `feat: read the search from the API in the browser`.

---

### Task 10: Suchtreffer in der Befehlspalette

**Modell:** opus

**Files:**
- Modify: `resources/js/features/palette/{model.ts,model.test.ts,EntryRow.tsx,CommandPalette.tsx,palette.test.tsx}`, `lang/{en,de}.json`, `e2e/tests/palette.spec.ts` (Kopfkommentar „finds commands only“ weg; ein Test „searches from the palette“ mit `waitForSearch`)

**Interfaces:**
- Consumes: Task 9 (`useSearch`, `SearchResults`), `parseKey` (`domain/keys.ts`), `usePermissions().can('org.manage')`, `useWorkItemTypes`, `useWorkflows`, `useProjects({ include_archived: true })`, `paths`, `router.visit`, `Avatar`, `ProjectBadge`, `ViewIcon`, `StatusIcon`, `typeIcon`, `botWord`, `Highlight`, `Skeleton`, `Banner`/Fehlerzeile wie im Klickdummy
- Produces:
  - `model.ts` (Port des Klickdummys): `PaletteEntry` = `command` | `jump` (`key`) | `item` (`ListedItem`) | `project` | `person` (`User`) | `view`; `LIMITS = { items: 8, others: 4 }`; `export function typedKey(query: string): string | null` (über `parseKey`, groß); `export function rootSections(query: string, commands: CommandDef[], results?: SearchResults, options?: { people: boolean }): PaletteSection[]` — Befehle wie bisher; mit Wörtern dahinter die Abschnitte `items`, `projects`, `people` (nur bei `options.people`), `views` mit Labels `palette.section.*`; das Item von `results.key_match` zuerst, sonst bei einem getippten Key ein `jump` vorn; ist ein Key getippt, steht der Abschnitt `items` vor den Befehlen (wie der Klickdummy).
  - `EntryRow({ entry, terms, lookups })` mit `RowLookups { typeOf, stateOf }`: Item (Typ-Icon im Ton, Key, Titel mit `Highlight`, Status ab `sm`), Sprung („:key öffnen“), Projekt (`ProjectBadge`, Name, Kennung), Person (`Avatar`, Name, `@handle` bzw. `botWord()`), View (`ViewIcon`, Name).
  - `CommandPalette`: Suche über `useSearch(debounced, {}, { enabled: !subpage })` mit `SEARCH_DELAY_MS` 150; `searching` solange die getippte Anfrage nicht die gefragte ist oder `isFetching`; Ziele: `jump` → `paths.item(key)`, `item` → `paths.item(item.key)`, `project` → `paths.project(identifier)`, `person` → `paths.settings(type === 'bot' ? 'bots' : 'people')`, `view` → `paths.view(id)`, alle über `router.visit` und dann schließen. Zustände: Skelett „Suche läuft …“ (`SkeletonGroup`) nur ohne Zeilen; Fehler als `role="alert"` mit `palette.search_failed` (Satz des Servers über `causeOf`) und „Erneut versuchen“ (`search.refetch()`); ohne Treffer „Keine Treffer für „:query““ mit den Tipps; ohne Eingabe die Tipps; Statusregion `palette.searching` bzw. `tn('palette.hits', rows.length)`. Eingabefeld `palette.input` „Suchen oder Befehl eingeben“, Platzhalter `palette.placeholder` „Suchen oder Befehl …“, Liste `palette.list` „Befehle und Treffer“.
  - Texte (de aus dem Klickdummy wörtlich): `palette.section.items` „Items“, `.projects` „Projekte“, `.people` „Personen“, `.views` „Views“; `palette.jump` „:key öffnen“ / „Open :key“; `palette.searching` „Suche läuft …“; `palette.search_failed` „Die Suche hat nicht geantwortet: :cause“; `palette.no_results` „Keine Treffer für „:query““; `palette.key_tip` „Ein Key wie WEB-47 springt direkt zum Item.“; `palette.tip` bleibt („Befehle findest du über ihren Namen, etwa „Theme“.“).

- [ ] **Step 1: Failing Tests schreiben**
  - `model.test.ts`: „lists the commands first, then items, projects, people and views“; „puts the item of key_match first, also when it came by a former identifier“ (`OLD-12` getippt, `key_match` = ID eines Items mit Key `NEW-12` → erste Zeile dieses Item, kein `jump`); „offers the jump to a typed key before the search answered“ (`results` `undefined`, `web-47` → `jump` `WEB-47` vor den Befehlen); „leaves the people out unless asked for“; „shows eight items and four of the others“; „searches nothing for a query of spaces“.
  - `palette.test.tsx` (mit `mockApi`, Route `GET /api/v1/search` je Test): „shows hits a moment after typing and opens an item with Enter“ (`router.visit` mit `/items/WEB-47`, Palette zu); „jumps to a typed key with Enter before the search answers“ (Antwort hängt; Enter → `/items/WEB-47`); „keeps the hits of the newer query when an older answer arrives late“ (Antwort zu „kon“ kommt nach der zu „kontakt“ → Zeilen von „kontakt“); „says it is searching and then how many hits there are“ (Statusregion); „shows the error with Try again and still jumps to a typed key“ (503 mit `detail` → Alert mit dem Satz, „Erneut versuchen“ fragt erneut; `web-47` + Enter springt); „says there are no hits and shows the tips“; „opens a project, a view, a person and a bot“ (Org-Admin; Member sieht keine Personen); „does not search in a sub-list“ (Theme-Unterliste, keine Anfrage); „searches over a list with its item commands“ (Befehl „Status ändern …“ registriert, „status“ getippt → Befehl vorn, Treffer danach).
  - `e2e/tests/palette.spec.ts`: „searches from the palette“ (Projekt und Item per API mit `searchToken()`, `waitForSearch`, ⌘K, Wort tippen, der Abschnitt „Items“ zeigt den Key, Enter öffnet die Item-Seite).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/palette`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test palette`.

- [ ] **Step 3: Gates G2, G3**

- [ ] **Step 4: Commit** — `feat: show search hits in the command palette`.

---

### Task 11: Abnahme-Abläufe der Suche: Flow 1, Key-Sprung, kein Leck

**Modell:** opus

**Files:**
- Modify: `e2e/tests/search.spec.ts`

**Interfaces:**
- Consumes: Task 8 (`searchToken`, `waitForSearch`), Task 10, `createE2eProject`, `createItem`, `signedInContext`, `PEOPLE`, `tr`, `pressMod`, `tabTo`, die Hilfsfunktionen von `items.spec.ts` (`subList`, `field`) als lokale Kopien oder nach `e2e/helpers.ts` gezogen (dann `items.spec.ts` mitziehen)
- Produces: die Abnahme „Erfolgskriterium 2.6 in der UI“ und Flow 1 des Klickdummys über ⌘K.

- [ ] **Step 1: Tests schreiben** (je Test ein eigenes Projekt, `finally` räumt ab):
  - „Flow 1: finds the item over the palette and closes it with the resolution set“ — Item `E2E Kontaktformular sendet doppelt ${searchToken()}` in einem Projekt mit dem Standard-Workflow; `waitForSearch`; ⌘K, `kontakt ${searchToken()}` tippen, die erste Zeile im Abschnitt „Items“ ist das Item (`aria-selected`), Enter → `/items/<key>` mit der Überschrift; dann wie `items.spec.ts` Flow 1: `s`, „done“, Enter → `ResolutionPrompt` mit vorbelegtem „Done“, Enter → Feld „Status: Done“ und „Resolution: Done“. Nur Tastatur.
  - „jumps to an item over its former key“ — Projekt anlegen, Item anlegen, Kennung per `PATCH /api/v1/projects/<id>` ändern; ⌘K, alten Key tippen, Enter (ohne auf die Suche zu warten) → URL `/items/<neuer Key>`.
  - „finds a project and a view by name“ — Projekt `E2E Suchprojekt ${searchToken()}` und View über `createE2eView` mit dem Token im Namen; `waitForSearch(…, (d) => d.projects.length > 0)`; ⌘K, Token tippen → Abschnitte „Projekte“ und „Views“; Pfeil auf die View, Enter → `/views/<id>`.
  - „shows Ida no item of a private project she is not in“ (Review Focus 2, Anti-Ziel) — als e2e-Person privates Projekt mit Item `E2E Geheimsache ${searchToken()}`, `waitForSearch` als e2e-Person bis gefunden; dann `signedInContext(browser, PEOPLE.ida)`: ⌘K, Token tippen → „Keine Treffer für …“ und kein Abschnitt „Items“; den Key des Items tippen, Enter → Seite „Diese Seite gibt es nicht“ (die 404, nie die Item-Seite).

- [ ] **Step 2: Laufen lassen** — `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test search` (alle vier Projekte).

- [ ] **Step 3: Gates G3** (voller Lauf am Ende der Task)

- [ ] **Step 4: Commit** — `test: find, open and close an item from the palette, and leak nothing to a member`.

---

### Task 12: Einstiege in die Suche und fehlende Palette-Befehle

**Modell:** opus

**Files:**
- Create: `resources/js/shell/SearchButton.tsx`
- Modify: `resources/js/lib/shortcuts/catalog.ts` (`shell.search`), `resources/js/shell/{bindings.tsx,Sidebar.tsx,MobileBar.tsx,PageStates.tsx}`, `resources/js/shell/sidebar/*` (falls die Seitenleiste dort ihren Kopf hat), `resources/js/features/projects/ProjectsScreen.tsx`, `resources/js/features/views/ViewsScreen.tsx`, `lang/{en,de}.json`, Tests: `resources/js/shell/{Shell.test.tsx,PageStates.test.tsx}`, `resources/js/features/{projects/projects.test.tsx,views/views.test.tsx}`, `resources/js/lib/shortcuts/HelpOverlay.test.tsx`, `e2e/tests/{shell.spec.ts,search.spec.ts}`

**Interfaces:**
- Consumes: Task 10 (Palette mit Suche), `useUiStore.setPaletteOpen`, `useShortcut`, `useCommand`, `usePermissions`
- Produces:
  - Katalog: `'shell.search': { keys: '/', scope: 'global', label: 'shortcuts.shell.search', group: 'shortcuts.group.general' }` (P15); `bindings.tsx`: `useShortcut('shell.search', () => ui().setPaletteOpen(true))`. In Listen gewinnt `list.search` (Bereich `list`, A181), die Hilfe zeigt dort nur die Titelsuche (`helpGroups` übergeht globale Kürzel, die die Seite neu bindet).
  - `SearchButton({ variant: 'full' | 'rail' })`: `full` = Knopf „Suchen …“ mit Lupe und `Kbd mod+k` (Kopf der Seitenleiste, wie der Klickdummy), `rail` = `IconButton` „Suchen“ mit `shortcut="mod+k"` (eingeklappte Leiste); `aria-keyshortcuts` über den Katalog. `MobileBar`: `IconButton` „Suchen“ vor der Inbox (am Handy der einzige Weg in die Palette).
  - `NotFound`: zweiter Knopf „Suchen“ (`errors.page.not_found.search`, `variant: 'secondary'`), nur mit angemeldeter Person (`useSharedProps().auth.user`), öffnet die Palette.
  - Palette-Befehle (Port aus `bindings.tsx` des Klickdummys und 13c): `shell.help` „Alle Tastaturkürzel“ (Gruppe Aktionen, `keys` `?`, Keywords „hilfe kürzel tastatur“), `shell.sidebar` „Seitenleiste einklappen“/„ausklappen“ (nur ab `md`, `when: isWide`), `projects.create` „Neues Projekt“ auf `/projects` (nur mit `project.create`, öffnet den Anlegen-Dialog wie `?create=1`), `views.create` „Neue View“ auf `/views` (nur mit `view.create`, öffnet `ViewDialog`).
  - Texte (de wörtlich aus dem Klickdummy): `shortcuts.shell.search` „Suchen“, `shell.search` „Suchen …“, `shell.search_icon` „Suchen“, `errors.page.not_found.search` „Suchen“, `commands.help.label` „Alle Tastaturkürzel“, `commands.help.keywords` „hilfe kürzel tastatur“, `commands.sidebar.collapse` „Seitenleiste einklappen“, `commands.sidebar.expand` „Seitenleiste ausklappen“, `commands.projects.create` „Neues Projekt“, `commands.views.create` „Neue View“; en entsprechend („Search“, „Search …“, „All keyboard shortcuts“, „Collapse the sidebar“, „Expand the sidebar“, „New project“, „New view“).

- [ ] **Step 1: Failing Tests schreiben**
  - `Shell.test.tsx`: „opens the palette with / outside lists“; „opens the palette from the search button of the sidebar and of the rail“; „lists Alle Tastaturkürzel and the sidebar toggle in the palette“ (Sidebar-Befehl fehlt unter `md`).
  - `PageStates.test.tsx`: „offers the search on the 404 page when signed in, not as a guest“.
  - `projects.test.tsx`: „offers Neues Projekt in the palette with the right and opens the dialog“; „leaves it out without the right“. `views.test.tsx` ebenso für „Neue View“.
  - `HelpOverlay.test.tsx`: „lists / as Suchen outside lists and as the title search in lists“.
  - e2e `shell.spec.ts`: „opens the palette with / and from the search button, also on the phone“ (Telefon: Knopf der mobilen Leiste per `tabTo`); `search.spec.ts`: „searches from the 404 page“ (`/items/ZZZ-1`, `tabTo` „Search“, Enter → Palette).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/shell resources/js/features/projects resources/js/features/views resources/js/lib/shortcuts`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test shell search projects views`.

- [ ] **Step 3: Gates G2, G3**

- [ ] **Step 4: Commit** — `feat: open the search with /, from the sidebar, the phone bar and the 404 page`.

---

### Task 13: Die Relationen-Suche über die Suche

**Modell:** opus

**Files:**
- Modify: `resources/js/features/item-detail/Relations.tsx`, `resources/js/features/item-detail/sections.test.tsx`, `lang/{en,de}.json`, `e2e/tests/item-sections.spec.ts`

**Interfaces:**
- Consumes: Task 9 (`useSearch`)
- Produces: `RelationDialog` sucht mit `useSearch(search, { types: ['items'], limit: SEARCH_LIMIT }, { enabled: open })` statt `useWorkItems({ q, … })` (P16): Kandidaten = `results.items` ohne das Item selbst (der Key-Treffer steht dank `key_match` vorn, auch über eine frühere Kennung und für archivierte Items); ohne Eingabe keine Anfrage und als `emptyText` `items.detail.relations.dialog.type_to_search` „Key oder Titel eingeben“ / „Type a key or a title“; ein Fehler der Suche (auch 503) steht wie bisher als `load`-Fehler mit „Erneut versuchen“ im Picker; die letzte Antwort bleibt bis zur nächsten stehen (wie bisher `shown`). `filter[q]`/`q` der Item-Liste bleibt als REST-Funktion bestehen (Kurzform, `ItemQuery`), der Browser nutzt sie nicht mehr.

- [ ] **Step 1: Failing Tests schreiben** — `sections.test.tsx`: „searches the relation target through the search“ (`GET /api/v1/search?q=kontakt&types=items&limit=20`; keine Anfrage an `/work-items/query`); „asks nothing until something is typed and says what to type“; „offers the item of a typed former key first“ (`key_match`); „shows a failed search with Try again“ (503). e2e `item-sections.spec.ts`: der bestehende Ablauf (Relation per `r` und Key) bleibt grün; Ergänzung „finds the target by a word of its title“ (Token, `waitForSearch`).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/item-detail`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test item-sections`.

- [ ] **Step 3: Gates G2, G3**

- [ ] **Step 4: Commit** — `feat: find the target of a relation through the search`.

---

### Task 14: Kürzel-Katalog: Kommentare, Präfix-Kollisionen, gebundene Einträge, Tasten der Widgets

**Modell:** sonnet (mechanisch, Code vollständig)

**Files:**
- Create: `resources/js/lib/shortcuts/widgets.ts`, `resources/js/lib/shortcuts/widgets.test.ts`
- Modify: `resources/js/lib/shortcuts/{catalog.ts,catalog.test.ts,registry.ts}`, `resources/js/lib/storage.ts`, `lang/{en,de}.json`

**Interfaces:**
- Consumes: `SHORTCUTS`, `canonicalKeys`
- Produces:
  - Kopfkommentar in `catalog.ts` ergänzt: „Ids are dot paths with underscores (`shell.go.my_items`, `list.select_all`): where the clickdummy wrote hyphens (`shell.go.my-items`), the app uses underscores like its translation keys.“
  - `storage.ts`: Kommentar ohne Klickdummy-Bezug („the demo“, „review build published as an artifact“): „localStorage that never throws: a private window, blocked site data or a sandboxed frame refuse it; the value then lasts until the page reloads.“ `registry.ts`: jeder Satz, der „demo“, „clickdummy“ oder „review build“ nennt oder behauptet, nur Liste und Detail ruhten unter Dialogen, wird auf das heutige Verhalten gebracht (`grep -n -i 'demo\|clickdummy\|review build\|only list' resources/js/lib/shortcuts/*.ts resources/js/lib/storage.ts resources/js/components/ui/Dialog.tsx resources/js/shell/Shell.tsx`).
  - `widgets.ts`: `export interface WidgetKey { keys: string; label: TranslationKey } export interface WidgetGroup { group: TranslationKey; entries: WidgetKey[] } export const WIDGET_KEYS: WidgetGroup[]` mit den Gruppen (nur `import type` im Kopf, damit `scripts/shortcuts-doc.mjs` die Datei mit Node laden kann):
    - `shortcuts.widget.group.palette`: `up` / `down` „Treffer wählen“ (`shortcuts.widget.palette.move`), `enter` „Ausführen“ (`.run`), `backspace` „Zurück zu allen Befehlen (im leeren Feld)“ (`.back`), `escape` „Schließen“ (`.close`).
    - `shortcuts.widget.group.table` (Tabelle, P26/A182): `left` / `right` „Spalte wechseln“, `up` / `down` „Zeile wechseln“, `shift+up` / `shift+down` „Auswahl erweitern“, `home` / `end` „Erste bzw. letzte Spalte“, `mod+home` / `mod+end` „Erste bzw. letzte Zeile“, `enter` „Zelle bearbeiten“, `escape` „Bearbeiten beenden“.
    - `shortcuts.widget.group.groups` (Gruppenköpfe in Liste und Tabelle): `left` „Gruppe zuklappen bzw. zum Kopf“, `right` „Gruppe aufklappen bzw. zur ersten Zeile“, `up` / `down` „Voriger bzw. nächster Kopf“.
    - `shortcuts.widget.group.editor`: `mod+enter` „Speichern bzw. absenden“, `escape` „Feld verlassen“.
    (Schlüssel `shortcuts.widget.<gruppe>.<was>`, en sinngemäß; die genauen de-Sätze oben sind verbindlich.)
- [ ] **Step 1: Failing Tests schreiben** — `catalog.test.ts`:
  - „starts no sequence with a key that is a shortcut of its own“ (für jeden Eintrag mit Leerzeichen in `keys`: der erste Schritt `canonicalKeys(keys.split(' ')[0])` ist kein `canonicalKeys` eines einstufigen Eintrags, in keinem Bereich; Grund im Kommentar: das Register beginnt eine Folge vor jedem Einzelkürzel, `g` allein liefe nie).
  - „binds every entry somewhere“: `const sources = import.meta.glob(['/resources/js/**/*.{ts,tsx}', '!/resources/js/**/*.test.{ts,tsx}', '!/resources/js/lib/shortcuts/catalog.ts'], { query: '?raw', import: 'default', eager: true })`; jede ID kommt als `'<id>'` in mindestens einer Datei vor (sonst zeigte die Doku ein Kürzel, das nichts tut).
  - `widgets.test.ts`: „has every label and group in both languages“; „names no key of a widget that the catalog binds in the same place“ (keine Gruppe nennt `mod+k`, `?`, `c`).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/lib/shortcuts resources/js/lib/storage`.
- [ ] **Step 3: Gates G2**
- [ ] **Step 4: Commit** — `refactor: tidy the shortcut catalog and list the keys of the widgets`.

---

### Task 15: Tastatur-Doku aus dem Katalog

**Modell:** opus

**Files:**
- Create: `scripts/shortcuts-doc.mjs`, `scripts/shortcuts-doc.test.mjs`, `docs/en/keyboard.md`, `docs/de/keyboard.md` (beide erzeugt)
- Modify: `docs/.vitepress/config.ts` (Eintrag „Keyboard“/„Tastatur“ in beiden Sidebars), `package.json` (Skript `"shortcuts:doc": "node scripts/shortcuts-doc.mjs"`), `CLAUDE.md` (Kommandos, Regel „Tastatur“)

**Interfaces:**
- Consumes: `SHORTCUTS` (`resources/js/lib/shortcuts/catalog.ts`), `WIDGET_KEYS` (`widgets.ts`), `lang/{en,de}.json`
- Produces:
  - `scripts/shortcuts-doc.mjs` (ESM, Node 24 lädt die `.ts`-Dateien per Type Stripping; beide importieren nur Typen): `export const DOC_PATHS = { en: 'docs/en/keyboard.md', de: 'docs/de/keyboard.md' }`, `export async function renderKeyboardDoc(language: 'en' | 'de'): Promise<string>`, `export function keyLabel(keys: string, language): string`, `export function duplicates(shortcuts): string[]` (Paare mit gleichem Bereich und gleichen kanonischen Tasten, wie `catalog.test.ts`); als Programm (`node scripts/shortcuts-doc.mjs`) schreibt es beide Seiten und bricht mit Exitcode 1 ab, wenn `duplicates` nicht leer ist.
  - Seitenaufbau (beide Sprachen gleich, DocsTest): Kommentar `<!-- Generated by scripts/shortcuts-doc.mjs from resources/js/lib/shortcuts/catalog.ts and widgets.ts. Do not edit; run `ddev exec pnpm shortcuts:doc`. -->`, `# Keyboard` / `# Tastatur`, ein Absatz (en/de im Skript: `?` zeigt die Kürzel des Bildschirms; ⌘ auf dem Mac, Strg/Ctrl sonst; in Feldern wirken nur ⌘K, Esc und ⌘↵; unter Dialogen ruhen die Einzeltasten), dann je Gruppe des Katalogs in Katalog-Reihenfolge `## <Gruppe>` mit Tabelle `| Taste | Aktion |` / `| Keys | Action |`, Einträge gleichen Labels in einer Gruppe in einer Zeile („J / ↓“), dann `## <Widget-Gruppe>` je `WIDGET_KEYS`. `keyLabel`: `mod` → „⌘ / Ctrl“ (en) bzw. „⌘ / Strg“ (de), `shift` ⇧, `alt` „⌥ / Alt“, `enter` ↵, `escape` Esc, `backspace` ⌫, `space` „Space“/„Leertaste“, Pfeile ← → ↑ ↓, `home`/`end` „Home“/„End“ bzw. „Pos1“/„Ende“, Buchstaben groß, Folgen „G then I“ / „G, dann I“; Tasten in `<kbd>`.
  - `scripts/shortcuts-doc.test.mjs` (läuft in Vitest wie `rank-fixtures.test.mjs`): „keeps the keyboard pages in step with the catalog“ (Dateiinhalt === `renderKeyboardDoc(language)` für beide Sprachen); „finds no key bound twice in one scope“ (`duplicates(SHORTCUTS)` leer, und ein künstliches Paar wird gefunden); „writes mod, shift, sequences and arrows for each language“ (`keyLabel('mod+shift+k', 'de')`, `keyLabel('g i', 'en')`, `keyLabel('alt+up', 'de')`); „lists the grid keys of the table“ (T20-M8: die Seite enthält die Zeilen für ⇧↑/⇧↓ und ⌘ Home/End).

- [ ] **Step 1: Failing Tests schreiben** (siehe oben), `ddev exec pnpm test -- scripts/shortcuts-doc` → FAIL.
- [ ] **Step 2: Implementieren, Seiten erzeugen** — `ddev exec pnpm shortcuts:doc`; `ddev mutagen sync`; Test grün; `ddev artisan test --filter=DocsTest` (gleiche Überschriften, Sidebar); `ddev exec pnpm --dir docs build` ohne tote Links.
- [ ] **Step 3: `CLAUDE.md`** — Regel „Tastatur“: „`docs/*/keyboard.md` erzeugt `ddev exec pnpm shortcuts:doc` aus Katalog und `widgets.ts`; wer ein Kürzel ändert, erzeugt die Seiten im selben Commit (`scripts/shortcuts-doc.test.mjs` scheitert sonst)“.
- [ ] **Step 4: Gates G1, G2**
- [ ] **Step 5: Commit** — `docs: generate the keyboard pages from the shortcut catalog`.

---

### Task 16: Doku, `CLAUDE.md`, Rulings, Spec, Master-Plan, Abnahme

**Modell:** opus

**Files:**
- Create: `docs/en/search.md`, `docs/de/search.md`
- Modify: `docs/.vitepress/config.ts` („Search“/„Suche“), `docs/{en,de}/development.md` (Meilisearch in DDEV, `app:search-sync`, `app:search-import`, Integration braucht den Dienst), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md`

**Interfaces:**
- Consumes: alles Vorige
- Produces:
  - `search` (en + de, gleiche Überschriften, `DocsTest`): was gefunden wird (Items mit Key, Titel und Beschreibung; Projekte über Kennung, frühere Kennungen und Namen; Personen und Bots; Views über den Namen), wer was findet (nur sichtbare Projekte, zur Abfragezeit; Archiv nur mit `include_archived`; ein Key springt, auch der frühere, nur zu Sichtbarem), die Palette (⌘K, `/` außerhalb von Listen, Abschnitte, Key-Sprung, Tipps), REST `GET /api/v1/search` mit Parametern, Antwort, Beispiel mit `curl` und Fehlern (422, 503), Betrieb (Meilisearch, `MEILISEARCH_KEY`, Queue `search`, `app:search-sync`, `app:search-import` als Reparaturweg, was bei einem Ausfall passiert, RAM-Hinweis auf Phase 14).
  - `CLAUDE.md`: „Stand“ (Phase 6 umgesetzt, als Nächstes Phase 7), Architektur „Suche“ (Index-Tabelle in Kurzform, Konsument, `SearchIndexer`, `QuerySearch`, Palette, Einstiege), Kommandos (Search-Kommandos, `shortcuts:doc`), Fallstricke (Meilisearch in `tests/Integration`, `Meili::settle()`, Präfix `testing_`, Scouts Beobachter aus, `searchToken()`/`waitForSearch()` in e2e). Die Tasks haben ihre Teile schon eingetragen; hier ordnen und prüfen.
  - Rulings `A199` ff. (je mit Grund und „Falls falsch“): P1–P21 dieses Plans, soweit sie über die Phase hinaus gelten. „Für spätere Phasen vorgemerkt“: Zeile Phase 6 entfernen (erledigt; Tasks 2, 4, 5, 10, 12–15); neu: Phase 7 (Kommentartext in das Item-Dokument, Konsument auf `comment.*`), Phase 9 (Index `pages`, Abschnitt „Seiten“ in der Palette, `types=pages`), Phase 10 („Vorlage anwenden …“ in der Palette, P17), Phase 13 (MCP-Tool `search` über `QuerySearch`; Filter auf Typ, Kategorie, Assignee, Labels über die schon indexierten Felder), Phase 14 (Entrypoint ruft `app:search-sync`, bei leerem Index `app:search-import`; Worker mit Queue `search`; Mindest-RAM für Meilisearch), Phase 15 (Neuaufbau über Index-Tausch statt Leeren, Latenz der Suche mit 50 000 Items, `label.deleted` nur die betroffenen Items neu).
  - Spec „Änderungen vom <Tag der Umsetzung> (Phase 6)“ zur Bestätigung: Suche findet Views über den Namen (P6); Personen-Treffer in der Palette nur für Org-Admins (P7); Archiv in der Suche wie in Listen (P3); Key-Sprung auch über die frühere Kennung, Archiv egal (P4); Relationen-Ziel nur über die Suche, ohne Vorschläge vor der ersten Taste (P16); Suche ohne Meilisearch → 503 statt leerer Treffer (P12).
  - Master-Plan: Phase 6 abgehakt im Abschnitt „Fortschritt“ erst nach dem Merge (Orchestrator); im Text von Phase 6 „„Vorlage anwenden …“ (aktiv ab Phase 10)“ → „kommt mit Phase 10“ (P17).

- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.

- [ ] **Step 2: Abnahme der Phase** (ohne den vollen G3: den fährt die finale Fix-Welle)

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev artisan app:search-import
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
E2E_COVERAGE=0 pnpm --dir e2e exec playwright test search palette shell item-sections e2e-helpers
ddev exec pnpm --dir docs build
```

Expected: alles grün, PHP `Total: 100.0 %`, Vitest-Schwellen erfüllt. Von Hand (Master-Abnahme, Erfolgskriterium 2.6 in UI und REST): Mara drückt ⌘K, tippt „kontakt“ und öffnet WEB-47 mit Enter; `/` auf „Meine Items“ öffnet die Palette, `/` in einer Projektliste die Titelsuche; `curl -H "Authorization: Bearer <Token>" "https://werkbuch.ddev.site/api/v1/search?q=kontakt"` liefert WEB-47; Ida findet kein OPS-Item, auch nicht über `OPS-1`; nach dem Anhalten von Meilisearch (`docker stop ddev-werkbuch-meilisearch`) sagt die Palette „Die Suche hat nicht geantwortet …“, ein getippter Key springt trotzdem; danach `docker start …` und `ddev artisan app:search-import`. Die Seite „Keyboard“ der Doku nennt `/`, ⌘K, die Grid-Tasten der Tabelle und die Palette.

- [ ] **Step 3: Commit** — `docs: add the search page, update CLAUDE.md, the rulings and the spec for phase 6`.

---

## Entscheidungen dieses Phasenplans

- **P1 Den Index schreibt nur der Konsument.** Die Modelle tragen Scouts `Searchable` nur für Dokumente und Index-Namen; `disableSearchSyncing()` schaltet Scouts Beobachter aus, `scout.queue` ist `false`. Grund: Spec 7.2 (Suchindex aus der Outbox), Master-Plan Phase 6 („Indexieren als Event-Konsument in der Queue `search`“); ein `save()` außerhalb einer Action (Seeder, Migration) soll den Index nicht nebenbei ändern. Falls falsch: Scouts Beobachter mit `scout.queue = search` (verliert die Idempotenz der Outbox).
- **P2 Sichtbarkeit zur Abfragezeit, nie im Index.** Meilisearch filtert mit `project_id IN Visibility::projectIds`, danach liest `QuerySearch` die Treffer durch `ItemQuery::for` bzw. `Project::visibleTo` neu. Mitgliedschaften, Sichtbarkeit und Deaktivierung lösen keine Neuindexierung aus. Grund: Master Review Focus 3; ein veralteter Index kann so nichts verraten. Falls falsch: Leserechte als Feld im Dokument (braucht Neuindexierung bei jeder Mitgliedschaft).
- **P3 Archiv in der Suche wie in Listen** (A162): ohne `include_archived` keine archivierten Items, keine Items und Projekte archivierter Projekte. Grund: dieselbe Regel wie `ItemQuery`, der Klickdummy blendet Archiviertes aus. Falls falsch: archivierte Projekte immer durchsuchen (nur Items gefiltert).
- **P4 Key-Sprung auf dem Server.** `q` in Key-Form (`ItemKey::parse`) sucht das Item über `WorkItem::findByReference` (auch eine frühere Kennung) und nennt es in `key_match`, wenn der Leser es sieht; Archiv egal (ein Key ist ein direkter Verweis wie `/items/KEY`). Sonst `null` und die Titelsuche läuft normal (A139). Grund: Spec 4.17 „ein Key springt direkt“, der Browser kennt frühere Kennungen nicht. Falls falsch: nur der Sprung im Browser über `/items/KEY` (die Seite leitet um).
- **P5 Antwortform** `{data: {items, projects, people, views, key_match}}`, Items schlank (P17 aus Phase 5), alle Schlüssel immer da, nicht angefragte Arten leer, `limit` je Art 1–50 (20), keine Seiten. Grund: eine Palette braucht wenige Treffer je Art; MCP (Phase 13) liest dieselbe Form. Falls falsch: `types` mit Seiten je Art.
- **P6 Views über die Datenbank** (Name, jedes Wort, Kollation, maskiert), nicht im Index; Wiki-Seiten folgen mit Phase 9 als Index. Grund: Views sind wenige und für alle sichtbar, der Klickdummy findet sie, Spec 4.17 nennt sie nicht im Index. Falls falsch: Index `views` mit Konsument auf `view.*`.
- **P7 Personen:** gefunden werden aktive Personen und Bots (Name, Handle); in der Palette nur für Org-Admins, die damit in die Einstellungen Personen bzw. Bots springen. REST liefert sie allen (wie `GET /users`). Grund: Members sehen dort seit Phase 2 nur „Nur für Admins“, ein Treffer führte ins Leere. Falls falsch: eine Personenseite (Spec kennt keine) oder Treffer ohne Ziel.
- **P8 Indexierte Felder nach Spec 4.17, Neuaufbau ohne Item-Events:** `workflow.updated` baut die Items der Projekte des Workflows neu, `label.deleted` alle Items, `project.updated` mit Kennung die Items des Projekts (Job `ReindexWorkItems`, Queue `search`). Gefiltert wird heute nur über `project_id` und `archived`; Typ, Kategorie, Assignee und Labels stehen für Phase 13 bereit. Falls falsch: diese Felder erst mit Phase 13 indexieren.
- **P9 Löschen:** `work_item.deleted` entfernt das Dokument, `project.deleted` das Projekt und per Filter (`RemovesWhere`, Meilisearch `deleteDocuments` mit `filter`) alle seine Items, auch wenn `PurgeProject` die Zeilen schon entfernt hat. Grund: die Queues `bulk` und `search` laufen ohne Reihenfolge. Falls falsch: `PurgeProject` schreibt ein eigenes Event mit den Item-IDs.
- **P10 Fake-Engine in Feature-Tests, echte Meilisearch in `tests/Integration`.** `Tests\Support\ArraySearchEngine` hält Dokumente im Speicher und kann scheitern; Meilisearch läuft lokal als DDEV-Dienst und in der CI als Service in `tests` und `e2e`; Präfix `testing_`. Grund: Master-Plan Phase 6 („Meilisearch in Integration echt, sonst Fake-Engine“); 100 % Abdeckung braucht die echte Engine-Klasse. Falls falsch: Scouts `collection`-Treiber (sucht nur Spalten, kein `archived`).
- **P11 Konsumenten in Tests aus.** `TestCase::setUp()` leert `werkbuch.event_consumers`; Tests schalten mit `consumers()` zu. Grund: sonst schriebe jede Action in jedem Test eine `event_consumptions`-Zeile und spräche mit der Engine. Falls falsch: Konsumenten an, `SCOUT_DRIVER=null` reicht (mehr Abfragen je Test).
- **P12 Ausfall von Meilisearch:** `QuerySearch` meldet und antwortet 503 `search_unavailable`; der Konsument wiederholt 8-mal (10 s … 1 h, `RetriesConsumption`), danach `failed_jobs` und `ConsumerGaveUp`; `app:search-import` repariert. Grund: Spec 5.1 („Erneut versuchen“ nur bei 5xx), Vormerkung Phase 6. Falls falsch: Rückfall auf die Titelsuche `q` der Item-Liste (andere Treffer, still).
- **P13 Ranking:** Meilisearch-Regeln mit `searchableAttributes` in Gewichtsreihenfolge (Key, Titel, Beschreibung), dazu `updated_at:desc` am Ende (Neueres zuerst wie der Klickdummy); keine Tippfehler in Keys, Kennungen und Handles. Jedes Wort muss treffen (`matchingStrategy: all`, Meilisearch ließe sonst Wörter von hinten weg). Task 7 hält das gegen echtes Verhalten fest. Falls falsch: eigene Ranking-Regeln je Index.
- **P14 Palette:** Befehle zuerst, dann Items (8), Projekte, Personen, Views (je 4); ein Key führt; Treffer auf jedem Bildschirm, auch über Listen mit Item-Befehlen („Suchtreffer … auch über die Items der Listen“ der Vormerkung so gelesen); Suche 150 ms nach der letzten Taste; `staleTime: 0` statt Invalidierung nach Mutationen (13c „search stale“). Falls falsch: `qk.search` in jeder Mutation ungültig machen.
- **P15 `/` außerhalb von Listen öffnet die Palette** (`shell.search`, global, wie der Klickdummy); in Listen gewinnt die Titelsuche (A181). Falls falsch: `/` nur in Listen.
- **P16 Relationen-Ziel über die Suche** (`types=items`, `limit` 20); ohne Eingabe keine Vorschläge. Grund: Vormerkung („Relationen-Suche durch die Suche ersetzen“), dieselben Treffer wie die Palette, Key-Sprung inklusive. Falls falsch: ohne Eingabe die ersten 20 Items der Liste vorschlagen.
- **P17 „Vorlage anwenden …“ kommt mit Phase 10**, nicht als toter Befehl jetzt. Grund: keine unerreichbaren Zweige (100 %), Vorlagen gibt es erst dann. Falls falsch: Befehl mit Toast „Noch keine Vorlagen“.
- **P18 `app:search-import` leert und baut neu** (Einstellungen, Leeren, Einlesen; der Index ist dabei kurz leer); `DemoSeeder` und `E2eSeeder` rufen den Neuaufbau am Ende. Grund: einfacher Reparaturweg; Demo und e2e brauchen einen gefüllten Index, ihre Seeder schreiben ohne Events. Falls falsch: Neuaufbau in einen zweiten Index und Tausch (Phase 15 vorgemerkt).
- **P19 Tastatur-Doku aus Katalog und `widgets.ts`;** das Hilfe-Overlay bleibt beim Register (zeigt, was gerade wirkt), die Tasten der Widgets (Grid, Gruppenköpfe, Palette, Editor) stehen nur in der Doku (T20-M8, A182). Ein Test hält fest, dass jeder Katalog-Eintrag irgendwo gebunden ist. Falls falsch: `widgets.ts` auch im Overlay zeigen.
- **P20 e2e-Kennungen:** Hash des Namens plus Versuchsnummer, bei 422 an `identifier` bis zu 10 Versuche. Grund: ein Zähler im Prozess überlebt keinen Neustart des Workers; 3 Base36-Zeichen kollidieren ab etwa 100 Projekten je Lauf und Variante. Falls falsch: fünf Zeichen Hash (dann nur noch eine Variante im Präfix).
- **P21 Der Konsument übergeht Events, die kein Dokument ändern** (Relationen, Beobachten, Favoriten, Tokens, Mitglieder, Kataloge außer `workflow.updated`/`label.deleted`, Views, Sicherheit) und verträgt die Events der Migrationen (`bot.created` aus `…_000500` indexiert den Standard-Bot). Falls falsch: jedes Event mit Subjekt `work_item` neu indexieren.

## Nicht in Phase 6 (vorgemerkt in Task 16)

- Phase 7: Kommentartext im Item-Dokument, Konsument auf `comment.*`.
- Phase 8: Meilisearch-Status auf der System-Seite.
- Phase 9: Index `pages`, Abschnitt „Seiten“ in der Palette.
- Phase 10: „Vorlage anwenden …“ in der Palette.
- Phase 13: MCP-Tool `search` über `QuerySearch`, Filter auf Typ, Kategorie, Assignee, Labels.
- Phase 14: `app:search-sync` im Entrypoint, Import bei leerem Index, Worker mit Queue `search`, Mindest-RAM.
- Phase 15: Neuaufbau über Index-Tausch, Latenz mit 50 000 Items, gezielter Neuaufbau nach `label.deleted`.
