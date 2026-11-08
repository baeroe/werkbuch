# Automatisierungen

Automatisierungen erledigen kleine, wiederkehrende Schritte eines Projekts für dich. Jedes Projekt hat fünf. Vier sind am Anfang aus, „Erwähnte Items verknüpfen“ ist an. Admins des Projekts schalten sie in den Projekteinstellungen unter **Automatisierungen** (`/projects/WEB/settings/automations`); der Schalter wirkt sofort.

Sie handeln als Standard-Bot „Automation“, halten sich an die Übergänge, die der Workflow erlaubt, und stehen mit ihrem Grund in der History, etwa „Automatisierung: Auto-Archiv“.

## Die fünf Automatisierungen

| Automatisierung | Was sie tut | Wann |
|---|---|---|
| Assignee beim Start | Eine Person, die ein Item ohne Assignee beginnt, wird sein Assignee. | Beim Statuswechsel des Items |
| Eltern schließen | Sind alle Kinder eines Items geschlossen, schließt auch das Eltern-Item. | Beim Statuswechsel eines Kinds |
| Auto-Archiv | Archiviert Items, die seit einer Zahl von Tagen geschlossen sind (Standard 30). | Jede Nacht |
| Auto-Close | Storniert Items, die seit einer Zahl von Tagen in Backlog oder Todo liegen (Standard 90), und sagt es in einem Kommentar. | Jede Nacht |
| Erwähnte Items verknüpfen | Verknüpft ein Item mit den Items, die seine Texte neu per `#` nennen. Standardmäßig an. | Nach dem Speichern |

## Assignee beim Start

Zieht eine Person ein Item ohne Assignee aus einem nicht begonnenen Status (Backlog, Unstarted) in einen Status der Kategorie Started, wird sie sein Assignee und beobachtet es. Das gilt auch, wenn jemand ein Item gleich in einem Started-Status anlegt.

- **Nur Personen.** Bots lösen es nie aus, auch kein Lauf einer [Vorlage](/de/concepts/templates).
- **Nur wer die Arbeit übernehmen darf:** ein Mitglied des Projekts oder eine Person, die Org-Admin ist.
- **Ein gewählter Assignee gewinnt.** Eine Änderung, die einen Assignee zusammen mit dem Status setzt (etwa eine Mehrfachbearbeitung), behält diesen Assignee, auch „Niemand“ (über die API `assignee_id: null` im selben Patch wie der Status).
- Die Person bekommt über sich selbst keine Benachrichtigung „Zugewiesen“.

## Eltern schließen

Kommt ein Kind in einen Status der Kategorie Completed oder Canceled, sieht werkbuch alle Kinder seines Eltern-Items an, auch archivierte. Sind alle geschlossen und mindestens eins davon Completed, geht das Eltern-Item in den ersten Completed-Status seines Workflows (in dessen Reihenfolge), den der Übergang erlaubt. Ist keiner erlaubt, bleibt das Eltern-Item offen. Wurden alle Kinder storniert, bleibt es ebenfalls offen: Erledigt wurde nichts.

