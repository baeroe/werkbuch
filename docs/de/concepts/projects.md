# Projekte

Ein Projekt ist der Ort, an dem ein Team an Items arbeitet. Jedes Projekt hat eigene Mitglieder und, sobald die Work Items in späteren Phasen kommen, eigene Items, ein eigenes Wiki und eigene Einstellungen.

## Felder

| Feld | Hinweis |
|---|---|
| Name | Pflicht. |
| Beschreibung | Klartext, bis 2000 Zeichen. |
| Bild | Optional. Ohne Bild bekommt das Projekt eine Farbe mit seinen Initialen. |
| Lead | Eine aktive Person, die Mitglied des Projekts ist. Standardmäßig die Person, die es anlegt. |
| Kennung | Siehe unten. |
| Sichtbarkeit | Öffentlich oder privat. |
| Workflow | Der Standard-Workflow, außer du wählst einen anderen. Siehe unten. |
| Typen | Die Item-Typen, die das Projekt nutzt, einer davon der Standardtyp. Siehe unten. |

## Kennung

Die Kennung besteht aus 2 bis 10 Großbuchstaben oder Ziffern und beginnt mit einem Buchstaben, zum Beispiel `WEB`. Sie ist in der ganzen Organisation eindeutig und wird zum Präfix der Keys der Items (`WEB-12`).

Du kannst sie ändern. Alte Kennungen funktionieren weiter: `ALT-12` leitet auf `NEU-12` um, und Links, Lesezeichen und API-Aufrufe mit der alten Kennung finden das Projekt weiterhin. Eine alte Kennung bleibt für dieses Projekt reserviert; niemand sonst kann sie vergeben. Zurück auf eine frühere Kennung desselben Projekts zu wechseln ist erlaubt.

## Workflow und Typen

Jedes Projekt nutzt einen [Workflow](/de/concepts/workflows) der Organisation und aktiviert die [Typen](/de/concepts/types-and-properties), die seine Items haben dürfen, einen davon als Standardtyp für neue Items. Beim Anlegen schlägt der Dialog den Standard-Workflow und alle aktiven Typen vor, der oberste angehakte Typ wird der Standard.

Projekt-Admins ändern beides in den Projekteinstellungen unter **Workflow** und **Typen**. Der Wechsel des Workflows ist ein eigener Schritt: Über die API ist er `PUT /api/v1/projects/{project}/workflow`, kein Feld des Projekts. Die Typen ändern sich mit den übrigen Feldern des Projekts (`enabled_type_ids`, `default_type_id`).

## Öffentlich und privat

Ein öffentliches Projekt sehen alle in der Organisation, ein privates nur seine Mitglieder und Org-Admins. Wer was sieht und was jede Rolle darf, steht unter [Rollen und Rechte](/de/concepts/permissions). Die Sichtbarkeit lässt sich jederzeit in den Projekteinstellungen ändern.

## Mitglieder und Rollen

Ein Mitglied hat eine von drei Rollen: Admin, Member oder Viewer. Projekt-Admins fügen in den Projekteinstellungen Personen und Bots hinzu, ändern Rollen und entfernen Mitglieder. Org-Admins können das in jedem Projekt.

- Wer ein öffentliches Projekt sieht, tritt ihm mit einem Klick bei und wird Mitglied.
- Wer ein Projekt anlegt, wird sein Admin.
- Der Lead bleibt Mitglied. Seine Rolle lässt sich ändern, ihn selbst kannst du aber nicht entfernen: bestimme zuerst einen anderen Lead.
- Bots können wie Personen Mitglied sein. Der Standard-Bot nur, wenn du ihn ausdrücklich hinzufügst.

## Archivieren

Ein Projekt-Admin kann ein Projekt archivieren. Es wird schreibgeschützt und verschwindet aus der Seitenleiste und aus den Views. Nichts geht verloren: **Archivierte zeigen** auf der Projektseite listet archivierte Projekte, und ein Projekt-Admin stellt das Projekt in dessen Einstellungen wieder her. Die Oberfläche wartet zuerst fünf Sekunden, und **Rückgängig** nimmt das Archivieren zurück.

## Löschen

Nur ein Projekt-Admin kann ein Projekt löschen und muss zur Bestätigung die Kennung eintippen. Das Projekt verschwindet sofort für alle. Der Rest samt allem, was dazugehört, wird im Hintergrund von einem Job entfernt, damit das Löschen eines großen Projekts die Seite nicht blockiert. Die Oberfläche wartet vor dem Löschen fünf Sekunden, und **Rückgängig** hält es auf. Danach lässt sich das Löschen nicht mehr rückgängig machen.

## Favoriten

Der Stern neben einem Projekt legt es in die Seitenleiste. Favoriten sind persönlich. Verliert jemand den Zugriff auf ein privates Projekt, verschwindet es sofort aus seiner Seitenleiste und kommt wieder, sobald er den Zugriff zurückbekommt.
