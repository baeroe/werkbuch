# werkbuch: Fachkonzept und App-Design

Stand: 2026-10-29 · Status: freigegeben

> **Änderungen vom 2026-10-28 (Moodboards):** Rafael hat die Designrichtung **Werkbuch („Arbeitsheft“)** gewählt: Punktraster-Papier, Karteikarten mit Typ-Reitern, Textmarker für Auswahl und Fokus, Glas als Transparentpapier, Schriften Bricolage Grotesque und Figtree, Tintenblau als einziger Akzent. Gestaltungsgrundlage ist jetzt `prototypes/clickdummy/DESIGN.md` (5.4).

> **Änderungen vom 2026-10-29 (Korrekturrunde 1 am Klickdummy):** Rafael hat entschieden:
> - **Eltern und Kinder (4.8):** zwei Ebenen. Nur Items eines Typs mit Häkchen „Epic“ haben Kind-Items, und Epics haben selbst kein Eltern-Item. Ein Typwechsel und das Häkchen „Epic“ in den Einstellungen werden abgelehnt, wenn bestehende Items die Regel sonst brechen würden. Neue Kind-Items starten im Startstatus des Workflows.
> - **Inbox (4.14):** Öffnen markiert eine Benachrichtigung als gelesen; „Als ungelesen markieren“ führt zurück.
> - **Wiki (4.15):** Löschen fragt immer nach, auch ohne Unterseiten, und bleibt danach 5 Sekunden rückgängig.
> - **Anlegen-Dialog (5.1):** Der Fokus startet im Titel.
> - **Board (4.11):** Karten von Kind-Items zeigen ihr Epic vor dem Key, außer das Board ist nach Eltern-Item gruppiert. Dafür trägt ein Work Item in der API neben `parent_id` eine kurze Angabe zum Eltern-Item (`parent`: id, key, title).
> - **Bots (4.2):** Die Oberfläche nennt Bot-Konten durchgehend „Bot“, auch wenn sie einer Person gehören. Die persönliche Seite „API und MCP“ spricht von MCP-Clients statt von Agenten.
> - **Gestaltung (5.4):** Die Heute-Markierung folgt im Nachtheft der Textmarker-Regel aus `DESIGN.md`: gelbe Schrift mit Schein statt gelber Fläche.
>
> Die übrigen Abweichungen des Klickdummys stehen in `prototypes/clickdummy/README.md` und kommen hierher, sobald Rafael sie bestätigt.

**Herkunft der Entscheidungen:** Jede Entscheidung trägt eine Herkunft. **Vorgabe** heißt, Rafael hat es von sich aus verlangt. **Abgestimmt** heißt, es wurde im Gespräch vorgeschlagen und bestätigt. **Spec** heißt, die Entscheidung fiel beim Ausformulieren und muss noch geprüft werden. Alle Spec-Entscheidungen stehen gesammelt in Abschnitt 12.

## 1. Ziel und Kontext

werkbuch ist ein offenes, selbst gehostetes Projektmanagement-Tool für Teams. Eine Instanz gehört genau einer Organisation. Darin arbeiten Personen und Bots in Projekten an Work Items, die eigene Typen, eigene Properties und eigene Workflows haben. Außerdem gibt es:
- pro Projekt ein Wiki
- teamweite Views über alle Projekte
- Vorlagen mit Zeitplan
- schaltbare Automatisierungen
- Benachrichtigungen
- eine Omni-Suche
- für Integrationen eine vollständige REST-API, einen MCP-Server und Webhooks

**Warum (Vorgabe):** werkbuch soll mehr Features haben als die üblichen offenen Tools und konsequent Open Source und selbst gehostet sein. Grobes Vorbild ist Plane. Dort gibt es eigene Typen, Properties, Workflows mit Übergängen, Recurring und Wiki nur in Bezahlversionen oder gar nicht.

**Betrieb wie openbill und prevju (Vorgabe):**
- ein Image `baeroe/werkbuch` auf Docker Hub, gestartet mit `docker compose up -d`
- Doku als VitePress-Seite auf GitHub Pages; Wunschdomain `werkbuch.dev`, zum Zeitpunkt der Spec frei, aber noch nicht registriert
- Lizenz MIT

**Zielgruppe (Spec):**
- kleine bis mittlere Teams, etwa Agenturen und Produktteams
- KI-Agenten, die als Bots mitarbeiten

### Erfolgskriterien

1. **Start:** `docker compose up -d` startet App, Queue, Scheduler, Reverb, MariaDB und Meilisearch, erreichbar über einen einzigen Port (7740). Nach dem ersten Start gibt es einen Admin (aus `ADMIN_EMAIL`/`ADMIN_PASSWORD`) und den Standard-Bot.
2. **Durchgängiger Ablauf in UI, REST und MCP:**
   1. Workflow mit eingeschränkten Übergängen anlegen und einem Projekt zuordnen.
   2. Typ mit Pflicht-Property anlegen, dann ein Item dieses Typs.
   3. Ein unerlaubter Übergang wird abgelehnt, ein erlaubter klappt.
   4. Ein Kommentar erwähnt eine Person. Diese sieht die Benachrichtigung live in der Inbox und bekommt eine Mail.
   5. Ein Webhook kommt signiert beim Empfänger an.
   6. Das Item ist über die Omni-Suche auffindbar.
3. **Vorlage mit Zeitplan:** Sie legt pünktlich Items an, als Standard-Bot. Nach einem Ausfall holt sie den verpassten Termin genau einmal nach.
4. **Views:** Eine teamweite View mit Filter auf eine eigene Property zeigt als Liste, Board und Tabelle dieselben Items wie die REST-API mit `?view=<id>` und das MCP-Tool. Die Timeline zeigt Epics mit Fortschritt.
5. **Bilder aus der Zwischenablage:** Sie landen per Einfügen in Beschreibung, Kommentar und Wiki-Seite. Wer keinen Zugriff auf das Projekt hat, bekommt das Bild nicht.
6. **Tastatur:** Jeder Ablauf geht ohne Maus. Die Kürzel aus 5.3 sind umgesetzt, Playwright prüft das.
7. **CI:** 100 % Zeilenabdeckung im PHP-Code und im Frontend (Vitest und Playwright zusammengerechnet), dazu Larastan, Pint und der Typecheck, alles grün.
8. **Doku:** auf Englisch und Deutsch zu Setup, Betrieb, Konzepten, Tastatur, API, MCP und Webhooks.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele v1** (Vorgabe bzw. abgestimmt): Projekte, Workflows, Typen, Properties, Work Items mit Kommentaren, History, Labels, Relationen, Eltern/Kind, Anhängen, Vorlagen mit Zeitplan, Automatisierungen, Benachrichtigungen (In-App + Mail), Wiki, teamweite Views (Liste, Board, Tabelle, Timeline für Epics), Omni-Suche, Personen und Bots mit Rollen, REST-API, MCP, Webhooks, Live-Updates, Englisch und Deutsch.

**Nicht in v1** (abgestimmt, mit „Spec“ markierte Punkte neu):
- Cycles/Sprints, Modules
- Estimates (lassen sich als Number-Property abbilden)
- Intake/Triage, Zeiterfassung, Kalender
- Gantt für andere Items als Epics, Abhängigkeitspfeile in der Timeline (Spec)
- Import aus Plane/Jira; Export nur über die API
- SSO und OAuth, auch für MCP-Connectors
- Live-Kollaboration im Editor
- eigene Rollen; mehrere Organisationen pro Instanz
- eine Gast-Rolle für Externe; Externe bekommen normale Konten (Vorgabe)
- native Apps; Antworten per Mail
- öffentliche Freigaben von Projekten oder Seiten
- Integrationen mit Slack, GitHub o. Ä. (dafür gibt es Webhooks)
- Items zwischen Projekten verschieben (Spec)
- Vorlagen mit Unteraufgaben (Spec)
- ODER-Gruppen in Filtern (Spec)
- Oberfläche für ein Audit-Log; die Events werden aber gespeichert (Spec)
- Kommentare auf Wiki-Seiten (Spec)
- anpassbare Tastaturkürzel (Spec)

**Anti-Ziele.** Daran wäre v1 gescheitert, auch wenn technisch alles funktioniert:
- **Überladene Oberfläche:** Im Alltag stehen Einstellungen herum, die man selten braucht, oder es gibt Funktionen, die nur mit der Maus gehen.
- **Gefühlt langsam:** Nach Klicks wird gewartet, alltägliche Änderungen zeigen Spinner, Listen ruckeln.
- **API und MCP hinken hinterher:** Was die UI kann, müssen auch REST und MCP können.
- **Kompliziertes Self-Hosting:** Mehr als Compose-Datei plus `.env` ist nötig, oder der Proxy braucht außer WebSocket-Support noch eigene Konfiguration.
- **Stiller Datenverlust:** Beschreibungen oder Seiten werden ohne Warnung überschrieben, die History hat Lücken, Webhooks gehen verloren.
- **Datenlecks über Projektgrenzen:** Suche, Views, Anhänge, Relationen, Webhooks oder MCP zeigen etwas, das man nicht sehen darf.
- **Doppelte Logik in UI, REST und MCP.**

## 3. Entscheidungen

