# Runner und GitHub-Integration: Design

Stand: 2026-11-23 · Status: von Rafael abgenommen am 2026-11-23 · Plan: `docs/superpowers/plans/2026-11-23-runner.md`

Dieses Dokument beschreibt den **werkbuch-Runner** (ein Go-Daemon mit TUI, der Aufträge aus werkbuch auf einer eigenen Maschine mit Claude Code oder Codex ausführt) und die **GitHub-Integration** (GitHub-App je Instanz: Repo je Projekt, Tokens je Auftrag, PR-Verknüpfung, CI und Merge). Beides ist ein Vorhaben: Der Runner braucht die App für Git, und der Ablauf eines Tickets (PR, CI, Review, Merge) hängt an beiden. Markierungen: *(Rafael)* hat Rafael entschieden, *(Claude)* ist ein Vorschlag aus dem Gespräch, den Rafael mit der Abnahme bestätigt, *(Builder)* entscheidet, wer umsetzt.

Die fachliche Grundlage bleibt `docs/superpowers/specs/2026-10-28-werkbuch-design.md`; nach der Abnahme bekommt sie einen Abschnitt „Änderungen vom 2026-11-23“, der auf dieses Dokument verweist.

## 1. Warum

Rafael will alle Arbeit, auch geschäftliche Aufgaben abseits von werkbuch, an einem Ort führen und einen Teil davon von Agenten erledigen lassen. werkbuch hat dafür schon Bots, Tokens, MCP, Webhooks (`bot.assigned`, `bot.mentioned`) und Vorlagen mit Zeitplan; es fehlen der Teil, der einen Agenten wirklich startet, und der Weg zu Git. Vorbild ist itsaplan.dev (Runner pollt die Instanz, startet das CLI headless, der Agent arbeitet über MCP), aber mit dem Ablauf, den Rafael heute im do-ticket-Flow von Hand fährt: umsetzen, PR, CI, unabhängiges Review, Merge.

Ein späterer „Hub“ über alle Instanzen (openbill, prevju, werkbuch) ist ein eigenes Vorhaben; der Runner wird so gebaut, dass er später eine zweite Quelle für Aufträge bekommen kann, ohne dass dieses Dokument es vorwegnimmt.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Ein Item oder Epic einem Bot zuweisen genügt: ein Runner auf einem Mac arbeitet es ab, öffnet einen PR, CI und ein unabhängiges Review laufen, werkbuch mergt, das Ticket wird „Done“. Fehler in CI oder Review führen zu einer Korrektur durch den Agenten, ohne dass Rafael eingreifen muss.
- Ein Bot im Kommentar erwähnt beantwortet Fragen aus Wiki und Code des Projekts.
- Jeder PR eines verknüpften Repos bekommt ein Review, auch PRs von Menschen.
- PRs stehen am Item (verknüpft über den Key).
- Runner installieren mit einem kopierten `curl`, verbinden per Einmal-Code, Updates kommen von selbst.
- Parallelität ist je Runner und je Repo einstellbar.
- Eine TUI im Stil von skilltri und tussh.

**Nicht-Ziele (v1)**

- WebSocket zwischen Runner und werkbuch (Polling, siehe 6.1).
- GitLab, Gitea, Forgejo, Bitbucket.
- Agenten, die im werkbuch-Server laufen (keine LLM-Keys in werkbuch).
- Ein Chat-Fenster für Agenten; Gespräche laufen über Kommentare.
- Ein Runner für mehrere werkbuch-Instanzen, der Hub.
- Sandbox oder Container um den Agenten (die Maschine ist die Grenze, siehe 11).
- Windows als Runner.
- herdr-Plugin für den Runner (später, eigenes Repo wie `herdr-skilltri`).
- Kostenabrechnung je Auftrag (Nutzung darf mitgeschrieben werden, siehe 7.5, aber keine Budgets).

**Anti-Ziele** (wäre gescheitert, auch wenn es technisch läuft)

- Der Agent mergt selbst oder setzt Tickets selbst auf „Done“.
- Schleifen ohne Ende: Korrektur auf Korrektur, die Tokens verbrennt.
- Der Agent handelt in werkbuch oder auf GitHub als Rafael.
- Der Runner braucht einen offenen Port oder Expose.
- Geheimnisse (Tokens, Private Key der App) stehen in Jobs, Events, Logs oder Auftragsprotokollen.
- Ein Ticket, das ein Agent bearbeitet, sieht in werkbuch anders aus als eines, das ein Mensch bearbeitet (gleiche History, gleiche Benachrichtigungen, gleiche Automatisierungen).

## 3. Rahmen und Vorgaben

- **Ort:** Der Runner liegt im werkbuch-Repo unter `runner/` mit eigenem `go.mod` (`github.com/baeroe/werkbuch/runner`) *(Rafael)*. Go wie tussh und skilltri *(Rafael)*.
- **Version:** Der Runner trägt die Version von werkbuch (`config/werkbuch.php`), gebaut im selben Release, kein eigener Tag *(Claude)*.
- **Auslieferung:** Die Binaries stecken im Docker-Image und werden von der Instanz ausgeliefert *(Rafael)*.
- **Maschine:** zuerst Rafaels alter MacBook (Architektur noch offen, daher macOS arm64 und amd64). Der Mac braucht für Code-Aufträge die Umgebung des Projekts (für werkbuch: Colima, DDEV, Node per mise) und Claude Code mit Login; das gehört in die Blueprint (`~/development/baeroe/setup`), nicht in dieses Vorhaben.
- **Regeln des Repos gelten:** 100 % Zeilen PHP und Frontend, `WorkflowsTest` (Actions per SHA, feste Runner-Images, kein Push ohne Tag-Bedingung), `ArchTest`, Rechte- und Routen-Matrix, Vertrag gegen das OpenAPI-Dokument, MCP-Parität (A397), Doku in `docs/en` und `docs/de`, Tastatur-Manifest, axe.

## 4. Ansätze

**Wo der Runner wohnt.** (a) Im späteren Hub, Aufträge aus allen Apps; (b) in werkbuch, alle Aufträge über Items; (c) eigenständiges Tool mit generischem Protokoll, werkbuch als erste Quelle. *Gewählt (c) im werkbuch-Repo* *(Rafael)*: Items geben Nachvollziehbarkeit, History, Benachrichtigungen und Review umsonst; geschäftliche Aufgaben werden Items (etwa im Projekt HAUS). Der Runner im Hub hätte die größte denkbare Angriffsfläche (eine App mit Zugriff auf alles, die auch Code ausführt).

**Verbindung.** (a) Polling; (b) Reverb/WebSocket; (c) werkbuch schickt Aufträge per Webhook an den Runner. *Gewählt (a)* *(Rafael nach Claudes Empfehlung)*: Abholen, Heartbeat und Ergebnis laufen ohnehin über HTTP (Reverb nimmt keine Client-Events); Reverb-Kanäle nehmen bewusst keine Tokens (A283) und stellen nur nach bestem Bemühen zu (A284), Polling bliebe als Rückfall nötig; der Gewinn (Start in unter 1 s statt bis 3 s, sofortiger Abbruch) zählt bei Läufen von Minuten nicht. (c) verlangt einen offenen Port. Das Protokoll ist so geschnitten, dass ein späterer „Wecker“ über Reverb nur das sofortige Abholen auslöst.

**Git-Zugang.** (a) `gh`-Login auf dem Mac; (b) OAuth-App oder Personal Token in werkbuch; (c) GitHub-App je Instanz. *Gewählt (c), gleich im ersten Wurf* *(Rafael)*: PRs laufen als App der Instanz statt unter Rafaels Account, Tokens gelten je Auftrag für ein Repo und eine Stunde, dieselbe App liefert die Webhooks für PRs und CI (dazu eine zweite App für die Freigabe, siehe unten). (a) wäre ein Übergang mit Umbau danach, (b) liefe unter Rafaels Account mit dauerhaften Tokens. Eine zentrale App für alle Instanzen geht nicht, werkbuch ist selbst gehostet.

