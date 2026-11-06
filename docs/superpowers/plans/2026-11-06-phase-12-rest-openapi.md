# Phase 12: REST vollständig und OpenAPI – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die REST-API unter `/api/v1` wird vollständig, einheitlich und beschrieben (Spec 6.1): Lücken gegenüber der Oberfläche und der Ressourcenliste aus 6.1 geschlossen (`GET /me`, Einzel-GETs), alle normalen Listen mit `filter[…]`, `sort`, `include` über spatie/laravel-query-builder v7 und Cursor (`per_page` ≤ 100), Rate-Limit 600/min je gültigem Token (sonst Konto der Sitzung, sonst IP), Body-Limit für JSON, OpenAPI 3.1 per Scramble unter `/api/docs` und `/api/openapi.json`. Das Dokument stimmt nachweislich mit dem Code überein: jede Route ist beschrieben, und jede Antwort, die die Feature-Tests unter `/api/v1` bekommen, wird gegen das Dokument geprüft. Abnahme: `ApiFlowTest` (Erfolgskriterium 2 komplett per REST) grün, OpenAPI vollständig.

**Architecture:** Scramble (0.13) erzeugt das Dokument aus Routen, Controllern und Resources; was es aus den Actions nicht sehen kann (die Actions validieren selbst, Spec 7.2), sagen eigene Extensions in `app/OpenApi/` und Scramble-Attribute an den Controller-Methoden. Listen tragen ihre Regeln an einer Stelle: `ListSpec` (statisch an der List-Action) steuert die Abfrage (`ListQuery` über den Query Builder) **und** die Parameter im Dokument (`#[ListOf]` + Extension). Ein Test-Harness (`Tests\Support\OpenApi\Contract`) hängt sich in jeden Feature-Test und prüft jede Antwort unter `/api/v1` (und den Body jeder erfolgreichen Anfrage) mit `opis/json-schema` gegen das erzeugte Dokument; die Bereiche werden Task für Task streng geschaltet. Rate-Limit und Body-Limit sind Middleware vor Auth bzw. vor dem Parsen.

**Tech Stack:** wie Phase 11; neu `dedoc/scramble`, `spatie/laravel-query-builder`, dev `opis/json-schema` (siehe „Paketversionen“).

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterium 2 (per REST), 8 (Doku API); 2 Anti-Ziele „API und MCP hinken hinterher“, „Doppelte Logik“, „Datenlecks“; 3 Zeile „REST“; **6.1 komplett**; 7.2 Actions, 7.5 Datenlecks und Throttle vor Auth; 9 „OpenAPI-Vollständigkeit“; 10 Doku „API (mit Verweis auf `/api/docs`)“; „Änderungen vom …“ zu 6.1: Tokens und `/me/*` nur aus der Sitzung (2026-10-31), Workflow eines Projekts per `PUT …/workflow`, Rich Text in zwei Formen, Beschreibung ohne Version, Sprache der API (Phase 4), Lese-POSTs (Phase 5), Personen-Treffer (Phase 6), Reaktionen (Phase 7), Baum und Versionen, Speichern ohne Basis (Phase 9), Test-Ping und „erneut senden“ (Phase 11)), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Verträge „Fehler“, „Resources“, „Routen“, „Konfiguration“, Phase 12), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A21, A31, A55, A59, A73, A75, A96, A139, A151, A157, A169, A172, A174, A203, A242, A283, A305, A308, A315, A367; „Für spätere Phasen vorgemerkt“, Zeile Phase 12 → Tasks 4, 6, 7, 10), Phase-1-Plan „Paketversionen“ (Scramble für Phase 12, Query Builder für Phase 5 geplant, nie installiert), `routes/api.php`, `tests/Feature/Api/routes.php`, `resources/js/api/*`.

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 12 entscheidend:

- Branch `feat/phase-12-api` von `main` nach dem Merge von Phase 11. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Neue Pakete nur die drei aus „Paketversionen“ (Task 1); `pnpm-lock.yaml` und `e2e/pnpm-lock.yaml` bleiben unverändert. Keine Config veröffentlichen (`vendor:publish`): Scramble und Query Builder werden im Code konfiguriert (`App\Providers\ApiServiceProvider`).
- **Keine Fachlogik im Dokument und in Controllern:** Controller bleiben dünn (Eingabe holen, `Actor::fromRequest()`, Action, Resource). Was eine Liste filtern und sortieren darf, steht nur in `ListSpec` der List-Action; das Dokument liest es von dort. Logik, die heute im Controller steht (`TokensController::owner()`), wandert in die Action.
- **Keine Verhaltensänderung der Actions außer den genannten** (Task 7 und die Listen-Parameter aus A386). Jede neue Action steht genau einmal in der Rechte-Matrix, jede neue Route unter `api/v1` genau einmal in `tests/Feature/Api/routes.php`, beides im Commit, der sie anlegt.
- **Keine Lecks:** ein Filter, eine Sortierung oder ein `include` engt nur den Bereich ein, den die Action ohnehin liest (Sichtbarkeit zuerst, dann der Query Builder); unsichtbare IDs in `filter[…]` treffen nichts (P3 aus Phase 5), nie 404 und nie eine Zahl. Das OpenAPI-Dokument enthält keine Daten der Instanz (keine Beispiele aus der Datenbank, keine Namen, keine Hosts außer `APP_URL`).
- **Fehler bleiben Problem Details (RFC 9457)** mit `reason` aus `ProblemResponse::SLUGS` bzw. `Problem`; neue Feldmeldungen unter `field.*`, neue Sätze unter `problem.detail.*`, in `lang/en.json` und `lang/de.json`.
- **OpenAPI ist Englisch** (Summary, Beschreibungen, Tags); Doku-Seiten en + de. Kein Text des Dokuments kommt aus `lang/*.json`.
- **Das Dokument ist ein Vertrag, kein Schmuck:** jede Antwort, die ein Feature-Test unter `/api/v1` bekommt, muss zum Dokument passen (Status dokumentiert, Body valide, keine undokumentierten Schlüssel in Objekten außer an mit `x-werkbuch-open` markierten Stellen); der Body jeder 2xx-Anfrage muss zum dokumentierten Request-Schema passen (A385). Ein Test, der diese Prüfung ausschaltet, braucht einen Grund im Kommentar.
- Abdeckung 100 % Zeilen PHP (auch `app/OpenApi/`) und Frontend; Larastan Level 8, Pint, `tsc`. `ArchTest`: `App\OpenApi` final, ohne `DB`, ohne `EventRecorder`, ohne `App\Actions` außer den statischen `spec()`-Aufrufen über `ListOf`.
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert (RED zuerst belegen).
- Demo- und Testdaten nur fiktiv. `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Dokument zu weit, Vertrag grün ohne Aussage:** ein Schema `{}` oder ein Objekt ohne `properties` lässt jede Antwort durch; ein `type: string` an einem Feld, das `null` sein kann, oder ein als Pflicht markiertes Feld, das bei schlanken Items fehlt (`description`, `values_markdown`, A174), fällt erst bei Clients auf. → Task 3 (`OpenApiDocumentTest`: kein leeres Schema außer `x-werkbuch-open`; das Harness setzt `additionalProperties: false` auf jedes Objekt-Schema einer Antwort), Tasks 8–12 (je Bereich ein Test mit schlankem und vollem Item, mit `null` in jedem nullable Feld).
- **Cursor einer anderen Liste:** ein `next_cursor` von `sort=name` mit `sort=-name` oder mit anderem `per_page`/Filter weiterverwendet liefert sonst still die falsche Seite; ein manipulierter Cursor wird ein 500. → Task 4 (`ListQueryTest`: „refuses the cursor of another sort“, „refuses a cursor with an unknown column“, „takes the cursor of the same list with another per_page“).
- **Rate-Limit vor Auth:** ein ungültiges oder abgelaufenes Token, ein Token eines deaktivierten Kontos und eine Flut von 401 zählen je IP und verbrauchen nie das Kontingent eines gültigen Tokens; zwei Tokens desselben Kontos zählen getrennt; die Sitzung der Oberfläche zählt je Konto, nicht je IP (Büro hinter NAT); das 429 kommt als Problem in der Sprache des Kontos mit `Retry-After`. → Task 6 (`ApiRateLimitTest`).
- **Body-Limit vor dem Parsen:** ein JSON-Body über der Grenze ohne `Content-Length` (chunked), mit falschem `Content-Type` (`text/plain`) oder mit `Content-Type: application/json; charset=utf-8` wird 413, bevor `TrimStrings` ihn dekodiert; ein Upload (multipart) über der JSON-Grenze, aber unter `ATTACHMENTS_MAX_MB`, geht durch. → Task 6 (`JsonBodyLimitTest`).
- **Filter als Orakel:** `filter[lead_id]=<Person>` über Projekte, `filter[project_id]=<privates Projekt>` über Vorlagen oder Webhooks, `include=members` an einem öffentlichen Projekt für Außenstehende und `sort` auf eine Spalte, die nur Admins sehen, verraten nichts über Unsichtbares (gleiche Antwort wie mit einer unbekannten ID). → Task 5 (je Liste ein Test „a filter on something hidden answers like an unknown id“).

## Gates

Regel A249:

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`.
- **G2 (Frontend), je Task mit `resources/js`:** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage`.
- **G3 gezielt, je Task mit Frontend oder e2e:** `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <specs>`.
- **G3 voll, genau einmal je Phase:** nach Task 16, im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build`.

