---
tags: [session, überblick]
datum: 2026-11-08
---
# 2026-11-08 – werkbuch bis v0.1.0

> **Stand: Phase 15 läuft noch** (PR #32 offen, Branch `feat/phase-15-polish`). Diese Notiz hält fest, was bis zum 2026-11-08 abends steht. Offen sind axe, Screenshots, Landingpage mit `docs.yml`, die Tastatur-Lücken, die zeitgebundenen Updates (Tasks 25, 25b), das Final-Review und die finale Fix-Welle. Der Orchestrator ergänzt die Notiz am Ende der Phase (Abschnitt „Nachtrag“ unten); das Release v0.1.0 kommt erst nach den manuellen Tests und Rafaels Freigabe.

## Kontext

werkbuch ist ein offenes, selbst gehostetes Projektmanagement-Tool (Projekte, Work Items mit eigenen Typen, Properties und Workflows, Wiki, Views, Vorlagen mit Zeitplan, Automatisierungen, Benachrichtigungen, Suche, REST, MCP, Webhooks), betrieben wie openbill und prevju: ein Image `baeroe/werkbuch`, `docker compose up -d`, Doku per VitePress. Vorbild ist Plane, mit dem Anspruch, Typen, Workflows, Recurring und Wiki offen anzubieten. Gebaut wurde es vom 2026-10-28 bis 2026-11-08 von Claude als Orchestrator mit Subagents (Implementer, Reviewer je Task), gesteuert über eine Spec, einen Master-Plan, einen Phasenplan je Phase mit Preflight und eine fortlaufende Liste von Rulings (A1–A464).

Quellen: `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (Spec mit „Änderungen vom …“), `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Master-Plan, „Fortschritt“), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (Rulings), die Phasenpläne daneben, `CLAUDE.md` (Stand, Architektur, Fallstricke).

## Was wurde gemacht

