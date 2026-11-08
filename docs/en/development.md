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

Three queue workers, the scheduler and Reverb run as DDEV daemons and start with `ddev start`. The worker `queue` takes the queues in this order: `mail` (invitation and password reset mails, ahead of everything so nobody waits for them), `default` (handing every event to its consumers), `live` (live updates through Reverb), `notifications` (the inbox, notification mails, reminders) and `bulk` (deleting projects). The worker `queue-webhooks` takes `webhooks` alone: a receiver that hangs holds its worker up to about 17 seconds per attempt. The worker `queue-index` takes `search` (keeps the search indexes in step with every change) and `media` (previews of uploaded images, `MEDIA_QUEUE` in `.env`). `queue:listen` starts PHP anew for every job and always takes the first queue that has a job, and every event makes jobs for `default`, `live` and `notifications`: behind them search results and previews came minutes late, so they have a worker of their own. The order of all queues is `config('werkbuch.queues')`. The Meilisearch dashboard asks for the key `MEILISEARCH_KEY` from `.env`.

The scheduler runs `app:redispatch-events` and `app:send-notification-mails` every minute, and every hour it clears uploads nobody took, sends the reminders for everyone for whom it is now 08:00, and prunes old notifications (all in `routes/console.php`).

Every mail of the app lands in Mailpit (`ddev mailpit`): password resets, invitations and notification mails. Notification mails are collected per person and item for `NOTIFICATION_MAIL_DELAY` minutes (5 in `.env.example`); `ddev artisan app:send-notification-mails --now` sends everything that is open right away. With `MAIL_MAILER=log` or `array`, werkbuch counts as having no mail server: there are no notification mails at all, only the inbox.

