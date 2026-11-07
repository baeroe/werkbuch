# Reverse Proxy

werkbuch spricht einfaches HTTP auf Port `7740` des Hosts, die Live-Updates eingeschlossen: nginx im Web-Dienst reicht den WebSocket an Reverb weiter. Der Reverse Proxy beendet HTTPS und leitet alles an diesen einen Port: `127.0.0.1:7740` vom selben Host, `<server>:7740` aus einem Container (Nginx Proxy Manager) oder von einem anderen Rechner, `werkbuch:8080` aus demselben Docker-Netz. `APP_URL` in der `.env` auf die öffentliche `https://`-Adresse setzen, etwa `https://pm.example.com`.

## Was werkbuch glaubt

- **Weitergereichte Header** (`X-Forwarded-For`, `-Proto`, `-Host`, `-Port`) nur von den Adressen in `TRUSTED_PROXIES`: IP-Adressen oder Netze in CIDR-Schreibweise, durch Kommas getrennt, keine Hostnamen (ein Docker-Dienstname wie `traefik` trifft nichts, und die Header werden still übergangen). Standard: `127.0.0.1`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`; damit ist ein Proxy auf demselben Host, in einem Docker-Netz oder im LAN abgedeckt. `X-Forwarded-Prefix` glaubt werkbuch nie: Es läuft an der Wurzel seines eigenen Hostnamens, nicht unter einem Pfad wie `/werkbuch`.
- **Host**: nur der Host aus `APP_URL`. Jeder andere `Host`-Header (auch `X-Forwarded-Host` von einem vertrauten Proxy) bekommt `400 Bad Request`. Der Proxy muss den ursprünglichen Host weiterreichen; alle Beispiele unten tun das.
- **Schema**: Links, Weiterleitungen und die Adressen von Skripten und Styles nehmen das Schema der Anfrage, hinter einem Proxy aus `X-Forwarded-Proto`. Fehlt es, stehen sie als `http://` da, und der Browser blockiert sie als gemischte Inhalte. Cookies hängen nicht daran: Sie sind sicher markiert, sobald `APP_URL` mit `https://` beginnt.

Die Adresse des Clients zählt für die Grenzen je IP: die Sperre nach Fehlversuchen bei der Anmeldung, „Passwort vergessen“, Einladungen und API-Anfragen ohne Token. Wer Port `7740` von einer vertrauten Adresse aus erreicht, kann die weitergereichten Header selbst setzen: ein neues `X-Forwarded-For` für jeden Anmeldeversuch oder ein falsches `X-Forwarded-Proto`. Docker behält meist die echte Adresse von Anfragen von außen, deren Header werden dann übergangen. Manche Aufbauten reichen sie aber mit der Adresse des Docker-Gateways (`172.x.0.1`) weiter, und die steht in der Standardliste: rootless Docker, Docker Desktop und der Userland-Proxy, den Docker etwa für Anfragen über IPv6 nimmt. Dann gilt jede Anfrage an Port `7740` als eine vom Proxy. Um diese Lücke zu schließen, den Proxy zum einzigen Weg hinein machen:

- **Proxy auf demselben Host, nicht im Container** (Caddy, nginx): `WERKBUCH_BIND=127.0.0.1` setzen (Standalone-Datei: `"127.0.0.1:7740:8080"`). Von anderen Rechnern ist der Port dann nicht erreichbar.
- **Proxy im selben Docker-Netz** (Traefik, Caddy in Compose): Er spricht `werkbuch:8080` direkt an; auch hier `WERKBUCH_BIND=127.0.0.1` setzen, der veröffentlichte Port wird nicht gebraucht.
- **Proxy in einem anderen Container oder auf einem anderen Host**: Port `7740` in der Firewall des Hosters fürs Internet sperren (Docker umgeht ufw und firewalld bei veröffentlichten Ports) und `TRUSTED_PROXIES` auf die Adresse des Proxys allein setzen, etwa `TRUSTED_PROXIES=192.168.1.10`. Das Eingrenzen hilft nur, wenn werkbuch diese Adresse sieht; mit dem Gateway dazwischen sieht es sie nicht.

Erreicht der Proxy werkbuch von einer Adresse außerhalb von `TRUSTED_PROXIES`, übergeht werkbuch seine Header: Links stehen als `http://` da, und alle Personen teilen sich die Adresse des Proxys, die Sperre nach Fehlversuchen trifft also alle auf einmal.

## WebSockets

Die Live-Updates nutzen einen WebSocket je Tab. Der Browser öffnet ihn unter der Adresse aus `APP_URL`: `wss://pm.example.com/app/<key>` (Port 443, außer `APP_URL` nennt einen anderen). Nur `/app/` führt zu Reverb; die HTTP-API von Reverb unter `/apps/` gibt es von außen nicht, werkbuch spricht Reverb innerhalb des Stacks an. Der Proxy muss:

- die Header `Upgrade` und `Connection` weiterreichen, damit die Verbindung auf das WebSocket-Protokoll wechseln kann,
- eine ruhige Verbindung Minuten lang offen halten, nicht nur Sekunden (nginx im Image lässt 300 Sekunden zu),
- `Origin` unverändert weiterreichen: Reverb nimmt nur den Host aus `APP_URL`.

Caddy und Traefik tun das alles von selbst. nginx braucht die Zeilen aus seinem Beispiel unten, Nginx Proxy Manager den Schalter „Websockets Support“. Klappt es nicht, zeigt der Browser das Banner „Live-Updates pausiert“, und Listen und Inbox aktualisieren sich erst beim nächsten Laden.

