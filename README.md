# werkbuch

Open, self-hosted project management for teams: projects, work items with your own types, properties and workflows, a wiki per project, team-wide views across projects, recurring work items and switchable automations. Built to be driven from the keyboard, and fully controllable over a REST API, an MCP server for AI agents and webhooks.

> **Status:** in development (phase 14 of 15: Docker). There is no release yet. Sign-in, people and bots, roles, projects, the catalogs (workflows with transition matrix, item types, properties, labels, relation types, resolutions), work items with relations and history, item lists (filters, saved views, list, board, table and timeline, bulk changes), search in the command palette and over REST, rich text with mentions, references, images, files and comments, notifications (inbox, collected mails, reminders, live updates over Reverb), the wiki per project, templates with schedules, automations, signed webhooks, the complete REST API with its OpenAPI reference under `/api/docs`, the MCP server for AI agents and the Docker image with its Compose stack are in place. The concept is in [`docs/superpowers/specs/2026-10-28-werkbuch-design.md`](docs/superpowers/specs/2026-10-28-werkbuch-design.md) (German). A clickable prototype with demo data lives in [`prototypes/clickdummy/`](prototypes/clickdummy/) (German UI).

## Self-hosting

werkbuch runs as a Docker Compose stack: the image `baeroe/werkbuch` (web service, Reverb for live updates, three queue workers, the scheduler) with MariaDB 11.4 and Meilisearch 1.56, everything behind one port (`7740`). You need Docker with Compose v2.20 or newer, 2 vCPU and 2 GB of RAM (4 GB recommended).

```bash
curl -fsSLO https://raw.githubusercontent.com/baeroe/werkbuch/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/baeroe/werkbuch/main/.env.docker.example
# edit .env: APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DB_PASSWORD, DB_ROOT_PASSWORD, MEILISEARCH_KEY
docker compose up -d
```

Put a reverse proxy with HTTPS in front, set `APP_URL` to its address and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. For Dockge or Portainer there is [`docker-compose.standalone.yml`](docker-compose.standalone.yml), one file without `.env`.

Until the first release, the image and the files on `main` are not published yet: build the image from a clone with `docker buildx build --load -t werkbuch:local .` and set `WERKBUCH_IMAGE=werkbuch:local` in `.env`.

- [Setup](docs/en/setup.md) and [Reverse proxy](docs/en/reverse-proxy.md)
- [Operations](docs/en/operations.md), [Upgrading](docs/en/upgrading.md) and [Backup](docs/en/backup.md)
- [REST API](docs/en/api.md), [MCP](docs/en/mcp.md) and [Webhooks](docs/en/webhooks.md)

## Development

Local development runs in [DDEV](https://ddev.com) (PHP 8.4, MariaDB 11.4, Meilisearch, Node 24 with pnpm); the guide is [`docs/en/development.md`](docs/en/development.md). The docs live in [`docs/`](docs) (VitePress, English and German): `ddev exec pnpm --dir docs dev`.

## Stack

Laravel, Inertia and React with a custom UI, MariaDB, Meilisearch, Laravel Reverb. Shipped as a Docker image with a Compose stack.

## License

[MIT](LICENSE)
