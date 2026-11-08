# REST-API

Alles, was die Oberfläche kann, kann die REST-API: Die Oberfläche selbst spricht nur über sie mit dem Server. Die API liegt unter `/api/v1` deiner Instanz, spricht JSON mit Schlüsseln in `snake_case` und nennt alles per ULID (Items auch per Key, `WEB-47`).

Jede Instanz beschreibt ihre API selbst:

- `/api/docs` zeigt die Referenz im Browser, mit jedem Endpunkt, Parameter, Body und jeder Antwort, und lässt dich Anfragen ausprobieren.
- `/api/openapi.json` ist dasselbe als OpenAPI-3.1-Dokument, für Code-Generatoren und Clients.

Beide sind öffentlich: Sie enthalten keine Daten der Instanz, nur die Form der API, damit eine Integration schon vor dem ersten Token entstehen kann. Das Dokument zu erzeugen ist aufwendig, darum erlauben beide 30 Anfragen je Minute und Adresse. Die Referenz lädt ihre Skripte von der Instanz selbst, nicht von einem CDN. Diese Seite erklärt, was die Referenz nicht sagt: Anmeldung, Fehler, Listen, Grenzen und wie sich die API ändert. KI-Agenten erreichen dieselben Operationen über den [MCP-Server](/de/mcp).

## Anmeldung

### Tokens

Skripte und Agenten nutzen ein Token: `Authorization: Bearer <token>`. Ein Token hat die Form `<id>|wb_<geheimnis>`. Du legst es in der Oberfläche an, unter **Persönliche Einstellungen → API & MCP → Neues Token**; werkbuch zeigt es nur einmal, direkt nach dem Anlegen. Ein Token eines [Bots](/de/bots) legt ein Org-Admin in den Einstellungen des Bots an. Ein Token handelt mit den Rechten seines Kontos, nie mit mehr, und endet mit seinem Ablaufdatum, wenn es widerrufen wird oder wenn sein Konto deaktiviert wird.

Eine Anfrage ohne gültiges Token und ohne Sitzung ist ein `401`. Wer ein Konto deaktiviert, löscht seine Tokens.

### Fähigkeiten

