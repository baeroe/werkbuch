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
# oder stattdessen auf Englisch: ddev artisan db:seed --class=DemoSeederEn   (dasselbe Team als Fieldwork)
```

Starte den Vite-Dev-Server und lass ihn laufen:

```bash
ddev exec pnpm dev
```

Öffne <https://werkbuch.ddev.site/login> und melde dich mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` aus `.env` an (`admin@example.com` und `password` in `.env.example`). Die Demo-Personen nutzen `<handle>@feldwerk.example.com` mit dem Passwort `werkbuch-demo`. `DemoSeederEn` legt dieselbe Demo auf Englisch an: das Team Fieldwork mit gleichen Handles, Projekten, Keys und Zeiten, die Personen unter `<handle>@fieldwork.example.com`. Eine Datenbank hält eine Sprache: jeder der beiden Seeder lehnt eine Datenbank mit der Demo der anderen ab, zum Wechseln vorher `ddev artisan migrate:fresh`. `tests/Feature/Seeders/DemoLanguagesTest.php` legt beide an und hält die englische Demo Zeile für Zeile auf die Form der deutschen; der e2e-Seeder bleibt bei der deutschen Demo.

## Dienste

| Was | Wo |
|---|---|
| App | `https://werkbuch.ddev.site` |
| Vite-Dev-Server | `https://werkbuch.ddev.site:5173` |
| Diese Doku | `ddev exec pnpm --dir docs dev` → `https://werkbuch.ddev.site:5174/de/` |
| Klickdummy | `ddev exec pnpm clickdummy` → `https://werkbuch.ddev.site:5176` |
| Reverb (WebSockets) | `https://werkbuch.ddev.site:6001` |
| Meilisearch | `https://werkbuch.ddev.site:7701` |
| Mail | `ddev mailpit` |
| Datenbank | `ddev mysql`, Benutzer, Passwort und Datenbank `db` |

Drei Queue-Worker, Scheduler und Reverb laufen als DDEV-Daemons und starten mit `ddev start`. Der Worker `queue` nimmt die Queues in dieser Reihenfolge: `mail` (Mails für „Passwort vergessen“ und Einladungen, vor allem anderen, damit niemand auf sie wartet), `default` (gibt jedes Event an seine Konsumenten), `live` (Live-Updates über Reverb), `notifications` (Inbox, Benachrichtigungsmails, Erinnerungen) und `bulk` (Projekte löschen). Der Worker `queue-webhooks` nimmt `webhooks` allein: ein hängender Empfänger hält seinen Worker bis etwa 17 Sekunden je Versuch auf. Der Worker `queue-index` nimmt `search` (zieht die Suchindizes bei jeder Änderung nach) und `media` (Vorschauen hochgeladener Bilder, `MEDIA_QUEUE` in `.env`). `queue:listen` startet PHP für jeden Job neu und nimmt immer die erste Queue, die einen Job hat, und jedes Event macht Jobs für `default`, `live` und `notifications`: dahinter kamen Suchtreffer und Vorschauen Minuten zu spät, darum haben sie einen eigenen Worker. Die Reihenfolge aller Queues steht in `config('werkbuch.queues')`. Das Dashboard von Meilisearch fragt nach dem Schlüssel `MEILISEARCH_KEY` aus `.env`.

Sitzungen, der Cache und die Zähler der Drosseln liegen ebenfalls in der Datenbank (`SESSION_DRIVER=database` und `CACHE_STORE=database` in `.env.example`, ebenso im Image). Der Cache-Store `database` läuft über den Treiber `retrying-database` (`App\Support\RetryingDatabaseStore`, `config/cache.php`): Zwei Anfragen einer Person, die gleichzeitig denselben abgelaufenen Zähler schreiben, können sich in InnoDB verklemmen, und der Store versucht so eine Anweisung außerhalb einer Transaktion bis zu dreimal, nie nach einem Lock-Wait. Behalte diesen Treiber; Laravels eigener Treiber `database` reicht die Verklemmung als `500` durch. Die Tests laufen mit `CACHE_STORE=array`; `tests/Integration/CacheDeadlockTest.php` prüft den Store gegen MariaDB.