**Epics.** (A) Das Epic entscheidet: ein dem Bot zugewiesenes Epic arbeitet er ganz ab, auf einem Branch mit einem PR; ein einzeln zugewiesener Task ist ein normaler Task, auch in einem Epic. (B) Der Parent entscheidet immer: jeder Task eines Epics landet auf dem Epic-Branch. *Gewählt A* *(Rafael)*: vorhersehbar, nichts bleibt hängen; B ließe einen einzelnen Task warten, bis das Epic fertig ist.

**Merge.** (a) Der Agent mergt (wie do-ticket heute mit `--admin`); (b) werkbuch mergt, wenn CI und Review auf demselben Commit grün sind. *Gewählt (b)* *(Rafael: „wenn alles passt soll gemergt werden“; Claude: nicht der Agent)*.

**Schutz vor einem Agenten, der mehr tut als erlaubt.** (a) Nur der Prompt verbietet Statuswechsel und Merge; (b) harte Sperren: werkbuch lehnt Statuswechsel über Run-Tokens ab, und auf GitHub gibt es zwei Apps, eine Agenten-App ohne Bypass und eine Review-App, die freigibt; das Ruleset (PR, Check `tests`, ein Approve) bleibt und erzwingt, dass nichts ohne grüne CI und Freigabe auf den Standard-Branch kommt; (c) eine App als Bypass-Akteur im Ruleset. *Gewählt (b)* *(Rafael)*: mit (a) und (c) könnte ein überlisteter Agent mit seinem eigenen Token mergen oder auf `main` pushen. Die zwei Manifest-Flows laufen nur einmal beim Einrichten.

**Regeln für die Agenten.** (a) Fest im Code; (b) frei in der UI; (c) drei Schichten: Vertrag im Code, Arbeitsregeln je Projekt und Typ in der UI mit mitgelieferten Standards, Code-Regeln im Repo (`CLAUDE.md`/`AGENTS.md`). *Gewählt (c)* *(Rafael)*: Ausgabeformat und Verbote müssen fest sein, weil der Ablauf daran hängt; was ein Projekt anders will (Nachweis, Testregeln, Schwerpunkte des Reviews), ändert ein Projekt-Admin ohne Release. Wiki-Seiten als Regelquelle fallen raus: jedes Mitglied mit `wiki.edit` könnte die Regeln ändern.

**Repo und Projekt.** *1:1* *(Rafael)*: je Projekt ein Monorepo, damit der Agent das ganze Projekt kennt; ein Repo gehört höchstens einem Projekt.

## 5. Begriffe

- **Runner:** eine Maschine mit dem Daemon `werkbuch-runner`, an eine Organisation gebunden.
- **Agent:** ein Bot (gibt es schon) mit eingeschalteter Agenten-Konfiguration (Runner-Pool, CLI, Anweisung, Limits). Ein Bot ohne sie bleibt ein reiner API-Bot wie heute.
- **Auftrag** (`agent_runs`): ein Lauf eines Agenten auf einem Runner. Typen: `task`, `correction`, `conflict`, `review`, `comment`.
- **Agenten-App / Review-App:** die zwei GitHub-Apps einer Instanz (11.3). Namen sind bei GitHub global eindeutig; der Manifest-Flow schlägt `<Organisation> werkbuch` bzw. `<Organisation> werkbuch review` vor, die Doku sagt nie `werkbuch[bot]`.
- **Strang** (`agent_threads`): die laufende Arbeit an einem Item oder Epic: Runner, Branch, Worktree, Claude-Session, PR. Aufträge eines Items bzw. Epics gehören zu einem Strang; er endet mit Merge, Schließen oder Abbruch.
- **Verknüpfung** (`work_item_links`): ein PR (später andere Ziele) an einem Item.

## 6. Runner-Protokoll

### 6.1 Verbindung und Authentifizierung

- Der Runner pollt. Ohne freien Platz fragt er nicht; ohne Auftrag wartet er 3 s, nach einer Minute ohne Auftrag 10 s (Builder darf die Werte setzen). Nur ausgehende HTTPS-Verbindungen.
- Die Routen liegen unter `/api/runner/*`, **nicht** unter `/api/v1` *(Claude)*: kein Teil der öffentlichen API, nicht im OpenAPI-Dokument, nicht in der MCP-Parität, nicht in der Routen-Matrix der Tokens. Fehler kommen als Problem Details (liegt unter `api/*`).
- **Runner-Token:** ein eigenes Geheimnis je Runner (gehasht gespeichert, widerrufbar), kein persönliches Token einer Person und kein Sanctum-Token eines Kontos *(Claude; Umsetzung Builder)*. Es darf nur das Runner-Protokoll. Eigene Drossel.
- **Protokollversion:** jede Anfrage schickt Runner-Version und Protokollversion; werkbuch antwortet bei abweichender Version mit der erwarteten (Selbst-Update, 8.3). Ein Runner mit zu altem Protokoll bekommt keine Aufträge.

### 6.2 Verbinden (Pairing)

1. Ein Org-Admin klickt in den Einstellungen „Runner verbinden“. werkbuch erzeugt einen Einmal-Code (10 Minuten, einmal einlösbar) und zeigt den Befehl `curl -fsSL <APP_URL>/runner/install.sh | sh -s -- --code <CODE>`.
2. Das Installationsskript (8.2) ruft `werkbuch-runner login <APP_URL> --code <CODE>`; der Runner schickt Code, Name (Hostname, änderbar), System, Architektur und Version und bekommt sein Runner-Token zurück. Es liegt im Keychain (`zalando/go-keyring` wie tussh), nie in der Config.
3. Die Seite zeigt den Runner sofort als verbunden (Live über den vorhandenen Kanal der Person bzw. erneutes Laden).

Ein abgelaufener oder benutzter Code ist eine klare Meldung im Terminal. Ein Runner kann in der Oberfläche umbenannt und widerrufen werden; widerrufen beendet seine laufenden Aufträge (wie Abbruch, 6.4).

### 6.3 Abholen

`POST /api/runner/claim` mit dem freien Platz des Runners (gesamt, je Repo, leichte Aufträge; Plätze aus werkbuch, siehe 9) und seiner Auslastung (8.6). Ein Runner nimmt Aufträge aller Projekte *(Rafael: keine Einschränkung)*, aber nur für CLIs, die er installiert und angemeldet hat (8.8). werkbuch wählt in einer Transaktion den nächsten passenden Auftrag (Reihenfolge und Regeln 9), setzt ihn auf `running` mit Lease (Ablauf = jetzt + Heartbeat-Fenster) und antwortet mit allem, was der Runner braucht:

- Auftrag: ID, Typ, Item (ID, Key, Titel), Projekt (Kennung), Strang (ID, Branch, Basis-Branch, Session-ID falls vorhanden), Zeitlimit.
- Prompt und System-Prompt, fertig gebaut von werkbuch (7.3).
- Run-Token für werkbuch-MCP (11.2) und, bei Projekten mit Repo, das GitHub-Installations-Token mit Repo-URL (11.3).
- CLI des Agenten und das Modell des Auftrags (7.7).

Ohne passenden Auftrag: `204`. Zwei Runner, die gleichzeitig abholen, bekommen nie denselben Auftrag (Zeilensperre, ein Test mit zwei Verbindungen).

### 6.4 Heartbeat, Ereignisse, Ergebnis, Abbruch