---

## Paketversionen

Geprüft am 2026-11-06 auf Packagist:

| Paket | Version | Task | Hinweis |
|---|---|---|---|
| `dedoc/scramble` | `^0.13.53` (vom 2026-11-03; `illuminate/contracts ^10–^13`, PHP ^8.1) | 1 | weiter 0.x: Task 1 prüft die Namen der Extension-Schnittstellen (`OperationExtension::handle(Operation, RouteInfo)`, `StaticMethodReturnTypeExtension`, `TypeToSchemaExtension`, `withDocumentTransformers`, `Scramble::configure()->expose(ui:, document:)`, Attribute `QueryParameter`, `BodyParameter`, `PathParameter`, `HeaderParameter`, `Response`, `Group`, `Endpoint`) gegen den Quelltext der installierten Version; weichen sie ab, ändert sich der Name im Plan, nicht das Ergebnis. Standard ist OpenAPI 3.1 (`OpenApiVersion::V3_1`), die Erzeugung läuft über `CacheableGenerator`. |
| `spatie/laravel-query-builder` | `^7.3.7` (vom 2026-10-26; PHP ^8.4, `illuminate/* ^12\|^13`) | 1, 4 | `QueryBuilder::for($builder, $request)`; `InvalidFilterQuery`/`InvalidSortQuery`/`InvalidIncludeQuery` sind 400-`HttpException`s: `ListQuery` fängt sie und wirft 422 (A386). Parameternamen der Standard-Config (`filter`, `sort`, `include`) bleiben. |
| `opis/json-schema` (dev) | `^2.6` (2.6.1 vom 2026-11-06, 2.6.0 vom 2025-10-17) | 3 | Draft 2020-12 (= Schema-Dialekt von OpenAPI 3.1). 2.6.1 ist vom Tag der Planung: scheitert die Installation oder ein Test am Paket, `2.6.0` pinnen und als Ruling festhalten. |

Geprüft und verworfen (A384): `lokiwich/scramble-spatie-query-builder` 0.1.0 (eine Version, 315 Downloads), `exonn-gmbh/scramble-spatie-query-builder` 1.0.5 (nur Query Builder ≤ 6 und Scramble ≤ 0.12), `pjadanowski/scramble-extras` 0.4.0 (verlangt `spatie/laravel-data`), `league/openapi-psr7-validator` 0.24 und `osteel/openapi-httpfoundation-testing` 0.15 (PSR-7-Umweg, OpenAPI 3.1 nur teilweise).

## Konventionen der API (gelten für alle Tasks)

| Thema | Regel |
|---|---|
| Dokument | `GET /api/openapi.json` (OpenAPI 3.1, `info.version` = `config('werkbuch.version')`, `servers` = `[{url: APP_URL + '/api/v1'}]`), UI `GET /api/docs` (Scramble, Stoplight Elements); beide ohne Anmeldung, Drossel `api` (A389) |
| Sicherheit | `securitySchemes`: `token` (HTTP Bearer, Format `<id>\|wb_<geheimnis>`), `session` (Cookie der Oberfläche mit `X-XSRF-TOKEN`); je Operation `security: [{token: []}, {session: []}]`, Routen mit `EnsureSession` nur `[{session: []}]` |
| Fähigkeit | je Operation `x-werkbuch-ability`: `read` für `GET`/`HEAD` und Routen mit `defaults('token_ability', 'read')`, sonst `write`; `x-werkbuch-session-only: true` bei `EnsureSession` |
| Fehler | Komponente `Problem` `{type, title, status, reason, detail?, errors?: {pfad: list<string>}}` plus offene Erweiterungen (`current`, `states`, `projects`, `issues`, `extensions` …; `x-werkbuch-open`); Medientyp `application/problem+json`; jede Operation dokumentiert `401`, `403`, `404`, `422`, `429`, `500`, Schreib-Operationen zusätzlich `409` und `413`, über `ProblemResponses` (A385: „dokumentiert“ heißt „kann vorkommen“) |
| Listen | `{data: list<X>, links: {first, last, prev, next}, meta: {path, per_page, next_cursor, prev_cursor, total}}`; Query `cursor`, `per_page` (1–100, Standard 100), `filter[<name>]`, `sort` (Komma, `-` absteigend), `include` (Komma); unbekannte Namen → 422 an `filter`/`sort`/`include`; Flags wie `include_archived` bleiben eigene Parameter (A386) |
| Cursor | trägt die Signatur der Sortierung (`_sig`); ein Cursor einer anderen Sortierung oder ein unlesbarer → 422 `field.cursor.invalid` an `cursor` |
| Grenzen | 600 Anfragen/min je gültigem Token, sonst je Konto der Sitzung, sonst je IP (`config('werkbuch.rate_limits.api')`, Env `API_RATE_LIMIT`, A387); Antwort-Header `X-RateLimit-Limit`, `X-RateLimit-Remaining`, beim 429 `Retry-After`; JSON-Body höchstens `LimitJsonBody::MAX_BYTES` 2 MiB (A388) |
| Pfad-Parameter | `{item}`: ULID oder Key (`WEB-12`, jede Schreibweise, auch frühere Kennung; ein `GET` mit früherem Key antwortet 301); `{project}`: ULID, Kennung oder frühere Kennung; alle anderen: ULID in jeder Schreibweise |
| Rich Text | Felder in zwei Formen (`description` Markdown, `description_json` Tiptap-JSON), schreiben in einer; Komponente `RichTextDocument` (`{type: 'doc', content?: list<object>}`, `x-werkbuch-open`) |
| Stabilität | `/api/v1` ändert sich nur additiv (neue Felder, Routen, Filter); Clients übergehen unbekannte Felder (A390) |

## Listen und ihre Regeln (`ListSpec`, A386)

Alle Sortierungen enden auf `id`; sortierbar sind nur Spalten, die nie `null` sind. „fest“ = keine Filter, keine Sortierung (ein `sort` ist 422).

| Route | Action | `filter[…]` | `sort` (Standard zuerst) | `include` | Bisherige Parameter → neu |
|---|---|---|---|---|---|
| `GET /users` | `ListUsers` | `type` (`person`, `bot`), `disabled` (bool) | `-type` (Personen zuerst), `name`, `handle`, `created_at` | – | `type` → `filter[type]` |
| `GET /bots` | `ListUsers` (der Controller setzt `filter[type]=bot` fest) | `disabled`, `owner_id` | `name`, `created_at` | – | – |
| `GET /invitations` | `ListInvitations` | `org_role` | `-created_at`, `expires_at` | – | – |
| `GET /tokens` | `ListTokens` | `user_id` (Besitzer; fehlt = eigenes Konto) | `-created_at`, `name` | – | `user_id` → `filter[user_id]` |
| `GET /projects` | `ListProjects` | `visibility`, `lead_id`, `workflow_id`, `member` (bool: Konto ist Mitglied) | `name`, `identifier`, `created_at`, `updated_at` | `members` | `include_archived` bleibt |
| `GET /projects/{project}/members` | `ListMembers` | `role`, `type` | `name` | – | – |
| `GET /workflows`, `/work-item-types`, `/properties`, `/labels`, `/relation-types` | `List…` | `name` (enthält); Typen `is_epic`, `archived`; Properties `field_type`; Relationstypen `built_in` | `name`, `created_at` | – | – |
| `GET /resolutions` | `ListResolutions` | `default_for`, `archived` | `position`, `label` | – | – |
| `GET /views` | `ListViews` | `created_by`, `name` (enthält) | `name`, `created_at`, `updated_at` | – | – |
| `GET /templates`, `/projects/{project}/templates` | `ListTemplates` | `project_id` (nur die erste Route), `scheduled` (bool) | `name`, `created_at` | – | `project` → `filter[project_id]` |
| `GET /webhooks` | `ListWebhooks` | `project_id`, `active`, `bot_id` | `name`, `created_at` | – | – |
| `GET /webhooks/{webhook}/deliveries` | `ListWebhookDeliveries` | `event`, `kind`, `succeeded` (bool) | fest (neueste zuerst) | – | – |
| `GET /notifications` | `ListNotifications` | `unread` (bool), `kind` (Liste der Arten) | fest (neueste zuerst) | – | `unread_only` → `filter[unread]=1`, `mentions_only` → `filter[kind]=mentioned` |
| `GET /favorites`, `/work-items/{item}/comments`, `…/history`, `/pages/{page}/versions`, `/templates/{template}/runs` | `List…` | fest | fest | – | – |

