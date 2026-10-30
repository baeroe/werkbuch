# Phase 1: Fundament – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Repo von „Spec und Klickdummy“ zu einer lauffähigen Laravel-13-App im Root umbauen: DDEV mit MariaDB, Meilisearch, Mailpit, Queue, Scheduler, Reverb und Vite-HMR; Pest mit 100 % Abdeckung, Larastan 8, Pint und Architekturtests; Problem Details; Anmeldung mit Fortify; i18n en/de; der Klickdummy-Komponentensatz, Kürzel-Register, API-Schicht und Shell in `resources/js`; Abdeckungs-Pipeline mit Playwright; VitePress-Gerüst; CI mit `tests`, `e2e`, `docs`, `clickdummy`.

**Architecture:** Laravel liegt im Repo-Root (Skeleton per Composer im DDEV-Container in `tmp-laravel/`, dann per `rsync` ins Root, ohne `prototypes/`, `docs/`, `CLAUDE.md`, `LICENSE`, `README.md` und `.github/` anzufassen). Jeder Anwendungsfall dieser Phase ist eine Action in `app/Actions/Auth/`; Fortify ruft sie über schmale Adapter in `app/Auth/`. Das Frontend ist ein Port des Klickdummys nach `resources/js/` (Inertia v3 statt React Router, `t()` statt deutscher Literale, `http.ts` statt Fake-API). Ein pnpm-Workspace (Root, `docs`, `prototypes/*`) wird im DDEV-Container installiert; `e2e/` ist eine eigene Wurzel auf dem Mac.

**Tech Stack:** PHP 8.4, Laravel 13, MariaDB 11.4, inertiajs/inertia-laravel 3, laravel/fortify 1, laravel/reverb 1, lorisleiva/laravel-actions 2; React 19, TypeScript 7, Vite 8 + laravel-vite-plugin 3, Tailwind 4, Base UI 1, TanStack Query 5, Zustand 5, dnd-kit, Lucide, fontsource; Pest 5 (PCOV), Larastan 3 (Level 8), Pint; Vitest 5 (jsdom, Istanbul), Playwright 1.64, vite-plugin-istanbul 9, istanbul-lib-*; VitePress 1.6 + vitepress-plugin-llms; DDEV 1.25; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (bindend, inkl. „Änderungen vom …“), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Abschnitte „Global Constraints“, „Verträge zwischen den Phasen“, „Phase 1: Fundament“), Gestaltung `prototypes/clickdummy/DESIGN.md` (bindend), `prototypes/clickdummy/README.md` („Routen“, „Tastatur“, „Wo die echte API andockt“), `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md`. Vorbild: `~/development/baeroe/openbill` (`CLAUDE.md` „Fallstricke“, `.ddev/`, `tests/`, `e2e/`, `docs/.vitepress/`, `.github/workflows/tests.yml`).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans. Für Phase 1 entscheidend, wörtlich:

- Branch `feat/phase-01-foundation`. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`.
- Commit-Messages englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (z. B. `Claude Opus 5.5`; Subagents nennen ihr eigenes Modell). Die Commit-Schritte unten nennen nur die Betreffzeile; der Trailer gehört immer dazu.
- PHP, Composer, Artisan und pnpm für die App nur in DDEV: `ddev composer …`, `ddev artisan …`, `ddev exec pnpm …`. Kein PHP auf dem Host. Playwright (`e2e/`) läuft auf dem Mac.
- Nur pnpm, nie npm oder npx; Einmal-Tools mit `pnpm dlx`. pnpm `12.8.1` (`packageManager`), Node `24` (`.node-version`).
- PHP 8.4, Laravel 13, MariaDB 11.4. Primärschlüssel ULID (`HasUlids`), auch `users`.
- UI-Texte und Mails nur über Schlüssel in `lang/en.json` und `lang/de.json` (gleiche Schlüssel, jeder benutzte Schlüssel existiert). URLs ohne Sprachpräfix. Code, Kommentare, Identifier Englisch.
- Abdeckung: 100 % Zeilen PHP (PCOV, `--min=100`) und 100 % Zeilen Frontend (Vitest und Playwright zusammengeführt); Ausnahmen nur mit Begründung im Kommentar (`@codeCoverageIgnore <Grund>` bzw. `/* istanbul ignore next -- <Grund> */`). Larastan Level 8, Pint, `tsc`.
- CI-Pflicht-Job heißt `tests` (`.github/workflows/tests.yml`); der Name ändert sich nie.
- Gestaltung nach `prototypes/clickdummy/DESIGN.md`: Tokens als CSS-Variablen hell/dunkel mit `@theme inline`, Tailwind-Palette entfernt, Schriften lokal (Bricolage Grotesque, Figtree), Icons Lucide, Komponenten auf Base UI, kein shadcn, kein Radix.
- Demo- und Testdaten nur fiktiv (`@example.com`, `@feldwerk.example.com`, Feldwerk, die Personen aus `prototypes/clickdummy/src/api/seed/people.ts`).
- Doku-Seiten in `docs/en/` **und** `docs/de/` mit gleichen Dateinamen im selben PR.
- Der Klickdummy bleibt fachlich eingefroren; in dieser Phase ändern sich an ihm nur Workspace-Anbindung, Dev-Server-Host und README-Kommandos.

## Review Focus

- **Konten erraten über „Passwort vergessen“:** Eine unbekannte Adresse, ein deaktiviertes Konto und eine zweite Anfrage innerhalb der Drossel des Password-Brokers (`RESET_THROTTLED`) bekommen exakt dieselbe Antwort wie ein bestehendes Konto, und es geht keine Mail an Unbekannte oder Deaktivierte. → Task 11, `PasswordResetTest` („answers the same for unknown, disabled and throttled addresses“).
- **Login-Drosselung mit Kanten:** Nach 5 Fehlversuchen für dieselbe E-Mail (egal welche Groß-/Kleinschreibung, mit Leerzeichen) von derselben IP ist 60 s gesperrt, auch mit richtigem Passwort; eine andere E-Mail von derselben IP und dieselbe E-Mail von einer anderen IP sind frei; die IP-Drossel (20/min) erscheint als Feldfehler, nicht als Inertia-Fehlerfenster mit HTML. → Task 11, `LoginThrottleTest`.
- **Host-Header-Injektion in der Reset-Mail:** Der Link in der Mail beginnt immer mit `APP_URL`, auch wenn die Anfrage mit fremdem `Host` kam (in `local`/Tests ist die Host-Prüfung aus). → Task 11, `PasswordResetTest` („builds the reset link from APP_URL, not from the request host“).
- **Abgelaufene Sitzung und alte Links:** Ein Login-Formular, das länger offen war als die Sitzung (419), landet wieder auf der Anmeldung mit lesbarer Meldung statt einem Inertia-Fehlerfenster; ein benutzter oder abgelaufener Reset-Link nennt den Grund am Feld und den Weg zu einem neuen Link. → Task 11, `CsrfExpiryTest` und `PasswordResetTest`; Task 14, `password-reset.spec.ts`.
- **Sprache aus Cookie und Profil:** `locale=fr`, `locale=../de` oder ein verschlüsseltes Fremd-Cookie werden ignoriert (Standard); das Profil schlägt das Cookie; nach dem Abmelden bleibt die Anmeldung in der zuletzt benutzten Sprache; eine Inertia-Navigation, nach der die Sprache wechselt, lädt die Seite neu (keine Seite mit gemischten Sprachen). → Task 5, `LocaleTest`; Task 14, `login.spec.ts`.

---

## Dateistruktur nach Phase 1

Neu im Root: `.ddev/` (Konfiguration, Meilisearch), Laravel (`app/`, `bootstrap/`, `config/`, `database/`, `lang/`, `public/`, `resources/`, `routes/`, `storage/`, `tests/`, `artisan`, `composer.*`, `phpunit.xml`, `phpstan.neon`), Frontend-Werkzeuge (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.node-version`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`), `scripts/` (Abdeckung), `e2e/` (eigene pnpm-Wurzel), VitePress in `docs/` (`package.json`, `.vitepress/`, `en/`, `de/`, `public/`). Verantwortung je Ordner:

| Ort | Inhalt |
|---|---|
| `app/Actions/Auth/` | die Anwendungsfälle dieser Phase (`Authenticate`, `EnsureAdmin`, `SetPassword`) |
| `app/Auth/` | Fortify-Adapter, die nur an Actions übergeben |
| `app/Domain/Accounts/` | reine Regeln (`Handle`) |
| `app/Http/Api/`, `app/Exceptions/` | `ProblemResponse`, `Problem` |
| `app/Http/Middleware/` | `SetLocale`, `HandleInertiaRequests`, `TrustProxies` |
| `app/Support/` | `TrustedRequests`, `MailSetup`, `PasswordRules` |
| `resources/js/{api,hooks,lib,store}/` | HTTP-Schicht, Query-Client, Helfer, Kürzel, UI-State |
| `resources/js/components/ui/` | Komponentensatz des Klickdummys |
| `resources/js/shell/` | Shell, Seitenleiste, Profilmenü, Fehlerseiten (Port von `src/app/`) |
| `resources/js/features/`, `resources/js/pages/` | Bildschirme bzw. die Inertia-Seiten, die nur einen Bildschirm rendern |

## Paketversionen

Composer (Prüfung per `https://repo.packagist.org/p2/<vendor>/<name>.json` am 2026-10-30, illuminate-Constraint der neuesten stabilen Version):

| Paket | Constraint | Phase | Laravel 13 | Hinweis |
|---|---|---|---|---|
| `laravel/framework` | `^13.39` | 1 | ja | Skeleton `laravel/laravel` v13.11.0 |
| `laravel/tinker` | `^3.0` | 1 | ja | |
| `inertiajs/inertia-laravel` | `^3.5` | 1 | ja (`^11.35\|^12\|^13`) | `Inertia::once()` vorhanden |
| `laravel/fortify` | `^1.41` | 1 | ja | |
| `laravel/reverb` | `^1.12` | 1 | ja | nur der Daemon, Kanäle ab Phase 8 |
| `lorisleiva/laravel-actions` | `^2.13` | 1 | ja | |
| `pestphp/pest` / `pestphp/pest-plugin-laravel` | `^5.3` / `^5.0` | 1 (dev) | ja (`^13.23`) | verlangt `phpunit/phpunit ^13`: die Skeleton-Zeile `phpunit/phpunit ^12.5` muss raus |
| `larastan/larastan` | `^3.13` | 1 (dev) | ja | |
| `laravel/pint`, `laravel/pail`, `laravel/pao`, `mockery/mockery`, `nunomaduro/collision`, `fakerphp/faker` | `^1.32`, `^1.2.7`, `^1.0.6`, `^1.6`, `^8.9`, `^1.24` | 1 (dev) | ja | aus dem Skeleton |
| `laravel/sanctum` | `^4.3` | 2 | ja | |
| `spatie/laravel-permission` | `^8.3` | 2 | ja (`^12\|^13`) | Major 8: Teams-API in Phase 2 gegen die v8-Doku prüfen |
| `spatie/laravel-medialibrary` | `^11.23` | 2 | ja | |
| `laravel/scout` | `^11.9` | 6 | ja | |
| `meilisearch/meilisearch-php` + `http-interop/http-factory-guzzle` | `^1.17` + `^1.2` | 6 | – (kein illuminate) | neueste ist `v2.0.0-beta.8`; Scout empfiehlt `^1.0` → stabile 1.x nehmen |
| `ueberdosis/tiptap-php` | `^2.2` | 4 | – (kein illuminate) | zieht `spatie/shiki-php` (ruft Node auf); Phase 7 nutzt Code-Hervorhebung ohne Shiki |
| `league/commonmark`, `league/html-to-markdown` | `^2.10`, `^5.2` | 4 | – | |
| `spatie/laravel-query-builder` | `^7.3` | 5 | ja | |
| `spatie/laravel-webhook-server` | `^4.0` | 11 | ja (nur `^13`) | 4.0.0 vom 2026-10-20, ganz frisch |
| `dedoc/scramble` | `^0.13.52` | 12 | ja | weiter 0.x |
| `laravel/mcp` | `^1.1` | 13 | ja | |

Kein Paket ohne Laravel-13-Support.

pnpm (Quelle `prototypes/clickdummy/package.json`, Rest npm-Registry am 2026-10-30):

- Root `dependencies`: `@base-ui/react ^1.9.0`, `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2`, `@fontsource-variable/bricolage-grotesque ^5.3.0`, `@fontsource-variable/figtree ^5.3.0`, `@inertiajs/react ^3.9.1`, `@tanstack/react-query ^5.105.0`, `@tiptap/core 3.32.0`, `@tiptap/pm 3.32.0`, `lucide-react ^1.62.0`, `react ^19.3.1`, `react-dom ^19.3.1`, `zustand ^5.0.16`.
- Root `devDependencies`: `@tailwindcss/vite ^4.3.3`, `@testing-library/dom ^10.4.2`, `@testing-library/react ^16.3.3`, `@testing-library/user-event ^14.6.8`, `@types/node ^24.19.2`, `@types/react ^19.3.0`, `@types/react-dom ^19.3.0`, `@vitejs/plugin-react ^6.1.2`, `@vitest/coverage-istanbul 5.0.5`, `istanbul-lib-coverage ^3.2.2`, `istanbul-lib-report ^3.0.1`, `istanbul-reports ^3.2.0`, `jsdom ^30.1.3`, `laravel-vite-plugin ^3.2.0`, `tailwindcss ^4.3.3`, `typescript ^7.0.2`, `vite ^8.3.5`, `vite-plugin-istanbul ^9.0.1`, `vitest 5.0.5` (exakt: `@vitest/coverage-istanbul` verlangt dieselbe Version).
- `docs`: `vitepress ^1.6.4`, `vitepress-plugin-llms ^1.14.0`, die beiden fontsource-Pakete wie oben; Override `vitepress>vite: ^6.4.3` im Root-Workspace (wie openbill).
- `e2e`: `@playwright/test 1.64.0` (exakt wie der Klickdummy), `@types/node ^24.19.2`, `typescript ^7.0.2`.
- Erst ab ihrer Phase: TanStack Virtual, Tiptap-Erweiterungen, `fractional-indexing`, `lowlight`, Laravel Echo.

Images (Tag und Digest, Docker Hub am 2026-10-30): `getmeili/meilisearch:v1.56.0@sha256:1f578fa865f8251894b3bf38d6668d6209a3f451f8f65ab953e129d4c1db5ef4`, `mariadb:11.4.13@sha256:1292844148b311e4ed4300022a996d39083f415a963e970cf47cad1b3b18e3a6` (wie openbill), `axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498`.

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 1 | Ziel | Task |
|---|---|---|
| `styles/tokens.css`, `styles/app.css`, Schriften, Theme-Skript aus `index.html`, `lib/theme.ts` | `resources/css/`, `app.blade.php`, `resources/js/lib/` | 4 |
| `lib/shortcuts/{registry,useShortcut}.ts` (+ neuer Katalog), `lib/{platform,storage,media}.ts` | `resources/js/lib/` | 6 |
| `types.ts`, `api/client.ts` (nur `ApiError`, `Page`, `PageArgs`, `MAX_PER_PAGE`, `reasonText`), `api/live.ts` (Stub), `hooks/{queryClient,retry,live}.ts` | `resources/js/` | 7 |
| `components/ui/*` mit `ui.test.tsx`, dazu `FavoriteStar`, `CopyField`, `FormDialog`, `Sortable` (13b), `lib/{errors,undo}.ts` | `resources/js/components/ui/`, `resources/js/lib/` | 8, 9 |
| `features/auth/{AuthLayout,Login,ForgotPassword}.tsx` (+ neu `ResetPassword`) | `resources/js/features/auth/` | 11 |
| `app/{Shell,Sidebar,ProfileMenu,LiveIndicator,PageStates,bindings}.tsx`, `lib/shortcuts/HelpOverlay.tsx`, `store/ui.ts`, `lib/{links,useDocumentTitle}.ts` | `resources/js/shell/`, `resources/js/lib/`, `resources/js/store/` | 12 |

Nicht portiert (nie): `api/db.ts`, `api/seed/`, die Fake-Körper aller `api/*.ts`, `lib/clock.ts` (Demo-Uhr), `store/session.ts`, „Als … ansehen“, „Live-Ereignis simulieren“, „Live-Verbindung trennen“, „Demo zurücksetzen …“, `api:fail`, Review-Build (`scripts/artifact.mjs`, `serve.mjs`, Hash-Router), `scripts/shots.mjs`. Nicht in Phase 1 (kommt mit der Phase des Bildschirms): `components/{fields,items}`, `domain/`, alle übrigen `features/*`, `lib/{commands,permissions,richtext}.ts`, `app/{PeekHost,CreateHost}`, die Galerie (`routes/`).

## Abdeckung über die Tasks

- **PHP:** Ab Task 2 ist `ddev artisan test --coverage --min=100` am Ende jeder Task grün. Jede Task bringt die Tests für ihren PHP-Code mit.
- **Frontend, Vitest:** Ab Task 4 ist `ddev exec pnpm test:coverage` am Ende jeder Task grün. `vitest.config.ts` hat Schwellen von 100 % Zeilen je Ordner, die mit dem Ordner dazukommen: `resources/js/lib/**` (Task 4), `resources/js/api/**`, `resources/js/hooks/**` (Task 7), `resources/js/components/ui/**` (Task 8), `resources/js/store/**` (Task 12). `pages/`, `features/`, `shell/` und `app.tsx` haben keine Vitest-Schwelle; sie deckt Playwright ab.
- **Frontend, zusammengeführt:** Ab Task 14 ist die Grenze von 100 % Zeilen über `resources/js/**` aktiv (`pnpm --dir e2e test`, dessen Global-Teardown `pnpm coverage:merge` ausführt). Was bis dahin in `pages/`, `features/`, `shell/` entstanden ist, deckt Task 14 mit Playwright oder gezielten Vitest-Tests ab.

---

### Task 1: Laravel 13 und DDEV im Repo-Root

**Files:**
- Create: `.ddev/config.yaml`, `.ddev/docker-compose.meilisearch.yaml`, Skeleton-Dateien (`app/`, `bootstrap/`, `config/`, `database/`, `public/`, `routes/`, `storage/`, `artisan`, `composer.json`, `composer.lock`, `.editorconfig`, `.gitattributes`), `app/Enums/{AccountType,Locale}.php`, `config/reverb.php`, `config/broadcasting.php`, `routes/channels.php`
- Modify: `.gitignore`, `.env.example` (neu), `database/migrations/0001_01_01_000000_create_users_table.php`, `app/Models/User.php`, `database/factories/UserFactory.php`
- Bewusst **nicht** aus dem Skeleton: `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, `.github/`, `.styleci.yml`, `.gitignore`, `.npmrc`, `package.json`, `vite.config.js`, `resources/js/`, `resources/css/app.css`, `resources/views/welcome.blade.php`, `tests/`, `phpunit.xml`, `vendor/`, `composer.lock`

**Interfaces:**
- Consumes: –
- Produces: DDEV-Projekt `werkbuch` unter `https://werkbuch.ddev.site`; DB `db:3306` (`db`/`db`/`db`) und Test-DB `testing`; Meilisearch `http://meilisearch:7700` (Master-Key `ddev-werkbuch-master-key`, Oberfläche `https://werkbuch.ddev.site:7701`); Mailpit SMTP `127.0.0.1:1025` im Web-Container, Oberfläche und API `https://werkbuch.ddev.site:8026`; Ports `5173` (Vite), `5174` (VitePress), `5176` (Klickdummy), `6001` (Reverb), alle per HTTPS. `App\Enums\AccountType: string { Person = 'person'; Bot = 'bot'; }`, `App\Enums\Locale: string { En = 'en'; De = 'de'; public static function values(): list<string>; }`. `App\Models\User` (ULID; Spalten `type`, `name`, `handle`, `email`, `password`, `locale`, `timezone`, `disabled_at`, `remember_token`), `UserFactory` mit States `bot()`, `disabled()`, `locale(Locale $l)`.

- [ ] **Step 1: DDEV-Konfiguration schreiben**

`.ddev/config.yaml` (komplett):

```yaml
name: werkbuch
type: laravel
docroot: public
php_version: "8.4"
webserver_type: nginx-fpm
xdebug_enabled: false
database:
  type: mariadb
  version: "11.4"
composer_version: "2"
nodejs_version: "24"
corepack_enable: true
# PCOV for `ddev artisan test --coverage` (Xdebug stays off)
webimage_extra_packages: ["php${DDEV_PHP_VERSION}-pcov"]
web_environment:
  - COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# https://werkbuch.ddev.site:<https_port> → container port
web_extra_exposed_ports:
  - { name: vite, container_port: 5173, http_port: 5172, https_port: 5173 }
  - { name: vitepress, container_port: 5174, http_port: 5175, https_port: 5174 }
  - { name: clickdummy, container_port: 5176, http_port: 5177, https_port: 5176 }
  - { name: reverb, container_port: 6001, http_port: 6002, https_port: 6001 }
# each daemon waits until composer install and .env exist, so a fresh clone starts cleanly
web_extra_daemons:
  - name: queue
    command: bash -c 'until [ -f vendor/autoload.php ] && [ -f .env ]; do sleep 5; done; exec php artisan queue:listen --queue=default,notifications,webhooks,search,media,bulk --sleep=1 --tries=3'
    directory: /var/www/html
  - name: scheduler
    command: bash -c 'until [ -f vendor/autoload.php ] && [ -f .env ]; do sleep 5; done; exec php artisan schedule:work'
    directory: /var/www/html
  - name: reverb
    command: bash -c 'until [ -f vendor/autoload.php ] && [ -f .env ]; do sleep 5; done; exec php artisan reverb:start --host=0.0.0.0 --port=6001'
    directory: /var/www/html
hooks:
  post-start:
    # separate database for Pest (phpunit.xml forces DB_DATABASE=testing)
    - exec: bash -c 'C=$(command -v mariadb || command -v mysql); $C -uroot -proot -e "CREATE DATABASE IF NOT EXISTS testing; GRANT ALL ON testing.* TO '"'"'db'"'"'@'"'"'%'"'"';"'
      service: db
```

