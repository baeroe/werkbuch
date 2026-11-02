# werkbuch

Open, self-hosted project management for teams: projects, work items with your own types, properties and workflows, a wiki per project, team-wide views across projects, recurring work items and switchable automations. Built to be driven from the keyboard, and fully controllable over a REST API, an MCP server for AI agents and webhooks.

> **Status:** in development (phase 5 of 15: views, filters, list layouts). There is no usable release yet. Sign-in, the shell, people and bots, tokens, roles, projects with members, the catalogs (workflows with transition matrix, item types, properties, labels, relation types, resolutions), work items (item page and preview, create dialog, rich-text descriptions, relations, history, command palette, REST) and item lists (filter engine, saved views, list, board, table and timeline, bulk changes, REST queries) are in place; search follows in the next phase. See [`docs/en/development.md`](docs/en/development.md) for the local setup. The concept is in [`docs/superpowers/specs/2026-10-28-werkbuch-design.md`](docs/superpowers/specs/2026-10-28-werkbuch-design.md) (German). A clickable prototype with demo data lives in [`prototypes/clickdummy/`](prototypes/clickdummy/) (German UI).

## Planned stack

Laravel, Inertia and React with a custom UI, MariaDB, Meilisearch, Laravel Reverb. Shipped as a Docker image with a Compose stack.

## License

[MIT](LICENSE)
