# Betrieb

Was im Stack läuft, was ihn verlässt, und die Schalter für den laufenden Betrieb von werkbuch. Das Einrichten steht unter [Einrichtung](/de/setup), der Proxy davor unter [Reverse Proxy](/de/reverse-proxy).

## Worker und Scheduler

Alle Arbeit im Hintergrund läuft über Queues in der Datenbank. Drei Worker-Dienste arbeiten sie ab, je Container ein Worker:

| Dienst | Queues, in dieser Reihenfolge | Tut |
|---|---|---|
| `queue` | `mail`, `default`, `live`, `notifications`, `bulk` | gibt jedes Event an seine Konsumenten, schickt die Live-Updates an Reverb, schreibt die Inbox und sendet Mails (zuerst die Anmelde-Mails: Einladungen und Passwort zurücksetzen auf der Queue `mail`, dann Benachrichtigungen), löscht Projekte, führt Vorlagen und die nächtlichen Automatisierungen aus |
| `queue-index` | `search`, `media` | hält den Suchindex mit jeder Änderung Schritt, erzeugt die Vorschauen hochgeladener Bilder |
| `queue-webhooks` | `webhooks` | stellt Webhooks zu |

Ein Worker nimmt die erste Queue seiner Liste, die einen Job hat. Suche und Vorschauen haben einen eigenen Worker, weil jedes Event Jobs für `default`, `live` und `notifications` macht; die Queue `mail` steht davor, ein Reset-Link oder eine Einladung wartet also nie dahinter; Webhooks haben einen, weil ein hängender Empfänger seinen Worker bis zu 17 Sekunden je Versuch hält. Jeder Worker endet nach einer Stunde (`--max-time=3600`), und Docker startet ihn neu (`restart: unless-stopped`); ein scheiternder Job wird bis zu dreimal versucht, wenn er keine eigene Zahl von Versuchen setzt.

Genau ein `queue-index` laufen lassen, nie skalieren: Zwei Worker auf `search` können beim Neuaufbau eine ältere Fassung eines Dokuments über eine neuere schreiben, und die Suche zeigt den älteren Text, bis sich das Item wieder ändert.

`scheduler` führt `php artisan schedule:work` mit den Aufgaben aus `routes/console.php` aus. Er stellt die Arbeit nur in die Queues, die Worker erledigen sie:

| Wann | Was |
|---|---|
| jede Minute | `app:redispatch-events` (Events, deren Übergabe verloren ging), `app:send-notification-mails` (Sammelmails, die ihren Job verloren), `app:run-templates` (Vorlagen, deren Zeitplan fällig ist) |
| jede Stunde | die Erinnerungen an Fälliges (um 08:00 in der Zeitzone jeder Person), die nächtlichen Automatisierungen Auto-Archiv und Auto-Close (um 03:00 in der Zeitzone der Organisation), das Aufräumen gelesener Benachrichtigungen, nicht übernommener Uploads und des Webhook-Protokolls |

Ohne Scheduler gibt es keine Erinnerungen, keine geplanten Vorlagen, keine nächtlichen Automatisierungen und kein Aufräumen; Änderungen, Mails und Webhooks gehen weiter über die Worker raus. `docker compose ps` zeigt, ob jeder Dienst gesund ist.

## Ausgehende Verbindungen

Nur drei Dinge verlassen den Stack:

