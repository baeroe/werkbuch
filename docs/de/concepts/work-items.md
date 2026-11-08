# Work Items

Ein Work Item ist ein Stück Arbeit in einem Projekt: ein Task, ein Bug, ein Epic oder welchen [Typ](/de/concepts/types-and-properties) deine Organisation sonst anlegt. Jedes Item gehört zu genau einem Projekt, durchläuft den [Workflow](/de/concepts/workflows) dieses Projekts und behält eine History von allem, was mit ihm passiert ist.

Wer ein Projekt sieht, liest seine Items. Member und Admins des Projekts legen sie an und ändern sie; Viewer lesen nur. Löschen dürfen nur Admins des Projekts. Wer ein Projekt sieht und wer welche Rolle hat, steht unter [Rollen und Rechte](/de/concepts/permissions).

## Felder

| Feld | Hinweise |
|---|---|
| Key | `WEB-47`: die Kennung des Projekts und eine Nummer. Siehe unten. |
| Typ | Einer der Typen, die das Projekt eingeschaltet hat; ohne Wahl der Standardtyp. |
| Titel | Pflicht, bis 255 Zeichen. |
| Beschreibung | [Rich Text](/de/concepts/rich-text): Überschriften, Listen, Checklisten, Tabellen, Code, Links, Erwähnungen, Verweise auf Items, Bilder und Dateien. |
| Status | Ein Status des Workflows des Projekts. Neue Items starten in dessen Startstatus. |
| Resolution | Wird beim Schließen gesetzt und beim Wiederöffnen geleert. |
| Assignee | Niemand oder eine Person oder ein Bot: ein aktives Mitglied des Projekts oder eine Person, die Org-Admin ist. Der Standard-Bot nur, wenn er Mitglied ist. |
| Priorität | Urgent, High, Medium, Low oder None (Standard). |
| Labels | Beliebig viele Labels der Organisation. |
| Start-Date, Due-Date | Tage ohne Uhrzeit. Das Start-Date liegt nicht nach dem Due-Date. |
| Eltern-Item | Ein Epic desselben Projekts. Siehe unten. |
| Properties | Die Felder des Typs, etwa „Kunde“ oder „Aufwand (h)“, manche davon Pflicht. |

Dazu merkt sich werkbuch, wer das Item wann angelegt hat, wann es zuletzt geändert wurde, wann es zum ersten Mal begonnen wurde (der erste Eintritt in einen Status der Kategorie Started), wann es geschlossen wurde (Eintritt in Completed oder Canceled; beim Wiederöffnen geleert) und wann es archiviert wurde. Ein Item aus einer [Vorlage](/de/concepts/templates) merkt sie sich in `template_id`; wird die Vorlage gelöscht, bleibt das Item, und `template_id` wird `null`. Ein offenes Item, dessen Due-Date vorbei ist, zeigt sich als überfällig, gerechnet in der Zeitzone der Organisation.

## Key

Der Key ist die Kennung des Projekts, ein Bindestrich und eine Nummer: `WEB-47`. Die Nummern zählen je Projekt hoch und werden nie wieder vergeben, auch nicht nach dem Löschen eines Items; ein Key meint also immer dasselbe Item.

Ändert ein Projekt seine Kennung, ändern sich die Keys mit, und die alten funktionieren weiter: `/items/ALT-12` führt auf `/items/NEU-12`, und die API beantwortet ein Lesen über den alten Key mit `301`. Umgeleitet wird nur ein Item, das du sehen darfst; für jedes andere ist der alte Key so unbekannt wie einer, den es nie gab.

## Typ

Der Typ bestimmt, welche Properties ein Item hat. Ein Wechsel, in der Oberfläche mit `t` oder über das Feld Typ, behält die Werte, die auch der neue Typ hat, und lässt die anderen fallen. Vorher nennt die Oberfläche die Werte, die verloren gehen, und fragt die Pflicht-Properties des neuen Typs ab, die noch leer sind. Die verlorenen Werte bleiben in der History.