- **Heartbeat** etwa alle 15 s je laufendem Auftrag; verlängert das Lease. Die Antwort sagt, ob der Auftrag abgebrochen wurde; dann beendet der Runner den Prozess (SIGTERM, nach 10 s SIGKILL) und meldet `canceled`.
- **Ereignisse:** der Runner schickt das Protokoll des CLI (bei Claude die Zeilen von `--output-format stream-json`, gekürzt auf das Lesbare) gebündelt, höchstens etwa einmal je Sekunde. werkbuch speichert sie (Grenzen siehe 7.5) und stößt das Neuladen im Browser über den vorhandenen Live-Kanal des Items an, gedrosselt.
- **Ergebnis:** `status` (`succeeded`, `failed`), Session-ID, bei `review` das Urteil (`approve`/`changes`) mit Befunden als Markdown, bei `comment` die Antwort als Markdown, bei `task`/`correction` der gepushte Commit (SHA) und eine kurze Zusammenfassung, Nutzung (Tokens, falls das CLI sie meldet). werkbuch handelt danach (7.2), nicht der Agent.
- **Abbruch** in der Oberfläche (Item oder Runner-Seite) oder per API: der Auftrag wird `canceling`, der nächste Heartbeat sagt es dem Runner. Ein Auftrag ohne Heartbeat über das Lease hinaus wird `lost` und neu eingereiht (höchstens einmal, danach `failed`) *(Claude)*.
- **Zeitlimit:** fest im Code, nicht einstellbar *(Rafael: keine Grenzen in der Bot-Konfiguration)*: 60 Minuten für `task`/`correction`, 30 für `conflict`, 20 für `review`, 10 für `comment`. Darüber `timed_out`, wie `failed` behandelt, mit Grund am Item.
- **Token-Erneuerung:** GitHub-Tokens gelten eine Stunde; der Runner holt für einen laufenden Auftrag ein neues über `POST /api/runner/runs/{id}/git-token`, bevor es abläuft.

## 7. Aufträge und Ablauf eines Tickets

### 7.1 Auftragstypen

| Typ | Auslöser | Darf | Ergebnis |
|---|---|---|---|
| `task` | Item bzw. Epic dem Bot zugewiesen | Worktree, Commits, Push, PR öffnen, werkbuch lesen und schreiben | PR offen; kein Kommentar |
| `correction` | CI rot oder Review mit Befunden am PR des Bots; oder ein Mensch stellt das Ticket mit offenem Bot-PR auf einen Unstarted-Status; oder ein Mensch weist ein Ticket mit offenem Strang wieder dem Bot zu | wie `task`, gleicher Strang, Session fortgesetzt | neuer Push auf denselben PR |
| `conflict` | PR des Bots hat Konflikte mit seiner Basis (`mergeable_state: dirty`) | wie `correction` | Basis in den Branch gemergt, Konflikte gelöst, Push |
| `review` | alle Checks auf dem letzten Commit eines PRs des Repos eines Projekts grün | nur lesen (werkbuch und Repo) | Urteil; werkbuch kommentiert am Ticket und am PR und gibt bei `approve` über die Review-App frei |
| `comment` | eine Person erwähnt den Bot in einem Kommentar | nur lesen (Wiki, Items, Repo) | Antwort; werkbuch postet sie als Kommentar des Bots |

- Typen *(Rafael)*, Rechte *(Claude)*. Was ein Auftrag tun darf, erzwingen werkbuch und GitHub (11.2, 11.3), nicht nur der Prompt.
- **Was nie einen Auftrag auslöst** *(Claude, gegen Schleifen)*: Änderungen, die werkbuch im Ablauf selbst macht (Status, Zuweisung, die Selbstzuweisung der Epic-Kinder; erkannt am Actor `agent`, 7.2), Kommentare von Bots, Erwähnungen in Beschreibung oder Feldern (`bot.mentioned` mit `source` `description`/`values`), bearbeitete Kommentare, PRs und Pushes der Agenten-App selbst außer über die Regeln dieses Abschnitts.
- `conflict` *(Rafael: eigener Typ; Claude: Ausgestaltung)*: werkbuch prüft offene Bot-PRs nach jedem Push auf deren Basis-Branch (GitHub rechnet `mergeable` verzögert, werkbuch fragt nach) und vor jedem Merge-Versuch. Ein Konflikt geht vor CI und Review. Der Agent mergt die Basis in den Branch (kein Rebase, kein Force-Push; beim Squash-Merge stört der Merge-Commit nicht), löst die Konflikte, lässt die betroffenen Tests laufen und pusht; danach laufen CI und Review neu. Eigene Bremse: höchstens 2 `conflict` je Strang, zählen nicht zur Korrektur-Bremse. Bei PRs von Menschen kein Auftrag, nur ein Hinweis am PR und am Item.
- `review` startet immer mit frischer Session ohne Kontext der Umsetzung *(Claude)*.
- **PRs von Personen werden ebenso reviewt** *(Rafael)*, standardmäßig an (je Projekt abschaltbar), mit demselben Review-Agenten und denselben Arbeitsregeln, sobald CI auf dem Head-Commit grün ist; ein Entwurf nicht. Ergebnis *(Claude)*: `approve` → Freigabe über die Review-App (die Person kann danach ohne `--admin` mergen) und Kommentar am PR und an verknüpften Items; `changes` → GitHub-Review als Kommentar mit den Befunden (kein „Request changes“, das den Merge sperren würde) und Kommentar an verknüpften Items. werkbuch startet bei PRs von Personen keine Korrektur, keinen `conflict` und mergt nicht; den Status schaltet nur die PR-Zuordnung aus 12.
- `comment`: eine Erwähnung startet immer einen `comment`, nie Code-Änderungen. Wer Änderungen will, stellt das Ticket zurück (löst `correction` aus) *(Claude)*. Hat das Item einen offenen Strang, setzt der `comment` dessen Session fort (Kontext), sonst frisch.
- Projekte ohne Repo: `task` läuft in einem Arbeitsordner ohne Git, endet mit einer Zusammenfassung als Kommentar und dem Status „Nach Abschluss“ (7.4); kein PR, kein CI, kein Review *(Claude)*.

### 7.2 Ablauf

```
Bot zugewiesen ─► task (Status „In Arbeit“)
  └─ PR offen ─► Status „In Review“
       ├─ Konflikt mit der Basis ─► conflict ─► Push ─► (CI …)
       ├─ CI rot ────────────┐
       ├─ CI grün ─► review   │
       │    ├─ Befunde ───────┤─► Status „Korrektur“ ─► correction ─► „In Arbeit“ ─► Push ─► (CI …)
       │    └─ ok ─► Kommentar, Freigabe (Review-App) ─► werkbuch mergt ─► Status „Gemergt“ (Done)
       └─ Bremse (3 Korrekturen / 2 Konflikte) ─► Strang pausiert, Ticket an die Owner-Person
```