| Thema | Entscheidung | Herkunft |
|---|---|---|
| Repo | `baeroe/werkbuch`, Laravel im Repo-Root, `docs/` (VitePress, Specs, Pläne, History), `prototypes/` (Moodboards, Klickdummy), `e2e/` (Playwright, eigenes pnpm-Projekt) | Spec, Aufbau wie openbill |
| Stack | PHP 8.4, Laravel 13, Inertia v3, React 19, TypeScript, Tailwind 4, Vite | Vorgabe |
| UI | eigene Komponenten auf Base UI (headless), kein shadcn; sympathisch, schnell, modern, gern glassy; simpel und mit der Tastatur steuerbar | Vorgabe |
| Daten im Frontend | Inertia für Seiten und Seitenkontext; Daten über TanStack Query aus `/api/v1` (die UI nutzt dieselbe API); Zustand für lokalen UI-State | Spec |
| Rechte | spatie/laravel-permission, feste Rollen in Organisation und Projekt | Vorgabe + abgestimmt |
| Geschäftslogik | lorisleiva/laravel-actions: jeder Anwendungsfall ist eine Action; UI, REST, MCP, Automatisierungen und Commands rufen dieselben Actions | Vorgabe |
| Events | Jede Action schreibt Events in ihrer Transaktion (Outbox); nach dem Commit entstehen daraus History, Benachrichtigungen, Webhooks, Suchindex, Live-Updates und Automatisierungen | Vorgabe + abgestimmt, Outbox: Spec |
| Queue | Laravel Queue mit Datenbank-Treiber, eigener Worker-Container; Scheduler als eigener Container; kein Redis | abgestimmt |
| Live-Updates | Laravel Reverb, über denselben Port wie die App | abgestimmt |
| Suche | Meilisearch über Laravel Scout | Vorgabe |
| Datenbank | MariaDB 11.4 | abgestimmt |
| IDs | ULIDs; Items zusätzlich mit Key `WEB-123` | abgestimmt |
| Editor | Tiptap v3; gespeichert als Tiptap-JSON; REST und MCP verstehen zusätzlich Markdown | abgestimmt |
| Anhänge | eigene Tabelle `attachments` + spatie/laravel-medialibrary | abgestimmt |
| REST | eigene Laravel-Routen unter `/api/v1`, spatie/laravel-query-builder, Cursor-Pagination, OpenAPI per Scramble, Fehler als Problem Details | abgestimmt |
| MCP | laravel/mcp unter `/mcp`, Sanctum-Token; Tools pro Ressource mit `action`-Parameter, je ein Lese- und ein Schreib-Tool | abgestimmt, Trennung Lesen/Schreiben: Spec |
| Webhooks | spatie/laravel-webhook-server, HMAC-Signatur, Retries, Zustellprotokoll, Schutz vor internen Zielen | abgestimmt |
| Auth | Session für die UI über Laravel Fortify (Login, Passwort vergessen, optionale TOTP-2FA); Sanctum-Tokens für API und MCP | abgestimmt, Fortify: Spec |
| Sprachen | UI, Mails und Doku auf Englisch und Deutsch, Texte nur über Schlüssel; Sprache aus dem Profil, URLs ohne Sprachpräfix | Spec |
| Lokal | DDEV mit MariaDB, Meilisearch, Mailpit, Reverb, Queue-Worker, Scheduler, Vite mit HMR | Vorgabe |
| Tests | Pest mit 100 % Zeilenabdeckung im PHP-Code; Vitest und Playwright, Frontend-Abdeckung zusammengerechnet 100 %; Larastan, Pint | Vorgabe + abgestimmt |
| Betrieb | Docker-Image `baeroe/werkbuch` (amd64 und arm64), Compose und Standalone-Compose, Port 7740 | Vorgabe + abgestimmt |
| Doku | VitePress (en/de) auf GitHub Pages | Vorgabe |
| Pakete | pnpm (nie npm/npx), Composer; PHP und JS nur im DDEV-Container | Vorgabe (CLAUDE.md) |
| Lizenz | MIT | Vorgabe (CLAUDE.md) |

## 4. Fachkonzept

### 4.1 Organisation

Es gibt genau eine Organisation pro Instanz. Ihre Einstellungen ändern nur Org-Admins:
- Name und Logo (Vorgabe)
- Standardsprache: gilt für neue Konten und für Mails an Konten ohne eigene Einstellung (Spec)
- Zeitzone: gilt für Zeitpläne und tägliche Jobs (Spec)
- Wochenbeginn, Montag oder Sonntag: gilt für Filter wie „diese Woche“ (Spec)

### 4.2 Personen und Bots

Ein Konto ist eine **Person** oder ein **Bot** (Vorgabe). Alle Konten haben gemeinsam: Name, ein eindeutiges Kürzel (`handle`: a–z, 0–9 und `-`, 3–32 Zeichen, gebraucht für Erwähnungen), Avatar, Org-Rolle und den Status deaktiviert ja/nein.

**Person:**
- E-Mail (eindeutig), Passwort, Sprache, Zeitzone (Standard: die der Organisation)
- optional 2FA per Authenticator-App (TOTP) mit Recovery-Codes (abgestimmt)
- eigene Benachrichtigungseinstellungen

**Bot:**
- Beschreibung, verantwortliche Person, kein Login, nur Tokens
- kann Projektmitglied sein, Items zugewiesen bekommen und erwähnt werden
- bekommt keine Benachrichtigungen; stattdessen lösen Erwähnung und Zuweisung die Webhook-Ereignisse `bot.mentioned` und `bot.assigned` aus (abgestimmt)

**Standard-Bot** (Vorgabe: Es gibt immer einen Bot, Automatisierungen handeln als dieser Bot):
- wird von einer Migration angelegt (Name „Automation“, Kürzel `automation`)
- lässt sich umbenennen und mit Avatar versehen, aber weder löschen noch deaktivieren
- Automatisierungen und Vorlagen-Zeitpläne handeln als dieser Bot
- hat die Org-Rolle Admin, damit Automatisierungen in jedem Projekt handeln dürfen (Spec)
- erscheint in Auswahllisten für Zuweisung und Erwähnung nur, wenn er ausdrücklich Projektmitglied ist (Spec)
- Admins können für ihn Tokens anlegen; die UI warnt, dass diese Admin-Rechte haben (Spec)