Das Eltern-Item wechselt im selben Moment wie das Kind; die History zeigt beides. Ein archiviertes Eltern-Item bleibt, wie es ist. Die Regel arbeitet sich nach oben, höchstens fünf Ebenen; mit [zwei Ebenen](/de/concepts/work-items#eltern-und-kinder) von Items ist das heute ein Schritt.

## Auto-Archiv

Jede Nacht archiviert Auto-Archiv die Items des Projekts, die seit mindestens der eingestellten Zahl von Tagen (1 bis 3650) in einem Status der Kategorie Completed oder Canceled sind, gezählt ab dem Schließen. Archivierte Items bleiben lesbar und auffindbar; **Wiederherstellen** holt ein Item zurück.

## Auto-Close

Jede Nacht zieht Auto-Close die Items in Backlog oder Unstarted (Todo), an denen seit der eingestellten Zahl von Tagen (1 bis 3650) nichts passiert ist, in den gewählten Canceled-Status und schreibt als Standard-Bot einen Kommentar: „Automatisch geschlossen: seit 90 Tagen keine Aktivität.“ (in der Sprache der Organisation).

- **Aktivität** ist die letzte Änderung des Items oder sein letzter Kommentar, je nachdem, was später war. Ein Item mit laufender Diskussion wird nicht geschlossen.
- **Der Übergang entscheidet.** Erlaubt der Workflow den Wechsel aus dem Status des Items in den gewählten Status nicht, überspringt Auto-Close das Item und schreibt keinen Kommentar. Die Einstellungen sagen, welche Status es überspringt.
- **Ein Canceled-Status ist nötig.** In einem Workflow ohne Status der Kategorie Canceled lässt sich Auto-Close nicht einschalten; Org-Admins können einen anlegen.

## Erwähnte Items verknüpfen

Nennt eine Beschreibung, ein Rich-Text-Feld oder ein Kommentar eines Items ein anderes Item neu per `#`, verknüpft werkbuch beide mit dem Relationstyp „verwandt mit“. Die Automatisierung ist **standardmäßig an**, in jedem Projekt, auch in schon bestehenden; in den Projekteinstellungen schaltest du sie aus, das gilt dann für das Projekt.

- **Neu genannt** heißt: Der Verweis stand vorher nicht im Text. Denselben Text noch einmal zu speichern oder einen Text, der einen schon vorhandenen Verweis behält, verknüpft nichts. Sind zwei Items schon verknüpft (in beiden Richtungen, mit dem Typ „verwandt mit“), entsteht keine zweite Relation.
- **Was zählt:** die Beschreibung, die Rich-Text-Felder und die Kommentare (neue und bearbeitete) eines Items. Wiki-Seiten verknüpfen nichts, und ein Item verknüpft sich nie mit sich selbst.
- **Projektübergreifend**, soweit die Person, die den Text schrieb, das andere Item sieht. Es entscheidet die Automatisierung des Projekts des Items, das den Text trägt.
- **Wird der Verweis entfernt, bleibt die Relation.** Die Relation selbst entfernst du bei den Relationen des Items.
- **Ein archiviertes Item** darf das andere Ende sein. Ein archiviertes Item oder ein Item eines archivierten Projekts verknüpft als Träger des Texts nichts.
- **Nach dem Speichern.** Die Relation entsteht einen Augenblick nach dem Speichern, nicht mit ihm; die Item-Seite lädt sie von selbst nach.
- **Benachrichtigungen** folgen den üblichen Regeln: Beobachter beider Items hören „Relation hinzugefügt“; die Person, die den Text schrieb, nicht.

## In der Nacht

Auto-Archiv und Auto-Close laufen jede Nacht um 03:00 in der Zeitzone der Organisation, auch in den Nächten der Zeitumstellung. „Seit 30 Tagen“ heißt 30 × 24 Stunden vor dem Lauf. Fiel eine Nacht aus (Wartung), erledigt die nächste die Arbeit: Die Items erfüllen die Schwelle weiter.

- **Archivierte Projekte** und Projekte in Löschung bleiben außen vor.
- **Niemand wird benachrichtigt.** Weder der Statuswechsel noch der Kommentar der Nacht schreiben eine Benachrichtigung, auch nicht ein Eltern-Item, das der Statuswechsel über „Eltern schließen“ schließt; die History des Items zeigt alles.
- `php artisan app:run-automations --now` führt beide sofort aus, etwa nach einer Wartung; `--project=<ULID>` grenzt auf ein Projekt ein.

## Wenn der Workflow wechselt

Auto-Close folgt dem Workflow des Projekts. Wenn ein Admin [den Workflow wechselt](/de/concepts/workflows#der-workflow-eines-projekts), nimmt Auto-Close den Status, dem sein Canceled-Status zugeordnet wird, falls das ein Canceled-Status ist; sonst den ersten Canceled-Status des neuen Workflows; und hat der neue Workflow keinen, wird Auto-Close ausgeschaltet. Der Dialog **Workflow wechseln** sagt vorher, was passiert. Dasselbe gilt, wenn der Canceled-Status aus dem Workflow entfernt oder in eine andere Kategorie verschoben wird.

## In der History

Jeder Schritt einer Automatisierung ist ein Eintrag des Standard-Bots „Automation“ mit seinem Grund: „Automatisierung: Assignee beim Start“, „Automatisierung: Eltern schließen“, „Automatisierung: Auto-Archiv“, „Automatisierung: Auto-Close“ oder „Automatisierung: Erwähnte Items verknüpfen“. Über die API hat der History-Eintrag `via` `automation` und den Grund als Schlüssel in `reason` (`assign_on_start`, `close_parent`, `auto_archive`, `auto_close`, `link_references`). Die Relation von „Erwähnte Items verknüpfen“ steht in der History beider Items als „Relation hinzugefügt“, mit `meta.on_behalf_of` die Person, die den Text schrieb. Die Person, deren Statuswechsel einen Schritt auslöste (Assignee beim Start, Eltern schließen), wird darüber nicht benachrichtigt.

## Rechte

- **Admins des Projekts** (und Org-Admins) schalten Automatisierungen und ändern ihre Einstellungen, auch in einem archivierten Projekt.
- **Alle, die das Projekt sehen,** lesen sie; Member und Viewer sehen die Einstellungen schreibgeschützt.

## REST

Lesen braucht ein Token mit `read`, Ändern eins mit `write`. Die Liste hat immer alle fünf Automatisierungen; eine, die nie gespeichert wurde, liest sich, wie ihr Schlüssel startet: aus mit ihren Standardwerten, `link_references` an.

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/projects/{project}/automations` | Die fünf Automatisierungen des Projekts. |
| `PUT /api/v1/projects/{project}/automations/{key}` | `200` mit der Automatisierung; `enabled` (Pflicht) und `settings`. |

Die Schlüssel heißen `assign_on_start`, `close_parent`, `auto_archive`, `auto_close` und `link_references` (ohne Einstellungen). `link_references` ohne gespeicherte Zeile einzuschalten ändert nichts, es auszuschalten speichert eine Zeile. `settings` hält `days` für Auto-Archiv und Auto-Close (eine ganze Zahl von 1 bis 3650, als JSON-Zahl) und `state_id` für Auto-Close (ein Canceled-Status des Workflows des Projekts, nötig zum Einschalten). Eine Einstellung, die du nicht schickst, behält ihren Wert; andere Schlüssel werden übergangen.

```bash
curl -X PUT https://werkbuch.example.com/api/v1/projects/APP/automations/auto_close \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "settings": {"days": 60, "state_id": "01m6akx71bcm10xw328kxkw7cz"}}'
```

```json
{
  "data": {
    "id": "01m6d5k2h3j4k5l6m7n8p9q0rs",
    "project_id": "01m6akx72yptw2aw6n30m5fg0a",
    "key": "auto_close",
    "enabled": true,
    "settings": { "days": 60, "state_id": "01m6akx71bcm10xw328kxkw7cz" }
  }
}
```

Ein unbekannter Schlüssel ist ein `404`; wer kein Admin des Projekts ist, bekommt `403` mit „Automatisierungen ändern nur Admins des Projekts.“; eine falsche Einstellung ist ein `422` an `settings.days` oder `settings.state_id`, und `settings` muss ein Objekt sein. Eine Änderung schreibt das Event `automation.updated`; dieselben Werte noch einmal gespeichert ändern nichts.