Der Scheduler ruft jede Minute `app:redispatch-events`, `app:send-notification-mails` und `app:run-templates` auf; stündlich räumt er Uploads ab, die kein Text übernommen hat, schickt die Erinnerungen an alle, bei denen es gerade 08:00 ist, räumt alte Benachrichtigungen und das Webhook-Protokoll auf und führt die nächtlichen Automatisierungen aus, sobald es für die Organisation 03:00 ist (alles in `routes/console.php`). Er arbeitet wirklich, auf der Datenbank der App: auf einer frischen Demo archiviert WEB nachts erledigte Items, und die Vorlagen der Demo legen an ihren Tagen Items an. Der e2e-Seeder schaltet die Demo-Automatisierungen aus und pausiert die Zeitpläne der Demo-Vorlagen; auf einer Datenbank, die die Playwright-Suite geseedet hat, läuft beides nicht.

Jede Mail der App landet in Mailpit (`ddev mailpit`): „Passwort vergessen“, Einladungen und Benachrichtigungsmails. Benachrichtigungsmails werden je Person und Item `NOTIFICATION_MAIL_DELAY` Minuten gesammelt (5 in `.env.example`); `ddev artisan app:send-notification-mails --now` schickt alles Offene sofort. Mit `MAIL_MAILER=log` oder `array` gilt werkbuch als ohne Mailserver: dann gibt es gar keine Benachrichtigungsmails, nur die Inbox.