**Konten verwalten:**
- **Einladung:** Ein Admin lädt per E-Mail ein und vergibt dabei die Org-Rolle, optional gleich Projekte mit Projektrolle. Der Link ist 7 Tage gültig, eine neue Einladung ersetzt die alte. Ohne Mailserver lässt sich der Link kopieren (Spec, wie openbill).
- **„Passwort vergessen“** läuft per Mail. Für den Notfall gibt es das Kommando `app:reset-password` (wie openbill).
- **Login-Drosselung wie openbill:** 5 Fehlversuche je E-Mail und IP sperren für 60 s.
- **Deaktivieren statt löschen** (abgestimmt): Tokens und Sitzungen werden widerrufen. Das Konto bleibt in History, Kommentaren und als Ersteller sichtbar und ist als „deaktiviert“ markiert. Bestehende Zuweisungen bleiben, bis jemand sie ändert. Ein deaktiviertes Konto lässt sich wieder aktivieren.
- **Erstes Konto:** wird beim Start aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` angelegt (`app:ensure-admin`, wie openbill).

**Tokens** (Sanctum, abgestimmt):
- Name, Fähigkeiten `read`, `write` und `mcp`, optional ein Ablaufdatum, „zuletzt benutzt“
- der Klartext wird nur einmal angezeigt
- Personen verwalten ihre eigenen Tokens, Admins die Tokens der Bots
- ein Token handelt immer mit den Rechten seines Kontos

### 4.3 Rollen und Rechte

Die Rollen sind fest (abgestimmt). Umgesetzt mit spatie/laravel-permission und der Teams-Funktion:
- Die Rechte sind eine feste Liste im Code, die Rollen werden per Migration synchronisiert.
- Geprüft wird in Policies, die die Actions aufrufen.
- Eigene Rollen lassen sich später nachrüsten.

**Organisation** (Admin, Member). Eine Gast-Rolle gibt es nicht, Externe bekommen normale Konten (Vorgabe).

| Recht | Admin | Member |
|---|---|---|
| Organisation, Personen, Bots, Webhooks verwalten | ✓ | – |
| Workflows, Typen, Properties, Labels, Relationstypen, Resolutions verwalten | ✓ | – |
| alle Projekte sehen und verwalten, auch private | ✓ | – |
| öffentliche Projekte sehen und beitreten | ✓ | ✓ |
| Projekte anlegen | ✓ | ✓ |
| Views anlegen | ✓ | ✓ |
| fremde Views ändern und löschen | ✓ | – |
| eigene Tokens | ✓ | ✓ |

**Projekt** (Admin, Member, Viewer):

| Recht | Admin | Member | Viewer |
|---|---|---|---|
| Items, Wiki und Vorlagen lesen | ✓ | ✓ | ✓ |
| kommentieren, reagieren, beobachten | ✓ | ✓ | ✓ |
| Items anlegen, ändern, archivieren | ✓ | ✓ | – |
| Wiki bearbeiten, Vorlagen und Zeitpläne verwalten | ✓ | ✓ | – |
| Items löschen | ✓ | – | – |
| Projekteinstellungen, Mitglieder, Workflow, Typen, Automatisierungen | ✓ | – | – |
| Projekt archivieren und löschen | ✓ | – | – |

**Regeln:**
- **Org-Admins** haben in jedem Projekt Admin-Rechte, ohne Mitglied sein zu müssen (Spec).
- **Sichtbarkeit** (abgestimmt): Öffentliche Projekte sehen alle Org-Member, private nur Mitglieder und Org-Admins. Ein Org-Member, der kein Mitglied ist, hat in öffentlichen Projekten Viewer-Rechte und tritt mit einem Klick als Member bei (Spec).
- **Project Lead** (abgestimmt): muss Mitglied sein, bekommt alle Benachrichtigungen des Projekts und hat keine zusätzlichen Rechte.
- **Letzter Admin:** Der letzte aktive Org-Admin unter den Personen lässt sich weder herabstufen noch deaktivieren. Der Standard-Bot zählt dabei nicht.

### 4.4 Projekte

**Felder:**
- Name, Beschreibung (Klartext, bis 2000 Zeichen), Bild (Vorgabe); ohne Bild gibt es eine Farbe mit Initialen
- Project Lead (Vorgabe)
- Kennung: 2–10 Großbuchstaben oder Ziffern, beginnt mit einem Buchstaben, eindeutig. Sie lässt sich ändern; alte Kennungen lösen danach weiter auf, `OLD-12` leitet also auf `NEW-12` um (Spec).
- Sichtbarkeit, öffentlich oder privat
- Workflow; Standard ist der Standard-Workflow (Vorgabe)
- aktivierte Typen (mindestens einer) und davon ein Standardtyp
- Einstellungen der Automatisierungen

**Weitere Regeln:**
- Die Item-Nummern laufen pro Projekt hoch und werden nie wieder vergeben.
- **Archivieren:** Das Projekt wird schreibgeschützt und aus Navigation und Views ausgeblendet; es lässt sich wiederherstellen.
- **Löschen:** nur Admins, bestätigt durch Eintippen der Kennung. Es läuft als Job und entfernt alles, auch die Anhänge.
- **Favoriten:** Jede Person kann Projekte und Views als Favoriten in die Seitenleiste legen (Spec).

### 4.5 Workflows

Workflows liegen zentral in der Organisation (abgestimmt). Einer davon ist der **Standard-Workflow**. Er wird jedem neuen Projekt zugewiesen, und ein Projekt kann einen anderen wählen (Vorgabe).

**Status:**
- Ein Status hat Name, Farbe, Reihenfolge und eine von fünf Kategorien: `backlog`, `unstarted`, `started`, `completed`, `canceled` (abgestimmt). Die Kategorien geben dem Status Bedeutung: offen oder geschlossen, Auto-Archiv, Fortschritt, Resolution, Filter.
- Jeder Workflow hat genau einen **Startstatus** und mindestens einen Status der Kategorie Completed. Jeder Status muss vom Startstatus aus erreichbar sein; das wird beim Speichern geprüft (Spec).
- Der Standard-Workflow hat die Status Backlog (Backlog), Todo (Unstarted), In Progress und Pending (beide Started), Done (Completed) und Cancelled (Canceled) (abgestimmt).

**Übergänge** (abgestimmt):
- Ein Workflow ist entweder frei, dann sind alle Übergänge erlaubt, oder er hat eine Übergangsmatrix mit den erlaubten Paaren (von → nach). Der Standard-Workflow ist frei.
- Die Regel gilt überall gleich: UI, REST, MCP, Automatisierungen, Vorlagen.
- Ein abgelehnter Übergang liefert in der API 409 mit `reason: transition_not_allowed`. Im Board sind beim Ziehen die Spalten gedimmt, die nicht erlaubt sind.

**Anlegen:**
- Neue Items starten im Startstatus.
- Wer ein Item direkt in einem anderen Status anlegt, etwa per Schnellanlage in einer Board-Spalte, durchläuft dieselbe Prüfung wie ein Übergang vom Startstatus dorthin (Spec).

**Änderungen an benutzten Workflows:**
- Status und Übergänge hinzufügen wirkt sofort.
- Wird ein Status gelöscht, der noch Items hat, oder wechselt ein Projekt den Workflow, ordnet man in einem Dialog jedem betroffenen Status einen neuen zu. Das Umschreiben läuft als Job, bewusst ohne Übergangsregeln. In der History steht es mit der Person, die es ausgelöst hat (abgestimmt).
- Ein Workflow lässt sich nur löschen, wenn kein Projekt ihn nutzt. Der Standard-Workflow lässt sich nie löschen.

### 4.6 Work-Item-Typen

Typen liegen zentral in der Organisation, Projekte aktivieren daraus eine Auswahl (abgestimmt). Mitgeliefert werden Task, Bug und Epic; weitere kann man anlegen (Vorgabe).

**Felder eines Typs** (abgestimmt):
- Name, Icon (aus Lucide), Farbe, Beschreibung
- Häkchen „Epic“: Items dieser Typen erscheinen in der Timeline
- zugeordnete Properties, je mit Pflicht ja/nein und Reihenfolge

**Typ wechseln:**
- Werte von Properties, die der neue Typ nicht hat, gehen verloren. Vorher zeigt die UI einen Hinweis, und die alten Werte bleiben in der History (abgestimmt).
- Pflicht-Properties des neuen Typs ohne Wert müssen im Wechseldialog gefüllt werden. Die API antwortet sonst mit 422 und nennt die fehlenden Felder (Spec).

**Löschen:** Ein benutzter Typ wird archiviert statt gelöscht. Es lassen sich dann keine neuen Items dieses Typs anlegen.

### 4.7 Properties

Properties liegen zentral in der Organisation und werden Typen zugeordnet (abgestimmt).

**Definition:**
- Label, Hilfetext, Standardwert
- Schlüssel (`snake_case`): eindeutig, unveränderlich, darf keinem Kernfeld gleichen, gebraucht für API und MCP
- Feldtyp: unveränderlich; nur der Wechsel von Einfach- auf Mehrfachauswahl ist erlaubt (Spec)

| Feldtyp | Wert | Einstellungen |
|---|---|---|
| Text | einzeilig, bis 255 Zeichen | – |
| Number | Dezimalzahl | 0–4 Nachkommastellen |
| Dropdown | eine oder mehrere Optionen | Mehrfachauswahl; Optionen mit Label, Farbe, Reihenfolge; benutzte Optionen werden archiviert statt gelöscht |
| Boolean | ja/nein | – |
| Date | Datum ohne Uhrzeit | – |
| Member picker | Personen oder Bots mit Zugriff auf das Projekt | Mehrfachauswahl |
| Rich text | Tiptap-JSON, derselbe Editor | – |
| URL | Adresse mit http(s) | – |

**Kernfelder:** Titel, Beschreibung, Resolution, Status, Assignee, Priorität, Labels, Start-Date, Due-Date und Eltern-Item. Sie gehören fest zu jedem Item und lassen sich nicht löschen.

**Pflicht** (Spec): Ein Pflichtwert ist beim Anlegen nötig und lässt sich danach nicht leeren. Wird eine Property nachträglich zur Pflicht, bleiben bestehende Items ohne Wert gültig und zeigen einen Hinweis.

**Löschen:** Eine Property lässt sich mit Bestätigung löschen; die UI nennt die Zahl der betroffenen Items. Die Werte verschwinden, die History behält sie.

**Speicherung:** Die Werte liegen typisiert in einer eigenen Tabelle mit einer Spalte je Werttyp, damit Views nach ihnen filtern und sortieren können (Spec; Details entscheidet der Builder).

**Resolution** (abgestimmt):
- eine pflegbare Liste mit Label, Reihenfolge und „Standard für Completed“ bzw. „Standard für Canceled“; einzelne Werte lassen sich archivieren
- mitgeliefert: Done (Standard für Completed), Won't do (Standard für Canceled), Duplicate, Cannot reproduce
- Beim Wechsel in einen Status der Kategorie Completed oder Canceled wird die Resolution gesetzt: auswählbar, sonst der Standard der Kategorie.
- Beim Wechsel zurück nach Backlog, Unstarted oder Started wird sie geleert.

### 4.8 Work Items

**Felder:**
- Key (`WEB-123`), Typ, Titel (Pflicht, bis 255 Zeichen), Beschreibung (Rich Text)
- Status, Resolution
- genau ein Assignee oder keiner; muss Zugriff auf das Projekt haben
- Priorität: Urgent, High, Medium, Low, None (Standard None)
- Labels
- Start-Date und Due-Date; das Start-Date liegt nicht nach dem Due-Date
- Eltern-Item, Relationen, Anhänge und die Properties des Typs
- Ersteller (Person oder Bot), angelegt am, geändert am, gestartet am (erster Eintritt in Started), geschlossen am (Eintritt in Completed oder Canceled, wird beim Wiederöffnen geleert), archiviert am
- Rang für die manuelle Reihenfolge

**Eltern und Kinder** (abgestimmt):
- Zwei Ebenen (Vorgabe, 2026-10-29): Nur Items eines Typs mit Häkchen „Epic“ haben Kind-Items, und Epics haben selbst kein Eltern-Item. Das Eltern-Item liegt im selben Projekt (Spec).
- Ein Typwechsel und das Häkchen „Epic“ in den Einstellungen werden abgelehnt, wenn bestehende Items die Regel sonst brechen würden; die Meldung nennt den Grund.
- Neue Kind-Items starten im Startstatus des Workflows; in gruppierten Listen stehen Kinder in ihrer eigenen Gruppe.
- Items mit Kindern zeigen den Fortschritt der Kinder: geschlossene von allen.

**Archivieren und Löschen** (abgestimmt):
- Archivieren geht nur bei geschlossenen Items. Archivierte Items sind schreibgeschützt und aus Views ausgeblendet, außer der Filter „archiviert“ ist gesetzt. Man kann sie wiederherstellen.
- Löschen ist endgültig und bekommt ein paar Sekunden Rückgängig; der DELETE geht erst nach Ablauf raus, wie in openbill.
- Beim Löschen verschwinden Kommentare, Anhänge, Werte und Relationen; Kinder werden zu Items ohne Eltern.

**Mehrfachbearbeitung** (Spec): Mehrere Items auswählen und gemeinsam Status, Assignee, Priorität, Labels oder Archiv ändern. Für jedes Item gelten seine Übergangsregeln. Was abgelehnt wurde, nennt ein Toast.

**Ansichten eines Items:** als Seitenpanel (Vorschau) und als eigene Seite, die über den Key adressierbar ist.

**Gleichzeitige Änderungen:**
- Einzelne Felder (Status, Assignee …) überschreiben sich zuletzt-gewinnt, die History zeigt beide Stände.
- Für die **Beschreibung** gilt dieselbe Konfliktwarnung wie bei Wiki-Seiten (4.15) (Spec).

### 4.9 Relationen

**Relationstypen** liegen zentral in der Organisation (abgestimmt):
- Ein Typ hat einen Namen und für jede Richtung eine Beschriftung, etwa „blockiert“ und „wird blockiert von“, oder er ist symmetrisch („verwandt mit“).
- Mitgeliefert werden blockiert, Duplikat und verwandt. Diese drei lassen sich nicht löschen; eigene Typen schon (Vorgabe: Relationen frei anlegbar).

**Regeln:**
- Relationen gehen zwischen beliebigen Items, auch über Projektgrenzen.
- Ausgeschlossen sind Relationen eines Items mit sich selbst und dasselbe Paar mit demselben Typ ein zweites Mal.
- Ein Item, das man nicht sehen darf, erscheint als „verborgenes Item“, ohne Titel.

**Bedeutung:** Nur „blockiert“ löst im System etwas aus. Solange der Blocker offen ist, zeigt das blockierte Item einen Hinweis, auch beim Start; erzwungen wird nichts. Eigene Typen sind reine Beschriftung.

### 4.10 Kommentare, History, Beobachten

**Kommentare** (abgestimmt):
- Rich Text mit Erwähnungen, Verweisen, Bildern und Dateien
- eigene Kommentare kann man bearbeiten (mit Hinweis „bearbeitet“; die alte Fassung steht in der History) und löschen; Projekt-Admins können alle löschen, die History vermerkt das Löschen
- Emoji-Reaktionen: jedes Emoji, je Person einmal pro Emoji
- keine Threads (Spec)

**History** (abgestimmt):
- Sie zeigt Wer, Wann und Alt → Neu für alle Felder, auch für Properties, Relationen, Anhänge, Typwechsel und Archiv.
- Sie stammt aus den Events (7.2) und steht in einer Zeitleiste zusammen mit den Kommentaren. Filter: alles, Kommentare, Änderungen.
- Mehrere Änderungen derselben Person innerhalb weniger Minuten fasst die Anzeige zusammen (Spec).

**Beobachten:**
- Automatisch beobachten Ersteller, Assignee und Erwähnte (abgestimmt) sowie wer kommentiert (Spec).
- Von Hand lässt sich das Beobachten an- und ausschalten.
- Wer sich abgemeldet hat, wird nur durch eine neue Erwähnung oder Zuweisung wieder angemeldet (Spec).

### 4.11 Views

**Was eine View ist** (abgestimmt):
- Eine View gehört dem ganzen Team und gilt projektübergreifend; das Projekt ist ein Filter wie jeder andere.
- Jede Person sieht in einer View nur Items aus Projekten, die sie sehen darf.

**Rechte:** Anlegen dürfen Org-Admins und -Member. Ändern und löschen dürfen der Ersteller und Org-Admins. Alle können eine View als neue View speichern (Spec).

**Bestandteile:** Name, Icon/Emoji, Filter und Darstellung:
- **Layout:** Liste, Board, Tabelle oder Timeline
- **Gruppierung:** Status, Kategorie, Assignee, Priorität, Typ, Label, Projekt, Eltern-Item oder keine
- **Sortierung:** manuell (Rang), Priorität, Due-Date, Start-Date, angelegt, geändert, Key oder eine Property vom Typ Number, Date oder Text
- **Angezeigte Felder bzw. Spalten**, einschließlich Properties
- Kind-Items zeigen ja/nein

**Status über mehrere Workflows** (Spec): Eine Gruppierung nach Status geht nur, wenn alle Items der View denselben Workflow haben. Sonst wird nach Kategorie gruppiert. Wer im Board in eine Kategorie-Spalte zieht, setzt den ersten Status dieser Kategorie im Workflow des Items, zu dem der Übergang erlaubt ist; gibt es keinen, folgt ein Toast.

**Filter** (Spec für die Details):
- Die Bedingungen werden mit UND verknüpft. Innerhalb eines Feldes ist „eines von“ möglich.
- Felder: Projekt, Typ, Status, Kategorie, Assignee, Ersteller, Priorität, Label, Start-Date, Due-Date, angelegt, geändert, geschlossen, Eltern-Item, hat Kinder, blockiert bzw. blockiert andere, archiviert, Titel enthält, alle Properties mit Operatoren passend zum Feldtyp.
- Operatoren: ist, ist nicht, eines von, keines von, leer, nicht leer, vor, nach, zwischen, enthält, größer, kleiner.
- Dynamische Werte: `me`, `today`, relative Daten (±N Tage oder Wochen), „diese Woche“, „dieser Monat“, „überfällig“.
- Der Filter ist JSON mit einer Versionsnummer, überall dasselbe Format (UI, REST, MCP). Er wird von **einer** Filter-Engine ausgewertet. Skizze:

```json
{ "version": 1, "conditions": [
  { "field": "project", "op": "in", "value": ["<ulid>"] },
  { "field": "state_category", "op": "in", "value": ["unstarted", "started"] },
  { "field": "assignee", "op": "in", "value": ["me"] },
  { "field": "due_date", "op": "before", "value": { "relative": "+7d" } },
  { "field": "property:customer", "op": "in", "value": ["<option-ulid>"] }
] }
```

**Ad-hoc und fest eingebaut:**
- Jede Item-Liste hat eine Filterleiste. Abweichungen von einer gespeicherten View gelten als „ungespeichert“; man kann sie speichern, als neue View speichern oder verwerfen. Der Stand steckt in der URL, Links lassen sich also teilen (Spec).
- Fest eingebaut, nicht löschbar (Spec):
  - „Meine Items“: mir zugewiesen und offen
  - „Von mir erstellt“
  - „Beobachtet“
  - die Item-Liste eines Projekts, die nichts anderes ist als eine ungespeicherte View mit Projektfilter

**Layouts:**
- **Liste:** gruppiert, Gruppen einklappbar, Felder als Chips, Kind-Items eingerückt.
- **Board:**
  - Spalten sind die Gruppen
  - Ziehen ändert das gruppierte Feld: Status (mit Prüfung der Übergänge), Priorität oder Assignee
  - nach Label gruppierte Boards sind nicht ziehbar
  - die Reihenfolge innerhalb einer Spalte folgt dem Rang
  - Schnellanlage oben in jeder Spalte
  - Karten von Kind-Items zeigen ihr Epic vor dem Key, außer das Board ist nach Eltern-Item gruppiert (Vorgabe, 2026-10-29)
- **Tabelle:** Inline-Bearbeitung mit der Tastatur (Pfeile, Enter, Esc), Spaltenauswahl einschließlich Properties, fester Kopf und feste erste Spalte.
- **Timeline** (Vorgabe: Gantt nur für Epics):
  - zeigt nur Items von Typen mit Häkchen „Epic“, gruppiert nach Projekt
  - Balken vom Start- bis zum Due-Date, Fortschritt aus den Kind-Items
  - Ziehen oder Ziehen an den Kanten ändert die Daten; per Tastatur verschieben die Pfeiltasten am ausgewählten Epic um eine Einheit
  - Epics ohne Daten stehen in einer Seitenliste und lassen sich auf die Zeitachse ziehen
  - Zoom: Woche, Monat, Quartal; eine Linie markiert heute

**Leistung:** Filtern, Sortieren und Paginieren macht der Server, mit Anzahl je Gruppe. Lange Listen und Tabellen sind virtualisiert.

### 4.12 Vorlagen und Recurring

Eine **Vorlage** gehört zu einem Projekt (abgestimmt). Sie legt fest:
- Name, Typ
- Titel mit Platzhaltern `{date}`, `{week}`, `{month}`, `{month_name}`, `{quarter}`, `{year}` (Spec); `{month_name}` folgt der Sprache der Organisation
- Beschreibung; Anhänge werden beim Anwenden kopiert
- Priorität, Assignee, Labels, Werte der Properties, optional ein Eltern-Item
- Start- und Due-Date relativ zum Anlegen, in Tagen

**Von Hand** wendet man eine Vorlage im Anlegen-Dialog oder in der Befehlspalette an.

**Zeitplan** (optional, abgestimmt):

| Frequenz | Einstellungen |
|---|---|
| täglich | alle N Tage |
| wöchentlich | alle N Wochen, an gewählten Wochentagen |
| monatlich | alle N Monate, an einem Tag des Monats (1–31 oder „letzter“) oder einem n-ten Wochentag wie „erster Montag“ (Spec) |
| jährlich | alle N Jahre, an einem Datum |

- Für alle Frequenzen gelten: Uhrzeit in der Zeitzone der Organisation, Beginn und Ende (nie, an einem Datum oder nach N Läufen).
- Ein Zeitplan lässt sich pausieren. Die UI zeigt die nächsten 5 Termine.

**Ausführung:**
- Der Scheduler prüft jede Minute die fälligen Vorlagen. Ein Job legt das Item als Standard-Bot an und vermerkt „aus Vorlage …“.
- Jeder Termin wird mit Vorlage und Termin eindeutig protokolliert. Doppelte Items sind dadurch ausgeschlossen, auch bei parallelen Läufen.
- Sind mehrere Termine verpasst, wird genau der letzte einmal nachgeholt (abgestimmt). Danach geht es mit dem nächsten Termin in der Zukunft weiter.

**Fehler** (Spec): Ist die Vorlage zur Laufzeit ungültig, etwa weil der Assignee kein Mitglied mehr ist, ein Typ deaktiviert wurde oder eine neue Pflicht-Property fehlt, schlägt der Lauf fehl. Er wird protokolliert, und Project Lead und Ersteller der Vorlage werden benachrichtigt. Die Vorlage bleibt aktiv.

### 4.13 Automatisierungen

Automatisierungen sind pro Projekt schaltbar, mit Parametern. Sie handeln als Standard-Bot, halten sich an die erlaubten Übergänge und stehen in der History mit Grund, etwa „Automatisierung: Auto-Archiv“ (Vorgabe + abgestimmt). Neu angelegt sind alle aus (Spec).

| Automatisierung | Verhalten |
|---|---|
| Auto-Archiv | archiviert Items, die seit N Tagen geschlossen sind; täglicher Job |
| Auto-Close | setzt Items in Backlog oder Unstarted (Spec), die seit N Tagen nicht geändert wurden, auf einen gewählten Canceled-Status und schreibt einen Bot-Kommentar dazu; ist der Übergang nicht erlaubt, wird das Item übersprungen; täglicher Job |
| Eltern schließen | sind alle Kinder geschlossen und mindestens eines davon Completed, geht das Eltern-Item in den ersten Completed-Status, zu dem der Übergang erlaubt ist; wirkt nach oben weiter, mit Begrenzung gegen Schleifen |
| Assignee beim Start | startet eine Person ein Item ohne Assignee, wird sie Assignee; Bots lösen das nicht aus |

### 4.14 Benachrichtigungen

**Wer benachrichtigt wird** (abgestimmt):
- alle Beobachter (4.10)
- der Project Lead bei jedem Ereignis des Projekts
- nie die Person, die die Änderung selbst ausgelöst hat; nie Bots, deaktivierte Konten oder Konten ohne Zugriff

**Ereignisse:**
- zugewiesen, erwähnt (Beschreibung oder Kommentar), neuer Kommentar, Statuswechsel
- sonstige Änderungen: Titel, Beschreibung, Priorität, Daten, Labels, Properties, Typ, Eltern-Item, Relationen, Anhänge
- fällig bzw. überfällig (eigene zugewiesene Items, täglich um 08:00 in der Zeitzone der Person) (Spec)
- neues Item im Projekt (nur Lead)
- fehlgeschlagene Vorlage (4.12)
- abgeschalteter Webhook (nur Org-Admins)

**Kanäle** (abgestimmt): Inbox in der App und Mail, einstellbar pro Person und Ereignis.
- Die Inbox ist standardmäßig für alle Ereignisse an.
- Mails sind standardmäßig an für: zugewiesen, erwähnt, Kommentar, fällig. Aus für: sonstige Änderungen (Spec).

**Inbox:**
- gruppiert nach Item, gelesen/ungelesen, alle als gelesen markieren, löschen, Filter „ungelesen“ und „Erwähnungen“
- Öffnen markiert als gelesen; „Als ungelesen markieren“ führt zurück (Vorgabe, 2026-10-29)
- das Badge aktualisiert sich live
- kein Snooze (Spec)

**Mail** (abgestimmt):
- Ereignisse werden pro Person und Item 5 Minuten gesammelt und dann als eine Mail verschickt (Spec: 5 Minuten, per Env änderbar)
- Sprache der Person, Link zum Item, Link zu den Einstellungen im Fuß
- keine Anhänge, keine eingebetteten Bilder
- ohne konfigurierten Mailserver bleibt es bei der Inbox

**Aufräumen:** Gelesene Benachrichtigungen werden nach 90 Tagen gelöscht (Spec).

### 4.15 Wiki

Jedes Projekt hat einen Seitenbaum (abgestimmt). Eine Seite hat Titel, Emoji, Inhalt (voller Editor), Ersteller, letzte Bearbeitung und eine Position im Baum.

**Baum:**
- Seiten lassen sich per Drag & Drop umordnen; ohne Maus über den Dialog „Verschieben nach …“.
- Löschen fragt immer nach, mit und ohne Unterseiten, entfernt den ganzen Teilbaum und bleibt danach 5 Sekunden rückgängig (Vorgabe, 2026-10-29).

**Gleichzeitiges Bearbeiten** (abgestimmt: keine Live-Kollaboration):
- Die Seite speichert automatisch nach kurzer Pause und schickt dabei die Versionsnummer mit, auf der die Änderung beruht.
- Hat inzwischen jemand anderes gespeichert, lehnt der Server ab, und die UI zeigt „von X geändert“. Man kann dann neu laden oder die eigene Fassung übernehmen; in diesem Fall wird die fremde vorher als Version gesichert (Spec).

**Versionen:**
- Eine Version entsteht nach 10 Minuten Bearbeitungspause und vor jedem Überschreiben einer fremden Fassung (Spec).
- Die Versionsliste zeigt Autor und Zeit und erlaubt Ansehen und Wiederherstellen. Wiederherstellen erzeugt eine neue Version.

**Weitere Regeln:**
- Seiten sind durchsuchbar und können verlinkt werden (4.16).
- Rechte gelten wie im Projekt: Member bearbeiten, Viewer lesen.

### 4.16 Rich Text und Anhänge

**Editor: Tiptap v3** (abgestimmt). Tiptap ist headless, deshalb bauen wir die Oberfläche selbst. Es gibt einen Editor-Baustein mit Ausbaustufen:
- **Kommentar:** Text, Listen, Code, Links, Erwähnungen, Bilder
- **Beschreibung und Vorlage:** zusätzlich Überschriften, Checklisten, Tabellen
- **Wiki:** alles

Gemeinsam haben alle Stufen: `/`-Menü, Markdown-Kürzel beim Tippen, Code-Blöcke mit Syntax-Highlighting, Bilder und Dateien per Einfügen und Drag & Drop mit Fortschritt.

**Erwähnungen und Verweise** (Spec):
- `@` sucht Personen und Bots mit Zugriff auf das Projekt.
- `#` sucht Items und Wiki-Seiten, die man sehen darf.
- Auf Verweise, die der Leser nicht sehen darf, zeigt die UI nur „verborgen“.

