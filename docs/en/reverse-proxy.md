# Reverse proxy

werkbuch speaks plain HTTP on port `7740` of the host, the live updates included: nginx in the web service passes the WebSocket on to Reverb. Your reverse proxy terminates HTTPS and forwards everything to that one port: `127.0.0.1:7740` from the same host, `<server>:7740` from a container (Nginx Proxy Manager) or another machine, `werkbuch:8080` from the same Docker network. Set `APP_URL` in `.env` to the public `https://` address, e.g. `https://pm.example.com`.

## What werkbuch trusts

- **Forwarded headers** (`X-Forwarded-For`, `-Proto`, `-Host`, `-Port`) only from the addresses in `TRUSTED_PROXIES`: IP addresses or networks in CIDR notation, comma-separated, no host names (a Docker service name like `traefik` matches nothing, and the headers are silently ignored). Default: `127.0.0.1`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`, so a proxy on the same host, in a Docker network or in your LAN is covered. `X-Forwarded-Prefix` is never believed: werkbuch runs at the root of its own host name, not under a path like `/werkbuch`.
- **Host**: only the host of `APP_URL`. Any other `Host` header (also `X-Forwarded-Host` from a trusted proxy) answers `400 Bad Request`. Your proxy must pass the original host; all examples below do.
- **Scheme**: links, redirects and the addresses of scripts and styles take the scheme of the request, behind a proxy from `X-Forwarded-Proto`. Without it they come out as `http://`, and the browser blocks them as mixed content. Cookies don't depend on it: they are marked secure as soon as `APP_URL` starts with `https://`.

The client address counts for the limits per IP: the sign-in lock, “forgot password”, invitations and API requests without a token. Anyone who reaches port `7740` from a trusted address can set the forwarded headers themselves: a new `X-Forwarded-For` for every sign-in attempt, or a fake `X-Forwarded-Proto`. Docker usually keeps the real address of requests from outside, so their headers are ignored. Some setups hand them over with the address of the Docker gateway (`172.x.0.1`) instead, which is in the default list: rootless Docker, Docker Desktop and the userland proxy Docker uses, for example, for requests over IPv6. Then every request to port `7740` counts as coming from a proxy. To close that gap, make the proxy the only way in:

- **Proxy on the same host, not in a container** (Caddy, nginx): set `WERKBUCH_BIND=127.0.0.1` (standalone file: `"127.0.0.1:7740:8080"`). The port isn't reachable from other machines.
- **Proxy in the same Docker network** (Traefik, Caddy in Compose): it talks to `werkbuch:8080` directly; set `WERKBUCH_BIND=127.0.0.1` too, the published port isn't needed.
- **Proxy in another container or on another host**: block port `7740` from the internet in the firewall of your hoster (Docker bypasses ufw and firewalld for published ports), and set `TRUSTED_PROXIES` to the address of the proxy only, e.g. `TRUSTED_PROXIES=192.168.1.10`. Narrowing the list only helps when werkbuch sees that address; with the gateway in between it doesn't.

If your proxy reaches werkbuch from an address outside `TRUSTED_PROXIES`, werkbuch ignores its headers: links come out as `http://`, and every person shares the proxy's address, so the sign-in lock after failed attempts hits everyone at once.

## WebSockets

The live updates use one WebSocket per tab. The browser opens it at the address of `APP_URL`: `wss://pm.example.com/app/<key>` (port 443 unless `APP_URL` names another). Only `/app/` leads to Reverb; Reverb's HTTP API under `/apps/` does not exist from outside, werkbuch talks to Reverb inside the stack. The proxy has to:

- pass the headers `Upgrade` and `Connection` on, so the connection can switch to the WebSocket protocol,
- keep a quiet connection open for minutes, not seconds (nginx in the image allows 300 seconds),
- pass `Origin` unchanged: Reverb only accepts the host of `APP_URL`.

Caddy and Traefik do all of it on their own. nginx needs the lines of its example below, Nginx Proxy Manager the switch “Websockets Support”. When it doesn't work, the browser shows the banner “Live updates paused”, and lists and the inbox only update when they load again.

## HSTS

The container sends no `Strict-Transport-Security` header: HSTS is for the one who terminates HTTPS to decide. Set it at the proxy; each example below has the line. Caddy does not set it on its own either. Use `includeSubDomains` only if really every subdomain of that domain speaks https: under an apex domain like `example.com`, the browser would otherwise refuse every `http://` subdomain for as long as `max-age` says.