Nicht über `ListSpec`: `GET /work-items` und `POST /work-items/query|groups|counts` (Filter-Engine der Views, Phase 5), `GET /search`, `GET /projects/{project}/pages` (Baum, A315), `GET /work-items/{item}/relations`, `…/subscribers`, `GET /mentions`, `GET /references`, `GET /state-usage`, `GET /projects/{project}/automations`, `GET /notification-preferences`. Ihre Parameter beschreiben Attribute und `ItemQueryDocs` (Task 10).

## Dateistruktur nach Phase 12

| Ort | Inhalt |
|---|---|
| `app/Providers/ApiServiceProvider.php` | Scramble (Routen `api/v1/*`, `expose(ui: 'api/docs', document: 'api/openapi.json')`, Middleware `throttle:api`, Extensions, Transformer, Info), Limiter `api` |
| `app/OpenApi/` | `ApiListReturnType` (Infer-Extension für `ApiList::respond`), `ApiListSchema` (Schema der Listen), `ListParameters` (Operation: `#[ListOf]` → Query-Parameter), `Abilities` (Operation: Sicherheit, `x-werkbuch-*`), `ProblemResponses` (Operation: Fehlerantworten), `PathParameters` (Operation: Beschreibung der Platzhalter), `ItemQueryDocs` (Operation: Kurzform und Body der Item-Abfragen), `Components` (Dokument: `Problem`, `RichTextDocument`, `Filter`, `Display`, `ListLinks`, `ListMeta`, Security Schemes), `Schemas` (Fabrik der Komponenten aus `App\Domain\Filter\Op`, `CoreField`, `DisplaySchema::FIELDS`, `ItemQueryInput::BODY_KEYS`, `Shorthand::KEYS`) |
| `app/Http/Api/ListOf.php` | Attribut `#[ListOf(ListUsers::class)]` an Index-Methoden |
| `app/Support/{ListSpec,ListFilter,ListQuery,SignedCursor}.php`, `app/Support/ListResult.php` (geändert) | Listenregeln, Query Builder, signierter Cursor |
| `app/Http/Middleware/LimitJsonBody.php`, `app/Http/Api/RateKey.php` | Body-Limit, Schlüssel der Drossel |
| `tests/Support/OpenApi/{Document,Contract,RecordContract}.php` | erzeugtes Dokument, Prüfung, Middleware des Harness |
| `tests/Feature/OpenApi/{OpenApiDocumentTest,OpenApiAbilitiesTest,ListParametersTest,ApiDocsRoutesTest}.php` | Vollständigkeit, Fähigkeiten, Parameter, Routen |
| `tests/Feature/Api/{ListQueryTest,ApiRateLimitTest,JsonBodyLimitTest,ApiGapsTest,UiApiCoverageTest,ApiFlowTest}.php` | Listen, Grenzen, Lücken, Abnahme |
| `docs/{en,de}/api.md` | Doku |

---

### Task 1: Pakete, Scramble-Gerüst, Routen der Doku

**Modell:** opus

**Files:**
- Create: `app/Providers/ApiServiceProvider.php`, `tests/Support/OpenApi/Document.php`, `tests/Feature/OpenApi/{OpenApiDocumentTest,ApiDocsRoutesTest}.php`
- Modify: `composer.json`, `composer.lock`, `bootstrap/providers.php`, `tests/Unit/ArchTest.php`, `CLAUDE.md` (Tech Stack, Kommandos `ddev artisan scramble:export --path=storage/app/openapi.json` zum Ansehen)

**Interfaces:**
- Produces:
  - `ApiServiceProvider::boot()`: `Scramble::configure()->routes(fn (Route $r) => str_starts_with($r->uri(), 'api/v1/'))`, `->expose(ui: 'api/docs', document: 'api/openapi.json')`, Middleware der beiden Routen `['throttle:api']` (kein `web`, keine Sitzung, kein `RestrictedDocsAccess`), `info.version` aus `config('werkbuch.version')`, `info.description` ein kurzer Absatz (Auth, Fehler, Listen, Link auf die Doku), `servers` aus `config('app.url').'/api/v1'`; Scramble `api_path` `api/v1` (Pfade im Dokument ohne Präfix: `/work-items/{item}`).
  - `Tests\Support\OpenApi\Document::get(): array` (das Dokument als Array, einmal je Prozess erzeugt über Scramble selbst, nicht über HTTP), `::operation(string $method, string $uri): ?array` (`$uri` wie `Route::uri()` ohne `api/v1`), `::operations(): array<string, array>` (Schlüssel `"<METHOD> <pfad>"`).
- Consumes: –