Die zwei Ebenen der Epics gelten auch für den Typ: Ein Item mit Kind-Items behält einen Epic-Typ, und ein Item mit Eltern-Item kann kein Epic werden. werkbuch lehnt so einen Wechsel ab und sagt, warum.

## Status und Resolution

Der Status wechselt entlang der Übergänge des Workflows: In einem freien Workflow geht alles, mit Übergangsmatrix nur die erlaubten Paare. Einen Übergang, den der Workflow nicht erlaubt, lehnt werkbuch überall ab, in der Oberfläche und über die API (`409`, `reason: transition_not_allowed`); das Statusfeld bietet nur die erlaubten an.

Wechselt ein Item in einen Status der Kategorie Completed oder Canceled, ist es geschlossen und bekommt eine Resolution: die gewählte, sonst den Standard der Kategorie. Die Oberfläche fragt nach, mit dem Standard vorgewählt; `mod+enter` bestätigt. Zurück in einen offenen Status leert die Resolution. Ein Item lässt sich auch direkt in einem anderen Status anlegen; das wird wie ein Übergang vom Startstatus aus geprüft, und die History zeigt beide Schritte.

## Eltern und Kinder

Items eines Epic-Typs können Kind-Items haben; Epics haben selbst kein Eltern-Item, es gibt also zwei Ebenen. Das Eltern-Item ist ein Epic desselben Projekts. Ein Epic zeigt den Fortschritt seiner Kinder: die geschlossenen (Completed oder Canceled) von allen. **Kind-Item** im Abschnitt Kinder eines Epics legt eins mit dem Epic als Eltern-Item an. Hat ein Epic mehr als 100 Kinder, zeigt der Abschnitt die ersten 100, **Weitere Kind-Items laden** holt die nächsten.

## Relationen