Reverb liefert die Live-Updates auf Port 6001 (`REVERB_*` in `.env`; der Browser bekommt Host, Port und Schema zur Laufzeit, es gibt keine `VITE_REVERB_*`-Variablen). Reverb liest den Code nur beim Start: nach einer Änderung an Kanälen oder am Live-Konsumenten `ddev restart`. Ohne Reverb (`BROADCAST_CONNECTION=null`) verbindet nichts, und Listen ziehen nach, wenn sie das nächste Mal laden. Mehr unter [Benachrichtigungen](/de/concepts/notifications#live-updates).

Hochgeladene Dateien liegen auf der privaten Disk `local` (`storage/app/private`), nie in `public/`. Eine Datei darf höchstens `ATTACHMENTS_MAX_MB` groß sein (standardmäßig 25 MB). Davor hat PHP eigene Grenzen, `upload_max_filesize` und `post_max_size`; sie müssen über `ATTACHMENTS_MAX_MB` liegen, sonst verwirft PHP eine große Datei, bevor werkbuch die Grenze nennen kann. DDEV erlaubt 100 MB, die CI setzt 30 MB und 32 MB. Eine Datei über einer der Grenzen ist ein `413` mit `reason: payload_too_large`. Mehr unter [Rich Text](/de/concepts/rich-text#bilder-und-dateien).

Webhooks gehen über die Queue `webhooks` des Workers `queue-webhooks` raus. `.ddev/config.yaml` setzt `WEBHOOKS_ALLOW_PRIVATE=true` (`web_environment`), ein Webhook darf also auf einen Empfänger im privaten Netz oder auf deinem Rechner zeigen. DDEV gibt das PHP als echte Umgebungsvariable mit, die `.env` nie überschreibt: um die Sperre privater Netze auszuprobieren, änderst du die Zeile in `.ddev/config.yaml` und rufst `ddev restart`; die Tests schalten sie selbst aus. Einen Empfänger auf deinem Mac, der auf `127.0.0.1` hört, erreicht der Container als `http://host.docker.internal:<port>/` (geprüft mit `ddev exec curl http://host.docker.internal:<port>/hook`); hör auf dem Loopback, nicht auf `0.0.0.0`, sonst fragt die macOS-Firewall, und der Port ist im Netz offen. Die e2e-Specs starten so einen Empfänger selbst (`e2e/webhookReceiver.ts`, `E2E_WEBHOOK_HOST`). Die Demo-Webhooks des `DemoSeeder` feuern auch in DDEV, an Hosts, die es nicht gibt; nach einem Tag mit Ereignissen schaltet das System „Deploy-Bot“ ab und benachrichtigt die Org-Admins, wie im Klickdummy. `ddev artisan migrate:fresh --seed --seeder=DemoSeeder` stellt sie wieder her, der e2e-Seeder schaltet sie aus. Mehr unter [Webhooks](/de/webhooks).

## Tests und Prüfungen

Jede Prüfung läuft in DDEV, damit die Versionen zur CI passen.

```bash
ddev artisan test --coverage --min=100                    # Pest, 100 % Zeilenabdeckung (PCOV)
ddev artisan test --filter=LoginTest                      # eine Datei oder ein Test
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

In der CI läuft die Suite in drei Jobs, keiner davon ist ein Pflicht-Check. `e2e-build` baut das instrumentierte Frontend einmal (`pnpm build:coverage`) und lässt Vitest mit Abdeckung laufen. `e2e (<projekt>)` läuft die Suite je Playwright-Projekt einmal (`desktop-light`, `desktop-dark`, `phone-light`, `phone-dark`), alle vier parallel. Jeder Job liefert diesen Build mit `php artisan serve` aus und hat eigene Services für MariaDB, Meilisearch und Mailpit, Reverb auf Port 8080 (`e2e/ci.env`) und drei Worker, einen auf `mail,default,live,notifications,bulk`, einen auf `search,media` und einen auf `webhooks`. Live-Specs brauchen Reverb und die Queue `live`; ohne beides steht das Banner „Live-Updates pausiert“, und die Specs warten vergeblich. Ein Projekt-Job läuft `--project=setup --project=<projekt>` mit `E2E_MERGE=0`, bildet seine Abdeckung per `--remap-only` auf die Quellen ab und lädt nur diese Datei als `e2e-coverage-<projekt>` hoch, auch nach gescheiterten Tests. `e2e-coverage` führt Vitest und die vier Dateien mit `--expect-shards=desktop-light,desktop-dark,phone-light,phone-dark` zusammen und lädt den Bericht als `frontend-coverage` hoch. Der Job scheitert unter 100 % Zeilen, wenn ein Projekt keine Abdeckung hinterließ, und in seinem letzten Schritt, sobald ein Projekt-Job scheiterte: Die Abdeckung kann 100 % zeigen, obwohl Tests scheiterten.

Das Frontend muss von Vitest und Playwright zusammen zu 100 % an Zeilen abgedeckt sein. Nach dem Playwright-Lauf schlägt `coverage:merge` darunter fehl. Führe danach `ddev exec pnpm build` aus, damit ein Build ohne Instrumentierung zurückbleibt.

Playwright hält seine Abdeckung je Projekt: Die Fixture schreibt `coverage/e2e/<projekt>/<test>-<n>.json`, und `coverage:merge` liest jede Datei unter `coverage/e2e`, gleich wie tief. Die 100 % gelten nur für die Summe aus Vitest und allen vier Projekten. Kein Projekt schafft sie allein (die Schublade am Handy, das dunkle Theme, die Touch-Menüs), darum hat ein einzelnes Projekt kein eigenes Gate. Zu Beginn jedes Laufs leert `globalSetup` den Ordner `coverage/e2e`, auch die Ordner der Projekte, die der Lauf auslässt (`--project=desktop-light`). Das ist Absicht: Ein Teil-Lauf ist nie die Summe, und die Reste eines früheren Laufs ließen ihn so aussehen.

Für einen CI-Job je Projekt hat der Merge zwei Optionen:

```bash
E2E_MERGE=0 pnpm --dir e2e test                # lässt coverage/e2e/<projekt>/ ungemergt liegen
node scripts/coverage-merge.mjs --remap-only --out coverage/e2e-<projekt>.json
node scripts/coverage-merge.mjs --expect-shards=desktop-light,desktop-dark,phone-light,phone-dark
```

`--remap-only` bildet jede Datei unter `coverage/e2e` einmal auf die Quellen zurück und schreibt sie als eine Datei, ohne Bericht und ohne Gate. Ein volles Projekt hinterlässt weit über tausend Dateien zu je etwa 2 MB, gemappt sind es rund 4 MB. Die Treffer summieren sich vor und nach dem Mapping gleich, weil alle Projekte denselben Build mit denselben Source-Maps laufen. `--expect-shards` liest genau die genannten Projekte, jedes aus `coverage/e2e/<name>.json`, `coverage/e2e/<name>/` oder `coverage/e2e/<präfix>-<name>/` (der Ordner, den `actions/download-artifact` aus dem Artefakt `e2e-coverage-<name>` macht). Er scheitert und nennt jedes Projekt ohne Abdeckung, mit leerem Ordner oder mit zwei solchen Quellen.

### Lasttests

Die Suite `Load` (`tests/Load`) misst die API gegen 50 000 Items. Sie hat eine eigene Konfiguration `phpunit.load.xml` und eine eigene Datenbank `load`, die DDEV beim Start neben `testing` anlegt; sie gehört weder zu `phpunit.xml` noch zur Abdeckung.

```bash
ddev exec vendor/bin/pest --configuration=phpunit.load.xml                    # die ganze Suite
ddev exec vendor/bin/pest --configuration=phpunit.load.xml --filter=SeedLoad  # nur die Daten
```

Ruf Pest direkt auf: `ddev artisan test` stellt `--configuration=phpunit.xml` vor deine Angabe, PHPUnit warnt, dass die Option doppelt kam, und endet mit Exitcode 1, auch wenn jeder Test besteht.

`phpunit.load.xml` erzwingt jeden Wert, darunter die Datenbank `load` und das Such-Präfix `load_`, weil sonst die Umgebung von DDEV gewänne. `Tests\Load\LoadWorld::ensure()` prüft beides vor seiner ersten Anweisung und lehnt alles andere ab. Danach läuft `migrate --force`, so bekommt eine geseedete Datenbank neue Migrationen, und es seedet neu (`migrate:fresh` und `Database\Seeders\LoadSeeder`), wenn der Tabelle `load_meta` die Version des Seeders oder seine Zahlen fehlen. Jede Änderung am Seeder erhöht `LoadSeeder::VERSION`.

Der Seeder schreibt den Demo-Katalog, 30 Personen `load-NN@example.com` (`load-01` ist Org-Admin, Passwort `werkbuch-load`), 5 Bots, 20 Projekte `L01` bis `L20` mit je 2 500 Items und ihrer History (rund 266 000 Events), 5 000 Relationen, 100 000 Kommentare (je Projekt ein Item mit 40), 2 000 Wiki-Seiten in `L01` in vier Ebenen, 200 Vorlagen (50 werden in derselben Minute fällig) und 50 ausgeschaltete Webhooks. Das erste Epic jedes Projekts hat die 40 Items danach als Kinder, 12 feste Relationen und drei Dateien. Er schreibt gesammelt ohne die Events der App und nimmt seine Texte aus einem festen Vorrat Tiptap-JSON, nie aus Markdown. Danach baut er den Suchindex (`load_work_items` und die anderen) neu auf. In DDEV dauert der erste Lauf rund eine Minute (23 s für die Zeilen, 33 s für den Suchindex); die Datenbank wird rund 580 MB groß (die Events rund 210 MB). Spätere Läufe nutzen sie weiter.

`tests/Load/ApiLoadTest.php` misst die Antworten, die der Browser auf diesen Daten bekommt: die erste Seite der Item-Liste in jeder Sortierung und beiden Richtungen, die Liste eines Projekts, jede Gruppierung über alle Projekte und in einem, zehn Zählungen, das Board eines Projekts, ein Epic mit allem, was es einbetten kann, Kommentare und History eines Items, die Suche, die Projekte, das Wiki und die Seiten, die ein Item nennen. Einige Zeilen lesen als Mitglied statt als Org-Admin. Jede Zeile läuft einmal zum Aufwärmen, dann dreimal, und vor jedem Lauf vergisst die App ihre `scoped`-Instanzen und die Sichtbarkeit (`Tests\Load\Support\Budget`). Das Budget ist 1,5 Sekunden je Antwort für den Median der drei Läufe. Jeder Lauf muss mit 200 antworten. Die Zahl der Abfragen ist die harte Prüfung, auf zwei Wegen. In jedem Lauf muss sie dieselbe sein wie in einer kleinen Welt, denselben Anfragen in einer Transaktion (zurückgerollt), die von jedem Projekt nur die ersten 100 Items und vom Wiki nur die obersten Seiten behält: Keine Abfrage wächst mit den Daten außerhalb der Antwort. Wo eine Antwort in beiden Welten gleich groß ist (eine Seite Items, Kommentare, History oder Projekte, das Board, das Epic mit Kindern, Relationen und Dateien), muss eine kleinere Antwort in der großen Welt genauso oft fragen: eine Seite mit 25 statt 100 (5 bzw. 2 Projekte), das Epic mit 10 seiner 40 Kinder, drei Relationen und einer Datei weniger. So fragt keine dieser Antworten die Datenbank je Item, Kommentar, Event, Projekt, Kind, Relation oder Datei einmal mehr. Gruppierungen und Zählungen haben keine kleinere Antwort: Ihre Gruppen sind in beiden Welten dieselben (nur die Gruppierung nach Eltern wächst, 2 500 Epics gegen 100), und die Zählungen fragen mit Absicht einmal je Filter; eine Abfrage je Gruppe oder je Filter bleibt Sache der Feature-Tests. Die Suche vergleicht sich mit einer Suche mit 50 Treffern je Art, das Wiki seine 2 000 Seiten mit 20. Nicht gemessen, für jede Zeile gleich: Die Suite hält Sitzung und Zähler der Drossel im Speicher und handelt in jedem Lauf mit demselben Konto-Objekt; eine Anfrage im Betrieb liest sie, ein paar Abfragen und Millisekunden mehr. Ein eigener Test verteilt die Ränge der 2 500 Items eines Projekts neu, in höchstens 1,5 Sekunden.

`tests/Load/SearchLoadTest.php` misst die Suche, die die Palette 150 ms nach der letzten Taste fragt, darum mit eigenem Budget, 0,5 Sekunden für den Median: ein, zwei und drei Wörter, alle Arten und nur Items, als Org-Admin (20 Projekte) und als Person, die ein Projekt sieht (in einer Transaktion, die zurückgerollt wird). Dazu prüft sie das Dokument des Items mit 40 Kommentaren gegen die Grenze seines Kommentartexts und baut am Ende jeden Index neu auf: in höchstens fünf Minuten, bis Meilisearch jedes Dokument hat, mit höchstens 512 MB für PHP. Der Neuaufbau leert die Indizes unterwegs, darum läuft er zuletzt.

`tests/Load/WorkLoadTest.php` misst die Arbeit hinter der API, jeden Teil einmal (ein zweiter Lauf fände ihn erledigt) und mit eigenem Budget: eine Mehrfachbearbeitung von 100 Items (ein Bot als Assignee und eine Priorität) mit den 50 eingeschalteten Webhooks in höchstens 3 Sekunden, dann den Konsum ihrer 300 Events (Suche, Benachrichtigungen, Live und Webhooks: 15 000 Zustellungen, der größte Body für ein Item mit 200 KB Beschreibung innerhalb der Grenze einer Payload), nur gemessen; die Nacht von Auto-Close über die 20 Projekte in höchstens 10 Minuten und 256 MB; den Scheduler mit den 50 fälligen Vorlagen in höchstens 1,5 Sekunden; und einen Vorlagenlauf, der 20 Bilder zu je 2 MB kopiert, in höchstens 10 Sekunden und 256 MB. Ihre Tests nutzen `DatabaseTransactions`: Die Actions committen in die Transaktion des Tests, darum läuft ihre Arbeit nach dem Commit, und das Ende des Tests rollt alles zurück. Der Such-Konsument schreibt in die Engine der Feature-Tests im Speicher, nie in Meilisearch, und die Bilder landen auf einer Fake-Disk. Ihre Konstante für Zeilen über dem Budget ist `WORK_OVER_BUDGET`. Ihre Zahlen sind eine Untergrenze, nicht das, was der Betrieb braucht: In der Transaktion des Tests ist jeder Commit einer Action ein Savepoint (kein Schreiben auf die Platte je Transaktion; im Betrieb committet jede der 100 Transaktionen der Mehrfachbearbeitung und der 8 396 der Nacht für sich, und die Sperren der Nacht sammeln sich bis zum Rollback, also wird kein Warten auf eine Sperre gemessen), die Nacht läuft ohne Konsumenten (im Betrieb gehen ihre rund 16 800 Events in den Queues an je vier Konsumenten), und der Konsum der Mehrfachbearbeitung hat einen Empfänger von Benachrichtigungen (der Seed hat keine Beobachter, nur die Lead-Person des Projekts hört von jedem Item).

Am Ende gibt die Suite eine Tabelle aller Zeilen aus (Median, die drei Läufe, die Abfragen, den Spitzenspeicher einer Zeile, die einmal läuft, die Abfragen gegen 100 Items und für die kleinere Antwort) und schreibt sie nach `storage/logs/load-budget.md`. Eine Zeile, die die Konstante `OVER_BUDGET` in `ApiLoadTest` nennt (`'<zeile>' => 'Task <n>: <grund>'`), läuft trotzdem und steht in der Tabelle; nur ihr Median wird nicht geprüft, ihre Abfragen schon. Ein Test hält fest, dass die Konstante nur Zeilen nennt, die es gibt.

In GitHub Actions läuft die Suite im Job `load` bei jedem Pull Request neben `tests`, mit eigener MariaDB (Datenbank `load`) und eigenem Meilisearch. Er ist kein Pflicht-Check; die Tabelle ist das Artefakt `load-budget`. Vor der Suite setzt der Job den Buffer Pool seiner MariaDB auf 1 GiB (`SET GLOBAL innodb_buffer_pool_size`), wie ihn DDEV hat; die 128 MiB des Images fassten die 580 MB Daten nicht. Wie `tests` und die e2e-Jobs setzt er außerdem `max_allowed_packet` auf 64 MiB, wie im Stack. Sein Runner bleibt langsamer als DDEV, ein Median nahe am Budget ist dort einen Blick wert.

Lass die Lastsuite nie gleichzeitig mit den anderen Tests oder den Browser-Tests laufen: Sie teilen sich MariaDB, Meilisearch und die CPU der VM, die Messungen stimmten dann nicht.

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
ddev artisan app:sync-roles                                # gleicht Rollen und Rechte in der Datenbank mit dem Code ab
ddev artisan app:redispatch-events                         # reicht liegengebliebene Events erneut an ihre Konsumenten
ddev artisan app:send-notification-mails                   # stellt gesammelte Benachrichtigungsmails ohne Job neu ein; mit --now gehen alle offenen sofort raus
ddev artisan app:run-templates                             # stellt fällige Vorlagen ein; --now führt sie hier aus, --template=<ULID> nur diese
ddev artisan app:run-automations                           # die nächtlichen Automatisierungen, nur um 03:00 der Organisation; --now sofort, --project=<ULID>
ddev artisan app:search-sync                               # schickt die Einstellungen der Suchindizes (config/scout.php) an Meilisearch
ddev artisan app:search-import                             # baut die Suchindizes neu aus der Datenbank auf und tauscht sie ein
ddev artisan app:prune-attachments --dry-run --min-age=30  # nennt Bilder und Dateien, die kein Text mehr nennt
```

Die Migration der Rollen führt `app:sync-roles` aus; von Hand brauchst du es nur, wenn sich eine Rechtetabelle im Code ohne Migration geändert hat. `app:redispatch-events` läuft jede Minute im Scheduler, von Hand brauchst du es nur, um nach einem Ausfall des Schedulers aufzuholen.

Auch `app:send-notification-mails` läuft jede Minute: es gibt fällige Sammelmails, deren Job verloren ging, erneut an die Queue, sobald 35 Minuten lang kein Versuch lief. Mit `--now` schickt es jede offene Sammlung im eigenen Prozess, fällig oder nicht; das brauchst du vor einer Wartung oder lokal, statt fünf Minuten zu warten.

Auch `app:run-templates` läuft jede Minute. Mit `--now` führt es jede fällige Vorlage im eigenen Prozess aus: eine, die scheitert, nennt es, die übrigen laufen trotzdem, und der Befehl endet mit einem Fehler. `app:run-automations` führt Auto-Archiv und Auto-Close aus (der Scheduler tut das stündlich, und sie handeln um 03:00 der Organisation); `--now` führt sie sofort aus, `--project=<ULID>` nur in diesem Projekt. Beide arbeiten auf der Datenbank der App, genau wie der Scheduler.

`app:search-sync` brauchst du nach einer Änderung der Index-Einstellungen in `config/scout.php`. `app:search-import` baut die Indizes von Grund auf: beim ersten Start, nach `migrate:fresh` und als Reparatur, wenn die Suche Änderungen verpasst hat (etwa nachdem Meilisearch stundenlang ausgefallen war). Während des Imports antwortet die Suche weiter aus den alten Indizes. Mehr unter [Suche](/de/search#betrieb).

Bilder und Dateien, die in einen Text eingefügt wurden, bleiben erhalten, wenn der Text sie verliert, damit History und Rückgängig funktionieren. `app:prune-attachments` entfernt die, die kein aktueller Text ihres Projekts mehr nennt (die Beschreibung oder ein Rich-Text-Wert eines Items, ein Kommentar, eine Wiki-Seite oder eine ihrer Versionen, eine Vorlage) und die älter als `--min-age` Tage sind (Standard 30); `--dry-run` listet sie nur auf, je mit Projekt, ID, Dateiname und Größe, und zählt sie zusammen. Auch Bilder, die nur eine ältere Fassung eines Texts in der History zeigt, gehen dabei; wähle das Mindestalter danach. Die Versionen einer Wiki-Seite zählen als Texte und behalten ihre. Dateien aus der Dateiliste eines Items räumt der Befehl nie ab, die löschst du dort. Außerdem entfernt er Ordner auf der Medien-Disk, deren Medien-Zeile fehlt (eine Vorschau, die entstand, während ihr Bild gelöscht wurde), wenn alle ihre Dateien älter als das Mindestalter sind. Ein Projekt mit einem Text, der sich nicht lesen lässt, überspringt er (`skipped WEB: unreadable text of …`, auch im Log) und entfernt dort nichts; die übrigen Projekte kommen trotzdem dran. Uploads, die nie ein Text übernommen hat (ein Bild in einem Kommentar, der nie abgeschickt wurde), gehen von selbst: ein Job des Schedulers entfernt sie stündlich, sobald sie älter als 24 Stunden sind. Wer ein Item löscht, löscht die Dateien des Items und seiner Kommentare mit, wer einen Kommentar, eine Wiki-Seite oder eine Vorlage löscht, deren Dateien, wer ein Projekt löscht, alle Dateien des Projekts. Ein Bild, das ein anderer Text des Projekts noch zeigt (aus einem Text in einen anderen kopiert), bleibt: es gehört dann diesem Text.

## Ungespeicherte Änderungen

Ein Bildschirm mit einem Formular, das Getipptes verlieren kann, rendert einen `LeaveGuard` (`resources/js/features/settings/frame/LeaveGuard.tsx`) mit seinem `dirty`-Zustand. Solange er `dirty` ist, hält ein Besuch innerhalb der App bei „Änderungen verwerfen?“, ebenso Zurück und Vor des Browsers, und Schließen oder Neuladen des Tabs bekommt die eigene Frage des Browsers. Ein gewollter Wechsel (auf die neue Kennung eines eben gespeicherten Projekts) setzt vorher `bypass`.

Halte dich an einen Guard je Bildschirm. Zwei Guards, die zugleich `dirty` sind, halten beide den Besuch: Ihre Dialoge stapeln sich, und die Person wird zweimal gefragt. Ein Bildschirm mit zwei Formularen gibt `dirty` immer nur einem Guard; unter **Sicherheit** schweigt der Guard des Passworts, solange die Recovery-Codes stehen. Text, der seinen Bildschirm überlebt (ein nicht abgeschickter Kommentar, die Beschreibung eines Items, eine Wiki-Seite), braucht keinen Guard: Er bleibt in `resources/js/lib/drafts.ts`, und ein `beforeunload` dieses Moduls fragt, solange etwas nicht gesendet ist.

## Docker-Image

Das Image der [Einrichtung](/de/setup) entsteht aus dem `Dockerfile` im Wurzelordner des Repositorys: das Frontend mit Vite in einer Node-Stufe, dann PHP-FPM und nginx auf `serversideup/php`. Wer eine Änderung am Image, an den Compose-Dateien oder am Entrypoint ausprobieren will, baut es und lässt den Smoke-Test dagegen laufen, auf dem eigenen Rechner mit Docker (etwa Colima) und nie, während die Playwright-Suite läuft:

```bash
docker buildx build --load -t werkbuch:local .
WERKBUCH_IMAGE=werkbuch:local scripts/compose-smoke.sh
```

`scripts/compose-smoke.sh` startet `docker-compose.yml` mit einer frischen `.env` in einem temporären Ordner, meldet sich an, prüft die Live-Updates über den einen Port, die Suche, die Grenzen, die Rechte in den Containern und das Access-Log, startet dieselben Volumes ein zweites Mal und entfernt den Stack am Ende samt Volumes; die letzte Zeile ist `smoke: ok`. `SMOKE_KEEP=1` behält den Stack, `SMOKE_PORT` setzt den Port auf `127.0.0.1` (Standard `7740`). Der CI-Job `image` macht dasselbe auf `amd64` und `arm64`.

## Dokumentation

Diese Doku liegt in `docs/` (VitePress) auf Englisch (`docs/en/`) und Deutsch (`docs/de/`). Jede Seite gibt es in beiden Sprachen unter demselben Dateinamen und mit denselben Überschriften, in der Seitenleiste in derselben Reihenfolge; keine Seite außer dieser nennt eine Phase des Baus. `tests/Unit/DocsTest.php` prüft das. Die Specs und Pläne in `docs/superpowers/` gehören nicht zur Seite.

```bash
ddev exec pnpm --dir docs dev       # https://werkbuch.ddev.site:5174/de/
ddev exec pnpm --dir docs build     # die Seite in docs/.vitepress/dist
```