`.ddev/docker-compose.meilisearch.yaml` (komplett):

```yaml
# Meilisearch v1 for Scout (phase 6). Reachable from the web container as http://meilisearch:7700,
# the dashboard as https://werkbuch.ddev.site:7701. Pinned like docker-compose.yml (phase 14).
services:
  meilisearch:
    container_name: ddev-${DDEV_SITENAME}-meilisearch
    image: getmeili/meilisearch:v1.56.0@sha256:1f578fa865f8251894b3bf38d6668d6209a3f451f8f65ab953e129d4c1db5ef4
    restart: "no"
    environment:
      MEILI_ENV: development
      MEILI_MASTER_KEY: ddev-werkbuch-master-key
      MEILI_NO_ANALYTICS: "true"
      VIRTUAL_HOST: $DDEV_HOSTNAME
      HTTP_EXPOSE: "7702:7700"
      HTTPS_EXPOSE: "7701:7700"
    volumes:
      - meilisearch:/meili_data
    labels:
      com.ddev.site-name: ${DDEV_SITENAME}
      com.ddev.approot: ${DDEV_APPROOT}
    expose:
      - "7700"
volumes:
  meilisearch:
    name: ${DDEV_SITENAME}-meilisearch
```

- [ ] **Step 2: DDEV starten**

```bash
cd /Users/rafael/development/baeroe/werkbuch
mkdir -p public
ddev start
ddev mysql -uroot -proot -e "SHOW DATABASES" | grep -E "^(db|testing)$"
ddev exec curl -s http://meilisearch:7700/health
ddev exec php -m | grep -i pcov
```

Expected: `Successfully started werkbuch`; `db` und `testing`; `{"status":"available"}`; `pcov`. Scheitert der DB-Hook mit „Access denied“: `ddev describe` prüfen (Root-Passwort ist `root`) und beheben, nicht entfernen.

- [ ] **Step 3: Skeleton in `tmp-laravel/` erzeugen und ins Root übernehmen**

Nicht `ddev composer create-project` (der DDEV-Wrapper verlangt ein leeres Projekt-Root, openbill-Fallstrick):

```bash
ddev exec --dir /var/www/html composer create-project laravel/laravel tmp-laravel "^13.0" --prefer-dist --no-install --no-scripts --no-interaction
rsync -a \
  --exclude README.md --exclude CHANGELOG.md --exclude CLAUDE.md --exclude AGENTS.md --exclude .github \
  --exclude .styleci.yml --exclude .gitignore --exclude .npmrc --exclude package.json --exclude vite.config.js \
  --exclude 'resources/js' --exclude 'resources/css' --exclude 'resources/views/welcome.blade.php' \
  --exclude tests --exclude phpunit.xml --exclude vendor --exclude node_modules --exclude composer.lock \
  tmp-laravel/ ./
rm -rf tmp-laravel
git status --short | grep -E "^( M|M )" || echo "no tracked file modified"
```

Expected: `no tracked file modified` (README, LICENSE, CLAUDE.md, docs/, prototypes/, .github/ unverändert).

- [ ] **Step 4: `.gitignore` ersetzen**

Bestehende Einträge behalten (Klickdummy-Ordner, `/.superpowers/`, `/.claude/worktrees/`, `/.playwright-mcp`, `/.pnpm-store/`, `node_modules/`, `.env`, `.DS_Store`, `*.log`, `/.idea`, `/.vscode`, `Thumbs.db`) und ergänzen: `.env.backup`, `.env.production`, `.phpunit.result.cache`, `/.phpunit.cache`, `/auth.json`, `/public/build`, `/public/hot`, `/public/storage`, `/storage/*.key`, `/storage/pail`, `/vendor`, `/tmp-laravel`, `/coverage`, `/docs/.vitepress/cache`, `/docs/.vitepress/dist`, `/e2e/.auth`, `/e2e/test-results`, `/e2e/playwright-report`.

- [ ] **Step 5: `.env.example` für DDEV schreiben**

Basis ist die `.env.example` des Skeletons. Geändert bzw. ergänzt (Werte sind Entscheidungen; Kommentare wie angegeben):

| Block | Werte |
|---|---|
| App | `APP_NAME=werkbuch`, `APP_URL=https://werkbuch.ddev.site`, `APP_LOCALE=en`, `APP_FALLBACK_LOCALE=en` |
| DB (`# DDEV defaults (CI sets its own values)`) | `DB_CONNECTION=mariadb`, `DB_HOST=db`, `DB_PORT=3306`, `DB_DATABASE=db`, `DB_USERNAME=db`, `DB_PASSWORD=db` |
| Sitzung (`# seven days without activity before the next sign-in`) | `SESSION_DRIVER=database`, `SESSION_LIFETIME=10080` |
| Infrastruktur | `CACHE_STORE=database`, `QUEUE_CONNECTION=database`, `BROADCAST_CONNECTION=reverb`, `FILESYSTEM_DISK=local` |
| Mail (`# DDEV ships Mailpit: https://werkbuch.ddev.site:8026`) | `MAIL_MAILER=smtp`, `MAIL_HOST=127.0.0.1`, `MAIL_PORT=1025`, `MAIL_FROM_ADDRESS="werkbuch@example.com"` |
| Suche (`# search (phase 6)`) | `SCOUT_DRIVER=meilisearch`, `MEILISEARCH_HOST=http://meilisearch:7700`, `MEILISEARCH_KEY=ddev-werkbuch-master-key` |
| Live (`# live updates (phase 8)`) | `REVERB_APP_ID=werkbuch`, `REVERB_APP_KEY=werkbuch-dev-key`, `REVERB_APP_SECRET=werkbuch-dev-secret`, `REVERB_HOST=werkbuch.ddev.site`, `REVERB_PORT=6001`, `REVERB_SCHEME=https`, `REVERB_SERVER_HOST=0.0.0.0`, `REVERB_SERVER_PORT=6001` |
| Proxy (`# IPs/CIDR of the reverse proxies, empty = localhost and private networks`) | `TRUSTED_PROXIES=` |
| Erstes Konto (`# created by php artisan app:ensure-admin (local development only)`) | `ADMIN_EMAIL=admin@example.com`, `ADMIN_PASSWORD=password` |
| werkbuch | `ATTACHMENTS_MAX_MB=25`, `NOTIFICATION_MAIL_DELAY=5`, `WEBHOOKS_ALLOW_PRIVATE=false` |

- [ ] **Step 6: `users`-Migration als Person-Tabelle umbauen**

`0001_01_01_000000_create_users_table.php` (die erste Migration wird nicht später geändert, darum jetzt endgültig): `users` mit `ulid('id')->primary()`, `string('type', 16)->default('person')`, `string('name')`, `string('handle', 32)->unique()`, `string('email')->nullable()->unique()`, `string('password')->nullable()`, `string('locale', 2)->nullable()`, `string('timezone', 64)->nullable()`, `timestamp('disabled_at')->nullable()`, `rememberToken()`, `timestamps()`; kein `email_verified_at`. `password_reset_tokens` bleibt. `sessions.user_id` wird `foreignUlid('user_id')->nullable()->index()`. Bots, Rollen, `is_default_bot`, `owner_id` und 2FA-Spalten folgen in Phase 2.

- [ ] **Step 7: Enums, Model, Factory**

`App\Enums\AccountType` und `App\Enums\Locale` wie unter Produces. `App\Models\User`: `HasUlids`, `HasFactory`, `Notifiable`; `$fillable = ['type','name','handle','email','password','locale','timezone','disabled_at']`; `$hidden = ['password','remember_token']`; `casts()`: `type` → `AccountType`, `locale` → `Locale`, `disabled_at` → `datetime`, `password` → `hashed`. Methoden `isPerson(): bool`, `isDisabled(): bool`. Die `@property`-Annotationen für Larastan stehen am Model. `UserFactory`: Person mit `handle` `user-` + 6 Kleinbuchstaben (unique), `email` `<handle>@example.com`, `password` statisch `password`, `locale`/`timezone` null; States wie unter Produces (`bot()`: `type` Bot, `email` und `password` null).

- [ ] **Step 8: composer.json anpassen, Reverb installieren, migrieren**

```bash
ddev composer config name baeroe/werkbuch
ddev composer config description "Open, self-hosted project management with custom types, workflows, views, wiki, REST API, MCP and webhooks."
ddev composer config license MIT
ddev composer config --unset scripts.setup
ddev composer config --unset scripts.dev
ddev composer require "php:^8.4" "laravel/framework:^13.39" --no-update
ddev composer update --no-interaction
ddev composer require laravel/reverb:^1.12
cp .env.example .env
ddev artisan key:generate
ddev artisan install:broadcasting --reverb --without-node --no-interaction
ddev artisan migrate --no-interaction
```

Danach: `routes/channels.php` enthält keine Kanäle (Kommentar „channels arrive in phase 8 (spec 7.2)“; der Standardkanal `App.Models.User.{id}` mit `(int)`-Vergleich passt nicht zu ULIDs). Legt `install:broadcasting` Dateien unter `resources/js/` an, werden sie gelöscht. `.env.example` behält die REVERB-Werte aus Step 5.

- [ ] **Step 9: Prüfen**

```bash
ddev artisan --version
curl -sk -o /dev/null -w '%{http_code}\n' https://werkbuch.ddev.site/up
ddev restart
ddev exec 'ps aux | grep -cE "[q]ueue:listen|[s]chedule:work|[r]everb:start"'
ddev composer validate
```

Expected: `Laravel Framework 13.x`; `200`; `3`; `./composer.json is valid`.

- [ ] **Step 10: Commit**

`git add -A .ddev .gitignore .env.example .editorconfig .gitattributes app artisan bootstrap composer.json composer.lock config database public routes storage` (prüfen: `.env`, `vendor/`, `tmp-laravel/` tauchen nicht auf). Betreff: `feat: add Laravel 13 with DDEV, MariaDB, Meilisearch, Mailpit and the dev daemons`.

---

### Task 2: Pest, Abdeckung, Larastan, Pint und Architekturtests

**Files:**
- Create: `phpunit.xml`, `phpstan.neon`, `tests/Pest.php`, `tests/TestCase.php`, `tests/Unit/ArchTest.php`, `tests/Unit/CoverageIgnoreTest.php`, `tests/Feature/HealthTest.php`, `tests/Feature/UserTest.php`, `tests/Integration/DatabaseTest.php`
- Modify: `composer.json`

**Interfaces:**
- Consumes: `App\Models\User`, `UserFactory` (Task 1)
- Produces: Suiten `Unit` (ohne App), `Feature` (`Tests\TestCase` + `RefreshDatabase`, MariaDB `testing`), `Integration` (`DatabaseMigrations`); Gate-Kommando `ddev artisan test --coverage --min=100`; Architekturregeln, die alle späteren Tasks einhalten; Helfer `appFiles(string $dir): list<string>` und `codeLines(string $code, string $pattern, string $file): list<string>` in `tests/Pest.php` für Text-Scans.

- [ ] **Step 1: Pakete**

```bash
ddev composer remove --dev phpunit/phpunit --no-update
ddev composer require --dev "pestphp/pest:^5.3" "pestphp/pest-plugin-laravel:^5.0" "larastan/larastan:^3.13" -W
ddev composer config allow-plugins.pestphp/pest-plugin true
```

- [ ] **Step 2: `phpunit.xml`, `phpstan.neon`, `tests/Pest.php`, `tests/TestCase.php`**

`phpunit.xml`: Suiten `Unit` (`tests/Unit`), `Feature` (`tests/Feature`), `Integration` (`tests/Integration`); `<source><include><directory>app</directory></include></source>`; `<env>`: `APP_ENV=testing`, `APP_MAINTENANCE_DRIVER=file`, `BCRYPT_ROUNDS=4`, `BROADCAST_CONNECTION=null`, `CACHE_STORE=array`, `DB_CONNECTION=mariadb` (force), `DB_DATABASE=testing` (force), `DB_URL=`, `ADMIN_EMAIL=` (force), `ADMIN_PASSWORD=` (force), `MAIL_MAILER=array`, `QUEUE_CONNECTION=sync`, `SESSION_DRIVER=array`, `SCOUT_DRIVER=null`, `PULSE_ENABLED=false`, `TELESCOPE_ENABLED=false`, `NIGHTWATCH_ENABLED=false`.

`phpstan.neon`: `includes: vendor/larastan/larastan/extension.neon`, `level: 8`, `parseModelCastsMethod: true`, `paths: [app, bootstrap/app.php, config, database, routes]`. Keine Baseline.

`tests/Pest.php`: `pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Feature')`; `pest()->extend(TestCase::class)->use(DatabaseMigrations::class)->in('Integration')`; Unit ohne Basisklasse. `tests/TestCase.php` ruft in `setUp()` `$this->withoutVite()`.

- [ ] **Step 3: Tests schreiben**

`tests/Feature/HealthTest.php`:

```php
it('answers the health check', fn () => $this->get('/up')->assertOk());
```

`tests/Feature/UserTest.php`:

```php
it('stores people with a ULID, a hashed password and typed columns', function () {
    $user = User::factory()->locale(Locale::De)->create(['password' => 'secret-pass']);

    expect(Str::isUlid($user->id))->toBeTrue()
        ->and($user->type)->toBe(AccountType::Person)
        ->and($user->locale)->toBe(Locale::De)
        ->and(Hash::check('secret-pass', $user->password))->toBeTrue()
        ->and($user->isPerson())->toBeTrue()
        ->and($user->isDisabled())->toBeFalse();
});

it('knows bots and disabled accounts', function () {
    expect(User::factory()->bot()->create()->isPerson())->toBeFalse()
        ->and(User::factory()->bot()->create()->email)->toBeNull()
        ->and(User::factory()->disabled()->create()->isDisabled())->toBeTrue();
});

it('refuses a second account with the same handle or email', function () {
    User::factory()->create(['handle' => 'mara', 'email' => 'mara@example.com']);

    expect(fn () => User::factory()->create(['handle' => 'mara']))->toThrow(UniqueConstraintViolationException::class)
        ->and(fn () => User::factory()->create(['email' => 'mara@example.com']))->toThrow(UniqueConstraintViolationException::class);
});
```

`tests/Integration/DatabaseTest.php`:

```php
it('runs on MariaDB 11.4 with utf8mb4', function () {
    expect((string) DB::scalar('select version()'))->toStartWith('11.4')
        ->and(DB::connection()->getConfig('charset'))->toBe('utf8mb4');
});
```

`tests/Unit/ArchTest.php` (Regeln wachsen in späteren Phasen):

```php
arch('php preset')->preset()->php();
arch('security preset')->preset()->security();
arch('no debugging leftovers')->expect(['dd', 'dump', 'ray', 'var_dump', 'print_r'])->not->toBeUsed();
arch('models are Eloquent models')->expect('App\Models')->toExtend(Model::class);
arch('enums are string backed')->expect('App\Enums')->toBeStringBackedEnums();
arch('actions are final, use AsAction and run through handle()')
    ->expect('App\Actions')->classes()->toBeFinal()->toUseTrait(AsAction::class)->toHaveMethod('handle');
arch('the domain is plain PHP')
    ->expect('App\Domain')->not->toUse(['Illuminate', 'Carbon', 'App\Models', 'App\Actions', 'App\Http', 'App\Support', 'App\Exceptions']);
arch('domain classes are final')->expect('App\Domain')->classes()->toBeFinal();
arch('http, console and jobs leave the database to actions')
    ->expect(['App\Http', 'App\Console', 'App\Jobs', 'App\Auth'])->not->toUse('Illuminate\Support\Facades\DB');
arch('models never call actions')->expect('App\Models')->not->toUse('App\Actions');

it('detects raw database writes', function () {
    $code = "<?php\nDB::table('users')->update([]);\nDB::table('users')->where('a', 1)->delete();\nDB::statement('x');\nDB::table('users')->get();";
    expect(rawWrites($code))->toBe(['code:2', 'code:3', 'code:4']);
});

it('writes the database raw only inside app/Actions', function () {
    $hits = collect(appFiles('app'))->reject(fn (string $f) => str_starts_with($f, 'app/Actions/'))
        ->flatMap(fn (string $f) => rawWrites((string) file_get_contents(base_path($f)), $f))->all();
    expect($hits)->toBe([]);
});

it('detects model writes', function () {
    expect(modelWrites("<?php\n\$user->save();\n\$this->set->handle(\$u);\nUser::create([]);"))->toBe(['code:2', 'code:4']);
});

it('never writes models in controllers, middleware, commands, jobs or auth adapters', function () {
    $hits = collect(['app/Http', 'app/Console', 'app/Jobs', 'app/Auth'])->flatMap(fn ($d) => appFiles($d))
        ->flatMap(fn (string $f) => modelWrites((string) file_get_contents(base_path($f)), $f))->all();
    expect($hits)->toBe([]);
});
```

Namensräume ohne Klassen (`App\Actions`, `App\Domain` bis Task 10) bestehen die `arch()`-Regeln trivial. `rawWrites()` findet `DB::table(...)` gefolgt von `->(insert|insertOrIgnore|insertGetId|update|updateOrInsert|upsert|delete|truncate|increment|decrement)(` in derselben Anweisung sowie `DB::(insert|update|delete|statement|unprepared)(`; `modelWrites()` findet `->(save|update|delete|forceFill|fill|forceDelete|restore|increment|decrement)(` und `::(create|insert|destroy|updateOrCreate|firstOrCreate)(`. Beide geben `datei:zeile` zurück und stehen in `tests/Pest.php`, ebenso `appFiles()` (rekursiv, Pfade relativ zum Root, nur `.php`). Ein fehlender Ordner liefert `[]`.

`tests/Unit/CoverageIgnoreTest.php`: jedes `@codeCoverageIgnore` (auch `Start`/`End`) in `app/` hat danach auf derselben Zeile einen Grund von mindestens drei Wörtern; Selbsttest des Detektors mit `"// @codeCoverageIgnore"` (Treffer) und `"// @codeCoverageIgnore the CLI never runs this branch"` (kein Treffer).

- [ ] **Step 4: Laufen lassen**

```bash
ddev artisan test --coverage --min=100
ddev exec vendor/bin/phpstan analyse --memory-limit=1G
ddev exec vendor/bin/pint --test
```

Expected: alle Suiten grün, `Total: 100.0 %`; `[OK] No errors`; Pint ohne Befund (vorher einmal `ddev exec vendor/bin/pint` auf das Skeleton). Fehlt `AppServiceProvider` an Abdeckung: leere Methoden sind abgedeckt, sobald die App bootet; sonst nichts mit Ignore-Kommentar lösen, sondern testen.

- [ ] **Step 5: Commit**

Betreff: `test: add Pest suites with PCOV coverage, Larastan level 8, Pint and architecture tests`.

---

### Task 3: Problem Details, `config/werkbuch.php`, Proxies und Host-Prüfung

**Files:**
- Create: `app/Exceptions/Problem.php`, `app/Http/Api/ProblemResponse.php`, `app/Support/TrustedRequests.php`, `app/Http/Middleware/TrustProxies.php`, `config/werkbuch.php`, `routes/api.php`, `lang/en.json`, `lang/de.json`, `tests/Feature/ProblemTest.php`, `tests/Feature/ConfigTest.php`, `tests/Feature/TrustedProxiesTest.php`
- Modify: `bootstrap/app.php`, `tests/Unit/ArchTest.php`

