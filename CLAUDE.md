# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Diese Datei aktuell halten.** Wer Stack, Ablauf, Kommandos oder Konventionen ändert, passt CLAUDE.md im selben Commit an. Veraltete Angaben hier sind schlimmer als keine.

## Was werkbuch ist

Offenes, selbst gehostetes Projektmanagement-Tool: Projekte, Work Items mit eigenen Typen, Properties und Workflows, Wiki pro Projekt, teamweite Views, Vorlagen mit Zeitplan, Automatisierungen, Benachrichtigungen, Omni-Suche, REST-API, MCP und Webhooks. Betrieb wie openbill und prevju: Docker-Image `baeroe/werkbuch`, `docker compose up -d`, Doku per VitePress auf GitHub Pages.

**Spec (bindend):** `docs/superpowers/specs/2026-10-28-werkbuch-design.md`. Konzeptänderungen dort nachtragen (Abschnitt „Änderungen vom …“).

## Stand

Spec freigegeben am 2026-10-28. **Phase 1 (Fundament) ist erledigt** (PR #5, 2026-10-30): Laravel 13 mit DDEV, Gates, Problem Details, i18n, Frontend-Basis mit portierten Komponenten, Anmeldung (Fortify), Shell, Seeder, zusammengeführte Abdeckung mit `e2e/`, VitePress-Gerüst, CI. Es gibt noch keine Fachlogik: Organisation, Rollen, Projekte und alles Weitere kommen ab Phase 2. Ablauf laut Spec, Abschnitt 11:

1. Drei Moodboards in `prototypes/moodboards/`. Erledigt: Am 2026-10-28 ist die Richtung **Werkbuch („Arbeitsheft“)** gewählt. Gestaltungsgrundlage ist `prototypes/clickdummy/DESIGN.md`; vor jeder UI-Arbeit lesen.
2. Klickdummy in `prototypes/clickdummy/`: steht und bleibt fachlich eingefroren (erste Korrekturrunde 2026-10-29 umgesetzt, Entscheidungen in der Spec unter „Änderungen vom 2026-10-29“ und im README des Klickdummys; Umsetzungsentscheidungen in `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-rulings.md`). Er ist Paket `werkbuch-clickdummy` im Root-Workspace (ein Lockfile für alles, Root-`package.json` und `pnpm-workspace.yaml` gehören der App). Dev-Server: `ddev exec pnpm clickdummy` (https://werkbuch.ddev.site:5176); andere Skripte: `ddev exec pnpm --filter werkbuch-clickdummy <script>`. Seine Playwright-Flows laufen nur in der CI (Job `clickdummy`). Kommandos, Abweichungen von der Spec und offene Fragen: dessen `README.md`; Aufräumliste (13b/13c): `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md`.
3. Umsetzung in 15 Phasen. Der Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` legt Phasen, Verträge und Abnahme fest (dort die Liste „Fortschritt“), je Phase gibt es einen Phasenplan daneben (`2026-10-30-phase-NN-<name>.md`; Phase 1: `…phase-01-foundation.md`). Entscheidungen während der Umsetzung stehen als `A1`, `A2`, … in `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (mit Grund und „Falls falsch“); neue Entscheidungen dort nachtragen, fachliche zusätzlich als „Änderungen vom …“ in die Spec.
4. Manuelle Tests.
5. Release v0.1.0, nur nach Freigabe durch Rafael.

## Tech Stack

PHP 8.4, Laravel 13 (`^13.39`), MariaDB 11.4, Inertia v3 mit React 19, TypeScript 7, Tailwind 4, Vite 8, Base UI, TanStack Query, Zustand, Lucide, fontsource (Bricolage Grotesque, Figtree). Fortify (Anmeldung), Sanctum 4 (Session-Cookie für die API, Tokens ab Phase 2), spatie/laravel-permission 8 (Teams), spatie/laravel-medialibrary 11, Reverb (nur der Daemon, Kanäle ab Phase 8), `lorisleiva/laravel-actions`. Tests: Pest 5 (PCOV), Larastan Level 8, Pint, Vitest 5 mit Istanbul, Playwright 1.64. Node 24, pnpm 12.8.1. Dev-Umgebung: DDEV. Weitere Pakete (Scout, tiptap-php, …) kommen mit ihrer Phase; die geprüften Versionen stehen im Phasenplan („Paketversionen“) und in Ruling A1.

## Kommandos

Alles für die App läuft in DDEV (kein PHP, Composer oder Node auf dem Host); nur `e2e/` läuft auf dem Mac.

```bash
cp .env.example .env && ddev start && ddev composer install && ddev exec pnpm install && ddev artisan key:generate && ddev artisan migrate   # erster Start (DDEV erzeugt keinen APP_KEY)
ddev artisan app:ensure-admin                  # erstes Konto aus ADMIN_EMAIL/ADMIN_PASSWORD (nur wenn es noch keine Person gibt)
ddev artisan app:reset-password <email>        # neues Passwort, beendet alle Sitzungen
ddev artisan db:seed --class=DemoSeeder        # fiktive Demo-Personen (Feldwerk)
ddev artisan app:redispatch-events             # liegengebliebene Events neu verteilen (läuft jede Minute im Scheduler)
ddev exec pnpm dev                             # Vite mit HMR, https://werkbuch.ddev.site:5173

ddev artisan test --coverage --min=100         # Pest, 100 % Zeilen; `--filter=Name` für einzelne Tests
ddev exec vendor/bin/phpstan analyse --memory-limit=1G
ddev exec vendor/bin/pint --test               # ohne --test formatiert er
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm --dir docs build                # VitePress; Dev-Server `ddev exec pnpm --dir docs dev` (Port 5174)

pnpm --dir e2e install && pnpm --dir e2e exec playwright install chromium   # einmal, auf dem Mac
ddev exec pnpm build:coverage                  # Istanbul-Build (vorher `pnpm dev` beenden)
pnpm --dir e2e test                            # Playwright auf dem Mac gegen DDEV, seedet die e2e-Daten
ddev exec pnpm coverage:merge                  # Vitest + Playwright zusammen, scheitert unter 100 % Zeilen
ddev exec pnpm build                           # stellt danach den normalen Build wieder her
```

Ports: App `https://werkbuch.ddev.site`, Vite 5173, Doku 5174, Klickdummy 5176, Reverb 6001, Meilisearch 7701; Mails: `ddev mailpit`. Queue-Worker (`queue:listen`), Scheduler und Reverb laufen als DDEV-Daemons. Ausführlich: `docs/en/development.md`.

## Regeln

- Nur pnpm, nie npm oder npx; Einmal-Tools mit `pnpm dlx`. `pnpm-workspace.yaml`: nur Pakete in `allowBuilds` dürfen Build-Skripte ausführen (sonst scheitert `pnpm install`; native Binaries `true`, Unnötiges `false`). Abhängigkeiten im Root installiert nur der Container (`ddev exec pnpm …`), nie der Mac: Die `node_modules` enthalten Linux-Binaries.
- Git: ein Branch je Änderung (`feat/…`, `fix/…`, `docs/…`), PR gegen `main`, Conventional Commits.
- Der CI-Pflicht-Job heißt `tests` (`.github/workflows/tests.yml`). Den Namen nie ändern. `tests` prüft die App (Composer, Pint, Larastan, Pest mit Abdeckung, `tsc`, Vitest mit Abdeckung, Build). Daneben laufen `e2e` (Playwright gegen `php artisan serve` mit MariaDB und Mailpit, zusammengeführte Frontend-Abdeckung; `e2e/ci.env` wird als `.env` kopiert, `QUEUE_CONNECTION=database` mit einem `queue:work` im Hintergrund), `docs` (VitePress-Build) und `clickdummy` (Typecheck, Tests, Build und Playwright-Flows des Klickdummys); alle drei sind keine Pflicht-Checks.
- Demo- und Testdaten sind nur fiktiv (`@example.com`, ausgedachte Firmen und Personen). Keine echten Kunden, Hosts oder Firmen.
- Fachlogik nur in `app/Actions/<Bereich>/<VerbNomen>.php` (final, `use AsAction`, Einstieg `handle()`; Abläufe, Validierung, Rechte, Transaktion) und `app/Domain/` (reine Regeln ohne Laravel, ohne Carbon). Controller, Middleware, Commands, Jobs und `app/Auth/` (Fortify-Adapter) rechnen nicht und schreiben weder Modelle noch per `DB::table`. `tests/Unit/ArchTest.php` erzwingt das. Jede andere Action bekommt als ersten Parameter von `handle()` den `Actor` (Ausnahmen: `App\Actions\Auth`, `App\Actions\Setup`, `App\Actions\Accounts\NextHandle`); `ArchTest` prüft das, ebenso dass nur Actions `EventRecorder` benutzen und dass sie dabei `DB::transaction(` enthalten.
- Primärschlüssel ULID (`HasUlids`) in den eigenen Tabellen; Framework-Tabellen (`jobs`, `failed_jobs`, `job_batches`, `cache`, `cache_locks`, `sessions`, `password_reset_tokens`) behalten ihre Schlüssel (A1).
- Texte: UI-Texte und Mails nur über Schlüssel in `lang/en.json` und `lang/de.json` (flach, Punktpfade, alphabetisch, gleiche Schlüssel und Platzhalter `:name` in beiden; Plural `.one`/`.other`; Schlüssel ohne Ziffern). Im Frontend `t()`/`tn()` aus `@/lib/i18n` (typisierte Schlüssel aus `lang/en.json`), in PHP `__()`. Beim Port aus dem Klickdummy wird jeder deutsche Text ein Schlüssel; `de.json` übernimmt ihn wörtlich. Dynamisch gebaute Schlüssel (`` t(`problem.reason.${r}`) ``) findet der Scan in `TranslationKeysTest` nicht; sie in beiden Dateien vollständig halten. Framework-Gruppen (`auth`, `passwords`, `validation`, `pagination`) bleiben in `lang/<sprache>/*.php`. Sprache: Profil, dann Cookie `locale` (unverschlüsselt, nur `en`/`de`), dann die Standardsprache der Organisation (`Locale::default()`, `SetLocale`; `config('app.locale')` füllt sie nur beim Anlegen in der Migration); ändert ein Besuch die Sprache, lädt die Seite neu.
- Tastatur: Kürzel stehen nur im Katalog `resources/js/lib/shortcuts/catalog.ts` (Hilfe-Overlay und spätere Tastatur-Doku lesen ihn); das Register `registry.ts` bindet sie zur Laufzeit (`useShortcut`). Neue Kürzel dort eintragen, nie frei registrieren (A7).
- Abdeckung: 100 % Zeilen PHP (PCOV) und Frontend (Vitest und Playwright zusammengeführt). Vitest hat Schwellen je Ordner (`vitest.config.ts`); ein neuer Ordner unter `resources/js` trägt seinen Eintrag dort ein, sonst deckt ihn nur Playwright ab. Ausnahmen nur mit Grund im Kommentar (`@codeCoverageIgnore <Grund>`, `/* istanbul ignore next -- <Grund> */`); `CoverageIgnoreTest` und `scripts/coverage-ignores.test.mjs` prüfen das.
- Doku: Jede Phase liefert ihre VitePress-Seiten in `docs/en/` **und** `docs/de/` mit gleichen Dateinamen und Überschriften (`tests/Unit/DocsTest.php`).
- Das README des Repos ist Englisch, die VitePress-Doku Englisch und Deutsch. Arbeitsdokumente (Spec, Pläne, Rulings, README und DESIGN.md des Klickdummys) sind Deutsch.

## Architektur

Die Verträge zwischen den Phasen stehen im Master-Plan (Abschnitt „Verträge zwischen den Phasen“); diese gibt es schon:

- **`Problem`** (`App\Exceptions\Problem`, final, `RuntimeException` und `HttpExceptionInterface`; Fabriken `forbidden()`, `notFound()`, `conflict()`, `invalid()`, `locked()`). Alle Render-Callbacks stehen in `App\Exceptions\Rendering::register()` (aufgerufen aus `bootstrap/app.php`; PCOV misst nur `app/`). Unter `/api/*` wird jede Exception als `application/problem+json` (RFC 9457) gerendert, auf Web-Routen als Inertia-Fehlerseite (`Errors/Error`, `Errors/NotFound`). Nur `Problem` trägt ein eigenes `detail`; alle anderen bekommen den übersetzten Text `problem.reason.<slug>`; ein 404 hat nie `detail`. `reason`-Codes: Schlüssel von `REASON_TEXT` im Klickdummy, neue Codes in `lang/*.json` und im Frontend ergänzen.
- **Pakete mit ULID** (Phase 2, P3): `personal_access_tokens.id` und alle Verweise auf eigene Modelle (`tokenable_id`, `model_id`, `team_id`, `media.model_id`) sind ULIDs, `roles`/`permissions`/`media` behalten ihre Integer-Schlüssel; die Migrationen sind von Hand geschrieben (keine Vorlagen veröffentlichen). `App\Models\PersonalAccessToken` (ULID) ist als Sanctum-Modell gesetzt, Token-Klartext `<id>|wb_<geheimnis>`. `Relation::enforceMorphMap` steht in `AppServiceProvider::boot()`: jedes Modell, das polymorph referenziert wird, braucht dort einen Eintrag (sonst `ClassMorphViolationException`). spatie-Teams sind an (`teams`), der Gate-Hook von spatie ist aus (`register_permission_check_method`).
- **Actor** (`App\Support\Actor`, final readonly): `user`, `via` (Konstanten `VIA_UI`, `VIA_API`, `VIA_MCP`, `VIA_AUTOMATION`, `VIA_TEMPLATE`, `VIA_SYSTEM`), `reason`, `token`. `Actor::fromRequest()` (Bearer-Token → `api` mit Token, Sitzung → `ui`, ohne Konto `AuthenticationException`), `Actor::automation($reason)` (Standard-Bot), `Actor::system($user, $reason)`; `meta()` liefert `via`, `reason` und `token_id` für das Event. In Tests: `actor($user)`.
- **Events und Outbox** (Phase 2): Tabelle `events` ist History und Outbox zugleich (`occurred_at` mit Mikrosekunden, `project_id` ohne Fremdschlüssel, P10). Schreiben nur über `App\Events\EventRecorder::record($type, $actor, $subject, $project, $changes, $meta)` innerhalb einer Transaktion (sonst `LogicException`); Typen in `App\Events\EventType` (`webhook()`, `group()`). Nach dem Commit (`afterCommit`) stellt `DispatchEvent` je Konsument aus `config('werkbuch.event_consumers')` einen `ConsumeEvent` in dessen Queue und setzt `dispatched_at`; `App\Events\Outbox::consume()` beansprucht die Zeile `(event_id, consumer)` in `event_consumptions` per `insertOrIgnore` in derselben Transaktion wie die Arbeit des Konsumenten (`App\Events\EventConsumer`): doppelte Dispatches laufen ins Leere, ein Konsument, der wirft, läuft beim nächsten Versuch erneut. `app:redispatch-events` (jede Minute, `withoutOverlapping(5)`) verteilt Events ohne `dispatched_at`, die älter als 2 Minuten sind: höchstens 500 je Lauf, jedes höchstens alle 15 Minuten (`redispatched_at`); ist ein Event nach 60 Minuten noch nicht verteilt, wird es bei jedem weiteren Versuch per `report()` gemeldet. Den Claim schreibt ein normales `insert`; nur `UniqueConstraintViolationException` heißt „schon erledigt“, jeder andere Fehler (unbekanntes Event, zu langer Schlüssel) wirft. In Tests: `consumers(RecordingConsumer::class)` (`tests/Support/`).
- **Organisation und Projekte** (Phase 2): `organization` hat genau eine Zeile, die die Migration aus der Config anlegt (`App\Models\Organization::current()`, im Container `scoped` an `sole()` gebunden: einmal je Request/Job gelesen). `User::effectiveLocale()`/`effectiveTimezone()` fallen auf sie zurück; `User::defaultBot()` ist der eine Bot mit `is_default_bot`. Projekte: `projects`, `project_identifiers` (frühere Kennungen, lösen weiter auf), `project_members` (die Rolle steht bei spatie), `favorites` (polymorph, Morph-Map `project`); `Project::findByReference()` findet per ULID, Kennung oder früherer Kennung, ohne Sichtbarkeitsprüfung. `workflow_id` und `default_type_id` haben bis Phase 3 keinen Fremdschlüssel. Neue Migrationen sortieren nach `2026_10_31_…`.
- **`config/werkbuch.php`**: `version`, `admin`, `trusted_proxies`, `attachments_max_mb`, `notification_mail_delay`, `webhooks_allow_private`, `event_consumers`, `rate_limits` (`api`, `mcp`, `login_per_ip`, `password_reset_per_ip`, `password_update_per_ip`), gelesen aus den Env-Variablen der Spec 8.2. Trusted Proxies und Host-Prüfung (nur der Host aus `APP_URL`) in `app/Support/TrustedRequests.php`.
- **Shared Props** (`HandleInertiaRequests`, Typ `SharedProps` in `resources/js/lib/page.ts`, `useSharedProps()`): `auth.user`, `auth.permissions`, `organization` (bis Phase 2 aus der Config), `locale`, `translations` (einmal je Sprache, `Inertia::once`), `features` (`mail`, `live`), `flash` (`status`, `error`), `errors`.
- **Frontend-Ordner** (`resources/js/`): `api/` (`http.ts` mit `get`/`post`/`patch`/`put`/`del`/`upload`, Session-Cookie und CSRF, bei 419 einmal `/sanctum/csrf-cookie`; `client.ts` mit `ApiError` und `Page<T>`; `live.ts`), `components/ui` (portierte Komponenten, 100 % Vitest), `features/`, `hooks/`, `lib/`, `pages/<Bereich>/<Name>.tsx` (nur der Bildschirm aus `features/`), `shell/`, `store/`, `test/`. Pfade der App nur über `paths` aus `lib/links.ts` (`<Link href={paths.inbox()}>`), nie als Literal.
- **Layouts**: persistentes Layout als Pfeilfunktion (`Page.layout = shellLayout`, `shell/layout.tsx`); Fehlerseiten nutzen `ErrorLayout` (Shell nur mit angemeldeter Person).
- **Anmeldung**: Fortify ohne `fortify:install`; Adapter in `app/Auth/`, Konfiguration in `app/Providers/FortifyServiceProvider.php`, eigene Controller für `POST /forgot-password` und `POST /reset-password` (`app/Http/Controllers/Auth/`, prüfen Eingaben vor Fortify), Logik in `app/Actions/Auth/` (`Authenticate`, `RequestPasswordReset`, `SendPasswordResetLink`, `SetPassword`, `EnsureAdmin`). Login-Drossel zweistufig (5 Fehlversuche je `lower(email)|IP` für 60 s, dazu `rate_limits.login_per_ip`); „Passwort vergessen“ verrät nie, ob es ein Konto gibt, Links kommen aus `APP_URL`. Passwortregeln nur in `SetPassword`/`PasswordRules`.
- **Seeder**: `DemoSeeder` (Personen aus `prototypes/clickdummy/src/api/seed/people.ts`, jede Phase ergänzt ihre Daten), `E2eSeeder` (eigene Personen je Playwright-Projekt).

## Fallstricke

- `ddev composer create-project` nicht benutzen (verlangt ein leeres Root); Composer und Artisan nur über `ddev`.
- `ddev exec` reicht Argumente durch eine Shell: Befehle mit Globs in einfache Quotes.
- Nach hartem Vite-Ende liegt `public/hot` noch da und die App sucht den toten Dev-Server: Datei löschen.
- Nach `pnpm --dir e2e test` ist der Abdeckungs-Build installiert; `ddev exec pnpm build` stellt den normalen her. Beim Abdeckungs-Build darf `pnpm dev` nicht laufen.
- `ddev exec pnpm install` schreibt Linux-Binaries nach `node_modules` (auch in `prototypes/clickdummy`); ein Lauf des Klickdummys oder von Playwright auf dem Mac braucht eine eigene Installation. Der Klickdummy hat kein eigenes Lockfile mehr.
- Mutagen: Dateien, die der Host schreibt, sieht der Container erst nach `ddev mutagen sync`.
- Die Daemons (Queue, Scheduler, Reverb) warten auf `vendor/` und `.env`, damit ein frischer Klon startet. `queue:listen` lädt Code je Job neu; Reverb liest ihn nur beim Start: nach Codeänderungen `ddev restart`.
- Mails für „Passwort vergessen“ gehen über die Queue `notifications`; ohne Worker kommt nichts an (Docker-Image: Phase 14).
- `php artisan serve` (CI, e2e) liest nur `.env`, keine durchgereichten Env-Variablen: darum `e2e/ci.env`.
- `phpunit.xml` erzwingt `APP_ENV=testing` und die Datenbank `testing` (`force="true"`). Laravels `Env` ist unveränderlich und lädt `.env` bei jedem App-Start neu: `putenv` reicht in Tests nicht, den `setEnv()`-Helfer nutzen. Unit-Tests booten keine App und lesen Dateien über `repo_path()`, nie `base_path()`.
- Laravel bereitet Exceptions vor den Render-Callbacks auf: `AuthorizationException`, `ModelNotFoundException` und `TokenMismatchException` kommen als `HttpException` (403, 404, 419) an; Zweige für die Originale wären tot.
- Setzt man `fortify.limiters.login`, entfällt in Fortifys Standard-Pipeline `EnsureLoginIsNotThrottled`; die Pipeline steht darum explizit in `FortifyServiceProvider` (`LoginThrottleTest` hält sie fest). Mit 2FA in Phase 2 muss `RedirectsIfTwoFactorAuthenticatable` dort hinein.
- Middleware-Reihenfolge: `SetLocale` und `PreventRequestForgery` stehen in der Prioritätsliste vor den Drosseln, sonst kommen 429 und 419 in der Standardsprache.
- Inertia-Tests (`assertInertia`) verlangen die Seitendatei in `resources/js/pages` (`ensure_pages_exist`); Seite und Route in einem Zug anlegen.
- Ein `(page) => …`-Layout muss eine Pfeilfunktion sein: Inertia v3 behandelt nur Funktionen ohne `prototype` so, eine `function`-Deklaration rendert es als Komponente mit den Seiten-Props (React-Fehler #31). `ErrorLayout` ist deshalb bewusst eine `function`.
- Tailwind scannt nur `resources/`; Klassen in `app/` oder `docs/` greifen nicht.
- `Locale::default()` und damit `SetLocale` (jeder Web-Request) brauchen die migrierte Organisationszeile: ohne `organization`-Zeile (Migration nicht gelaufen, Tabelle geleert) scheitert jede Seite mit `ModelNotFoundException`.
- Tests, die die Organisation ändern, nehmen `Organization::current()->update([...])`, nie eine frisch geladene Instanz (die `scoped`-Instanz bliebe veraltet). Datenbank-Defaults stehen nach `create()` nicht im Modell (`null` statt `false`): Factories setzen sie ausdrücklich. `migrate:fresh` leert auch die Dev-Datenbank (Demo-Daten danach neu seeden).
- Eloquent speichert die Wanduhr der App-Zeitzone (UTC): lokale Zeiten vorher mit `->utc()` umrechnen.
- Events nur in Transaktionen: `RefreshDatabase` hält jeden Feature-Test in einer Transaktion, dort ist der `LogicException`-Zweig von `EventRecorder` unerreichbar (Test darum in `tests/Integration`). `Queue::fake()` beachtet `afterCommit` nicht: ein zurückgerolltes Event erscheint dort trotzdem als gepushter `DispatchEvent`; für Rollback-Tests nur `ConsumeEvent` faken (`Queue::fake([ConsumeEvent::class])`).
- Konsumenten (`EventConsumer::consume()`) laufen in der Claim-Transaktion: dort nur Datenbank-Schreibzugriffe und Wirkungen nach außen, die selbst idempotent sind. Nicht idempotente Wirkungen (Mail, Webhook-HTTP) nur über eigene Jobs mit eigener Dedupe-Zeile, `->afterCommit()` eingestellt; sonst gehen sie bei einem Fehler und erneutem Versuch doppelt raus. Ein Konsument, der alle Versuche verbraucht, landet in `failed_jobs` und läuft nur über `queue:retry` erneut, der Redispatcher greift nicht (das Event hat `dispatched_at`).
- `Request::cookies->get()` wirft bei `locale[]=de` einen 500; Cookies über `cookies->all()` lesen.
- PCOV meldet bei jedem PHP-Aufruf „JIT is incompatible with third party extensions“; `.ddev/php/jit.ini` schaltet das JIT aus und hält die Ausgabe sauber.
- Playwright: Chrome meldet jede 404/500-Antwort als Konsolenfehler; erwartete Fehler stehen in der Fixture `allowedErrors`. Login-Drosseln setzt `cache:clear` zurück (`globalSetup`, `beforeAll` der Reset-Spec). Reset-Mails prüft der Test über Mailpit, und zwar über neue Nachrichten-IDs und eine Adresse je Lauf, nie über Zeitstempel (Mac- und Container-Uhr können abweichen).
