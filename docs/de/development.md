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

Queue-Worker, Scheduler und Reverb laufen als DDEV-Daemons und starten mit `ddev start`. Der Worker hört auch auf die Queue `search`, die die Suchindizes bei jeder Änderung nachzieht, und auf `media`, die die Vorschauen hochgeladener Bilder rechnet (`MEDIA_QUEUE` in `.env`). Das Dashboard von Meilisearch fragt nach dem Schlüssel `MEILISEARCH_KEY` aus `.env`.

Hochgeladene Dateien liegen auf der privaten Disk `local` (`storage/app/private`), nie in `public/`. Eine Datei darf höchstens `ATTACHMENTS_MAX_MB` groß sein (standardmäßig 25 MB). Davor hat PHP eigene Grenzen, `upload_max_filesize` und `post_max_size`; sie müssen über `ATTACHMENTS_MAX_MB` liegen, sonst verwirft PHP eine große Datei, bevor werkbuch die Grenze nennen kann. DDEV erlaubt 100 MB, die CI setzt 30 MB und 32 MB. Eine Datei über einer der Grenzen ist ein `413` mit `reason: payload_too_large`. Mehr unter [Rich Text](/de/concepts/rich-text#bilder-und-dateien).

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

Das Frontend muss von Vitest und Playwright zusammen zu 100 % an Zeilen abgedeckt sein. Nach dem Playwright-Lauf schlägt `coverage:merge` darunter fehl. Führe danach `ddev exec pnpm build` aus, damit ein Build ohne Instrumentierung zurückbleibt.

## Passwort vergessen

Kann sich niemand mehr anmelden, setze auf der Kommandozeile ein neues Passwort. Das Kommando fragt danach und beendet alle Sitzungen des Kontos:

```bash
ddev artisan app:reset-password du@example.com
```

Ohne Terminal liest es stattdessen die erste Zeile von STDIN.

Authenticator-App und Recovery-Codes verloren? `ddev artisan app:reset-two-factor du@example.com` schaltet den zweiten Faktor des Kontos aus und beendet seine Sitzungen; danach meldet das Passwort allein an, und der zweite Faktor lässt sich in den Einstellungen neu einrichten.

## Wartungsbefehle

```bash
ddev artisan app:sync-roles            # gleicht Rollen und Rechte in der Datenbank mit dem Code ab
ddev artisan app:redispatch-events     # reicht liegengebliebene Events erneut an ihre Konsumenten
ddev artisan app:search-sync           # schickt die Einstellungen der Suchindizes (config/scout.php) an Meilisearch
ddev artisan app:search-import         # leert die Suchindizes und füllt sie neu aus der Datenbank
ddev artisan app:prune-attachments --dry-run --min-age=30   # nennt Bilder und Dateien, die kein Text mehr nennt
```

Die Migration der Rollen führt `app:sync-roles` aus; von Hand brauchst du es nur, wenn sich eine Rechtetabelle im Code ohne Migration geändert hat. `app:redispatch-events` läuft jede Minute im Scheduler, von Hand brauchst du es nur, um nach einem Ausfall des Schedulers aufzuholen.

`app:search-sync` brauchst du nach einer Änderung der Index-Einstellungen in `config/scout.php`. `app:search-import` baut die Indizes von Grund auf: beim ersten Start, nach `migrate:fresh` und als Reparatur, wenn die Suche Änderungen verpasst hat (etwa nachdem Meilisearch stundenlang ausgefallen war). Während des Imports ist die Suche kurz leer. Mehr unter [Suche](/de/search#betrieb).

Bilder und Dateien, die in einen Text eingefügt wurden, bleiben erhalten, wenn der Text sie verliert, damit History und Rückgängig funktionieren. `app:prune-attachments` entfernt die, die kein aktueller Text ihres Projekts mehr nennt (die Beschreibung oder ein Rich-Text-Wert eines Items, der Text eines Kommentars) und die älter als `--min-age` Tage sind (Standard 30); `--dry-run` listet sie nur auf, je mit Projekt, ID, Dateiname und Größe, und zählt sie zusammen. Auch Bilder, die nur eine ältere Fassung eines Texts in der History zeigt, gehen dabei; wähle das Mindestalter danach. Dateien aus der Dateiliste eines Items räumt der Befehl nie ab, die löschst du dort. Außerdem entfernt er Ordner auf der Medien-Disk, deren Medien-Zeile fehlt (eine Vorschau, die entstand, während ihr Bild gelöscht wurde), wenn alle ihre Dateien älter als das Mindestalter sind. Ein Projekt mit einem Text, der sich nicht lesen lässt, überspringt er (`skipped WEB: unreadable text of …`, auch im Log) und entfernt dort nichts; die übrigen Projekte kommen trotzdem dran. Uploads, die nie ein Text übernommen hat (ein Bild in einem Kommentar, der nie abgeschickt wurde), gehen von selbst: ein Job des Schedulers entfernt sie stündlich, sobald sie älter als 24 Stunden sind. Wer ein Item löscht, löscht die Dateien des Items und seiner Kommentare mit, wer einen Kommentar löscht, dessen Dateien, wer ein Projekt löscht, alle Dateien des Projekts. Ein Bild, das ein anderer Text des Projekts noch zeigt (aus einem Text in einen anderen kopiert), bleibt: es gehört dann diesem Text.

## Dokumentation

Diese Doku liegt in `docs/` (VitePress) auf Englisch (`docs/en/`) und Deutsch (`docs/de/`). Jede Seite gibt es in beiden Sprachen unter demselben Dateinamen und mit denselben Überschriften; `tests/Unit/DocsTest.php` prüft das. Die Specs und Pläne in `docs/superpowers/` gehören nicht zur Seite.

```bash
ddev exec pnpm --dir docs dev       # https://werkbuch.ddev.site:5174/en/
ddev exec pnpm --dir docs build     # die Seite in docs/.vitepress/dist
```