**Format:**
- Gespeichert wird Tiptap-JSON (abgestimmt).
- Daraus erzeugt der Server Klartext für die Suche und HTML für Mails und liest beim Speichern die Erwähnungen und Anhänge aus. Benachrichtigt werden nur neu Erwähnte.
- HTML für Mails entsteht serverseitig aus dem JSON (ueberdosis/tiptap-php). Nutzer-HTML wird nie direkt ausgegeben.

**Markdown in REST und MCP** (abgestimmt, Schreibweise Spec):
- Lesen liefert beide Formen, etwa `description` (Markdown) und `description_json` (Tiptap-JSON). Schreiben akzeptiert eine der beiden. Dasselbe gilt für Kommentare, Seiten und Rich-Text-Properties.
- Konventionen:

| Was | Markdown |
|---|---|
| Erwähnung | `@handle` |
| Verweis auf ein Item | `WEB-123` |
| Verweis auf eine Seite | `[Titel](page:<ulid>)` |
| Bild | `![alt](attachment:<ulid>)` |
| Datei | `[datei.pdf](attachment:<ulid>)` |

- `@handle` ohne Zugriff auf das Projekt bleibt Text.
- Umwandlung über league/commonmark (GFM) und tiptap-php; zurück über tiptap-php und league/html-to-markdown, jeweils mit eigenen Knoten für Erwähnung, Verweis und Anhang.

