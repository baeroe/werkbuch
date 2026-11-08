# Vorlagen

Eine Vorlage legt [Work Items](/de/concepts/work-items) mit festen Feldern an: die wöchentliche Wartung, den Monatsbericht, die Checkliste für einen neuen Kunden. Du wendest sie von Hand im Anlegen-Dialog an oder gibst ihr einen Zeitplan, dann legt der Standard-Bot „Automation“ das Item zur eingestellten Zeit an. Jedes Projekt hat eigene Vorlagen unter **Vorlagen** in der Seitenleiste (`/projects/WEB/templates`).

## Eine Vorlage anlegen

**Neue Vorlage** öffnet den Editor. Eine Vorlage hält, was ein Item bekommt:

| Feld | Hinweise |
|---|---|
| Name | Bis 120 Zeichen; so heißt die Vorlage in Listen und im Anlegen-Dialog. Namen müssen nicht eindeutig sein. |
| Typ | Einer der Typen, die im Projekt eingeschaltet sind. |
| Titel | Der Titel des Items, mit [Platzhaltern](#platzhalter) wie `{week}`. Mit dem längsten Wert jedes Platzhalters gefüllt hat er höchstens 255 Zeichen. |
| Beschreibung | [Rich Text](/de/concepts/rich-text) wie in einem Item: `/`, Erwähnungen, Verweise, Bilder und Dateien. |
| Priorität, Assignee, Labels, Eltern-Item | Wie in einem Item; ein Eltern-Item nur bei einem Typ, der eins haben kann (ein Epic des Projekts). |
| Properties | Die Felder des Typs. Ein Pflichtfeld darf beim Speichern leer bleiben (es sagt „Pflichtfeld: Ohne Wert scheitert der Lauf.“); der Lauf scheitert dann, bis es einen Wert hat. |
| Start-Date, Due-Date | Als [Abstand](#start-und-due-date-als-abstand) in Tagen. |

Der Editor speichert nur, wenn du es sagst: **Speichern** oder <kbd>⌘ / Strg</kbd>+<kbd>↵</kbd> (gehaltene Tasten speichern einmal). Wer mit Änderungen geht, wird vorher gefragt. Bearbeiten zwei Personen dieselbe Vorlage, gewinnt die letzte Speicherung: Speichern ersetzt die ganze Vorlage.

Eine Vorlage behält, was sie schon trägt, wenn sich der Katalog ändert: eine archivierte Option, ein archivierter Typ, ein Assignee oder eine Person in einer Personen-Property, die das Projekt verlassen haben, bleiben stehen, und Speichern geht weiter (auch, um einen Zeitplan zu pausieren). Ein gelöschtes Label oder der Wert einer Property, die der Typ nicht mehr hat, fällt beim nächsten Speichern weg. Wie Läufe mit diesen Teilen umgehen, steht unter [Fehler](#fehler-und-protokoll).

## Platzhalter

Der Titel darf Platzhalter enthalten. Jeder Lauf füllt sie mit seinem eigenen Datum, in der Zeitzone der Organisation; von Hand angewendet bekommen sie das Datum von jetzt. **Platzhalter einfügen** neben dem Titel listet sie mit einem Beispiel, und die Vorschau unter dem Titel zeigt den Titel des nächsten Laufs.

| Platzhalter | Bedeutet | Beispiel für Montag, 2. November 2026 |
|---|---|---|
| `{date}` | Der Tag als `YYYY-MM-DD` | `2026-11-02` |
| `{week}` | Die ISO-Kalenderwoche, zweistellig | `45` (Anfang Februar `05`) |
| `{month}` | Der Monat als Zahl, zweistellig | `11` |
| `{month_name}` | Der Name des Monats in der Sprache der Organisation | `November` |
| `{quarter}` | Das Quartal, 1 bis 4 | `4` |
| `{year}` | Das Jahr | `2026` |

Aus `Wartung KW {week}` wird „Wartung KW 45“, aus `Monatsbericht {month_name} {year}` „Monatsbericht November 2026“. Ein Platzhalter, den werkbuch nicht kennt, etwa `{day}`, bleibt Text. Am 31. Dezember 2026 ist `{week}` `53`: Die ISO-Woche eines Tags am Jahreswechsel kann zum anderen Jahr gehören.

## Start- und Due-Date als Abstand

Start- und Due-Date sind Tage nach dem Anlegen des Items: `0` ist derselbe Tag, `2` zwei Tage später, leer heißt kein Datum. Abstände sind ganze Zahlen von 0 bis 3650; das Due-Date darf nicht vor dem Start-Date liegen. Gezählt wird im Kalender der Organisation: Eine Vorlage mit Due-Date `2`, die am Montag läuft, gibt ein Item, das am Mittwoch fällig ist.

## Bilder und Dateien

Bilder und Dateien in der Beschreibung und in Rich-Text-Properties gehören der Vorlage. Bei jedem Anwenden kopiert werkbuch sie: Jedes Item bekommt seine eigene Kopie, die bleibt, wenn die Vorlage geändert oder gelöscht wird. Eine Datei der Vorlage steht im Text des Items, nie in seiner Dateiliste. Kann ein Item nicht angelegt werden, haben seine Kopien keinen Besitzer, und das stündliche Aufräumen entfernt sie nach 24 Stunden.

Wird eine Vorlage gelöscht, geht ein Bild an einen anderen Text des Projekts, der es noch zeigt (ein Item, ein Kommentar, eine Seite oder eine andere Vorlage); der Rest wird mit der Vorlage gelöscht.

## Eine Vorlage anwenden

- **Im Anlegen-Dialog** (<kbd>C</kbd>) füllt das Feld **Vorlage** Typ, Titel (mit den Platzhaltern von jetzt), Beschreibung, Felder und Daten. Vor dem Anlegen kannst du alles ändern. Ein Hinweis unter den Feldern sagt es; sein Knopf **Rückgängig** (mit <kbd>Tab</kbd> der nächste Halt nach dem Feld) bringt zurück, was vorher dastand, bis du den Entwurf änderst. Schreibst du weiter, während die Vorlage lädt, wird sie nicht angewendet, und ein Toast sagt es. **Keine Vorlage** lässt sie los und behält die Felder.
- **In der Befehlspalette** listet **Vorlage anwenden …** die Vorlagen der Projekte, in denen du Items anlegen darfst, und öffnet den Anlegen-Dialog mit der gewählten.

Ein Item aus einer Vorlage merkt sich diese (`template_id`), und seine History sagt „Aus Vorlage „…““, mit dem Namen, den die Vorlage damals hatte. Von Hand angewendet legst du das Item selbst an. Items, auf die ihre Texte per `#` verweisen, werden mit dem neuen Item verknüpft, solange im Projekt [Erwähnte Items verknüpfen](/de/concepts/automations#erwahnte-items-verknupfen) an ist.

## Zeitplan

**Nach Zeitplan anlegen** gibt einer Vorlage einen Zeitplan. Der Editor zeigt ihn als Satz („Jeden ersten Montag im Monat um 09:00“) und listet die **nächsten Termine**, so wie der Server sie rechnet.

### Frequenzen

| Frequenz | Einstellungen |
|---|---|
| Täglich | Alle 1 bis 999 Tage. |
| Wöchentlich | Alle 1 bis 999 Wochen, an einem oder mehreren Wochentagen. Die Wochen zählen ab dem Montag der Woche des Beginns; ohne Wochentag am Wochentag des Beginns. |
| Monatlich | Alle 1 bis 999 Monate, an einem Tag (1 bis 31 oder dem letzten Tag) oder an einem Wochentag des Monats (dem ersten bis vierten oder dem letzten Montag, Dienstag, …). Ein Monat ohne diesen Tag nimmt seinen letzten: Der 31. läuft am 30. April und am 28. oder 29. Februar. |
| Jährlich | Alle 1 bis 999 Jahre, an einem Tag des Jahres. Der 29. Februar läuft in anderen Jahren am 28. Februar. |

### Uhrzeit und Zeitzone

Die Uhrzeit ist eine Tageszeit (`HH:MM`, 24 Stunden) in der Zeitzone der Organisation, die der Editor nennt. Sie bleibt das ganze Jahr dieselbe Uhrzeit: 09:00 ist im Sommer und im Winter 09:00. Eine Uhrzeit, die es nicht gibt, weil die Uhren vorgestellt werden (02:30 am 28. März 2027 in Berlin), läuft um 03:30; eine, die es zweimal gibt, weil die Uhren zurückgestellt werden (02:30 am 25. Oktober 2026), läuft beim ersten Mal.

### Beginn, Ende und Pause

Der Zeitplan beginnt an seinem Starttag (zwischen 2000-01-01 und 2099-12-31). Er endet **nie**, **an einem Datum** (der letzte Lauf ist spätestens an diesem Tag) oder **nach einer Zahl von Läufen** (1 bis 9999). Es zählen die Läufe nach Zeitplan, auch gescheiterte; **Jetzt ausführen** zählt nicht. Ein Zeitplan ohne einen einzigen Termin, etwa einer, der vor seinem ersten Wochentag endet, lässt sich nicht speichern.

**Pausiert** hält den Zeitplan an: keine Items, bis du ihn wieder einschaltest. **Jetzt ausführen** geht weiter. Das Fortsetzen holt nichts nach, was in die Pause fiel.

### Ein Beispiel

Die Vorlage „Monatsbericht“ des Demo-Projekts APP läuft jeden ersten Montag im Monat um 09:00. Am 28. Oktober 2026 gesehen, sind ihre nächsten Termine der 2. November 2026, der 7. Dezember 2026, der 4. Januar 2027, der 1. Februar 2027 und der 1. März 2027, jeweils um 09:00.

## Ausführung

Der Scheduler sucht jede Minute nach fälligen Vorlagen. Ein Lauf legt genau ein Item je Termin an, als Standard-Bot „Automation“, mit dem History-Eintrag „Aus Vorlage „…““.

- **Pünktlich:** Ein Termin läuft in der Minute, in der er fällig wird.
- **Nach einem Ausfall:** Stand der Scheduler (Wartung, Absturz), wird nur der letzte verpasste Termin nachgeholt, einmal. Bei einem Ende nach einer Zahl von Läufen nie über diese Zahl hinaus.
- **Nichts rückwirkend:** Ein Zeitplan zählt ab dem Moment, in dem er gespeichert wurde. Eine neue Vorlage mit einem Beginn in der Vergangenheit legt nichts für die Vergangenheit an; das Speichern eines geänderten Zeitplans, das Fortsetzen nach einer Pause, das Wiederherstellen eines archivierten Projekts und ein Wechsel der Zeitzone der Organisation beginnen den Zeitplan ab diesem Moment neu.
- **Archivierte Projekte** führen keine Vorlagen aus. Ihr Zeitplan beginnt neu, wenn das Projekt wiederhergestellt wird.
- **Zeitzone der Organisation:** Nach einem Wechsel zählen die Termine in der neuen Zeitzone. Kein Termin der alten wird nachgeholt, und kein Tag bekommt ein zweites Item.
- `php artisan app:run-templates --now` führt die fälligen Vorlagen sofort im eigenen Prozess aus, etwa nach einer Wartung; eine Vorlage, die scheitert, wird gemeldet, die übrigen laufen trotzdem.

**Jetzt ausführen** (im Editor oder als Befehl der Palette) legt sofort ein Item aus der gespeicherten Vorlage an: Speichere deine Änderungen vorher. Auch das handelt als Standard-Bot, und das Protokoll nennt, wer gedrückt hat. Es zählt nicht zum Zeitplan: Die Zahl der Läufe, der nächste Termin und ein Ende nach einer Zahl von Läufen bleiben, wie sie sind.

## Fehler und Protokoll

Ein Lauf scheitert, wenn das Item nicht angelegt werden kann: Der Assignee ist nicht mehr im Projekt, der Typ ist ausgeschaltet oder archiviert, eine Pflicht-Property hat keinen Wert, eine archivierte Option ist gesetzt, das Eltern-Item ist weg oder kein Epic, oder der Titel ist länger als 255 Zeichen. Gelöschte Labels und Werte von Properties, die der Typ nicht mehr hat, fallen still weg; sie lassen keinen Lauf scheitern.

Ein gescheiterter Lauf legt nichts an. Die Vorlage bleibt, wie sie ist, und der nächste Termin läuft wie sonst. Der Grund steht in der Sprache der Organisation da, etwa „Pflicht-Property Kunde fehlt“. Der Lead des Projekts und wer die Vorlage angelegt hat, bekommen die Benachrichtigung „Vorlage fehlgeschlagen“ (siehe [Benachrichtigungen](/de/concepts/notifications)); sie führt zur Vorlage. Kann ein Lauf nach Zeitplan auch nach drei Versuchen gar nicht zu Ende kommen, wird er als gescheitert mit „Interner Fehler beim Anlegen des Items“ gebucht, damit der nächste Termin nicht hängen bleibt.

Das **Protokoll** einer Vorlage listet jeden Lauf, den neuesten zuerst: wann, ob nach Zeitplan oder von Hand (mit der Person), und das angelegte Item oder den Grund des Scheiterns. Die Liste der Vorlagen zeigt je Vorlage den Zeitplan als Satz und den nächsten Termin.

## Rechte

- **Member und Admins** des Projekts legen Vorlagen an, ändern, löschen und führen sie aus; Org-Admins in jedem Projekt, Bots nur als Mitglied.
- **Viewer** und Außenstehende eines öffentlichen Projekts lesen die Vorlagen und ihre Protokolle, ohne Editor.
- **Archivierte Projekte** behalten ihre Vorlagen lesbar; Speichern, Löschen und **Jetzt ausführen** werden mit `409 project_archived` abgelehnt, und kein Zeitplan läuft.
- **Gleichzeitig gespeichert:** Wird die Vorlage während **Jetzt ausführen** immer wieder gespeichert, gibt der Lauf nach drei Versuchen auf und antwortet `409 template_changed`; nichts ist angelegt, versuche es noch einmal.
- **Anwenden** im Anlegen-Dialog braucht das Recht, im Projekt der Vorlage Items anzulegen.

## REST

Lesen braucht ein Token mit `read`, Ändern eins mit `write`. Projekte nennst du per ULID, Kennung oder früherer Kennung, Vorlagen und Läufe per ULID. Eine Vorlage oder ein Projekt, das das Konto des Tokens nicht sieht, ist ein `404`; ein Viewer, der etwas ändern will, bekommt `403` mit „Vorlagen verwalten nur Member und Admins des Projekts.“

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/templates` | Die Vorlagen aller Projekte, die das Konto sieht, nach Name; `filter[project_id]=<id>` grenzt auf eins ein (ein Projekt, das du nicht siehst, ergibt eine leere Liste), `filter[scheduled]=1` behält die mit Zeitplan, `?lean=1` lässt die Texte weg. Mit `cursor` und `per_page`. |
| `GET /api/v1/projects/{project}/templates` | Die Vorlagen eines Projekts. |
| `POST /api/v1/projects/{project}/templates` | `201` mit der neuen Vorlage: `name`, `payload`, `schedule` (alle Pflicht, `schedule` darf `null` sein). |
| `GET /api/v1/templates/{template}` | Eine Vorlage. |
| `PUT /api/v1/templates/{template}` | `200`; ersetzt die ganze Vorlage. Die eigene Antwort zurückgeschickt ändert nichts. |
| `DELETE /api/v1/templates/{template}` | `204`. Items aus der Vorlage bleiben. |
| `GET /api/v1/templates/{template}/draft` | Die Felder, die ein Item bekommt, wenn die Vorlage jetzt angewendet wird. |
| `POST /api/v1/templates/preview` | Die nächsten fünf Termine eines Zeitplans und der Titel am ersten davon (ein Lesezugriff, ein Token mit `read` reicht). |
| `POST /api/v1/templates/{template}/run` | Jetzt ausführen: `200` mit `{run, item}`, auch wenn der Lauf scheiterte. |
| `GET /api/v1/templates/{template}/runs` | Das Protokoll, das Neueste zuerst, mit `cursor` und `per_page`. |

### Eine Vorlage anlegen

`payload` hält die Felder des Items. Die Beschreibung kommt als Markdown in `payload.description` oder als Tiptap-JSON in `payload.description_json`, nicht beides; `values` hält die Properties nach ihrem Schlüssel. `schedule` ist `null` oder ein Zeitplan: `frequency` (`daily`, `weekly`, `monthly`, `yearly`), `interval`, das Feld der Frequenz (`weekdays` mit 0 für Sonntag bis 6 für Samstag, `month_day` 1 bis 31 oder `"last"`, `nth_weekday` `{n, weekday}` mit `n` 1 bis 4 oder `-1` für den letzten, `yearly_date` `MM-DD`), `time`, `starts_on`, `ends` (`{"type": "never"}`, `{"type": "on", "date": "…"}` oder `{"type": "count", "count": n}`) und `paused`.

```bash
curl -X POST https://werkbuch.example.com/api/v1/projects/APP/templates \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monatsbericht",
    "payload": {
      "type_id": "01m6akx7247gfm80md352w7wra",
      "title": "Monatsbericht {month_name} {year}",
      "description": "- Stunden\n- offene Items\n- nächste Schritte",
      "priority": "medium",
      "assignee_id": "01m6akx65qgwfz2m2tz3bpt7st",
      "label_ids": [],
      "values": {},
      "parent_id": null,
      "start_offset_days": 0,
      "due_offset_days": 4
    },
    "schedule": {
      "frequency": "monthly",
      "interval": 1,
      "nth_weekday": { "n": 1, "weekday": 1 },
      "time": "09:00",
      "starts_on": "2026-11-01",
      "ends": { "type": "never" },
      "paused": false
    }
  }'
```

Die Antwort (`201`, gekürzt):

```json
{
  "data": {
    "id": "01m6d3t8q4w2e6r0y5v9h3n7pa",
    "project_id": "01m6akx72yptw2aw6n30m5fg0a",
    "name": "Monatsbericht",
    "payload": {
      "title": "Monatsbericht {month_name} {year}",
      "description": "- Stunden\n- offene Items\n- nächste Schritte",
      "description_json": { "type": "doc", "content": ["…"] },
      "due_offset_days": 4,
      "…": "…"
    },
    "schedule": { "frequency": "monthly", "interval": 1, "nth_weekday": { "n": 1, "weekday": 1 }, "time": "09:00", "…": "…" },
    "run_count": 0,
    "last_run_at": null,
    "next_run_at": "2026-11-02T08:00:00.000000Z",
    "created_by": "01m6akx65qgwfz2m2tz3bpt7st"
  }
}
```

`next_run_at` steht in UTC: 09:00 in Berlin ist im Winter 08:00 UTC. Zum Ändern schickst du die Vorlage ganz mit `PUT` zurück, die Beschreibung nur als `description_json`.

### Einen Zeitplan vorschauen

```bash
curl -X POST https://werkbuch.example.com/api/v1/templates/preview \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"schedule": {"frequency": "monthly", "interval": 1, "nth_weekday": {"n": 1, "weekday": 1}, "time": "09:00", "starts_on": "2026-09-01", "ends": {"type": "never"}, "paused": false}, "title": "Monatsbericht {month_name} {year}"}'
```

```json
{
  "data": {
    "runs": [
      "2026-11-02T08:00:00.000000Z",
      "2026-12-07T08:00:00.000000Z",
      "2027-01-04T08:00:00.000000Z",
      "2027-02-01T08:00:00.000000Z",
      "2027-03-01T08:00:00.000000Z"
    ],
    "title": "Monatsbericht November 2026"
  }
}
```

`run_count` (optional) ist die Zahl der bisherigen Läufe, für ein Ende nach einer Zahl von Läufen. Ein pausierter oder beendeter Zeitplan hat keine Termine. Die Monatsnamen kommen in der Sprache der Organisation.

### Eine Vorlage per API anwenden

`GET …/draft` antwortet mit den Feldern des Items, wie sie jetzt wären (`title` mit gefüllten Platzhaltern, `start_date` und `due_date` aus den Abständen, `description_json` mit den Bildern der Vorlage). Schick sie mit `template_id` an `POST /api/v1/work-items`: werkbuch kopiert die Bilder, und das Item merkt sich die Vorlage. Eine `template_id` eines anderen Projekts ist ein `422`.

### Jetzt ausführen

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  https://werkbuch.example.com/api/v1/templates/01m6d3t8q4w2e6r0y5v9h3n7pa/run
```

```json
{
  "data": {
    "run": {
      "id": "01m6d4a1s2d3f4g5h6j7k8m9zx",
      "template_id": "01m6d3t8q4w2e6r0y5v9h3n7pa",
      "scheduled_for": null,
      "ran_at": "2026-11-05T10:12:31.204517Z",
      "status": "created",
      "work_item_id": "01m6d4a1v8b7n6m5c4x3z2q1wa",
      "error": null,
      "triggered_by": "01m6akx65qgwfz2m2tz3bpt7st"
    },
    "item": { "id": "01m6d4a1v8b7n6m5c4x3z2q1wa", "key": "APP-26", "title": "Monatsbericht November 2026", "…": "…" }
  }
}
```

Ein gescheiterter Lauf antwortet ebenfalls `200`, mit `status` `failed`, dem Grund in `error` und `item` `null`. `scheduled_for` ist der Termin eines Laufs nach Zeitplan, `null` bei einem von Hand. `GET …/runs` listet die Läufe in derselben Form.

### Fehler

Eine Vorlage, die sich nicht speichern lässt, antwortet `422` mit allen Feldfehlern auf einmal: `payload.<feld>` (`payload.title` für einen Titel, der zu lang würde, `payload.values.<key>`), `schedule.<feld>` für einen Zeitplan, der sich nicht lesen lässt, und `schedule` für einen ohne einen einzigen Termin („Dieser Zeitplan hat keinen einzigen Termin. Prüfe Beginn, Wochentage und Ende.“).
