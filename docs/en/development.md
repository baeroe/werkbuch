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
ddev artisan app:search-import                # builds the search indexes in Meilisearch
ddev artisan app:ensure-admin                 # creates the account from ADMIN_EMAIL / ADMIN_PASSWORD in .env
ddev artisan db:seed --class=DemoSeeder       # optional: the fictional team Feldwerk (builds the search indexes again at the end)
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

Two queue workers, the scheduler and Reverb run as DDEV daemons and start with `ddev start`. The worker `queue` takes the queues in this order: `default` (handing every event to its consumers), `live` (live updates through Reverb), `notifications` (the inbox, notification mails, reminders, password reset and invitation mails), `webhooks` and `bulk` (deleting projects). The worker `queue-index` takes `search` (keeps the search indexes in step with every change) and `media` (previews of uploaded images, `MEDIA_QUEUE` in `.env`). `queue:listen` starts PHP anew for every job and always takes the first queue that has a job, and every event makes jobs for `default`, `live` and `notifications`: behind them search results and previews came minutes late, so they have a worker of their own. The order of all queues is `config('werkbuch.queues')`. The Meilisearch dashboard asks for the key `MEILISEARCH_KEY` from `.env`.

The scheduler runs `app:redispatch-events` and `app:send-notification-mails` every minute, and every hour it clears uploads nobody took, sends the reminders for everyone for whom it is now 08:00, and prunes old notifications (all in `routes/console.php`).

Every mail of the app lands in Mailpit (`ddev mailpit`): password resets, invitations and notification mails. Notification mails are collected per person and item for `NOTIFICATION_MAIL_DELAY` minutes (5 in `.env.example`); `ddev artisan app:send-notification-mails --now` sends everything that is open right away. With `MAIL_MAILER=log` or `array`, werkbuch counts as having no mail server: there are no notification mails at all, only the inbox.

Reverb serves the live updates on port 6001 (`REVERB_*` in `.env`; the browser gets host, port and scheme at runtime, there are no `VITE_REVERB_*` variables). Reverb reads the code only at its start: after changing a channel or the live consumer, run `ddev restart`. Without Reverb (`BROADCAST_CONNECTION=null`), nothing connects and lists update when they load next. More under [Notifications](/en/concepts/notifications#live-updates).

Uploaded files land on the private disk `local` (`storage/app/private`), never in `public/`. One file may be at most `ATTACHMENTS_MAX_MB` (25 MB by default). PHP has its own limits in front of that, `upload_max_filesize` and `post_max_size`; they must be above `ATTACHMENTS_MAX_MB`, otherwise PHP drops a large file before werkbuch can name the limit. DDEV allows 100 MB, the CI sets 30 MB and 32 MB. A file over either limit is a `413` with `reason: payload_too_large`. More under [rich text](/en/concepts/rich-text#images-and-files).

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

Tests use their own database `testing`, which DDEV creates on start. The tests in `tests/Integration` also need Meilisearch running (`ddev describe` lists the service `meilisearch`); they use the index prefix `testing_` and never touch the indexes of the app. All other tests search a fake engine in memory. `ddev exec` passes its arguments through a shell: wrap commands with glob patterns in single quotes.

### Browser tests and merged coverage

The Playwright suite in `e2e/` runs on your machine against the DDEV site, because the browsers are native binaries and the `node_modules` of the app belong to the container. `e2e/` is a pnpm project of its own.

```bash
pnpm --dir e2e install                       # once, on the host
pnpm --dir e2e exec playwright install chromium
ddev exec pnpm build:coverage                # instrumented frontend build (stop `pnpm dev` first)
pnpm --dir e2e test                          # seeds the e2e data, then runs the tests
ddev exec pnpm coverage:merge                # Vitest and Playwright together: 100 % lines over resources/js
```

The CI job `e2e` runs the same suite against `php artisan serve` with MariaDB, Meilisearch and Mailpit as services, Reverb on port 8080 (`e2e/ci.env`) and two workers, one on `default,live,notifications,bulk` and one on `search,media`. Live specs need Reverb and the queue `live`; without them, the banner "Live updates paused" shows and the specs wait in vain.

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
ddev artisan app:send-notification-mails   # queues collected notification mails that have no job; --now sends all open ones at once
ddev artisan app:search-sync           # sends the settings of the search indexes (config/scout.php) to Meilisearch
ddev artisan app:search-import         # empties the search indexes and fills them again from the database
ddev artisan app:prune-attachments --dry-run --min-age=30   # lists pictures and files no text names any more
```

`app:sync-roles` is what the migration of the roles runs; call it by hand only after a rights table in the code changed without a migration. `app:redispatch-events` runs every minute in the scheduler, so you only need it by hand to catch up after the scheduler was down.

`app:send-notification-mails` runs every minute as well: it hands collected mails that are due and lost their job to the queue again, once no try ran for 35 minutes. With `--now` it sends every open collection in its own process, due or not; use it before maintenance, or locally instead of waiting five minutes.

`app:search-sync` is needed after a change of the index settings in `config/scout.php`. `app:search-import` builds the indexes from scratch: on the first start, after `migrate:fresh`, and as the repair when the search missed changes (for example after Meilisearch was down for hours). During the import the search is briefly empty. More under [Search](/en/search#operation).

Pictures and files pasted into a text stay when the text loses them, so that the history and undo keep working. `app:prune-attachments` removes those that no current text of their project names any more (the description or a rich text value of an item, the text of a comment) and that are older than `--min-age` days (default 30); `--dry-run` only lists them, each with project, id, file name and size, and sums them up. Pictures that only an older version of a text in the history shows go too, so pick the minimum age with that in mind. Files of the file list of an item are never pruned; they are deleted there. The command also removes folders on the media disk whose media row is gone (a preview made while its picture was being deleted), when all their files are older than the minimum age. A project with a text that cannot be read is skipped (`skipped WEB: unreadable text of …`, also in the log) and nothing of it is removed; the other projects still get their turn. Uploads that no text ever took (a picture pasted into a comment that was never sent) go by themselves: a job of the scheduler removes them every hour once they are older than 24 hours. Deleting an item removes the files of the item and of its comments, deleting a comment its files, deleting a project all files of the project. A picture that another text of the project still shows (copied from one text into another) stays: it then belongs to that text.

## Documentation

These docs live in `docs/` (VitePress) in English (`docs/en/`) and German (`docs/de/`). Every page exists in both languages under the same file name and with the same headings; `tests/Unit/DocsTest.php` checks that. The specs and plans in `docs/superpowers/` are not part of the site.

```bash
ddev exec pnpm --dir docs dev       # https://werkbuch.ddev.site:5174/en/
ddev exec pnpm --dir docs build     # the site in docs/.vitepress/dist
```