## Caddy

```txt
pm.example.com {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy localhost:7740
}
```

If Caddy runs in the same Compose project, use `reverse_proxy werkbuch:8080`. Caddy gets the certificate on its own, passes WebSockets through and doesn't limit the body size.

## Traefik

Traefik and werkbuch need a shared Docker network (here the external network `proxy` of your Traefik). Put this into `docker-compose.override.yml` next to `docker-compose.yml`, and set `WERKBUCH_BIND=127.0.0.1` in `.env`:

```yaml
services:
  werkbuch:
    networks:
      - default
      - backend
      - proxy
    labels:
      - traefik.enable=true
      # werkbuch is in three networks: tell Traefik which one it shares with werkbuch
      - traefik.docker.network=proxy
      - traefik.http.routers.werkbuch.rule=Host(`pm.example.com`)
      - traefik.http.routers.werkbuch.entrypoints=websecure
      - traefik.http.routers.werkbuch.tls.certresolver=letsencrypt
      - traefik.http.routers.werkbuch.middlewares=werkbuch-hsts
      - traefik.http.middlewares.werkbuch-hsts.headers.stsSeconds=31536000
      - traefik.http.services.werkbuch.loadbalancer.server.port=8080

networks:
  proxy:
    external: true
```

Without `traefik.docker.network` Traefik may pick werkbuch's address in the internal `backend` network, which it can't reach (502/504). Entrypoint and cert resolver names depend on your Traefik setup. Traefik passes WebSockets (`Upgrade`) through on its own. Its address in the `proxy` network is private, so the default `TRUSTED_PROXIES` covers it.

## nginx

```nginx
# in the http context, e.g. /etc/nginx/conf.d/werkbuch.conf
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name pm.example.com;
    # uploads carry up to 32 MB (ATTACHMENTS_MAX_MB, 25 by default)
    client_max_body_size 32m;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:7740;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # the WebSocket of the live updates under /app/
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
        # replaces what the client sent with its real address
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}
```

## Nginx Proxy Manager

1. Add a proxy host for `pm.example.com`.
2. Scheme `http`, forward to the address of the server (its public or private IP, not `127.0.0.1`: that is the Nginx Proxy Manager container itself), port `7740`. If both share a Docker network (as in the Traefik example), `werkbuch`, port `8080` works too.
3. Turn on **Websockets Support**. Without it the live updates stay paused.
4. SSL tab: request a certificate, turn on *Force SSL* and *HSTS Enabled* (*HSTS Subdomains* only under the condition in [HSTS](#hsts)).
5. If uploads end in `413`, add `client_max_body_size 32m;` in the Advanced tab.

## MCP

AI agents reach the [MCP server](/en/mcp) under `APP_URL/mcp` with `POST` requests. Pass them unchanged, with `Authorization` and the headers `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`. MCP clients send `Accept: application/json, text/event-stream`: don't remove `text/event-stream` from it. Today werkbuch answers every request as plain JSON; the protocol also allows a streamed answer (`text/event-stream`), which werkbuch would mark with `X-Accel-Buffering: no`, so don't buffer answers of `/mcp` and leave that header alone. The examples above need nothing extra for it.

## Checklist

- `APP_URL` starts with `https://` and has exactly the host the browser uses.
- Optional hardening: port `7740` is not reachable from the internet (`WERKBUCH_BIND=127.0.0.1` or a firewall), and `TRUSTED_PROXIES` is narrowed to the proxy.
- The page source of the sign-in shows addresses of scripts and styles starting with `https://`. If they start with `http://`, the proxy's address is not in `TRUSTED_PROXIES`, or it sends no `X-Forwarded-Proto`.
- **Settings → System** (org admins) shows Live updates as “Running”. That page asks Reverb inside the stack; it says nothing about the proxy.
- After signing in, the banner “Live updates paused” does not appear, and the developer tools of the browser show the WebSocket `wss://pm.example.com/app/…` with status `101`. If the banner stays, the proxy doesn't pass the WebSocket on: in Nginx Proxy Manager the switch “Websockets Support” is off, in nginx `Upgrade` or `Connection` is missing.
- An upload of 25 MB arrives (`ATTACHMENTS_MAX_MB`): allow at least `client_max_body_size 32m` (nginx); Caddy and Traefik don't limit the body size by default.
- `curl -sI https://pm.example.com/up` shows `Strict-Transport-Security` if you set it at the proxy.