**Vorlauf (2026-10-28/29):** drei Moodboards, Richtung „Werkbuch (Arbeitsheft)“ gewählt (PR #1); Klickdummy mit Fake-API und erster Korrekturrunde (PR #2), bestätigte Abweichungen in der Spec (PR #3); Master-Plan mit 15 Phasen (PR #4).

| Phase | Inhalt | PR | gemergt |
|---|---|---|---|
| 1 | Fundament: Laravel 13 in DDEV, Gates, Problem Details, i18n, Frontend-Basis, Fortify, Shell, CI, VitePress | #5 | 2026-10-30 |
| 2 | Organisation, Personen und Bots, Einladungen, Rollen und Rechte (Matrix), Outbox, REST-Grundlage, Tokens, 2FA, Projekte, Einstellungen | #11 | 2026-10-31 |
| 3 | Workflows mit Übergangsmatrix, Typen, Properties, Labels, Relationstypen, Resolutions, mitgelieferter Katalog | #12 | 2026-10-31 |
| 4 | Work Items, Relationen, History aus Events, Status-Zuordnung, Rich Text, Item-Seite, Anlegen-Dialog, Befehlspalette | #13 | 2026-11-01 |
| 5 | Filter-Engine, Keyset-Cursor, Gruppen und Zählungen vom Server, Views, Liste, Board, Tabelle, Timeline, Mehrfachleiste | #15 (+ #17) | 2026-11-02 |
| 6 | Meilisearch über Scout, Such-Konsument, Suche in der Palette | #18 | 2026-11-02 |
| 7 | Editor komplett (`/`, `@`, `#`, Bilder, Dateien), Kommentare, Reaktionen, Anhänge mit Vorschauen | #19 | 2026-11-03 |
| 8 | Benachrichtigungen, Inbox, Sammelmails, Erinnerungen, Live-Updates über Reverb, System-Seite | #20 | 2026-11-04 |
| 9 | Wiki: Baum, Versionen, Konfliktschutz, Verschieben, Löschen mit Rückgängig | #21 | 2026-11-04 |
| 10 | Vorlagen mit Zeitplan und Platzhaltern, geplante Läufe, Automatisierungen | #22 | 2026-11-05 |
| 11 | Webhooks: SSRF-Schutz, Signatur, Backoff, Protokoll, Abschalten | #25 | 2026-11-06 |
| 12 | REST vollständig, OpenAPI über Scramble, Vertrag gegen jede Testantwort | #26 | 2026-11-06 |
| 13 | MCP: 29 Tools um dieselben Actions, Parität mit REST, Lecktests | #28 | 2026-11-07 |
| 14 | Docker: ein Image für amd64/arm64, Compose-Stack mit acht Diensten, Smoke im CI, Release-Workflows vorbereitet | #30 | 2026-11-07 |
| 15 | Feinschliff (läuft, Stand unten) | #32 | offen |

Größe der Phasen-PRs (Zeilen hinzugefügt, Commits): #5 43 427/30, #11 32 677/40, #12 21 745/28, #13 40 998/46, #15 38 062/66, #18 7 251/27, #19 21 504/64, #20 20 787/79, #21 16 699/42, #22 22 369/40, #25 14 100/38, #26 14 955/29, #28 13 191/26, #30 6 443/23; Phase 15 hat bis heute 161 Commits.

**Phase 15 bis heute** (Plan mit 67 Tasks nach Rafaels Feedback; Details in `.superpowers/sdd/2026-11-07-phase-15-polish/progress.md`, nicht im Repo):
- Sicherheit und Robustheit: Login-Deckel je Konto mit bekanntem Gerät (T1, A434), TOTP-Tagesdeckel (T2, A435), Cache wiederholt nur Deadlocks (T3, A436), Queue `mail` (T4, A437), ein Standard-Bot per Unique-Index und Einladungs-Race (T5a), `ReadCommitted`-Kanten, `/counts`-Grenze, CSP der API-Doku (T5b).
- CI: e2e je Playwright-Projekt mit Merge-Job (T6a, T6b, A438), Flakes (T7), `tests` mit 60 Minuten (A464).
- Last: Suite `Load` mit 50 000 Items (T8a, T8b, A439), Stempel NOT NULL (T9, A440), Listen, Board und Zählungen unter Budget (T10a–T10c), gezieltes Neuindexieren und Blöcke (T11a, T11b, A459), Neuaufbau der Suche mit Tausch (T12, A460), Bots je Event (T13a), Arbeit hinter der API gemessen (T13b), OpenAPI und MCP (T14), Frontend-Leistung (T14b).
- Tastatur-Manifest (T17a, T17b, A442), Deferred-Punkte (T19a–T21c, T21i–T21m), vorgezogene Punkte (T21d–T21h, A448–A451), Rafaels Feedback (T21n–T21v, A452–A456), englische Demo-Daten (T22a–T22d), Doku-Durchsicht (T24a–T24c), Checkliste der manuellen Tests (T26), diese Notiz und die Abschlussdokumente (T27).

## Entscheidungen & Warum

- **Klickdummy zuerst, dann eingefroren** (R-Rulings, A446): fachliche Fragen wurden im Prototyp geklärt; danach war er Vorlage und wurde nie wieder geändert. Aufräumen passierte im Port, nicht im Prototyp.
- **Fachlogik nur in Actions mit `Actor`, Events als Outbox** (A4, Phase 2): History, Suche, Benachrichtigungen, Live und Webhooks lesen dieselbe Tabelle `events`; Konsumenten beanspruchen ein Event in ihrer eigenen Transaktion und laufen idempotent erneut.
- **REST wächst mit jeder Phase**, weil die Oberfläche ab dem ersten Bildschirm nur über `/api/v1` liest (Master-Plan); MCP und Webhooks benutzen dieselben Actions und Resources (A397–A399).
- **Eine Sichtbarkeitsregel** (`Visibility`, Phase 2): alles, was jemand nicht sehen darf, antwortet 404 wie Unbekanntes; Suche, Live, Webhooks, MCP und Benachrichtigungen bauen nur darauf (A139, A413).
- **Keyset statt Offset für jede Item-Liste** mit eigenem Cursor samt Signatur der Ordnung (A169); Gruppen und Zahlen rechnet der Server, der Browser ordnet nur das Geladene ein (P1 der Phase 5).
- **Der Vertrag wird an echten Antworten geprüft** (A385): jede Testantwort unter `/api/v1` gegen das erzeugte OpenAPI-Dokument, statt eines eingecheckten Schnappschusses.
- **Docker: ein Image, Rolle am Kommando**, e2e bleibt auf `php artisan serve`, Erfolgskriterium 1 prüft ein Smoke gegen den echten Stack (A417, A420).
- **Phase 15, Sicherheit:** IP-Grenzen sind hinter einem fälschbaren Proxy wirkungslos, darum ein Deckel je Konto; damit niemand die Besitzerin aussperrt, gilt er nicht auf einem bekannten Gerät, und das Gerät hängt am Passwort, damit ein Reset es entwertet (A434, Preflight K1, Review T1-I1).
- **Phase 15, CI:** e2e je Playwright-Projekt statt eines Jobs mit 1 h 38 min; der Merge-Job verlangt die vier Projekte beim Namen und scheitert, wenn ein Projekt rot war, auch bei 100 % Abdeckung (A438).
- **Phase 15, Last:** messen vor ändern; die harte Zusicherung ist die Zahl der Abfragen gegen zwei Basen (kleine Welt, kleinere Antwort), die Wanduhr nur ein Median gegen 1,5 s (A439, P2).
- **Phase 15, vorgezogen von Rafael:** Ränge neu verteilen, Kinder seitenweise, natürliche Sortierung, Live für Personen ohne Projektkanal (A448–A451), statt nach v0.1.0.
- **Phase 15, Feedback von Rafael:** „Erwähnte Items verknüpfen“ standardmäßig an und nach dem Commit in einem Job (synchron bräche es die Sperr-Reihenfolge, A452, A453); Tabellen-Menü ohne Verbinden und Teilen, weil Markdown es nicht trägt (A454, A455); Wiki-Seiten im Item über eine Verweistabelle statt einer Suche im JSON (A456).
- **Phase 15, Doku:** englische Demo-Daten für englische Screenshots (A443), Doku unter `https://werkbuch.dev` (A444).
- **Release nur mit Rafaels Freigabe**; `config('werkbuch.version')` bleibt `0.1.0-dev`.

## Stolpersteine

- **Parallele Pest-Läufe zerstören die Test-Datenbank** (Phase 14 T4a, Phase 15 T10a): ein per `TaskStop` abgebrochener Lauf lief im Container weiter. Seitdem `pgrep` vor jedem G1 und nur ein Agent mit Pest gleichzeitig.
- **Mutagen spielte alte Dateien zurück** (Phase 15): `lang/*.json` und Editor-Dateien kamen in alter Fassung aus dem Container; vor jedem Commit `git diff --stat` prüfen.
- **Geteilte Colima-VM:** Speicher voll → Kernel tötet Prozesse, Vitest läuft in Timeouts; jedes `ddev start/stop` eines anderen Projekts schreibt den Router neu und lässt e2e kurz 502 sehen. Ein Docker-`volume prune` in Phase 14 traf fremde Volumes; seitdem nur eigene Ressourcen per Name.
- **Laravels benannte Limiter** liegen unter `md5(<Name><Schlüssel>)`: `RateLimiter::clear` mit dem Rohschlüssel traf nie (Fund T2, `TwoFactorDay::cacheKey`).
- **Grenzen von MariaDB unter Last** (A463): 50 Webhook-Zustellungen mit Bodies bis 1 MiB in einer Anweisung sprengten `max_allowed_packet` („gone away“ nur in der CI mit 16 MiB); ein Event mit über 5 000 Empfängern überschritt 65 535 Platzhalter.
- **Last-Suite und `scoped`-Instanzen:** nach `migrate:fresh` blieb die alte Organisation im Container; der Standard-Bot bekam seine Rolle im Team einer Organisation, die es nicht mehr gab, die Nacht übersprang private Projekte (nur in der CI mit leerer Datenbank, Fix 872f15d8).
- **Vitest-Lecks unter Last:** TanStack-Benachrichtigungen nach dem Teardown (`window is not defined`, Exitcode 1 trotz grüner Tests) und ein Modul-Cache mit alten pnpm-Pfaden; behoben über einen eigenen Scheduler in `test/queryTeardown.ts` und den Stand von `node_modules` im Cache-Schlüssel.
- **Base UI setzt den Fokus einen Frame später**: Tests tippen erst, wenn das Popup den Fokus hat; e2e nur über `tabTo`/`arrowTo`. Fokus nach Umsortieren glaubt man nur im echten Browser.
- **InnoDB-Fremdschlüssel auf dem ersten Index**, der mit der Spalte beginnt (Phase 9): ein `set null` auf `pages.parent_id` machte Projekte unlöschbar, bis die Index-Reihenfolge stimmte.
- **PCOV und opcache:** eine private statische Methode, die nur ein konstantes Array zurückgibt, ersetzt opcache an der Aufrufstelle, PCOV meldet die Zeile als nicht abgedeckt (Phase 12).
- **Leere Negationen in Tests** (`->not->toContain(a, b)` prüft nur `a`) fielen in mehreren Reviews auf; seitdem eine Positivkontrolle oder je Schlüssel einzeln.

## Zahlen (Stand 2026-11-08)

- **Tests:** Pest 7 889 Tests (G1 mit 100,0 % Zeilen PCOV, Larastan Level 8, Pint), Vitest rund 3 190 Tests in rund 210 Dateien (Schwellen je Ordner, 100 % Zeilen zusammen mit Playwright), 49 Playwright-Specs in vier Projekten (Desktop/Handy × hell/dunkel), Frontend-Abdeckung 100 % Zeilen aus Vitest und allen vier Projekten zusammen. Last-Suite: 79 Tests.
- **Rulings:** 464 App-Rulings (A1–A464), 41 Rulings des Klickdummys (R1–R41).
- **CI, letzter grüner Lauf** (PR #32, Lauf 42495822897, Commit 872f15d8, 32 min gesamt): `tests` 32:16, `e2e build` 3:33, `e2e (desktop-light)` 26:36, `e2e (desktop-dark)` 25:35, `e2e (phone-light)` 23:59, `e2e (phone-dark)` 26:12, `e2e coverage` 0:19, `load` 5:58, `image (amd64)` 2:41, `image (arm64)` 2:27, `clickdummy` 3:54, `docs` 0:20. Folgelauf 42505936153 (6408ab19): `tests` 38:05 (darum 60 min Grenze, A464), e2e je Projekt 21:46–25:39, `load` rot (Nacht `closed` 8 439 statt 8 440, offen für die Final-Welle).
- **e2e vorher:** ein Job mit 1 h 38 min bei 120 min Grenze (Phase 13/14).
- **Last** (CI, Lauf 42495822897, Median aus drei Läufen, Budget 1,5 s, Abfragen gleich der kleinen Welt):

| Zeile | Median | Abfragen |
|---|---:|---:|
| Liste nach Rang (`POST /work-items/query`, 100 Items) | 237 ms | 14 |
| Liste nach Kennung (`key`) | 355–369 ms | 14 |
| Liste nach Kategorie | 393–399 ms | 14 |
| Liste nach `property:effort` (Zahl) | 588–589 ms | 14 |
| Liste nach `property:load_note` (Text, natürlich) | 652–661 ms | 14 |
| Liste eines Projekts (`GET`) | 111 ms | 17 |
| Gruppen über alle Projekte | 50–252 ms | 5–7 |
| Gruppen eines Projekts | 22–34 ms | 7–10 |
| `/counts` mit 10 Filtern | 505 ms | 14 |
| Board eines Projekts (7 Antworten) | 391 ms | 70 |
| Item mit Kindern, Relationen, Typ, Workflow, Dateien | 77 ms | 43 |
| Kommentare / History eines Items | 22 / 19 ms | 10 |
| Suche (1–3 Wörter) | 20–33 ms | 13–18 |
| Wiki mit 2 000 Seiten | 204 ms | 4 |
| Ränge eines Projekts neu verteilen (2 500 Items) | 343 ms | 17 |
| Mehrfachbearbeitung 100 Items, 50 Webhooks | 1,03 s | 1 900 |
| ihr Konsum (15 000 Zustellungen, nur gemessen) | 10,2 s | 11 483 |
| Nacht: Auto-Close über 20 Projekte | 91 s | 156 000 |
| Vorlagenlauf mit 20 Bildern zu 2 MB | 221 ms | 176 |

  Lokal (DDEV): Seeden rund 23 s (Zeilen) plus 33 s (Suchindex), Datenbank rund 580 MB, Neuaufbau der Suche mit Tausch 9–10 s bei 30 MB.

## Offen (Phase 15 läuft)

- axe über alle Seiten und Zustände (A441, Tasks 15a, 15b, 16), Tastatur-Lücken (13 Abläufe in `GAPS`, Task 18), Screenshots beider Sprachen (A443, Tasks 22e, 22f), Landingpage, README und `docs.yml` für `https://werkbuch.dev` (A444, Task 23): warten auf Rafaels OK für die Entwicklungsdatenbank.
- Meilisearch v1.56.1 (Task 25, frühestens 2026-11-16), `serversideup/php` v5.1.x (Task 25b, ab 2026-11-18/19).
- Final-Review der ganzen Phase, voller G3 lokal, finale Fix-Welle (Minors der Reviews, die rote Nacht im Job `load`, `max_sort_length` der natürlichen Sortierung, nullable Stempel im OpenAPI-Dokument).
- Für Rafael: Titel „Erwähnte“ oder „Verwiesene Items verknüpfen“, zwei Inbox-Zeilen je Speichern bei `link_references`, Bestätigung der Spec-Änderungen vom 2026-11-07/08.
- Nach der Phase: DNS und Pages-Einstellung für `werkbuch.dev`, manuelle Tests nach `docs/superpowers/plans/2026-10-30-werkbuch-manual-tests.md`, Secrets für Docker Hub, Release-Commit und Tag `v0.1.0` nur nach Freigabe.

## Nachtrag

(Wird am Ende von Phase 15 ergänzt: Final-Review, voller G3, Merge von PR #32, letzte CI-Zahlen.)
