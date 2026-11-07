# Phase 14: Docker und Release-Vorbereitung – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** werkbuch läuft als ein Image `baeroe/werkbuch` (amd64 und arm64) in einem Compose-Stack, der mit `docker compose up -d` App, drei Queue-Worker, Scheduler, Reverb, MariaDB und Meilisearch startet und alles über **einen** Port (7740) erreichbar macht; nach dem ersten Start gibt es den Admin aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` und den Standard-Bot, Live-Updates laufen über denselben Port (Erfolgskriterium 1). Dazu: CI-Job `image` (Build beider Architekturen ohne Push, Smoke gegen den Stack je Architektur), Release-Workflows `docker.yml`/`dockerhub.yml` (nur vorbereitet, ausgelöst erst durch einen Tag `vX.Y.Z` mit Rafaels Freigabe), Betriebsdoku en + de.

**Architecture:** Ein Image für alle App-Dienste: `serversideup/php` (fpm-nginx, Debian trixie, glibc) mit schreibgeschütztem Code (Code, `/var/www` und `/var/www/html` gehören root), beschreibbar nur `storage/` und `bootstrap/cache`; eine Node-Stage baut die Assets mit pnpm. Der Entrypoint `docker/entrypoint.d/99-werkbuch.sh` erkennt die Rolle am Kommando (`SERVERSIDEUP_DEFAULT_COMMAND`): der Web-Dienst wartet auf die Datenbank, migriert, legt den Admin an, synchronisiert und füllt bei Bedarf den Suchindex, baut Caches und `scramble:cache`; Worker, Scheduler und Reverb bauen nur ihren Config-Cache (mit den Schlüsseln aus dem Volume) und starten erst, wenn der Web-Dienst gesund ist. Weil `php artisan optimize` die Routen cacht und `routes/*.php` dann nie laufen, stehen die Route-Bindungen in einem Provider (`RouteBindingServiceProvider`). nginx im Web-Container leitet nur `/app/` (WebSocket) an den Dienst `reverb` weiter, die HTTP-API von Reverb (`/apps/`) bleibt intern; HSTS setzt der TLS-Proxy, nie der Container. Der Browser bekommt die öffentliche Adresse aus `APP_URL`, der Server sendet intern an `reverb:6001` (neue Trennung `werkbuch.live`). Der Nachweis ist ein Smoke (`scripts/compose-smoke.sh` + `.mjs`), der in CI je Architektur und lokal mit Colima gegen den echten Stack läuft; die Playwright-Suite bleibt auf `php artisan serve`.

**Tech Stack:** wie Phase 13; neu: Docker (buildx, Compose v2), `serversideup/php` v5.0.4, nginx-Konfiguration, GitHub Actions per SHA; dev-Paket `symfony/yaml` (Tests lesen Compose und Workflows).

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterien 1 und 8; 2 Anti-Ziel „Kompliziertes Self-Hosting“; 3 Zeilen „Live-Updates“, „Betrieb“; 7.5 Proxy; **8.1–8.4 komplett**; 9 „Docker-Setup“, „Release-Notizen“, CI; 10 Setup, Reverse Proxy, Upgrading, Backup; 14 Reverb hinter Proxys, Speicherbedarf), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Verträge „Queues“, „Konfiguration“, Phase 14), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A26, A216, A278, A285, A301, A368, A373, A378, A381, A388, A389, A403, A409; „Für spätere Phasen vorgemerkt“, Zeile Phase 14 → Tabelle „Vormerkungen“ unten), Schwesterprojekt `~/development/baeroe/openbill` (`Dockerfile`, `docker/entrypoint.d/99-openbill.sh`, `docker-compose*.yml`, `.env.docker.example`, `.github/workflows/{docker,dockerhub}.yml`, `scripts/release-notes.sh`, `tests/Feature/DockerSetupTest.php`, `tests/Unit/ReleaseNotesTest.php`, `docs/en/{setup,reverse-proxy,upgrading,backup}.md`) als Vorbild für Muster und Wortlaut. Preflight `.superpowers/sdd/2026-11-07-phase-14-docker/preflight.md` (K1–K15): eingearbeitet, dieser Plan sagt selbst, was gilt.

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 14 entscheidend:

- Branch `feat/phase-14-docker` von `main` **nach dem Merge von PR #28** (Phase 13). Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>`.
- **Kein Task taggt, pusht ein Image oder legt ein Release an.** `docker.yml` reagiert nur auf Tags `v*` (und `workflow_dispatch` ohne Push); der Tag `v0.1.0` und das Anheben von `config('werkbuch.version')` auf `0.1.0` geschehen erst mit Rafaels Freigabe (Abschnitt „Nach der Phase“). `git push` nur für den Branch (PR), nie `--tags`.
- PHP, Composer, Artisan, pnpm der App nur in DDEV. Docker-Kommandos (`docker buildx build`, `docker compose`) laufen auf dem Mac gegen Colima. Neues Paket nur `symfony/yaml` (dev, Task 3a); `pnpm-lock.yaml` und `e2e/pnpm-lock.yaml` bleiben unverändert.
- **Images und Actions nur gepinnt, nur mindestens zwei Wochen alt** (Stand der Prüfung: 2026-11-07, Tabelle „Versionen und Digests“). Ausnahme (A414): ein Release, das eine bekannte Lücke schließt, geht der Zwei-Wochen-Regel vor, wenn es sonst nichts ändert (Diff geprüft) — so `serversideup/php` v5.0.4. Basis-Images per Tag **und** Digest, jede Action per 40-stelligem Commit-SHA mit Kommentar `# vX.Y.Z` — in **allen** Workflows, auch den bestehenden Jobs von `tests.yml` (A425). Neue Majors von Actions kommen in dieser Phase nicht.
- **Sicherheit des Images:** Code, `/var/www` und `/var/www/html` gehören root und sind für `www-data` nur lesbar; ebenso die Debug-Dateien der Basis, die PHP und FPM beim Start lesen (`$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini`, `/usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf`, `/usr/local/etc/php-fpm.conf`). Beschreibbar nur `storage/` (darin das Volume `storage/app`) und `bootstrap/cache`, dazu `/etc/nginx` (Templates beim Start, A429). Alle App-Container laufen als `www-data` (UID 33), nie als root. Kein Geheimnis im Image oder Build-Kontext (`.dockerignore` streng: keine `.env*`, `node_modules`, `vendor`, `e2e`, `tests`, `prototypes` außer den Manifesten, `.superpowers`, `.claude`, `coverage`). `zend.exception_ignore_args = On`, `session.upload_progress.enabled = Off`. Access-Logs ohne Query-String, ohne Referer, Reset-Token und Upload-Pfad maskiert. Kein HSTS vom Container (der TLS-Proxy setzt es), die HTTP-API von Reverb (`/apps/`) nie über nginx.
- **glibc, nie musl** (A381: `RES_OPTIONS` begrenzt die DNS-Wartezeit der Webhooks nur unter glibc): beide Stages auf Debian trixie, kein `-alpine`-Tag.
- **Queues wie DDEV und CI** (A301, T16-M5): `queue` (`default,live,notifications,bulk`), `queue-index` (`search,media`, **genau ein** Container, T4-M2), `queue-webhooks` (`webhooks`); `ConfigTest` hält DDEV, CI und Compose im Gleichschritt.
- Port `${WERKBUCH_BIND:-0.0.0.0}:${WERKBUCH_PORT:-7740}`, Volumes `werkbuch-data`, `mariadb-data`, `meili-data` (Spec 8.1). `docker-compose.standalone.yml` bleibt mit `docker-compose.yml` im Gleichschritt (Test).
- **Parität DDEV ↔ Docker:** MariaDB im Stack mit `--max-allowed-packet=64M` (DDEV hat 256M; 16M der Voreinstellung reichen nicht für den Sammel-Insert der Webhook-Zustellungen, `QueueDeliveries`); `REVERB_PUBLIC_PORT` steht als Schlüssel in `.env.example` und `e2e/ci.env` und wird in Tests leer gehalten (`phpunit.xml`, `tests/TestCase.php`). Die Compose-Dateien reichen keine Variable leer durch, die die Basis beim Start nicht leer erlaubt (Präfixe `PHP_`, `NGINX_`, `SSL_`, `LOG_`, `APACHE_`, `HEALTHCHECK_PATH`, `TRUSTED_PROXY` — das trifft auch `TRUSTED_PROXIES`): sonst bricht `10-init-webserver-config.sh` den Start des Web-Dienstes ab.
- Keine Verhaltensänderung der App außer: `features.live` aus `werkbuch.live` (Task 1), Standard von `session.secure` aus dem Schema von `APP_URL` (Task 1), die Route-Bindungen ziehen von `routes/api.php` in `RouteBindingServiceProvider` (Task 2; in DDEV und Tests ohne Wirkung, im Image erst so wirksam), der Satz zum Platzhalter `change-me` kommt aus `lang/*.json` (Task 2; die Ablehnung selbst besteht seit Phase 1), `app:search-import --if-empty` (Task 2). DDEV und die CI-e2e verhalten sich danach wie vorher (gezielter G3 in Task 1).
- Doku en + de mit gleichen Dateinamen und Überschriften (`DocsTest`); README englisch; Rulings, Spec-Änderungen und Pläne deutsch. Demo- und Beispieldaten nur fiktiv (`example.com`).
- Abdeckung 100 % Zeilen PHP; Larastan Level 8; Pint. Tests müssen rot werden können (RED zuerst belegen; wo ein Test bestehendes Verhalten festhält, sagt der Bericht das). `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert.

## Review Focus

- **Was nur im Image anders ist: Routen-Cache.** `php artisan optimize` cacht die Routen; mit gecachten Routen läuft `routes/api.php` nie. Erwartet: `{item}` per Key (auch frühere Kennung, 301), `{project}` per Kennung, `{attachment}` auf der Web-Route binden im Image wie in DDEV. → Task 2 (`RouteCacheTest`, `ArchTest`), Task 5a (Smoke: Projekt per Kennung, Item per Key).
- **Zweiter Start und Update mit vorhandenen Volumes:** Container neu erzeugen (`up -d --force-recreate`), neues Image auf altem Volume. Erwartet: `APP_KEY` und Reverb-Schlüssel bleiben (Sitzungen gelten weiter), kein zweiter Admin, Migrationen laufen nur einmal, der Suchindex wird nur importiert, wenn er fehlt, keine halb geschriebene Schlüssel-Datei. → Task 3b (Entrypoint-Tests „keeps the keys of the volume“, „leaves no .tmp behind“), Task 5a (Smoke nach `--force-recreate`: Anmeldung geht, Schlüssel-Hash gleich, genau eine Person).
- **Platzhalter und fehlende Werte:** Standalone-Datei unverändert deployt (`change-me`), `.env` ohne Passwörter, Meilisearch-Key zu kurz. Erwartet: Compose verweigert den Start (`:?`) bzw. MariaDB, Meilisearch und werkbuch stoppen mit einer lesbaren Zeile, **bevor** MariaDB das Passwort in ihr Volume schreibt; kein Konto mit dem Passwort `change-me`; MariaDB der Standalone-Datei startet mit geänderten Werten wirklich (der Guard-`entrypoint` löscht sonst den `CMD`). → Task 2 (`EnsureAdminTest`), Task 3b (Entrypoint-Test, Start im Container), Task 4b (Guards, `command`), Task 8 (Standalone von Hand gestartet).
- **Geheimnisse in Logs und Image:** signierte Upload-URL (`/api/mcp/uploads/{token}?signature=…`), Einladungslink (`?signature=`), Reset-Link (`/reset-password/<token>`), Referer mit Query, Argumente in Stacktraces von `failed_jobs`, `.env` im Build-Kontext, das Zufalls-Root-Passwort von MariaDB. Erwartet: keine dieser Zeichenfolgen in `docker compose logs` (außer dem Root-Passwort der Standalone-Datei, das wegen `MARIADB_ROOT_HOST=localhost` nur im Container taugt, Doku), `zend.exception_ignore_args` = 1 in FPM und CLI, keine `.env` im Image. → Task 3a (`ImageTest`), Task 4a/4b (`MARIADB_ROOT_HOST`), Task 5a (Smoke: Probe-Wert fehlt im Log, `php -r ini_get` im Container).
- **Live hinter einem TLS-Proxy:** `APP_URL=https://pm.example.com`, Proxy terminiert TLS auf 443 und spricht Port 7740 an. Erwartet: der Browser bekommt `wss://pm.example.com:443/app/<key>` (nie `reverb:6001` und nie den internen Port), Reverb nimmt nur `Origin` = Host aus `APP_URL`, der Server sendet intern an `http://reverb:6001`, `/apps/` ist über 7740 nicht erreichbar, der Container schickt kein HSTS. → Task 1 (`LiveAddressTest`, `InertiaTest`), Task 3a (`ImageTest`), Task 5a (Smoke: `features.live` = Host und Port von `APP_URL`, WebSocket über 7740, `/apps` → 404, `/up` ohne HSTS), Task 6a (Doku Reverse Proxy, HSTS am Proxy).
- **Grenzen am Webserver:** ein Upload über 32 MiB, ein Worker-Container, der vor dem Ende der Migration startet, ein Reverb, der beim Start von nginx noch nicht läuft. Erwartet: 413 vom Webserver (die Oberfläche liest ihn als `payload_too_large`, F29), Worker warten per `depends_on: service_healthy` und verweigern ohne Schlüssel den Start, nginx startet ohne Reverb und antwortet auf `/app/` mit 502, bis Reverb da ist (Auflösung zur Laufzeit). → Task 3a (nginx mit `resolver`), Task 3b (Worker ohne Schlüssel), Task 4a (`depends_on`), Task 5a (Smoke: 413 per `Content-Length`).

## Gates

Regel A249, ergänzt um das Image:

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Tasks mit Code unter `tests/Integration` dazu `ddev artisan test --testsuite=Integration --filter=<Name>`.
- **G2 (Frontend):** entfällt (keine Änderung unter `resources/js`); Task 5a läuft `ddev exec pnpm test` für `scripts/compose-smoke.test.mjs`.
- **GI (Image), Tasks 3a, 3b, 5a und 8:** `colima status` muss laufen; `docker buildx build --load -t werkbuch:local .` (native Architektur des Macs, arm64) → Erfolg; in Task 5a und 8 dazu `WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh` → letzte Zeile `smoke: ok`. Tasks 4a/4b prüfen die Compose-Dateien nur mit `docker compose … config`.
- **G3 gezielt, Task 1:** nach `ddev restart` (neue `web_environment`): `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test live.spec.ts notifications-acceptance.spec.ts` → grün.
- **G3 voll, genau einmal je Phase:** nach Task 8, im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build`.

---

## Versionen und Digests

Geprüft am 2026-11-07 per `docker buildx imagetools inspect` (Erstellungsdatum aus der Image-Config) und über die GitHub-API (Tag → Commit, annotierte Tags aufgelöst). „Alter“ = Tage bis 2026-11-07.

| Was | Pin | Alter | Hinweis |
|---|---|---|---|
| App-Basis | `serversideup/php:8.4.27-fpm-nginx-trixie-v5.0.4@sha256:c91d4ff3cb30582078050735b42e873a196d60a406a68cff14bda79e3b5fff56` | 12 | **Ausnahme A414 (Sicherheit vor Wartezeit):** erstellt 2026-10-26T23:07Z, am 2026-11-09 zwei Wochen alt. Index für `linux/amd64` und `linux/arm64`; Debian trixie (glibc). Schließt gegenüber v5.0.2 (`sha256:579494c3…`, 17 Tage, in openbill) zwei bekannte Lücken: v5.0.3 `session.upload_progress.enabled` aus (CVE-2026-115560), v5.0.4 `libbrotli1` `1.1.0-2+deb13u1` (CVE-2026-111497). Der Diff v5.0.2…v5.0.4 für `fpm-nginx` ändert nur diese beiden Punkte; Entrypoint, nginx-Templates und s6 bleiben gleich. v5.0.5 betrifft `fpm-nginx` nicht, v5.1.x verworfen (< 14 Tage). Bringt `opcache pcntl pdo_mysql pdo_pgsql redis zip` (+ `sodium`), Benutzer `www-data`, Ports 8080/8443, `HEALTHCHECK` auf `/healthcheck`, `STOPSIGNAL SIGQUIT`, Skripte `healthcheck-queue`, `healthcheck-schedule`. |
| Asset-Stage | `node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c` | 17 | glibc wie die App (nativer Build auf `$BUILDPLATFORM`); 24.22.1/24.22.2 verworfen (< 14 Tage). |
| MariaDB | `mariadb:11.4.13@sha256:1292844148b311e4ed4300022a996d39083f415a963e970cf47cad1b3b18e3a6` | 36 | identisch mit den Services der CI; der Tag `11.4.13` zeigt inzwischen auf einen Rebuild vom 26.10. — der Pin bleibt beim geprüften Digest. |
| Meilisearch | `getmeili/meilisearch:v1.56.0@sha256:1f578fa865f8251894b3bf38d6668d6209a3f451f8f65ab953e129d4c1db5ef4` | 12 | **Ausnahme A414:** dieselbe Version wie DDEV und CI (CLAUDE.md, `tests/Integration` prüft sie); ab 2026-11-09 zwei Wochen alt. Alpine mit `curl` (Healthcheck), `ENTRYPOINT ["tini","--"]`, `CMD ["/bin/sh","-c","/bin/meilisearch"]`, läuft als root im Container. v1.56.1 (Speicher und Laufzeit bei langen Filtern) ab 2026-11-16 nachziehen (Vormerkung Phase 15). |
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262 # v4.4.0` | 110 | Major v4 wie bisher |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0` | – | |
| `actions/cache` | `0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0` | – | |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2` | – | |
| `actions/download-artifact` | `d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0` | – | nur `docker.yml` (Digests) |
| `pnpm/action-setup` | `fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0` | – | |
| `shivammathur/setup-php` | `eb7c497e18156a6bbabfef1d3a82760b9eda3962 # 2.40.0` | 30 | |
| `docker/setup-qemu-action` | `99012661954931238ded8c8b007157a8430204e1 # v4.4.0` | 53 | nur Rückfall (A421), im Plan nicht benutzt |
| `docker/setup-buildx-action` | `f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1` | 52 | |
| `docker/login-action` | `81c6f93d4bc991e510b342a00b419b3bb4efc5c6 # v4.7.0` | 15 | nur Tags |
| `docker/metadata-action` | `dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0` | – | |
| `docker/build-push-action` | `c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0` | 53 | |
| `peter-evans/dockerhub-description` | `1b9a80c056b620d92cedb9d9b5a223409c68ddfa # v5.0.0` | – | sieht das Docker-Hub-Token |
| `symfony/yaml` (Composer, dev) | `8.1.10` (vom 2026-10-18) | 20 | gleiche Linie wie `symfony/process` 8.1.10 im Lock; 8.1.11 (04.11.) verworfen. |

