# Wiki

Jedes Projekt hat ein Wiki: einen Baum aus Seiten für das, was das Team wissen muss, etwa Absprachen, Abläufe und Technik. Eine Seite hat einen Titel, ein Emoji, einen Text im vollen Editor, wer sie angelegt und wer sie zuletzt geändert hat. Seiten speichern von selbst, behalten ältere Versionen, lassen sich aus Items und Kommentaren verweisen und werden von der Suche gefunden. Live-Kollaboration gibt es nicht: Schreiben zwei Personen gleichzeitig an derselben Seite, bekommen sie einen Konflikt, bei dem niemandes Text verloren geht.

Das Wiki eines Projekts liegt unter `/projects/WEB/wiki`; in der Seitenleiste ist es **Wiki** unter einem Projekt. Ohne offene Seite zeigt es die sechs zuletzt geänderten Seiten.

## Der Baum

Der Baum nennt jede Seite des Projekts: auf breiten Bildschirmen links neben der Seite, auf kleineren auf der Übersicht des Wikis.

- **Anlegen:** **Neue Seite** im Kopf des Wikis (auch in der Befehlspalette) legt eine Seite am Ende der obersten Ebene an und öffnet sie mit markiertem Titel „Neue Seite“, bereit zum Überschreiben. **Unterseite anlegen** unter **Weitere Aktionen** einer Seite legt eine darunter an.
- **Tasten:** Der Baum ist ein Halt für <kbd>Tab</kbd>. <kbd>↑</kbd> und <kbd>↓</kbd> wandern zwischen den Seiten, <kbd>→</kbd> klappt die Unterseiten auf oder geht zur ersten, <kbd>←</kbd> klappt sie zu oder geht zur Eltern-Seite, <kbd>Pos1</kbd> und <kbd>Ende</kbd> springen zur ersten und letzten Seite, <kbd>↵</kbd> öffnet die Seite. Alle Tasten stehen auf der Seite [Tastatur](/de/keyboard).
- **Ziehen:** Mit der Maus wandert eine Seite an ihrem Griff am Anfang der Zeile. Eine Linie zeigt, wo sie landet; weiter nach rechts gezogen kommt sie unter die Seite darüber, nach links eine Ebene höher. Die Unterseiten wandern mit. <kbd>Esc</kbd> bricht ab.
- **Verschieben nach …:** Ohne Maus (und auf Touchscreens) fragt **Weitere Aktionen** → **Verschieben nach …** (auch in der Palette) nach der neuen Eltern-Seite (**Unter**, oder **Oberste Ebene**) und der **Position** unter ihren Seiten (vor einer Seite oder **Am Ende**). Eine Seite kann nie unter sich selbst oder eine ihrer Unterseiten wandern.
- **Löschen:** **Weitere Aktionen** → **Löschen …**, <kbd>⌘ / Strg</kbd>+<kbd>⌫</kbd> auf der Seite oder auf einer Zeile des Baums. werkbuch fragt immer vorher und nennt die Unterseiten, die mitgehen. Danach sind die Seite und ihr ganzer Teilbaum sofort weg, und fünf Sekunden lang holt **Rückgängig** (oder <kbd>⌘ / Strg</kbd>+<kbd>Z</kbd>) sie zurück. Danach sind sie endgültig gelöscht, samt allen Versionen; Bilder, die ein anderer Text des Projekts noch zeigt, bleiben bei diesem Text.

Verschieben ändert den Text einer Seite nicht: Sie behält ihre Version, und wer sie gleichzeitig bearbeitet, bekommt keinen Konflikt.

## Eine Seite bearbeiten

Der Titel ist eine Zeile mit höchstens 200 Zeichen. Das Emoji davor wählst du im Emoji-Picker, und du kannst es wieder entfernen. Der Text nutzt die Stufe „Seite“ des [Editors](/de/concepts/rich-text): Überschriften, Listen, Checklisten, Tabellen, Code, Zitate, waagerechte Linien, Erwähnungen, Verweise, Bilder und Dateien.