Reverb serves the live updates on port 6001 (`REVERB_*` in `.env`; the browser gets host, port and scheme at runtime, there are no `VITE_REVERB_*` variables). Reverb reads the code only at its start: after changing a channel or the live consumer, run `ddev restart`. Without Reverb (`BROADCAST_CONNECTION=null`), nothing connects and lists update when they load next. More under [Notifications](/en/concepts/notifications#live-updates).

Uploaded files land on the private disk `local` (`storage/app/private`), never in `public/`. One file may be at most `ATTACHMENTS_MAX_MB` (25 MB by default). PHP has its own limits in front of that, `upload_max_filesize` and `post_max_size`; they must be above `ATTACHMENTS_MAX_MB`, otherwise PHP drops a large file before werkbuch can name the limit. DDEV allows 100 MB, the CI sets 30 MB and 32 MB. A file over either limit is a `413` with `reason: payload_too_large`. More under [rich text](/en/concepts/rich-text#images-and-files).

Webhooks go out on the queue `webhooks` of the worker `queue-webhooks`. `.ddev/config.yaml` sets `WEBHOOKS_ALLOW_PRIVATE=true` (`web_environment`), so a webhook may point at a receiver in the private network or on your machine. DDEV hands that to PHP as a real environment variable, which `.env` never overrides: to try the block of private networks, change the line in `.ddev/config.yaml` and run `ddev restart`; the tests force it off themselves. A receiver on your Mac that listens on `127.0.0.1` is reached from the container as `http://host.docker.internal:<port>/` (checked with `ddev exec curl http://host.docker.internal:<port>/hook`); listen on the loopback, not on `0.0.0.0`, or the macOS firewall asks and the port is open to the network. The e2e specs start such a receiver themselves (`e2e/webhookReceiver.ts`, `E2E_WEBHOOK_HOST`). The demo webhooks of the `DemoSeeder` fire in DDEV too, at hosts that do not exist; after a day with events the system switches "Deploy-Bot" off and tells the org admins, as in the clickable prototype. `ddev artisan migrate:fresh --seed --seeder=DemoSeeder` brings them back, and the e2e seeder switches them off. More under [webhooks](/en/webhooks).

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

In CI, the suite runs in three jobs, none of them a required check. `e2e-build` builds the instrumented frontend once (`pnpm build:coverage`) and runs Vitest with coverage. `e2e (<project>)` runs the suite once per Playwright project (`desktop-light`, `desktop-dark`, `phone-light`, `phone-dark`), the four in parallel. Each one serves that build with `php artisan serve` and has its own MariaDB, Meilisearch and Mailpit as services, Reverb on port 8080 (`e2e/ci.env`) and three workers, one on `mail,default,live,notifications,bulk`, one on `search,media` and one on `webhooks`. Live specs need Reverb and the queue `live`; without them, the banner "Live updates paused" shows and the specs wait in vain. A project job runs `--project=setup --project=<project>` with `E2E_MERGE=0`, maps its coverage back with `--remap-only` and uploads only that file as `e2e-coverage-<project>`, also after failed tests. `e2e-coverage` merges Vitest and the four files with `--expect-shards=desktop-light,desktop-dark,phone-light,phone-dark` and uploads the report as `frontend-coverage`. It fails below 100 % lines, when a project left no coverage, and in its last step whenever a project job failed: the coverage can reach 100 % while tests fail.

The frontend must be covered to 100 % lines by Vitest and Playwright together. After the Playwright run, `coverage:merge` fails below that. Run `ddev exec pnpm build` afterwards to leave an uninstrumented build behind.

Playwright keeps its coverage per project: the fixture writes `coverage/e2e/<project>/<test>-<n>.json`, and `coverage:merge` reads every file below `coverage/e2e`, at any depth. The 100 % hold for the sum of Vitest and all four projects only. No project gets there alone (the drawer of the phone, the dark theme, the touch menus), so a single project has no gate of its own. At the start of every run, `globalSetup` empties `coverage/e2e`, the folders of the projects the run leaves out (`--project=desktop-light`) included. That is on purpose: a partial run is never the sum, and the leftovers of an earlier run would make it look like one.

For a CI job per project, the merge has two options:

```bash
E2E_MERGE=0 pnpm --dir e2e test                # leaves coverage/e2e/<project>/ unmerged
node scripts/coverage-merge.mjs --remap-only --out coverage/e2e-<project>.json
node scripts/coverage-merge.mjs --expect-shards=desktop-light,desktop-dark,phone-light,phone-dark
```

`--remap-only` maps every file below `coverage/e2e` back to the sources once and writes them as one file, with no report and no gate. A full project leaves well over a thousand files of about 2 MB; mapped, they come to about 4 MB. The hits add up the same before and after the mapping, because every project runs the same build with the same source maps. `--expect-shards` reads exactly the projects it names, each from `coverage/e2e/<name>.json`, `coverage/e2e/<name>/` or `coverage/e2e/<prefix>-<name>/` (the folder `actions/download-artifact` makes of the artifact `e2e-coverage-<name>`). It fails naming every project without coverage, with an empty folder or with two such sources.

### Load tests

The suite `Load` (`tests/Load`) measures the API against 50 000 items. It has its own configuration `phpunit.load.xml` and its own database `load`, which DDEV creates on start next to `testing`; it is neither part of `phpunit.xml` nor of the coverage.

```bash
ddev exec vendor/bin/pest --configuration=phpunit.load.xml                  # the whole suite
ddev exec vendor/bin/pest --configuration=phpunit.load.xml --filter=SeedLoad # only the data
```

Call Pest directly: `ddev artisan test` puts `--configuration=phpunit.xml` in front of yours, PHPUnit warns that the option came twice and ends with exit code 1, even when every test passes.

`phpunit.load.xml` forces every value, the database `load` and the search prefix `load_` among them, because the environment of DDEV would win otherwise. `Tests\Load\LoadWorld::ensure()` checks both before its first statement and refuses anything else. It then runs `migrate --force`, so a seeded database gets new migrations, and seeds anew (`migrate:fresh` and `Database\Seeders\LoadSeeder`) when the table `load_meta` lacks the version of the seeder or its numbers. Every change to the seeder raises `LoadSeeder::VERSION`.

The seeder writes the demo catalog, 30 people `load-NN@example.com` (`load-01` is the org admin, password `werkbuch-load`), 5 bots, 20 projects `L01` to `L20` with 2 500 items each and their history (about 266 000 events), 5 000 relations, 100 000 comments (one item per project with 40), 2 000 wiki pages in `L01` four levels deep, 200 templates (50 come due in the same minute) and 50 switched-off webhooks. The first epic of every project has the 40 items after it as children, 12 fixed relations and three files. It writes in bulk without the app's events and takes its texts from a fixed pool of Tiptap JSON, never from Markdown. Then it builds the search index (`load_work_items` and the others) anew. In DDEV the first run takes about a minute (23 s for the rows, 33 s for the search index); the database comes to about 580 MB (the events about 210 MB). Later runs reuse it.

`tests/Load/ApiLoadTest.php` measures the answers of the browser against these data: the first page of the item list in every sort and both directions, the list of a project, every grouping over all projects and in one, ten counts, the board of a project, an epic with everything it can include, the comments and the history of an item, the search, the projects and the wiki. A few rows read as a member instead of the org admin. Each row runs once to warm up, then three times, and before every run the app forgets its scoped instances and the visibility (`Tests\Load\Support\Budget`). The budget is 1.5 seconds per answer for the median of the three runs. Every run has to answer 200. The number of queries is the hard check, in two ways. In every run it has to be the same as in a small world, the same requests in a transaction (rolled back) that keeps only the first 100 items of every project and the top pages of the wiki: no query grows with the data outside the answer. Where an answer is as big in both worlds (a page of items, comments, history or projects, the board, the epic with its children, relations and files), a smaller answer in the big world has to ask as often: a page of 25 instead of 100 (5 or 2 projects), the epic with 10 of its 40 children, three relations and one file fewer. So none of these answers asks the database once more per item, comment, event, project, child, relation or file. The groupings and the counts have no smaller answer: their groups are the same in both worlds (only the grouping by parent grows, 2 500 epics against 100) and the counts ask once per filter on purpose, so a query per group or per filter is left to the feature tests. The search compares itself with a search of 50 hits per kind, the wiki its 2 000 pages with 20. Not measured, and the same for every row: the suite keeps the session and the counters of the rate limit in memory and acts with one account object for every run; a request in production reads them, a few queries and milliseconds more.

`tests/Load/SearchLoadTest.php` measures the search the palette asks 150 ms after the last key, so with a budget of its own, 0.5 seconds for the median: one, two and three words, all kinds and only items, as the org admin (20 projects) and as a person who sees one project (in a transaction that is rolled back). It also checks the document of the item with 40 comments against the limit of its comment text, and rebuilds every index at the end: within five minutes until Meilisearch holds every document, with at most 512 MB of PHP. The rebuild empties the indexes on the way, so it runs last.

At the end the suite prints a table of every row (median, the three runs, the queries, the queries against 100 items and for the smaller answer) and writes it to `storage/logs/load-budget.md`. A row the constant `OVER_BUDGET` in `ApiLoadTest` names (`'<row>' => 'Task <n>: <reason>'`) still runs and shows up in the table; only its median is not checked, its queries are. A test makes sure the constant names only rows that exist.

In GitHub Actions the job `load` runs the suite next to `tests` on every pull request, with its own MariaDB (database `load`) and Meilisearch. It is no required check; the table is the artifact `load-budget`. Before the suite, the job sets the buffer pool of its MariaDB to 1 GiB (`SET GLOBAL innodb_buffer_pool_size`), as DDEV has it; the image's 128 MiB would not hold the 580 MB of data. Its runner is still slower than DDEV, so a median close to the budget there is worth a look.

Never run the load suite at the same time as the other tests or the browser tests: they share MariaDB, Meilisearch and the CPU of the VM, and the measurements would be off.

## Lost password

If nobody can sign in any more, set a new password from the command line. The command asks for it and ends all sessions of the account:

```bash
ddev artisan app:reset-password you@example.com
```

Without a terminal it reads the first line of STDIN instead.

Lost the authenticator app and the recovery codes? `ddev artisan app:reset-two-factor you@example.com` turns the second factor of the account off and ends its sessions; afterwards the password alone signs in, and the second factor can be set up again in the settings.

## MCP locally

The MCP server runs at `https://werkbuch.ddev.site/mcp`. Create a token with `mcp`, `read` and `write` under **Personal settings → API & MCP** and try it with `curl`, without an MCP client:

```bash
curl https://werkbuch.ddev.site/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
```

`tools/call` works the same way (`"params": {"name": "whoami", "arguments": {}}`). The snippet for Claude Code from the token dialog connects a real client. Do not use `php artisan mcp:inspector`: it starts the inspector through `npx`, and this project uses pnpm only. Requests count against `MCP_RATE_LIMIT` (300 a minute per token in `.env.example`). More under [MCP](/en/mcp).

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

## Docker image

The image of [Setup](/en/setup) is built from the `Dockerfile` in the root of the repository: the frontend with Vite in a Node stage, then PHP-FPM and nginx on `serversideup/php`. To try a change of the image, the compose files or the entrypoint, build it and run the smoke test against it, on your machine with Docker (Colima, for example) and never while the Playwright suite runs:

```bash
docker buildx build --load -t werkbuch:local .
WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh
```

`scripts/compose-smoke.sh` starts `docker-compose.yml` with a fresh `.env` in a temporary folder, signs in, checks the live updates over the one port, the search, the limits, the rights inside the containers and the access log, starts the same volumes a second time and removes the stack with its volumes at the end; the last line is `smoke: ok`. `SMOKE_KEEP=1` keeps the stack, `SMOKE_PORT` sets the port on `127.0.0.1` (default `7740`). The CI job `image` runs the same on `amd64` and `arm64`.

## Documentation

These docs live in `docs/` (VitePress) in English (`docs/en/`) and German (`docs/de/`). Every page exists in both languages under the same file name and with the same headings; `tests/Unit/DocsTest.php` checks that. The specs and plans in `docs/superpowers/` are not part of the site.

```bash
ddev exec pnpm --dir docs dev       # https://werkbuch.ddev.site:5174/en/
ddev exec pnpm --dir docs build     # the site in docs/.vitepress/dist
```