- [ ] **Step 1: Pakete** — `ddev composer require dedoc/scramble:^0.13.53 spatie/laravel-query-builder:^7.3.7` und `ddev composer require --dev opis/json-schema:^2.6`. Im Quelltext unter `vendor/dedoc/scramble` die Schnittstellen aus „Paketversionen“ nachsehen und die tatsächlichen Namen als Kommentar oben in `ApiServiceProvider` notieren.
- [ ] **Step 2: Failing Tests** — `ApiDocsRoutesTest`: „serves the document without signing in“ (`GET /api/openapi.json` → 200 JSON, `openapi` beginnt mit `3.1`, `info.version` = `config('werkbuch.version')`, `servers[0].url` = `APP_URL/api/v1`); „serves the docs page without signing in“ (`GET /api/docs` → 200 HTML mit `/api/openapi.json` oder dem Dokument inline); „keeps web routes out of the document“ (kein Pfad `/login`, `/media/…`, `/broadcasting/…`, `/attachments/{attachment}` der Web-Route); „throttles the docs like the API“ (Limiter `api` an beiden Routen, über `Route::getRoutes()` geprüft). `OpenApiDocumentTest` „documents every route under api/v1“: für jede Route mit Präfix `api/v1/` und jeder Methode außer `HEAD` gibt es `Document::operation()` (Pfad mit gleichen Platzhaltern), und umgekehrt kein Pfad ohne Route.
- [ ] **Step 3: Rot, implementieren, grün** — `ddev artisan test --filter='OpenApi|ArchTest'`. `ArchTest`: `App\OpenApi` final, ohne `Illuminate\Support\Facades\DB`, ohne `App\Events\EventRecorder`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add scramble with the docs at /api/docs and /api/openapi.json`.

---

### Task 2: Sicherheit, Fähigkeiten, Fehler und Pfade im Dokument

**Modell:** opus

**Files:**
- Create: `app/OpenApi/{Abilities,ProblemResponses,PathParameters,Components,Schemas}.php`, `tests/Feature/OpenApi/OpenApiAbilitiesTest.php`
- Modify: `app/Providers/ApiServiceProvider.php`, `tests/Feature/OpenApi/OpenApiDocumentTest.php`

**Interfaces:**
- Produces:
  - `Abilities` (OperationExtension): liest die Route aus `RouteInfo` (Methode, `defaults['token_ability']`, Middleware `EnsureSession`) und setzt `security`, `x-werkbuch-ability`, `x-werkbuch-session-only` wie in „Konventionen“.
  - `ProblemResponses` (OperationExtension): ergänzt die Fehlerantworten aus „Konventionen“ als `$ref: '#/components/responses/Problem<Status>'`, ohne vorhandene Antworten desselben Status zu ersetzen; `429` mit Header `Retry-After`; jede 2xx-Antwort bekommt die Header `X-RateLimit-Limit`, `X-RateLimit-Remaining`; jede `GET`-Operation mit `{item}` zusätzlich `301` mit Header `Location` (`RedirectFormerItemKey`).
  - `PathParameters` (OperationExtension): Beschreibung und `schema` je Platzhalter (siehe „Konventionen“); `{item}` und `{project}` ohne `pattern`, alle anderen mit `pattern` `^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$`.
  - `Components` (Document-Transformer) und `Schemas::problem(): array`, `::richTextDocument(): array`, `::listLinks(): array`, `::listMeta(): array` (je ein Schema-Array; die Transformer legen sie unter `components.schemas` ab, `components.securitySchemes` `token`, `session`).
- Consumes: Task 1.

- [ ] **Step 1: Failing Tests** — `OpenApiAbilitiesTest` „says the ability of every route like the route matrix“: für jede Zeile aus `tests/Feature/Api/routes.php` ist `x-werkbuch-ability` der Operation `ability` der Zeile bzw. die Regel der Methode, und `x-werkbuch-session-only` genau bei `'session' => true`; „offers only the session for session routes“ (`POST /tokens`, `/me/*`: `security` = `[{session: []}]`). `OpenApiDocumentTest`: „describes the problem shape“ (`components.schemas.Problem` hat `required` `[type, title, status, reason]`, `errors` als Objekt aus Listen von Texten); „documents the errors of every operation“ (jede Operation hat 401, 403, 404, 422, 429, 500; jede schreibende 409, 413); „says what an item path takes“ (Beschreibung von `{item}` nennt Key und ULID).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter=OpenApi`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: describe tokens, abilities, problems and path parameters in the openapi document`.

---

### Task 3: Vertrags-Harness: jede Antwort gegen das Dokument

**Modell:** opus

**Files:**
- Create: `tests/Support/OpenApi/{Contract,RecordContract}.php`, `tests/Feature/OpenApi/ContractTest.php`
- Modify: `tests/TestCase.php`, `tests/Feature/OpenApi/OpenApiDocumentTest.php`, `CLAUDE.md` (Fallstricke: Harness)

**Interfaces:**
- Produces:
  - `Tests\Support\OpenApi\RecordContract` (Middleware, im Test-Kernel per `prependMiddleware` in `TestCase::setUp`, nur für Pfade `api/v1/*`): nach `$next` liest sie `Route::current()` (Methode, URI-Muster) und gibt Anfrage und Antwort an `Contract::check`.
  - `Contract::check(Request $request, Response $response): void` sammelt Verstöße in einer statischen Liste: Status nicht dokumentiert; Antwort-Body (JSON) nicht valide gegen das Schema des Status und Medientyps (opis, Draft 2020-12, `$ref` über das ganze Dokument aufgelöst); bei 2xx und JSON-Body: Body nicht valide gegen das Request-Schema. Vor dem Prüfen setzt es in jedem Objekt-Schema ohne `x-werkbuch-open` `additionalProperties: false` (A385). Multipart-Bodies und Antworten ohne JSON (Dateien, 204) prüft es nur auf den Status.
  - `Contract::STRICT_TAGS: list<string>` (zu Beginn `[]`): nur Operationen mit einem dieser Tags erzeugen Verstöße; Tasks 8–12 tragen ihre Tags ein, Task 14 ersetzt die Liste durch „alle“ und löscht die Konstante.
  - `Contract::violations(): list<string>` (je Zeile `"<METHOD> <uri> <status>: <Pfad im Body>: <Fehler>"`), `Contract::reset()`, `Contract::off(string $reason)` (für einen Test; der Grund steht im Aufruf). `TestCase::tearDown` prüft `Contract::violations() === []` und scheitert mit der Liste.
- Consumes: Task 1 (`Document`), Task 2.

- [ ] **Step 1: Failing Tests** — `ContractTest` mit einem Dokument aus dem Test (`Contract::using(array $document)`): „reports an undocumented status“, „reports a key the schema does not name“, „accepts a key under an open schema“, „reports a wrong type of a nullable field“ (`string` statt `["string","null"]`), „checks the request body only for a success“ (422 mit falschem Body → kein Verstoß, 200 mit undokumentiertem Schlüssel → Verstoß), „skips a multipart body“, „lets a test switch it off with a reason“. `OpenApiDocumentTest` „has no empty schema“: kein Schema `{}` und kein `type: object` ohne `properties`, `additionalProperties` oder `x-werkbuch-open`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='OpenApi|ContractTest'`; danach die ganze Suite: mit leerer `STRICT_TAGS` grün.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `test: check every api response of the feature tests against the openapi document`.

---

### Task 4: Listen: `ListSpec`, Query Builder, signierter Cursor, Listen im Dokument

**Modell:** opus

**Files:**
- Create: `app/Support/{ListSpec,ListFilter,ListQuery,SignedCursor}.php`, `app/Http/Api/ListOf.php`, `app/OpenApi/{ApiListReturnType,ApiListSchema,ListParameters}.php`, `tests/Feature/Api/ListQueryTest.php`, `tests/Feature/OpenApi/ListParametersTest.php`
- Modify: `app/Support/ListResult.php`, `app/Http/Api/ApiList.php` (nur Kommentar), `app/Providers/ApiServiceProvider.php`, `lang/{en,de}.json`, `tests/Feature/Api/ApiListTest.php`

**Interfaces:**
- Produces:
  - `final readonly class ListFilter { static exact(string $name, ?string $column = null, ?list<string> $values = null): self; static partial(string $name, ?string $column = null): self; static boolean(string $name, ?string $column = null): self; static scope(string $name, string $type, Closure(Builder, mixed): void $apply): self; /* name, kind, column, values, type */ }` (`type` für das Dokument: `string`, `boolean`, `list<string>`; `values` wird `enum`).
  - `final readonly class ListSpec { __construct(array<string, ListFilter> $filters = [], array<string, string> $sorts = [] /* name → Spalte */, list<string> $default = [] /* `-type`, `name` … */, list<string> $includes = []); static fixed(): self; }`.
  - `ListQuery::apply(Builder $query, array $input, ListSpec $spec): array{0: Builder, 1: string}` baut über `QueryBuilder::for($query, Request::create('/', 'GET', $input))` mit `allowedFilters`, `allowedSorts`, `defaultSort`, `allowedIncludes`, hängt `orderBy(<tabelle>.id)` an und gibt die Signatur zurück (`"name:asc,id:asc"`). Fängt `InvalidFilterQuery` → 422 `field.list.filter` an `filter` (`:name`, `:allowed`), `InvalidSortQuery` → `field.list.sort` an `sort`, `InvalidIncludeQuery` → `field.list.include` an `include`; ein Filterwert der falschen Form (nicht in `values`, kein Boolean nach Laravels `boolean`) → `field.list.filter_value` an `filter.<name>`; alle Fehler in einer 422.
  - `ListResult::of(Builder $query, PageArgs $args, string $signature = ''): self` — liest den Cursor über `SignedCursor::decode(?string $encoded, string $signature): ?Cursor` (unlesbar, ohne oder mit anderem `_sig` → 422 `field.cursor.invalid`; jede `UnexpectedValueException` ebenso, Vormerkung Phase 2) und schreibt `next_cursor`/`prev_cursor` mit `_sig` (`SignedCursor::encode(Cursor, string): string`).
  - `#[ListOf(class-string $action)]` (Attribut an Controller-Methoden); jede List-Action mit `ListSpec` hat `public static function spec(): ListSpec`.
  - `ApiListReturnType` (Scramble `StaticMethodReturnTypeExtension` für `ApiList::respond($result, X::class)`) und `ApiListSchema` (`TypeToSchemaExtension`): Antwort 200 `{data: list<X>, links: ListLinks, meta: ListMeta}`, `required` alle drei.
  - `ListParameters` (OperationExtension): für Methoden mit `#[ListOf]` die Query-Parameter `cursor`, `per_page` (`integer`, 1–100, Standard 100), je Filter `filter[<name>]` (Typ, `enum`), `sort` (Beschreibung mit allen Namen und `-`), `include` (`enum`), ohne Spec nur `cursor`/`per_page`.
- Consumes: Task 1–3.

- [ ] **Step 1: Failing Tests** — `ListQueryTest` (an `ListLabels` mit einer Test-Spec über `Label`): „filters exactly, partly and by a boolean“; „sorts by name both ways and ends on the id“; „refuses an unknown filter, sort and include in one 422“ (Pfade `filter`, `sort`, `include`, Sätze mit `:allowed`); „refuses a filter value outside its values“ (`filter.type`); „refuses the cursor of another sort“ (Cursor von `sort=name` mit `sort=-name` → 422 `cursor`); „refuses a cursor with an unknown column and a broken one“ (beides 422, nie 500); „takes the cursor of the same list with another per_page“; „keeps the filters in links.next“. `ListParametersTest`: „documents the filters, sorts and includes of a list from its spec“ (eine Test-Spec, ein Test-Controller mit `#[ListOf]` über eine Test-Route im Test registriert und Scramble neu erzeugt); „documents the list shape for ApiList::respond“ (`meta.total` Pflicht).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ListQuery|ListParameters|ApiListTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: add list specs with query builder filters, sorts, includes and signed cursors`.

---

### Task 5: Jede normale Liste über `ListSpec`

**Modell:** sonnet

**Files:**
- Modify: die List-Actions der Tabelle „Listen und ihre Regeln“ (`app/Actions/{Users,Invitations,Tokens,Projects,Workflows,WorkItemTypes,Properties,Labels,RelationTypes,Resolutions,Views,Templates,Webhooks,Notifications,Favorites,Comments,Pages}/List*.php`, `app/Actions/WorkItems/ListHistory.php`), ihre Controller (`#[ListOf]`, `TokensController::owner()` entfällt), `resources/js/api/{users,tokens,templates,notifications}.ts` und ihre Tests, `lang/{en,de}.json`, die betroffenen Feature-Tests (`tests/Feature/{Users,Tokens,Templates,Notifications,Projects}/*`, `tests/Feature/Api/*ApiTest.php`)
- Create: `tests/Feature/Api/ListSpecsTest.php`

