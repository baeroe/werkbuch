# Einrichtung mit Docker Compose

werkbuch läuft als Docker-Compose-Stack aus acht Diensten. Sechs davon kommen aus einem Image, `baeroe/werkbuch` (für `linux/amd64` und `linux/arm64`): der Web-Dienst, Reverb für die Live-Updates, drei Queue-Worker und der Scheduler. Die anderen beiden sind MariaDB 11.4 und Meilisearch 1.56. Alles ist über einen Port erreichbar; HTTPS kommt von einem Reverse Proxy davor (siehe [Reverse Proxy](/de/reverse-proxy)).

::: warning Vor dem ersten Release
Das Image `baeroe/werkbuch` mit seinen Tags (`latest`, `0.1.0`) und die Dateien unter `raw.githubusercontent.com/baeroe/werkbuch/main` gibt es erst mit dem ersten Release, ebenso der Digest, den `docker buildx imagetools inspect` unter [Versionen](#versionen) zeigt. Bis dahin das Image aus einem Klon des Repositorys bauen:

```bash
git clone https://github.com/baeroe/werkbuch.git && cd werkbuch
docker buildx build --load -t werkbuch:local .
```

Dann `docker-compose.yml` und `.env.docker.example` aus dem Klon nehmen statt sie herunterzuladen und `WERKBUCH_IMAGE=werkbuch:local` in der `.env` setzen (in der Standalone-Datei: `image: werkbuch:local`).
:::

## Voraussetzungen

- Docker Engine mit Compose v2.20 oder neuer: Die Dienste starten in der Reihenfolge ihrer Healthchecks (`depends_on` mit `condition: service_healthy`).
- Ein Rechner mit `amd64` oder `arm64`.
- Mindestens 2 vCPU und 2 GB RAM, empfohlen 4 GB. Der Speicher geht an:
  - Meilisearch, das den Suchindex im Speicher hält und beim Indexieren bis zu zwei Drittel des RAM nimmt. Auf einer knappen Maschine `MEILI_MAX_INDEXING_MEMORY` (in Bytes, etwa `536870912` für 512 MiB) im `environment` von `meilisearch` setzen.
  - MariaDB.
  - PHP-FPM im Web-Dienst, mit bis zu 20 Prozessen zu höchstens 512 MB. Eine Anfrage braucht meist 30 bis 60 MB, auf einem Host mit 2 GB aber `PHP_FPM_PM_MAX_CHILDREN=8` im `environment` von `werkbuch` setzen.
  - Vier Worker-Container: drei Queues und der Scheduler.
- 10 GB Platte, dazu der Platz der Anhänge.

Einstellungen wie diese beiden gehören in eine `docker-compose.override.yml` neben der `docker-compose.yml`; `docker compose` liest sie von selbst. In der Standalone-Datei stehen sie direkt bei den Diensten dort.

```yaml
services:
  werkbuch:
    environment:
      PHP_FPM_PM_MAX_CHILDREN: "8"
  meilisearch:
    environment:
      MEILI_MAX_INDEXING_MEMORY: "536870912" # Bytes, 512 MiB
```

## Schnellstart: einfügen und deployen

Eine Compose-Datei mit allem darin, ohne `.env`:

1. Den Block unten in Dockge oder Portainer als neuen Stack einfügen oder als `compose.yaml` auf dem Server speichern.
2. Die fünf Werte oben ändern: `APP_URL` (die https-Adresse des Reverse Proxys), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DB_PASSWORD` und `MEILISEARCH_KEY`. Lange Zufallswerte nehmen, etwa mit `openssl rand -hex 24`; der Schlüssel von Meilisearch braucht mindestens 16 Zeichen.
3. Deployen (Dockge, Portainer) oder `docker compose up -d` ausführen. Auf `werkbuch: ready` in den Logs von `werkbuch` warten, dann `APP_URL` öffnen und mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` anmelden.

werkbuch startet nicht, solange einer der drei Werte noch `change-me` ist: Der Web-Dienst stoppt bei jedem davon (beim Admin-Passwort nur, solange es kein Konto gibt), MariaDB beim Datenbank-Passwort, Meilisearch bei seinem Schlüssel. Er lauscht auf Port `7740` auf jeder Adresse des Servers (`0.0.0.0`): Den Reverse Proxy auf `http://<server>:7740` zeigen lassen. Läuft der Proxy auf demselben Host, die Port-Zeile als `"127.0.0.1:7740:8080"` schreiben, damit nur der Proxy ihn erreicht, siehe [Was werkbuch glaubt](/de/reverse-proxy#was-werkbuch-glaubt).

Der erste Admin entsteht beim ersten Start. Danach liest werkbuch das Admin-Passwort oben nicht mehr: dort wieder `change-me` eintragen, damit das eigene Passwort nicht in der Datei bleibt. Die Zeile selbst bleibt stehen, die Dienste verweisen auf sie. `DB_PASSWORD` so lassen: MariaDB speichert es beim ersten Start. Als root kann sich in dieser Datei niemand bei MariaDB anmelden (der Hash des Passworts passt zu keinem Passwort); Backups nutzen den Benutzer `werkbuch`.

<<< @/../docker-compose.standalone.yml{yaml}

Alles andere an dieser Datei direkt darin ändern: Der Block `x-werkbuch-environment` hält die Einstellungen aller werkbuch-Container, die Zeile `image:` die Version. Wer die Einstellungen lieber in einer eigenen `.env` neben der Compose-Datei hat (etwa damit die Compose-Datei bei Updates unverändert bleibt), nimmt stattdessen den Weg unten.

## Dateien

```bash
mkdir werkbuch && cd werkbuch
curl -fsSLO https://raw.githubusercontent.com/baeroe/werkbuch/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/baeroe/werkbuch/main/.env.docker.example
```

## .env

Die `.env` vor dem ersten Start ausfüllen. Die Passwörter sind in der Vorlage absichtlich leer: Bis sie gesetzt sind, bricht `docker compose up` mit `DB_PASSWORD missing` ab (oder `DB_ROOT_PASSWORD`, `MEILISEARCH_KEY`, `APP_URL`, `ADMIN_EMAIL`).

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `APP_URL` | ja | Öffentliche Adresse samt `https://`, ohne Schrägstrich am Ende, etwa `https://pm.example.com`. Links, Mails, die Adresse der Live-Updates und der erlaubte `Host`-Header kommen daher: Anfragen für jeden anderen Host bekommen `400`. Cookies sind sicher markiert, wenn sie mit `https://` beginnt. Ohne Proxy, für einen ersten Blick auf dem eigenen Rechner: `http://localhost:7740`. |
| `APP_LOCALE` | nein | `en` (Standard) oder `de`: die Sprache der Organisation, gesetzt, wenn sie beim ersten Start entsteht. Später unter **Einstellungen → Allgemein** änderbar. |
| `WERKBUCH_IMAGE` | nein | Standard `baeroe/werkbuch:latest`. Eine Version festlegen, siehe [Versionen](#versionen). |
| `WERKBUCH_BIND`, `WERKBUCH_PORT` | nein | Adresse und Port des Web-Dienstes auf dem Host, Standard `0.0.0.0` und `7740` (der Container lauscht auf `8080`). `WERKBUCH_BIND=127.0.0.1` hält den Port lokal, für einen Proxy auf demselben Host (nicht im Container), siehe [Reverse Proxy](/de/reverse-proxy#was-werkbuch-glaubt). |
| `ADMIN_EMAIL` | ja | E-Mail des ersten Admins. Compose startet ohne sie nicht, auch später nicht; genutzt wird sie nur, solange werkbuch kein Konto hat. |
| `ADMIN_PASSWORD` | erster Start | Passwort des ersten Admins, mindestens 8 Zeichen, nie `change-me`. Gelesen nur, solange werkbuch kein Konto hat; nach der ersten Anmeldung entfernen, siehe [Passwörter](#passworter). |
| `DB_PASSWORD` | ja | Passwort des Datenbank-Benutzers `werkbuch`. MariaDB speichert es beim ersten Start; ändert man es danach in der `.env`, bricht die Verbindung. |
| `DB_ROOT_PASSWORD` | ja | Passwort des root-Benutzers von MariaDB. root kann sich nur im Container `mariadb` anmelden. |
| `MEILISEARCH_KEY` | ja | Master-Key von Meilisearch, mindestens 16 Zeichen (`openssl rand -hex 32`). Mit einem kürzeren Schlüssel startet Meilisearch nicht, und werkbuch wartet darauf. |
| `APP_KEY` | nein | Schlüssel der App. Leer: entsteht beim ersten Start und bleibt im Daten-Volume. Nie nachträglich ändern, siehe [Was wo liegt](#was-wo-liegt). |
| `REVERB_APP_KEY`, `REVERB_APP_SECRET` | nein | Schlüssel und Geheimnis der Live-Updates (Reverb). Leer: entstehen beim ersten Start und bleiben im Daten-Volume. |
| `TRUSTED_PROXIES` | nein | IP-Adressen oder CIDR-Netze (keine Hostnamen), deren `X-Forwarded-*`-Header werkbuch glaubt, durch Kommas getrennt. Leer: localhost und die privaten Netze. Auf den eigenen Proxy eingrenzen, siehe [Reverse Proxy](/de/reverse-proxy#was-werkbuch-glaubt). |
| `MAIL_MAILER` | nein | `log` (Standard) schreibt Mails ins Log und verschickt nichts: Einladungen werden als Link weitergegeben, „Passwort vergessen“ fehlt, und Benachrichtigungen bleiben in der Inbox. `smtp` verschickt sie. |
| `MAIL_SCHEME` | nein | `smtps` für TLS ab dem ersten Byte. Leer: `smtps` auf Port 465, sonst `smtp`, das auf TLS wechselt, wenn der Server es anbietet. |
| `MAIL_HOST`, `MAIL_PORT` | mit `smtp` | Mailserver und Port (Standard `587`). |
| `MAIL_USERNAME`, `MAIL_PASSWORD` | mit `smtp` | Anmeldung am Mailserver, falls er eine verlangt. |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | nein | Absender jeder Mail, Standard `werkbuch@example.com` und `werkbuch`. |
| `ATTACHMENTS_MAX_MB` | nein | Größter Upload in MB, Standard `25`. PHP und nginx im Image nehmen 30 und 32 MB: Ein größerer Wert wirkt darüber nicht, der Upload endet vorher mit `413` (das Log des Web-Dienstes warnt beim Start). Für größere Uploads auch diese Grenzen anheben, siehe [Betrieb](/de/operations#uploads). |
| `NOTIFICATION_MAIL_DELAY` | nein | Minuten, bis die Benachrichtigungen eines Work Items in einer Mail rausgehen, Standard `5`. |
| `WEBHOOKS_ALLOW_PRIVATE` | nein | `true` lässt Webhooks private Netze erreichen (`10.x`, `172.16.x`, `192.168.x`, localhost und ähnliche); Adressen der Metadaten-Dienste von Clouds und Link-local bleiben gesperrt. Standard `false`. Siehe [Webhooks](/de/webhooks). |
| `API_RATE_LIMIT` | nein | Anfragen je Minute an die REST-API je Token oder, ohne Token, je IP-Adresse. Standard `600`. |
| `API_SESSION_RATE_LIMIT` | nein | Anfragen je Minute an die REST-API je angemeldeter Browser-Sitzung. Standard `3000`. |
| `MCP_RATE_LIMIT` | nein | Anfragen je Minute an den [MCP-Server](/de/mcp) je Token oder je IP-Adresse. Standard `300`. |

Nur diese Variablen erreichen die Container: Die Compose-Datei reicht sie weiter. Alles andere gehört ins `environment` eines Dienstes, am besten in einer `docker-compose.override.yml` (siehe [Voraussetzungen](#voraussetzungen)). Dort nie eine Variable, die mit `PHP_`, `NGINX_`, `SSL_`, `LOG_` oder `TRUSTED_PROXY` beginnt, leer setzen: Das Startskript des Basis-Images stoppt dann den Web-Dienst.

Die Adresse, die der Browser für die Live-Updates nutzt, kommt aus `APP_URL` (Host, Port und `wss://` bei `https://`). `REVERB_PUBLIC_HOST`, `REVERB_PUBLIC_PORT` und `REVERB_PUBLIC_SCHEME` setzen eine andere; nötig sind sie nur, wenn der Browser Reverb nicht unter `APP_URL` erreicht, was mit dem Stack und einem Proxy davor nie vorkommt. Sie stehen nicht in der `.env`: bei Bedarf ins `environment` von `werkbuch` eintragen.

## Start

```bash
docker compose up -d
docker compose logs -f werkbuch    # auf "werkbuch: ready" warten, dann Strg+C
```

`docker compose up -d` kehrt zurück, sobald `werkbuch` gesund ist, weil die Worker darauf warten; beim ersten Start kann das ein paar Minuten dauern. Mit `--wait` kehrt es erst zurück, wenn jeder Dienst gesund ist. Dann `APP_URL` öffnen und mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` anmelden.

Bei jedem Start macht der Web-Dienst:

1. Er stoppt, wenn `DB_PASSWORD` oder `MEILISEARCH_KEY` noch `change-me` ist.
2. Er nimmt `APP_KEY`, `REVERB_APP_KEY` und `REVERB_APP_SECRET` aus der Umgebung, sonst aus dem Daten-Volume, sonst erzeugt er sie einmal und schreibt sie dorthin (`werkbuch: generated APP_KEY in storage/app/.app-key (data volume)`).
3. Er wartet bis zu 60 Sekunden auf die Datenbank; ist sie nicht erreichbar, stoppt er mit `werkbuch: database mariadb:3306 not reachable after 60s`, und Docker startet ihn neu.
4. Er migriert die Datenbank.
5. Er legt den ersten Admin aus `ADMIN_EMAIL` und `ADMIN_PASSWORD` an, solange werkbuch kein Konto hat.
6. Er schickt die Einstellungen der Suchindizes an Meilisearch und füllt den Index, wenn er leer ist oder Felder dieser Version fehlen.
7. Er baut seine Caches (Konfiguration mit den Schlüsseln, Routen, Views, Events).
8. Er baut das OpenAPI-Dokument und warnt, wenn `ATTACHMENTS_MAX_MB` größer ist, als PHP annimmt.
9. Er schreibt `werkbuch: ready` ins Log und startet nginx und PHP-FPM.

Scheitert ein Schritt, stoppt der Container mit einer Meldung, so bedient eine halb migrierte Instanz nie Anfragen. Meilisearch muss gesund sein, bevor der Web-Dienst startet. Die Worker, der Scheduler und Reverb starten, sobald der Web-Dienst gesund ist, lesen die Schlüssel aus dem Daten-Volume, bauen nur ihre Caches und schreiben `werkbuch: ready: php artisan …`; sie migrieren nie.

`werkbuch: no account yet, set ADMIN_EMAIL and ADMIN_PASSWORD and run docker compose up -d` heißt: Es gibt noch kein Konto, und keins ist entstanden, weil `ADMIN_PASSWORD` leer ist. Das Passwort in der `.env` setzen und `docker compose up -d` erneut ausführen. Sobald es ein Konto gibt, lässt jeder Start die Konten in Ruhe und endet seine Zeile mit `ADMIN_EMAIL and ADMIN_PASSWORD are only used on the first start.`, mit oder ohne `ADMIN_PASSWORD`.

## Passwörter

`ADMIN_PASSWORD` braucht nur der erste Start. Nach der ersten Anmeldung die Zeile aus der `.env` löschen und `docker compose up -d` ausführen, damit das Passwort weder in der Datei noch in der Umgebung des Containers steht. In der Standalone-Datei stattdessen wieder `change-me` eintragen (siehe Schnellstart oben).

Das eigene Passwort ändert jede Person, und einen zweiten Faktor richtet sie ein, unter **Persönliche Einstellungen → Sicherheit**. Ein vergessenes Passwort setzt der Server zurück; das Kommando fragt das neue zweimal ab, ohne es anzuzeigen:

```bash
docker compose exec werkbuch php artisan app:reset-password admin@example.com
```

Ohne Terminal liest es stattdessen die erste Zeile seiner Eingabe, etwa `docker compose exec -T werkbuch php artisan app:reset-password admin@example.com < neues-passwort.txt`. Das Passwort ist nie ein Argument und landet so nicht im Verlauf der Shell. Das Zurücksetzen meldet das Konto überall ab; seine API-Tokens bleiben gültig.

Wer die Authenticator-App und die Recovery-Codes verloren hat, bekommt den zweiten Faktor abgeschaltet; die Person meldet sich dann nur mit dem Passwort an und kann ihn neu einrichten:

```bash
docker compose exec werkbuch php artisan app:reset-two-factor admin@example.com
```

## Dienste

| Dienst | Aufgabe | Netze | Healthcheck |
|---|---|---|---|
| `werkbuch` | nginx und PHP-FPM auf Port `8080`, veröffentlicht als `7740`; migriert beim Start, reicht `/app/` (den WebSocket) an Reverb weiter | `default`, `backend` | `/up` für den Host aus `APP_URL` |
| `reverb` | der WebSocket-Server der Live-Updates auf Port `6001` | `backend` | `/up` auf Port `6001` |
| `queue` | Worker für die Queues `mail`, `default`, `live`, `notifications`, `bulk`: Events, Live-Updates, Benachrichtigungs-Mails, Löschen von Projekten | `default`, `backend` | der Worker-Prozess läuft |
| `queue-index` | Worker für `search` und `media`: der Suchindex und die Vorschauen von Bildern | `default`, `backend` | der Worker-Prozess läuft |
| `queue-webhooks` | Worker für `webhooks`: die Zustellungen | `default`, `backend` | der Worker-Prozess läuft |
| `scheduler` | startet die geplante Arbeit: Benachrichtigungs-Mails, Erinnerungen, Vorlagen, die nächtlichen Automatisierungen, Aufräumen | `default`, `backend` | der Scheduler-Prozess läuft |
| `mariadb` | die Datenbank, gestartet mit `--max-allowed-packet=64M` | `backend` | MariaDB antwortet und InnoDB ist bereit |
| `meilisearch` | die Suche | `backend` | `/health` |

`backend` ist ein internes Netz: kein veröffentlichter Port und kein Weg ins Internet. MariaDB, Meilisearch und Reverb hängen nur dort. Nur der Web-Dienst veröffentlicht einen Port; die Worker und der Scheduler hängen auch in `default`, weil sie Mails und Webhooks verschicken.

Suche und Vorschauen haben einen eigenen Worker, `queue-index`, damit sie nicht hinter den Events jeder Änderung warten; Webhooks haben einen, `queue-webhooks`, weil ein hängender Empfänger seinen Worker je Versuch bis zu 17 Sekunden hält. Von `queue-index` läuft genau ein Container, nie skalieren.

Alle werkbuch-Container laufen als `www-data` mit `no-new-privileges`; der Code im Image ist für sie nur lesbar.

## Was wo liegt

| Was | Wo |
|---|---|
| Anhänge und ihre Vorschauen, Bilder der Organisation, der Konten und der Projekte, dazu die Schlüssel `.app-key`, `.reverb-app-key`, `.reverb-app-secret` | Volume `werkbuch-data` (`/var/www/html/storage/app` in den Containern; Reverb hängt es nur lesend ein) |
| Datenbank: Projekte, Work Items, Wiki, alles andere, Sitzungen und die Queues | Volume `mariadb-data` |
| Suchindex | Volume `meili-data`; ist er leer, baut werkbuch ihn beim nächsten Start aus der Datenbank neu |
| Einstellungen | `.env` neben der `docker-compose.yml` oder der Block oben in der Standalone-Datei |
| Logs | keine auf der Platte: `docker compose logs` |

Container lassen sich jederzeit neu erzeugen, die Volumes bleiben. `docker compose down -v` löscht sie, und mit ihnen die Datenbank, jeden Upload und die Schlüssel.

`.app-key` gehört in jedes Backup und darf nie verloren gehen. `APP_KEY` verschlüsselt die Geheimnisse der Webhooks und die zweiten Faktoren samt Recovery-Codes: Mit einem anderen Schlüssel ist jede Person mit zweitem Faktor ausgesperrt, und jeder Webhook braucht ein neues Geheimnis. `APP_KEY` nie nachträglich ändern. Wer ihn in der `.env` setzt, setzt ihn vor dem ersten Start; bei einer Instanz, die schon `.app-key` hat, bleibt er leer. Ein `APP_KEY` in der `.env` gewinnt vor `.app-key`; weichen die beiden ab, warnt jeder Start mit `werkbuch: APP_KEY of the environment differs from storage/app/.app-key`. Die Reverb-Schlüssel sind weniger heikel: Neue verlangen nur ein Neuladen der offenen Tabs.

## Eigene MariaDB

Um statt des Dienstes `mariadb` eine vorhandene MariaDB 11.4 zu nutzen, die `docker-compose.yml` anpassen:

1. Den Dienst `mariadb` und den Eintrag `mariadb` unter `depends_on` von `werkbuch` entfernen.
2. `DB_HOST`, `DB_PORT`, `DB_DATABASE` und `DB_USERNAME` im Block `x-werkbuch-environment` ergänzen (Standard `mariadb`, `3306`, `werkbuch`, `werkbuch`); `DB_PASSWORD` steht schon dort. `DB_WAIT_TIMEOUT` legt fest, wie viele Sekunden der Start auf sie wartet (Standard 60).
3. Dem Benutzer alle Rechte an seiner Datenbank geben.
4. In der Konfiguration dieses Servers `max_allowed_packet` auf mindestens `64M` setzen. Zustellungen der Webhooks werden in einer Anweisung geschrieben, je Webhook ein Body bis 1 MiB, und dafür reicht der Standard von 16 MiB nicht.

Die Datenbank muss aus dem Netz `default` des Stacks erreichbar sein.

## Speicher

Uploads liegen nur im Volume `werkbuch-data`. S3 oder ein anderer Objektspeicher wird in dieser Version nicht unterstützt; die Platte für die Anhänge einplanen und das Volume sichern.

## Versionen

`latest` folgt jedem Release. Eine Version legt `WERKBUCH_IMAGE` in der `.env` fest, als Tag wie `WERKBUCH_IMAGE=baeroe/werkbuch:0.1.0` oder, damit sich das Image unter dem Tag sicher nie ändert, mit seinem Digest: `WERKBUCH_IMAGE=baeroe/werkbuch:0.1.0@sha256:…` (`docker buildx imagetools inspect baeroe/werkbuch:0.1.0` zeigt ihn). Dann holt `docker compose pull` nur, was gewählt ist. In der Standalone-Datei stattdessen die Zeile `image:` ändern.

## docker-compose.yml

Die vollständige Compose-Datei, dieselbe, die `curl` oben aus dem Main-Branch lädt. Meist bleibt sie, wie sie ist: Alles, was man einstellt, kommt in die `.env`.

<<< @/../docker-compose.yml{yaml}
