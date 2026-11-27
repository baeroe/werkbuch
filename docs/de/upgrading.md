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

- **Agenten:** Ein Bot kann Items selbst bearbeiten. Weist du ihm ein Item zu, setzt ein Runner es um, öffnet einen Pull Request, lässt CI und ein unabhängiges Review laufen, behebt, was sie finden, und werkbuch merged, sobald die CI grün ist und das Review keine Befunde hat. Konflikte mit dem Basis-Branch bekommen einen eigenen Auftrag, Bremsen (3 Korrekturen, 2 Konflikte) pausieren einen Strang, bevor er endlos Tokens verbraucht, ein Epic wird auf einem Branch mit einem Pull Request bearbeitet, und ein in einem Kommentar erwähnter Bot antwortet aus Wiki, Items und Code. Um Items zu bearbeiten, brauchen Agenten die vier Schritte der Agenten im Workflow des Projekts (In Arbeit, In Review, Korrektur, Gemergt); eine Antwort auf eine Erwähnung braucht keinen davon. Kann ein als Agent eingerichteter Bot auf eine Erwähnung nicht antworten (Agent aus, keine verantwortliche Person, deaktiviert, darf die Items des Projekts nicht ändern), sagt der Standard-Bot in einem Kommentar am Item, warum, und wer es ändert ([Erwähnungen](https://werkbuch.dev/de/concepts/agents#erwahnungen)). Siehe [Agenten](https://werkbuch.dev/de/concepts/agents).
- **Runner:** `werkbuch-runner` läuft auf einem Mac oder Linux-Rechner von dir mit Claude Code oder Codex und ruft immer nur deine Instanz. Die Instanz liefert ihn selbst aus: **Einstellungen → Runner → Runner verbinden** zeigt einen Befehl mit `/runner/install.sh` und einem Einmal-Code, der ihn installiert, koppelt und als Dienst seines Benutzers startet; er aktualisiert sich selbst auf die Version der Instanz. Ohne Befehl öffnet er eine Terminal-Oberfläche mit Status, den Aufträgen samt Live-Protokoll und dem Doctor. Siehe [Runner](https://werkbuch.dev/de/runner).
- **GitHub:** Eine private GitHub-App je GitHub-Konto (dein eigenes, eine Organisation oder mehrere), angelegt unter **Einstellungen → GitHub** (**Weitere App hinzufügen** für jedes weitere Konto, siehe [Eine App je Konto](https://werkbuch.dev/de/github#eine-app-je-konto)) und auf den Repos installiert, an denen die Agenten arbeiten sollen; jedes Projekt wählt unter **Projekteinstellungen → Agenten** sein Repo, den Basis-Branch und die Merge-Methode. werkbuch hört Pushes, Pull Requests und Checks über den Webhook der Apps und pausiert die Agenten eines Projekts, wenn auf seinem Basis-Branch ein Merge landet, den werkbuch nicht gemacht hat. **Trennen** gilt je App und lässt die anderen Apps und ihre Projekte in Ruhe ([Trennen](https://werkbuch.dev/de/github#trennen)). Siehe [GitHub](https://werkbuch.dev/de/github).
- **Pull Requests an Items:** Ein Pull Request im Repo eines Projekts verknüpft sich mit den Items, die er in Branch-Name, Titel oder Beschreibung nennt; `Fixes <KEY>` und die anderen schließenden Wörter schließen das Item beim Merge, `skip` nimmt eine Verknüpfung zurück. Ein offener Pull Request schiebt seine Items nach In Review, der Merge nach Gemergt. Das Item zeigt seine Pull Requests mit ihren Checks und dem Urteil des Reviews.
- **Oberfläche:** Einstellungen für Runner, GitHub, Bots als Agenten (Runner-Pool, CLI, Modelle), Arbeitsregeln für die Prompts, Hinweise je Typ und je Projekt Repo, Review-Agent und Bremsen; am Item jeder Auftrag in der Aktivität mit Live-Protokoll, Abbrechen und Erneut starten, dazu ein Hinweis, wenn der Agent eine Person braucht. Über REST und MCP: Runner, Aufträge und Agenten (`agents`, `manage-agents`).
- **Aktivität:** Die Aktivität eines Items zeigt das Neueste zuerst, das Kommentarfeld steht oben, ein neuer Kommentar direkt darunter. Was andere inzwischen schreiben oder ändern, kommt oben dazu, und die Zeile, die du liest, bleibt, wo sie ist ([History](https://werkbuch.dev/de/concepts/work-items#history)).
- **Verweise im Editor:** Verweise auf Items und Seiten sind auch beim Bearbeiten eines Texts Links: Ein Klick öffnet ein Item in der Vorschau bzw. eine Seite als Seite, mit `strg` oder `cmd` in einem neuen Tab; die Pfeiltasten wählen einen Verweis aus, `enter` öffnet ihn. Beim Lesen öffnet ein Klick auf einen Item-Verweis jetzt ebenfalls die Vorschau. Siehe [Verweise](https://werkbuch.dev/de/concepts/rich-text#verweise).
- **Update:** Die Datenbank migriert beim Start. Die Compose-Dateien und `.env.docker.example` haben sich nicht geändert: wie unter [Aktualisieren](https://werkbuch.dev/de/upgrading) beschrieben aktualisieren. `0.4.0-rc.5` ist ein Vorab-Release, `latest` bleibt auf 0.3.2: Zum Ausprobieren `WERKBUCH_IMAGE=baeroe/werkbuch:0.4.0-rc.5` in der `.env` setzen (in der Standalone-Compose-Datei die Zeile `image:`).
- **Von 0.4.0-rc.4 kommend:** Der Workflow hat zwei optionale Schritte der Agenten. Mit **Todo (bereit für den Agenten)** beginnt ein Bot ein Item erst, wenn es in diesem Status steht, nicht schon im Backlog. Mit **Pending (wartet auf eine Person)** kommentiert ein Agent, der ohne eine Person nicht weiterkommt, was er braucht, und schiebt das Item dorthin; der Strang wartet, bis das Item wieder dem Bot zugewiesen wird. **Vorschlag übernehmen** im Workflow-Editor füllt beide, ohne sie arbeiten Agenten wie bisher. Ein Bot beginnt ein Item außerdem erst, wenn jedes Item, das es blockiert (Relation *blockiert*), erledigt ist. Der Vertrag, den werkbuch jedem Prompt mitgibt, steht jetzt in der Sprache der Organisation. Eine Korrektur, die nur den Nachweis setzt, startet ein neues Review. Der Runner beendet einen Auftrag beim ersten Ergebnis (eine Aufgabe im Hintergrund überschreibt es nicht mehr), führt den Setup-Befehl auch für einen vorhandenen Worktree aus, hält das Git-Token von Reviews und Antworten fern, und ein neuer Strang eines Items kollidiert nicht mehr mit dem Branch eines früheren. Die App eines Strangs läuft nach seinem Auftrag nicht mehr weiter: Ein neuer **Stop-Befehl** je Projekt (**Projekteinstellungen → Agenten**, bei DDEV `ddev stop`) läuft nach jedem Code-Auftrag im Worktree, und der Worktree eines beendeten Strangs (gemergt oder geschlossen) wird beim nächsten Kontakt des Runners samt Teardown entfernt statt erst nach drei Tagen; setz den Stop-Befehl in deinen Projekten, ohne ihn ändert sich nichts. Die Agenten-Einstellungen eines Projekts (`PUT /api/v1/projects/{project}/agents`, MCP `save-project-agents`) verlangen jetzt den Schlüssel `stop_command` (`null` für keinen). Runner aktualisieren sich selbst. Ein Epic wird wieder als bereit markiert: werkbuch fordert dafür bei GitHub `contents: write` an (mit rc.4 blieb jedes Epic ein Draft). Dazu: Ein Klick auf den Key eines Items kopiert ihn, und der Filter bietet „Nicht zugewiesen“ direkt in seiner Werteliste. Siehe [Agenten](https://werkbuch.dev/de/concepts/agents).
- **Von 0.4.0-rc.3 kommend:** Agenten lesen vor jeder Arbeit selbst das Item, seine Kommentare und die Bilder darin: Der Auftrag nennt die Aufrufe von `werkbuch-run` wörtlich, und scheitert das Lesen, bricht der Agent ab, statt aus Titel und Code zu raten (mit rc.3 arbeiteten Aufträge oft ohne die Beschreibung). Bilder liefert das MCP-Tool `attachments` mit `action: content` (PNG, JPEG, GIF und WebP bis 3,75 MB); ein Aufruf von `attachments` ohne `action` liest wie bisher. Eigene Arbeitsregeln, die das Item auf anderem Weg lesen lassen, an den Auftrag angleichen ([Prompt und Regeln](https://werkbuch.dev/de/concepts/agents#prompt-und-regeln)). Damit Agenten testen können, braucht ein Projekt einen Setup-Befehl, der die Umgebung je Worktree anlegt ([Runner](https://werkbuch.dev/de/runner)).
- **Von 0.4.0-rc.2 kommend:** Mit rc.2 scheiterte jeder Code-Auftrag sofort: Der Runner lehnte die neuen Installations-Tokens von GitHub (mit Punkten) ab. rc.3 nimmt sie an und schwärzt sie in Protokollen vollständig. Runner aktualisieren sich selbst auf die Version der Instanz, zu tun ist nichts. GitHub verbinden wartet jetzt bis zu 30 Sekunden, bis GitHub den Code in die App umwandelt; antwortet GitHub nicht, sagt werkbuch das und verlinkt die Liste der Apps des Kontos, falls GitHub trotzdem eine angelegt hat ([Fehlersuche](https://werkbuch.dev/de/github#fehlersuche)). Ein Proxy, der 60 Sekunden auf eine Antwort wartet (der Standard von nginx), reicht ([Runner und GitHub](https://werkbuch.dev/de/reverse-proxy#runner-und-github)).
- **Von 0.4.0-rc.1 kommend:** GitHub verbinden geht jetzt (rc.1 scheiterte bei GitHub mit 422, weil werkbuch ein leeres JSON-Array als Body schickte). REST und MCP haben sich mit den Apps je Konto geändert: `DELETE /api/v1/github` ist jetzt `DELETE /api/v1/github/apps/{id}`, `GET /api/v1/github` und `agents:get-github` antworten mit `apps` (jede mit ihren `installations`) statt `app` und `installations`, und `POST /api/v1/github/manifest` nimmt `owner` und `owner_type` (`User` oder `Organization`) statt `organization`.
- **Ausgehende Verbindungen:** Mit verbundenem GitHub rufen `queue` und `werkbuch` `api.github.com:443`, und GitHub liefert seine Webhooks an `POST /github/webhook`, das per HTTPS aus dem Internet erreichbar sein muss ([GitHub](https://werkbuch.dev/de/github#der-webhook-hinter-dem-proxy)). Runner laden den Runner von deiner Instanz und brauchen ausgehendes HTTPS zu ihr und, bei Projekten mit Repo, zu `github.com` (dazu, was Claude Code oder Codex selbst brauchen), aber keinen offenen Port. Siehe [Betrieb](https://werkbuch.dev/de/operations#runner-und-github).
- Image `baeroe/werkbuch:0.4.0-rc.5` für `linux/amd64` und `linux/arm64`.

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
