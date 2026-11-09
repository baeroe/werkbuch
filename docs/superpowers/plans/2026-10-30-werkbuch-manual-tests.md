# werkbuch: Checkliste für die manuellen Tests

Stand: 2026-11-08 (Phase 15, Task 26). Schritt 5 des Ablaufs der Spec (Abschnitt 11, „Manuelle Tests: Eine Checkliste aus den Erfolgskriterien und Kapitel 4“). Danach kommt das Release v0.1.0, nur nach Rafaels Freigabe.

Jeder Schritt nennt die Stelle in Spec (`docs/superpowers/specs/2026-10-28-werkbuch-design.md`, „Spec 4.8“), Rulings (`docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, „A452“) oder Doku (`docs/de/…`, „`concepts/wiki.md`“), aus der das erwartete Ergebnis stammt. Was Pest oder Playwright schon genau prüft, steht hier nur als Plausibilität, mit dem Test daneben.

## So wird getestet

### Zwei Umgebungen

**DDEV mit den Demo-Daten** (Alltag, Rechte, Live, Mail, MCP; `docs/de/development.md`, „Erster Start“):

```bash
ddev start
ddev artisan migrate:fresh --seed --seeder=DemoSeeder   # baut am Ende auch den Suchindex
ddev exec pnpm build                                     # oder: ddev exec pnpm dev (dann https://werkbuch.ddev.site:5173 läuft mit)
```

- App: https://werkbuch.ddev.site, Mails: `ddev mailpit`, Meilisearch-Dashboard: Port 7701 (Schlüssel `MEILISEARCH_KEY` aus `.env`).
- **Während der manuellen Tests kein `pnpm --dir e2e test`:** der `E2eSeeder` setzt die Dev-Datenbank zurück, stellt die Organisation auf Englisch, schaltet alle Automatisierungen, Demo-Vorlagen und Demo-Webhooks aus (CLAUDE.md, „Seeder“). Danach wieder `migrate:fresh --seed --seeder=DemoSeeder`.
- Der DDEV-Scheduler läuft wirklich (CLAUDE.md, „Fallstricke“): in WEB archiviert er nachts, in APP storniert er alte Backlog-Items, montags legt „Wöchentliche Wartung“ ein Item an. Das gehört zu den Demo-Daten, ist kein Befund.

**Compose-Stack auf Colima** (Erfolgskriterium 1, Betrieb, Proxy, Backup; `docs/de/setup.md`): Das Image gibt es vor dem Release nicht auf Docker Hub, darum aus dem Repo bauen (`setup.md`, Kasten „Vor dem ersten Release“):

```bash
cd ~/development/baeroe/werkbuch && docker buildx build --load -t werkbuch:local .
mkdir -p ~/werkbuch-manual && cd ~/werkbuch-manual
cp ~/development/baeroe/werkbuch/docker-compose.yml .
cp ~/development/baeroe/werkbuch/.env.docker.example .env
# .env: APP_URL=http://localhost:7740, WERKBUCH_IMAGE=werkbuch:local, WERKBUCH_BIND=127.0.0.1, APP_LOCALE=de,
#       ADMIN_EMAIL=admin@example.com, ADMIN_PASSWORD, DB_PASSWORD, DB_ROOT_PASSWORD, MEILISEARCH_KEY (openssl rand -hex 24)
docker compose -p werkbuch-manual up -d --wait
```

- Eigener Projektname `werkbuch-manual` (der Smoke nutzt `werkbuch-smoke`), Port 7740 muss frei sein. Nicht parallel zu e2e oder zum Smoke laufen lassen (CLAUDE.md, „Fallstricke“: Last der Colima-VM). Vorher `colima ssh -- free -m` ansehen.
- Abräumen nur gezielt: `docker compose -p werkbuch-manual down -v` (nie `prune`).
- Mail auf dem Stack (optional, Vorschlag): eine `docker-compose.override.yml` mit einem Dienst `mailpit: { image: axllent/mailpit, ports: ["127.0.0.1:8027:8025"] }` und in der `.env` `MAIL_MAILER=smtp`, `MAIL_HOST=mailpit`, `MAIL_PORT=1025` (`setup.md`, Tabelle „.env“; die Override-Datei liest Compose von selbst, „Voraussetzungen“). Ohne das bleibt `MAIL_MAILER=log`, was Schritt **4.2.7** braucht.

### Zugänge

| Konto | Passwort | Rolle (Demo, `database/seeders/Demo/ProjectsSeeder.php`) |
|---|---|---|
| `admin@example.com` (nur Stack: `ADMIN_EMAIL`; auf DDEV legt `migrate:fresh --seed` kein Admin-Konto an, dort ist Mara die Org-Admin) | `ADMIN_PASSWORD` | Org-Admin, kein Projektmitglied |
| `mara@feldwerk.example.com` | `werkbuch-demo` (`DemoSeeder::PASSWORD`) | Org-Admin; Admin in WEB, Member in APP und OPS |
| `jonas@feldwerk.example.com` | `werkbuch-demo` | Member; Admin und Lead in OPS, Member in WEB und APP |
| `ida@feldwerk.example.com` | `werkbuch-demo` | Member; Admin und Lead in WEB, **Außenstehende** im öffentlichen APP, sieht das private OPS **nicht** |
| `theo@feldwerk.example.com` | `werkbuch-demo` | Member; Admin und Lead in APP, **Viewer** in WEB, sieht OPS nicht |
| `lene@feldwerk.example.com` | `werkbuch-demo` | Member in WEB und APP, sieht OPS nicht |
| `sven@feldwerk.example.com` | `werkbuch-demo` | **deaktiviert** |
| Kira (Bot), „Automation“ (Standard-Bot) | nur Tokens | Kira Member in WEB und OPS; der Standard-Bot Org-Admin |

Englische Demo (`DemoSeederEn`): dieselben Handles unter `@fieldwork.example.com`, Organisation „Fieldwork“, gleiches Passwort (`development.md`, „Erster Start“). Eine Datenbank hält nur eine Sprache.

Zwei Personen gleichzeitig: zwei Browser oder ein normales und ein privates Fenster. Für Live-Tests beide Fenster nebeneinander.

### Befunde melden

- Je Befund ein GitHub-Issue in `baeroe/werkbuch` mit der Nummer des Schritts (etwa „**4.8.6**: …“), Umgebung (DDEV oder Stack), Konto, Breite, Theme, Schritten und Erwartung; oder als Liste unter „Befunde“ am Ende dieser Datei.
- Korrekturen kommen als PRs gegen `main`, je Befund ein Branch (`fix/…`), wie in Spec 11 („Korrekturen kommen als PRs“).
- Ein Häkchen `[x]` heißt: geprüft und wie erwartet. Ein Abweichen bleibt `[ ]` mit Verweis auf das Issue.

---

## Erfolgskriterien (Spec 1)

### 1. Start mit Docker Compose

- [ ] **1.1** Den Stack wie oben starten → erwartet: `docker compose -p werkbuch-manual ps` zeigt acht Dienste `healthy` (`werkbuch`, `reverb`, `queue`, `queue-index`, `queue-webhooks`, `scheduler`, `mariadb`, `meilisearch`), nur `werkbuch` veröffentlicht einen Port (7740) (Spec 1 Kriterium 1, 8.1; `setup.md`, „Dienste“).
- [ ] **1.2** `docker compose -p werkbuch-manual logs werkbuch` → erwartet: die Schritte aus `setup.md`, „Start“, und am Ende `werkbuch: ready`; die Worker schreiben `werkbuch: ready: php artisan …`.
- [ ] **1.3** http://localhost:7740 öffnen, mit `ADMIN_EMAIL`/`ADMIN_PASSWORD` anmelden → erwartet: angemeldet; **Einstellungen → Bots** zeigt den Standard-Bot „Automation“ (Spec 4.2 „Standard-Bot“).
- [ ] **1.4** Ein `DB_PASSWORD=change-me` in einer zweiten Probe (eigener Projektname, gleich wieder abräumen) → erwartet: werkbuch startet nicht und sagt es (`setup.md`, „Start“, Schritt 1; A423).
- [ ] **1.5** In einer zweiten Probe ohne `ADMIN_PASSWORD` auf leeren Volumes (eigener Projektname, danach `down -v`) → erwartet: Log `werkbuch: no account yet, set ADMIN_EMAIL and ADMIN_PASSWORD …`, der Dienst läuft weiter (`setup.md`, „Start“; A432).

### 2. Durchgängiger Ablauf in UI, REST und MCP

Auf DDEV mit den Demo-Daten (Spec 1 Kriterium 2). Für REST ein Token mit `read` und `write` von Mara (**Persönliche Einstellungen → API & MCP → Neues Token**), in der Shell `export TOKEN='…'`; die `curl`-Beispiele der Doku mit `https://werkbuch.ddev.site` statt `https://werkbuch.example.com`.

**UI (als Mara, nur Tastatur wo möglich)**

- [ ] **2.1** **Einstellungen → Workflows → Neuer Workflow**: Status anlegen, „Freie Übergänge“ aus, in der Matrix nur einige Paare erlauben; einen Status unerreichbar lassen → erwartet: „Nicht erreichbar“ an der Zeile, Speichern geht erst ohne Befund. Dann in einem neuen Projekt unter **Projekteinstellungen → Workflow** zuordnen (Spec 4.5; `concepts/workflows.md`, „Frei oder Matrix“, „Der Workflow eines Projekts“).
- [ ] **2.2** **Einstellungen → Properties**: eine Property anlegen; **Typen**: einen Typ anlegen, die Property als Pflicht zuordnen, im Projekt aktivieren; mit `c` ein Item dieses Typs ohne den Pflichtwert anlegen → erwartet: Fehler am Feld, mit Wert angelegt (Spec 4.6, 4.7; `concepts/types-and-properties.md`, „Pflichtwerte und Standardwerte“).
- [ ] **2.3** Am Item mit `s` einen Status wählen, den die Matrix nicht erlaubt → erwartet: er wird gar nicht angeboten; im Board ist die Spalte beim Ziehen gedimmt; ein erlaubter Zug klappt (Spec 4.5 „Übergänge“).
- [ ] **2.4** Als Mara mit `m` kommentieren und `@lene` erwähnen; Lene ist im zweiten Browser auf `/inbox` → erwartet: Karte und Badge erscheinen ohne Neuladen; nach 5 Minuten (oder `ddev artisan app:send-notification-mails --now`) liegt die Mail an Lene in Mailpit, mit Link auf das Item (Spec 4.14 „Mail“; `concepts/notifications.md`, „Inbox“, „Mail“).
- [ ] **2.5** **Einstellungen → Webhooks → Webhook anlegen** mit dem Empfänger aus **6.3.1** (Ereignisse `work_item.*`, `comment.*`), Geheimnis kopieren; Status eines Items ändern → erwartet: der Empfänger meldet `signiert ok`; das Protokoll unter „Zustellungen“ zeigt 200 (Spec 6.3; `webhooks.md`, „Signatur prüfen“, „Zustellprotokoll“).
- [ ] **2.6** ⌘K, ein Wort aus dem Titel des neuen Items tippen → erwartet: das Item steht unter „Items“; den Key tippen → „:key öffnen“ springt hin (Spec 4.17; `search.md`, „Befehlspalette“).

**REST (`curl` mit `$TOKEN`)**

- [ ] **2.7** Workflow mit Matrix anlegen und einem Projekt zuordnen: Beispiele aus `concepts/workflows.md`, „Workflow anlegen“ und „Workflow eines Projekts wechseln“ → erwartet: 201 bzw. 200; ohne Zuordnung eines benutzten Status 422 mit `states`.
- [ ] **2.8** Property und Typ mit Pflicht-Property anlegen (`concepts/types-and-properties.md`, „REST“), dann ein Item ohne den Wert (`concepts/work-items.md`, „Ein Item anlegen“) → erwartet: 422 mit Fehler an `values.<key>`; mit Wert 201.
- [ ] **2.9** Unerlaubten Übergang schicken (`concepts/work-items.md`, „Ein Item verschieben“) → erwartet: 409 `transition_not_allowed` als `application/problem+json` mit Satz in Maras Sprache; ein erlaubter 200 (Spec 4.5; `api.md`, „Fehler“; A151).
- [ ] **2.10** Kommentar mit `@lene` in Markdown (`api.md`, „Kommentieren“) → erwartet: Lenes Inbox wie **2.4**; `GET /api/v1/notifications?filter[event]=mentioned` mit einem Token von Lene nennt sie (`concepts/notifications.md`, „REST“).
- [ ] **2.11** Webhook per REST anlegen (`webhooks.md`, „REST“) → erwartet: 201 `{data, secret}`, das Geheimnis nur dort; eine Zustellung kommt signiert an.
- [ ] **2.12** `curl -g "https://werkbuch.ddev.site/api/v1/search?q=<KEY>" -H "Authorization: Bearer $TOKEN"` → erwartet: `key_match` ist die ULID des Items (`search.md`, „REST“).

**MCP (Claude Code, eingerichtet nach `mcp.md`, „Einrichten“, ohne skilltri)**

Token mit `mcp`, `read`, `write`. In einem leeren Testordner nur für diesen Ordner anmelden, nicht im user scope (dort steht nur `skilltri mcp`): `claude mcp add --transport http --scope local werkbuch https://werkbuch.ddev.site/mcp --header "Authorization: Bearer <token>"`, nach den Tests `claude mcp remove werkbuch -s local`. Lehnt der Client das DDEV-Zertifikat ab: `NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" claude` (Vorschlag) oder auf den Stack ausweichen (`http://localhost:7740/mcp`).

- [ ] **2.13** `/mcp` in Claude Code → erwartet: Server `werkbuch` verbunden, 29 Tools; das Modell ruft zuerst `whoami` (`mcp.md`, „Was der Server bietet“).
- [ ] **2.14** Auftrag: „Lege einen Workflow mit Matrix an und ordne ihn Projekt X zu“ → erwartet: `manage-organization` `create-workflow`, dann `manage-projects` `set-workflow`; ohne Zuordnung eines benutzten Status meldet das Tool 422 mit `states` (`mcp.md`, Tabelle `manage-projects`).
- [ ] **2.15** „Lege eine Property und einen Typ mit Pflicht-Property an, dann ein Item ohne den Wert“ → erwartet: `create-property`, `create-type`, `manage-work-items` `create` scheitert mit `values.<key>` (`mcp.md`, „Fehler“).
- [ ] **2.16** „Verschiebe das Item in einen nicht erlaubten Status“ → erwartet: `409 transition_not_allowed: …` als Fehlertext; ein erlaubter geht (`mcp.md`, `manage-work-items` `transition`).
- [ ] **2.17** „Kommentiere und erwähne @lene“ → erwartet: `manage-comments` `add`; Lene wie **2.4**; `GET /api/v1/work-items/<key>/history` nennt `via: mcp` (`mcp.md`, „Agent-Szenario“; `concepts/work-items.md`, „Die History lesen“).
- [ ] **2.18** „Lege einen Webhook für `comment.*` an“, dann kommentieren → erwartet: `manage-webhooks` `create` antwortet `secret`; der Empfänger meldet `signiert ok`. „Suche nach <Key>“ → `search` mit `key_match` (`mcp.md`, Tabellen `manage-webhooks`, `search`).

### 3. Vorlage mit Zeitplan

- [ ] **3.1** Als Mara in WEB eine Vorlage mit Titel „Wartung KW {week}“ und Zeitplan „täglich“ zu einer Uhrzeit drei Minuten in der Zukunft speichern → erwartet: „Nächste Termine“ zeigt den Termin; zur Uhrzeit (spätestens eine Minute danach, Scheduler jede Minute) entsteht genau ein Item, Ersteller „Automation“, im Verlauf „Aus Vorlage „…““ (Spec 4.12 „Ausführung“; `concepts/templates.md`, „Ausführung“).
- [ ] **3.2** Auf dem Stack: `docker compose -p werkbuch-manual stop scheduler`, eine Vorlage mit einem Termin wenige Minuten voraus speichern, den Termin verstreichen lassen, dann `docker compose -p werkbuch-manual start scheduler` → erwartet: genau ein Item für den verpassten Termin, auch nach weiteren Minuten kein zweites (Spec 1 Kriterium 3; Plausibilität, genau prüft `tests/Feature/Api/TemplatesAcceptanceTest.php` drei Wochen Ausfall).
- [ ] **3.3** Im Protokoll der Vorlage (**Läufe**) → erwartet: je Lauf eine Zeile mit „geplant“ und dem Item als Link (`concepts/templates.md`, „Fehler und Protokoll“).

### 4. Views

- [ ] **4.0.1** Die Demo-View „Studio Nordlicht“ (Filter auf die Property „Kunde“) als Liste, Board (`2`) und Tabelle (`3`) öffnen → erwartet: dieselben Keys in allen drei Layouts (Spec 1 Kriterium 4; `concepts/views.md`, „Layouts“).
- [ ] **4.0.2** `curl -g "https://werkbuch.ddev.site/api/v1/work-items?view=<id>&per_page=100" -H "Authorization: Bearer $TOKEN"` und über MCP „Zeige die Items der View Studio Nordlicht“ (`views` `items`) → erwartet: dieselben Keys wie **4.0.1** (`concepts/views.md`, „Eine View lesen“; `mcp.md`, `views`).
- [ ] **4.0.3** Als Ida dieselbe View → erwartet: nur Items aus WEB und APP, nie aus OPS (Spec 4.11 „Was eine View ist“).
- [ ] **4.0.4** Die View „Roadmap“ als Timeline (`4`) → erwartet: nur Epics, gruppiert nach Projekt, Balken mit Fortschritt der Kinder (Spec 4.11 „Timeline“).

### 5. Bilder aus der Zwischenablage

- [ ] **5.1** Einen Screenshot (⇧⌘⌃4) als Mara in die Beschreibung von OPS-12 einfügen (⌘V) → erwartet: Platzhalter mit Fortschritt, dann das Bild; nach dem Neuladen noch da (Spec 4.16; `concepts/rich-text.md`, „Bilder und Dateien“).
- [ ] **5.2** Dasselbe in einen Kommentar (`m`) und in eine Wiki-Seite von OPS → erwartet: wie **5.1**.
- [ ] **5.3** Die Adresse des Bilds kopieren (Rechtsklick → Bildadresse, `/attachments/<id>` und `/attachments/<id>/preview`) und als Ida öffnen → erwartet: 404, bei Datei und Vorschau; als Mara lädt es (Spec 1 Kriterium 5, 4.16 „Auslieferung“; A235).
- [ ] **5.4** Ein Bild in WEB einfügen und als Theo (Viewer) und Ida öffnen → erwartet: beide sehen es.

### 6. Tastatur

- [ ] **6.1** `?` auf Liste, Item-Seite und Board → erwartet: das Hilfe-Overlay nennt die Kürzel aus Spec 5.3; `docs/de/keyboard.md` nennt dieselben.
- [ ] **6.2** Stichprobe aus `scripts/keyboard-flows.test.mjs` (`FLOWS`) nur mit der Tastatur, mindestens: ein Item anlegen (`c`, ⌘⏎), Status/Assignee/Priorität (`s`, `a`, `p`), mehrere bearbeiten (`x`, ⇧X, `p`), archivieren mit Rückgängig (⌘⌫, ⌘Z), Karte im Board verschieben (⇧←/⇧→, ⌥↑/⌥↓), Zelle der Tabelle bearbeiten (Pfeile, Enter, Esc), Epic auf der Timeline verschieben (⇧→), Inbox (`j`, `e`, `u`, `#`), Wiki-Seite verschieben (Menü, „Verschieben nach …“), Webhook anlegen → erwartet: jeder Ablauf geht ohne Maus, der Fokus bleibt sichtbar und landet nach jedem Schritt an einer sinnvollen Stelle (Spec 1 Kriterium 6, 5.1; A442).
- [ ] **6.3** Was `e2e/keyboard-flows.ts` unter `GAPS` als ungeprüft nennt, besonders von Hand: `i`, `l`, `t`, `d`, ⇧D, ⇧P, ⌘A in einer Liste, ←/→ im Board, ⌥←/⌥→ in der Timeline, `/`-Menü und Bild-Alt-Text im Editor, ein Kommentar bearbeiten/löschen/reagieren per Tastatur, „Alle erneut versuchen“ auf der System-Seite → erwartet: geht wie in `keyboard.md` beschrieben.

### 7. CI

- [ ] **7.1** Im PR der Phase 15 → erwartet: `tests` grün (PHP 100 % Zeilen, Larastan, Pint, Typecheck, Vitest), die vier `e2e (…)`, `e2e-build`, `e2e-coverage` (100 % Zeilen Frontend), `docs`, `clickdummy`, `image (amd64)`, `image (arm64)`, `load` grün (Spec 1 Kriterium 7, 9; CLAUDE.md, „Regeln“ zum CI).

### 8. Doku

- [ ] **8.1** `ddev exec pnpm --dir docs dev` (Port 5174) oder nach dem Deploy https://werkbuch.dev → erwartet: Englisch und Deutsch mit Setup, Reverse Proxy, Betrieb, Upgrading, Backup, Konzepten, Tastatur, API, MCP, Webhooks, Bots, Suche; gleiche Seiten in beiden Sprachen (Spec 1 Kriterium 8, 10).
- [ ] **8.2** Screenshots → erwartet: deutsche Seiten zeigen die deutsche Oberfläche mit Feldwerk, englische die englische mit Fieldwork (A443).
- [ ] **8.3** Nach Rafaels DNS-Einträgen und der Pages-Einstellung (Plan Phase 15, „Nach der Phase“, Punkte 1–2): https://werkbuch.dev/en/ und https://werkbuch.dev/de/ laden mit HTTPS; die Landingpage und Links aus README und App zeigen dorthin (A444).

---

## Kapitel 4: Regeln als prüfbare Schritte

### 4.1 Organisation

- [ ] **4.1.1** Als Mara **Einstellungen → Allgemein**: Name und Logo ändern → erwartet: Seitenleiste und Anmeldeseite zeigen beides; als Lene ist der Bereich nur lesbar (Spec 4.1; `concepts/permissions.md`, „Organisationsrollen“).
- [ ] **4.1.2** Standardsprache auf Englisch → erwartet: eine Person ohne eigene Sprache (Profil leer) sieht die Oberfläche nach dem Neuladen englisch, ihre Mails kommen englisch (Spec 4.1).
- [ ] **4.1.3** Wochenbeginn Sonntag, dann eine Liste mit „Due-Date ist diese Woche“ → erwartet: die Woche beginnt am Sonntag (Spec 4.1; `concepts/views.md`, „Daten und Zeitzone“).
- [ ] **4.1.4** Zeitzone der Organisation ändern → erwartet: „Nächste Termine“ einer Vorlage rechnen in der neuen Zone, kein Termin wird nachgeholt (A339).

### 4.2 Personen und Bots

- [ ] **4.2.1** Als Mara eine Person einladen (Org-Rolle, ein Projekt mit Rolle) → erwartet: Mail in Mailpit mit Link; im privaten Fenster annehmen, Passwort setzen, angemeldet, Mitglied des Projekts (Spec 4.2 „Einladung“).
- [ ] **4.2.2** Dieselbe Adresse erneut einladen → erwartet: der alte Link ist geschlossen (Spec 4.2: „eine neue Einladung ersetzt die alte“).
- [ ] **4.2.3** Als Sven anmelden → erwartet: abgelehnt mit dem Hinweis auf ein deaktiviertes Konto; in WEB stehen seine Kommentare und History mit „(deaktiviert)“ (Spec 4.2 „Deaktivieren statt löschen“).
- [ ] **4.2.4** Lene ist im zweiten Browser angemeldet; Mara deaktiviert sie → erwartet: Lenes nächster Klick führt zur Anmeldung, ihre Live-Verbindung endet, ihre Tokens sind weg (`GET /api/v1/me` mit ihrem Token 401); reaktivieren bringt keine Tokens zurück (Spec 4.2; A281).
- [ ] **4.2.5** Auf DDEV (Mara ist dort die einzige Person mit Org-Rolle Admin) versucht Mara, sich selbst zum Member zu machen oder zu deaktivieren → erwartet: abgelehnt, der Standard-Bot zählt nicht (Spec 4.3 „Letzter Admin“).
- [ ] **4.2.6** Standard-Bot umbenennen, Avatar setzen, dann deaktivieren → erwartet: Umbenennen geht, Deaktivieren nicht; ein Token für ihn zeigt die Warnung zu Admin-Rechten (Spec 4.2 „Standard-Bot“).
- [ ] **4.2.7** Auf dem Stack ohne Mailserver (`MAIL_MAILER=log`) einladen → erwartet: der Link lässt sich kopieren, „Passwort vergessen“ fehlt auf der Anmeldeseite (Spec 4.2 „Einladung“; `operations.md`, „Mail“).
- [ ] **4.2.8** Bot anlegen (Mara), Token mit Ablaufdatum anlegen → erwartet: Klartext einmal, danach nie wieder; „zuletzt benutzt“ füllt sich nach einem Aufruf (Spec 4.2 „Tokens“; `bots.md`).
- [ ] **4.2.9** `ddev artisan app:reset-password lene@feldwerk.example.com` → erwartet: fragt zweimal, beendet Lenes Sitzungen (Spec 4.2; `setup.md`, „Passwörter“).
- [ ] **4.2.10** Zweiten Faktor für Lene einrichten, mit Code anmelden, einen Recovery-Code verwenden → erwartet: 8 Codes, ein benutzter fehlt danach in der Liste; viele falsche Codes führen nach dem Minutendeckel zu einer Meldung in Stunden mit Hinweis auf den Betreiber (Plausibilität; A435, `operations.md`, „Drosseln und Proxys“).

### Anmeldung mit Fehlversuchen (A434)

- [ ] **AN.1** Im ersten Browser als Lene einmal erfolgreich anmelden und wieder abmelden (setzt das Cookie des bekannten Geräts) (A434; `operations.md`, „Drosseln und Proxys“).
- [ ] **AN.2** In einem zweiten Browser 50 Fehlversuche für `lene@feldwerk.example.com` (nach je 5 sperrt die IP-Grenze 60 s; zusammen rund 10 Minuten). Abkürzung auf DDEV (Vorschlag, simuliert 50 Fehlversuche über verschiedene Adressen): `ddev artisan tinker --execute="foreach (range(1, 50) as \$i) { RateLimiter::hit(App\Auth\AccountLoginRateLimiter::PREFIX.App\Auth\AccountLoginRateLimiter::address('lene@feldwerk.example.com'), 3600); }"` → erwartet: der nächste Versuch im zweiten Browser wird abgelehnt, auch mit dem richtigen Passwort, und die Meldung nennt die Wartezeit in Minuten.
- [ ] **AN.3** Im ersten Browser (bekanntes Gerät) als Lene mit richtigem Passwort anmelden → erwartet: geht.
- [ ] **AN.4** In einem privaten Fenster mit richtigem Passwort → erwartet: abgelehnt, Meldung in Minuten.
- [ ] **AN.5** Im privaten Fenster „Passwort vergessen“, Link aus Mailpit, neues Passwort setzen, anmelden → erwartet: geht; die Sperre ist aufgehoben. Der erste Browser ist danach wieder ein unbekanntes Gerät (das Cookie hängt am Passwort), bis zur nächsten Anmeldung dort.
- [ ] **AN.6** Bekannte Grenze, kein Befund: meldet sich im ersten Browser ein zweites Konto an, ist Lene dort wieder unbekannt (A434, Restrisiko M1).

### 4.3 Rollen und Rechte

- [ ] **4.3.1** Als Theo (Viewer in WEB) ein WEB-Item öffnen → erwartet: Felder lesbar, jedes Feld nennt den Grund statt eines Editors; kommentieren, reagieren, beobachten, ein Bild in den Kommentar einfügen geht; „Datei hochladen“ ist gesperrt mit Grund (Spec 4.3 Tabelle „Projekt“; A234).
- [ ] **4.3.2** Als Theo im Wiki von WEB → erwartet: lesen und Versionen ansehen ja, kein Editor, kein Griff im Baum, „Wiederherstellen“ gesperrt (Spec 4.15 „Weitere Regeln“).
- [ ] **4.3.3** Als Ida (Außenstehende) im öffentlichen APP → erwartet: Projekt unter `/projects` mit „Beitreten“, Items lesbar wie ein Viewer; nach „Beitreten“ als Member änderbar (Spec 4.3 „Sichtbarkeit“; `concepts/projects.md`, „Mitglieder und Rollen“).
- [ ] **4.3.4** Als Ida `/items/OPS-12`, `/projects/OPS`, `/projects/OPS/wiki` und `GET /api/v1/work-items/OPS-12` mit ihrem Token → erwartet: überall 404, nie 403 (CLAUDE.md, „Sichtbarkeit“; `concepts/permissions.md`, „Sichtbarkeit“).
- [ ] **4.3.5** Als Jonas (Member in WEB) ein WEB-Item löschen → erwartet: nicht angeboten bzw. 403 mit Satz; als Ida (Admin) geht es (Spec 4.3: „Items löschen“ nur Admin).
- [ ] **4.3.6** Als Lene eine View anlegen, als Jonas sie ändern → erwartet: Jonas nur „Duplizieren“, „Speichern“ gesperrt mit Satz; Mara darf ändern (Spec 4.11 „Rechte“).
- [ ] **4.3.7** Als Lene **Einstellungen → Personen, Bots, Webhooks, System** → erwartet: „Nur für Admins“, nichts lädt; Kataloge lesbar (Spec 4.3 Tabelle „Organisation“).
- [ ] **4.3.8** Org-Admin ohne Mitgliedschaft: Mara macht Lene zur Org-Admin → erwartet: Lene sieht das private OPS und verwaltet es ohne Mitglied zu sein; zurückgestuft ist OPS für sie wieder weg, ihre Live-Verbindung wird getrennt (Spec 4.3 „Org-Admins“; A281). Auf dem Stack dasselbe mit `admin@example.com`.

### 4.4 Projekte

- [ ] **4.4.1** Projekt anlegen: Kennung aus dem Namen vorgeschlagen, Workflow und Typen vorgewählt, Bild hochladen → erwartet: Karte mit Bild bzw. Farbe und Initialen (Spec 4.4 „Felder“; A65).
- [ ] **4.4.2** Kennung von APP auf APX ändern; `/items/APP-4` öffnen → erwartet: Umleitung auf `/items/APX-4`; `curl -i …/api/v1/work-items/APP-4` 301 mit `Location` und `Cache-Control: no-store, private`; ⌘K mit `APP-4` springt zu APX-4 (Spec 4.4; `concepts/work-items.md`, „Frühere Keys“; A119, A202).
- [ ] **4.4.3** Danach OPS umbenennen; als Ida `/items/OPS-12` → erwartet: 404, kein 301 (CLAUDE.md, „Fallstricke“: früherer Key nur für Sichtbares).
- [ ] **4.4.4** Zurückbenennen (APX → APP, dann OPS zurück) → erwartet: Links funktionieren wieder, keine Umleitungsschleife (A119, K6).
- [ ] **4.4.5** Projekt archivieren → erwartet: Rückgängig-Toast; aus Seitenleiste und Views verschwunden; geöffnet mit Banner „Archiviert, schreibgeschützt“, keine Änderung möglich (409); wiederherstellen geht (Spec 4.4 „Archivieren“; A163).
- [ ] **4.4.6** Ein Testprojekt löschen: Kennung falsch eintippen → Fehler am Feld; richtig → Projekt sofort weg, Rückgängig führt zurück; nach Ablauf auch per REST 404, Anhänge weg (Spec 4.4 „Löschen“; `concepts/projects.md`, „Löschen“).
- [ ] **4.4.7** Projekt und View mit Stern favorisieren → erwartet: in der Seitenleiste in Reihenfolge; ein privates Projekt, das man verliert, verschwindet aus den Favoriten (Spec 4.4 „Favoriten“).
- [ ] **4.4.8** Lead entfernen → erwartet: 409 `lead_cannot_leave`; herabstufen geht (A47).

### 4.5 Workflows

- [ ] **4.5.1** Workflow ohne Completed-Status speichern → erwartet: Befund, kein Speichern (Spec 4.5 „Status“; `concepts/workflows.md`, „Regeln beim Speichern“).
- [ ] **4.5.2** Status eines benutzten Workflows entfernen → erwartet: Dialog „Status ersetzen“ mit Zahl der Items je Status; nach dem Speichern stehen die Items im neuen Status, die History nennt den Grund, keine Benachrichtigung dafür (Spec 4.5; A102, A294).
- [ ] **4.5.3** Projekt auf einen anderen Workflow umstellen → erwartet: Zuordnungsdialog mit Vorschlägen und Effekten; der Hauptknopf erst mit allen Zielen (A95, A116; `concepts/workflows.md`, „Workflow eines Projekts wechseln“).
- [ ] **4.5.4** Standard-Workflow löschen bzw. Standard abwählen; einen benutzten Workflow löschen → erwartet: abgelehnt mit Satz und Projekten (A72, A99).
- [ ] **4.5.5** Board über WEB und APP (verschiedene Workflows) nach Status gruppieren → erwartet: fällt auf Kategorie zurück mit Hinweis; Zug in eine Kategorie-Spalte setzt den ersten erlaubten Status (Spec 4.11 „Status über mehrere Workflows“).

### 4.6 Work-Item-Typen

- [ ] **4.6.1** Typ eines Bugs mit „Umgebung“ und „Browser“ auf Task wechseln (`t`) → erwartet: Dialog nennt die verlorenen Werte; danach History mit den alten Werten (Spec 4.6 „Typ wechseln“).
- [ ] **4.6.2** Auf einen Typ mit Pflicht-Property wechseln → erwartet: der Dialog fragt den Pflichtwert ab (Spec 4.6).
- [ ] **4.6.3** Häkchen „Epic“ an einem Typ entfernen, dessen Items Kinder haben → erwartet: abgelehnt mit Grund am Schalter (Spec 4.8 „Eltern und Kinder“).
- [ ] **4.6.4** Benutzten Typ löschen → erwartet: archiviert statt gelöscht, Toast sagt es; neue Items dieses Typs nicht mehr möglich; Standardtyp eines Projekts lässt sich weder löschen noch archivieren (409, nennt Projekte) (Spec 4.6 „Löschen“; A66).

### 4.7 Properties

- [ ] **4.7.1** Property nachträglich zur Pflicht machen → erwartet: bestehende Items ohne Wert zeigen „Pflichtfeld, noch leer“; ein gesetzter Pflichtwert lässt sich nicht leeren (Spec 4.7 „Pflicht“).
- [ ] **4.7.2** Property löschen → erwartet: Bestätigung nennt die Zahl der Items (nur sichtbare), danach Toast; History behält die Werte (Spec 4.7 „Löschen“; A175).
- [ ] **4.7.3** In ein Zahlenfeld „1.500“ tippen → erwartet: Hinweis auf beide Lesarten, kein Speichern; „1500“ und „1,5“ gehen (A146).
- [ ] **4.7.4** Eine benutzte Option eines Dropdowns entfernen → erwartet: wird archiviert, Toast sagt es; Items behalten sie (A147).
- [ ] **4.7.5** Schlüssel einer Property mit Kernfeld-Namen (`title`) → erwartet: abgelehnt; Feldtyp beim Bearbeiten fest, nur Einfach → Mehrfachauswahl (Spec 4.7 „Definition“).
- [ ] **4.7.6** Resolution: ein Item nach Done ziehen → Resolution-Frage mit Standard „Done“; zurück nach Started → Resolution leer (Spec 4.7 „Resolution“).

### 4.8 Work Items

- [ ] **4.8.1** Start-Date nach Due-Date wählen → erwartet: der Kalender lehnt ab mit Satz (Spec 4.8 „Felder“).
- [ ] **4.8.2** Ein offenes Item archivieren → erwartet: nicht angeboten bzw. 409 `not_closed`; ein geschlossenes geht, ist danach schreibgeschützt und aus Listen weg, wiederherstellen geht (Spec 4.8 „Archivieren und Löschen“).
- [ ] **4.8.3** Epic mit Kindern löschen → erwartet: 5 s Rückgängig; danach sind die Kinder ohne Eltern, ihre History sagt „Eltern-Item gelöscht“ (Spec 4.8; A112).
- [ ] **4.8.4** Mehrere Items über zwei Workflows auswählen, Status setzen → erwartet: Status nur aus gemeinsamen; Archivieren nur, wenn alle geschlossen; ein abgelehntes Item nennt der Toast (Spec 4.8 „Mehrfachbearbeitung“; A198).
- [ ] **4.8.5** Ein Item in der Vorschau (Leertaste) und als Seite (Enter) → erwartet: beide; die URL läuft über den Key (Spec 4.8 „Ansichten“).
- [ ] **4.8.6** Beschreibung: Mara und Jonas öffnen WEB-47, beide tippen, Jonas speichert zuerst → erwartet: Mara bekommt das Banner mit „Neu laden“ und „Meine Fassung übernehmen“; Übernehmen speichert ihre Fassung, Jonas’ steht in der History (Spec 4.8 „Gleichzeitige Änderungen“; A103, A154).
- [ ] **4.8.7** Item mit Assignee anlegen, der kein Mitglied ist → erwartet: nicht wählbar; der Standard-Bot nur, wenn ausdrücklich Mitglied (Spec 4.8 „Felder“; A127).

### 4.9 Relationen

- [ ] **4.9.1** Mit `r` eine Relation „blockiert“ zu einem Item in einem anderen Projekt → erwartet: beide Enden zeigen sie; das blockierte zeigt den Hinweis, solange der Blocker offen ist (Spec 4.9).
- [ ] **4.9.2** Relation von WEB zu OPS (als Mara), dann als Ida das WEB-Item → erwartet: „verborgenes Item“ ohne Key, Titel und Link; „blockiert“ zählt trotzdem (Spec 4.9 „Regeln“; A118).
- [ ] **4.9.3** Dieselbe Relation ein zweites Mal, eine mit sich selbst → erwartet: Fehler am Feld (Spec 4.9 „Regeln“).
- [ ] **4.9.4** Mitgelieferten Relationstyp löschen → erwartet: gesperrt; umbenennen geht (Spec 4.9 „Relationstypen“).

### 4.10 Kommentare, History, Beobachten

- [ ] **4.10.1** Eigenen Kommentar bearbeiten → erwartet: „bearbeitet“, die alte Fassung im Verlauf aufklappbar (Spec 4.10 „Kommentare“).
- [ ] **4.10.2** Fremden Kommentar löschen als Projekt-Admin; als Member → erwartet: Admin ja mit Rückgängig, Member nicht; die History vermerkt das Löschen ohne Text (Spec 4.10; A228, A241).
- [ ] **4.10.3** Reaktionen 👍 und 👍🏽 → erwartet: zwei verschiedene; je Person einmal je Emoji (Spec 4.10; A242).
- [ ] **4.10.4** Mehrere Änderungen in kurzer Folge → erwartet: eine zusammengefasste Zeile mit Alt → Neu; Filter „Kommentare“, „Änderungen“ (Spec 4.10 „History“).
- [ ] **4.10.5** Item abbestellen, dann ändert jemand es → erwartet: keine Benachrichtigung; eine Erwähnung oder neue Zuweisung meldet wieder an (Spec 4.10 „Beobachten“; A113).
- [ ] **4.10.6** Kommentar an archiviertem Item → erwartet: nicht möglich, Grund statt Composer; Beobachten geht (A240).

### 4.11 Views

- [ ] **4.11.1** In einer Projektliste einen Filter setzen → erwartet: „Ungespeicherte Änderungen“, Zustand in der URL; die URL in einem anderen Browser öffnen zeigt dasselbe (Spec 4.11 „Ad-hoc und fest eingebaut“).
- [ ] **4.11.2** „Als neue View speichern …“, Ändern, Verwerfen mit Rückgängig (Spec 4.11; `concepts/views.md`, „Views und eingebaute Listen“).
- [ ] **4.11.3** Filter mit „me“, „heute“, „+7 Tage“, „überfällig“, „Titel enthält uber“ (findet „Über“) (Spec 4.11 „Filter“; A167).
- [ ] **4.11.4** Board nach Label gruppieren → erwartet: nicht ziehbar; nach Priorität und Assignee ziehbar (Spec 4.11 „Board“).
- [ ] **4.11.5** Schnellanlage in einer Board-Spalte (`+`) → erwartet: Item entsteht in der Spalte, leuchtet auf; in einer verbotenen Spalte gesperrt mit Grund (Spec 4.5 „Anlegen“, 4.11).
- [ ] **4.11.6** Tabelle: Spalten wählen (auch Properties), Kopf und erste Spalte bleiben beim Scrollen stehen, Zelle mit Enter bearbeiten (Spec 4.11 „Tabelle“).
- [ ] **4.11.7** Timeline: Balken ziehen und an den Kanten ziehen, Epic ohne Datum aus „Ohne Datum“ einplanen, Zoom Woche/Monat/Quartal, Linie „Heute“ (Spec 4.11 „Timeline“).
- [ ] **4.11.8** Eine View, deren Filter eine inzwischen gelöschte Property nennt → erwartet: lädt, Chip „Unbekanntes Feld“, trifft nichts (A160).

### 4.12 Vorlagen und Recurring

- [ ] **4.12.1** Vorlage mit allen Platzhaltern im Titel, Beschreibung mit Bild, Abständen für Start und Due → erwartet: Vorschau des Titels vom Server; Anwenden im Anlegen-Dialog füllt alles, das Bild ist eine eigene Kopie (Spec 4.12; A335, A337).
- [ ] **4.12.2** Vorlage aus der Palette anwenden („Vorlage anwenden …“) (Spec 4.12 „Von Hand“).
- [ ] **4.12.3** Monatlich am ersten Montag, monatlich am 31., jährlich am 29.02. → erwartet: „Nächste Termine“ zeigt fünf plausible Termine (31. im April der 30., 29.02. im Nicht-Schaltjahr der 28.) (Spec 4.12 „Zeitplan“; `concepts/templates.md`, „Frequenzen“).
- [ ] **4.12.4** Sommerzeit (nur Plausibilität, genau prüft `tests/Feature/Templates/ScheduledRunsTest.php`): täglich 02:30 ab 2027-03-26 → erwartet: am 2027-03-28 steht 03:30; täglich 02:30 ab 2027-10-29 → am 2027-10-31 genau ein Termin 02:30 (`concepts/templates.md`, „Uhrzeit und Zeitzone“).
- [ ] **4.12.5** „Jetzt ausführen“ → erwartet: Item vom Standard-Bot, im Protokoll „von Hand von Mara“; Zähler der Läufe und nächster Termin bleiben (A338).
- [ ] **4.12.6** Assignee einer Vorlage aus dem Projekt entfernen, „Jetzt ausführen“ → erwartet: Lauf gescheitert mit Satz in der Sprache der Organisation; Lead und Ersteller haben „Vorlage fehlgeschlagen“ in der Inbox; die Vorlage bleibt aktiv (Spec 4.12 „Fehler“; A340, A348).
- [ ] **4.12.7** Zeitplan pausieren und fortsetzen → erwartet: kein verpasster Termin wird nachgeholt (A339).

### 4.13 Automatisierungen

- [ ] **4.13.1** **Projekteinstellungen → Automatisierungen** in einem neuen Projekt → erwartet: alle aus außer „Erwähnte Items verknüpfen“ (Spec 4.13; A452).
- [ ] **4.13.2** „Assignee beim Start“ an; ein Item ohne Assignee als Person nach In Progress ziehen → erwartet: man wird Assignee, History „Automatisierung: Assignee beim Start“, man selbst bekommt keine Benachrichtigung (Spec 4.13; A342).
- [ ] **4.13.3** „Eltern schließen“ an; letztes Kind eines Epics nach Done → erwartet: das Epic geht in den ersten erlaubten Completed-Status (Spec 4.13).
- [ ] **4.13.4** Auto-Archiv und Auto-Close: Plausibilität über `ddev artisan app:run-automations --now --project=<ULID>` → erwartet: alte geschlossene archiviert, alte Backlog-Items storniert mit Kommentar; niemand wird benachrichtigt; ein nicht erlaubter Übergang überspringt das Item (Spec 4.13; A344, A357; `concepts/automations.md`, „In der Nacht“).
- [ ] **4.13.5** Workflow mit Auto-Close an wechseln → erwartet: der Dialog sagt, welchen Canceled-Status Auto-Close danach nimmt (A345).

### 4.14 Benachrichtigungen

- [ ] **4.14.1** Lene beobachtet ein WEB-Item; Mara kommentiert dort mit `@lene` und einem Verweis `#OPS-12` → erwartet: eine Zeile der stärksten Art („erwähnt“) in Lenes Inbox; der Auszug und die Mail zeigen den Verweis als verborgen, ohne Key und Titel von OPS-12 (Spec 4.14; A229, A267).
- [ ] **4.14.2** Ida ist Lead von WEB; Jonas legt in WEB ein Item an → erwartet: Ida bekommt „Neues Item“, sonst niemand (A269).
- [ ] **4.14.3** Mara erwähnt `@lene` in einem APP-Kommentar und entfernt Lene innerhalb der 5 Minuten aus APP → erwartet: die Inbox-Zeile verschwindet, die Mail geht nicht raus (Spec 4.14 „nie Konten ohne Zugriff“; `concepts/notifications.md`, „Mail“).
- [ ] **4.14.4** Benachrichtigung öffnen → erwartet: gelesen; „Als ungelesen markieren“ führt zurück; „Alle als gelesen“ im Filter „Erwähnungen“ liest nur Erwähnungen (Spec 4.14 „Inbox“; A291).
- [ ] **4.14.5** **Persönliche Einstellungen → Benachrichtigungen**: Mail für Kommentare aus → erwartet: die nächste Kommentar-Benachrichtigung kommt nur in die Inbox (Spec 4.14 „Kanäle“).
- [ ] **4.14.6** Ein Item mit Due-Date heute Lene zuweisen; am nächsten Tag um 08:00 Lenes Zeit → erwartet: Erinnerung in Inbox und eine Sammelmail (Plausibilität; A275).
- [ ] **4.14.7** Zwei Tabs derselben Person: in einem gelesen markieren → erwartet: der andere folgt ohne Neuladen (A277).

### 4.15 Wiki

- [ ] **4.15.1** Seite anlegen, Emoji wählen, tippen → erwartet: speichert nach kurzer Pause, „Gespeichert“; nach dem Neuladen da (Spec 4.15 „Gleichzeitiges Bearbeiten“).
- [ ] **4.15.2** Mara und Jonas auf derselben Seite, Jonas speichert zuerst → erwartet: Mara sieht „von Jonas geändert“ mit „Neu laden“ und „Meine Fassung übernehmen“; Übernehmen sichert Jonas’ Fassung als Version (Spec 4.15; A307).
- [ ] **4.15.3** „Neu laden“ und danach Rückgängig aus dem Toast → erwartet: die eigene Fassung und das Banner kommen zurück (A307; `concepts/wiki.md`, „Gleichzeitig bearbeiten“).
- [ ] **4.15.4** Versionen ansehen und eine wiederherstellen → erwartet: neue Version, Emoji bleibt (Spec 4.15 „Versionen“; A323, A328).
- [ ] **4.15.5** Seite mit Unterseiten löschen → erwartet: Rückfrage nennt die Unterseiten, danach 5 s Rückgängig; ohne Unterseiten fragt es auch (Spec 4.15 „Baum“).
- [ ] **4.15.6** Seite per Ziehen umordnen und per „Verschieben nach …“ → erwartet: beides; ein offener Editor auf der Seite bekommt keinen Konflikt (A311).
- [ ] **4.15.7** Wiki eines archivierten Projekts → erwartet: lesbar, nicht bearbeitbar (A312).

### 4.16 Rich Text und Anhänge

- [ ] **4.16.1** `/`-Menü, Markdown-Kürzel (`## `, `- `, `[ ] `), Code-Block mit Sprache → erwartet: Hervorhebung (Spec 4.16 „Editor“; `concepts/rich-text.md`, „Blöcke und Kürzel“).
- [ ] **4.16.2** `@` in einem OPS-Item → erwartet: nur Personen und Bots mit Zugriff auf OPS (nicht Ida, Theo, Lene) (Spec 4.16 „Erwähnungen und Verweise“).
- [ ] **4.16.3** `#` → erwartet: Items und Wiki-Seiten getrennt, nur Sichtbares; ein Verweis zeigt den aktuellen Key bzw. Titel (Spec 4.16).
- [ ] **4.16.4** Eine SVG- und eine PDF-Datei in die Dateiliste laden → erwartet: beide als Download, nie inline; ein PNG zeigt eine Vorschau (Spec 4.16 „Auslieferung“; A237).
- [ ] **4.16.5** Eine Datei über 25 MB → erwartet: Ablehnung mit der Grenze, vor dem Senden (Spec 4.16 „Größe“).
- [ ] **4.16.6** Bild aus dem Text löschen, dann `ddev artisan app:prune-attachments --dry-run --min-age=1` (am nächsten Tag) → erwartet: das Bild steht in der Liste, ohne `--dry-run` geht es (Spec 4.16 „Aus dem Text entfernte Bilder“; `concepts/rich-text.md`, „Aufräumen“).
- [ ] **4.16.7** Beschreibung über REST als Markdown lesen und zurückschreiben (`concepts/rich-text.md`, „Schreiben über REST“) → erwartet: Erwähnungen, Verweise (auch verborgene als `[hidden](item:<ulid>)`) und Bilder bleiben (A229).

### 4.17 Suche und Befehlspalette

- [ ] **4.17.1** ⌘K mit einem Wort aus einem Kommentar → erwartet: das Item wird gefunden; Treffer nach Art gruppiert (Items, Seiten, Projekte, Personen nur für Org-Admins, Views) (Spec 4.17; A204, A205).
- [ ] **4.17.2** Als Ida nach einem Wort, das nur in OPS steht, und nach `OPS-12` → erwartet: kein Treffer, kein Sprung, wie ein unbekannter Key (Spec 4.17 „Zugriff“; A202).
- [ ] **4.17.3** Archiviertes Item per Key → erwartet: Sprung geht; als Suchtreffer erscheint es nicht (A201, A202).
- [ ] **4.17.4** Auf dem Stack `docker compose -p werkbuch-manual stop meilisearch`, dann ⌘K → erwartet: Fehler mit „Erneut versuchen“, kein leeres Ergebnis; ein getippter Key springt trotzdem; danach `start meilisearch` (A210; `search.md`, „Fehler“).
- [ ] **4.17.5** Palette: Navigation, „Neues Item“, „Status ändern …“ am ausgewählten Item, „Vorlage anwenden …“, „Theme wechseln …“ (Spec 4.17 „Befehlspalette“).

---

## Aus Phase 15: Block E2 und E3

- [ ] **P.1** Board mit erschöpften Rängen (A448): ein Projekt mit drei Items in einer Spalte; per REST (`concepts/work-items.md`, „Items von Hand ordnen“) die Ränge `a0`, `a0` + 125 × `0` + `1` und `a1` setzen (wie `e2e/tests/board.spec.ts`, „moves a card where the ranks ran out“); Sortierung „Manuell“; die dritte Karte mit ⌥↑ zwischen die ersten beiden → erwartet: kurz „Ordnung wird neu verteilt …“, dann steht sie dort, auch nach dem Neuladen; kein „nicht verschoben“.
- [ ] **P.2** Epic mit mehr als 100 Kindern (A449): per REST 105 Kinder unter WEB-30 anlegen (`for i in $(seq 1 105); do curl -s -o /dev/null -X POST https://werkbuch.ddev.site/api/v1/work-items -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"project_id\":\"WEB\",\"title\":\"Kind $i\",\"parent_id\":\"WEB-30\"}"; done`) → erwartet: das Detail zeigt die ersten 100 Kinder, daneben „100 von N“ (N = alle Kinder samt den schon vorhandenen) und „Weitere Kind-Items laden“; danach alle, der Fokus auf dem ersten nachgeladenen; der Fortschritt zählt alle (`concepts/work-items.md`, „Eltern und Kinder“).
- [ ] **P.3** Text-Property mit Zahlen sortieren (A450): drei Bugs mit „Browser“ = „Firefox 9“, „Firefox 10“, „Firefox 100“; Tabelle nach „Browser“ sortieren → erwartet: 9, 10, 100 (auch absteigend umgekehrt); Sortierung „Key“ ordnet `A2` vor `A10` (`concepts/views.md`, „Sortierung“).
- [ ] **P.4** Öffentliches Projekt erscheint ohne Neuladen (A451): Lene auf `/projects`; Jonas legt ein öffentliches Projekt an → erwartet: es erscheint bei Lene ohne Neuladen; ein privates neues nicht; Jonas stellt ein privates auf öffentlich → erscheint bei Lene (`concepts/notifications.md`, „Live-Updates“).
- [ ] **P.5** `#`-Verweis legt eine Relation an (A452, A453): in der Beschreibung von WEB-47 `#` und ein anderes Item wählen, speichern → erwartet: kurz danach eine Relation „verwandt mit“ an beiden Items, im Verlauf mit „Automatisierung: Erwähnte Items verknüpfen“; den Verweis wieder entfernen → die Relation bleibt; derselbe Verweis noch einmal → keine zweite Relation (`concepts/automations.md`, „Erwähnte Items verknüpfen“).
- [ ] **P.6** Als Theo (Viewer) in WEB einen Kommentar mit `#`-Verweis schreiben → erwartet: keine Relation (`item.edit` fehlt) (A452).
- [ ] **P.7** Die Automatisierung im Projekt ausschalten, erneut einen neuen Verweis speichern → erwartet: keine Relation; wieder an → der nächste neue Verweis verknüpft (A452).
- [x] **P.8** Entschieden von Rafael am 2026-11-09: zwei Inbox-Zeilen je Speichern mit neuem Verweis sind in Ordnung (die Änderung bzw. der Kommentar und „Relationen geändert“).
- [ ] **P.9** Board per Trackpad und Rad (21n): Board mit vielen Spalten auf 1440 px; den Zeiger über eine Spalte halten und waagerecht wischen bzw. ⇧+Rad → erwartet: das Board scrollt seitwärts; senkrecht scrollt die Spalte, ohne die Seite mitzuziehen (Plan Phase 15, Task 21n).
- [ ] **P.10** Tabelle im Editor (A454): in einer Beschreibung eine Tabelle einfügen (`/`, „Tabelle“); in einer Zelle erscheint der Reiter „Tabelle“; per Klick und per Alt+F10 das Menü öffnen, Zeile darüber/darunter, Spalte links/rechts, Kopfzeile und Kopfspalte schalten, Zeile und Spalte löschen → erwartet: jede Aktion wirkt, die Ansage nennt sie, der Fokus kehrt in die Zelle zurück; die letzte Zeile/Spalte ist gesperrt mit „Lösche stattdessen die Tabelle“; im `/`-Menü stehen dieselben Befehle unter „Tabelle“; als Theo und in der Vorschau eines archivierten Items kein Reiter (`concepts/rich-text.md`, „Tabellen bearbeiten“).
- [ ] **P.11** Markdown zurückschreiben ohne Verlust (A455): Tabelle mit Kopfspalte in WEB-47, dann `curl -s -H "Authorization: Bearer $TOKEN" https://werkbuch.ddev.site/api/v1/work-items/WEB-47 | jq -r .data.description > desc.md`, eine Zelle in `desc.md` ändern, `jq -n --rawfile d desc.md '{description: $d}' | curl -s -X PATCH https://werkbuch.ddev.site/api/v1/work-items/WEB-47 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @-` → erwartet: in der Oberfläche die geänderte Zelle und weiter Kopfzeile und Kopfspalte (`concepts/rich-text.md`, „Tabellen“).
- [ ] **P.12** Wiki-Seite im Item (A456): eine WEB-Seite mit `#WEB-47` → erwartet: WEB-47 zeigt zwischen „Relationen“ und „Dateien“ den Abschnitt „Wiki-Seiten“ mit der Seite und Link ins Wiki; Verweis aus der Seite entfernen → der Abschnitt verschwindet ohne Neuladen; die Demo zeigt ihn an Items, die die Demo-Seiten nennen (`concepts/work-items.md`, „Wiki-Seiten“).
- [ ] **P.13** Eine OPS-Seite (privat) nennt `#WEB-47` (als Mara) → erwartet: Mara sieht beide Seiten im Abschnitt, Ida (Admin in WEB, nicht in OPS) nur die WEB-Seite; `GET /api/v1/work-items/WEB-47/pages` mit Idas Token hat `meta.total` ohne die OPS-Seite (A456).
- [ ] **P.14** Englische Demo (A443): `ddev artisan migrate:fresh && ddev artisan db:seed --class=DemoSeederEn`, als `mara@fieldwork.example.com` (`werkbuch-demo`) mit englischer Oberfläche durch Listen, Item-Seite, Wiki, Vorlagen, Inbox, Webhooks, Einstellungen → erwartet: Organisation „Fieldwork“, kein deutscher Text in den Daten (Titel, Beschreibungen, Kommentare, Seiten, Vorlagen, Katalog), gleiche Keys wie die deutsche Demo; danach zurück mit `migrate:fresh --seed --seeder=DemoSeeder` (`development.md`, „Erster Start“).

---

## Bedienung (Spec 5)

- [ ] **B.1** Desktop 1440 px, hell und dunkel (Palette „Theme wechseln …“ und System): Listen, Board, Tabelle, Timeline, Item-Seite, Vorschau, Inbox, Wiki, Vorlagen, Einstellungen → erwartet: lesbar, Kontrast ausreichend, Glas nur auf schwebenden Flächen, „Heute“ im Dunkeln als gelbe Schrift mit Schein (Spec 5.1, 5.4; Änderungen vom 2026-10-29 „Gestaltung“).
- [ ] **B.2** Handy 390 px (Browser-Werkzeuge oder echtes Telefon gegen die DDEV-Adresse): lesen, kommentieren, Status und Assignee ändern; Ziele mindestens 44 px; Suche über das Icon der unteren Leiste (Spec 5.1 „Responsiv“).
- [ ] **B.3** Gefühlt schnell: Statuswechsel, Zuweisung, Archivieren erscheinen sofort, ohne Spinner; ein Fehler (Netz im Browser aus) rollt mit Toast zurück (Spec 5.1 „Schnell“).
- [ ] **B.4** Rückgängig statt Rückfrage: Löschen/Archivieren mit 5-s-Toast und ⌘Z; Rückfrage nur bei Projekt löschen, Workflow wechseln, Wiki-Seite löschen (Spec 5.1).
- [ ] **B.5** VoiceOver (⌘F5) mit Safari, Stichprobe: Liste (Zeilen mit Key, Titel, „ausgewählt“; Ansage nach Filter), Item-Seite (Überschrift, Felder mit Namen „Status: …“), Palette (Combobox, Zahl der Treffer), Inbox (Zeilen, „Ungelesen:“, Badge-Name „Inbox, N ungelesen“) → erwartet: alles benannt, Änderungen angesagt (Spec 5.1 „Barrierefreiheit“; A441).
- [ ] **B.6** Banner „Live-Updates pausiert“: auf dem Stack `docker compose -p werkbuch-manual stop reverb` → erwartet: nach wenigen Sekunden das Banner; nach `start reverb` verschwindet es und Listen laden nach (Spec 14 „Reverb hinter Proxys“; `reverse-proxy.md`, „WebSockets“).

## Betrieb (Spec 8, 10)

- [ ] **O.1** Update (`upgrading.md`): auf dem Stack Daten anlegen, Image neu bauen (`docker buildx build --load -t werkbuch:local .`), dann `docker compose -p werkbuch-manual down && docker compose -p werkbuch-manual up -d` (nach dem Release `pull && down && up -d`) → erwartet: Daten, Konto, Schlüssel und Suchindex bleiben, `Nothing to migrate` bzw. neue Migrationen laufen einmal (A431).
- [ ] **O.2** Backup nach `backup.md`, „Sichern“ (Dump als `werkbuch`, `tar` des Daten-Volumes) → erwartet: zwei Dateien, `.app-key` im Archiv.
- [ ] **O.3** Wiederherstellen nach `backup.md`, „Wiederherstellen“ (`down -v`, Dump einspielen, `tar` zurück, `up -d`) → erwartet: Anmeldung, zweiter Faktor, Webhook-Geheimnisse und ein Item mit Anhang funktionieren, die Suche ist neu gebaut.
- [ ] **O.4** Proxy mit WebSockets (`reverse-proxy.md`, „Caddy“ bzw. „Nginx Proxy Manager“): Caddy auf dem Mac vor den Stack (`APP_URL` auf die Adresse des Proxys, `docker compose up -d`), dann die „Checkliste“ der Seite abarbeiten → erwartet: `https://`-Adressen der Assets, kein Banner „Live-Updates pausiert“, WebSocket `wss://…/app/…` mit 101, Upload von 25 MB geht.
- [ ] **O.5** System-Seite (**Einstellungen → System**, `operations.md`, „System-Seite“): Version, Rückstand je Queue samt ältestem Job, Suche mit Aufgaben, Live „Läuft“, Testmail (mit Mailpit aus der Override-Datei) → erwartet: alle Fakten stimmen; `docker compose -p werkbuch-manual stop meilisearch` → die Suche steht auf „nicht erreichbar“, danach wieder „läuft“. Fehlgeschlagene Jobs entstehen erst nach allen Versuchen (Suche rund 3 h 20 min): gibt es welche, „Alle erneut versuchen“ → legt sie zurück, Fehlerzeilen ohne Nutzer, Passwort und Query in URLs (Spec 5.2 „System“; A287; sonst prüft das `tests/Feature/System/RetryFailedJobsTest.php`).
- [ ] **O.6** Logs (`operations.md`, „Logs“): `docker compose -p werkbuch-manual logs werkbuch` nach einem Reset-Link → erwartet: `/reset-password/…` maskiert, keine Query, kein Token im Log.
- [ ] **O.7** `docker compose -p werkbuch-manual exec werkbuch php artisan app:reset-two-factor <email>` → erwartet: zweiter Faktor aus, Sitzungen beendet (`setup.md`, „Passwörter“).

## Webhooks (Spec 6.3)

- [ ] **6.3.1** Empfänger auf dem Mac (Vorschlag; aus dem Repo-Ordner, nutzt das Snippet `docs/snippets/webhooks/verify.mjs`, `webhooks.md`, „Signatur prüfen“; hört nur auf `127.0.0.1`, DDEV erreicht ihn als `http://host.docker.internal:8099/hook`, `development.md`, „Dienste“):

  ```bash
  WEBHOOK_SECRET='whsec_…' node --input-type=module -e "
  import { createServer } from 'node:http';
  import { verifyWerkbuchSignature } from './docs/snippets/webhooks/verify.mjs';
  createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    const ok = verifyWerkbuchSignature(process.env.WEBHOOK_SECRET, req.headers['x-werkbuch-timestamp'], body, req.headers['x-werkbuch-signature']);
    console.log(req.headers['x-werkbuch-event'], req.headers['x-werkbuch-delivery'], ok ? 'signiert ok' : 'SIGNATUR FALSCH', body.toString().slice(0, 200));
    res.end('ok'); }); }).listen(8099, '127.0.0.1');"
  ```

  Das Geheimnis zeigt werkbuch nur beim Anlegen und nach „Neues Geheimnis“: den Empfänger danach mit dem Wert starten.
- [ ] **6.3.2** Test-Ping aus dem Protokoll → erwartet: Toast mit Code und Dauer; der Empfänger meldet `ping`, `signiert ok` (`webhooks.md`, „Test-Ping und erneut senden“).
- [ ] **6.3.3** Webhook „nur für Bot Kira“ mit `bot.*` und `work_item.*`; ein WEB-Item Kira zuweisen → erwartet: genau ein `bot.assigned` und die `work_item.*` dieses Items; Änderungen an Items, die Kira nicht gehören, kommen nicht (Spec 6.3; A364, A371).
- [ ] **6.3.4** Kira aus OPS entfernen, ein OPS-Item ändern, das ihr zugewiesen war → erwartet: keine Zustellung; „erneut senden“ einer alten OPS-Zustellung scheitert mit dem Grund „Bot ohne Zugriff“, ohne HTTP (A364, A367).
- [ ] **6.3.5** Empfänger anhalten, eine Änderung machen → erwartet: Versuche im Protokoll mit „Keine Antwort“ und Grund; „erneut senden“ mit laufendem Empfänger kommt mit derselben `X-Werkbuch-Delivery` an (A365, A367).
- [ ] **6.3.6** Webhook auf `http://169.254.169.254/` oder `http://127.1/` speichern → erwartet: Fehler am Feld (auch mit `WEBHOOKS_ALLOW_PRIVATE=true` in DDEV) (A368, A378).

---

## Offen: Rulings, die noch auf Rafaels Bestätigung warten

Aus den Spec-Abschnitten „Änderungen vom …“ (Kopf der Spec) und den Rulings. **Nicht mehr offen** sind die Antworten vom 2026-11-07 (Plan Phase 15, „Antworten von Rafael“): A434 (Sperre auf neuem Gerät bis zu einer Stunde, bestätigt), A443 (Screenshots mit deutschen und englischen Demo-Daten), A444 (`werkbuch.dev`), A447 (verkleinert, vorgezogen als A448–A451), dazu A102 (Status-Zuordnung synchron, bestätigt 2026-10-31).

**Phase 15** (Spec „Änderungen vom 2026-11-07 (Phase 15)“; Task 27 trägt die übrigen aus dem Plan in Spec und Rulings nach)
- [ ] **A452** Details von „Erwähnte Items verknüpfen“: nur mit `item.edit` an der Quelle, geplante Vorlagenläufe prüfen den Standard-Bot, ein entfernter Verweis lässt die Relation stehen, Wiki-Seiten verknüpfen nichts. Das „ob“ (standardmäßig an) ist Rafaels Vorgabe.
- [x] **A452 (Lärm)** Bestätigt von Rafael am 2026-11-09: zwei Inbox-Zeilen je Speichern bleiben.
- [x] **A452 (Name)** Bestätigt von Rafael am 2026-11-09: der Name bleibt „Erwähnte Items verknüpfen“.
- [ ] **A453** Verknüpfen nach dem Commit in einem Job (kurz verzögert, der eigene Tab hört es live).
- [ ] **A454** Tabellen-Menü ohne Verbinden/Teilen und ohne einzelne Kopfzellen; keine Palette-Befehle.
- [ ] **A455** Markdown übernimmt Kopfzeile/Kopfspalte des vorigen Texts nur bei passender Tabelle; sonst gilt die Markdown-Form.
- [ ] **A456** Wiki-Seiten im Item nur aus der aktuellen Fassung, nur sichtbare, nach Titel.
- [ ] **A435** TOTP 30 Versuche je Konto und Tag.
- [ ] **A437** Queue `mail` vor `default` im Dienst `queue`.
- [ ] **A440** Zeitstempel der Items NOT NULL (ersetzt A406).
- [ ] **A448** Neu verteilen über Projekte hinweg: eine Liste mehrerer Projekte nach „Manuell“ kann danach anders mischen (das „ob“ ist Rafaels Antwort 5).
- [ ] **A449** `include=children` endet nach 100, der Rest seitenweise.
- [ ] **A450** Wo Server und Browser natürlich verschieden sortieren (andere Ziffernschriften, Brüche), entscheidet der Server.
- [ ] **A451** Live für Personen ohne Projektkanal gebündelt je 100 Kanäle; private neue Projekte nur für Mitglieder und Org-Admins.
- [ ] **A457** Filterzahlen auf vier Nachkommastellen gerundet; **A458** Klartext trennt Absätze mit Zeilenumbruch.

**Phase 14** (Spec „Änderungen vom 2026-11-07 (Phase 14)“)
- [ ] **A417, A418** drei Queue-Dienste, Reverb liest das Volume nur, internes Netz, nur `werkbuch` migriert.
- [ ] **A415, A419** nginx reicht nur `/app` an Reverb, kein HSTS aus dem Container.
- [ ] **A414, A429** Basis `serversideup/php` v5.0.4; Code root-owned, `www-data`, `no-new-privileges`.
- [ ] **A423** Standalone-Datei mit `change-me`, root ohne bekanntes Passwort.
- [ ] **A415, A416, A424** Konfiguration (`MEILISEARCH_KEY` ≥ 16 Zeichen, `APP_LOCALE`, S3 erst nach v0.1.0).
- [ ] **A420, A421, A425** e2e gegen `php artisan serve`, Smoke gegen den Stack im Job `image`, Actions per SHA.
- [ ] **A431** Update mit `down`.

**Phase 13** (MCP)
- [ ] **A397** Werkzeugschnitt (29 Tools; nicht über MCP: Tokens anlegen, Passwort, zweiter Faktor, System, `GET /references`).
- [ ] **A398** Argumente; **A399** Ergebnisse (25 je Seite, schlank); **A401** nur Tokens an `/mcp`; **A402** Drossel 300/min; **A403** Upload-URL; **A404** `types` ohne Art ist 422; **A405** Filter der Suche.

**Phase 12** (REST und OpenAPI)
- [ ] **A384** eigene Scramble-Extensions; **A386** Listen-Parameter `filter`/`sort`/`include`, alte Parameter übergangen; **A387** Drosseln; **A388** Body-Limit 8 MiB; **A389** API-Doku öffentlich; **A390** Stabilität ohne ETags; **A391** zurückgeschickt pinnt nicht; **A392** neue Lesepunkte; **A393** E-Mail-Adressen für jedes aktive Konto sichtbar.

**Phase 11** (Webhooks)
- [ ] **A361** Zustellung und Versuche getrennt; **A362** Payload bleibt, ohne `meta`; **A364** nur für einen Bot; **A365** Wiederholungen; **A366** Abschalten; **A367** Test-Ping und erneut senden; **A370** Projekt-Webhooks; **A371** `bot.assigned`; **A368, A378** Link-local und Metadaten bleiben gesperrt; **A379** nächtliche Automatisierungen gehen an Webhooks.

**Phase 10** (Vorlagen, Automatisierungen)
- [ ] **A336** ausdrückliches Speichern; **A337** Bilder beim Anwenden kopiert; **A338, A350** „Jetzt ausführen“ zählt nicht; **A339** nichts rückwirkend; **A340, A356** veraltete Vorlagen; **A342** Auslöser werden nicht benachrichtigt; **A344** Auto-Close zählt Kommentare; **A357** nächtliche Automatisierungen still; **A345** Auto-Close folgt dem Workflow; **A348** Mail für fehlgeschlagene Vorlagen.

**Phase 9** (Wiki)
- [ ] **A313** Seiten benachrichtigen nicht; **A307** „fremd“ und „Meine Fassung übernehmen“; **A308, A327** Speichern ohne Basis über REST; **A309, A328** Version nach der Pause, Wiederherstellen; **A323** ohne Emoji; **A314** Versionen beim Aufräumen; **A312** archivierte Projekte; **A319** Titel 200; **A311** Verschieben; **A310, A306** Löschen als ein Ereignis; **A315** Baum und Versionen in der API.

**Phase 8** (Benachrichtigungen, Live)
- [ ] **A267** ein Eintrag je Person und Ereignis; **A268** Zuweisung; **A269, A113** Lead und Abmeldung; **A270, A294** ohne Benachrichtigung; **A275** Erinnerungen; **A276** Aufräumen stündlich; **A277** Inbox ohne Events; **A291** „Alle als gelesen“ achtet den Filter; **A278** Queue `live`; **A279** Live-Nachrichten nur mit IDs; **A280** Kanäle; **A281** Trennen bei Zugriffsverlust.

**Phase 7** (Editor, Kommentare, Anhänge)
- [ ] **A240** archivierte Items; **A241** fremde Kommentare; **A234** Bilder im Text auch für Viewer; **A232, A233, A238, A261, A264** Uploads im Text; **A229** verborgene Verweise in Markdown; **A228** gelöschte Kommentare; **A243, A259** `bot.mentioned`, Selbst-Erwähnung; **A237** Vorschaubilder; **A242** Reaktionen; **A244** Erwähnungen in Properties.

**Phase 6** (Suche)
- [ ] **A204** Views in der Suche; **A205** Personen-Treffer nur für Org-Admins; **A201** Archiv wie in Listen; **A202** Key-Sprung; **A214** Ziel einer Relation über die Suche; **A210** Suche ohne Meilisearch.

**Phase 5** (Views)
- [ ] **A164, A184** Filterfelder „Ist ein Epic“, „Beobachtet“; **A167** Texte ohne Akzente; **A160** gelöschte Property in einer View; **A163** archivierte Projekte im Filter; **A170** Gruppen einzeln; **A172** Lese-POSTs; **A175** Zahlen „bei N Items“; **A185** Views ohne Konfliktwarnung; **A177** Timeline nach Start-Date. (A180 ist durch A448, A168 durch A450 überholt.)

**Phase 4** (Work Items; Spec „Änderungen vom 2026-10-31 (Phase 4)“)
- [ ] **A103** Beschreibung ohne Version, Rich Text in zwei Formen; **A118** verborgene Blocker; **A113, A120** Beobachten (Bots nie, im Archiv erlaubt), Abbestellen; **A112** Löschen hinterlässt Spuren; **A115** Prioritäten englisch (ob übersetzen, bleibt offen); **A116** Zuordnung streng; **A134** archivierte Items bei der Status-Zuordnung (Alternative: nur geschlossene Ziele); **A141** archiviertes Ziel einer Relation; **A147** Optionen entfernen; **A146** mehrdeutige Zahlen; **A129** Anlegen in einem anderen Status; **A152** Zahlen unter 10²⁰; **A150** eingefügter Rich Text; **A151** Sprache der API; **A154** ungespeicherter Text.

**Phase 3** (Kataloge)
- [ ] **A67** Namen und Längen; **A57** mitgelieferter Katalog; **A68** Typ-Icons; **A69, A89** Standardwerte; **A66** Standardtyp; **A72** genau ein Standard (Workflow, Resolutions); **A65** neue Projekte; **A64** Workflow eines Projekts nur über `PUT …/workflow`. (A61 „Löschen ohne Zahl“ ist seit Phase 5 durch A175 erledigt.)

**Phase 2** (Konten, Rollen, Projekte)
- [ ] **A43** `POST /tokens` nur aus der Sitzung; **A25, A44** `/me/*` nur aus der Sitzung; **A55** E-Mail-Adresse nur aus der Sitzung und nur durch Org-Admins; **A42** Einladungslink nur für Sitzung und `write`; **A29** `is_member`; **A47** Lead; **A27** Ereigniskatalog (`project.restored`); **A49** ein Einstellungsrahmen (Bestätigung per Screenshot offen).
- [ ] Offene Fragen ohne Nummer (Rulings, „Offene Fragen aus Phase 2“): Mitglieder können sich nicht selbst austragen; der letzte Projekt-Admin darf entfernt werden; Beitreten in ein archiviertes öffentliches Projekt geht; Bots können Favoriten haben.

## Befunde

<!-- Je Befund: Schritt, Umgebung, Konto, Breite/Theme, was passiert, was erwartet war, Issue-Link. -->