**Interfaces:**
- Consumes: –
- Produces (Vertrag aus dem Master-Plan):
  - `final class App\Exceptions\Problem extends RuntimeException implements Symfony\Component\HttpKernel\Exception\HttpExceptionInterface` (`getStatusCode(): int` = `$status`, `getHeaders(): array` = `[]`; so antwortet ein `Problem` auf Web-Routen mit seinem Status statt 500) mit `public readonly int $status`, `public readonly string $reason`, `public readonly ?string $detail`, `public readonly array $errors = []` (`array<string, list<string>>`), `public readonly array $extensions = []` (`array<string, mixed>`); Fabriken `forbidden(?string $detail = null): self` (403 `forbidden`), `notFound(?string $detail = null): self` (404 `not_found`), `conflict(string $reason, array $extensions = []): self` (409), `invalid(array $errors): self` (422 `validation_failed`), `locked(string $reason): self` (409). Konstante `Problem::REASONS` (`list<string>`): `transition_not_allowed`, `not_closed`, `not_archived`, `archived`, `project_archived`, `forbidden`, `not_found`, `validation_failed`, `description_conflict`, `page_conflict`, `parent_not_epic`, `epic_has_no_parent`, `last_admin`, `in_use`, `unauthenticated`, `too_many_requests`, `bad_request`, `method_not_allowed`, `payload_too_large`, `csrf_token_mismatch`, `conflict`, `server_error`, `service_unavailable`, `http_error` (alle Slugs der HTTP-Status stehen darin; die ersten 14 = `REASON_TEXT` des Klickdummys ohne `simulated`).
  - `final class App\Http\Api\ProblemResponse { public static function from(Throwable $e, bool $debug): JsonResponse }` mit Body `{type: "urn:werkbuch:problem:<reason>", title, status, detail, reason, errors?, ...extensions}`, Header `Content-Type: application/problem+json` und bei 429 `Retry-After`.
  - `config('werkbuch.*')`: `version` (`'0.1.0-dev'`), `admin.email`, `admin.password` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), `trusted_proxies` (`TRUSTED_PROXIES`), `attachments_max_mb` (int, `ATTACHMENTS_MAX_MB`, 25), `notification_mail_delay` (int Minuten, `NOTIFICATION_MAIL_DELAY`, 5), `webhooks_allow_private` (bool, `WEBHOOKS_ALLOW_PRIVATE`, false), `event_consumers` (`[]`), `rate_limits.api` (600), `rate_limits.mcp` (300), `rate_limits.login_per_ip` (20).
  - `final class App\Support\TrustedRequests` mit `PROXIES = ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']`, `proxies(): list<string>`, `parseProxies(mixed $value): list<string>`, `hostPatterns(mixed $appUrl): list<string>` (wie openbill).
  - `routes/api.php` (leer, Präfix `api/v1` über `withRouting(api: …, apiPrefix: 'api/v1')`).

- [ ] **Step 1: Failing Tests schreiben**

`tests/Feature/ProblemTest.php` (Routen im Test anlegen: `Route::middleware('api')->prefix('api/v1')->get('_t/...', …)`):

```php
it('renders a Problem as application/problem+json', function () {
    Route::get('api/v1/_t/conflict', fn () => throw Problem::conflict('description_conflict', ['current' => ['id' => 'x']]));

    $this->getJson('api/v1/_t/conflict')->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertExactJson([
            'type' => 'urn:werkbuch:problem:description_conflict', 'title' => __('problem.title.conflict'),
            'status' => 409, 'detail' => __('problem.reason.description_conflict'),
            'reason' => 'description_conflict', 'current' => ['id' => 'x'],
        ]);
});

it('renders validation errors as 422 validation_failed with errors by path', function () {
    Route::post('api/v1/_t/validate', fn (Request $r) => $r->validate(['title' => 'required']));

    $this->postJson('api/v1/_t/validate', [])->assertStatus(422)
        ->assertJsonPath('reason', 'validation_failed')
        ->assertJsonPath('errors.title.0', __('validation.required', ['attribute' => 'title']));
});

it('maps framework exceptions to reasons', function (Closure $throw, int $status, string $reason) {
    Route::get('api/v1/_t/x', $throw);
    $this->getJson('api/v1/_t/x')->assertStatus($status)->assertJsonPath('reason', $reason);
})->with([
    'auth' => [fn () => throw new AuthenticationException(), 401, 'unauthenticated'],
    'policy' => [fn () => throw new AuthorizationException(), 403, 'forbidden'],
    'model' => [fn () => throw (new ModelNotFoundException())->setModel(User::class), 404, 'not_found'],
    'abort 404' => [fn () => abort(404), 404, 'not_found'],
    'throttle' => [fn () => throw new ThrottleRequestsException(headers: ['Retry-After' => 30]), 429, 'too_many_requests'],
    'method' => [fn () => abort(405), 405, 'method_not_allowed'],
    'other http' => [fn () => abort(418), 418, 'http_error'],
    'crash' => [fn () => throw new LogicException('secret internals'), 500, 'server_error'],
]);
```

Dazu in `ProblemTest.php`: „hides internals of 5xx and model names of 404 unless debugging“ (`app.debug=false`: `detail` des Absturzes ist `__('problem.reason.server_error')`, der 404-`detail` enthält nicht `User`), „sends Retry-After with 429“ (Header `Retry-After: 30`), „leaves web routes to Laravel“ (`Problem::forbidden()` auf einer Web-Route → 403, weil `Problem` ein `HttpExceptionInterface` ist; `Content-Type` ohne `problem+json`), „has the factories of the contract“ (`forbidden()` 403, `notFound()` 404, `locked('archived')` 409, `invalid([...])->reason` `validation_failed`).

Die Titel- und Reason-Schlüssel (`problem.title.<slug>` je Status, `problem.reason.<reason>` je `Problem::REASONS`) legt dieser Task mit englischen und deutschen Texten in `lang/en.json`/`lang/de.json` an (Datei hier anlegen; Task 5 baut darauf auf). Deutsche Reason-Texte = `REASON_TEXT` des Klickdummys wörtlich.

`tests/Feature/ConfigTest.php`: Standardwerte (`25`, `5`, `false`, `[]`, `600`, `300`, `20`, `'0.1.0-dev'`); Env-Werte werden gelesen (mit `putenv` + `$this->refreshApplication()` für `ATTACHMENTS_MAX_MB=50`, `WEBHOOKS_ALLOW_PRIVATE=true`).

`tests/Feature/TrustedProxiesTest.php`: openbills `tests/Feature/TrustedProxiesTest.php` übernehmen (Private Netze vertraut, Internet nicht, `X-Forwarded-Prefix` nie, `TRUSTED_PROXIES` ersetzt die Liste, `parseProxies`, `hostPatterns` mit `https://pm.example.com`, `http://localhost:7740`, leer und null, Framework-`TrustProxies` ersetzt), dazu:

```php
it('answers 400 for a foreign Host outside local and tests', function () {
    config(['app.url' => 'https://pm.example.com']);
    $this->app['env'] = 'production';

    $this->get('http://evil.example.net/up')->assertStatus(400);
    $this->get('https://pm.example.com/up')->assertOk();
});
```

- [ ] **Step 2: Rot sehen**

Run: `ddev artisan test --filter='ProblemTest|ConfigTest|TrustedProxiesTest'`
Expected: FAIL (`Class "App\Exceptions\Problem" not found`).

- [ ] **Step 3: Implementieren**

`bootstrap/app.php`: `withRouting(web:, api: __DIR__.'/../routes/api.php', apiPrefix: 'api/v1', commands:, channels:, health: '/up')`; `$middleware->replace(FrameworkTrustProxies::class, TrustProxies::class)`; `$middleware->trustHosts(at: fn (): array => TrustedRequests::hostPatterns(config('app.url')), subdomains: false)`; `$exceptions->dontReportWhen(fn (Throwable $e) => $e instanceof Problem && $e->status < 500)`; `$exceptions->render(fn (Throwable $e, Request $r) => $r->is('api/*') && ! $e instanceof HttpResponseException ? ProblemResponse::from($e, (bool) config('app.debug')) : null)`; `$exceptions->shouldRenderJsonWhen(fn (Request $r) => $r->is('api/*') || $r->expectsJson())`. `TrustProxies::headers()` ohne `X-Forwarded-Prefix`. `ProblemResponse::from` ordnet zu (in dieser Reihenfolge, `Problem` vor dem allgemeinen HTTP-Fall): `Problem` → eigene Werte; `ValidationException` → 422/`validation_failed`/`errors()`; `AuthenticationException` → 401/`unauthenticated`; `AuthorizationException` → 403/`forbidden`; `ModelNotFoundException`, `RecordsNotFoundException` → 404/`not_found`; `TokenMismatchException` → 419/`csrf_token_mismatch`; `HttpExceptionInterface` → Status mit Slug aus `[400 bad_request, 401 unauthenticated, 403 forbidden, 404 not_found, 405 method_not_allowed, 409 conflict, 413 payload_too_large, 419 csrf_token_mismatch, 422 validation_failed, 429 too_many_requests, 500 server_error, 503 service_unavailable]`, sonst `http_error`, Header übernehmen; alles andere → 500/`server_error`. `detail`: eigener Text des `Problem` bzw. der HTTP-Exception (nicht bei 404 und ≥ 500), sonst `__("problem.reason.<reason>")`; mit `$debug` bei 500 die Exception-Meldung. `title`: `__("problem.title.<slug des Status>")`. `errors` nur, wenn nicht leer.

`tests/Unit/ArchTest.php` ergänzen: `arch('the problem is final')->expect(Problem::class)->toBeFinal()->toExtend(RuntimeException::class)->toImplement(HttpExceptionInterface::class)`; `arch('api layer classes are final')->expect('App\Http\Api')->classes()->toBeFinal()`.

- [ ] **Step 4: Grün sehen**

Run: `ddev artisan test --coverage --min=100` und `ddev exec vendor/bin/phpstan analyse --memory-limit=1G`
Expected: PASS, `Total: 100.0 %`, `[OK] No errors`.

- [ ] **Step 5: Commit**

Betreff: `feat: add Problem Details for /api, config/werkbuch.php, trusted proxies and the host check`.

---

### Task 4: pnpm-Workspace und Frontend-Basis

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.node-version`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `resources/views/app.blade.php`, `resources/css/tokens.css`, `resources/css/app.css`, `resources/js/app.tsx`, `resources/js/vite-env.d.ts`, `resources/js/lib/theme.ts`, `resources/js/lib/theme.test.ts`, `resources/js/lib/page.ts`, `resources/js/lib/page.test.ts`, `resources/js/test/setup.ts`, `resources/js/pages/Errors/NotFound.tsx`, `public/favicon.svg`, `app/Http/Middleware/HandleInertiaRequests.php`, `app/Support/MailSetup.php`, `config/inertia.php`, `tests/Feature/InertiaTest.php`, `tests/Unit/ThemeScriptTest.php`
- Modify: `routes/web.php`, `bootstrap/app.php`, `prototypes/clickdummy/vite.config.ts` (nur `server.allowedHosts`), `prototypes/clickdummy/README.md` („Starten“, „Kommandos“), `.github/workflows/tests.yml` (Übergang)
- Delete: `prototypes/clickdummy/pnpm-lock.yaml`, `prototypes/clickdummy/pnpm-workspace.yaml`, `public/favicon.ico`

**Interfaces:**
- Consumes: `App\Models\User` (Task 1)
- Produces:
  - Shared Props (`HandleInertiaRequests::share`): `auth.user` (`null` oder `{id, type, name, handle, email, locale, timezone, avatar_url}`, `avatar_url` in Phase 1 immer `null`), `auth.permissions` (`[]` bis Phase 2), `organization` (`{name, locale, timezone, week_start, logo_url}` aus Config bis Phase 2: `config('app.name')`, `config('app.locale')`, `config('app.timezone')`, `1`, `null`), `features` (`{mail: MailSetup::configured(), live: null}`), `flash` (`{status: session('status'), error: session('error')}`). Task 5 ergänzt `locale` und `translations`.
  - `final class App\Support\MailSetup { public static function configured(): bool }` (falsch für Mailer `log` und `array`).
  - `resources/js/lib/page.ts`: `interface AuthUser { id: string; type: 'person' | 'bot'; name: string; handle: string; email: string | null; locale: Locale | null; timezone: string | null; avatar_url: string | null }`, `interface SharedProps { auth: { user: AuthUser | null; permissions: string[] }; organization: { name: string; locale: Locale; timezone: string; week_start: 0 | 1; logo_url: string | null }; locale: Locale; translations: Record<string, string>; features: { mail: boolean; live: null }; flash: { status: string | null; error: string | null }; errors: Record<string, string> }`, `function useSharedProps(): SharedProps`. `export type Locale = 'de' | 'en'` steht hier, bis Task 7 `@/types` einführt; dann importieren `page.ts` und `i18n.ts` `Locale` von dort.
  - `resources/js/lib/theme.ts` (Port, unverändert): `ThemeChoice`, `THEME_KEY = 'werkbuch:theme'`, `readTheme(): ThemeChoice`, `applyTheme(theme: ThemeChoice): void`.
  - Script-Namen in `package.json`: `dev`, `build`, `typecheck` (`tsc -p .`), `test` (`vitest run`), `test:coverage` (`vitest run --coverage`), `clickdummy` (`pnpm --dir prototypes/clickdummy dev --host 0.0.0.0 --port 5176 --strictPort`). Task 14 ergänzt `build:coverage` und `coverage:merge`.
  - Alias `@/*` → `resources/js/*` (tsconfig, Vite, Vitest).

- [ ] **Step 1: Workspace-Dateien**

`package.json`: `"name": "werkbuch"`, `"private": true`, `"type": "module"`, `"packageManager": "pnpm@12.8.1"`, `"engines": {"node": ">=24"}`, Abhängigkeiten aus „Paketversionen“ (Root). `.node-version`: `24`.

`pnpm-workspace.yaml`:

```yaml
# The root package (the Laravel app's frontend) is always part of the workspace. e2e/ is a root of its own.
packages:
  - docs
  - prototypes/*

# Only listed packages may run build scripts; any other package with build scripts makes
# `pnpm install` fail until it is added here as `true` (fetches/builds a native binary) or `false`.
allowBuilds:
  esbuild: true

overrides:
  # VitePress 1.x pins Vite 5; remove once VitePress 2 is stable
  vitepress>vite: ^6.4.3
```

Klickdummy: `pnpm-lock.yaml` und `pnpm-workspace.yaml` dort löschen (sonst hält pnpm den Ordner für eine eigene Wurzel); in `prototypes/clickdummy/vite.config.ts` nur `server: { allowedHosts: ['.ddev.site'] }` ergänzen. README des Klickdummys: „Starten“ → `ddev exec pnpm install` im Repo-Root, `ddev exec pnpm clickdummy` → `https://werkbuch.ddev.site:5176`; Kommandos als `ddev exec pnpm --dir prototypes/clickdummy <script>`; Playwright-Flows laufen in der CI (Job `clickdummy`), weil `node_modules` aus dem Container Linux-Binaries enthält.

```bash
ddev exec pnpm install
```

Expected: ein `pnpm-lock.yaml` im Root; kein Fehler zu Build-Skripten (sonst `allowBuilds` ergänzen: `true` für native Binaries, `false` für Unnötiges).

- [ ] **Step 2: Vite, TypeScript, Vitest**

`vite.config.ts`: `laravel({ input: ['resources/css/app.css', 'resources/js/app.tsx'], refresh: true })`, `react()`, `tailwindcss()`; Alias `@`; DDEV-HMR wie openbill (`DDEV_PRIMARY_URL_WITHOUT_PORT` → `host: '0.0.0.0'`, `port: 5173`, `strictPort`, `origin: <url>:5173`, `cors.origin: /https?:\/\/([A-Za-z0-9\-.]+)?(\.ddev\.site)(?::\d+)?$/`); `server.watch.ignored`: `storage/framework/views`, `vendor`, `prototypes`, `docs`, `e2e`, `coverage`, `.pnpm-store`.

`tsconfig.json`: Optionen des Klickdummys (`tsconfig.app.json`: `ES2022`, `bundler`, `react-jsx`, `strict`, `verbatimModuleSyntax`, `noUnused*`, `noFallthroughCasesInSwitch`), dazu `resolveJsonModule: true`, `types: ["vite/client", "node"]`, `paths: {"@/*": ["./resources/js/*"]}`, `include: ["resources/js", "vite.config.ts", "vitest.config.ts"]`.

`vitest.config.ts`:

```ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'resources/js') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./resources/js/test/setup.ts'],
    testTimeout: 20_000,
    include: ['resources/js/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'istanbul',
      reporter: ['json', 'text-summary'],
      reportsDirectory: 'coverage/unit',
      include: ['resources/js/**/*.{ts,tsx}'],
      exclude: ['resources/js/**/*.test.{ts,tsx}', 'resources/js/test/**', 'resources/js/**/*.d.ts', 'resources/js/types.ts'],
      // one entry per folder, added by the task that creates the folder (plan "Abdeckung über die Tasks")
      thresholds: { 'resources/js/lib/**': { lines: 100 } },
    },
  },
});
```

`resources/js/test/setup.ts`: wie `prototypes/clickdummy/src/test/setup.ts` (Cleanup, `asyncUtilTimeout: 5000`).

- [ ] **Step 3: Tokens, Schriften, Theme**

`resources/css/tokens.css` = `prototypes/clickdummy/src/styles/tokens.css` (unverändert). `resources/css/app.css` = `src/styles/app.css` mit erster Zeile `@import 'tailwindcss' source(none);` und `@source '../js';` (Tailwind scannt sonst Prototypen und Doku), dann `@import './tokens.css';`. `app.tsx` importiert `@fontsource-variable/bricolage-grotesque/opsz.css` und `@fontsource-variable/figtree`.

`resources/views/app.blade.php`: `<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">`; Meta `viewport`, `color-scheme`, die beiden `theme-color` aus `prototypes/clickdummy/index.html`; das Theme-Skript aus `index.html` wörtlich (setzt `data-theme` nur für `light`/`dark`); `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` (SVG = Data-URI aus `index.html` als Datei); `@viteReactRefresh`, `@vite(['resources/css/app.css', 'resources/js/app.tsx'])`, `<title>werkbuch</title>`, `@inertiaHead`; `<body>@inertia</body>`.

`resources/js/app.tsx`: `createInertiaApp` mit `resolve` über `import.meta.glob('./pages/**/*.tsx')` (ohne `eager`: jede Seite ein Chunk), `setup` rendert `<StrictMode><App {...props} /></StrictMode>`, `progress: { color: '#2f51b6', showSpinner: false }`. Spätere Tasks fügen Provider und Listener hinzu.

- [ ] **Step 4: Inertia-Server**

```bash
ddev composer require inertiajs/inertia-laravel:^3.5
ddev artisan vendor:publish --provider="Inertia\ServiceProvider" --tag=inertia-config
```

`config/inertia.php`: `testing.ensure_pages_exist = true`, `testing.page_paths = [resource_path('js/pages')]`, `testing.page_extensions = ['tsx']`. `bootstrap/app.php`: `$middleware->web(append: [HandleInertiaRequests::class])`. `routes/web.php`: Skeleton-Route `/` entfernen; `Route::fallback(fn () => Inertia::render('Errors/NotFound')->toResponse(request())->setStatusCode(404))`. `pages/Errors/NotFound.tsx`: vorläufig eine Überschrift und ein Satz auf den Tokens (Task 12 ersetzt sie).

- [ ] **Step 5: Tests schreiben**

`tests/Feature/InertiaTest.php` (Helfer `inertiaProbe(): string` in `tests/Pest.php`: registriert `Route::middleware('web')->get('_t/page', fn () => Inertia::render('Errors/NotFound'))` und gibt `'_t/page'` zurück; Tests rufen `->get(inertiaProbe())`, damit spätere Auth-Regeln sie nicht ändern):

```php
it('renders unknown paths as the Inertia 404 page', function () {
    $this->actingAs(User::factory()->create())->get('/does-not-exist')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
});

it('shares the page context with guests', function () {
    $this->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user', null)->where('auth.permissions', [])
        ->where('organization', ['name' => 'werkbuch', 'locale' => 'en', 'timezone' => config('app.timezone'), 'week_start' => 1, 'logo_url' => null])
        ->where('features', ['mail' => false, 'live' => null])
        ->where('flash', ['status' => null, 'error' => null]));
});

it('shares exactly the fields of the signed-in account', function () {
    $user = User::factory()->locale(Locale::De)->create();
    $this->actingAs($user)->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('auth.user', ['id' => $user->id, 'type' => 'person', 'name' => $user->name, 'handle' => $user->handle,
            'email' => $user->email, 'locale' => 'de', 'timezone' => null, 'avatar_url' => null]));
});

it('reports mail as configured unless the mailer only logs', function (string $mailer, bool $configured) {
    config(['mail.default' => $mailer]);
    expect(MailSetup::configured())->toBe($configured);
})->with([['smtp', true], ['log', false], ['array', false]]);
```

`tests/Unit/ThemeScriptTest.php`: `resources/views/app.blade.php` enthält `localStorage.getItem('werkbuch:theme')`, und `resources/js/lib/theme.ts` enthält `THEME_KEY = 'werkbuch:theme'` (Drift-Test).

`resources/js/lib/theme.test.ts`:

```ts
it('reads system for nothing, junk and blocked storage', () => {
  expect(readTheme()).toBe('system');
  localStorage.setItem(THEME_KEY, 'sepia');
  expect(readTheme()).toBe('system');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(readTheme()).toBe('system');
});
it('sets data-theme for light and dark, removes it for system, and survives blocked storage', () => {
  applyTheme('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(true);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBeUndefined();
});
```

`resources/js/lib/page.test.ts`: `useSharedProps()` gibt `usePage().props` zurück (`vi.mock('@inertiajs/react')`).

- [ ] **Step 6: Laufen lassen**

```bash
ddev artisan test --coverage --min=100
ddev exec pnpm typecheck
ddev exec pnpm test:coverage
ddev exec pnpm build
ddev exec 'pnpm --filter werkbuch-clickdummy typecheck && pnpm --filter werkbuch-clickdummy test && pnpm --filter werkbuch-clickdummy build'
```

Expected: alles grün; `public/build/manifest.json` existiert. Dann `ddev exec pnpm dev` starten und `curl -sk https://werkbuch.ddev.site/does-not-exist | grep -c 'werkbuch.ddev.site:5173/@vite/client'` → `1`; Dev-Server beenden (`public/hot` muss danach weg sein, sonst `rm public/hot`).

- [ ] **Step 7: CI-Übergang**

