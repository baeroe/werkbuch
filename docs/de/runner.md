# Runner

Ein Runner ist eine eigene Maschine, auf der [Agenten](/de/concepts/agents) arbeiten: ein Mac oder ein Linux-Rechner mit Claude Code oder Codex. Der Daemon `werkbuch-runner` holt Aufträge über HTTPS bei deiner Instanz ab, startet das CLI headless in einem eigenen Ordner je Item und meldet Protokoll und Ergebnis zurück. Er braucht keinen offenen Port und kein Expose: Er ruft immer nur werkbuch auf.

Alles, was je Instanz eingerichtet wird (Namen, Plätze, welcher Bot wo arbeitet, Regeln, Modelle), liegt in werkbuch. Die Maschine hält nur die Adresse der Instanz, ihr Token und das, was zur Maschine gehört: den Login des CLI, die MCP-Server, Skills und Plugins ihres Benutzers und das, was die Projekte zum Bauen und Testen brauchen.

## Was du brauchst

- macOS (Apple Silicon oder Intel) oder Linux, `arm64` oder `amd64`. Windows geht nicht.
- `git` und Claude Code (`claude`) oder Codex (`codex`), installiert und angemeldet für den Benutzer, unter dem der Runner läuft.
- Für Aufträge, die Code ändern: was die Projekte zum Bauen und Testen brauchen, für werkbuch selbst Colima, DDEV und Node. Der Setup-Befehl eines Projekts startet es je Worktree (siehe [Setup und Teardown](#setup-und-teardown)).
- Ausgehendes HTTPS zu deiner Instanz und, für Projekte mit Repo, zu `github.com`.

## Ein eigener Benutzer

Ein Agent arbeitet unbeaufsichtigt mit allen Rechten des Benutzers, unter dem der Runner läuft: Er liest, schreibt und führt Befehle aus. Die Maschine ist die Grenze. Gib dem Runner einen eigenen Benutzer:

- **Keine Admin-Rechte**, kein Zugang zu privaten Daten: keine persönliche Mail, kein Passwort-Manager, keine SSH-Schlüssel.
- **Nichts Persönliches in seinem Harness:** Was für diesen Benutzer eingerichtet ist (MCP-Server, Skills, Plugins, Hooks, eine `~/.claude/CLAUDE.md`), läuft in jedem Auftrag mit. Hooks der Zeiterfassung oder ein persönliches Token für werkbuch gehören dort nicht hin.
- **macOS:** Leg unter **Systemeinstellungen → Benutzer:innen & Gruppen** einen Standardbenutzer an, melde dich einmal als dieser Benutzer an und lass ihn nach einem Neustart automatisch anmelden (**Benutzer:innen & Gruppen → Automatisch anmelden als**; dafür muss FileVault aus sein). Ein Launch Agent läuft nur, solange sein Benutzer angemeldet ist. Halte den Mac wach: **Systemeinstellungen → Energie** (bzw. **Batterie → Optionen**), „Automatischen Ruhezustand bei ausgeschaltetem Display verhindern“, oder `sudo pmset -a sleep 0` aus einem Admin-Konto.
- **Linux:** Eine User-Unit von systemd endet, wenn sich ihr Benutzer abmeldet. `sudo loginctl enable-linger <benutzer>` hält sie ohne Sitzung am Laufen.

Melde das CLI als dieser Benutzer an, bevor du den Runner installierst: `claude` einmal starten und seinem Login folgen, oder `codex login`.

## Installieren

Org-Admins finden den Befehl unter **Einstellungen → Runner → Runner verbinden**. Er enthält einen Einmal-Code (zehn Minuten, einmal):

```sh
curl -fsSL https://pm.example.com/runner/install.sh | sh -s -- --code ABCD-EFGH
```

Führ ihn in einem Terminal des Runner-Benutzers aus, nie als root und nie mit `sudo`. Das Skript

1. lädt den Runner dieser Instanz für System und Architektur der Maschine (`/runner/download/<os>/<arch>`), prüft seine SHA-256-Summe und legt ihn nach `~/.local/bin/werkbuch-runner`,
2. verbindet ihn mit dem Code (`werkbuch-runner login`); der Runner schickt Name, System, Architektur und Version und bekommt ein eigenes Token, das er im Schlüsselbund ablegt,
3. richtet ihn als Dienst des Benutzers ein und startet ihn.

Der Dialog in werkbuch sagt, sobald der Runner verbunden ist. Optionen des Skripts: `--name <name>` benennt den Runner (Standard: der Hostname; umbenennen geht später in werkbuch), `--prefix <ordner>` installiert woanders als in `~/.local`, `--no-service` schreibt den Dienst, ohne ihn zu laden. Ein abgelaufener oder benutzter Code endet mit einer Meldung im Terminal; erzeug im Dialog einen neuen.

Ein zweiter Aufruf mit neuem Code ersetzt den Dienst auf der Maschine, ohne zweiten Dienst, aber werkbuch sieht einen **neuen** Runner: eine neue Karte mit neuem Token, den Standard-Plätzen und womöglich einem anderen Namen. Die alte Karte bleibt und ist nicht widerrufen, Runner-Pools, die den alten Runner nennen, nehmen den neuen nicht, und Stränge des alten ziehen erst nach 30 Minuten offline um. Widerruf danach die alte Karte, stell die Plätze des neuen ein und hak ihn in den Runner-Pools der Bots an, die den alten nutzten.

| Wo | Was |
|---|---|
| `~/.local/bin/werkbuch-runner` | das Binary |
| `~/.config/werkbuch-runner/config.yaml` | die Adresse der Instanz |
| Schlüsselbund, Dienst `werkbuch-runner` | das Runner-Token (unter Linux ohne Secret Service: `credentials.json` neben der Config, nur für den Benutzer lesbar) |
| `~/.local/state/werkbuch-runner` | Zustand, der Socket der TUI, das Log des Launch Agents (`runner.log`) |
| `~/.local/share/werkbuch-runner` | die Klone der Repos und die Worktrees der Aufträge |

## Der Dienst

| | macOS | Linux |
|---|---|---|
| Datei | `~/Library/LaunchAgents/dev.werkbuch.runner.plist` | `~/.config/systemd/user/werkbuch-runner.service` |
| Neu starten | `launchctl kickstart -k gui/$(id -u)/dev.werkbuch.runner` | `systemctl --user restart werkbuch-runner` |
| Log | `~/.local/state/werkbuch-runner/runner.log` (ab 10 MB gekürzt, eine ältere Datei `runner.log.1`) | `journalctl --user -u werkbuch-runner` |

Der Dienst startet mit der Sitzung des Benutzers und nach einem Absturz erneut. `werkbuch-runner service uninstall` stoppt und entfernt ihn, `werkbuch-runner service install` richtet ihn wieder ein.

## Befehle

```sh
werkbuch-runner           # die TUI (in einem Terminal)
werkbuch-runner status    # was der Daemon gerade tut
werkbuch-runner doctor    # CLIs, Schlüsselbund, Instanz, Token, Git und Ausstattung prüfen
werkbuch-runner update    # auf die Version aktualisieren, die die Instanz erwartet
werkbuch-runner logout    # Instanz und Token vergessen
werkbuch-runner version
werkbuch-runner login https://pm.example.com --code ABCD-EFGH   # von Hand verbinden
werkbuch-runner daemon    # was der Dienst ausführt
```

## TUI

`werkbuch-runner` ohne Befehl öffnet die TUI (auf Englisch). Sie liest den Daemon alle zwei Sekunden und ändert nichts außer der Anmeldung: Alles andere stellst du in werkbuch ein.

- **Status** (`1`): Instanz, Version, Verbindung, die Plätze aus werkbuch, CPU, GPU, RAM und Speicher mit den letzten fünf Minuten, die laufenden Aufträge mit Branch, Session und Worktree, die letzten.
- **Runs** (`2`): die Aufträge und das Protokoll des gewählten, live, solange der Agent arbeitet. `enter` zeigt das Protokoll ganz, `f` folgt ihm, `c` bricht den Auftrag nach einer Rückfrage ab.
- **Doctor** (`3`): die Prüfungen von `werkbuch-runner doctor`, gemacht vom Daemon in seiner eigenen Umgebung.

`tab` oder `1` bis `3` wechseln den Reiter, `?` zeigt die Tasten, `l` meldet ab (nur im Reiter **Status**), `q` beendet.

## Doctor

`werkbuch-runner doctor` und der Reiter **Doctor** prüfen:

| Prüfung | In Ordnung, wenn |
|---|---|
| config | die Adresse der Instanz gesetzt ist |
| keychain | das Runner-Token da ist |
| instance | werkbuch antwortet |
| token | werkbuch das Token nimmt (abgelehnt: der Runner wurde widerrufen, verbinde ihn neu) |
| git | `git` installiert ist |
| agents | mindestens ein CLI installiert und angemeldet ist, mit seiner Version |
| data | der Datenordner beschreibbar ist, mit dem freien Platz |
| equipment | die MCP-Server, Skills und Plugins der CLIs |
| werkbuch access | kein MCP-Server der Maschine diese Instanz erreicht (eine Warnung) |
| daemon | der Daemon läuft und werkbuch erreicht |

Prüf in der Umgebung des Dienstes: Die TUI fragt den Daemon und sieht so `PATH` und Schlüsselbund des Launch Agents, die sich von deiner Shell unterscheiden können.

## Einstellungen in werkbuch

Jeder Runner ist eine Karte unter **Einstellungen → Runner**: online (ein Kontakt in der letzten Minute), Version, System, Auslastung, die Nutzung des Claude-Abos, die CLIs mit Version und Anmeldung, die Ausstattung und die Aufträge auf ihm mit **Abbrechen**. Dort benennst du ihn um, widerrufst ihn (sein Token gilt nicht mehr, laufende Aufträge werden abgebrochen, wartende gehen an die anderen Runner) und stellst seine **Plätze** ein:

| Plätze | Standard | Zählt |
|---|---|---|
| gesamt | 2 | Aufträge, die Code ändern (Umsetzen, Korrektur, Konflikt), zugleich |
| je Repo | 1 | davon je Repo (zwei Aufträge eines Repos teilen sich die Test-Datenbank von DDEV) |
| leicht | 2 | Reviews und Antworten, in einem eigenen Topf |

Der Runner bekommt die Plätze mit jeder Antwort; eine Änderung gilt ohne Neustart. Welchen Runner ein Bot nimmt, ist sein **Runner-Pool** (**Einstellungen → Bots → Agent einrichten**; keiner angehakt: alle Runner).

### Limit für das Claude-Abo

Der Runner liest, wie viel vom Claude-Abo seines Nutzers verbraucht ist, so wie `/usage` von Claude Code es zeigt: die Session (fünf Stunden) und die Woche, je mit dem Zeitpunkt, an dem sie neu beginnt. Er fragt alle fünf Minuten mit der Anmeldung von Claude Code (unter macOS aus dem Schlüsselbund, sonst `~/.claude/.credentials.json`) und schickt nur die Prozente an werkbuch; die Karte zeigt sie als Balken.

Unter **Plätze** stellst du ein **Limit** in Prozent ein: Erreicht die Session oder die Woche es, nimmt der Runner keine neuen Aufträge von Claude Code; laufende laufen zu Ende, Aufträge von Codex gehen weiter. Ein Auftrag, der darauf wartet, sagt es am Item (*der Runner hat sein Limit für das Claude-Abo erreicht*) und startet, sobald die Nutzung wieder darunter liegt, das Limit steigt oder ein anderer Runner des Pools unter seinem Limit ihn nimmt. Ohne Limit, oder solange nichts bekannt ist (keine Anmeldung, ein Runner älterer Version), wird nichts zurückgehalten.

### Setup und Teardown

Setup- und Teardown-Befehl der Worktrees gehören zum Projekt (**Projekteinstellungen → Agenten**): Der Runner führt das Setup mit `sh -c` im Worktree vor jedem Auftrag aus, der Code ändert, und das Teardown, bevor er den Worktree entfernt. Beide sehen zwei Variablen: `WERKBUCH_WORKTREE`, den absoluten Pfad des Worktrees, und `WERKBUCH_STRAND`, den Namen des Strangs als Projektname (Kleinbuchstaben, Ziffern und `-`).

Der **Stop-Befehl** (optional) läuft im Worktree nach jedem Auftrag, der Code ändert, auch nach einem fehlgeschlagenen, abgebrochenen oder zeitüberschrittenen, mit denselben Variablen; ein Review oder eine Antwort auf eine Erwähnung führt ihn nie aus. Damit hältst du die App eines ruhenden Strangs an, ohne Daten zu löschen, bei DDEV mit `ddev stop`; das nächste Setup startet sie wieder. Seine Ausgabe steht im Protokoll des Auftrags. Endet ein Strang (gemergt oder geschlossen), entfernt der Runner seinen Worktree beim nächsten Kontakt mit werkbuch, das Teardown zuerst; der Sweep nach drei Tagen ohne Nutzung bleibt als Rückfall.

Ohne Setup-Befehl bekommt der Agent einen nackten Checkout: keine Abhängigkeiten, keine Datenbank, nichts, womit er testen kann. Das Setup läuft vor jedem Auftrag, der Code ändert (task, correction, conflict), auch in einem schon vorhandenen Worktree; schreib es also so, dass es beliebig oft auf demselben Worktree laufen darf. Seine Ausgabe steht im Protokoll des Auftrags, ein gescheitertes Setup beendet den Auftrag. Ein Review und eine Antwort auf eine Erwähnung laufen ohne Shell und bekommen kein Setup (ein schweres Setup bremst sie also nicht); das Teardown läuft trotzdem, wenn der Worktree ihres Strangs geht (jeder Befehl darf bis zu 15 Minuten dauern).

Mit DDEV braucht jeder Worktree einen eigenen Projektnamen, gesetzt in der von git ignorierten `.ddev/config.local.yaml` (nie mit `ddev config --project-name`, das die versionierte `.ddev/config.yaml` ändert). Der Setup-Befehl für werkbuch selbst, der auch Reverb den Host des Worktrees gibt:

```sh
set -e
cd "$WERKBUCH_WORKTREE"
n="wb-$WERKBUCH_STRAND"
printf 'name: %s\n' "$n" > .ddev/config.local.yaml
[ -f .env ] || cp .env.example .env
sed -i.bak "s/^REVERB_HOST=.*/REVERB_HOST=$n.ddev.site/" .env && rm .env.bak
ddev start -y
ddev composer install --no-interaction
ddev exec pnpm install --frozen-lockfile
grep -q '^APP_KEY=base64' .env || ddev artisan key:generate
ddev artisan migrate --force
ddev artisan app:search-sync
```

Für eine Laravel-App ohne Reverb dasselbe ohne die Zeile `REVERB_HOST` und ohne `app:search-sync`. Der Teardown-Befehl entfernt das DDEV-Projekt samt Datenbank:

```sh
cd "$WERKBUCH_WORKTREE" && ddev delete -Oy
```

## Ein Auftrag auf der Maschine

1. Ohne Arbeit fragt der Runner alle 3 Sekunden, nach einer Minute ohne Arbeit alle 10 Sekunden. Er schickt Auslastung, CLIs, Ausstattung und die Nutzung des Claude-Abos und bekommt seine Plätze und die Version, die werkbuch erwartet.
2. Ein Auftrag kommt mit allem, was er braucht: dem Item, dem Prompt aus werkbuch, dem Modell, einem Token für werkbuch und, für ein Projekt mit Repo, einem Token für das Repo.
3. Je Repo hält der Runner einen Bare-Klon, je Item (ein **Strang**) einen Worktree auf dem Branch `agent/<KEY>-<slug>`. Ein Projekt ohne Repo arbeitet in einem Ordner des Strangs.
4. Dort startet er das CLI mit einem privaten Ordner des Auftrags (MCP-Konfiguration, Prompt, Tokens), schickt alle 15 Sekunden einen Heartbeat und das Protokoll höchstens einmal je Sekunde, am Ende das Ergebnis: Status, Session, Commit, Zusammenfassung oder Urteil.
5. Korrekturen, Konflikte und Antworten an einem offenen Strang setzen dessen Session fort; ein Review beginnt immer frisch.

Zeitlimits, fest: **120 Minuten** für Umsetzen und Korrektur, **30** für einen Konflikt, **20** für ein Review, **10** für eine Antwort. Am Limit beendet der Runner das CLI (SIGTERM, nach 10 Sekunden SIGKILL, samt allem, was es gestartet hat) und meldet `timed_out`. Ein Auftrag ohne Heartbeat für eine Minute gilt als verloren und wird einmal neu eingereiht; beim zweiten Mal scheitert er. Ist der Runner eines Strangs länger als 30 Minuten offline, übernimmt ein anderer Runner des Pools den Strang mit frischer Session auf demselben Branch. Der Worktree eines beendeten Strangs geht nach drei Tagen, mit dem Teardown-Befehl.

Commits tragen den Namen des Bots und `<handle>@users.noreply.<host der Instanz>`.

## Was ein Auftrag darf

| | Umsetzen, Korrektur, Konflikt | Review, Antwort |
|---|---|---|
| Dateien | alles, was der Benutzer darf | nur den Worktree und den privaten Ordner des Auftrags lesen |
| Befehle | alle (Claude Code mit `--permission-mode bypassPermissions`, Codex ohne Sandbox) | keine (Claude Code nur `Read`, `Grep`, `Glob`, ohne die Einstellungen des Repos; Codex `--sandbox read-only`) |
| Git | klonen, committen, pushen mit einem Token des Repos (`contents: write`, `pull_requests: write`); `gh` mit demselben Token | kein Token, kein `gh`; den Diff und die gescheiterten Checks legt der Runner als Dateien bereit |
| werkbuch | Token des Bots mit `read`, `write`, `mcp` | Token des Bots mit `read`, `mcp` |

Das Token für werkbuch ist ein Token des Bots für genau diesen Auftrag: Es läuft mit dem Zeitlimit ab und wird am Ende widerrufen. werkbuch lehnt damit ab, was der Ablauf sich vorbehält (`403 agent_forbidden`): Status oder Typ eines Items wechseln, zuweisen, archivieren, löschen und alles an Projekten, Katalogen, Personen, Tokens, Webhooks, Automatisierungen und Vorlagen. Erlaubt sind Lesen, Beschreibung und Werte eines Items (der Nachweis), Kommentare, Anhänge, Relationen hinzufügen und Wiki-Seiten. Der Agent mergt nie und setzt kein Item auf erledigt; das tut werkbuch, siehe [den Ablauf](/de/concepts/agents#der-ablauf).

## Ausstattung der Maschine

MCP-Server, Skills, Plugins und Hooks des CLI sind Ausstattung der Maschine, eingerichtet für den Runner-Benutzer, von Hand oder mit einem Werkzeug deiner Wahl. werkbuch setzt keins voraus und hängt sich je Auftrag als MCP-Server `werkbuch-run` dazu, neben dem, was die Maschine hat. Skills und Regeln, die zum Code gehören, kommen aus dem Repo (`CLAUDE.md`, `AGENTS.md`, `.claude/skills`). Der Runner meldet die Namen seiner MCP-Server, Skills und Plugins; Runner-Karte und Doctor zeigen sie.

Hat die Maschine einen weiteren Zugang zu werkbuch, etwa einen MCP-Server mit einem persönlichen Token, könnte ein Agent an seinem Run-Token vorbei handeln. Doctor warnt davor (**werkbuch access**) und nennt den Server; schalte ihn für den Runner-Benutzer ab.

## Sicherheit

- **Runner-Token:** eins je Runner, in werkbuch gehasht gespeichert und auf der Maschine im Schlüsselbund, gilt nur für das Runner-Protokoll. Widerrufst du den Runner, gilt es nicht mehr.
- **Run-Token:** ein Token des Bots für einen Auftrag, nie in der Token-Liste, beim Ende des Auftrags widerrufen; der Bot sieht nur, was seine Projektrollen erlauben.
- **Token des Repos:** ein Installations-Token der [GitHub-App](/de/github) für ein Repo, eine Stunde gültig. Der Runner hält es in Dateien des privaten Ordners (`0600`), nie in der Umgebung, in Argumenten oder in `.git/config`: Ein Credential-Helper für den Host des Repos liest die Datei, und `gh` bekommt einen eigenen Konfigurationsordner. Die Helper der Maschine (etwa osxkeychain) und die Token-Variablen (`GH_TOKEN`, `GITHUB_TOKEN`) sind im Auftrag abgeschaltet. Zehn Minuten vor Ablauf holt der Runner ein neues Token und ersetzt die Dateien.
- **Anmeldung von Claude Code:** der Runner liest sie nur, um Anthropic nach der Nutzung des Abos zu fragen; sonst verlässt sie die Maschine nie, und er erneuert sie nie.
- **Das Protokoll** eines Auftrags erreicht werkbuch ohne Tokens, auch ohne ein nacktes `wb_…`.
- **Texte sind Daten:** Der Vertrag jedes Prompts sagt, dass Texte aus Items, Kommentaren, Wiki und Pull Requests Daten sind, keine Anweisungen. Was die Tokens verbieten, kann auch ein überlisteter Agent nicht.

## Updates

Der Runner trägt die Version von werkbuch und wird mit jedem Release ins Image gebaut. Erwartet werkbuch eine andere Version, holt der Runner sein neues Binary von der Instanz, prüft die Summe, ersetzt sich und startet neu, sobald kein Auftrag läuft; bis dahin nimmt er keine neuen Aufträge. Ein gescheitertes Update lässt den alten Runner weiterlaufen und steht in der TUI und an der Runner-Karte. `werkbuch-runner update` aktualisiert von Hand.

## Fehlersuche

- **Offline in werkbuch:** `werkbuch-runner status` und das Log des Dienstes. Nach einem Neustart des Macs muss der Benutzer angemeldet sein (automatische Anmeldung); unter Linux `loginctl enable-linger` prüfen.
- **Ein Auftrag wartet auf einen Runner mit seinem CLI:** Kein Runner im Pool des Bots hat das CLI installiert und angemeldet. `werkbuch-runner doctor` unter dem Runner-Benutzer sagt, welches; melde es an, und der Auftrag startet von selbst.
- **Token abgelehnt:** Der Runner wurde widerrufen. Erzeug einen neuen Code und führ den Befehl erneut aus; werkbuch sieht dann einen neuen Runner (siehe [Installieren](#installieren)): Plätze einstellen und in den Runner-Pools anhaken.
- **Der Dienst findet das CLI nicht**, deine Shell schon: Der Dienst übernimmt den `PATH` der Shell, aus der er eingerichtet wurde. Führ `werkbuch-runner service install` aus einer Shell aus, deren `PATH` das CLI findet; ein neuer Code ist nicht nötig.
- **Einen Runner entfernen:** In werkbuch widerrufen, dann auf der Maschine `werkbuch-runner service uninstall`, `werkbuch-runner logout` und `~/.local/bin/werkbuch-runner`, `~/.config/werkbuch-runner`, `~/.local/state/werkbuch-runner` und `~/.local/share/werkbuch-runner` löschen.