- **„Done“ erst nach dem Merge** *(Claude; Rafael hatte Done beim PR vorgeschlagen)*: Done setzt `closed_at` und Resolution, löst „Eltern schließen“ aus (ein Epic schlösse vor dem Merge), benachrichtigt und startet die Frist von Auto-Archiv.
- **Statuswechsel und Zuweisungen macht werkbuch**, über die vorhandenen Actions mit einem neuen `Actor::agent($bot)`: der Agent-Bot, `via` `automation`, Grund `agent`, **ohne** `on_behalf_of` (Rafael soll Benachrichtigungen über die Arbeit des Agenten bekommen; `causedBy` ließe die zuweisende Person aus) *(Claude)*. Mit Übergangsprüfung; ist ein Übergang im Workflow nicht erlaubt, bleibt der Status, und ein Kommentar sagt es (kein Abbruch des Ablaufs). Ereignisse mit Actor `agent` lösen nie einen Auftrag aus.
- **Agent sein darf** ein aktiver Bot mit verantwortlicher Person (Owner), der Mitglied des Projekts mit `item.edit` ist; nicht der Standard-Bot (er hat keinen Owner) *(Claude)*. Ohne diese Bedingungen bleibt eine Zuweisung eine normale Zuweisung, und ein Hinweis in der Oberfläche sagt warum.
- **CI-Ergebnis:** werkbuch hört `check_suite`/`check_run` der Agenten-App. Grün heißt: auf dem Head-Commit des PRs sind alle Check-Runs abgeschlossen und keiner `failure`, `cancelled`, `timed_out` oder `action_required` (wie do-ticket: alle Checks, nicht nur der Pflicht-Check). Rot, sobald einer scheitert, auch wenn andere noch laufen *(Claude)*. Ergebnisse alter Commits zählen nicht. Ein Repo ohne jeden Check gilt zwei Minuten nach dem Push als grün *(Claude)*. Den Log-Auszug für `correction` liest werkbuch über die Actions-API (`actions: read`).
- **Review** läuft je Head-Commit einmal; ein neuer Push macht ein laufendes Review hinfällig (Abbruch, neues Review nach neuer CI).
- **Freigabe und Merge:** Ist das Review `approve`, gibt die Review-App den PR auf diesem Head-Commit frei (GitHub-Review „approve“ mit den Befunden als Text). Dann mergt werkbuch über die Agenten-App, wenn auf demselben Head-Commit CI grün ist und der PR mergebar ist. Methode je Projekt (Standard Squash), Branch danach löschen. Das Ruleset des Repos (PR nötig, Check `tests`, ein Approve) bleibt unverändert und ohne Bypass; GitHub selbst verhindert so jeden Merge ohne grüne CI und Freigabe (11.3). Scheitert der Merge wegen eines Konflikts, wird es ein `conflict`, sonst ein Kommentar und Status „Korrektur“.
- **Bremsen:** höchstens 3 `correction` und 2 `conflict` je Strang (je Projekt einstellbar). Danach ist der Strang **pausiert** (PR, Branch, Worktree und Session bleiben): Status „Korrektur“, Assignee die Owner-Person des Bots, Kommentar mit dem letzten Befund. Diese Zuweisung beendet den Strang nicht (Actor `agent`).
- **Fehlgeschlagener Auftrag** (`failed`, `timed_out`, `lost` zum zweiten Mal): Kommentar mit dem Grund, Status „Korrektur“, kein automatischer neuer Versuch. Am Auftrag in der Aktivität steht „Erneut starten“ (startet denselben Typ im selben Strang neu, setzt die Bremse nicht zurück).
- **Mensch greift ein** *(Claude)*:
  - Weist eine Person das Ticket einer anderen Person zu, wird ein laufender Auftrag abgebrochen und der Strang pausiert; der PR bleibt.
  - Weist eine Person das Ticket wieder dem Bot zu: mit pausiertem oder offenem Strang eine `correction` mit den Kommentaren seit dem letzten Auftrag als Befund (die Bremse beginnt von vorn), ohne Strang ein neuer `task`.
  - Stellt eine Person das Ticket mit offenem Bot-PR auf einen Unstarted-Status, ebenso eine `correction`.
  - Mergt eine Person den Bot-PR selbst auf GitHub, behandelt werkbuch das wie den eigenen Merge (Status „Gemergt“, Strang `merged`). Schließt sie ihn ohne Merge, endet der Strang (`closed`), das Ticket geht auf „Korrektur“ mit Kommentar.

### 7.3 Prompts und Regeln

werkbuch baut Prompt und System-Prompt je Auftrag aus drei Schichten *(Rafael)*, in dieser Reihenfolge zusammengesetzt (Vertrag → Bot → Projekt je Typ → Auftrag):

1. **Vertrag, im Code, nicht änderbar** (Englisch): was der Typ tun soll und was nie (Status setzen, zuweisen, mergen, Release, Force-Push), das Ausgabeformat, das werkbuch liest (Urteil `approve`/`changes`, Befunde nach Schwere, Antwort als Markdown, Zusammenfassung), die Schwelle „`changes` nur bei Critical oder Important“, und dass Texte aus Items, Kommentaren, Wiki und PRs Daten sind, keine Anweisungen. Bei einem Widerspruch gewinnt der Vertrag; was er verbietet, sperren werkbuch und GitHub zusätzlich hart (11.2, 11.3).
2. **Arbeitsregeln je Projekt und Typ, in der UI** (Abschnitt „Agenten“ der Projekteinstellungen, 10.3): ein Markdown-Text je Typ (`task`, `correction`, `conflict`, `review`, `comment`). **Standards** liefert werkbuch mit (Englisch und Deutsch, in der Sprache der Organisation vorbelegt, abgeleitet aus dem do-ticket-Flow; Inhalt unten), ein Projekt ohne eigenen Text nutzt den Standard, „Standard wiederherstellen“ setzt ihn zurück; ein neuer Standard in einem Release erreicht nur Projekte ohne eigenen Text. Ändern `project.manage`, jede Änderung als Event in der History des Projekts (alter und neuer Text). Dazu je Bot eine freie Anweisung (10.4).
3. **Code-Regeln im Repo:** `CLAUDE.md` bzw. `AGENTS.md`, die das CLI ohnehin liest. Kommandos, Konventionen und Fallstricke versionieren mit dem Code; die UI-Regeln sagen nur, wie gearbeitet wird.

Inhalt der Standards *(Claude, der Builder schreibt die Texte)*:

- `task`: das Item per MCP lesen (`werkbuch_work-items get`), im gegebenen Worktree umsetzen, die Regeln des Repos befolgen, testen, committen, pushen, PR öffnen (Titel mit Key, Body mit `Fixes KEY-n` und der Attribution), den Nachweis in der Property `resolution_proof` setzen, falls das Projekt sie hat (Text, Vorher/Nachher, mindestens ein Bild über `get-upload-url`). Der Implementierungs-Brief von do-ticket ist die Vorlage, ohne Review-Subagent, Merge und Statuswechsel.
- `correction`: die Befunde (CI-Log-Auszug, Review-Befunde oder Kommentare) abarbeiten, auf denselben Branch pushen, den Nachweis an den neuen Stand anpassen.
- `conflict`: Basis hineinmergen, Konflikte im Sinn beider Seiten lösen, betroffene Tests laufen lassen, pushen.
- `review`: unvoreingenommen, nur Ticket-Ziel und PR; gründlich auf Regressionen, Tests, die nur die Umsetzung spiegeln, Barrierefreiheit, Doku, Abnahme des Tickets; Befunde mit `datei:zeile`, Problem und Vorschlag; keine Tests gegen die Datenbank.
- `comment`: kurz und direkt aus Wiki, Items und Code des Projekts antworten, Quellen nennen.

Epics (7.6) bekommen dazu den Kontext des Epics und der Geschwister.

### 7.4 Status je Workflow

Im Workflow-Editor (Organisation → Workflows, Abschnitt „Agenten“) stellt ein Org-Admin ein, welcher Status des Workflows für welchen Schritt gesetzt wird *(Rafael: einstellbar; 2026-11-23: am Workflow statt je Projekt, damit es nicht jedes Projekt einrichten muss)*. Alle Projekte des Workflows nutzen diese Schritte, auch für PRs von Personen (12). werkbuch prüft die Kategorie:

| Schritt | Kategorie | Vorschlag |
|---|---|---|
| In Arbeit | Started | „In Progress“ |
| In Review | Started | eigener Status „In Review“ (im Workflow anlegen; im Standard-Workflow ginge „Pending“) |
| Korrektur | Unstarted oder Backlog | „Todo“ |
| Gemergt bzw. nach Abschluss (ohne Repo) | Completed | „Done“ |

- Der Editor schlägt je Schritt einen Status nach Name und Kategorie vor; gespeichert wird erst, was jemand übernimmt.
- Hat ein Workflow keine (vollständigen) Schritte, sind die Agenten in seinen Projekten aus (kein Auftrag startet, die Zuweisung an den Bot bleibt eine normale Zuweisung; Projekt → Agenten sagt warum und verweist auf den Editor; ohne Katalogrecht mit dem Hinweis, dass ein Org-Admin es einrichtet) *(Claude)*.
- Ein Workflow-Wechsel eines Projekts bringt die Schritte des neuen Workflows mit; fehlen sie dort, sind die Agenten aus, und der Dialog sagt es vorher.
- Entfernt `SaveWorkflow` einen Status, der einen Schritt belegt, folgt der Schritt der Status-Zuordnung (`state_mapping`), wenn deren Ziel die Kategorie erfüllt, sonst wird er geleert (Hinweis vor dem Speichern). Eine Kategorie-Änderung eines belegten Status ist 422 am Status.

### 7.5 Aufträge in werkbuch

