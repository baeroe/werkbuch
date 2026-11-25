# Aktualisieren

Erst eine [Sicherung](/de/backup) machen, dann neben `docker-compose.yml` ausführen:

```bash
docker compose pull && docker compose down && docker compose up -d
```

`down` stoppt jeden Dienst, bevor die neue Version startet, werkbuch ist also offline, solange der Start dauert; die Volumes bleiben. Ohne `down` erzeugte `up -d` zuerst `werkbuch` neu, und das migriert die Datenbank, während die alten Worker mit altem Code gegen das neue Schema weiterlaufen, bis Compose sie erreicht.

Mit der [Standalone-Compose-Datei](/de/setup#schnellstart-einfugen-und-deployen) in Dockge oder Portainer: den Stack stoppen, dann das Image neu ziehen und ihn starten (Dockge: **Stop**, dann **Update**; Portainer: den Stack stoppen, dann mit neu gezogenem Image aktualisieren).

Beim Start migriert die neue Version die Datenbank, schickt die Einstellungen der Suchindizes an Meilisearch, füllt die Indizes neu, wenn diese Version ihnen Felder bringt, und baut ihre Caches und das OpenAPI-Dokument; [Einrichtung](/de/setup#start) nennt jeden Schritt. `docker compose restart` allein behält das alte Image.

- **Feste Version:** zuerst `WERKBUCH_IMAGE` in der `.env` ändern (etwa `baeroe/werkbuch:0.2.0`) oder die Zeile `image:` der Standalone-Compose-Datei.
- **Compose-Datei:** Die Hinweise unten sagen, wann sich `docker-compose.yml` geändert hat. Dann neu herunterladen und eigene Änderungen in `docker-compose.override.yml` halten:
  `curl -fsSLO https://raw.githubusercontent.com/baeroe/werkbuch/main/docker-compose.yml`
  Mit der Standalone-Compose-Datei die neue [docker-compose.standalone.yml](https://github.com/baeroe/werkbuch/blob/main/docker-compose.standalone.yml) einfügen und die eigenen Werte aus dem Block oben übertragen.
- **MariaDB:** Patch-Versionen aktualisieren sich beim Start selbst (`MARIADB_AUTO_UPGRADE`). Eine neue Hauptversion kommt nur mit einem Hinweis hier.
- **Meilisearch:** Eine neue Version von Meilisearch hebt beim Start die Datenbank der Version davor (`MEILI_UPGRADE_DB` in beiden Compose-Dateien); die Suche behält ihren Index. Nur wenn das nicht geht, stoppt sie mit einem Fehler zur Version ihrer Datenbank (`docker compose logs meilisearch`), und `werkbuch` startet nicht. Der Index kommt aus der Datenbank, also ihn löschen und von werkbuch neu bauen lassen:

  ```bash
  docker compose rm -sf meilisearch
  docker volume rm werkbuch_meili-data     # <projekt>_meili-data, siehe docker volume ls
  docker compose up -d
  docker compose restart werkbuch
  ```

  Der Start von `werkbuch` findet den Index leer und importiert alles; bis dahin ist die Suche leer. `up -d` allein startet ein `werkbuch` nicht neu, das noch läuft (etwa beim Weg zurück zum älteren Meilisearch), darum das `restart`. Nach dem Heben liest ein älteres Meilisearch die Datenbank nicht mehr; zurück geht es nur mit denselben Schritten.
- **Zurück:** Migrationen werden nicht zurückgerollt. Die Sicherung wiederherstellen und die alte Version festlegen.

Alle Versionen und ihre Änderungen: https://github.com/baeroe/werkbuch/releases

## Hinweise je Version

<!-- nur absolute Links: jeder Abschnitt der englischen Fassung wird zu den Notizen seines GitHub-Releases -->

### 0.4.0

- **Agenten:** Ein Bot kann Items selbst bearbeiten. Weist du ihm ein Item zu, setzt ein Runner es um, öffnet einen Pull Request, lässt CI und ein unabhängiges Review laufen, behebt, was sie finden, und werkbuch merged, sobald die CI grün ist und das Review keine Befunde hat. Konflikte mit dem Basis-Branch bekommen einen eigenen Auftrag, Bremsen (3 Korrekturen, 2 Konflikte) pausieren einen Strang, bevor er endlos Tokens verbraucht, ein Epic wird auf einem Branch mit einem Pull Request bearbeitet, und ein in einem Kommentar erwähnter Bot antwortet aus Wiki, Items und Code. Agenten brauchen die vier Schritte der Agenten im Workflow des Projekts (In Arbeit, In Review, Korrektur, Gemergt). Siehe [Agenten](https://werkbuch.dev/de/concepts/agents).
- **Runner:** `werkbuch-runner` läuft auf einem Mac oder Linux-Rechner von dir mit Claude Code oder Codex und ruft immer nur deine Instanz. Die Instanz liefert ihn selbst aus: **Einstellungen → Runner → Runner verbinden** zeigt einen Befehl mit `/runner/install.sh` und einem Einmal-Code, der ihn installiert, koppelt und als Dienst seines Benutzers startet; er aktualisiert sich selbst auf die Version der Instanz. Ohne Befehl öffnet er eine Terminal-Oberfläche mit Status, den Aufträgen samt Live-Protokoll und dem Doctor. Siehe [Runner](https://werkbuch.dev/de/runner).
- **GitHub:** Eine private GitHub-App je GitHub-Konto (dein eigenes, eine Organisation oder mehrere), angelegt unter **Einstellungen → GitHub** und auf den Repos installiert, an denen die Agenten arbeiten sollen; jedes Projekt wählt unter **Projekteinstellungen → Agenten** sein Repo, den Basis-Branch und die Merge-Methode. werkbuch hört Pushes, Pull Requests und Checks über den Webhook der Apps und pausiert die Agenten eines Projekts, wenn auf seinem Basis-Branch ein Merge landet, den werkbuch nicht gemacht hat. Siehe [GitHub](https://werkbuch.dev/de/github).
- **Pull Requests an Items:** Ein Pull Request im Repo eines Projekts verknüpft sich mit den Items, die er in Branch-Name, Titel oder Beschreibung nennt; `Fixes <KEY>` und die anderen schließenden Wörter schließen das Item beim Merge, `skip` nimmt eine Verknüpfung zurück. Ein offener Pull Request schiebt seine Items nach In Review, der Merge nach Gemergt. Das Item zeigt seine Pull Requests mit ihren Checks und dem Urteil des Reviews.
- **Oberfläche:** Einstellungen für Runner, GitHub, Bots als Agenten (Runner-Pool, CLI, Modelle), Arbeitsregeln für die Prompts, Hinweise je Typ und je Projekt Repo, Review-Agent und Bremsen; am Item jeder Auftrag in der Aktivität mit Live-Protokoll, Abbrechen und Erneut starten, dazu ein Hinweis, wenn der Agent eine Person braucht. Über REST und MCP: Runner, Aufträge und Agenten (`agents`, `manage-agents`).
- **Update:** Die Datenbank migriert beim Start. Die Compose-Dateien und `.env.docker.example` haben sich nicht geändert: wie unter [Aktualisieren](https://werkbuch.dev/de/upgrading) beschrieben aktualisieren. `0.4.0-rc.1` ist ein Vorab-Release, `latest` bleibt auf 0.3.2: Zum Ausprobieren `WERKBUCH_IMAGE=baeroe/werkbuch:0.4.0-rc.1` in der `.env` setzen (in der Standalone-Compose-Datei die Zeile `image:`).
- **GitHub-App, die vor diesem Release angelegt wurde** (von `main`): bei GitHub unter **Developer settings → GitHub Apps → \<App\> → Permissions & events** die Berechtigung **Commit statuses: read** hinzufügen und auf jeder Installation der App annehmen. Bis beides erledigt ist, verweigert GitHub werkbuch jedes Token, das sie verlangt: CI lesen und mergen scheitern. Eine mit diesem Release angelegte App hat sie.
- **Ausgehende Verbindungen:** Mit verbundenem GitHub rufen `queue` und `werkbuch` `api.github.com:443`, und GitHub liefert seine Webhooks an `POST /github/webhook`, das per HTTPS aus dem Internet erreichbar sein muss ([GitHub](https://werkbuch.dev/de/github#der-webhook-hinter-dem-proxy)). Runner laden den Runner von deiner Instanz und brauchen ausgehendes HTTPS zu ihr und, bei Projekten mit Repo, zu `github.com` (dazu, was Claude Code oder Codex selbst brauchen), aber keinen offenen Port. Siehe [Betrieb](https://werkbuch.dev/de/operations#runner-und-github).
- Image `baeroe/werkbuch:0.4.0-rc.1` für `linux/amd64` und `linux/arm64`.

### 0.3.2

- **Rich Text:** Lange Verweise auf Wiki-Seiten und Datei-Chips brechen um wie Text, statt aus Kommentaren und Beschreibungen hinauszulaufen; das Icon bleibt am ersten Wort. Ein ausgewähltes Bild oder ein ausgewählter Datei-Chip zeigt beim Bearbeiten seinen Auswahlrahmen, beim Lesen nie.
- **API und MCP:** Ein Projekt nennt mit `include=types` seine Typen (`GET /api/v1/projects`, `GET /api/v1/projects/{project}`; über MCP `projects` mit `include: ["types"]`): jeden eingeschalteten Typ mit Name, `is_epic` und Pflicht-Properties, so findet ein Agent den Epic-Typ auch in einem leeren Projekt. `GET /api/v1/projects/{project}` lehnt ein unbekanntes `include` jetzt mit 422 ab (bisher wurde dort etwa `include=members` still übergangen; die Liste behält `include=members`).
- Die Compose-Dateien haben sich nicht geändert: wie unter [Aktualisieren](https://werkbuch.dev/de/upgrading) beschrieben aktualisieren.
- Image `baeroe/werkbuch:0.3.2` für `linux/amd64` und `linux/arm64`.

### 0.3.1

- **Projekte:** Items, Wiki, Vorlagen und Einstellungen eines Projekts haben einen gemeinsamen Kopf an derselben Stelle: das Zeichen des Projekts, das Projekt und der Bereich, darunter die Reiter. Die Einstellungen eines Projekts stehen nicht mehr zentriert und schmaler; Kopf und Reiter gehen über die ganze Breite wie in den anderen Bereichen, nur Abschnitte und Formular behalten ihre Breite.
- **Sicherheit:** Das Image baut auf `serversideup/php` v5.1.5 auf (bisher v5.0.4): PHP 8.4.28 mit den Fixes für PHP-FPM und Sitzungen, nginx 1.30.7, und PHP-FPM führt nur Dateien aus, die es gibt und die auf `.php` enden. Außerdem antwortet das Image auf `/index.php/…` mit 404 statt umzuleiten und schließt so eine offene Umleitung der Basis.
- Die Compose-Dateien haben sich nicht geändert: wie unter [Aktualisieren](https://werkbuch.dev/de/upgrading) beschrieben aktualisieren.
- Image `baeroe/werkbuch:0.3.1` für `linux/amd64` und `linux/arm64`.

### 0.3.0

- **Projekte:** Der Name eines Projekts mit Stern in der Seitenleiste öffnet seine Items, der Pfeil daneben klappt seine Bereiche auf. Die Einstellungen eines Projekts sind ohne Seitenleiste erreichbar: ein vierter Reiter **Einstellungen** unter dem Kopf von Items, Wiki, Vorlagen und den Einstellungen, ein Link auf jeder Projektkarte und **Projekteinstellungen öffnen …** in der Befehlspalette.
- **Kommentare** können jetzt auch Tabellen, über das `/`-Menü und mit dem Menü der Tabelle (`alt+F10`), wie Beschreibungen und Wiki-Seiten.
- Die Compose-Dateien haben sich nicht geändert: wie unter [Aktualisieren](https://werkbuch.dev/de/upgrading) beschrieben aktualisieren.
- Image `baeroe/werkbuch:0.3.0` für `linux/amd64` und `linux/arm64`.

### 0.2.0

- **Die Compose-Datei hat sich geändert:** Der neue Dienst `gotenberg` ([Gotenberg](https://gotenberg.dev) 8.37) macht Wiki-Seiten zu PDFs. `docker-compose.yml` neu herunterladen (oder die neue Standalone-Datei einfügen und die eigenen Werte übernehmen), dann wie unter [Aktualisieren](https://werkbuch.dev/de/upgrading) beschrieben aktualisieren. Ohne den Dienst läuft werkbuch wie bisher, nur der Knopf **PDF** bleibt gesperrt. Siehe [Betrieb](https://werkbuch.dev/de/operations#pdf).
- **Wiki:** eine Seite, auch mit ihren Unterseiten, als PDF herunterladen. Der Baum startet eingeklappt und merkt sich je Person und Projekt, was aufgeklappt war.
- **Projekte:** Wiki und Vorlagen eines Projekts sind ohne Stern erreichbar: Reiter über Items, Wiki und Vorlagen, Links auf jeder Projektkarte und **Wiki öffnen …** und **Vorlagen öffnen …** in der Befehlspalette.
- **Properties:** Jede Property steht entweder rechts in der Seitenleiste oder unter der Beschreibung eines Items, einstellbar je Property. Rich-Text-Properties, auch die vorhandenen, stehen standardmäßig unter der Beschreibung.
- **Editor:** In Beschreibungen gibt es Tabellen im `/`-Menü; eine breite Tabelle scrollt in ihrem Rahmen. Bilder in einem Text öffnen sich per Klick (im Editor mit Enter) groß, mit **Originalgröße**, **Original öffnen**, **Herunterladen** und `←`/`→` durch die Bilder desselben Texts; ein ausgewähltes Bild hat das Menü **Bild** (`alt+F10`).
- **Suche:** Meilisearch 1.56.1. Es hebt die Datenbank der Version davor selbst (`MEILI_UPGRADE_DB` in beiden Compose-Dateien).
- Image `baeroe/werkbuch:0.2.0` für `linux/amd64` und `linux/arm64`.

### 0.1.0

- Erstes Release: Projekte mit Mitgliedern, Work Items mit eigenen Typen, Properties und Workflows, Liste, Board, Tabelle und Timeline, gespeicherte Views, ein Wiki je Projekt, Vorlagen mit Zeitplänen, Automatisierungen, Benachrichtigungen mit Mail und Live-Updates, Suche, eine REST-API mit ihrer OpenAPI-Referenz, ein MCP-Server für KI-Agenten und signierte Webhooks, auf Englisch und Deutsch.
- Image `baeroe/werkbuch:0.1.0` für `linux/amd64` und `linux/arm64`. Läuft als Docker-Compose-Stack mit MariaDB 11.4 und Meilisearch 1.56, siehe [Einrichtung](https://github.com/baeroe/werkbuch/blob/main/docs/de/setup.md).