`.github/workflows/tests.yml`: beide bestehenden Jobs installieren jetzt im Root (`pnpm/action-setup@v4` ohne `package_json_file`, `actions/setup-node@v4` mit `node-version-file: .node-version`, `cache-dependency-path: pnpm-lock.yaml`, `pnpm install --frozen-lockfile`) und rufen den Klickdummy mit `pnpm --filter werkbuch-clickdummy <script>`. Job-Namen bleiben bis Task 16.

- [ ] **Step 8: Commit**

Betreff: `feat: add the pnpm workspace, Inertia with React, the Werkbuch tokens, fonts and the theme script`.

---

### Task 5: i18n

**Files:**
- Create: `app/Http/Middleware/SetLocale.php`, `lang/en/auth.php`, `lang/en/passwords.php`, `lang/de/auth.php`, `lang/de/passwords.php`, `lang/de/pagination.php`, `lang/de/validation.php`, `resources/js/lib/i18n.ts`, `resources/js/lib/i18n.test.ts`, `tests/Feature/LocaleTest.php`, `tests/Unit/TranslationsTest.php`, `tests/Feature/TranslationKeysTest.php`, `tests/Unit/FrameworkTranslationsTest.php`
- Modify: `lang/en.json`, `lang/de.json`, `app/Http/Middleware/HandleInertiaRequests.php`, `app/Models/User.php` (`HasLocalePreference`), `bootstrap/app.php`, `resources/js/app.tsx`, `resources/js/test/setup.ts`, `resources/js/lib/page.ts`

**Interfaces:**
- Consumes: Shared Props (Task 4), `Problem::REASONS` (Task 3)
- Produces:
  - `final class App\Http\Middleware\SetLocale` mit `public static function resolve(Request $request): string` (Reihenfolge: `locale` des angemeldeten Kontos → Cookie `locale` (nur `en`/`de`) → `config('app.locale')` als Standard der Organisation bis Phase 2 → `en`) und `handle()`, das `app()->setLocale()`, `Carbon::setLocale()` setzt und, wenn die Sprache aus dem Profil kommt und vom Cookie abweicht, `cookie()->forever('locale', …)` schreibt. Cookie `locale` ist von der Verschlüsselung ausgenommen (`$middleware->encryptCookies(except: ['locale'])`).
  - `User implements HasLocalePreference`: `preferredLocale(): string` = eigene Sprache, sonst `config('app.locale')`.
  - Shared Props: `locale` (`'en' | 'de'`), `translations` (`Inertia::once(fn () => File::json(lang_path("{$locale}.json")))`).
  - `resources/js/lib/i18n.ts`:
    - `type TranslationKey = keyof typeof import('../../../lang/en.json') & string`
    - `type PluralKey` = jeder Stamm `K`, für den `` `${K}.one` `` und `` `${K}.other` `` Schlüssel sind
    - `type TranslationParams = Record<string, string | number>`
    - `initI18n(props: { locale: Locale; translations: Record<string, string> }): void`, `getLocale(): Locale`, `intlLocale(): 'de-DE' | 'en-GB'`, `t(key: TranslationKey, params?: TranslationParams): string`, `tn(key: PluralKey, count: number, params?: TranslationParams): string` (`:count` mit `Intl.NumberFormat(intlLocale())`), `hasTranslation(key: string): key is TranslationKey`.
  - Schlüssel-Schema (gilt für alle Phasen): flach, Punktpfade nach Bereich, Segmente `[a-z_]+` ohne Ziffern, alphabetisch sortiert; Platzhalter `:name`; Plural `.one`/`.other`. Namensräume: `common.*` (wiederkehrende Wörter: `common.retry`, `common.close`, `common.cancel`, `common.save`, `common.undo`, `common.loading`, `common.copy`, `common.copied`), `ui.<komponente>.*` (`components/ui`), `kbd.*` (Tastennamen), `shortcuts.*` (Register und Hilfe), `shell.*`, `login.*`, `forgot_password.*`, `reset_password.*`, `errors.*` (Fehlerseiten, Fehler-Toasts), `problem.title.*`, `problem.reason.*`, `theme.*`, `items.*`, `mail.*`; später je Feature-Ordner ein Namensraum (`inbox.*`, `wiki.*`, `settings.org.*` …). Kein JSON-Schlüssel beginnt mit `auth.`, `passwords.`, `validation.`, `pagination.` (die gehören den PHP-Gruppendateien).
  - Port-Regel (gilt für alle Phasen): Jeder deutsche Text des Klickdummys wird ein Schlüssel; `lang/de.json` übernimmt ihn wörtlich, `lang/en.json` bekommt die englische Fassung im selben Ton (kurz, direkt, „you“). Texte mit Werten werden ganze Sätze mit Platzhaltern, nie zusammengesetzte Teilstücke. `Intl`-Formate nehmen `intlLocale()` statt `'de-DE'`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/Feature/LocaleTest.php` (Route `Route::middleware('web')->get('_t/locale', fn () => ['locale' => app()->getLocale()])` im Test):

```php
it('speaks English without cookie and profile', fn () => $this->get('_t/locale')->assertJson(['locale' => 'en']));

it('follows the locale cookie before sign-in', fn () => $this->withUnencryptedCookie('locale', 'de')->get('_t/locale')->assertJson(['locale' => 'de']));

it('ignores cookies that name no supported language', function (string $value) {
    $this->withUnencryptedCookie('locale', $value)->get('_t/locale')->assertJson(['locale' => 'en']);
})->with(['fr', '../de', 'DE', '', 'eyJpdiI6Ij']);

it('takes the profile over the cookie and remembers it in the cookie', function () {
    $user = User::factory()->locale(Locale::De)->create();
    $this->actingAs($user)->withUnencryptedCookie('locale', 'en')->get('_t/locale')
        ->assertJson(['locale' => 'de'])->assertPlainCookie('locale', 'de');
});

it('lets the cookie decide for an account without own language', function () {
    $this->actingAs(User::factory()->create())->withUnencryptedCookie('locale', 'de')->get('_t/locale')->assertJson(['locale' => 'de']);
});

it('shares locale and the translations of that language once', function () {
    $this->withUnencryptedCookie('locale', 'de')->get(inertiaProbe())->assertInertia(fn (Assert $page) => $page
        ->where('locale', 'de')
        ->where('translations', json_decode((string) file_get_contents(lang_path('de.json')), true)));
});

it('sets the lang attribute of the page', fn () => $this->withUnencryptedCookie('locale', 'de')->get(inertiaProbe())->assertSee('<html lang="de">', false));

it('mails in the language of the account, else the default', function () {
    expect(User::factory()->locale(Locale::De)->make()->preferredLocale())->toBe('de')
        ->and(User::factory()->make()->preferredLocale())->toBe('en');
});
```

`tests/Unit/TranslationsTest.php` (ohne App; Helfer `lang()`, `langKeys()`, `placeholders()` in `tests/Pest.php`):

```php
it('has the same keys in English and German, sorted', function () {
    [$en, $de] = [langKeys('en'), langKeys('de')];
    expect(array_values(array_diff($en, $de)))->toBe([], 'missing in de.json')
        ->and(array_values(array_diff($de, $en)))->toBe([], 'missing in en.json')
        ->and($en)->toBe(collect($en)->sort()->values()->all());
});
it('keeps the placeholders of every key equal in both languages', function () {
    foreach (langKeys('en') as $key) expect(placeholders(lang('de')[$key]))->toBe(placeholders(lang('en')[$key]), $key);
});
it('follows the key schema and leaves framework groups to their PHP files', function () {
    foreach (langKeys('en') as $key) expect($key)->toMatch('/^[a-z_]+(\.[a-z_]+)+$/')->not->toMatch('/^(auth|passwords|validation|pagination)\./');
});
it('has a text for every problem reason and status title', function () {
    $needed = [...array_map(fn ($r) => "problem.reason.{$r}", Problem::REASONS),
        ...array_map(fn ($s) => "problem.title.{$s}", ['bad_request', 'unauthenticated', 'forbidden', 'not_found', 'method_not_allowed', 'conflict', 'payload_too_large', 'csrf_token_mismatch', 'validation_failed', 'too_many_requests', 'server_error', 'service_unavailable', 'http_error'])];
    expect(array_values(array_diff($needed, langKeys('en'))))->toBe([]);
});
```

`tests/Feature/TranslationKeysTest.php` (braucht den Translator, darum Feature; Helfer `usedTranslationKeys()` scannt rekursiv `app/`, `routes/`, `resources/views/` und `resources/js/` (`.ts`/`.tsx` ohne Tests) nach `t|tn|__|trans|@lang('…')`; `tn('a.b', …)` zählt als `a.b.one` und `a.b.other`):

```php
it('defines every key used in code', function () {
    $used = usedTranslationKeys();
    [$groups, $json] = $used->partition(fn (string $k) => preg_match('/^(auth|passwords|validation|pagination)\./', $k) === 1);
    expect($used)->not->toBeEmpty()
        ->and($json->diff(langKeys('en'))->values()->all())->toBe([])
        ->and($groups->filter(fn (string $k) => trans($k, [], 'en') === $k || trans($k, [], 'de') === $k)->values()->all())->toBe([]);
});
```

Dynamische Schlüssel (`` t(`problem.reason.${r}`) ``) findet der Scan nicht; sie sind in beiden Dateien vollständig zu halten (Fallstrick in CLAUDE.md).

`tests/Unit/FrameworkTranslationsTest.php`: für `validation`, `pagination`, `auth`, `passwords`: `lang/de/<gruppe>.php` hat genau die Schlüssel von `vendor/laravel/framework/src/Illuminate/Translation/lang/en/<gruppe>.php` (ohne `custom`/`attributes`) und je Schlüssel dieselben Platzhalter; dasselbe für `lang/en/auth.php` und `lang/en/passwords.php`. `lang/de/validation.php` aus openbill übernehmen (`~/development/baeroe/openbill/lang/de/validation.php`), `attributes` mit `email` → `E-Mail`, `password` → `Passwort`, `name` → `Name`. `lang/en/auth.php`: `failed` „Email or password is not correct.“, `throttle` „Too many attempts. Try again in :seconds seconds.“; `lang/de/auth.php`: „E-Mail oder Passwort stimmen nicht.“, „Zu viele Versuche. Versuch es in :seconds Sekunden wieder.“; `passwords.token` en „This link has expired or was already used. Request a new one.“, de „Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.“; `passwords.reset` en „Your password is set. Sign in with it.“, de „Dein Passwort ist gesetzt. Melde dich damit an.“

`resources/js/lib/i18n.test.ts`:

```ts
beforeEach(() => initI18n({ locale: 'en', translations: { 'common.close': 'Close', 'x.greeting': 'Hi :name', 'x.items.one': ':count item', 'x.items.other': ':count items' } }));
it('fills placeholders', () => expect(t('x.greeting' as TranslationKey, { name: 'Mara' })).toBe('Hi Mara'));
it('shows a missing key as itself', () => expect(t('x.missing' as TranslationKey)).toBe('x.missing'));
it('picks one or other and formats the count in the language', () => {
  expect(tn('x.items' as PluralKey, 1)).toBe('1 item');
  expect(tn('x.items' as PluralKey, 1200)).toBe('1,200 items');
  initI18n({ locale: 'de', translations: { 'x.items.one': ':count Item', 'x.items.other': ':count Items' } });
  expect(tn('x.items' as PluralKey, 1200)).toBe('1.200 Items');
});
it('names the Intl locale', () => { expect(intlLocale()).toBe('en-GB'); initI18n({ locale: 'de', translations: {} }); expect(intlLocale()).toBe('de-DE'); expect(getLocale()).toBe('de'); });
it('knows which keys exist', () => { expect(hasTranslation('common.close')).toBe(true); expect(hasTranslation('nope.nope')).toBe(false); });
```

- [ ] **Step 2: Rot sehen**

Run: `ddev artisan test --filter='LocaleTest|TranslationsTest|TranslationKeysTest|FrameworkTranslationsTest'` und `ddev exec pnpm test -- resources/js/lib/i18n.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

`bootstrap/app.php`: `$middleware->web(append: [SetLocale::class, HandleInertiaRequests::class])` (SetLocale vor Inertia), `encryptCookies(except: ['locale'])`. `resources/js/app.tsx`: `initI18n(initialPage.props)` vor dem Rendern; `router.on('navigate', (event) => { if (event.detail.page.props.locale !== getLocale()) window.location.reload(); })`. `test/setup.ts`: `initI18n({ locale: 'de', translations: de })` mit `import de from '../../../lang/de.json'` (die portierten Tests behalten ihre deutschen Erwartungen). `i18n.ts` nimmt `Locale` aus `lib/page.ts`.

- [ ] **Step 4: Grün sehen**

Run: `ddev artisan test --coverage --min=100`, `ddev exec pnpm typecheck`, `ddev exec pnpm test:coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

Betreff: `feat: add English and German translations, SetLocale and t()/tn() with typed keys`.

---

### Task 6: Kürzel-Register

**Files:**
- Create: `resources/js/lib/shortcuts/registry.ts`, `resources/js/lib/shortcuts/registry.test.ts`, `resources/js/lib/shortcuts/catalog.ts`, `resources/js/lib/shortcuts/catalog.test.ts`, `resources/js/lib/shortcuts/useShortcut.ts`, `resources/js/lib/shortcuts/useShortcut.test.tsx`, `resources/js/lib/platform.ts`, `resources/js/lib/storage.ts`, `resources/js/lib/media.ts`, `resources/js/lib/platform.test.ts`, `resources/js/lib/storage.test.ts`, `resources/js/lib/media.test.ts`
- Modify: `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: `t`, `TranslationKey` (Task 5)
- Produces:
  - `registry.ts` = Port von `src/lib/shortcuts/registry.ts` mit unverändertem Verhalten und denselben Exporten (`ShortcutScope`, `ShortcutDef`, `isTyping`, `canonicalKeys`, `registerShortcut`, `listShortcuts`, `subscribeShortcuts`, `enterDialogScope`); einzige Änderung: `ShortcutDef.label: TranslationKey` und `ShortcutDef.group: TranslationKey`.
  - `catalog.ts`: die eine statische Quelle aller Kürzel (Hilfe-Overlay jetzt, Doku-Generator in Phase 6):
    ```ts
    export interface CatalogEntry { keys: string; scope: ShortcutScope; label: TranslationKey; group: TranslationKey; repeat?: boolean }
    export const SHORTCUTS = { 'shell.help': { keys: '?', scope: 'global', label: 'shortcuts.shell.help', group: 'shortcuts.group.general' }, … } as const satisfies Record<string, CatalogEntry>;
    export type ShortcutId = keyof typeof SHORTCUTS;
    ```
    Einträge in Phase 1: `shell.help` (`?`), `shell.undo` (`mod+z`), `shell.go.inbox` (`g i`), `shell.go.my_items` (`g m`), `shell.go.views` (`g v`), `shell.go.projects` (`g p`). Gruppen `shortcuts.group.general` („Allgemein“), `shortcuts.group.navigation` („Navigation“). Jede spätere Phase trägt ihre Kürzel hier ein (IDs wie im Klickdummy, `detail.title.${surface}` wird `detail.title` mit `instance`).
  - `useShortcut.ts`: `useShortcut(id: ShortcutId, run: (event: KeyboardEvent) => void, options?: { when?: () => boolean; instance?: string; deps?: DependencyList }): void` (registriert `id` bzw. `` `${id}:${instance}` `` mit Tasten, Scope, Label, Gruppe und `repeat` aus dem Katalog; `run`/`when` immer aus dem letzten Render), `useDialogScope(active?: boolean): void`, `useShortcutList(): ShortcutDef[]` (wie Klickdummy).
  - `platform.ts` (`isMac(): boolean`), `storage.ts` (`safeStorage: StateStorage`), `media.ts` (`isWide(): boolean`, `useIsWide(): boolean`) = Ports, unverändert.

- [ ] **Step 1: Tests portieren und schreiben**

`registry.test.ts` = `src/lib/shortcuts/registry.test.ts` mit Labels und Gruppen als Schlüssel (`label: 'shortcuts.shell.help'`), alle 18 Fälle unverändert. Dazu:

`catalog.test.ts`:

```ts
it('binds no key twice within one scope', () => {
  const seen = new Map<string, string>();
  for (const [id, entry] of Object.entries(SHORTCUTS)) {
    const slot = `${entry.scope}|${canonicalKeys(entry.keys)}`;
    expect(seen.get(slot), `${id} and ${seen.get(slot)} share ${entry.keys}`).toBeUndefined();
    seen.set(slot, id);
  }
});
it('has a label and a group in both languages for every shortcut', () => {
  for (const entry of Object.values(SHORTCUTS)) {
    expect(Object.keys(en)).toContain(entry.label); expect(Object.keys(de)).toContain(entry.label);
    expect(Object.keys(en)).toContain(entry.group);
  }
});
```

`useShortcut.test.tsx`: registriert beim Mounten mit den Katalogwerten (`listShortcuts()` enthält `{ id: 'shell.help', keys: '?', scope: 'global' }`), meldet beim Unmounten ab, `instance` ergibt die ID `shell.help:peek`, `when` false lässt den Lauf aus, `run` sieht den letzten Render, `useDialogScope` pausiert eine `list`-Taste und gibt sie beim Unmount frei.

`platform.test.ts` (Mac über `userAgentData.platform` und `navigator.platform`, sonst nicht), `storage.test.ts` (wirft nie, auch wenn `localStorage` wirft), `media.test.ts` (ohne `matchMedia` breit; `useIsWide` folgt `change`).

- [ ] **Step 2: Rot sehen, implementieren, grün sehen**

Run: `ddev exec pnpm test -- resources/js/lib` → FAIL; nach dem Port → PASS. Danach `ddev exec pnpm typecheck` und `ddev exec pnpm test:coverage` grün (Schwelle `lib/**`).

- [ ] **Step 3: Commit**

Betreff: `feat: port the shortcut registry with a static catalog of shortcuts`.

---

### Task 7: API-Schicht und Query-Client

**Files:**
- Create: `resources/js/types.ts`, `resources/js/api/client.ts`, `resources/js/api/client.test.ts`, `resources/js/api/http.ts`, `resources/js/api/http.test.ts`, `resources/js/api/live.ts`, `resources/js/api/live.test.ts`, `resources/js/hooks/queryClient.ts`, `resources/js/hooks/queryClient.test.ts`, `resources/js/hooks/retry.ts`, `resources/js/hooks/retry.test.tsx`, `resources/js/hooks/live.ts`, `resources/js/hooks/live.test.tsx`
- Modify: `resources/js/app.tsx`, `resources/js/lib/page.ts` und `resources/js/lib/i18n.ts` (`Locale` aus `@/types`), `vitest.config.ts` (Schwellen `api/**`, `hooks/**`), `package.json` (`@tiptap/core`, `@tiptap/pm`)

**Interfaces:**
- Consumes: `t`, `hasTranslation` (Task 5)
- Produces:
  - `types.ts` = `src/types.ts` vollständig; einzige Änderung: `import type { JSONContent } from '@tiptap/core'`.
  - `api/client.ts`: `interface ApiErrorInit { status: number; reason: string; detail?: string; errors?: Record<string, string[]>; extensions?: Record<string, unknown> }`, `class ApiError extends Error` (`status`, `reason`, `errors?`, `extensions`, Getter `current`; `message` = `detail` ?? `t('errors.fallback', { status, reason })`), `interface Page<T> { items: T[]; next_cursor: string | null; total: number }`, `interface PageArgs { cursor?: string | null; per_page?: number }`, `MAX_PER_PAGE = 100`, `reasonText(reason: string): string` (= `t('problem.reason.<reason>')`, unbekannt → `t('problem.reason_unknown', { reason })`). Kein `FAIL_KEY`, `read`, `write`, `paginate`, `newId` (Fake-API).
  - `api/http.ts`:
    ```ts
    export const API_BASE = '/api/v1';
    export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[] | Record<string, string | number | boolean | null | undefined>;
    export type Query = Record<string, QueryValue>;
    export interface RequestOptions { signal?: AbortSignal }
    export function toQueryString(query: Query): string;
    export function get<T>(path: string, query?: Query, options?: RequestOptions): Promise<T>;
    export function post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
    export function patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
    export function put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
    export function del<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
    export function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, options?: RequestOptions): Promise<T>;
    ```
    Pfade relativ zu `API_BASE` (`get('/work-items', { filter: { project: 'WEB' } })`). Phase 2 liefert die Server-Seite der `Page<T>`-Hülle.
  - `api/live.ts`: `interface LiveEvent { type: string; item_id?: string; actor_id: string }`, `subscribeLive(callback: (event: LiveEvent) => void): () => void`, `isLiveConnected(): boolean` (bis Phase 8 immer `true`), `subscribeLiveStatus(callback: () => void): () => void`; liefert bis Phase 8 keine Ereignisse.
  - `hooks/live.ts`: `useLiveConnected(): boolean`. `hooks/retry.ts`: `refetchFailed(client: QueryClient): Promise<void>` (nur aktive Queries, Deferred-Punkt 13b), `useRefetchFailed(): () => void`. `hooks/queryClient.ts`: `queryClient` (Optionen wie Klickdummy: `retry: false`, `staleTime: 10_000`, `refetchOnWindowFocus: false`), `resetForUser(previousId: string | null, nextId: string | null): void` (leert den Cache, wenn sich die Person ändert).
  - `app.tsx`: `QueryClientProvider` um `<App>`; im `navigate`-Listener `resetForUser(lastUserId, page.props.auth.user?.id ?? null)`.