- Tabelle `agent_runs`: Typ, Status (`queued`, `waiting`, `running`, `canceling`, `succeeded`, `failed`, `canceled`, `timed_out`, `lost`), Agent (Bot), Runner, Item, Strang, Head-Commit (bei `review`), Auslöser (Event), Versuch, Lease, Start, Ende, Ergebnis (Urteil, Text), Session-ID, Nutzung (falls gemeldet), Fehler.
- Ereignisse eines Auftrags in einer eigenen Tabelle, höchstens 2 000 Zeilen oder 1 MB je Auftrag (darüber werden die ältesten verdichtet, Builder), aufgeräumt nach 30 Tagen (stündlicher Job, wie Zustellungen).
- Events in der Outbox (History, Live, Webhooks): `agent_run.queued`, `agent_run.started`, `agent_run.finished` (mit Status) am Item; der Verlauf zeigt sie. Ob sie Webhooks auslösen, entscheidet der Builder (Standard nein, wie die Katalog-Events). Ereignisse des Protokolls (6.4) gehen **nicht** durch die Outbox.
- `agent_threads`: Item (bzw. Epic), Runner, Branch, Basis-Branch, Worktree-Name, Session-ID, PR, Korrekturen, Status (`open`, `paused`, `merged`, `closed`), Zähler der Korrekturen und Konflikte.

### 7.6 Epics (Regel A)

- Ist ein Epic dem Bot zugewiesen, entsteht ein Strang am Epic mit Branch `agent/<KEY>-<slug>` vom Standard-Branch. Die offenen Kinder (nicht Completed/Canceled), die niemandem oder dem Bot gehören, werden in Rang-Reihenfolge nacheinander je ein `task` desselben Strangs; der Bot weist sich jedes Kind beim Start selbst zu (Actor `agent`, löst keinen eigenen Auftrag aus). Weist eine Person ein Kind eines laufenden Bot-Epics dem Bot zu, hängt es sich an den Strang (kein eigener Branch).
- Kinder, die einer Person gehören, bleiben ihre; diese Person pusht ihre Arbeit selbst auf den Epic-Branch. Der PR wird bereit, wenn kein Kind mehr offen ist: Kinder des Bots stehen dann auf „In Review“, Kinder von Personen sind Completed oder Canceled. Weil die Kinder des Bots bis zum Merge auf „In Review“ (Started) stehen, schließt „Eltern schließen“ das Epic nicht vor dem Merge.
- Je Kind darf der Agent einen Teil-Branch nutzen, der lokal in den Epic-Branch gemergt wird; gepusht wird nur der Epic-Branch *(Rafael)*. Nach dem ersten Kind öffnet der Agent einen **Entwurfs-PR** auf den Standard-Branch.
- CI und Review laufen erst, wenn alle Kinder fertig sind und werkbuch den PR auf bereit stellt; Ergebnisse vorher zählen nicht. Kinder stehen bis dahin auf „In Review“.
- Merge: Epic und alle Kinder (ohne Canceled) werden „Gemergt“.
- Ein einzeln zugewiesener Task in einem Epic ist ein normaler Task mit eigenem Branch und PR *(Rafael)*.
- Ein Epic läuft in sich immer nacheinander (ein Branch, ein Worktree).

### 7.7 Modell je Auftrag

*(Rafael: nicht jeder Auftrag braucht das stärkste Modell; Claude: über Labels)*. werkbuch wählt das Modell beim Einreihen, das erste passende gewinnt:

1. **Modell-Label des Items:** systemweit *(Rafael, 2026-11-23, ersetzt die Zuordnung je Projekt)*. Ein Label des Katalogs der Organisation kann ein Modell tragen (optionales Feld „Modell für Agenten“, eine Wahl aus der Liste, etwa `haiku`); wer im Label-Dialog ein Modell wählt, bekommt den Namen `<Modell> Agent` vorgeschlagen („Haiku Agent“, „Opus Agent“, „Fable Agent“). Erkannt wird über das Feld, nie über den Namen (umbenennen oder übersetzen bricht nichts). Trägt ein Item mehrere Modell-Labels, gewinnt das erste in Katalog-Reihenfolge. Ein Kind eines Epics ohne Modell-Label nimmt das des Epics.
2. **Projekt je Auftragstyp** (etwa `review` → `opus`, `comment` → `haiku`).
3. **Bot je Auftragstyp**, dann der Standard des Bots.

- Labels statt eines eigenen Felds am Item: sie gelten in allen Projekten, lassen sich schon beim Anlegen, aus Vorlagen, per Mehrfachbearbeitung und per MCP setzen und filtern; ein neues Item-Feld liefe durch Resource, REST, Vorlagen und das ausgeschöpfte MCP-Budget von `work-items`.
- Das Modell kommt aus einer **festen Liste je CLI** *(Rafael: keine freien Namen)*, gepflegt im Code und mit Releases von werkbuch erweitert (Claude Code etwa `haiku`, `sonnet`, `opus`, `fable`; Codex dessen Namen). Alle Modellfelder sind Selects; wechselt das CLI und gibt es das gewählte Modell dort nicht, gilt der Standard des CLI (mit Hinweis). Der Runner reicht es durch (`--model` bzw. `-m`); lehnt das CLI es ab, scheitert der Auftrag mit dem Grund.
- Am Auftrag stehen das gewählte Modell und woher es kam (Label, Projekt, Bot) und, falls gemeldet, der Verbrauch.
- Eine automatische Wahl (ein kleines Modell schätzt das Ticket ein) ist ein Nicht-Ziel von v1.

### 7.8 Session

- Claude Code headless: `claude -p --output-format stream-json --verbose`, Session fortsetzen mit `--resume <session-id>`; Codex: `codex exec` bzw. `codex exec resume <id>`. Sessions liegen auf der Maschine und hängen am Arbeitsordner: der Worktree lebt je Strang bis zu dessen Ende.
- `correction` und `comment` an einem offenen Strang setzen dessen Session fort; `review` nie.

## 8. Der Runner

### 8.1 Aufbau

- `werkbuch-runner daemon` läuft dauerhaft (launchd auf macOS, systemd-User-Unit auf Linux), hält die Verbindung, startet Aufträge, hört auf einem Unix-Socket für die TUI (wie skilltri). Ein Aufruf ohne Argumente öffnet die TUI; startet keinen Daemon, wenn keiner läuft, sondern sagt es (Builder darf anders).
- Befehle (Vorschlag, Builder): `login`, `daemon`, `status`, `doctor`, `logout`, `update`, `version`.
- Dateien wie tussh und skilltri: Config `~/.config/werkbuch-runner/config.yaml`, Zustand und Logs `~/.local/state/werkbuch-runner`, Repos und Worktrees `~/.local/share/werkbuch-runner`, Geheimnisse im Keychain.
- Adapter je CLI hinter einer Schnittstelle: v1 Claude Code und Codex (Codex darf als zweites folgen, wenn er den ersten Wurf sprengt, Builder). Ein Adapter baut den Aufruf, liest das Protokoll in Ereignisse, holt Session-ID und Nutzung heraus.
- MCP für den Agenten: der Runner schreibt je Auftrag eine MCP-Konfiguration in ein privates Temp-Verzeichnis (0600) mit werkbuch (`<APP_URL>/mcp`, Bearer Run-Token, Servername `werkbuch-run`) und hängt sie **zusätzlich** zur Ausstattung der Maschine an (8.7; Claude `--mcp-config` ohne `--strict-mcp-config`, Codex und andere im Format ihres CLI).
- Git: je Repo ein Bare-Mirror, je Strang ein Worktree; Klonen und Push über HTTPS mit dem Installations-Token (Credential-Helper bzw. Umgebung des Auftrags, nie in `.git/config` geschrieben). `gh` bekommt `GH_TOKEN` desselben Tokens. Commit-Identität: der Bot (Name, `<bot-handle>@users.noreply.<host>` o. ä., Builder) bzw. die App.
- Aufräumen: Worktree eines beendeten Strangs nach einer Frist (Standard 3 Tage) entfernen, samt Teardown-Hook.