**Anhänge** (abgestimmt):
- **Datenmodell:** Jede hochgeladene Datei ist ein Datensatz in `attachments` (Projekt, Uploader, Besitzer: Item, Kommentar, Seite oder Vorlage, Art: `inline` aus dem Editor oder `file` aus der Dateiliste des Items) mit genau einer Datei aus spatie/laravel-medialibrary.
- **Verweise:** Der Editor speichert nur die Attachment-ID, nie einen Pfad.
- **Auslieferung:** Eine Route prüft das Leserecht auf den Besitzer. Inline angezeigt werden nur sichere Bildformate (PNG, JPEG, GIF, WebP, AVIF); alles andere, auch SVG, kommt als Download mit `nosniff` und `CSP: sandbox` (Spec).
- **Ungespeicherte Items:** Uploads für ein noch nicht gespeichertes Item gehören zunächst niemandem und werden beim Speichern verknüpft. Was nach 24 Stunden noch keinen Besitzer hat, löscht ein Job.
- **Aus dem Text entfernte Bilder** bleiben erhalten, damit History und Rückgängig funktionieren. Aufräumen ist Sache des Betreibers: `app:prune-attachments` mit `--dry-run` und Mindestalter (Spec, wie `app:prune-images` in openbill). Dateien aus der Dateiliste löscht man dort, mit Rückgängig.
- **Größe und Vorschau:** höchstens `ATTACHMENTS_MAX_MB` pro Datei, Standard 25 (Spec). Vorschaubilder rechnet die Queue.
- **Weitere Bilder:** Logo, Avatare und Projektbilder laufen direkt über medialibrary.
- **Speicher:** lokal im Volume oder S3-kompatibel per Env.

### 4.17 Suche und Befehlspalette

**Index** (Meilisearch über Scout, Vorgabe):
- Items: Key, Titel, Klartext der Beschreibung und der Kommentare (Spec), Projekt, Typ, Kategorie, Assignee, Labels, archiviert
- Wiki-Seiten: Titel, Text
- Projekte, Personen und Bots
- Indexiert wird über die Queue. Die Index-Einstellungen synchronisiert der Container beim Start.

**Zugriff:** Jede Suche läuft serverseitig mit einem Filter auf die Projekte, die die Person sehen darf (abgestimmt). Der Browser spricht nie direkt mit Meilisearch.

**Befehlspalette** (⌘K bzw. Strg+K):
- eine Eingabe für Suche und Aktionen: Navigation, „neues Item“, „Status ändern“ am ausgewählten Item, Vorlage anwenden, Theme wechseln
- die Treffer sind nach Art gruppiert
- ein Key wie `WEB-123` springt direkt zum Item

## 5. Bedienung und Gestaltung

### 5.1 Grundsätze

- **Simpel** (Vorgabe): wenige Ebenen; Einstellungen getrennt vom Alltag; gute Standardwerte statt Optionen.
- **Tastatur zuerst** (Vorgabe): Jede Aktion ist per Tastatur erreichbar. Kürzel stehen in Menüs und Tooltips, `?` zeigt alle. Die Kürzel haben eine Quelle im Code, aus der auch Hilfe-Overlay und Doku entstehen.
- **Schnell** (Vorgabe):
  - Änderungen erscheinen sofort (optimistisch); Fehler werden mit Toast zurückgerollt.
  - Live-Updates statt Neuladen; lange Listen sind virtualisiert.
  - Zielwert (Spec): sichtbare Rückmeldung unter 100 ms; gecachte Seiten wechseln ohne Ladezustand.
- **Rückgängig statt Rückfrage:** Löschen und Archivieren zeigen 5 Sekunden einen Toast mit Rückgängig. Bestätigungsdialoge gibt es nur bei großen Folgen, etwa Projekt löschen, Workflow wechseln oder eine Wiki-Seite löschen.
- **Hell und Dunkel** nach System, umschaltbar.
- **Barrierefreiheit:** WCAG 2.2 AA mit Kontrasten, Fokusführung und Ansagen für Screenreader. Wie bei openbill geht Barrierefreiheit vor Gestaltung.
- **Responsiv:** Am Desktop ist alles möglich. Am Handy (390 px) kann man lesen, kommentieren und Status oder Assignee ändern.

### 5.2 Aufbau

- **Seitenleiste:** Inbox, Meine Items, Views (Favoriten, „Alle Views“), Projekte (Favoriten, „Alle Projekte“). Ein Projekt hat die Bereiche Items, Wiki, Vorlagen und Einstellungen. Dazu Einstellungen und Profil.
- **Item-Listen:** Filterleiste, Anzeigeoptionen, Layoutwechsel.
- **Item-Detail:** als Seitenpanel (Vorschau) und als eigene Seite; die URL läuft über den Key.
- **Anlegen-Dialog** (C): Projekt, Typ, Titel, Beschreibung, Properties, Vorlage. Mit „weitere anlegen“ legt man mehrere nacheinander an.
- **Wiki:** Baum links, Seite rechts.
- **Einstellungen:**
  - Organisation: Allgemein, Personen, Bots, Workflows (Editor mit Übergangsmatrix), Typen, Properties, Labels, Relationstypen, Resolutions, Webhooks, System
  - Projekt: Allgemein, Mitglieder, Workflow, Typen, Automatisierungen
  - Persönlich: Profil, Sicherheit, Benachrichtigungen, API & MCP (Tokens und Einrichtungs-Snippets für Claude Code und Codex wie in openbill)
- **System** (Spec, nur Admins): Version, Rückstand der Queue, fehlgeschlagene Jobs mit „erneut versuchen“, Status von Meilisearch, Testmail.

### 5.3 Tastaturkürzel (Startsatz, wird im Klickdummy verfeinert)

| Kürzel | Aktion |
|---|---|
| ⌘K / Strg+K | Befehlspalette und Suche |
| `/` | Filter bzw. Suche im aktuellen Kontext |
| `?` | alle Kürzel |
| C | neues Item |
| G, dann I / M / V / P | Inbox / Meine Items / Views / Projekte |
| J/K oder ↓/↑ | nächstes / voriges Item |
| Enter / Leertaste | Item öffnen / Vorschau |
| Esc | schließen, Auswahl aufheben |
| X (⇧ für Bereiche) | Item auswählen |
| S / A / I / P / L / T | Status / Assignee / mir zuweisen / Priorität / Labels / Typ |
| D / ⇧D | Due-Date / Start-Date |
| ⇧P / R | Eltern-Item / Relation |
| E / M | Titel bearbeiten / Kommentar schreiben |
| ⌘⏎ | speichern bzw. absenden |
| ⌘⌫ | archivieren bzw. löschen (mit Rückgängig) |
| ⌘Z | letzte Aktion rückgängig, solange der Toast steht |
| 1–4 | Liste / Board / Tabelle / Timeline |

### 5.4 Gestaltung

- **Richtung:** sympathisch, schnell, modern, gern glassy (Vorgabe). Aus drei Moodboards (Abschnitt 11) hat Rafael am 2026-10-28 **Werkbuch („Arbeitsheft“)** gewählt. Festgehalten ist sie in `prototypes/clickdummy/DESIGN.md`.
- **Glas sparsam** (Spec): für schwebende Flächen wie Befehlspalette, Menüs, Seitenpanel und Toasts. Lesetext steht auf ruhigen Flächen mit vollem Kontrast.
- **Tokens wie in openbill:** CSS-Variablen für hell und dunkel, `@theme inline`, die Farbpalette von Tailwind ist entfernt.
- **Schriften** liegen lokal (fontsource); zur Laufzeit werden keine externen Fonts geladen.
- **Icons:** Lucide.
- **Komponenten:** eigener Satz auf Base UI. Er entsteht im Klickdummy und wird in die App übernommen, wie in openbill.

## 6. Schnittstellen

### 6.1 REST-API

