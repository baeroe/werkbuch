# werkbuch

Open, self-hosted project management for teams: projects, work items with your own types, properties and workflows, a wiki per project, team-wide views across projects, recurring work items and switchable automations. Built to be driven from the keyboard, and fully controllable over a REST API, an MCP server for AI agents and webhooks.

> **Status:** in development (phase 9 of 15: wiki). There is no usable release yet. Sign-in, the shell, people and bots, tokens, roles, projects with members, the catalogs (workflows with transition matrix, item types, properties, labels, relation types, resolutions), work items (item page and preview, create dialog, rich-text descriptions, relations, history, command palette, REST), item lists (filter engine, saved views, list, board, table and timeline, bulk changes, REST queries), search (items, wiki pages, projects, people and views in the command palette and over REST, jumps by key), rich text (the full editor with `/` menu, mentions, references, images and files, comments with reactions, file lists, Markdown over REST), notifications (inbox with badge, collected mails, daily reminders, notification settings, live updates over Reverb, a system page for org admins) and the wiki (a page tree per project with autosave, conflicts that lose no text, versions, drag and drop and "Move to …", page references and search) are in place; templates, schedules and automations follow in the next phase. See [`docs/en/development.md`](docs/en/development.md) for the local setup. The concept is in [`docs/superpowers/specs/2026-10-28-werkbuch-design.md`](docs/superpowers/specs/2026-10-28-werkbuch-design.md) (German). A clickable prototype with demo data lives in [`prototypes/clickdummy/`](prototypes/clickdummy/) (German UI).

## Planned stack

Laravel, Inertia and React with a custom UI, MariaDB, Meilisearch, Laravel Reverb. Shipped as a Docker image with a Compose stack.

## License

[MIT](LICENSE)