### 8.2 Installation

- `GET /runner/install.sh` (öffentlich, ohne Geheimnis): erkennt System (`darwin`, `linux`) und Architektur (`arm64`, `amd64`), lädt `GET /runner/download/<os>/<arch>` von derselben Instanz, prüft die SHA-256-Summe aus `GET /runner/download/<os>/<arch>.sha256`, legt das Binary nach `~/.local/bin/werkbuch-runner`, ruft `login` mit dem Code, richtet den Dienst ein und startet ihn. Ein zweiter Aufruf mit neuem Code verbindet neu (anderer Name oder andere Instanz) ohne Doppel-Dienst.
- Downloads ohne Anmeldung (das Binary ist kein Geheimnis), mit eigener Drossel.
- macOS: kein Notarisieren nötig (`curl` setzt kein Quarantäne-Attribut, Go signiert arm64 ad hoc). Statische Binaries ohne cgo (go-keyring nutzt unter macOS `security`).
- In DDEV baut ein Kommando den Runner für die Entwicklung (Go per mise auf dem Mac oder im Container, Builder) und legt ihn dorthin, wo die Routen ihn finden.

### 8.3 Image und Updates

- Eine Build-Stage im `Dockerfile` (Go-Image per Tag und Digest wie die anderen Basen, auf `$BUILDPLATFORM`) baut die vier Binaries mit der Version per `-ldflags`; die App-Stage kopiert sie samt Prüfsummen an einen festen Ort außerhalb von `public/`. `ImageTest` hält Stage, Pins und Ort fest, der Smoke lädt Skript und Binary herunter und prüft die Summe.
- Selbst-Update: meldet werkbuch eine andere Version, lädt der Runner sein neues Binary von der Instanz, prüft die Summe, ersetzt sich atomar und startet neu, sobald keine Aufträge laufen; neue Aufträge holt er bis dahin nicht. Ein gescheitertes Update lässt den alten Runner weiterlaufen und zeigt es in TUI und Oberfläche.

### 8.4 Konfiguration: in werkbuch, nicht im Runner

*(Rafael: alles einfach halten; konfiguriert wird in werkbuch)*

- **Auf dem Runner** liegt nur, was an der Maschine hängt: Instanz-URL und Runner-Token (aus `login`, Token im Keychain). `claude`/`codex` findet er über `PATH`; „Doctor“ meldet, wenn eins fehlt oder nicht angemeldet ist.
- **In werkbuch** (Runner-Seite, 10.1): Name, Plätze (gesamt Standard 2, je Repo Standard 1, leichte Aufträge Standard 2). Der Runner bekommt sie mit jeder Antwort auf Abholen bzw. Heartbeat; Änderungen gelten ohne Neustart.
- **In werkbuch je Projekt** (10.3): optionale Setup- und Teardown-Befehle, die der Runner nach dem Anlegen bzw. vor dem Entfernen eines Worktrees ausführt (für werkbuch etwa ein eigener DDEV-Projektname je Worktree, `ddev start`, `ddev delete -Oy`). Projekte ohne Repo laufen in einem Ordner je Strang.
- Keine Einschränkung auf Projekte: jeder Runner nimmt Aufträge aller Projekte.

### 8.5 TUI

- Bubble Tea, Bubbles, Lip Gloss wie skilltri und tussh; dieselbe 16-Farben-Palette (`styles.go` als Vorbild), Tabs, Tastenhilfe *(Rafael: einheitlich; Claude: Lesart „gleicher Stil“)*. Kein gemeinsames Go-Modul der drei Tools in v1.
- Tabs (Vorschlag): **Status** (Verbindung, Instanz, Version, Plätze aus werkbuch, laufende Aufträge, **Auslastung** 8.6 mit kleinen Verläufen der letzten Minuten), **Aufträge** (laufende und letzte, Protokoll live, Abbrechen), **Doctor** (Claude/Codex installiert und angemeldet, Git, Keychain, Erreichbarkeit der Instanz). Keine Einstellungen in der TUI außer Abmelden; ein Hinweis zeigt, wo in werkbuch konfiguriert wird.

### 8.6 Auslastung

*(Rafael)* Der Runner misst CPU (gesamt in Prozent), GPU (Auslastung in Prozent, wo das System sie ohne Root liefert, auf Apple Silicon über IOKit; sonst „nicht verfügbar“), RAM (belegt/gesamt) und Speicher (frei/gesamt des Datenträgers seines Datenordners), alle 5 s. Er zeigt sie in der TUI und schickt den letzten Stand mit jedem Heartbeat bzw. Abholen an werkbuch, das ihn auf der Runner-Seite zeigt (10.1). werkbuch speichert nur den letzten Stand, keinen Verlauf. Messung ohne cgo (Builder wählt die Bibliothek, etwa gopsutil, oder Systembefehle). *(Claude: auch in werkbuch, weil es dort ohne Zugriff auf die Maschine nützt.)*

### 8.7 Ausstattung der Maschine: MCP-Server, Skills, Plugins

*(Rafael, 2026-11-23: kein Katalog in werkbuch; Einrichtung auf dem Runner, wie der Betreiber will; werkbuch setzt kein bestimmtes Tool voraus)*

- MCP-Server, Skills, Plugins und Hooks des Agenten sind Ausstattung der Maschine, wie der Login des CLI: eingerichtet für den Benutzer, unter dem der Runner läuft, so, wie der Betreiber seine Harnesses einrichtet (von Hand oder mit einem Werkzeug seiner Wahl; werkbuch setzt keins voraus). Empfohlen ist ein eigener macOS-Benutzer für den Runner (11.1); dann gehört alles, was dort eingerichtet ist, dem Runner, und nichts Persönliches (Hooks der Zeiterfassung, die eigene `~/.claude/CLAUDE.md`) läuft mit.
- Skills und Regeln, die zum Code gehören, kommen aus dem Repo (`CLAUDE.md`/`AGENTS.md`, `.claude/skills`), wie 7.3.
- werkbuch selbst hängt der Runner je Auftrag dazu (8.1). Hat die Maschine einen weiteren Zugang zu werkbuch (etwa ein MCP-Server mit einem persönlichen Token), handelte ein Agent damit an Run-Token und Sperre (11.2) vorbei: „Doctor“ warnt davor (der Runner fragt die MCP-Liste des CLI ab und sucht Server, die die Instanz erreichen) und nennt den Server, den der Betreiber für den Runner abschalten sollte. Merges schützt das Ruleset ohnehin (11.3).
- Der Runner meldet mit dem Heartbeat die Namen der MCP-Server, Skills und Plugins seines Harness; die Runner-Seite in werkbuch zeigt sie nur zum Lesen (10.1), „Doctor“ in der TUI ebenso.

### 8.8 CLIs des Runners

*(Claude, auf Rafaels Frage, was bei einem fehlenden CLI passiert)*

- Der Runner meldet mit jedem Heartbeat bzw. Abholen seine CLIs: installiert (Pfad), Version, angemeldet ja/nein. Die Runner-Karte zeigt sie, „Doctor“ ebenso.
- Vergeben wird ein Auftrag nur an einen Runner, der das CLI des Agenten installiert und angemeldet hat. Hat kein Runner im Pool des Agenten es, wartet der Auftrag (`waiting`) mit dem Grund „Kein Runner im Pool hat <CLI>“ (am Item sichtbar) und startet von selbst, sobald einer es meldet.
- Beim Einrichten des Agenten (10.4) steht an einem CLI, das kein Runner im Pool meldet, „Auf keinem Runner im Pool verfügbar“; speichern geht trotzdem.

## 9. Parallelität

| Ebene | Wo | Standard |
|---|---|---|
| Runner gesamt | werkbuch, Runner-Seite | 2 |
| je Repo auf dem Runner | werkbuch, Runner-Seite | 1 (DDEV teilt die Test-Datenbank) |
| leichte Aufträge (`comment`, `review`) | werkbuch, Runner-Seite, eigener Topf | 2 |

