# Runner-Plan Task 12: Eine private GitHub-App je GitHub-Konto (WEBU-35)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: erst der Test, dann der Code.

**Goal:** werkbuch verbindet mehrere private GitHub-Apps, eine je GitHub-Konto (eigenes Konto oder Organisation): Rafaels Repos unter `baeroe` und in `haussdotdev` sind in werkbuch wählbar. Eine private App lässt sich nur auf dem Konto installieren, dem sie gehört; darum braucht jedes Konto seine App (Entscheidung Rafael 2026-11-25 gegen eine öffentliche App, OAuth oder ein Maschinen-Konto).

**Architecture:** `github_apps` wird eine Liste (ohne `singleton`, eindeutig je `owner_login` und `app_id`), jede Installation gehört ihrer App (`github_installations.github_app_id`), ein Repo über seine Installation. Alles, was GitHub fragt, nimmt die App des Repos bzw. der Installation (`InstallationTokens`, `LinkRepository`, `SyncGitHub::pull($app)`); der Wächter und die Agenten-PRs vergleichen mit `<slug>[bot]` der App des Repos. Der Webhook bleibt eine Adresse: die App kommt aus `X-GitHub-Hook-Installation-Target-ID`, signiert wird mit deren Geheimnis, die Zustellung merkt sich ihre App (`github_deliveries.github_app_id`). Trennen gilt je App (`DELETE /github/apps/{githubApp}`) und pausiert nur die Projekte mit Repos dieser App. `GET /github` nennt `apps` mit ihren Installationen; Verbinden fragt das Konto (`owner`, `owner_type`), ein Konto mit App ist 409.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 4, 10.2, 11.3, 11.4 (Änderung vom 2026-11-25). Rulings ab A680.

## Grenzen

- Kein echtes GitHub; Tests über `Tests\Support\FakeGitHub` mit zwei Apps (Tokens nur für Installationen der App, die das JWT signierte; Installationen je App).
- WEBU-34 (leerer Body als `{}`) läuft parallel: nach dessen Merge rebasen, `GitHubApi`/`FakeGitHub` nehmen beides.
- MCP: keine neuen Argumente (Budget rund 500 Bytes); `sync-github` liest alle Apps, Trennen und Verbinden bleiben nur in der Sitzung (A397).

## Dateien

- Backend: Migration `…_2026_11_25_000100_github_apps_per_account`, Modelle `GitHubApp`, `GitHubInstallation`, `GitHubRepository`, `GitHubDelivery`, Factories, `App\GitHub\{InstallationTokens,Manifest}`, Actions `StartManifest`, `CompleteManifest`, `SyncGitHub`, `ReturnFromInstallation`, `DisconnectGitHub`, `GetGitHub`, `LinkRepository`, `ReceiveGitHubDelivery`, `HandleGitHubDelivery`, `DetectUnauthorizedPush`, `App\Support\AgentPullRequests`, `SyncPullRequest`, `PostLinkback`, `VerifyGitHubSignature`, `GitHubWebhookController`, `GitHubPageController`, `Api\GitHubController`, `GitHubResource`, `GitHubSchemas`, `RouteBindingServiceProvider`, `routes/api.php`, MCP-Summaries, `E2eSeeder`, `lang/*.json`.
- Tests: `FakeGitHub` (zwei Apps, JWT geprüft), `tests/Feature/GitHub/*`, `MatrixWorld`, `matrix.php`, `routes.php`, `tests/Integration/GitHubAppsMigrationTest.php`.
- Browser: `types.ts`, `api/github.ts`, `hooks/github.ts`, `features/settings/org/github/*` (Liste der Apps, „Weitere App hinzufügen“, Trennen je App), `features/settings/project/Agents.tsx` (Repos aller Apps, gruppiert nach Konto), Tests, `e2e/tests/github.spec.ts`, `e2e/a11y-pages.ts`, `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs`.
- Doku: `docs/{en,de}/github.md`, Spec, Rulings, `CLAUDE.md`.

## Tasks

- [ ] **1 Datenmodell:** Migration (Singleton weg, `owner_login`/`app_id` eindeutig, `github_installations.github_app_id` Pflicht mit Kaskade, `github_deliveries.github_app_id` mit `nullOnDelete`, Bestehendes an die eine App; Rückweg nur mit höchstens einer App), Beziehungen, Factories; Test der Migration.
- [ ] **2 FakeGitHub für mehrere Apps:** `connected()` und `secondApp()`, `/app/installations` und `access_tokens` je App über das JWT (Signatur gegen den Schlüssel der App geprüft, eine fremde Installation 404), `deliver(…, $app)` mit `X-GitHub-Hook-Installation-Target-ID`.
- [ ] **3 Verbinden:** `StartManifest` mit `owner`/`owner_type` (Konto mit App 409 `github_connected` mit Satz), Manifest-Name `<login> werkbuch`, `CompleteManifest` eindeutig je Konto unter der Sperre.
- [ ] **4 Tokens und Abgleich:** `InstallationTokens` und `LinkRepository` über die App der Installation, `SyncGitHub` je App (alle beim Abgleich von Hand und nach der Installation), `/github/install?app=`.
- [ ] **5 Webhook:** App aus dem Header, Signatur mit deren Geheimnis, unbekannt 401 (zählt in der Drossel), Zustellung mit App; `HandleGitHubDelivery` liest mit der App der Zustellung.
- [ ] **6 Bot der App des Repos:** `DetectUnauthorizedPush`, `AgentPullRequests::isAgent` (mit dem Repo), Aufrufer.
- [ ] **7 Trennen je App:** `DisconnectGitHub($actor, $app)`, nur Projekte mit Repos dieser App; Route, Bindung, Matrix, OpenAPI.
- [ ] **8 Lesen:** `GetGitHub`/`GitHubResource` mit `apps[].installations`, Schemas, MCP-Summaries (Budget messen).
- [ ] **9 Browser:** Typen, API, Hooks, Einstellungsseite mit Liste der Apps, Dialog „Weitere App hinzufügen“, Trennen je App; Projekt → Agenten mit Repos aller Apps (Gruppe je Konto).
- [ ] **10 e2e, axe, Tastatur:** `github.spec.ts` mit Apps je Variante, a11y mit zwei Apps und dem Dialog, Abläufe.
- [ ] **11 Doku, Spec, Rulings, CLAUDE.md, Proof.**
