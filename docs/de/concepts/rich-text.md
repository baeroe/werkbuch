# Rich Text

Beschreibungen, Rich-Text-Properties und Kommentare sind Rich Text: formatierter Text mit Erwähnungen, Verweisen auf Items, Bildern und Dateien. werkbuch speichert ihn als JSON in der Form des Editors (Tiptap) und liest und schreibt ihn auch als Markdown, damit API und Agenten mit schlichtem Text arbeiten. HTML, das jemand einfügt oder schickt, zeigt werkbuch nie so, wie es kam; dargestellt werden nur die Knoten, die werkbuch kennt.

## Stufen des Editors

Es gibt einen Editor in drei Stufen. Jede Stufe zeigt, was an ihren Ort passt:

| Stufe | Wo | Blöcke |
|---|---|---|
| Kommentar | Kommentare | Text, Listen, Zitate, Code, Links, Erwähnungen, Verweise, Bilder und Dateien |
| Beschreibung | Beschreibungen von Items, Rich-Text-Properties | Dazu Überschriften (drei Ebenen), Checklisten und Tabellen |
| Seite | Wiki-Seiten (spätere Phase) | Dazu Trennlinien; Tabellen im `/`-Menü |

Ein Text mit Blöcken, die seine Stufe nicht kennt (eine Tabelle in einem Kommentar), zeigt deren Text als Absätze. `mod+enter` speichert bzw. sendet; Beschreibung und Rich-Text-Properties speichern außerdem nach einer kurzen Pause und beim Verlassen des Felds von selbst.

## Blöcke und Kürzel

Ein `/` am Zeilenanfang oder nach einem Leerzeichen öffnet das Blockmenü. Tippen grenzt die Liste ein (auch über Wörter wie „todo“ für eine Checkliste), die Pfeiltasten wählen, `enter` oder `tab` macht aus der Zeile den Block, `esc` schließt das Menü. Jeder Eintrag nennt sein Markdown-Kürzel, das auch beim Tippen wirkt:

| Block | Kürzel beim Tippen |
|---|---|
| Überschrift 1 bis 3 | `# `, `## `, `### ` |
| Liste | `- ` |
| Nummerierte Liste | `1. ` |
| Checkliste | `[ ] ` |
| Code | ```` ``` ```` (mit Sprache: ```` ```php ````) |
| Zitat | `> ` |
| Trennlinie (nur Seiten) | `---` |