- Ein Epic läuft in sich nacheinander.
- `review` gilt als leicht, solange es keine Tests gegen die Datenbank fährt (Prompt). *(Claude)*
- Reihenfolge der Vergabe: `correction` und `review` vor `task` und `comment`, dann Priorität des Items, dann Alter *(Claude)*.
- **Mehrere Runner je Agent:** ein Pool. `task`, `review` und `comment` an einem Item ohne offenen Strang nimmt der erste freie Runner; `correction` und `comment` an einem offenen Strang gehen an dessen Runner. Ist er länger als eine einstellbare Frist offline (Standard 30 Minuten), übernimmt ein anderer mit frischer Session auf dem Branch, der Strang zieht um *(Claude)*. Solange wartet der Auftrag (`waiting`).

## 10. Oberfläche in werkbuch

### 10.1 Organisation → Betrieb → „Runner“

Liste der Runner (Name, online/offline nach letztem Kontakt, Version, System, Plätze belegt/gesamt, Auslastung CPU/GPU/RAM/Speicher (8.6), Ausstattung nur zum Lesen (8.7), CLIs mit Version und Anmeldung (8.8), laufende Aufträge mit Item und Abbrechen), Plätze bearbeiten (gesamt, je Repo, leichte Aufträge), „Runner verbinden“ (Dialog mit Befehl, Kopieren, Ablauf des Codes), Umbenennen, Widerrufen mit Rückfrage. Nur Org-Admins, wie Webhooks.

### 10.2 Organisation → Betrieb → „GitHub“

„Mit GitHub verbinden“ führt einmalig durch zwei Manifest-Flows (Agenten-App, dann Review-App; Name, Berechtigungen, Webhook-URL und Rückweg vorbelegt) und die Installation beider Apps auf denselben Repos (Auswahl bei GitHub; Repos kommen später über die Installationen bei GitHub dazu). Danach: Zustand beider Apps und Installationen, freigegebene Repos (nur Repos, auf denen beide installiert sind, sind wählbar), Hinweis zum Ruleset (PR, Check, ein Approve, kein Bypass), Trennen. Private Keys und Webhook-Secrets verschlüsselt mit `APP_KEY`, nie in Antworten.

### 10.3 Projekt → „Agenten“ (neuer Abschnitt der Projekteinstellungen)

Repo (aus den freigegebenen Repos, oder keins; ein Repo gehört höchstens einem Projekt, eindeutig in der Datenbank), Basis-Branch, Merge-Methode, Setup- und Teardown-Befehle des Worktrees (8.4), Review-Agent (ein Bot, für PRs von Menschen und Bots), die Schritte des Workflows nur zum Lesen mit Link in den Editor (7.4), Bremsen (Korrektur, Konflikt), Modell je Auftragstyp (7.7), Review für PRs von Personen an/aus (Standard an), Kommentar am PR an/aus (Standard an), die Arbeitsregeln je Typ (7.3, mit Standard und „Standard wiederherstellen“). Lesen jeder im Projekt, ändern `project.manage`.

### 10.4 Organisation → Bots → Agent

Je Bot: Agent an/aus, Runner-Pool (Mehrfachauswahl), CLI, Standard-Modell und Modell je Auftragstyp (7.7), Anweisung (Text). Keine eigenen Plätze oder Zeitlimits je Bot (9, 6.4). Org-Admins.

### 10.5 Item

- **Aktivität:** jeder Auftrag ist eine Zeile (Typ, Agent, Runner, Status, Dauer); aufgeklappt das Protokoll, live während des Laufs; „Abbrechen“ für wer das Item ändern darf. Ergebnisse von `review` und `comment` sind Kommentare des Bots (normale Kommentare, mit Hinweis „Auftrag …“).
- **Abschnitt „Pull Requests“** (neben Relationen): verknüpfte PRs mit Nummer, Titel, Zustand (offen, Entwurf, gemergt, geschlossen), CI-Zustand, Review-Urteil, Link zu GitHub.
- Ein Chip „Agent arbeitet“ am Kopf, solange ein Auftrag läuft.
- Was ein Agent am Item ändert, sieht und hört man wie bei einer Person (History, Benachrichtigungen, Live).

### 10.6 Bereits vorhandenes

Tastatur (jede neue Aktion mit Kürzel bzw. Weg im Tastatur-Manifest), axe für jede neue Seite und jeden Dialog, beide Sprachen, Doku-Screenshots wo die Konzeptseiten sie zeigen.

## 11. Sicherheit

### 11.1 Maschine

Der Agent läuft unbeaufsichtigt mit den Rechten des Nutzers, unter dem der Runner läuft (Claude mit `--permission-mode` für unbeaufsichtigte Läufe, Builder wählt den engsten, der den Flow trägt). Die Maschine ist die Grenze; die Doku empfiehlt einen eigenen macOS-Benutzer ohne Admin-Rechte und ohne Zugang zu privaten Daten. Texte aus Items, Kommentaren, Wiki und PRs sind Daten (Prompt-Injection: der Prompt sagt es; die Tokens begrenzen, was ein überlisteter Agent tun kann).

### 11.2 werkbuch-Tokens

- Runner-Token: nur das Runner-Protokoll.
- Run-Token: je Auftrag ein persönliches Token **des Bots** mit Ablauf = Zeitlimit des Auftrags (plus Puffer), widerrufen beim Ende, als Run-Token gekennzeichnet (Bezug auf den Auftrag). Fähigkeiten: `task`, `correction`, `conflict` `read`, `write`, `mcp`; `review`, `comment` `read`, `mcp` *(Claude)*. Ergebnisse von `review` und `comment` postet werkbuch selbst. Der Bot sieht nur, was seine Projektrollen erlauben.
- **Harte Sperre** *(Rafael)*: mit einem Run-Token lehnen die Actions ab, was der Ablauf werkbuch vorbehält: Status- und Typwechsel (`TransitionWorkItem`, `state_id` in `UpdateWorkItem` und der Mehrfachbearbeitung, `ChangeWorkItemType`), Zuweisung, Archivieren, Wiederherstellen, Löschen, Beobachten, Relationen entfernen, alles an Projekten, Katalogen, Personen, Tokens, Webhooks, Automatisierungen, Vorlagen; erlaubt bleiben Lesen, Werte und Beschreibung eines Items (der Nachweis), Kommentare, Anhänge, Relationen hinzufügen und Wiki-Seiten. Ablehnung 403 mit eigenem Grund (`agent_forbidden`). Der Builder legt die Liste in der Rechte-Matrix fest (eine Spalte „Run-Token“).
- Run-Tokens erscheinen nicht in der Token-Liste der Oberfläche als normale Tokens (eigene Kennzeichnung, Builder), nie in Events, Logs oder Protokollen.

### 11.3 GitHub-Tokens

- **Zwei Apps** *(Rafael)*: Die **Agenten-App** (`contents: write`, `pull_requests: write`, `checks: read`, `actions: read`, `metadata`; Webhooks für PRs, Pushes, Checks) pusht, öffnet PRs und mergt. Die **Review-App** (`pull_requests: write`, `contents: read`, `metadata`; keine Webhooks) gibt nur frei und kommentiert Reviews. Keine der beiden steht als Bypass im Ruleset.
- Installations-Tokens der Agenten-App je Auftrag, beschränkt auf das eine Repo und die Rechte des Typs: `task`/`correction`/`conflict` `contents: write`, `pull_requests: write`, `checks: read`; `review`/`comment` `contents: read`, `pull_requests: read`. Das Token des Agenten kann zwar mergen, aber das Ruleset verlangt grüne Checks und eine Freigabe, die nur die Review-App gibt, und die gibt nur werkbuch nach einem `approve` auf genau dem Head-Commit. Merge, Freigabe, Kommentare am PR und Statusabfragen macht werkbuch mit eigenen kurzlebigen Tokens. `workflows: write` nur, falls Agenten Workflow-Dateien ändern sollen (Standard nein, Builder klärt).
- **Zu prüfen, bevor gebaut wird** (erstes Ticket, Spike): ob GitHub die Freigabe einer App für „ein Approve nötig“ im Ruleset zählt, und ob „Dismiss stale approvals“ sie bei neuem Push verwirft (gewünscht). **Fallback**, falls sie nicht zählt: eine dritte, nur von werkbuch genutzte Merge-App als Bypass-Akteur des Rulesets; Agenten-Tokens kommen nie von ihr.

