# Runner, Task 6: Installation, Downloads, Image (WEBU-23)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ein Org-Admin kopiert `curl -fsSL <APP_URL>/runner/install.sh | sh -s -- --code <CODE>` aus „Runner verbinden“; das Skript lädt den Runner von derselben Instanz, prüft die Summe, legt ihn nach `~/.local/bin`, verbindet ihn mit dem Code und richtet den Dienst ein (launchd bzw. systemd-User). Das Image baut die vier Binaries, die Instanz liefert sie aus, der Runner aktualisiert sich daraus (A499).

**Spec:** `docs/superpowers/specs/2026-11-23-runner-design.md` 6.1, 6.2, 8.2, 8.3, 11. Plan `2026-11-23-runner.md` Task 6. Referenz: WEBU-20 (Pairing, `CreatePairingCode::command`), WEBU-21 (`runner/`, `update` lädt `/runner/download/<os>/<arch>` und `.sha256`, A496, A499), Mock-up `/_tui` des Klickdummys (Frames `install`, `install-expired`). Nicht hier: TUI (WEBU-22), GitHub (WEBU-24), Dienst auf dem alten Mac (WEBU-29).

**Rulings:** ab A520.

## Entscheidungen

### Routen (außerhalb von `/api/v1`, ohne Gruppe)

| Route | Antwort |
|---|---|
| `GET /runner/install.sh` | `text/plain`, das Skript mit `APP_URL` eingesetzt, `no-store`, `nosniff` |
| `GET /runner/download/{os}/{arch}` | das Binary (`application/octet-stream`, `attachment`), `no-store` |
| `GET /runner/download/{os}/{arch}.sha256` | `<hex>  werkbuch-runner-<os>-<arch>` |

- `os` ∈ `darwin`, `linux`, `arch` ∈ `arm64`, `amd64`; anderes und ein fehlendes Binary 404 (Problem, `runner/*` kommt zu `ApiPaths::problems`).
- Ohne Anmeldung (das Binary und das Skript sind kein Geheimnis, Spec 8.2; der Runner hat vor dem Pairing kein Token), in `routes/runner.php` ohne Gruppe (keine Sitzung, kein Cookie je Download), Drossel `runner-download` 30 je Minute und Adresse.
- Die Binaries liegen in `config('werkbuch.runner_dist')` = `base_path('runner/dist')` (im Image root-owned, außerhalb von `public/`; in DDEV aus `ddev runner-build`).

### `install.sh` (POSIX `sh`, `resources/runner/install.sh`)

- Optionen: `--code <CODE>` (Pflicht), `--name <name>`, `--prefix <dir>` (Standard `$HOME/.local`, Binary nach `<prefix>/bin`), `--no-service` (Dienst-Datei schreiben, aber weder laden noch starten), `--help`.
- Nur `https`, `http` nur für Loopback (wie `config.NormalizeInstance`, A499). Nie `sudo`.
- Ablauf: System/Architektur (`uname -s`/`uname -m`, `x86_64` → `amd64`, `aarch64` → `arm64`), Download in einen Temp-Ordner, Summe (`sha256sum` oder `shasum -a 256`), `<neu> version`, atomar nach `<prefix>/bin/werkbuch-runner` (Umbenennen im selben Ordner: ein laufender Daemon behält sein Inode), `login`, `service install [--no-start]`. Scheitert das Pairing, bleibt das Binary, kein Dienst entsteht, Exitcode 1.
- Ausgabe wie Mock-up: `system`, `instance`, `✓ downloaded`, `✓ checksum`, `✓ installed`, `✓ paired`, `✓ service`, danach die Sätze; Fehler `✗ <schritt>` mit dem Satz des Runners.

### Dienst aus dem Runner (`runner/internal/service`, Befehl `werkbuch-runner service install|uninstall`)

- macOS: `~/Library/LaunchAgents/dev.werkbuch.runner.plist` (`RunAtLoad`, `KeepAlive`, `ThrottleInterval` 10, Log `<state>/runner.log`, `EnvironmentVariables` mit `PATH` der Installation und gesetzten `WERKBUCH_RUNNER_*`), geladen per `launchctl bootout` + `bootstrap gui/<uid>` (zweiter Aufruf: kein Doppel-Dienst, Neustart mit neuem Token).
- Linux: `~/.config/systemd/user/werkbuch-runner.service` (`Restart=always`, `Environment=`), `systemctl --user daemon-reload`, `enable`, `restart`.
- `--no-start`: nur schreiben. `WERKBUCH_RUNNER_SERVICE_DIR` verlegt den Ordner (Tests).

### Image

- Stage `runner` auf `$BUILDPLATFORM`: `golang:1.26.11-trixie` per Digest (= `toolchain go1.26.11` in `runner/go.mod`), `CGO_ENABLED=0`, `-trimpath -ldflags "-s -w -X main.version=<config/werkbuch.php>"`, vier Binaries mit `.sha256`, Modul-Cache als Cache-Mount.
- App-Stage kopiert sie nach `/var/www/html/runner/dist` (root-owned, nur lesbar) und `resources/runner`.

### Tests

- PHP: `tests/Feature/Runners/RunnerDownloadTest.php` (Binary und Summe, 404 für unbekanntes System, fehlendes Binary, Skript mit URL, `sh -n`, Drossel, kein Cookie), `tests/Feature/Runners/InstallScriptTest.php` (das Skript mit falschem `curl`, `uname` und Runner vor dem `PATH`: Ablauf, Summe falsch, http, Pairing scheitert, Optionen), `ImageTest` (Stage, Pins, Ort, Version, `.dockerignore`).
- Go: `internal/service` (Plist, Unit, Escaping, Laden mit falschem `launchctl`/`systemctl`), `main_test` (`service`, erste Zeile von `login`).
- Smoke: Skript und vier Summen, Binary der eigenen Architektur, unbekanntes System 404; im Image als root ein Container mit `--network host`: `install.sh --no-service`, `systemd-analyze verify`, Daemon kurz → Runner online, dann widerrufen.

## Tasks

- [ ] Plan, Branch, DDEV
- [ ] Go: `internal/service` (TDD), Befehl `service`, `login` erste Zeile, `go.mod` toolchain
- [ ] PHP: Routen, Controller, `RunnerDist`, Drossel, `ApiPaths` (TDD)
- [ ] `install.sh` und Shell-Test (TDD)
- [ ] Dockerfile, `.dockerignore`, `ImageTest`, `.gitignore`
- [ ] DDEV-Kommando `runner-build`, Abnahme gegen DDEV (temp. Präfix, `--no-service`, `plutil -lint`, online, `logout`)
- [ ] Smoke (`compose-smoke.sh`/`.mjs`), Image bauen, Smoke grün
- [ ] Rulings, `CLAUDE.md` (Kommandos, Abschnitt), `runner/README.md`
- [ ] Gesamtlauf, PR, Nachweis
