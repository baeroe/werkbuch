# Typen und Properties

Typen, Properties, Labels, Relationstypen und Resolutions sind die Kataloge der Organisation. Org-Admins pflegen sie unter **Einstellungen** in der Gruppe **Kataloge**; alle anderen können sie dort lesen, und Projekte wählen aus ihnen. Namen sind in jedem Katalog eindeutig, ohne Rücksicht auf Groß- und Kleinschreibung.

## Typen

Jedes Work Item hat einen Typ, etwa Task oder Bug. werkbuch liefert drei mit: **Task**, **Bug** (mit der optionalen Property „Aufwand (h)“) und **Epic**. Weitere legst du unter **Einstellungen → Typen** an.

Ein Typ hat:

- einen **Namen** (bis 60 Zeichen) und eine **Beschreibung**,
- ein **Icon** aus einer festen Liste von 20 (`square-check`, `bug`, `zap`, `layers`, `file-text`, `rocket` und weitere),
- eine **Farbe**, einen von sechs Tönen: Himmel, Ocker, Moos, Pflaume, Sand und Schiefer,
- das Häkchen **Epic**: Items eines Epic-Typs erscheinen in der Timeline und können Kind-Items haben,
- seine **Properties**, jede Pflicht oder nicht, in der Reihenfolge, die du ihnen gibst.

### Archivieren statt löschen

Ein archivierter Typ nimmt keine neuen Items an. Projekte, die ihn aktiviert haben, behalten ihn, aber kein Projekt kann ihn neu aktivieren, und er kann nicht Standardtyp werden. **Wiederherstellen** holt ihn zurück.

Ein Typ, der Standardtyp eines Projekts ist, lässt sich weder archivieren noch löschen; wähle in diesen Projekten zuerst einen anderen Standardtyp. Die Oberfläche und die API (`409`, `reason: default_type`) nennen sie. Löschen nimmt einen Typ aus jedem Projekt, das ihn aktiviert hatte. Sobald es Work Items gibt, wird ein Typ, den noch Items tragen, archiviert statt gelöscht.

### Die Typen eines Projekts

Jedes Projekt aktiviert die Typen, die es nutzt, und wählt einen davon als **Standardtyp** für neue Items. Projekt-Admins tun das unter **Projekteinstellungen → Typen**. Mindestens ein aktiver Typ bleibt aktiviert, und der Standardtyp ist aktiviert und aktiv.

Ein neues Projekt bekommt alle aktiven Typen, der erste ist der Standard, außer du wählst im Dialog anders; dort wird der oberste angehakte Typ der Standard.

## Properties

Eine Property ist ein Feld, das Typen ihren Items über die Kernfelder hinaus geben, die jedes Item hat. Properties gehören der Organisation und werden unter **Einstellungen → Typen** den Typen zugeordnet. Eine Property hat ein Label (bis 60 Zeichen), einen Hilfetext (bis 500), einen Schlüssel, einen Feldtyp und optional einen Standardwert.

### Schlüssel

Der Schlüssel nennt die Property in der API und später in MCP und Filtern. Er ist `snake_case`: Kleinbuchstaben, Ziffern und `_`, vorn ein Buchstabe, höchstens 40 Zeichen. Er ist eindeutig und **lässt sich nicht ändern**, sobald die Property gespeichert ist. Er darf nicht der Name eines Kernfelds sein: `id`, `key`, `project`, `type`, `title`, `description`, `state`, `state_category`, `resolution`, `assignee`, `priority`, `label`, `labels`, `start_date`, `due_date`, `parent`, `created_by`, `created_at`, `updated_at`, `started_at`, `closed_at`, `archived`, `archived_at` und `rank` sind vergeben.

### Feldtypen

Auch der Feldtyp ist fest. Erlaubt ist nur der Wechsel von Einfach- auf Mehrfachauswahl (bei Dropdowns und der Personenauswahl), nie zurück, denn Items verlören sonst alle Werte bis auf einen.

| Feldtyp | Wert | Einstellungen | Standardwert |
|---|---|---|---|
| Text (`text`) | Eine Zeile, bis 255 Zeichen. | – | Ein Text; leer heißt keiner. |
| Zahl (`number`) | Eine Dezimalzahl. | 0 bis 4 Nachkommastellen. | Eine Zahl, auf die Nachkommastellen gerundet. |
| Dropdown (`dropdown`) | Eine oder mehrere Optionen aus einer Liste. | Mehrfachauswahl; die Optionen. | Eine nicht archivierte Option, bei Mehrfachauswahl mehrere. |
| Ja oder nein (`boolean`) | Ein Schalter. | – | Ja oder nein; nein gilt wie kein Standardwert. |
| Datum (`date`) | Ein Datum ohne Uhrzeit. | – | Ein Datum (`2026-10-31`). |
| Personenauswahl (`member`) | Personen oder Bots mit Zugriff auf das Projekt. | Mehrfachauswahl. | Keiner. |
| Rich Text (`rich_text`) | Formatierter Text im selben Editor wie die Beschreibung. | – | Keiner. |
| URL (`url`) | Eine Adresse mit http oder https. | – | Eine Adresse mit http oder https. |

### Optionen

Ein Dropdown hat mindestens eine aktive Option. Eine Option hat ein Label (bis 60 Zeichen), einen Ton und einen Platz in der Reihenfolge; ein Dropdown hat höchstens 100. Eine Option, die du nicht mehr anbieten willst, lässt sich **archivieren**: Für neue Werte steht sie nicht mehr zur Wahl, und du kannst sie wiederherstellen. In der Oberfläche lässt sich eine gespeicherte Option nur archivieren; über die API wird eine Option gelöscht, die in einem `PUT` fehlt.

