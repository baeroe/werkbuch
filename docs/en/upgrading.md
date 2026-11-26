# Upgrading

Make a [backup](/en/backup) first, then run next to `docker-compose.yml`:

```bash
docker compose pull && docker compose down && docker compose up -d
```

`down` stops every service before the new version starts, so werkbuch is offline for as long as the start takes; the volumes stay. Without `down`, `up -d` would create `werkbuch` anew first, and it migrates the database while the old workers keep running the old code against the new schema until Compose reaches them.

With the [standalone compose file](/en/setup#quick-start-paste-and-deploy) in Dockge or Portainer: stop the stack, then pull the image again and start it (Dockge: **Stop**, then **Update**; Portainer: stop the stack, then update it with the image pulled again).

On start the new version migrates the database, sends the settings of the search indexes to Meilisearch, fills the indexes again when this version adds fields to them, and builds its caches and the OpenAPI document; [Setup](/en/setup#start) lists every step. `docker compose restart` alone keeps the old image.

- **Pinned version:** change `WERKBUCH_IMAGE` in `.env` first (e.g. `baeroe/werkbuch:0.2.0`), or the `image:` line of the standalone compose file.
- **Compose file:** the notes below say when `docker-compose.yml` changed. Download it again and keep your own changes in `docker-compose.override.yml`:
  `curl -fsSLO https://raw.githubusercontent.com/baeroe/werkbuch/main/docker-compose.yml`
  With the standalone compose file, paste the new [docker-compose.standalone.yml](https://github.com/baeroe/werkbuch/blob/main/docker-compose.standalone.yml) and copy your values from the block at the top into it.
- **MariaDB:** patch versions upgrade themselves on start (`MARIADB_AUTO_UPGRADE`). A new major version only comes with a note here.
- **Meilisearch:** a new version of Meilisearch upgrades the database of the version before when it starts (`MEILI_UPGRADE_DB` in both compose files); the search keeps its index. Only if it cannot, it stops with an error about the version of its database (`docker compose logs meilisearch`), and `werkbuch` does not start. The index comes from the database, so delete it and let werkbuch build it again:

  ```bash
  docker compose rm -sf meilisearch
  docker volume rm werkbuch_meili-data     # <project>_meili-data, see docker volume ls
  docker compose up -d
  docker compose restart werkbuch
  ```

  The start of `werkbuch` finds the index empty and imports everything; until then the search is empty. `up -d` alone does not start a `werkbuch` that is still running (going back to the older Meilisearch, for example), hence the `restart`. Once upgraded, an older Meilisearch no longer reads the database; going back only works with the same steps.
- **Going back:** migrations are not rolled back. Restore the backup and pin the old version.

All versions and their changes: https://github.com/baeroe/werkbuch/releases

## Notes per version

<!-- absolute links only: each section becomes the notes of its GitHub release -->

### 0.4.0

- **Agents:** a bot can work on items by itself. Assign it an item, and a runner implements it, opens a pull request, lets CI and an independent review run, fixes what they find, and werkbuch merges once CI is green and the review has no findings. Conflicts with the base branch get a run of their own, brakes (3 corrections, 2 conflicts) pause a strand before it burns tokens without end, an epic is worked on one branch with one pull request, and a bot mentioned in a comment answers from the wiki, the items and the code. Agents need the four steps of the agents in the workflow of the project (In progress, In review, Correction, Merged) to work on items; answering a mention needs none of them. When a bot set up as an agent cannot answer a mention (agent off, no responsible person, deactivated, may not edit items of the project), the default bot says why in a comment at the item, with who changes it ([Mentions](https://werkbuch.dev/en/concepts/agents#mentions)). See [Agents](https://werkbuch.dev/en/concepts/agents).
- **Runner:** `werkbuch-runner` runs on a Mac or a Linux machine of yours with Claude Code or Codex and only ever calls your instance. The instance hands it out itself: **Settings → Runners → Connect a runner** shows a command with `/runner/install.sh` and a one-time code that installs it, pairs it and starts it as a service of its user; it updates itself to the version of the instance. Without a command it opens a terminal UI with status, the runs and their live log, and the doctor. See [Runner](https://werkbuch.dev/en/runner).
- **GitHub:** one private GitHub app per GitHub account (your own, an organization, or several), created from **Settings → GitHub** (**Add another app** for each further account, see [One app per account](https://werkbuch.dev/en/github#one-app-per-account)) and installed on the repos the agents shall work on; each project picks its repo, base branch and merge method under **Project settings → Agents**. werkbuch hears pushes, pull requests and checks through the webhook of the apps and pauses the agents of a project when its base branch gets a merge werkbuch did not make. **Disconnect** works per app and leaves the other apps and their projects alone ([Disconnect](https://werkbuch.dev/en/github#disconnect)). See [GitHub](https://werkbuch.dev/en/github).
- **Pull requests at items:** a pull request in the repo of a project links to the items it names in its branch name, title or description; `Fixes <KEY>` and the other closing words close the item on merge, `skip` takes a link back. An open pull request moves its items to In review, the merge moves them to Merged. The item shows its pull requests with their checks and the verdict of the review.
- **Interface:** settings for runners, GitHub, bots as agents (runner pool, CLI, models), working rules for the prompts, guidance per type, and per project the repo, the review agent and the brakes; at the item, each run in the activity with its live log, cancel and start again, and a notice when the agent needs a person. Over REST and MCP: runners, runs and agents (`agents`, `manage-agents`).
- **Activity:** the activity of an item shows the newest first, with the comment field on top; a new comment stands right under it. What others write or change meanwhile comes in on top, and the line you read stays where it is ([History](https://werkbuch.dev/en/concepts/work-items#history)).
- **References in the editor:** references to items and pages are links while you edit a text, too: a click opens an item in the preview or a page as the page, with `ctrl` or `cmd` in a new tab; the arrow keys select a reference and `enter` opens it. While reading, a click on an item reference now opens the preview as well. See [References](https://werkbuch.dev/en/concepts/rich-text#references).
- **Update:** the database migrates on start. The compose files and `.env.docker.example` did not change: update as described in [Upgrading](https://werkbuch.dev/en/upgrading). `0.4.0-rc.4` is a pre-release and `latest` stays on 0.3.2: to try it, set `WERKBUCH_IMAGE=baeroe/werkbuch:0.4.0-rc.4` in `.env` (in the standalone compose file the line `image:`).
- **Coming from 0.4.0-rc.3:** agents read the item, its comments and the pictures in them by themselves before any work: the run names the calls of `werkbuch-run` word for word, and if reading fails, the agent stops instead of guessing from the title and the code (with rc.3 runs often worked without the description). Pictures come from the MCP tool `attachments` with `action: content` (PNG, JPEG, GIF and WebP up to 3.75 MB); a call of `attachments` without `action` reads as before. Align working rules of your own that read the item another way with the run ([Prompt and rules](https://werkbuch.dev/en/concepts/agents#prompt-and-rules)). For agents to test, a project needs a setup command that prepares the environment per worktree ([Runner](https://werkbuch.dev/en/runner)).
- **Coming from 0.4.0-rc.2:** with rc.2 every code run failed at once: the runner refused GitHub's new installation tokens (with dots). rc.3 takes them and blanks them whole in logs. Runners update themselves to the version of the instance, there is nothing to do. Connecting GitHub now waits up to 30 seconds for GitHub to turn the code into the app; if GitHub does not answer, werkbuch says so and links the list of the apps of the account, in case GitHub created one anyway ([Troubleshooting](https://werkbuch.dev/en/github#troubleshooting)). A proxy that waits 60 seconds for an answer (the default of nginx) is enough ([Runners and GitHub](https://werkbuch.dev/en/reverse-proxy#runners-and-github)).
- **Coming from 0.4.0-rc.1:** connecting GitHub works now (rc.1 failed at GitHub with 422 because werkbuch sent an empty JSON array as body). REST and MCP changed with the apps per account: `DELETE /api/v1/github` is now `DELETE /api/v1/github/apps/{id}`, `GET /api/v1/github` and `agents:get-github` answer `apps` (each with its `installations`) instead of `app` and `installations`, and `POST /api/v1/github/manifest` takes `owner` and `owner_type` (`User` or `Organization`) instead of `organization`.
- **Outgoing connections:** with GitHub connected, `queue` and `werkbuch` call `api.github.com:443`, and GitHub delivers its webhooks to `POST /github/webhook`, which has to be reachable from the internet over HTTPS ([GitHub](https://werkbuch.dev/en/github#the-webhook-behind-the-proxy)). Runners download the runner from your instance and need outgoing HTTPS to it and, for projects with a repo, to `github.com` (besides what Claude Code or Codex need themselves), but no open port. See [Operations](https://werkbuch.dev/en/operations#runners-and-github).
- Image `baeroe/werkbuch:0.4.0-rc.4` for `linux/amd64` and `linux/arm64`.

### 0.3.2

- **Rich text:** long references to wiki pages and file chips wrap like text instead of running out of comments and descriptions; the icon stays with the first word. A selected image or file chip shows its selection frame while editing, never while reading.
- **API and MCP:** a project names its types with `include=types` (`GET /api/v1/projects`, `GET /api/v1/projects/{project}`; over MCP `projects` with `include: ["types"]`): each type switched on in the project with its name, `is_epic` and required properties, so an agent finds the epic type of an empty project. `GET /api/v1/projects/{project}` now refuses an unknown `include` with 422 (before, `include=members` there was silently ignored; the list keeps `include=members`).
- The compose files did not change: update as described in [Upgrading](https://werkbuch.dev/en/upgrading).
- Image `baeroe/werkbuch:0.3.2` for `linux/amd64` and `linux/arm64`.

### 0.3.1

- **Projects:** items, wiki, templates and settings of a project share one header in the same place: the project badge, the project and the part, the tabs below it. The settings of a project no longer stand centred and narrower; their header and tabs span the width like the other parts, only the sections and the form keep their width.
- **Security:** the image is built on `serversideup/php` v5.1.5 (was v5.0.4): PHP 8.4.28 with the fixes for PHP-FPM and sessions, nginx 1.30.7, and PHP-FPM runs only files that exist and end in `.php`. The image also answers `/index.php/…` with 404 instead of redirecting it, which closes an open redirect of the base image.
- The compose files did not change: update as described in [Upgrading](https://werkbuch.dev/en/upgrading).
- Image `baeroe/werkbuch:0.3.1` for `linux/amd64` and `linux/arm64`.

### 0.3.0

- **Projects:** the name of a starred project in the sidebar opens its items, the arrow beside it unfolds its parts. The settings of a project are reachable without the sidebar: a fourth tab **Settings** below the header of its items, wiki, templates and settings, a link on every project card, and **Open project settings …** in the command palette.
- **Comments** take tables too, from the `/` menu and with the menu of the table (`alt+F10`), like descriptions and wiki pages.
- The compose files did not change: update as described in [Upgrading](https://werkbuch.dev/en/upgrading).
- Image `baeroe/werkbuch:0.3.0` for `linux/amd64` and `linux/arm64`.

### 0.2.0

- **The compose file changed:** a new service `gotenberg` ([Gotenberg](https://gotenberg.dev) 8.37) turns wiki pages into PDFs. Download `docker-compose.yml` again (or paste the new standalone file and copy your values into it), then update as described in [Upgrading](https://werkbuch.dev/en/upgrading). Without the service werkbuch runs as before, only the PDF button stays disabled. See [Operations](https://werkbuch.dev/en/operations#pdf).
- **Wiki:** download a page, or a page with its subpages, as PDF. The tree starts folded and remembers what you opened, per person and project.
- **Projects:** the wiki and the templates of a project are reachable without a star: tabs above the items, wiki and templates, links on every project card, and **Open wiki …** and **Open templates …** in the command palette.
- **Properties:** every property shows either in the side panel or below the description of an item, set per property in its settings. Rich text properties, the existing ones too, go below the description by default.
- **Editor:** descriptions take tables from the `/` menu; a wide table scrolls inside its frame. Images in a text open large on a click (or Enter in an editor), with **Actual size**, **Open original**, **Download** and `←`/`→` through the images of the same text; a selected image has an **Image** menu (`alt+F10`).
- **Search:** Meilisearch 1.56.1. It upgrades the database of the version before by itself (`MEILI_UPGRADE_DB` in both compose files).
- Image `baeroe/werkbuch:0.2.0` for `linux/amd64` and `linux/arm64`.

### 0.1.0

- First release: projects with members, work items with your own types, properties and workflows, list, board, table and timeline, saved views, a wiki per project, templates with schedules, automations, notifications with mail and live updates, search, a REST API with its OpenAPI reference, an MCP server for AI agents and signed webhooks, in English and German.
- Image `baeroe/werkbuch:0.1.0` for `linux/amd64` and `linux/arm64`. Runs as a Docker Compose stack with MariaDB 11.4 and Meilisearch 1.56, see [Setup](https://github.com/baeroe/werkbuch/blob/main/docs/en/setup.md).