**Grundlagen:**
- Basis `/api/v1`, JSON, Schlüssel in snake_case, ULIDs. Items sind auch über den Key erreichbar (`/api/v1/work-items/WEB-123`).
- **Auth:** Bearer-Token (Sanctum) oder die Session der UI mit CSRF.
- **Vollständig** (Vorgabe): Alles, was die UI kann, kann auch die API.
  - Organisation, Personen und Bots, Tokens
  - Projekte, Mitglieder, Favoriten, Automatisierungen
  - Workflows mit Status und Übergängen, Workflow-Zuordnung mit Zuordnung der Status
  - Typen, Properties, Labels, Relationstypen, Resolutions
  - Work Items: anlegen, ändern, Übergang, Mehrfachbearbeitung, Archiv, Löschen, Relationen, Beobachter, Historie
  - Kommentare und Reaktionen, Anhänge (Upload per Multipart)
  - Vorlagen (auch „jetzt ausführen“, Terminvorschau), Wiki-Seiten (verschieben, Versionen, wiederherstellen)
  - Views und ihre Ergebnisse, Benachrichtigungen und Einstellungen, Suche
  - Webhooks mit Zustellungen, „erneut senden“ und Test-Ping
  - Die UI nutzt dieselbe API.

**Pagination, Filter, Sortierung, Includes** (abgestimmt):
- **Pagination** über Cursor (`cursorPaginate`), `per_page` höchstens 100, Antwort im Laravel-Format `{data, links, meta}`.
- **Normale Ressourcen** filtern, sortieren und laden Beziehungen über spatie/laravel-query-builder (v7): `?filter[…]=…&sort=-…&include=…`, mit Operatoren.
- **Work Items** nutzen die Filter-Engine der Views (4.11):
  - `?view=<id>`
  - oder `POST /api/v1/work-items/query` mit Filter, Sortierung und Cursor im Body
  - häufige Felder zusätzlich als Kurzform `filter[project]=WEB&filter[assignee]=me`; die Kurzform wird in dieselbe Engine übersetzt (Spec)

**Fehler und Grenzen:**
- Fehler als Problem Details (RFC 9457) mit `reason`-Codes, Feldfehler unter `errors`. Status: 403, 404, 409 (Übergang, Konflikt, gesperrt), 413, 422, 429.
- Rate-Limit je gültigem Token, sonst je IP: API 600/min (Spec, wie openbill). Ein Body-Limit gilt für JSON; Uploads haben eigene Grenzen.

**OpenAPI:**
- erzeugt von Scramble: UI unter `/api/docs`, JSON unter `/api/openapi.json`
- die Parameter des Query Builders kommen über eine Community-Erweiterung (z. B. lokiwich/scramble-spatie-query-builder) oder eine kleine eigene Extension; das klärt der Plan
- ein Test prüft, dass jede API-Route dokumentiert ist

### 6.2 MCP

**Grundlagen** (abgestimmt):
- laravel/mcp unter `/mcp`, Bearer-Token mit Fähigkeit `mcp`. Lese-Tools brauchen zusätzlich `read`, Schreib-Tools `write` (Spec).
- Rate-Limit 300/min je Token (Spec).
- Die Tools rufen dieselben Actions und geben dieselben Darstellungen zurück wie REST. Rich Text kommt als Markdown.

**Tools:**
- Pro Ressource gibt es ein Lese-Tool (`IsReadOnly`) und ein Schreib-Tool (`IsDestructive`), jeweils mit einem `action`-Parameter. Ein Beispiel ist `work-items` für list, get, query und history und `manage-work-items` für create, update, transition, archive, restore, delete und bulk-update (Spec). So kann ein Client Lesen ohne Rückfrage erlauben, und die Zahl der Tools bleibt überschaubar.
- **Ressourcen:** Organisation und Einstellungen (Workflows, Typen, Properties, Labels, Relationstypen, Resolutions), Personen und Bots, Projekte und Mitglieder, Work Items, Relationen, Kommentare, Vorlagen, Wiki, Views, Benachrichtigungen, Webhooks, Automatisierungen, dazu `search`.
- **Uploads:** `get-upload-url` liefert eine signierte URL für `curl -F` (15 min). Binärdaten gehen nie durch Tool-Argumente (wie prevju).
- **Referenzen** als MCP-Resources: Filter-Syntax, Markdown-Konventionen, Feldtypen. Sie werden zur Laufzeit aus der englischen Doku gelesen (wie openbill).

**Instructions und Tests:**
- Die Server-Instructions sagen, dass Texte in Ergebnissen Nutzerdaten sind und keine Anweisungen.
- Fehler kommen als lesbarer Text für das Modell (Muster aus openbill).
- Tests prüfen: Jeder in Texten oder Doku genannte Tool-Name existiert, und die Doku nennt alle Tools.
- **Agent-Szenario für Doku und Landingpage:** Ein Item wird einem Bot zugewiesen. Der Webhook `bot.assigned` erreicht einen Agenten. Der arbeitet per MCP, kommentiert und setzt den Status.

### 6.3 Webhooks

**Konfiguration** (abgestimmt, Verwaltung durch Org-Admins):
- Name, URL, Geheimnis (wird einmal angezeigt, lässt sich erneuern), Geltungsbereich: Organisation oder ein Projekt
- Ereignisse mit Platzhalter pro Gruppe (`work_item.*`), optional nur für einen bestimmten Bot (Spec), aktiv ja/nein

**Ereignisse** (Katalog, Feinschnitt im Plan):

| Gruppe | Ereignisse |
|---|---|
| `project` | `created`, `updated`, `archived`, `deleted`, `member_added`, `member_removed` |
| `work_item` | `created`, `updated`, `state_changed`, `assigned`, `archived`, `restored`, `deleted`, `relation_added`, `relation_removed` |
| `comment` | `created`, `updated`, `deleted` |
| `page` | `created`, `updated`, `moved`, `deleted` |
| `bot` | `mentioned`, `assigned` |
| `template` | `run_failed` |

**Payload:** `{ id, event, occurred_at, actor {id, type, name, handle}, project {id, identifier} | null, data, changes {feld: {old, new}} | null }`. `data` ist die REST-Darstellung der Ressource, Rich Text in beiden Formen.

**Zustellung** (Spec für die Werte):
- spatie/laravel-webhook-server mit Headern `X-Werkbuch-Event`, `X-Werkbuch-Delivery`, `X-Werkbuch-Timestamp` und `X-Werkbuch-Signature: sha256=<HMAC über "timestamp.body">`
- über die Queue, 10 s Timeout, Erfolg ist 2xx, Weiterleitungen werden nicht verfolgt
- 8 Versuche mit wachsendem Abstand, verteilt über etwa 24 Stunden
- jeder Versuch wird protokolliert: Status, Dauer, Antwort gekürzt auf 2 KB, Fehler; das Protokoll wird nach 30 Tagen gelöscht
- „erneut senden“ und Test-Ping
- schlägt ein Webhook 24 Stunden lang ohne Erfolg fehl, wird er abgeschaltet, und die Org-Admins werden benachrichtigt

**SSRF:**
- Ziele in privaten, Loopback-, Link-local- und Metadata-Netzen sind gesperrt, außer `WEBHOOKS_ALLOW_PRIVATE=true`.
- Geprüft wird bei jedem Versand nach der DNS-Auflösung; die Anfrage geht an die geprüfte IP.

## 7. Architektur

### 7.1 Stack und Pakete

- **Backend:** PHP 8.4, Laravel 13, Inertia v3, laravel/fortify, laravel/sanctum, laravel/mcp, laravel/reverb, laravel/scout (Meilisearch), lorisleiva/laravel-actions, spatie/laravel-permission, spatie/laravel-medialibrary, spatie/laravel-query-builder, spatie/laravel-webhook-server, dedoc/scramble, ueberdosis/tiptap-php, league/commonmark, league/html-to-markdown.
- **Frontend:** React 19, TypeScript, Tailwind 4, Vite, Base UI, Tiptap v3, TanStack Query, TanStack Virtual, Zustand, dnd-kit, Laravel Echo (Reverb), Lucide, fontsource.
- **Werkzeuge:**
  - Pest 5 (Suiten Unit, Feature, Integration wie openbill)
  - Larastan, mindestens Level 8 (Spec)
  - Pint, Vitest, Playwright
  - pnpm-Workspace: App, `docs`, `prototypes/*`; `e2e/` ist eine eigene Wurzel wie in openbill

### 7.2 Backend-Regeln

- **Actions-Regel** (Vorgabe): Jeder Anwendungsfall ist eine Action in `app/Actions/<Bereich>/`, lesend oder schreibend.
  - Controller, Inertia-Seiten, API-Endpunkte, MCP-Tools, Jobs und Commands enthalten keine Fachlogik; sie rufen Actions auf.
  - Validierung und Rechteprüfung passieren in der Action selbst, egal wer sie aufruft.
  - Schreibende Actions laufen in einer Transaktion.
  - Architekturtests sichern das ab, unter anderem keine schreibenden Zugriffe per `DB::table` außerhalb von Actions.
- **Reine Regeln** liegen in `app/Domain` als PHP ohne Laravel, damit sie isoliert testbar sind: Übergangsgraph, Filter-Engine (Übersetzung in Queries), Terminberechnung, Platzhalter, Markdown-Konventionen.
- **Events und Outbox** (Spec):
  - Jede schreibende Action legt in ihrer Transaktion Events in einer Tabelle `events` an: Typ, Actor, Subjekt, Projekt, Änderungen, Zeitpunkt.
  - Diese Tabelle ist die Quelle der History und zugleich die Outbox.
  - Nach dem Commit verteilt ein Dispatcher jedes Event an die Konsumenten: Benachrichtigungen, Webhooks, Suchindex, Live-Updates, Automatisierungen. Jeder Konsument arbeitet über die Queue.
  - Ein Scheduler-Job verteilt Events nach, die nach einem Absturz unverteilt geblieben sind. Kein Event geht verloren.
- **Queue:** Datenbank-Treiber, Queues `default`, `notifications`, `webhooks`, `search`, `media`, `bulk`. Ein Worker-Container arbeitet sie nach Priorität ab.
- **Scheduler:**
  - jede Minute: fällige Vorlagen, Sammelmails, Nachverteilen der Outbox
  - stündlich: Erinnerungen an fällige Items für alle, bei denen es gerade 08:00 ist
  - täglich um 03:00 Org-Zeit: Auto-Archiv, Auto-Close, Aufräumen (Anhänge ohne Besitzer, Webhook-Protokolle, alte Benachrichtigungen)
- **Live-Updates:**
  - Reverb mit privaten Kanälen `project.{id}` (Änderungen an Items und Seiten), `user.{id}` (Inbox) und `work-item.{id}` (Kommentare, Detail)
  - die Autorisierung der Kanäle nutzt dieselben Policies
  - der Client aktualisiert damit den Cache von TanStack Query; eigene Änderungen werden nicht doppelt angewendet
- **Zugriffsprüfung über Projektgrenzen:** Es gibt genau einen Scope „sichtbare Projekte einer Person“. Ihn nutzen Views, Suche, REST, MCP, Relationen, Anhänge, Benachrichtigungen und Live-Kanäle.

### 7.3 Frontend