**Interfaces:**
- Produces: je List-Action `spec(): ListSpec` nach der Tabelle; `ListTokens::handle(Actor $actor, array $input)` liest den Besitzer aus `filter.user_id` (ULID in jeder Schreibweise über `Ids::normalize`, keine ULID oder unbekannt → 404, Vormerkung Phase 2), `CreateToken::handle(Actor $actor, array $input)` aus `user_id` ebenso; `ListNotifications` nimmt `filter[unread]` und `filter[kind]` statt `unread_only`/`mentions_only`; `ListTemplates` `filter[project_id]` statt `project` (Referenz wie bisher: ULID, Kennung, frühere Kennung). Im Browser: `listUsers({ type })` → `filter[type]`, `listTokens({ user_id })` → `filter[user_id]`, `listNotifications({ unread_only, mentions_only })` → `filter[unread]`/`filter[kind]` (die Signaturen der Funktionen bleiben, nur die Query ändert sich), `listTemplates({ project })` → `filter[project_id]`.
- Consumes: Task 4.

- [ ] **Step 1: Failing Tests** — `ListSpecsTest` je Liste: ein Filter und eine Sortierung der Tabelle wirken; der alte Parameter wird übergangen (Antwort wie ohne); „a filter on something hidden answers like an unknown id“ für `projects?filter[lead_id]=<Person nur in einem privaten Projekt>`, `templates?filter[project_id]=<privates Projekt>`, `webhooks?filter[project_id]=<Projekt in Löschung>` (Review Focus 5); „includes the members only of visible projects“ (`projects?include=members` als Außenstehender eines öffentlichen Projekts: Mitglieder wie `GET …/members`); „finds the tokens of a bot by an upper-case ULID“. Vitest: die vier API-Dateien schicken die neuen Parameter.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ListSpecs|Api|Users|Tokens|Templates|Notifications|Projects'`; `ddev exec pnpm vitest run resources/js/api`.
- [ ] **Step 3: Gates G1, G2**; G3 gezielt `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test inbox settings-organization templates settings-personal`.
- [ ] **Step 4: Commit** — `feat: filter, sort and include every plain list through its list spec`.

---

### Task 6: Rate-Limit und Body-Limit

**Modell:** opus

**Files:**
- Create: `app/Http/Api/RateKey.php`, `app/Http/Middleware/LimitJsonBody.php`, `tests/Feature/Api/{ApiRateLimitTest,JsonBodyLimitTest}.php`
- Modify: `app/Providers/ApiServiceProvider.php` (Limiter `api`), `bootstrap/app.php` (`throttle:api` in die Gruppe `api`; `LimitJsonBody` als globale Middleware vor `TrimStrings`), `config/werkbuch.php` (`'api' => (int) env('API_RATE_LIMIT', 600)`), `.env.example`, `e2e/ci.env` (unverändert 600, Kommentar), `app/Exceptions/Rendering.php` (falls das 429 der Gruppe noch keinen `reason` hat), `lang/{en,de}.json` (`problem.detail.json_too_large` „Ein JSON-Body darf höchstens :max MB groß sein.“), `tests/Feature/ConfigTest.php`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `RateKey::for(Request $request): string` — `token:<id>` für ein Bearer-Token, das `PersonalAccessToken::findToken` findet und nicht abgelaufen ist (das Konto muss nicht aktiv sein: es scheitert danach an `EnsureAccountIsActive`, verbraucht aber nur sein eigenes Kontingent), sonst `user:<id>` für die Sitzung der Oberfläche (Guard `web`), sonst `ip:<ip>` (A387). Limiter `api`: `Limit::perMinute(config('werkbuch.rate_limits.api'))->by(RateKey::for($request))`.
  - `LimitJsonBody::MAX_BYTES = 2 * 1024 * 1024`; `handle()`: nur Pfade `api/*`; Anfragen mit Body, deren `Content-Type` nicht `multipart/form-data` ist: `Content-Length` > MAX → 413 sofort; sonst `strlen($request->getContent())` > MAX → 413; Problem `payload_too_large` mit `problem.detail.json_too_large` (`:max` 2) über `Problem::tooLarge`.
- Consumes: Task 2 (429/413 im Dokument).

- [ ] **Step 1: Failing Tests** — `ApiRateLimitTest` (Limit per `config(['werkbuch.rate_limits.api' => 3])` vor dem Booten der Drossel; Uhr fest): „answers 429 with Retry-After after the limit of a token“ (Problem `too_many_requests` in der Sprache des Kontos, Header `X-RateLimit-Limit` 3, `X-RateLimit-Remaining` 0, `Retry-After`); „counts two tokens of one account apart“; „counts the session per account, not per address“ (zwei Konten von derselben IP je eigenes Kontingent); „counts an unknown, an expired and a revoked token per address“ und „never spends the quota of a valid token on them“; „counts the requests a route throttle refuses too“ (`attachments`); „throttles the docs per address“. `JsonBodyLimitTest`: „refuses a json body above 2 MiB with 413 before it is parsed“ (Spion auf `TrimStrings` bzw. die Action läuft nie); „refuses it without Content-Length“; „refuses text/plain and json with a charset alike“; „lets a multipart upload above 2 MiB through“ (unter `ATTACHMENTS_MAX_MB`); „lets 2 MiB exactly through“; „leaves web routes alone“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RateLimit|JsonBodyLimit|ConfigTest|Attachments'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: limit the api to 600 requests a minute per token and json bodies to 2 MiB`.

---

### Task 7: Lückenschluss und Vormerkungen

**Modell:** opus

**Files:**
- Create: `app/Actions/Users/{GetUser,GetMe}.php`, `app/Actions/{Workflows/GetWorkflow,WorkItemTypes/GetWorkItemType,Properties/GetProperty,Labels/GetLabel,RelationTypes/GetRelationType,Resolutions/GetResolution}.php`, `app/Http/Controllers/Api/MeController.php`, `tests/Feature/Api/{ApiGapsTest,UiApiCoverageTest}.php`
- Modify: `routes/api.php`, die sechs Katalog-Controller und `UsersController` (`show`; `org_role` als Text gecastet, Vormerkung), `app/Http/Resources/UserResource.php` (nur Doku), `app/Actions/Users/{UpdateUser,DeactivateUser}.php`, `app/Actions/Auth/SetPassword.php`, `app/Actions/WorkItems/CountWorkItems.php`, `app/Actions/Favorites/ToggleFavorite.php`, `app/Actions/Users/UpdateUser.php` (`owner_id` eines Bots), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Feature/Api/ProjectRightsTableTest.php`, `tests/Feature/Api/{MembersApiTest,DeactivateUserTest}.php` (Kommentare), `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `GET /api/v1/me` → `{data: User, permissions: list<string>}` (`GetMe::handle(Actor $actor): User`; `permissions` = `Grants::of()` der Org-Rolle wie `auth.permissions` der Oberfläche); außerhalb der Gruppe `EnsureSession` (ein Lese-Token darf es, A392); `GET /api/v1/users/{user}` → `{data: User}` (jedes aktive Konto liest jedes Konto, wie die Liste; `{user}` per ULID in jeder Schreibweise, sonst 404); `GET /api/v1/{workflows,work-item-types,properties,labels,relation-types,resolutions}/{id}` → `{data: …}` (lesen darf jedes Konto, wie die Listen).
  - `UpdateUser`: ein gesendetes `locale`/`timezone`, das der wirksamen geerbten Einstellung gleicht, während die gespeicherte `null` ist, ist keine Änderung (A391).
  - `DeactivateUser` löscht offene `password_reset_tokens` des Kontos; `SetPassword` lehnt ein deaktiviertes Konto ab (Vormerkung Phase 8; die Anmeldung war schon gesperrt).
  - `CountWorkItems::filters`: ein JSON-Objekt mit dem Namen `"0"` ist kein Listen-Fehler (der Controller holt `filters` aus `json_decode($request->getContent())`, ein Objekt bleibt `stdClass`; die Action wandelt `stdClass` in ein Array und lehnt nur echte JSON-Listen ab), und mehrere falsche Namen nennt die Meldung alle (`field.filters.names` mit `:names`).
  - `owner_id` eines Bots: `UpdateUser` behandelt `owner_id: null` wie `CreateBot` (fehlend = bisherige verantwortliche Person, `null` → 422 `field.owner_id.required`), Vormerkung Phase 2; `MemberInput` behält seinen Namen (Vormerkung erledigt, Kommentar an der Klasse).
  - `ToggleFavorite`: `field.id.required` für ein fehlendes `id`, `field.id.invalid` nur für ein falsches.
  - `UiApiCoverageTest`: jede Pfad-Vorlage in `resources/js/api/*.ts` (ohne Tests; `${…}` → Platzhalter) mit ihrer Methode trifft eine Route unter `api/v1` (Ausnahme nur `webPost('/broadcasting/batch')`).
- Consumes: Task 4 (Resources der Einzel-GETs gleich der Listen).

