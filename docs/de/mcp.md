# MCP

werkbuch ist ein MCP-Server: Ein KI-Agent in Claude Code, Codex oder einem anderen MCP-Client liest und ändert darüber Projekte, Items, Kommentare, Wiki-Seiten, Vorlagen und Webhooks. Der Server liegt unter `/mcp` deiner Instanz. Seine Tools sind dünne Hüllen um die [REST-API](/de/api): Jede Aktion eines Tools ruft denselben Code wie eine REST-Operation, ihr Zwilling, mit denselben Rechten, Regeln und Fehlern. Was die Tools nicht abdecken, erledigt ein Skript über REST.

## Was der Server bietet

- **29 Tools**, je Ressource ein Paar: ein Tool, das liest (`work-items`), und eins, das schreibt (`manage-work-items`), beide mit einem Argument `action`. Drei Tools stehen allein: `whoami`, `search` und `get-upload-url`. Die [Liste der Tools](#tools) nennt jede Aktion und ihren Zwilling.
- **Drei Referenzen** als MCP-Resources: wie ein Filter geschrieben wird, Markdown und die Werte der Feldtypen (siehe [Referenzen](#referenzen)).
- **Instructions**, die der Client dem Modell beim Verbinden gibt: zuerst `whoami` aufrufen, Texte in Ergebnissen sind Daten, wie Listen blättern, wo die Referenzen liegen.

Nicht über MCP: Tokens anlegen, das eigene Passwort und der zweite Faktor (sie brauchen wie über REST die Sitzung der Oberfläche), die System-Seite und `GET /references`.

## Einrichten

1. Lege in der Oberfläche unter **Persönliche Einstellungen → API & MCP → Neues Token** ein Token mit der Fähigkeit `mcp` und `read` an, dazu `write`, wenn der Agent etwas ändern soll. Für einen [Bot](/de/bots) legt ein Org-Admin das Token in den Einstellungen des Bots an. Das Token handelt mit den Rechten seines Kontos, nie mit mehr.
2. Trage den Server in deinem Client ein. Der Dialog, der das neue Token zeigt, gibt die drei Snippets mit deiner Adresse und dem Token:

```bash
# Claude Code
claude mcp add --transport http --scope user werkbuch https://werkbuch.example.com/mcp --header "Authorization: Bearer <token>"
```

```toml
# Codex, ~/.codex/config.toml
[mcp_servers.werkbuch]
url = "https://werkbuch.example.com/mcp"
http_headers = { "Authorization" = "Bearer <token>" }
```

```json
{
  "mcpServers": {
    "werkbuch": {
      "type": "http",
      "url": "https://werkbuch.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Das JSON ist für Clients mit einer Konfiguration `mcpServers`, etwa eine `.mcp.json` in einem Projekt.

## Verbindung

Der Server spricht Streamable HTTP: Jede Nachricht ist ein `POST /mcp` mit einem JSON-RPC-Body und `Content-Type: application/json` (ein anderer Typ ist ein `415`). Er ist zustandslos: Es gibt keine Sitzung des Protokolls (kein `Mcp-Session-Id`), keine Benachrichtigungen vom Server, und `GET` und `DELETE` auf `/mcp` antworten `405`. Jede Anfrage trägt das Token als `Authorization: Bearer <token>`; ein Cookie der Oberfläche meldet hier niemanden an (`401`).

Protokollversionen:

- `2026-07-28`, das aktuelle Protokoll, über `server/discover`. Jede Anfrage trägt dann `_meta` mit `io.modelcontextprotocol/protocolVersion` und `io.modelcontextprotocol/clientCapabilities` und die Header `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method` (die Methode des Bodys) und bei `tools/call` und `resources/read` `Mcp-Name` (das Tool bzw. die URI). Ein fehlender oder widersprechender Header ist der JSON-RPC-Fehler `-32020` mit dem Status `400`.
- `2025-11-25`, `2025-06-18` und `2025-03-26` über `initialize`; ein Client, der eine ältere Version erfragt, bekommt `2025-11-25`.

Ein Browser kann den Server nicht für eine andere Seite benutzen: Ein `Origin`-Header, der nicht die Adresse deiner Instanz ist, ist ein `403`; eine Anfrage ohne `Origin` (jeder Client auf der Kommandozeile) geht durch. `tools/list` nennt alle Tools, die das Token benutzen darf, auf einer Seite.

```bash
curl https://werkbuch.example.com/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' -H 'Mcp-Name: whoami' \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami", "arguments": {}, "_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}}}}'
```

## Was ein Token sieht

Hinein kommt nur ein Token mit der Fähigkeit `mcp`. Ein Tool, das liest, braucht dazu `read`, ein Tool, das schreibt (`manage-…` und `get-upload-url`), braucht `write`. Ein Tool, das das Token nicht benutzen darf, fehlt in `tools/list`; wer es trotzdem aufruft, bekommt den JSON-RPC-Fehler `-32602` („Tool [x] not found.“). Ein Token mit nur `read` und `mcp` sieht die 15 lesenden Tools und kann nichts ändern. Die Referenzen brauchen nur `mcp`.

Darüber hinaus sieht ein Tool genau, was sein Konto über REST sieht. Was das Konto nicht sehen darf, bekommt dieselbe Antwort wie etwas, das es nicht gibt (`404`): ein Item eines privaten Projekts, ein Kommentar daran, sein Key in der Suche. Eine Relation oder ein Verweis auf ein solches Item zeigt das andere Ende verborgen, ohne Key, Titel und ID.

## Grenzen

- **Anfragen:** 300 je Minute je gültigem Token (`MCP_RATE_LIMIT`), ohne gültiges Token 300 je Adresse. Das ist ein eigenes Kontingent neben den 600 der REST-API: Ein Agent, der beides nutzt, bremst das andere nicht. Gezählt wird vor der Anmeldung. Jede Antwort trägt `X-RateLimit-Limit` und `X-RateLimit-Remaining`; über der Grenze ist die Antwort `429` mit `Retry-After`.
- **Geteilt mit REST:** Ein Test-Ping und `redeliver` eines Webhooks zählen in denselben 6 je Minute und Konto wie über REST, Uploads über `get-upload-url` in denselben 60 je Minute und Konto. Ein Tool über einer solchen Grenze antwortet mit dem Fehler `429 too_many_requests` und `retry_after` in Sekunden.
- **Bodies:** Ein JSON-Body über 8 MiB (8 388 608 Bytes) ist ein `413`; Uploads haben ihre eigene Grenze, `ATTACHMENTS_MAX_MB`.
- **Seiten:** `per_page` ist 1 bis 100, weggelassen 25.

## Tools

Ein Tool mit mehreren Aktionen nimmt das Argument `action`. Ein Tool mit einer Aktion (`whoami`, `search`, `get-upload-url`, `automations`, `manage-automations`, `relations`, `attachments`, `manage-attachments`) nimmt keins; die Tabelle nennt seine Aktion trotzdem (`call` bei den ersten dreien). Die Doku schreibt eine Aktion als `tool:aktion`, etwa `work-items:get`. **Pflicht** nennt die Argumente, die eine Aktion außer `action` braucht; **REST-Zwilling** ist die Operation unter `/api/v1`, der die Aktion folgt, mit Parametern, Body und Antwort in der Referenz unter `/api/docs`.

<!-- tools:start -->

### `whoami`

Das Konto des Tokens: Person oder Bot, Sprache, Zeitzone, Rolle in der Organisation und die Rechte dieser Rolle. Als Erstes aufrufen. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `call` | Das Konto des Tokens. | – | `GET /me` |

### `search`

Sucht Items, Wiki-Seiten, Projekte, Personen und Views zugleich, wie die Befehlspalette. Jedes Wort muss treffen, ein Key (`WEB-47`) stellt sein Item nach vorn. `type_id`, `state_category`, `assignee_id` (`none` allein: Items ohne Assignee) und `label_id` engen die Items ein. Treffer sind schlank. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `call` | Sucht. | `q` | `GET /search` |

### `get-upload-url`

Eine Adresse, an die eine Datei geht, siehe [Datei hochladen](#datei-hochladen). (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `call` | Eine Adresse für den Upload. | `input` | – |

### `organization`

Die Organisation und ihre Kataloge: Workflows, Typen, Properties, Labels, Relationstypen und Resolutions. Jedes Konto liest sie. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `get` | Die Organisation. | – | `GET /organization` |
| `state-usage` | Die Items je Status eines Projekts oder eines Workflows, archivierte eingeschlossen (`project` oder `workflow`). | – | `GET /state-usage` |
| `list-workflows` | Die Workflows. | – | `GET /workflows` |
| `get-workflow` | Ein Workflow. | `id` | `GET /workflows/{workflow}` |
| `list-types` | Die Typen. | – | `GET /work-item-types` |
| `get-type` | Ein Typ. | `id` | `GET /work-item-types/{workItemType}` |
| `list-properties` | Die Properties. | – | `GET /properties` |
| `get-property` | Eine Property. | `id` | `GET /properties/{property}` |
| `list-labels` | Die Labels. | – | `GET /labels` |
| `get-label` | Ein Label. | `id` | `GET /labels/{label}` |
| `list-relation-types` | Die Relationstypen. | – | `GET /relation-types` |
| `get-relation-type` | Ein Relationstyp. | `id` | `GET /relation-types/{relationType}` |
| `list-resolutions` | Die Resolutions. | – | `GET /resolutions` |
| `get-resolution` | Eine Resolution. | `id` | `GET /resolutions/{resolution}` |

### `manage-organization`

Ändert die Organisation und ihre Kataloge; nur Org-Admins. `update-…` ersetzt den Eintrag ganz, wie `PUT`. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `update` | Ändert die Organisation; nur die genannten Schlüssel ändern sich. | `input` | `PATCH /organization` |
| `create-workflow` | Legt einen Workflow an. | `input` | `POST /workflows` |
| `update-workflow` | Ersetzt einen Workflow. | `id`, `input` | `PUT /workflows/{workflow}` |
| `delete-workflow` | Löscht einen Workflow. | `id` | `DELETE /workflows/{workflow}` |
| `create-type` | Legt einen Typ an. | `input` | `POST /work-item-types` |
| `update-type` | Ersetzt einen Typ. | `id`, `input` | `PUT /work-item-types/{workItemType}` |
| `delete-type` | Löscht einen Typ (archiviert ihn, solange Items ihn tragen). | `id` | `DELETE /work-item-types/{workItemType}` |
| `create-property` | Legt eine Property an. | `input` | `POST /properties` |
| `update-property` | Ersetzt eine Property. | `id`, `input` | `PUT /properties/{property}` |
| `delete-property` | Löscht eine Property mit ihren Werten. | `id` | `DELETE /properties/{property}` |
| `create-label` | Legt ein Label an. | `input` | `POST /labels` |
| `update-label` | Ersetzt ein Label. | `id`, `input` | `PUT /labels/{label}` |
| `delete-label` | Löscht ein Label. | `id` | `DELETE /labels/{label}` |
| `create-relation-type` | Legt einen Relationstyp an. | `input` | `POST /relation-types` |
| `update-relation-type` | Ersetzt einen Relationstyp. | `id`, `input` | `PUT /relation-types/{relationType}` |
| `delete-relation-type` | Löscht einen Relationstyp mit seinen Relationen. | `id` | `DELETE /relation-types/{relationType}` |
| `create-resolution` | Legt eine Resolution an. | `input` | `POST /resolutions` |
| `update-resolution` | Ersetzt eine Resolution. | `id`, `input` | `PUT /resolutions/{resolution}` |
| `delete-resolution` | Löscht eine Resolution (archiviert sie, solange Items sie tragen). | `id` | `DELETE /resolutions/{resolution}` |

### `people`

Konten: Personen und Bots, offene Einladungen, API-Tokens (die eigenen; Org-Admins auch die der Bots) und wer in einem Projekt erwähnt werden kann. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list-users` | Die Konten, Personen vor Bots (`filter.type` nimmt `person` und `bot`). | – | `GET /users` |
| `get-user` | Ein Konto. | `id` | `GET /users/{user}` |
| `list-bots` | Die Bots. | – | `GET /bots` |
| `list-invitations` | Die offenen Einladungen. | – | `GET /invitations` |
| `list-tokens` | Die API-Tokens des eigenen Kontos oder des Kontos in `filter.user_id`. | – | `GET /tokens` |
| `mentionable` | Wer in einem Projekt erwähnt werden kann. | `project` | `GET /mentions` |

### `manage-people`

Ändert Konten; die meisten Aktionen sind für Org-Admins. Eine neue E-Mail-Adresse einer Person kommt nur aus der Oberfläche (`403 session_required`), und Tokens entstehen nur dort. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `update-user` | Ändert ein Profil; nur die genannten Schlüssel ändern sich. | `id`, `input` | `PATCH /users/{user}` |
| `set-role` | Setzt die Rolle in der Organisation (`org_role`). | `id`, `input` | `PUT /users/{user}/role` |
| `deactivate` | Deaktiviert ein Konto; seine Tokens und Sitzungen enden. | `id` | `POST /users/{user}/deactivate` |
| `reactivate` | Aktiviert ein Konto wieder; Tokens kommen nicht zurück. | `id` | `POST /users/{user}/reactivate` |
| `create-bot` | Legt einen Bot an. | `input` | `POST /bots` |
| `invite` | Lädt eine Adresse ein; antwortet `{link, invitation}`. | `input` | `POST /invitations` |
| `revoke-token` | Widerruft ein API-Token. | `id` | `DELETE /tokens/{token}` |

### `projects`

Die Projekte, die das Konto sieht, ein Projekt, seine Mitglieder und die eigenen Favoriten. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Die Projekte des Kontos (`filter.member` nur die, in denen es Mitglied ist; `include` `members`). | – | `GET /projects` |
| `get` | Ein Projekt. | `project` | `GET /projects/{project}` |
| `members` | Die Mitglieder eines Projekts, Personen und Bots mit ihrer Rolle. | `project` | `GET /projects/{project}/members` |
| `favorites` | Die eigenen Favoriten, Projekte und Views in einer Reihenfolge. | – | `GET /favorites` |

### `manage-projects`

Projekte, ihre Mitglieder und die eigenen Favoriten. Ein Projekt ändern seine Admins. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `create` | Legt ein Projekt an; das Konto wird sein Admin. | `input` | `POST /projects` |
| `update` | Ändert ein Projekt; nur die genannten Schlüssel ändern sich. | `project`, `input` | `PATCH /projects/{project}` |
| `archive` | Archiviert ein Projekt; seine Items sind schreibgeschützt. | `project` | `POST /projects/{project}/archive` |
| `restore` | Holt ein archiviertes Projekt zurück. | `project` | `POST /projects/{project}/restore` |
| `delete` | Löscht ein Projekt sofort für alle; seine Daten gehen im Hintergrund. | `project` | `DELETE /projects/{project}` |
| `set-workflow` | Wechselt den Workflow; jeder benutzte Status braucht ein Ziel in `mapping`, sonst 422 mit `states`. | `project`, `input` | `PUT /projects/{project}/workflow` |
| `join` | Tritt einem Projekt als Mitglied bei. | `project` | `POST /projects/{project}/join` |
| `add-member` | Fügt ein Konto mit einer Rolle hinzu. | `project`, `input` | `POST /projects/{project}/members` |
| `update-member` | Ändert die Rolle eines Mitglieds. | `project`, `user`, `input` | `PATCH /projects/{project}/members/{user}` |
| `remove-member` | Entfernt ein Mitglied; die Lead-Person bleibt. | `project`, `user` | `DELETE /projects/{project}/members/{user}` |
| `toggle-favorite` | Nimmt ein Projekt oder eine View in die eigenen Favoriten auf oder heraus; antwortet `{kind, id, favorite}`. | `input` | `POST /favorites/toggle` |

### `automations`

Die vier Automatisierungen eines Projekts mit ihren Einstellungen. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Die Automatisierungen eines Projekts. | `project` | `GET /projects/{project}/automations` |

### `manage-automations`

Schaltet eine Automatisierung eines Projekts und setzt ihre Einstellungen; die Admins des Projekts. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `update` | Schaltet eine Automatisierung an oder aus und setzt ihre Einstellungen. | `project`, `key`, `input` | `PUT /projects/{project}/automations/{key}` |

### `work-items`

Listen nach einer View und der Kurzform von `filter`, Abfragen mit einem Body, Gruppen und Zählungen, ein Item mit dem, was es einbettet, seine History und seine Beobachter. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Eine Seite Items (schlank, außer `lean` ist 0). | – | `GET /work-items` |
| `query` | Eine Seite Items nach einem Filter in `input`. | – | `POST /work-items/query` |
| `groups` | Die Gruppen einer Abfrage und ihre Zahlen. | `input` | `POST /work-items/groups` |
| `counts` | Die Zahl der Items je benanntem Filter. | `input` | `POST /work-items/counts` |
| `get` | Ein Item; `include` bettet mehr ein. | `item` | `GET /work-items/{item}` |
| `history` | Die History eines Items, älteste zuerst. | `item` | `GET /work-items/{item}/history` |
| `subscribers` | Wer ein Item beobachtet. | `item` | `GET /work-items/{item}/subscribers` |

### `manage-work-items`

Legt Items an und ändert sie. Eine Beschreibung mit `base_description_version` wird mit `409 description_conflict` abgelehnt, wenn sie inzwischen jemand geändert hat. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `create` | Legt ein Item an. | `input` | `POST /work-items` |
| `update` | Ändert die Schlüssel aus `input`. | `item`, `input` | `PATCH /work-items/{item}` |
| `transition` | Zieht ein Item in einen anderen Status. | `item`, `input` | `POST /work-items/{item}/transition` |
| `change-type` | Gibt einem Item einen anderen Typ. | `item`, `input` | `PUT /work-items/{item}/type` |
| `archive` | Archiviert ein geschlossenes Item. | `item` | `POST /work-items/{item}/archive` |
| `restore` | Holt ein archiviertes Item zurück. | `item` | `POST /work-items/{item}/restore` |
| `delete` | Löscht ein Item endgültig. | `item` | `DELETE /work-items/{item}` |
| `bulk-update` | Eine Änderung für viele Items. | `input` | `POST /work-items/bulk` |
| `subscribe` | Beobachtet ein Item. | `item` | `PUT /work-items/{item}/subscription` |
| `unsubscribe` | Beobachtet ein Item nicht mehr. | `item` | `DELETE /work-items/{item}/subscription` |

### `relations`

Die Relationen eines Items. Ein Ende in einem Projekt, das das Konto nicht sieht, ist `hidden`, ohne Key, Titel und ID. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Die Relationen eines Items. | `item` | `GET /work-items/{item}/relations` |

### `manage-relations`

Verknüpft Items und entfernt Relationen. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `add` | Verknüpft ein Item (`item`, die Quelle) mit `input.target_id` (ULID oder Key). | `item`, `input` | `POST /work-items/{item}/relations` |
| `remove` | Entfernt eine Relation, von jedem Ende aus, das das Konto ändern darf. | `relation` | `DELETE /relations/{relation}` |

### `comments`

Die Kommentare eines Items, älteste zuerst, mit ihren Reaktionen. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Eine Seite der Kommentare eines Items. | `item` | `GET /work-items/{item}/comments` |
| `get` | Ein Kommentar. | `comment` | `GET /comments/{comment}` |

### `manage-comments`

Schreibt Kommentare. Bearbeiten darf nur, wer ihn schrieb; löschen dazu die Projekt-Admins. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `add` | Kommentiert ein Item. | `item`, `input` | `POST /work-items/{item}/comments` |
| `edit` | Ersetzt den Text des eigenen Kommentars. | `comment`, `input` | `PATCH /comments/{comment}` |
| `delete` | Löscht einen Kommentar (wer ihn schrieb oder ein Projekt-Admin). | `comment` | `DELETE /comments/{comment}` |
| `react` | Fügt die eigene Reaktion hinzu. | `comment`, `input` | `PUT /comments/{comment}/reactions` |
| `unreact` | Nimmt die eigene Reaktion zurück. | `comment`, `input` | `DELETE /comments/{comment}/reactions` |

### `attachments`

Die Daten eines Bilds oder einer Datei. Die Datei selbst liefert `url` mit demselben Bearer-Token (`?download=1` zum Herunterladen). (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `get` | Die Daten eines Anhangs. | `attachment` | `GET /attachments/{attachment}` |

### `manage-attachments`

Löscht eine Datei aus der Dateiliste eines Items oder einen eigenen Upload, den noch kein Text nennt. Ein Bild oder eine Datei in einem Text geht mit dem Text (`409 attachment_inline`). (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `delete` | Löscht einen Anhang. | `attachment` | `DELETE /attachments/{attachment}` |

### `pages`

Das Wiki eines Projekts: der Baum, eine Seite mit ihrem Text, die Versionen einer Seite. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `tree` | Der ganze Baum eines Projekts, ohne Text. | `project` | `GET /projects/{project}/pages` |
| `get` | Eine Seite mit ihrem Text. | `page` | `GET /pages/{page}` |
| `versions` | Die Versionen einer Seite, neueste zuerst, ohne Text. | `page` | `GET /pages/{page}/versions` |
| `version` | Eine Version einer Seite mit ihrem Text. | `page`, `page_version` | `GET /pages/{page}/versions/{pageVersion}` |

### `manage-pages`

Schreibt Wiki-Seiten, mit dem Konfliktschutz der REST-API (`base_version`, `keep_current`). (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `create` | Eine neue Seite am Ende ihrer Geschwister. | `project`, `input` | `POST /projects/{project}/pages` |
| `update` | Speichert die gesendeten Schlüssel. | `page`, `input` | `PATCH /pages/{page}` |
| `move` | Verschiebt eine Seite mit ihrem Teilbaum. | `page`, `input` | `POST /pages/{page}/move` |
| `delete` | Löscht eine Seite mit ihrem Teilbaum; antwortet `{deleted}`. | `page` | `DELETE /pages/{page}` |
| `restore-version` | Macht eine Version zur aktuellen Seite. | `page`, `page_version` | `POST /pages/{page}/versions/{pageVersion}/restore` |

### `templates`

Vorlagen für Items: die Liste, eine Vorlage, ihre Läufe, der Entwurf eines Items daraus und die nächsten Termine eines Zeitplans. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Eine Seite der Vorlagen aller Projekte, die das Konto sieht. | – | `GET /templates` |
| `get` | Eine Vorlage. | `template` | `GET /templates/{template}` |
| `runs` | Die Läufe einer Vorlage, neueste zuerst. | `template` | `GET /templates/{template}/runs` |
| `draft` | Die Felder eines neuen Items aus einer Vorlage, Platzhalter gefüllt. | `template` | `GET /templates/{template}/draft` |
| `preview` | Die nächsten Termine eines Zeitplans und ein Titel mit gefüllten Platzhaltern; speichert nichts. | `input` | `POST /templates/preview` |

### `manage-templates`

Schreibt Vorlagen und führt sie sofort aus. Ein gescheiterter Lauf antwortet mit seinem Satz, nicht mit einem Fehler. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `create` | Eine neue Vorlage in einem Projekt. | `project`, `input` | `POST /projects/{project}/templates` |
| `update` | Ersetzt eine Vorlage ganz. | `template`, `input` | `PUT /templates/{template}` |
| `delete` | Löscht eine Vorlage; Items daraus bleiben. | `template` | `DELETE /templates/{template}` |
| `run` | Führt eine Vorlage sofort aus; antwortet den Lauf und sein Item (keins, wenn der Lauf scheiterte). | `template` | `POST /templates/{template}/run` |

### `views`

Die Views des Teams und eine Seite der Items einer View. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Die Views, nach Name. | – | `GET /views` |
| `get` | Eine View mit Filter und Darstellung. | `view` | `GET /views/{view}` |
| `items` | Eine Seite der Items einer View (schlank, außer `lean` ist false). | `view` | `POST /work-items/query` |

### `manage-views`

Legt Views an, ersetzt und löscht sie; wer die View anlegte oder ein Org-Admin. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `create` | Legt eine View an. | `input` | `POST /views` |
| `update` | Ersetzt eine View (alle vier Schlüssel). | `view`, `input` | `PUT /views/{view}` |
| `delete` | Löscht eine View samt den Sternen aller daran. | `view` | `DELETE /views/{view}` |

### `notifications`

Die eigene Inbox und die eigenen Benachrichtigungseinstellungen. Ein Bot hat eine leere Inbox. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Eine Seite der eigenen Inbox, neueste zuerst. | – | `GET /notifications` |
| `preferences` | Die ganze Matrix aus Arten und Kanälen mit dem Wert, der gilt. | – | `GET /notification-preferences` |

### `manage-notifications`

Markiert eigene Benachrichtigungen als gelesen oder ungelesen, löscht sie und ändert die Einstellungen. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `read` | Markiert Benachrichtigungen als gelesen: nach IDs oder alle ungelesenen. | `input` | `POST /notifications/read` |
| `unread` | Markiert gelesene Benachrichtigungen wieder als ungelesen. | `input` | `POST /notifications/unread` |
| `delete` | Löscht eine Benachrichtigung der eigenen Inbox. | `notification` | `DELETE /notifications/{notification}` |
| `save-preferences` | Ändert die genannten Zellen der Einstellungen; antwortet die ganze Matrix. | `input` | `PUT /notification-preferences` |

### `webhooks`

Webhooks und ihr Zustellprotokoll; nur Org-Admins. Das Geheimnis steht nie darin. (Braucht `read`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `list` | Eine Seite der Webhooks. | – | `GET /webhooks` |
| `get` | Ein Webhook. | `webhook` | `GET /webhooks/{webhook}` |
| `deliveries` | Die Versuche eines Webhooks, neueste zuerst. | `webhook` | `GET /webhooks/{webhook}/deliveries` |

### `manage-webhooks`

Schreibt Webhooks; nur Org-Admins. `create` und `rotate-secret` nennen das Geheimnis einmal. `ping` und `redeliver` rufen den Empfänger auf, zusammen mit der REST-API 6-mal je Minute und Konto. (Braucht `write`.)

| Aktion | Zweck | Pflicht | REST-Zwilling |
|---|---|---|---|
| `create` | Legt einen Webhook an; antwortet `{data, secret}`. | `input` | `POST /webhooks` |
| `update` | Ersetzt einen Webhook ganz; ohne Geheimnis in der Antwort. | `webhook`, `input` | `PUT /webhooks/{webhook}` |
| `delete` | Löscht einen Webhook mit seinen Versuchen. | `webhook` | `DELETE /webhooks/{webhook}` |
| `rotate-secret` | Ein neues Geheimnis, das alte gilt nicht mehr; antwortet `{data, secret}`. | `webhook` | `POST /webhooks/{webhook}/rotate-secret` |
| `ping` | Sendet sofort einen Test-Ping und antwortet seinen Versuch. | `webhook` | `POST /webhooks/{webhook}/ping` |
| `redeliver` | Sendet eine Zustellung erneut und antwortet den neuen Versuch. | `webhook`, `delivery` | `POST /webhooks/{webhook}/deliveries/{delivery}/redeliver` |

<!-- tools:end -->

## Argumente

- **Referenzen** im Pfad des Zwillings sind Argumente in `snake_case`: `item` (ULID oder Key, auch ein früherer: das Item kommt mit seinem aktuellen Key, eine Umleitung gibt es nicht), `project` (ULID, Kennung oder frühere Kennung), `page`, `page_version`, `comment`, `template`, `view`, `webhook` usw. (ULIDs in jeder Schreibweise), `id` für einen Eintrag eines Katalogs, ein Konto oder ein Token, außer wo die Route das Konto neben einem Projekt als `{user}` nennt: `manage-projects` nimmt das Mitglied in `update-member` und `remove-member` als `user`.
- **`input`** ist der Body des REST-Zwillings, mit denselben Schlüsseln und demselben Schema wie unter `/api/docs`. Rich Text geht als Markdown hinein (`description`, `body`, `content`) oder als Tiptap-JSON unter dem Schlüssel mit `_json`, wie über REST.
- **Queries** eines `GET`-Zwillings sind eigene Argumente: `filter` ist ein Objekt (`{"assignee": ["me"]}`), Listen sind JSON-Listen (`["person", "bot"]`), Flags `true` und `false` oder `1` und `0`. Texte werden wie über REST getrimmt, auch Unicode-Leerraum.
- **Seiten:** `cursor` ist das `meta.next_cursor` der Seite davor, `per_page` weggelassen 25 (REST: 100). Listen von Items sind schlank, wenn `lean` fehlt (`work-items:list`, `work-items:query`, `views:items`, `templates:list`): ohne Beschreibung und ohne Markdown der Rich-Text-Werte; mit `lean: false` kommen sie mit, oder das Item über `work-items:get`. Wer beides setzt, bekommt dieselbe Antwort wie über REST.

## Ergebnisse

Das Ergebnis eines Tools ist der Body der REST-Antwort, als `structuredContent` und als JSON-Text gespiegelt in `content`, mit drei Unterschieden:

- **Rich Text nur als Markdown:** `description`, `body`, `content` und die Rich-Text-Werte in `values` sind Markdown für das Konto (aktuelle Handles, Keys von Items, die es sieht, `[hidden](item:…)` für den Rest); die Formen mit `_json` fallen weg.
- **Keine `links`:** Eine Liste hat `data` und `meta`; `meta.path` ist die Adresse des REST-Zwillings, `meta.next_cursor` führt zur nächsten Seite.
- **Antworten ohne Body** (`204`, `202`) sind `{"done": true}`.

Ein Tool, das schreibt, antwortet, was REST antwortet: das Item nach der Änderung, `{updated, rejected}` von `manage-work-items:bulk-update`, `{deleted}` von `manage-pages:delete`, den Lauf von `manage-templates:run`, auch wenn er scheiterte (mit seinem Satz in `error`).

## Fehler

Eine Ablehnung ist ein Ergebnis mit `isError: true`. Sein Text ist eine Zeile `<status> <reason>: <detail>`, danach je Feldfehler eine Zeile `<feld>: <satz>`; `structuredContent` ist das [Problem](/de/api#fehler), das REST antworten würde, mit demselben `reason` und in der Sprache des Kontos. Ein `429` hat dazu `retry_after` in Sekunden.

```text
422 validation_failed: Die Eingabe ist nicht gültig.
values.customer: „Kunde“ ist ein Pflichtfeld.
```

Manche Fehler kommen, bevor ein Tool läuft, und sind HTTP-Antworten: `401` ohne gültiges Token oder für ein deaktiviertes Konto (mit `WWW-Authenticate`), `403` für ein Token ohne `mcp` oder ein fremdes `Origin`, `413`, `415`, `429`, jeweils mit einem Problem. Ein Tool, das das Token nicht benutzen darf, und ein unbekanntes Tool sind der JSON-RPC-Fehler `-32602`.

## Rich Text und Erwähnungen

Schreib Markdown wie über REST: `@handle` erwähnt eine Person oder einen Bot, die im Projekt Arbeit übernehmen können (`people:mentionable` nennt sie), ein Key wie `WEB-12` wird ein Verweis, wenn das Konto das Item sieht, `![alt](attachment:<id>)` zeigt ein hochgeladenes Bild. Die Referenz ist die Resource `werkbuch://reference/markdown`, derselbe Text wie der Abschnitt [Markdown](/de/concepts/rich-text#markdown) bei Rich Text. Eine Erwähnung aus einem Tool benachrichtigt wie eine aus der Oberfläche; die Erwähnung eines Bots schickt `bot.mentioned` an seinen Webhook.

## Datei hochladen

Eine Datei geht nie über ein Argument eines Tools. `get-upload-url` gibt eine Adresse, an die sie geht:

```json
{
  "data": {
    "url": "https://werkbuch.example.com/api/mcp/uploads/01k…?project_id=…&kind=inline&expires=…&signature=…",
    "method": "POST",
    "field": "file",
    "expires_at": "2026-11-07T09:15:00.000000Z",
    "curl": "curl -F 'file=@<path>' 'https://werkbuch.example.com/api/mcp/uploads/01k…'"
  }
}
```

`input.kind` ist `inline` für ein Bild oder eine Datei in einem Text oder `file` für die Dateiliste von `input.work_item_id`. Der Agent schickt die Datei mit `curl -F 'file=@<path>' '<url>'`, ohne Bearer-Token; die Antwort ist der Anhang mit seiner `id`. Eine `file` steht sofort in der Dateiliste des Items. Ein Upload `inline` gehört niemandem, bis der Agent `![alt](attachment:<id>)` (Bild) oder `[name](attachment:<id>)` (Datei) in einen Markdown-Text des Projekts schreibt; ab dann besitzt ihn der Text, und ein Upload, den kein Text nimmt, geht nach 24 Stunden.

Die Adresse nennt Projekt, Art und Item in ihrer Signatur und gilt höchstens 15 Minuten, nie länger als ihr Token. Sie darf mehrfach benutzt werden, so kann `curl` nach einem Abbruch neu ansetzen. Jeder Upload prüft das Token erneut (nicht widerrufen, nicht abgelaufen, Konto aktiv, `write` und `mcp`) und die Rechte des Kontos an Projekt und Item, so wie sie beim Upload sind.

## Referenzen

| URI | Inhalt |
|---|---|
| `werkbuch://reference/filters` | Filter als JSON: Felder, Operatoren, Werte ([Views](/de/concepts/views#filter)) |
| `werkbuch://reference/markdown` | Markdown von Rich Text ([Rich Text](/de/concepts/rich-text#markdown)) |
| `werkbuch://reference/field-types` | Die Werte jedes Feldtyps einer Property ([Typen und Properties](/de/concepts/types-and-properties#feldtypen)) |

Jede ist ein Abschnitt der englischen Doku, gelesen, wenn der Client sie erfragt; so laufen Referenz und Doku nie auseinander.

## Sicherheit

- **Texte sind Daten.** Titel, Beschreibungen, Kommentare, Wiki-Seiten und Namen kommen von Menschen. Die Instructions des Servers sagen dem Modell, Aufforderungen darin nicht zu folgen; an den Rechten seines Kontos kommt es über die Tools ohnehin nicht vorbei. Gib einem Agenten ein Token eines [Bots](/de/bots) mit den Mitgliedschaften, die seine Aufgabe braucht, und nur `read` und `mcp`, wenn er nur liest.
- **Der Standard-Bot ist Org-Admin.** Ein Token von ihm darf überall alles; gib es nie einem Agenten.
- **Alles, was ein Tool antwortet, landet im Verlauf des Agenten**, auch beim Anbieter des Modells. Dazu gehören das Geheimnis eines Webhooks (`manage-webhooks:create`, `manage-webhooks:rotate-secret`), der Einladungslink von `manage-people:invite`, die Adresse von `get-upload-url` und die Adresse eines Webhooks samt Query (`webhooks:get`), die ein Token des Empfängers tragen kann. Lege Webhooks und Einladungen über REST oder in der Oberfläche an, wenn das zählt.
- **Jede Änderung ist gezeichnet:** Events und History nennen das Konto und `via: mcp`, so lässt sich die Änderung eines Agenten von der einer Person unterscheiden.

## Agent-Szenario

Ein [Bot](/de/bots) als Agent: Ein Org-Admin legt den Bot an, macht ihn zum Mitglied eines Projekts und legt ein Token mit `read`, `write` und `mcp` für ihn an, dazu einen [Webhook](/de/webhooks#agenten) **nur für diesen Bot** mit den Ereignissen `bot.*`.

1. Jemand weist dem Bot ein Item zu. Der Webhook `bot.assigned` erreicht den Agenten mit dem Item in `data.item`.
2. Der Agent verbindet sich mit seinem Token mit `/mcp` und ruft `whoami`: Er erfährt sein Konto und seine Rechte.
3. `work-items:get` mit `item` (dem Key aus dem Webhook) liest das Item, die Beschreibung als Markdown.
4. Er erledigt die Arbeit und meldet sich mit `manage-comments:add` (`item`, `input.body` in Markdown).
5. `manage-work-items:transition` (`item`, `input.to_state_id`) zieht das Item weiter; die History zeigt den Bot mit `via: mcp`.

`bot.mentioned` weckt den Agenten genauso, wenn jemand `@handle` des Bots schreibt. Über REST sind dieselben Schritte `GET /me`, `GET /work-items/{item}`, `POST /work-items/{item}/comments` und `POST /work-items/{item}/transition`.