- Inertia übernimmt Routing und Seitenkontext: aktuelle Person, Rechte, Organisation, IDs. Listen und Details lädt TanStack Query aus `/api/v1`; geschrieben wird nur über die API.
- Zustand hält den lokalen UI-State: Auswahl, Fokus, Palette, Entwürfe.
- Die Komponenten stammen aus dem Klickdummy (`resources/js/components/ui`), der Editor liegt in `resources/js/editor`.
- Ein Kürzel-Register mit Geltungsbereichen (global, Liste, Detail, Dialog) ist die einzige Quelle für Kürzel, Hilfe und Doku.
- UI-Texte gibt es nur über Schlüssel in `lang/en.json` und `lang/de.json` (Muster aus openbill, mit Test auf gleiche und benutzte Schlüssel).
- Die Sprache kommt aus dem Profil. Vor dem Login gelten Cookie bzw. Standard der Organisation. Die URLs haben kein Sprachpräfix, damit geteilte Links für alle in ihrer Sprache öffnen (Spec, anders als openbill).
- Das Theme wird vor dem ersten Rendern gesetzt, wie in openbill.

### 7.4 Datenmodell (Skizze)

Alle Primärschlüssel sind ULIDs, alle Tabellen haben Zeitstempel. Die Details entscheidet der Plan.

| Tabelle | Kern |
|---|---|
| `organization` | name, locale, timezone, week_start; Logo über medialibrary; genau eine Zeile |
| `users` | type (`person`/`bot`), name, handle (unique), email (unique, nullable bei Bots), password (nullable), locale, timezone, is_default_bot, owner_id (Bots), disabled_at, 2FA-Spalten (Fortify) |
| spatie-Tabellen | Rollen und Rechte mit Teams, Team-ID = Projekt bzw. die Organisation |
| `personal_access_tokens` | Sanctum |
| `projects` | identifier (unique), name, description, lead_id, visibility, workflow_id, default_type_id, next_number, archived_at; Bild über medialibrary |
| `project_identifiers` | frühere Kennungen (unique) → project_id |
| `project_members`, `project_types` | Mitgliedschaft (Rolle über spatie) bzw. aktivierte Typen |
| `workflows`, `workflow_states`, `workflow_transitions` | is_default, is_free, initial_state_id; Status mit name, color, category, position; erlaubte Paare (unique) |
| `work_item_types`, `type_properties` | name, icon, color, is_epic, archived_at; Zuordnung mit required und position |
| `properties`, `property_options` | key (unique), label, field_type, settings (JSON), default_value; Optionen mit label, color, position, archived_at |
| `resolutions`, `labels`, `relation_types` | jeweils zentral; relation_types mit outward_label, inward_label (nullable = symmetrisch), built_in |
| `work_items` | project_id, number (unique je Projekt), type_id, title, description (JSON), description_text, description_version, state_id, resolution_id, assignee_id, priority, start_date, due_date, parent_id, rank, created_by, started_at, closed_at, archived_at, template_id |
| `work_item_values` | work_item_id, property_id und je Werttyp eine Spalte (string, number, date, bool, user_id, option_id, json); mehrere Zeilen bei Mehrfachauswahl |
| `work_item_labels`, `work_item_relations`, `work_item_subscribers` | Zuordnungen; Relation (type, source, target) unique; Beobachter mit Grund und „abgemeldet“ |
| `comments`, `comment_reactions` | body (JSON), body_text, edited_at; Reaktion (comment, user, emoji) unique |
| `attachments` | project_id, attachable (morph, nullable), kind (`inline`/`file`), uploaded_by, filename, mime, size; Datei über medialibrary |
| `events` | type, actor_id, subject (morph), project_id, changes (JSON), occurred_at, dispatched_at: History und Outbox |
| `notifications`, `notification_preferences` | user_id, event_id, read_at, mailed_at; Einstellungen je Ereignis und Kanal |
| `views`, `favorites` | name, icon, filter (JSON), display (JSON), created_by; Favoriten je Person (View oder Projekt) mit Position |
| `templates`, `template_runs` | project_id, name, payload (JSON), Zeitplan-Spalten, active, next_run_at; Lauf mit scheduled_for (unique je Vorlage), work_item_id, status, error |
| `automations` | project_id, key, enabled, settings (JSON) |
| `pages`, `page_versions` | project_id, parent_id, rank, title, emoji, content (JSON), content_text, version; Versionen mit Inhalt, Titel, Autor |
| `webhooks`, `webhook_deliveries` | name, url, secret (verschlüsselt), project_id, events (JSON), bot_id, active, disabled_at; Zustellung mit attempt, status_code, duration_ms, response_excerpt, error |

### 7.5 Sicherheit

- **Tests auf Datenlecks:** Rechte-Matrix-Test (jede Action × jede Rolle, wie `RightsMatrixTest` in openbill) und gezielte Tests auf Lecks über Projektgrenzen: Suche, Views, Relationen, Anhänge, Live-Kanäle, Webhooks, MCP.
- **Inhalte und Uploads:** Rich Text wird nur aus JSON gerendert, nie als rohes HTML der Nutzer. Für Uploads gelten die Regeln aus 4.16. Webhooks sind gegen SSRF geschützt (6.3).
- **Proxy:** Trusted Proxies und Host-Prüfung wie in openbill: `TRUSTED_PROXIES`, nur der Host aus `APP_URL`, kein Vertrauen in `X-Forwarded-Prefix`.
- **Sitzungen und Tokens:** Login-Drosselung, Throttle vor Auth (Stolperstein aus openbill), Tokens gehasht, Webhook-Geheimnisse verschlüsselt, 2FA optional.

## 8. Betrieb

### 8.1 Docker und Compose

Das Image `baeroe/werkbuch` gibt es für amd64 und arm64.
- **Basis:** serversideup/php 8.4 mit fpm-nginx, wie openbill.
- **Build:** eine Node-Stage mit pnpm baut die Assets einmal nativ.
- **Rechte:** Der Code liegt schreibgeschützt im Image, beschreibbar sind nur `storage/` und `bootstrap/cache`.

| Dienst | Image | Aufgabe |
|---|---|---|
| `werkbuch` | `baeroe/werkbuch` | Web (nginx + PHP-FPM) auf `${WERKBUCH_BIND:-0.0.0.0}:${WERKBUCH_PORT:-7740}`; führt beim Start die Migrationen aus; nginx leitet `/app` und `/apps` an Reverb weiter, sodass ein einziger Port reicht |
| `queue` | `baeroe/werkbuch` | `queue:work` |
| `scheduler` | `baeroe/werkbuch` | `schedule:work` |
| `reverb` | `baeroe/werkbuch` | `reverb:start`, nur intern |
| `mariadb` | MariaDB 11.4 (Digest) | internes Netz |
| `meilisearch` | Meilisearch v1 (Digest) | internes Netz |

**Volumes:** `werkbuch-data` (`storage/app` mit Anhängen; App, Queue und Scheduler hängen es ein), `mariadb-data` und `meili-data`. Alle Images sind per Digest gepinnt.

**Entrypoint der App:**
1. Ordner im Volume anlegen.
2. Schlüssel setzen: `APP_KEY` und die Reverb-Schlüssel kommen aus der Env; fehlen sie, werden sie erzeugt und im Volume gespeichert.
3. Auf die Datenbank warten, dann migrieren. Standard-Bot und Grunddaten kommen aus Migrationen.
4. `app:ensure-admin`, Index-Einstellungen von Meilisearch synchronisieren, `optimize`.

Die anderen Container starten ohne Migration.

**Standalone-Compose:** `docker-compose.standalone.yml` für Dockge und Portainer bleibt mit `docker-compose.yml` im Gleichschritt; ein Test vergleicht beide (wie openbill).

**Health und Backup:** Healthcheck `/up`. Die Doku beschreibt das Backup: DB-Dump und das Volume `werkbuch-data`.

### 8.2 Konfiguration

| Variable | Zweck |
|---|---|
| `APP_URL` | öffentliche https-Adresse (Pflicht) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | erstes Konto, nur beim ersten Start |
| `DB_PASSWORD` (+ `MARIADB_*`) | Datenbank |
| `MEILISEARCH_KEY` | Master-Key der Suche |
| `MAIL_*`, `MAIL_FROM_ADDRESS` | SMTP, optional |
| `TRUSTED_PROXIES` | IPs/CIDR der Proxys, leer = private Netze |
| `WERKBUCH_PORT`, `WERKBUCH_BIND` | Port und Bind-Adresse |
| `ATTACHMENTS_MAX_MB` | Dateigröße, Standard 25 |
| `NOTIFICATION_MAIL_DELAY` | Sammelzeit der Mails, Standard 5 min |
| `WEBHOOKS_ALLOW_PRIVATE` | interne Webhook-Ziele erlauben, Standard false |
| `FILESYSTEM_DISK`, `AWS_*` | optional S3-kompatibler Speicher |

### 8.3 Lokale Entwicklung (DDEV)

- **Umgebung:** `https://werkbuch.ddev.site` mit PHP 8.4, MariaDB 11.4, Node 24 und pnpm über corepack.
- **Dienste:** Mailpit; Meilisearch als Zusatzdienst; Queue-Worker, Scheduler und Reverb als Daemons im Web-Container; Vite mit HMR.
- **PHP** gibt es auf dem Host nicht. PHP, Composer, Artisan und pnpm laufen nur im Container (wie openbill).
- **Playwright** läuft auf dem Mac gegen DDEV, `e2e/` ist ein eigenes pnpm-Projekt.

### 8.4 Release

- Ein Tag `vX.Y.Z` löst GitHub Actions aus: Image bauen und pushen (`X.Y.Z`, `X.Y`, `latest`) und ein GitHub-Release mit Notizen aus `docs/*/upgrading.md` anlegen.
- Der Abschnitt in `upgrading.md` ist Pflicht und wird per Test geprüft; ebenso die `version` in der Config.
- Die Beschreibung auf Docker Hub wird aus der README synchronisiert.
- Getaggt wird erst nach Freigabe durch Rafael (wie openbill).

## 9. Qualität und Tests

- **PHP:** Pest mit 100 % Zeilenabdeckung als harte Grenze im CI (PCOV, `--min=100`), dazu Larastan (mindestens Level 8), Pint und Architekturtests.
- **Frontend:**
  - Vitest für `lib/`, Stores, Hooks, Filter- und Kürzel-Logik und Editor-Helfer.
  - Playwright deckt jede Seite und jeden Ablauf ab: nur mit Tastatur, hell und dunkel, 1440 und 390 px.
  - Live-Updates werden mit zwei Browser-Kontexten getestet, Webhooks gegen einen lokalen Empfänger, Mails über die Mailpit-API.