Ein Token trägt dazu Fähigkeiten, die es weiter einschränken ([Rollen und Rechte](/de/concepts/permissions#tokens)):

| Fähigkeit | Erlaubt |
|---|---|
| `read` | `GET` und `HEAD` und die vier Lesezugriffe, die ihre Frage im Body stellen: `POST /work-items/query`, `/work-items/groups`, `/work-items/counts` und `/templates/preview` |
| `write` | Jede andere Anfrage |
| `mcp` | Den [MCP-Server](/de/mcp) unter `/mcp`; seine Tools brauchen dazu `read` zum Lesen und `write` zum Ändern |

Ein Token ohne die Fähigkeit, die eine Anfrage braucht, bekommt `403`. Die Referenz nennt die Fähigkeit jeder Operation (`x-werkbuch-ability`).

### Nur mit der Sitzung

Die Oberfläche meldet sich mit ihrer Sitzung an: ein Cookie und bei jeder Anfrage außer `GET` und `HEAD` der Header `X-XSRF-TOKEN` (aus dem Cookie `XSRF-TOKEN`); fehlt er oder ist er veraltet, ist das ein `419`. Manches geht nur mit dieser Sitzung, nie mit einem Token, egal mit welchen Fähigkeiten:

- Tokens anlegen (`POST /tokens`),
- das eigene Passwort und der zweite Faktor (`/me/password`, `/me/two-factor…`),
- die E-Mail-Adresse einer Person ändern (`PATCH /users/{user}` mit `email`).

Ein Token bekommt `403` mit dem Grund `session_required`. So kann ein gestohlenes Token weder sein Konto übernehmen noch sich einen Nachfolger anlegen. Tokens auflisten und widerrufen geht mit einem Token.

## Fehler

Jeder Fehler ist ein Problem-Details-Dokument (RFC 9457) mit dem Medientyp `application/problem+json`:

```json
{
  "type": "urn:werkbuch:problem:validation_failed",
  "title": "Validierung fehlgeschlagen",
  "status": 422,
  "detail": "Die Eingabe ist nicht gültig.",
  "reason": "validation_failed",
  "errors": {
    "title": ["Der Titel darf nicht leer sein."],
    "values.customer": ["„Kunde“ ist ein Pflichtfeld."]
  }
}
```

- `reason` ist der Code, nach dem du unterscheidest (`transition_not_allowed`, `description_conflict`, `project_archived`, `session_required` …). Die Referenz nennt jeden Grund, den der Server heute antwortet.
- `errors` nennt die Felder eines `422`: einen Pfad in den Body oder die Query (`values.customer`, `filter.conditions.0.op`), je mit seinen Sätzen. Alle Probleme einer Anfrage kommen auf einmal.
- `detail` ist ein Satz für Menschen. Ein `404` hat keinen: Was du nicht sehen darfst, antwortet genau wie etwas, das es nicht gibt, nie mit `403`.
- Manche Probleme tragen weitere Schlüssel: `current` (der gespeicherte Stand bei einem Konflikt, siehe unten), `states` (die Status, die beim Wechsel eines Workflows ein Ziel brauchen), `projects` (wer einen Katalogeintrag noch benutzt).

Die Sätze kommen in der Sprache des Kontos (aus seinem Profil, sonst die Standardsprache der Organisation); ein `401` kommt in der Sprache der Organisation. `Accept-Language` wird nicht gelesen.

| Status | Bedeutet |
|---|---|
| `401` | Kein gültiges Token, keine Sitzung |
| `403` | Gesehen, aber nicht erlaubt (Rolle, Fähigkeit, `session_required`) |
| `404` | Unbekannt oder für dich verborgen |
| `409` | Eine Regel des Zustands: ein Übergang, ein Konflikt, archiviert, in Benutzung |
| `413` | Body zu groß |
| `419` | Sitzung ohne gültiges `X-XSRF-TOKEN` |
| `422` | Eingabe ungültig, mit `errors` |
| `429` | Zu viele Anfragen, siehe [Grenzen](#grenzen) |
| `503` | Ein Dienst ist nicht erreichbar (`search_unavailable`, `mail_failed`) |

## Listen

### Seiten

Listen kommen in Seiten über einen Cursor:

```json
{
  "data": [ … ],
  "links": { "first": null, "last": null, "prev": null, "next": "https://werkbuch.example.com/api/v1/projects?sort=-name&per_page=1&cursor=eyJwcm…" },
  "meta": { "path": "https://werkbuch.example.com/api/v1/projects", "per_page": 1, "next_cursor": "eyJwcm…", "prev_cursor": null, "total": 3 }
}
```

- `per_page` nimmt 1 bis 100, Standard 100; `meta.total` zählt alle Treffer.
- Folge `links.next`: Der Link behält die Query (Filter, Sortierung, `per_page`). Auf der letzten Seite ist er `null`.
- Ein Cursor gehört zu seiner Liste und Sortierung: einer aus einer anderen Sortierung (`sort=name`, weiter mit `sort=-name`) oder einer, der sich nicht lesen lässt, ist ein `422` an `cursor`. Ein anderes `per_page` geht.
- Listen, die per `POST` gelesen werden (`/work-items/query`), haben keine Adresse zum Folgen: Dort ist `links.next` `null`, und dieselbe Anfrage mit `cursor` = `meta.next_cursor` führt weiter.

### Filter, Sortierung und Includes

Normale Listen nehmen drei Parameter:

- `filter[<name>]=<wert>` grenzt die Liste ein. Mehrere Werte durch Komma treffen jeden davon (`filter[type]=person,bot`); ein Filter auf Text trifft, was ihn enthält (`filter[name]=web`); ein Ja-Nein-Filter nimmt `1` oder `0`; ein ID-Filter nimmt eine ULID in jeder Schreibweise. Mehrere Filter gelten alle.
- `sort=<name>` ordnet sie, mit `-` davor absteigend, mehrere durch Komma (`sort=-type,name`). Jede Ordnung endet auf der ULID, so behalten gleiche Werte eine feste Reihenfolge.
- `include=<name>` bettet Zugehöriges ein.

Ein unbekannter Name ist ein `422` an `filter`, `sort` oder `include`, der die Namen nennt, die die Liste kennt; ein Wert, den ein Filter nicht nimmt, ist ein `422` an `filter.<name>`. Ein Filter grenzt nur ein, was du ohnehin siehst: Eine ID, die du nicht sehen darfst, trifft nichts und antwortet wie eine unbekannte, nie mit `404`. Schalter für die ganze Liste behalten ihren eigenen Parameter: `include_archived=1` bei den Projekten, `lean=1` bei den Vorlagen.

Ohne `sort` behält jede Liste ihre eigene Ordnung (der Standard in der Tabelle). Feste Listen nehmen keinen Filter und keine Sortierung; die Inbox und das Protokoll der Webhooks nehmen Filter, kommen aber immer neueste zuerst.

<!-- lists:start -->
| Liste | Filter | Sortierung | Standard | Include |
|---|---|---|---|---|
| `GET /users` | `type` (`person`, `bot`), `disabled` | `type`, `name`, `handle`, `created_at` | `-type` (Personen zuerst) | – |
| `GET /bots` | `disabled`, `owner_id` | `name`, `created_at` | Anlegen | – |
| `GET /invitations` | `org_role` (`admin`, `member`) | `expires_at`, `created_at` | Anlegen | – |
| `GET /tokens` | `user_id` (der Besitzer, eine ULID; ohne die eigenen Tokens) | `name`, `created_at` | Anlegen | – |
| `GET /projects` | `visibility` (`public`, `private`), `lead_id`, `workflow_id`, `member` (ob du Mitglied bist) | `name`, `identifier`, `created_at` | `name` | `members` |
| `GET /projects/{project}/members` | `type` (`person`, `bot`) | `name` | Beitritt | – |
| `GET /workflows` | `name` | `name`, `created_at` | Katalog-Reihenfolge | – |
| `GET /work-item-types` | `name`, `is_epic`, `archived` | `name`, `created_at` | Katalog-Reihenfolge | – |
| `GET /properties` | `label`, `field_type` (`text`, `number`, `dropdown`, `boolean`, `date`, `member`, `rich_text`, `url`) | `label`, `key`, `created_at` | Katalog-Reihenfolge | – |
| `GET /labels` | `name` | `name`, `created_at` | Katalog-Reihenfolge | – |
| `GET /relation-types` | `name`, `built_in` | `name`, `created_at` | Katalog-Reihenfolge | – |
| `GET /resolutions` | `default_for` (`completed`, `canceled`), `archived` | `position`, `label` | `position` | – |
| `GET /views` | `created_by`, `name` | `name`, `created_at` | `name` | – |
| `GET /templates` | `project_id`, `scheduled` | `name`, `created_at` | `name` | – |
| `GET /projects/{project}/templates` | `scheduled` | `name`, `created_at` | `name` | – |
| `GET /webhooks` | `project_id`, `active`, `bot_id` | `name`, `created_at` | `name` | – |
| `GET /webhooks/{webhook}/deliveries` | `event`, `kind` (`scheduled`, `manual`, `ping`), `succeeded` | – | `-attempted_at` (neueste zuerst) | – |
| `GET /notifications` | `unread`, `event` (die Arten; `filter[event]=mentioned` für Erwähnungen) | – | `-created_at` (neueste zuerst) | – |
| `GET /favorites` | – | – | deine Reihenfolge | – |
| `GET /work-items/{item}/comments` | – | – | älteste zuerst | – |
| `GET /work-items/{item}/history` | – | – | älteste zuerst | – |
| `GET /work-items/{item}/pages` | – | – | Titel (nur Seiten von Projekten, die du siehst) | – |
| `GET /pages/{page}/versions` | – | – | neueste zuerst | – |
| `GET /templates/{template}/runs` | – | – | neueste zuerst | – |
<!-- lists:end -->

`created_at` sortiert nach der ULID, die mit dem Anlegen wächst; „Katalog-Reihenfolge“ ist die Reihenfolge, in der die Einträge angelegt wurden, wie die Oberfläche sie zeigt. `include=members` hängt an jedes Projekt der Seite `members`. Die Referenz nennt die Werte jedes Filters.

## Work Items

### Keys

`/work-items/{item}` nimmt die ULID oder den Key in jeder Schreibweise (`WEB-47`, `web-47`). Hat ein Projekt seine Kennung gewechselt, gelten seine früheren Keys weiter: Ein `GET` mit einem früheren Key antwortet `301` mit der aktuellen Adresse in `Location` (und `Cache-Control: no-store`), jede andere Anfrage wirkt ohne Umleitung auf das Item. Umgeleitet werden nur Items, die du siehst; für alle anderen ist der frühere Key ein `404` wie ein unbekannter.

### Listen von Items

Items haben ihre eigene Filter-Engine, die der Views. Die vollständige Referenz der Felder und Operatoren steht auf der Seite [Views](/de/concepts/views#rest).

- `GET /work-items?view=<id>` liefert die Items einer gespeicherten View; `filter[…]` grenzt sie in einer Kurzform weiter ein (`filter[project]=WEB&filter[assignee]=me&filter[state_category]=unstarted,started`), `sort=-due_date` ändert die Ordnung.
- `POST /work-items/query` nimmt einen vollen Filter, eine Sortierung und den Cursor im Body, ein Lesezugriff wie `GET`.
- `POST /work-items/groups` und `/work-items/counts` liefern die Zahlen einer Gruppierung oder benannter Filter.
- `lean=1` (`"lean": true`) lässt `description`, `description_json` und `values_markdown` weg.
- `POST /projects/{project}/redistribute-ranks` gibt den Items eines Projekts neue kurze Ränge in ihrer Ordnung, wenn zwischen zwei Nachbarn kein Rang mehr passt; es antwortet `{"redistributed": n}` ([Work Items](/de/concepts/work-items#items-von-hand-ordnen)).

`GET /work-items/{item}?include=children,relations,type,workflow,attachments` bettet in einer Anfrage ein, was die Item-Seite braucht. `children` enthält die ersten 100 Kinder in manueller Ordnung, archivierte eingeschlossen; wie viele es gibt, sagt `children_progress.total`, und `GET /work-items?filter[parent]=<key>&include_archived=1` blättert in derselben Ordnung durch alle.

## Rich Text

Beschreibungen, Rich-Text-Werte, Kommentare, Wiki-Seiten und Vorlagen kommen in zwei Formen: `description` in Markdown und `description_json` als Tiptap-Dokument (`body`/`body_json` bei Kommentaren, `content`/`content_json` bei Seiten). Schreib in einer davon; beide zugleich sind ein `422`. Markdown ist für den Leser geschrieben: Erwähnungen zeigen den aktuellen Handle, Verweise den aktuellen Key bzw. Titel, und Verweise auf etwas, das du nicht sehen darfst, bleiben `[hidden](item:<ulid>)`. Was ein Text enthalten darf und wie Erwähnungen, Verweise, Bilder und Dateien geschrieben werden, steht auf der Seite [Rich Text](/de/concepts/rich-text#schreiben-uber-rest).

## Konflikte

Zwei Änderungen desselben Texts überschreiben sich nicht still, wenn du sagst, welche Fassung du bearbeitet hast:

- Items: Schick mit einer neuen Beschreibung `base_description_version` (die `description_version`, die du gelesen hast). Hat sie inzwischen jemand geändert, antwortet der Server `409` mit dem Grund `description_conflict` und dem gespeicherten Item in `current`; gespeichert wird nichts. Willst du deinen Text trotzdem, schick ihn noch einmal mit der `description_version` aus `current`. Ohne `base_description_version` gewinnt der Letzte.
- Wiki-Seiten: Schick `base_version` (die `version`, die du gelesen hast). Eine neuere Seite ist ein `409` mit dem Grund `page_conflict` und der Seite in `current`. Schick deine Fassung noch einmal mit der `version` aus `current`; mit `"keep_current": true` behält werkbuch den anderen Text als Version der Seite. Ohne `base_version` gewinnt der Letzte; der Text davor bleibt als Version, wenn jemand anderes ihn schrieb oder er älter als zehn Minuten ist.

Jede andere Änderung wirkt auf den Stand, den sie vorfindet, nach dessen Regeln: Ein Übergang, der nicht mehr erlaubt ist, ist ein `409` mit `transition_not_allowed`. ETags und `If-Match` gibt es nicht.

## Grenzen

- **Anfragen:** 600 je Minute und gültigem Token (`API_RATE_LIMIT`); ohne Token hat die Sitzung der Oberfläche 3000 je Minute und Konto (`API_SESSION_RATE_LIMIT`), alles andere 600 je Adresse. Gezählt wird vor der Anmeldung, darum verbraucht eine Flut von `401` nie das Kontingent eines gültigen Tokens, und zwei Tokens eines Kontos zählen getrennt. Hinter einem Reverse Proxy braucht die Zählung je Adresse den Proxy in `TRUSTED_PROXIES` ([Betrieb](/de/operations#drosseln-und-proxys)).
- Jede Antwort trägt `X-RateLimit-Limit` und `X-RateLimit-Remaining`, außer einem `413` für einen zu großen Body (JSON über 8 MiB oder ein Body über `post_max_size` von PHP): er wird abgelehnt, bevor die Anfrage zählt. Über der Grenze ist die Antwort `429` mit dem Grund `too_many_requests` und `Retry-After` in Sekunden.
- Manche Anfragen haben eine kleinere eigene Grenze, je Konto: Uploads 60 je Minute, Test-Ping und **Erneut senden** eines Webhooks zusammen 6, die Testmail 6, das eigene Passwort ändern 6. Ihr `429` sieht gleich aus; `X-RateLimit-*` nennen immer die Grenze der API, nur `Retry-After` sagt, wie lange du warten musst.
- **JSON-Bodies** dürfen höchstens 8 MiB (8 388 608 Bytes) groß sein, sonst `413` mit dem Grund `payload_too_large` (ein `Content-Length` darüber wird sofort abgelehnt). Das lässt Platz für ein Bild als Data-URL und für ein Item mit mehreren Rich-Text-Werten an ihrer Größengrenze.
- **Uploads** (`POST /attachments`, Multipart) haben ihre eigene Grenze, `ATTACHMENTS_MAX_MB` (Standard 25 MB), ebenfalls ein `413`. Wie man sie im Docker-Image anhebt: [Betrieb](/de/operations#uploads).

## Stabilität

`/api/v1` ändert sich nur durch Hinzufügen: neue Felder, Endpunkte, Filter, Sortierungen und `reason`-Codes. Ein Client übergeht Felder, die er nicht kennt, und behandelt einen `reason`, den er nicht kennt, nach seinem Status (ein `409`, den er nicht einordnen kann, ist trotzdem ein Konflikt). `reason` ist im Dokument eine Liste der bekannten Codes und jeder andere Text, so bricht ein Client, der aus dem heutigen Dokument erzeugt wurde, an einem neuen nicht. Eine Änderung, die einen Client bräche, wird `/api/v2`. Idempotenz-Schlüssel gibt es nicht: Eine Mehrfachbearbeitung (`POST /work-items/bulk`) meldet je Item, was geschah, so lässt sie sich für die gescheiterten Items wiederholen.

## Beispiele

Die Beispiele nutzen `https://werkbuch.example.com` und ein Token in `$TOKEN`. `-g` hält `curl` davon ab, `[` und `]` in `filter[…]` zu deuten.

### Wer bin ich

`GET /me` antwortet mit dem Konto des Tokens und den Rechten seiner Rolle in der Organisation, auch mit einem Lese-Token und für einen Bot:

```bash
curl -H "Authorization: Bearer $TOKEN" https://werkbuch.example.com/api/v1/me
```

```json
{
  "data": {
    "id": "01m6akx65qgwfz2m2tz3bpt7st",
    "type": "person",
    "name": "Mara Lindqvist",
    "handle": "mara",
    "email": "mara@feldwerk.example.com",
    "org_role": "admin",
    "locale": "de",
    "timezone": "Europe/Berlin",
    "permissions": ["org.manage", "org.manage_catalog", "project.see_all", "project.join", "project.create", "view.create", "view.manage_any", "token.own"]
  }
}
```

(Gekürzt.) `locale` und `timezone` sind die geltenden, die der Organisation, wenn das Konto keine eigenen hat.

### Deine offenen Items

```bash
curl -g -H "Authorization: Bearer $TOKEN" \
  "https://werkbuch.example.com/api/v1/work-items?filter[assignee]=me&filter[state_category]=unstarted,started&sort=due_date&lean=1"
```

### Ein Item anlegen

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "WEB", "title": "Kontaktformular sendet doppelt", "priority": "high",
       "description": "Auf Staging gesehen, siehe WEB-42.\n\n- Formular absenden\n- zwei Mails kommen an"}'
```

Die Antwort ist `201` mit dem Item in `data`, sein Key in `data.key`. `project_id` nimmt die ULID oder die Kennung; ohne `type_id` bekommt das Item den Standardtyp des Projekts, ohne `state_id` den Startstatus seines Workflows.

### Eine Liste blättern

```bash
curl -H "Authorization: Bearer $TOKEN" "https://werkbuch.example.com/api/v1/projects?sort=-name&per_page=1"
```

Ruf danach `links.next` der Antwort auf, bis er `null` ist.

### Kommentieren

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/WEB-47/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Auf Staging behoben, @mara kannst du prüfen?"}'
```

### Eine Datei hochladen

```bash
curl -X POST https://werkbuch.example.com/api/v1/attachments \
  -H "Authorization: Bearer $TOKEN" \
  -F project_id=WEB -F kind=file -F work_item_id=WEB-47 \
  -F file=@angebot.pdf
```

`kind=file` legt die Datei in die Dateiliste des Items. Für ein Bild im Text lädst du mit `kind=inline` hoch und nennst es im Text als `![alt](attachment:<ulid>)` ([Rich Text](/de/concepts/rich-text#eine-datei-hochladen)).

### Eine Grenze prüfen

```bash
curl -i -H "Authorization: Bearer $TOKEN" https://werkbuch.example.com/api/v1/organization
```

```text
HTTP/2 200
x-ratelimit-limit: 600
x-ratelimit-remaining: 599
```
