# Bots

Ein Bot ist ein Konto für ein Skript oder einen KI-Agenten. Er hat keine Anmeldung und kein Passwort. Er arbeitet über Tokens, über den [MCP-Server](/de/mcp) und die REST-API. Sonst verhält er sich wie eine Person: Er kann Mitglied von Projekten sein, bekommt Items zugewiesen und steht in der History unter seinem Namen. Die Oberfläche nennt jeden Bot „Bot“, auch wenn er einer Person gehört.

Diese Seite behandelt die Grundlagen, wie ein [Webhook](/de/webhooks#agenten) einen Agenten weckt und wie der Agent dann über [MCP](/de/mcp) arbeitet.

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

Der Agent arbeitet dann mit einem Token seines Bots über [MCP](/de/mcp#agent-szenario); das Token braucht `mcp`, `read` und, um etwas zu ändern, `write`. `whoami` sagt ihm, zu welchem Konto das Token gehört, `work-items:get` liest das Item (die Beschreibung als Markdown), `manage-comments:add` meldet, was er getan hat, und `manage-work-items:transition` zieht das Item weiter. Jede Änderung steht in der History unter dem Namen des Bots, mit `via: mcp`. Ein Skript ohne MCP-Client macht dasselbe über die [REST-API](/de/api): `GET /api/v1/me`, `GET /api/v1/work-items/{item}`, ein Kommentar und ein Statuswechsel.

## Als Agent arbeiten

Ein Bot kann als Agent arbeiten: Wer ihm ein Item zuweist, startet einen Auftrag auf einem **Runner**, einem eigenen Mac oder Linux-Rechner mit Claude Code oder Codex. Org-Admins richten das an drei Stellen ein:

- **Einstellungen → Runner → Runner verbinden** zeigt einen Befehl mit einem Einmal-Code (zehn Minuten, einmal). Führ ihn im Terminal der Maschine aus, am besten unter einem eigenen Benutzer ohne Admin-Rechte; er installiert den Runner von dieser Instanz und startet ihn als Dienst, und der Dialog sagt, sobald der Runner verbunden ist. Jede Runner-Karte zeigt, ob er online ist (ein Kontakt in der letzten Minute), seine Plätze (wie viele Aufträge zugleich, gesamt, je Repo und für Reviews und Antworten; unter **Plätze**), seine letzte Auslastung, die gefundenen CLIs, was seine Ausstattung bietet und was dort läuft, mit **Abbrechen**. **Widerrufen** macht sein Token ungültig und bricht ab, was auf ihm läuft.
- **Einstellungen → GitHub → Mit GitHub verbinden** legt eine GitHub-App für die Instanz an und installiert sie auf den Repos, an denen Agenten arbeiten; die App pusht und öffnet Pull Requests, nie eine Person. Die Seite nennt die Repos mit ihrem Projekt und ob ein Ruleset den Basis-Branch schützt. **GitHub trennen** lässt werkbuch die App vergessen; offene Stränge pausieren.
- **Einstellungen → Bots → Agent einrichten** an einem Bot: an oder aus, der Runner-Pool (keiner angehakt: alle Runner), das CLI mit den Runnern, die es installiert und angemeldet haben, das Standard-Modell und ein Modell je Auftragstyp (Umsetzen, Korrektur, Konflikt lösen, Review, Antwort; „Wie Standard“ nimmt das Standard-Modell). Die Seite nennt die Projekte, in denen der Bot Mitglied ist, und sagt, wo er nicht arbeitet und warum. Der Standard-Bot und ein Bot ohne verantwortliche Person können keine Agenten sein.

Wie Agenten arbeiten, steht an drei weiteren Stellen. **Einstellungen → Agenten** hält die Arbeitsregeln je Auftragstyp für die ganze Organisation, vorbelegt mit dem Standard von werkbuch (**Standard wiederherstellen** je Typ); über jedem Text steht aufklappbar und nur zum Lesen der Vertrag, den werkbuch immer zuerst in den Prompt stellt, und die Seite sagt, in welcher Reihenfolge der Prompt entsteht. Ein Typ hat ein optionales **Vorgehen für Agenten** für seine Items, ein Label ein optionales **Modell für Agenten** (ein Modell-Label: ein Item damit lässt seinen Agenten zuerst auf diesem Modell laufen).

Alles Weitere legt ein Projekt unter **Projekteinstellungen → Agenten** fest, zusammen gespeichert: Repo und Basis-Branch, die Merge-Methode, den Review-Agenten (ein Bot des Projekts oder ein Org-Admin-Bot, der als Agent arbeitet; keiner: der Bot des Strangs reviewt, und PRs von Personen bekommen kein Review), ob PRs von Personen ein Review bekommen und ob die App am PR kommentiert, den Setup- und Teardown-Befehl eines Worktrees, die Bremsen (Korrekturen und Konflikte je Strang, bevor er pausiert), ein Modell je Auftragstyp (nach einem Modell-Label, vor dem des Bots) und einen Text mit Projektinformationen und Regeln für Agenten. Dort stehen auch die [Schritte der Agenten](/de/concepts/workflows#schritte-der-agenten) seines Workflows. Pusht die App auf den Basis-Branch, ohne dass werkbuch gemergt hat, pausieren alle Stränge des Projekts, und die Seite sagt es; ein Projekt-Admin prüft den Commit bei GitHub und wählt **Bestätigen und fortsetzen**.

### Am Item

Jeder Auftrag ist eine Zeile der Aktivität des Items (Filter **Aufträge**): seine Art, das Modell und woher es kommt (Label, Projekt, Bot), der Runner, die Dauer und warum er wartet; **Protokoll** klappt auf, was der Runner vom CLI gelesen hat, und wächst, solange der Auftrag läuft. Unter dem Titel sagt ein Chip, dass der Agent arbeitet, und ein Hinweis, was eine Person braucht: die Bremse nach so vielen Korrekturen oder Konflikten, ein gescheiterter oder abgebrochener Auftrag (**Erneut starten**), ein Auftrag, der auf seinen Runner (offline) oder einen Runner mit seinem CLI wartet, ein eigenmächtiger Merge, ein Bot, der in diesem Projekt nicht als Agent arbeitet. Wer das Item ändern darf, bricht einen Auftrag ab, startet ihn erneut oder weist das Item dem Agenten wieder zu (eine Korrektur im selben Strang); nach **GitHub trennen** geht es mit **Weitermachen** weiter, sobald das Projekt sein Repo wieder hat. Der Abschnitt **Pull Requests** nennt die verknüpften Pull Requests mit Zustand, den Checks des Head-Commits und dem Urteil des Reviews. Ein Kommentar des Agenten, der einen Auftrag beantwortet (ein Review, eine Antwort), verweist mit **Ergebnis eines Auftrags** auf ihn. Für Screenreader ist das Protokoll keine Live-Region: ein Status sagt höchstens alle fünf Sekunden, wie viele neue Zeilen kamen.

## Der Standard-Bot

Jede Organisation hat einen Standard-Bot mit dem Namen „Automation“. Automatisierungen und die Zeitpläne von Vorlagen handeln in seinem Namen, ihre Änderungen stehen in der History also unter seinem Namen.

Der Standard-Bot ist **Org-Admin**, und das ist Absicht: Eine Automatisierung muss in jedem Projekt handeln können. Das macht seine Tokens mächtig. Ein Token handelt immer mit den Rechten seines Kontos, also **hat ein Token des Standard-Bots überall Admin-Rechte**. Die Oberfläche warnt dich, wenn du eines anlegst. Lege so ein Token nur an, wenn du es brauchst, und behandle es wie ein Admin-Passwort.

Du kannst den Standard-Bot umbenennen. Seine Rolle bleibt Admin, er bleibt aktiv, und du kannst ihn nicht deaktivieren. Mitglied eines Projekts ist er nur, wenn du ihn ausdrücklich hinzufügst.
