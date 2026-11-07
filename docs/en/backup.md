# Backup

A backup has three parts: the database (volume `mariadb-data`), the files (volume `werkbuch-data`: attachments with their previews, the pictures of the organization, accounts and projects, and the keys `.app-key`, `.reverb-app-key`, `.reverb-app-secret`) and your `.env`. The search index (volume `meili-data`) needs no backup: werkbuch builds it from the database on the next start.

`.app-key` is the `APP_KEY` of the instance. It encrypts the secrets of the webhooks and the second factors with their recovery codes: without it, everyone with a second factor is locked out and every webhook needs a new secret. It is in the data volume, so the backup of the files below holds it. If you set `APP_KEY` in `.env` instead, the `.env` in the backup is what holds it.

Run the commands next to `docker-compose.yml`, the stack keeps running. With the [standalone compose file](/en/setup#quick-start-paste-and-deploy) run them in the stack's folder (Dockge: `/opt/stacks/<name>/`); the compose file itself takes the place of `.env` in the backup.

## Back up

Database first, then the files, so every attachment in the dump has its file:

```bash
# 1. database: a consistent snapshot, as the user werkbuch
docker compose exec -T mariadb sh -c 'exec mariadb-dump -uwerkbuch -p"$MARIADB_PASSWORD" --single-transaction werkbuch' > werkbuch-db-$(date +%F).sql

# 2. files of the data volume, the keys included
docker compose exec -T werkbuch tar czf - -C /var/www/html/storage/app . > werkbuch-data-$(date +%F).tar.gz
```

Keep both files and a copy of `.env` somewhere else than the server. For a nightly backup put both commands into a script and run it from cron.

## Restore

A restore replaces everything. On a new server: copy `docker-compose.yml` and `.env` there first. On the existing server, remove the old data (this deletes it!):

```bash
docker compose down -v
```

Then:

```bash
# 1. empty database (MariaDB creates the database "werkbuch" and its user from .env)
docker compose up -d --wait mariadb
docker compose exec -T mariadb sh -c 'exec mariadb -uwerkbuch -p"$MARIADB_PASSWORD" werkbuch' < werkbuch-db-2026-11-07.sql

# 2. files into the data volume
docker compose run --rm --no-deps -T --entrypoint tar werkbuch xzf - -C /var/www/html/storage/app < werkbuch-data-2026-11-07.tar.gz

# 3. start werkbuch
docker compose up -d
```

werkbuch finds the restored keys in the data volume, so sessions, second factors and webhook secrets stay valid, and it builds the search index on this start. Open an item with an attachment as a check.

## The root user of MariaDB

Backups and werkbuch use the user `werkbuch`, never root. With `docker-compose.yml`, root has the password `DB_ROOT_PASSWORD` and can only log in from inside the `mariadb` container (`MARIADB_ROOT_HOST=localhost`):

```bash
docker compose exec mariadb sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
```

In the standalone compose file, root has no password anybody knows: its password hash matches no password, and nothing about it is written to the log. If you ever need root there, for example because `DB_PASSWORD` was changed after the first start and werkbuch no longer gets in, start MariaDB once without its privilege checks, reachable only from inside its container:

```bash
docker compose stop
docker compose run --rm --no-deps --name werkbuch-db-rescue --entrypoint docker-entrypoint.sh mariadb mariadbd --skip-grant-tables --skip-networking
```

In a second terminal:

```bash
docker exec -it werkbuch-db-rescue mariadb
```

```sql
FLUSH PRIVILEGES;
ALTER USER 'werkbuch'@'%' IDENTIFIED BY 'the DB_PASSWORD of the compose file';
```

Then stop the rescue container with `Ctrl+C` in the first terminal and start the stack with `docker compose up -d`.

## Notes

- `docker compose down -v` deletes all three volumes. Without `-v`, `down` keeps them.
- Moving to a new server is a backup on the old one plus a restore on the new one, with the same `.env`. The data volume carries `.app-key` along; never start the new server with another `APP_KEY`.
- `app:prune-attachments` deletes pictures and files for good: run it after a backup.