- **Gespeichert wird von selbst,** 1,2 Sekunden nachdem du aufhörst zu tippen, wenn du Titel oder Text verlässt, und sofort mit <kbd>⌘ / Strg</kbd>+<kbd>↵</kbd>. Im Kopf der Seite sagt werkbuch **Speichert …**, **Gespeichert** mit der Zeit seitdem oder **Nicht gespeichert**. Scheitert das Speichern, bleibt dein Text, und eine Meldung bietet **Erneut versuchen**.
- **Ein Titel ist Pflicht.** Solange der Titel leer ist, wird nichts gespeichert; verlässt du die Seite mit anderen Änderungen, speichert werkbuch sie unter dem Titel, den die Seite hatte.
- **Bilder und Dateien** fügst du ein, ziehst sie in den Text oder wählst sie mit **Bild oder Datei** im `/`-Menü. Das Speichern wartet, bis ihre Uploads fertig sind.
- **Ungespeicherter Text bleibt** für den Besuch: Er kommt wieder, wenn du die Seite erneut öffnest, und das Verlassen des Browsers fragt vorher, solange welcher übrig ist.
- **Zugriff verloren beim Tippen:** Wird das Projekt archiviert oder ändert sich deine Rolle, während Text ungespeichert ist, wird die Seite schreibgeschützt und zeigt deinen Text darüber mit **Kopieren** und **Verwerfen**. Löscht jemand die Seite, sagt sie „Diese Seite wurde gelöscht“ und behält deinen Text genauso.

Baum und offene Seite folgen den Änderungen anderer live. Eine fremde Speicherung erscheint in deinem Editor nur, solange du nichts getippt hast; sonst trifft deine nächste Speicherung den Konflikt unten.

## Gleichzeitig bearbeiten

Jede Speicherung nennt die Version der Seite, von der sie ausging. Hat inzwischen jemand anderes die Seite gespeichert, speichert werkbuch nichts. Dein Text bleibt im Editor, und ein Banner sagt „Jonas Feld hat die Seite inzwischen geändert.“ mit zwei Möglichkeiten:

- **Neu laden** holt die neue Fassung in den Editor; dein Text wird verworfen. Eine Meldung bietet ein paar Sekunden lang **Rückgängig**, das deinen Text und das Banner zurückholt.
- **Meine Fassung übernehmen** speichert deinen Text über die neue Fassung. Die andere wird vorher als [Version](#versionen) gesichert, es geht also nichts verloren.

Kam die andere Speicherung von dir selbst in einem anderen Fenster, sagt das Banner das. Verlässt du die Seite bei offenem Konflikt, wird nichts gespeichert; eine Meldung sagt das mit **Öffnen**, und das Banner steht wieder da, wenn du zurückkommst. Eine Version wiederherstellen geht erst, wenn der Konflikt gelöst ist.

## Versionen

werkbuch sichert den Stand einer Seite als Version:

- bevor eine Speicherung den Stand ersetzt, den ein anderes Konto gespeichert hat,
- wenn jemand speichert, nachdem die Seite mindestens zehn Minuten geruht hat (gesichert wird der Stand, der geruht hat, nicht jede Pause dazwischen),
- bevor **Meine Fassung übernehmen** die andere Fassung überschreibt, auch wenn es die eigene war,
- bevor eine Version wiederhergestellt wird.

Eine Version behält Titel, Text, wer sie geschrieben hat und wann; das Emoji gehört nicht dazu. **Versionen …** im Kopf der Seite (auch in der Palette) listet sie, die neueste zuerst, die aktuelle markiert; eine gewählte zeigt ihren Titel und Text. **Diese Version wiederherstellen** macht sie zum aktuellen Stand mit neuer Versionsnummer: Der Stand davor bleibt als Version, das Emoji bleibt, Erwähnungen und Verweise der Version bleiben, und ein Bild, das es nicht mehr gibt, fällt heraus. Viewer lesen die Versionen, stellen aber keine wieder her. Versionen gehen nur mit ihrer Seite.

## Verweise und Suche

- `#` in jedem Text eines Projekts bietet Wiki-Seiten unter den Items an. Ein Verweis speichert nur die ULID der Seite; wer ihn liest, sieht das aktuelle Emoji und den aktuellen Titel und kommt über ihn zur Seite. Eine Seite, die der Leser nicht sehen darf, steht als **verborgen** da, ohne Titel. In Markdown ist ein Verweis `[Titel](page:<ulid>)`, in Mails ein Link auf die Seite.
- **Erwähnungen** in einer Seite funktionieren wie in anderen Texten, benachrichtigen aber niemanden: Seiten haben keine Beobachter, und Inbox und Mails gehören zu Work Items.
- **Suche:** Die Befehlspalette findet Seiten über Titel und Text unter **Seiten**, unter den Items (siehe [Suche](/de/search)).
- **Im Item:** Das Item zeigt die Seiten, die auf es verweisen, in einem eigenen Abschnitt **Wiki-Seiten** zwischen Relationen und Dateien, jede als Link auf die Seite mit dem zugehörigen Wiki. Den Abschnitt gibt es nur, wenn mindestens eine Seite auf das Item verweist und du sie sehen darfst; er folgt Änderungen im Wiki. Es zählt nur der aktuelle Text einer Seite, nicht ihre Versionen, und ein Key als einfacher Text ist kein Verweis.
- **Links:** `/projects/WEB/wiki/<ulid>` öffnet eine Seite. Eine Seite eines anderen Projekts führt ins Wiki dieses Projekts, eine frühere Kennung zur aktuellen; eine Seite, die es nicht gibt (oder die du nicht sehen darfst), zeigt „Diese Seite gibt es nicht“, mit dem Baum.

## Rechte

Das Wiki folgt den [Rollen des Projekts](/de/concepts/permissions):

- **Member und Admins** des Projekts legen Seiten an, bearbeiten, verschieben und löschen sie und stellen Versionen wieder her; Org-Admins in jedem Projekt, Bots nur als Mitglied.
- **Viewer** und Außenstehende eines öffentlichen Projekts lesen den Baum, die Seiten und ihre Versionen. Sie sehen keinen Editor, und **Neue Seite** ist gesperrt und sagt warum.
- **Archivierte Projekte** behalten ihr Wiki lesbar und durchsuchbar (die Suche findet seine Seiten nur mit `include_archived`); Anlegen, Speichern, Verschieben, Löschen und Wiederherstellen werden mit `409 project_archived` abgelehnt.
- **Bilder und Dateien** einer Seite bekommt jeder, der das Projekt sieht.

## REST

Lesen braucht ein Token mit `read`, Ändern eins mit `write`. Projekte gehen über ULID, Kennung oder frühere Kennung, Seiten und Versionen über ihre ULID. Eine Seite oder ein Projekt, das das Konto des Tokens nicht sieht, ist ein `404`, wie eins, das es nicht gibt; ein Viewer, der etwas ändern will, bekommt `403` mit dem Grund `forbidden` und „Das Wiki bearbeiten nur Member und Admins des Projekts.“

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/projects/{project}/pages` | Der ganze Baum ohne Text, verschachtelt in `children`, mit `meta.total`. |
| `POST /api/v1/projects/{project}/pages` | `201` mit der neuen Seite: `title` (Pflicht), `emoji`, `content` (Markdown) oder `content_json`, `parent_id`. |
| `GET /api/v1/pages/{page}` | Die Seite mit `content` (Markdown) und `content_json` (Tiptap-JSON). |
| `PATCH /api/v1/pages/{page}` | `200` mit der Seite; `title`, `emoji`, `content` oder `content_json`, `base_version`, `keep_current`. |
| `POST /api/v1/pages/{page}/move` | `200` mit der Seite; `parent_id` und `before_id`. |
| `DELETE /api/v1/pages/{page}` | `200` mit `{"deleted": n}`, der Zahl der mit dem Teilbaum gelöschten Seiten. |
| `GET /api/v1/pages/{page}/versions` | Die Versionen ohne Text, die neueste zuerst, mit `cursor` und `per_page`. |
| `GET /api/v1/pages/{page}/versions/{version}` | Eine Version mit `content` und `content_json`. |
| `POST /api/v1/pages/{page}/versions/{version}/restore` | `200` mit der Seite in ihrem neuen Stand. |
| `GET /api/v1/work-items/{item}/pages` | Die Seiten, deren aktueller Text auf das Item verweist, ohne Text, nach Titel; es zählen nur Seiten, die du siehst, auch in `meta.total`. |

### Den Baum lesen

```bash
curl -H "Authorization: Bearer <token>" \
  https://werkbuch.example.com/api/v1/projects/WEB/pages
```

```json
{
  "data": [
    {
      "id": "01m6c0a1b2c3d4e5f6g7h8j9ka",
      "project_id": "01m6akx72yptw2aw6n30m5fg0a",
      "parent_id": null,
      "rank": "a0",
      "title": "Projekt-Handbuch",
      "emoji": "📘",
      "version": 4,
      "created_by": "01m6akx65qgwfz2m2tz3bpt7st",
      "created_at": "2026-10-12T08:30:00.000000Z",
      "updated_by": "01m6akx65qgwfz2m2tz3bpt7st",
      "updated_at": "2026-10-27T14:05:00.000000Z",
      "children": [
        { "id": "01m6c0a1b2c3d4e5f6g7h8j9kb", "title": "Seitenstruktur", "version": 3, "children": [], "…": "…" }
      ]
    }
  ],
  "meta": { "total": 12 }
}
```

Der Baum wird nicht geblättert: Er kommt immer ganz. Die Seiten einer Ebene stehen in ihrer Reihenfolge; `rank` ist diese Reihenfolge als Schlüssel (bytegenau vergleichen).

### Eine Seite speichern

`PATCH` ändert nur, was du schickst. Schick die gelesene `version` als `base_version` mit, damit ein neuerer Stand eines anderen nicht überschrieben wird:

```bash
curl -X PATCH https://werkbuch.example.com/api/v1/pages/01m6c0a1b2c3d4e5f6g7h8j9kb \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "## Navigation\n\nHöchstens fünf Einträge. Siehe WEB-48.", "base_version": 3}'
```

Die Antwort ist die Seite mit ihrer neuen `version`. Eine Speicherung, die nichts ändert, antwortet mit der Seite, wie sie ist, und behält ihre Version. Hat sich die Seite seit Version 3 geändert, ist die Antwort `409` mit der Seite, wie sie jetzt ist, in `current`, und nichts wird gespeichert:

```json
{
  "type": "urn:werkbuch:problem:page_conflict",
  "title": "Konflikt",
  "status": 409,
  "detail": "Jonas Feld hat die Seite inzwischen geändert.",
  "reason": "page_conflict",
  "current": { "id": "01m6c0a1b2c3d4e5f6g7h8j9kb", "title": "Seitenstruktur", "version": 4, "content": "…", "…": "…" }
}
```

Um deinen Text trotzdem zu behalten, schick ihn erneut mit `"base_version": 4` und `"keep_current": true`: Der Stand aus `current` wird als Version gesichert, bevor deiner ihn ersetzt. Ohne `base_version` gewinnt die letzte Speicherung; der Stand eines anderen Kontos wird trotzdem vorher als Version gesichert.

### Eine Seite verschieben

Beide Felder sind Pflicht. `parent_id` ist die neue Eltern-Seite, `null` die oberste Ebene; `before_id` die Seite, vor die sie kommt, `null` das Ende:

```bash
curl -X POST https://werkbuch.example.com/api/v1/pages/01m6c0a1b2c3d4e5f6g7h8j9kb/move \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"parent_id": null, "before_id": null}'
```

Die Unterseiten wandern mit. Verschieben ändert weder `version` noch `updated_at`.

### Eine Seite löschen

```bash
curl -X DELETE https://werkbuch.example.com/api/v1/pages/01m6c0a1b2c3d4e5f6g7h8j9ka \
  -H "Authorization: Bearer <token>"
```

```json
{ "deleted": 3 }
```

Die Seite geht mit ihrem ganzen Teilbaum und allen Versionen. Über die API gibt es kein Rückgängig.

### Versionen

```bash
curl -H "Authorization: Bearer <token>" \
  https://werkbuch.example.com/api/v1/pages/01m6c0a1b2c3d4e5f6g7h8j9kb/versions
```

```json
{
  "data": [
    {
      "id": "01m6c1v2w3x4y5z6a7b8c9d0ef",
      "page_id": "01m6c0a1b2c3d4e5f6g7h8j9kb",
      "version": 2,
      "title": "Seitenstruktur",
      "author_id": "01m6akx65qgwfz2m2tz3bpt7st",
      "created_at": "2026-10-20T10:30:00.000000Z"
    }
  ],
  "links": { "…": "…" },
  "meta": { "per_page": 100, "next_cursor": null, "total": 2, "…": "…" }
}
```

`GET …/versions/{version}` liefert dazu `content` und `content_json`; `POST …/versions/{version}/restore` macht sie zum aktuellen Stand und antwortet mit der Seite.

### Fehler

Eine Anfrage, die nicht passt, ist ein `422` mit allen Problemen auf einmal:

| Feld | Bedeutung |
|---|---|
| `title` | Leer oder länger als 200 Zeichen. |
| `emoji` | Kein einzelnes Emoji. |
| `content`, `content_json` | Nicht als Rich Text lesbar, zu lang, oder ein Bild bzw. eine Datei, die die Seite nicht nutzen darf (siehe [Rich Text](/de/concepts/rich-text#markdown)). Schick eins von beiden, nie beide. |
| `parent_id` | Keine Seite dieses Projekts, oder die Seite selbst bzw. eine ihrer Unterseiten. |
| `before_id` | Keine Seite auf der Ebene, auf die die Seite kommt. |
| `base_version`, `keep_current` | Keine ganze Zahl ab 1 bzw. kein Wahrheitswert. |

Speichern, Verschieben, Löschen und Wiederherstellen in einem archivierten Projekt ist ein `409` mit dem Grund `project_archived`. Meldungen kommen in der Sprache des Kontos.