### 11.4 Eingehende Webhooks

`POST /github/webhook` (außerhalb von `/api/v1`), Signatur `X-Hub-Signature-256` mit dem Secret der App, sonst 401; idempotent über die Delivery-ID; verarbeitet in der Queue (eigener Konsument bzw. Job, Builder), Antwort sofort.

## 12. PR-Verknüpfung

Vorbild sind itsaplan (feste Wörter, Checks je Link) und Plane (Status je PR-Zustand); deren Sync von Issues und Kommentaren mit GitHub, persönliche GitHub-Accounts und Admin-Tokens übernimmt werkbuch nicht *(Rafael)*.

**Erkennung** *(Rafael)*: werkbuch liest Titel und Beschreibung des PRs und den Namen seines Head-Branches, bei jedem Öffnen, Bearbeiten und Push. Es zählen nur Keys des Projekts, zu dem das Repo gehört (auch frühere Kennungen); groß oder klein egal.

| Im PR | Wirkung |
|---|---|
| `fix`/`fixes`/`fixed`/`fixing`, `close`/`closes`/`closed`/`closing`, `resolve`/`resolves`/`resolved`/`resolving` vor einem oder mehreren Keys | verknüpft, **schließt** beim Merge |
| `ref`/`refs`/`references`, `part of`, `relates to`/`related to` vor Keys | verknüpft, schließt nie |
| `skip`/`ignore` vor Keys | nicht verknüpfen (hebt eine Verknüpfung aus Branch oder anderem Text auf) |
| ein Key ohne Wort, im Text oder im Branch-Namen | verknüpft, schließt nie |

- Syntax: Wort, optional Doppelpunkt, dann Keys getrennt durch Komma oder `and` (`Fixes WEBU-12, WEBU-13`, `Closes: WEBU-12 and WEBU-14`). Die Wortliste steht im Code (Englisch, wie GitHubs eigene Schlüsselwörter), nicht in der UI. Nicht in Code-Blöcken des Bodys.
- PRs des Agenten verknüpft ihr Strang ohnehin; ihr Body trägt `Fixes KEY-n` (Standard der Arbeitsregeln).
- Eine Verknüpfung, deren Key aus Titel, Body und Branch verschwindet, bleibt (wie bei Relationen), außer `skip` hebt sie auf.

**Wirkung und Status** *(Rafael: auch für PRs von Personen)*:
- **Entwürfe lösen nichts aus** (weder Status noch Review), sie werden nur verknüpft und angezeigt.
- **PR geöffnet bzw. aus dem Entwurf bereit:** jedes verknüpfte Item in einem Backlog- oder Unstarted-Status geht auf „In Review“ (7.4). Items in Started bleiben (wer schon arbeitet, verliert nichts), Completed/Canceled bleiben.
- **PR in den Basis-Branch des Projekts gemergt:** Items, die der PR **schließt**, gehen auf „Gemergt“, aber nur, wenn am Item kein anderer offener (auch Entwurfs-)PR hängt; Completed/Canceled bleiben. Items, die er nur verknüpft, bleiben.
- **PR ohne Merge geschlossen:** bei PRs von Personen keine Statusänderung; bei PRs des Agenten 7.2.
- Statuswechsel mit Actor `agent` des Review-Agenten des Projekts (7.2) bzw. eines eigenen Systems-Actors, wenn das Projekt keinen hat (Builder); mit Übergangsprüfung wie 7.2. Ohne Agenten-Schritte am Workflow (7.4) wird nur verknüpft.
- **Kommentar am PR** *(Rafael)*: bei einer neuen Verknüpfung schreibt die Agenten-App einen Kommentar mit Link auf die Items (einer je PR, wird aktualisiert), je Projekt abschaltbar, standardmäßig an.

**Daten** *(Rafael: Checks als eigene Tabelle)*:
- `work_item_links`: Item, Art (`pull_request`), Repo, Nummer, Titel, URL, Zustand (`open`, `merged`, `closed`), Entwurf, Head- und Basis-Branch, Head-Commit, `closes`, Review-Urteil (je Head-Commit), Stempel; eindeutig je Item, Repo und Nummer. Aktualisiert durch die Webhooks.
- `work_item_link_checks`: je Verknüpfung und Check-Run Name, App, Status, Ergebnis, URL, Head-Commit; daraus der CI-Zustand für 7.2 und die Anzeige am Item (10.5).
- Ein Event am Item bei neuer Verknüpfung und bei Merge (History); Benachrichtigungen folgen den bestehenden Regeln (`item_changed`) *(Builder: neue Art nötig?)*.
- REST: Verknüpfungen samt Checks am Item lesen (`include=links` o. ä.) und über MCP (A397-Regel).

## 13. REST, MCP, Doku

- Unter `/api/v1` (mit OpenAPI-Dokument, Vertrag, Rechte-Matrix, MCP-Parität): Runner lesen, umbenennen, widerrufen; Aufträge lesen (je Item, je Runner), abbrechen; Agenten-Konfiguration eines Bots; Agenten-Einstellungen eines Projekts; Verknüpfungen eines Items. Pairing-Code erzeugen und die GitHub-Verbindung nur aus der Sitzung (`EnsureSession`), nicht über MCP (Eintrag in A397).
- VitePress `docs/en` und `docs/de`: „Runner“ (Installation, Config, TUI, Sicherheit, eigener macOS-Benutzer, Ausstattung der Maschine), „GitHub“ (zwei Apps, Ruleset ohne Bypass, Repos), „Agenten“ (Aufträge, Ablauf, Status, Epics, Parallelität); `operations.md` (Downloads, Drosseln), `bots.md`.
- `CLAUDE.md` bekommt die Abschnitte im gewohnten Stil, Rulings ab A472 in der Rulings-Datei.

## 14. Qualität

- Go: `go vet`, `go test -race` im neuen CI-Job `runner` (fester Runner, Actions per SHA; nie `tests` heißen), Tests gegen einen falschen werkbuch-Server und ein falsches CLI (Skript, das stream-json ausgibt). Abdeckungsziel für Go setzt der Builder (die 100 %-Regel gilt für PHP und Frontend).
- PHP: Tests mit zwei Verbindungen für Abholen und Merge-Entscheidung, Webhook-Fixtures von GitHub, `Http::fake` für die GitHub-API.
- Smoke: Download und Prüfsumme gegen den Stack.
- Abnahme: ein echter Durchlauf auf dem alten Mac: Ticket in einem Testrepo dem Bot zuweisen → PR → CI rot (absichtlich) → Korrektur → CI grün → Review → Freigabe → Merge → Done; ein Konflikt durch einen Commit auf der Basis → `conflict`; ein Epic mit zwei Kindern; eine Frage per Erwähnung.

## 15. Dem Builder überlassen

- Genaue Tabellen, Spalten, Indizes, Namen der Actions und Routen innerhalb der Regeln oben.
- Intervalle (Polling, Heartbeat, Lease), Grenzen des Protokolls, Fristen (Aufräumen, Offline-Umzug), solange sie einstellbar oder begründet sind.
- Der Weg der Ereignisse in den Browser (gedrosseltes Live-Signal auf dem Kanal des Items).
- Ob Codex im ersten Wurf mitkommt.
- Commit-Identität des Bots.
- Wie die GitHub-Webhooks verarbeitet werden (Job, Konsument) und wie CI „grün“ bei spät dazukommenden Check-Suites stabil wird.
- Schnitt in Tickets des Epics (Vorschlag: zuerst der Spike zur Freigabe durch eine App (11.3), dann Datenmodell und Protokoll, Runner-Daemon, Installation und Image, TUI, GitHub-App und Verknüpfung, Ablauf und Zustandsmaschine, Oberfläche, Doku und Abnahme).