- **Frontend-Abdeckung:** Ein Coverage-Build instrumentiert mit Istanbul. Playwright sammelt `window.__coverage__`, das Ergebnis wird mit der Vitest-Abdeckung zusammengeführt. Grenze: 100 % Zeilen. Ausnahmen nur mit Begründung im Kommentar.
- **Querschnittstests wie in openbill:** Rechte-Matrix, Datenlecks, Übersetzungen, Doku (gleiche Struktur in en/de, Links, Screenshots), Docker-Setup, OpenAPI-Vollständigkeit, MCP (Namen, Annotationen, Doku), Release-Notizen.
- **Last** (Spec): Ein Seeder mit etwa 50.000 Items in 20 Projekten. Damit prüft der Feinschliff Listen, Board, Suche und API auf spürbare Wartezeiten.
- **CI:**
  - Pflicht-Job `tests` in `.github/workflows/tests.yml`: PHP mit Abdeckung, Larastan, Pint, Typecheck, Vitest; der Name ändert sich nie.
  - Weitere Jobs: `e2e` mit Playwright gegen den Compose-Stack und der zusammengeführten Abdeckung; `docs`; `image`.
  - Dependabot für Actions, Composer und pnpm.

## 10. Doku

Die Doku ist eine VitePress-Seite in `docs/`, auf Englisch (`docs/en/`) und Deutsch (`docs/de/`) mit gleichen Dateinamen und `llms.txt`, wie openbill. Veröffentlicht wird sie über GitHub Pages. Bis `werkbuch.dev` registriert ist, liegt sie unter einem Unterpfad (`DOCS_BASE`).

**Seiten:**
- Landingpage
- Setup (bindet die echte Compose-Datei ein), Reverse Proxy (mit WebSockets für NPM, Traefik und Caddy), Upgrading, Backup
- Konzepte: Projekte, Workflows, Typen und Properties, Views, Vorlagen, Automatisierungen, Rechte
- Tastatur: erzeugt aus dem Kürzel-Register
- Bots und Agenten, API (mit Verweis auf `/api/docs`), MCP mit allen Tools und Einrichtung, Webhooks mit Ereignissen, Payload und Beispielcode zur Signaturprüfung

Screenshots entstehen per Playwright aus Demo-Daten in beiden Sprachen. Demo- und Testdaten sind nur fiktiv.

## 11. Ablauf

1. **Spec** (dieses Dokument): abstimmen, dann im neuen Repo `~/development/baeroe/werkbuch` committen. Das GitHub-Repo `baeroe/werkbuch` ist von Anfang an öffentlich, wie openbill (am Tag der ersten Spec angelegt), und folgt den Konventionen in `~/development/baeroe/CLAUDE.md`. Damit stehen GitHub Pages, Rulesets und Actions ohne Minutenlimit von Beginn an zur Verfügung (Spec).
2. **Drei Moodboards** in `prototypes/moodboards/`:
   - drei Designrichtungen, alle simpel, tastaturorientiert und mehr oder weniger glassy
   - je eine statische Seite mit Tokens (Farben hell und dunkel, Schrift, Radien, Glas, Schatten), Kernkomponenten (Buttons, Felder, Menüs, Chips, Befehlspalette, Toast) und einem Schlüsselbildschirm (Board mit Seitenpanel und offener Palette)
   - Rafael bekommt Links zum Anschauen, wählt eine Richtung oder mischt; das Ergebnis wird `DESIGN.md`
3. **Klickdummy** in `prototypes/clickdummy/`:
   - nach dem Ablauf von `design-webapp`: `DESIGN.md`, Fake-API mit Seed-Daten hinter TanStack Query, Zustand, Iteration per Playwright-Screenshots über die Breakpoints
   - **ohne shadcn:** eigene Komponenten auf Base UI und Tailwind 4
   - deckt alle Bildschirme aus 5.2 und das Tastaturkonzept ab
   - Korrekturrunden mit Rafael, bis alles sitzt; was sich ändert, wird hier als „Änderungen vom …“ nachgetragen (wie openbill)
4. **Umsetzung:**
   - Sie beginnt erst, wenn die Korrekturen am Klickdummy durch sind (Vorgabe). Es laufen keine Backend-Phasen vorab, weil Klickdummy und `DESIGN.md` diese Spec noch ändern können.
   - Master-Plan und Phasenpläne (superpowers:writing-plans)
   - je Phase ein Branch und ein PR; ein Subagent setzt um, ein Review-Subagent prüft mit Fix-Runden; Merge nach grüner CI (wie openbill)
   - Tests und VitePress-Doku gehören zu jeder Phase
   - Vorschlag für den Phasenschnitt, den der Plan entscheidet:
     1. Fundament (Repo, DDEV, Docker-Gerüst, Auth, i18n, UI-Basis)
     2. Organisation, Konten, Rollen
     3. Workflows, Typen, Properties, Labels
     4. Items, Events und History
     5. Editor, Kommentare, Anhänge
     6. Views und Filter-Engine
     7. Benachrichtigungen, Mail, Reverb
     8. Suche und Befehlspalette
     9. Vorlagen und Automatisierungen
     10. Wiki
     11. REST vollständig mit OpenAPI
     12. MCP
     13. Webhooks
     14. Docker und Release
     15. Feinschliff
5. **Manuelle Tests:** Eine Checkliste aus den Erfolgskriterien und Kapitel 4. Rafael testet auf DDEV und mit dem Compose-Stack, Korrekturen kommen als PRs.
6. **Release v0.1.0** nach Freigabe durch Rafael: Image auf Docker Hub, GitHub-Release, Doku online.

## 12. Entscheidungen beim Ausformulieren (bitte prüfen)

**Bedienung und Umfang**
- TanStack Query statt SWR (openbill), weil der Klickdummy nach `design-webapp` damit gebaut wird und optimistische Updates einfacher sind (3, 7.3).
- URLs ohne Sprachpräfix, Sprache aus dem Profil (7.3).
- Mehrfachbearbeitung schon in v1 (4.8).
- Nicht in v1: Items zwischen Projekten verschieben, Vorlagen mit Unteraufgaben, ODER-Gruppen, Oberfläche fürs Audit-Log, Kommentare auf Wiki-Seiten, anpassbare Kürzel, Abhängigkeitspfeile in der Timeline (2).
- System-Seite für Admins (5.2); Organisation mit Zeitzone und Wochenbeginn (4.1).

**Konten und Rechte**
- Fortify für Login, Passwort vergessen und 2FA (3).
- Standard-Bot heißt „Automation“, hat Org-Rolle Admin und taucht in Auswahllisten nur als Projektmitglied auf (4.2).
- Org-Admins haben in jedem Projekt Admin-Rechte. Org-Member haben in öffentlichen Projekten Viewer-Rechte und treten mit einem Klick bei. Items löschen dürfen nur Projekt-Admins (4.3).
- Projektkennung änderbar, alte Keys lösen weiter auf (4.4).

**Workflows, Typen, Properties**
- Ein Workflow braucht einen Completed-Status, und jeder Status muss vom Startstatus aus erreichbar sein. Wer ein Item direkt in einem anderen Status anlegt, wird wie ein Übergang geprüft (4.5).
- Pflicht heißt: beim Anlegen nötig und nicht leerbar. Feldtyp unveränderlich; Einfach- → Mehrfachauswahl ist erlaubt (4.7).
- Eltern-Items nur im selben Projekt (4.8).
- Board über mehrere Workflows gruppiert nach Kategorie (4.11).

**Abläufe**
- Wer kommentiert, beobachtet automatisch. Keine Threads (4.10).
- Platzhalter und monatliche Varianten im Zeitplan. Eine ungültige Vorlage schlägt fehl und benachrichtigt Lead und Ersteller (4.12).
- Automatisierungen sind anfangs aus. Auto-Close gilt nur für Backlog und Unstarted (4.13).
- Erinnerungen um 08:00 Ortszeit. Mail-Standardwerte, 5 Minuten Sammelzeit, Benachrichtigungen 90 Tage aufheben (4.14).
- Wiki: Versionen nach 10 Minuten Pause und vor dem Überschreiben, Löschen mit Teilbaum. Dieselbe Konfliktwarnung gilt für Item-Beschreibungen (4.15, 4.8).

**Editor, Anhänge, Suche**
- `@` für Personen und Bots, `#` für Items und Seiten. Markdown-Schreibweise und zwei Felder je Rich Text in der API (4.16).
- Anhänge: `inline` und `file`, Aufräumen per Kommando, 25 MB, SVG nie inline (4.16).
- Kommentare im Suchindex (4.17).

**Schnittstellen**
- MCP: je Ressource ein Lese- und ein Schreib-Tool (6.2).
- Kurzform für Work-Item-Filter in der REST-API (6.1).
- Rate-Limits 600 bzw. 300 pro Minute (6.1, 6.2).
- Webhook-Werte: 8 Versuche, Abschalten nach 24 Stunden, Protokoll 30 Tage, Filter auf einen Bot (6.3).

**Technik und Betrieb**
- Events als Outbox-Tabelle (7.2).
- Reverb hinter nginx im App-Container, damit ein einziger Port reicht (8.1).
- Glas nur für schwebende Flächen (5.4).
- Larastan mindestens Level 8, Last-Seeder (9).
- Repo von Anfang an öffentlich, wie openbill (11).
- Zielgruppe (1).

## 13. Dem Builder überlassen

- **Datenbank:** genaue Tabellen, Indizes, Spaltentypen; Algorithmus für den Rang; Speicherung der Teams in spatie mit ULIDs.
- **Namen:** endgültige Namen der Ereignisse, der MCP-Tools und der Routen; Format der Kurzform-Filter.
- **Werkzeuge:** Wahl der Scramble-Erweiterung oder eine eigene; wie nginx im serversideup-Image an Reverb weiterleitet.
- **Abläufe:** Aufteilung der Queues und Worker-Parameter; Zusammenfassen der History in der Anzeige.
- **UI:** Details der Animationen und der Glas-Effekte im Rahmen von `DESIGN.md`; die Kürzel-Belegung im Detail, abgestimmt im Klickdummy.

## 14. Risiken und offene Punkte

- **Frontend-Abdeckung von 100 %** über zusammengeführte E2E-Abdeckung ist aufwendig. Früh im Fundament aufsetzen, nicht erst am Ende.
- **Scramble-Erweiterung für den Query Builder** ist ein Community-Paket. Prüfen, ob es gepflegt ist; sonst eine eigene Extension schreiben.
- **Reverb hinter Proxys:** Nginx Proxy Manager braucht den Schalter „Websockets Support“. Das kommt in die Doku, und die UI warnt sichtbar, wenn die Live-Verbindung fehlt.
- **spatie-Teams mit ULIDs** brauchen angepasste Migrationen. Die Organisations-Rollen als eigenes „Team“ sind zu prüfen.
- **tiptap-php mit eigenen Knoten** (Erwähnung, Verweis, Anhang) und dem Schema von Tiptap v3: Die Rundreise Markdown ↔ JSON braucht Tests.
- **Speicherbedarf:** Meilisearch braucht auf kleinen Servern spürbar RAM. Mindestanforderungen dokumentieren.
- **Domain:** `werkbuch.dev` muss Rafael registrieren. Bis dahin liegt die Doku unter einem Unterpfad.