- [ ] **Step 1: Tests schreiben**

`http.test.ts` (`fetch` per `vi.stubGlobal`, `document.cookie` für `XSRF-TOKEN`):

```ts
it('sends JSON with session cookie and CSRF header, and parses the answer', async () => {
  document.cookie = 'XSRF-TOKEN=abc%3D';
  fetchMock.mockResolvedValue(json(201, { id: 'x' }));
  await expect(post('/work-items', { title: 'A' })).resolves.toEqual({ id: 'x' });
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/work-items', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', body: '{"title":"A"}',
    headers: expect.objectContaining({ Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 'abc=', 'X-Requested-With': 'XMLHttpRequest' }),
  }));
});
it('builds query strings with arrays and one level of objects, skipping empties', () => {
  expect(toQueryString({ cursor: null, per_page: 50, ids: ['a', 'b'], filter: { project: 'WEB', assignee: 'me', empty: undefined }, open: true }))
    .toBe('?per_page=50&ids%5B%5D=a&ids%5B%5D=b&filter%5Bproject%5D=WEB&filter%5Bassignee%5D=me&open=1');
  expect(toQueryString({})).toBe('');
});
```

Dazu in `http.test.ts`: 204 → `undefined`; Problem Details 409 → `ApiError` mit `status`, `reason`, `message` aus `detail` und `current` aus den Extensions; 422 behält `errors` je Pfad; Fehler ohne JSON (502 `text/html`) → `reason` `http_error`; Netzfehler (`fetch` wirft `TypeError`) kommt unverändert durch; 419 → einmal `GET /sanctum/csrf-cookie`, dann Wiederholung, ein zweites 419 → `ApiError` 419 `csrf_token_mismatch`; 401 → `window.location.reload()` und `ApiError` `unauthenticated`; `options.signal` erreicht `fetch`; `upload` meldet `onProgress(0.5)` bei 50/100, löst mit JSON auf, 413 → `ApiError`, Abbruch per Signal ruft `xhr.abort()`.

`client.test.ts`: `ApiError` (Felder, `current`, `message` aus `detail`, sonst `errors.fallback`), `reasonText('transition_not_allowed')` = deutscher Text des Klickdummys (Setup-Sprache de), unbekannter Grund → `problem.reason_unknown` mit Code.

`queryClient.test.ts`: `resetForUser('a', 'a')` lässt den Cache, `resetForUser('a', 'b')`, `('a', null)` und `(null, 'b')` leeren ihn; `(null, null)` nicht.

`retry.test.tsx` = Klickdummy-Test plus: eine inaktive fehlgeschlagene Query wird nicht neu geladen.

`live.test.ts` / `live.test.tsx`: verbunden; `subscribeLive` und `subscribeLiveStatus` geben Abmelder zurück, die nichts werfen; `useLiveConnected()` ist `true`.

- [ ] **Step 2: Rot, implementieren, grün**

Run: `ddev exec pnpm test -- resources/js/api resources/js/hooks` → FAIL, dann PASS; `ddev exec pnpm typecheck`; `ddev exec pnpm test:coverage` mit den neuen Schwellen `'resources/js/api/**': { lines: 100 }`, `'resources/js/hooks/**': { lines: 100 }`.

- [ ] **Step 3: Commit**

Betreff: `feat: add the HTTP layer with ApiError and Page, the query client and the live stub`.

---

### Task 8: `components/ui`, Teil 1: Grundbausteine