- [ ] **Step 1: Failing Tests** — `ApiGapsTest`: „tells a token who it belongs to“ (`GET /me` mit Lese-Token → das Konto und seine Rechte; ein Bot-Token → der Bot); „reads one account, also by an upper-case ULID“; „reads one entry of every catalog“ (je Katalog 200 wie das Element der Liste, unbekannt 404); „keeps the inherited language when the own answer comes back“ (`PATCH /users/{me}` mit der eigenen `UserResource` → `locale` bleibt `null`); „drops open reset links of a deactivated account“; „refuses a new password for a deactivated account“; „counts a filter named 0“; „names every wrong filter name“; „keeps the owner of a bot on null“. `ProjectRightsTableTest`: die Lücken `POST /projects`, `PATCH`/`DELETE …/members/{user}`, `POST …/restore`, „the lead has no rights of their own“. `UiApiCoverageTest` wie oben.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ApiGaps|UiApiCoverage|RightsMatrixTest|RouteMatrixTest|ProjectRightsTable|Users|CountWorkItems|Favorites'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: add GET /me and single reads of accounts and catalogs, close the api leftovers`.

---

### Tasks 8–12: Bereiche beschreiben und streng schalten

Gemeinsames Muster je Task (die Tasks unterscheiden sich nur im Bereich):

- **Controller:** je Klasse `#[Group('<Tag>', weight: n)]` (Tags unten), je Methode eine PHPDoc-Zeile als Summary (Englisch, Imperativ: „Create a label.“) und, wo nötig, ein Absatz Beschreibung (Rechte, besondere Antworten). Bodies über `#[BodyParameter(name, description, required, type)]` mit PHPDoc-Typen (verschachtelt als `array{…}`, Listen als `list<…>`), Query-Parameter über `#[QueryParameter]`, besondere Antworten über `#[Response(status, description, type)]` (201 beim Anlegen, 202 beim Löschen eines Projekts, 204, Antworten ohne `data` wie `{updated, rejected}`). Wiederkehrende Formen als Komponenten aus `Schemas` (`RichTextDocument`, `Filter`, `Display`, `Problem`) per `type: 'App\OpenApi\Schemas::<name>'`-Verweis bzw. über `Components` (wie es Task 1 bei Scramble vorfand).
- **Resources:** wo Scramble eine Form nicht erschließt (`(object)`-Casts, `$this->unless`, Arrays aus Hilfsmethoden, `toJSON()`), eine PHPDoc-Zeile `/** @var <Typ> */` über dem Schlüssel; Objekte mit freien Schlüsseln (`values`, `values_markdown`, `changes`, `settings`, `meta` der Problem-Erweiterungen) mit `x-werkbuch-open` über `Components`.
- **Strenge:** die Tags des Bereichs kommen in `Contract::STRICT_TAGS`; danach läuft die ganze Suite (`ddev artisan test`) und jeder Verstoß wird am **Dokument** behoben, außer das Dokument ist richtig und der Code weicht von Spec oder Ruling ab (dann ist es ein Befund: stoppen und melden).
- **Test je Bereich** in `tests/Feature/OpenApi/<Bereich>DocsTest.php`: (a) jede Operation des Bereichs hat Summary, Tag und ein 2xx-Schema; (b) ein voller und, wo es ihn gibt, ein schlanker Datensatz mit `null` in jedem nullable Feld bestehen den Vertrag (Review Focus 1); (c) bei Bodies: die dokumentierten Schlüssel = die Schlüssel, die die Action liest (gegen eine Konstante der Action, wo es sie gibt, sonst gegen die Liste im Test).
- Steps: **1** Tests (a)–(c) rot; **2** beschreiben, `STRICT_TAGS` erweitern, `ddev artisan test` grün; **3** Gates G1; **4** Commit `docs: describe the <bereich> endpoints in the openapi document`.

### Task 8: Organisation, Konten, Bots, Einladungen, Tokens, eigenes Konto

**Modell:** sonnet · **Tags:** `Organization`, `Accounts`, `Invitations`, `Tokens`, `Me` · **Files:** `app/Http/Controllers/Api/{OrganizationController,UsersController,BotsController,InvitationsController,TokensController,MeController,PasswordController,TwoFactorController}.php`, Resources `{Organization,User,Invitation,Token}Resource`, `tests/Feature/OpenApi/AccountsDocsTest.php`. Besonders: Bilder als Data-URL (`logo_url`, `avatar_url`; `format: uri`, Beschreibung der erlaubten Typen und 2 MB); `POST /invitations` → `{link: string|null, invitation}` ohne `data`; `POST /tokens` → 201 `{token, plain_text}`; `POST /me/two-factor*` mit Geheimnis und Codes nur in der Antwort (Beschreibung: einmal gezeigt).

### Task 9: Projekte, Mitglieder, Favoriten, Automatisierungen, Kataloge

**Modell:** sonnet · **Tags:** `Projects`, `Members`, `Favorites`, `Automations`, `Workflows`, `Work item types`, `Properties`, `Labels`, `Relation types`, `Resolutions` · **Files:** die Controller `Projects`, `Members`, `Favorites`, `Automations`, `Workflows`, `StateUsage`, `WorkItemTypes`, `Properties`, `Labels`, `RelationTypes`, `Resolutions`; Resources `Project`, `ProjectMember`, `Favorite`, `Automation`, `Workflow`, `WorkItemType`, `Property` (`settings` offen), `Label`, `RelationType`, `Resolution`; `tests/Feature/OpenApi/CatalogDocsTest.php`. Besonders: `PUT /projects/{project}/workflow` mit `mapping` (Objekt alte → neue Status-ULID, offen); 422 `invalid_workflow` mit `issues`, 409 `state_in_use`/`in_use` mit `states`/`projects` als dokumentierte Problem-Erweiterungen (Beispiel je Erweiterung); Antworten der Löschungen `{outcome}`, `{affected_items}`, `{affected_relations}`.

### Task 10: Work Items, Abfragen, Relationen, History

**Modell:** opus · **Tags:** `Work items`, `Item queries`, `Relations`, `History` · **Files:** `WorkItemsController`, `RelationsController`, `SubscribersController`, `HistoryController`, Resources `WorkItem` (voll und schlank: `description`, `description_json`, `values_markdown` nicht in `required`), `RelationEntry`, `HistoryEntry`; `app/OpenApi/ItemQueryDocs.php`; `tests/Feature/OpenApi/WorkItemsDocsTest.php`.

**Interfaces:**
- Produces: `ItemQueryDocs` (OperationExtension): `GET /work-items` bekommt `view`, `filter[<Kurzform>]` je `Shorthand::KEYS`, `sort` (`SortSpec::fromQuery`-Form), `show_sub_items`, `include_archived`, `lean`, `cursor`, `per_page`; `POST /work-items/query` den Body aus `ItemQueryInput::BODY_KEYS`, `…/groups` aus `GroupWorkItems::KEYS`, `…/counts` `{filters: {name: Filter}, include_archived}`; Komponenten `Filter` (`{version: 1, conditions: list<{field, op, value?}>}`, `op` als `enum` aus `App\Domain\Filter\Op`, `field` als `enum` der `CoreField`-Werte oder `pattern` `^property:`), `Display` (`DisplaySchema::FIELDS`, `Layout`, `GroupBy`), `SortSpec`. Vormerkung Phase 5 („Scramble beschreibt Body und Kurzform der Abfrage aus `ItemQueryInput` und `Shorthand`“) ist damit erledigt.
- Test (c): dokumentierte Body-Schlüssel = `ItemQueryInput::BODY_KEYS` bzw. `GroupWorkItems::KEYS`, Kurzform = `Shorthand::KEYS`, `op`-Werte = `Op::cases()`, `field`-Werte = `CoreField::cases()`. Dazu: `POST /work-items/bulk` mit `PATCH_KEYS`, Antwort `{updated, rejected}`; 409 `description_conflict` mit `current` (ein `WorkItem`).

### Task 11: Kommentare, Anhänge, Rich Text, Suche, Views

**Modell:** sonnet · **Tags:** `Comments`, `Attachments`, `Rich text`, `Search`, `Views` · **Files:** `CommentsController`, `AttachmentsController`, `RichTextController`, `SearchController`, `ViewsController`; Resources `Comment`, `Attachment`, `SearchResults`, `View`; `tests/Feature/OpenApi/ContentDocsTest.php`. Besonders: `POST /attachments` als `multipart/form-data` (`file` binär, `project_id`, `kind`, `work_item_id`), 413 mit der Grenze; die Datei selbst liegt unter `/attachments/{id}` außerhalb von `/api/v1` (Beschreibung nennt sie und `?download=1`, Bearer-Token mit `read` genügt, A235); `DELETE /comments/{comment}/reactions` mit `emoji` im Body oder `?emoji=`.

### Task 12: Wiki, Vorlagen, Benachrichtigungen, System, Webhooks

