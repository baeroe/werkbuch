# Operations

What runs in the stack, what goes out of it, and the switches for running werkbuch over time. Setting it up is under [Setup](/en/setup), the proxy in front under [Reverse proxy](/en/reverse-proxy).

## Workers and scheduler

All work in the background goes through queues in the database. Three worker services take them, each container one worker:

| Service | Queues, in this order | Does |
|---|---|---|
| `queue` | `default`, `live`, `notifications`, `bulk` | hands every event to its consumers, sends the live updates to Reverb, writes the inbox and sends mails (notifications, invitations, password reset), deletes projects, runs templates and the nightly automations |
| `queue-index` | `search`, `media` | keeps the search index in step with every change, makes the previews of uploaded pictures |
| `queue-webhooks` | `webhooks` | delivers webhooks |

A worker takes the first queue of its list that has a job. Search and previews have a worker of their own because every event makes jobs for `default`, `live` and `notifications`; webhooks have one because a receiver that hangs holds its worker for up to 17 seconds per attempt. Every worker ends after an hour (`--max-time=3600`) and Docker starts it again (`restart: unless-stopped`); a job that fails is tried up to three times unless it sets its own number of attempts.

Run exactly one `queue-index`, never scale it: two workers on `search` can write an older version of a document over a newer one while they rebuild, and the search shows the older text until the item changes again.

`scheduler` runs `php artisan schedule:work` with the tasks of `routes/console.php`. It only puts work on the queues, the workers do it:

| When | What |
|---|---|
| every minute | `app:redispatch-events` (events whose hand-over got lost), `app:send-notification-mails` (collected mails that lost their job), `app:run-templates` (templates whose schedule is due) |
| every hour | the reminders of what is due (at 08:00 in the time zone of each person), the nightly automations auto-archive and auto-close (at 03:00 in the time zone of the organization), pruning read notifications, uploads nobody took and the webhook log |

Without the scheduler there are no reminders, no scheduled templates, no nightly automations and no clean-up; changes, mails and webhooks still go out through the workers. `docker compose ps` shows whether every service is healthy.

## Outbound connections

Only three things leave the stack:

- **Webhook deliveries** from `queue-webhooks`, to the address and port of each webhook. The test ping and **Send again** run in the request of the person who clicks them, so they go out from `werkbuch`.
- **Mail** over SMTP to `MAIL_HOST` and `MAIL_PORT`: notification mails, invitations and password resets from `queue`, the test mail of the [system page](#system-page) from `werkbuch`.
- **Name lookups** of the receivers and of the mail server, through Docker's DNS.

werkbuch never sends through a proxy: `HTTP_PROXY` and `HTTPS_PROXY` of the environment are ignored for webhooks, since a proxy would look the name up itself and get round the check of the address ([Webhooks](/en/webhooks#private-networks)). An outbound proxy is not supported in this version. Meilisearch runs with `MEILI_NO_ANALYTICS`, and `mariadb`, `meilisearch` and `reverb` sit in the internal network `backend` without any way out.

**IPv6:** a Docker network has no IPv6 unless it is switched on. In that case a receiver is only reached over IPv4, and a name with nothing but IPv6 addresses ends as `unresolvable` in the delivery log. To reach such receivers, give the Docker daemon IPv6 (see Docker's documentation on IPv6) and switch it on for the network `default` in a `docker-compose.override.yml`, then run `docker compose down && docker compose up -d` so the network is created anew:

```yaml
networks:
  default:
    enable_ipv6: true
```

**Firewall:** inbound, only the published port of `werkbuch` (`7740`) has to be open, and only for your reverse proxy. Outbound, the containers need DNS, the port of your mail server and the ports of your webhook receivers (usually 443). Docker routes the traffic of containers past the `INPUT` and `OUTPUT` rules of the host, ufw included; rules for containers belong in the `DOCKER-USER` chain.

## Private webhook targets

By default a webhook cannot reach private networks, loopback or link-local addresses. `WEBHOOKS_ALLOW_PRIVATE` set to `true` in `.env` allows private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), carrier-grade NAT (`100.64.0.0/10`) and the loopback, for a receiver in your own network. Everything else stays blocked: link-local (`169.254.0.0/16`, `fe80::/10`), the metadata addresses of cloud providers (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`), multicast, documentation and reserved networks. The details are under [Webhooks](/en/webhooks#private-networks).

Seen from the containers, the services of the stack are in a private network too: with the switch on, a webhook may point at `http://mariadb:3306`, `http://meilisearch:7700`, `http://reverb:6001` or `http://werkbuch:8080`, and `localhost` is the sending container itself. Meilisearch and Reverb only act on requests signed with their keys, and a webhook sends a `POST` with a JSON body; still, the delivery log shows org admins the first 2 KB of every answer. Turn the switch on only when a receiver in your network needs it.

## Rate limits and proxies

| Variable | Default | Counts |
|---|---|---|
| `API_RATE_LIMIT` | `600` | requests a minute of the REST API per token, without a token per IP address |
| `API_SESSION_RATE_LIMIT` | `3000` | requests a minute of the REST API per signed-in browser session |
| `MCP_RATE_LIMIT` | `300` | requests a minute of the MCP server per token, without a token per IP address |

Set them in `.env` and run `docker compose up -d`. More about the limits under [REST API](/en/api#limits) and [MCP](/en/mcp#limits).

Every limit per IP address, and the limits of the sign-in (20 attempts a minute per address, 5 failed attempts per email and address), need the real address of the client. Behind a proxy werkbuch reads it from `X-Forwarded-For`, but only from a proxy in `TRUSTED_PROXIES`. If your proxy is not in it, every request comes from the proxy's address: all clients share one quota, and a few wrong passwords lock out everyone from that address. Left empty, `TRUSTED_PROXIES` is localhost and the private networks; that covers a proxy in a Docker network, and it also believes the header from the Docker gateway, so anyone who reaches the published port directly can claim any address. [Reverse proxy](/en/reverse-proxy#what-werkbuch-trusts) explains how to narrow it.

## Live updates

The browser keeps a WebSocket open to Reverb (service `reverb`) as long as a tab is open: `wss://<host of APP_URL>/app/…`, forwarded by nginx in `werkbuch`. Reverb runs without `ext-uv` in this version, and its event loop waits on its connections with PHP's `stream_select`, which ends at 1024 connections. One instance therefore carries about 1000 open tabs at once. To refuse connections above a limit of your own, set `REVERB_APP_MAX_CONNECTIONS` in the `environment` of `reverb` (in a `docker-compose.override.yml`):

```yaml
services:
  reverb:
    environment:
      REVERB_APP_MAX_CONNECTIONS: "900"
```

A tab that is turned away shows **Live updates paused**, and its lists update when they load next. An event loop on `ext-uv` would lift the limit; it may come with a later version of the image.

## Logs

Nothing is written to disk: `docker compose logs <service>` shows what each container writes to stdout and stderr.

- **The app** logs to stderr from level `info` (`LOG_LEVEL`). Stack traces carry no argument values (`zend.exception_ignore_args`), so neither a password nor the secret of a webhook ends up in a trace, also not in `failed_jobs`.
- **nginx** in `werkbuch` writes one line per request to stdout: client address, time, method, path, status, size, duration, user agent and `X-Forwarded-For` (the client behind your proxy). The path comes without its query string, which holds the signatures of invitation and upload links; the token of a password reset link and of an MCP upload address is masked (`/reset-password/...`), and a path is cut off at its first `%`. The referer is left out, and so is the health check that Compose sends from inside the container every 15 seconds.

Keep `LOG_LEVEL` at `info`. With `debug` and `MAIL_MAILER=log`, a password reset that someone requests is written to the log as a mail, link included.

What the log can still hold:

- nginx of the base image answers a request for `/index.php/reset-password/<token>` with a redirect and logs that path in full. werkbuch's own links never take this form; such a request comes from someone who has the link already.
- The error log of nginx (also stderr) names the whole request line, query string included, when nginx itself refuses or fails a request: a body over its size limit, PHP-FPM or Reverb not answering. For an upload of an MCP agent that is a signed address which is valid for 15 minutes at most; for an invitation it is the link itself, which stays open until it is accepted or expires after 7 days (invite the same address again to close the old link). Treat the logs as confidential.

`LOG_OUTPUT_LEVEL=debug` of the base image is not supported in werkbuch's image: its debug files belong to root, so that a fault of the app can never rewrite the configuration PHP reads at its next start.

## Configuration in a running container

Change settings in `.env` (or in the standalone file) and run `docker compose up -d`: Compose creates the containers whose settings changed anew, and their start builds the caches again.

Never run `php artisan config:clear` or `php artisan optimize:clear` through `docker compose exec`. The keys `APP_KEY`, `REVERB_APP_KEY` and `REVERB_APP_SECRET` only live in the configuration cache of each container, which the start builds from the data volume. Without the cache the container loses them until it is started again: sign-in, the secrets of webhooks and the live updates stop working. If a container needs a fresh cache, restart it with `docker compose restart <service>`.

## Empty variables

Never set a variable that starts with `PHP_`, `NGINX_`, `SSL_`, `LOG_` or `TRUSTED_PROXY` to an empty value, neither in `.env` nor in an `environment` block: the start script of the base image stops the web service then (a `LOG_LEVEL=` in `.env` is enough). Leave a variable out to keep its default.

## Search

Every start of `werkbuch` sends the settings of the search indexes to Meilisearch (`app:search-sync`) and fills the indexes from the database when one of them is empty or its documents lack fields of this version (`app:search-import --if-empty`). A new instance, an emptied Meilisearch volume and an update that adds fields to the search are therefore handled by the start. If Meilisearch is not reachable, the start stops.

Rebuild the indexes by hand when the search missed changes, for example after Meilisearch was down for hours:

```bash
docker compose exec werkbuch php artisan app:search-import
```

During the import the search is briefly empty. How the search behaves while Meilisearch is down is under [Search](/en/search#operation).

## Mail

`MAIL_MAILER=log` (the default) sends nothing: invitations are handed on as links, **Forgot password** is hidden and notifications stay in the inbox. With `MAIL_MAILER=smtp` and `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` in `.env` werkbuch sends them; `MAIL_SCHEME=smtps` (or port 465) speaks TLS from the first byte, otherwise werkbuch switches to TLS when the server offers it. After `docker compose up -d`, send a test mail from the system page.

## System page

Org admins find the state of the instance under **Settings → System**: the version, the jobs waiting per queue with the oldest one, the jobs planned for later, whether Meilisearch answers with its open and failed tasks, whether a mail server is set up (with the button **Test mail to …**), whether Reverb answers, and the failed jobs with **Retry all**. The check of Reverb runs inside the stack; whether the browser gets through your proxy shows only in the browser (no **Live updates paused** banner).

## Uploads

`ATTACHMENTS_MAX_MB` (default `25`) is the largest upload. PHP and nginx in the image take bodies up to 30 and 32 MB, and the start of `werkbuch` warns when `ATTACHMENTS_MAX_MB` is above what PHP takes. For larger uploads, raise the three limits of the image, `PHP_UPLOAD_MAX_FILE_SIZE`, `PHP_POST_MAX_SIZE` and `NGINX_CLIENT_MAX_BODY_SIZE`, in the `environment` of `werkbuch`, the service that takes the uploads, along with `ATTACHMENTS_MAX_MB` in `.env`, for example for 100 MB:

```yaml
services:
  werkbuch:
    environment:
      PHP_UPLOAD_MAX_FILE_SIZE: "110M"
      PHP_POST_MAX_SIZE: "112M"
      NGINX_CLIENT_MAX_BODY_SIZE: "112M"
```

Raise the body limit of your reverse proxy too (`client_max_body_size` in nginx and Nginx Proxy Manager). JSON bodies stay limited to 8 MiB.