**Files:**
- Create in `resources/js/components/ui/`: `cx.ts`, `styles.ts`, `Button.tsx`, `IconButton.tsx`, `Kbd.tsx`, `Tooltip.tsx`, `Field.tsx`, `Input.tsx`, `Textarea.tsx`, `Checkbox.tsx`, `Switch.tsx`, `Chip.tsx`, `Banner.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `Skeleton.tsx`, `Avatar.tsx`, `IndexCard.tsx`, `TypeTab.tsx`, `StatusIcon.tsx`, `PriorityIcon.tsx`, `ProgressBar.tsx`, `ProjectBadge.tsx`, `ViewIcon.tsx`, `InPageLink.tsx`, `FavoriteStar.tsx`, `CopyField.tsx`, `ui.test.tsx` (Teil-1-Fälle), je ein `<Name>.test.tsx` nach der Tabelle unten
- Modify: `lang/en.json`, `lang/de.json`, `vitest.config.ts` (Schwelle `components/ui/**`)

**Interfaces:**
- Consumes: `t`, `intlLocale` (Task 5), `isMac` (Task 6), `useRefetchFailed` (Task 7), Typen aus `@/types` (Task 7)
- Produces: dieselben Exporte, Props und Klassen wie die gleichnamigen Dateien in `prototypes/clickdummy/src/components/ui/` (Signaturen dort nachlesen, nicht ändern), mit diesen Ausnahmen:
  - `FavoriteStar` (aus `features/views-overview/FavoriteStar.tsx`, 13b) wird rein darstellend: `FavoriteStar({ active, pending, name, onToggle }: { active: boolean; pending: boolean; name: string; onToggle: () => void })`; das Lesen und Umschalten der Favoriten kommt in Phase 2 als Hülle in `features/`.
  - `CopyField` und `useCopy` (aus `features/settings/org/CopyField.tsx`, 13b) unverändert in der Signatur; `buttonLabel` Standard `t('common.copy')`.
  - `Kbd`: gesprochene Namen und Tastentexte aus `kbd.*` (`kbd.spoken.command` „Befehl“/„Command“, `kbd.text.ctrl` „Strg“/„Ctrl“, `kbd.text.delete` „Entf“/„Del“, `kbd.text.space` „Leertaste“/„Space“, `kbd.then` „dann“/„then“ …); `aria-keyshortcuts` bleibt englisch (`Meta+K`).
  - `ProgressBar` formatiert mit `Intl.NumberFormat(intlLocale(), { style: 'percent' })` (Deferred).

- [ ] **Step 1: Texte zu Schlüsseln**

Jeder deutsche Text dieser Dateien wird ein Schlüssel nach Task 5 (`ui.<komponente_snake>.<text>`; Wiederkehrendes in `common.*`). Stichprobe danach: `grep -rn '[äöüß]' resources/js/components/ui --include='*.tsx' --include='*.ts' | grep -v '\.test\.'` ist leer.

- [ ] **Step 2: Tests portieren und ergänzen**

`ui.test.tsx` übernimmt aus dem Klickdummy die Fälle zu `Kbd on a Mac`, `Button and the focus`, `Field keeps a polite live region`, `Avatar` unverändert (Setup-Sprache de). Neue Testdateien, je Zeile die Verhaltensweisen, die als `it(...)` festgehalten werden (Namen frei, Assertions konkret):

| Datei | Pflicht-Fälle |
|---|---|
| `Button.test.tsx` | jede `variant` und `size` rendert ihre Klasse; `icon` links; `shortcut` zeigt `Kbd`; `disabledReason` macht `aria-disabled` und zeigt den Grund im Tooltip; `buttonClass()` liefert dieselben Klassen |
| `IconButton.test.tsx` | `label` ist der zugängliche Name; mit und ohne Tooltip; `disabledReason` |
| `Kbd.test.tsx` | Nicht-Mac: `mod+k` heißt „Steuerung K“ und zeigt „Strg“; Folge `g i` heißt „G dann I“; `ariaKeyshortcuts('g i')` ist `undefined`, `ariaKeyshortcuts('shift+mod+k')` ist `Shift+Meta+K` auf dem Mac; Symbole `/`, `?` werden gesprochen; Englisch: „Command K“, „G then I“ (Deferred: Folgen und Nicht-Mac) |
| `Tooltip.test.tsx` | erscheint bei Fokus, verschwindet bei Escape; `side` wird durchgereicht |
| `Field.test.tsx`, `Input.test.tsx`, `Textarea.test.tsx` | Label gehört zum Feld; `hint` und `error` per `aria-describedby`; `error` setzt `aria-invalid`; `ref` reicht durch |
| `Checkbox.test.tsx`, `Switch.test.tsx` | Leertaste schaltet; `indeterminate` (Checkbox); `disabled` |
| `Chip.test.tsx`, `Banner.test.tsx`, `EmptyState.test.tsx`, `IndexCard.test.tsx`, `TypeTab.test.tsx`, `ViewIcon.test.tsx`, `ProjectBadge.test.tsx` | jeder Ton bzw. jede Variante; `titleAs` (EmptyState); unbekanntes View-Icon fällt auf das Standard-Icon; Projektbild statt Kürzel |
| `StatusIcon.test.tsx`, `PriorityIcon.test.tsx` | alle sieben Formen × fünf Kategorien bzw. fünf Prioritäten mit zugänglichem Namen aus `ui.status_icon.*`/`ui.priority_icon.*` |
| `Skeleton.test.tsx` | `SkeletonGroup` hat `aria-busy` und den Namen aus `label` |
| `ErrorState.test.tsx` | „Erneut versuchen“ ruft `onRetry` und lädt die übrigen fehlgeschlagenen aktiven Queries; `retrying` zeigt den Busy-Zustand |
| `ProgressBar.test.tsx` | Prozent in `de-DE` („50 %“) und `en-GB` („50%“); Grenzen 0 und 1 |
| `InPageLink.test.tsx` | Port des Klickdummy-Tests |
| `FavoriteStar.test.tsx` | Name „„Roadmap“ in die Seitenleiste legen“ bzw. „… aus der Seitenleiste nehmen“; `pending` zeigt den Spinner mit `aria-busy` und ignoriert einen zweiten Druck |
| `CopyField.test.tsx` | kopiert per Clipboard-API, zeigt „Kopiert“; ohne Clipboard markiert es den Text und meldet `failed` |

- [ ] **Step 3: Port und grün**

Run: `ddev exec pnpm test -- resources/js/components/ui`, `ddev exec pnpm typecheck`, `ddev exec pnpm test:coverage` mit `'resources/js/components/ui/**': { lines: 100 }`
Expected: PASS, die Schwelle hält für alle Dateien dieses Tasks.

- [ ] **Step 4: Commit**

Betreff: `feat: port the basic components of the clickdummy with translations and full tests`.

---

### Task 9: `components/ui`, Teil 2: Overlays und Rückmeldung

**Files:**
- Create in `resources/js/components/ui/`: `Dialog.tsx`, `AlertDialog.tsx`, `Popover.tsx`, `Menu.tsx`, `Select.tsx`, `Combobox.tsx`, `Tabs.tsx`, `SegmentedControl.tsx`, `Calendar.tsx`, `EmojiPicker.tsx`, `toast.ts`, `Toaster.tsx`, `FormDialog.tsx`, `SortableList.tsx`, Tests nach der Tabelle; `resources/js/lib/errors.ts`, `resources/js/lib/errors.test.ts`, `resources/js/lib/undo.ts`, `resources/js/lib/undo.test.ts`
- Modify: `ui.test.tsx` (Teil-2-Fälle), `resources/js/app.tsx` (`TooltipProvider`, `Toaster`), `resources/js/lib/shortcuts/catalog.ts` (`dialog.submit`), `lang/en.json`, `lang/de.json`, `package.json` (dnd-kit)

**Interfaces:**
- Consumes: Teil 1 (Task 8), `useDialogScope`, `useShortcut`, `registerShortcut` (Task 6), `ApiError` (Task 7)
- Produces: dieselben Exporte und Props wie im Klickdummy, dazu:
  - `FormDialog` (aus `features/settings/org/FormDialog.tsx`, 13b): Props unverändert; das ⌘⏎-Kürzel kommt aus dem Katalog als `dialog.submit` (`mod+enter`, Scope `dialog`, Label `shortcuts.dialog.submit`, Gruppe `shortcuts.group.dialog`) über `useShortcut('dialog.submit', …)`.
  - `SortableList` (aus `features/settings/org/Sortable.tsx`, 13b, Datei umbenannt): `SortableList<T extends { id: string }>(props: SortableListProps<T>)` und `SortableControls` unverändert; Ansagen über `ui.sortable.*`.
  - `lib/errors.ts`: `isTransient(error: unknown): boolean`, `notifyError(title: string, error: unknown, retry?: () => void): void` (Ursache ohne Antwort: `t('errors.no_answer')`; Knopf `t('common.retry')`).
  - `lib/undo.ts`: `undoLabel(): string` (= `t('common.undo')`, ersetzt die Konstante `UNDO_LABEL`, weil die Sprache erst nach `initI18n` feststeht), `runWithUndo(options: UndoOptions): number`, `canUndo(): boolean`, `undoLatest(): boolean`; Standardtitel des Fehlers `t('errors.not_done', { label })`.
  - Korrekturen aus der Deferred-Liste: Calendar fokussiert nach einem wirkungslosen `goTo` nicht mehr (`moveFocus` wird zurückgesetzt); Calendar formatiert Monat, Wochentage und Tagesnamen mit `intlLocale()`; EmojiPicker nimmt Flaggen und Keycaps an (Regex ohne literales U+FE0F/U+200D, `\p{Extended_Pictographic}` bzw. `\p{Regional_Indicator}` mit `u`-Flag); Select und Combobox reichen nur `aria-label` an das DOM, keine übrigen Props.

- [ ] **Step 1: Tests portieren und ergänzen**

`ui.test.tsx` übernimmt die Toast-Fälle (6), `Combobox gives its search input the name …`, `an open Dialog pauses the list shortcuts …` und `Dialog with something shown once` (2). `lib/undo.test.ts`, `lib/errors.test.ts` und `SortableList.test.tsx` (aus `sortable.test.tsx`) werden 1:1 portiert. Neu:

| Datei | Pflicht-Fälle |
|---|---|
| `Dialog.test.tsx` | Fokus startet auf `initialFocus`, kehrt zu `finalFocus` zurück; Escape schließt; `size` je Klasse; `closable={false}` ohne Kreuz; verschachtelter Dialog hält zwei Scope-Ebenen |
| `AlertDialog.test.tsx` | Bestätigen ruft `onConfirm`, Abbrechen nicht; Fokus startet auf „Abbrechen“; `tone="danger"` |
| `Popover.test.tsx`, `Tabs.test.tsx`, `SegmentedControl.test.tsx` | öffnet/schließt per Tastatur; Pfeiltasten wechseln Tab bzw. Segment und melden `onValueChange` |
| `Menu.test.tsx` | Eintrag per Enter; Radio-Gruppe meldet den Wert; Untermenü per Pfeil rechts; `MenuLinkItem` mit `render`; Gruppenlabel und Trenner |
| `Select.test.tsx`, `Combobox.test.tsx` | Auswahl per Tastatur; Combobox filtert, zeigt `emptyText`; nur `aria-label` landet am DOM (`data-x` nicht) |
| `Calendar.test.tsx` | Pfeile ±1 Tag/±7 Tage, Home/End an die Wochenenden je `weekStartsOn` 0 und 1, PageUp/PageDown ±1 Monat (31.01. → 28.02.2027), „Heute“ springt zu `today`, Auswahl und Abwahl, Monatsname „Oktober 2026“ (de) bzw. „October 2026“ (en), kein Fokuswechsel nach wirkungslosem `goTo` |
| `EmojiPicker.test.tsx` | Suche filtert; Pfeile und Enter wählen; `🇩🇪` und `1️⃣` werden angenommen |
| `Toaster.test.tsx` | Pause bei Zeiger und Fokus, Rest der Zeit danach; drei Plätze; Rückgängig-Toasts werden nicht verdrängt; Fehler außerhalb der drei (Deferred: Pause und Verdrängen) |
| `FormDialog.test.tsx` | ⌘⏎ sendet genau einmal, auch zweimal schnell gedrückt; `pending` sperrt den Knopf ohne Fokusverlust; `notice` als Banner |

- [ ] **Step 2: Port und grün**

Run: `ddev exec pnpm test -- resources/js/components/ui resources/js/lib`, `ddev exec pnpm typecheck`, `ddev exec pnpm test:coverage`
Expected: PASS; Schwellen `lib/**` und `components/ui/**` halten.

- [ ] **Step 3: Commit**

Betreff: `feat: port dialogs, menus, pickers, toasts and the shared form parts of the clickdummy`.

---

### Task 10: Konten-Kommandos

**Files:**
- Create: `app/Domain/Accounts/Handle.php`, `app/Support/PasswordRules.php`, `app/Actions/Auth/SetPassword.php`, `app/Actions/Auth/EnsureAdmin.php`, `app/Enums/EnsureAdminOutcome.php`, `app/Console/Commands/EnsureAdminCommand.php`, `app/Console/Commands/ResetPasswordCommand.php`, `tests/Unit/Domain/HandleTest.php`, `tests/Feature/SetPasswordTest.php`, `tests/Feature/EnsureAdminTest.php`, `tests/Feature/ResetPasswordCommandTest.php`
- Modify: `composer.json` (`lorisleiva/laravel-actions`)

**Interfaces:**
- Consumes: `User`, `AccountType` (Task 1), `config('werkbuch.admin.*')` (Task 3)
- Produces:
  - `final class App\Domain\Accounts\Handle`: `public const PATTERN = '/^[a-z0-9-]{3,32}$/'`, `public static function isValid(string $handle): bool`, `public static function suggest(string $source, callable $taken): string` (`$taken: callable(string): bool`; nimmt den Teil vor `@`, ä/ö/ü/ß → ae/oe/ue/ss, alles andere Ungültige → `-`, Läufe von `-` zusammen, Ränder ohne `-`; kürzer als 3 → `-user` anhängen; auf 32 kürzen; belegt → `-2`, `-3`, … mit gekürztem Stamm).
  - `final class App\Support\PasswordRules { public static function rules(): array }` → `['required', 'string', Password::min(8)]` (in `Support`, weil in `App\Actions` nur Actions mit `handle()` liegen).
  - `final class App\Actions\Auth\SetPassword` (`AsAction`): `handle(User $user, string $password): void` — prüft `PasswordRules`, sonst `ValidationException` an `password`; setzt das Passwort, erneuert `remember_token`, löscht alle Zeilen in `sessions` des Kontos; in `DB::transaction`.
  - `enum App\Enums\EnsureAdminOutcome: string { Created = 'created'; Exists = 'exists'; AccountsExist = 'accounts_exist'; NotConfigured = 'not_configured'; }`
  - `final class App\Actions\Auth\EnsureAdmin` (`AsAction`): `handle(?string $email, ?string $password): EnsureAdminOutcome` — legt die Person nur an, wenn es noch **keine** Person gibt; sonst `Exists` (E-Mail vorhanden) bzw. `AccountsExist`; ohne beide Werte `NotConfigured`; ungültige E-Mail, Passwort unter 8 Zeichen oder der Platzhalter `change-me` → `ValidationException`, nichts angelegt. Name = Teil vor `@`, `handle` = `Handle::suggest`. Phase 2 ergänzt die Org-Rolle Admin.
  - `app:ensure-admin` (`EnsureAdminCommand`): liest `config('werkbuch.admin.email|password')`, ruft `EnsureAdmin`, gibt aus: `Created`: „Admin account <email> created.“; `Exists`: „<email> already exists; nothing changed. Remove ADMIN_PASSWORD from .env.“; `AccountsExist`: „Accounts exist already; ADMIN_EMAIL is only used on the first start.“; `NotConfigured` ohne Personen: Warnung „No account exists and ADMIN_EMAIL/ADMIN_PASSWORD are not set: nobody can sign in.“ (Exit 0); `ValidationException` → Fehlermeldung, Exit 1.
  - `app:reset-password {email}` (`ResetPasswordCommand`): Passwort nur per verdecktem Prompt (zweimal: „New password (at least 8 characters)“, „Repeat the new password“) oder als erste Zeile von STDIN (`--no-interaction`); nie als Argument oder Option; öffentliches statisches `$stdin = 'php://stdin'` für Tests; unbekannte E-Mail, leere Eingabe, ungleiche Wiederholung, ungültiges Passwort → Exit 1; Erfolg „New password set for <email>; all sessions ended.“

- [ ] **Step 1: Failing Tests schreiben**

`tests/Unit/Domain/HandleTest.php`:

```php
it('validates handles', function (string $handle, bool $valid) {
    expect(Handle::isValid($handle))->toBe($valid);
})->with([['mara', true], ['jo-2', true], ['ab', false], ['Mara', false], ['mara_l', false], [str_repeat('a', 33), false]]);

it('suggests a handle from an email address', function (string $source, string $handle) {
    expect(Handle::suggest($source, fn () => false))->toBe($handle);
})->with([
    ['mara@feldwerk.example.com', 'mara'], ['Jörg.Müßig@example.com', 'joerg-muessig'], ['jo@example.com', 'jo-user'],
    ['--a__b--@example.com', 'a-b'], [str_repeat('x', 40).'@example.com', str_repeat('x', 32)],
]);

it('appends a number while the handle is taken', function () {
    $taken = ['automation', 'automation-2'];
    expect(Handle::suggest('automation@example.com', fn (string $h) => in_array($h, $taken, true)))->toBe('automation-3')
        ->and(strlen(Handle::suggest(str_repeat('y', 32).'@x.de', fn (string $h) => $h === str_repeat('y', 32))))->toBe(32);
});
```

`tests/Feature/SetPasswordTest.php`: neues Passwort gilt, `remember_token` ist neu, Sitzungen des Kontos weg (Zeile in `sessions` vorher eingefügt), Sitzungen anderer bleiben; zu kurz → `ValidationException` an `password`, altes Passwort gilt weiter.

`tests/Feature/EnsureAdminTest.php` (Muster openbill):

```php
beforeEach(fn () => config(['werkbuch.admin.email' => 'owner@example.com', 'werkbuch.admin.password' => 'secret-pass']));

it('creates the first person from ADMIN_EMAIL and ADMIN_PASSWORD', function () {
    $this->artisan('app:ensure-admin')->expectsOutputToContain('created')->assertSuccessful();
    $user = User::sole();
    expect([$user->email, $user->handle, $user->name, $user->type])->toBe(['owner@example.com', 'owner', 'owner', AccountType::Person])
        ->and(Hash::check('secret-pass', $user->password))->toBeTrue();
});

```

Dazu: „changes nothing on the next start“ (zweiter Lauf nach Passwortänderung in der UI: Ausgabe `already exists`, Passwort bleibt), „creates no second admin once people exist“ (eine Person vorhanden → Ausgabe `only used on the first start`, weiter 1 Konto), „warns without failing when nobody can sign in“ (ohne Werte → `nobody can sign in`, Exit 0), „fails and creates nothing for invalid values“ (Datensätze `['not-an-email','secret-pass']`, `['owner@example.com','short']`, `['owner@example.com','change-me']` → Exit 1, 0 Konten).

`tests/Feature/ResetPasswordCommandTest.php`: openbills `ResetPasswordCommandTest` übernehmen (Prompt zweimal, STDIN erste Zeile, leeres STDIN, unbekannte Adresse, ungleiche Wiederholung, zu kurz, kein Passwort-Argument und keine Option `password`), Klasse `ResetPasswordCommand`.

- [ ] **Step 2: Rot, implementieren, grün**

```bash
ddev composer require lorisleiva/laravel-actions:^2.13
ddev artisan test --filter='HandleTest|SetPasswordTest|EnsureAdminTest|ResetPasswordCommandTest'
ddev artisan test --coverage --min=100
ddev exec vendor/bin/phpstan analyse --memory-limit=1G
```

Expected: erst FAIL, dann PASS mit `Total: 100.0 %`; ArchTest grün (Actions final mit `AsAction` und `handle`, Domain ohne Laravel, Commands ohne Model-Schreibzugriffe).

- [ ] **Step 3: Commit**

Betreff: `feat: add app:ensure-admin and app:reset-password with handles derived from the email`.

---

### Task 11: Anmeldung mit Fortify und die Auth-Bildschirme

**Files:**
- Create: `config/fortify.php`, `app/Providers/FortifyServiceProvider.php`, `app/Actions/Auth/Authenticate.php`, `app/Auth/FortifyResetUserPassword.php`, `app/Auth/PasswordResetLinkResponse.php`, `app/Notifications/ResetPasswordNotification.php`, `resources/views/vendor/mail/**`, `resources/views/vendor/notifications/email.blade.php`, `resources/js/features/auth/{AuthLayout,Login,ForgotPassword,ResetPassword}.tsx`, `resources/js/pages/Auth/{Login,ForgotPassword,ResetPassword}.tsx`, `tests/Feature/Auth/{LoginTest,LoginThrottleTest,PasswordResetTest,CsrfExpiryTest}.php`
- Modify: `bootstrap/app.php`, `bootstrap/providers.php`, `app/Models/User.php`, `app/Http/Middleware/HandleInertiaRequests.php`, `lang/*`, `tests/Unit/ArchTest.php`

**Interfaces:**
- Consumes: `SetPassword`, `PasswordRules` (Task 10), `AuthLayout`-Bausteine aus `components/ui` (Tasks 8, 9), `useSharedProps` (Task 4), `t` (Task 5)
- Produces:
  - Routen von Fortify: `GET|POST /login` (`login`, `login.store`), `POST /logout` (`logout`), `GET|POST /forgot-password` (`password.request`, `password.email`), `GET /reset-password/{token}` (`password.reset`), `POST /reset-password` (`password.update`). `config/fortify.php`: `features = [Features::resetPasswords()]`, `views = true`, `home = '/my-items'`, `redirects.logout = '/login'`, `limiters.login = 'login'`, `lowercase_usernames = true`.
  - `final class App\Actions\Auth\Authenticate` (`AsAction`): `handle(string $email, string $password): ?User` — nur Personen, nicht deaktiviert, Passwort stimmt; sonst `null` (Fortify zählt das als Fehlversuch).
  - `FortifyServiceProvider::boot()`: Views als Inertia-Seiten `Auth/Login`, `Auth/ForgotPassword`, `Auth/ResetPassword` (Props `token`, `email`); `Fortify::authenticateUsing(fn (Request $r) => Authenticate::run(…))`; `Fortify::resetUserPasswordsUsing(FortifyResetUserPassword::class)`; `RateLimiter::for('login', fn (Request $r) => Limit::perMinute(config('werkbuch.rate_limits.login_per_ip'))->by($r->ip()))`; `FailedPasswordResetLinkRequestResponse` → `PasswordResetLinkResponse`; `ResetPassword::createUrlUsing(fn (User $u, string $token) => rtrim(config('app.url'), '/').'/reset-password/'.$token.'?email='.urlencode((string) $u->email))`. Die Sperre nach 5 Fehlversuchen je `lower(email)|IP` für 60 s macht Fortifys `LoginRateLimiter` (Pipeline `EnsureLoginIsNotThrottled`).
  - `final class App\Auth\FortifyResetUserPassword implements ResetsUserPasswords`: `reset(User $user, array $input): void` → prüft `password` mit `PasswordRules::rules()` + `confirmed`, ruft `SetPassword::run`.
  - `final class App\Auth\PasswordResetLinkResponse implements FailedPasswordResetLinkRequestResponse`: `__construct(string $status)`; `INVALID_USER` und `RESET_THROTTLED` → `back()->with('status', __('passwords.sent'))` (wie Erfolg); sonst Validierungsfehler an `email`.
  - `User::sendPasswordResetNotification(string $token): void` → nichts für deaktivierte Konten, sonst `ResetPasswordNotification` (Schlüssel `mail.reset_password.subject|greeting|intro|action|expiry|outro`, Sprache `preferredLocale()`). Die veröffentlichten Mail-Views (`vendor:publish --tag=laravel-mail --tag=laravel-notifications`) nutzen `mail.layout.*` statt der englischen Satz-Schlüssel des Frameworks.
  - `bootstrap/app.php`: `redirectGuestsTo(fn () => route('login'))`, `redirectUsersTo('/my-items')`; Middleware-Priorität wie openbill (ThrottleRequests vor AuthenticatesRequests); Exceptions: `ThrottleRequestsException` auf `login.store` → `back()->withErrors(['email' => __('auth.throttle', ['seconds' => <Retry-After>])])->onlyInput('email')`; `TokenMismatchException` außerhalb `/api` → `redirect()->back()->with('error', __('errors.page_expired'))`.
  - `features/auth/*`: Port von `AuthLayout`, `Login`, `ForgotPassword` des Klickdummys (ohne Demo-Hinweise und Fußzeile „Klickdummy …“), dazu `ResetPassword` (Reiter „Passwort“, Titel „Neues Passwort“, Felder E-Mail (vorbelegt, `readOnly`), „Neues Passwort“, „Wiederholen“, Knopf „Passwort setzen“; Texte unter `reset_password.*`). Formulare über Inertias `useForm`; leere Felder prüft der Client mit den Texten des Klickdummys und setzt den Fokus; Serverfehler stehen am Feld, Fokus auf das erste fehlerhafte Feld. `AuthLayout` zeigt `flash.status` als Banner `info` (in einer `role="status"`-Region) und `flash.error` als Banner `danger` über dem Formular. Ein Fehler am Feld `email` auf `ResetPassword` bietet den Link „Neuen Link anfordern“ (`reset_password.request_new`) auf `/forgot-password`. Schlüssel, auf die sich Task 14 verlässt: `login.title`, `login.email`, `login.password`, `login.submit`, `login.forgot_link`, `forgot_password.email`, `forgot_password.submit`, `reset_password.email`, `reset_password.request_new`. `ForgotPassword` ohne Mailserver (`features.mail === false`): statt des Formulars ein Banner „Diese Instanz verschickt keine Mails. Ein Admin setzt dein Passwort mit `php artisan app:reset-password` zurück.“ (`forgot_password.no_mail`). Nach dem Absenden ersetzt die Bestätigung des Klickdummys das Formular (Fokus darauf), unabhängig davon, ob es das Konto gibt.

- [ ] **Step 1: Failing Tests schreiben**

Dateien unter `tests/Feature/Auth/`. Pflicht-Fälle mit ihren Assertions:

`LoginTest.php`:

```php
it('shows the sign-in page to guests and leads signed-in people on', function () {
    $this->get('/login')->assertOk()->assertInertia(fn (Assert $p) => $p->component('Auth/Login'));
    $this->actingAs(User::factory()->create())->get('/login')->assertRedirect('/my-items');
});

it('signs a person in with any case of the email and leads to my items', function () {
    User::factory()->create(['email' => 'mara@example.com', 'password' => 'secret-pass']);
    $this->post('/login', ['email' => ' Mara@Example.com ', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('refuses wrong passwords, disabled accounts and bots with the same message', function (Closure $make, string $password) {
    $make();
    $this->from('/login')->post('/login', ['email' => 'x@example.com', 'password' => $password])
        ->assertRedirect('/login')->assertSessionHasErrors(['email' => __('auth.failed')]);
    $this->assertGuest();
})->with([
    'wrong password' => [fn () => User::factory()->create(['email' => 'x@example.com', 'password' => 'secret-pass']), 'wrong-pass'],
    'disabled' => [fn () => User::factory()->disabled()->create(['email' => 'x@example.com', 'password' => 'secret-pass']), 'secret-pass'],
    'bot' => [fn () => User::factory()->bot()->create(['email' => 'x@example.com']), 'anything'],
]);
```

Weitere Fälle in `LoginTest.php`: „signs in the account of app:ensure-admin“ (nach `artisan('app:ensure-admin')` mit gesetzter Config → Redirect `/my-items`), „signs out and leads to the sign-in“ (`POST /logout` → `/login`, `assertGuest()`), „rate-limits before it authenticates“ (in `app(Kernel::class)->getMiddlewarePriority()` steht `ThrottleRequests::class` vor `AuthenticatesRequests::class`).

`LoginThrottleTest.php` (Review Focus 2; `beforeEach`: `$this->freezeTime()` und Mara mit `secret-pass`):

```php
it('locks the email for this IP after five failures, even with the right password', function () {
    foreach (range(1, 5) as $i) $this->post('/login', ['email' => $i % 2 ? 'MARA@example.com' : 'mara@example.com', 'password' => 'nope']);
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 60])]);
    $this->assertGuest();
});

it('answers the 21st attempt of an IP within a minute with a field error, not a 429 page', function () {
    foreach (range(1, 20) as $i) $this->post('/login', ['email' => "u{$i}@example.com", 'password' => 'nope']);
    $this->from('/login')->withHeader('X-Inertia', 'true')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/login')->assertSessionHasErrors('email');
    $this->assertGuest();
});
```

Dazu: „keeps other emails from this IP and this email from other IPs free“ (nach 5 Fehlversuchen für Mara meldet sich Ida von derselben IP an, Mara von `REMOTE_ADDR` `10.9.9.9`) und „unlocks after 60 seconds“ (`$this->travel(61)->seconds()` → Anmeldung klappt).

`PasswordResetTest.php` (Review Focus 1, 3, 4):

```php
it('builds the reset link from APP_URL, not from the request host, and mails in the language of the account', function () {
    Notification::fake();
    config(['app.url' => 'https://pm.example.com']);
    $user = User::factory()->locale(Locale::De)->create(['email' => 'lene@example.com']);

    $this->withHeader('Host', 'evil.example.net')->post('/forgot-password', ['email' => 'lene@example.com'])->assertSessionHas('status');

    Notification::assertSentTo($user, ResetPasswordNotification::class, fn ($n) =>
        str_starts_with($n->toMail($user)->actionUrl, 'https://pm.example.com/reset-password/') && $n->locale === 'de');
});

it('answers the same for unknown, disabled and throttled addresses', function () {
    Notification::fake();
    User::factory()->create(['email' => 'lene@example.com']);
    User::factory()->disabled()->create(['email' => 'sven@example.com']);
    $this->post('/forgot-password', ['email' => 'lene@example.com']);

    foreach (['nobody@example.com', 'sven@example.com', 'lene@example.com'] as $email) {
        $this->from('/forgot-password')->post('/forgot-password', ['email' => $email])
            ->assertRedirect('/forgot-password')->assertSessionHas('status', __('passwords.sent'))->assertSessionHasNoErrors();
    }
    Notification::assertSentTimes(ResetPasswordNotification::class, 1);
});

it('sets the new password, ends other sessions and leads to the sign-in', function () {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    DB::table('sessions')->insert(['id' => 's1', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);

    $this->post('/reset-password', ['token' => Password::createToken($user), 'email' => 'lene@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertRedirect('/login')->assertSessionHas('status', __('passwords.reset'));
    expect(Hash::check('new-password', $user->fresh()->password))->toBeTrue()
        ->and(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(0);
});
```

Dazu: „names the reason of a used or expired link at the field“ (Token `used` → Fehler `email` = `__('passwords.token')`), „refuses short and unrepeated passwords“ (Datensätze `['short','short']`, `['new-password','other-password']` → Fehler an `password`), „shows the reset page with token and email“ (`GET /reset-password/abc?email=lene%40example.com` → `Auth/ResetPassword` mit `token` `abc`, `email` `lene@example.com`), „shows the forgot page to guests“ (`Auth/ForgotPassword`).

`CsrfExpiryTest.php` (Review Focus 4): CSRF prüft Laravel in Unit-Tests nicht, darum wirft eine Testroute die Exception selbst: `Route::middleware('web')->post('_t/expired', fn () => throw new TokenMismatchException())`; `from('/login')->post('_t/expired')` → Redirect `/login` mit `session('error') === __('errors.page_expired')`; dieselbe Exception unter `api/v1/_t/expired` → Problem Details 419 `csrf_token_mismatch`.

`ArchTest.php` ergänzen: `arch('auth adapters are final and do not compute')->expect('App\Auth')->classes()->toBeFinal()->not->toUse('App\Domain')`.

- [ ] **Step 2: Rot sehen**

Run: `ddev artisan test --filter=Auth`
Expected: FAIL (Fortify fehlt).

- [ ] **Step 3: Implementieren**

```bash
ddev composer require laravel/fortify:^1.41
ddev artisan vendor:publish --tag=fortify-config
ddev artisan vendor:publish --tag=laravel-mail --tag=laravel-notifications
```

Nicht `fortify:install` (legt 2FA-Migration und `app/Actions/Fortify/*` ohne `handle()` an). Provider in `bootstrap/providers.php` eintragen. Seiten unter `pages/Auth/*` rendern nur das Feature (`export default function LoginPage() { return <Login />; }`).

- [ ] **Step 4: Grün sehen**

```bash
ddev artisan test --coverage --min=100
ddev exec vendor/bin/phpstan analyse --memory-limit=1G
ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage && ddev exec pnpm build
```

Expected: alles grün. Von Hand (mit `ddev exec pnpm dev`): `https://werkbuch.ddev.site/login` mit dem Konto aus `ddev artisan app:ensure-admin` anmelden → Weiterleitung auf `/my-items` (bis Task 12 die vorläufige 404-Seite); „Passwort vergessen?“ → Mail in Mailpit (`https://werkbuch.ddev.site:8026`) mit Link auf `https://werkbuch.ddev.site/reset-password/…`.

- [ ] **Step 5: Commit**

Betreff: `feat: sign in, sign out and reset passwords with Fortify, throttled and without account enumeration`.

---

### Task 12: Shell mit Seitenleiste

**Files:**
- Create: `resources/js/store/ui.ts`, `resources/js/store/ui.test.ts`, `resources/js/lib/links.ts`, `resources/js/lib/links.test.ts`, `resources/js/lib/useDocumentTitle.ts`, `resources/js/lib/useDocumentTitle.test.tsx`, `resources/js/lib/shortcuts/HelpOverlay.tsx`, `resources/js/lib/shortcuts/HelpOverlay.test.tsx`, `resources/js/shell/{Shell,Sidebar,MobileBar,ProfileMenu,LiveIndicator,PageStates,bindings,layout}.tsx`, `resources/js/shell/LiveIndicator.test.tsx`, `resources/js/shell/PageStates.test.tsx`, `resources/js/features/items/MyItemsEmpty.tsx`, `resources/js/pages/Items/MyItems.tsx`, `resources/js/pages/Errors/Error.tsx`, `tests/Feature/ShellRoutesTest.php`, `tests/Feature/ErrorPagesTest.php`
- Modify: `resources/js/pages/Errors/NotFound.tsx`, `routes/web.php`, `bootstrap/app.php`, `lang/*`, `vitest.config.ts` (Schwelle `store/**`)

**Interfaces:**
- Consumes: `components/ui` (Tasks 8, 9), Register und Katalog (Task 6), `useLiveConnected` (Task 7), `useSharedProps` (Task 4), `t` (Task 5), `undoLatest`, `canUndo` (Task 9), `applyTheme` (Task 4)
- Produces:
  - `store/ui.ts` = Port von `src/store/ui.ts` (alle Felder; Theme über `applyTheme`); `store/session.ts` entfällt (die Person kommt aus `auth.user`).
  - `lib/links.ts`: `paths` mit `home()`, `myItems()`, `created()`, `subscribed()`, `inbox()`, `views()`, `view(id: string)`, `projects()`, `project(identifier: string, layout?: 'board' | 'table' | 'timeline')`, `wiki(identifier: string, pageId?: string)`, `templates(identifier: string, templateId?: string)`, `projectSettings(identifier: string, section?: string)`, `item(key: string)`, `settings(section?: string)`, `me(section?: string)`, `login()`, `logout()`, `forgotPassword()`, `resetPassword(token: string, email: string)`, `invitation(token: string)` — Pfade wie README „Routen“ des Klickdummys; `appUrl(path: string): string` (`location.origin` + Pfad), `instanceOrigin(): string` (`location.origin`); `useActivePath(to: string, end?: boolean, also?: string[]): boolean` (aus `usePage().url` ohne Query). Kein `hrefOf`, kein Hash-Routing; React Router fällt weg, Links sind Inertias `<Link href={paths.inbox()}>`.
  - `lib/useDocumentTitle.ts` (Port, „<Titel> – werkbuch“).
  - `shell/layout.tsx`: `export const shellLayout = (page: ReactNode) => <Shell>{page}</Shell>` (Pfeilfunktion, Inertia-v3-Fallstrick). Jede Seite mit Shell setzt `Page.layout = shellLayout`.
  - `Shell`: Port ohne `PeekHost`, `CreateHost`, `CommandPalette`, `ItemDialogsHost` (kommen mit ihren Phasen); „Zum Inhalt“, `MobileBar`, `Sidebar`, `<main id="main">` mit `LiveIndicator` darüber, `HelpOverlay`; zeigt `flash.error` einmal je Besuch als Fehler-Toast.
  - `Sidebar`: Wortmarke mit Einklappen, Inbox (ohne Zähler bis Phase 8), Meine Items, Abschnitt Views (leerer Hinweis „Views mit Stern stehen hier.“ und „Alle Views“), Abschnitt Projekte (leerer Hinweis „Projekte mit Stern stehen hier.“ und „Alle Projekte“), unten `ProfileMenu` und Zahnrad „Einstellungen der Organisation“; eingeklappt die Icon-Leiste. Ohne Suche-Knopf (Phase 6) und ohne „anlegen“-Links (Phase 2 und 5). Links auf Seiten späterer Phasen führen bis dahin auf die 404-Seite.
  - `MobileBar`: Menü (Drawer mit derselben Seitenleiste), Wortmarke, Inbox-Link; ohne Suche bis Phase 6.
  - `ProfileMenu`: Theme (System/Hell/Dunkel), „Persönliche Einstellungen“, „Abmelden“ (`router.post(paths.logout())`, Fehler → Toast `shell.profile.logout_failed`); ohne „Als … ansehen“ und Demo-Gruppe.
  - `bindings.tsx`: `useShellBindings()` registriert `shell.help`, `shell.undo` (mit `when: canUndo`) und `shell.go.*` (`router.visit`).
  - `HelpOverlay`: Port; `helpGroups()` mit Gruppenschlüsseln, Reihenfolge `shortcuts.group.general`, `shortcuts.group.navigation` zuerst; Titel und Beschreibung aus `shortcuts.help.*`.
  - `PageStates`: `NotFound({ title?, description? })` (Port, Aktion „Meine Items öffnen“; ohne „Suchen“ bis Phase 6), `ErrorPage({ status }: { status: 403 | 500 | 503 })` (Texte `errors.page.<status>.title|description`, „Neu laden“).
  - Seiten: `pages/Items/MyItems.tsx` → `MyItemsEmpty` (Überschrift „Meine Items“, `EmptyState` mit Titel, Text und Knopf „Projekte ansehen“ aus `ItemsScreen.tsx` des Klickdummys, Preset `my`; Schlüssel `items.empty.my.title|description`, `items.empty.projects_link`; Phase 5 ersetzt den Inhalt). `pages/Errors/NotFound.tsx` → `NotFound` in der Shell. `pages/Errors/Error.tsx` → `ErrorPage`, `layout`: Shell nur mit `auth.user`, sonst ohne.
  - Schlüssel, auf die sich Task 14 verlässt: `shell.skip_to_content`, `shell.mobile.open_navigation`, `shell.mobile.navigation`, `shell.sidebar.collapse`, `shell.sidebar.expand`, `shell.profile.logout`, `shortcuts.help.title`, `theme.system`, `theme.light`, `theme.dark`, `items.my.title`, `errors.not_found.title`, `errors.not_found.open_my_items`.
  - Routen: `Route::middleware('auth')->group(…)`: `Route::redirect('/', '/my-items')`, `Route::inertia('/my-items', 'Items/MyItems')->name('my-items')`, `Route::fallback(…)` (404 `Errors/NotFound`). Gäste landen überall auf `/login`.
  - `bootstrap/app.php`: `$exceptions->respond(fn (Response $response, Throwable $e, Request $request) => …)`: außerhalb `/api`, für Status 403, 404, 500, 503 und nicht bei `app.debug` mit 500 → `Inertia::render($status === 404 ? 'Errors/NotFound' : 'Errors/Error', ['status' => $status])->toResponse($request)->setStatusCode($status)`.

- [ ] **Step 1: Failing Tests schreiben**

`ShellRoutesTest.php`:

```php
it('leads / to my items and guests to the sign-in', function () {
    $this->get('/')->assertRedirect('/login');
    $this->actingAs(User::factory()->create())->get('/')->assertRedirect('/my-items');
});

it('renders my items for signed-in people', function () {
    $this->actingAs(User::factory()->create())->get('/my-items')->assertOk()->assertInertia(fn (Assert $p) => $p->component('Items/MyItems'));
});

it('shows unknown paths as 404 in the shell, but only to signed-in people', function () {
    $this->get('/projects/WEB')->assertRedirect('/login');
    $this->actingAs(User::factory()->create())->get('/projects/WEB')->assertNotFound()->assertInertia(fn (Assert $p) => $p->component('Errors/NotFound'));
});
```

`ErrorPagesTest.php`: Testroute in `web` mit `abort(403)` → 403 `Errors/Error` mit `status` 403; `throw new LogicException` mit `app.debug=false` → 500 `Errors/Error`; mit `app.debug=true` bleibt Laravels Debug-Seite (kein Inertia-Payload).

`store/ui.test.ts` = Port von `store.test.ts` ohne die Session-Fälle. `lib/links.test.ts`: jeder Pfad (`paths.project('WEB', 'board')` → `/projects/WEB?layout=board`, `paths.resetPassword('t', 'a+b@example.com')` → `/reset-password/t?email=a%2Bb%40example.com`), `appUrl`, `instanceOrigin`, `useActivePath` (genau, darunter, `also`, Query ignoriert; `vi.mock('@inertiajs/react')`). `HelpOverlay.test.tsx`: Port von `HelpOverlay.test.ts` plus „zeigt die Gruppen in übersetzter Form, Allgemein zuerst“. `LiveIndicator.test.tsx`: ohne Verbindung (gemocktes `useLiveConnected` → false) erscheint das Banner „Live-Updates pausiert“ in der `status`-Region, „Neu laden“ ruft `location.reload`; verbunden ist die Region leer. `PageStates.test.tsx`: `ErrorPage` je Status; `NotFound` mit eigenem Titel. `useDocumentTitle.test.tsx`: setzt und stellt zurück.

- [ ] **Step 2: Rot, implementieren, grün**

```bash
ddev artisan test --coverage --min=100
ddev exec pnpm typecheck && ddev exec pnpm test:coverage && ddev exec pnpm build
```

Expected: grün (Schwelle `'resources/js/store/**': { lines: 100 }` neu). Von Hand mit `ddev exec pnpm dev`: nach dem Login die Shell mit leerer Seitenleiste; `?` zeigt die Kürzel; `g p` führt auf die 404-Seite in der Shell; bei 390 px öffnet „Navigation öffnen“ den Drawer; Theme im Profilmenü wechselt ohne Flackern und übersteht Neuladen.

- [ ] **Step 3: Commit**

Betreff: `feat: add the shell with sidebar, profile menu, shortcut help, live banner and error pages`.

---

### Task 13: `DemoSeeder`-Gerüst

**Files:**
- Create: `database/seeders/DemoSeeder.php`, `database/seeders/Demo/PeopleSeeder.php`, `database/seeders/E2eSeeder.php`, `tests/Feature/DemoSeederTest.php`
- Modify: `database/seeders/DatabaseSeeder.php`

**Interfaces:**
- Consumes: `User`, `Locale` (Task 1)
- Produces:
  - `DemoSeeder::PASSWORD = 'werkbuch-demo'`; `DemoSeeder::run()` verweigert `production` (`RuntimeException`) und ruft der Reihe nach die Seeder unter `database/seeders/Demo/` auf; jede Phase hängt ihren an (`ProjectsSeeder`, `ItemsSeeder` …).
  - `Demo\PeopleSeeder`: die sechs Personen aus `src/api/seed/people.ts` per `updateOrCreate` nach E-Mail (Mara Lindqvist `mara`, Jonas Feld `jonas`, Ida Brenner `ida`, Theo Okafor `theo`, Lene Vogt `lene`, Sven Albers `sven`), E-Mail `<handle>@feldwerk.example.com`, `locale` `de`, `timezone` `Europe/Berlin`, Passwort `DemoSeeder::PASSWORD` (bei jedem Lauf neu gesetzt), Sven mit `disabled_at` `2026-09-18 17:00` Europe/Berlin. Organisation Feldwerk, Org-Rollen und die Bots folgen in Phase 2.
  - `E2eSeeder`: ruft `DemoSeeder`, dann je Person `updateOrCreate`: `e2e@example.com` („Erik Ende“, `e2e`, `locale` null, Passwort `e2e-password`) und für die Reset-Tests `reset-desktop-light@example.com`, `reset-desktop-dark@example.com`, `reset-phone-light@example.com`, `reset-phone-dark@example.com` („Rita Reset“, Handle wie der Teil vor `@`, Passwort `e2e-password`); verweigert `production`.

- [ ] **Step 1: Failing Test schreiben**

```php
it('seeds the six demo people of the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    expect(User::orderBy('handle')->pluck('email', 'handle')->all())->toBe([
        'ida' => 'ida@feldwerk.example.com', 'jonas' => 'jonas@feldwerk.example.com', 'lene' => 'lene@feldwerk.example.com',
        'mara' => 'mara@feldwerk.example.com', 'sven' => 'sven@feldwerk.example.com', 'theo' => 'theo@feldwerk.example.com',
    ])->and(User::where('handle', 'sven')->sole()->isDisabled())->toBeTrue()
        ->and(User::where('locale', 'de')->where('timezone', 'Europe/Berlin')->count())->toBe(6);
});

it('runs again without duplicates and resets the demo password', function () {
    $this->seed(DemoSeeder::class);
    User::where('handle', 'lene')->sole()->update(['password' => 'changed-elsewhere']);
    $this->seed(DemoSeeder::class);
    expect(User::count())->toBe(6)->and(Hash::check(DemoSeeder::PASSWORD, User::where('handle', 'lene')->sole()->password))->toBeTrue();
});

it('adds the e2e people on top', function () {
    $this->seed(E2eSeeder::class);
    expect(User::count())->toBe(11)->and(User::where('email', 'e2e@example.com')->sole()->locale)->toBeNull();
});

it('refuses production', function () {
    $this->app['env'] = 'production';
    expect(fn () => $this->seed(DemoSeeder::class))->toThrow(RuntimeException::class)
        ->and(fn () => $this->seed(E2eSeeder::class))->toThrow(RuntimeException::class);
});
```

- [ ] **Step 2: Rot, implementieren, grün**

Run: `ddev artisan test --filter=DemoSeederTest` (FAIL → PASS), dann `ddev artisan test --coverage --min=100` und `ddev artisan db:seed --class=DemoSeeder` (Ausgabe ohne Fehler).

- [ ] **Step 3: Commit**

Betreff: `feat: add the DemoSeeder scaffold with the demo people and an E2eSeeder`.

---

### Task 14: Abdeckungs-Pipeline und `e2e/`

**Files:**
- Create: `scripts/coverage-merge.mjs`, `scripts/coverage-merge.test.mjs`, `scripts/coverage-ignores.test.mjs`, `e2e/package.json`, `e2e/pnpm-workspace.yaml`, `e2e/pnpm-lock.yaml`, `e2e/tsconfig.json`, `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `e2e/fixtures.ts`, `e2e/helpers.ts`, `e2e/ci.env`, `e2e/tests/auth.setup.ts`, `e2e/tests/login.spec.ts`, `e2e/tests/password-reset.spec.ts`, `e2e/tests/shell.spec.ts`
- Modify: `vite.config.ts` (Modus `coverage`), `package.json` (`build:coverage`, `coverage:merge`), Vitest-Tests für Zeilen, die Playwright nicht erreicht

**Interfaces:**
- Consumes: Seiten und Shell (Tasks 11, 12), `E2eSeeder` (Task 13), `lang/*.json` (Task 5)
- Produces:
  - `pnpm build:coverage` = `vite build --mode coverage`: im Modus `coverage` hängt `vite.config.ts` `istanbul({ include: 'resources/js/**', exclude: ['resources/js/**/*.test.*', 'resources/js/test/**'], extension: ['.ts', '.tsx'], requireEnv: false, forceBuildInstrument: true })` an und setzt `build.sourcemap = true`; Ausgabe nach `public/build` wie der normale Build.
  - `e2e/fixtures.ts`: `test` und `expect`; Auto-Fixture `pageErrors` (Port aus `prototypes/clickdummy/e2e/fixtures.ts`); Auto-Fixture `coverage`: wenn `E2E_COVERAGE !== '0'`, schreibt nach jedem Test `window.__coverage__` jeder offenen Seite der App-URL nach `coverage/e2e/<testId>-<n>.json`, dazu per `exposeBinding('__werkbuchCoverage')` und Init-Skript auf `pagehide` den Stand vor jedem vollen Neuladen; scheitert, wenn eine Seite kein `__coverage__` hat („run `ddev exec pnpm build:coverage` first“).
  - `scripts/coverage-merge.mjs` (Node, ESM, `istanbul-lib-coverage`, `istanbul-lib-report`, `istanbul-reports`) mit benannten Exporten `normalizePath(file: string, root: string): string | null` (alles vor `resources/js/` abschneiden; Pfade außerhalb oder Tests → `null`), `loadCoverage(root: string): CoverageMap` (`coverage/unit/coverage-final.json` plus alle `coverage/e2e/*.json`, Pfade normalisiert und gegen `root` aufgelöst), `uncovered(map: CoverageMap): { file: string; lines: number[] }[]` (`file` relativ zum Repo), und Hauptprogramm: schreibt `coverage/merged/coverage-final.json`, Berichte `text-summary` und `html` (`coverage/merged/html`), listet jede Datei unter 100 % mit ihren Zeilen, Exit 1 unter 100 % Zeilen; fehlt `coverage/unit/coverage-final.json`, Exit 1 mit „run `ddev exec pnpm test:coverage` first“.
  - `e2e/global-setup.ts`: Ziel `WERKBUCH_URL ?? 'https://werkbuch.ddev.site'`; gegen DDEV (ohne `WERKBUCH_URL`) mit Abdeckung: `public/hot` darf nicht existieren und `public/build/manifest.json` muss existieren; leert `coverage/e2e/`; Artisan über `E2E_ARTISAN ?? 'ddev artisan'`: `cache:clear` (setzt die Login-Drosseln zurück) und `db:seed --class=E2eSeeder --no-interaction`.
  - `e2e/global-teardown.ts`: mit Abdeckung `E2E_EXEC ?? 'ddev exec'` + `pnpm coverage:merge` (vorher bei DDEV `ddev mutagen sync`, Fehler davon ignoriert); scheitert der Merge, scheitert der Lauf.
  - `e2e/helpers.ts`: `tr(locale: 'en' | 'de', key: string, params?: Record<string, string | number>): string` (liest `../lang/<locale>.json`; Tests schreiben keine UI-Texte ab), `PEOPLE` (`e2e`, `mara` und `theo` aus dem `DemoSeeder` mit `DemoSeeder::PASSWORD`, `reset` je Projektname), `login(page, email, password)` nur per Tastatur, `mailpit` (`MAILPIT_URL ?? 'https://werkbuch.ddev.site:8026'`) mit `latestTo(email: string, after: Date): Promise<{ html: string } | null>` über `GET /api/v1/search?query=to:"<email>"` und `GET /api/v1/message/<ID>` (`ignoreHTTPSErrors`).
  - Playwright-Projekte: `setup` (meldet die e2e-Person einmal an, speichert `e2e/.auth/user.json`) und `desktop-light` (1440×900, `colorScheme: 'light'`), `desktop-dark`, `phone-light` (390×844), `phone-dark`, alle mit `dependencies: ['setup']`, `storageState` der e2e-Person, `locale: 'en-GB'`, `timezoneId: 'Europe/Berlin'`, `ignoreHTTPSErrors`; `workers: 1`, `fullyParallel: false`, `retries: 0`, `globalSetup`, `globalTeardown`, Reporter `list` (CI zusätzlich `github`).
  - `e2e/package.json` Scripts: `test` (`playwright test`), `typecheck` (`tsc --noEmit`). `e2e/pnpm-workspace.yaml`: `packages: []` (eigene Wurzel, wird auf dem Mac installiert).
  - Ab hier gilt die zusammengeführte Grenze von 100 % Zeilen.

- [ ] **Step 1: Merge-Skript testgetrieben**

`scripts/coverage-merge.test.mjs`:

```js
it('normalizes container, runner and Mac paths to the repo', () => {
  expect(normalizePath('/var/www/html/resources/js/lib/i18n.ts', '/repo')).toBe('/repo/resources/js/lib/i18n.ts');
  expect(normalizePath('/home/runner/work/werkbuch/werkbuch/resources/js/app.tsx', '/repo')).toBe('/repo/resources/js/app.tsx');
  expect(normalizePath('/repo/resources/js/lib/i18n.test.ts', '/repo')).toBeNull();
  expect(normalizePath('/repo/node_modules/x/index.js', '/repo')).toBeNull();
});
it('adds the hits of unit and e2e runs per line', () => { /* fixtures: line 3 hit only in unit, line 5 only in e2e → uncovered() is [] */ });
it('lists the lines nobody ran', () => { /* line 7 hit nowhere → [{ file: 'resources/js/x.ts', lines: [7] }] */ });
```

`scripts/coverage-ignores.test.mjs`: jedes `istanbul ignore` in `resources/js/**/*.{ts,tsx}` hat die Form `/* istanbul ignore <next|if|else> -- <Grund mit mindestens drei Wörtern> */`; Selbsttest des Detektors.

Run: `ddev exec pnpm test -- scripts` → FAIL, dann PASS.

- [ ] **Step 2: e2e-Projekt anlegen und installieren (auf dem Mac)**

```bash
pnpm --dir e2e install
pnpm --dir e2e exec playwright install chromium
pnpm --dir e2e typecheck
```

- [ ] **Step 3: Specs schreiben**

Alle Abläufe nur mit der Tastatur (`page.keyboard`, `locator.press`, kein `click`); Texte nur über `tr()`. Je Spec die Pflicht-Tests und ihre Assertions:

`login.spec.ts` (`test.use({ storageState: { cookies: [], origins: [] } })`; drei Anmeldungen je Projekt, damit ein Lauf unter der IP-Grenze bleibt):

| Test | Ablauf und Assertions |
|---|---|
| signs in and out with the keyboard only, in English | `/login`, `login(page, PEOPLE.e2e…)` → URL `/my-items`, `h1` = `tr('en','items.my.title')`; Tab zum Profilmenü, Enter, Pfeil zu „Sign out“, Enter → `/login`; `goto('/my-items')` → `/login` |
| shows the sign-in in German when the language cookie says so | Cookie `locale=de` → Überschrift `tr('de','login.title')`, `html[lang=de]` |
| switches to the language of the account after signing in, and keeps it after signing out | englische Anmeldeseite, `PEOPLE.mara` → `h1` = `tr('de','items.my.title')` (Seite neu geladen); abmelden → Überschrift `tr('de','login.title')` |
| names the reason at the email field for a wrong password | `PEOPLE.theo` mit falschem Passwort → E-Mail-Feld `aria-invalid="true"` und fokussiert, URL `/login` |
| paints the theme of the system before the first render, without horizontal scroll | `getComputedStyle(documentElement).getPropertyValue('--bg')` = `oklch(0.235 0.02 258)` (dark) bzw. `oklch(0.975 0.004 250)` (light); `scrollWidth <= innerWidth` |

`password-reset.spec.ts` (ohne Sitzung; `person = PEOPLE.reset[info.project.name]`):

```ts
test('sets a new password from the mail, and the used link names its reason', async ({ page }, info) => {
  const person = PEOPLE.reset[info.project.name]; const start = new Date();
  await page.goto('/login');
  // Tab to "Forgot password?", Enter, type the email, Enter
  await expect(page.getByText(person.email)).toBeVisible(); // the confirmation, which takes the focus
  await expect.poll(() => mailpit.latestTo(person.email, start), { timeout: 15_000 }).not.toBeNull();
  const { html } = (await mailpit.latestTo(person.email, start))!;
  const link = /href="([^"]+\/reset-password\/[^"]+)"/.exec(html)![1].replaceAll('&amp;', '&');
  await page.goto(link);
  // type the new password twice, Enter
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status').filter({ hasText: /\S/ })).toBeVisible(); // flash.status (text from lang/en/passwords.php)
  await page.goto(link); // the same link again, still signed out
  // type twice, Enter
  await expect(page.getByLabel(tr('en', 'reset_password.email'))).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('link', { name: tr('en', 'reset_password.request_new') })).toHaveAttribute('href', '/forgot-password');
  await page.goto('/login');
  await login(page, person.email, 'new-e2e-password');
  await expect(page).toHaveURL(/\/my-items$/);
});
test('answers an unknown address like a known one and sends nothing', async ({ page }) => {
  const start = new Date();
  await page.goto('/forgot-password');
  // type nobody@example.com, Enter
  await expect(page.getByText('nobody@example.com')).toBeVisible();
  await page.waitForTimeout(2000);
  expect(await mailpit.latestTo('nobody@example.com', start)).toBeNull();
});
```

`reset_password.email` und `reset_password.request_new` sind JSON-Schlüssel des Bildschirms (Task 11).

`shell.spec.ts` (Sitzung der e2e-Person, Englisch):

| Test | Assertions |
|---|---|
| starts with „Skip to content“ and lists the shortcuts with `?` | erstes Tab fokussiert den Link `shell.skip_to_content`; `?` öffnet den Dialog `shortcuts.help.title` mit `shortcuts.shell.go.inbox`; Escape schließt ihn |
| goes to projects with `g p` and shows the 404 page inside the shell | URL `/projects`; Überschrift `errors.not_found.title`; Seitenleiste sichtbar; Enter auf `errors.not_found.open_my_items` führt nach `/my-items` |
| opens the navigation drawer on the phone | nur `phone-*` (`test.skip` sonst): Knopf `shell.mobile.open_navigation` per Tab und Enter öffnet den Dialog `shell.mobile.navigation`, Escape schließt, Fokus zurück auf dem Knopf |
| collapses the sidebar to the rail and back | nur `desktop-*`: Knopf `shell.sidebar.collapse`, danach `shell.sidebar.expand` sichtbar |
| switches the theme from the profile menu and keeps it after reload | Profilmenü → `theme.dark` → nach `reload()` `html[data-theme=dark]`; zurück auf `theme.system` → Attribut fehlt |
| loads everything from its own origin | keine Anfrage außer Basis-URL und `data:`; `document.fonts.check('16px "Figtree Variable"')` und `document.fonts.check('700 16px "Bricolage Grotesque Variable"')` werden `true` |

- [ ] **Step 4: Laufen lassen und Lücken schließen**

```bash
ddev exec pnpm test:coverage
ddev exec pnpm build:coverage
pnpm --dir e2e test
```

Expected: alle Projekte grün; der Global-Teardown druckt den zusammengeführten Bericht und endet mit 100 % Zeilen. Listet er Zeilen: zuerst eine Playwright-Prüfung des Ablaufs, sonst ein Vitest-Test (z. B. `pages/Errors/Error.tsx`, Zweige ohne Verbindung); ein Ignore-Kommentar nur mit Grund. Danach `ddev exec pnpm build` (normaler Build zurück).

- [ ] **Step 5: Commit**

Betreff: `test: add the Istanbul coverage build, merged frontend coverage and the Playwright suite`.

---

### Task 15: VitePress-Gerüst

**Files:**
- Create: `docs/package.json`, `docs/.vitepress/config.ts`, `docs/.vitepress/theme/index.ts`, `docs/.vitepress/theme/style.css`, `docs/public/favicon.svg`, `docs/en/index.md`, `docs/en/development.md`, `docs/de/index.md`, `docs/de/development.md`, `tests/Feature/DocsTest.php`

**Interfaces:**
- Consumes: Kommandos der Tasks 1–14
- Produces: `docs`-Paket `werkbuch-docs` mit Scripts `dev` (`vitepress dev --host 0.0.0.0 --port 5174`), `build`, `preview`; `config.ts` wie openbill: `base = process.env.DOCS_BASE ?? '/'`, `site = process.env.DOCS_URL`, `srcExclude: ['history/**', 'superpowers/**', 'README.md']`, `llmstxt({ workDir: 'en', … })`, `vite.server.allowedHosts: ['.ddev.site']`, Locales `root` (`/en/`, English) und `de`, Seitenliste `pages = ['development']` (spätere Phasen tragen ihre Seiten ein), `editLink`, `socialLinks` auf `https://github.com/baeroe/werkbuch`, deutsche Theme-Texte wie openbill; Theme leitet Pfade ohne Sprache auf `/en/…` um und setzt Figtree/Bricolage und Tintenblau (`--vp-c-brand-1`) aus `DESIGN.md`.

