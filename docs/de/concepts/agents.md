# Agenten

Ein Agent ist ein [Bot](/de/bots), der selbst an Items arbeitet. Weist du ihm ein Item zu, setzt ein [Runner](/de/runner), eine eigene Maschine mit Claude Code oder Codex, es um, öffnet einen Pull Request, lässt CI und ein unabhängiges Review laufen, behebt, was sie finden, und werkbuch mergt, sobald alles grün ist. Fragst du ihn etwas in einem Kommentar, antwortet er aus Wiki, Items und Code des Projekts.

Ein Item, an dem ein Agent arbeitet, sieht aus wie jedes andere: dieselbe History, dieselben Benachrichtigungen, dieselben Automatisierungen. Der Agent setzt nie einen Status, weist nie zu und mergt nie; all das macht werkbuch, unter dem Namen des Bots.

| Begriff | Heißt |
|---|---|
| Agent | ein Bot mit eingeschaltetem Agenten: Runner-Pool, CLI, Modelle |
| Runner | eine Maschine mit dem Daemon `werkbuch-runner` |
| Auftrag | ein Lauf eines Agenten auf einem Runner: Umsetzen, Korrektur, Konflikt, Review oder Antwort |
| Strang | die laufende Arbeit an einem Item oder Epic: Branch, Worktree, Session des CLI, Pull Request |

## Vor dem ersten Auftrag