Vor dem Build prüft Task 3a die beiden FROM-Digests noch einmal (`docker buildx imagetools inspect <ref>` → `Digest:` gleich); ein abweichender Digest ist ein Stopp und eine Rückfrage, nie ein stilles Update.

## Vormerkungen → Tasks

| Vormerkung (Rulings „Für spätere Phasen“, Ledger) | Wo |
|---|---|
| Worker auf `notifications`, `bulk` (A26), `live` (A278), `search` (A216), `media`, `default` (Vorlagen), eigener Worker `webhooks`, Aufteilung A301 | Task 4a |
| Scheduler-Container für Kehrer, Erinnerungen, Aufräumen, Vorlagen, Automatisierungen, `PruneWebhookDeliveriesJob` | Task 4a |
| `TrustHosts` auch für `/up` | Task 4a (Healthcheck mit `Host` aus `APP_URL`) |
| `SESSION_SECURE_COOKIE` aus dem Schema von `APP_URL` | Task 1 |
| Reverb-Adresse des Browsers aus `APP_URL`, System-Seite prüft intern (M4) | Task 1 |
| `memory_limit` ≥ 512 MB; `upload_max_filesize`/`post_max_size`/`client_max_body_size` passend zu `ATTACHMENTS_MAX_MB`; JSON-Grenze am Webserver (A388) | Task 3a (A419) |
| nginx `/app` an Reverb; Reverb-Schlüssel erzeugt der Entrypoint | Task 3a (nginx), Task 3b (Schlüssel). `/apps` (HTTP-API) über nginx entfällt: der Server spricht Reverb intern an (A415, A419) |
| `app:search-sync` bei jedem Start, `app:search-import` bei leerem Index (A216, Phase 7/9) | Tasks 2, 3b |
| `scramble:cache` nach `migrate` (A389), Cookie-Name aus `APP_NAME` | Task 3a (`APP_NAME`), Task 3b (`scramble:cache`) |
| `route:cache` nach dem Update (Provider von `laravel/mcp` lädt `routes/ai.php`) | Task 2 (Bindungen im Provider, A430), Task 3b (`optimize`), Task 5a (Smoke `/mcp` → 401, Projekt per Kennung, Item per Key) |
| docs im Image für die MCP-Referenzen (A409) | Task 3a |
| Access-Logs ohne Query für `/api/mcp/uploads/` (A403) | Task 3a |
| musl liest `RES_OPTIONS` nicht (A381); `exception_ignore_args` | Task 3a |
| Stoplight-Dateien samt LICENSE im Image | Task 3a |
| Betriebsdoku: Trusted Proxies, Rate-Limits, ausgehende Verbindungen, `WEBHOOKS_ALLOW_PRIVATE` und Metadaten-Adressen (A378), Proxy mit WebSockets, `/mcp` hinter dem Proxy, `MCP_RATE_LIMIT`, Mindest-RAM für Meilisearch | Tasks 6a, 6b |
| Eigener Worker/Queue für Anmelde-Mails (T5-M7) | vertagt, A418 |
| Nachfüllen von `value_text` fortsetzbar (T4-M3) | entfällt, A427 |
| S3-kompatibler Speicher (Spec 4.16, 8.2) | vertagt, A424 |

## Dateistruktur nach Phase 14

| Ort | Inhalt |
|---|---|
| `Dockerfile`, `.dockerignore` | zwei Stages (`assets`, `app`), Build-Kontext ohne Geheimnisse |
| `docker/entrypoint.d/99-werkbuch.sh` | Start aller App-Container, Rolle über `SERVERSIDEUP_DEFAULT_COMMAND` |
| `docker/nginx/conf.d/00-werkbuch.conf` | http-Kontext: `map` des geloggten Pfads, `map` ohne den eigenen Healthcheck, `log_format werkbuch` |
| `docker/nginx/server-opts.d/werkbuch.conf` | server-Kontext: `access_log`, `resolver`, `location ^~ /app/` → Reverb |
| `docker/nginx/server-opts.d/security.conf` | ersetzt die Datei der Basis: dieselben Header und `deny`-Locations, ohne HSTS |
| `docker/php/zz-werkbuch.ini` | `zend.exception_ignore_args`, `expose_php`, `session.upload_progress.enabled` |
| `docker-compose.yml`, `docker-compose.standalone.yml`, `.env.docker.example` | der Stack |
| `scripts/compose-smoke.sh`, `scripts/compose-smoke.mjs`, `scripts/compose-smoke.test.mjs` | Smoke des Stacks (CI und Abnahme) |
| `scripts/release-notes.sh`, `scripts/release-version.sh` | Notizen und Versionsprüfung des Releases |
| `.github/workflows/{tests,docker,dockerhub}.yml` | Job `image`, Release, Docker-Hub-Beschreibung |
| `app/Providers/RouteBindingServiceProvider.php` | die Route-Bindungen (vorher `routes/api.php`) |
| `app/Support/LiveAddress.php` | öffentliche Adresse der Live-Updates |
| `app/Search/CountsDocuments.php` | Zahl der Dokumente eines Index |
| `tests/Support/RepoFiles.php` | Text, YAML und `ENV` des Dockerfiles für Tests |
| `tests/Feature/Docker/{ImageTest,ComposeTest}.php`, `tests/Feature/RouteCacheTest.php`, `tests/Unit/{WorkflowsTest,ReleaseNotesTest}.php`, `tests/Unit/Support/LiveAddressTest.php` | Tests |
| `docs/{en,de}/{setup,reverse-proxy,operations,upgrading,backup}.md` | Betriebsdoku |

## Task-Übersicht

| Task | Inhalt | Modell |
|---|---|---|
| 1 | Live-Adresse des Browsers, sichere Cookies | sonnet |
| 2 | Route-Bindungen im Provider, Platzhalter-Satz, Suchindex nur bei Bedarf | sonnet |
| 3a | Image ohne Entrypoint: Dockerfile, `.dockerignore`, nginx, PHP | opus |
| 3b | Entrypoint | opus |
| 4a | `docker-compose.yml`, `.env.docker.example` | sonnet |
| 4b | `docker-compose.standalone.yml` | sonnet |
| 5a | Smoke gegen den Stack | opus |
| 5b | CI-Job `image`, Actions per SHA | sonnet |
| 6a | Doku Setup und Reverse Proxy | opus |
| 6b | Doku Betrieb, Update, Backup, README | opus |
| 7 | Release-Workflows vorbereiten | sonnet |
| 8 | Abnahme mit Colima, Texte | opus |

Reihenfolge wie die Tabelle; 4a braucht 3b nicht, aber den Pin der Datenbank-Images aus `tests.yml`/DDEV; 5a braucht 3b und 4a; 6a braucht 4b (eingebettete Datei).

---

### Task 1: Live-Adresse des Browsers und sichere Cookies

**Modell:** sonnet

**Files:**
- Create: `app/Support/LiveAddress.php`, `tests/Unit/Support/LiveAddressTest.php`
- Modify: `config/werkbuch.php` (`live`), `config/session.php` (`secure`), `app/Http/Middleware/HandleInertiaRequests.php`, `.env.example` (`REVERB_PUBLIC_PORT=6001` als Schlüssel mit Kommentar), `.ddev/config.yaml` (`web_environment`: `- REVERB_PUBLIC_PORT=6001`), `e2e/ci.env` (`REVERB_PUBLIC_PORT=8080`), `phpunit.xml` (`<env name="REVERB_PUBLIC_PORT" value="" force="true"/>`), `tests/TestCase.php` (`$_SERVER['REVERB_PUBLIC_PORT'] = $_ENV['REVERB_PUBLIC_PORT'] ?? '';`), `tests/Feature/InertiaTest.php`, `tests/Feature/ConfigTest.php`, `CLAUDE.md` (Shared Props `features.live`, `config/werkbuch.php`, Kommandos: `ddev restart` nach dem Update)

**Interfaces:**
- Produces:
  - `App\Support\LiveAddress::from(mixed $appUrl, mixed $host, mixed $port, mixed $scheme): array{host: ?string, port: int, scheme: 'http'|'https'}` (final, statisch, rein): `scheme` = `$scheme`, wenn `http`/`https` (klein), sonst das Schema von `$appUrl`, sonst `https`; `host` = `$host`, wenn ein nicht leerer Text, sonst der Host von `$appUrl` (klein), sonst `null`; `port` = `$port` als ganze Zahl 1–65535 (auch als Text), sonst der Port von `$appUrl`, sonst 443 bei `https`, 80 bei `http`. Ein leerer Text (`''`, so halten ihn die Tests) gilt bei allen drei als „nicht gesetzt“.
  - `config('werkbuch.live')` = `LiveAddress::from(env('APP_URL'), env('REVERB_PUBLIC_HOST'), env('REVERB_PUBLIC_PORT'), env('REVERB_PUBLIC_SCHEME'))` mit Kommentar: wo der Browser den WebSocket öffnet (in Docker `APP_URL`, nginx leitet `/app/` weiter), getrennt von `broadcasting.connections.reverb.options` (dorthin sendet der Server, in Docker intern `http://reverb:6001`; die System-Seite prüft dieselbe interne Adresse, M4).
  - `features.live` = `null` ohne Broadcaster `reverb`, ohne `broadcasting.connections.reverb.key` oder ohne `werkbuch.live.host`; sonst `{key, host, port, scheme}` mit `host`/`port`/`scheme` aus `werkbuch.live`. Form unverändert (der Browser ändert sich nicht).
  - `config('session.secure')` = `env('SESSION_SECURE_COOKIE', <Schema von APP_URL> === 'https')`.
  - Env-Dateien: `.env.example` bekommt `REVERB_PUBLIC_PORT=6001` als **Schlüssel** (nie nur als Kommentar), darüber ein Kommentar auf Englisch: „Port where the browser reaches Reverb when it is not under APP_URL (DDEV: 6001); empty = the port of APP_URL. REVERB_PUBLIC_HOST/REVERB_PUBLIC_SCHEME likewise, empty = from APP_URL.“ `e2e/ci.env` bekommt `REVERB_PUBLIC_PORT=8080`. So haben beide Dateien dieselben Schlüssel, `tests/Unit/CiEnvTest.php` bleibt unverändert grün. `.ddev/config.yaml` behält zusätzlich `- REVERB_PUBLIC_PORT=6001` in `web_environment` (deckt ein älteres `.env` ohne den Schlüssel ab; die echte Umgebung gewinnt).
  - Tests: DDEV setzt `REVERB_PUBLIC_PORT` in `$_SERVER` jedes Pest-Laufs; damit wäre `werkbuch.live.port` in Tests 6001 statt des Ports aus `APP_URL`. Darum `phpunit.xml` `<env name="REVERB_PUBLIC_PORT" value="" force="true"/>` und in `tests/TestCase.php` neben den Drosseln `$_SERVER['REVERB_PUBLIC_PORT'] = $_ENV['REVERB_PUBLIC_PORT'] ?? '';` (Kommentar wie dort: DDEV-Env erreicht `$_SERVER`, Laravel liest es vor den erzwungenen Werten).

- [ ] **Step 1: Failing Tests** —
  - `LiveAddressTest`: „takes host, port and scheme from APP_URL behind a TLS proxy“ (`https://pm.example.com`, Rest `null` → `['host' => 'pm.example.com', 'port' => 443, 'scheme' => 'https']`); „keeps the port of APP_URL“ (`http://localhost:7740` → `localhost`, 7740, `http`); „lets REVERB_PUBLIC_PORT point at a port of its own as in DDEV“ (`https://werkbuch.ddev.site`, Port `'6001'` → 6001, `https`); „and the CI“ (`http://127.0.0.1:8000`, Port `'8080'` → `127.0.0.1`, 8080, `http`); „ignores a port or scheme it cannot use“ (`''`, `'abc'`, `'0'`, `'70000'`, `'wss'` → Werte aus `APP_URL`); „has no host without a usable APP_URL“ (`null`, `''`, `'not a url'` → `host` `null`); „writes the host in lower case“.
  - `InertiaTest`: „shares the live settings when Reverb is the broadcaster“ setzt `werkbuch.live` = `['host' => 'pm.example.com', 'port' => 443, 'scheme' => 'https']` und `broadcasting.connections.reverb.options` = `['host' => 'reverb', 'port' => 6001, 'scheme' => 'http']` → `features.live` = `{key, host: 'pm.example.com', port: 443, scheme: 'https'}` (nie `reverb`); „shares no live settings while the key or the host of Reverb is missing (T2-M3)“ nimmt `werkbuch.live.host` `null` statt des Hosts der Verbindung.
  - `ConfigTest`: „keeps the limits of the environment of DDEV out of the tests“ nimmt `'REVERB_PUBLIC_PORT' => ''` in seine Liste auf (prüft die Zeile in `tests/TestCase.php`); `afterEach` setzt zusätzlich `setEnv('REVERB_PUBLIC_PORT', '')`; „reads the environment“ um `REVERB_PUBLIC_PORT` `'7000'` → `config('werkbuch.live.port')` `7000` ergänzen; neu „takes secure cookies from the scheme of APP_URL unless SESSION_SECURE_COOKIE says otherwise“ (über `setEnv()`: `https://…` → `true`, `http://localhost:7740` → `false`, `SESSION_SECURE_COOKIE=false` mit https → `false`); neu „points the browser at Reverb's own port in DDEV and the CI“ (`.ddev/config.yaml` enthält `- REVERB_PUBLIC_PORT=6001`, `.env.example` enthält `\nREVERB_PUBLIC_PORT=6001\n`, `e2e/ci.env` enthält `\nREVERB_PUBLIC_PORT=8080\n`); neu „takes the port of APP_URL in the tests, whatever DDEV sets“ (ohne `setEnv` → `config('werkbuch.live.port')` = Port von `config('app.url')` bzw. 80/443).
- [ ] **Step 2: RED** — `ddev artisan test --filter='LiveAddress|InertiaTest|ConfigTest|CiEnvTest'` → scheitert an der fehlenden Klasse, an `features.live.host` `reverb` und an der fehlenden Zeile in `TestCase.php`; `CiEnvTest` ist grün und muss es nach Step 3 bleiben.
- [ ] **Step 3: Umsetzen** wie unter Interfaces.
- [ ] **Step 4: G1**, dann `ddev restart` und **G3 gezielt** (Live in DDEV und Browser unverändert).
- [ ] **Step 5: Commit** — `feat: give the browser the public address of the live updates, apart from the one the server sends to`.

---

### Task 2: Route-Bindungen im Provider, Platzhalter-Satz, Suchindex nur bei Bedarf

**Modell:** sonnet

Der Platzhalter `change-me` wird in `EnsureAdmin` schon seit Phase 1 abgelehnt (`private const PLACEHOLDER_PASSWORD`, fester englischer Satz, `tests/Feature/EnsureAdminTest.php` Datensatz „placeholder password“). Diese Task legt ihn nicht neu an, sie macht die Konstante öffentlich und den Satz übersetzbar. Dafür bekommt sie die Route-Bindungen (A430).