**Bild oder Datei** im Menü öffnet die Dateiauswahl des Browsers. Code wird für Bash, CSS, Diff, JavaScript, JSON, Markdown, PHP, Python, Shell, SQL, TypeScript, XML und YAML hervorgehoben; ohne Sprache rät werkbuch eine für die Anzeige, der Text bleibt, wie du ihn getippt hast. Fett, kursiv, durchgestrichen, Code im Text und Links gehen mit den üblichen Markdown-Zeichen (`**`, `*`, `~~`, `` ` ``) und Tasten. Links behalten nur `http`, `https` und `mailto`.

## Erwähnungen

`@` öffnet eine Liste der Personen und Bots, die im Projekt erwähnt werden können: seine aktiven Mitglieder und Personen, die Org-Admins sind. Ein Bot nur, wenn er Mitglied des Projekts ist, auch der Standard-Bot. Tippen grenzt die Liste über Name oder Handle ein. Eine Erwähnung zeigt den aktuellen Handle des Kontos, auch nach einer Umbenennung; ein deaktiviertes Konto ist als solches markiert.

Wer erwähnt wird, beobachtet das Item danach, auch wenn er es abbestellt hatte. Ein erwähnter Bot bekommt das Event `bot.mentioned`. Es zählen nur neu Erwähnte: Wer einen Text bearbeitet, in dem eine Erwähnung bleibt, erwähnt niemanden noch einmal, und wer sich selbst erwähnt, zählt nicht. Benachrichtigungen zu Erwähnungen kommen in einer späteren Phase.

Die Erwähnung von jemandem, der im Projekt nicht erwähnt werden kann, etwa weil er es verlassen hat, wird beim Speichern zu Text `@handle`. Eine Erwähnung, die schon im Text stand, bleibt eine Erwähnung.

## Verweise

`#` sucht die Items, die du siehst, mit derselben [Suche](/de/search) wie die Befehlspalette: über den Key (auch einen früheren), den Titel und den Text. Ein Verweis zeigt den Typ und den aktuellen Key des Items, den Titel für Screenreader, und führt beim Lesen zum Item. Wiki-Seiten kommen in einer späteren Phase.

werkbuch speichert nur die ULID des Items, nie Key oder Titel. Wer den Text liest, sieht den Verweis so, wie er darf: Ein Item, das er nicht sieht, steht als **verborgen** da, ohne Key und Titel, in der Oberfläche, in der API und in Mails. Beim Speichern kannst du nur auf Items verweisen, die du siehst; ein Verweis, der schon im Text stand, bleibt, auch auf ein Item, das du nicht siehst.

## Bilder und Dateien

Füge einen Screenshot oder ein im Browser kopiertes Bild ein, ziehe Dateien in den Editor oder wähle sie mit **Bild oder Datei** im `/`-Menü. Jede Datei zeigt beim Hochladen ihren Fortschritt, und du kannst weitertippen. Bilder stehen im Text; ein ausgewähltes Bild bekommt mit `enter` oder einem Doppelklick seinen Alternativtext. Jede andere Datei ist ein Chip mit Name und Größe; ein Klick lädt sie herunter.

- **Formate:** werkbuch erkennt den Typ einer Datei an ihrem Inhalt, nie an ihrem Namen oder an der Angabe des Browsers. Nur PNG, JPEG, GIF, WebP und AVIF erscheinen im Text; alles andere, auch SVG und PDF, kommt als Download (`Content-Security-Policy: sandbox`, `nosniff`). HTML oder Markdown mit der Adresse eines Bilds (`<img src>`, `![](https://…)`) wird nie ein Bild; sein Alternativtext bleibt als Text.
- **Größe:** höchstens `ATTACHMENTS_MAX_MB` je Datei, standardmäßig 25 MB. Eine größere Datei lehnt werkbuch mit `413` ab.
- **Vorschauen:** Für PNG, JPEG und WebP rechnet werkbuch im Hintergrund (Queue `media`) eine Vorschau von höchstens 1600 × 1600 Pixeln; bis sie da ist, zeigt es das Original. GIF behält seine Animation, AVIF erscheint ohne Vorschau.
- **Wer:** Bilder und Dateien in einen Text einfügen darf, wer kommentieren darf, auch Viewer. Die Dateiliste eines Items braucht das Recht, das Item zu ändern (siehe [Work Items](/de/concepts/work-items#dateien)).
- **Wer sie sieht:** Eine Datei bekommt nur, wer das Item (oder das Item des Kommentars) sieht, zu dem sie gehört; für alle anderen ist sie ein `404`, als gäbe es sie nicht.

Ein Upload gehört niemandem, bis der Text gespeichert ist, der ihn nennt; dann gehört er diesem Text. Ein Text darf auch ein Bild eines anderen Texts desselben Projekts zeigen (aus einer Beschreibung in eine andere kopiert); das Bild bleibt bei seinem ersten Text. Ein Bild eines anderen Projekts oder den Upload einer anderen Person, den noch kein Text übernommen hat, kann er nie nennen.

Bilder und Dateien, die aus einem Text verschwinden, bleiben erhalten, damit History und Rückgängig funktionieren. Das [Aufräumen](#aufraumen) entfernt sie später.

## Markdown

Über die API kommt jeder Rich Text in zwei Formen: Markdown (`description`, `body`, `values_markdown`) und Tiptap-JSON (`description_json`, `body_json`, `values`). Geschrieben wird eine der beiden, nie beide. Markdown liest werkbuch als GitHub-Markdown; HTML darin bleibt Text. werkbuch schreibt jeden Knoten in genau einer Form, ein gelesener und unverändert zurückgeschickter Text bleibt also derselbe.

| Was | Markdown |
|---|---|
| Erwähnung | `@mara` |
| Verweis auf ein Item | `WEB-123` |
| Verweis auf ein Item, das der Leser nicht sieht | `[hidden](item:<ulid>)` |
| Verweis auf eine Seite (spätere Phase) | `[Titel](page:<ulid>)` |
| Bild | `![Alternativtext](attachment:<ulid>)` |
| Datei | `[angebot.pdf](attachment:<ulid>)` |

### Schreiben über REST

Für Markdown und JSON gelten dieselben Regeln, geprüft für das Konto, das schreibt:

| Du schreibst | Ergebnis |
|---|---|
| `@handle` eines Kontos, das im Projekt erwähnt werden kann | Eine Erwähnung. |
| `@handle` ohne Zugriff auf das Projekt, unbekannt oder deaktiviert | Bleibt Text. |
| `WEB-123` eines Items, das du siehst (auch mit früherem Key) | Ein Verweis mit dem aktuellen Key. |
| `WEB-123` eines Items, das du nicht siehst oder das es nicht gibt | Bleibt Text; niemand erfährt, ob es das Item gibt. |
| `[hidden](item:<ulid>)`, das schon im Text stand | Bleibt ein Verweis. |
| `[x](item:<ulid>)` eines Items, das du nicht siehst, neu im Text | Bleibt Text: `x`. |
| `[Titel](page:<ulid>)` | Bleibt Text, bis es Wiki-Seiten gibt. |
| `attachment:<ulid>` des Projekts, das ein Text besitzt, oder dein eigener Upload | Ein Bild bzw. eine Datei. |
| `attachment:<ulid>` eines anderen Projekts oder eines fremden Uploads ohne Text | `422` am Feld, das den Text schickte; nichts wird gespeichert. |

In Code-Blöcken, Code im Text, Linktexten und Alternativtexten wird nichts als Erwähnung oder Verweis gelesen: `` `@mara` `` und `[WEB-123](https://example.com)` bleiben, wie sie sind. Ein Backslash hält Text davon ab, eins zu werden: `\@mara`, `WEB\-123`. Schreibt werkbuch Markdown, setzt es diesen Backslash vor Text, der auf dem Rückweg sonst zur Erwähnung oder zum Verweis würde.

## REST

Lesen braucht ein Token mit `read`, Schreiben eins mit `write`. Ein Kommentar oder Anhang eines Items, das du nicht siehst, ist ein `404`.

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/work-items/{item}/comments` | Die Kommentare des Items, älteste zuerst, mit `cursor` und `per_page`. |
| `POST /api/v1/work-items/{item}/comments` | `201` mit dem Kommentar; `body` (Markdown) oder `body_json`. |
| `GET`, `PATCH`, `DELETE /api/v1/comments/{id}` | Der Kommentar; den eigenen ändern; den eigenen löschen (Projekt-Admins und Org-Admins löschen jeden, `204`). |
| `PUT`, `DELETE /api/v1/comments/{id}/reactions` | Eigene Reaktion hinzufügen oder zurücknehmen, `{"emoji": "👍"}`; beides lässt sich wiederholen und antwortet mit dem Kommentar. |
| `POST /api/v1/attachments` | Hochladen (Multipart): `project_id`, `kind` (`inline` für Texte, `file` für die Dateiliste mit `work_item_id`), `file`. `201`. |
| `GET`, `DELETE /api/v1/attachments/{id}` | Die Daten eines Anhangs; ihn löschen (`204`). |
| `GET /attachments/{id}` | Die Datei selbst; `?download=1` immer als Download, `/attachments/{id}/preview` die Vorschau. |
| `GET /api/v1/mentions?project=WEB&q=ma` | Wer im Projekt erwähnt werden kann, beste Treffer zuerst. |
| `GET /api/v1/references?items=<ulid>,<ulid>` | Die Items hinter Verweisen, nur die, die du siehst, ohne zu sagen, welche fehlen. |
| `GET /api/v1/work-items/{item}?include=attachments` | Bettet die Dateiliste des Items ein. |

Die Datei-Route nimmt auch ein Bearer-Token mit `read`, so laden Skripte Dateien herunter. Hochladen geht höchstens 60-mal je Minute und Konto.

### Einen Kommentar schreiben

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/WEB-47/comments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"body": "Auf Staging behoben, @mara schaust du drüber? Gleiche Ursache wie WEB-42.\n\n- Formular sendet einmal\n- Mail kommt einmal"}'
```

Die Antwort (`201`):

```json
{
  "data": {
    "id": "01m6b3h0xq7tn2c5d8e9f4g6hj",
    "work_item_id": "01m6akyecnp503vn6jmb8sp249",
    "author_id": "01m6akx65qgwfz2m2tz3bpt7st",
    "body": "Auf Staging behoben, @mara schaust du drüber? Gleiche Ursache wie WEB-42.\n\n- Formular sendet einmal\n- Mail kommt einmal",
    "body_json": { "type": "doc", "content": ["…"] },
    "created_at": "2026-11-03T09:12:44.318204Z",
    "edited_at": null,
    "reactions": []
  }
}
```

In `body_json` ist `@mara` ein Knoten `{"type": "mention", "attrs": {"id": "<ulid>", "label": "mara", "mentionSuggestionChar": "@"}}` und `WEB-42` ein Knoten `{"type": "reference", "attrs": {"id": "<ulid>", "kind": "item", "label": null, "mentionSuggestionChar": "#"}}`. Eine Änderung (`PATCH` mit `body` oder `body_json`) markiert den Kommentar als bearbeitet; die History behält die frühere Fassung, bis der Kommentar gelöscht wird. Ein Kommentar, der nach den Regeln leer ist, ist ein `422` an `body`.

### Eine Datei hochladen

Erst das Bild hochladen, dann im Text nennen:

```bash
curl -X POST https://werkbuch.example.com/api/v1/attachments \
  -H "Authorization: Bearer <token>" \
  -F project_id=WEB \
  -F kind=inline \
  -F file=@screenshot.png
```

```json
{
  "data": {
    "id": "01m6b3k2r5s8t1v4w7x0y3z6ab",
    "project_id": "01m6akx72yptw2aw6n30m5fg0a",
    "owner": null,
    "kind": "inline",
    "filename": "screenshot.png",
    "mime": "image/png",
    "size": 48213,
    "inline": true,
    "url": "/attachments/01m6b3k2r5s8t1v4w7x0y3z6ab",
    "preview_url": null,
    "uploaded_by": "01m6akx65qgwfz2m2tz3bpt7st",
    "created_at": "2026-11-03T09:14:02.000000Z"
  }
}
```

```bash
curl -X PATCH https://werkbuch.example.com/api/v1/work-items/WEB-47 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"description": "Das zweite Senden sieht man hier:\n\n![Netzwerk-Tab](attachment:01m6b3k2r5s8t1v4w7x0y3z6ab)"}'
```

Ab dann gehört das Bild zur Beschreibung von WEB-47 (`owner` `{"type": "work_item", …}`). Für die Dateiliste eines Items schickst du `kind=file` und `work_item_id=WEB-47`: Die Datei gehört dann sofort dem Item, und seine History nennt sie.

### Fehler

Eine Datei über der Grenze, auch wenn PHP sie schon verworfen hat, bevor werkbuch sie sieht:

```json
{
  "type": "urn:werkbuch:problem:payload_too_large",
  "title": "Anfrage zu groß",
  "status": 413,
  "detail": "Dateien dürfen höchstens 25 MB groß sein.",
  "reason": "payload_too_large"
}
```

Ein Text, der ein Bild eines anderen Projekts oder den Upload einer anderen Person nennt:

```json
{
  "type": "urn:werkbuch:problem:validation_failed",
  "title": "Validierung fehlgeschlagen",
  "status": 422,
  "detail": "Die Eingabe ist nicht gültig.",
  "reason": "validation_failed",
  "errors": { "description": ["Der Text nennt ein Bild oder eine Datei, die er nicht verwenden darf: lade sie in diesem Projekt neu hoch."] }
}
```

Ein Bild oder eine Datei zu löschen, die zu einem Text gehört, ist ein `409` mit `reason: attachment_inline`: Es geht mit seinem Text. Einzeln gelöscht werden nur Dateien der Dateiliste, und nur von jemandem, der das Item ändern darf; eine Datei der Liste, die ein Text des Projekts nennt, verlässt die Liste und bleibt als Datei dieses Texts. Ein Text, der noch ein inzwischen verschwundenes Bild oder eine verschwundene Datei nennt, lässt sich speichern: Das tote Bild bzw. die tote Datei verschwindet dabei aus ihm. Kommentare und Reaktionen an einem archivierten Item oder in einem archivierten Projekt lehnt werkbuch mit `409` ab (`archived`, `project_archived`).

## Aufräumen

Zwei Dinge halten Uploads klein:

- **Uploads, die kein Text übernommen hat** (ein Bild in einem Kommentar, der nie abgeschickt wurde): Ein Job des Schedulers entfernt sie stündlich, sobald sie älter als 24 Stunden sind. Der Browser löscht Uploads nie selbst, denn ein Text kann schon mit ihnen gespeichert sein.
- **Bilder und Dateien, die kein Text mehr nennt:** `php artisan app:prune-attachments --dry-run --min-age=30` listet die Bilder und Dateien, die kein aktueller Text ihres Projekts nennt (Beschreibungen, Rich-Text-Werte, Kommentare) und die älter als das Mindestalter in Tagen sind; ohne `--dry-run` entfernt es sie. Auch Bilder, die nur eine ältere Fassung in der History zeigt, gehen dabei; wähle das Mindestalter danach. Dateien der Dateiliste räumt es nie ab.

Wer ein Item löscht, löscht seine Dateien und die seiner Kommentare, wer einen Kommentar löscht, dessen Dateien, wer ein Projekt löscht, alle; ein Bild, das ein anderer Text des Projekts noch zeigt, bleibt und gehört dann diesem Text. Dateien gehen erst, wenn die Änderung gespeichert ist: Scheitert sie, geht nichts verloren. Mehr unter [Entwicklung](/de/development#wartungsbefehle).
