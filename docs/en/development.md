# Development

werkbuch runs locally in [DDEV](https://ddev.com): PHP 8.4, MariaDB 11.4, Meilisearch, Node 24 with pnpm, Vite with hot reload and Mailpit. You don't need PHP, Composer or Node on your machine, apart from the Playwright suite (see below). All commands go through `ddev`, and JavaScript packages are managed with pnpm only, never npm.

## Requirements

- DDEV 1.25 or newer with a Docker provider (for example Colima)
- Git
- Node 24 on the host, for the Playwright suite in `e2e/` only (for example via mise)

## First start

```bash
git clone https://github.com/baeroe/werkbuch.git
cd werkbuch
cp .env.example .env
ddev start
ddev composer install
ddev exec pnpm install
ddev artisan key:generate
ddev artisan migrate
ddev artisan app:ensure-admin                 # creates the account from ADMIN_EMAIL / ADMIN_PASSWORD in .env
ddev artisan db:seed --class=DemoSeeder       # optional: the fictional team Feldwerk
```

Start the Vite dev server and keep it running:

```bash
ddev exec pnpm dev
```

Open <https://werkbuch.ddev.site/login> and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env` (`admin@example.com` and `password` in `.env.example`). The demo people use `<handle>@feldwerk.example.com` with the password `werkbuch-demo`.

## Services

| What | Where |
|---|---|
| App | `https://werkbuch.ddev.site` |
| Vite dev server | `https://werkbuch.ddev.site:5173` |
| These docs | `ddev exec pnpm --dir docs dev` → `https://werkbuch.ddev.site:5174/en/` |
| Clickable prototype | `ddev exec pnpm clickdummy` → `https://werkbuch.ddev.site:5176` |
| Reverb (WebSockets) | `https://werkbuch.ddev.site:6001` |
| Meilisearch | `https://werkbuch.ddev.site:7701` |
| Mail | `ddev mailpit` |
| Database | `ddev mysql`, user, password and database `db` |

The queue worker, the scheduler and Reverb run as DDEV daemons and start with `ddev start`.

## Tests and checks

Every check runs inside DDEV, so the versions match the CI.

```bash
ddev artisan test --coverage --min=100                    # Pest, 100 % line coverage (PCOV)
ddev artisan test --filter=LoginTest               # one file or test
ddev exec vendor/bin/phpstan analyse --memory-limit=1G    # Larastan, level 8
ddev exec vendor/bin/pint                                 # format PHP
ddev exec pnpm typecheck                                  # tsc
ddev exec pnpm test:coverage                              # Vitest with thresholds per folder; 100 % lines only together with Playwright
ddev exec pnpm --dir docs build                           # these docs
```

Tests use their own database `testing`, which DDEV creates on start. `ddev exec` passes its arguments through a shell: wrap commands with glob patterns in single quotes.

### Browser tests and merged coverage

The Playwright suite in `e2e/` runs on your machine against the DDEV site, because the browsers are native binaries and the `node_modules` of the app belong to the container. `e2e/` is a pnpm project of its own.

```bash
pnpm --dir e2e install                       # once, on the host
pnpm --dir e2e exec playwright install chromium
ddev exec pnpm build:coverage                # instrumented frontend build (stop `pnpm dev` first)
pnpm --dir e2e test                          # seeds the e2e data, then runs the tests
ddev exec pnpm coverage:merge                # Vitest and Playwright together: 100 % lines over resources/js
```

The frontend must be covered to 100 % lines by Vitest and Playwright together. After the Playwright run, `coverage:merge` fails below that. Run `ddev exec pnpm build` afterwards to leave an uninstrumented build behind.

## Lost password

If nobody can sign in any more, set a new password from the command line. The command asks for it and ends all sessions of the account:

```bash
ddev artisan app:reset-password you@example.com
```

Without a terminal it reads the first line of STDIN instead.

Lost the authenticator app and the recovery codes? `ddev artisan app:reset-two-factor you@example.com` turns the second factor of the account off and ends its sessions; afterwards the password alone signs in, and the second factor can be set up again in the settings.

## Maintenance commands

```bash
ddev artisan app:sync-roles            # compares the roles and rights in the database with the code
ddev artisan app:redispatch-events     # hands events that got stuck to their consumers again
```

`app:sync-roles` is what the migration of the roles runs; call it by hand only after a rights table in the code changed without a migration. `app:redispatch-events` runs every minute in the scheduler, so you only need it by hand to catch up after the scheduler was down.

## Documentation

These docs live in `docs/` (VitePress) in English (`docs/en/`) and German (`docs/de/`). Every page exists in both languages under the same file name and with the same headings; `tests/Unit/DocsTest.php` checks that. The specs and plans in `docs/superpowers/` are not part of the site.

```bash
ddev exec pnpm --dir docs dev       # https://werkbuch.ddev.site:5174/en/
ddev exec pnpm --dir docs build     # the site in docs/.vitepress/dist
```