## HSTS

Der Container schickt keinen Header `Strict-Transport-Security`: Über HSTS entscheidet, wer HTTPS beendet. Am Proxy setzen; jedes Beispiel unten hat die Zeile. Auch Caddy setzt ihn nicht von selbst. `includeSubDomains` nur nehmen, wenn wirklich jede Subdomain dieser Domain https spricht: Unter einer Apex-Domain wie `example.com` verweigert der Browser sonst jede `http://`-Subdomain, so lange `max-age` sagt.

## Caddy

```txt
pm.example.com {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy localhost:7740
}
```

Läuft Caddy im selben Compose-Projekt, `reverse_proxy werkbuch:8080` nehmen. Caddy holt das Zertifikat selbst, reicht WebSockets durch und begrenzt die Größe des Bodys nicht.

## Traefik

Traefik und werkbuch brauchen ein gemeinsames Docker-Netz (hier das externe Netz `proxy` des Traefik). Das hier in eine `docker-compose.override.yml` neben der `docker-compose.yml` schreiben und `WERKBUCH_BIND=127.0.0.1` in der `.env` setzen:

```yaml
services:
  werkbuch:
    networks:
      - default
      - backend
      - proxy
    labels:
      - traefik.enable=true
      # werkbuch hängt in drei Netzen: Traefik sagen, welches es mit werkbuch teilt
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

Ohne `traefik.docker.network` nimmt Traefik womöglich die Adresse von werkbuch im internen Netz `backend`, die es nicht erreicht (502/504). Die Namen von Entrypoint und Cert-Resolver hängen vom eigenen Traefik ab. Traefik reicht WebSockets (`Upgrade`) von selbst durch. Seine Adresse im Netz `proxy` ist privat, der Standard von `TRUSTED_PROXIES` deckt sie also ab.

## nginx

```nginx
# im http-Kontext, etwa /etc/nginx/conf.d/werkbuch.conf
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name pm.example.com;
    # Uploads bringen bis zu 32 MB (ATTACHMENTS_MAX_MB, Standard 25)
    client_max_body_size 32m;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:7740;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # der WebSocket der Live-Updates unter /app/
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
        # ersetzt, was der Client geschickt hat, durch seine echte Adresse
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}
```

## Nginx Proxy Manager

1. Einen Proxy Host für `pm.example.com` anlegen.
2. Schema `http`, weiterleiten an die Adresse des Servers (seine öffentliche oder private IP, nicht `127.0.0.1`: das ist der Container von Nginx Proxy Manager selbst), Port `7740`. Teilen sich beide ein Docker-Netz (wie im Traefik-Beispiel), geht auch `werkbuch`, Port `8080`.
3. **Websockets Support** einschalten. Ohne den Schalter bleiben die Live-Updates pausiert.
4. Reiter SSL: ein Zertifikat anfordern, *Force SSL* und *HSTS Enabled* einschalten (*HSTS Subdomains* nur unter der Bedingung aus [HSTS](#hsts)).
5. Enden Uploads mit `413`, im Reiter Advanced `client_max_body_size 32m;` eintragen.

## MCP

KI-Agenten erreichen den [MCP-Server](/de/mcp) unter `APP_URL/mcp` mit `POST`-Anfragen. Diese unverändert weiterreichen, mit `Authorization` und den Headern `MCP-Protocol-Version`, `Mcp-Method` und `Mcp-Name`. MCP-Clients schicken `Accept: application/json, text/event-stream`: `text/event-stream` darin nicht entfernen. Heute beantwortet werkbuch jede Anfrage mit einfachem JSON; das Protokoll erlaubt auch eine gestreamte Antwort (`text/event-stream`), die werkbuch mit `X-Accel-Buffering: no` kennzeichnen würde. Antworten von `/mcp` darum nicht puffern und diesen Header in Ruhe lassen. Die Beispiele oben brauchen dafür nichts Zusätzliches.

## Checkliste

- `APP_URL` beginnt mit `https://` und hat genau den Host, den der Browser nutzt.
- Optionale Härtung: Port `7740` ist aus dem Internet nicht erreichbar (`WERKBUCH_BIND=127.0.0.1` oder eine Firewall), und `TRUSTED_PROXIES` ist auf den Proxy eingegrenzt.
- Der Quelltext der Anmeldung zeigt Adressen von Skripten und Styles, die mit `https://` beginnen. Beginnen sie mit `http://`, steht die Adresse des Proxys nicht in `TRUSTED_PROXIES`, oder er schickt kein `X-Forwarded-Proto`.
- **Einstellungen → System** (Org-Admins) zeigt die Live-Updates als „Läuft“. Diese Seite fragt Reverb innerhalb des Stacks; über den Proxy sagt sie nichts.
- Nach der Anmeldung erscheint das Banner „Live-Updates pausiert“ nicht, und die Entwicklerwerkzeuge des Browsers zeigen den WebSocket `wss://pm.example.com/app/…` mit Status `101`. Bleibt das Banner, reicht der Proxy den WebSocket nicht weiter: In Nginx Proxy Manager ist der Schalter „Websockets Support“ aus, in nginx fehlt `Upgrade` oder `Connection`.
- Ein Upload von 25 MB kommt an (`ATTACHMENTS_MAX_MB`): mindestens `client_max_body_size 32m` zulassen (nginx); Caddy und Traefik begrenzen die Größe des Bodys von sich aus nicht.
- `curl -sI https://pm.example.com/up` zeigt `Strict-Transport-Security`, wenn er am Proxy gesetzt ist.
