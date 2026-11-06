# Bots

Ein Bot ist ein Konto für ein Skript oder einen KI-Agenten. Er hat keine Anmeldung und kein Passwort. Er arbeitet über Tokens, über die REST-API und später über MCP. Sonst verhält er sich wie eine Person: Er kann Mitglied von Projekten sein, bekommt Items zugewiesen und steht in der History unter seinem Namen. Die Oberfläche nennt jeden Bot „Bot“, auch wenn er einer Person gehört.

Diese Seite behandelt die Grundlagen und wie ein [Webhook](/de/webhooks#agenten) einen Agenten weckt. Die Arbeit über MCP kommt mit dem MCP-Server in einer späteren Phase.

## Bot anlegen

Nur Org-Admins legen Bots an: **Einstellungen → Bots → Bot anlegen**.

- Der **Name** ist das, was Leute sehen.
- Der **Handle** hat 3 bis 32 Zeichen (a–z, 0–9 und Bindestrich) und ist unter allen Konten eindeutig. Leute erwähnen den Bot damit, zum Beispiel `@kira`.
- Die **Beschreibung** sagt, wofür der Bot da ist, damit andere wissen, warum es ihn gibt.
- Die **verantwortliche Person** ist die Ansprechperson, wenn der Bot etwas Unerwartetes tut. Standardmäßig bist du das.

Bots haben keine E-Mail-Adresse und bekommen keine Benachrichtigungen; eine Erwähnung oder Zuweisung schickt stattdessen die Webhook-Ereignisse `bot.mentioned` und `bot.assigned` (siehe unten). Ein Bot kann nicht Lead eines Projekts sein; der Lead ist immer eine Person.

## Zugriff geben

Ein Bot sieht und tut nur, was seine Rollen erlauben, wie eine Person. Die Organisationsrolle eines neuen Bots ist Member. Damit er in einem Projekt arbeiten kann, füge ihn in den Projekteinstellungen als Mitglied hinzu. Org-Admins ändern die Rolle eines Bots wie die einer Person und können ihn deaktivieren.

## Tokens

Ein Bot arbeitet mit einem Token. Tokens für Bots legen nur Org-Admins an: Öffne den Bot in den Einstellungen und wähle **Token anlegen**. Ein Token hat einen Namen, Fähigkeiten und optional ein Ablaufdatum. werkbuch zeigt es nur einmal, direkt nach dem Anlegen, kopiere es also gleich. Ist es verloren, widerrufe es und lege ein neues an.

Die Fähigkeiten sind `read`, `write` und `mcp`; siehe [Rollen und Rechte](/de/concepts/permissions#tokens). Gib einem Bot nur, was seine Aufgabe braucht, und ein Token je Skript, damit du sie einzeln widerrufen kannst. Tokens lassen sich nur aus der Oberfläche anlegen, nicht mit einem anderen Token.

Deaktivierst du einen Bot, werden alle seine Tokens gelöscht. Beim erneuten Aktivieren kommen sie nicht zurück.

## Einen Agenten wecken

Ein Agent erfährt von seiner Arbeit über einen [Webhook](/de/webhooks) mit **Nur für einen Bot**. So ein Webhook bekommt `bot.assigned`, wenn jemand anderes dem Bot ein Item zuweist (ein Bot, der sich ein Item selbst nimmt, bekommt keins), `bot.mentioned`, wenn jemand ihn mit `@handle` erwähnt, und die Änderungen und Kommentare der Items, die ihm zugewiesen sind, jeweils mit dem Item in `data`. Er bekommt sie nur, solange der Bot aktiv ist und das Projekt sieht: entfernst du den Bot aus einem privaten Projekt, hört sein Webhook von dort nichts mehr. Wie alles andere ist `data` für den Bot geschrieben und nennt also nie ein Item, das der Bot nicht sehen darf.

Der Agent arbeitet dann mit einem Token seines Bots über die [REST-API](/de/api): er liest das Item, kommentiert und setzt den Status. `GET /api/v1/me` sagt ihm, zu welchem Konto das Token gehört. MCP folgt in einer späteren Phase.

## Der Standard-Bot

Jede Organisation hat einen Standard-Bot mit dem Namen „Automation“. Automatisierungen und die Zeitpläne von Vorlagen handeln in seinem Namen, ihre Änderungen stehen in der History also unter seinem Namen.

Der Standard-Bot ist **Org-Admin**, und das ist Absicht: Eine Automatisierung muss in jedem Projekt handeln können. Das macht seine Tokens mächtig. Ein Token handelt immer mit den Rechten seines Kontos, also **hat ein Token des Standard-Bots überall Admin-Rechte**. Die Oberfläche warnt dich, wenn du eines anlegst. Lege so ein Token nur an, wenn du es brauchst, und behandle es wie ein Admin-Passwort.

Du kannst den Standard-Bot umbenennen. Seine Rolle bleibt Admin, er bleibt aktiv, und du kannst ihn nicht deaktivieren. Mitglied eines Projekts ist er nur, wenn du ihn ausdrücklich hinzufügst.