Eine Relation verbindet zwei Items über einen [Relationstyp](/de/concepts/types-and-properties#relationstypen), etwa „blockiert“, „Duplikat“ oder „verwandt“. Sie liest sich von beiden Enden: Blockiert WEB-30 das Item WEB-47, wird WEB-47 von WEB-30 blockiert. Relationen gehen über Projektgrenzen. Ein Item lässt sich nicht mit sich selbst verbinden, und dasselbe Paar kann denselben Typ nicht zweimal haben; bei einem symmetrischen Typ zählt das umgekehrte Paar als dasselbe.

Ein Item am anderen Ende, das du nicht sehen darfst, erscheint als **verborgenes Item**, ohne Key und Titel. Eine Relation entfernen darf, wer eines ihrer Enden ändern darf.

Nur „blockiert“ hat eine Folge: Solange ein offenes Item ein anderes offenes blockiert, zeigt das blockierte einen Hinweis. werkbuch hindert niemanden daran, es zu beginnen. Der Hinweis zählt auch einen Blocker, den du nicht sehen darfst, ohne ihn zu nennen. Alle anderen Relationstypen sind reine Beschriftung.

## Wiki-Seiten

Verweisen Wiki-Seiten per `#` auf ein Item, zeigt das Item sie im Abschnitt **Wiki-Seiten** zwischen Relationen und Dateien: jede Seite als Link in ihr Wiki. Den Abschnitt gibt es nur, wenn mindestens eine solche Seite existiert, die du sehen darfst. Er liest den aktuellen Text der Seiten und folgt darum Änderungen, Verschiebungen und Löschungen im Wiki. Siehe [Wiki](/de/concepts/wiki#verweise-und-suche).

## Kommentare

Wer ein Item lesen kann, kann es kommentieren, auch als Viewer; Bots ebenso, über die API. Ein Kommentar ist [Rich Text](/de/concepts/rich-text) der Stufe Kommentar: Text, Listen, Zitate, Code, Links, Erwähnungen, Verweise, Bilder und Dateien. In der Oberfläche öffnet `m` das Kommentarfeld am Ende der Aktivität, und `mod+enter` sendet. Ein Kommentar, der beim Senden scheitert, bleibt im Feld, und nicht gesendeter Text bleibt für diesen Besuch erhalten, auch wenn du das Item schließt.

Eigene Kommentare kannst du bearbeiten und löschen. Ein bearbeiteter Kommentar trägt **bearbeitet**, und die History behält die frühere Fassung; ist der Kommentar gelöscht, sagt die History nur noch, dass er bearbeitet und gelöscht wurde, ohne seinen Text. Projekt-Admins und Org-Admins können fremde Kommentare löschen, nie bearbeiten. Löschen wartet fünf Sekunden mit **Rückgängig**.

Wer kommentieren darf, kann mit jedem Emoji reagieren, je Person einmal pro Emoji; ein zweiter Druck auf die eigene Reaktion nimmt sie zurück. Ein Hautton ist ein eigenes Emoji.

Ein archiviertes Item oder ein Item in einem archivierten Projekt nimmt keine neuen Kommentare und Reaktionen, und seine Kommentare lassen sich weder bearbeiten noch löschen. Ein Kommentar ändert die Zeit „geändert“ des Items nicht; die Sortierung danach meint seine Felder.

## Dateien

Der Abschnitt **Dateien** eines Items listet die angehängten Dateien: Bilder mit einer kleinen Vorschau, andere Dateien mit einem Icon, je mit Name und Größe. Ein Bild öffnet sich in einem neuen Tab, daneben steht sein Download; jede andere Datei wird heruntergeladen. **Datei hochladen** oder das Ziehen von Dateien auf den Abschnitt hängt sie an, jede mit eigenem Fortschritt; **Entfernen** nimmt eine weg, mit Rückgängig. Beides braucht das Recht, das Item zu ändern, und beides steht in der History. Dateien bleiben im Projekt: Herunterladen kann sie nur, wer das Item sieht.

Bilder und Dateien in einem Text (der Beschreibung, einem Kommentar) gehören nicht zu dieser Liste, sondern zu ihrem Text. Wie sie hochgeladen werden, welche Formate im Text erscheinen und wie die Größe begrenzt ist, steht unter [Rich Text](/de/concepts/rich-text#bilder-und-dateien).

## Beobachten

Wer ein Item beobachtet, erfährt von Kommentaren, Statuswechseln und anderen Änderungen in der Inbox und, wenn gewünscht, per Mail; wer wovon erfährt, steht unter [Benachrichtigungen](/de/concepts/notifications). Wer ein Item anlegt, wem es zugewiesen wird, wer es kommentiert und wer darin erwähnt wird, beobachtet es automatisch. Wer ein Item lesen kann, kann es beobachten oder nicht mehr beobachten, auch als Viewer und auch in einem archivierten Projekt. Wer sich abmeldet, bleibt abgemeldet, bis das Item ihm erneut zugewiesen wird oder er darin neu erwähnt wird; Kommentieren meldet ihn nicht wieder an. Bots beobachten keine Items.

## Archivieren und Löschen

**Archivieren** ist für geschlossene Items: Es blendet sie aus Listen aus, und sie sind schreibgeschützt, bis jemand sie wiederherstellt. Archivieren lassen sich nur Items in einem Status der Kategorie Completed oder Canceled (`409`, `reason: not_closed`); eine Änderung an einem archivierten Item wird abgelehnt (`409`, `reason: archived`). **Wiederherstellen** macht es wieder änderbar, im Status, den es hatte.

**Löschen** entfernt ein Item endgültig, mit seinen Werten, Labels, Relationen, Kommentaren und Dateien; das dürfen nur Admins des Projekts. Die Oberfläche wartet vorher fünf Sekunden, und **Rückgängig** hält es auf. Kind-Items werden zu Items ohne Eltern, und sie wie auch die Items am anderen Ende seiner Relationen bekommen einen Eintrag in ihre History. Die History des gelöschten Items selbst bleibt im Event-Protokoll.

`mod+backspace` an einem Item archiviert es, wenn es geschlossen ist, und löscht es sonst, beides mit Rückgängig. Auf eine Auswahl wirkt es nur, wenn das für jedes Item dasselbe ist (alle geschlossen zum Archivieren oder keins geschlossen zum Löschen).

## Mehrfachbearbeitung

Mehrere Items können dieselbe Änderung auf einmal bekommen: Status, Resolution, Assignee, Priorität, Labels (setzen, hinzufügen oder entfernen), Daten, Archivieren und Wiederherstellen. Für jedes Item gelten seine eigenen Regeln: sein Workflow, sein Projekt, deine Rolle darin. Was bei einem Item abgelehnt wird, hält die anderen nicht auf; die Antwort nennt die abgelehnten mit ihrem Grund. In der Oberfläche wählst du Items in einer [Liste](/de/concepts/views) aus (`x`, `shift+x`, `mod+a`): Die Leiste über der Liste ändert alle, die Item-Kürzel wirken auf die Auswahl, und ein Toast nennt, was abgelehnt wurde. Die Oberfläche bietet eine Aktion für eine Auswahl nur an, wenn sie für jedes ausgewählte Item erlaubt ist; sie ändert also nie nur einen Teil, weil Rechte fehlen oder Items archiviert sind.

## Gleichzeitige Änderungen

Ändern zwei Personen dasselbe Item, gewinnt Feld für Feld die letzte Änderung, und die History zeigt beide.

Die Beschreibung ist geschützt: Die Oberfläche schickt die Version der Beschreibung mit, von der sie ausging. Hat inzwischen jemand anderes die Beschreibung gespeichert, wird nichts überschrieben. Dein Text bleibt im Editor, ein Banner nennt, wer sie geändert hat, und du wählst zwischen der neuen Fassung und deiner; die andere bleibt in der History. Über die API greift der Schutz, wenn du `base_description_version` mitschickst; ohne gewinnt die letzte Änderung.

## History

Jede Änderung ist ein Eintrag in der History des Items, mit wer, wann und wie (in der Oberfläche, über die API, durch eine [Automatisierung](/de/concepts/automations) oder eine Vorlage). Ein Item, das eine Vorlage anlegte, sagt „Aus Vorlage „…““ mit dem Namen, den die Vorlage damals hatte; ein Schritt einer Automatisierung nennt seinen Grund, etwa „Automatisierung: Eltern schließen“. Eine Feldänderung zeigt den alten und den neuen Wert; ein Statuswechsel nennt beide Status so, wie sie damals hießen, auch wenn ein Status später umbenannt oder entfernt wurde. Die Oberfläche fasst die Änderungen einer Person innerhalb von fünf Minuten zusammen und zeigt die Kommentare in derselben Zeitleiste; der Filter wechselt zwischen allem, Kommentaren und Änderungen. Auch das Bearbeiten und Löschen eines Kommentars und das Anhängen und Entfernen einer Datei der Dateiliste sind Einträge. Beobachten, Reaktionen und die manuelle Reihenfolge der Items gehören nicht zur History.

## REST

Lesen braucht ein Token mit `read`, Ändern eines mit `write`. Items sprichst du über ULID oder Key an (`WEB-47`, in beliebiger Schreibweise, auch mit einer früheren Kennung).

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/work-items` | Items, die du siehst: `view`, eine Kurzform wie `filter[project]`, `filter[assignee]=me`, `filter[q]` (ein Key oder ein Teil des Titels), `sort`, `show_sub_items`, `include_archived`, `lean`, `cursor`, `per_page`. Filter, Gruppen und Zahlen stehen unter [Views](/de/concepts/views#rest). |
| `POST /api/v1/work-items` | `201` mit dem neuen Item. |
| `GET /api/v1/work-items/{item}` | Das Item; `?include=children,relations,type,workflow,attachments` bettet diese mit ein (`children`: die ersten 100 nach Rang, archivierte eingeschlossen; `children_progress.total` zählt alle, die Liste `?filter[parent]=WEB-30&include_archived=1` hat den Rest). |
| `PATCH /api/v1/work-items/{item}` | `200` mit dem Item. |
| `POST /api/v1/work-items/{item}/transition` | `200`; `to_state_id`, `resolution_id`. |
| `PUT /api/v1/work-items/{item}/type` | `200`; `type_id`, `values`. |
| `POST /api/v1/work-items/{item}/archive` | `200`; `.../restore` holt es zurück. |
| `DELETE /api/v1/work-items/{item}` | `204`. |
| `POST /api/v1/work-items/bulk` | `200` mit `updated` und `rejected`. |
| `GET`, `POST /api/v1/work-items/{item}/relations` | Die Relationen, wie du sie siehst; `201` mit der neuen (`type_id`, `target_id`). |
| `DELETE /api/v1/relations/{id}` | `204`. |
| `GET /api/v1/work-items/{item}/subscribers` | Wer das Item beobachtet. |
| `PUT`, `DELETE /api/v1/work-items/{item}/subscription` | Beobachten an oder aus; `200` mit dem Item. |
| `GET /api/v1/work-items/{item}/history` | Die History, älteste zuerst. |
| `GET /api/v1/work-items/{item}/pages` | Die [Wiki-Seiten](#wiki-seiten), die auf das Item verweisen und die du siehst, nach Titel. |
| `POST /api/v1/projects/{project}/redistribute-ranks` | `200` mit `{"redistributed": n}`; siehe [Items von Hand ordnen](#items-von-hand-ordnen). |
| `GET`, `POST /api/v1/work-items/{item}/comments` | Die Kommentare, älteste zuerst; `201` mit dem neuen. Kommentare, Reaktionen und Dateien stehen unter [Rich Text](/de/concepts/rich-text#rest). |

Ein Item, das das Konto des Tokens nicht sieht, ist ein `404`, wie eines, das es nicht gibt. Ein unbekannter Filter oder ein unbekanntes `include` ist ein `422`, nie still übergangen. Meldungen (`detail`, Feldfehler) kommen in der Sprache des Kontos, sonst in der Standardsprache der Organisation.

### Ein Item anlegen

`project_id` nimmt die Kennung oder die ULID des Projekts. Die Beschreibung kommt als Markdown in `description` oder als Tiptap-JSON in `description_json`, nicht beides; die Antwort hat beide Formen. HTML im Markdown bleibt Text, Links behalten nur `http`, `https` und `mailto`, und eine Beschreibung hat höchstens 256 KB. `values` hält die Properties unter ihrem Schlüssel; ein Dropdown nimmt die ULID einer Option. `template_id` macht das Item aus einer Vorlage des Projekts und kopiert ihre Bilder (siehe [Vorlagen](/de/concepts/templates#eine-vorlage-per-api-anwenden)).

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "APP",
    "type_id": "01m6akx7247gfm80md352w7wra",
    "title": "Zwei Farbvarianten für die Startseite",
    "description": "Der Kunde wünscht **zwei** Varianten:\n\n- hell\n- dunkel",
    "priority": "high",
    "values": { "customer": "01m6akx71ps45t3brd0rtp5496" }
  }'
```

Die Antwort (`201`, gekürzt):

```json
{
  "data": {
    "id": "01m6akyecnp503vn6jmb8sp249",
    "number": 25,
    "key": "APP-25",
    "title": "Zwei Farbvarianten für die Startseite",
    "description": "Der Kunde wünscht **zwei** Varianten:\n\n- hell\n- dunkel",
    "description_json": { "type": "doc", "content": ["…"] },
    "description_version": 1,
    "state_id": "01m6akx71bcm10xw328kxkw7ak",
    "resolution_id": null,
    "priority": "high",
    "values": { "customer": "01m6akx71ps45t3brd0rtp5496", "approved": false },
    "values_markdown": {},
    "children_progress": null,
    "blocked": false,
    "blocking": false,
    "subscribed": true
  }
}
```

Eine Pflicht-Property ohne Wert ist ein `422` an `values.<key>`, und nichts entsteht, nicht einmal eine Nummer wird verbraucht:

```json
{
  "type": "urn:werkbuch:problem:validation_failed",
  "title": "Validierung fehlgeschlagen",
  "status": 422,
  "detail": "Die Eingabe ist nicht gültig.",
  "reason": "validation_failed",
  "errors": { "values.customer": ["„Kunde“ ist ein Pflichtfeld."] }
}
```

`state_id` legt das Item in einem anderen Status an, geprüft wie ein Übergang vom Startstatus aus. `parent_id`, `assignee_id`, `label_ids`, `start_date` und `due_date` funktionieren wie beim Ändern.

### Ein Item ändern

`PATCH` ändert nur, was du schickst; `null` leert ein Feld. Schicke zu einer neuen Beschreibung `base_description_version` mit, um sie zu schützen:

```bash
curl -X PATCH https://werkbuch.example.com/api/v1/work-items/APP-25 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"description": "Vier Varianten.", "base_description_version": 1}'
```

Hat sich die Beschreibung seit Version 1 geändert, antwortet werkbuch `409` mit dem Item, wie es jetzt ist, in `current`, und nichts wird gespeichert. Um deinen Text zu behalten, schickst du ihn erneut mit der `description_version` aus `current`.

```json
{
  "type": "urn:werkbuch:problem:description_conflict",
  "title": "Konflikt",
  "status": 409,
  "detail": "Mara Lindqvist hat die Beschreibung inzwischen geändert.",
  "reason": "description_conflict",
  "current": { "key": "APP-25", "description": "Drei Varianten.", "description_version": 2, "…": "…" }
}
```

### Ein Item verschieben

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/APP-25/transition \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to_state_id": "01m6akx71dkvjjrrvepyrpwdtd"}'
```

Im Demo-Workflow „Agentur-Freigabe“ darf Todo nicht direkt nach Done:

```json
{
  "type": "urn:werkbuch:problem:transition_not_allowed",
  "title": "Konflikt",
  "status": 409,
  "detail": "Von „Todo“ nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.",
  "reason": "transition_not_allowed"
}
```

Bei einem geschlossenen Status wählt `resolution_id` die Resolution; ohne behält das Item die, die es in dieser Kategorie hatte, oder bekommt den Standard. Ein Status außerhalb des Workflows des Projekts ist ein `422` an `state_id`.

### Items von Hand ordnen

Die Sortierung „Manuell“ folgt dem Rang jedes Items (`rank`): ein kurzer Text, Byte für Byte verglichen, bei gleichen entscheidet die ULID. Wer ein Item von Hand verschiebt, schickt einen Rang zwischen seinen Nachbarn (`PATCH` mit `rank`, höchstens 128 Zeichen). Ist zwischen zwei Nachbarn kein Platz mehr, bekommen die Items des Projekts neue kurze Ränge in ihrer Ordnung:

```bash
curl -X POST https://werkbuch.example.com/api/v1/projects/WEB/redistribute-ranks \
  -H "Authorization: Bearer <token>"
```

```json
{ "redistributed": 57 }
```

`redistributed` zählt die Items, deren Rang sich geändert hat. Jedes Item des Projekts behält seinen Platz, archivierte eingeschlossen; keins bekommt ein neues `updated_at`, und die History eines Items zeigt es nicht. Eine Liste mehrerer Projekte nach „Manuell“ kann ihre Items danach anders mischen. Mitglieder und Admins des Projekts dürfen es (`item.edit`, die Fähigkeit `write`), in einem archivierten Projekt niemand (`409 project_archived`). Änderungen an Items des Projekts warten, bis die neuen Ränge gespeichert sind.

### Mehrere Items ändern

`ids` nimmt 1 bis 100 ULIDs oder Keys, `patch` die Änderung: `state_id`, `resolution_id`, `assignee_id`, `priority`, `label_ids`, `add_label_ids`, `remove_label_ids`, `start_date`, `due_date` und `archived` (`true` archiviert, `false` stellt wieder her). Titel, Beschreibungen und Properties gehören nicht dazu. Jedes Item wird für sich geändert; `updated` nennt die ULIDs aller Items, die nicht abgelehnt wurden, unveränderte eingeschlossen, `rejected` die abgelehnten unter der Referenz, die du geschickt hast.

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["WEB-47", "APP-25", "WEB-999"], "patch": {"priority": "low", "archived": true}}'
```

```json
{
  "updated": ["01m6akyecnp503vn6jmb8sp249"],
  "rejected": [
    { "id": "WEB-47", "reason": "not_closed" },
    { "id": "WEB-999", "reason": "not_found" }
  ]
}
```

WEB-47 ist offen und lässt sich nicht archivieren, also behält es auch seine Priorität. Die Gründe sind die der einzelnen Anfragen: `not_found`, `forbidden`, `project_archived`, `archived`, `not_archived`, `not_closed`, `transition_not_allowed`, `validation_failed`. Ein `patch` mit anderen Schlüsseln ist ein `422` für die ganze Anfrage, und nichts ändert sich.

### Die History lesen

`GET /api/v1/work-items/APP-25/history` liefert eine Seite von Einträgen, älteste zuerst, einen je Event:

```json
{
  "data": [
    {
      "id": "01m6akyfzw4c5y5a3ckk9r8f1m",
      "type": "work_item.state_changed",
      "actor_id": "01m6akx65qgwfz2m2tz3bpt7st",
      "subject": { "type": "work_item", "id": "01m6akyecnp503vn6jmb8sp249" },
      "project_id": "01m6akx72yptw2aw6n30m5fg0a",
      "changes": {
        "state_id": { "old": "01m6akx71chfjn0xxagbvwdypv", "new": "01m6akx71e3nx5kbgq8zgtbhsw" },
        "resolution_id": { "old": null, "new": "01m6akx5waaqzm6e1q337g4zwp" }
      },
      "states": {
        "old": { "id": "01m6akx71chfjn0xxagbvwdypv", "name": "In Progress", "category": "started" },
        "new": { "id": "01m6akx71e3nx5kbgq8zgtbhsw", "name": "Cancelled", "category": "canceled" }
      },
      "reason": null,
      "via": "api",
      "occurred_at": "2026-11-01T03:55:20.676612Z"
    },
    {
      "type": "work_item.updated",
      "changes": { "title": { "old": "Test", "new": "Zwei Farbvarianten für die Startseite" }, "priority": { "old": "high", "new": "medium" } },
      "…": "…"
    }
  ],
  "links": { "first": null, "last": null, "prev": null, "next": null },
  "meta": { "path": "https://werkbuch.example.com/api/v1/work-items/APP-25/history", "per_page": 100, "next_cursor": null, "prev_cursor": null, "total": 9 }
}
```

Die Typen sind `work_item.created`, `updated`, `state_changed`, `assigned`, `archived`, `restored`, `relation_added`, `relation_removed` und `deleted`, dazu `comment.updated` (mit altem und neuem Text in `changes.body`) und `comment.deleted` (ohne Text). Eine Datei der Dateiliste erscheint als `attachments` mit `{id, filename}`. Eine Property erscheint als `values.<key>`, eine Beschreibung als Tiptap-JSON. Eine Relation nennt das andere Item mit seinem aktuellen Key, wenn du es siehst, und sonst nur `{"label": "…", "hidden": true}`.

### Frühere Keys

Nachdem WEB in SITE umbenannt wurde, geht ein Lesen über den alten Key weiter:

```bash
curl -i https://werkbuch.example.com/api/v1/work-items/WEB-47 -H "Authorization: Bearer <token>"
```

```text
HTTP/2 301
location: https://werkbuch.example.com/api/v1/work-items/SITE-47
cache-control: no-store, private
```

Die Query kommt mit. Änderungen über den alten Key (`PATCH`, `POST`, `DELETE`) wirken direkt auf das Item, ohne Umleitung.