**Modell:** sonnet · **Tags:** `Wiki`, `Templates`, `Notifications`, `System`, `Webhooks` · **Files:** `PagesController`, `PageVersionsController`, `TemplatesController`, `NotificationsController`, `NotificationPreferencesController`, `SystemController`, `WebhooksController`; Resources `Page`, `PageNode` (rekursiv als Komponente mit `$ref` auf sich selbst), `PageVersion`, `Template`, `TemplateRun`, `TemplateDraft`, `Notification`, `NotificationPreference`, `SystemStatus`, `Webhook`, `WebhookDelivery`; `tests/Feature/OpenApi/OperationsDocsTest.php`. Besonders: 409 `page_conflict` mit `current`; `GET /projects/{project}/pages` → `{data: list<PageNode>, meta: {total}}` ohne Cursor; `POST /webhooks` und `…/rotate-secret` → `{data, secret}` (Beschreibung: einmal gezeigt); Ping und „erneut senden“ mit der eigenen Drossel (6/min).

---

### Task 13: Problem-Erweiterungen und Feldmeldungen vollständig

**Modell:** sonnet

**Files:**
- Modify: `app/OpenApi/{Components,Schemas}.php`, `tests/Feature/OpenApi/OpenApiDocumentTest.php`

**Interfaces:**
- Produces: `Schemas::problemReasons(): list<string>` = alle Schlüssel `problem.reason.*` aus `lang/en.json`; `Problem.reason` dokumentiert sie als `enum` mit Beschreibung („neue Gründe kommen additiv hinzu“, A390); jede in `Problem::conflict|unprocessable|locked|unavailable` benutzte Erweiterung (`current`, `states`, `projects`, `issues`, …) als optionale Eigenschaft.
- [ ] **Step 1: Failing Test** — „documents every reason the server can answer“: `enum` von `Problem.reason` = `problem.reason.*` in `lang/en.json`; „documents every extension of a problem“: per Regex über `app/` gefundene Schlüssel von `$extensions`-Arrays an `Problem::…` stehen im Schema.
- [ ] **Step 2: Rot, implementieren, grün; Step 3: Gates G1; Step 4: Commit** — `docs: list every problem reason and extension in the openapi document`.

---

### Task 14: Abnahme: `ApiFlowTest` und Vertrag überall

**Modell:** opus

**Files:**
- Create: `tests/Feature/Api/ApiFlowTest.php`
- Modify: `tests/Support/OpenApi/Contract.php` (`STRICT_TAGS` entfällt: jede Operation ist streng), `CLAUDE.md`

**Interfaces:**
- Consumes: alles Vorige; `consumers(SearchConsumer::class, NotificationConsumer::class, WebhookConsumer::class)`, `searchEngine()`, `Mail::fake()`, `Queue::fake([SendNotificationMailJob::class])`, `Http::fake()`, `FakeResolver`, `App\Domain\Webhooks\Signature`.

- [ ] **Step 1: Failing Test** — `ApiFlowTest` „runs success criterion 2 over REST only“, nur über HTTP mit Bearer-Tokens (Org-Admin mit `read`+`write`, Mara mit `read`+`write`, ein Bot), jede Antwort unter dem Vertrag: (1) `POST /workflows` mit Matrix ohne `Backlog → Done`, `POST /projects`, `PUT /projects/{p}/workflow` mit `mapping`; (2) `POST /properties` (Pflicht, Text), `POST /work-item-types` mit ihr als Pflicht, `PATCH /projects/{p}` aktiviert den Typ, `POST /work-items` ohne den Wert → 422 `values.<key>`, mit Wert → 201; (3) `POST …/transition` nach Done → 409 `transition_not_allowed`, nach In Progress → 200; (4) `POST /work-items/{item}/comments` mit `@mara` in Markdown → Maras `GET /notifications?filter[kind]=mentioned` nennt ihn, eine Sammlung mit Mail entsteht (`SendNotificationMail::run` → `Mail::assertSent`); (5) `POST /webhooks` auf `https://receiver.example.com/hook` mit `comment.*` → der Kommentar von (4) erzeugt eine Zustellung, `DeliverWebhook` schickt (`Http::fake`), die Signatur prüft mit `Signature::verify` und dem Geheimnis aus der Antwort von `POST /webhooks`; (6) `GET /search?q=<Wort des Titels>` → das Item, `key_match` für den Key. Danach: „answers every list with the same envelope“ (alle `GET`-Listen mit `#[ListOf]` liefern `data`, `links`, `meta.total`).
- [ ] **Step 2: `STRICT_TAGS` entfernen**, `ddev artisan test` → keine Verstöße.
- [ ] **Step 3: Gates G1** (dazu `ddev artisan test --testsuite=Integration`).
- [ ] **Step 4: Commit** — `test: run success criterion 2 over rest under the openapi contract`.

---

### Task 15: Oberfläche: Link auf die API-Doku

**Modell:** sonnet

**Files:**
- Modify: `resources/js/features/settings/personal/ApiAndMcp.tsx` und Test, `lang/{en,de}.json` (`settings.api.docs.link` „API-Dokumentation“, `settings.api.docs.hint` „OpenAPI-Beschreibung dieser Instanz“), `e2e/tests/settings-personal.spec.ts`

**Interfaces:**
- Produces: in „API und MCP“ ein Abschnitt mit Link auf `instanceOrigin() + '/api/docs'` (neuer Tab, `rel="noopener"`) und `…/api/openapi.json`; keine neuen Pfade in `lib/links.ts` (keine App-Seite).
- [ ] **Step 1: Failing Tests** — Vitest „links the api docs of the instance“; e2e (gezielt): der Link ist per Tab erreichbar, `page.request.get(href)` antwortet 200 (die Seite selbst wird nicht gerendert: Stoplight lädt von einem CDN, A389).
- [ ] **Step 2: Rot, implementieren, grün; Step 3: Gates G2, G3 gezielt `settings-personal`; Step 4: Commit** — `feat: link the api docs from api and mcp`.

---

### Task 16: Doku, `CLAUDE.md`, Rulings, Spec

**Modell:** opus

**Files:**
- Create: `docs/{en,de}/api.md`, `tests/Feature/Docs/ApiDocsPageTest.php`
- Modify: `docs/.vitepress/config.ts` (Gruppe mit `api` vor `webhooks`), `docs/{en,de}/{bots,webhooks,search}.md` (Verweise), `docs/{en,de}/concepts/views.md` (Kurzform, `POST /work-items/query`), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md`

**Interfaces:**
- Produces:
  - `api.md` (en + de, gleiche Überschriften, `DocsTest`): Überblick und Verweis auf `/api/docs`, `/api/openapi.json`; Anmeldung (Tokens, Fähigkeiten `read`/`write`/`mcp`, Lese-POSTs, was nur die Sitzung darf); Fehler (Problem Details, `reason`, `errors`, Sprache des Kontos); Listen (Cursor, `per_page`, Tabelle `filter`/`sort`/`include` je Liste); Work Items (Key, frühere Kennung und 301, Kurzform, `?view=`, `POST /work-items/query`, Verweis auf die Filter-Referenz in `concepts/views.md`); Rich Text in zwei Formen; Konflikte (`base_description_version`, `base_version`); Grenzen (600/min, Header, 2 MiB, Uploads); Stabilität von v1; Beispiele mit `curl` (Token anlegen in der Oberfläche, Item anlegen, Liste blättern, Kommentar, Datei hochladen).
  - `ApiDocsPageTest`: die Tabelle der Listen in `docs/en/api.md` nennt je Liste genau die Filter, Sortierungen und Includes ihrer `ListSpec`; jeder `curl`-Pfad der Seite trifft eine Route.
  - `CLAUDE.md`: „Stand“ (Phase 12 umgesetzt, als Nächstes Phase 13), Architektur „REST: Konventionen und OpenAPI“ (Scramble, `app/OpenApi`, `ListSpec`/`ListQuery`/`SignedCursor`, Rate-Limit, Body-Limit, Vertrag), Kommandos, Fallstricke (Harness: Verstöße am Dokument beheben; `Contract::off` nur mit Grund; Scramble analysiert statisch: neue Controller-Methoden brauchen Summary und Attribute; das Dokument wird je Testprozess einmal erzeugt).
  - Rulings `A384`–`A392` (unten, Anpassungen aus der Umsetzung); „Für spätere Phasen vorgemerkt“: Zeile Phase 12 entfernen; Phase 13 (MCP-Tools lesen dieselben `ListSpec`s, `GET /me` als `whoami`, Drossel `mcp` mit `RateKey`), Phase 14 (Cache des Dokuments nach dem Start leeren bzw. beim Build erzeugen; Stoplight vom CDN in der Betriebsdoku erwähnen), Phase 15 (Last: Listen mit Filtern über 50 000 Items, Erzeugungszeit des Dokuments).
  - Spec „Änderungen vom <Tag> (Phase 12)“ zur Bestätigung: A386, A387, A388, A389, A390, A391, A392.
- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter='DocsTest|ApiDocsPage'`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 2: Abnahme der Phase** (ohne vollen G3)

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev restart
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build
E2E_COVERAGE=0 pnpm --dir e2e exec playwright test settings-personal inbox templates settings-organization
ddev exec pnpm --dir docs build
```

Expected: alles grün. Von Hand: `https://werkbuch.ddev.site/api/docs` zeigt alle Gruppen; ein Token aus „API und MCP“ ruft `GET /api/v1/me` und `GET /api/v1/work-items?filter[assignee]=me` mit `curl`; `GET /api/v1/projects?sort=-name&per_page=1` blättert über `links.next`; 601 Anfragen in einer Minute ergeben ein 429 mit `Retry-After`.