- [ ] **Step 1: Failing Test schreiben**

`tests/Feature/DocsTest.php` (Feature, weil `base_path()` die App braucht):

```php
it('has every docs page in English and German', function () {
    $pages = fn (string $l): array => array_map('basename', glob(base_path("docs/{$l}/*.md")) ?: []);
    expect($pages('en'))->not->toBeEmpty()->toEqualCanonicalizing($pages('de'));
});
it('lists every page but the landing page in the sidebar', function () {
    $config = (string) file_get_contents(base_path('docs/.vitepress/config.ts'));
    foreach (array_diff(array_map(fn ($f) => basename($f, '.md'), glob(base_path('docs/en/*.md')) ?: []), ['index']) as $page) {
        expect($config)->toContain("'{$page}'");
    }
});
it('keeps specs, plans and history out of the site', fn () => expect((string) file_get_contents(base_path('docs/.vitepress/config.ts')))->toContain("'history/**'", "'superpowers/**'"));
it('documents the DDEV commands of the development page in both languages', function () {
    foreach (['en', 'de'] as $l) {
        expect((string) file_get_contents(base_path("docs/{$l}/development.md")))
            ->toContain('ddev start', 'ddev artisan test --coverage --min=100', 'ddev exec pnpm test:coverage', 'ddev exec pnpm build:coverage', 'pnpm --dir e2e test', 'app:ensure-admin', 'app:reset-password');
    }
});
```