1. **Ein Runner:** unter **Einstellungen → Runner** verbinden ([Runner](/de/runner)).
2. **GitHub**, für Projekte mit Code: die App unter **Einstellungen → GitHub** verbinden und das Repo des Projekts unter **Projekteinstellungen → Agenten** wählen ([GitHub](/de/github)). Ein Projekt ohne Repo geht auch, siehe [ohne Repo](#ohne-repo).
3. **Der Setup-Befehl**, für Projekte mit Code: unter **Projekteinstellungen → Agenten**, damit jeder Worktree seine Abhängigkeiten und eine eigene Testumgebung bekommt, mit DDEV einen eigenen Projektnamen je Strang ([Setup und Teardown](/de/runner#setup-und-teardown)). Er läuft vor jedem Auftrag, der Code ändert; schreib ihn also so, dass er wiederholt laufen darf.
4. **Das Ruleset des Basis-Branchs:** Verlangt es eine Freigabe, trag die App in seine Bypass-Liste ein, nur für Pull Requests; sonst kann werkbuch nicht mergen ([Freigabe verlangt](/de/github#freigabe-verlangt)).
5. **Ein Bot als Agent:** **Einstellungen → Bots → Agent einrichten**: an, der Runner-Pool (keiner angehakt: alle Runner), das CLI, das Standard-Modell und ein Modell je Auftragstyp. Der Bot braucht eine verantwortliche Person, muss aktiv und Mitglied des Projekts mit dem Recht sein, Items zu bearbeiten. Der Standard-Bot kann kein Agent sein.
6. **Die Schritte des Workflows:** Der Workflow des Projekts nennt für jeden der vier [Schritte der Agenten](/de/concepts/workflows#schritte-der-agenten) einen Status: In Arbeit, In Review, Korrektur, Gemergt. Ohne alle vier arbeiten die Agenten in seinen Projekten an keinem Item, und die Zuweisung an einen Bot bleibt eine normale Zuweisung; Erwähnungen beantworten sie trotzdem (eine Antwort bewegt kein Item).

Wo etwas fehlt, sagt das Item unter seinem Titel warum, und **Projekteinstellungen → Agenten** sagt es für das Projekt.

## Der Ablauf

```
Bot zugewiesen ─► Umsetzen (In Arbeit)
  └─ Pull Request offen ─► In Review
       ├─ Konflikt mit der Basis ─► Konflikt ─► Push ─► (CI …)
       ├─ CI rot ─────────────┐
       ├─ CI grün ─► Review    │
       │    ├─ Befunde ────────┴─► Korrektur ─► Korrektur-Auftrag ─► In Arbeit ─► Push ─► (CI …)
       │    └─ keine Befunde ─► werkbuch mergt ─► Gemergt
       └─ Bremse (3 Korrekturen / 2 Konflikte) ─► Strang pausiert, Item an die verantwortliche Person
```

1. **Zugewiesen:** Jemand weist dem Bot das Item zu (auch eine Vorlage, deren Assignee der Bot ist). werkbuch reiht einen Auftrag **Umsetzen** ein; sobald er startet, geht das Item auf **In Arbeit**.
2. **Pull Request:** Der Agent arbeitet in einem Worktree auf dem Branch `agent/<KEY>-<slug>`, testet, committet, pusht und öffnet einen Pull Request mit `Fixes <KEY>`. werkbuch verknüpft ihn und setzt das Item auf **In Review**. Hat ein früherer Strang des Items den Namen schon benutzt (Pull Request geschlossen, dann neu zugewiesen), bekommt der neue Strang `-2`, `-3` …, damit der alte Worktree ihn nicht hält; von Hand angelegte oder auf dem Remote gebliebene Namen werden nicht geprüft.
3. **CI:** werkbuch hört die Checks des Head-Commits. Grün heißt: Jeder Check-Run, jeder Workflow-Lauf von GitHub Actions und jeder Commit-Status dieses Commits ist fertig, und keiner ist gescheitert; rot, sobald einer scheitert, auch wenn andere noch laufen. Ein Repo ohne jeden Check gilt als grün, wenn GitHub zwei Minuten nach dem Push keinen für den Commit hat.
4. **Review:** Bei grüner CI reviewt der Review-Agent des Projekts den Pull Request, immer mit frischer Session und ohne den Kontext der Umsetzung; ohne Review-Agent reviewt der Bot des Strangs selbst. Einmal je Head-Commit; ein neuer Push macht ein laufendes Review hinfällig.
5. **Korrektur:** Rote CI oder Befunde im Review setzen das Item auf **Korrektur** und starten eine **Korrektur** im selben Strang, mit fortgesetzter Session. werkbuch nennt die gescheiterten Checks mit Links; deren Logs liest der Agent selbst. Danach laufen CI und Review erneut.
6. **Merge:** Mit einem Review ohne Befunde und grüner CI auf demselben Head-Commit und einem mergebaren Pull Request mergt werkbuch mit der Merge-Methode des Projekts und löscht den Branch. Das Item geht auf **Gemergt**. Das Urteil des Reviews steht als Kommentar am Pull Request (die App kann ihren eigenen Pull Request nicht freigeben).

Erledigt erst nach dem Merge: Erledigt setzt die Resolution, schließt über [Automatisierungen](/de/concepts/automations) ein Eltern-Epic und startet die Frist von Auto-Archiv.

Ein **Konflikt** mit dem Basis-Branch geht vor CI und Review: werkbuch prüft die offenen Pull Requests der Agenten nach jedem Push auf ihre Basis und vor jedem Merge und startet einen **Konflikt**-Auftrag. Der Agent mergt die Basis in den Branch (kein Rebase, kein Force-Push), löst die Konflikte, lässt die betroffenen Tests laufen und pusht.

Solange ein Auftrag, der Code ändert, wartet oder läuft, entscheiden CI und Review nichts; ihre Befunde warten am Strang. Endet der Auftrag ohne neuen Commit, werden wartende Befunde eine Korrektur, sonst pausiert der Strang (keine Änderung). Mit neuem Commit fallen sie weg.

## Auftragstypen

| Auftrag | Startet, wenn | Darf | Endet mit | Zeitlimit |
|---|---|---|---|---|
| Umsetzen | dem Bot ein Item zugewiesen wird | Worktree, Commits, Push, Pull Request öffnen, werkbuch lesen und schreiben | einem offenen Pull Request | 120 Min. |
| Korrektur | CI rot, Befunde im Review, eine Person stellt das Item auf Backlog oder Unstarted zurück oder weist es dem Bot wieder zu | wie Umsetzen, selber Strang und Session | einem neuen Push auf denselben Pull Request | 120 Min. |
| Konflikt | der Pull Request mit seiner Basis kollidiert | wie Korrektur | der hineingemergten Basis, einem Push | 30 Min. |
| Review | alle Checks des Head-Commits grün sind | nur lesen | einem Urteil: keine Befunde oder Befunde | 20 Min. |
| Antwort | eine Person den Bot in einem neuen Kommentar erwähnt | nur lesen | einer Antwort als Kommentar des Bots | 10 Min. |

Was ein Auftrag darf, erzwingen die Tokens, nicht nur der Prompt; siehe [was ein Auftrag darf](/de/runner#was-ein-auftrag-darf). Änderungen, die werkbuch im Ablauf selbst macht (Status, Zuweisung), Kommentare von Bots, Erwähnungen in Beschreibung oder Feldern und bearbeitete Kommentare starten nie einen Auftrag.

## Ohne Repo

In einem Projekt ohne Repo arbeitet ein Auftrag **Umsetzen** in einem eigenen Ordner und endet mit einer Zusammenfassung als Kommentar des Bots. Das Item geht direkt auf den Schritt **Gemergt**: Es gibt keinen Pull Request, keine CI und kein Review.

## Bremsen

Damit kein Strang endlos Tokens verbrennt, hat jeder Strang zwei Bremsen (**Projekteinstellungen → Agenten**, 1 bis 10): höchstens **3 Korrekturen** und **2 Konflikte**. Hinter einer Bremse pausiert der Strang: Pull Request, Branch, Worktree und Session bleiben, das Item geht auf **Korrektur** und an die verantwortliche Person des Bots, mit einem Kommentar mit dem letzten Befund. Dasselbe passiert, wenn ein Auftrag ganz ohne Änderung endet.

## Wenn ein Auftrag scheitert

Ein Auftrag, der scheitert, sein Zeitlimit reißt oder zweimal verloren geht, hinterlässt einen Kommentar mit dem Grund, und nichts startet von selbst neu. Nach einem Auftrag, der Code ändert, oder einem Review des Pull Requests eines Agenten geht das Item auf **Korrektur**; eine gescheiterte Antwort lässt das Item, wo es ist. **Erneut starten** am Auftrag startet denselben Typ im selben Strang; die Bremsen zählen weiter.

## Personen greifen ein

- **Das Item einer Person zuweisen:** Ein laufender Auftrag wird abgebrochen, der Strang pausiert; der Pull Request bleibt.
- **Es wieder dem Bot zuweisen:** Mit offenem oder pausiertem Strang eine Korrektur mit den Kommentaren seit dem letzten Auftrag als Befund, und die Bremsen beginnen von vorn; ohne Strang ein neuer Auftrag Umsetzen. Ein Strang, den ein [eigenmächtiger Merge](/de/github#eigenmachtiger-merge) pausiert hat, geht nur mit **Bestätigen und fortsetzen** weiter, einer, den **GitHub trennen** pausiert hat, nur mit **Weitermachen**; Wiederzuweisen weckt ihn nicht.
- **Auf Backlog oder Unstarted zurückstellen**, solange der Pull Request des Bots offen ist: ebenfalls eine Korrektur.
- **Den Pull Request selbst auf GitHub mergen:** werkbuch behandelt das wie den eigenen Merge; das Item geht auf **Gemergt**. Schließt du ihn ohne Merge, endet der Strang, und das Item geht mit einem Kommentar auf **Korrektur**.
- **Abbrechen** eines Auftrags am Item; das darf, wer das Item bearbeiten darf.
- **Fragen:** den Bot in einem Kommentar erwähnen (siehe [Erwähnungen](#erwahnungen)). Eine Frage ändert nie Code; wer eine Änderung will, stellt das Item zurück oder weist es wieder zu.

## Wenn der Agent nicht weiterkommt

Kann der Agent ein Item oder einen Teil davon nicht umsetzen, weil etwas fehlt (Information, Zugriff, Entscheidung), beendet er seine Antwort mit `Outcome: blocked` und nennt, was er braucht. werkbuch schreibt das als Kommentar des Bots, setzt das Item auf den optionalen Schritt `blocked` (meist **Pending**, [Schritte der Agenten](/de/concepts/workflows#schritte-der-agenten)) und gibt es der verantwortlichen Person des Bots. Der Strang pausiert: kein Review, kein Merge. Antworte in den Kommentaren und weise das Item wieder dem Bot zu; dann beginnt eine Korrektur mit den Kommentaren seit dem letzten Auftrag. Ein gepushter Teil bleibt auf dem Branch. Bei einem Kind eines Epics läuft der Strang mit dem nächsten Kind weiter; das Epic wird nicht bereit, solange ein Kind auf eine Person wartet. Ohne den Schritt `blocked` behält das Item seinen Status; Kommentar, Zuweisung und Pause bleiben.

## Beginnen in Todo

Mit dem optionalen Schritt `ready` (meist **Todo**, [Schritte der Agenten](/de/concepts/workflows#schritte-der-agenten)) beginnt der Bot ein Item erst, wenn es ihm gehört **und** in diesem Status steht. Im Backlog zugewiesen, startet nichts: das Item sagt „Bob beginnt, sobald das Item auf Todo steht“. Weise es in Todo zu oder stelle ein Item des Bots auf Todo, dann startet der Auftrag Umsetzen. Ein Item des Bots, das eine Person ohne Strang auf **Korrektur** stellt, beginnt wie aus Todo; mit Strang korrigiert es wie bisher. Erwähnungen, Reviews, rote CI und Konflikte hängen nicht vom Status ab. Ohne den Schritt `ready` beginnt ein Agent sofort, wie bisher.

## Epics

Ist ein Epic dem Bot zugewiesen, arbeitet er das ganze Epic auf einem Branch mit einem Pull Request ab:

- Ein Strang am Epic, Branch `agent/<KEY>-<slug>` vom Basis-Branch. Die offenen Kinder, die niemandem oder dem Bot gehören (mit dem Schritt `ready` nur die in Todo; ein Kind, das später dorthin kommt, wird eingereiht, und das Epic wird nicht bereit, solange offene Kinder im Backlog warten), werden nacheinander Aufträge Umsetzen, in ihrer manuellen Reihenfolge; der Bot weist sich jedes Kind beim Start selbst zu.
- Nach dem ersten Kind öffnet der Agent einen **Entwurfs**-Pull-Request. Kinder des Bots warten auf **In Review**.
- Kinder, die einer Person gehören, bleiben ihre; sie pusht ihre Arbeit selbst auf den Epic-Branch.
- Ist kein Kind mehr offen, stellt werkbuch den Pull Request bereit; erst dann laufen CI und Review.
- Beim Merge gehen das Epic und die Kinder des Bots auf **Gemergt**; schon geschlossene Kinder bleiben.

Ein Task, der dem Bot einzeln zugewiesen ist, ist ein normaler Task mit eigenem Branch und Pull Request, auch in einem Epic. Ein Kind, das eine Person dem Bot zuweist, während er an dessen Epic arbeitet, hängt sich an den Strang des Epics.

## Erwähnungen

Erwähnst du den Bot mit `@handle` in einem neuen Kommentar, antwortet er in einem eigenen Kommentar, aus Wiki, Items und Code des Projekts, mit Quellen. Es zählen nur Erwähnungen von Konten, die das Item bearbeiten dürfen, und nur in neuen Kommentaren; Erwähnungen in Beschreibung oder Feldern und bearbeitete Kommentare starten nichts. An einem Item mit offenem Strang setzt die Antwort dessen Session fort, sonst beginnt sie frisch. Eine Antwort braucht keinen der vier Schritte des Workflows: Sie bewegt kein Item.

Kann ein als Agent eingerichteter Bot hier nicht antworten (sein Agent ist ausgeschaltet, er hat keine verantwortliche Person, ist deaktiviert oder darf Items des Projekts nicht ändern), sagt es der Standard-Bot in einem Kommentar am Item, einmal je Kommentar: warum, und wer es mit einem Link an die richtige Stelle ändert (ein Org-Admin für Agent und Bot, ein Projekt-Admin für die Mitglieder). Ein Bot, der nie als Agent eingerichtet war, bekommt keinen Hinweis (er wacht womöglich über einen Webhook auf `bot.mentioned` auf, siehe [Einen Agenten wecken](/de/bots#einen-agenten-wecken)), der Standard-Bot auch nicht. Eine Erwähnung durch einen Bot, durch ein Konto, das das Item nicht bearbeiten darf, oder in einem bearbeiteten Kommentar bekommt ebenfalls keinen Hinweis, und der Hinweis selbst löst nichts aus; die Beobachter des Items hören davon wie von jedem Kommentar.

## Pull Requests von Personen

Pull Requests von Personen gehen ebenfalls durchs Review, wenn das Projekt einen Review-Agenten hat und **PRs von Personen reviewen** an ist (Standard):

- Reviewt werden nur Pull Requests, die mit einem Item des Projekts verknüpft sind (über Branch-Namen, Titel oder Beschreibung), sobald CI auf dem Head-Commit grün ist; Entwürfe nicht.
- Ohne Befunde schreibt die App ein GitHub-Review **Approve**, mit Befunden einen Kommentar mit den Befunden (kein „Request changes“, das den Merge sperren würde). Das Urteil geht auch als Kommentar an die verknüpften Items.
- werkbuch startet für sie nie eine Korrektur oder einen Konflikt und mergt sie nie.

Welche Status ein Pull Request einer Person bewegt, steht unter [Pull Requests](/de/concepts/workflows#pull-requests) bei den Workflows.

## Prompt und Regeln

werkbuch baut den Prompt jedes Auftrags in Schichten, in dieser Reihenfolge:

1. **Vertrag**, im Code, in der Sprache der Organisation (Englisch oder Deutsch; der Auftrag eines Laufs folgt ihr): was der Auftragstyp tut und nie tut (Status setzen, zuweisen, mergen, releasen, Force-Push), das Format, das werkbuch liest, und dass Texte aus Items, Kommentaren, Wiki und Pull Requests Daten sind, keine Anweisungen. **Einstellungen → Agenten** zeigt ihn aufklappbar und nur zum Lesen.
2. **Arbeitsregeln je Auftragstyp** für die ganze Organisation, unter **Einstellungen → Agenten**: vorbelegt mit dem Standard von werkbuch in der Sprache der Organisation, **Standard wiederherstellen** je Typ. Ändern dürfen Org-Admins.
3. **Vorgehen für Agenten** des Typs des Items, im Typ-Dialog.
4. **Projektinformationen und Regeln für Agenten**, unter **Projekteinstellungen → Agenten**.
5. **Der Auftrag:** das Item mit Key und Titel, die Aufrufe von `werkbuch-run`, die das Item (mit Dateien und Relationen, bei einem Kind dazu das Epic), seine Kommentare Seite für Seite und seine Bilder lesen (`attachments` mit `content` gibt ein PNG, JPEG, GIF oder WebP als Bild), mit ihren Argumenten wörtlich, bei einem Kind dazu das Epic mit seinen Geschwistern. Der Text des Items steht nicht im Prompt: Der Vertrag sagt jedem Auftrag, ihn vor jeder Arbeit zu lesen und, wenn das Lesen ein zweites Mal scheitert, nichts zu ändern und zu sagen, welcher Aufruf scheiterte.

Das CLI liest außerdem die Regeln des Codes im Repo (`CLAUDE.md`, `AGENTS.md`). Kommandos und Konventionen gehören dorthin, die Texte in werkbuch sagen, wie gearbeitet wird. Eine Anweisung je Bot gibt es nicht.

## Modelle

Nicht jeder Auftrag braucht das stärkste Modell. werkbuch wählt das Modell beim Einreihen; das erste, das passt, gewinnt:

1. **Ein Modell-Label des Items:** ein Label mit **Modell für Agenten** (im Label-Dialog). Bei mehreren das erste in der Reihenfolge des Katalogs; ein Kind ohne nimmt das des Epics.
2. **Das Projekt**, ein Modell je Auftragstyp (**Projekteinstellungen → Agenten**).
3. **Der Bot**, ein Modell je Auftragstyp, dann sein Standard-Modell.

Die Modelle kommen aus einer festen Liste je CLI: Claude Code `haiku`, `sonnet` (Standard), `opus`, `fable`; Codex `gpt-5-codex` (Standard), `gpt-5-codex-mini`. Ein Modell eines anderen CLI wird übergangen. Der Auftrag zeigt das Modell und woher es kam.

## Plätze und Reihenfolge

Ein Runner nimmt so viele Aufträge, wie seine Plätze erlauben (**Einstellungen → Runner**: 2 gesamt, 1 je Repo, 2 leicht). Reviews und Antworten zählen nur in ihrem eigenen Topf. Konflikte, Korrekturen und Reviews kommen vor Umsetzen und Antworten; danach zählt die Priorität des Items, dann das Alter des Auftrags. Ein Strang bleibt auf seinem Runner; ein Auftrag des Strangs wartet, solange der Runner belegt ist, und zieht nach 30 Minuten offline auf einen anderen Runner des Pools um. Ein Epic läuft immer ein Kind nach dem anderen.

## Am Item

Jeder Auftrag ist eine Zeile der Aktivität des Items (Filter **Aufträge**): seine Art, das Modell und woher es kommt, der Runner, die Dauer und warum er wartet. **Protokoll** klappt auf, was der Runner vom CLI gelesen hat, und wächst, solange der Auftrag läuft. Unter dem Titel sagt ein Chip, dass der Agent arbeitet, und ein Hinweis, was eine Person braucht: eine Bremse, ein gescheiterter oder abgebrochener Auftrag (**Erneut starten**), ein Auftrag, der auf seinen Runner (offline) oder einen Runner mit seinem CLI wartet, ein eigenmächtiger Merge, ein Bot, der in diesem Projekt nicht als Agent arbeitet. Wer das Item bearbeiten darf, bricht einen Auftrag ab, startet ihn erneut oder gibt das Item dem Agenten zurück; nach **GitHub trennen** geht es mit **Weitermachen** weiter, sobald das Projekt sein Repo wieder hat.

Der Abschnitt **Pull Requests** nennt die verknüpften Pull Requests mit Zustand, den Checks des Head-Commits und dem Urteil des Reviews. Ein Kommentar des Agenten, der einen Auftrag beantwortet (ein Review, eine Antwort, eine Zusammenfassung), verweist mit **Ergebnis eines Auftrags** auf ihn. Für Screenreader ist das Protokoll keine Live-Region: Ein Status sagt höchstens alle fünf Sekunden, wie viele neue Zeilen kamen.

## REST und MCP

Die Aufträge liest `GET /api/v1/runs` (Filter `work_item_id`, `runner_id`, `bot_id`, `project_id`, `status`, `type`), dazu `GET /api/v1/runs/{run}/events` für das Protokoll, `POST …/cancel` und `POST …/retry`. `GET /api/v1/work-items/{item}?include=links,agent` liest die Pull Requests und den Stand des Agenten an einem Item. Über [MCP](/de/mcp) machen die Tools `agents` und `manage-agents` dasselbe. Einen Runner verbinden und GitHub verbinden geht nur in der Oberfläche.
