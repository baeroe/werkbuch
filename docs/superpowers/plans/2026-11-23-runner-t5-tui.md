# Runner, Task 5: Runner-TUI in Go (WEBU-22)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `werkbuch-runner` ohne Argumente öffnet im Terminal eine TUI mit drei Reitern nach dem freigegebenen Stand von `/_tui` des Klickdummys (WEBU-18, PR #63): **Status** (Verbindung, Instanz, Version, Plätze aus werkbuch, laufende und letzte Aufträge, Auslastung CPU/GPU/RAM/Speicher mit Verläufen), **Runs** (laufende und letzte Aufträge, Protokoll live, Abbrechen) und **Doctor** (Prüfungen, Ausstattung der Maschine mit Warnung vor einem weiteren werkbuch-Zugang). Eingestellt wird nichts außer Abmelden; ein Hinweis nennt, wo in werkbuch konfiguriert wird.

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 8.5–8.8. Plan: `2026-11-23-runner.md` Task 5. Daemon und Socket-API: PR #66 (WEBU-21, Rulings A491–A499). Stil: `skilltri/internal/tui` (Bubble Tea, Bubbles, Lip Gloss, 16 Farben aus `styles.go`, Kopf mit Reitern und Zustand, Tasten im Fuß, Modell-Tests ohne Terminal).

**Rulings:** ab A500 in `2026-10-30-werkbuch-app-rulings.md`.

## Entscheidungen

### Aufbau

`runner/internal/tui/`:

- `styles.go` (Palette wie skilltri: Farben 1–8 und 15 des Terminals, Reiter invertiert, Alarm-Chip, App-Name magenta)
- `layout.go` (breitensichere Helfer: `fit`, `padLeft`, `wrap`, `san`, `highlightRow`, `modalBox`, `overlay`, `keyHints`, `clampLines`; Balken und Verlauf `bar`, `spark`)
- `source.go` (`Source`: was die TUI vom Daemon liest; `SocketSource` über `socket.Client`)
- `model.go` (Wurzelmodell: Reiter, Abfrage alle 2 s, Kopf, Fuß mit Status, Modals (Hilfe, Rückfrage, Details), Spinner von Bubbles)
- `status.go`, `runs.go`, `doctor.go` (die drei Reiter)
- `tui_test.go` (Modell-Tests gegen eine falsche `Source`), `source_test.go` (`SocketSource` gegen `socket.Handler` auf einem echten Unix-Socket)

### Daten (A500, A501)

- Die TUI fragt den Daemon über den Socket alle 2 s nach `GET /status`, `GET /runs`, `GET /load` (Werte des Samplers, 60 × 5 s = fünf Minuten Verlauf). Antwortet keiner, zeigt der Kopf „○ no daemon“ und Status sagt, wie man ihn startet.
- Das Protokoll eines gewählten Laufs liest sie als Stream `GET /runs/{id}/events` (NDJSON, live bis zum Ende), immer nur den einen gewählten.
- Abbrechen: `c` mit Rückfrage → `POST /runs/{id}/cancel`.
- **Doctor über den Daemon** (neu `GET /doctor`): der Daemon prüft mit seiner Umgebung (unter launchd hat er einen anderen `PATH` und Schlüsselbund-Zugang als die Shell; was er sieht, zählt für Aufträge) und hängt eine Prüfung der Version an (werkbuch erwartet eine andere, Update-Zustand). Antwortet kein Daemon, prüft die TUI selbst (`doctor.Checks`) und sagt das.
- Abmelden: `l` auf Status mit Rückfrage, derselbe Weg wie `werkbuch-runner logout` (main reicht die Funktion herein).

### Erweiterungen der Socket-API

- `GET /doctor` → `[{name, level, detail}]` (`socket.Check`; `socket` importiert `doctor` nicht, der Daemon wandelt um).
- `Status.system` (`darwin/arm64`).
- `Summary.branch`, `Summary.session` (aus dem Strang des Claims) für die Zeile unter einem laufenden Auftrag.

### Screenshots (A502)

Ein falscher Daemon unter `runner/docs/demo/` (eigenes `main`, dasselbe `socket.Handler` über ein Demo-Backend mit `executor.Fake`): Instanz `https://werkbuch.example.com`, ein laufender Auftrag WEB-51 mit Protokoll, das live wächst, letzte Aufträge, Doctor mit einem nicht angemeldeten Codex und der Warnung vor `werkbuch-mara`. `runner/docs/screenshots.sh` baut Runner und Demo, startet die Demo auf einem Socket unter `/tmp`, setzt alle Ordner in eine Sandbox und spielt die Tapes `runner/docs/tapes/*.tape` (VHS) nach `runner/docs/screenshots/*.png`. Kein verstecktes Flag im Runner selbst.

### Tasten

Überall: `tab`/`⇧tab`, `1`–`3`, `j`/`k` bzw. `↑`/`↓`, `?` Hilfe, `q`/`ctrl+c` beenden, `esc` schließt das Modal. Status: `enter` öffnet den gewählten Auftrag in Runs, `r` fragt sofort neu, `l` meldet ab. Runs: `enter` volles Protokoll (`esc` zurück, `g`/`G`), `f` folgen an/aus, `c` abbrechen. Doctor: `r` noch einmal, `enter` Details der Prüfung.

## Tasks

### 1. Socket und Daemon erweitern

- [ ] Test: `GET /doctor` antwortet die Prüfungen des Backends; `Status.system`; `Summary.branch`/`session`.
- [ ] `socket.Check`, `Backend.Doctor`, Route; `Daemon.Doctor` (Funktion aus main plus Prüfung der Version); `executor.Fake` für Tests und Demo.

### 2. Gerüst der TUI, Source, Abfrage

- [ ] Test: ohne Daemon „no daemon“ im Kopf und Hinweis auf Status; mit Daemon Instanz, Version, Plätze, Auslastung mit Verlauf.
- [ ] `styles.go`, `layout.go`, `source.go`, `model.go`, `status.go`.

### 3. Runs

- [ ] Test: Liste, Auswahl bleibt bei neuer Abfrage am Auftrag, Protokoll aus dem Stream, Folgen, volles Protokoll, Abbrechen mit Rückfrage.

### 4. Doctor

- [ ] Test: Prüfungen über den Daemon, Rückfall lokal, Ausstattung mit Warnung, Zählung im Fuß, Details.

### 5. Befehl, Demo, Screenshots, Doku

- [ ] `werkbuch-runner` ohne Argumente startet die TUI (nur in einem Terminal, sonst der Hinweis).
- [ ] Demo-Daemon, `screenshots.sh`, Tapes, Bilder; README, `CLAUDE.md` „Runner (Go)“, Rulings.

## Abweichungen und Stand (nach der Umsetzung)

(nach der Umsetzung ergänzt)
