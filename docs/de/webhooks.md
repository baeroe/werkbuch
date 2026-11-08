# Webhooks

Ein Webhook sagt einem anderen System Bescheid, wenn sich in werkbuch etwas ändert: einem Deploy-Skript, einem Chat, einem CRM oder einem KI-Agenten. werkbuch schickt jedes Ereignis, das er abonniert hat, als signierten JSON-`POST` an seine Adresse, versucht es etwa 24 Stunden lang erneut, wenn der Empfänger nicht antwortet, und protokolliert jeden Versuch. Über die API sind Webhooks `GET /api/v1/webhooks`.

## Webhook einrichten

Webhooks verwalten nur Org-Admins: **Einstellungen → Betrieb → Webhooks → Webhook anlegen**. Ein Token des Standard-Bots darf es auch über REST, denn der Standard-Bot ist Org-Admin; alle anderen bekommen `403` (siehe [Rollen und Rechte](/de/concepts/permissions)).

- **Name**: bis zu 120 Zeichen, damit du den Webhook in der Liste und im Protokoll erkennst. Namen müssen nicht eindeutig sein.
- **URL**: `http` oder `https`, höchstens 2048 Zeichen, ohne Benutzer oder Passwort darin. werkbuch folgt nie einer Weiterleitung, gib also die endgültige Adresse an. Adressen in privaten Netzen sind gesperrt (siehe [Private Netze](#private-netze)).
- **Geltungsbereich**: die ganze Organisation oder ein Projekt. Ein Projekt-Webhook bekommt nur die Ereignisse seines Projekts; er geht mit, wenn sein Projekt gelöscht wird.
- **Ereignisse**: einzelne Ereignisse oder eine ganze Gruppe. Hakst du alle Ereignisse einer Gruppe an, speichert werkbuch die Gruppe als `gruppe.*` (etwa `work_item.*`); das nimmt auch Ereignisse mit, die eine spätere Version der Gruppe hinzufügt. Ein Webhook ohne passendes Ereignis bekommt nichts.
- **Nur für einen Bot** (optional): der Webhook bekommt nur, was dieser Bot sehen darf und was ihn betrifft (siehe [Agenten](#agenten)).
- **Aktiv**: aus heißt, es geht nichts raus; Ereignisse aus dieser Zeit werden beim Wiedereinschalten nicht nachgeschickt.

Beim Anlegen zeigt werkbuch das **Geheimnis** einmal: `whsec_` und 43 weitere Zeichen. Trag es gleich beim Empfänger ein. Später kannst du nur ein neues erzeugen (**Neues Geheimnis erzeugen**), das das alte sofort ablöst, auch für Wiederholungen, die noch warten; zwei gültige Geheimnisse gleichzeitig gibt es nicht. werkbuch speichert das Geheimnis mit `APP_KEY` verschlüsselt und zeigt es nie in der Liste, im Protokoll, in Events oder Fehlertexten.

**Wer die Payload liest.** `data` ist für einen Leser geschrieben, so wie die REST-API ihm antworten würde: mit Bot der Bot (seine Rolle, die Items, die er sehen darf; verborgene Relationen und Verweise bleiben verborgen), ohne Bot der Standard-Bot, und der ist Org-Admin. Ein Projekt-Webhook ohne Bot nennt Verweise und Relationen in andere Projekte also mit ihrem Key, wie ein Org-Admin sie sähe. Wer das nicht will, wählt einen Bot mit passenden Mitgliedschaften.

## Ereignisse

<!-- events:start -->

| Ereignis | Wann |
|---|---|
| `project.created` | Ein Projekt wurde angelegt |
| `project.updated` | Name, Kennung, Beschreibung, Lead, Sichtbarkeit, Workflow oder Typen haben sich geändert |
| `project.archived` | Ein Projekt wurde archiviert |
| `project.restored` | Ein archiviertes Projekt wurde wiederhergestellt |
| `project.deleted` | Ein Projekt wurde gelöscht (bekommen nur Webhooks der Organisation) |
| `project.member_added` | Jemand ist einem Projekt beigetreten oder wurde hinzugefügt |
| `project.member_removed` | Jemand wurde aus einem Projekt entfernt |
| `work_item.created` | Ein Item wurde angelegt |
| `work_item.updated` | Felder eines Items haben sich geändert: Titel, Beschreibung, Priorität, Daten, Labels, Properties, Typ, Eltern-Item, Rang, Dateien |
| `work_item.state_changed` | Ein Item ist in einen anderen Status gewechselt |
| `work_item.assigned` | Ein Item hat einen anderen oder keinen Assignee bekommen |
| `work_item.archived` | Ein Item wurde archiviert |
| `work_item.restored` | Ein archiviertes Item wurde wiederhergestellt |
| `work_item.deleted` | Ein Item wurde gelöscht |
| `work_item.relation_added` | Eine Relation kam dazu; jedes Ende bekommt ein eigenes Ereignis |
| `work_item.relation_removed` | Eine Relation wurde entfernt; jedes Ende bekommt ein eigenes Ereignis |
| `comment.created` | Ein Kommentar wurde geschrieben |
| `comment.updated` | Ein Kommentar wurde bearbeitet |
| `comment.deleted` | Ein Kommentar wurde gelöscht |
| `page.created` | Eine Wiki-Seite wurde angelegt |
| `page.updated` | Eine Wiki-Seite wurde gespeichert oder eine Version wiederhergestellt |
| `page.moved` | Eine Wiki-Seite wurde verschoben oder umsortiert |
| `page.deleted` | Eine Wiki-Seite wurde mit ihren Unterseiten gelöscht |
| `bot.mentioned` | Ein Bot wurde in einer Beschreibung, einer Rich-Text-Property oder einem Kommentar erwähnt |
| `bot.assigned` | Jemand anderes hat einem Bot ein Item zugewiesen |
| `template.run_failed` | Ein Lauf einer Vorlage ist fehlgeschlagen |

<!-- events:end -->

Änderungen an Katalogen (Workflows, Typen, Properties, Labels), an Vorlagen und Automatisierungen, an Konten, Views, Tokens und an Webhooks selbst haben keinen Webhook. Die nächtlichen [Automatisierungen](/de/concepts/automations) gehen raus wie jede Änderung: storniert Auto-Close 30 Items, bekommt ein Webhook auf `work_item.state_changed` 30 Zustellungen (still sind sie nur für Benachrichtigungen).

## Payload

Jede Zustellung ist ein JSON-Objekt:

```json
{
  "id": "01m6b2q7h2m8d4f6g9k1p3s5tv",
  "event": "work_item.state_changed",
  "occurred_at": "2026-11-04T08:12:31.204517Z",
  "actor": { "id": "01m6akw3g1r5t8v2x4z7b9d3fh", "type": "person", "name": "Mara Lindqvist", "handle": "mara" },
  "project": { "id": "01m6akx0c4e7h2j5m8n1q3s6vw", "identifier": "WEB" },
  "data": {
    "id": "01m6akyecnp503vn6jmb8sp249",
    "key": "WEB-47",
    "title": "Kontaktformular sendet doppelt",
    "state_id": "01m6akv9p3r6t8w1y4b7d2f5hk",
    "assignee_id": "01m6akw3g1r5t8v2x4z7b9d3fh",
    "description": "Schritte zum Nachstellen: …"
  },
  "changes": {
    "state_id": { "old": "01m6akv9n8q2s5v7x9z3c6e1gj", "new": "01m6akv9p3r6t8w1y4b7d2f5hk" }
  }
}
```

- `id` ist die ID des Events (beim Ping die der Zustellung). `occurred_at` steht in UTC mit Mikrosekunden.
- `actor` ist, wer die Änderung gemacht hat: eine Person oder ein Bot (`type` `person` oder `bot`). Automatisierungen und Läufe von Vorlagen handeln als Standard-Bot.
- `project` ist das Projekt mit seiner aktuellen Kennung, `null` bei Ereignissen ohne Projekt.
- `data` ist das Subjekt, wie die REST-API es dem Leser zeigt (das Item oben ist gekürzt), siehe die Tabelle unten. Es ist `null`, wenn das Subjekt beim Versenden schon weg ist oder der Leser es nicht (mehr) sieht.
- `changes` sind die geänderten Felder als `{old, new}`, `null`, wenn es keine gibt. Eine Relation nennt das andere Ende als `{label, item_id, key}` oder als `{label, hidden: true}`, wenn der Leser es nicht sieht. Status stehen nur als ID: ein inzwischen umbenannter oder entfernter Status erscheint nur mit seiner ID; den Workflow liest du über REST.
- Interne Merkmale eines Events (der Browser-Tab, der es auslöste, in wessen Namen eine Automatisierung handelte, wer neu erwähnt wurde) verlassen den Server nie.

Der Body entsteht **einmal**, wenige Sekunden nach dem Ereignis, und geht bei jedem Versuch und bei **Erneut senden** unverändert raus. `data` ist also der Stand des Subjekts in diesem Moment, nicht genau zu `occurred_at`. Ein Body über 1 MiB (eine lange Beschreibung in Markdown und JSON, als alt und neu) geht ohne `changes` raus und, wenn er dann noch zu groß ist, ohne `data`; das kann ein Empfänger nicht von einem Subjekt unterscheiden, das es nicht mehr gibt. Ist `data` `null`, lies das Subjekt über REST.

### `data` je Ereignis

| Ereignis | `data` |
|---|---|
| `project.*` außer `deleted` | Das Projekt, wie `GET /api/v1/projects/{id}` es zeigt |
| `project.deleted` | `{id, identifier, name}` |
| `work_item.*` außer `deleted` | Das Item, wie `GET /api/v1/work-items/{id}` es zeigt: Rich Text als Markdown (`description`) und als JSON (`description_json`) |
| `work_item.deleted` | `{id, key, title}` |
| `comment.created`, `comment.updated` | Der Kommentar (`body` als Markdown und `body_json`) mit seinem Item in der kurzen Form der Listen als `work_item` |
| `comment.deleted` | `{id, work_item_id, author_id}`, kein Text |
| `page.created`, `page.updated`, `page.moved` | Die Seite mit ihrem Inhalt als Markdown und JSON |
| `page.deleted` | `{id, title, page_ids}`: die gelöschte Seite und jede Seite ihres Teilbaums |
| `bot.mentioned` | `{bot, item, source, comment}`: `source` ist `description`, `values` oder `comment`; `comment` nur, solange es ihn gibt |
| `bot.assigned` | `{bot, item}` |
| `template.run_failed` | Der Lauf (`error` sagt, warum) mit seiner Vorlage als `template` |

`comment.updated` eines inzwischen gelöschten Kommentars hat weder `data` noch den alten und neuen Text in `changes`. Seiten-Ereignisse tragen den Text nie in `changes`.

## Header

| Header | Wert |
|---|---|
| `X-Werkbuch-Event` | Das Ereignis, `ping` beim Test-Ping |
| `X-Werkbuch-Delivery` | Die ID der Zustellung: gleich bei jedem Versuch und bei **Erneut senden** |
| `X-Werkbuch-Timestamp` | Unix-Sekunden dieses Versuchs |
| `X-Werkbuch-Signature` | `sha256=` und das Hex von HMAC-SHA256 über `<timestamp>.<body>` mit dem Geheimnis |
| `Content-Type` | `application/json` |
| `User-Agent` | `werkbuch/<version>` |

## Signatur prüfen

Ein Empfänger prüft jede Anfrage, bevor er ihr traut:

1. Lies den Body **roh**, genau wie er ankam, bevor du ihn als JSON liest (die Signatur gilt für diese Bytes).
2. Rechne HMAC-SHA256 über `X-Werkbuch-Timestamp`, einen Punkt und den Body mit dem Geheimnis als Schlüssel und vergleiche `sha256=<hex>` in konstanter Zeit mit `X-Werkbuch-Signature`.
3. Nimm den Zeitstempel nur an, wenn er höchstens 300 Sekunden von deiner Uhr abweicht, damit sich eine mitgeschnittene Anfrage später nicht erneut abspielen lässt.

Ein fehlender oder kaputter Header ist keine gültige Signatur. Diese Funktionen machen alle drei Schritte und antworten `true` oder `false`; werkbuch testet sie gegen seinen eigenen Signaturcode:

::: code-group

<<< @/snippets/webhooks/verify.mjs{js} [Node]

<<< @/snippets/webhooks/verify.php [PHP]

<<< @/snippets/webhooks/verify.py [Python]

:::

In Node liest du den Body als Buffer (in Express `express.raw({ type: 'application/json' })`), in PHP `file_get_contents('php://input')` mit `$_SERVER['HTTP_X_WERKBUCH_SIGNATURE'] ?? null`, in Python `request.get_data()` (Flask) oder `await request.body()` (FastAPI). Auf eine falsche Signatur antwortest du mit `401`.

## Wiederholungen

Eine Zustellung ist mit jeder `2xx`-Antwort erledigt. Alles andere ist ein Fehlschlag: andere Codes, auch `3xx` (Weiterleitungen werden nicht verfolgt), keine Antwort binnen 10 Sekunden (davon 5 für den Verbindungsaufbau), eine gesperrte Adresse, eine Antwort über 64 KB. werkbuch versucht es dann erneut, insgesamt achtmal:

| Versuch | Nach dem ersten |
|---|---|
| 1 | sofort |
| 2 | 1 Minute |
| 3 | 6 Minuten |
| 4 | 36 Minuten |
| 5 | 2 Stunden 36 Minuten |
| 6 | 8 Stunden 36 Minuten |
| 7 | 20 Stunden 36 Minuten |
| 8 | 24 Stunden |

Die Pausen zählen ab jedem Fehlschlag, die echten Zeiten verschieben sich also um die Dauer der Versuche. Scheitern alle acht, ist die Zustellung `failed`. Vor jedem Versuch liest werkbuch den Webhook neu: es gelten die aktuelle URL und das aktuelle Geheimnis, und ein Webhook, der ausgeschaltet wurde oder dessen Bot das Projekt nicht mehr sieht, schickt nichts mehr (`cancelled`). Bekommt ein Webhook einen anderen Bot oder ein anderes Projekt, werden seine wartenden Zustellungen ebenso abgebrochen, denn ihre Bodies entstanden für den Bot und das Projekt davor.

Was ein Empfänger wissen sollte:

- **Entdopple über `X-Werkbuch-Delivery`.** Ein Absturz zwischen Senden und Protokoll kann einen Versuch doppelt schicken, immer mit derselben Zustellungs-ID und demselben Body.
- **Die Reihenfolge ist nicht garantiert, auch nicht für ein Item.** Jede Zustellung hat ihren eigenen Job und ihre eigenen Wiederholungen, ein späteres Ereignis desselben Items kann also zuerst ankommen; ordne die Ereignisse nach `occurred_at` und dann nach `id` (beide im Body) oder lies den aktuellen Stand über REST.
- **Antworte schnell** und arbeite danach. Zehn Sekunden sind die Grenze für die ganze Anfrage.

## Abgeschaltet und wieder an

Ist ein Webhook 24 Stunden lang gescheitert (ein geplanter Versuch scheitert, und der erste Fehlschlag seit dem letzten Erfolg ist 24 Stunden alt), schaltet werkbuch ihn ab: die Liste zeigt ihn als „Abgeschaltet“, wartende Zustellungen werden abgebrochen, und jede aktive Person mit Org-Rolle Admin bekommt die Benachrichtigung „Webhook abgeschaltet“ in die Inbox (per Mail nur, wenn sie das eingeschaltet hat, siehe [Benachrichtigungen](/de/concepts/notifications)). Ein gescheiterter Test-Ping oder ein gescheitertes **Erneut senden** zählt dafür nie; ein Erfolg von beiden setzt die Fehlschläge zurück.

**Wieder aktivieren** (in der Liste, im Protokoll oder mit `"active": true` in `PUT /api/v1/webhooks/{id}`) beginnt von vorn: was in der Zeit ohne ihn geschah, wird nicht nachgeschickt. Einzelne Zustellungen schickst du bei Bedarf aus dem Protokoll erneut.

## Zustellprotokoll

**Zustellungen** an einem Webhook zeigt jeden Versuch, neueste zuerst: Ereignis, Zeit, Nummer des Versuchs, den Status-Code oder „Keine Antwort“, Dauer und die ersten 2 KB der Antwort (an einem ganzen Zeichen gekürzt; eine gepackte Antwort steht als Verfahren und Größe, etwa `(gzip, 50914 bytes)`). Ohne Antwort steht stattdessen der Grund:

| Grund | Bedeutung |
|---|---|
| `scheme` | Die URL ist weder `http` noch `https` |
| `credentials` | Die URL enthält Benutzer oder Passwort |
| `unresolvable` | Der Name hat keine Adresse, oder die URL lässt sich nicht lesen |
| `private_address` | Eine der Adressen des Namens liegt in einem gesperrten Netz |
| `bot_access` | **Erneut senden** für einen Webhook, dessen Bot das Projekt nicht mehr sieht |
| `too_large` | Die Antwort war länger als 64 KB |
| `timeout` | Keine Antwort binnen 10 Sekunden |
| `connection` | Die Verbindung ist gescheitert |

Ein Fehlertext maskiert Benutzer, Passwort und Query jeder URL darin, aber nicht den Pfad: ein Empfänger, der sein Token im Pfad trägt wie Slack und Discord, zeigt es Org-Admins im Protokoll. Zustellungen und ihre Versuche werden 30 Tage nach ihrer letzten Änderung gelöscht. Eine Zustellung, die 36 Stunden nach ihrem letzten Versuch noch wartet (ihr Job ging verloren), wird `failed`, aber nie, solange die Queue `webhooks` noch fällige Jobs hält: nach einem Ausfall des Workers gehen ihre wartenden Versuche noch raus.

## Test-Ping und erneut senden

**Test-Ping** schickt das Ereignis `ping` sofort, auch an einen abgeschalteten Webhook, und sagt dir, was der Empfänger geantwortet hat. Sein Body ist `{id, event: "ping", occurred_at, actor, project, data: {webhook: {id, name}}, changes: null}`, signiert wie jede Zustellung. Ein gescheiterter Ping wird nicht wiederholt.

**Erneut senden** im Protokoll schickt denselben Body noch einmal, mit derselben `X-Werkbuch-Delivery`, neuem Zeitstempel und der nächsten Nummer, auch an einen abgeschalteten Webhook, aber nie an einem Bot vorbei, der das Projekt nicht mehr sieht. Ein Erfolg erledigt die Zustellung, und ein geplanter Versuch, der da schon lief und danach scheitert, macht das weder rückgängig noch zählt er fürs Abschalten; ein Fehlschlag lässt ihre restlichen geplanten Versuche stehen. Für einen Ping hat das Protokoll kein **Erneut senden**: schick einen neuen.

Beide warten in der Anfrage auf den Empfänger, bis etwa 10 Sekunden plus die Auflösung des Namens, und beide sind auf sechs je Minute und Konto begrenzt (darüber `429`).

## Private Netze

Vor **jedem** Versuch (auch beim Ping) löst werkbuch den Namen auf, prüft **jede** IPv4- und IPv6-Adresse und schickt nur an eine geprüfte Adresse: ein Name, der beim Speichern auf eine öffentliche Adresse zeigte und später auf `127.0.0.1`, wird nicht erreicht. Eine gesperrte Adresse unter mehreren genügt zur Ablehnung. Gesperrt sind private, Loopback-, Link-local-, Carrier-Grade-NAT-, Dokumentations-, Benchmark-, Multicast- und reservierte Netze, Metadaten-Adressen von Clouds (`169.254.169.254`, `fd00:ec2::254`, `100.100.100.200`), IPv6-Adressen aus Unique Local, Link-local und Loopback sowie IPv4-Adressen in IPv6 (`::ffff:127.0.0.1`, NAT64 `64:ff9b::`, 6to4 `2002::`). Beim Speichern lehnt werkbuch nur Adress-Literale und `localhost` in einem gesperrten Netz ab; einen Namen prüft es beim Versenden, denn DNS kann sich bis dahin ändern.

`WEBHOOKS_ALLOW_PRIVATE=true` erlaubt Ziele in privaten Netzen (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, IPv6 Unique Local `fc00::/7`), im Carrier-Grade-NAT (`100.64.0.0/10`) und auf dem Loopback (`127.0.0.0/8`, `::1`, `localhost`), für einen Empfänger im selben Netz, auch als IPv4-Adresse in IPv6 (`::ffff:10.0.0.1`). Die Auflösung erspart der Schalter nie, und alles andere bleibt gesperrt: Link-local (`169.254.0.0/16`, `fe80::/10`, darin die Metadaten-Adresse `169.254.169.254`), die Metadaten-Adressen `100.100.100.200` und `fd00:ec2::254`, `0.0.0.0/8` und `::`, Multicast, `240.0.0.0/4`, Dokumentations- und Benchmark-Netze.

Zwei Grenzen: ein NAT64-Präfix des eigenen Netzes (außer `64:ff9b::/96`) lässt sich nicht erkennen, und werkbuch schickt nie über einen Proxy (`HTTP_PROXY` und `HTTPS_PROXY` der Umgebung gelten nicht, denn ein Proxy löste den Namen selbst auf und umginge die Prüfung).

## Betrieb

Zustellungen laufen über die Queue `webhooks`. Ein Worker muss auf sie hören; er wartet bei einem langsamen Empfänger bis zu 10 Sekunden je Versuch, gib `webhooks` also einen eigenen Worker, wenn sich sonst mehrere Queues einen teilen, sonst hält ein hängender Empfänger Live-Updates und Benachrichtigungen auf. werkbuch begrenzt jede Namensauflösung des Prozesses auf 2 Sekunden und einen Versuch (`RES_OPTIONS=timeout:2 attempts:1`, wenn die Umgebung keins setzt), das gilt für alle Auflösungen von PHP, nicht nur für Webhooks. Das Protokoll räumt der Scheduler stündlich auf. Im Docker-Compose-Stack ist dieser Worker der Dienst `queue-webhooks`; welche Verbindungen den Stack verlassen und was `WEBHOOKS_ALLOW_PRIVATE` dort öffnet, steht unter [Betrieb](/de/operations#ausgehende-verbindungen).

## REST

Alle Endpunkte brauchen die Rechte eines Org-Admins. Lesen braucht die Fähigkeit `read`, alles andere `write`. Die Listen nehmen Filter und Sortierungen wie jede Liste der [REST-API](/de/api#listen): `filter[project_id]`, `filter[active]`, `filter[bot_id]` bei den Webhooks, `filter[event]`, `filter[kind]`, `filter[succeeded]` beim Protokoll.

Über [MCP](/de/mcp) tun die Tools `webhooks` und `manage-webhooks` dasselbe mit denselben Rechten; ein Test-Ping und `manage-webhooks:redeliver` zählen in denselben 6 je Minute. Das Geheimnis, das `manage-webhooks:create` und `manage-webhooks:rotate-secret` antworten, und die Adresse eines Webhooks samt Query landen im Verlauf des Agenten: Lege Webhooks über REST oder in der Oberfläche an, wenn das zählt.

| Endpunkt | Bedeutung |
|---|---|
| `GET /api/v1/webhooks` | Die Webhooks, nach Name, in Seiten (`cursor`, `per_page`) |
| `POST /api/v1/webhooks` | `{name, url, project_id, events, bot_id, active}`, alle Pflicht (`project_id` und `bot_id` dürfen `null` sein). Antwortet `201` mit `{data, secret}`: außer bei `rotate-secret` das einzige Mal, dass das Geheimnis zu sehen ist |
| `GET /api/v1/webhooks/{id}` | Ein Webhook |
| `PUT /api/v1/webhooks/{id}` | Ersetzt den Webhook ganz, dieselben Felder wie beim Anlegen |
| `DELETE /api/v1/webhooks/{id}` | Löscht ihn samt Protokoll; `204` |
| `POST /api/v1/webhooks/{id}/rotate-secret` | Ein neues Geheimnis: `{data, secret}` |
| `POST /api/v1/webhooks/{id}/ping` | Ein Test-Ping; antwortet mit dem Versuch |
| `GET /api/v1/webhooks/{id}/deliveries` | Das Protokoll: Versuche, neueste zuerst, in Seiten |
| `POST /api/v1/webhooks/{id}/deliveries/{delivery}/redeliver` | Schickt eine Zustellung erneut; antwortet mit dem Versuch |

```bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name": "Deploy", "url": "https://deploy.example.com/hook", "project_id": null,
       "events": ["work_item.state_changed"], "bot_id": null, "active": true}' \
  https://werkbuch.example.com/api/v1/webhooks
```

```json
{
  "data": {
    "id": "01m6c1d4f7h0k3m6p9r2t5w8yb",
    "name": "Deploy",
    "url": "https://deploy.example.com/hook",
    "project_id": null,
    "events": ["work_item.state_changed"],
    "bot_id": null,
    "active": true,
    "disabled_at": null,
    "failing_since": null,
    "last_success_at": null,
    "created_by": "01m6akw3g1r5t8v2x4z7b9d3fh",
    "created_at": "2026-11-06T09:00:00.000000Z",
    "updated_at": "2026-11-06T09:00:00.000000Z"
  },
  "secret": "whsec_…"
}
```

`disabled_at` ist gesetzt, wenn das System den Webhook abgeschaltet hat, `failing_since` ist der erste Fehlschlag seit dem letzten Erfolg. Ein Versuch im Protokoll (und die Antwort von `ping` und `redeliver`) ist `{id, delivery_id, webhook_id, event, attempt, kind, status_code, duration_ms, response_excerpt, error, created_at}`; `kind` ist `scheduled`, `manual` (erneut senden) oder `ping`, `status_code` ist ohne Antwort `null`, und `error` ist der Grund aus der Tabelle oben mit dem ersten Satz des Fehlers.

Feldfehler kommen als `422`: `url` mit unbekanntem Schema, mit Benutzer oder Passwort, einem Host in einer Form, die sich nicht lesen lässt, oder einem privaten Literal; `events` leer, keine Liste von Namen oder mit einem unbekannten Ereignis; `bot_id`, die keinen aktiven Bot nennt (ein Bot, den der Webhook schon hat, darf inzwischen deaktiviert sein: die übrigen Felder bleiben änderbar, und der Webhook stellt nichts zu, solange der Bot inaktiv ist).

## Agenten

Ein Webhook mit Bot ist der Weg, einen KI-Agenten zu wecken. Er bekommt:

- `bot.assigned` und `bot.mentioned` **seines** Bots,
- `work_item.*` und `comment.*` von Items, denen der Bot beim Versenden zugewiesen ist (auch die Änderung, die ihm das Item wegnahm, und das Löschen eines Items, das er hatte),
- und das alles nur, solange der Bot aktiv ist und das Projekt sieht: geprüft beim Versenden und noch einmal vor jedem Versuch. Ein Agent, der aus einem privaten Projekt entfernt wurde, hört nichts mehr davon.

Projekt-, Seiten- und Vorlagen-Ereignisse gehen nie an einen Webhook mit Bot. `bot.assigned` kommt, wenn jemand anderes dem Bot ein Item zuweist (beim Anlegen, Ändern, in der Mehrfachbearbeitung oder aus einer Vorlage); ein Bot, der sich ein Item selbst nimmt, bekommt keins. Das Szenario: weise dem Bot ein Item zu, der Webhook `bot.assigned` erreicht den Agenten mit `data.item`, und der Agent arbeitet es mit einem Token seines Bots über [MCP](/de/mcp#agent-szenario) ab: `whoami`, `work-items:get`, dann `manage-comments:add` und `manage-work-items:transition`. Über die [REST-API](/de/api) gehen dieselben Schritte für ein Skript ohne MCP-Client. Gib dem Agenten ein [Token seines Bots](/de/bots#tokens) und eine Mitgliedschaft im Projekt, nie ein Token des Standard-Bots.
