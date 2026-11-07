# Sicherung

Eine Sicherung hat drei Teile: die Datenbank (Volume `mariadb-data`), die Dateien (Volume `werkbuch-data`: Anhänge mit ihren Vorschauen, die Bilder von Organisation, Konten und Projekten und die Schlüssel `.app-key`, `.reverb-app-key`, `.reverb-app-secret`) und die Konfiguration: die `.env` und, falls vorhanden, die `docker-compose.override.yml`. Der Suchindex (Volume `meili-data`) braucht keine Sicherung: werkbuch baut ihn beim nächsten Start aus der Datenbank.

`.app-key` ist der `APP_KEY` der Instanz. Er verschlüsselt die Geheimnisse der Webhooks und die zweiten Faktoren samt Recovery-Codes: Ohne ihn ist jede Person mit zweitem Faktor ausgesperrt, und jeder Webhook braucht ein neues Geheimnis. Er liegt im Daten-Volume, die Sicherung der Dateien unten enthält ihn also. Steht `APP_KEY` stattdessen in der `.env`, hält ihn die `.env` in der Sicherung.

Die Befehle neben `docker-compose.yml` ausführen, der Stack läuft dabei weiter. Mit der [Standalone-Compose-Datei](/de/setup#schnellstart-einfugen-und-deployen) im Ordner des Stacks (Dockge: `/opt/stacks/<name>/`); dort ersetzt die Compose-Datei selbst die `.env` in der Sicherung.

## Sichern

Erst die Datenbank, dann die Dateien, so hat jeder Anhang im Dump seine Datei:

```bash
# 1. Datenbank: ein konsistenter Stand, als Benutzer werkbuch
docker compose exec -T mariadb sh -c 'exec mariadb-dump -uwerkbuch -p"$MARIADB_PASSWORD" --single-transaction werkbuch' > werkbuch-db-$(date +%F).sql

# 2. Dateien des Daten-Volumes, die Schlüssel eingeschlossen
docker compose exec -T werkbuch tar czf - -C /var/www/html/storage/app . > werkbuch-data-$(date +%F).tar.gz
```

Zwischen Dump und `tar` liegen Sekunden. Ein Anhang, der dazwischen gelöscht wird, steht im Dump, aber seine Datei fehlt im Archiv; eine Datei, die dazwischen dazukommt, belegt nur Platz. Die Sicherung zu einer ruhigen Zeit laufen lassen, etwa nachts. `tar` endet mit Exitcode 1 und `file changed as we read it`, wenn sich eine Datei ändert, während es sie liest (eine Vorschau, die gerade entsteht): Die Sicherung dann wiederholen.

Beide Dateien und eine Kopie der `.env` und der `docker-compose.override.yml` an einem anderen Ort als dem Server aufbewahren. Für eine nächtliche Sicherung beide Befehle in ein Skript schreiben und per cron ausführen.

## Wiederherstellen

Eine Wiederherstellung ersetzt alles. Auf einem neuen Server: zuerst `docker-compose.yml`, `.env` und, falls vorhanden, `docker-compose.override.yml` dorthin kopieren. Auf dem bestehenden Server die alten Daten entfernen (das löscht sie!):

```bash
docker compose down -v
```

Dann:

```bash
# 1. leere Datenbank (MariaDB legt die Datenbank "werkbuch" und ihren Benutzer aus der .env an)
docker compose up -d --wait mariadb
docker compose exec -T mariadb sh -c 'exec mariadb -uwerkbuch -p"$MARIADB_PASSWORD" werkbuch' < werkbuch-db-2026-11-07.sql

# 2. Dateien ins Daten-Volume
docker compose run --rm --no-deps -T --entrypoint tar werkbuch xzf - -C /var/www/html/storage/app < werkbuch-data-2026-11-07.tar.gz

# 3. werkbuch starten
docker compose up -d
```

werkbuch findet die wiederhergestellten Schlüssel im Daten-Volume, so bleiben Sitzungen, zweite Faktoren und die Geheimnisse der Webhooks gültig, und es baut den Suchindex bei diesem Start. Zur Probe ein Item mit Anhang öffnen.

## Der root-Benutzer von MariaDB

Sicherungen und werkbuch nutzen den Benutzer `werkbuch`, nie root. Mit `docker-compose.yml` hat root das Passwort `DB_ROOT_PASSWORD` und kann sich nur im Container `mariadb` anmelden (`MARIADB_ROOT_HOST=localhost`):

```bash
docker compose exec mariadb sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
```

In der Standalone-Compose-Datei hat root kein Passwort, das jemand kennt: Der Hash seines Passworts passt zu keinem Passwort, und nichts davon steht im Log. Braucht man dort doch root, etwa weil `DB_PASSWORD` nach dem ersten Start geändert wurde und werkbuch nicht mehr hineinkommt, MariaDB einmal ohne Rechteprüfung starten, erreichbar nur in seinem Container:

```bash
docker compose stop
docker compose run --rm --no-deps --name werkbuch-db-rescue --entrypoint docker-entrypoint.sh mariadb mariadbd --skip-grant-tables --skip-networking
```

In einem zweiten Terminal:

```bash
docker exec -it werkbuch-db-rescue mariadb
```

```sql
FLUSH PRIVILEGES;
ALTER USER 'werkbuch'@'%' IDENTIFIED BY 'das DB_PASSWORD der Compose-Datei';
```

Dann den Rettungs-Container im zweiten Terminal mit `docker stop werkbuch-db-rescue` stoppen (MariaDB übergeht das `Ctrl+C` des ersten Terminals; `docker stop` fährt es sauber herunter, und `--rm` entfernt den Container) und den Stack mit `docker compose up -d` starten.

## Hinweise

- `docker compose down -v` löscht alle drei Volumes. Ohne `-v` behält `down` sie.
- Ein Umzug auf einen neuen Server ist eine Sicherung auf dem alten und eine Wiederherstellung auf dem neuen, mit derselben `.env` und `docker-compose.override.yml`. Das Daten-Volume nimmt `.app-key` mit; den neuen Server nie mit einem anderen `APP_KEY` starten.
- `app:prune-attachments` löscht Bilder und Dateien endgültig: nach einer Sicherung ausführen.
