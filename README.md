# werkbuch

Open, self-hosted project management for teams: projects, work items with your own types, properties and workflows, a wiki per project, team-wide views across projects, recurring work items and switchable automations. Built to be driven from the keyboard, and fully controllable over a REST API, an MCP server for AI agents and webhooks.

> **Status:** in development (phase 1 of 15: foundation). There is no usable release yet. The foundation (sign-in, shell, quality gates, CI) is in place; projects and work items follow in the next phases. See [`docs/en/development.md`](docs/en/development.md) for the local setup. The concept is in [`docs/superpowers/specs/2026-10-28-werkbuch-design.md`](docs/superpowers/specs/2026-10-28-werkbuch-design.md) (German). A clickable prototype with demo data lives in [`prototypes/clickdummy/`](prototypes/clickdummy/) (German UI).

## Planned stack

Laravel, Inertia and React with a custom UI, MariaDB, Meilisearch, Laravel Reverb. Shipped as a Docker image with a Compose stack.

## License

[MIT](LICENSE)
