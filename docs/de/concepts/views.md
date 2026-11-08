# Views

Eine View ist eine gespeicherte Liste von [Work Items](/de/concepts/work-items): ein Filter und eine Art, das Gefundene zu zeigen. Views gehören dem ganzen Team und gelten projektübergreifend; das Projekt ist ein Filter wie jeder andere. Jede Person sieht in einer View nur Items aus Projekten, die sie sehen darf; dieselbe View kann Mara also mehr Items zeigen als Ida.

Jede Item-Liste in werkbuch funktioniert gleich, gespeichert oder nicht: **Meine Items**, die Liste eines Projekts und jede View haben die Filterleiste, das Menü **Anzeige** und die vier Layouts. Filtern, Sortieren, Gruppieren und Blättern macht der Server; der Browser zeigt nur, was zurückkommt.

## Views und eingebaute Listen

Vier Listen sind eingebaut und lassen sich nicht löschen:

| Liste | Adresse | Enthält | Beginnt mit |
|---|---|---|---|
| Meine Items: Zugewiesen | `/my-items` | Offene Items, die dir zugewiesen sind | Nach Kategorie gruppiert, nach Priorität sortiert |
| Meine Items: Erstellt | `/created` | Items, die du angelegt hast | Nach Kategorie gruppiert, neueste zuerst |
| Meine Items: Beobachtet | `/subscribed` | Items, die du beobachtest | Nach Kategorie gruppiert, zuletzt geänderte zuerst |
| Projekt | `/projects/WEB` | Die Items des Projekts | Nach Status gruppiert, manuelle Reihenfolge |

Eine eingebaute Liste ist eine View, die nie gespeichert wird. Du kannst sie filtern und ihre Anzeige ändern; als ungespeicherte Änderung zählt nur ein anderer Filter. **Als neue View speichern …** (in der Leiste der ungespeicherten Änderungen oder am Ende von **Anzeige**) macht aus dem, was du siehst, eine View und behält, wofür die Liste steht, als Bedingung: „Projekt ist Website“, „Assignee ist ich“, „Ersteller ist ich“ oder „Beobachtet ist ja“.

Gespeicherte Views stehen unter **Views** (`/views`) und unter `/views/<id>`. Ein Stern legt eine View in die Seitenleiste, in deiner eigenen Reihenfolge; wird eine View gelöscht, verschwindet sie aus allen Seitenleisten.

## Rechte

| Aktion | Wer |
|---|---|
| Eine View lesen | Jedes aktive Konto |
| Eine View anlegen, als neue View speichern, duplizieren | Org-Admins und Org-Member |
| Eine View ändern oder löschen | Wer sie angelegt hat, und Org-Admins |

Eine View hat einen Namen (bis 60 Zeichen), ein Icon (eins aus der Liste im Dialog oder genau ein Emoji), einen Filter und eine Anzeige. **Speichern** ersetzt die ganze View; speichern zwei Personen dieselbe View gleichzeitig, gewinnt die zweite ganz. Wer eine View nicht ändern darf, kann trotzdem mit **Als neue View speichern …** oder **Duplizieren** eine Kopie anlegen.

Ein Filter darf ein Projekt, eine Person oder ein Item nennen, das der Leser nicht sieht. werkbuch behält die Bedingung, wie sie ist, und zeigt sie als „Verborgenes Projekt“, „Unbekannte Person“ und so weiter; sie trifft nur, was der Leser sieht.

## Layouts

`1` bis `4` wechseln zwischen den Layouts; der Schalter steht auch im Kopf jeder Liste. Das Layout gehört zur Anzeige und zu einer gespeicherten View.

### Liste

Items in Gruppen, die sich einklappen lassen, die Felder der Anzeige als Chips hinter dem Titel, Kind-Items eingerückt unter ihrem Epic. Jede Gruppe zeigt die Zahl ihrer Items vom Server und lädt ihre Items seitenweise beim Scrollen; eingeklappte oder weit entfernte Gruppen laden nichts.

