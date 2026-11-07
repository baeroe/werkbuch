# Entwicklung

werkbuch läuft lokal in [DDEV](https://ddev.com): PHP 8.4, MariaDB 11.4, Meilisearch, Node 24 mit pnpm, Vite mit Hot Reload und Mailpit. Auf deinem Rechner brauchst du weder PHP, Composer noch Node, außer für die Playwright-Suite (siehe unten). Alle Kommandos laufen über `ddev`, und JavaScript-Pakete verwaltest du nur mit pnpm, nie mit npm.

## Voraussetzungen

- DDEV 1.25 oder neuer mit einem Docker-Provider (zum Beispiel Colima)
- Git
- Node 24 auf dem Rechner, nur für die Playwright-Suite in `e2e/` (zum Beispiel über mise)

## Erster Start

```bash
git clone https://github.com/baeroe/werkbuch.git
cd werkbuch
cp .env.example .env
ddev start
ddev composer install
ddev exec pnpm install
ddev artisan key:generate
ddev artisan migrate
ddev artisan app:search-import                # baut die Suchindizes in Meilisearch auf
ddev artisan app:ensure-admin                 # legt das Konto aus ADMIN_EMAIL / ADMIN_PASSWORD in .env an
ddev artisan db:seed --class=DemoSeeder       # optional: das fiktive Team Feldwerk (baut am Ende die Suchindizes neu)
```

Starte den Vite-Dev-Server und lass ihn laufen:

```bash
ddev exec pnpm dev
```

Öffne <https://werkbuch.ddev.site/login> und melde dich mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` aus `.env` an (`admin@example.com` und `password` in `.env.example`). Die Demo-Personen nutzen `<handle>@feldwerk.example.com` mit dem Passwort `werkbuch-demo`.

## Dienste

| Was | Wo |
|---|---|
| App | `https://werkbuch.ddev.site` |
| Vite-Dev-Server | `https://werkbuch.ddev.site:5173` |
| Diese Doku | `ddev exec pnpm --dir docs dev` → `https://werkbuch.ddev.site:5174/en/` |
| Klickdummy | `ddev exec pnpm clickdummy` → `https://werkbuch.ddev.site:5176` |
| Reverb (WebSockets) | `https://werkbuch.ddev.site:6001` |
| Meilisearch | `https://werkbuch.ddev.site:7701` |
| Mail | `ddev mailpit` |
| Datenbank | `ddev mysql`, Benutzer, Passwort und Datenbank `db` |

Drei Queue-Worker, Scheduler und Reverb laufen als DDEV-Daemons und starten mit `ddev start`. Der Worker `queue` nimmt die Queues in dieser Reihenfolge: `mail` (Mails für „Passwort vergessen“ und Einladungen, vor allem anderen, damit niemand auf sie wartet), `default` (gibt jedes Event an seine Konsumenten), `live` (Live-Updates über Reverb), `notifications` (Inbox, Benachrichtigungsmails, Erinnerungen) und `bulk` (Projekte löschen). Der Worker `queue-webhooks` nimmt `webhooks` allein: ein hängender Empfänger hält seinen Worker bis etwa 17 Sekunden je Versuch auf. Der Worker `queue-index` nimmt `search` (zieht die Suchindizes bei jeder Änderung nach) und `media` (Vorschauen hochgeladener Bilder, `MEDIA_QUEUE` in `.env`). `queue:listen` startet PHP für jeden Job neu und nimmt immer die erste Queue, die einen Job hat, und jedes Event macht Jobs für `default`, `live` und `notifications`: dahinter kamen Suchtreffer und Vorschauen Minuten zu spät, darum haben sie einen eigenen Worker. Die Reihenfolge aller Queues steht in `config('werkbuch.queues')`. Das Dashboard von Meilisearch fragt nach dem Schlüssel `MEILISEARCH_KEY` aus `.env`.

Der Scheduler ruft jede Minute `app:redispatch-events` und `app:send-notification-mails` auf; stündlich räumt er Uploads ab, die kein Text übernommen hat, schickt die Erinnerungen an alle, bei denen es gerade 08:00 ist, und räumt alte Benachrichtigungen auf (alles in `routes/console.php`).

Jede Mail der App landet in Mailpit (`ddev mailpit`): „Passwort vergessen“, Einladungen und Benachrichtigungsmails. Benachrichtigungsmails werden je Person und Item `NOTIFICATION_MAIL_DELAY` Minuten gesammelt (5 in `.env.example`); `ddev artisan app:send-notification-mails --now` schickt alles Offene sofort. Mit `MAIL_MAILER=log` oder `array` gilt werkbuch als ohne Mailserver: dann gibt es gar keine Benachrichtigungsmails, nur die Inbox.

Reverb liefert die Live-Updates auf Port 6001 (`REVERB_*` in `.env`; der Browser bekommt Host, Port und Schema zur Laufzeit, es gibt keine `VITE_REVERB_*`-Variablen). Reverb liest den Code nur beim Start: nach einer Änderung an Kanälen oder am Live-Konsumenten `ddev restart`. Ohne Reverb (`BROADCAST_CONNECTION=null`) verbindet nichts, und Listen ziehen nach, wenn sie das nächste Mal laden. Mehr unter [Benachrichtigungen](/de/concepts/notifications#live-updates).

Hochgeladene Dateien liegen auf der privaten Disk `local` (`storage/app/private`), nie in `public/`. Eine Datei darf höchstens `ATTACHMENTS_MAX_MB` groß sein (standardmäßig 25 MB). Davor hat PHP eigene Grenzen, `upload_max_filesize` und `post_max_size`; sie müssen über `ATTACHMENTS_MAX_MB` liegen, sonst verwirft PHP eine große Datei, bevor werkbuch die Grenze nennen kann. DDEV erlaubt 100 MB, die CI setzt 30 MB und 32 MB. Eine Datei über einer der Grenzen ist ein `413` mit `reason: payload_too_large`. Mehr unter [Rich Text](/de/concepts/rich-text#bilder-und-dateien).

Webhooks gehen über die Queue `webhooks` des Workers `queue-webhooks` raus. `.ddev/config.yaml` setzt `WEBHOOKS_ALLOW_PRIVATE=true` (`web_environment`), ein Webhook darf also auf einen Empfänger im privaten Netz oder auf deinem Rechner zeigen. DDEV gibt das PHP als echte Umgebungsvariable mit, die `.env` nie überschreibt: um die Sperre privater Netze auszuprobieren, änderst du die Zeile in `.ddev/config.yaml` und rufst `ddev restart`; die Tests schalten sie selbst aus. Einen Empfänger auf deinem Mac, der auf `127.0.0.1` hört, erreicht der Container als `http://host.docker.internal:<port>/` (geprüft mit `ddev exec curl http://host.docker.internal:<port>/hook`); hör auf dem Loopback, nicht auf `0.0.0.0`, sonst fragt die macOS-Firewall, und der Port ist im Netz offen. Die e2e-Specs starten so einen Empfänger selbst (`e2e/webhookReceiver.ts`, `E2E_WEBHOOK_HOST`). Die Demo-Webhooks des `DemoSeeder` feuern auch in DDEV, an Hosts, die es nicht gibt; nach einem Tag mit Ereignissen schaltet das System „Deploy-Bot“ ab und benachrichtigt die Org-Admins, wie im Klickdummy. `ddev artisan migrate:fresh --seed --seeder=DemoSeeder` stellt sie wieder her, der e2e-Seeder schaltet sie aus. Mehr unter [Webhooks](/de/webhooks).

## Tests und Prüfungen

Jede Prüfung läuft in DDEV, damit die Versionen zur CI passen.

```bash
ddev artisan test --coverage --min=100                    # Pest, 100 % Zeilenabdeckung (PCOV)
ddev artisan test --filter=LoginTest               # eine Datei oder ein Test
ddev exec vendor/bin/phpstan analyse --memory-limit=1G    # Larastan, Level 8
ddev exec vendor/bin/pint                                 # PHP formatieren
ddev exec pnpm typecheck                                  # tsc
ddev exec pnpm test:coverage                              # Vitest mit Schwellen je Ordner; 100 % Zeilen erst zusammen mit Playwright
ddev exec pnpm --dir docs build                           # diese Doku
```

Die Tests nutzen eine eigene Datenbank `testing`, die DDEV beim Start anlegt. Die Tests in `tests/Integration` brauchen zusätzlich ein laufendes Meilisearch (`ddev describe` nennt den Dienst `meilisearch`); sie nutzen das Index-Präfix `testing_` und lassen die Indizes der App in Ruhe. Alle anderen Tests suchen in einer nachgebauten Suchmaschine im Speicher. `ddev exec` reicht seine Argumente an eine Shell weiter: Kommandos mit Glob-Mustern gehören in einfache Anführungszeichen.

### Browser-Tests und zusammengeführte Abdeckung

Die Playwright-Suite in `e2e/` läuft auf deinem Rechner gegen die DDEV-Seite, weil die Browser native Programme sind und das `node_modules` der App dem Container gehört. `e2e/` ist ein eigenes pnpm-Projekt.

```bash
pnpm --dir e2e install                       # einmalig, auf dem Rechner
pnpm --dir e2e exec playwright install chromium
ddev exec pnpm build:coverage                # instrumentierter Frontend-Build (vorher `pnpm dev` beenden)
pnpm --dir e2e test                          # legt die E2E-Daten an, dann laufen die Tests
ddev exec pnpm coverage:merge                # Vitest und Playwright zusammen: 100 % Zeilen über resources/js
```

Der CI-Job `e2e` läuft dieselbe Suite gegen `php artisan serve` mit MariaDB, Meilisearch und Mailpit als Services, Reverb auf Port 8080 (`e2e/ci.env`) und drei Workern, einem auf `mail,default,live,notifications,bulk`, einem auf `search,media` und einem auf `webhooks`. Live-Specs brauchen Reverb und die Queue `live`; ohne beides steht das Banner „Live-Updates pausiert“, und die Specs warten vergeblich.

Das Frontend muss von Vitest und Playwright zusammen zu 100 % an Zeilen abgedeckt sein. Nach dem Playwright-Lauf schlägt `coverage:merge` darunter fehl. Führe danach `ddev exec pnpm build` aus, damit ein Build ohne Instrumentierung zurückbleibt.

## Passwort vergessen

Kann sich niemand mehr anmelden, setze auf der Kommandozeile ein neues Passwort. Das Kommando fragt danach und beendet alle Sitzungen des Kontos:

```bash
ddev artisan app:reset-password du@example.com
```

Ohne Terminal liest es stattdessen die erste Zeile von STDIN.

Authenticator-App und Recovery-Codes verloren? `ddev artisan app:reset-two-factor du@example.com` schaltet den zweiten Faktor des Kontos aus und beendet seine Sitzungen; danach meldet das Passwort allein an, und der zweite Faktor lässt sich in den Einstellungen neu einrichten.

## MCP lokal

Der MCP-Server läuft unter `https://werkbuch.ddev.site/mcp`. Lege unter **Persönliche Einstellungen → API & MCP** ein Token mit `mcp`, `read` und `write` an und probiere es mit `curl`, ohne MCP-Client:

```bash
curl https://werkbuch.ddev.site/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
```

`tools/call` geht genauso (`"params": {"name": "whoami", "arguments": {}}`). Das Snippet für Claude Code aus dem Token-Dialog verbindet einen echten Client. `php artisan mcp:inspector` nicht benutzen: Es startet den Inspector über `npx`, und dieses Projekt nimmt nur pnpm. Anfragen zählen gegen `MCP_RATE_LIMIT` (300 je Minute und Token in `.env.example`). Mehr unter [MCP](/de/mcp).

## Wartungsbefehle

```bash
ddev artisan app:sync-roles            # gleicht Rollen und Rechte in der Datenbank mit dem Code ab
ddev artisan app:redispatch-events     # reicht liegengebliebene Events erneut an ihre Konsumenten
ddev artisan app:send-notification-mails   # stellt gesammelte Benachrichtigungsmails ohne Job neu ein; mit --now gehen alle offenen sofort raus
ddev artisan app:search-sync           # schickt die Einstellungen der Suchindizes (config/scout.php) an Meilisearch
ddev artisan app:search-import         # leert die Suchindizes und füllt sie neu aus der Datenbank
ddev artisan app:prune-attachments --dry-run --min-age=30   # nennt Bilder und Dateien, die kein Text mehr nennt
```

Die Migration der Rollen führt `app:sync-roles` aus; von Hand brauchst du es nur, wenn sich eine Rechtetabelle im Code ohne Migration geändert hat. `app:redispatch-events` läuft jede Minute im Scheduler, von Hand brauchst du es nur, um nach einem Ausfall des Schedulers aufzuholen.

Auch `app:send-notification-mails` läuft jede Minute: es gibt fällige Sammelmails, deren Job verloren ging, erneut an die Queue, sobald 35 Minuten lang kein Versuch lief. Mit `--now` schickt es jede offene Sammlung im eigenen Prozess, fällig oder nicht; das brauchst du vor einer Wartung oder lokal, statt fünf Minuten zu warten.

`app:search-sync` brauchst du nach einer Änderung der Index-Einstellungen in `config/scout.php`. `app:search-import` baut die Indizes von Grund auf: beim ersten Start, nach `migrate:fresh` und als Reparatur, wenn die Suche Änderungen verpasst hat (etwa nachdem Meilisearch stundenlang ausgefallen war). Während des Imports ist die Suche kurz leer. Mehr unter [Suche](/de/search#betrieb).

Bilder und Dateien, die in einen Text eingefügt wurden, bleiben erhalten, wenn der Text sie verliert, damit History und Rückgängig funktionieren. `app:prune-attachments` entfernt die, die kein aktueller Text ihres Projekts mehr nennt (die Beschreibung oder ein Rich-Text-Wert eines Items, der Text eines Kommentars) und die älter als `--min-age` Tage sind (Standard 30); `--dry-run` listet sie nur auf, je mit Projekt, ID, Dateiname und Größe, und zählt sie zusammen. Auch Bilder, die nur eine ältere Fassung eines Texts in der History zeigt, gehen dabei; wähle das Mindestalter danach. Dateien aus der Dateiliste eines Items räumt der Befehl nie ab, die löschst du dort. Außerdem entfernt er Ordner auf der Medien-Disk, deren Medien-Zeile fehlt (eine Vorschau, die entstand, während ihr Bild gelöscht wurde), wenn alle ihre Dateien älter als das Mindestalter sind. Ein Projekt mit einem Text, der sich nicht lesen lässt, überspringt er (`skipped WEB: unreadable text of …`, auch im Log) und entfernt dort nichts; die übrigen Projekte kommen trotzdem dran. Uploads, die nie ein Text übernommen hat (ein Bild in einem Kommentar, der nie abgeschickt wurde), gehen von selbst: ein Job des Schedulers entfernt sie stündlich, sobald sie älter als 24 Stunden sind. Wer ein Item löscht, löscht die Dateien des Items und seiner Kommentare mit, wer einen Kommentar löscht, dessen Dateien, wer ein Projekt löscht, alle Dateien des Projekts. Ein Bild, das ein anderer Text des Projekts noch zeigt (aus einem Text in einen anderen kopiert), bleibt: es gehört dann diesem Text.

## Docker-Image

Das Image der [Einrichtung](/de/setup) entsteht aus dem `Dockerfile` im Wurzelordner des Repositorys: das Frontend mit Vite in einer Node-Stufe, dann PHP-FPM und nginx auf `serversideup/php`. Wer eine Änderung am Image, an den Compose-Dateien oder am Entrypoint ausprobieren will, baut es und lässt den Smoke-Test dagegen laufen, auf dem eigenen Rechner mit Docker (etwa Colima) und nie, während die Playwright-Suite läuft:

```bash
docker buildx build --load -t werkbuch:local .
WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh
```

`scripts/compose-smoke.sh` startet `docker-compose.yml` mit einer frischen `.env` in einem temporären Ordner, meldet sich an, prüft die Live-Updates über den einen Port, die Suche, die Grenzen, die Rechte in den Containern und das Access-Log, startet dieselben Volumes ein zweites Mal und entfernt den Stack am Ende samt Volumes; die letzte Zeile ist `smoke: ok`. `SMOKE_KEEP=1` behält den Stack, `SMOKE_PORT` setzt den Port auf `127.0.0.1` (Standard `7740`). Der CI-Job `image` macht dasselbe auf `amd64` und `arm64`.

## Dokumentation

Diese Doku liegt in `docs/` (VitePress) auf Englisch (`docs/en/`) und Deutsch (`docs/de/`). Jede Seite gibt es in beiden Sprachen unter demselben Dateinamen und mit denselben Überschriften; `tests/Unit/DocsTest.php` prüft das. Die Specs und Pläne in `docs/superpowers/` gehören nicht zur Seite.

```bash
ddev exec pnpm --dir docs dev       # https://werkbuch.ddev.site:5174/en/
ddev exec pnpm --dir docs build     # die Seite in docs/.vitepress/dist
```
