# Setup with Docker Compose

werkbuch runs as a Docker Compose stack of eight services. Six of them come from one image, `baeroe/werkbuch` (for `linux/amd64` and `linux/arm64`): the web service, Reverb for the live updates, three queue workers and the scheduler. The other two are MariaDB 11.4 and Meilisearch 1.56. Everything is reachable over one port; HTTPS comes from a reverse proxy in front of it (see [Reverse proxy](/en/reverse-proxy)).

## Requirements

- Docker Engine with Compose v2.20 or newer: the services start in the order of their health checks (`depends_on` with `condition: service_healthy`).
- A machine with `amd64` or `arm64`.
- At least 2 vCPU and 2 GB of RAM, 4 GB recommended. The memory goes to:
  - Meilisearch, which keeps the search index in memory and takes up to two thirds of the RAM while it indexes. On a tight machine, set `MEILI_MAX_INDEXING_MEMORY` (in bytes, for example `536870912` for 512 MiB) in the `environment` of `meilisearch`.
  - MariaDB.
  - PHP-FPM in the web service, with up to 20 processes of at most 512 MB each. A request usually takes 30 to 60 MB, but on a 2 GB host set `PHP_FPM_PM_MAX_CHILDREN=8` in the `environment` of `werkbuch`.
  - Four worker containers: three queues and the scheduler.
- 10 GB of disk, plus what the attachments take.

Settings like these two belong in a `docker-compose.override.yml` next to `docker-compose.yml`; `docker compose` reads it on its own. In the standalone file, add them to the services there.

```yaml
services:
  werkbuch:
    environment:
      PHP_FPM_PM_MAX_CHILDREN: "8"
  meilisearch:
    environment:
      MEILI_MAX_INDEXING_MEMORY: "536870912" # bytes, 512 MiB
```

## Quick start: paste and deploy

One compose file with everything in it, no `.env`:

1. Paste the block below into a new stack in Dockge or Portainer, or save it as `compose.yaml` on your server.
2. Change the five values at the top: `APP_URL` (the https address of your reverse proxy), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DB_PASSWORD` and `MEILISEARCH_KEY`. Choose long random values, for example with `openssl rand -hex 24`; the key of Meilisearch needs at least 16 characters.
3. Deploy (Dockge, Portainer) or run `docker compose up -d`. Wait for `werkbuch: ready` in the logs of `werkbuch`, then open `APP_URL` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

werkbuch refuses to start while one of the three is still `change-me`: the web service stops on each of them (on the admin password only as long as there is no account), MariaDB on the database password, Meilisearch on its key. It listens on port `7740` of the server: point your reverse proxy at `http://<server>:7740`.

The first admin is created on the first start. After that the admin password at the top is no longer read: put `change-me` back there, so your password is not left in the file. Keep the line itself, the services refer to it. Keep `DB_PASSWORD` as it is: MariaDB stores it on the first start. Nobody can log in to MariaDB as root in this file (its password hash matches no password); backups use the user `werkbuch`.

<<< @/../docker-compose.standalone.yml{yaml}

To change anything else of this file, edit it in place: the block `x-werkbuch-environment` holds the settings of every werkbuch container, the line `image:` the version. If you prefer the settings in a separate `.env` next to the compose file (for example to keep the compose file unchanged on updates), use the way below instead.

## Files

```bash
mkdir werkbuch && cd werkbuch
curl -fsSLO https://raw.githubusercontent.com/baeroe/werkbuch/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/baeroe/werkbuch/main/.env.docker.example
```

## .env

Fill in `.env` before the first start. The passwords are empty in the template on purpose: until they are set, `docker compose up` stops with `DB_PASSWORD missing` (or `DB_ROOT_PASSWORD`, `MEILISEARCH_KEY`, `APP_URL`, `ADMIN_EMAIL`).