## Labels

Labels markieren Items über alle Projekte hinweg, etwa „UX“ oder „Formulare“. Ein Label hat einen Namen (bis 60 Zeichen) und einen Ton. Ein Standard-Label gibt es nicht.

## Relationstypen

Ein Relationstyp benennt die Verbindung zwischen zwei Items. Er hat einen Namen und für jede Richtung eine Beschriftung, etwa „blockiert“ und „wird blockiert von“, oder er ist **symmetrisch** und heißt in beide Richtungen gleich, etwa „verwandt mit“.

werkbuch liefert drei mit: **blockiert** (andersherum „wird blockiert von“), **Duplikat** und **verwandt** (symmetrisch). Sie lassen sich umbenennen, aber nicht löschen. Nur „blockiert“ wird etwas auslösen, sobald es Work Items gibt: Solange der Blocker offen ist, zeigt das blockierte Item einen Hinweis. Eigene Relationstypen sind reine Beschriftung.

## Resolutions

Eine Resolution sagt, wie ein geschlossenes Item ausgegangen ist. Ein Item, das in einen Status der Kategorie Completed oder Canceled wechselt, bekommt eine: die, die du wählst, sonst den Standard der Kategorie. werkbuch liefert **Done** (Standard für Completed), **Won't do** (Standard für Canceled), **Duplicate** und **Cannot reproduce** mit, in dieser Reihenfolge.

Jede der beiden Kategorien hat immer genau einen Standard. Wird eine Resolution Standard einer Kategorie, verliert die bisherige die Marke; um den Standard zu wechseln, machst du eine andere Resolution zum Standard. Ein Standard lässt sich weder archivieren noch löschen. Eine archivierte Resolution steht nicht mehr zur Wahl.

## REST

Lesen darf jedes Konto die Kataloge; anlegen, ändern und löschen nur Org-Admins. Listen kommen in Seiten von bis zu 100 (`per_page`, `cursor`), wie jede Liste der API.

| Katalog | Auflisten und anlegen | Ändern und löschen |
|---|---|---|
| Typen | `/api/v1/work-item-types` | `/api/v1/work-item-types/{id}` |
| Properties | `/api/v1/properties` | `/api/v1/properties/{id}` |
| Labels | `/api/v1/labels` | `/api/v1/labels/{id}` |
| Relationstypen | `/api/v1/relation-types` | `/api/v1/relation-types/{id}` |
| Resolutions | `/api/v1/resolutions` | `/api/v1/resolutions/{id}` |

`POST` legt an (`201`), `PUT` ersetzt den ganzen Eintrag: Jedes Feld ist Pflicht außer denen, die leer sein dürfen (Beschreibungen, Hilfetexte, der Standardwert, `inward_label`, `default_for`, `archived_at`), und ein fehlendes ist ein `422` an diesem Feld. Zum Archivieren schickst du einen beliebigen Text in `archived_at` (die Zeit setzt werkbuch selbst); `null` stellt wieder her. Die Typen eines Projekts ändert `PATCH /api/v1/projects/{project}` mit den Feldern `enabled_type_ids` und `default_type_id`.

Eine Dropdown-Property mit zwei Optionen, die erste als Standard. Wie die Status eines Workflows tragen neue Optionen IDs, die du wählst, und werkbuch antwortet mit ULIDs:

```bash
curl -X POST https://werkbuch.example.com/api/v1/properties \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Kanal",
    "key": "channel",
    "field_type": "dropdown",
    "help": "Wo der Beitrag erscheint.",
    "settings": { "multiple": false },
    "options": [
      { "id": "web", "label": "Website", "color": "sky" },
      { "id": "news", "label": "Newsletter", "color": "moss" }
    ],
    "default_value": "web"
  }'
```

```json
{
  "data": {
    "id": "01m68z9k8p6q45xg9r0vx5mc93",
    "key": "channel",
    "label": "Kanal",
    "field_type": "dropdown",
    "help": "Wo der Beitrag erscheint.",
    "default_value": "01m68z9k8p6q45xg9r0vx5mc94",
    "settings": { "multiple": false },
    "options": [
      { "id": "01m68z9k8p6q45xg9r0vx5mc94", "label": "Website", "color": "sky", "position": 0, "archived_at": null },
      { "id": "01m68z9k8qhx241w3mz1fagh3q", "label": "Newsletter", "color": "moss", "position": 1, "archived_at": null }
    ]
  }
}
```

Ein Typ, der sie verlangt:

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-item-types \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Artikel",
    "icon": "file-text",
    "tone": "plum",
    "description": "Ein Beitrag für die Website oder den Newsletter.",
    "is_epic": false,
    "properties": [{ "property_id": "01m68z9k8p6q45xg9r0vx5mc93", "required": true }]
  }'
```

`settings` ist `{"decimals": 0…4}` bei einer Zahl, `{"multiple": true|false}` bei einem Dropdown oder einer Personenauswahl und sonst leer. Löschen antwortet `200` mit `{"outcome": "deleted"}` bei Typen und Resolutions, `{"affected_items": 0}` bei Properties und Labels und `{"affected_relations": 0}` bei Relationstypen; die Zahlen nennen die Items und Relationen, die den Wert verloren haben, sobald es Work Items gibt.