**Files:**
- Create: `app/Providers/RouteBindingServiceProvider.php`, `tests/Feature/RouteCacheTest.php`, `app/Search/CountsDocuments.php`
- Modify: `routes/api.php` (die zwölf `Route::bind` samt ihren `use`-Zeilen und Kommentaren heraus, oben ein Kommentar), `bootstrap/providers.php`, `tests/Unit/ArchTest.php`, `app/Actions/Auth/EnsureAdmin.php`, `app/Console/Commands/SearchImportCommand.php`, `app/Search/{SearchIndexer,MeilisearchEngine}.php`, `tests/Support/ArraySearchEngine.php`, `lang/{en,de}.json`, `tests/Feature/EnsureAdminTest.php`, `tests/Feature/Console/SearchCommandsTest.php`, `tests/Feature/Search/SearchIndexerTest.php`, `tests/Integration/MeilisearchEngineTest.php`, `CLAUDE.md` (jede Angabe „`Route::bind` in `routes/api.php`“ — REST, Items, Kommentare, Anhänge, Views, Wiki, Vorlagen, Webhooks, Fallstricke zu `{project}`, `{item}`, `{view}`, `{page}`, `{template}` — nennt danach `App\Providers\RouteBindingServiceProvider`; neuer Fallstrick „Route-Bindungen nur im Provider: mit gecachten Routen (das Image) läuft keine Datei unter `routes/`, `ArchTest` und `RouteCacheTest` halten das fest“; Kommandos: `app:search-import --if-empty`; „Suche: Index“)

**Interfaces:**
- Produces:
  - `App\Providers\RouteBindingServiceProvider` (final, `extends ServiceProvider`, `boot()`): die zwölf Bindungen aus `routes/api.php` (`project`, `item`, `relation`, `view`, `comment`, `attachment`, `notification`, `page`, `pageVersion`, `template`, `webhook`, `delivery`) **unverändert** in derselben Reihenfolge, mit ihren Kommentaren und Imports. Grund (Klassenkommentar): `php artisan optimize` cacht die Routen; mit gecachten Routen lädt Laravel `routes/*.php` nicht, und ein `Route::bind` dort liefe nie — `{item}` und `{project}` bänden dann per Primärschlüssel (404 für Keys und Kennungen, kein 301 für frühere). `bootstrap/providers.php`: direkt nach `AppServiceProvider`. `routes/api.php` behält oben einen Kommentar: „Route parameters are bound in App\Providers\RouteBindingServiceProvider: with cached routes (the image) this file never runs.“
  - `EnsureAdmin::PLACEHOLDER = 'change-me'` (`public const`, umbenannt aus `private const PLACEHOLDER_PASSWORD`; `ComposeTest` liest ihn). Verhalten wie bisher: nur wenn ein Konto **angelegt** würde (nach `NotConfigured`, `Exists`, `AccountsExist`) und nach `PasswordRules`, dann `ValidationException` an `password`, jetzt mit `__('field.admin_password.placeholder')` („ADMIN_PASSWORD is still the placeholder change-me: choose your own password before the first start.“ / „ADMIN_PASSWORD ist noch der Platzhalter change-me: wähle vor dem ersten Start ein eigenes Passwort.“; beide Sätze enthalten das Wort `placeholder` bzw. `Platzhalter`). `app:ensure-admin` endet dann wie bisher mit `FAILURE` (der Entrypoint stoppt). `NotConfigured` bleibt eine Warnung mit Exitcode 0; kein neuer Exitcode.
  - `interface App\Search\CountsDocuments { public function documentCount(string $index): int; }` — Zahl der Dokumente eines Index, `0` für einen Index, den es nicht gibt. `MeilisearchEngine` implementiert es über `$this->meilisearch->index($index)->stats()['numberOfDocuments']` (`ApiException` mit `index_not_found` → `0`, jede andere Ausnahme fliegt); `ArraySearchEngine` über die Zahl ihrer Dokumente.
  - `SearchIndexer::needsImport(): bool` — `true`, wenn für einen der vier Indizes aus `MODELS` die Engine `CountsDocuments` ist, `documentCount(searchableAs())` `0` ist und `makeAllSearchableQuery()->exists()` (ein Index ohne Dokumente, obwohl es Zeilen gibt: neues Meilisearch-Volume, erster Start); eine Engine ohne `CountsDocuments` (`null`) → `false`.
  - `app:search-import {--if-empty}`: mit `--if-empty` und `needsImport()` falsch nur „The search indexes have their documents; nothing imported.“ und `SUCCESS`, sonst wie bisher `rebuild()`.

- [ ] **Step 1: Failing Tests** —
  - `ArchTest`: „binds route parameters in a provider, never in a route file“ (Text jeder Datei aus `glob(repo_path('routes/*.php'))`: kein `Route::bind(`, `Route::model(`, `Route::pattern(`).
  - `tests/Feature/RouteCacheTest.php` „keeps every route binding with cached routes“: Closure `$artisan = fn (array $args) => Process::path(base_path())->env(['APP_ROUTES_CACHE' => $cache])->timeout(120)->run(['php', 'artisan', ...$args])` mit `$cache = sys_get_temp_dir().'/werkbuch-routes-'.Str::random(12).'.php'`; erst `route:cache` → erfolgreich, dann `tinker --execute` mit einem Ausdruck, der eine Zeile `ROUTES:` + `json_encode(['cached' => app()->routesAreCached(), 'bound' => <je der zwölf Namen getBindingCallback($name) !== null>, 'search' => Route::getRoutes()->getByName('api.search') !== null])` ausgibt; der Test liest die Zeile mit dem Präfix und erwartet `cached` `true`, jeden der zwölf Namen `true` (Liste im Test ausgeschrieben, jeder einzeln geprüft), `search` `true`. Die Temp-Datei geht in einem `finally` weg; der Test fasst `bootstrap/cache` des Repos nie an (prüft am Ende, dass `bootstrap/cache/routes-v7.php` nicht entstand).
  - `EnsureAdminTest`: „names the placeholder with the sentence of lang“ (`ADMIN_PASSWORD=change-me` → Ausgabe enthält `__('field.admin_password.placeholder')`, Exitcode 1, keine Person); „does not mind the placeholder once accounts exist“ (Person vorhanden → `AccountsExist`, Exitcode 0) — hält bestehendes Verhalten fest, ist also schon grün (im Bericht sagen); der Datensatz „placeholder password“ des bestehenden Tests bleibt.
  - `SearchIndexerTest`: „needs an import while an index has no documents but its table has rows“ (`searchEngine()` leer, Standard-Bot vorhanden → `true`); „needs none once every index with rows has documents“ (nach `rebuild()` → `false`); „needs none for an empty table“ (keine Items/Seiten/Projekte, `users` indexiert → `false`); „needs none without an engine that counts“ (`scout.driver` `null` → `false`).
  - `SearchCommandsTest`: „imports with --if-empty only when an index lacks its documents“ (beide Zweige, `$engine->writes()` zählt).
  - `tests/Integration/MeilisearchEngineTest`: „counts the documents of an index and 0 for a missing one“ (`Meili::use()`, Index fehlt → 0; nach `rebuild()` + `Meili::settle()` → Zahl der Konten).
- [ ] **Step 2: RED** — `ddev artisan test --filter='ArchTest|RouteCacheTest|EnsureAdminTest|SearchIndexerTest|SearchCommandsTest'`: `ArchTest` und `RouteCacheTest` (`bound` `false` für alle zwölf) scheitern vor der Verschiebung, der Satz-Test am alten Satz, die Such-Tests an der fehlenden Methode bzw. Option.
- [ ] **Step 3: Umsetzen** — zuerst die Bindungen verschieben, `RouteCacheTest` und `ArchTest` grün; dann Platzhalter und Suche.
- [ ] **Step 4: G1** + `ddev artisan test --testsuite=Integration --filter=MeilisearchEngine`.
- [ ] **Step 5: Commits** — `fix: bind route parameters in a provider, so cached routes keep them` (Provider, `routes/api.php`, `ArchTest`, `RouteCacheTest`, CLAUDE.md-Angaben zu den Bindungen), dann `feat: name the placeholder admin password in the words of lang and import the search only when an index is empty`.

---

### Task 3a: Image ohne Entrypoint: Dockerfile, `.dockerignore`, nginx, PHP

**Modell:** opus

