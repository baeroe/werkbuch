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
- **Meilisearch:** Eine neue Version von Meilisearch liest den Index einer älteren nicht immer; sie stoppt dann mit einem Fehler zur Version ihrer Datenbank (`docker compose logs meilisearch`), und `werkbuch` startet nicht. Der Index kommt aus der Datenbank, also ihn löschen und von werkbuch neu bauen lassen:

  ```bash
  docker compose rm -sf meilisearch
  docker volume rm werkbuch_meili-data     # <projekt>_meili-data, siehe docker volume ls
  docker compose up -d
  ```

  Der Start findet den Index leer und importiert alles; bis dahin ist die Suche leer. Zurück zum älteren Meilisearch geht es danach nur mit denselben Schritten.
- **Zurück:** Migrationen werden nicht zurückgerollt. Die Sicherung wiederherstellen und die alte Version festlegen.

Alle Versionen und ihre Änderungen: https://github.com/baeroe/werkbuch/releases

## Hinweise je Version

<!-- nur absolute Links: jeder Abschnitt der englischen Fassung wird zu den Notizen seines GitHub-Releases -->

### 0.1.0

- Erstes Release: Projekte mit Mitgliedern, Work Items mit eigenen Typen, Properties und Workflows, Liste, Board, Tabelle und Timeline, gespeicherte Views, ein Wiki je Projekt, Vorlagen mit Zeitplänen, Automatisierungen, Benachrichtigungen mit Mail und Live-Updates, Suche, eine REST-API mit ihrer OpenAPI-Referenz, ein MCP-Server für KI-Agenten und signierte Webhooks, auf Englisch und Deutsch.
- Image `baeroe/werkbuch:0.1.0` für `linux/amd64` und `linux/arm64`. Läuft als Docker-Compose-Stack mit MariaDB 11.4 und Meilisearch 1.56, siehe [Einrichtung](https://github.com/baeroe/werkbuch/blob/main/docs/de/setup.md).