- **Zustellungen der Webhooks** aus `queue-webhooks`, an Adresse und Port jedes Webhooks. Der Test-Ping und **Erneut senden** laufen in der Anfrage der Person, die sie klickt, sie gehen also aus `werkbuch` raus.
- **Mail** per SMTP an `MAIL_HOST` und `MAIL_PORT`: Benachrichtigungen, Einladungen und das Zurücksetzen von Passwörtern aus `queue`, die Testmail der [System-Seite](#system-seite) aus `werkbuch`.
- **Namensauflösungen** der Empfänger und des Mailservers, über das DNS von Docker.

werkbuch sendet nie über einen Proxy: `HTTP_PROXY` und `HTTPS_PROXY` der Umgebung gelten für Webhooks nicht, weil ein Proxy den Namen selbst auflöste und so die Prüfung der Adresse umginge ([Webhooks](/de/webhooks#private-netze)). Ein ausgehender Proxy wird in dieser Version nicht unterstützt. Meilisearch läuft mit `MEILI_NO_ANALYTICS`, und `mariadb`, `meilisearch` und `reverb` stehen im internen Netz `backend` ohne Weg nach draußen.

**IPv6:** Ein Docker-Netz hat kein IPv6, solange es nicht eingeschaltet ist. Dann erreicht werkbuch einen Empfänger nur über IPv4, und ein Name, der nur IPv6-Adressen hat, endet im Zustellprotokoll als `unresolvable`. Für solche Empfänger dem Docker-Daemon IPv6 geben (siehe die Doku von Docker zu IPv6), es in einer `docker-compose.override.yml` für das Netz `default` einschalten und dann `docker compose down && docker compose up -d` ausführen, damit das Netz neu entsteht:

```yaml
networks:
  default:
    enable_ipv6: true
```

**Firewall:** Eingehend muss nur der veröffentlichte Port von `werkbuch` (`7740`) offen sein, und nur für den Reverse Proxy. Ausgehend brauchen die Container DNS, den Port des Mailservers und die Ports der Webhook-Empfänger (meist 443). Docker leitet den Verkehr der Container an den Regeln `INPUT` und `OUTPUT` des Hosts vorbei, ufw eingeschlossen; Regeln für Container gehören in die Kette `DOCKER-USER`.

## Private Ziele für Webhooks

Standardmäßig erreicht ein Webhook keine privaten Netze, kein Loopback und keine Link-local-Adressen. `WEBHOOKS_ALLOW_PRIVATE` auf `true` in der `.env` erlaubt private Netze (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), Carrier-Grade-NAT (`100.64.0.0/10`) und das Loopback, für einen Empfänger im eigenen Netz. Alles andere bleibt gesperrt: Link-local (`169.254.0.0/16`, `fe80::/10`), die Metadaten-Adressen der Cloud-Anbieter (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`), Multicast, Dokumentations- und reservierte Netze. Die Einzelheiten stehen unter [Webhooks](/de/webhooks#private-netze).

Aus Sicht der Container liegen auch die Dienste des Stacks in einem privaten Netz: Mit dem Schalter darf ein Webhook auf `http://mariadb:3306`, `http://meilisearch:7700`, `http://reverb:6001` oder `http://werkbuch:8080` zeigen, und `localhost` ist der sendende Container selbst. Meilisearch und Reverb handeln nur auf Anfragen, die mit ihren Schlüsseln signiert sind, und ein Webhook schickt ein `POST` mit JSON; trotzdem zeigt das Zustellprotokoll Org-Admins die ersten 2 KB jeder Antwort. Den Schalter nur einschalten, wenn ein Empfänger im eigenen Netz ihn braucht.

## Drosseln und Proxys

| Variable | Standard | Zählt |
|---|---|---|
| `API_RATE_LIMIT` | `600` | Anfragen je Minute an die REST-API je Token, ohne Token je IP-Adresse |
| `API_SESSION_RATE_LIMIT` | `3000` | Anfragen je Minute an die REST-API je angemeldeter Browser-Sitzung |
| `MCP_RATE_LIMIT` | `300` | Anfragen je Minute an den MCP-Server je Token, ohne Token je IP-Adresse |

In der `.env` setzen und `docker compose up -d` ausführen. Mehr zu den Grenzen unter [REST-API](/de/api#grenzen) und [MCP](/de/mcp#grenzen).

Jede Grenze je IP-Adresse, und die Grenzen der Anmeldung (20 Versuche je Minute und Adresse, 5 Fehlversuche je E-Mail und Adresse), brauchen die echte Adresse des Clients. Hinter einem Proxy liest werkbuch sie aus `X-Forwarded-For`, aber nur von einem Proxy aus `TRUSTED_PROXIES`. Steht der Proxy nicht darin, kommt jede Anfrage von der Adresse des Proxys: Alle Clients teilen sich ein Kontingent, und ein paar falsche Passwörter sperren alle von dieser Adresse aus. Leer heißt `TRUSTED_PROXIES` localhost und die privaten Netze; das deckt einen Proxy in einem Docker-Netz, glaubt den Header aber auch vom Gateway von Docker, sodass jeder, der den veröffentlichten Port direkt erreicht, eine beliebige Adresse angeben kann. Wie man es eingrenzt, steht unter [Reverse Proxy](/de/reverse-proxy#was-werkbuch-glaubt).

Weil sich eine Adresse fälschen lässt, hat die Anmeldung eine dritte Grenze, die sie nicht beachtet: 50 Fehlversuche je E-Mail-Adresse und Stunde, über alle IP-Adressen. Ist sie erreicht, kann sich diese E-Mail-Adresse für den Rest der Stunde nicht anmelden, auch nicht mit dem richtigen Passwort, und die Meldung nennt die Wartezeit in Minuten. Ein Browser, der sich schon einmal mit genau dieser Adresse angemeldet hat, ist davon ausgenommen: Nach jeder Anmeldung, auch nach dem zweiten Faktor, setzt werkbuch ein verschlüsseltes Cookie `werkbuch_device` für ein Jahr. So kann niemand, der nur die Adresse kennt, die Besitzerin aus ihrem eigenen Browser aussperren. Das Cookie hängt am aktuellen Passwort: Ein neues Passwort macht jeden solchen Browser wieder unbekannt, bis er sich einmal neu anmeldet. Ausgenommen ist der Browser, in dem das Passwort in den Einstellungen geändert wurde. Die beiden anderen Grenzen gelten für diesen Browser wie für jeden anderen. Eine erfolgreiche Anmeldung setzt den Zähler zurück, „Passwort vergessen“ bleibt offen, und ein neues Passwort über den Link aus der Mail hebt die Grenze auf. `php artisan app:reset-password` tut dasselbe.

Auch der Schritt des zweiten Faktors ist begrenzt: fünf Versuche je Minute und 30 Versuche je Konto und 24 Stunden, über alle Anmeldungen. Codes, Recovery-Codes und erfolgreiche Codes zählen alle, darum spricht die Meldung von Versuchen. Sind die 30 verbraucht, kommt das Konto für den Rest der 24 Stunden nicht mehr durch den zweiten Faktor, und die Meldung nennt die Wartezeit in Stunden und verweist auf den Betreiber, der den zweiten Faktor mit `php artisan app:reset-two-factor` zurücksetzen kann. Ein neues Passwort setzt den Zähler zurück.

## Live-Updates

Der Browser hält einen WebSocket zu Reverb (Dienst `reverb`) offen, solange ein Tab offen ist: `wss://<Host aus APP_URL>/app/…`, weitergeleitet von nginx in `werkbuch`. Reverb läuft in dieser Version ohne `ext-uv`, und seine Event-Schleife wartet mit PHPs `stream_select` auf die Verbindungen, das bei 1024 Verbindungen endet. Eine Instanz trägt darum etwa 1000 offene Tabs gleichzeitig. Wer Verbindungen über einer eigenen Grenze abweisen will, setzt `REVERB_APP_MAX_CONNECTIONS` in der `environment` von `reverb` (in einer `docker-compose.override.yml`):

```yaml
services:
  reverb:
    environment:
      REVERB_APP_MAX_CONNECTIONS: "900"
```

Ein abgewiesener Tab zeigt **Live-Updates pausiert**, und seine Listen aktualisieren sich beim nächsten Laden. Eine Event-Schleife auf `ext-uv` höbe die Grenze auf; sie kommt vielleicht mit einer späteren Version des Images.

## Logs

Auf die Platte wird nichts geschrieben: `docker compose logs <dienst>` zeigt, was jeder Container nach stdout und stderr schreibt.

- **Die App** schreibt nach stderr ab der Stufe `info` (`LOG_LEVEL`). Stacktraces tragen keine Werte von Argumenten (`zend.exception_ignore_args`), so landet weder ein Passwort noch das Geheimnis eines Webhooks in einem Trace, auch nicht in `failed_jobs`.
- **nginx** in `werkbuch` schreibt je Anfrage eine Zeile nach stdout: Adresse des Clients, Zeit, Methode, Pfad, Status, Größe, Dauer, User-Agent und `X-Forwarded-For` (der Client hinter dem Proxy). Der Pfad kommt ohne Query-String, der die Signaturen von Einladungs- und Upload-Links trägt; das Token eines Links zum Zurücksetzen des Passworts und einer MCP-Upload-Adresse ist maskiert (`/reset-password/...`), und ein Pfad endet an seinem ersten `%`. Der Referer fehlt, ebenso der Healthcheck, den Compose alle 15 Sekunden aus dem Container schickt.

`LOG_LEVEL` ist keine Variable der `.env`: Sie ändert sich nur im `environment` eines Dienstes, in der `docker-compose.override.yml` oder der Standalone-Datei. Dort auf `info` lassen. Mit `debug` und `MAIL_MAILER=log` steht ein angefordertes Zurücksetzen des Passworts als Mail im Log, samt Link.

Was trotzdem im Log stehen kann:

- nginx des Basis-Images beantwortet eine Anfrage an `/index.php/reset-password/<token>` mit einer Weiterleitung und schreibt diesen Pfad vollständig ins Log. werkbuchs eigene Links haben nie diese Form; eine solche Anfrage kommt von jemandem, der den Link schon hat.
- Das Fehlerlog von nginx (ebenfalls stderr) nennt die ganze Anfragezeile samt Query-String, wenn nginx selbst eine Anfrage ablehnt oder nicht zustellen kann: ein Body über seiner Größengrenze, PHP-FPM oder Reverb antworten nicht. Für einen Upload eines MCP-Agenten ist das eine signierte Adresse, die höchstens 15 Minuten gilt; für eine Einladung ist es der Link selbst, der offen bleibt, bis er angenommen wird oder nach 7 Tagen abläuft (eine neue Einladung an dieselbe Adresse schließt den alten Link). Die Logs vertraulich behandeln.

`LOG_OUTPUT_LEVEL=debug` des Basis-Images wird im Image von werkbuch nicht unterstützt: Seine Debug-Dateien gehören root, damit ein Fehler der App nie die Konfiguration umschreiben kann, die PHP beim nächsten Start liest.

## Konfiguration im laufenden Container

Einstellungen in der `.env` (oder in der Standalone-Datei) ändern und `docker compose up -d` ausführen: Compose erzeugt die Container, deren Einstellungen sich geändert haben, neu, und ihr Start baut die Caches wieder auf.

Nie `php artisan config:clear` oder `php artisan optimize:clear` per `docker compose exec` ausführen. Die Schlüssel `APP_KEY`, `REVERB_APP_KEY` und `REVERB_APP_SECRET` stehen nur im Config-Cache jedes Containers, den der Start aus dem Daten-Volume baut. Ohne den Cache verliert der Container sie bis zum nächsten Start: Anmeldung, die Geheimnisse der Webhooks und die Live-Updates gehen dann nicht mehr. Braucht ein Container einen frischen Cache, ihn mit `docker compose restart <dienst>` neu starten.

## Leere Variablen

Nie eine Variable, die mit `PHP_`, `NGINX_`, `SSL_`, `LOG_`, `APACHE_`, `HEALTHCHECK_PATH` oder `TRUSTED_PROXY` beginnt, in einem `environment`-Block (in der `docker-compose.override.yml` oder in der Standalone-Datei) auf einen leeren Wert setzen: Das Startskript des Basis-Images stoppt dann den Web-Dienst (`LOG_LEVEL: ""` genügt). Eine Variable weglassen, um ihren Standard zu behalten. Über die `.env` passiert das nicht: `docker-compose.yml` reicht nur die Variablen aus `.env.docker.example` weiter, die einzige davon mit einem solchen Präfix ist `TRUSTED_PROXIES`, und ein leeres `TRUSTED_PROXIES=` fällt auf seinen Standard zurück.

## Suche

Jeder Start von `werkbuch` schickt die Einstellungen der Suchindizes an Meilisearch (`app:search-sync`) und füllt die Indizes aus der Datenbank, wenn einer leer ist oder seinen Dokumenten Felder dieser Version fehlen (`app:search-import --if-empty`). Eine neue Instanz, ein geleertes Volume von Meilisearch und ein Update, das der Suche Felder bringt, erledigt also der Start. Ist Meilisearch nicht erreichbar, bricht der Start ab.

Die Indizes von Hand neu aufbauen, wenn die Suche Änderungen verpasst hat, etwa nachdem Meilisearch stundenlang weg war:

```bash
docker compose exec werkbuch php artisan app:search-import
```

Während des Imports antwortet die Suche weiter aus dem alten Index, den der neue am Ende ersetzt. Wie sich die Suche verhält, solange Meilisearch weg ist, steht unter [Suche](/de/search#betrieb).

## Mail

`MAIL_MAILER=log` (der Standard) sendet nichts: Einladungen werden als Links weitergegeben, **Passwort vergessen** ist ausgeblendet, und Benachrichtigungen bleiben in der Inbox. Mit `MAIL_MAILER=smtp` und `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` in der `.env` sendet werkbuch sie; `MAIL_SCHEME=smtps` (oder Port 465) spricht TLS ab dem ersten Byte, sonst wechselt werkbuch zu TLS, wenn der Server es anbietet. Nach `docker compose up -d` eine Testmail von der System-Seite schicken.

## System-Seite

Org-Admins finden den Zustand der Instanz unter **Einstellungen → System**: die Version, die wartenden Jobs je Queue mit dem ältesten, die für später geplanten Jobs, ob Meilisearch antwortet, mit seinen offenen und gescheiterten Aufgaben, ob ein Mailserver eingerichtet ist (mit dem Knopf **Testmail an …**), ob Reverb antwortet, und die fehlgeschlagenen Jobs mit **Alle erneut versuchen**. Die Prüfung von Reverb läuft innerhalb des Stacks; ob der Browser durch den Proxy kommt, zeigt nur der Browser (kein Banner **Live-Updates pausiert**).

## Uploads

`ATTACHMENTS_MAX_MB` (Standard `25`) ist der größte Upload. PHP und nginx im Image nehmen Bodies bis 30 und 32 MB, und der Start von `werkbuch` warnt, wenn `ATTACHMENTS_MAX_MB` über dem liegt, was PHP nimmt. Für größere Uploads die drei Grenzen des Images, `PHP_UPLOAD_MAX_FILE_SIZE`, `PHP_POST_MAX_SIZE` und `NGINX_CLIENT_MAX_BODY_SIZE`, in der `environment` von `werkbuch` anheben, dem Dienst, der die Uploads annimmt, zusammen mit `ATTACHMENTS_MAX_MB` in der `.env`, etwa für 100 MB:

```yaml
services:
  werkbuch:
    environment:
      PHP_UPLOAD_MAX_FILE_SIZE: "110M"
      PHP_POST_MAX_SIZE: "112M"
      NGINX_CLIENT_MAX_BODY_SIZE: "112M"
```

Auch die Grenze des Reverse Proxys anheben (`client_max_body_size` in nginx und Nginx Proxy Manager). JSON-Bodies bleiben auf 8 MiB begrenzt.