Der Entrypoint ist in dieser Task ein Stub (Task 3b schreibt ihn ganz): `#!/bin/sh`, `set -e`, `cd /var/www/html`, `php artisan config:clear --no-interaction`, `php artisan optimize --no-interaction`. Damit lässt sich das Image bauen; `ImageTest` prüft den Entrypoint hier nicht.

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker/entrypoint.d/99-werkbuch.sh` (Stub, ausführbar, `git update-index --chmod=+x`), `docker/nginx/conf.d/00-werkbuch.conf`, `docker/nginx/server-opts.d/werkbuch.conf`, `docker/nginx/server-opts.d/security.conf`, `docker/php/zz-werkbuch.ini`, `tests/Support/RepoFiles.php`, `tests/Feature/Docker/ImageTest.php`
- Modify: `composer.json`/`composer.lock` (`symfony/yaml` dev), `CLAUDE.md` (Tech Stack: Docker-Basis v5.0.4 und Node-Stage; Architektur „Docker: Image“ (Stages, Rechte, nginx, PHP-Einstellungen); Fallstricke: `$request_uri` statt `$uri` im Log, Reverb in nginx über `resolver 127.0.0.11`, jede neue `DocReference`-Seite gehört in `.dockerignore` und Dockerfile, HSTS nur am Proxy, keine Variable mit den Präfixen der Basis leer setzen)

**Interfaces:**
- Produces:
  - `Tests\Support\RepoFiles` (final, statisch): `text(string $path): string` (scheitert per `expect`, wenn die Datei fehlt), `yaml(string $path): array` (`Yaml::parse(…, Yaml::PARSE_CUSTOM_TAGS)`), `dockerfileEnv(string $name): string` (Wert von `NAME=value` im `ENV` der Stage `app`), `bytes(string $size): int` (`32M` → Bytes).
  - **Dockerfile** (zwei Stages; Werte bindend, Kommentare im Stil von openbill):
    ```dockerfile
    # syntax=docker/dockerfile:1
    FROM --platform=$BUILDPLATFORM node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c AS assets
    WORKDIR /app
    ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
    RUN corepack enable && corepack install
    COPY docs/package.json docs/
    COPY prototypes/clickdummy/package.json prototypes/clickdummy/
    # the whole workspace, like openbill: the store cache makes docs and clickdummy cheap, none of it reaches the image
    RUN --mount=type=cache,id=werkbuch-pnpm-store,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
    COPY vite.config.ts tsconfig.json ./
    COPY resources ./resources
    RUN pnpm build

    FROM serversideup/php:8.4.27-fpm-nginx-trixie-v5.0.4@sha256:c91d4ff3cb30582078050735b42e873a196d60a406a68cff14bda79e3b5fff56 AS app
    LABEL org.opencontainers.image.{title,description,source=https://github.com/baeroe/werkbuch,licenses=MIT}
    ENV AUTORUN_ENABLED=false SSL_MODE=off TRUSTED_PROXY=off SHOW_WELCOME_MESSAGE=false \
        PHP_OPCACHE_ENABLE=1 PHP_MEMORY_LIMIT=512M PHP_UPLOAD_MAX_FILE_SIZE=30M PHP_POST_MAX_SIZE=32M NGINX_CLIENT_MAX_BODY_SIZE=32M \
        APP_NAME=werkbuch APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr LOG_LEVEL=info \
        DB_CONNECTION=mariadb DB_HOST=mariadb DB_PORT=3306 DB_DATABASE=werkbuch DB_USERNAME=werkbuch \
        SESSION_DRIVER=database SESSION_LIFETIME=10080 CACHE_STORE=database QUEUE_CONNECTION=database MEDIA_QUEUE=media \
        BROADCAST_CONNECTION=reverb REVERB_APP_ID=werkbuch REVERB_HOST=reverb REVERB_PORT=6001 REVERB_SCHEME=http \
        REVERB_SERVER_HOST=0.0.0.0 REVERB_SERVER_PORT=6001 \
        SCOUT_DRIVER=meilisearch MEILISEARCH_HOST=http://meilisearch:7700 SCOUT_PREFIX= MAIL_MAILER=log FILESYSTEM_DISK=local
    USER root
    RUN install-php-extensions intl bcmath gd exif
    COPY --chmod=755 docker/entrypoint.d/ /etc/entrypoint.d/
    COPY --chmod=644 docker/nginx/conf.d/ /etc/nginx/conf.d/
    # werkbuch.conf (log, Reverb) and security.conf (the base's headers without HSTS, A419)
    COPY --chmod=644 docker/nginx/server-opts.d/ /etc/nginx/server-opts.d/
    COPY --chmod=644 docker/php/zz-werkbuch.ini /usr/local/etc/php/conf.d/zz-werkbuch.ini
    WORKDIR /var/www/html
    COPY --chmod=644 composer.json composer.lock ./
    RUN --mount=type=cache,target=/composer/cache composer check-platform-reqs --no-dev \
        && composer install --no-dev --no-interaction --no-progress --prefer-dist --no-scripts --no-autoloader
    COPY artisan LICENSE ./
    COPY app ./app
    COPY bootstrap ./bootstrap
    COPY config ./config
    COPY database ./database
    COPY lang ./lang
    COPY public ./public
    COPY resources/views ./resources/views
    COPY routes ./routes
    # read at runtime by the MCP references (werkbuch.docs_path, A409)
    COPY docs/en/concepts/views.md docs/en/concepts/rich-text.md docs/en/concepts/types-and-properties.md ./docs/en/concepts/
    COPY --from=assets /app/public/build ./public/build
    # the base gives /var/www to www-data: whoever writes there could swap the code folder (A429)
    RUN mkdir -p storage/app/private storage/app/public storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
        && composer dump-autoload --no-dev --optimize --no-interaction \
        && chown root:root /var/www . && chmod 755 /var/www . \
        && chown -R root:root artisan LICENSE app bootstrap config database docs lang public resources routes vendor \
        && chmod -R a+rX,go-w artisan LICENSE app bootstrap config database docs lang public resources routes vendor \
        && chown root:root "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" /usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf /usr/local/etc/php-fpm.conf \
        && chmod 644 "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" /usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf /usr/local/etc/php-fpm.conf \
        && chown -R www-data:www-data storage bootstrap/cache
    USER www-data
    ```
    `composer check-platform-reqs` läuft vor `install`, weil `install --no-scripts` die Plattform nicht gegen alle Pakete prüft (Step 6 belegt, dass ohne `exif` der Build scheitert). `chown -R root:root` über die Code-Ordner (nicht nur `.`): was `COPY` in einen Ordner legt, den die Basis schon anlegte, behält dessen Eigentümer `www-data`. Die drei Debug-Dateien gehören root und bleiben lesbar (`644`): `LOG_OUTPUT_LEVEL=debug` schreibt dort nichts mehr, das ist im Image nicht unterstützt (Doku, Task 6b). `/etc/nginx` bleibt beschreibbar, weil die Basis beim Start ihre Templates dorthin schreibt (A429). Der Composer-Cache liegt in einem Cache-Mount, nie in der Schicht. `pnpm install` ohne `--filter` (wie openbill erprobt), kein Versuch mit Filter.
  - **`.dockerignore`** (Kontext, nie Inhalt des Images): `.git`, `.github`, `.ddev`, `.superpowers`, `.claude`, `.idea`, `.vscode`, `.env`, `.env.*`, `**/node_modules`, `.pnpm-store`, `vendor`, `storage`, `bootstrap/cache/*.php`, `public/build`, `public/hot`, `public/storage`, `coverage`, `e2e`, `tests`, `scripts`, `*.log`, `**/.DS_Store`, `docker-compose*.yml`, `CLAUDE.md`; `docs/*` mit `!docs/package.json`, `!docs/en`, `docs/en/*`, `!docs/en/concepts`, `docs/en/concepts/*` und je Referenz-Seite `!docs/en/concepts/<seite>.md`; `prototypes/*/*` mit `!prototypes/*/package.json`. **Nicht** `public/vendor` (Stoplight samt LICENSE, A389).
  - **`docker/nginx/conf.d/00-werkbuch.conf`** (http-Kontext; `00-` sortiert vor `default.conf`, damit Format und Variablen beim Lesen des Servers bekannt sind):
    ```nginx
    map $request_uri $werkbuch_logged_uri {
        ~^/reset-password/   /reset-password/…;
        ~^/api/mcp/uploads/  /api/mcp/uploads/…;
        "~^(?<werkbuch_path>[^?]*)"  $werkbuch_path;
    }
    # the compose health check asks /up every 10 s from inside the container; anyone else's /up is logged
    map "$remote_addr $request_uri" $werkbuch_loggable {
        "~^(127\.0\.0\.1|::1) /up(\?|$)"  0;
        default  $loggable;
    }
    log_format werkbuch '$remote_addr - [$time_local] "$request_method $werkbuch_logged_uri $server_protocol" $status $body_bytes_sent $request_time "$http_user_agent" "$http_x_forwarded_for"';
    ```
    (`$request_uri`, nicht `$uri`: nach `try_files` hieße jede Zeile `/index.php`. `$loggable` kommt aus `nginx.conf` der Basis und lässt nur `/healthcheck` aus. `$http_x_forwarded_for` ist kein Geheimnis und hinter einem Proxy die einzige Spur der Client-Adresse. `::1` neben `127.0.0.1`, weil `curl localhost` im Container IPv6 nehmen kann.)
  - **`docker/nginx/server-opts.d/werkbuch.conf`** (server-Kontext, serversideup bindet `server-opts.d/*.conf` ein):
    ```nginx
    access_log /dev/stdout werkbuch if=$werkbuch_loggable;
    resolver 127.0.0.11 valid=10s ipv6=off;
    # only the WebSocket; Reverb's HTTP API (/apps/) stays inside the stack, the server sends to reverb:6001 (A415)
    location ^~ /app/ {
        set $werkbuch_reverb http://reverb:6001;
        proxy_pass $werkbuch_reverb;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
    }
    ```
    Die Adresse über eine Variable: nginx löst `reverb` erst bei der Anfrage über das DNS von Docker auf und startet, bevor Reverb läuft. Kein `location` für `/apps`: eine Anfrage dorthin geht an Laravel und endet mit 404.
  - **`docker/nginx/server-opts.d/security.conf`**: ersetzt die gleichnamige Datei der Basis. Inhalt = die Datei aus dem Basis-Image v5.0.4 (`docker run --rm --entrypoint cat <Pin der Tabelle> /etc/nginx/server-opts.d/security.conf`) **wörtlich ohne** die Zeile `add_header Strict-Transport-Security …` (sie setzt `max-age=31536000; includeSubDomains` an jede Antwort: hinter einem TLS-Proxy reicht der Proxy das durch, und unter einer Apex-Domain zwänge die Voreinstellung ein Jahr lang alle Subdomains auf https). `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` und die `deny`-Locations für Dotfiles und `*.sh|.sql|.log|.ini|…` bleiben unverändert. Oben ein Kommentar: Herkunft (serversideup/docker-php v5.0.4, `server-opts.d/security.conf`), was fehlt und warum (HSTS setzt der Proxy, A419); beim Heben der Basis mit der neuen Datei vergleichen.
  - **`docker/php/zz-werkbuch.ini`**: `zend.exception_ignore_args = On`, `expose_php = Off`, `session.upload_progress.enabled = Off` (die ersten beiden stehen schon in der ini der Basis, die dritte setzt v5.0.3; doppelte Sicherung für Test und Smoke, falls die Basis zurückgeht).

- [ ] **Step 1: Paket und Prüfung** — `ddev composer require --dev "symfony/yaml:^8.1.10"`, dann `ddev composer update symfony/yaml:8.1.10` (Lock auf 8.1.10). Die beiden FROM-Digests per `docker buildx imagetools inspect` gegen die Tabelle prüfen. Läuft die Task vor dem 2026-11-09, gilt für v5.0.4 der Sicherheitssatz von A414 (kein Stopp wegen des Alters).
- [ ] **Step 2: Failing Tests** — `tests/Feature/Docker/ImageTest.php` (über `RepoFiles`):
  - „pins both base images by version and digest, on glibc“ (genau zwei `FROM`, beide `/^[a-z0-9\/._-]+:[\w.-]+@sha256:[0-9a-f]{64}$/`, genau die Refs der Tabelle — `serversideup/php:8.4.27-fpm-nginx-trixie-v5.0.4@sha256:c91d4ff3…` und `node:24.22.0-trixie-slim@sha256:a6155384…` —, keiner enthält `alpine`, A381);
  - „builds the assets with pnpm from corepack, never npm“ (`corepack enable`, `pnpm install --frozen-lockfile` **ohne** `--filter`, `RUN pnpm build`, kein `npm`/`npx`);
  - „installs the PHP extensions the code needs and checks the platform“ (`install-php-extensions intl bcmath gd exif`, `composer check-platform-reqs --no-dev` vor `composer install`);
  - „has every extension the CI tests with“ (die Liste `extensions:` jedes `setup-php`-Schritts in `.github/workflows/tests.yml`, heute `intl, zip, bcmath, pdo_mysql, gd`, ⊆ den Namen hinter `install-php-extensions` ∪ den Erweiterungen der Basis `opcache pcntl pdo_mysql pdo_pgsql redis zip`, im Test als Konstante mit Kommentar „serversideup v5.0.4“; dazu `exif`, weil `spatie/image` es verlangt). Grund: `ext-intl` (`App\Domain\Emoji`) und `ext-gd` (`media-library.image_driver`) verlangt kein Paket, `check-platform-reqs` fände ihr Fehlen nicht;
  - „lets uploads up to ATTACHMENTS_MAX_MB through PHP and nginx and gives PHP 512 MB“ (`bytes(PHP_UPLOAD_MAX_FILE_SIZE)` ≥ `Attachment::DEFAULT_MAX_MB` MiB, `PHP_POST_MAX_SIZE` > Upload, `NGINX_CLIENT_MAX_BODY_SIZE` ≥ Post, `PHP_MEMORY_LIMIT` = 512 MiB, `APP_ENV` `production`, `APP_DEBUG` `false`, `TRUSTED_PROXY` `off`, `AUTORUN_ENABLED` `false`);
  - „sends to Reverb inside the stack and works the queues of the database“ (`REVERB_HOST` `reverb`, `REVERB_PORT` = `REVERB_SERVER_PORT` = `6001`, `REVERB_SCHEME` `http`, `QUEUE_CONNECTION` `database`, `BROADCAST_CONNECTION` `reverb`, `SCOUT_DRIVER` `meilisearch`, `MEILISEARCH_HOST` `http://meilisearch:7700`, `LOG_CHANNEL` `stderr`, `APP_NAME` `werkbuch`);
  - „ships the docs the MCP references read“ (je Unterklasse von `App\Mcp\Resources\DocReference` per Reflection `page()` (protected, ohne `setAccessible`) → `.dockerignore` enthält `!docs/en/<page>` und das Dockerfile kopiert `docs/en/<page>`);
  - „ships Stoplight with its license“ (`.dockerignore` schließt `public/vendor` nicht aus, `public/vendor/stoplight-elements/8.4.2/LICENSE` existiert, `COPY public ./public`);
  - „keeps secrets, dependencies and local files out of the build context“ (`.dockerignore` enthält `.env`, `.env.*`, `**/node_modules`, `vendor`, `storage`, `bootstrap/cache/*.php`, `.git`, `.ddev`, `.superpowers`, `.claude`, `e2e`, `tests`, `coverage`, `prototypes/*/*`);
  - „keeps the code read-only for PHP, only storage and bootstrap/cache writable“ (Stage `app` ohne `--chown`; im letzten `RUN` vor `USER www-data` in dieser Reihenfolge: `chown root:root /var/www .` und `chmod 755 /var/www .`, `chown -R root:root` und `chmod -R a+rX,go-w` je über eine Liste mit `app`, `vendor`, `public`, `config`, `routes`, dann `chown root:root` **und** `chmod 644` über `$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini`, `/usr/local/etc/php-fpm.d/zzz-docker-php-serversideup-fpm-debug.conf`, `/usr/local/etc/php-fpm.conf`, zuletzt `chown -R www-data:www-data storage bootstrap/cache`; der letzte `USER` ist `www-data`);
  - „keeps the Composer cache out of the image“ (der `RUN` mit `composer install` hat `--mount=type=cache,target=/composer/cache`);
  - „hides the arguments in stack traces and keeps the session upload progress off“ (`zz-werkbuch.ini` enthält `zend.exception_ignore_args = On` und `session.upload_progress.enabled = Off`, Dockerfile kopiert sie nach `/usr/local/etc/php/conf.d/`);
  - „logs no query string, no referer, no reset token and no health check of its own, but the forwarded address“ (`00-werkbuch.conf`: `log_format werkbuch` ohne `$request `, `$args`, `$query_string`, `$http_referer`, mit `$http_x_forwarded_for`; `map $request_uri` maskiert `/reset-password/` und `/api/mcp/uploads/`; `map "$remote_addr $request_uri" $werkbuch_loggable` mit `127\.0\.0\.1`, `::1`, `/up` und `default $loggable`; `server-opts.d/werkbuch.conf` setzt `access_log … werkbuch if=$werkbuch_loggable`);
  - „passes /app/ on to Reverb, resolved at request time, and never Reverb's HTTP API“ (`location ^~ /app/` mit `Upgrade` und `Connection "upgrade"`, `resolver 127.0.0.11`, `proxy_pass $werkbuch_reverb`, kein `proxy_pass http://reverb` direkt; in keiner Datei unter `docker/nginx/` eine Zeile `location` mit `/apps`);
  - „leaves HSTS to the TLS proxy“ (keine Datei unter `docker/nginx/` enthält `Strict-Transport-Security`; `security.conf` enthält `X-Content-Type-Options` und die `deny`-Location für Dotfiles, `location ~ /\.`; das Dockerfile kopiert `server-opts.d/` nach `/etc/nginx/server-opts.d/`).
- [ ] **Step 3: RED** — `ddev artisan test --filter=ImageTest` → scheitert (Dateien fehlen).
- [ ] **Step 4: Umsetzen** wie unter Interfaces, Entrypoint als Stub.
- [ ] **Step 5: G1**.
- [ ] **Step 6: GI** — Build, dann
  ```bash
  docker run --rm --entrypoint sh werkbuch:local -c '
    id -u; php -m; getconf GNU_LIBC_VERSION
    php -r "echo ini_get(\"zend.exception_ignore_args\"), \"|\", ini_get(\"session.upload_progress.enabled\"), \"\n\";"
    php -r "foreach ([\"JPEG Support\",\"PNG Support\",\"WebP Support\"] as \$k) if (!gd_info()[\$k]) exit(1);"
    dpkg-query -W -f="\${Version}\n" libbrotli1
    test ! -w /var/www && test ! -w /var/www/html && test ! -w app && test ! -w vendor && test ! -w public \
      && test ! -w "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" && test -w storage && echo rights-ok'
  ```
  → UID 33, `intl`, `gd`, `exif`, `bcmath`, `pcntl`, `pdo_mysql` in der Liste, `glibc …`, `1|` oder `1|0`, Exitcode des GD-Checks 0, `1.1.0-2+deb13u1`, `rights-ok`. Gegenprobe einmal (danach zurück): ohne `exif` in `install-php-extensions` scheitert der Build an `check-platform-reqs`.
- [ ] **Step 7: Commit** — `feat: build the werkbuch image: read-only code, nginx with reverb, no hsts from the container`.

---

### Task 3b: Entrypoint

**Modell:** opus

**Files:**
- Modify: `docker/entrypoint.d/99-werkbuch.sh` (vollständig), `tests/Feature/Docker/ImageTest.php` (Entrypoint-Fälle), `CLAUDE.md` (Architektur „Docker: Entrypoint“: Rollen, Schlüssel im Volume, Reihenfolge des Starts; Fallstricke: Skripte in `/etc/entrypoint.d` laufen in einer Subshell — exportierte Variablen erreichen das Kommando nie, nur der Config-Cache trägt `APP_KEY` und die Reverb-Schlüssel, darum nie `php artisan config:clear` oder `optimize:clear` im laufenden Container, sondern `docker compose restart <dienst>`; `STOPSIGNAL SIGQUIT` der Basis; der eingebaute Healthcheck der Basis prüft nur nginx)
- Consumes: Task 2 (`app:search-import --if-empty`, Platzhalter in `app:ensure-admin`), Task 3a (Image).

**Interfaces:**
- Produces:
  - **`docker/entrypoint.d/99-werkbuch.sh`** (POSIX `sh`, `set -e`, `cd /var/www/html`, `log() { echo "werkbuch: $*"; }`), Schritte in dieser Reihenfolge:
    0. `DB_PASSWORD` oder `MEILISEARCH_KEY` = `change-me` → `log "<NAME> is still the placeholder change-me: …" >&2; exit 1` (vor jedem Dateizugriff).
    1. Rolle: `web`, wenn `SERVERSIDEUP_DEFAULT_COMMAND` = `true` (serversideups Entrypoint exportiert es für `/init`), sonst `worker`.
    2. `mkdir -p storage/app/private storage/app/public` (nur `web`; Reverb hängt das Volume nur lesend ein).
    3. Schlüssel je `APP_KEY` (Datei `storage/app/.app-key`, Wert `base64:` + 32 Zufallsbytes), `REVERB_APP_KEY` (`storage/app/.reverb-app-key`, 20 Hex-Zeichen), `REVERB_APP_SECRET` (`storage/app/.reverb-app-secret`, 64 Hex-Zeichen): aus der Env, sonst aus der Datei, sonst (nur `web`) einmal erzeugt mit `umask 077` aus `/dev/urandom` (`head -c`/`od`/`base64`, kein PHP) **in `<datei>.tmp`, dann `mv` auf `<datei>`** (bricht der Start mitten im Schreiben ab, liegt nie eine halbe Datei im Volume; eine liegengebliebene `.tmp` überschreibt der nächste Start), sonst (`worker`) `log "… missing: start the werkbuch service first" >&2; exit 1`; danach `export`.
    4. `php artisan config:clear --no-interaction`.
    5. nur `web`: auf die Datenbank warten (`DB_WAIT_TIMEOUT`, Standard 60 s, `PDO` mit `ATTR_TIMEOUT` 3 wie openbill), `php artisan migrate --force`, dann `out=$(php artisan app:ensure-admin)` (scheitert das Kommando, endet der Start mit seinem Exitcode; die Ausgabe wird vorher ausgegeben), die Ausgabe ausgeben, und enthält sie die Warnung von `NotConfigured` (`ADMIN_EMAIL/ADMIN_PASSWORD are not set`), zusätzlich `log "no account yet, set ADMIN_EMAIL and ADMIN_PASSWORD and restart"` (kein Abbruch); dann `php artisan app:search-sync`, `php artisan app:search-import --if-empty`.
    6. `php artisan optimize` (Config mit den Schlüsseln, Routen samt `routes/ai.php` — die Bindungen stehen im Provider, Task 2 —, Views, Events; jeder Container baut seinen eigenen Cache, weil die Skripte in einer Subshell laufen und exportierte Variablen nie das Kommando erreichen).
    7. nur `web`: `php artisan scramble:cache`; Warnung (kein Abbruch), wenn `ATTACHMENTS_MAX_MB` MB über `post_max_size` liegt (`php -r`); `log "ready"`. `worker`: `log "ready: $DOCKER_CMD"`.

- [ ] **Step 1: Failing Tests** — in `ImageTest` (Closure `$entrypoint = fn (array $env, ?string $role = 'true'): Process` kopiert das Skript mit `cd <tempdir>` in ein Temp-Verzeichnis und legt ein falsches `php` vor den `PATH`, das seine Argumente in `$LOG` schreibt, für `artisan app:ensure-admin` den Inhalt von `$FAKE_ENSURE_ADMIN` ausgibt und `0` liefert):
  - „is a script a POSIX shell accepts“ (`sh -n`);
  - „stops before anything else while DB_PASSWORD or MEILISEARCH_KEY is the placeholder“ (Exitcode 1, Satz, kein `storage/`);
  - „runs the web start in order“ (Rolle `true`: die `artisan`-Aufrufe in der Reihenfolge `config:clear`, `migrate --force`, `app:ensure-admin`, `app:search-sync`, `app:search-import --if-empty`, `optimize`, `scramble:cache`);
  - „says how to get the first account when there is none“ (`FAKE_ENSURE_ADMIN` = die Warnung von `NotConfigured` → Ausgabe enthält `werkbuch: no account yet`, Exitcode 0; mit `Accounts exist already…` fehlt die Zeile);
  - „starts a worker without migrating“ (Rolle `false`, Schlüssel-Dateien vorhanden: nur `config:clear`, `optimize`);
  - „generates the keys once and keeps them in the volume“ (zwei Läufe → gleiche Inhalte in `.app-key`, `.reverb-app-key`, `.reverb-app-secret`, Modus `0600`, Formate `^base64:[A-Za-z0-9+/=]{44}$`, `^[0-9a-f]{20}$`, `^[0-9a-f]{64}$`);
  - „leaves no .tmp behind“ (nach dem ersten Lauf keine Datei `storage/app/*.tmp`; eine vorher hingelegte `storage/app/.app-key.tmp` mit Müll ist danach weg bzw. überschrieben, `.app-key` hat das richtige Format);
  - „takes keys from the environment and writes no file“;
  - „refuses to start a worker without the keys of the web service“ (Rolle `false`, keine Dateien, keine Env → Exitcode 1).
- [ ] **Step 2: RED** — `ddev artisan test --filter=ImageTest` → die Entrypoint-Fälle scheitern am Stub, die Fälle aus 3a bleiben grün.
- [ ] **Step 3: Umsetzen** wie unter Interfaces.
- [ ] **Step 4: G1** und **GI** — Build, die Prüfung aus Task 3a Step 6 erneut, dazu zwei echte Starts ohne Stack:
  - `docker run --rm -e DB_PASSWORD=change-me -e MEILISEARCH_KEY=x werkbuch:local` → Exitcode ≠ 0, Ausgabe enthält `werkbuch: DB_PASSWORD is still the placeholder change-me`.
  - `docker run --rm -e DB_PASSWORD=x -e MEILISEARCH_KEY=y werkbuch:local php artisan queue:work` → Exitcode ≠ 0, Ausgabe enthält `start the werkbuch service first`.
- [ ] **Step 5: Commit** — `feat: start every werkbuch container from one entrypoint: keys in the volume, migrations only in web`.

---

### Task 4a: Compose-Stack `docker-compose.yml`

**Modell:** sonnet

**Files:**
- Create: `docker-compose.yml`, `.env.docker.example`, `tests/Feature/Docker/ComposeTest.php`
- Modify: `tests/Feature/ConfigTest.php` („works every queue in DDEV and the CI …“ liest auch `docker-compose.yml`), `CLAUDE.md` (Architektur „Docker: Compose“)

**Interfaces:**
- Produces:
  - **`docker-compose.yml`**: oben ein Kommentar (Doku `docs/en/setup.md`, `.env` daneben, Volumes überstehen `down`, `down -v` löscht sie). `x-werkbuch-environment: &werkbuch-environment` mit `APP_URL: "${APP_URL:?APP_URL missing (public address, see .env.docker.example)}"`, `APP_LOCALE: "${APP_LOCALE:-en}"` (die Organisation nimmt ihre Sprache beim Anlegen aus `config('app.locale')`, Migration `…_000200`), `APP_KEY: "${APP_KEY:-}"`, `REVERB_APP_KEY: "${REVERB_APP_KEY:-}"`, `REVERB_APP_SECRET: "${REVERB_APP_SECRET:-}"`, `DB_PASSWORD: "${DB_PASSWORD:?…}"`, `MEILISEARCH_KEY: "${MEILISEARCH_KEY:?…}"`, `TRUSTED_PROXIES: "${TRUSTED_PROXIES:-127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7}"` (Standard = `TrustedRequests::PROXIES`; **nie** leer: `10-init-webserver-config.sh` der Basis prüft jede Variable, die mit `TRUSTED_PROXY` beginnt, und bricht bei einem leeren Wert den Start des Web-Dienstes ab — `TRUSTED_PROXIES` fällt darunter; `:-` nimmt den Standard auch für `TRUSTED_PROXIES=` in der `.env`), `MAIL_MAILER: "${MAIL_MAILER:-log}"`, `MAIL_SCHEME`, `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD` (je `:-` leer), `MAIL_PORT: "${MAIL_PORT:-587}"`, `MAIL_FROM_ADDRESS: "${MAIL_FROM_ADDRESS:-werkbuch@example.com}"`, `MAIL_FROM_NAME: "${MAIL_FROM_NAME:-werkbuch}"`, `ATTACHMENTS_MAX_MB: "${ATTACHMENTS_MAX_MB:-25}"`, `NOTIFICATION_MAIL_DELAY: "${NOTIFICATION_MAIL_DELAY:-5}"`, `WEBHOOKS_ALLOW_PRIVATE: "${WEBHOOKS_ALLOW_PRIVATE:-false}"`, `API_RATE_LIMIT: "${API_RATE_LIMIT:-600}"`, `API_SESSION_RATE_LIMIT: "${API_SESSION_RATE_LIMIT:-3000}"`, `MCP_RATE_LIMIT: "${MCP_RATE_LIMIT:-300}"`. Keine Variable mit `PHP_`, `NGINX_`, `SSL_`, `LOG_`, `APACHE_`, `HEALTHCHECK_PATH`, `TRUSTED_PROXY` und leerem Standard (aus demselben Grund). `x-werkbuch-service: &werkbuch-service` mit `image: ${WERKBUCH_IMAGE:-baeroe/werkbuch:latest}`, `restart: unless-stopped`, `security_opt: [no-new-privileges:true]`, `networks: [default, backend]`.
  - Dienste:

    | Dienst | Kommando | Volume | Healthcheck | `depends_on` (`service_healthy`) | sonst |
    |---|---|---|---|---|---|
    | `werkbuch` | Image (`/init`) | `werkbuch-data:/var/www/html/storage/app` | `sh -c` mit Host aus `APP_URL` (`h=$${APP_URL#*://}; h=$${h%%/*}; curl -fsS -o /dev/null -H "Host: $${h%%:*}" http://localhost:8080/up`), `start_period: 180s` (nginx loggt diese Abfrage nicht, `$werkbuch_loggable`, Task 3a) | `mariadb`, `meilisearch` | `ports: ["${WERKBUCH_BIND:-0.0.0.0}:${WERKBUCH_PORT:-7740}:8080"]`; `environment` = Anker + `ADMIN_EMAIL: "${ADMIN_EMAIL:?…}"`, `ADMIN_PASSWORD: "${ADMIN_PASSWORD:-}"` (nur hier) |
    | `reverb` | `php artisan reverb:start --host=0.0.0.0 --port=6001` | `werkbuch-data:/var/www/html/storage/app:ro` | `curl -fsS -o /dev/null http://localhost:6001/up` | `werkbuch` | `networks: [backend]`, `stop_signal: SIGTERM`, `ulimits.nofile` 10000/10000 (schadet nicht; ohne `ext-uv`/`ev` endet `stream_select` trotzdem bei 1024 Verbindungen, Doku) |
    | `queue` | `php artisan queue:work --queue=default,live,notifications,bulk --sleep=1 --tries=3 --max-time=3600 --memory=384` | rw | `healthcheck-queue` | `werkbuch` | `stop_signal: SIGTERM`, `stop_grace_period: 30s` |
    | `queue-index` | wie `queue`, `--queue=search,media` | rw | `healthcheck-queue` | `werkbuch` | dito; Kommentar: genau ein Container (T4-M2), nie skalieren |
    | `queue-webhooks` | wie `queue`, `--queue=webhooks` | rw | `healthcheck-queue` | `werkbuch` | dito (ein hängender Empfänger hält den Worker, T16-M5) |
    | `scheduler` | `php artisan schedule:work` | rw | `healthcheck-schedule` | `werkbuch` | `stop_signal: SIGTERM` |
    | `mariadb` | `command: ["--max-allowed-packet=64M"]` | `mariadb-data:/var/lib/mysql` | `healthcheck.sh --connect --innodb_initialized` | – | Image der CI (Tabelle), `MARIADB_DATABASE`/`MARIADB_USER` `werkbuch`, `MARIADB_PASSWORD: "${DB_PASSWORD:?…}"`, `MARIADB_ROOT_PASSWORD: "${DB_ROOT_PASSWORD:?…}"`, `MARIADB_ROOT_HOST: localhost`, `MARIADB_AUTO_UPGRADE: "1"`, `networks: [backend]`; Kommentar über `command`: wie DDEV groß genug für Sammel-Inserts der Webhook-Zustellungen (`QueueDeliveries`, je Zeile ein Body bis 1 MiB), ein Mehrfaches der 16 MiB der Voreinstellung |
    | `meilisearch` | Image | `meili-data:/meili_data` | `curl -fsS -o /dev/null http://localhost:7700/health` | – | Image von DDEV/CI, `MEILI_MASTER_KEY: "${MEILISEARCH_KEY:?…}"`, `MEILI_ENV: production`, `MEILI_NO_ANALYTICS: "true"`, `networks: [backend]` |

    `networks`: `default`, `backend` mit `internal: true`. `volumes`: `werkbuch-data`, `mariadb-data`, `meili-data`. Alle Kommandos der App-Dienste als ein Text (Compose teilt ihn ohne Shell), damit `ConfigTest` dieselbe Regex nimmt; `command` von `mariadb` als Liste.
  - **`.env.docker.example`**: jede Variable aus `docker-compose.yml` als `NAME=` bzw. kommentiert `# NAME=` mit einer Zeile Erklärung (wie openbill); Passwörter und `MEILISEARCH_KEY` leer (`MEILISEARCH_KEY` mit dem Hinweis „at least 16 characters, e.g. `openssl rand -hex 32`“), `APP_URL=https://pm.example.com`, `# APP_LOCALE=en` (`en` oder `de`, Sprache der Organisation beim ersten Start), `ADMIN_EMAIL=admin@example.com`, `WERKBUCH_BIND=0.0.0.0`, `WERKBUCH_PORT=7740`, `# TRUSTED_PROXIES=` mit „empty = the private networks“, der Satz „Remove ADMIN_PASSWORD once the admin exists“ und `app:reset-password`, oben der Satz „Never set a variable starting with PHP_, NGINX_, SSL_, LOG_ or TRUSTED_PROXY to an empty value: the web service refuses to start“ und „Keep storage/app/.app-key: it encrypts webhook secrets and second factors“. `FILESYSTEM_DISK`/`AWS_*` erscheinen nicht (A424).

- [ ] **Step 1: Failing Tests** — `tests/Feature/Docker/ComposeTest.php` (Closures `$compose = fn () => RepoFiles::yaml('docker-compose.yml')`, `$default = fn (string $value): ?string` liest `${X:-d}` → `d`, `${X:?…}` → `null`, Literal → Literal, `$appServices` = die sechs Dienste mit dem Image von werkbuch):
  - „runs the services of spec 8.1 with the workers split like DDEV“ (Dienste genau `werkbuch, reverb, queue, queue-index, queue-webhooks, scheduler, mariadb, meilisearch`; App-Dienste mit `${WERKBUCH_IMAGE:-baeroe/werkbuch:latest}`);
  - „uses the pinned MariaDB of the CI and the Meilisearch of DDEV and the CI“ (gleich `jobs.tests.services.mariadb.image` aus `tests.yml` bzw. `.ddev/docker-compose.meilisearch.yaml` und `jobs.tests.services.meilisearch.image`; Digest-Form);
  - „starts MariaDB with a packet size like DDEV and root only from inside“ (`mariadb.command` = `['--max-allowed-packet=64M']`, `MARIADB_ROOT_HOST` `localhost`);
  - „publishes only werkbuch, on 7740 unless WERKBUCH_PORT says otherwise“;
  - „keeps MariaDB, Meilisearch and Reverb on the internal network“ (`networks: [backend]`, keine `ports`, `backend.internal` `true`; App-Dienste auf `default` und `backend`);
  - „mounts the data volume where the app writes, read-only for Reverb“;
  - „starts the workers, the scheduler and Reverb only after werkbuch is healthy, werkbuch only after MariaDB and Meilisearch“;
  - „checks every service's health, werkbuch for the host of APP_URL“;
  - „stops the workers with SIGTERM and gives a job 30 seconds“;
  - „gives the admin account only to werkbuch“ (`ADMIN_*` nur dort, `ADMIN_PASSWORD` `${ADMIN_PASSWORD:-}`);
  - „ships no usable password: Compose refuses to start without them“ (`DB_PASSWORD`, `DB_ROOT_PASSWORD`, `MEILISEARCH_KEY`, `APP_URL`, `ADMIN_EMAIL` mit `:?`; in `.env.docker.example` leer bzw. Beispiel);
  - „passes no variable empty that the base image needs set“ (kein Schlüssel im `environment` eines App-Dienstes passt auf `/^(PHP_|NGINX_|SSL_|LOG_|APACHE_|HEALTHCHECK_PATH|TRUSTED_PROXY)/` und hat `$default` `''`; `$default(TRUSTED_PROXIES)` = `implode(',', TrustedRequests::PROXIES)`);
  - „takes the language of the organization from APP_LOCALE“ (`${APP_LOCALE:-en}`);
  - „keeps private webhook targets off and mail on log unless set“;
  - „documents every variable of the compose file in .env.docker.example“ (und kein `FILESYSTEM_DISK`);
  - „hardens every werkbuch container with no-new-privileges“;
  - `ConfigTest` „works every queue in DDEV, the CI and Compose, …“: `$workers('docker-compose.yml')` = dieselben drei Listen wie DDEV, ihre Vereinigung = `config('werkbuch.queues')`.
- [ ] **Step 2: RED** (`ddev artisan test --filter='ComposeTest|ConfigTest'`), **Step 3** umsetzen, **Step 4: G1** und `docker compose -f docker-compose.yml --env-file <Wegwerf-.env aus .env.docker.example mit Beispielwerten> config -q` → Exitcode 0; dieselbe `.env` mit `TRUSTED_PROXIES=` → `docker compose … config` zeigt den Standard.
- [ ] **Step 5: Commit** — `feat: add the compose stack with web, reverb, three queue workers, scheduler, mariadb and meilisearch`.

---

### Task 4b: Standalone-Datei

**Modell:** sonnet

**Files:**
- Create: `docker-compose.standalone.yml`
- Modify: `tests/Feature/Docker/ComposeTest.php`, `CLAUDE.md` (Architektur „Docker: Compose“: Standalone im Gleichschritt)
- Consumes: Task 2 (`EnsureAdmin::PLACEHOLDER`), Task 4a.

**Interfaces:**
- Produces:
  - **`docker-compose.standalone.yml`**: kein `${…}`; oben `x-werkbuch: &werkbuch-env` mit `APP_URL: https://pm.example.com`, `ADMIN_EMAIL: admin@example.com`, `ADMIN_PASSWORD: change-me`, `DB_PASSWORD: &db-password change-me`, `MEILISEARCH_KEY: &meili-key change-me` und Kommentar „werkbuch refuses to start while a value is still change-me“; die App-Dienste mergen den Anker und die Standardwerte der übrigen Variablen aus `docker-compose.yml` als Literale (auch `TRUSTED_PROXIES` mit der Liste und `APP_LOCALE: en`); `werkbuch` mit `ports: ["7740:8080"]`, `image: baeroe/werkbuch:latest`.
  - `mariadb` mit `MARIADB_RANDOM_ROOT_PASSWORD: "1"` statt Root-Passwort, `MARIADB_ROOT_HOST: localhost` (das Zufalls-Passwort steht im Log der MariaDB — `GENERATED ROOT PASSWORD: …`, in Dockge und Portainer sichtbar —, taugt so aber nur im Container; Backups nutzen den Nutzer `werkbuch`), `command: ["--max-allowed-packet=64M"]` wie in `docker-compose.yml`, und `entrypoint` `sh -c 'if [ "$$MARIADB_PASSWORD" = change-me ]; then echo "werkbuch: set DB_PASSWORD at the top of the compose file (still change-me)" >&2; exit 1; fi; exec docker-entrypoint.sh "$$@"' docker-entrypoint.sh`. Kommentar über `command`: ein `entrypoint` in Compose löscht den `CMD` des Images; ohne `command` bekäme `docker-entrypoint.sh` keine Argumente, überspränge jedes Setup, endete mit 0 und startete in einer Schleife neu (`docker-entrypoint.sh` setzt vor ein Argument mit `-` selbst `mariadbd`).
  - `meilisearch` mit demselben Guard über `$$MEILI_MASTER_KEY` und `exec tini -- /bin/sh -c /bin/meilisearch` (startet Meilisearch selbst, braucht kein `command`).

- [ ] **Step 1: Failing Tests** — in `ComposeTest` (`$standalone = fn () => RepoFiles::yaml('docker-compose.standalone.yml')`):
  - „keeps the standalone file free of .env references and puts every edited value at the top“ (kein `${` ohne `$$`; `x-werkbuch` vor `services:`, genau die fünf Werte, Anker greifen in `werkbuch`, `mariadb`, `meilisearch`; `EnsureAdmin::PLACEHOLDER` = `change-me`);
  - „runs the standalone stack like docker-compose.yml“ (gleiche Dienste, `restart`, `healthcheck`, `networks`, `volumes`, `depends_on`, `command` (auch von `mariadb`), `stop_signal`, `security_opt`, Images der Datenbanken, `MARIADB_ROOT_HOST`; jede Variable der App-Dienste hat in der Standalone-Datei den Standardwert aus `docker-compose.yml` bzw. den Wert aus `x-werkbuch`);
  - „starts MariaDB with a command wherever its entrypoint is replaced“ (über beide Dateien: hat ein Dienst `entrypoint`, hat er `command`; für `mariadb` der Standalone-Datei gilt das gesetzt);
  - „refuses the placeholder in MariaDB and Meilisearch of the standalone file before they store it“ (Guards im `entrypoint`, `exec docker-entrypoint.sh "$$@"` bzw. `exec tini --`, `MARIADB_RANDOM_ROOT_PASSWORD` `"1"`, kein `MARIADB_ROOT_PASSWORD`).
- [ ] **Step 2: RED**, **Step 3** umsetzen, **Step 4: G1** und `docker compose -f docker-compose.standalone.yml config -q` → Exitcode 0; `docker compose -f docker-compose.standalone.yml config` zeigt bei `mariadb` `command` und `entrypoint` (den Start mit geänderten Werten prüft Task 8 von Hand; `config -q` sieht einen gelöschten `CMD` nicht).
- [ ] **Step 5: Commit** — `feat: add the standalone compose file that refuses its placeholders`.

---

### Task 5a: Smoke gegen den Stack

**Modell:** opus

**Files:**
- Create: `scripts/compose-smoke.sh` (ausführbar), `scripts/compose-smoke.mjs`, `scripts/compose-smoke.test.mjs`
- Modify: `tests/Feature/Docker/ImageTest.php` („has a smoke script a shell accepts“: `bash -n`), `CLAUDE.md` (Kommandos: Image bauen, Smoke; Architektur „Docker: Smoke“; Fallstricke: Smoke braucht Colima und läuft nie parallel zu e2e)
- Consumes: Task 3b (Image), Task 4a (`docker-compose.yml`).

**Interfaces:**
- Produces:
  - `scripts/compose-smoke.mjs` (Node 24, keine Abhängigkeiten): exportiert `CookieJar` (`store(setCookieHeaders: string[])`, `header(): string`, `get(name): ?string`), `xsrfToken(jar): string` (URL-dekodiertes `XSRF-TOKEN`), `inertiaPage(html: string): object` (liest die Seite aus `<script data-page="app" type="application/json">…</script>` oder `data-page="…"` mit HTML-Entities), `liveFrame(text: string): {event, channel?, data}` (Pusher-Frames, `data` als Text-JSON entpackt) und `run(env): Promise<void>`; als Skript (`import.meta.url` = `argv[1]`) ruft es `run(process.env)` und schreibt je Prüfung `smoke: <prüfung> ok`, am Ende `smoke: ok`, bei einem Fehler die Meldung und Exitcode 1. Umgebung: `SMOKE_URL` (Standard `http://localhost:7740`), `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_PROBE` (8–16 Kleinbuchstaben), `SMOKE_MODE` (`full` Standard, `again`). Jede Anfrage schickt `Origin` und `Referer` = `SMOKE_URL` (Sanctum stateful, Reverb `allowed_origins`: ohne `Origin` lehnt Reverb die Verbindung ab).
  - Prüfungen `full`, in dieser Reihenfolge:
    - (a) `GET /up?probe=<PROBE>` → 200 (wiederholt bis 180 s);
    - (b) `GET /reset-password/<PROBE>?email=probe%40example.com` → 200;
    - (c) `GET /api/openapi.json` → 200, `openapi` beginnt mit `3.1`;
    - (d) `POST /mcp` mit JSON ohne Token → 401;
    - (e) `GET /sanctum/csrf-cookie` → 204, `POST /login` (JSON, `X-XSRF-TOKEN`) → 2xx, `GET /api/v1/me` → `data.email` = `SMOKE_EMAIL`, `data.org_role` `admin`;
    - (f) `GET /api/v1/bots` → ein Bot mit `handle` `automation`;
    - (g) `GET /my-items` → `inertiaPage(...).props.features.live`: `key` nicht leer, `host` = Host von `SMOKE_URL`, `port` = dessen Port, `scheme` = dessen Schema;
    - (h) `new WebSocket('ws://<host>:<port>/app/<key>?protocol=7&client=js&version=8.6.0&flash=false', { headers: { Origin } })` (undici in Node 24 nimmt `headers` und schickt `Origin`, geprüft mit Node 24.21; kein Weg über `node:http`) → `pusher:connection_established` mit `socket_id`;
    - (i) `POST /api/v1/projects` (`name` `Smoke <PROBE>`, `identifier` `S` + 5 zufällige Großbuchstaben) → 201;
    - (i2) `GET /api/v1/projects/<KENNUNG>` → 200 mit `data.id` = id (Bindung per Kennung mit gecachten Routen, A430);
    - (j) `POST /broadcasting/batch` `{socket_id, channel_names: ['private-project.<id>']}` → `auth`, Frame `pusher:subscribe` → `pusher_internal:subscription_succeeded` binnen 15 s;
    - (k) `POST /api/v1/work-items` (`title` `<PROBE> live`) → 201 **ohne** `X-Socket-ID`, dann binnen 60 s ein Frame `live` auf dem Kanal mit `type` `work_item.created` und `item_id` = id (Outbox → Queue `live` → Reverb über die Dienstadresse `reverb:6001` → WebSocket über nginx);
    - (k2) `GET /api/v1/work-items/<KENNUNG>-1` → 200 mit `data.id` = id des Items (Bindung per Key mit gecachten Routen);
    - (l) `GET /api/v1/search?q=<PROBE>&types=items` wiederholt bis 60 s, bis `data.items` die id nennt (Worker `queue-index`, Meilisearch);
    - (m) `node:http`-Anfrage `POST /api/v1/attachments` mit `Content-Length: 34603008` ohne Body → 413 (nginx);
    - (m2) `POST /apps/werkbuch/events` (JSON `{}`) → 404, `Content-Type` beginnt mit `text/html` oder `application/json` (Laravel, nicht Reverb: die HTTP-API von Reverb ist über 7740 nicht erreichbar);
    - (n) `DELETE /api/v1/projects/<id>` → 202;
    - (o) `GET /up` → keine Kopfzeile `Strict-Transport-Security`, `X-Content-Type-Options` `nosniff`;
    - (p, optional, nur wenn die Stunde reicht; sonst im Bericht als offen nennen) vor (n): ein PNG von 2×2 px per Multipart an `/api/v1/attachments` (`project_id` = id, `kind=inline`) → 201, dann `GET /api/v1/attachments/<id>` wiederholt bis 60 s, bis `preview_url` gesetzt ist (Worker `queue-index` mit `media`, GD, Volume im Worker).
    Modus `again`: (a), (e), (f) und `GET /api/v1/users?filter[type]=person` → `meta.total` 1.
  - `scripts/compose-smoke.sh` (bash, `set -euo pipefail`): erzeugt in `$(mktemp -d)` eine `.env` mit `APP_URL=http://localhost:${SMOKE_PORT:-7740}`, `WERKBUCH_BIND=127.0.0.1`, `WERKBUCH_PORT`, `WERKBUCH_IMAGE` (Pflicht aus der Umgebung), `ADMIN_EMAIL=admin@example.com`, zufälligen `ADMIN_PASSWORD`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `MEILISEARCH_KEY` (je `openssl rand -hex 24`) und, wenn nicht gesetzt, `SMOKE_PROBE` (12 Kleinbuchstaben aus `/dev/urandom`); gibt den Pfad der `.env` aus; `dc() { docker compose -p werkbuch-smoke --env-file "$ENV" -f "$ROOT/docker-compose.yml" "$@"; }`; `trap` beim Ende: bei Fehler `dc logs --no-color | tail -n 400`, dann `dc down -v` (außer `SMOKE_KEEP=1`). Ablauf:
    1. `dc up -d --wait --wait-timeout 300` → `node scripts/compose-smoke.mjs` (`SMOKE_MODE=full`).
    2. Prüfungen im Container: `dc exec -T werkbuch sh -c` mit `test "$(id -u)" != 0 && test ! -w /var/www && test ! -w /var/www/html && test ! -w app && test ! -w vendor && test -w storage/app && test ! -w "$PHP_INI_DIR/conf.d/zzz-serversideup-docker-php-debug.ini" && php -r "exit(ini_get(\"zend.exception_ignore_args\") === \"1\" ? 0 : 1);" && php -r "exit(in_array(ini_get(\"session.upload_progress.enabled\"), [\"\", \"0\"], true) ? 0 : 1);" && test "$(dpkg-query -W -f="\${Version}" libbrotli1)" = 1.1.0-2+deb13u1 && getconf GNU_LIBC_VERSION`; dieselbe UID-Prüfung in `queue` und `reverb`.
    3. Logs: `dc logs werkbuch` darf `SMOKE_PROBE` nicht enthalten und muss `/reset-password/…` enthalten.
    4. Hash von `storage/app/.app-key` merken, `dc up -d --force-recreate --wait --wait-timeout 300`, Hash gleich, `SMOKE_MODE=again` → `smoke: ok`.

- [ ] **Step 1: Failing Tests** — `scripts/compose-smoke.test.mjs` (Vitest): „keeps cookies across answers and reads the XSRF token“, „reads the Inertia page from the script tag and from data-page“, „unpacks a pusher frame whose data is JSON text“; `ImageTest` „has a smoke script a shell accepts“.
- [ ] **Step 2: RED** — `ddev exec pnpm test -- scripts/compose-smoke.test.mjs`, `ddev artisan test --filter=ImageTest`.
- [ ] **Step 3: Umsetzen** wie unter Interfaces.
- [ ] **Step 4: G1**, `ddev exec pnpm test` und **GI** komplett: `docker buildx build --load -t werkbuch:local . && WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh` → `smoke: ok`. Gegenproben je einmal mit Neubau (danach zurück): ohne `location ^~ /app/` scheitert (h); ohne `map $request_uri` scheitert die Log-Prüfung. Die Bindungen deckt `RouteCacheTest` ab (Task 2); (i2) und (k2) prüfen sie hier im echten Image.
- [ ] **Step 5: Commit** — `test: smoke-test the compose stack: sign-in, live updates over one port, search, limits and what only the image changes`.

---

### Task 5b: CI-Job `image` und Actions per SHA

**Modell:** sonnet

**Files:**
- Create: `tests/Unit/WorkflowsTest.php`
- Modify: `.github/workflows/tests.yml` (Job `image`; **jede** `uses:` per SHA), `.github/dependabot.yml` (Kommentar bei `github-actions`), `CLAUDE.md` (Regeln: CI-Job `image` neben `tests`, `e2e`, `docs`, `clickdummy`, keine Pflicht; jede Action per SHA mit `# vX.Y.Z`)
- Consumes: Task 5a (`scripts/compose-smoke.sh`).

**Interfaces:**
- Produces:
  - Job `image` in `tests.yml` (kein Pflicht-Check):
    ```yaml
    image:
      strategy:
        fail-fast: false
        matrix:
          include:
            - { arch: amd64, runner: ubuntu-24.04 }
            - { arch: arm64, runner: ubuntu-24.04-arm }
      runs-on: ${{ matrix.runner }}
      timeout-minutes: 45
      steps:
        - checkout (SHA)
        - setup-buildx (SHA)
        - build-push-action (SHA): context ., platforms linux/${{ matrix.arch }}, push false, load true, tags werkbuch:ci,
          cache-from type=gha,scope=image-${{ matrix.arch }}, cache-to type=gha,scope=image-${{ matrix.arch }},mode=max
        - setup-node (SHA) mit .node-version
        - name: Compose smoke
          run: scripts/compose-smoke.sh
          env: { WERKBUCH_IMAGE: 'werkbuch:ci' }
    ```
    Kommentar über dem Job: Erfolgskriterium 1 je Architektur nativ (A421); die Playwright-Suite bleibt auf `php artisan serve` (A420).
  - Jede `uses:` in `tests.yml` auf den SHA der Tabelle mit `# vX.Y.Z` (Majors wie bisher).
  - `.github/dependabot.yml`: Kommentar bei `github-actions`: Dependabot hebt SHAs samt Kommentar; schlägt es einen neuen Major vor, ist das ein eigener PR mit eigener Entscheidung (die Gruppe `actions` bleibt).
  - `tests/Unit/WorkflowsTest.php`: die Struktur aus `RepoFiles::yaml` über alle `.github/workflows/*.yml`, die Pins **als Text** (`RepoFiles::text`, YAML wirft Kommentare weg): „pins every action by commit“ (jede Zeile mit `uses:` in jedem Workflow passt auf `/uses:\s*[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}\s+#\s*v?\d+\.\d+\.\d+\s*$/`; der Test zählt die Zeilen und scheitert, wenn es keine gibt); „keeps the required job named tests“; „builds both platforms on every pull request without pushing“ (`jobs.image.strategy.matrix.include` hat `amd64` und `arm64`, kein Schritt mit `push: true`, kein `docker/login-action`, `permissions.contents` `read`).

- [ ] **Step 1: Failing Tests** — `WorkflowsTest` (scheitert an den Tags `@v4` und am fehlenden Job).
- [ ] **Step 2: RED** — `ddev artisan test --filter=WorkflowsTest`.
- [ ] **Step 3: Umsetzen** — Pins, Job `image`, Kommentar in `dependabot.yml`.
- [ ] **Step 4: G1**. Den Job selbst prüft erst die CI des PRs (kein Push in der Task).
- [ ] **Step 5: Commit** — `ci: build the image for amd64 and arm64 and smoke-test the compose stack; pin every action by commit`.

---

### Task 6a: Doku Setup und Reverse Proxy

**Modell:** opus

**Files:**
- Create: `docs/{en,de}/{setup,reverse-proxy}.md`
- Modify: `docs/.vitepress/config.ts` (Gruppe `selfhosting` „Self-hosting“/„Betrieb“ zuerst, Seiten `setup`, `reverse-proxy`, Titel in `en`/`de`; Task 6b ergänzt die übrigen drei), `docs/{en,de}/index.md` (Verweis auf Setup), `tests/Unit/DocsTest.php`
- Consumes: Tasks 3a–5a (Werte), Task 4b (eingebettete Standalone-Datei).

**Interfaces:**
- Produces (Inhalt je Seite; gleiche Überschriften in beiden Sprachen):
  - `setup.md`: **Requirements** (Docker Engine mit Compose v2.20+ für `depends_on`-Bedingungen und `--wait`; amd64 oder arm64; mindestens 2 vCPU und 2 GB RAM, 4 GB empfohlen (Meilisearch hält den Index im Speicher und nimmt zum Indexieren bis zwei Drittel des RAM — auf knappen Maschinen `MEILI_MAX_INDEXING_MEMORY` im `environment` von `meilisearch` setzen —, MariaDB, PHP-FPM mit bis zu 20 Prozessen à höchstens 512 MB (üblich 30–60 MB je Anfrage; auf 2-GB-Hosts `PHP_FPM_PM_MAX_CHILDREN=8` im `environment` von `werkbuch` setzen), vier Worker-Container); 10 GB Platte plus Anhänge (A428)); **Quick start: paste and deploy** (`<<< @/../docker-compose.standalone.yml{yaml}`, fünf Werte, `change-me` wird abgelehnt); **Files**, **.env** (Tabelle aller Variablen aus `.env.docker.example` mit Pflicht und Bedeutung; `APP_LOCALE` (`en`/`de`, Sprache der Organisation beim ersten Start); `REVERB_PUBLIC_*` als „nur, wenn der Browser Reverb nicht unter `APP_URL` erreicht“; Satz: Variablen, die mit `PHP_`, `NGINX_`, `SSL_`, `LOG_` oder `TRUSTED_PROXY` beginnen, nie leer setzen, der Web-Dienst startet sonst nicht); **Start** (`docker compose up -d`, `docker compose logs -f werkbuch` bis `werkbuch: ready`; was der Start tut, in der Reihenfolge des Entrypoints; `werkbuch: no account yet` heißt: `ADMIN_EMAIL`/`ADMIN_PASSWORD` setzen und neu starten); **Passwords** (`ADMIN_PASSWORD` danach entfernen, `app:reset-password`, `app:reset-two-factor`); **Services** (Tabelle der acht Dienste mit Aufgabe, Netz, Healthcheck; ein `queue-index` und warum); **What lives where** (Volumes, Schlüssel-Dateien `.app-key`, `.reverb-app-key`, `.reverb-app-secret`; `.app-key` gehört zum Backup und darf nie verloren gehen — `APP_KEY` verschlüsselt die Geheimnisse der Webhooks und die zweiten Faktoren samt Recovery-Codes, ein anderer Schlüssel sperrt jede Person mit zweitem Faktor aus —; `APP_KEY` nie nachträglich ändern); **Your own MariaDB** (mit `max_allowed_packet` ≥ 64M); **Storage** (nur lokal in v0.1.0, A424); **Versions** (`WERKBUCH_IMAGE`); **docker-compose.yml** (`<<< @/../docker-compose.yml{yaml}`).
  - `reverse-proxy.md`: was werkbuch glaubt (`TRUSTED_PROXIES`, Host nur aus `APP_URL`, 400 für fremde Hosts, `X-Forwarded-Proto` für sichere Cookies); **WebSockets** (der Browser öffnet `wss://<APP_URL-Host>/app/…`; der Proxy muss `Upgrade`/`Connection` durchreichen und lange Verbindungen halten; nur `/app/` führt zu Reverb, `/apps/` gibt es von außen nicht); **HSTS** (der Container schickt kein `Strict-Transport-Security`; der Proxy setzt es, je Proxy eine Beispielzeile — Caddy setzt es nicht von selbst —, mit dem Hinweis, `includeSubDomains` nur zu setzen, wenn wirklich alle Subdomains https sprechen); je Abschnitt **Caddy**, **Traefik** (Labels), **nginx** (mit `proxy_http_version 1.1`, `Upgrade`, `proxy_read_timeout`), **Nginx Proxy Manager** (Schalter „Websockets Support“, Spec 14); `/mcp` (kein Puffern, `Accept: text/event-stream` nicht entfernen); **Checklist** (Live-Banner verschwindet, System-Seite zeigt Live `ok`).
  - `DocsTest`: „embeds the real compose files in the setup“ (beide Sprachen enthalten `<<< @/../docker-compose.standalone.yml{yaml}` und `<<< @/../docker-compose.yml{yaml}`); „explains every variable of .env.docker.example in the setup“ (je Name aus der Datei steht `` `NAME` `` in beiden `setup.md`); „covers the proxies with WebSockets and HSTS“ (`reverse-proxy.md` beider Sprachen: `Websockets Support`, `Caddy`, `Traefik`, `nginx`, `Upgrade`, `Strict-Transport-Security`); „keeps the app key in the backup“ (beide `setup.md` nennen `.app-key` und `APP_KEY`).
- [ ] **Step 1: Failing Tests** (`DocsTest` neu) → RED.
- [ ] **Step 2: Seiten** schreiben (Wortlaut im Stil von openbill, Werte aus Tasks 3a–5a; Beispiel-Domain `pm.example.com`), Gruppe in `config.ts`, Verweis in `index.md`.
- [ ] **Step 3: Prüfen** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 4: Commit** — `docs: add setup and reverse proxy in en and de`.

---

### Task 6b: Doku Betrieb, Update, Backup

**Modell:** opus

**Files:**
- Create: `docs/{en,de}/{operations,upgrading,backup}.md`
- Modify: `docs/.vitepress/config.ts` (Gruppe `selfhosting` um `operations`, `upgrading`, `backup`), `docs/{en,de}/{search,webhooks,mcp,api,development}.md` (Verweise; `search.md` auf die Mindestanforderungen, `development.md`: Image lokal bauen und Smoke), `tests/Unit/DocsTest.php`, `README.md` („Self-hosting“ mit drei Befehlen und Link auf die Doku; „Planned stack“ → „Stack“)
- Consumes: Task 6a.

**Interfaces:**
- Produces (gleiche Überschriften in beiden Sprachen):
  - `operations.md`: **Workers and scheduler** (drei Queues und ihre Reihenfolge, `queue-index` nie skalieren, Scheduler-Aufgaben aus `routes/console.php`); **Outbound connections** (wer nach außen spricht: Webhooks aus `queue-webhooks` und beim Ping aus `werkbuch`, SMTP; kein ausgehender Proxy in v1, A368; IPv6-Routing des Containers; Firewall-Regeln); **Private webhook targets** (`WEBHOOKS_ALLOW_PRIVATE`: nur private Netze, Link-local und Metadaten-Adressen bleiben gesperrt, A378; aus Sicht des Containers sind auch `mariadb`, `meilisearch`, `reverb` privat); **Rate limits and proxies** (`API_RATE_LIMIT`, `API_SESSION_RATE_LIMIT`, `MCP_RATE_LIMIT`; die Drossel je Adresse braucht richtige `TRUSTED_PROXIES`; leer = die privaten Netze); **Live updates** (Reverb ohne `ext-uv` trägt etwa 1000 gleichzeitige Tabs — `stream_select` endet bei 1024 Verbindungen —, `REVERB_APP_MAX_CONNECTIONS` als Schutz, `ext-uv` als Ausblick); **Logs** (stderr/stdout; Access-Log ohne Query, Referer und Tokens, mit `X-Forwarded-For`, ohne den eigenen Healthcheck; keine Argumente in Stacktraces; Restrisiko: das Fehlerlog von nginx nennt bei einem Fehler des Upstreams die volle Anfrage samt Query — eine signierte Upload-URL lebt nur kurz (A403); `LOG_OUTPUT_LEVEL=debug` der Basis ist im Image nicht unterstützt, die Debug-Dateien gehören root); **Configuration in a running container** (nie `php artisan config:clear` oder `optimize:clear` per `docker compose exec`: die Schlüssel stehen nur im Config-Cache, der Container verlöre `APP_KEY` und die Reverb-Schlüssel bis zum Neustart; stattdessen `docker compose restart <dienst>`); **Empty variables** (Variablen mit `PHP_`, `NGINX_`, `SSL_`, `LOG_`, `TRUSTED_PROXY` nie leer); **Search** (`app:search-sync` bei jedem Start, Import bei leerem Index, `docker compose exec werkbuch php artisan app:search-import` nach einem Update mit neuen Feldern); **Mail** (`MAIL_*`, Testmail auf der System-Seite); **System page**; **Uploads** (`ATTACHMENTS_MAX_MB` über 25: `PHP_UPLOAD_MAX_FILE_SIZE`, `PHP_POST_MAX_SIZE`, `NGINX_CLIENT_MAX_BODY_SIZE` in `environment` von `werkbuch` und `queue` mit anheben).
  - `upgrading.md`: Ablauf (Backup, `docker compose pull && docker compose down && docker compose up -d` — kurze Ausfallzeit, Volumes bleiben; ohne `down` liefen die alten Worker mit altem Code gegen das neue Schema weiter, bis Compose sie erreicht, A431; was der Start tut; neue Compose-Datei; MariaDB-Patches automatisch; **Meilisearch**: eine neue Meilisearch-Version liest den alten Index nicht immer — `docker compose stop meilisearch`, Volume `<projekt>_meili-data` löschen, `up -d`, werkbuch importiert den Index beim Start, A422; zurück nur über Backup); `## Notes per version` mit Kommentar „absolute links only“ und `### 0.1.0` („First release: …“ mit Links `https://github.com/baeroe/werkbuch/blob/main/docs/en/setup.md`).
  - `backup.md`: Datenbank (`mariadb-dump -uwerkbuch … --single-transaction werkbuch`) dann `werkbuch-data` (`tar`; darin `.app-key`, ohne den die Geheimnisse der Webhooks und die zweiten Faktoren unlesbar sind), `.env`; Meilisearch braucht kein Backup (Index wird neu gebaut); Root von MariaDB: in `docker-compose.yml` `DB_ROOT_PASSWORD`, in der Standalone-Datei ein Zufalls-Passwort, das im Log der MariaDB steht und wegen `MARIADB_ROOT_HOST=localhost` nur im Container taugt — Backups nutzen den Nutzer `werkbuch`; Wiederherstellen in der Reihenfolge wie openbill mit `werkbuch`-Namen; Hinweise (`down -v` löscht, Umzug, `.app-key` mitnehmen).
  - `DocsTest`: „names every service and the operational switches“ (`operations.md` beider Sprachen: jeder Dienstname aus `docker-compose.yml`, `WEBHOOKS_ALLOW_PRIVATE`, `TRUSTED_PROXIES`, `API_RATE_LIMIT`, `API_SESSION_RATE_LIMIT`, `MCP_RATE_LIMIT`, `REVERB_APP_MAX_CONNECTIONS`, `app:search-import`, `config:clear`); „stops the stack before it updates“ (`upgrading.md` beider Sprachen enthält `docker compose pull && docker compose down && docker compose up -d`); „keeps the app key in the backup“ um `backup.md` erweitern; die Liste der Befehle in „documents the DDEV commands …“ um `docker buildx build` und `scripts/compose-smoke.sh` ergänzen.
- [ ] **Step 1: Failing Tests** (`DocsTest` neu) → RED.
- [ ] **Step 2: Seiten** schreiben, Gruppe ergänzen, Verweise, README. Wird die Task knapp: `en` vollständig zuerst, `de` danach im selben Commit.
- [ ] **Step 3: Prüfen** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 4: Commit** — `docs: add operations, upgrading and backup in en and de`.

---

### Task 7: Release-Workflows vorbereiten

**Modell:** sonnet

**Files:**
- Create: `.github/workflows/docker.yml`, `.github/workflows/dockerhub.yml`, `scripts/release-notes.sh`, `scripts/release-version.sh` (beide ausführbar), `tests/Unit/ReleaseNotesTest.php`
- Modify: `tests/Unit/WorkflowsTest.php`, `CLAUDE.md` (Kommandos: `scripts/release-notes.sh`; Release nur mit Freigabe)

**Interfaces:**
- Produces:
  - `scripts/release-notes.sh <version>`: wie openbill (Abschnitt `### <version ohne -suffix>` aus `docs/en/upgrading.md`, beide Sprachen müssen ihn haben, sonst Exitcode 1 mit `docs/<l>/upgrading.md has no section "### <v>"`).
  - `scripts/release-version.sh <version>`: Exitcode 0 nur, wenn `config/werkbuch.php` genau `'version' => '<version>'` enthält, sonst 1 mit `config/werkbuch.php has version <ist>, the tag says <soll>` (A426).
  - `docker.yml` (`name: Docker image`; `on: push: tags ['v*']` und `workflow_dispatch`; `permissions: contents: read`; `concurrency` je Ref):
    - Job `build` (Matrix wie `image`: `amd64`/`ubuntu-24.04`, `arm64`/`ubuntu-24.04-arm`): checkout; bei Tags zuerst `scripts/release-version.sh "${GITHUB_REF_NAME#v}"` und `scripts/release-notes.sh … > /dev/null`; buildx; Build mit `load: true` → `scripts/compose-smoke.sh` (`WERKBUCH_IMAGE=werkbuch:release`); nur bei Tags: `docker/login-action` (SHA, `secrets.DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`), `docker/metadata-action` (nur Labels), Build mit `outputs: type=image,name=baeroe/werkbuch,push-by-digest=true,name-canonical=true,push=true` (Cache derselben `scope` → kein zweiter Bau), Digest nach `${{ runner.temp }}/digests/` und `upload-artifact` (`digests-${{ matrix.arch }}`, 1 Tag). Kommentar über dem pushenden Schritt: der gepushte Build ist nicht byte-gleich mit dem geprüften — die Schichten kommen aus demselben Cache, nur die Zeit im Manifest unterscheidet sich.
    - Job `merge` (`needs: build`, nur Tags): `download-artifact` (`pattern: digests-*`, `merge-multiple: true`), login, metadata mit `images: baeroe/werkbuch` und Tags `type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}`, `type=raw,value=latest,enable=${{ !contains(github.ref_name, '-') }}`, dann `docker buildx imagetools create` aus den Tags und Digests, danach `imagetools inspect` des Versionstags.
    - Job `release` (`needs: merge`, nur Tags, `permissions: contents: write`): `gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes --notes "$(scripts/release-notes.sh "${GITHUB_REF_NAME#v}")"` (+ `--prerelease` für `-`).
    - Kommentar oben: wird erst durch einen Tag mit Rafaels Freigabe ausgelöst; braucht die Secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
  - `dockerhub.yml`: wie openbill (`push` auf `main` mit `README.md`/eigener Datei, `workflow_run` nach „Docker image“ mit Erfolg aus `push`, `workflow_dispatch`); prüft per `curl https://hub.docker.com/v2/repositories/baeroe/werkbuch/` und überspringt mit `::notice::`, solange es das Repository nicht gibt; `peter-evans/dockerhub-description` (SHA) mit `repository: baeroe/werkbuch`, `short-description` („Open, self-hosted project management: custom types, workflows, views, wiki, REST API, MCP and webhooks“, ≤ 100 Zeichen), `enable-url-completion: true`.
  - `WorkflowsTest` dazu: „pushes images only for version tags, after the smoke“ (`docker.yml`: `on` nur `push.tags` `v*` und `workflow_dispatch`, kein `pull_request`; jeder Schritt mit `docker/login-action` oder `push=true` hat `if: startsWith(github.ref, 'refs/tags/v')`; der Smoke-Schritt steht vor dem pushenden Build; `jobs.release.permissions.contents` `write`, sonst nirgends `write`); „checks version and notes before anything is built“ (die ersten `run`-Schritte im Job `build` rufen `release-version.sh` und `release-notes.sh`); „syncs the description only while the repository exists“. „pins every action by commit“ (Task 5b) gilt für die neuen Dateien ohne Änderung.
  - `ReleaseNotesTest`: wie openbill („prints the notes of a version …“, „uses the notes of the final version for a pre-release tag“, „refuses a version without notes“, „has only absolute links“ mit `](https://github.com/baeroe/werkbuch/blob/main/docs/en/setup.md)`, „has notes for the version in config/werkbuch.php“ mit `0.1.0-dev` → Abschnitt `0.1.0`); dazu „refuses a tag that is not the version of config/werkbuch.php“ (`release-version.sh 9.9.9` → 1, `release-version.sh <config-version>` → 0).
- Consumes: Task 5a (`scripts/compose-smoke.sh`), Task 5b (`WorkflowsTest`), Task 6b (`docs/*/upgrading.md` mit `### 0.1.0`).

- [ ] **Step 1: Failing Tests** → RED. **Step 2** umsetzen. **Step 3: G1**; `actionlint` nicht installieren (Struktur prüft `WorkflowsTest`).
- [ ] **Step 4: Commit** — `ci: prepare the release of the image to docker hub on version tags`.

---

### Task 8: Abnahme mit Colima, `CLAUDE.md`, Rulings, Spec, Master-Plan

**Modell:** opus

**Files:**
- Modify: `CLAUDE.md`, `README.md` (Status: Phase 14 erledigt), `docs/{en,de}/index.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Abschnitt Phase 14: Abweichungen aus A418/A420/A424/A430/A431 nachtragen; „Fortschritt“ setzt der Orchestrator beim Merge)

**Interfaces:**
- Produces:
  - **Abnahme Erfolgskriterium 1 (real, mit Colima):**
    ```bash
    colima status
    docker buildx build --load -t werkbuch:local .
    WERKBUCH_IMAGE=werkbuch:local SMOKE_KEEP=1 scripts/compose-smoke.sh
    ```
    Expected: `smoke: ok`; der Stack läuft danach weiter (`SMOKE_KEEP=1`). Von Hand im Browser auf `http://localhost:7740`: mit `admin@example.com` und dem Passwort aus der `.env` des Smokes (Pfad steht in der Ausgabe) anmelden; Einstellungen → Bots zeigt „Automation“; zwei Tabs auf derselben Projektliste, im einen den Status eines Items ändern → der andere zeigt es ohne Neuladen, kein Banner „Live-Updates pausiert“; ein Item über seinen Key öffnen (`/items/<KEY>`); Organisation → System: Live `ok`, Suche `ok`, E-Mail „nicht eingerichtet“, keine fehlgeschlagenen Jobs. Danach `docker compose -p werkbuch-smoke down -v`.
  - **Standalone-Datei von Hand** (das Gate `config -q` sieht einen gelöschten `CMD` nicht): `docker compose -f docker-compose.standalone.yml config` einmal ansehen (`mariadb` mit `entrypoint` und `command`); dann eine Kopie in einem Temp-Verzeichnis mit `image: werkbuch:local`, eigenen Werten statt `change-me` und `ports: ["127.0.0.1:7741:8080"]`, `APP_URL: http://localhost:7741`, `docker compose -p werkbuch-standalone -f <kopie> up -d --wait --wait-timeout 300` → alle Dienste gesund; `docker compose -p werkbuch-standalone -f <kopie> exec -T mariadb mariadb -uwerkbuch -p<passwort> -N -e 'select @@max_allowed_packet'` → `67108864`; mit `change-me` als `DB_PASSWORD` stoppt `mariadb` mit der Zeile des Guards; danach `down -v`. Ergebnis mit Ausgaben in den Bericht.
  - `CLAUDE.md`: „Stand“ (Phase 14 erledigt; als Nächstes Phase 15; Release v0.1.0 nur mit Freigabe), Tech Stack (Image-Basis v5.0.4, Node-Stage, Compose-Images), Kommandos (`docker buildx build --load -t werkbuch:local .`, `WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh`, `scripts/release-notes.sh <v>`), Architektur „Docker“ vervollständigen, soweit Tasks 3a–7 es nicht schon schrieben (Rollen im Entrypoint, Schlüssel im Volume, nginx → Reverb nur `/app/`, `werkbuch.live` gegen `broadcasting.connections.reverb.options`, Dienste und Worker, Smoke, Job `image`, Release-Workflows), Fallstricke prüfen und ergänzen (Bindungen nur im Provider — Task 2; nie `config:clear` im laufenden Container — Task 3b; jede neue Queue in `docker-compose.yml`, DDEV und CI zugleich; jede neue Action per SHA; Colima teilt den Speicher mit DDEV; keine Variable mit den Präfixen der Basis leer).
  - Rulings **A414–A431** (unten, mit Anpassungen aus der Umsetzung); „Für spätere Phasen vorgemerkt“: Zeile Phase 14 entfernen (ihr „`/apps` (HTTP-API)“ ist durch A415 erledigt); Phase 15 ergänzen: eigener Worker oder Queue `mail` für Anmelde-Mails (T5-M7, A418), S3-kompatibler Speicher (A424), e2e gegen den Compose-Stack prüfen, wenn die Suite schneller wird (A420), Meilisearch-Pin auf v1.56.1 heben ab 2026-11-16 (Speicher und Laufzeit bei langen Filtern, `QuerySearch` filtert über alle sichtbaren `project_id`), `serversideup/php` nach v5.1.x (dabei `security.conf` mit der neuen Datei der Basis vergleichen), Reverb mit `ext-uv` über 1000 Verbindungen.
  - Spec „Änderungen vom 2026-11-07 (Phase 14)“ zur Bestätigung: 8.1 (drei Queue-Dienste statt `queue`, Reverb hängt das Volume lesend ein, internes Netz; nginx leitet nur `/app` an Reverb weiter, die HTTP-API bleibt intern; kein HSTS vom Container; A417, A418, A419), 8.2 (`MEILISEARCH_KEY` Pflicht mit 16+ Zeichen, `DB_ROOT_PASSWORD`, `WERKBUCH_IMAGE`, `APP_LOCALE`, `REVERB_APP_KEY`/`REVERB_APP_SECRET` optional, `REVERB_PUBLIC_*`; `FILESYSTEM_DISK`/`AWS_*` erst nach v0.1.0; A415, A424), 9 (Job `e2e` gegen `php artisan serve`, Erfolgskriterium 1 per Smoke im Job `image`; A420), 10 (Update mit `down` vor `up`, A431).
- [ ] **Step 1: Abnahme** wie oben (Ergebnis mit Ausgabe des Smokes in den Bericht).
- [ ] **Step 2: Standalone von Hand** wie oben.
- [ ] **Step 3: Texte** — `CLAUDE.md`, Rulings, Spec, Master-Plan, README, `index.md`.
- [ ] **Step 4: Prüfen** — G1, `ddev exec pnpm --dir docs build`, `ddev artisan test --filter='DocsTest|ConfigTest|Docker|Workflows|ReleaseNotes|RouteCache'`.
- [ ] **Step 5: Commit** — `docs: update CLAUDE.md, the rulings and the spec for phase 14`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und **parallel im Hintergrund der volle G3**; beide Ergebnisse in eine finale Fix-Welle. CI: `tests`, `e2e`, `docs`, `image (amd64)`, `image (arm64)` grün.

---

## Vorschläge für neue Rulings (ab A414; A413 ist in Phase 13 vergeben)

- **A414 · Basis-Images:** `serversideup/php:8.4.27-fpm-nginx-trixie-v5.0.4` (Debian trixie, glibc) und `node:24.22.0-trixie-slim`, beide per Digest; MariaDB mit dem Digest der CI; Meilisearch `v1.56.0` mit dem Digest von DDEV und CI, obwohl es bei der Planung erst 12 Tage alt war (ab 2026-11-09 zwei Wochen). **Sicherheit vor Wartezeit:** Ein Release, das eine bekannte Lücke schließt, geht der Zwei-Wochen-Regel vor, wenn es sonst nichts ändert (Diff geprüft). So v5.0.4 statt v5.0.2: v5.0.3 schaltet `session.upload_progress.enabled` ab (CVE-2026-115560), v5.0.4 hebt `libbrotli1` (CVE-2026-111497); der Diff für `fpm-nginx` ändert nur das. `zz-werkbuch.ini` setzt `session.upload_progress.enabled = Off` zusätzlich. *Grund:* Spec 8.1 (serversideup wie openbill), A381 (`RES_OPTIONS` nur unter glibc), ein Image für Test und Betrieb; ein älteres Meilisearch im Image als in den Integrationstests wäre ungeprüft; die Zwei-Wochen-Regel darf keine bekannte Lücke festschreiben. *Falls falsch:* v5.0.2 mit `session.upload_progress.enabled = Off` (deckt nur eine der beiden Lücken) bzw. Meilisearch v1.55.0 (26 Tage alt) und DDEV/CI mitziehen.
- **A415 · Live-Adresse getrennt:** der Browser öffnet den WebSocket unter `werkbuch.live` (Standard: Host, Port und Schema von `APP_URL`; `REVERB_PUBLIC_HOST`/`_PORT`/`_SCHEME` für DDEV und CI), der Server sendet an `broadcasting.connections.reverb.options` (im Image `http://reverb:6001`), die System-Seite prüft diese interne Adresse (M4 erledigt). `REVERB_PUBLIC_PORT` steht als Schlüssel in `.env.example` (6001) und `e2e/ci.env` (8080); Tests halten ihn leer (`phpunit.xml`, `tests/TestCase.php`), ein leerer Wert heißt „aus `APP_URL`“. Weil der Server intern sendet, bleibt die HTTP-API von Reverb (`/apps/`) innerhalb des Stacks (A419). *Grund:* hinter dem Proxy sind beide Adressen verschieden, Erfolgskriterium 1 verlangt einen Port. *Falls falsch:* der Server sendet über nginx (`http://werkbuch:8080/apps/…`), nginx leitet `/apps/` dann doch weiter, und `REVERB_HOST` bleibt öffentlich.
- **A416 · Sichere Cookies aus `APP_URL`:** `SESSION_SECURE_COOKIE` fehlt → `true` genau für `https://`. *Grund:* Vormerkung Phase 2; ein Betreiber mit https soll nichts setzen müssen, `http://localhost:7740` (Abnahme) muss sich anmelden können. *Falls falsch:* immer `true` außer `local`.
- **A417 · Ein Image, Rolle am Kommando:** der Entrypoint unterscheidet Web (`/init`) und alle anderen über `SERVERSIDEUP_DEFAULT_COMMAND`; nur Web migriert und erzeugt Schlüssel (`APP_KEY`, `REVERB_APP_KEY`, `REVERB_APP_SECRET`) einmal ins Volume, je über `<datei>.tmp` und `mv` (nie eine halbe Datei); Worker, Scheduler und Reverb starten nach `werkbuch: service_healthy` und verweigern ohne Schlüssel den Start; Reverb hängt das Volume nur lesend ein. Die Schlüssel erreichen PHP nur über den Config-Cache jedes Containers (die Skripte laufen in einer Subshell): `config:clear` im laufenden Container nimmt sie ihm bis zum Neustart. `.app-key` gehört zum Backup; `APP_KEY` verschlüsselt Webhook-Geheimnisse und zweite Faktoren und wird nie nachträglich geändert. *Grund:* Spec 8.1 („die anderen Container starten ohne Migration“, Schlüssel im Volume); keine zweite Umgebungsvariable für die Rolle. *Falls falsch:* `WERKBUCH_ROLE` in der Compose-Datei.
- **A418 · Drei Queue-Dienste wie DDEV:** `queue` (`default,live,notifications,bulk`), `queue-index` (`search,media`, genau einer), `queue-webhooks`; Optionen `--tries=3 --sleep=1 --max-time=3600 --memory=384`, `SIGTERM`, 30 s Gnadenfrist. Ein eigener Worker für Anmelde-Mails (T5-M7) kommt nicht in v0.1.0. *Grund:* A301, T16-M5, T4-M2; Spec 8.1 nennt einen Dienst `queue`, das reicht nicht. *Falls falsch:* Queue `mail` vor `default` im Dienst `queue`.
- **A419 · nginx im Image:** nur `/app/` an `reverb:6001`, aufgelöst zur Anfragezeit (`resolver 127.0.0.11`); `/apps/` (HTTP-API von Reverb, signiert mit dem App-Secret) wird nie veröffentlicht, eine Anfrage dorthin endet bei Laravel mit 404 (A415). Kein HSTS vom Container: das Image ersetzt `server-opts.d/security.conf` der Basis durch dieselbe Datei ohne `Strict-Transport-Security` (die Basis setzt `max-age=31536000; includeSubDomains` an jede Antwort; unter einer Apex-Domain zwänge das ein Jahr lang alle Subdomains auf https); HSTS setzt der TLS-Proxy (Doku je Proxy). Access-Log `werkbuch` ohne Query und Referer, mit maskiertem Reset-Token und Upload-Pfad, mit `$http_x_forwarded_for`, ohne den eigenen Healthcheck (`$werkbuch_loggable`: `/up` von `127.0.0.1`/`::1`); das Fehlerlog von nginx lässt sich nicht maskieren (Restrisiko, Doku, A403). Bodies bis 32 MiB für alles (nginx kennt den Content-Type an dieser Stelle nicht; die 8-MiB-Grenze für JSON bleibt `LimitJsonBody`, 512 MB `memory_limit` tragen das Dekodieren von 32 MiB); `TRUSTED_PROXY=off`, nur `TRUSTED_PROXIES` entscheidet. *Grund:* Spec 8.1, A388, A403; HSTS ist Sache dessen, der TLS terminiert. *Falls falsch:* eigene `location` für `/api/v1/attachments` und `/api/mcp/uploads/` mit 32 MiB, sonst 9 MiB; HSTS ohne `includeSubDomains` im Image.
- **A420 · e2e bleibt auf `php artisan serve`:** der Job `e2e` läuft weiter gegen `php artisan serve` (1 h 12 min–1 h 35 min bei 120 min Grenze); Erfolgskriterium 1 prüft ein Smoke gegen den echten Compose-Stack im Job `image` (je Architektur) und vor jedem Release. Der Smoke deckt ab, was nur im Image anders ist: Routen-Cache (Bindungen per Kennung und Key), Rechte im Container, nginx (`/app`, kein `/apps`, kein HSTS, Logs), Basis-Pakete. *Grund:* gegen Compose bräuchte die Suite einen instrumentierten Abdeckungs-Build im Image, `E2E_ARTISAN` per `docker compose exec`, Seeder mit Dev-Paketen (Faker) im Produktions-Image und den Empfänger der Webhooks über `host-gateway`, dazu den Bau des Images in derselben Zeit; das Risiko, die 120 Minuten zu reißen und die Abdeckung zu verlieren, ist größer als der Gewinn, weil die Suite die App testet und der Smoke den Stack. *Falls falsch:* zweiter Job `e2e-compose` mit wenigen Specs (Anmeldung, Live, Upload) gegen den Stack.
- **A421 · Native Runner für arm64:** `ubuntu-24.04-arm` (frei für öffentliche Repos) statt QEMU, je Architektur bauen und den Stack prüfen, beim Release per Digest pushen und zusammenführen. *Grund:* Erweiterungen bauen unter QEMU ein Vielfaches länger, und nur nativ prüft der Smoke arm64 wirklich. *Falls falsch:* QEMU (`docker/setup-qemu-action`, gepinnt) mit einem Build für beide Plattformen.
- **A422 · Suche beim Start:** jeder Start des Web-Dienstes ruft `app:search-sync` und `app:search-import --if-empty` (Import, wenn ein Index ohne Dokumente ist, obwohl seine Tabelle Zeilen hat); ein neues Meilisearch ohne lesbaren alten Index heißt: Volume löschen, werkbuch baut den Index beim Start neu. *Grund:* A216, T4-M4 (`removeWhere` ohne Einstellungen scheitert still), Phase 9 (`pages`); der Index ist aus der Datenbank wiederherstellbar. *Falls falsch:* Import nur von Hand (Doku).
- **A423 · Platzhalter `change-me`:** die Standalone-Datei liefert `change-me` für `ADMIN_PASSWORD`, `DB_PASSWORD`, `MEILISEARCH_KEY`; `app:ensure-admin` lehnt ihn beim Anlegen ab (seit Phase 1; jetzt `EnsureAdmin::PLACEHOLDER` und der Satz aus `lang`), der Entrypoint und die Guards von MariaDB und Meilisearch stoppen davor. MariaDB der Standalone-Datei startet mit `command: ["--max-allowed-packet=64M"]` (ein `entrypoint` löscht den `CMD`; ohne `command` endete MariaDB still mit 0) und `MARIADB_ROOT_HOST=localhost`: das Zufalls-Root-Passwort aus `MARIADB_RANDOM_ROOT_PASSWORD` steht im Log, taugt aber nur im Container. Ohne Konto und ohne `ADMIN_*` sagt der Start `werkbuch: no account yet …` und läuft weiter (wie openbill). *Grund:* wie openbill; ein deployter Platzhalter wäre ein bekanntes Passwort. *Falls falsch:* leere Werte mit `:?` auch in der Standalone-Datei (Dockge kennt keine `.env`).
- **A424 · S3 nicht in v0.1.0:** `FILESYSTEM_DISK`/`AWS_*` (Spec 8.2) bleiben auf `local` und erscheinen nicht in `.env.docker.example`; `league/flysystem-aws-s3-v3` ist nicht installiert, Auslieferung, Vorschau und Aufräumen der Anhänge lesen lokale Pfade. *Grund:* eigene Arbeit an Anhängen, nicht am Betrieb; v0.1.0 läuft mit dem Volume. *Falls falsch:* eigene Task in Phase 15 (Paket, Auslieferung als Stream, Tests gegen MinIO).
- **A425 · Actions per Commit:** jede `uses:` in jedem Workflow per 40-stelligem SHA mit `# vX.Y.Z`, die Majors bleiben wie bisher (v4), neue Actions in ihrer jüngsten Version, die zwei Wochen alt ist; Dependabot hebt SHAs samt Kommentar, ein neuer Major ist ein eigener PR mit eigener Entscheidung (Kommentar in `dependabot.yml`). `WorkflowsTest` liest die Pins als Text (YAML verwirft Kommentare). *Grund:* Vorgabe der Phase; ein verschobener Tag soll kein Token sehen. *Falls falsch:* nur Actions mit Zugriff auf Secrets per SHA (wie openbill).
- **A426 · Version und Tag:** ein Tag `vX.Y.Z` baut nur, wenn `config('werkbuch.version')` genau `X.Y.Z` ist und `docs/{en,de}/upgrading.md` den Abschnitt `### X.Y.Z` haben; bis zur Freigabe bleibt `0.1.0-dev`. *Grund:* Spec 8.4; MCP `serverInfo.version` und der User-Agent der Webhooks nennen diese Version. *Falls falsch:* die Version aus dem Tag ins Image schreiben (Build-Arg).
- **A427 · Nachfüllen von `value_text` (T4-M3) entfällt:** vor v0.1.0 gibt es keine Installation mit Daten; auf einer neuen Datenbank hat die Migration `…_000910` nichts zu tun. *Grund:* die Vormerkung galt „bevor es Produktionsdaten gibt“. *Falls falsch:* Migration in Blöcken mit Fortsetzung umschreiben.
- **A428 · Mindestanforderungen:** 2 vCPU, 2 GB RAM (4 GB empfohlen), 10 GB Platte plus Anhänge, Docker Compose v2.20+, amd64 oder arm64. Auf 2-GB-Hosts `PHP_FPM_PM_MAX_CHILDREN=8` (20 × 512 MB `memory_limit` wären theoretisch 10 GB, üblich sind 30–60 MB je Anfrage) und bei knappem Speicher `MEILI_MAX_INDEXING_MEMORY` (Meilisearch nimmt zum Indexieren bis zwei Drittel des RAM). Reverb ohne `ext-uv` trägt etwa 1000 gleichzeitige Tabs. *Grund:* Spec 14 (Speicher von Meilisearch); acht Container, PHP mit 512 MB Grenze. *Falls falsch:* nach Messung mit dem Last-Seeder in Phase 15 anpassen.
- **A429 · Härtung der Container:** App-Dienste als `www-data` mit `no-new-privileges` (neutralisiert zugleich das setuid-Binary `s6-overlay-suexec`; s6 läuft dann unprivilegiert, wie vorgesehen); Code, `/var/www` und `/var/www/html` gehören root (sonst ließe sich der Code-Ordner aus `/var/www` heraus umbenennen und ersetzen); die Debug-Dateien der Basis, die PHP und FPM beim Start lesen (`zzz-serversideup-docker-php-debug.ini`, FPM-Debug-Pool, `php-fpm.conf`), gehören root, `LOG_OUTPUT_LEVEL=debug` geht im Image darum nicht; `/etc/nginx` bleibt für `www-data` beschreibbar, weil die Basis beim Start die Templates dorthin schreibt (Restrisiko: eine Änderung wirkt erst nach einem Neustart); MariaDB, Meilisearch und Reverb nur im internen Netz ohne veröffentlichten Port; Meilisearch läuft als root in seinem Container (Image des Herstellers), ohne Zugang von außen. *Grund:* Vorgabe „Nicht-root“ und „Code schreibgeschützt“ (Spec 8.1); `cap_drop: ALL` ist mit s6-overlay der Basis nicht geprüft. *Falls falsch:* `cap_drop` nach eigener Prüfung ergänzen, Meilisearch mit `user:` und vorbereitetem Volume, `/etc/nginx` nach dem Start per eigenem Skript root geben.
- **A430 · Route-Bindungen im Provider:** die zwölf `Route::bind` stehen in `App\Providers\RouteBindingServiceProvider`, nie in `routes/*.php` (`ArchTest`); `RouteCacheTest` prüft sie mit gecachten Routen. *Grund:* `php artisan optimize` im Image cacht die Routen, dann laufen die Routen-Dateien nie, und `{item}`/`{project}` bänden per Primärschlüssel (404 für Keys und Kennungen, kein 301); weder Pest noch ein Smoke über ULIDs bemerkte das. *Falls falsch:* `route:cache` aus dem Start nehmen (`config:cache`, `view:cache`, `event:cache` einzeln) und die Bindungen in `routes/api.php` lassen.
- **A431 · Update mit `down`:** `docker compose pull && docker compose down && docker compose up -d` (kurze Ausfallzeit, Volumes bleiben). *Grund:* `up -d` erzeugt `werkbuch` zuerst neu und migriert; die alten Worker liefen mit altem Code gegen das neue Schema weiter, bis Compose sie erreicht (`depends_on` hält nur neue Container zurück). *Falls falsch:* Worker prüfen beim Start und je Job die Schema-Version und warten; dann reicht `pull && up -d`.

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** Neue Doku-Seite `operations` („Betrieb“) für Worker, ausgehende Verbindungen, Grenzen und Logs; Spec 10 nennt Setup, Reverse Proxy, Upgrading, Backup, Erfolgskriterium 8 „Betrieb“.
- **P2** Docker-Images bleiben aus Dependabot heraus (Kommentar in `dependabot.yml` besteht); Digests hebt eine Phase von Hand nach der Zwei-Wochen-Regel bzw. A414.
- **P3** Tests für Image, Compose und Workflows lesen nur Dateien (`symfony/yaml`, Pins als Text); das Image selbst prüfen Smoke und Job `image`, den Entrypoint dazu ein Harness mit falschem `php`.
- **P4** Der Smoke nutzt die Sitzung (kein Token): `CreateToken` geht nur aus der Sitzung (`EnsureSession`).

## Nach der Phase (nur mit Rafaels Freigabe, kein Task)

1. Secrets `DOCKERHUB_USERNAME` und `DOCKERHUB_TOKEN` im Repository `baeroe/werkbuch` (Token mit Read, Write, Delete für die Beschreibung).
2. Manuelle Tests (Phase 15), dann ein Release-Commit: `config/werkbuch.php` `'version' => '0.1.0'`, Abschnitt `### 0.1.0` in beiden `upgrading.md` final.
3. `git tag v0.1.0 && git push origin v0.1.0` → `docker.yml` baut, prüft, pusht `0.1.0`, `0.1`, `latest`, legt das GitHub-Release an; `dockerhub.yml` synchronisiert danach die Beschreibung.
4. Hinweis: openbill steht noch auf `serversideup/php` v5.0.2 (ohne die beiden Sicherheits-Releases, A414).
