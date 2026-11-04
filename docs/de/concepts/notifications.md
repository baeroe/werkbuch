# Benachrichtigungen

werkbuch sagt Personen Bescheid, wenn sich etwas an ihrer Arbeit tut: in der **Inbox** der App und, wenn gewünscht, **per Mail**. Listen, Item-Seiten und die Inbox folgen außerdem den Änderungen anderer **live**, ohne Neuladen. Über die API sind Inbox und Einstellungen `GET /api/v1/notifications` und `GET /api/v1/notification-preferences`.

## Wer benachrichtigt wird

| Ereignis | Wer davon erfährt | Mail standardmäßig |
|---|---|---|
| Zugewiesen | Die Person, der das Item jetzt zugewiesen ist, auch wenn das Item zugewiesen angelegt wird | an |
| Erwähnt | Wer in einer Beschreibung, einer Rich-Text-Property oder einem Kommentar neu erwähnt wird, auch beim Bearbeiten eines Kommentars | an |
| Neuer Kommentar | Die Beobachter des Items | an |
| Statuswechsel | Die Beobachter des Items | aus |
| Sonstige Änderungen | Die Beobachter des Items: Titel, Beschreibung, Priorität, Daten, Labels, Properties, Typ, Eltern-Item, Relationen, Dateien und eine Zuweisung an jemand anderen | aus |
| Fällig oder überfällig | Die Person, der ein Item zugewiesen ist, jeden Morgen (siehe [Erinnerungen](#erinnerungen)) | an |
| Neues Item im Projekt | Nur der Lead des Projekts | aus |
| Vorlage fehlgeschlagen | Kommt mit den Vorlagen (eine spätere Phase) | aus |
| Webhook abgeschaltet | Org-Admins; kommt mit den Webhooks (eine spätere Phase) | aus |

Wer ein Item beobachtet, steht unter [Work Items](/de/concepts/work-items#beobachten). Dazu gilt:

- **Der Lead** eines Projekts zählt als Beobachter jedes Items des Projekts, außer er hat dieses Item abbestellt.
- **Wer ein Item abbestellt hat,** erfährt davon nur, wenn er darin erwähnt wird oder es ihm zugewiesen wird.
- **Nie die Person, die die Änderung gemacht hat**, auch nicht über eine Erwähnung oder Zuweisung an sich selbst. Nie Bots, deaktivierte Konten oder Konten, die das Projekt nicht mehr sehen.
- **Ein Eintrag je Person und Änderung.** Treffen mehrere Ereignisse zusammen (du wirst in einem Kommentar zu einem Item erwähnt, das du beobachtest), bekommst du das stärkste: erwähnt, dann zugewiesen, dann Kommentar, Statuswechsel, sonstige Änderungen, fällig, neues Item. Sind für das stärkste bei dir beide Kanäle aus, zählt das nächste.
- **Keine Benachrichtigung** für Archivieren, Wiederherstellen oder Löschen eines Items, für Beobachten, Reaktionen, einen gelöschten Kommentar oder eine Änderung der manuellen Reihenfolge. Bekommen Items durch einen Workflow-Wechsel einen anderen Status, wird auch niemand benachrichtigt; die History des Items zeigt den Zug.

Der Zugriff wird dreimal geprüft: wenn die Benachrichtigung entsteht, wenn du sie liest und wenn eine Mail rausgeht. Wer den Zugriff auf ein Projekt verliert, sieht ab dann keine seiner Benachrichtigungen mehr, auch die alten nicht; mit dem Zugriff kommen sie zurück. Eine Benachrichtigung geht mit ihrem Item und ihrem Projekt, wenn sie gelöscht werden.

## Kanäle und Standardwerte

Jede Person wählt je Ereignis, wo sie davon erfährt, in ihren persönlichen Einstellungen unter **Benachrichtigungen** (`/me/notifications`): **In-App** (die Inbox) und **E-Mail**. Die Inbox ist für jedes Ereignis an, Mail für zugewiesen, erwähnt, neuer Kommentar sowie fällig oder überfällig. **Standardwerte** stellt alles zurück. Hat die Instanz keinen Mailserver, ist die Spalte **E-Mail** gesperrt, und die gespeicherte Wahl bleibt für später stehen.

Bots haben keine Inbox und keine Einstellungen; sie bekommen nie Benachrichtigungen.

## Inbox

Die Inbox (`/inbox`, <kbd>G</kbd> <kbd>I</kbd>) gruppiert die Benachrichtigungen nach Item, die neuesten zuerst, und zeigt die neuesten 50; ältere rücken nach, sobald du neuere löschst. Jede Zeile sagt, wer was getan hat, mit einem kurzen Auszug aus dem Kommentar oder der Beschreibung, in der du erwähnt wurdest, und wann. Das Badge neben **Inbox** in der Seitenleiste, der eingeklappten Seitenleiste und der Leiste am Handy zählt die ungelesenen Benachrichtigungen und folgt ihnen live.

- **Filter:** **Ungelesen** und **Erwähnungen**, auch zusammen; sie stehen in der Adresse.
- **Öffnen liest.** Ein Klick auf eine Zeile oder <kbd>↵</kbd> öffnet das Item in der Vorschau und markiert die Benachrichtigung als gelesen; ein Klick mit <kbd>⌘ / Strg</kbd> oder der mittleren Taste öffnet es in einem neuen Tab und liest sie ebenfalls. Eine Benachrichtigung ohne Item öffnet ihre Seite. **Als ungelesen markieren** (<kbd>U</kbd>) nimmt das zurück.
- **Alle als gelesen markieren** (<kbd>⇧E</kbd>) liest, was der Filter **Erwähnungen** übrig lässt: mit dem Filter nur die Erwähnungen.
- **Löschen** (<kbd>#</kbd>) entfernt eine Benachrichtigung; 5 Sekunden lang holt **Rückgängig** (<kbd>⌘ / Strg</kbd>+<kbd>Z</kbd>) sie zurück.
- **Tasten:** <kbd>J</kbd> und <kbd>K</kbd> (oder <kbd>↓</kbd> und <kbd>↑</kbd>) wandern zwischen den Zeilen, <kbd>E</kbd> markiert als gelesen, <kbd>U</kbd> als ungelesen, die <kbd>Leertaste</kbd> öffnet die Vorschau. Alle Tasten stehen auf der [Tastatur-Seite](/de/keyboard). Auf einem Touchscreen hat jede Zeile ein Menü mit denselben Aktionen.

Ein Auszug kommt immer aus dem aktuellen Text: ein bearbeiteter Kommentar zeigt seine neue Fassung, ein gelöschter keine. Ein Verweis auf ein Item, das du nicht siehst, liest sich als verborgen. Gibt es das Item einer Benachrichtigung nicht mehr, sagt ihre Karte „Nicht mehr verfügbar“.

## Mail

- **Gesammelt.** Benachrichtigungen zu einem Item werden `NOTIFICATION_MAIL_DELAY` Minuten gesammelt (standardmäßig 5) und gehen dann als eine Mail je Person und Item raus, die älteste zuerst. Der Betreff ist `[WEB-47] Titel des Items`, der Fuß verlinkt die Einstellungen der Benachrichtigungen.
- **In deiner Sprache,** der Sprache deines Profils, sonst der der Organisation; Zeiten in deiner Zeitzone.
- **Kommentare und Erwähnungen** kommen mit ihrem aktuellen Text. Links bleiben Links, Bilder und Dateien erscheinen als Links zu werkbuch; eine Mail hat nie Anhänge oder eingebettete Bilder. Ein langer Text wird mit **Weiterlesen** gekürzt.
- **Beim Senden geprüft.** Kurz bevor die Mail rausgeht, prüft werkbuch jede Zeile noch einmal: das Konto ist aktiv, es sieht das Projekt noch, das Item gibt es, die Benachrichtigung ist noch ungelesen und Mail ist für das Ereignis noch an. Was du inzwischen in der Inbox gelesen hast, wird nicht gemailt. Bleibt nichts übrig, geht keine Mail raus.
- **Ohne Mailserver** (`MAIL_MAILER` `log` oder `array`) gibt es keine Benachrichtigungsmails, nur die Inbox, und es kommen auch keine nach, wenn später ein Mailserver eingerichtet wird.
- **Scheitert der Mailserver,** versucht werkbuch es erneut (nach 1, 5, 15 und 30 Minuten, und der Scheduler gibt eine Mail erst erneut an die Queue, wenn 35 Minuten lang nichts sie versucht hat: ihr Job ging verloren). Eine Mail, die 24 Stunden nach ihrer Fälligkeit noch scheitert, wird aufgegeben und im Log gemeldet. Ein Absturz genau zwischen Mailserver und Datenbank kann eine Mail doppelt schicken; verloren geht so keine.

`php artisan app:send-notification-mails --now` schickt jede offene Sammlung sofort, etwa vor einer Wartung.

## Erinnerungen

Jeden Morgen um 08:00 in deiner Zeitzone (der deines Profils, sonst der der Organisation) erinnert werkbuch an jedes dir zugewiesene Item, dessen Due-Date heute (**fällig**) oder früher (**überfällig**) ist, gezählt in deinem eigenen Kalender. Das geschieht jeden Tag, solange das Item offen ist. Geschlossene und archivierte Items und Items archivierter Projekte bleiben außen vor. Jedes Item ist eine Benachrichtigung in der Inbox; die Mail fasst alle Erinnerungen des Tages in einer Mail zusammen („Deine fälligen und überfälligen Items“).

Der Scheduler startet die Erinnerungen jede Stunde, für alle, bei denen es gerade 08:00 ist, auch in Zeitzonen mit halben Stunden und an den Tagen der Zeitumstellung.

## Aufräumen

Gelesene Benachrichtigungen werden nach 90 Tagen gelöscht; ungelesene bleiben. Gesammelte Mails werden 90 Tage nach dem Versand gelöscht; Benachrichtigungen, die du nur per Mail bekommst, zwei Tage nach ihrer Mail. Eine Erinnerungs-Stunde, die mehr als einen Tag zurückliegt, erinnert niemanden. Der Scheduler räumt stündlich auf.

## Live-Updates

Listen, Boards, Tabellen und Timelines, die Item-Seite und die Vorschau (Felder, Kommentare, Reaktionen, History), die Liste der Projekte und ihrer Mitglieder sowie die Inbox mit ihrem Badge folgen den Änderungen anderer live. Eine Nachricht sagt nur, was sich geändert hat (IDs und die Art der Änderung, nie einen Titel, einen Text oder einen Wert); der Browser lädt den neuen Stand dann über die API, die deinen Zugriff prüft. Änderungen an Katalogen, Views, Konten und Favoriten erscheinen, wenn eine Seite das nächste Mal lädt.

- **Eigene Änderungen** werden nicht doppelt angewendet: der Tab, der eine Änderung gemacht hat, bekommt sie nicht zurück, deine anderen Tabs schon.
- **Zugriff verloren heißt getrennt.** Wirst du aus einem Projekt entfernt, wird ein Projekt privat, geht deine Org-Rolle von Admin zu Member oder wird dein Konto deaktiviert, schließt werkbuch deine Live-Verbindungen. Der Browser verbindet neu und fragt jeden Kanal neu an; ein Projekt, das du nicht mehr siehst, wird abgelehnt, und seine Listen und Seiten laden neu und zeigen, was du noch sehen darfst.
- **Keine Verbindung.** Hat der Browser 3 Sekunden lang keine Verbindung, sagt ein Banner „Live-Updates pausiert“ mit **Neu laden**. Kommt die Verbindung zurück, laden die Seiten, was sie verpasst haben.

Live-Updates laufen über [Reverb](https://reverb.laravel.com) mit WebSockets. Der Browser verbindet sich mit `REVERB_HOST`, `REVERB_PORT` und `REVERB_SCHEME`, die er zur Laufzeit von der Seite bekommt; Reverb selbst hört auf `REVERB_SERVER_HOST` und `REVERB_SERVER_PORT`. Ein Reverse Proxy vor werkbuch muss WebSockets durchlassen (in Nginx Proxy Manager der Schalter „Websockets Support“), sonst bleibt das Banner. Ein Queue-Worker muss auf die Queue `live` hören. Erreicht eine Meldung Reverb nicht, schickt werkbuch 30 Sekunden lang keine und versucht es nicht erneut (das Log bekommt den Fehler höchstens alle 10 Minuten); die Browser laden nach, was sie verpasst haben, sobald sie wieder verbunden sind. Ohne Reverb (`BROADCAST_CONNECTION` nicht `reverb`) verbindet der Browser nicht und zeigt kein Banner; Seiten ziehen dann nach, wenn sie das nächste Mal laden. Live-Updates gehören zur Sitzung der Oberfläche; REST- und MCP-Clients erfahren von Änderungen über Webhooks (eine spätere Phase).

## REST

Inbox und Einstellungen gehören dem Konto des Tokens: Lesen braucht `read`, alles andere `write`.

| Endpunkt | Bedeutung |
|---|---|
| `GET /api/v1/notifications` | Die Inbox, die neuesten zuerst, in Seiten (`cursor`, `per_page` 1–100). `unread_only=1` und `mentions_only=1` filtern. |
| `POST /api/v1/notifications/read` | `{"ids": [...]}` (1 bis 100) oder `{"all": true}`, mit `"mentions_only": true` nur die Erwähnungen. Antwortet `{"updated": n}`. |
| `POST /api/v1/notifications/unread` | `{"ids": [...]}`; antwortet `{"updated": n}`. |
| `DELETE /api/v1/notifications/{id}` | Löscht eine Benachrichtigung; `204`. |
| `GET /api/v1/notification-preferences` | Die Einstellungen: je Ereignis erst `inbox`, dann `mail`. |
| `PUT /api/v1/notification-preferences` | `{"preferences": [{"event", "channel", "enabled"}, ...]}`; ausgelassene Zeilen bleiben. Antwortet mit der ganzen Liste. |

```bash
curl -H "Authorization: Bearer <token>" \
  "https://werkbuch.example.com/api/v1/notifications?unread_only=1&per_page=20"
```

```json
{
  "data": [
    {
      "id": "01m6b2q7k9x3c5v8n1r4t6y0wz",
      "user_id": "01m6akw3f8p2d7s9q4h6j1k5mn",
      "event": "mentioned",
      "event_id": "01m6b2q7h2m8d4f6g9k1p3s5tv",
      "project_id": "01m6akx0c4e7h2j5m8n1q3s6vw",
      "work_item_id": "01m6akyecnp503vn6jmb8sp249",
      "actor_id": "01m6akw3g1r5t8v2x4z7b9d3fh",
      "data": { "source": "comment", "comment_id": "01m6b2q7g5k8n2q4s7v9x1z3bd" },
      "excerpt": "@Mara Lindqvist kannst du das zweite Absenden am Handy prüfen?",
      "read_at": null,
      "mailed_at": null,
      "created_at": "2026-11-04T08:12:31.204517Z",
      "item": { "id": "01m6akyecnp503vn6jmb8sp249", "key": "WEB-47", "title": "Kontaktformular sendet doppelt", "…": "…" }
    }
  ],
  "links": { "…": "…" },
  "meta": { "per_page": 20, "next_cursor": null, "total": 1, "…": "…" }
}
```

`event` ist eins von `assigned`, `mentioned`, `comment`, `state_changed`, `item_changed`, `due`, `item_created`, `template_run_failed`, `webhook_disabled`. `data` enthält nur IDs und Namen von Feldern: `{source, comment_id}` bei einer Erwähnung, `{comment_id}` bei einem Kommentar, `{from, to}` (die Status, wie sie damals hießen) bei einem Statuswechsel, `{fields}` bei sonstigen Änderungen, `{due_date, overdue}` bei einer Erinnerung. `mailed_at` ist der Zeitpunkt, zu dem die Mail mit dieser Benachrichtigung rausging, `item` das Item in der kurzen Form der Listen.

Eine Benachrichtigung als gelesen markieren, oder alle Erwähnungen auf einmal:

```bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"ids": ["01m6b2q7k9x3c5v8n1r4t6y0wz"]}' \
  https://werkbuch.example.com/api/v1/notifications/read

curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"all": true, "mentions_only": true}' \
  https://werkbuch.example.com/api/v1/notifications/read
```

Die Mails zu neuen Kommentaren ausschalten:

```bash
curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"preferences": [{"event": "comment", "channel": "mail", "enabled": false}]}' \
  https://werkbuch.example.com/api/v1/notification-preferences
```

IDs anderer Konten, Benachrichtigungen, die du nicht mehr siehst, und unbekannte IDs werden übergangen (`updated` zählt nur, was sich geändert hat); eine davon zu löschen ist ein `404`. `ids` und `all` zusammen oder eine Zeile mit unbekanntem `event` oder `channel` sind ein `422` mit allen Fehlern auf einmal. Bots lesen eine leere Inbox und leere Einstellungen; Einstellungen ändern ist für sie ein `403`. Lesen, Markieren und Löschen schreiben keine History.

## System-Seite

Org-Admins finden den Zustand der Instanz in den Einstellungen der Organisation unter **System** (`/settings/system`):

- **Version** von werkbuch.
- **Queues:** der Rückstand je Queue und seit wann ihr ältester Job wartet. Jobs, die erst später laufen sollen, etwa gesammelte Mails, zählen getrennt als geplant und sind kein Rückstand.
- **Fehlgeschlagene Jobs:** die neuesten 50 mit Queue, Job, Fehler und Zeit; **Alle erneut versuchen** legt sie zurück in ihre Queue.
- **Suche:** ob Meilisearch antwortet, mit den offenen Aufgaben und den in den letzten 24 Stunden gescheiterten.
- **E-Mail:** ob ein Mailserver eingerichtet ist, und eine **Testmail** an deine eigene Adresse, die sofort rausgeht und den Fehler des Mailservers zeigt, wenn sie scheitert.
- **Live-Updates:** läuft, nicht erreichbar oder aus.

Über die API: `GET /api/v1/system`, `POST /api/v1/system/failed-jobs/retry` (optional `{"ids": [...]}`, antwortet `{"retried": n}`) und `POST /api/v1/system/test-mail` (antwortet `{"sent_to": "…"}`; `409` mit `reason: mail_not_configured` ohne Mailserver, `503` mit `reason: mail_failed`, wenn der Server ablehnt). Members und Bots bekommen ein `403`.