### Board

Jede Gruppe ist eine Spalte, leere eingeschlossen. Eine Karte ziehen oder `shift+left` und `shift+right` ändert das gruppierte Feld:

- **Status:** nur entlang der Übergänge des Workflows. Ein Zug, den der Workflow nicht erlaubt, bleibt in seiner Spalte, und ein Toast sagt warum; in einen geschlossenen Status fragt werkbuch nach der Resolution.
- **Kategorie:** Das Item bekommt den ersten Status dieser Kategorie in seinem eigenen Workflow, in den es wechseln darf; gibt es keinen, sagt es der Toast.
- **Priorität** und **Assignee:** der neue Wert; eine Person, die nicht Mitglied des Projekts ist, kann das Item nicht übernehmen.
- **Typ, Projekt, Eltern-Item:** Karten bleiben in ihrer Spalte. **Label:** Ein nach Label gruppiertes Board ist nicht ziehbar, weil ein Item in der Spalte jedes seiner Labels steht.

Die Reihenfolge in einer Spalte folgt der Sortierung der Anzeige. Mit der Sortierung **Manuell** verschieben `alt+up` und `alt+down` oder Ziehen innerhalb der Spalte eine Karte zwischen ihre Nachbarn; mit jeder anderen Sortierung sagt werkbuch, dass die Reihenfolge der Sortierung folgt. Ist zwischen zwei Nachbarn kein Platz mehr, verteilt werkbuch zuerst die Ordnung des Projekts der Karte neu (die Reihenfolge bleibt, die Ränge werden wieder kurz, siehe [Items von Hand ordnen](./work-items.md#items-von-hand-ordnen)) und verschiebt die Karte dann; Züge anderer Karten des Projekts warten darauf. Die Karte bleibt, wo sie war, und ein Toast sagt warum, wenn die beiden Nachbarn zu einem anderen Projekt gehören, wenn in einer Liste mehrerer Projekte die neue Ordnung andere Karten zwischen sie gestellt hat oder wenn die neue Ordnung länger als fünf Sekunden lädt. Einen Zug, den der Server ablehnt, nimmt werkbuch zurück, und die Zahlen der Spalten stimmen wieder. **+** im Kopf einer Spalte legt ein Item an, das zur Spalte passt.

### Tabelle

Eine Zeile je Item, eine Spalte je Feld der Anzeige, Properties eingeschlossen. Der Kopf und die erste Spalte (Key und Titel) bleiben beim Scrollen stehen. Zellen lassen sich direkt ändern: `enter` öffnet den Editor einer Zelle, `escape` schließt ihn. Zellen von Properties, die der Typ des Items nicht hat, zeigen „—“. Projekt, angelegt und geändert lassen sich hier nicht ändern.

### Timeline

Die Timeline zeigt die Epics der Liste (Items eines Typs mit Häkchen „Epic“), nach Projekt gruppiert und nach Start-Date geordnet, egal was Gruppierung und Sortierung der Anzeige sagen. Ein Balken reicht vom Start- bis zum Due-Date und ist nach dem Anteil geschlossener Kind-Items gefüllt. Einen Balken ziehen verschiebt ihn, seine Enden ziehen ändert ein Datum. Epics ohne Daten stehen in der Seitenliste **Ohne Datum**; zieh sie auf die Achse oder nimm **Ab heute einplanen** (zwei Wochen ab heute). Der Zoom (Woche, Monat, Quartal) steht als `?zoom=week` bzw. `?zoom=quarter` in der Adresse; **Heute** scrollt zu heute.

## Gruppierung

| Gruppierung | Gruppen, in dieser Reihenfolge | Leere Gruppen |
|---|---|---|
| Status | Die Reihenfolge des Workflows | Alle Status des Workflows |
| Kategorie | Backlog, Unstarted, Started, Completed, Canceled | Alle fünf |
| Assignee | Personen vor Bots, nach Name; „Nicht zugewiesen“ zuletzt | „Nicht zugewiesen“ immer |
| Priorität | Urgent, High, Medium, Low, None | Alle fünf |
| Typ | Die Reihenfolge des Katalogs | Die aktivierten Typen des einen Projekts, das der Filter nennt, sonst keine |
| Label | Nach Name; „Ohne Label“ zuletzt | „Ohne Label“ immer |
| Projekt | Nach Name | Das eine Projekt, das der Filter nennt |
| Eltern-Item | Nach Key; „Ohne Eltern-Item“ zuletzt | „Ohne Eltern-Item“ immer |
| Keine | Eine Gruppe | — |

Nach Status gruppieren geht nur, solange alle gefundenen Items einen Workflow teilen; sonst gruppiert werkbuch nach Kategorie und sagt es über der Liste. Ein Item mit zwei Labels steht in beiden Label-Gruppen und zählt in der Gesamtzahl einmal.

## Sortierung

| Sortierung | Über die API (`sort.field`) | Reihenfolge (aufsteigend) |
|---|---|---|
| Manuell | `rank` | Die Reihenfolge, die du Items durch Ziehen gibst (Rang) |
| Priorität | `priority` | Urgent zuerst |
| Due-Date, Start-Date | `due_date`, `start_date` | Früheste zuerst |
| Angelegt, geändert | `created_at`, `updated_at` | Älteste zuerst |
| Key | `key` | Kennung des Projekts, dann die Nummer (`WEB-9` vor `WEB-10`) |
| Kategorie | `state_category` | Backlog zuerst |
| Eine Property (Zahl, Datum, Text oder Adresse) | `property:<key>` | Kleinste, früheste oder alphabetisch zuerst |

Items ohne Wert stehen in beiden Richtungen am Ende; gleiche Werte behalten die manuelle Reihenfolge. Texte werden ohne Rücksicht auf Groß- und Kleinschreibung und Akzente verglichen.

<!-- reference:start -->
## Filter

Ein Filter ist eine Liste von Bedingungen, die alle gelten müssen. Jede Bedingung hat ein Feld, einen Operator und bei den meisten Operatoren einen Wert. In der Oberfläche fügt `f` oder **Filter** eine Bedingung hinzu, und `/` sucht im Titel; über die API ist ein Filter überall JSON in derselben Form:

```json
{
  "version": 1,
  "conditions": [
    { "field": "assignee", "op": "is", "value": "me" },
    { "field": "state_category", "op": "in", "value": ["unstarted", "started"] },
    { "field": "due_date", "op": "before", "value": { "relative": "+7d" } },
    { "field": "property:customer", "op": "is", "value": "01m6dd2rc7syc8r8s7q2my2j51" }
  ]
}
```

Ein Filter hat bis zu 50 Bedingungen, eine Liste bis zu 100 Werte, ein Text bis zu 255 Zeichen. Ein unbekanntes Feld, ein Operator, den das Feld nicht kennt, oder ein Wert falscher Form wird abgelehnt (`422` an `filter.conditions.<n>.field`, `.op` bzw. `.value`), nie still übergangen.

### Felder

| Feld | Art | Hinweise |
|---|---|---|
| `project`, `type`, `state`, `created_by` | ID | ULID; `created_by` auch `me` |
| `assignee`, `parent` | ID, darf leer sein | ULID; `assignee` auch `me` |
| `state_category` | Auswahl | `backlog`, `unstarted`, `started`, `completed`, `canceled` |
| `priority` | Auswahl | `urgent`, `high`, `medium`, `low`, `none` |
| `label` | Liste | ULIDs von Labels |
| `start_date`, `due_date` | Tag | `due_date` auch `overdue` |
| `created_at`, `updated_at`, `closed_at` | Zeitpunkt | Verglichen wird der Tag; `closed_at` darf leer sein |
| `has_children`, `blocked`, `blocking`, `archived`, `epic`, `subscribed` | Ja/Nein | `epic`: ein Typ mit Häkchen „Epic“; `subscribed`: du beobachtest das Item |
| `title` | Text | Nur `contains` |
| `property:<key>` | Nach Feldtyp | Siehe unten |

### Operatoren

| Art | Operatoren |
|---|---|
| ID | `is`, `is_not`, `in`, `not_in`; `is_empty`, `is_not_empty`, wo das Feld leer sein darf |
| Auswahl | `is`, `is_not`, `in`, `not_in` |
| Liste | `is`, `is_not`, `in`, `not_in`, `contains`, `is_empty`, `is_not_empty` |
| Tag | `is`, `before`, `after`, `between`, `is_empty`, `is_not_empty`; `overdue` nur bei `due_date` |
| Zeitpunkt | `is`, `before`, `after`, `between`; `is_empty`, `is_not_empty` nur bei `closed_at` |
| Ja/Nein | `is` |
| Text | `contains`; Text- und Adress-Properties auch `is`, `is_empty`, `is_not_empty` |
| Zahl | `is`, `gt`, `lt`, `between`, `is_empty`, `is_not_empty` |
| Rich Text | `contains`, `is_empty`, `is_not_empty` |

`is` und `is_not` nehmen einen Wert oder eine Liste, `in` und `not_in` eine Liste. Bei einem Listenfeld wie den Labels heißen `is`, `in` und `contains` „hat eines davon“, `is_not` und `not_in` „hat keines davon“. Ein fehlender Wert ist nie gleich, darum treffen `is_not` und `not_in` auch Items ohne Wert. `before` und `after` schließen den Tag selbst aus, `between` nimmt zwei Werte und schließt beide ein. `overdue` nimmt keinen Wert: Das Due-Date liegt vor heute, und das Item steht nicht in einem Status der Kategorie Completed oder Canceled.

### Werte

| Wert | Bedeutung |
|---|---|
| `"me"` | Die Person, die die Liste liest. Nur bei `assignee`, `created_by` und Personen-Properties. |
| `"2026-11-02"` | Ein Tag. |
| `"today"`, `"this_week"`, `"this_month"` | Heute, die laufende Woche, der laufende Monat. |
| `{ "relative": "+7d" }` | Tage oder Wochen ab heute: `-3d`, `+2w`, bis zu fünf Ziffern. |
| `true`, `false` | Für Ja/Nein-Felder. |
| Eine Zahl | Für Zahl-Properties, im Betrag unter 10²⁰. |
| Ein Text | Für `contains` und `is` bei Texten, 1 bis 255 Zeichen. |

Die dynamischen Werte gelten nur, wo das Feld sie nimmt: `"today"` in einer Titelsuche ist das Wort „today“. Bei einem Zeitraum wie `this_week` heißt `is` „darin“, `before` „vor seinem ersten Tag“ und `after` „nach seinem letzten Tag“.

### Daten und Zeitzone

„Heute“, Wochen und Monate zählen in der Zeitzone der Organisation, und Wochen beginnen an dem Wochentag, den sie einstellt. Bei angelegt, geändert und geschlossen vergleicht werkbuch den Tag, auf den der Zeitpunkt in dieser Zeitzone fällt: Ein Item, das um 00:30 Uhr in Berlin angelegt wurde, gilt als an diesem Tag angelegt, auch beim Wechsel zwischen Sommer- und Winterzeit.

### Properties

Die Operatoren einer Property folgen ihrem Feldtyp:

| Feldtyp | Art | Operatoren |
|---|---|---|
| Dropdown, Person (ein Wert) | ID | `is`, `is_not`, `in`, `not_in`, `is_empty`, `is_not_empty` |
| Dropdown, Person (mehrere Werte) | Liste | `is`, `is_not`, `in`, `not_in`, `contains`, `is_empty`, `is_not_empty` |
| Datum | Tag | `is`, `before`, `after`, `between`, `is_empty`, `is_not_empty` |
| Ja/Nein | Ja/Nein | `is` |
| Zahl | Zahl | `is`, `gt`, `lt`, `between`, `is_empty`, `is_not_empty` |
| Text, Adresse | Text | `contains`, `is`, `is_empty`, `is_not_empty` |
| Rich Text | Rich Text | `contains`, `is_empty`, `is_not_empty` |

Eine Bedingung auf eine Property (`property:<key>`) trifft nur Items, deren Typ die Property hat, auch mit `is_empty`, `is_not`, `not_in` und `is false`. Eine Ja/Nein-Property, die nie gesetzt wurde, liest sich als „nein“. Texte werden ohne Rücksicht auf Groß- und Kleinschreibung und Akzente verglichen („uber“ findet „Über“); Rich Text wird in seinem Klartext gesucht. Wird eine Property gelöscht, behält eine gespeicherte View ihre Bedingung; sie trifft dann nichts und zeigt sich als „Unbekanntes Feld“, bis du sie entfernst.

### Archivierte Items

Archivierte Items bleiben aus jeder Liste draußen, außer eine Bedingung auf `archived` fragt nach ihnen oder die Anfrage setzt `include_archived`. Items eines archivierten Projekts erscheinen nur, wo eine `project`-Bedingung mit `is` oder `in` das Projekt nennt: Die Liste eines archivierten Projekts zeigt seine offenen Items, schreibgeschützt.

<!-- reference:end -->

## Zustand in der Adresse

Alles, was du in einer Liste änderst, steht in ihrer Adresse, soweit es von der gespeicherten View oder der eingebauten Liste abweicht: `filter` (die Bedingungen als JSON), `layout`, `group`, `sort` (`due_date:desc`), `fields` (durch Kommas getrennt), `sub` (`0` blendet Kind-Items aus) und in der Timeline `zoom`. Ein Link zeigt jemand anderem dieselbe Liste, und Neuladen behält sie. **Verwerfen** kehrt zum gespeicherten Stand zurück.

## Tastatur

`?` zeigt alle Kürzel, die gerade gelten.

### Listen

| Tasten | Aktion |
|---|---|
| `j`, `k` oder `down`, `up` | Nächstes bzw. voriges Item |
| `shift+j`, `shift+k` oder `shift+down`, `shift+up` | Auswahl erweitern |
| `x` | Item auswählen |
| `shift+x` | Bereich bis zum Item auswählen |
| `mod+a` | Alle auswählen (lädt vorher alle Seiten) |
| `escape` | Auswahl aufheben |
| `enter` | Item öffnen |
| `space` | Vorschau zeigen oder schließen |
| `f` | Bedingung hinzufügen |
| `/` | Nach Titel filtern |
| `1`, `2`, `3`, `4` | Liste, Board, Tabelle, Timeline |

Die Item-Kürzel (`s` Status, `a` zuweisen, `i` mir zuweisen, `p` Priorität, `l` Labels, `t` Typ, `d` Due-Date, `shift+d` Start-Date, `shift+p` Eltern-Item, `mod+backspace` archivieren bzw. löschen) wirken auf die Auswahl, sonst auf das Item unter dem Cursor. Sind mehrere Items ausgewählt, ändert eine Leiste über der Liste Status, Assignee, Priorität und Labels aller auf einmal und archiviert sie, wenn alle geschlossen sind. Eine Aktion gilt für eine Auswahl nur, wenn sie für jedes ausgewählte Item erlaubt ist: Sind einige archiviert oder gehören zu einem Projekt, das du nur liest (oder beim Archivieren noch offen), lässt die Leiste die Aktion weg, die Palette ebenso, und ihr Kürzel sagt warum, ohne etwas zu ändern. `mod+backspace` archiviert eine Auswahl nur, wenn alle Items geschlossen sind, und löscht sie nur, wenn keins geschlossen ist (offene und archivierte gleichermaßen); würde es einige archivieren und andere löschen, passiert nichts, und ein Hinweis sagt warum. Was der Server bei einem Item trotzdem ablehnt, etwa einen Übergang, den sein Workflow verbietet, nennt ein einziger Toast. `e` bearbeitet den Titel nur in der Vorschau und auf der Item-Seite.

Gruppenköpfe sind keine Tab-Stopps: `left` auf einem Item geht zum Kopf seiner Gruppe; auf einem Kopf klappt `left` ein, `right` klappt auf oder geht zum ersten Item, `down` und `up` gehen zum nächsten bzw. vorigen Kopf.

### Board

| Tasten | Aktion |
|---|---|
| `left`, `right` | Spalte links bzw. rechts |
| `j`, `k` oder `down`, `up` | Nächste bzw. vorige Karte in der Spalte |
| `shift+left`, `shift+right` | Karte in die nächste Spalte verschieben, in die sie darf |
| `alt+up`, `alt+down` | Karte nach oben bzw. unten verschieben (nur Sortierung „Manuell“) |
| `escape` beim Ziehen | Ziehen abbrechen |

Die Befehlspalette (`mod+k`) bietet dieselben Züge an, solange sie möglich sind.

### Tabelle

Die Tabelle ist ein Grid mit einem Tab-Stopp:

| Tasten | Aktion |
|---|---|
| `left`, `right` | Vorige bzw. nächste Spalte |
| `up`, `down` | Vorige bzw. nächste Zeile; mit `shift` erweitern sie die Auswahl |
| `home`, `end` | Erste bzw. letzte Spalte; mit `mod` die erste bzw. letzte Zeile |
| `enter` | Editor der Zelle öffnen (in der ersten Spalte: das Item) |
| `escape` | Editor schließen |

`j`, `k`, `x` und `space` wirken wie in der Liste, ebenso die Tasten der Gruppenköpfe.

### Timeline

| Tasten | Aktion |
|---|---|
| `shift+left`, `shift+right` | Epic um eine Einheit des Zooms (Tag, Woche, Monat) früher bzw. später; `shift+right` plant ein Epic ohne Datum ab heute ein |
| `alt+left`, `alt+right` | Epic kürzer bzw. länger machen (sein Due-Date) |

Züge werden nach einer kurzen Pause gespeichert; `escape` beim Ziehen setzt den Balken zurück. Die Befehlspalette (`mod+k`) bietet dieselben Züge an, solange sie möglich sind.

## REST

Lesen braucht ein Token mit `read`. Die drei Anfragen unten, die mit `POST` lesen (`query`, `groups`, `counts`), sind ebenfalls Lesezugriffe: Ein Token mit nur `read` darf sie schicken. Views anlegen, ändern und löschen braucht `write`. Meldungen kommen in der Sprache des Kontos. Tokens, Fehler, Seiten und Grenzen erklärt die Seite [REST-API](/de/api); die Liste der Views nimmt `filter[created_by]`, `filter[name]` und `sort` wie jede Liste dort.

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/work-items` | Eine Seite Items: `view`, `filter[…]` (Kurzform), `sort`, `show_sub_items` (`1` oder `0`, standardmäßig wie die View, sonst `1`), `include_archived`, `lean`, `cursor`, `per_page` |
| `POST /api/v1/work-items/query` | Eine Seite Items für einen Filter im Body |
| `POST /api/v1/work-items/groups` | Die Gruppen einer Gruppierung mit ihren Zahlen |
| `POST /api/v1/work-items/counts` | Zahlen für bis zu 50 benannte Filter |
| `GET`, `POST /api/v1/views` | Die Views, nach Name; `201` mit einer neuen |
| `GET`, `PUT`, `DELETE /api/v1/views/{id}` | Eine View; `PUT` ersetzt sie ganz; `204` |
| `POST /api/v1/favorites/toggle` | `{"kind": "view", "id": "…"}` setzt den Stern einer View oder nimmt ihn weg |

### Eine View lesen

`?view=<id>` liefert die Items einer View: ihren Filter, ihre Sortierung und ob sie Kind-Items zeigt. `filter[…]` engt weiter ein (alle Bedingungen gelten), `sort` ersetzt ihre Sortierung: der API-Name aus [Sortierung](#sortierung), mit `-` davor absteigend (`sort=-due_date`).

```bash
curl -g -H "Authorization: Bearer <Token>" \
  "https://werkbuch.example.com/api/v1/work-items?view=01m6dd2re3zvh9g281chdw9hmv&filter[state_category]=unstarted,started&sort=-due_date&lean=1"
```

Die Kurzform nimmt diese Schlüssel; mehrere Werte stehen durch Kommas getrennt und heißen „einer davon“:

| Schlüssel | Wert |
|---|---|
| `project` | Kennung, frühere Kennung oder ULID; unbekannt oder verborgen ist `404` |
| `parent` | Key oder ULID eines Items; unbekannt oder verborgen ist `404` |
| `q` | Ein Key (`WEB-47`) findet dieses Item, jeder andere Text sucht im Titel |
| `assignee`, `created_by` | ULIDs oder `me`; `none` allein für „niemand“ |
| `type`, `state`, `label` | ULIDs |
| `state_category` | `backlog`, `unstarted`, `started`, `completed`, `canceled` |
| `priority` | `urgent`, `high`, `medium`, `low`, `none` |
| `archived` | `true` oder `false` |

`sort` nimmt ein Feld (`due_date`), ein Feld mit `-` für absteigend (`-due_date`) oder eine Property (`property:effort`). `lean=1` lässt `description`, `description_json` und `values_markdown` weg und macht lange Listen viel kleiner. Jeder andere Schlüssel in `filter[…]` ist ein `422`.

### Mit einem Filter abfragen

`POST /api/v1/work-items/query` nimmt einen Filter im Body. Neben `filter` nimmt es `view_id`, `shorthand` (die Kurzform als Objekt), `q`, `sort` (`{"field", "direction"}`), `show_sub_items`, `group_by` und `group` (eine Gruppe einer Gruppierung, etwa eine Spalte eines Boards), `include_archived`, `lean`, `cursor` und `per_page`. Jeder andere Schlüssel ist ein `422`.

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/query \
  -H "Authorization: Bearer <Token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "version": 1, "conditions": [
      { "field": "assignee", "op": "is", "value": "me" },
      { "field": "due_date", "op": "before", "value": { "relative": "+7d" } },
      { "field": "state_category", "op": "in", "value": ["unstarted", "started"] }
    ] },
    "sort": { "field": "due_date", "direction": "asc" },
    "lean": true,
    "per_page": 50
  }'
```

Die Antwort ist eine Seite wie in jeder Liste, mit den Items in `data`. Einen Filter, der nicht passt, lehnt werkbuch mit allen Problemen auf einmal ab:

```json
{
  "type": "urn:werkbuch:problem:validation_failed",
  "title": "Validierung fehlgeschlagen",
  "status": 422,
  "detail": "Die Eingabe ist nicht gültig.",
  "reason": "validation_failed",
  "errors": {
    "filter.conditions.0.field": ["Dieses Feld gibt es nicht."],
    "filter.conditions.1.op": ["Dieses Feld kennt diesen Operator nicht."]
  }
}
```

### Gruppen

`POST /api/v1/work-items/groups` nimmt `view_id`, `filter`, `q`, `sort`, `show_sub_items`, `include_archived` und `group_by` (Pflicht) und antwortet mit der Gruppierung, die gilt, der Zahl aller Items und den Gruppen in ihrer Reihenfolge:

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/groups \
  -H "Authorization: Bearer <Token>" \
  -H "Content-Type: application/json" \
  -d '{"view_id": "01m6dd2re4m3z0aez8e2qzc19p", "group_by": "state"}'
```

```json
{
  "data": {
    "group_by": "category",
    "total": 3,
    "groups": [
      { "key": "backlog", "count": 1 },
      { "key": "unstarted", "count": 0 },
      { "key": "started", "count": 2 },
      { "key": "completed", "count": 0 },
      { "key": "canceled", "count": 0 }
    ]
  }
}
```

Hier verteilen sich die Items auf mehrere Workflows, also gruppiert der Server nach Kategorie. Die Items einer Gruppe liest `query` mit demselben `group_by` wie in der Antwort und `"group": "<key>"`. Gruppen nach Eltern-Item tragen das Item (`id`, `key`, `title`, `type_id`).

### Zahlen

`POST /api/v1/work-items/counts` zählt bis zu 50 benannte Filter auf einmal. Namen sind 1 bis 64 Buchstaben, Ziffern, `_`, `.`, `:` oder `-`; `include_archived` gilt für alle.

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/counts \
  -H "Authorization: Bearer <Token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "overdue": { "version": 1, "conditions": [{ "field": "due_date", "op": "overdue" }] },
      "mine": { "version": 1, "conditions": [{ "field": "assignee", "op": "is", "value": "me" }] }
    }
  }'
```

```json
{ "data": { "overdue": 10, "mine": 8 } }
```

Gruppen und Zahlen zählen nur, was das Konto des Tokens sieht. Ein Filter auf ein Projekt, das es nicht sieht, zählt `0`, als gäbe es das Projekt nicht.

### Seiten und Cursor

Eine Seite hat bis zu 100 Items (`per_page`, Standard 100); `meta.total` zählt alle, `meta.next_cursor` führt weiter. Bei `GET` folgst du `links.next`: der Link behält die Query (View, Filter, Sortierung, `per_page`). Bei `POST` ist `links.next` `null`: schick dieselbe Anfrage noch einmal mit `meta.next_cursor` als `cursor`; die Sortierung bestimmt die Reihenfolge, Gleichstand entscheiden die manuelle Reihenfolge und die ULID, so kommt jedes Item genau einmal. Ein Cursor gehört zu seiner Sortierung und Gruppe: einer aus einer anderen Liste ist ein `422` an `cursor`, und ein leerer `cursor` beginnt auf der ersten Seite.

### Views verwalten

```bash
curl -X POST https://werkbuch.example.com/api/v1/views \
  -H "Authorization: Bearer <Token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Überfällig bei Nordlicht",
    "icon": "timer",
    "filter": { "version": 1, "conditions": [
      { "field": "property:customer", "op": "is", "value": "01m6dd2rc7syc8r8s7q2my2j51" },
      { "field": "due_date", "op": "overdue" }
    ] },
    "display": {
      "layout": "table",
      "group_by": "assignee",
      "sort": { "field": "due_date", "direction": "asc" },
      "fields": ["key", "title", "state", "assignee", "due_date", "property:customer"],
      "show_sub_items": true
    }
  }'
```

Alle vier Teile sind Pflicht, auch beim `PUT`, das die View ganz ersetzt; eine Antwort unverändert zurückgeschickt ändert nichts. `display` nimmt `layout` (`list`, `board`, `table`, `timeline`), `group_by` (`state`, `category`, `assignee`, `priority`, `type`, `label`, `project`, `parent`, `none`), `sort`, `fields` (bis zu 30: `key`, `title`, `state`, `assignee`, `priority`, `labels`, `start_date`, `due_date`, `project`, `created_at`, `updated_at` und `property:<key>`) und `show_sub_items`.