- [ ] **Step 3: Commit** — `docs: add the api guide, update CLAUDE.md, the rulings and the spec for phase 12`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und **parallel im Hintergrund der volle G3**; beide Ergebnisse gehen in die eine finale Fix-Welle.

---

## Vorschläge für neue Rulings (ab A384; A379–A382 sind in Phase 11 vergeben)

- **A384 · Eigene Scramble-Extensions statt einer Community-Erweiterung für den Query Builder;** die Regeln einer Liste stehen einmal in `ListSpec` an der List-Action und speisen Abfrage und Dokument (`#[ListOf]`). *Grund:* Spec 6.1 lässt die Wahl offen; geprüft am 2026-11-06: `lokiwich/scramble-spatie-query-builder` hat eine Version (0.1.0) und 315 Downloads, `exonn-gmbh/…` kennt nur Query Builder ≤ 6 und Scramble ≤ 0.12, `pjadanowski/scramble-extras` verlangt `spatie/laravel-data`; außerdem rufen die Controller Actions, deren Regeln Scramble nicht sieht. *Falls falsch:* eine Erweiterung einbinden, sobald eine gepflegt ist und Query Builder 7 kennt; `ListSpec` bleibt die Quelle.
- **A385 · Der Vertrag wird an echten Antworten geprüft:** jede Antwort unter `/api/v1` aus den Feature-Tests gegen das erzeugte Dokument (opis/json-schema, Draft 2020-12), Objekte ohne `x-werkbuch-open` streng (`additionalProperties: false` nur beim Prüfen, nicht im veröffentlichten Dokument), Anfrage-Bodies nur bei 2xx; jede Operation dokumentiert die üblichen Fehlerstatus (dokumentiert heißt „kann vorkommen“). Kein eingecheckter Schnappschuss des Dokuments. *Grund:* Spec 9 „OpenAPI-Vollständigkeit“ und der Auftrag, dass das Dokument zu Resources und Validierung passt; Hunderte vorhandene API-Tests prüfen es so ohne eigene Fälle. *Falls falsch:* ein Schnappschuss `docs/public/openapi.json` mit Frische-Test und ein eigener Satz Vertragstests je Route.
- **A386 · Listen nach Spec 6.1:** Feldfilter heißen `filter[<name>]`, Sortierung `sort`, Beziehungen `include`; die bisherigen eigenen Parameter wandern dorthin (`type`, `user_id`, `project`, `unread_only`, `mentions_only`; die Oberfläche folgt in derselben Task), Flags über die ganze Abfrage (`include_archived`) bleiben eigene Parameter wie bei Items und Suche; unbekannte Namen sind 422 (`field.list.filter|sort|include`), andere unbekannte Query-Parameter werden weiter übergangen; sortierbar nur Spalten ohne `null`, jede Sortierung endet auf `id`; der Cursor trägt die Signatur der Sortierung (anderer Sortierung → 422); `include` gibt es in v1 nur als `projects?include=members`. *Grund:* eine Form für alle Listen (Spec 6.1 „über spatie/laravel-query-builder“), Laravels Cursor vertrüge `null` nicht, und ein Cursor anderer Richtung lieferte still falsche Seiten; vor v0.1.0 gibt es keine fremden Clients. *Falls falsch:* die alten Parameter als Aliase behalten.
- **A387 · Rate-Limit-Schlüssel:** gültiges Token → je Token; sonst die Sitzung der Oberfläche → je Konto; sonst je IP; 600/min aus `API_RATE_LIMIT` (Standard 600); die Drossel läuft vor Auth (Spec 7.5), Routen-Drosseln (Anhänge, Ping, Testmail, Passwort) gelten zusätzlich. *Grund:* Spec 6.1 nennt Token und IP; die Oberfläche je IP zu zählen ließe ein Büro hinter NAT sich gegenseitig drosseln, und Live-Updates laden Abfragen in Wellen. *Falls falsch:* die Sitzung je IP.
- **A388 · JSON-Bodies höchstens 2 MiB,** geprüft vor dem Parsen (`Content-Length`, sonst die Länge des Inhalts), für alle Nicht-Multipart-Bodies unter `/api/*`, 413 `payload_too_large` mit eigenem Satz; Uploads behalten `ATTACHMENTS_MAX_MB`. *Grund:* Spec 6.1 „Ein Body-Limit gilt für JSON“ ohne Wert; ein Rich-Text-Feld darf 256 KiB haben, ein Item mit Beschreibung und mehreren Rich-Text-Properties braucht über 1 MiB. *Falls falsch:* 1 MiB oder abhängig von der Zahl der Rich-Text-Properties.
- **A389 · `/api/docs` und `/api/openapi.json` sind öffentlich** (keine Anmeldung, Drossel je IP), die Oberfläche der Doku ist Scrambles Stoplight Elements und lädt deren Skript von einem CDN, das Dokument selbst kommt vom Server. *Grund:* das Dokument enthält keine Daten der Instanz, die API ist Open Source, und Integrationen brauchen es vor dem ersten Token; ein eigener Bundle der Doku-Oberfläche wäre ein JS-Paket mehr. *Falls falsch:* nur für angemeldete Konten, bzw. Stoplight per pnpm einbinden und selbst ausliefern.
- **A390 · Keine ETags, kein `If-Match`, kein `Idempotency-Key` in v1;** Konflikte bleiben `base_description_version` und `base_version`; `/api/v1` ändert sich nur additiv (neue Felder, Routen, Filter, `reason`-Codes), Clients übergehen unbekannte Felder; eine brechende Änderung wäre `/api/v2`. *Grund:* die Spec verlangt nichts davon, die Konfliktwerte gibt es schon; Mehrfachbearbeitung meldet je Item, was geschah. *Falls falsch:* ETag/`If-Match` für Beschreibung und Seiten zusätzlich.
- **A391 · Zurückgeschickt pinnt nicht:** `PATCH /users/{user}` mit `locale` oder `timezone` gleich der geerbten Einstellung ändert nichts, solange das Konto keine eigene hat. *Grund:* `UserResource` liefert die wirksamen Werte (Vormerkung Phase 2); wer das ganze Objekt zurückschickt, würde sonst still von der Organisation abgekoppelt. *Falls falsch:* `UserResource` liefert `locale` (gespeichert, nullable) und `effective_locale` getrennt.
- **A392 · Neue Lesepunkte:** `GET /me` (Konto des Tokens bzw. der Sitzung samt Rechten der Org-Rolle, auch mit einem Lese-Token), `GET /users/{user}` und je Katalog `GET /<katalog>/{id}`; Einzel-GETs für Einladungen, Tokens, Mitglieder, Relationen und Benachrichtigungen gibt es nicht (die Listen genügen). *Grund:* Spec 6.1 „vollständig“ und MCP (Phase 13, „get“); ein Bot muss erfahren, wer er ist. *Falls falsch:* Einzel-GETs überall.

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** OperationIds sind die von Scramble (`<controller>.<methode>`); Tags in der Reihenfolge der Spec 6.1.
- **P2** Das 429 einer Routen-Drossel (Anhänge, Ping) und das der API sehen gleich aus; welche griff, sagt `X-RateLimit-Limit`.
- **P3** `filter[name]` der Kataloge sucht per `like` mit maskierten `%`, `_`, `\`, über die Kollation (wie Views).
- **P4** Die e2e-Prüfung der Doku rendert die Stoplight-Seite nicht (CDN in der CI); sie prüft Link und Status.
- **P5** Der Vertrag prüft keine Antworten außerhalb `/api/v1` (Dateien unter `/attachments/…`, `/media/…`).

## Nicht in Phase 12 (vorgemerkt in Task 16)

- Phase 13: MCP über dieselben `ListSpec`s und Actions, `whoami` aus `GetMe`, Drossel `mcp` mit `RateKey`.
- Phase 14: Erzeugung bzw. Cache des Dokuments im Image; Betriebsdoku zu `API_RATE_LIMIT` und dem CDN der Doku-Oberfläche.
- Phase 15: Last der Listen mit Filtern und Sortierungen über 50 000 Items (Indizes für `name`, `created_at`), Dauer der Erzeugung des Dokuments.