- [ ] **Step 2: Seiten schreiben**

`index.md` (en/de): was werkbuch ist (README-Absatz), Status „in development“, Verweis auf `development`. `development.md` (en/de): Voraussetzungen (DDEV, Colima, mise/Node 24 nur für `e2e/`), erster Start (`ddev start`, `ddev composer install`, `ddev exec pnpm install`, `cp .env.example .env`, `ddev artisan key:generate`, `ddev artisan migrate`, `ddev artisan app:ensure-admin`, `ddev artisan db:seed --class=DemoSeeder`), Dev-Server (`ddev exec pnpm dev`, Adressen der Ports aus Task 1), Tests (PHP mit Abdeckung, Larastan, Pint, `tsc`, Vitest, Abdeckungs-Build, Playwright, Zusammenführung), Notfall `app:reset-password`, Doku-Server.

- [ ] **Step 3: Bauen**

```bash
ddev exec pnpm install
ddev exec pnpm --dir docs build
ddev exec 'DOCS_BASE=/werkbuch/ pnpm --dir docs build && grep -q "/werkbuch/" docs/.vitepress/dist/en/index.html && test -f docs/.vitepress/dist/llms.txt'
ddev artisan test --coverage --min=100
```

Expected: beide Builds grün, `grep`/`test` mit Exit 0, Pest grün.

- [ ] **Step 4: Commit**

Betreff: `docs: add the VitePress scaffold with index and development pages in English and German`.

---

### Task 16: CI und Dependabot

**Files:**
- Modify: `.github/workflows/tests.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: alle Kommandos der Tasks 2–15, `e2e/ci.env` (Task 14)
- Produces: Jobs `tests` (Pflicht), `e2e`, `docs`, `clickdummy`; `permissions: contents: read`; Trigger `pull_request` und `push` auf `main`.

- [ ] **Step 1: Job `tests`**

```yaml
  # required check: the name must stay `tests`
  tests:
    runs-on: ubuntu-latest
    services:
      mariadb:
        image: mariadb:11.4.13@sha256:1292844148b311e4ed4300022a996d39083f415a963e970cf47cad1b3b18e3a6
        env: { MARIADB_ROOT_PASSWORD: root, MARIADB_DATABASE: testing, MARIADB_USER: db, MARIADB_PASSWORD: db }
        ports: ['3306:3306']
        options: >-
          --health-cmd="healthcheck.sh --connect --innodb_initialized" --health-interval=5s --health-timeout=5s --health-retries=20
    env: { DB_CONNECTION: mariadb, DB_HOST: 127.0.0.1, DB_PORT: 3306, DB_DATABASE: testing, DB_USERNAME: db, DB_PASSWORD: db }
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.4', extensions: 'intl, zip, bcmath, pdo_mysql', coverage: pcov }
      - uses: pnpm/action-setup@v4   # version from "packageManager" in package.json
      - uses: actions/setup-node@v4
        with: { node-version-file: .node-version, cache: pnpm }
      # Composer cache like openbill (composer config cache-files-dir + actions/cache@v4, key from composer.lock)
      - name: Composer
        run: composer install --no-interaction --no-progress --prefer-dist
      - name: Environment
        run: cp .env.example .env && php artisan key:generate
      - name: Pint
        run: vendor/bin/pint --test
      - name: Larastan
        run: vendor/bin/phpstan analyse --no-progress --memory-limit=1G
      - name: pnpm install
        run: pnpm install --frozen-lockfile
      - name: TypeScript
        run: pnpm typecheck
      - name: Vitest with coverage
        run: pnpm test:coverage
      - name: Build
        run: pnpm build
      - name: Pest with coverage
        run: php artisan test --coverage --min=100
```

- [ ] **Step 2: Jobs `e2e`, `docs`, `clickdummy`**

`e2e` (kein Pflicht-Check, `timeout-minutes: 30`): Services `mariadb` (wie oben, DB `werkbuch`) und `mailpit` (`axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498`, Ports `1025:1025`, `8025:8025`); setup-php ohne Abdeckung, pnpm, Node; `composer install`; `cp e2e/ci.env .env && php artisan key:generate` (`php artisan serve` reicht nur wenige Env-Variablen an den Server weiter, darum steht alles in `.env`); `php artisan migrate --force`; `pnpm install --frozen-lockfile`; `pnpm test:coverage`; `pnpm build:coverage`; Server im Hintergrund `PHP_CLI_SERVER_WORKERS=4 php artisan serve --host=127.0.0.1 --port=8000 > serve.log 2>&1 &` und `curl -fsS --retry 30 --retry-delay 1 --retry-all-errors http://127.0.0.1:8000/up`; `pnpm --dir e2e install --frozen-lockfile`, `pnpm --dir e2e typecheck`, `pnpm --dir e2e exec playwright install --with-deps chromium`; `pnpm --dir e2e test` mit `env: { CI: 'true', WERKBUCH_URL: http://127.0.0.1:8000, MAILPIT_URL: http://127.0.0.1:8025, E2E_ARTISAN: php artisan, E2E_EXEC: '' }`; immer `coverage/merged/` als Artefakt `frontend-coverage`; bei Fehler `serve.log`, `storage/logs/`, `e2e/test-results` als Artefakt.

`e2e/ci.env`: Inhalt von `.env.example` mit `APP_ENV=e2e`, `APP_DEBUG=false`, `APP_URL=http://127.0.0.1:8000`, `DB_HOST=127.0.0.1`, `DB_DATABASE=werkbuch`, `MAIL_HOST=127.0.0.1`, `MAIL_PORT=1025`, `QUEUE_CONNECTION=sync`, `BROADCAST_CONNECTION=log`, `SCOUT_DRIVER=null`, `ADMIN_EMAIL=`, `ADMIN_PASSWORD=`.

`docs`: pnpm, Node, `pnpm install --frozen-lockfile`, `DOCS_BASE=/werkbuch/ pnpm --dir docs build`, Prüfung `test -f docs/.vitepress/dist/llms.txt`.

`clickdummy` (kein Pflicht-Check; ersetzt `clickdummy-e2e`): pnpm, Node, `pnpm install --frozen-lockfile`, `pnpm --filter werkbuch-clickdummy typecheck`, `… test`, `… build`, `pnpm --filter werkbuch-clickdummy exec playwright install --with-deps chromium`, `pnpm --filter werkbuch-clickdummy e2e`, bei Fehler Report als Artefakt.

- [ ] **Step 3: Dependabot**

`.github/dependabot.yml` wie openbill: `github-actions` (`/`, wöchentlich, eine Gruppe), `composer` (`/`, Gruppe minor/patch, Limit 5), `npm` mit `directories: ['/', '/e2e']` (Gruppe minor/patch, Limit 5); Docker-Images bewusst nicht (Digests).

- [ ] **Step 4: Prüfen**

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12 -color` (Colima)
Expected: keine Ausgabe, Exit 0. Endgültig prüft die CI am PR (alle vier Jobs grün).

- [ ] **Step 5: Commit**

Betreff: `ci: check the app in tests, run Playwright with merged coverage, build the docs and keep the clickdummy job`.

---

### Task 17: CLAUDE.md, README, Rulings

**Files:**
- Modify: `CLAUDE.md`, `README.md`
- Create: `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (falls nicht vorhanden)

**Interfaces:**
- Consumes: alles Vorige
- Produces: aktuelle Arbeitsanweisung für Phase 2.

- [ ] **Step 1: `CLAUDE.md` neu schneiden**

Abschnitte (Deutsch): „Was werkbuch ist“ (bleibt), „Stand“ (Phase 1 umgesetzt; Ablauf und Verweis auf Master-Plan und Phasenpläne), „Tech Stack“ (Werte aus „Paketversionen“), „Kommandos“ (alle `ddev …`-Kommandos dieses Plans, `pnpm --dir e2e …` auf dem Mac, Ports), „Regeln“ (bisherige plus: Actions-Regel, Domain ohne Laravel, i18n-Schlüsselschema und Port-Regel, Kürzel nur über `catalog.ts`, Abdeckung und Ausnahmen mit Grund, `allowBuilds`, Root-Abhängigkeiten im Container), „Architektur“ (Verträge aus dem Master-Plan, die es schon gibt: `Problem`, `config/werkbuch.php`, Shared Props, `http.ts`, `ApiError`/`Page`, `shellLayout`, `paths`), „Fallstricke“ mindestens: `ddev composer create-project` nicht benutzen; `public/hot` nach hartem Vite-Ende löschen; `ddev exec` mit Globs in einfache Quotes; Inertia-Tests verlangen die Seitendatei; Layouts als Pfeilfunktion; `phpunit.xml` erzwingt `testing`; Tailwind scannt nur `resources/`; dynamische Übersetzungsschlüssel findet der Test nicht; Cookie `locale` unverschlüsselt; nach einem Lauf von `pnpm --dir e2e test` ist der Abdeckungs-Build installiert (`ddev exec pnpm build` stellt den normalen her); Mutagen braucht `ddev mutagen sync`; `php artisan serve` liest nur `.env`; Login-Drosseln in e2e per `cache:clear`; Daemons warten auf `vendor/` und `.env`, Reverb braucht nach Codeänderungen `ddev restart`; der Klickdummy hat kein eigenes Lockfile mehr. Den Absatz zum Job `tests` auf den neuen Stand bringen (prüft die App; `clickdummy`, `e2e`, `docs` sind keine Pflicht-Checks).

- [ ] **Step 2: README**

Status-Zeile: „in development (phase 1 of 15: foundation)“, Link auf `docs/en/development.md` für den lokalen Start; sonst unverändert (Englisch).

- [ ] **Step 3: Rulings**

In `2026-10-30-werkbuch-app-rulings.md` (Kopf wie die Rulings des Klickdummys) als `A1` die Paketprüfung (Tabelle „Paketversionen“, Ergebnis: alle mit Laravel 13; Hinweise zu meilisearch-php 1.x, tiptap-php/shiki-php, laravel-permission v8) mit Grund und „Falls falsch“; die Entscheidungen unten mit Wirkung über Phase 1 hinaus (P4, P5, P6, P8, P10, P12) als `A2`–`A7` mit Verweis auf diesen Plan.

- [ ] **Step 4: Abnahme der Phase**

```bash
ddev start && ddev composer install && ddev exec pnpm install && ddev artisan migrate
ddev artisan test --coverage --min=100
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build
ddev exec pnpm --dir docs build
```

Expected: alles grün, PHP `Total: 100.0 %`, Frontend zusammengeführt 100 % Zeilen. Von Hand: Login mit dem Konto aus `app:ensure-admin` auf Englisch und (Cookie `locale=de` bzw. nach Sprachwechsel im Browser über das Cookie) auf Deutsch; `ddev exec pnpm dev` liefert HMR (eine Änderung an `MyItemsEmpty.tsx` erscheint ohne Neuladen).

- [ ] **Step 5: Commit**

Betreff: `docs: update CLAUDE.md, the README status and the rulings for phase 1`.

---

## Entscheidungen dieses Phasenplans

- **P1 Skeleton per `ddev exec composer create-project` in `tmp-laravel/` + `rsync`.** Grund: Der Master-Plan nennt `ddev composer create-project`; der DDEV-Wrapper verlangt aber ein leeres Root (openbill). Falls falsch: Ergebnis ist identisch, nur der Weg ändert sich.
- **P2 Meilisearch als eigene `.ddev/docker-compose.meilisearch.yaml`, gepinnt auf v1.56.0 mit Digest.** Grund: Es gibt kein offizielles `ddev/ddev-meilisearch`, nur Community-Add-ons; eigene Datei hält Version und Key gleich zu Compose (Phase 14). Falls falsch: `ddev add-on get kevinquillen/ddev-meilisearch` und Host/Key in `.env.example` anpassen.
- **P3 DDEV-Daemons warten auf `vendor/` und `.env`; lokal `queue:listen` statt `queue:work`; Reverb schon jetzt installiert, auf Port 6001, ohne Kanäle.** Grund: Ein frischer Klon startet ohne abstürzende Daemons, `listen` lädt geänderten Code ohne Neustart, der Master-Plan verlangt den Reverb-Daemon, und dessen Standardkanal passt nicht zu ULIDs. Falls falsch: `queue:work` mit `queue:restart`, Reverb-Daemon bis Phase 8 auskommentieren.
- **P4 Kein Sanctum in Phase 1; `http.ts` holt bei 419 einmal `/sanctum/csrf-cookie`.** Grund: Phase 1 hat keine API-Endpunkte; die Route kommt mit Sanctum in Phase 2 (Tokens). Falls falsch: Sanctum hier installieren und `statefulApi()` setzen.
- **P5 Fortify ohne `fortify:install`; Adapter in `app/Auth/`, Logik in `app/Actions/Auth/`.** Grund: `fortify:install` legt die 2FA-Migration (Phase 2) und `app/Actions/Fortify/*` ohne `handle()` an, was die Actions-Regel bricht. Falls falsch: in Phase 2 die 2FA-Spalten per eigener Migration ergänzen (so oder so).
- **P6 Actions dieser Phase ohne `Actor`.** Grund: Anmelden, Passwort setzen und das erste Konto laufen vor jeder Anmeldung; `Actor` kommt mit Phase 2, deren Architekturregel `App\Actions\Auth` ausnimmt. Falls falsch: Phase 2 ergänzt `Actor::system()` als ersten Parameter.
- **P7 Login-Drosselung zweistufig.** Fortifys `LoginRateLimiter` sperrt nach 5 Fehlversuchen je `lower(email)|IP` für 60 s (Spec 4.2 wörtlich); der Routen-Limiter `login` begrenzt jede IP auf 20 Versuche pro Minute (wie openbill `throttle:20,1`, `config('werkbuch.rate_limits.login_per_ip')`). Grund: Erfolgreiche Logins zählen sonst mit, und ohne IP-Grenze ließen sich beliebig viele Adressen probieren. Falls falsch: IP-Grenze in der Config ändern.
- **P8 „Passwort vergessen“ verrät nie, ob es ein Konto gibt; Links immer aus `APP_URL`; deaktivierte Konten bekommen keine Mail.** Grund: Laravel/Fortify melden unbekannte und gedrosselte Adressen unterscheidbar und bauen Links aus dem Host der Anfrage. Falls falsch: Rafael entscheidet für sichtbare Fehler; Tests in `PasswordResetTest` umdrehen.
- **P9 `app:ensure-admin` legt nur das allererste Personenkonto an.** Grund: Spec 8.2 „erstes Konto, nur beim ersten Start“; ein später geändertes `ADMIN_EMAIL` soll keinen zweiten Admin erzeugen. Falls falsch: wie openbill auch anlegen, wenn nur diese E-Mail fehlt.
- **P10 `users` in Phase 1 schon mit `type`, `handle`, `locale`, `timezone`, `disabled_at`; die Organisation in den Shared Props aus der Config.** Grund: Die erste Migration wird nicht mehr geändert, `SetLocale` und Login brauchen Sprache und Deaktivierung; die Tabelle `organization` kommt in Phase 2. Falls falsch: Phase 2 ergänzt per Migration.
- **P11 i18n mit Typen: `TranslationKey` aus `lang/en.json`, Vitest mit den deutschen Texten, keine JSON-Schlüssel in Framework-Gruppen, eigene Reset-Mail und veröffentlichte Mail-Views.** Grund: `tsc` prüft jeden statischen Schlüssel, portierte Tests behalten ihre Erwartungen, und Laravels Mail-Texte sind englische Satz-Schlüssel. Falls falsch: `t(key: string)` und nur der PHP-Scan.
- **P12 Kürzel-Katalog `lib/shortcuts/catalog.ts` neben dem portierten Register.** Grund: Hilfe, Doppel-Prüfung (R38) und die erzeugte Tastatur-Doku (Phase 6) brauchen eine statische Quelle; zur Laufzeit registrierte Kürzel kann ein Skript nicht lesen. Falls falsch: zurück zu frei registrierten `ShortcutDef`s, Phase 6 sammelt dann aus Laufzeit-Snapshots.
- **P13 Seitenleiste mit allen Links des Klickdummys, aber ohne Suche-Knopf, Zähler und „anlegen“-Links; `/my-items` zeigt den echten leeren Zustand.** Grund: Spätere Phasen ändern die Seitenleiste nicht mehr, nur Inhalte; ein Link auf eine Seite späterer Phasen zeigt ehrlich die 404-Seite. Falls falsch: Links bis zu ihrer Phase ausblenden.
- **P14 Port-Umfang: Galerie nicht portiert, `FavoriteStar` rein darstellend, `src/app` wird `resources/js/shell`, `types.ts` importiert `JSONContent` aus `@tiptap/core`.** Grund: Die Galerie bräuchte Felder späterer Phasen und eigene Abdeckung (der Klickdummy zeigt sie weiter); Daten-Hooks gehören nicht in `components/ui`; `resources/js/app/` neben `app.tsx` wäre verwirrend; Phase 1 braucht von Tiptap nur den Typ. Falls falsch: Galerie in Phase 4 unter `/_components` nur für `local`, Import in Phase 4 zurück auf `@tiptap/react`.
- **P15 Abdeckung: Vitest mit Istanbul und Schwellen je Ordner, zusammengeführt per `scripts/coverage-merge.mjs` mit Pfad-Normalisierung; der Merge läuft dort, wo Vitest lief (`E2E_EXEC`, lokal `ddev exec`).** Grund: Container-, Runner- und Mac-Pfade unterscheiden sich; `node_modules` im Root sind Linux-Binaries. Falls falsch: Merge auf dem Mac mit eigenen Abhängigkeiten in `e2e/`.
- **P16 e2e mit eigenen Personen (`E2eSeeder`), Texte aus `lang/*.json`, CI gegen `php artisan serve` mit `.env` aus `e2e/ci.env` und Mailpit-Service.** Grund: Reset-Tests brauchen je Projekt eine Person (Broker-Drossel 60 s), Texte ändern sich, `artisan serve` reicht Env-Variablen nicht durch. Falls falsch: Phase 14 stellt ohnehin auf den Compose-Stack um.
- **P17 Der Klickdummy zieht ins Root-Lockfile; seine Flows laufen nur noch in CI, lokal sein Dev-Server über DDEV (Port 5176).** Grund: Master-Plan (ein Workspace); die `node_modules` aus dem Container laufen nicht auf dem Mac. Falls falsch: `supportedArchitectures` mit `darwin` im Workspace ergänzen.
- **P18 Sitzung 7 Tage ohne „Angemeldet bleiben“; Web-Fehler als Inertia-Seiten; 419 und die IP-Drossel am Login als lesbare Meldung.** Grund: Der Klickdummy hat kein solches Häkchen und ein Alltagswerkzeug soll nicht alle zwei Stunden abmelden; Inertia zeigt Fehler sonst als HTML-Overlay. Falls falsch: `SESSION_LIFETIME` senken bzw. Laravels Fehlerseiten.
- **P19 `Problem` implementiert zusätzlich `HttpExceptionInterface`.** Grund: Der Vertrag nennt nur `extends RuntimeException`; ohne das Interface würde ein `Problem` auf einer Web-Route (z. B. Einladung annehmen, Phase 2) als 500 enden. Falls falsch: Web-Routen fangen `Problem` selbst ab.
