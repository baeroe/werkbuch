# Runner-Plan Task 7: GitHub-App, Repos, Tokens, Webhooks (WEBU-24)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. TDD: erst der Test, dann der Code.

**Goal:** werkbuch hat genau eine GitHub-App (Manifest-Flow), kennt ihre Installationen und Repos, verknüpft je Projekt ein Repo (1:1) mit Hinweis auf ein Ruleset am Basis-Branch, gibt jedem Auftrag ein Installations-Token mit den Rechten seines Typs, nimmt signierte Webhooks genau einmal an und erkennt einen eigenmächtigen Push der App auf den Basis-Branch.

**Architecture:** `App\GitHub` spricht mit GitHub (nur lesend gegenüber der Datenbank, HTTP über Laravels `Http`, JWT der App per `openssl_sign` RS256, keine neue Bibliothek: weder `firebase/php-jwt` noch `lcobucci/jwt` liegen im Lockfile). Die Actions unter `App\Actions\GitHub` schreiben. HTTP läuft nie unter einer Sperre: erst fragen, dann in der Transaktion schreiben. Webhooks: `POST /github/webhook` ohne Middleware-Gruppe (wie `routes/runner.php`), `VerifyGitHubSignature` vor allem, Zeile in `github_deliveries` per `insertOrIgnore` über die Delivery-ID, Verarbeitung im Job `ProcessGitHubDelivery` (Queue `default`).

**Tech Stack:** Laravel 13, Pest, `Http::fake` als falsches GitHub (Antworten in der Form der REST-API, Payloads der Webhooks in der Form der Doku, Signatur echt mit HMAC-SHA256).

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 4, 6.3, 6.4 (Token-Erneuerung), 10.2, 10.3 (nur Repo und Basis-Branch), 11.3, 11.4. Rulings A510 ff.

## Grenzen

- Keine große Oberfläche (WEBU-27): eine schlichte Blade-Seite `GET /github` für den Manifest-Flow und den Zustand, dazu REST und MCP.
- Keine PR-Verknüpfung (WEBU-25), kein Ablauf (WEBU-26). `pull_request`, `check_suite`, `check_run` werden angenommen, dedupliziert und als `ignored` vermerkt.
- Nach `ConfirmMergeGuard` sind die pausierten Stränge wieder offen; einen Auftrag stößt erst WEBU-26 an.

## Dateien

- Migration `2026_11_24_000100_create_github_tables`: `github_apps` (eine Zeile, `singleton` eindeutig), `github_installations`, `github_repositories`, `project_repositories` (Projekt eindeutig, Repo eindeutig, Basis-Branch, `protected`, Wächter-Spalten `guard_*`), `github_merges`, `github_deliveries`.
- Models `GitHubApp` (Key und Secret `encrypted`, `#[Hidden]`), `GitHubInstallation`, `GitHubRepository`, `ProjectRepository`, `GitHubMerge`, `GitHubDelivery`.
- `App\GitHub\{AppJwt, GitHubApi, GitHubUnavailable, InstallationTokens, Manifest, Signature}`; `App\Domain\GitHub\{RepoPermissions, BranchRules}` (rein).
- Actions `App\Actions\GitHub\{GetGitHub, StartManifest, CompleteManifest, SyncGitHub, DisconnectGitHub, ReceiveGitHubDelivery, HandleGitHubDelivery, DetectUnauthorizedPush, PruneGitHubDeliveries}`, `App\Actions\Projects\{GetProjectRepository, LinkRepository, ConfirmMergeGuard}`, `App\Actions\AgentRuns\RenewGitToken`; `App\Support\OwnMerges` (für WEBU-26).
- `ClaimRun`: Token nach dem Commit, bei einem Fehler zurück in die Warteschlange (wie verloren); Kandidaten ohne Projekte mit offenem Wächter; `RunQueue` Grund `merge_guard`.
- Routen: `routes/github.php` (Webhook), `routes/runner.php` (`runs/{runId}/git-token`), `routes/web.php` (`/github`, `/github/manifest`, `/github/setup`), `routes/api.php` (`github`, `github/sync`, `github/manifest` und `DELETE github` nur Sitzung, `projects/{project}/repository`, `…/repository/confirm-guard`).
- MCP: `agents:get-github`, `agents:get-repository`, `manage-agents:sync-github`, `manage-agents:set-repository`, `manage-agents:confirm-merge-guard`; Manifest und Trennen nicht über MCP (A397).
- Tests: `tests/Feature/GitHub/*`, `tests/Support/FakeGitHub.php`, Matrix-Zeilen, Routen-Zeilen, MCP-Zeilen.

## Tasks

- [ ] **1 Datenmodell:** Migration, Models, Factories, Morph-Map; Test: App-Zeile verschlüsselt Key und Secret, `toArray()` ohne beide.
- [ ] **2 JWT und API:** `AppJwt` (RS256, `iat` −60 s, `exp` +9 min, `iss` App-ID), `GitHubApi` gegen `FakeGitHub`; Test: JWT mit dem öffentlichen Schlüssel prüfbar.
- [ ] **3 Manifest-Flow:** `StartManifest` (Name `<Organisation> werkbuch`, Rechte und Ereignisse aus Spec 11.3, `state` im Cache an die Person gebunden, eine Stunde), `CompleteManifest` (Konvertierung, Zeile anlegen, Event `github.connected` ohne Geheimnis, Weiterleitung zur Installation), `SyncGitHub` (Installationen und Repos, Ruleset am Basis-Branch).
- [ ] **4 Repo am Projekt:** `LinkRepository` (1:1, 422 `field.repository_id.taken`, Basis-Branch, Ruleset-Hinweis, Event `project.repository_changed`), `GetProjectRepository`.
- [ ] **5 Tokens:** `InstallationTokens::forRun` (ein Repo, Rechte je Typ aus `RepoPermissions`), Claim mit `git`, `RenewGitToken`; Tests „scopes the installation token …“, „gives the run back once when GitHub refuses the token, then fails it“.
- [ ] **6 Webhook:** Signatur (401), Dedupe (Redelivery einmal), Job, Installations-Ereignisse.
- [ ] **7 Wächter:** `DetectUnauthorizedPush` (Push der App auf den Basis-Branch, Commit nicht aus `OwnMerges`, wartet bei einem laufenden eigenen Merge), Stränge pausieren, Aufträge abbrechen bzw. warten lassen, Kommentar am Item mit Erwähnung der Org-Admins, Event; `ConfirmMergeGuard`.
- [ ] **8 Trennen:** `DisconnectGitHub` (Stränge mit Repo pausieren `github`, offene Aufträge abbrechen, Tabellen leeren).
- [ ] **9 REST, OpenAPI, MCP, Matrix, Doku-Tabellen, Blade-Seite, CLAUDE.md, Rulings.**
- [ ] **10 Prüfen:** `--coverage --min=100`, Larastan, Pint, `OpenApi|ApiDocsPage|McpDocs`, Nachweis gegen das DDEV des Worktrees mit falschem GitHub.

## Abnahme

- `it verifies the webhook signature and handles a redelivery once`
- `it scopes the installation token to the one repo and the permissions of the run type`
- `it keeps a repository in at most one project`
- `it never returns a private key or secret`
- `it pauses the threads of a project when the app pushes to its base branch outside a werkbuch merge`