| Variable | Required | Meaning |
|---|---|---|
| `APP_URL` | yes | Public address including `https://`, without a trailing slash, e.g. `https://pm.example.com`. Links, mails, the address of the live updates and the allowed `Host` header come from it: requests for any other host get `400`. Cookies are marked secure when it starts with `https://`. Without a proxy, for a first look on your own machine: `http://localhost:7740`. |
| `APP_LOCALE` | no | `en` (default) or `de`: the language of the organization, set when it is created on the first start. Change it later under **Settings → General**. |
| `WERKBUCH_IMAGE` | no | Default `baeroe/werkbuch:latest`. Pin a version, see [Versions](#versions). |
| `WERKBUCH_BIND`, `WERKBUCH_PORT` | no | Host address and port of the web service, default `0.0.0.0` and `7740` (the container listens on `8080`). `WERKBUCH_BIND=127.0.0.1` keeps the port local, for a proxy on the same host (not in a container), see [Reverse proxy](/en/reverse-proxy#what-werkbuch-trusts). |
| `ADMIN_EMAIL` | yes | Email of the first admin. Compose refuses to start without it, also later; it is only used while werkbuch has no account. |
| `ADMIN_PASSWORD` | first start | Password of the first admin, at least 8 characters, never `change-me`. Read only while werkbuch has no account; remove it once you have signed in, see [Passwords](#passwords). |
| `DB_PASSWORD` | yes | Password of the database user `werkbuch`. MariaDB stores it on the first start; changing it in `.env` afterwards breaks the connection. |
| `DB_ROOT_PASSWORD` | yes | Password of the MariaDB root user. Root can only log in from inside the `mariadb` container. |
| `MEILISEARCH_KEY` | yes | Master key of Meilisearch, at least 16 characters (`openssl rand -hex 32`). With a shorter key Meilisearch does not start, and werkbuch waits for it. |
| `APP_KEY` | no | Encryption key of the app. Empty: made on the first start and kept in the data volume. Never change it later, see [What lives where](#what-lives-where). |
| `REVERB_APP_KEY`, `REVERB_APP_SECRET` | no | Key and secret of the live updates (Reverb). Empty: made on the first start and kept in the data volume. |
| `TRUSTED_PROXIES` | no | IP addresses or CIDR networks (no host names) whose `X-Forwarded-*` headers werkbuch believes, comma-separated. Empty: localhost and the private networks. Narrow it to your proxy, see [Reverse proxy](/en/reverse-proxy#what-werkbuch-trusts). |
| `MAIL_MAILER` | no | `log` (default) writes mails to the log and sends nothing: invitations are handed on as links, “Forgot password” is hidden and notifications stay in the inbox. `smtp` sends them. |
| `MAIL_SCHEME` | no | `smtps` for TLS from the first byte. Empty: `smtps` on port 465, otherwise `smtp`, which switches to TLS when the server offers it. |
| `MAIL_HOST`, `MAIL_PORT` | with `smtp` | Mail server and port (default `587`). |
| `MAIL_USERNAME`, `MAIL_PASSWORD` | with `smtp` | Login at the mail server, if it needs one. |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | no | Sender of every mail, default `werkbuch@example.com` and `werkbuch`. |
| `ATTACHMENTS_MAX_MB` | no | Largest upload in MB, default `25`. PHP and nginx in the image take 30 and 32 MB: a larger value has no effect beyond that, the upload ends in `413` first (the log of the web service warns at the start). |
| `NOTIFICATION_MAIL_DELAY` | no | Minutes until the notifications of a work item go out in one mail, default `5`. |
| `WEBHOOKS_ALLOW_PRIVATE` | no | `true` lets webhooks reach private networks (`10.x`, `172.16.x`, `192.168.x`, localhost and the like); addresses of cloud metadata services and link-local stay blocked. Default `false`. See [Webhooks](/en/webhooks). |
| `API_RATE_LIMIT` | no | Requests a minute of the REST API per token or, without a token, per IP address. Default `600`. |
| `API_SESSION_RATE_LIMIT` | no | Requests a minute of the REST API per signed-in browser session. Default `3000`. |
| `MCP_RATE_LIMIT` | no | Requests a minute of the [MCP server](/en/mcp) per token or per IP address. Default `300`. |

Only these variables reach the containers: the compose file passes them on. Anything else goes into the `environment` of a service, best in a `docker-compose.override.yml` (see [Requirements](#requirements)). Never set a variable that starts with `PHP_`, `NGINX_`, `SSL_`, `LOG_` or `TRUSTED_PROXY` to an empty value there: the start script of the base image then stops the web service.

The address the browser uses for the live updates comes from `APP_URL` (host, port and `wss://` for `https://`). `REVERB_PUBLIC_HOST`, `REVERB_PUBLIC_PORT` and `REVERB_PUBLIC_SCHEME` set another one; they are only needed when the browser does not reach Reverb under `APP_URL`, which with the stack and a proxy in front never happens. They are not in `.env`: add them to the `environment` of `werkbuch` if you need them.

## Start

```bash
docker compose up -d
docker compose logs -f werkbuch    # wait for "werkbuch: ready", then Ctrl+C
```

`docker compose up -d` returns once `werkbuch` is healthy, because the workers wait for it; on the first start that can take a few minutes. With `--wait` it returns only when every service is healthy. Then open `APP_URL` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

On every start the web service:

1. stops if `DB_PASSWORD` or `MEILISEARCH_KEY` is still `change-me`,
2. takes `APP_KEY`, `REVERB_APP_KEY` and `REVERB_APP_SECRET` from the environment, else from the data volume, else makes them once and writes them there (`werkbuch: generated APP_KEY in storage/app/.app-key (data volume)`),
3. waits up to 60 seconds for the database; if it is not reachable, it stops with `werkbuch: database mariadb:3306 not reachable after 60s` and Docker starts it again,
4. migrates the database,
5. creates the first admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` while werkbuch has no account,
6. sends the settings of the search indexes to Meilisearch and fills the index when it is empty or lacks fields of this version,
7. builds its caches (configuration with the keys, routes, views, events),
8. builds the OpenAPI document and warns when `ATTACHMENTS_MAX_MB` is larger than PHP takes,
9. logs `werkbuch: ready` and starts nginx and PHP-FPM.

A step that fails stops the container with a message, so a half-migrated instance never serves requests. Meilisearch has to be healthy before the web service starts. The workers, the scheduler and Reverb start once the web service is healthy, read the keys from the data volume, build only their caches and log `werkbuch: ready: php artisan …`; they never migrate.

`werkbuch: no account yet, set ADMIN_EMAIL and ADMIN_PASSWORD and restart` means: no admin was created because `ADMIN_PASSWORD` is empty. On a new instance, set it in `.env` and run `docker compose up -d` again. The same line appears on every start once you have removed `ADMIN_PASSWORD` after the first sign-in; as long as you can sign in, it changes nothing.

## Passwords

`ADMIN_PASSWORD` is only needed for the first start. Once you have signed in, delete the line from `.env` and run `docker compose up -d`, so the password no longer sits in the file and in the environment of the container. In the standalone file, put `change-me` back instead (see [Quick start](#quick-start-paste-and-deploy)).

Everyone changes their own password, and sets up a second factor, under **Personal settings → Security**. A forgotten password is reset on the server; the command asks for the new one twice without showing it:

```bash
docker compose exec werkbuch php artisan app:reset-password admin@example.com
```

Without a terminal it reads the first line of its input instead, e.g. `docker compose exec -T werkbuch php artisan app:reset-password admin@example.com < new-password.txt`. The password is never an argument, so it does not end up in the shell history. Resetting signs the account out everywhere; its API tokens stay valid.

Someone who lost both the authenticator app and the recovery codes gets the second factor turned off; they then sign in with the password alone and can set it up again:

```bash
docker compose exec werkbuch php artisan app:reset-two-factor admin@example.com
```

## Services

| Service | Does | Networks | Health check |
|---|---|---|---|
| `werkbuch` | nginx and PHP-FPM on port `8080`, published as `7740`; migrates on start, forwards `/app/` (the WebSocket) to Reverb | `default`, `backend` | `/up` for the host of `APP_URL` |
| `reverb` | the WebSocket server of the live updates on port `6001` | `backend` | `/up` on port `6001` |
| `queue` | worker for the queues `default`, `live`, `notifications`, `bulk`: events, live updates, notification mails, deleting projects | `default`, `backend` | the worker process runs |
| `queue-index` | worker for `search` and `media`: the search index and the previews of pictures | `default`, `backend` | the worker process runs |
| `queue-webhooks` | worker for `webhooks`: the deliveries | `default`, `backend` | the worker process runs |
| `scheduler` | starts the scheduled work: notification mails, reminders, templates, the nightly automations, clean-up | `default`, `backend` | the scheduler process runs |
| `mariadb` | the database, started with `--max-allowed-packet=64M` | `backend` | MariaDB answers and InnoDB is ready |
| `meilisearch` | the search | `backend` | `/health` |

`backend` is an internal network: no published port and no way out to the internet. MariaDB, Meilisearch and Reverb are only in there. The web service is the only one with a published port; the workers and the scheduler are in `default` too, because they send mails and webhooks.

Search and previews have a worker of their own, `queue-index`, so they don't wait behind the events of every change; webhooks have one, `queue-webhooks`, because a receiver that hangs holds its worker for up to 17 seconds per attempt. Run exactly one `queue-index`, never scale it.

All werkbuch containers run as `www-data` with `no-new-privileges`; the code in the image is read-only for them.

## What lives where

| What | Where |
|---|---|
| Attachments and their previews, pictures of the organization, accounts and projects, and the keys `.app-key`, `.reverb-app-key`, `.reverb-app-secret` | volume `werkbuch-data` (`/var/www/html/storage/app` in the containers; Reverb mounts it read-only) |
| Database: projects, work items, wiki, everything else, sessions and the queues | volume `mariadb-data` |
| Search index | volume `meili-data`; werkbuch rebuilds it from the database on the next start when it is empty |
| Settings | `.env` next to `docker-compose.yml`, or the block at the top of the standalone file |
| Logs | none on disk: `docker compose logs` |

Containers can be recreated at any time, the volumes stay. `docker compose down -v` deletes them, and with them the database, every upload and the keys.

`.app-key` belongs in every backup and must never get lost. `APP_KEY` encrypts the secrets of the webhooks and the second factors with their recovery codes: with another key, everyone with a second factor is locked out, and every webhook needs a new secret. Never change `APP_KEY` later. If you set it in `.env`, set it before the first start; on an instance that already has `.app-key`, leave it empty. The Reverb keys are less critical: new ones only need a reload of the open tabs.

## Your own MariaDB

To use an existing MariaDB 11.4 instead of the `mariadb` service, edit `docker-compose.yml`:

1. Remove the service `mariadb` and the entry `mariadb` under `depends_on` of `werkbuch`.
2. Add `DB_HOST`, `DB_PORT`, `DB_DATABASE` and `DB_USERNAME` to the block `x-werkbuch-environment` (defaults `mariadb`, `3306`, `werkbuch`, `werkbuch`); `DB_PASSWORD` is there already. `DB_WAIT_TIMEOUT` sets how many seconds the start waits for it (default 60).
3. Give the user all privileges on its database.
4. Set `max_allowed_packet` to at least `64M` in the configuration of that server. Webhook deliveries are written in one statement, one body of up to 1 MiB per webhook, and the default of 16 MiB is too small for that.

The database has to be reachable from the network `default` of the stack.

## Storage

Uploads are stored in the volume `werkbuch-data` only. S3 or another object storage is not supported in this version; plan the disk for your attachments and back up the volume.

## Versions

`latest` follows every release. Pin a version with `WERKBUCH_IMAGE` in `.env`, as a tag such as `WERKBUCH_IMAGE=baeroe/werkbuch:0.1.0` or, to be sure the image never changes under the tag, with its digest: `WERKBUCH_IMAGE=baeroe/werkbuch:0.1.0@sha256:…` (`docker buildx imagetools inspect baeroe/werkbuch:0.1.0` shows it). Then `docker compose pull` fetches only what you chose. In the standalone file, change the line `image:` instead.

## docker-compose.yml

The complete compose file, the same one `curl` downloads above from the main branch. Usually you leave it as it is: everything you set goes into `.env`.

<<< @/../docker-compose.yml{yaml}
