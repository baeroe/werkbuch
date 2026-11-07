# Phase 15: Feinschliff – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** werkbuch ist bereit für die manuellen Tests und danach für v0.1.0: die offenen Sicherheits- und Robustheitspunkte sind zu, die CI läuft je Projekt-Job sicher unter 60 Minuten und ohne bekannte Flakes, 50 000 Items in 20 Projekten laden ohne spürbare Wartezeit, jede Seite besteht axe (WCAG 2.2 AA) und jeder Ablauf geht nachweisbar nur mit der Tastatur (Erfolgskriterium 6), die noch gültigen Punkte der Deferred-Liste und die von Rafael vorgezogenen Punkte aus A447 (Ränge neu verteilen, Kinder seitenweise, natürliche Sortierung, Live für Nicht-Mitglieder, Kleinkram aus K20) sind erledigt, die Doku hat Screenshots aus deutschen und englischen Demo-Daten, eine Landingpage und einen Pages-Workflow für `https://werkbuch.dev`, und Rafael bekommt eine Checkliste für die manuellen Tests.

**Architecture:** Keine neue Fachlichkeit außer Block E2 (unten). Sicherheit: zwei zusätzliche Drosseln an Fortify (Konto ohne IP mit Ausnahme für ein bekanntes Gerät, TOTP je Tag), ein neues Passwort hebt beide auf, der Cache-Store wiederholt nur noch echte Deadlocks, Anmelde-Mails bekommen eine eigene Queue vor `default`. CI: der Abdeckungs-Build entsteht einmal, je Playwright-Projekt läuft ein eigener Job mit eigener Datenbank und lädt eine vorverdichtete Abdeckungsdatei hoch, ein Merge-Job führt die vier benannten Dateien zusammen. Last: ein deterministischer `LoadSeeder` (direkte Sammel-Inserts, Tiptap-JSON aus einem festen Pool) in einer eigenen, per Wächter geschützten Datenbank `load`, eine Testsuite `Load` mit eigenem TestCase, Zeit- und Abfrage-Budgets, danach Indizes und Bündelungen nur dort, wo eine Messung sie verlangt. Barrierefreiheit: `@axe-core/playwright` in einer Spec über alle Seiten und Zustände, ein Tastatur-Manifest, das jeden Katalog-Eintrag und jeden Ablauf einem Playwright-Test zuordnet und per Test vollständig gehalten wird. Doku: ein `DemoSeederEn` mit denselben Seedern und englischen Texten, zwei Playwright-Projekte nur für Screenshots (nicht in der CI), die die Entwicklungsdatenbank je Sprache frisch seeden, mit fester Browser-Uhr, Bilder unter `docs/public/screenshots/{en,de}/`, Pages-Workflow wie openbill, aber per SHA gepinnt, für `https://werkbuch.dev` mit Base `/`. Aus A447 vorgezogen: ein Server-Endpunkt verteilt die Ränge eines Projekts neu, `include=children` endet nach 100 Kindern und das Detail lädt den Rest seitenweise, Text-Properties sortieren über `natural_sort_key` und `Intl.Collator({ numeric: true })` gleich, und Projekt-Events erreichen Personen, die das Projekt sehen, aber seinen Kanal noch nicht halten, über ihren eigenen Kanal.

**Tech Stack:** wie Phase 14; neu: `@axe-core/playwright` 4.14.0 (nur `e2e/`, exakt gepinnt, vom 2026-10-15; am Tag der Task erneut prüfen), oxipng im Docker-Image per Digest (wie openbill), `actions/upload-pages-artifact`/`actions/deploy-pages` per SHA.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterien 1–8, besonders 6, 7, 8; 5.1–5.3 Tastatur und Kürzel; 7.5 Sicherheit; 9 Qualität, Last, CI; 10 Doku, Screenshots, `DOCS_BASE`; 11.5 manuelle Tests; 14 Risiken). Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Phase 15 „Liefert“ und „Abnahme“). Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A28, A61, A168, A180, A186, A187, A206, A216, A315, A318, A338, A406, A418, A420, A424, A428, A433; „Für spätere Phasen vorgemerkt“, Zeilen „Phase 15“ und „Nach v0.1.0“). `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (gegen den Code geprüft am 2026-11-07, Ergebnis in der Tabelle „Vormerkungen → Tasks“). Ledger `.superpowers/sdd/2026-10-30-werkbuch-app/progress.md` und `.superpowers/sdd/2026-11-07-phase-14-docker/{progress,final-review,cache-deadlock-review}.md`. **Preflight** `.superpowers/sdd/2026-11-07-phase-15-polish/preflight.md` (K1–K23; in diesen Plan eingearbeitet, die Tabelle „Task → K-Rulings“ dort nennt je Task die Befunde, die der Brief mitgibt). Vorbild für Screenshots und Pages: `~/development/baeroe/openbill` (`e2e/tests/docs-screenshots.spec.ts`, `e2e/optimize-screenshots.sh`, `e2e/playwright.config.ts`, `.github/workflows/docs.yml`, `tests/Unit/DocsTest.php` ab Z. 94).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 15 entscheidend:

- Branch `feat/phase-15-polish` von `main` **nach dem Merge von PR #30** (Phase 14). Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>`.
- **Kein Release.** `config('werkbuch.version')` bleibt `0.1.0-dev`, kein Tag, kein Push eines Images, kein Anlegen des Pages-Environments; die Pages-Einstellung (Source, Custom Domain) per API nur nach Rafaels ausdrücklicher Freigabe, die der Controller einholt, und nie aus einer Task; `docs.yml` wird nur angelegt (er läuft erst nach dem Merge auf `main`, Abschnitt „Nach der Phase“).
- **Keine neue Fachlichkeit** außer den Punkten, die Rafael aus A447 vorgezogen hat (Block E2: Ränge neu verteilen, Kinder seitenweise, natürliche Sortierung, Live für Personen ohne Projektkanal). Was das Verhalten für Nutzer ändert (Drosseln, bekanntes Gerät, `NOT NULL`, Queue `mail`, Block E2), steht als Ruling (ab A434) mit Grund und „Falls falsch“; Fachliches zusätzlich als „Änderungen vom 2026-11-xx“ in der Spec. Rafaels Antworten vom 2026-11-07 sind eingearbeitet (Abschnitt „Antworten von Rafael (2026-11-07)“); keine Entscheidung dieses Plans ist mehr vorläufig.
- PHP, Composer, Artisan, pnpm der App nur in DDEV; Playwright auf dem Mac. Neue Pakete nur `@axe-core/playwright` in `e2e/` (exakt gepinnt, Version ≥ 14 Tage alt am Tag der Task, im Bericht mit Datum). Kein neues Composer-Paket, keine neue Abhängigkeit im Root-`package.json`.
- Abdeckung bleibt 100 % Zeilen PHP und Frontend (Vitest + Playwright zusammengeführt) — auch nach dem Umbau der CI (Tasks 6a/6b): der Merge-Job scheitert unter 100 %. Die Grenze gilt nur für die Summe aus Vitest und allen vier Playwright-Projekten, nie für ein Projekt allein (Handy-Schublade, dunkles Theme, Touch-Menüs). Larastan Level 8, Pint, `tsc`.
- Der Pflicht-Job heißt weiter `tests`. Neue Jobs (`e2e-build`, `e2e (<projekt>)`, `e2e-coverage`, `load`, im Workflow `docs.yml` `pages`, `build`, `deploy`) sind keine Pflicht-Checks.
- **Messen vor Ändern (Last):** jede neue Index-Migration und jede Bündelung in den Tasks 9–13b nennt im Bericht die Messung davor und danach (Zeit aus der Suite `Load`, `EXPLAIN` der Abfrage, bei Bündelungen ohne eigene Zeile in `Load` die Abfragezahl des Feature-Tests vor und nach dem Fix). Ohne Messung kein Index.
- **Datenbank `load`:** nur über `phpunit.load.xml` (alle Env-Werte `force="true"`) und nur hinter dem Wächter von `LoadWorld::ensure()` (bricht ab, wenn die Verbindung nicht `load` heißt oder `scout.prefix` nicht `load_` ist). Die Last-Suite ruft nie `migrate:fresh` gegen eine andere Datenbank, nie `--env=load`. (Das `migrate:fresh` des Screenshot-Laufs, Task 22e, trifft bewusst die Entwicklungsdatenbank von DDEV und stellt am Ende den `E2eSeeder`-Stand her.)
- Barrierefreiheit: WCAG 2.2 AA; axe-Ausnahmen nur in `e2e/a11y-exceptions.ts` mit Regel, Selektor und Grund (wie `@codeCoverageIgnore`), nie über eine generierte ID (`:r12:`); ein Test hält die Datei ehrlich (Task 15a).
- Demo-, Last- und Screenshot-Daten nur fiktiv (`@example.com`, Feldwerk bzw. Fieldwork, `Lastprojekt NN`). Screenshots nur aus dem `DemoSeeder` (de) bzw. `DemoSeederEn` (en), je frisch geseedet, reproduzierbar per `pnpm --dir e2e docs:screenshots` mit fester Browser-Uhr; der Lauf setzt die Entwicklungsdatenbank am Ende per `migrate:fresh --seed --seeder=E2eSeeder` zurück; keine echten Hosts, Firmen, Kunden (Regel aus `~/development/baeroe/CLAUDE.md`).
- Doku en + de mit gleichen Dateinamen und Überschriften (`DocsTest`); README englisch; Pläne, Rulings, Checkliste, History deutsch.
- Tests müssen rot werden können (RED belegen). `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert.
- **e2e lokal:** die vier Varianten teilen eine Datenbank, `workers: 1` bleibt (Fallstrick „`--now` sendet alle offenen Sammlungen“). Nur die CI teilt nach Projekt.
- **Task-Größe:** jede Task ist ein Implementer-Lauf von etwa einer Stunde (K23). Tasks, deren Umfang erst eine Messung zeigt (10, 16, 18), teilt der Orchestrator nach der Messung (10a, 10b … bzw. 16a … je ≤ 1 h); der Brief nennt dann die Zeilen bzw. Ursachen.

## Review Focus

- **Drossel als Sperre gegen den Besitzer:** Wer die Adresse eines Kontos kennt, kann mit falschen Passwörtern die Konto-Drossel füllen (50 Fehlversuche schafft eine IP in 2,5 min). Erwartet: der Deckel ist hoch genug für Tippfehler einer Person (50 je Stunde), die Meldung nennt die Wartezeit in Minuten, „Passwort vergessen“ bleibt offen und ein neues Passwort hebt die Sperre auf, eine Anmeldung mit richtigem Passwort von einem **unbekannten** Gerät bleibt gesperrt, von einem **bekannten** (Cookie `werkbuch_device` aus einer früheren Anmeldung genau dieser Adresse) nicht; ein Erfolg leert den Zähler auch nach dem zweiten Faktor, und der Schlüssel enthält die Adresse klein, getrimmt und transliteriert (`Mara@…` = `mara@…`). → Task 1 (Tests „locks an account after the failures of many addresses“, „signs in from a known device while the account is locked“, „ignores the device cookie of another address“, „clears the account after the second factor“, „clears the account and the day of codes with a new password“, „keeps forgot-password open for a locked account“).
- **Projekt-Jobs, die sich gegenseitig stören oder Abdeckung verlieren:** Ein Projekt-Job ohne Abdeckungsdatei (abgebrochen, Artefakt fehlt, leer) darf den Merge nicht still grün lassen; ein roter Projekt-Job darf nicht hinter 100 % verschwinden. Erwartet: der Merge-Job verlangt die vier Projekte **beim Namen** und scheitert mit dem fehlenden Namen; er scheitert zuletzt auch, wenn ein Projekt-Job rot war (`needs.e2e.result`); die vorverdichtete Datei eines Projekts gibt dieselben Zeilen wie die rohen Dateien; `globalTeardown` merged lokal weiter wie bisher. → Tasks 6a/6b (Tests „needs the coverage of every project by name“, „gives the same lines whether runs are remapped one by one or together“, `WorkflowsTest`).
- **Last-Budget, das in der geteilten VM wackelt oder schönrechnet:** Wanduhr-Prüfungen schwanken (A187), gemerkte `scoped`-Instanzen sparen Abfragen, die eine echte Anfrage hätte. Erwartet: Budget je Antwort 1,5 s als Median von drei Läufen nach einem Aufwärmlauf, vor jedem Lauf `forgetScopedInstances()` und `Visibility::forget()`; die Abfragezahl ist die harte Zusicherung (unabhängig von 2 500 oder 50 000 Items); jede Zeile läuft und erscheint in der Tabelle, auch über Budget (`OVER_BUDGET` mit Task-Verweis statt `todo`); die Suite `Load` ist kein Pflicht-Check, ihre Zahlen stehen im Bericht. → Tasks 8a, 8b, 9–13b.
- **Die Last-Suite trifft die falsche Datenbank:** `migrate:fresh` gegen die Dev- oder Test-Datenbank wäre ein Datenverlust. Erwartet: `LoadWorld::ensure()` bricht vor jedem Schreiben ab, wenn die Datenbank nicht `load` oder das Präfix nicht `load_` ist (Test „refuses a database other than load“); `phpunit.load.xml` setzt jeden Wert mit `force="true"`. → Task 8a.
- **`NOT NULL` auf Zeitstempeln mit vorhandenen Zeilen:** Eine Datenbank aus der Entwicklung (Demo, e2e) hat vielleicht Items ohne `created_at`. Erwartet: die Migration füllt `null` aus der ULID (Zeit der Erzeugung) vor dem `NOT NULL`, die Spalten bekommen **weder** `DEFAULT` **noch** `ON UPDATE` (`explicit_defaults_for_timestamp`), der Rückweg lässt die Werte stehen; Cursor alter Listen sind danach 422 `field.cursor.invalid`, nie 500. → Task 9 (Tests „fills missing stamps from the ULID“, „has no default and no on-update on the stamps“, „refuses a cursor of the old shape“).
- **axe grün durch Wegsehen:** Eine Spec, die nur die Startansicht prüft, übersieht Dialoge, Palette, Vorschau, Menüs und den dunklen Modus. Erwartet: jede Seite aus `resources/js/pages` in allen vier Projekten, jeder Zustand aus `e2e/a11y-pages.ts` in `desktop-light`, `desktop-dark` und `phone-light`; ein Test hält die Liste gegen die Seitendateien; Ausnahmen nur mit Grund und ohne generierte IDs. → Tasks 15a, 15b, 16.
- **Tastatur-Nachweis als Behauptung:** Ein Manifest, das Tests nennt, die es nicht (mehr) gibt, die in einem Projekt übersprungen werden oder die die Maus benutzen. Erwartet: das Manifest nennt je Katalog-Eintrag, je Widget-Taste (`<gruppe>:<label-schlüssel>`) und je Ablauf eine Datei und einen Testtitel, die existieren; ein Test scheitert bei fehlendem Eintrag, unbekannter Datei oder Titel; die genannten Tests enthalten im Rumpf (Klammerzählung ab `test('…'`) kein `click(`, `hover(`, `dragTo(`, `tap(` und kein `page.mouse` (Ausnahme: das Ziehen in `board.spec.ts`/`wiki-tree.spec.ts`, das nie als Tastaturnachweis zählt); ein in einem Projekt übersprungener Test braucht für dieses Projekt einen zweiten Nachweis oder einen Eintrag in `PROJECT_GAPS` mit Grund. → Tasks 17a, 17b, 18.
- **Live verrät ein Projekt, das jemand nicht sieht:** die Nachricht über ein neues oder öffentlich gewordenes Projekt geht an Personenkanäle; eine ULID eines privaten Projekts an eine Person ohne Zugriff verriete dessen Existenz. Erwartet: Empfänger nur aus `Visibility::seeing` nach `Visibility::forget()`, keine Bots, keine Deaktivierten, nichts für ein Projekt in Löschung; feste Zahl Abfragen. → Task 21h (Tests „tells only members and org admins about a new private project“, „sends nothing for a project that is being deleted“).
- **Neuverteilen der Ränge ändert die Ordnung:** Erwartet: gleiche Ordnung nach `rank`, `id` vor und nach, archivierte Items eingeschlossen, kein `updated_at`, kein Event je Item, unter der Projektsperre gegen ein gleichzeitiges `PATCH rank`. → Task 21d.
- **Englische Demo-Daten laufen auseinander:** Erwartet: ein Fingerabdruck der Struktur (Handles, Kennungen, Keys, Beziehungen, Zahlen) ist für `DemoSeeder` und `DemoSeederEn` gleich; jeden Text-Schlüssel gibt es in beiden Sprachen; kein Deutsch in den englischen Texten. → Tasks 22a–22d.

## Gates

Regel A249, wie Phase 14:

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Mit Code unter `tests/Integration` dazu `ddev artisan test --testsuite=Integration --filter=<Name>`.
- **G2 (Frontend), je Task mit `resources/js`, `scripts/` oder `e2e/`-Typen:** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → grün, Schwellen gehalten; `pnpm --dir e2e typecheck` bei `e2e/`.
- **GL (Last), Tasks 8a–13b:** `ddev artisan test --configuration=phpunit.load.xml` → grün; die Tabelle der Messwerte aus der Ausgabe in den Bericht. **GL läuft nie parallel zu G1 oder G3** (dieselbe MariaDB, derselbe Meilisearch, CPU der VM).
- **G3 gezielt, je Task mit Playwright:** `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <specs>` → grün.
- **G3 voll, genau einmal je Phase:** nach Task 27, im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build`.
- **GD (Doku), Tasks 22e–24c:** `ddev exec pnpm --dir docs build` (Base `/` wie auf `werkbuch.dev`) → ohne tote Links; mit `DOCS_BASE=/werkbuch/` ebenso (Probe des CI-Jobs `docs`).

---

## Vormerkungen → Tasks

Geprüft gegen den Code am 2026-11-07 (Preflight K20). Was erledigt ist, steht nicht mehr hier.

| Vormerkung | Quelle | Wo |
|---|---|---|
| Login-Drossel je Konto ohne IP (fälschbarer Proxy), ohne Dauersperre der Besitzerin | Final-Review Phase 14, Preflight K1 | Task 1 |
| Tagesdeckel für fehlgeschlagene TOTP-Versuche je Konto | Rulings Z. 561 | Task 2 |
| `RetryingDatabaseStore` nur bei 1213/40001; Docblock `DatabaseLock`; API-Test mit echtem Store; Deadlock beim `update` von `increment` | Cache-Deadlock-Review M1–M5 | Task 3 |
| Eigene Queue für Anmelde-Mails (T5-M7, A418) | Rulings Z. 561 | Task 4 |
| Kein DB-Schutz „genau ein Standard-Bot“; Einladungs-Race-Test mit zwei Verbindungen | Rulings Z. 561 | Task 5a |
| `ReadCommitted::run`-Kanten; `/counts` 50 × 50 nur durch die API-Drossel begrenzt (P34); CSP der API-Doku nur Startansicht getestet | Rulings Z. 561 | Task 5b |
| e2e-Laufzeit 1 h 38 bei 120 min Grenze | Ledger Phase 13/14 (PRIO) | Tasks 6a, 6b |
| Flakes `bulk.spec.ts` (phone-light), `webhooks.spec.ts:31` (phone-dark), `QuerySearchTest` | Ledger Phase 13/14 | Task 7 |
| Last-Seeder 50 000 Items in 20 Projekten; Ziel 1,5 s (A187) | Master-Plan, Spec 9 | Tasks 8a, 8b |
| `coalesce`-Leer-Marke für `created_at`/`updated_at` nutzt keinen Index (A406) | Rulings Z. 561 | Task 9 |
| Indizes Property-Sortierung (P34), `name`/`label`/`identifier` der Listen (Phase 12), `blocked`/`blocking` je Zeile (T3-M3), redundante Abfragen in `Grouping` (T8-M4), `meta.total` je Seite (A28) | Rulings Z. 561 | Task 10 (a…) |
| `label.deleted` nur betroffene Items (A206); `workflow.updated` nur bei geänderter Kategorie | Rulings Z. 561 | Task 11a |
| Suche mit 50 000 Items messen; viele Kommentare je Dokument (A245); `ReindexWorkItems` in Blöcken mit eigenem Timeout | Rulings Z. 561 | Task 11b |
| Neuaufbau über zweiten Index und Tausch statt Leeren (A216); Neuaufbau lässt einen fremden Index stehen (T4-M1, Phase 6); `Meili::use` ohne Präfix-Prüfung | Rulings Z. 561, Preflight K14 | Task 12 |
| `QueueDeliveries` liest den Standard-Bot je Webhook (T6-M1); `announceAssignedBot` bündeln (T10-M8); Reihenfolge der Zustellungen je Item | Rulings Z. 561 | Task 13a |
| 50 Webhooks × Mehrfachbearbeitung von 100 Items; Payload-Größe; Benachrichtigungen bei Bulk-Änderungen (P3); Auto-Close über 50 000 Items; viele Vorlagen zur selben Minute; Kopien vieler Bilder je Vorlagenlauf (nur messen, wenn billig) | Master-Plan, Rulings Z. 561 | Task 13b |
| Erzeugung des OpenAPI-Dokuments (Zeit, Speicher, Laufzeit der Suite mit Vertrag); `tools/list` (107 KB, Budget 120 KB); `ListFlags` hart verdrahtet; Dauer des Pflicht-Jobs `tests` (K7) | Rulings Z. 561, Preflight K7 | Task 14 |
| `usePagedLists` rechnet `hashKey` bei `invalidate` neu statt `entry.hash` (Rest von T9-M3); `cachedItem` quadratisch (T15-M2); `measure` als `useLayoutEffect` ohne Abhängigkeiten (T13-M7, T21-M9) | Rulings Z. 561, Preflight K20 | Task 14b-1 |
| „Ohne Datum“ nicht virtualisiert (T21-M8); `useEpics` lädt alle Epics für den Namen eines Chips (T16-M1) | Rulings Z. 561 | Task 14b-2 |
| axe über alle Seiten | Master-Plan | Tasks 15a, 15b, 16 |
| Erfolgskriterium 6 nachweisen | Spec 1 | Tasks 17a, 17b, 18 |
| Restliche Punkte der Deferred-Liste | Deferred-Liste, Master-Plan, Preflight K20 | Tasks 19a–21c (Liste dort) |
| Kleinkram aus Rulings Z. 561, Ledger und Deferred, der in keiner anderen Task stand | Preflight K20 | Task 21c |
| Englische Demo-Daten für die englischen Screenshots | Rafaels Antwort 3 (A443) | Tasks 22a–22d |
| Screenshots, Landingpage, README, `docs.yml` für `werkbuch.dev`, Doku-Durchsicht | Master-Plan, Spec 10, Rafaels Antwort 1 (A444) | Tasks 22e–24c |
| Ränge eines Projekts neu verteilen (A180) | A447, Rafaels Antwort 5 | Tasks 21d, 21e |
| `include=children` mit Seiten (A186) | A447, Rafaels Antwort 5 | Task 21f |
| Text-Properties natürlich sortieren (A168), Eltern-Gruppen nach Kennung (T8-M7) | A447, Rafaels Antwort 5 | Task 21g |
| Live für Nicht-Mitglieder bei neuen und öffentlich gewordenen Projekten (Phase 8 M3) | A447, Rafaels Antwort 5 | Task 21h |
| Wiki-Reste aus Phase 9 (403 bei „darf“, Rückgängig nach „Neu laden“, Versionen eines gelöschten Projekts) | A447 (aus K20), Ledger Phase 9 | Task 21i |
| Verwaiste neue Datei nach Rollback, `CatalogProperties` vergessen, Docblocks `ItemOrder`, Test-Hygiene, Relevanz-Gegenproben, Seeder-Tests | A447 (aus K20), Deferred „→ 13c“ | Task 21j |
| `MemberInput` aufteilen | A447 (aus K20), Rulings Z. 561 | Task 21k |
| Phase-5-Punkte „→ 13c“: Felder, Filter, Listenzustand, `BoardReason` | A447 (aus K20), Deferred | Task 21l |
| N3, Satz ohne nächsten Schritt bei `c`, `savableDisplay`, Skelett-Wartezeit, Timeline-Ablehnung, Katalog-Tests, e2e-Helfer | A447 (aus K20), Deferred | Task 21m |
| T19-M5/M7 (Board-Test), T20-M2/M7 (Tabelle) | Deferred „→ 13c“ | Tasks 21e, 20a |
| Kopien vieler und großer Bilder je Vorlagenlauf | A447 (aus K20) | Task 13b (Messung) |
| `serversideup/php` v5.1.x | A447, Phase-14-Final-Review | Task 25b |
| Offene Minors Phase 14 (IPv6 in `LiveAddress` und Healthcheck, Upload-Warnung, `DB_WAIT_TIMEOUT`, Dockerfile-Kommentar `server-opts.d`, Spec 4.16 im Änderungsblock, `RouteCacheTest`-Meldungen); Meilisearch v1.56.1 und `serversideup/php` v5.1.x nur nach der Zwei-Wochen-Regel | Phase-14-Ledger, Final-Review | Task 25 |
| Checkliste manuelle Tests, `docs/history/`, CLAUDE.md final | Master-Plan | Tasks 26, 27 |

**Bewusst nach v0.1.0** (Ruling A447, mit Grund; verkleinert durch Rafaels Antwort 5 vom 2026-11-07): `RemapStates` als ein `UPDATE` je Paar (nur, wenn Task 10 es über dem Budget misst), `affected_items` nur über Typen mit der Property (A61), Reverb mit `ext-uv` (A428), S3 (A424), Live-Invalidierung je Projekt (Phase 8 M5), Vorschauen für GIF/AVIF (A237), Versionen der Wiki-Seiten ausdünnen, Erinnerungen nachholen, einzelnen fehlgeschlagenen Job erneut versuchen in der Oberfläche, Bündeln vieler Benachrichtigungen je Person (P3, nur Messung in Task 13b), Screenshots im README des eingefrorenen Klickdummys, `mcp:inspector` ohne `npx`, schlanke Env für Reverb und `cap_drop`/`read_only` (A429), zwei Web-Container mit geteiltem `.tmp` (T3b-M1). **Vorgezogen in Phase 15** (Block E2, Tasks 13b, 20a, 25b): Umverteilen der Ränge (A180 → A448), `include=children` mit Seiten (A186 → A449), Text-Properties natürlich sortieren (A168 → A450), Live für Nicht-Mitglieder bei neuen oder öffentlich gewordenen Projekten (Phase 8 M3 → A451) und alle Punkte, die Preflight K20 nach A447 gelegt hatte: verwaiste neue Datei nach einem Rollback, schärfere Relevanz-Gegenproben (T7-M1–M4), N3, Vorlagen mit vielen und großen Bildern je Lauf (Messung in 13b), `MemberInput` aufteilen, die drei Wiki-Reste aus Phase 9, die offenen Phase-5-Punkte „→ 13c“ (Triage gegen den Code vom 2026-11-07; erledigt bzw. hinfällig und darum nicht in einer Task: Palette-Befehle `projects.create`/`views.create`, Suche ≤ 10 s veraltet (`staleTime: 0`), Kopfzahl der Inbox, „Kind-Item anlegen“ gesperrt mit Grund, ⇧P auf Boards, „Teil von“ an `ItemCard`) und `serversideup/php` v5.1.x.

## Dateistruktur (neu oder wesentlich geändert)

| Ort | Inhalt |
|---|---|
| `app/Auth/AccountLoginRateLimiter.php`, `app/Auth/KnownDevice.php` | Fortifys `LoginRateLimiter` plus Konto-Deckel, Cookie „bekanntes Gerät“ (Task 1) |
| `app/Support/RetryingDatabaseStore.php` | nur noch 1213/40001 (Task 3) |
| `app/Support/BotIds.php` | IDs der Bots je Anfrage, `scoped` (Task 13a) |
| `.github/workflows/tests.yml` | Jobs `e2e-build`, `e2e` (Matrix), `e2e-coverage` (Task 6b), `load` (Task 8b) |
| `.github/workflows/docs.yml` | GitHub Pages für `https://werkbuch.dev` mit Prüfung, ob Pages an ist (Task 23) |
| `e2e/global-teardown.ts`, `e2e/fixtures.ts`, `scripts/coverage-merge.mjs` | Abdeckung je Projekt in Unterordnern, `--remap-only`, `--expect-shards=<namen>` (Task 6a) |
| `database/seeders/LoadSeeder.php`, `database/seeders/Load/*` | 50 000 Items, deterministisch, Tiptap-Pool (Task 8a) |
| `phpunit.load.xml`, `tests/Load/{LoadTestCase,LoadWorld}.php`, `tests/Load/*Test.php`, `tests/Load/Support/*` | Suite `Load` gegen die Datenbank `load` (Tasks 8a, 8b, 11b, 13b) |
| `database/migrations/2026_11_08_000200_make_item_stamps_required.php` | `created_at`/`updated_at` NOT NULL ohne Default (Task 9) |
| `e2e/tests/a11y.spec.ts`, `e2e/a11y-pages.ts`, `e2e/a11y-exceptions.ts`, `scripts/a11y-pages.test.mjs` | axe (Tasks 15a, 15b) |
| `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs` | Tastatur-Manifest (Tasks 17a, 17b) |
| `database/seeders/DemoSeederEn.php`, `database/seeders/Demo/Texts/{DemoTexts,German,English}.php`, `database/seeders/Demo/files/en/*`, `tests/Feature/Seeders/{EnglishDemoTexts,EnglishDemoItems,EnglishDemoContent,DemoLanguages}Test.php` | Englische Demo-Daten (Tasks 22a–22d) |
| `e2e/tests/docs-screenshots.spec.ts`, `e2e/tests/docs-seed.setup.ts`, `e2e/optimize-screenshots.sh`, `docs/public/screenshots/{en,de}/*.png` | Screenshots (Tasks 22e, 22f) |
| `docs/public/CNAME` | Custom Domain `werkbuch.dev` (Task 23) |
| `app/Actions/WorkItems/RedistributeRanks.php` | Ränge neu verteilen (Task 21d) |
| `app/Support/{ProjectLock,ProjectMembership}.php` | statt `MemberInput` (Task 21k) |
| `resources/js/domain/natural-sort-fixtures.json`, `tests/Integration/NaturalSortTest.php` | Natürliche Sortierung (Task 21g) |
| `docs/superpowers/plans/2026-10-30-werkbuch-manual-tests.md` | Checkliste (Task 26) |
| `docs/history/2026-11-xx-werkbuch-bis-v0.1.0.md` | History (Task 27) |

## Task-Übersicht

| Task | Inhalt | Modell |
|---|---|---|
| 1 | Login-Drossel je Konto mit bekanntem Gerät | opus |
| 2 | TOTP-Tagesdeckel | sonnet |
| 3 | Cache-Store: nur echte Deadlocks wiederholen | sonnet |
| 4 | Queue `mail` für Anmelde-Mails | sonnet |
| 5a | Ein Standard-Bot in der Datenbank, Einladungs-Race | opus |
| 5b | `ReadCommitted`, `/counts`-Grenze, CSP der API-Doku | opus |
| 6a | Abdeckung je Projekt: Skripte und Fixture | opus |
| 6b | CI: e2e je Projekt, Merge-Job | opus |
| 7 | Flakes | opus |
| 8a | Last-Seeder, Datenbank `load`, `LoadWorld` | opus |
| 8b | Budget, `ApiLoadTest`, CI-Job `load` | opus |
| 9 | Zeitstempel der Items `NOT NULL`, Leer-Marke weg | opus |
| 10 (a…) | Listen, Gruppen, Zählungen, Board unter Last (geteilt nach 8b) | opus |
| 11a | Gezieltes Neuindexieren (Label, Kategorie) | opus |
| 11b | Neuindexieren in Blöcken, `SearchLoadTest` | opus |
| 12 | Neuaufbau der Suche mit Tausch | opus |
| 13a | Standard-Bot je Event, Bots einer Mehrfachbearbeitung | opus |
| 13b | `WorkLoadTest`: Webhooks, Bulk, Nacht, Vorlagen | opus |
| 14 | OpenAPI und MCP: Zeit und Größe; Dauer von `tests` | sonnet |
| 14b-1 | Frontend-Leistung: `entry.hash`, `cachedItem`, `measure` | opus |
| 14b-2 | Frontend-Leistung: „Ohne Datum“ virtualisiert, Eltern-Chip | opus |
| 15a | axe: Paket, Liste, Seiten | opus |
| 15b | axe: Zustände, erste Befundliste | opus |
| 16 (a…) | axe-Befunde beheben | opus |
| 17a | Tastatur-Manifest: Test, Kürzel und Widgets | opus |
| 17b | Tastatur-Manifest: Abläufe | opus |
| 18 (a…) | Fehlende Tastatur-Abläufe | opus |
| 19a | Deferred A1: Lese-Look, Mitglieder ohne Mitglieder | opus |
| 19b | Deferred A2: Skelette, Timeline leer, Fehlergrenze, Ladesätze | opus |
| 20a | Deferred B1: Tabelle | opus |
| 20b | Deferred B2: Liste, Board, Filter-Chips, `MobileBar`, Relationen-Dialog | opus |
| 21a | Deferred C1: Backend (`DisplaySchema`, `FilterSchema`, `ItemOrder`, `GetSystemStatus`) | sonnet |
| 21b | Deferred C2: Frontend (Invalidierung, `reloadedFor`, `q`, `toast.ts`) | sonnet |
| 21c | Deferred C3: Kleinkram Tests, e2e und Rulings | sonnet |
| 21d | Ränge eines Projekts neu verteilen (Server) | opus |
| 21e | Ränge neu verteilen (Board) | opus |
| 21f | Kinder eines Epics seitenweise | opus |
| 21g | Text-Properties und Kennungen natürlich sortieren | opus |
| 21h | Live-Updates für Personen ohne Projektkanal | opus |
| 21i | Wiki: drei Reste aus Phase 9 | opus |
| 21j | Kleinkram aus K20: Backend und Tests | sonnet |
| 21k | `MemberInput` aufteilen | sonnet |
| 21l | Kleinkram aus K20: Frontend A (Felder, Filter, Listenzustand) | opus |
| 21m | Kleinkram aus K20: Frontend B (Board, Timeline, Kataloge, Kommentare, e2e) | sonnet |
| 22a | Englische Demo-Daten: Mechanismus, Organisation, Personen, Katalog, Projekte, Views | opus |
| 22b | Englische Demo-Daten: Items, Aktivität, Kommentare, Dateien | sonnet |
| 22c | Englische Demo-Daten: Wiki, Vorlagen, Inbox, Webhooks, Automatisierungen | sonnet |
| 22d | Englische Demo-Daten: ganzer Lauf, Gleichheit beider Fassungen | sonnet |
| 22e | Screenshots: Projekte, Setup, fünf Shots | opus |
| 22f | Screenshots: übrige Shots, alle ansehen | opus |
| 23 | Landingpage, README, `docs.yml` für `werkbuch.dev` | sonnet |
| 24a | Doku-Durchsicht: Setup, Betrieb, Entwicklung | opus |
| 24b | Doku-Durchsicht: Konzepte | opus |
| 24c | Doku-Durchsicht: API, MCP, Webhooks, Suche, Tastatur, Bots | opus |
| 25 | Offene Minors aus Phase 14 (nicht vor dem 2026-11-16) | sonnet |
| 25b | `serversideup/php` v5.1.x (nicht vor dem 2026-11-19) | sonnet |
| 26 | Checkliste manuelle Tests | opus |
| 27 | History, CLAUDE.md, Rulings, Spec, Master-Plan | opus |

58 Tasks (ohne die Teilungen von 10, 16, 18 nach Messung), davon 16 sonnet.

**Reihenfolge** wie die Tabelle, mit diesen Abhängigkeiten:
- 5a vor 5b (beide in `tests/Integration`, `RaceConnections`).
- 6a vor 6b; 6b vor allen Tasks, die Specs anlegen oder ändern (15a, 17b, 18, 21e, 21f, 21h, 22e: neue Specs landen gleich in den Projekt-Jobs; `docs-screenshots.spec.ts` und `docs-seed.setup.ts` sind dort ausgeschlossen).
- 8a vor 8b; 8b vor 9–13b und 14 (Messung davor). 9 vor 10 (die Zeilen `sort=created_at|updated_at` sind danach keine Ursache mehr für 10). 10 wird nach 8b nach `OVER_BUDGET` geteilt (K13). 11a vor 11b vor 12 (alle drei in `app/Search`, 11b misst `rebuild()` vor dem Tausch). 13a vor 13b (13b misst den Stand nach der Bündelung).
- 15a vor 15b vor 16; 17a vor 17b vor 18.
- 19b nach 16 (die Verzögerung der Skelette ersetzt die Ansagen, die 16 sonst einzeln behöbe); 20b vor 21e (beide ändern das Board: `BoardLayout.tsx`, Board-Tests); 21a nach 10 (beide ändern `ItemOrder`).
- Block E2: 21d vor 21e; 21g nach 10, 21a und 21j (alle ändern `ItemOrder`; 21j nur Docblocks) und nach 8b (GL-Zeile); 21d nach 8b (GL-Zeile); 21f nach 8b; 21h nach 6b; 21i nach 19b; 21k nach 21d und 21j (benennt `MemberInput` um, das 21d noch nutzt) und vor 22a; 21l nach 20b und 21b (Filter, Listen); 21m nach 19b (Skelette) und 21l.
- 22a vor 22b vor 22c vor 22d (alle in `database/seeders/Demo`); 21j vor 22a (beide ändern `ViewsSeeder`/`FavoritesSeeder` bzw. deren Tests).
- 16, 18, 19a–21m und 22d vor 22e (Screenshots zeigen den Endstand, die englischen brauchen `DemoSeederEn`); 22e vor 22f vor 23 (Landingpage und README zeigen die Bilder); 23 vor 24a–24c.
- **25 nicht vor dem 2026-11-16** (Meilisearch v1.56.1 erfüllt erst dann die Zwei-Wochen-Regel), **25b nicht vor dem 2026-11-19** (`serversideup/php` v5.1.1), 25 vor 25b (beide ändern Image-Tests und Smoke). Ist 24c früher fertig, läuft 26 vor 25/25b (die Checkliste hängt an keinem Punkt davon); 27 läuft immer nach 25b.
- Alle vor 26 (außer 25, 25b, siehe oben) und 27.

---

## Block A: Sicherheit und Robustheit

### Task 1: Login-Drossel je Konto mit bekanntem Gerät

**Modell:** opus (Sicherheit, drei Wege: Passwort, zweiter Faktor, neues Passwort; K1)

Heute zählt Fortifys `LoginRateLimiter` Fehlversuche je `lower(email)|IP` (5, dann 60 s), dazu `login_per_ip` (20/min über alle Adressen). Hinter einem Proxy, dessen `X-Forwarded-For` werkbuch vertraut und der fälschbar ist (Docker-Gateway, `reverse-proxy.md`), wechselt ein Angreifer die IP je Versuch: unbegrenzt viele Passwörter gegen ein Konto. Neu ein Deckel je Adresse ohne IP (A434). Damit er die Besitzerin nicht dauerhaft aussperrt (50 Fehlversuche schafft eine IP in 2,5 min, stündlich wiederholbar), gilt er nicht für ein **bekanntes Gerät** (OWASP „device cookies“), ein Erfolg leert ihn auch nach dem zweiten Faktor, und ein neues Passwort hebt ihn auf.

`LoginRateLimiter::tooManyAttempts` läuft in `EnsureLoginIsNotThrottled` **vor** der Passwortprüfung (`FortifyServiceProvider.php:58-64`): ein gesperrtes Konto kommt auf einem unbekannten Gerät auch mit dem richtigen Passwort nicht durch, das ist gewollt. `EnsureLoginIsNotThrottled`, `AttemptToAuthenticate`, `RedirectIfTwoFactorAuthenticatable`, `PrepareAuthenticatedSession` und `LockoutResponse` bekommen den Limiter per Konstruktor: eine Bindung erreicht alle fünf, die Pipeline bleibt (A445). Fortify ruft `increment` nur bei Fehlversuchen und `clear` nur in `PrepareAuthenticatedSession` — bei Konten mit zweitem Faktor endet die Pipeline vorher in `RedirectToTwoFactorChallenge`, und `TwoFactorChallengeController::store` leert heute nichts.

**Files:**
- Create: `app/Auth/AccountLoginRateLimiter.php`, `app/Auth/KnownDevice.php`, `tests/Feature/Auth/AccountLoginThrottleTest.php`
- Modify: `app/Providers/FortifyServiceProvider.php` (Bindung, `Event::listen(Login::class, …)`, Kommentar über der Pipeline), `app/Http/Controllers/Auth/TwoFactorChallengeController.php` (leert nach dem Erfolg), `app/Actions/Auth/SetPassword.php` (leert Konto- und Tageszähler), `app/Exceptions/Rendering.php` (Satz mit Minuten ab 120 s), `lang/{en,de}/auth.php` (`throttle_minutes` mit `:minutes`), `config/werkbuch.php` (`rate_limits.login_per_account` 50, `rate_limits.login_account_decay` 3600), `docs/{en,de}/operations.md` (Abschnitt Drosseln: Konto-Deckel, bekanntes Gerät, neues Passwort hebt auf), `CLAUDE.md` („Anmeldung“: Drosseln dreistufig, bekanntes Gerät; Fallstricke)

**Interfaces:**
- `App\Auth\AccountLoginRateLimiter extends Laravel\Fortify\LoginRateLimiter` (final), im Container `singleton(LoginRateLimiter::class, AccountLoginRateLimiter::class)`.
  - `tooManyAttempts($request)` = Elternregel **oder** (`attempts(accountKey) >= login_per_account` **und nicht** `KnownDevice::matches($request, <Adresse>)`).
  - `increment($request)` erhöht beide (Konto mit Abklingzeit `login_account_decay` s); `availableIn($request)` = das Maximum beider Zähler, die greifen; `clear($request)` leert beide.
  - `clearAccount(string $email): void` leert nur den Konto-Zähler (für `TwoFactorChallengeController` und `SetPassword`).
  - `accountKey` = `'login-account:'.Str::transliterate(Str::lower(Str::trim(<Adresse>)))` (wie Fortify: `Ä` und `ä` zählen gleich); ohne Text (fehlt, Liste) zählt nur die Elternregel. Der Schlüssel enthält nie die IP.
- `App\Auth\KnownDevice` (final): `NAME = 'werkbuch_device'`; `remember(Login $event): void` setzt per `Cookie::queue` den Wert `hash_hmac('sha256', <adresse wie oben>, config('app.key'))` für ein Jahr, `httponly`, `samesite=lax`, `secure` wie `session.secure` (verschlüsselt über `EncryptCookies` wie jedes Cookie); `matches(Request $request, string $email): bool` vergleicht mit `hash_equals`. Registriert per `Event::listen(Login::class, [KnownDevice::class, 'remember'])` im `FortifyServiceProvider`, **nicht** unter `app/Listeners` (Fallstrick Event-Discovery: liefe doppelt). `Login` feuert nach der Anmeldung mit Passwort und nach dem zweiten Faktor (`guard->login`), beide Wege setzen das Cookie.
- `TwoFactorChallengeController::store`: nach dem Erfolg `app(LoginRateLimiter::class)->clearAccount($user->email)`.
- `SetPassword`: leert `login-account:<adresse>` (über `clearAccount`) und `two-factor-day:<id>` (Task 2). Wer per Mail ein neues Passwort setzt, hat das Postfach bewiesen.
- Meldung: Fortifys `LockoutResponse` übergibt `seconds` und `minutes` an `auth.throttle`; `Rendering` nimmt ab 120 s `auth.throttle_minutes` („Too many sign-in attempts. Try again in :minutes minutes.“ / „Zu viele Anmeldeversuche. Versuch es in :minutes Minuten wieder.“), darunter bleibt `auth.throttle`. Lässt sich die Wahl in `Rendering` nicht treffen (die `ValidationException` trägt nur den fertigen Satz), bindet die Task eine Unterklasse von `LockoutResponse` — der Bericht sagt, welcher Weg.
- „Passwort vergessen“ zählt nicht mit und bleibt offen; die Zwei-Faktor-Seite hat ihre eigene Drossel (Task 2).

- [ ] **Step 1: Failing Tests** — `AccountLoginThrottleTest` (je Test `cache:clear` im `beforeEach`, `config(['werkbuch.rate_limits.login_per_account' => 3])` für kurze Tests; Konto mit zweitem Faktor wie in `TwoFactorLoginTest`):
  - „locks an account after the failures of many addresses“: drei Fehlversuche von `10.0.0.1`, `10.0.0.2`, `10.0.0.3` (`withServerVariables(['REMOTE_ADDR' => …])`) → der vierte von `10.0.0.4` **mit richtigem Passwort** ohne Gerät antwortet mit dem Sperrfehler an `email`, keine Sitzung.
  - „says the wait in minutes“: der Satz nennt `:minutes` (aufgerundet), nicht 3540 Sekunden; unter 120 s bleibt der Sekundensatz.
  - „counts the address in any case, with spaces and accents“: `Mara@Example.com `, `mara@example.com` zählen auf denselben Schlüssel; `Ä…` und `ä…` ebenso.
  - „clears the account after a sign-in“: zwei Fehlversuche, dann Erfolg, dann wieder drei Fehlversuche möglich, bevor gesperrt wird.
  - „signs in from a known device while the account is locked“: erst eine erfolgreiche Anmeldung (Cookie `werkbuch_device` aus der Antwort), Abmelden, Konto über drei fremde IPs gesperrt, dann mit dem Cookie und richtigem Passwort → angemeldet.
  - „ignores the device cookie of another address“: Cookie von Konto B, Konto A gesperrt → bleibt gesperrt.
  - „sets the device cookie after the second factor“ und „clears the account after the second factor“: zwei Fehlversuche, Passwort richtig, Code richtig → Cookie gesetzt, Zähler leer.
  - „clears the account and the day of codes with a new password“: Konto gesperrt, Tageszähler voll (Task 2 noch nicht da: Schlüssel direkt per `RateLimiter::hit`), Reset über `POST /reset-password` → beide Schlüssel leer, Anmeldung geht.
  - „leaves other accounts alone“: Konto A gesperrt, Konto B meldet sich von derselben IP an.
  - „keeps forgot-password open for a locked account“: `POST /forgot-password` → wie sonst (Status, keine 429).
  - „releases after the decay“: `$this->travel(3601)->seconds()` → Anmeldung geht.
  - `LoginThrottleTest` (bestehend) bleibt unverändert grün: hält die Pipeline fest.
- [ ] **Step 2: RED** — `ddev artisan test --filter='AccountLoginThrottle|LoginThrottle'` → die neuen scheitern (vierter Versuch meldet an).
- [ ] **Step 3: Umsetzen** wie unter Interfaces.
- [ ] **Step 4: G1;** G3 gezielt `login.spec.ts two-factor.spec.ts password-reset.spec.ts`.
- [ ] **Step 5: Commit** — `fix: cap failed sign-ins per account across all addresses, except on a known device`.

### Task 2: TOTP-Tagesdeckel

**Modell:** sonnet

Die Drossel `two-factor` lässt je Anmeldung 5 Codes je Minute zu (`login.id` ist die ID des Kontos), also bis 7 200 am Tag; mit Fenster ±1 (drei gültige Codes) liegt die Trefferchance bei rund 2,2 % je Tag. Neu: höchstens 30 Versuche je Konto und 24 h, Codes und Recovery-Codes zusammen (A435). Die Drossel ist eine Middleware (`routes/auth.php:23`) und zählt **jeden** POST, auch den erfolgreichen; das bleibt (30 Anmeldungen mit zweitem Faktor an einem Tag kommen bei einer Person nicht vor), darum spricht der Satz von „Versuchen“, nicht von „falschen Codes“.

**Files:**
- Modify: `app/Providers/FortifyServiceProvider.php` (`RateLimiter::for('two-factor', …)` gibt `[Limit::perMinute(5)->by(<id>), Limit::perDay(30)->by('two-factor-day:'.<id>)]`), `config/werkbuch.php` (`rate_limits.two_factor_per_day` 30), `lang/{en,de}.json` (`two_factor_challenge.locked` mit `:hours`, aufgerundet, mindestens 1: en „Too many attempts today. Try again in :hours hours, or ask the operator of werkbuch to reset your second factor.“, de „Heute zu viele Versuche. Versuch es in :hours Stunden wieder oder lass deinen zweiten Faktor vom Betreiber von werkbuch zurücksetzen.“; Org-Admins können es in der Oberfläche nicht, nur `app:reset-two-factor`), `app/Exceptions/Rendering.php` (der 429 der Challenge nennt bei mehr als 60 s Wartezeit diesen Satz statt des Minutensatzes), `tests/Feature/Auth/TwoFactorLoginTest.php` (die Fälle der Challenge stehen dort; eine Datei `TwoFactorChallengeTest.php` gibt es nicht), `docs/{en,de}/concepts/permissions.md` (ein Satz beim zweiten Faktor; steht dort nichts dazu, dann `operations.md`, Abschnitt Drosseln), `CLAUDE.md`
- `SetPassword` leert `two-factor-day:<id>` schon seit Task 1; diese Task belegt es mit dem echten Zähler.
- Ohne `login.id` (abgelaufen) bleibt es bei der Weiterleitung auf `/login` (`FindChallengedUser`); solche Anfragen teilen sich den Schlüssel `two-factor-day:` (leer), das belastet kein Konto.

- [ ] **Step 1: Failing Tests** in `TwoFactorLoginTest`:
  - „allows 30 attempts a day per account, over several sign-ins“ (`two_factor_per_day` 30, je fünf Versuche `$this->travel(61)->seconds()`, neue Anmeldung mit Passwort dazwischen: der 31. Versuch → Fehler `two_factor_challenge.locked` am Feld `code`, ein richtiger Code wird nicht mehr geprüft).
  - „counts recovery codes too“; „counts a successful code too“.
  - „starts again the next day“ (`travel(1)->days()`).
  - „starts again after a new password“ (Reset über `POST /reset-password` → 31. Versuch geht).
  - „burdens no account without a challenge“ (POST ohne `login.id` → Weiterleitung `/login`, der Tageszähler des Kontos bleibt 0).
  - „keeps the limit of five a minute“ (bestehend, grün).
- [ ] **Step 2: RED** — der 31. Versuch kommt durch.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1;** G3 gezielt `two-factor.spec.ts`.
- [ ] **Step 5: Commit** — `fix: cap second-factor attempts per account and day`.

### Task 3: Cache-Store wiederholt nur echte Deadlocks

**Modell:** sonnet

A433 wiederholt auch „Lock wait timeout exceeded“: außerhalb einer Transaktion wartet jeder Versuch bis `innodb_lock_wait_timeout` (50 s), schlimmstenfalls 150 s je Anfrage (Review M1). Der Grund: `causedByConcurrencyError` kommt aus dem Trait `DetectsConcurrencyErrors`, und `ConcurrencyErrorDetector` erkennt „Lock wait timeout“ über den Text. Neu nur SQLSTATE 40001 bzw. MariaDB-Fehler 1213 (A436, ändert A433).

**Files:**
- Modify: `app/Support/RetryingDatabaseStore.php` (`causedByConcurrencyError` → eigenes `isDeadlock(Throwable): bool`: `QueryException` mit `errorInfo[1] === 1213` oder SQLSTATE `40001`; der Trait entfällt dort), `tests/Integration/CacheDeadlockTest.php`, `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A433 um „geändert durch A436“ ergänzen, nur der Verweis), `CLAUDE.md` („Grenzen der API“, Fallstricke)
- Docblock richtigstellen: `DatabaseLock::release` und `pruneExpiredLocks` schlucken ihre Fehler; werfen können das `update` in `acquire`, `refresh` und `forceRelease`; betroffen sind nur Jobs und Scheduler.

- [ ] **Step 1: Failing Tests** — in `CacheDeadlockTest`:
  - „passes a lock wait timeout through at once“ (zwei Verbindungen wie bisher, Lock-Wait 1 s → genau ein Versuch, die `QueryException` fliegt). Der bestehende Fall „waits again for a lock … until the cache gave up“ wird damit umgedreht (er erwartete drei Versuche) und heißt danach so.
  - „retries a deadlock on the update of increment“ (`beforeExecuting` wirft einmal 1213 vor `update \`cache\``; `increment` ergibt danach genau +1).
  - „uses the retrying store for the rate limiter of the app“ (`config(['cache.default' => 'database'])`, `app()->forgetInstance(RateLimiter::class)`, Store des `RateLimiter` per Reflection ist `RetryingDatabaseStore`).
  - Fall `add` prüft zusätzlich `get('other') === 5`.
- [ ] **Step 2: RED** — der Lock-Wait-Fall zählt drei Versuche.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1** + `ddev artisan test --testsuite=Integration --filter=CacheDeadlock`.
- [ ] **Step 5: Commit** — `fix: retry cache statements only on a deadlock, never on a lock wait`.

### Task 4: Queue `mail` für Anmelde-Mails

**Modell:** sonnet

Reset-Link und Einladung stehen heute in `notifications` hinter `default` und `live`; jedes Event macht Jobs auf `default`, und eine Mehrfachbearbeitung oder ein Import verzögert so die Mail, auf die jemand vor dem Bildschirm wartet (T5-M7, A418). Neu: Queue `mail` vor `default` im Dienst `queue` (A437). Andere Mails, auf die jemand wartet, gibt es nicht (die Testmail geht synchron, der zweite Faktor hat keine Mail).

**Files:**
- Modify: `app/Actions/Auth/SendPasswordResetLink.php` (`jobQueue` `mail`), `app/Notifications/{ResetPasswordNotification,InvitationNotification}.php` (`onQueue('mail')`; die Einladung schickt `app/Actions/Invitations/InviteUser.php:118`), `config/werkbuch.php` (`queues` = `['mail', 'default', 'live', 'notifications', 'webhooks', 'search', 'media', 'bulk']`), `.ddev/config.yaml` (Daemon `queue`: `--queue=mail,default,live,notifications,bulk`), `.github/workflows/tests.yml` (Worker der e2e), `docker-compose.yml`, `docker-compose.standalone.yml` (Dienst `queue`), `tests/Feature/ConfigTest.php`, `tests/Feature/Docker/ComposeTest.php` (erwartet den Befehl wörtlich, Z. 247), `tests/Feature/Auth/PasswordResetTest.php` (vier Stellen hängen am Namen `notifications`, Z. 102, 137, 139, 197, auch `queue:work --queue=notifications` → `mail`), `tests/Feature/InvitationTest.php`, `docs/{en,de}/operations.md` (Queue-Tabelle), `docs/{en,de}/development.md` (Z. 88 nennt heute falsch „two workers … default,live,notifications,webhooks,bulk“; richtig: drei Worker samt `mail`), `CLAUDE.md` (Kommandos/Ports: Worker-Listen; Fallstricke „Mails für Passwort vergessen“)

- [ ] **Step 1: Failing Tests** — `PasswordResetTest` und `InvitationTest` erwarten Queue `mail` (`Queue::fake()`, `assertPushedOn('mail', …)`; die Wiederholungs-Tests arbeiten mit `--queue=mail`); `ConfigTest` „lists mail first in the worker of DDEV, CI and Compose“; `ComposeTest` mit dem neuen Befehl.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** dann `ddev restart`.
- [ ] **Step 4: G1;** G3 gezielt `password-reset.spec.ts invitation.spec.ts onboarding.spec.ts`.
- [ ] **Step 5: Commit** — `fix: send sign-in mails on a queue of their own ahead of default`.

### Task 5a: Ein Standard-Bot in der Datenbank, Einladungs-Race

**Modell:** opus

**Files:**
- Create: Migration `database/migrations/2026_11_08_000100_guard_one_default_bot.php`, `tests/Integration/InvitationRaceTest.php`, `tests/Integration/DefaultBotGuardMigrationTest.php`
- Modify: `app/Models/User.php` (`$hidden` um `default_bot_guard`), Tests dazu, `CLAUDE.md` („Organisation und Projekte“: Datenbank hält genau einen Standard-Bot)

**Interfaces:**
- **Ein Standard-Bot:** Spalte `default_bot_guard` als `tinyint` *virtual generated* `IF(is_default_bot, 1, NULL)` mit `unique` (MariaDB erlaubt `UNIQUE` auf einer `VIRTUAL` erzeugten Spalte, mehrere `NULL` sind erlaubt); der Rückweg entfernt beides. Ein zweites `is_default_bot = true` scheitert an der Datenbank (`UniqueConstraintViolationException`). `EnsureDefaultBot` bleibt idempotent. Die Spalte steht in jedem `select *` von `users`: `User::$hidden` nimmt sie aus `toArray()` (Event-`changes` aus Schnappschüssen, Debugausgaben).
- **Einladung:** Zwei gleichzeitige `AcceptInvitation` derselben Einladung → genau ein Konto zur Adresse, die zweite bekommt den Zustand `closed`. Über `RaceConnections`: `hold()` (die erste nimmt an und bleibt offen), `releaseBeforeLock('invitations')` (die erste committet in dem Moment, in dem die zweite sperrt), `second(fn () => AcceptInvitation::run(…))` liest danach `accepted_at` (`AcceptInvitation.php:49`). Nicht `expectLockWait`: das erwartet einen Lock-Timeout.

- [ ] **Step 1: Failing Tests** — Feature „refuses a second default bot in the database“ (`DB::table('users')->insert` mit `is_default_bot` → `UniqueConstraintViolationException`); „leaves the guard out of the array of a user“; `DefaultBotGuardMigrationTest` (`--path`): per `SHOW CREATE TABLE users` ist die Spalte `VIRTUAL` und der Index `UNIQUE`, der Rückweg entfernt beides; `InvitationRaceTest` „makes one account of two accepts at once“.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1** + Integration `--filter='InvitationRace|DefaultBotGuard'`.
- [ ] **Step 5: Commits** — `fix: keep one default bot in the database`, `test: accept an invitation twice at once`.

### Task 5b: `ReadCommitted`, `/counts`-Grenze, CSP der API-Doku

**Modell:** opus

**Files:**
- Create: `tests/Integration/ReadCommittedTest.php` (ohne Test-Transaktion; ein Feature-Test erreicht den Weg nie, weil er in einer Transaktion steht; bisher gibt es nur `McpReadCommittedTest.php`)
- Modify: `app/Support/ReadCommitted.php`, `app/Providers/AppServiceProvider.php` (Listener auf `ConnectionEstablished`), `app/Actions/WorkItems/CountWorkItems.php`, `lang/{en,de}.json` (`field.filters.too_many` mit `:max`, alphabetisch), `app/OpenApi/ItemQueryDocs.php` (dort steht das `counts`-Schema, Z. 168; Grenze in der Beschreibung von `filters`), `tests/Feature/WorkItems/CountWorkItemsTest.php`, `tests/Feature/OpenApi/ApiDocsRoutesTest.php`, `CLAUDE.md`

**Interfaces:**
- **`ReadCommitted::run`:** scheitert das `SET` im `finally`, wird die eigentliche Exception der Transaktion weitergeworfen und der Fehler des `SET` per `report()` gemeldet. Gegen einen Reconnect: das `BEGIN` liegt im Callback (`DB::transaction` des Aufrufers), und Laravel verbindet in `handleBeginTransactionException` neu und beginnt sofort — `run` kann dazwischen nichts prüfen. Darum setzt `run` eine statische Tiefe, und ein Listener auf `Illuminate\Database\Events\ConnectionEstablished` (im `AppServiceProvider`, nur für die Standardverbindung) setzt bei Tiefe > 0 die Ebene `read committed` erneut (Laravel löst das Ereignis auch beim Reconnect aus, `DatabaseManager:166`). Kein `SELECT @@…` vor `BEGIN`.
- **`/counts`:** höchstens `CountWorkItems::MAX_CONDITIONS_TOTAL` 500 Bedingungen über alle Filter, sonst 422 `field.filters.too_many` (`:max`) an `filters` (`field.filters.invalid` mit `:max` bleibt für die Zahl der Filter); `ItemQueryDocs` nennt die Grenze aus der Konstante; der OpenAPI-Vertrag prüft das Beispiel mit 11 × 50.
- **CSP der API-Doku:** `ApiDocsRoutesTest` prüft die CSP auch auf einer Antwort mit Query (`/api/docs?foo=1`) und dass `public/api-docs.js` kein `eval` enthält; nichts sonst.

- [ ] **Step 1: Failing Tests** — `ReadCommittedTest` „sets the level again after a reconnect“ (`DB::disconnect()` im Callback vor `DB::transaction`, dann `select @@session.transaction_isolation` in der Transaktion = `READ-COMMITTED`), „rethrows the error of the transaction when resetting the level fails“ (`beforeExecuting` wirft beim `set session … repeatable read`, die Exception des Callbacks kommt an, `report()` ist per `Exceptions::fake()` belegt); `CountWorkItemsTest` „refuses more than 500 conditions over all filters“ (11 Filter × 50 → 422 an `filters`); API-Doku wie oben.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1** + Integration `--filter='ReadCommitted'`.
- [ ] **Step 5: Commits** — `fix: keep the error of a read-committed transaction and its level after a reconnect`, `fix: cap the conditions of one count request`, `test: check the CSP of the API docs with a query`.

---

## Block B: CI

Heute braucht `e2e` 1 h 38 min bei 120 min Grenze: rund 6 min Vorbereitung (Vitest 4:30, Build 0:11, Playwright 0:20) und 92 min Tests, je Projekt etwa 23 min. Ein Projekt-Job liegt also bei etwa 30 min. `info.testId` ist je Projekt verschieden (`e2e/fixtures.ts:91`), der Build hängt an keiner `VITE_*`-Variable: `public/build` aus einem Job ist in den Projekt-Jobs verwendbar, Pfade aus Runner und Container normalisiert `normalizePath` schon.

### Task 6a: Abdeckung je Projekt: Skripte und Fixture

**Modell:** opus

Ein voller Lauf schreibt weit über tausend Dateien zu je etwa 2 MB (`scripts/coverage-merge.mjs:44-46`), rund 600 MB je Projekt roh. Vier solche Artefakte hoch- und wieder herunterzuladen kostet je Minuten, und der Merge-Job müsste alles erneut remappen. Neu (A438): jeder Projekt-Job verdichtet seine Abdeckung einmal (`--remap-only`) zu einer Datei von einigen MB; der Merge liest die vier Dateien **beim Namen**. Das ist linear: Treffer je Anweisung des Builds summieren sich vor oder nach dem Mapping gleich, und alle Projekte nutzen denselben Build mit denselben Source-Maps.

**Files:**
- Modify: `e2e/fixtures.ts` (schreibt nach `coverage/e2e/<projekt>/<testId>-<n>.json`), `e2e/global-teardown.ts` (merged nur, wenn `E2E_MERGE` nicht `0` ist), `scripts/coverage-merge.mjs` (liest `coverage/e2e/**` rekursiv, heute nur die oberste Ebene per `readdirSync`, Z. 64; Optionen `--remap-only --out <datei>` und `--expect-shards=<name,name,…>`), `scripts/coverage-merge.test.mjs`, `docs/{en,de}/development.md` (Abdeckung je Projekt; dass `globalSetup` bei einem Lauf mit nur einem Projekt die Unterordner der anderen löscht, `global-setup.ts:24`, und warum das richtig ist: ein Teil-Lauf ist nie die Summe), `CLAUDE.md` (Kommandos: `coverage:merge` und die Optionen)

**Interfaces:**
- `node scripts/coverage-merge.mjs --remap-only --out coverage/e2e-<projekt>.json`: remappt die Dateien von `coverage/e2e/<projekt>/` einmal (`remapCoverage`) und schreibt eine Datei; kein Gate, kein Bericht.
- `--expect-shards=desktop-light,desktop-dark,phone-light,phone-dark`: der Merge findet je Namen genau eine Quelle (`coverage/e2e/<name>.json`, `coverage/e2e/<name>/` oder ein Unterordner gleich welchen Präfixes, der auf `<name>` endet, wie ihn `download-artifact` als `e2e-coverage-<name>` anlegt) mit mindestens einer Datei; jeder fehlende oder leere Name → Exit 1 mit dem Namen. Ohne die Option liest der Merge alle Unterordner wie lokal.
- Lokal unverändert: `pnpm --dir e2e test` merged am Ende (`E2E_MERGE` ungesetzt).
- Gilt ein Projekt für sich? Nein: die 100 % gelten nur für die Summe aus Vitest und allen vier Projekten (Global Constraints); ein einzelnes Projekt hat kein Gate.

- [ ] **Step 1: Failing Tests** — `coverage-merge.test.mjs`: „needs the coverage of every project by name“ (drei von vier → Fehler mit dem fehlenden Namen; ein leerer Ordner zählt als fehlend), „finds a project in a folder named after its artifact“ (`e2e-coverage-phone-dark/`), „reads the files of every project recursively“, „gives the same lines whether runs are remapped one by one or together“ (zwei Projekte je `--remap-only`, dann gemerged, gegen beide roh gemerged).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** lokal `E2E_MERGE=0 pnpm --dir e2e exec playwright test --project=setup --project=desktop-light login.spec.ts` schreibt nach `coverage/e2e/desktop-light/`, danach `ddev exec node scripts/coverage-merge.mjs --remap-only --out coverage/e2e-desktop-light.json` und `ddev exec pnpm coverage:merge` lesen es (nur Funktionsprobe, kein 100-%-Lauf).
- [ ] **Step 5: Commit** — `test: keep the e2e coverage per project and remap it once per project`.

### Task 6b: CI: e2e je Projekt, Merge-Job

**Modell:** opus

Neu (A438): ein Job baut einmal, vier Jobs (`desktop-light`, `desktop-dark`, `phone-light`, `phone-dark`) laufen parallel mit **eigener** Datenbank, Meilisearch, Mailpit, Reverb und Workern, ein Merge-Job führt die Abdeckung zusammen und hält die 100 %. Ziel: jeder Projekt-Job ≤ 45 min (`timeout-minutes: 60`), Gesamtdauer ≤ 60 min.

**Files:**
- Modify: `.github/workflows/tests.yml` (Job `e2e` ersetzt durch `e2e-build`, `e2e` mit `strategy.matrix.project`, `e2e-coverage`), `tests/Unit/WorkflowsTest.php`, `docs/{en,de}/development.md` (CI-Abschnitt), `CLAUDE.md` („Regeln“: CI-Jobs; Fallstricke)

**Interfaces:**
- `e2e-build`: Composer, `pnpm install`, `pnpm test:coverage` (Vitest, `coverage/unit`; braucht es hier und in `tests`, beides bleibt, K7), `pnpm build:coverage`; lädt `public/build` und `coverage/unit` als Artefakte `e2e-build` bzw. `unit-coverage` hoch (`retention-days: 3`).
- `e2e (<projekt>)`: `needs: e2e-build`, Services wie bisher, lädt `public/build` herunter (kein eigener Vite-Build), startet Server, Reverb, drei Worker wie bisher (samt `mail` aus Task 4), `pnpm --dir e2e test --project=setup --project=${{ matrix.project }}` mit `E2E_MERGE: '0'`; danach (`if: always()`) `node scripts/coverage-merge.mjs --remap-only --out coverage/e2e-${{ matrix.project }}.json` und Upload **nur dieser Datei** als `e2e-coverage-<projekt>`; bei Fehler die Logs als `e2e-results-<projekt>`. `fail-fast: false`, `timeout-minutes: 60`.
- `e2e-coverage`: `needs: [e2e-build, e2e]`, `if: always() && needs.e2e-build.result == 'success'` (`needs.e2e-build` ist nur lesbar, wenn `e2e-build` in `needs` steht); lädt Build, `unit-coverage` und alle `e2e-coverage-*` (`merge-multiple: false`), `pnpm coverage:merge --expect-shards=desktop-light,desktop-dark,phone-light,phone-dark`, lädt `coverage/merged` hoch; der **letzte** Schritt scheitert mit `needs.e2e.result != 'success'` (die Abdeckung kann 100 % zeigen, obwohl Tests scheiterten).
- Alle neuen `uses:` per SHA wie A425 (dieselben Versionen wie im bestehenden Job).

- [ ] **Step 1: Failing Tests** — `WorkflowsTest`: „runs the e2e suite once per Playwright project“ (Matrix = die vier Projekte aus `e2e/playwright.config.ts`, gelesen als Text), „uploads one remapped coverage file per project“, „merges the coverage of every project by name with the gate“ (`e2e-coverage` ruft `coverage:merge --expect-shards=<die vier Namen>`, `needs` enthält `e2e-build` und `e2e`, letzter Schritt prüft `needs.e2e.result`), „builds the coverage build once“ (kein `build:coverage` in `e2e`), `timeout-minutes` ≤ 60 je Projekt.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** `actionlint` (Image `rhysd/actionlint:1.7.7`, schon vorhanden) → Exit 0.
- [ ] **Step 4: G1** (`WorkflowsTest`).
- [ ] **Step 5: Commit** — `ci: run the e2e suite per Playwright project and merge its coverage once`. Die Laufzeit belegt erst der PR (Tabelle der Job-Dauern im Bericht der Task 27).

### Task 7: Flakes

**Modell:** opus (Timebox 90 min; Ursache nicht gefunden → Bericht mit dem Stand, kein Fix)

Nach superpowers:systematic-debugging: erst Ursache belegen, dann ändern. Bekannt: `webhooks.spec.ts:31` (phone-dark) lief in den Test-Timeout 120 s (Lauf 42399040297 von PR #30, Versuch 1, nach 2,0 min; das Artefakt `e2e-results` mit 21,7 MB liegt vor), danach `keyboard.press` nach dem Ende des Kontexts; der Test tabbt bis zu 80 Mal (`tabTo(page, open, { max: 80 })`) über die Handy-Schublade. `bulk.spec.ts` (phone-light, Phase 13) ohne bekannte Ursache. `QuerySearchTest` ist seit 8747f58 frei von Factory-Namen.

**Files:** je nach Ursache `e2e/tests/{webhooks,bulk}.spec.ts`, `e2e/helpers.ts`, `tests/Feature/Search/QuerySearchTest.php`; `CLAUDE.md` (Fallstrick, falls die Ursache allgemein ist)

- [ ] **Step 1: Reproduzieren** — `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test webhooks.spec.ts bulk.spec.ts --project=setup --project=phone-light --project=phone-dark --repeat-each=10` → Fehlschläge mit Trace (`trace: 'retain-on-failure'`) sammeln; die Traces der CI-Läufe von PR #28 und #30 (Artefakt `e2e-results`, Lauf 42399040297) per `gh run download` dazu. `ddev artisan test --filter=QuerySearchTest --repeat=50` → 50 × grün oder Fehlfall.
- [ ] **Step 2: Ursache je Flake** im Bericht mit Beleg (Trace-Ausschnitt, Zeitstempel). Für `webhooks.spec.ts`: misst die Dauer des Tab-Wegs auf dem Handy; ist er die Ursache, geht der Test auf dem Handy über den Auslöser direkt (`focus()` + Enter) — Tastatur bleibt, die Tab-Reihenfolge prüft `desktop`.
- [ ] **Step 3: Fix** — keine Wartezeiten (`waitForTimeout`), keine Retries (`retries: 0` bleibt); Warten nur auf Zustände (`toBeVisible`, `expect.poll`).
- [ ] **Step 4: Gegenprobe** — derselbe `--repeat-each=10`-Lauf → 0 Fehlschläge; `QuerySearchTest --repeat=50` grün.
- [ ] **Step 5: Commit** je Flake — `test: <was> without depending on <Ursache>`.

---

## Block C: Last

### Task 8a: Last-Seeder, Datenbank `load`, `LoadWorld`

**Modell:** opus

**Files:**
- Create: `database/seeders/LoadSeeder.php`, `database/seeders/Load/{LoadCatalog,LoadItems,LoadContent,LoadTexts}.php`, `phpunit.load.xml`, `tests/Load/LoadTestCase.php`, `tests/Load/LoadWorld.php`, `tests/Load/SeedLoadTest.php`
- Modify: `tests/Pest.php` (`pest()->extend(LoadTestCase::class)->in('Load')`), `.ddev/config.yaml` (Hook wie für `testing`: `CREATE DATABASE IF NOT EXISTS load; GRANT ALL ON load.* TO 'db'@'%'`, danach `ddev restart`), `docs/{en,de}/development.md` (Abschnitt „Last“: Datenbank, Seeder, Laufzeit), `CLAUDE.md` (Kommandos, Architektur „Last“, Fallstrick „GL nie parallel zu G1/G3“)

**Interfaces:**
- `LoadSeeder` (in `database/seeders`, nicht unter `app/`: zählt nicht zur Abdeckung; `WithoutModelEvents`; deterministisch mit `mt_srand(15)` und Faker-Seed 15; nur fiktive Namen; `public const VERSION = 1`, jede spätere Änderung am Seeder erhöht sie):
  - Organisation und Katalog wie der Demo-Katalog (ruft `Demo\CatalogSeeder`), 30 Personen `load-NN@example.com`, 5 Bots, 20 Projekte `L01`…`L20` „Lastprojekt 01“….
  - Je Projekt 2 500 Items = **50 000**: 5 % Epics mit je bis zu 40 Kindern, Status über alle Kategorien verteilt, 10 % archiviert, 70 % mit Assignee, 0–3 Labels, Werte für `effort` und drei weitere Properties (Datum, Text, Dropdown), Rang `Rank::nBetween`.
  - 5 000 Relationen, 100 000 Kommentare (bis 40 an einzelnen Items), 2 000 Wiki-Seiten in `L01` (Baum bis Tiefe 4) mit je 0–5 Versionen, 200 Vorlagen (50 mit Zeitplan zur selben Minute), 50 Webhooks (Organisation, `work_item.*`, Ziel `https://receiver.example.com`, **aus**: kein Versand beim Seeden).
  - **Texte ohne Markdown** (`Document::fromMarkdown` braucht bis rund 1 s je Text, `RichTextRules` fragt je Text die Datenbank): `LoadTexts` baut Tiptap-JSON direkt als Array, ein fester Pool von 200 Beschreibungen und 200 Kommentaren aus Bausteinen (Absatz, Liste, Code, Erwähnung einer festen `load-NN`-Person, Verweis auf ein Item desselben Projekts). `description_text`/`body_text` kommen über `Document::fromJson(...)->toText()` einmal je Pool-Eintrag (ein Verweis trägt keinen Text, die ID des Ziels wird je Zeile eingesetzt), nie je Zeile. Kein `fromMarkdown`, kein `RichTextRules`.
  - Schreibt per Sammel-`insert` in Blöcken zu 1 000 ohne Events (wie `ItemsSeeder`, A86). Legt am Ende die Tabelle `load_meta` (nur in `load`) mit `VERSION` und den Zahlen an.
  - Am Ende `SearchIndexer::rebuild()` und wartet über eine eigene Methode `LoadWorld::settle()` (nicht `Tests\Support\Meili`, das verlangt `testing_`). Ziel: Datenbank < 5 min in DDEV; die Dauer von `rebuild()` misst der Bericht getrennt (Budget in Task 11b).
- `phpunit.load.xml`: Testsuite `Load` (`tests/Load`), `DB_DATABASE=load`, `SCOUT_DRIVER=meilisearch`, `SCOUT_PREFIX=load_`, `APP_ENV=testing`, `CACHE_STORE=array`, `QUEUE_CONNECTION=sync`, **alle** `force="true"` (DDEV-Env-Werte überstimmen sonst `phpunit.xml`); nicht Teil von `phpunit.xml`, also weder im Pflicht-Job noch in der Abdeckung.
- `Tests\Load\LoadTestCase extends Illuminate\Foundation\Testing\TestCase`: ohne `RecordContract` (der OpenAPI-Vertrag gehört nicht zur Last-Suite und erzeugt in `tearDown` das Dokument), ohne `RefreshDatabase`, Konsumenten aus wie `Tests\TestCase`.
- `LoadWorld::ensure()` (statisch, einmal je Prozess):
  - **Wächter zuerst:** bricht mit einer `RuntimeException` ab, wenn `DB::getDatabaseName() !== 'load'` oder `config('scout.prefix') !== 'load_'`, vor jedem Schreiben.
  - Ruft immer `migrate --force` (schnell, wenn nichts offen ist): so bekommt eine schon geseedete `load` die Migrationen der Tasks 9 und 10.
  - Seedet neu (`migrate:fresh --force` + `LoadSeeder`), wenn `load_meta` fehlt, ihre `VERSION` nicht `LoadSeeder::VERSION` ist oder die Zahlen fehlen; sonst nutzt sie den Stand (schnelle Wiederholung).
  - Tests verändern keine Daten außer in Transaktionen, die sie zurückrollen.
- In der CI legt der Service `MARIADB_DATABASE: load` sie an (Task 8b).

- [ ] **Step 1: Failing Tests** — `SeedLoadTest` „refuses a database other than load“ (Konfiguration auf `testing` umgestellt → Exception, keine Tabelle geändert), „refuses a search prefix other than load_“, „seeds 50 000 items in 20 projects“ (Zahlen je Tabelle, `L01` hat 2 000 Seiten, 50 Webhooks aus, `load_meta.version` = `VERSION`), „migrates a seeded database again“ (eine offene Test-Migration per `--path` läuft beim nächsten `ensure()`).
- [ ] **Step 2: RED** — `ddev artisan test --configuration=phpunit.load.xml --filter=SeedLoad`.
- [ ] **Step 3: Umsetzen;** DDEV-Hook, `ddev restart`.
- [ ] **Step 4: GL** (`--filter=SeedLoad`); Dauer des Seeders, Dauer von `rebuild()`, Größe der Datenbank (`information_schema.tables`) und Spitzenspeicher von PHP in den Bericht; G1 (nichts unter `app/` geändert, muss grün bleiben).
- [ ] **Step 5: Commit** — `test: seed 50 000 items into a guarded load database`.

### Task 8b: Budget, `ApiLoadTest`, CI-Job `load`

**Modell:** opus

**Files:**
- Create: `tests/Load/ApiLoadTest.php`, `tests/Load/Support/Budget.php`
- Modify: `.github/workflows/tests.yml` (Job `load`, MariaDB-Service mit `MARIADB_DATABASE: load`), `tests/Unit/WorkflowsTest.php`, `docs/{en,de}/development.md` (Abschnitt „Last“: Budget, Tabelle, `OVER_BUDGET`), `CLAUDE.md`

**Interfaces:**
- `Budget::measure(string $name, Closure $request, float $seconds = 1.5): float` — ein Aufwärmlauf, dann drei Läufe; **vor jedem Lauf** `app()->forgetScopedInstances()` und `Visibility::forget()` (Laravel vergisst `scoped`-Instanzen zwischen zwei Anfragen eines Tests nicht; `Organization::current()`, `RoleIndex`, `CatalogProperties` kämen sonst aus dem Speicher); Median gegen das Budget (A187: 1,5 s je Antwort); schreibt `name: median ms, queries` in eine Tabelle, die `ApiLoadTest` am Ende ausgibt (`fwrite(STDERR, …)`) und nach `storage/logs/load-budget.md` schreibt. `Budget::queries(Closure $request): int` zählt Abfragen (`DB::listen`) mit denselben Vorbereitungen.
- `ApiLoadTest` (als Org-Admin-Person der Last-Daten, Sitzung):
  - Zeilen: `POST /api/v1/work-items/query` (erste Seite 100, jede Sortierung aus `SortSpec::CORE` und `property:effort`, beide Richtungen, `lean`), `GET /api/v1/work-items?filter[project]=L07`, `POST …/groups` (jede Gruppierung über alle Projekte und in `L07`), `POST …/counts` (10 Filter), Board = `/groups` + erste Seite jeder Gruppe nach Status in `L07`, `GET /api/v1/work-items/{key}?include=children,relations,type,workflow,attachments` (Epic mit 40 Kindern), `GET …/comments` und `…/history` des Items mit 40 Kommentaren, `GET /api/v1/search?q=<Wort>` (echte Meilisearch), `GET /api/v1/projects`, `GET /api/v1/projects/L01/pages` (2 000 Seiten).
  - Jede Zeile: **harte Zusicherung** Abfragezahl gleich der in `L20` mit nur den ersten 100 Items (feste Zahl, unabhängig von der Datenmenge; Ausnahmen nur mit Grund im Test), dazu Median ≤ 1,5 s.
  - **`OVER_BUDGET`** statt `->todo()` (Pests `todo` ruft `skip('__TODO__')`, der Test liefe nicht und die Zeile fehlte in der Tabelle): `const OVER_BUDGET = ['<zeile>' => 'Task 10: <Grund>']`. Jede Zeile läuft und misst, die Tabelle zeigt alle; nur die Zusicherung des Medians entfällt für genannte Zeilen (P2: nicht gelockert). Test „names only rows that exist“ hält die Liste ehrlich; Tasks 9–13b leeren sie.
- CI-Job `load` (nicht Pflicht, `timeout-minutes: 40`): Services wie `tests` (MariaDB mit `MARIADB_DATABASE: load`, Meilisearch), `php artisan test --configuration=phpunit.load.xml`; lädt `storage/logs/load-budget.md` als Artefakt `load-budget` hoch (`if: always()`). Läuft bei jedem PR parallel zu `tests`.

- [ ] **Step 1: Failing Tests** — `ApiLoadTest` (zuerst ohne `OVER_BUDGET`: RED zeigt, welche Zeilen über Budget liegen), „names only rows that exist“; `WorkflowsTest` „runs the load suite outside the required job“ (Job `load` mit `phpunit.load.xml`, nicht `tests`, Service-Datenbank `load`).
- [ ] **Step 2: RED;** **erste Messung** ohne Änderung am App-Code: die Tabelle (Median, Abfragen) in den Bericht.
- [ ] **Step 3: `OVER_BUDGET`** mit je Zeile der Task und dem Grund aus der Messung (Listen, Gruppen, Zählungen, Board → Task 10; Suche → 11b; `sort=created_at|updated_at` → Task 9); CI-Job.
- [ ] **Step 4: GL;** G1 (`WorkflowsTest`).
- [ ] **Step 5: Commits** — `test: measure the API against 50 000 items`, `ci: run the load suite beside the tests`.

**Danach (Orchestrator):** Task 10 nach den Zeilen von `OVER_BUDGET` in 10a, 10b … je Ursache teilen (K13), je ≤ 1 h; die Briefe nennen ihre Zeilen.

### Task 9: Zeitstempel der Items `NOT NULL`, Leer-Marke weg

**Modell:** opus

A406 gab `created_at`/`updated_at` eine Leer-Marke mit `coalesce`, weil beide Spalten `null` sein dürfen; der Ausdruck nutzt die Indizes aus `…_000920` in der Keyset-Bedingung nicht. Vor v0.1.0 gibt es keine Daten außer Entwicklung (A427): beide Spalten werden `NOT NULL` (A440, ersetzt A406), die Marke entfällt für sie.

`timestamps()` legt nullable `TIMESTAMP` an (`…_000800`:37); ein `->nullable(false)->change()` ergibt `timestamp NOT NULL`. Mit `explicit_defaults_for_timestamp = OFF` gäbe MariaDB der ersten solchen Spalte von sich aus `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`; dann bewegte jedes `toBase()->update` ohne `updated_at` den Stempel (`TemplatesSeeder`, Neuverteilung von Rängen, Buchhaltung). MariaDB 11.4 hat `ON` als Standard, und DDEV, CI und Compose setzen nichts anderes — ein Test hält das fest.

`ItemOrder` ordnet `created_at` immer gefolgt von `rank` (aufsteigend, auch bei absteigendem Stempel) und `id`; ein Einzelindex `(created_at)` kann diese gemischte Ordnung nicht liefern, `EXPLAIN` zeigt weiter `Using filesort`. Der Gewinn ist die Range-Bedingung des Keysets auf der Spalte statt auf einem Ausdruck.

**Files:**
- Create: `database/migrations/2026_11_08_000200_make_item_stamps_required.php` (Kommentar nennt `explicit_defaults_for_timestamp`), `tests/Integration/ItemStampsMigrationTest.php`
- Modify: `app/Views/ItemOrder.php` (`created_at`, `updated_at` ohne Marke und ohne `coalesce`, nur die Spalte; Signatur bleibt `created_at:desc` usw.), `app/Support/ListQuery.php`/`ListSpecsTest` nur falls sie `nullable` dieser Spalten voraussetzen, `database/factories/WorkItemFactory.php` (setzt beide immer), `tests/Feature/Views/ItemOrderTest.php`, `tests/Load/ApiLoadTest.php` (Zeilen aus `OVER_BUDGET` nehmen, wenn die Messung es trägt), `CLAUDE.md` („Sortierung und Cursor der Items“), Ruling A406 um „ersetzt durch A440“ ergänzen

**Interfaces:**
- Migration `up()`: `update work_items set created_at = <Zeit der ULID>, updated_at = coalesce(updated_at, created_at, <Zeit der ULID>) where created_at is null or updated_at is null` (Zeit der ULID in PHP über `Str::ulid`-Parse je Block per `chunkById`, nie per SQL-Funktion), dann beide `->nullable(false)->change()` ohne Default. `down()`: wieder `nullable`, Werte bleiben.
- Ein Cursor der alten Form ist 422 `field.cursor.invalid`: die Signatur bleibt `created_at:desc`, aber `sort_0` (Marke) ist kein Stempel und `sort_1` zu viel; die bestehende Formprüfung lehnt das ab.
- Kein zusammengesetzter Index `(created_at, rank, id)` ohne Messung (die gemischte Richtung bräuchte zwei).

- [ ] **Step 1: Failing Tests** — `ItemStampsMigrationTest` (`--path` wie `ListIndexesMigrationTest`): „fills missing stamps from the ULID“, „keeps the values on the way back“, „has no default and no on-update on the stamps“ (`SHOW CREATE TABLE work_items`: beide `NOT NULL`, **ohne** `DEFAULT`, **ohne** `ON UPDATE`); `ItemOrderTest`: „sorts by created_at without a guard“ (das SQL der Ordnung enthält kein `coalesce` für `created_at`/`updated_at`), „refuses a cursor of the old shape“ (422), „pages every item exactly once“ (bestehend, grün).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** `EXPLAIN` der zweiten Seite von `sort=-updated_at` vorher/nachher in den Bericht.
- [ ] **Step 4: G1** + Integration `--filter=ItemStamps`; **GL**.
- [ ] **Step 5: Commit** — `perf: make the stamps of items required and page them by the column`.

**Kriterium:** `EXPLAIN` zeigt für die zweite Seite (Keyset-Bedingung) `range` bzw. `ref` mit dem Stempel-Index; der Median der Zeilen `sort=created_at|updated_at` in GL vorher/nachher steht im Bericht. „Index benutzt für ORDER BY“ ist kein Kriterium. Bringt die Messung nichts, bleibt die Änderung trotzdem (Vereinfachung, A440), und der Bericht sagt es.

### Task 10 (a…): Listen, Gruppen, Zählungen, Board unter Last

**Modell:** opus

Nimmt jede Zeile von `OVER_BUDGET` (Task 8b) für Listen, Gruppen, Zählungen und Board heraus. Wie viele Ursachen es gibt, zeigt erst die Messung: der Orchestrator teilt diese Task nach 8b in 10a, 10b … je Ursache, je ≤ 1 h (K13). Kandidaten (nur mit Messung, Global Constraints): Index für die Property-Sortierung (`work_item_values (property_id, position, work_item_id)` mit den Wertspalten), `blocked`/`blocking` als skalare Unterabfrage je Zeile (T3-M3: nur bei Filter auf `blocked`), redundante Abfragen in `Grouping`/`GroupWorkItems` (T8-M4), Indizes für `name`/`identifier` der Listen aus Phase 12 (Projekte, Views, Kataloge — bei 20 Projekten nur messen).

**Nur messen und Ruling, kein Umbau, solange unter 1,5 s:** `meta.total` je Seite (A28: zählt die gefilterte Menge bei jeder Seite; nur auf der ersten Seite zählen und im Cursor tragen ändert die Antwort der Folgeseiten, darum gehört das, falls nötig, als Ruling in die Spec 6.1); `RemapStates` über 2 500 Items eines Projekts (Workflow-Wechsel in einer Transaktion, die zurückrollt): über 1,5 s → Messung in den Bericht, Ruling „nach v0.1.0“ (A447) bleibt.

**Files:** `app/Views/{ItemOrder,Grouping,FilterQuery,ItemQuery}.php`, `app/Actions/WorkItems/{QueryWorkItems,GroupWorkItems,CountWorkItems}.php`, `app/Support/ListResult.php`, neue Migrationen `2026_11_08_0003xx_…`, Tests in `tests/Feature/Views/`, `tests/Integration/ItemQueryLoadTest.php` (Abfragezahlen), `tests/Load/ApiLoadTest.php`, `CLAUDE.md`

- [ ] **Step 1: Messen** — `EXPLAIN ANALYZE` (MariaDB: `ANALYZE FORMAT=JSON`) jeder Abfrage der eigenen `OVER_BUDGET`-Zeilen gegen die Datenbank `load`, im Bericht.
- [ ] **Step 2: Je Ursache ein Test**, der die Abfragezahl oder den benutzten Index festhält (Feature: `DB::listen`; Index über `EXPLAIN` in `tests/Integration`), RED.
- [ ] **Step 3: Ändern** — je Ursache die kleinste Änderung.
- [ ] **Step 4: G1;** **GL**: die eigenen Zeilen aus `OVER_BUDGET` entfernt, alle ≤ 1,5 s.
- [ ] **Step 5: Commits** je Ursache — `perf: <was> under 50 000 items`.

### Task 11a: Gezieltes Neuindexieren (Label, Kategorie)

**Modell:** opus

**Files:** `app/Search/SearchConsumer.php`, `app/Actions/Labels/DeleteLabel.php`, `app/Actions/Workflows/SaveWorkflow.php`, `tests/Feature/Search/SearchConsumerTest.php`, `tests/Feature/Api/LabelsApiTest.php` (`meta.item_ids` von `DeleteLabel`), `CLAUDE.md` („Suche: Konsument“)

**Interfaces:**
- `DeleteLabel` schreibt die IDs der Items, die das Label trugen, in `meta.item_ids` (vor der Kaskade gelesen, alle); der Konsument stellt `ReindexWorkItems(null, <diese IDs>)` ein statt aller Items (A206 „Falls falsch“ umgesetzt). `ReindexWorkItems(?array $projectIds, ?array $itemIds = null)`.
- `SaveWorkflow` schreibt `meta.categories_changed` (`true`, wenn die Kategorie eines bleibenden Status sich änderte oder ein Status entfernt wurde) **nur am `workflow.updated` des gespeicherten Workflows**; das zweite `workflow.updated` beim Abwählen des alten Standards (`SaveWorkflow.php:109`) hat keins und indexiert nicht mehr. Der Konsument indexiert nur bei `categories_changed`.

- [ ] **Step 1: Failing Tests** — `SearchConsumerTest`: „reindexes only the items that carried a deleted label“, „leaves the items alone when a workflow keeps its categories“, „reindexes when a category changes“, „leaves the items alone when the old default loses its mark“.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1;** **GL** (Abfragezeilen unverändert).
- [ ] **Step 5: Commit** — `perf: reindex only the items a deleted label or a changed category touches`.

### Task 11b: Neuindexieren in Blöcken, `SearchLoadTest`

**Modell:** opus

**Files:** `app/Jobs/ReindexWorkItems.php`, `app/Search/SearchIndexer.php`, `tests/Feature/Search/ReindexWorkItemsTest.php` (neu), `tests/Load/SearchLoadTest.php` (neu), `tests/Load/ApiLoadTest.php` (Suchzeilen aus `OVER_BUDGET`), `CLAUDE.md`

**Interfaces:**
- `ReindexWorkItems(?array $projectIds, ?array $itemIds = null, ?string $after = null)`: `$timeout` 600, je Job höchstens `ReindexWorkItems::BLOCK` 2 000 Items; mehr → der Job stellt für den Rest einen Folgejob mit dem letzten `id` als `$after` ein.
- `SearchLoadTest`: `GET /search` mit einem, zwei und drei Wörtern, mit `types=items`, als Person mit 1 und mit 20 Projekten: Median ≤ 0,5 s (eigenes Budget, weil die Palette nach 150 ms fragt); Dokument mit 40 Kommentaren ≤ `COMMENTS_MAX`; `rebuild()` der 50 000 Items (Dauer und Speicher im Bericht, Budget 5 min, `memory_get_peak_usage` ≤ 512 MB). Meilisearch nimmt beim Indexieren bis zwei Drittel des RAM (A428) und teilt in DDEV die VM mit allen Projekten: GL läuft allein.

- [ ] **Step 1: Failing Tests** — `ReindexWorkItemsTest`: „continues in a follow-up job after a block“, „reindexes only the named items“; `SearchLoadTest` wie oben.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1;** **GL**.
- [ ] **Step 5: Commits** — `perf: reindex in blocks of 2 000 per job`, `test: measure the search against 50 000 items`.

### Task 12: Neuaufbau der Suche mit Tausch

**Modell:** opus

`app:search-import` leert heute die Indizes und füllt sie neu; solange ist die Suche leer (A216). Neu: in `<index>_next` aufbauen, dann `swapIndexes` (Meilisearch, im Client 1.17 `HandlesSystem.php:53`, im Server seit v1.0), dann den alten löschen.

**Files:** `app/Search/SearchIndexer.php` (`rebuild()`; `MODELS` ist heute private), `app/Search/MeilisearchEngine.php` (`swap(string $a, string $b): void`, `delete(string $index): void`, Interface `App\Search\SwapsIndexes`), `tests/Support/ArraySearchEngine.php`, `tests/Feature/Search/SearchIndexerTest.php`, `tests/Integration/MeilisearchEngineTest.php`, `tests/Support/Meili.php` (`INDEXES` samt `_next`; `use()` prüft `scout.prefix === 'testing_'`, sonst Fehler), `docs/{en,de}/search.md`, `CLAUDE.md`

**Interfaces:**
- `SearchIndexer::buildNext(string $model): int` (Einstellungen an `<name>_next`, leeren, füllen; Zahl der Dokumente) und `SearchIndexer::swapIn(string $model): void` (`swap(<name>, <name>_next)`, `delete(<name>_next)`); `rebuild()` ruft beide je Index aus `MODELS`, Rückgabe unverändert. Eine Engine ohne `SwapsIndexes` (Array-Engine im Test, `null`) baut wie bisher in place.
- Scheitert das Füllen, bleibt der alte Index unberührt und `<name>_next` wird gelöscht (im `finally`).
- **Präfix-Wächter:** `swap` und `delete` nehmen nur Indizes, die mit `scout.prefix` beginnen (sonst `InvalidArgumentException`); ein fremder Index auf derselben Meilisearch bleibt immer stehen.

- [ ] **Step 1: Failing Tests** — Integration „keeps the old index searchable while it rebuilds“ (Item umbenannt ohne Konsument, `buildNext(WorkItem::class)`, `Meili::settle()`: die Suche findet den alten Titel, nach `swapIn` den neuen), „leaves the old index when filling fails“, „removes the next index after the swap“, „leaves a foreign index alone when it rebuilds“ (ein Index `testing_other` bzw. ohne Präfix bleibt nach `rebuild()`; T4-M1 aus Phase 6), „refuses to swap or delete an index without the prefix“; `Meili::use` „refuses a prefix other than testing_“.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1** + Integration `--filter='MeilisearchEngine|SearchSettings|SearchFlow'`; **GL** (`rebuild()` misst weiter).
- [ ] **Step 5: Commit** — `fix: rebuild the search beside the live index and swap it in`.

### Task 13a: Standard-Bot je Event, Bots einer Mehrfachbearbeitung

**Modell:** opus

`BulkUpdateWorkItems` ruft nur `UpdateWorkItem::apply` (`BulkUpdateWorkItems.php:97`), erst `apply` ruft `announceAssignedBot` (`UpdateWorkItem.php:211, 244`), und `apply` hat schon sechs Parameter. Statt eines weiteren Parameters gibt es einen Speicher je Anfrage.

**Files:** `app/Actions/Webhooks/QueueDeliveries.php`, `app/Support/BotIds.php` (neu), `app/Actions/WorkItems/{UpdateWorkItem,BulkUpdateWorkItems}.php`, `app/Providers/AppServiceProvider.php` (`scoped`), Tests in `tests/Feature/Webhooks/QueueDeliveriesTest.php`, `tests/Feature/WorkItems/BulkUpdateWorkItemsTest.php`, `docs/{en,de}/webhooks.md` (Reihenfolge), `CLAUDE.md`

**Interfaces:**
- `QueueDeliveries` liest den Standard-Bot einmal je Event (nicht je Webhook, T6-M1).
- `App\Support\BotIds` (final, im Container `scoped`): `preload(list<string> $ids): void` liest mit **einer** Abfrage, welche der IDs Bots sind; `isBot(string $id): bool` antwortet aus dem Speicher und fragt eine unbekannte ID einzeln nach. `UpdateWorkItem::announceAssignedBot` fragt nur noch `BotIds::isBot`; `BulkUpdateWorkItems` ruft vorher `BotIds::preload(<alle Ziel-Assignees>)` (T10-M8). Die Signatur von `apply` bleibt.
- Reihenfolge der Zustellungen je Item: **nicht garantiert** (bleibt); `webhooks.md` sagt es und rät, nach `occurred_at` und `id` des Events zu ordnen (Satz in en und de).
- „Messung davor/danach“ ist hier die Abfragezahl der Feature-Tests (RED/GREEN); die Zeit misst 13b.

- [ ] **Step 1: Failing Tests** — „reads the default bot once per event“ (Abfragezahl mit 1 und 20 Webhooks gleich), „asks for the bots of a bulk change once“ (Abfragezahl mit 1 und 100 Items: Unterschied ≤ 100 × konstante Zahl ohne den Bot-Check), „asks for a single assignee as before“ (Patch ohne `preload`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1.**
- [ ] **Step 5: Commits** — `perf: read the default bot once per event`, `perf: look the bots of a bulk change up once`, `docs: say that deliveries per item may arrive out of order`.

### Task 13b: `WorkLoadTest`: Webhooks, Bulk, Nacht, Vorlagen

**Modell:** opus

In einer eigenen Transaktion, die zurückrollt, laufen `afterCommit`-Rückrufe nie (`DispatchEvent` ist `afterCommit`): es gäbe keinen Konsum zu messen. Laravels Trait `DatabaseTransactions` erklärt die Test-Transaktion zur Basis, dann laufen sie; der Such-Konsument schriebe aber in Meilisearch (`load_*`), was kein Rollback zurücknimmt.

**Files:** `tests/Load/WorkLoadTest.php`, `tests/Load/Support/ArraySearchEngine.php` (Kopie der Test-Engine: die Helfer aus `tests/Pest.php` hängen an `Feature`), `tests/Load/Support/Budget.php` (falls nötig), je nach Befund App-Code, `CLAUDE.md`

**Interfaces:**
- `WorkLoadTest` (Last-Datenbank, `DatabaseTransactions`; Queue `sync` mit `Queue::fake([DeliverWebhook::class])`; Konsumenten Benachrichtigung und Webhook echt, der Such-Konsument gegen die Array-Engine; Meilisearch misst nur `SearchLoadTest`):
  - Mehrfachbearbeitung von 100 Items (`assignee_id` auf einen Bot, `priority`) mit 50 aktiven Webhooks → Dauer der Anfrage (Budget 3 s, weil 100 Transaktionen), Dauer des Konsums aller Events, Zahl der Zustellungen (= 50 × Events), größte `webhook_deliveries.body` bei einer Beschreibung von 200 KB (≤ `WebhookPayload::MAX_BYTES`), Zahl der Benachrichtigungen je Person.
  - Auto-Close über `L01`–`L20` mit eingeschalteter Automatisierung (Dauer, Budget 10 min, Speicher).
  - `RunDueTemplates` mit 50 fälligen Vorlagen (Dauer des Einstellens).
  - Kopien vieler und großer Bilder je Vorlagenlauf (Rafaels Antwort 5, nicht mehr „nur wenn billig“): eine Vorlage mit 20 Bildern zu je 2 MB, `RunTemplate::execute` → Dauer vor der Sperre (`TemplateAttachments::copy`), Spitzenspeicher, Platz auf der Medien-Disk; Budget 10 s je Lauf und `memory_get_peak_usage` ≤ 256 MB. Die Bilder legt der Test mit `Storage::fake('local')` an (keine Last-Datenbank-Zeilen außerhalb der Transaktion).
- Werte in den Bericht; über Budget → Ursache in dieser Task beheben (mit Test und Messung davor/danach) oder Ruling.

- [ ] **Step 1: `WorkLoadTest`** schreiben; erste Messung in den Bericht.
- [ ] **Step 2: RED** je Zusicherung über Budget (sonst „keine“ im Bericht).
- [ ] **Step 3: Beheben** oder Ruling.
- [ ] **Step 4: GL;** G1, falls App-Code geändert.
- [ ] **Step 5: Commits** — `test: measure bulk changes, webhooks, the night and templates against 50 000 items`, je Fix `perf: <was>`.

### Task 14: OpenAPI und MCP: Zeit und Größe; Dauer von `tests`

**Modell:** sonnet

**Files:** `tests/Feature/OpenApi/OpenApiDocumentTest.php`, `tests/Feature/OpenApi/ApiDocsRoutesTest.php`, `tests/Feature/Mcp/McpServerTest.php` (das Budget für `tools/list` steht dort, Z. 37/240), `app/OpenApi/ListFlags.php`, `.github/workflows/tests.yml` und `tests/Unit/WorkflowsTest.php` (nur bei Bedarf, siehe unten), `CLAUDE.md`

**Interfaces:**
- `/api/openapi.json` im Betrieb kommt aus dem Cache von `scramble:cache`: Test „serves the cached document in production“ (`app()->detectEnvironment(fn () => 'production')`, `scramble.cache.store` `array`, `scramble:cache` gelaufen → zweite Anfrage ohne Generierung, Antwort < 200 ms).
- Budget der Erzeugung von 30 s / 512 MB auf **10 s / 128 MB**; den Speicher (bisher genannt 12–17 MB) und die Zeit neu messen und in den Bericht; `tools/list` bleibt ≤ 120 KB (Messwert im Bericht).
- `ListFlags` liest die Flags aus den Specs (`ListSpec`) statt einer festen Liste (Phase-12-Vormerkung); `ListParametersTest` hält das Ergebnis gleich.
- Laufzeit der Pest-Suite mit Vertrag: `ddev artisan test --profile` → die zehn langsamsten Tests in den Bericht; nichts ändern, wenn keiner über 10 s.
- **Dauer des Pflicht-Jobs `tests`** (heute 31–37 min bei `timeout-minutes: 45`; Phase 15 bringt viele neue Fälle, K7): aus dem letzten PR-Lauf in den Bericht. Liegt sie über 40 min, `timeout-minutes: 60` und `WorkflowsTest` hält ≤ 60 fest.

- [ ] **Step 1: Failing Tests** wie oben (der Produktions-Test scheitert, falls der Cache nicht greift; das neue Budget ist sofort grün — im Bericht sagen).
- [ ] **Step 2: RED** für `ListFlags` (ein Test, der eine neue Flag-Spalte in einer Test-Spec erwartet).
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1.**
- [ ] **Step 5: Commit** — `test: hold the OpenAPI document to 10 s and its cache in production`.

### Task 14b-1: Frontend-Leistung: `entry.hash`, `cachedItem`, `measure`

**Modell:** opus

`hashKey` läuft in `usePagedLists` schon nur bei `invalidate` (`hooks/workItems.ts:213, 317-318`); der Rest von T9-M3: dort wird neu gerechnet statt `entry.hash` zu nehmen. Ein Test mit 50 Cache-Ereignissen wäre sofort grün, darum zählt der Test bei `invalidate`.

**Files:** `resources/js/hooks/workItems.ts` (`usePagedLists`), `resources/js/components/fields/commands/context.ts` (`cachedItem`), `resources/js/features/items/list/ListLayout.tsx`, `resources/js/features/items/timeline/TimelineLayout.tsx`, Tests daneben

**Interfaces:**
- `usePagedLists`: bei `invalidate` `entry.hash` statt `hashKey` neu; Test zählt Aufrufe von `hashKey` über einen Spion bei 50 Invalidierungen.
- `cachedItem`: eine Map ID/Key → Item je Aufruf von `targetsNow()` statt einer Suche je Ziel (T15-M2); Test mit 1 000 gewählten Items: eine Iteration je gecachter Seite.
- `measure` in `ListLayout`/`TimelineLayout`: `useLayoutEffect` mit Abhängigkeiten (Zahl der Zeilen, Breite), nicht je Render (T13-M7, T21-M9).
- Gemessen wird in Vitest mit 5 000 Items im Cache (`renderHook`, `performance.now()` je Aktion, Werte vorher/nachher im Bericht, keine Zeitgrenze im Test); kein Browser gegen die Last-Datenbank.

- [ ] **Step 1: Failing Tests** wie oben.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `items-list.spec.ts timeline.spec.ts bulk.spec.ts palette.spec.ts`.
- [ ] **Step 5: Commits** je Punkt — `perf: <was>`.

### Task 14b-2: Frontend-Leistung: „Ohne Datum“ virtualisiert, Eltern-Chip

**Modell:** opus

**Files:** `resources/js/features/items/timeline/{TimelineLayout,Unplanned}.tsx`, `resources/js/hooks/workItems.ts` (`useEpics`), `resources/js/features/items/filter/values/EnumValue.tsx`, Tests daneben

**Interfaces:**
- „Ohne Datum“ der Timeline virtualisiert wie die Zeilen (`useVirtualizer`, T21-M8); Cursor und Fokus bleiben wie heute (Karte des Cursors gerendert).
- Ein Eltern-Chip liest seinen Namen aus `item.parent` bzw. `useItemRef`, `useEpics` lädt nur bei offener Liste (A153, T16-M1).

- [ ] **Step 1: Failing Tests** — „renders only the visible undated epics“ (500 Epics ohne Datum, gerenderte Karten ≤ sichtbare + Überhang), „names a parent chip without loading the epics“ (keine Anfrage an `/work-items/query` mit `epic is true`, bis die Liste aufgeht).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `timeline.spec.ts filter.spec.ts`.
- [ ] **Step 5: Commits** je Punkt — `perf: <was>`.

---

## Block D: Barrierefreiheit und Tastatur

### Task 15a: axe: Paket, Liste, Seiten

**Modell:** opus

**Files:**
- Create: `e2e/tests/a11y.spec.ts`, `e2e/a11y-pages.ts`, `e2e/a11y-exceptions.ts`, `scripts/a11y-pages.test.mjs`
- Modify: `e2e/package.json`, `e2e/pnpm-lock.yaml` (`@axe-core/playwright` exakt), `CLAUDE.md` (Regeln: axe; Fallstricke)

**Interfaces:**
- `e2e/a11y-pages.ts`: `A11Y_PAGES: { name: string; page: string /* Datei unter resources/js/pages */; path: (ids) => string; state?: (page: Page) => Promise<void>; guest?: boolean; projects?: string[] }[]`. In dieser Task: jede Seitendatei aus `resources/js/pages` (21 heute, auch `Errors/Error`, `Errors/NotFound`, alle `Auth/*` als Gast) mindestens einmal in ihrer Startansicht, ohne `state`.
- `e2e/a11y-exceptions.ts`: `{ rule: string; target: string; reason: string; until?: 'Task 16' }[]`; der Test filtert Verstöße, deren Regel und Selektor eine Ausnahme nennen. `target` ist ein stabiler Selektor (Regel plus `data-*`-Attribut oder Rolle der Komponente), **nie** eine generierte ID von Base UI (`:r12:`).
- `a11y.spec.ts`: je Eintrag ein Test, `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()` (`best-practice` bleibt aus, nicht WCAG), erwartet `[]` nach den Ausnahmen; die Meldung listet Regel, Ziel und `help`. Seiten laufen in allen vier Projekten (Kontrast hell/dunkel, Layout 1440/390).
- `scripts/a11y-pages.test.mjs` (Vitest, root): jede Datei unter `resources/js/pages/**/*.tsx` ohne `.test.` steht in `A11Y_PAGES` (Text gelesen); jede Ausnahme hat einen nicht leeren `reason`; kein `target` enthält `#:r` oder `[id^=`; nach Task 16 darf keine `until: 'Task 16'` mehr stehen (Test in Task 16 scharf geschaltet).

- [ ] **Step 1: Paket** — `@axe-core/playwright` 4.14.0 (vom 2026-10-15, hängt an `axe-core ~4.14.0`; `@playwright/test` ist 1.64.0) am Tag der Task erneut nach der Zwei-Wochen-Regel prüfen (`pnpm --dir e2e view @axe-core/playwright time`), exakt pinnen, Datum in den Bericht.
- [ ] **Step 2: `a11y-pages.test.mjs`** RED (Liste fehlt).
- [ ] **Step 3: Spec und Liste;** erster Lauf `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test a11y.spec.ts` in allen vier Projekten. Jeder Verstoß kommt als Ausnahme mit `until: 'Task 16'` und dem Satz von axe in `a11y-exceptions.ts`; die Liste der Verstöße (Regel, Seite, Anzahl, Projekt) in den Bericht.
- [ ] **Step 4: G2;** G3 gezielt `a11y.spec.ts` → grün mit Ausnahmen; Laufzeit je Projekt in den Bericht.
- [ ] **Step 5: Commit** — `test: check every page with axe`.

### Task 15b: axe: Zustände, erste Befundliste

**Modell:** opus

Rund 45 Einträge (21 Seiten, etwa 24 Zustände) mal vier Projekte wären etwa 180 Tests, bei 4–8 s je Test lokal 15–25 min zusätzlich. Zustände laufen darum nur in `desktop-light`, `desktop-dark` und `phone-light` (`test.skip` für `phone-dark` mit Grund: dunkles Theme und Handy-Layout sind sonst schon abgedeckt; A441).

**Files:** `e2e/a11y-pages.ts`, `e2e/tests/a11y.spec.ts`, `e2e/a11y-exceptions.ts`

**Interfaces:**
- Zustände in `A11Y_PAGES` (mit `state`): Palette offen (`mod+k`), Hilfe (`?`), Item-Vorschau offen, Anlegen-Dialog, Menü „Weitere Aktionen“ einer Item-Seite, Anzeige-Menü, Board, Tabelle, Timeline (1–4), Filter-Menü offen, Mehrfachleiste mit Auswahl, Wiki-Seite im Editor, Versionen-Dialog, Vorlagen-Editor mit Zeitplan, Token-Dialog mit Klartext, Webhook-Dialog, Inbox mit Karten, Einstellungen jedes Abschnitts (Organisation, Persönlich, Projekt), System-Seite.
- Daten: grundsätzlich die des `E2eSeeder`. Zustände, die Daten anlegen (Token, Webhook-Dialog nach dem Speichern, Mehrfachleiste), legen eigene `E2E …`-Daten an und räumen im `finally` auf (Token per `DELETE`, Webhook per `removeE2eWebhook`, Projekt per `removeE2eProject`); die Mehrfachleiste wählt nur aus und ändert nichts.

- [ ] **Step 1:** `a11y-pages.test.mjs` „lists the states of the screens“ (die Namen der Zustände oben stehen in der Liste) → RED.
- [ ] **Step 2:** Zustände schreiben; Lauf in den drei Projekten; neue Verstöße als Ausnahmen mit `until: 'Task 16'`; die gesamte Befundliste (Regel, Seite/Zustand, Anzahl, Projekt, vermutete Ursache) in den Bericht.
- [ ] **Step 3: G2;** G3 gezielt `a11y.spec.ts`.
- [ ] **Step 4: Commit** — `test: check every state of the screens with axe`.

**Danach (Orchestrator):** Hat die Befundliste mehr als 25 verschiedene Ursachen, Task 16 nach Ursachen in 16a, 16b … teilen, je ≤ 1 h.

### Task 16 (a…): axe-Befunde beheben

**Modell:** opus

Arbeitet die Ausnahmen mit `until: 'Task 16'` ab. Kontraste nur über die Tokens in `resources/css/tokens.css` (beide Themen, `DESIGN.md` lesen); Namen, Rollen und Live-Regionen in den Komponenten. Eine Ausnahme darf bleiben, wenn axe falsch liegt (Grund mit Beleg, etwa „Base UI setzt `aria-hidden` auf Geschwister eines modalen Dialogs“) — dann ohne `until`, mit stabilem Selektor.

Dazu der a11y-Punkt der Deferred-Triage, den axe nicht sieht: viele Status-Regionen beim Laden der Zählungen (T23-M8: ein Status je Liste, Skelette der Zeilen `aria-hidden`). Skelett-Regionen, die ansagen und gleich wieder verschwinden (M3), behebt Task 19b mit der Verzögerung.

**Files:** je Befund; `e2e/a11y-exceptions.ts`; `scripts/a11y-pages.test.mjs` (scharf: keine `until: 'Task 16'`); `resources/js/features/settings/catalog/usage.tsx`; Tests je Komponente in Vitest.

- [ ] **Step 1:** `a11y-pages.test.mjs` „leaves no exception waiting for task 16“ → RED (bei einer Teilung: nur in der letzten Teil-Task scharf).
- [ ] **Step 2:** je Ursache: Vitest-Test, der Rolle/Name/Kontrast-Token festhält, RED; Fix; Ausnahme entfernen.
- [ ] **Step 3: G2;** G3 gezielt `a11y.spec.ts` und die Specs der geänderten Bildschirme.
- [ ] **Step 4: Commit** je Ursache — `fix(a11y): <was>`.

### Task 17a: Tastatur-Manifest: Test, Kürzel und Widgets

**Modell:** opus

Erfolgskriterium 6 verlangt: jeder Ablauf ohne Maus, die Kürzel aus 5.3 umgesetzt, Playwright prüft das. Heute verteilt sich der Nachweis über viele Specs. Neu (A442): ein Manifest, das jeden Eintrag des Kürzel-Katalogs, jede Widget-Taste und jeden Ablauf einem Playwright-Test zuordnet, und ein Test, der es vollständig und ehrlich hält. `SHORTCUTS` hat 60 IDs, `WIDGET_KEYS` 42 Einträge in fünf Gruppen, aber nur 30 eindeutige Labels.

**Files:**
- Create: `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs`
- Modify: `CLAUDE.md` (Regeln: Tastatur — neues Kürzel oder neuer Ablauf braucht einen Eintrag), `docs/{en,de}/keyboard.md` (ein Absatz: wie geprüft wird; die Tabelle bleibt erzeugt)

**Interfaces:**
- `e2e/keyboard-flows.ts`: `export const SHORTCUT_TESTS: Record<string, Proof>` mit `Proof = { file: string; test: string; projects?: string[] }`. Schlüssel: jede ID aus `SHORTCUTS` und je Widget-Taste `<gruppe>:<label-schlüssel>`. Kein Import aus `resources/js` (`e2e/tsconfig.json` schließt nur `e2e/**` ein, ein Import zöge die `@/`-Aliase in den Typecheck); die Vollständigkeit prüft nur der Test. Dazu `export const MOUSE_ALLOWED` und `export const PROJECT_GAPS` (je mit Grund) und `export const GAPS` (`file: 'TODO'`).
- `scripts/keyboard-flows.test.mjs` (Vitest, root): liest `catalog.ts` und `widgets.ts` als Text (IDs per Regex, Widget-Einträge als `<gruppe>:<label-schlüssel>`), `keyboard-flows.ts` per Import; prüft
  - (a) jede ID und jede Widget-Taste hat einen Eintrag (in `SHORTCUT_TESTS` oder `GAPS`), und kein Schlüssel ist unbekannt;
  - (b) jede genannte Datei existiert unter `e2e/tests/`;
  - (c) der Titel steht dort wörtlich in `test('…'` bzw. `it('…'`, unabhängig von `test.describe` (11 Specs nutzen es);
  - (d) der Rumpf dieses Tests — ab dem Aufruf bis zur passenden schließenden Klammer (Klammerzählung, nicht „bis zum nächsten `test(`“) — enthält kein `.click(`, `.hover(`, `.dragTo(`, `.tap(`, `page.mouse`; Ausnahmen nur über `MOUSE_ALLOWED` mit Grund (etwa ein `click()` auf einen Toast, den der Test nicht prüft; nie für den genannten Ablauf selbst). `e2e/helpers.ts` enthält keine Mausaufrufe, die Prüfung des Rumpfs übersieht also keinen Helfer;
  - (e) ein Test mit `test.skip(…)` für ein Projekt gilt dort nicht: der Eintrag nennt `projects` oder es gibt einen zweiten Nachweis bzw. einen Eintrag in `PROJECT_GAPS` mit Grund. Ohne `projects` und ohne `skip` gilt der Test als Nachweis in allen Projekten.
- In dieser Task darf `GAPS` Einträge haben; der Test listet sie.

- [ ] **Step 1:** Test RED (Manifest fehlt).
- [ ] **Step 2:** Einträge für alle Kürzel und Widget-Tasten aus den bestehenden Specs; was keinen reinen Tastatur-Test hat, kommt nach `GAPS`. Die Liste in den Bericht.
- [ ] **Step 3: G2.**
- [ ] **Step 4: Commit** — `test: map every shortcut and widget key to a keyboard-only Playwright test`.

### Task 17b: Tastatur-Manifest: Abläufe

**Modell:** opus

**Files:** `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs`

**Interfaces:**
- `export const FLOW_TESTS: ({ flow: string } & Proof)[]` mit mindestens diesen Abläufen (Kapitel 4 und 5.2): Anmelden (mit zweitem Faktor), Passwort vergessen, Einladung annehmen, Projekt anlegen, Mitglied hinzufügen, Workflow mit Matrix anlegen, Typ mit Pflicht-Property anlegen, Item anlegen, Status/Assignee/Priorität/Labels/Typ/Daten/Eltern ändern, Relation hinzufügen und entfernen, Beschreibung bearbeiten, Kommentieren, Bild einfügen, Datei hochladen, Mehrfachbearbeitung, archivieren/löschen mit Rückgängig, Liste filtern und als View speichern, Board-Zug, Tabellen-Zelle, Timeline-Zug und Einplanen, Suche und Sprung per Key, Inbox abarbeiten, Benachrichtigungen einstellen, Wiki-Seite anlegen, bearbeiten, verschieben, löschen, Version wiederherstellen, Vorlage anlegen und ausführen, Zeitplan einstellen, Automatisierung schalten, Webhook anlegen und pingen, Token anlegen, zweiten Faktor einrichten, Organisation und System-Seite, Theme und Seitenleiste.
- `keyboard-flows.test.mjs` prüft die Abläufe mit denselben Regeln (b)–(e); „lists every flow“ hält die Mindestliste oben als Text fest. Fehlende Abläufe kommen nach `GAPS`.

- [ ] **Step 1:** „lists every flow“ RED.
- [ ] **Step 2:** Abläufe aus den bestehenden Specs eintragen; Lücken nach `GAPS`, die Liste in den Bericht.
- [ ] **Step 3: G2.**
- [ ] **Step 4: Commit** — `test: map every flow to a keyboard-only Playwright test`.

**Danach (Orchestrator):** Task 18 nach der Liste `GAPS` (und bei mehr als drei App-Fehlern) teilen, je ≤ 1 h.

### Task 18 (a…): Fehlende Tastatur-Abläufe

**Modell:** opus

Schließt `GAPS` aus Tasks 17a/17b: je Lücke ein Test in der passenden bestehenden Spec (oder einer neuen `e2e/tests/keyboard-<bereich>.spec.ts`), nur Tastatur (`tabTo`, `arrowTo`, `pressMod`), eigene Daten (`createE2eProject` usw.). Danach verbietet `keyboard-flows.test.mjs` `GAPS` (leer); `PROJECT_GAPS` bleibt nur mit Grund. Fällt dabei ein Ablauf auf, der ohne Maus **nicht** geht, ist das ein Fehler der App: Fix mit Vitest-Test in derselben Task (bei mehr als drei solchen Fehlern teilt der Orchestrator).

**Files:** `e2e/tests/*.spec.ts`, `e2e/keyboard-flows.ts`, `scripts/keyboard-flows.test.mjs`, ggf. `resources/js/**`

- [ ] **Step 1:** `keyboard-flows.test.mjs` „has no gaps“ → RED (bei einer Teilung: nur in der letzten Teil-Task scharf).
- [ ] **Step 2:** je Lücke Test schreiben, gezielt laufen (alle vier Projekte), Manifest eintragen.
- [ ] **Step 3: G2;** G3 gezielt alle geänderten Specs.
- [ ] **Step 4: Commit** je Bereich — `test: <Ablauf> with the keyboard only`.

---

## Block E: Restliche Punkte der Deferred-Liste

Geprüft gegen den Code am 2026-11-07 (Preflight K20). Erledigt bzw. hinfällig und darum nicht hier: 422 auf ein nicht gezeigtes Feld (`noticeOf`/`unplacedMessages`), „Du liest nur mit.“ bei Org-Admins, Witwen (`text-wrap: balance` für `h1`–`h4`), Galerie-Muster (keine Galerie in der App), Tabellen-Picker am Handy (44 px über die Zelle), `retry-all` nur aktive, `Kbd` Strg/Ctrl, `listItemName` als eigenes Modul (`components/items/names.ts`, T12-M3), Relationen-Dialog vergisst die Treffer **beim Leeren** (beim Neutippen nicht: Task 20b). Die Phase-5-Punkte „→ 13c“ der Deferred-Liste sind am 2026-11-07 einzeln gegen den Code geprüft und Tasks zugeordnet (20a, 21e, 21g, 21j, 21l, 21m; erledigte nennt A447); was beim Umsetzen schon erledigt ist, nennt der Bericht (P4).

### Task 19a: Deferred A1: Lese-Look, Mitglieder ohne Mitglieder

**Modell:** opus

**Files:** `resources/js/features/settings/frame/parts.tsx`, `resources/js/features/settings/project/{General,Members,Workflow,Types}.tsx`, Vitest daneben (`project.test.tsx`), `CLAUDE.md`

**Interfaces:**
- **Lese-Look statt ausgegraut (M1):** wer nicht verwalten darf, sieht Lead, Bild, Rollen der Mitglieder, Workflow-Auswahl und Typ-Checkboxen als Text bzw. `ReadOnlyTrigger` im Stil `readOnlyField` (fokussierbar, Wert für Screenreader lesbar, Grund als Beschreibung), nie `disabled`. Der letzte aktive Typ (`last`) bleibt gesperrt, aber per `disabledReason`.
- **Mitglieder ohne Mitglieder (M2):** leerer Zustand nennt den nächsten Schritt (für Verwaltende: „Person oder Bot hinzufügen“ mit Fokus ins Feld; sonst Satz ohne Knopf).

- [ ] **Step 1: Failing Tests** — „shows the lead as text to a reader“, „reads the roles of members without a disabled control“, „reads the workflow and the types without a disabled control“, „names the next step for an empty member list“ (Verwaltende mit Knopf und Fokus, Leser ohne Knopf).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `project-catalog.spec.ts projects.spec.ts a11y.spec.ts`.
- [ ] **Step 5: Commits** je Punkt.

### Task 19b: Deferred A2: Skelette, Timeline leer, Fehlergrenze, Ladesätze

**Modell:** opus

**Files:** `resources/js/components/ui/Skeleton.tsx`, `resources/js/features/items/ListStates.tsx` (`DelayedSkeleton`, Z. 114), `resources/js/features/items/ItemsScreen.tsx` (Z. 228, 236), `resources/js/lib/permissions.ts` (Z. 136), `resources/js/features/items/timeline/TimelineLayout.tsx` (`TimelineEmpty` ist dort eine lokale Funktion, Z. 594), `resources/js/features/items/display/DisplayMenu.tsx`, `resources/js/features/items/layouts.ts`, Vitest daneben, `CLAUDE.md`

**Interfaces:**
- **Skelette erst nach 300 ms (M3):** `SkeletonGroup` (bzw. ein Hook `useLate(ms = 300)`) zeigt nichts, bis 300 ms vergangen sind; alle Skelette der App laufen darüber (`DelayedSkeleton` geht darin auf). Eine Status-Region sagt „Lädt …“ erst mit dem Skelett.
- **Leere Timeline mit Filter (M2, T21-M5):** `TimelineEmpty` bekommt `filtered` und `onResetFilter` und zeigt „Filter zurücksetzen“ wie `ListEmpty`.
- **Fehlergrenze der Layouts (T18-M5):** die lazy Layouts stehen in einer Fehlergrenze, die `ListError` mit „Erneut versuchen“ zeigt (lädt den Chunk neu, Muster `LateBoundary`).
- **`ListError` sagt, dass es läuft (T14-M4):** `retrying` aus `useListData`.
- **Kurze falsche Sätze beim Laden (T17-M3, T17-M7):** die Ursachen sitzen in `ItemsScreen.tsx:228, 236` und `lib/permissions.ts:136`, nicht im `DisplayMenu`: solange die Properties laden, zeigt das Anzeige-Menü eine Property-Sortierung nicht als „Unbekanntes Feld“; solange die Rechte laden, kein Ersteller-Satz am Speichern.

- [ ] **Step 1: Failing Tests** je Punkt (Vitest: „shows no skeleton before 300 ms“, „offers to reset the filter on an empty timeline“, „shows a failed layout chunk with a retry“, „says while it retries“, „calls a loading property sort neither unknown nor sortable“, „shows no creator sentence while rights load“).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `timeline.spec.ts items-list.spec.ts views-save.spec.ts a11y.spec.ts`.
- [ ] **Step 5: Commits** je Punkt.

### Task 20a: Deferred B1: Tabelle

**Modell:** opus

**Files:** `resources/js/features/items/table/{TableLayout,useGridKeys}.ts(x)`, `resources/js/features/items/table/cells/PropertyCells.tsx`, `lang/{en,de}.json`, `table.test.tsx`

**Interfaces:**
- **Gehaltene Pfeile in der Tabelle (T20-M3):** `focusAt` fokussiert sofort, wenn die Zelle schon gerendert ist, sonst im nächsten Frame.
- **Pfeile auf einem Steuerelement einer Zelle (T20-M9):** `cellOf(target.closest('[data-cell]'))`, solange kein Editor offen ist.
- **Ablehnung einer Property-Zelle überlebt das Wegscrollen (T20-M5):** Map auf Ebene der Tabelle, Schlüssel `<rowKey>:<property.key>`.
- **Klick daneben mit unlesbarem Text (T20-M10):** das Popover bleibt offen und zeigt den Fehler (wie Enter).
- **Hilfen einmal (T20-M2):** `TableLayout.tsx:251` wiederholt `useEditReason` von Hand (`itemData.ts:29`), `PropertyCells.tsx:282` `typeHasProperty`: eine Funktion `editReasonOf(item, reason)` ohne Hook und `typeHasProperty` aus `columns.ts`. **Ganzer Satz im Test (T20-M7):** `table.test.tsx:455` prüft den Grund eines Viewers mit `toBe` statt `/nur lesen|lesen/`.
- **Texte der Tabelle (T20-M6):** `items.table.read_only.project` → „Das Projekt eines Items lässt sich nicht ändern.“ / „The project of an item cannot be changed.“; `items.table.edit_hint*` ohne fest geschriebenes ⌘↵ (Kbd aus dem Katalog) und mit „Esc nimmt das Getippte zurück, ein zweites schließt.“

- [ ] **Step 1: Failing Tests** je Punkt in `table.test.tsx`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `table.spec.ts`.
- [ ] **Step 5: Commits** je Punkt.

### Task 20b: Deferred B2: Liste, Board, Filter-Chips, `MobileBar`, Relationen-Dialog

**Modell:** opus

**Files:** `resources/js/features/items/list/ListLayout.tsx`, `resources/js/features/items/board/BoardLayout.tsx`, `resources/js/features/items/filter/{FilterBar,useValueOptions,ConditionChip}.tsx`, `resources/js/shell/MobileBar.tsx`, `resources/js/features/item-detail/Relations.tsx` (Z. 90, 114-115), `lang/{en,de}.json`, Vitest daneben

**Interfaces:**
- **Fokus beim Rad-Scrollen (T13-M4):** `rangeExtractor` hält die Zeile mit dem Fokus (Item-Zeile per `rowKey` **oder** Gruppenkopf), nicht nur die erste Zeile des Cursor-Items.
- **Schnellanlage in einer Spalte mit weiteren Seiten (T19-M3):** Toast `items.board.created_further` („:key steht weiter unten in „:column““) mit „Öffnen“.
- **Filter-Chips (T16-M2, T16-M5):** ein deaktiviertes Konto heißt mit Namen und „(deaktiviert)“, ein Status eines anderen Workflows mit Namen; „Verborgen“ nur für IDs, die der Leser nicht kennt. Scheitert das Laden der Properties, zeigt ein Property-Chip „Nicht geladen“ mit „Erneut versuchen“ statt „Unbekanntes Feld“.
- **`MobileBar` (Klickdummy-Abweichung):** die Schublade schließt nur bei einem neuen Pfad, nicht bei einer neuen Query.
- **Relationen-Dialog beim Neutippen:** die Treffer einer früheren Eingabe (`keepPreviousData`, `hooks/search.ts:20`) stehen gesperrt und nicht wählbar, solange die Antwort `isPlaceholderData` ist (wie `stale` im `SuggestionMenu`); Enter wählt dann nichts.

- [ ] **Step 1: Failing Tests** je Punkt in den bestehenden Vitest-Dateien (`list.test.tsx`, `board.test.tsx`/`drag.test.tsx`, `filter.test.tsx`, `Shell.test.tsx`, `sections.test.tsx`: „offers no hit of an earlier query while the search answers“).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `board.spec.ts filter.spec.ts items-list.spec.ts shell.spec.ts item-sections.spec.ts`.
- [ ] **Step 5: Commits** je Punkt.

### Task 21a: Deferred C1: Backend

**Modell:** sonnet

**Files:** `app/Domain/Views/DisplaySchema.php`, `app/Domain/Filter/FilterSchema.php`, `app/Views/ItemOrder.php`, `app/Actions/System/GetSystemStatus.php`, Tests daneben, `CLAUDE.md` („System“)

**Interfaces:**
- `DisplaySchema::read`: `fields`, das keine Liste ist, wird `DisplaySchema::DEFAULT_FIELDS` (= `DEFAULT_FIELDS` aus `resources/js/domain/viewState.ts`; ein Test liest beide und vergleicht) (T2-M1).
- `FilterSchema`: ein Text aus Unicode-Leerraum (NBSP, U+3000) ist leer (`preg_match('/^[\s\p{Z}]*\z/u', …)`, T2-M2).
- `ItemOrder`: Alias je Index `"sort_{$index}"`, `ALIASES` entfällt (T5-M5).
- `GetSystemStatus`: Meilisearch-Status und Reverb-Probe parallel **im selben Prozess** über `Http::pool` (Reverb `GET /up`; Meilisearch über einen eigenen `Http`-Aufruf von `GET /tasks?…` mit den Indizes dieser Instanz statt des Clients). Nicht `Concurrency::run`: dessen Treiber `process` startet je Rückruf `php artisan invoke-serialized-closure` (Bootstrap etwa 100–200 ms je Prozess unter PHP-FPM, dieselbe Env nötig, Rückrufe müssen serialisierbar sein). Ziel ≤ 3 s statt bis 10 s; Test „asks search and live at the same time“ (`Http::fake` mit Verzögerung oder Zählung beider Anfragen in einem Pool, Ergebnis gleich wie seriell). Geht das wegen des Meilisearch-Clients nicht (etwa weil `ReportsStatus` am Client hängt), bleibt es seriell mit 2 s Timeout je Teil und einem Satz in A447; der Bericht sagt, warum.

- [ ] **Step 1: Failing Tests** je Punkt.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1;** G2 (der Test liest `viewState.ts`).
- [ ] **Step 5: Commits** je Punkt.

### Task 21b: Deferred C2: Frontend

**Modell:** sonnet

**Files:** `resources/js/hooks/{workItemTypes,comments,projects,views,users}.ts`, `resources/js/api/workItems.ts`, `resources/js/components/ui/toast.ts`, Tests daneben, `CLAUDE.md` (Satz zu `ListWorkItemsArgs.q` anpassen)

**Interfaces:**
- Query-Invalidierung der Suche: Kommentare, Projekte, Views und Konten machen `qk.search.all` ungültig; `useSaveWorkItemType` macht `qk.workItems.all` ungültig (T23-M7).
- `useProjectsWith`: `reloadedFor` vergisst eine ID, sobald das Projekt in der Liste ist.
- `ListWorkItemsArgs.q` entfernt samt Tests und dem Satz in CLAUDE.md; **`GroupWorkItemsArgs.q` bleibt** (es erbt heute `q`, und `groupWorkItems` schickt es, `api/workItems.ts:53, 84, 88`): `q` wird dort ausdrücklich deklariert.
- `toast.ts`: die zwei toten Guards in `startTimer` weg.

- [ ] **Step 1: Failing Tests** je Punkt (für `q`: „sends q with the groups“ bleibt grün, „takes no q in the list args“ als Typtest).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2.**
- [ ] **Step 5: Commits** je Punkt.

### Task 21c: Deferred C3: Kleinkram Tests, e2e und Rulings

**Modell:** sonnet

Die billigen Punkte aus Rulings Z. 561, Ledger und Deferred, die in keiner anderen Task standen (Preflight K20). Jeder Punkt ist klein; was sich beim Lesen als größer zeigt, kommt mit Grund in A447 statt in diese Task.

**Files:** `tests/Feature/Models/OrganizationTest.php`, `tests/Feature/SanctumTest.php`, `config/sanctum.php`, `phpstan.neon`, `tests/Feature/EnsureAdminTest.php`, `app/Actions/Auth/ResetTwoFactor.php`, `e2e/helpers.ts`, `resources/js/features/settings/org/People.tsx` (Z. 220), `resources/js/features/settings/frame/parts.tsx` (Nav-Skelett), `resources/js/lib/permissions.ts`, `resources/js/components/fields/Picker.tsx` + Test, `resources/js/features/items/ItemsScreen.tsx` (Z. 152) und `resources/js/features/views/viewForm.ts` (Z. 59), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-rulings.md`, `CLAUDE.md`

**Interfaces / Punkte:**
- **Tests Backend:** `OrganizationTest` prüft das Scoping (`Organization::current()` einmal je Request/Job); `SanctumTest`-Gate, Middleware-Name in `config/sanctum.php`, der phpstan-Ignore dazu weg, wenn er nicht mehr nötig ist; `EnsureAdminTest` zählt Events nach Typ **und** `subject_id` (heute nur `subject_id`, Z. 30).
- **`ResetTwoFactor`:** bei einer unbestätigten Einrichtung den passenden Eventtyp (`user.two_factor_setup_cancelled` statt `…_disabled`), Test.
- **e2e:** `pressMod` nutzt dieselbe Plattform-Erkennung wie der Rest von `helpers.ts` (heute dupliziert, Z. 292-297); Wortlaut von `focusSettledOn`; Timeout von `syncMutagen` benannt; Router-Fallstrick (Kommentar an `routerBadGateways`); Cache-Flush in e2e nur dort, wo eine Spec ihn braucht (Kommentar oder Helfer). Nur Typecheck und gezielte Specs.
- **Frontend:** Reload-Flag wird nach dem Neuladen zurückgesetzt; Breiten des Nav-Skeletts passen in die 12,5-rem-Spalte; `People.tsx:220` Fehlertext richtig und keine zweite Projektlisten-Abfrage; `usePermissions` fragt auf Gast-Seiten nichts; Picker-Test für `onQueryChange` (T13-M1); `copyName` an einer Stelle (T17-M4: heute `ItemsScreen.tsx:152` und `views/viewForm.ts:59`).
- **Rulings:** T4-M1 (Rundung auf vier Stellen) und T4-M2 (`value_text` mit `\n`) als Sätze in den Rulings; `invitation.welcome` in den Klickdummy-Rulings.

- [ ] **Step 1: Failing Tests** je Punkt mit Test (die reinen Text- und Rulings-Punkte ohne).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1 + G2;** `pnpm --dir e2e typecheck`; G3 gezielt `settings-organization.spec.ts palette.spec.ts`.
- [ ] **Step 5: Commits** je Bereich — `test: …`, `fix: …`, `docs: …`.

---

## Block E2: Aus A447 vorgezogen (Rafaels Antwort 5)

Geprüft gegen den Code am 2026-11-07: alle vier Hauptpunkte sind offen (Belege je Task). Jede Task beginnt mit RED.

### Task 21d: Ränge eines Projekts neu verteilen (Server)

**Modell:** opus

Heute rechnet der Browser den Rang (`domain/boardRules.ts:176-182` `rankForSlot`, A104); wird er länger als `RANK_MAX` 128, sagt das Board „Hier ist kein Platz mehr“ (`BoardLayout.tsx:410`, A180), und der Server lehnt längere Ränge ab (`ItemInput.php:245`). Eine Neuverteilung gibt es nur im Wiki (`PageRanks.php:51-68`, A320). Neu (A448, ändert A180): der Server verteilt die Ränge aller Items eines Projekts neu, in ihrer Ordnung.

**Files:**
- Create: `app/Actions/WorkItems/RedistributeRanks.php`, `tests/Feature/WorkItems/RedistributeRanksTest.php`, `tests/Integration/RedistributeRanksRaceTest.php`
- Modify: `routes/api.php` (`POST /api/v1/projects/{project}/redistribute-ranks`), `app/Http/Controllers/Api/WorkItemsController.php` oder ein eigener invokabler Controller, `app/Events/EventType.php` (`project.ranks_redistributed`, ohne Webhook), `app/Policies/ProjectPolicy.php` (`redistributeRanks`: sichtbar, sonst 404; `item.edit`, sonst 403 `items_members_only`), `app/OpenApi/WorkItemSchemas.php` (Antwort `{redistributed}`), `app/Search/SearchConsumer.php` (übergeht den Typ), `app/Notifications`-Fakten (kennen ihn nicht), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `resources/js/hooks/live.ts` (der Typ macht `qk.workItems.all` ungültig wie `project.updated`) + Test, `docs/{en,de}/concepts/work-items.md` (manuelle Ordnung), `docs/{en,de}/api.md`, `CLAUDE.md`

**Interfaces:**
- `RedistributeRanks::handle($actor, Project|string $project): int` (Zahl der umgeschriebenen Items): Referenz über `Project::findByReference`, `Authorize::check($actor, 'redistributeRanks', $project)`, dann `DB::transaction(…, 3)`: `CatalogLock::share()` → `MemberInput::lock($project)` (in Löschung 404, archiviert 409 `project_archived`) → alle Items des Projekts (auch archivierte) nach `rank`, `id` mit `lockForUpdate` in Blöcken per `chunkById` nur zum Lesen der Ordnung, neue Ränge `Rank::nBetween(null, null, n)` in dieser Ordnung, geschrieben nur für Zeilen mit anderem Rang per `toBase()->update(['rank' => …])` (ohne `updated_at`, ohne Event je Item: die manuelle Ordnung ist keine History, A320/K13 aus Phase 9), dann **ein** `project.ranks_redistributed` (Subjekt Projekt, `changes` `null`, `meta.count`). Kein Item ändert seinen Platz im Projekt; über Projekte hinweg (eine Liste mehrerer Projekte nach „Manuell“) kann sich die Mischung ändern (A448).
- REST → 200 `{redistributed: n}` ohne `data`; ein Lese-Token 403 (Fähigkeit `write`).
- Live: der Typ geht wie jedes `project.*` an `private-project.{id}`; `useLiveSync` lädt danach die Items.

- [ ] **Step 1: Failing Tests** — „keeps the order and shortens every rank“ (60 Items mit Rängen von 120 Zeichen und gleichen Rängen → danach gleiche Ordnung nach `rank`, `id`, jeder Rang ≤ 3 Zeichen, `updated_at` unverändert, ein Event), „counts only items whose rank changed“, „refuses a viewer and hides an invisible project“, „refuses an archived project“, „takes archived items along“; Matrix- und Routenzeilen; Live-Hook „reloads the items after the ranks of a project were redistributed“; `RedistributeRanksRaceTest`: ein gleichzeitiges `PATCH rank` desselben Projekts wartet auf die Projektsperre (`expectLockWait` auf `projects`) und landet danach zwischen den neuen Rängen.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1** + Integration `--filter=RedistributeRanks`; G2 für `live.ts`; **GL**: Dauer für 2 500 Items eines Projekts in `ApiLoadTest` als eigene Zeile (in einer Transaktion, die zurückrollt), Budget 1,5 s.
- [ ] **Step 5: Commit** — `feat: redistribute the ranks of a project on the server`.

### Task 21e: Ränge neu verteilen (Board)

**Modell:** opus

**Files:** `resources/js/api/workItems.ts` (`redistributeRanks(projectId)`), `resources/js/hooks/workItems.ts` (`useRedistributeRanks`, macht `qk.workItems.all` ungültig), `resources/js/features/items/board/{BoardLayout,useBoardDrag}.tsx`, `resources/js/domain/boardRules.ts` (Kommentar), `lang/{en,de}.json` (`items.board.reranking`), Tests `board.test.tsx`, `drag.test.tsx`, `test/board.tsx` (falscher Server kennt den Endpunkt), `e2e/tests/board.spec.ts`

**Interfaces:**
- Liefert `rankForSlot` `null` (Taste ⌥↑/⌥↓ oder Ablegen in der eigenen Spalte bei „Manuell“), ruft das Board einmal `redistributeRanks(<Projekt des Items>)`, wartet, bis die Seiten der Spalte neu geladen sind (`invalidateQueries` mit `refetchType: 'active'` abwarten), rechnet den Rang mit den frischen Nachbarn neu und schickt den `PATCH`; ist er dann noch `null` (Nachbarn aus einem anderen Projekt), bleibt der heutige Toast `no_room`. Die Statuszeile sagt `items.board.reranking` („Ordnung wird neu verteilt …“) und danach den Zug wie sonst; die Karte bleibt bis dahin an ihrem Platz (`inTurn`, `placements`).
- Ein Fehler der Neuverteilung: `notifyError` mit „Erneut versuchen“, die Karte springt zurück.
- Dazu T19-M5/M7 (Deferred, offen): `drag.test.tsx:366` prüft beim Ablegen zwischen gleichen Rängen auch, dass der neue Rang unter dem nächsten liegt; `BoardColumn.tsx:180-210` den `<ul>` im `SortableContext` einrücken.

- [ ] **Step 1: Failing Tests** — „redistributes the ranks when there is no room and moves the card“, „keeps the card and says no room when the neighbours belong to another project“, „puts the card back when the redistribution fails“ (Vitest, falscher Server); e2e „moves a card where the ranks ran out“ (eigenes Projekt, zwei Items per API mit Rängen von 127 Zeichen über `PATCH rank`, ⌥↑ per Tastatur).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `board.spec.ts`.
- [ ] **Step 5: Commit** — `feat: make room in the board when the ranks ran out`.

### Task 21f: Kinder eines Epics seitenweise

**Modell:** opus

Heute lädt `include=children` alle Kinder (`GetWorkItem.php:48-50`, A186); das Detail zeigt sie aus `WorkItemDetail.children` (`api/workItems.ts:100-118`, `item-detail/Children.tsx`). Neu (A449, ändert A186): höchstens 100, der Rest seitenweise über die Item-Liste.

**Files:** `app/Actions/WorkItems/GetWorkItem.php` (`CHILDREN_MAX` 100), `app/OpenApi/ItemQueryDocs.php` bzw. die Beschreibung von `include` (nennt die Grenze und den Weg über `filter[parent]`), `app/Mcp/**` (falls ein Tool `include=children` nutzt: dieselbe Grenze im Text), `resources/js/features/item-detail/Children.tsx`, `resources/js/hooks/workItems.ts` (nur falls `useInfiniteWorkItems` eine Option braucht), `lang/{en,de}.json` (`items.detail.children.more`, `items.detail.children.shown`), Tests `tests/Feature/WorkItems/GetWorkItemTest.php`, `tests/Feature/Api/WorkItemsApiTest.php`, `features/item-detail/sections.test.tsx`, `e2e/tests/item-sections.spec.ts`, `docs/{en,de}/api.md`, `CLAUDE.md` („Items lesen“)

**Interfaces:**
- Server: `include=children` lädt die ersten `GetWorkItem::CHILDREN_MAX` Kinder nach `rank`, `id` (archivierte eingeschlossen, wie heute), über eine eigene Abfrage mit `limit` (kein `load('children')`), `loadForResource` wie heute. Wie viele es gibt, sagt `children_progress.total` (zählt archivierte mit); kein neues Feld.
- Browser: `Children` zeigt bis zu 100 aus dem Detail; ist `children_progress.total` größer, nimmt der Abschnitt stattdessen `useInfiniteWorkItems({ parent_id: item.id, include_archived: true, show_sub_items: true, sort: manual, lean: true })` (erste Seite 100, dieselbe Ordnung) mit „Weitere Kind-Items laden“ (`loadMore`, Fehler mit „Erneut versuchen“) und „:shown von :total“. Jeder andere Leser von `detail.children` (Typwechsel `hasChildren`, `useChildType`, Befehle) entscheidet über `children_progress.total`, nie über die Länge der Liste; der Bericht nennt die geprüften Stellen.

- [ ] **Step 1: Failing Tests** — `GetWorkItemTest` „embeds at most 100 children in manual order“ (130 Kinder, 100 im Ergebnis, die ersten nach Rang, `children_progress.total` 130, feste Zahl Abfragen); Vitest „loads the further children page by page“, „says how many children it shows“; e2e mit 101 Kindern per API (eigenes Projekt, `beforeAll`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1 + G2;** G3 gezielt `item-sections.spec.ts`; **GL**: Zeile „Epic mit 40 Kindern“ unverändert.
- [ ] **Step 5: Commits** — `perf: embed at most 100 children of an item`, `feat: load the further children of an epic page by page`.

### Task 21g: Text-Properties natürlich sortieren

**Modell:** opus

Heute sortieren Text und URL nach Kollation (`ItemOrder.php:53-54`, `domain/sort.ts:97` `Intl.Collator` ohne `numeric`, A168): „Item 10“ steht vor „Item 9“. Neu (A450, ändert A168): natürliche Ordnung auf beiden Seiten gleich: in MariaDB `natural_sort_key()` (seit 10.7, 11.4 hat sie), im Browser `Intl.Collator(intlLocale(), { sensitivity: 'base', numeric: true })` nur für Text- und URL-Properties (Kennungen, Status, Titel bleiben).

**Files:** `app/Views/ItemOrder.php` (Schlüssel der Typen `text`/`url`: `natural_sort_key(<wert>)`, Cursor-Wert ist dieser Schlüssel als Text), `resources/js/domain/sort.ts` + `sort.test.ts`, `resources/js/domain/natural-sort-fixtures.json` (neu: Liste von Texten in erwarteter Ordnung), `tests/Integration/NaturalSortTest.php` (neu, echte MariaDB), `tests/Feature/Views/ItemOrderTest.php`, `docs/{en,de}/concepts/views.md` (Satz zur Sortierung), `CLAUDE.md` („Sortierung und Cursor der Items“, „Regeln der Listen im Browser“)

**Interfaces:**
- Fixtures wie `rank-fixtures.json`: eine Datei, die PHP (gegen MariaDB) und Vitest lesen: `["Item 2", "Item 9", "Item 10", "item 11", "Item 100", "Version 1.2", "Version 1.10", …]`; nur Fälle, in denen beide Seiten gleich ordnen. Wo `natural_sort_key` und `Intl` sich unterscheiden (führende Nullen, Dezimalpunkte, Vorzeichen, Ziffern anderer Schriften), sagt der Bericht es mit Beispiel, und das Ruling nennt den Unterschied (der Server entscheidet die Seiten, der Browser nur die Lage nach einer optimistischen Änderung).
- **Eltern-Gruppen (T8-M7, offen):** `Grouping.php:279` ordnet nach `identifier`, dann `number`; Kennungen dürfen Ziffern haben (`Identifier.php:11`), `A10` steht vor `A2`. Neu `natural_sort_key(identifier)`, dann `number` (Test in `GroupingTest.php`). Die Sortierung `key` der Items (`ItemOrder.php:241`) bekommt dieselbe Regel, damit Gruppen und Sortierung gleich ordnen; `sort.ts` vergleicht Kennungen dann ebenfalls mit `numeric: true`.
- Keyset: Ordnung und Bedingung nutzen denselben Ausdruck; ein Cursor der alten Form (Kollationswert) ist 422 `field.cursor.invalid` oder liefert eine korrekte Folgeseite, nie 500 (Test).

- [ ] **Step 1: Failing Tests** — `NaturalSortTest` „orders texts like the browser“ (Fixtures über `select … order by natural_sort_key(…)`), `ItemOrderTest` „sorts a text property naturally“, „pages a natural sort exactly once“ (die bestehende Prüfung „pages every item exactly once“ mit Texten mit Zahlen); `sort.test.ts` „orders text properties like the server“ (Fixtures), „keeps titles and keys as they are“.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** `EXPLAIN` einer Property-Sortierung vorher/nachher in den Bericht (die Unterabfrage bleibt; **GL**-Zeile `property:<text>` dazu).
- [ ] **Step 4: G1 + G2;** Integration `--filter=NaturalSort`; G3 gezielt `table.spec.ts`.
- [ ] **Step 5: Commit** — `feat: sort text properties naturally on the server and in the browser`.

### Task 21h: Live-Updates für Personen ohne Projektkanal

**Modell:** opus

Heute geht jedes `project.*` nur an `private-project.{id}` (`LiveConsumer.php:18, 69`); ein neues Projekt hält noch niemand, ein Projekt, das öffentlich wird, halten nur Mitglieder (und Org-Admins). Andere Personen, die es danach sehen, erfahren es erst beim Neuladen (Final-Review Phase 8 M3). Neu (A451): an diese Personen über ihren eigenen Kanal, nur, wenn `Visibility` sagt, dass sie das Projekt sehen.

**Files:** `app/Live/LiveConsumer.php`, `app/Live/LiveMessage.php` (eine Nachricht an bis zu 100 Kanäle: `broadcastOn()` gibt eine Liste; Laravels Pusher-Broadcaster teilt selbst in Blöcke zu 100), `app/Live/Broadcasts.php` (falls nötig), `tests/Feature/Live/LiveConsumerTest.php`, `e2e/tests/live.spec.ts`, `docs/{en,de}/concepts/notifications.md` (Live), `CLAUDE.md` („Live: Konsument“)

**Interfaces:**
- Für `project.created` und `project.updated` mit `changes.visibility.new = public`: die aktiven Personen (keine Bots, `disabled_at` leer) per eine Abfrage, dann `Visibility::forget()` und `Visibility::seeing($project, $personen)`; an jede davon außer dem Actor geht die Nachricht des Events auf `presence-user.{id}` (dieselbe Payload wie auf dem Projektkanal, `socket` wie dort), gebündelt zu 100 Kanälen je Nachricht. Ein privates neues Projekt erreicht so nur Mitglieder und Org-Admins; ein Projekt in Löschung niemanden. Mitglieder, die den Projektkanal schon halten, bekommen sie doppelt; der Browser entdoppelt über `event_id`.
- Der Browser braucht nichts Neues (`project.*` lädt `qk.projects.all`, `LiveHost` meldet den neuen Projektkanal an); der Test belegt es.
- Feste Zahl Abfragen je Event (zwei: Personen, Mitglieder), unabhängig von der Zahl der Personen.

- [ ] **Step 1: Failing Tests** — `LiveConsumerTest`: „tells everyone who sees a new public project on their own channel“, „tells only members and org admins about a new private project“, „tells people about a project that turned public“, „sends a hundred channels per message“ (150 Personen → zwei Nachrichten), „asks the same number of queries for 2 and 50 people“, „sends nothing for a project that is being deleted“; e2e (`live.spec.ts`): die Inbox-Person ist kein Mitglied, Erik legt per API ein öffentliches Projekt an → es erscheint in ihrer Projektliste ohne Neuladen (Positivkontrolle über `channelHeld` auf `presence-user`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** `ddev restart` (Konsumenten lesen Code beim Start).
- [ ] **Step 4: G1;** G3 gezielt `live.spec.ts`.
- [ ] **Step 5: Commit** — `feat: tell people about a project they can see before they listen to it`.

### Task 21i: Wiki: drei Reste aus Phase 9

**Modell:** opus

Geprüft am 2026-11-07, alle drei offen:
- **403 bei weiter „darf“:** `features/wiki/usePageSave.ts:299-302` setzt nur „Nicht gespeichert“ und lädt `qk.projects.all`; `PageSheet.tsx:254` zeigt `ParkedDraft` nur ohne `canEdit`. Melden die neu geladenen Rechte weiter „darf“ (etwa eine Regel des Servers, die der Browser nicht kennt), steht nur „Nicht gespeichert“ ohne Satz und ohne Weg.
- **Rückgängig nach „Neu laden“ bricht still ab:** `restoreMine` (`usePageSave.ts:400`) endet, wenn `flush()` `false` gibt; ein leerer Titel (`:259-260`) oder ein laufender Upload (`:250-254`) machen das ohne Satz.
- **Versionen eines gelöschten Projekts laden beim Wiederverbinden:** `project.deleted` merkt nur die Projekt-ID (`hooks/live.ts:98, 330-332`); `qk.pageVersions.*` tragen kein `project_id` (`types.ts:600-613`), `usePageVersion`/`usePageVersions` (`hooks/pages.ts:199-211`) fragen nur `usePageGone`: ein offener Versionen-Dialog fragt nach `live.reconnected` und bekommt 404.

**Files:** `resources/js/features/wiki/{usePageSave.ts,PageSheet.tsx,VersionsDialog.tsx}`, `resources/js/hooks/pages.ts`, `lang/{en,de}.json` (`wiki.save.refused`, `wiki.conflict.undo_blocked.title_required|uploading`), Tests `features/wiki/{usePageSave.test.tsx,versions.test.tsx}`, `hooks/live.test.tsx`

**Interfaces:**
- 403: nach dem Neuladen der Rechte, gilt die Seite weiter als änderbar, `notifyError(t('wiki.save.not_saved'), error, retry)` mit dem Satz des Servers; sonst bleibt `ParkedDraft` (heute). Der Entwurf bleibt in beiden Fällen.
- Rückgängig: scheitert `flush()` ohne Konflikt, ein Toast mit dem Grund (leerer Titel → Fokus auf den Titel; laufender Upload → der Toast sagt es und das Rückgängig wartet auf das Ende der Uploads und läuft dann, höchstens einmal).
- `usePageVersions(pageId, projectId)` und `usePageVersion(pageId, versionId, projectId)` fragen nichts, solange `useLiveGone(projectId)` gilt; die Aufrufer geben die ULID des Projekts mit.

- [ ] **Step 1: Failing Tests** — „says why a refused save failed while the rights still allow it“, „says why undo after reload could not run with an empty title“, „undoes after reload once the upload finished“, „asks for no version of a page whose project was deleted“ (Bus-Ereignisse `project.deleted`, dann `live.reconnected`: kein `GET …/versions`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `wiki.spec.ts`.
- [ ] **Step 5: Commits** je Punkt.

### Task 21j: Kleinkram aus K20: Backend und Tests

**Modell:** sonnet

Geprüft am 2026-11-07, alle offen:
- **Verwaiste neue Datei nach einem Rollback:** `app/Support/ImageInput.php:71` fügt das neue Bild ohne `DB::afterRollBack` hinzu (nur die alten Dateien warten auf den Commit, `:64`); `UploadAttachment.php:86` und `TemplateAttachments.php:120` räumen schon auf. Fix: `DB::afterRollBack(fn () => app(Filesystem::class)->removeAllFiles($media))`; Test: `tests/Feature/Api/OrganizationApiTest.php:175` („keeps the old logo whole …“) prüft dazu, dass der Ordner des neuen Bilds weg ist; ebenso für Avatar und Projektbild je ein Fall.
- **T3-M2:** `CatalogProperties` (`AppServiceProvider.php:61`, `scoped`) wird nach `SaveProperty`/`DeleteProperty` nicht vergessen. Fix: `DB::afterCommit(fn () => app()->forgetInstance(CatalogProperties::class))` in beiden; Test in `tests/Feature/Views/CatalogPropertiesTest.php` (speichern, dann im selben Prozess eine Liste mit der neuen Property sortieren).
- **T5-M3/T5-M4:** Docblock von `ItemOrder::page()` warnt, dass die Zeilen `sort_*`/`_sig` tragen und nie `save()` sehen dürfen (Test „refuses to save an item of a page“ hält das fest); die zwei Docblocks an `ItemOrder.php:220-221` werden einer, der Cast heißt defensiv.
- **T7-M1/M3/M4/M7:** Mutationstabelle als Kommentar und die `save()`-Warnung in `tests/Feature/WorkItems/QueryWorkItemsTest.php` und `tests/Feature/Views/ItemQueryTest.php`.
- **Schärfere Gegenproben der Relevanz (T7-M1–M4 aus Phase 6):** der Wortlaut der Befunde ist nicht mehr auffindbar; offen nach dem Code: `tests/Integration/SearchRelevanceTest.php:38` zeigt nicht, dass nur das letzte Wort ein Präfix ist (Gegenprobe: das Präfix eines früheren Worts findet nichts), `:107` hat keinen Fall, der **nicht** treffen darf. Beide ergänzen; die übrigen Fälle (`:50-51`, `:80`, `:100-104`, `:124`) haben schon Gegenproben.
- **T24-M3/M4:** `ViewsSeederTest.php:66-70` vergleicht von der Darstellung nur `layout`: dazu `group_by`, `sort`, `fields`, `created_at` und die Werte der Bedingungen; `FavoritesSeeder.php:54` liest den Ersteller aus der gespeicherten View statt aus `ViewsSeeder::CREATORS`.
- **T25-M4/M6:** `ViewsAcceptanceTest.php:44` fragt den Typ doppelt (`$type` aus `:37` nehmen); der Fall `:105` bekommt eine Variante mit View-Filter und Epic-Bedingung zusammen.

**Files:** wie oben, `CLAUDE.md` („Bilder“: neues Bild nach Rollback weg)

- [ ] **Step 1: Failing Tests** je Punkt mit Verhalten (Bild nach Rollback, `CatalogProperties`, `save()` einer Seite, Relevanz, Seeder-Vergleich); die reinen Kommentare ohne Test.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G1** + Integration `--filter=SearchRelevance`.
- [ ] **Step 5: Commits** je Bereich — `fix: …`, `test: …`.

### Task 21k: `MemberInput` aufteilen

**Modell:** sonnet

`App\Support\MemberInput` hat `lock()` (die Sperre der Projektzeile, 13 Aufrufer, auch `UpdateProject`, `DeleteProject`, `AssignWorkflow`, `CreateWorkItem`, `SaveTemplate`, `DeleteTemplate`, `FailScheduledTemplate`, `RedistributeRanks`), dazu `role()`, `isMember()` (5, auch `Access\Assignable.php:26`) und `membership()` (3); der Name sagt nicht, dass es das Projekt sperrt (Vormerkung Phase 12; der Docblock `:15-16` hielt den Namen damals bewusst). MCP benutzt es nur über die Actions.

**Files:** `app/Support/ProjectLock.php` (neu, `lock()`), `app/Support/ProjectMembership.php` (neu, `role`, `isMember`, `membership`), alle 22 Aufrufer, `tests/Unit/ArchTest.php` (falls es `MemberInput` nennt), `CLAUDE.md` (jede Nennung von `MemberInput::lock` → `ProjectLock::lock`, die Sperr-Reihenfolge, Fallstricke), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (nur ein Satz unter der Vormerkung: umbenannt in Phase 15)

- [ ] **Step 1: Failing Test** — `ArchTest` „has no MemberInput“ (die Klasse gibt es nicht mehr) und „locks projects only through ProjectLock“ (kein `lockForUpdate` auf `projects` außerhalb von `ProjectLock`, `PageLock`, `ItemLock`, `CatalogLock`; der Bericht nennt die gefundenen Stellen).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umbenennen** ohne Verhaltensänderung.
- [ ] **Step 4: G1** (voll) + Integration `--filter='ProjectMember|ProjectIdentifier|WorkItemNumber|TemplateRun'`.
- [ ] **Step 5: Commit** — `refactor: split MemberInput into ProjectLock and ProjectMembership`.

### Task 21l: Kleinkram aus K20: Frontend A (Felder, Filter, Listenzustand)

**Modell:** opus (Fokus-Verhalten)

Geprüft am 2026-11-07, alle offen (die Phase-5-Punkte „→ 13c“ der Deferred-Liste, die keine andere Task nimmt):
- **T11-M6:** `components/fields/DateField.tsx:97` tauscht `ReadOnlyTrigger` ↔ `DatePopover` ohne die Fokus-Übergabe des Pickers (`Picker.tsx:244-253`); ein Hook `useFocusSwap(readOnly)` für beide. Test nach dem Muster `fields.test.tsx:985`.
- **T11-M7/M8:** `sections.test.tsx` „refuses a target after the kind turned to :in“ (Ziel wählen, Art auf `…:in`, senden → Ablehnung am Ziel); `fields.test.tsx` „keeps the focus when an open picker turns read-only“ (dieselbe Prüfung wie `:997-999`, mit offenem Popover).
- **T12-M5/M6:** `items.test.tsx:278` prüft die Namen der Datums-Chips wörtlich; `ItemRowBase.onOpen` nur zusammen mit `cursor` Pflicht (Union-Typ).
- **T14-M3, T14-M5/M7:** `useListState.ts:71-73` löscht `pending`, wenn der Server eine Adresse mit anderen Zustandsparametern liefert; `useListState.ts:52` erfindet für `view` ohne View keine Projektbasis (wirft); `useListData.ts:79` ohne `_options`.
- **T15-M6:** `catalog.ts:38-41` nennt für `item.*` den Bereich `detail`, der Mount in Listen ist `list`: Kommentar im Katalog und ein Satz in `docs/{en,de}/keyboard.md` (über `scripts/shortcuts-doc.mjs`, falls der Satz erzeugt wird).
- **T16-M4:** × an einem Chip mit getipptem Text ändert die Adresse zweimal (`filter/values/InlineInput.tsx:62-64`): kein Übernehmen beim Blur, wenn `relatedTarget` das × des Chips ist. Test zählt `router.get`.
- **T16-M6:** ein Test geht den Datums-Popover des Filters nur mit der Tastatur (Schnellauswahl, Abstand, Kalender) in `filter.test.tsx`.
- **T10-M1/M5/M6, T10-M4:** Kommentare in `domain/grouping.ts:103` und `grouping.test.ts:267` („der spätere Eintrag in `served` gewinnt“); `BoardReason` bekommt eine Variante `sentence` statt des `edit`-Musters mit fertigem Satz (`boardRules.ts:108`, Test `boardRules.test.ts`).

**Files:** wie oben, Tests daneben.

- [ ] **Step 1: Failing Tests** je Punkt mit Verhalten.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** G3 gezielt `filter.spec.ts items-list.spec.ts item-sections.spec.ts`.
- [ ] **Step 5: Commits** je Punkt.

### Task 21m: Kleinkram aus K20: Frontend B (Board, Timeline, Kataloge, Kommentare, e2e)

**Modell:** sonnet

Geprüft am 2026-11-07, alle offen:
- **N3 (Phase 7):** `item-detail/comments/CommentComposer.tsx:86` übernimmt im ungesendeten Rest einer nummerierten Liste `attrs.start` der gesendeten; neu `start` = alter Start + Zahl der gesendeten Punkte (minus eins, wenn der letzte gesendete Punkt weiterwuchs). Test im Block `describe('unsentRest')` von `comments.test.tsx`.
- **`c` und „Vorlage anwenden“ ohne Recht:** `shell/bindings.tsx:51` und `features/templates/applyTemplate.tsx:56` zeigen `permissions.reason.item_create.nowhere` ohne nächsten Schritt; der Satz bekommt ihn in de/en („Bitte eine Projekt-Admin, dich als Mitglied aufzunehmen.“ sinngemäß, gleiche Platzhalter). Test im Palette- bzw. Shell-Test.
- **T17-M8/R1:** `display/options.ts:53-55, 62-67` behält eine Sortierung auf eine gelöschte Property, solange `properties` fehlt: Speichern wartet auf die Properties (Grund am Knopf). Test in `save.test.tsx`; dazu der ganze Satz statt nur `aria-disabled` an `:277` (T17-M5).
- **T18-M3:** `ItemsScreen.tsx:118` wartet auf jedes `[data-skeleton]`: nur noch `[data-layout-skeleton]` am Fallback des Layouts. Test in `screen.test.tsx`. (19b ändert die Skelette; diese Task läuft danach.)
- **T21-M6:** `timeline.test.tsx` „puts the bar back when the server refuses the dates“ (422, Balken zurück, Toast).
- **T23-M6:** `catalogs.test.tsx:572` nimmt `rowOf` statt `rowOf2`, die Bestätigung mit 0, die Projektkarte „dann die Zahl“.
- **T25-M1/M2/M5:** `e2e/tests/views-acceptance.spec.ts` nimmt die Helfer von `timeline.spec.ts` aus einem gemeinsamen Modul `e2e/timelineHelpers.ts`, benennt das lokale `shown` um und wählt Text per `ControlOrMeta+a` statt `selectText()`.

**Files:** wie oben, `lang/{en,de}.json`.

- [ ] **Step 1: Failing Tests** je Punkt mit Verhalten.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: G2;** `pnpm --dir e2e typecheck`; G3 gezielt `views-acceptance.spec.ts timeline.spec.ts comments.spec.ts`.
- [ ] **Step 5: Commits** je Bereich.

---

## Block F: Screenshots und Doku

### Task 22a: Englische Demo-Daten: Mechanismus, Organisation, Personen, Katalog, Projekte, Views

**Modell:** opus

Rafaels Antwort 3 (A443): die englischen Screenshots zeigen englische Demo-Daten. Die Demo-Seeder schreiben heute deutsche Texte inline (`database/seeders/Demo/*.php`, zusammen rund 2 900 Zeilen; `ItemsSeeder` allein 937). Neu: **dieselben Seeder** in zwei Sprachen. Die Struktur (Handles, Kennungen `WEB`/`APP`/`OPS`, Keys und Nummern, Zeiten, Status, Typen per Schlüssel, Beziehungen, Relationen, Rollen, Favoriten) bleibt eine; nur Texte kommen je Sprache. Kein zweiter Satz Seeder.

**Files:**
- Create: `database/seeders/DemoSeederEn.php` (`extends DemoSeeder`, `protected const LOCALE = Locale::En`), `database/seeders/Demo/Texts/{DemoTexts,German,English}.php`, `tests/Feature/Seeders/EnglishDemoTextsTest.php`
- Modify: `database/seeders/DemoSeeder.php` (Sprache an die Demo-Seeder weitergeben: `DemoTexts::use(static::LOCALE)` vor `call`, im `finally` zurück), `database/seeders/Demo/{OrganizationSeeder,PeopleSeeder,BotsSeeder,CatalogSeeder,ProjectsSeeder,ViewsSeeder,FavoritesSeeder,TokensSeeder}.php` (Texte über `DemoTexts`), `tests/Feature/DemoSeederTest.php` (bleibt grün, deutsch unverändert), `docs/{en,de}/development.md` (Demo-Daten: `DemoSeederEn`), `CLAUDE.md` („Seeder“, Kommandos: `ddev artisan db:seed --class=DemoSeederEn`)

**Interfaces:**
- `Database\Seeders\Demo\Texts\DemoTexts` (final, statisch, nur Seeder): `use(Locale $locale)`, `current(): Locale`, `get(string $key): string|array` → aus `German::TEXTS` bzw. `English::TEXTS` (je `public const TEXTS = [<schlüssel> => <text>]`). Ein Schlüssel, den die aktive Sprache nicht kennt, wirft `RuntimeException` mit dem Schlüssel (kein Rückfall auf Deutsch: eine halb übersetzte Demo fiele sonst nicht auf).
- Schlüssel stabil und sprachfrei: `organization.name`, `person.<handle>.name`, `bot.<handle>.name|description`, `catalog.workflow.agency.name|description`, `catalog.state.<schlüssel>`, `catalog.type.<schlüssel>.name|description`, `catalog.property.<key>.label|help|option.<schlüssel>`, `catalog.label.<schlüssel>`, `catalog.relation.<built_in|schlüssel>.*`, `project.<KENNUNG>.name|description`, `view.<schlüssel>.name` (Schlüssel aus dem Ersteller und der Nummer im Seed, nie der Name). Die Seeder, die heute über einen deutschen Namen suchen (`updateOrCreate` über Workflow-, Typ-, Labelname; Views über Name und Ersteller), suchen über den Text der **aktiven** Sprache: ein zweiter Lauf derselben Sprache bleibt idempotent; beide Sprachen in einer Datenbank sind nicht vorgesehen (gleiche Keys) und `DemoSeederEn` bricht auf einer Datenbank mit deutscher Demo-Organisation (`name` = `Feldwerk`) mit einer Meldung ab, ebenso `DemoSeeder` auf `Fieldwork`.
- `DemoSeederEn`: Organisation „Fieldwork“, `locale` `en`, Zone `Europe/Berlin` wie deutsch (gleiche Zeiten, gleiche Termine); Personen mit englischen Namen, gleichen Handles, `locale` `en`, Mails `<handle>@fieldwork.example.com`; Bots gleiche Handles. Mitgelieferte Katalog-Einträge (`EnsureCatalog` folgt der Sprache der Organisation zur Zeit der Migration): der englische `CatalogSeeder` setzt ihre Texte auf die englischen `catalog.builtin.*` aus `lang/en.json`, wie der deutsche heute die deutschen setzt.
- Englische Wörter: kurz, natürlich, kein „Denglisch“; Workflow „Agentur-Freigabe“ → „Agency approval“, Typ „Kundenwunsch“ → „Client request“, die übrigen nach dem Klickdummy sinngemäß. Alles fiktiv.

- [ ] **Step 1: Failing Tests** — `EnglishDemoTextsTest`: „knows every key in both languages“ (die Schlüssel von `German::TEXTS` und `English::TEXTS` sind gleich, kein Wert leer), „writes no German into the English texts“ (kein `ä ö ü ß Ä Ö Ü` und keins der Wörter `und`, `der`, `die`, `das`, `nicht`, `mit`, `für`, `ist` als ganzes Wort in `English::TEXTS`; Eigennamen über eine Liste mit Grund), „throws for a key the language lacks“, „seeds the organization, people, catalog, projects and views in English“ (`RefreshDatabase`, `Storage::fake('local')`, `searchEngine()`; `db:seed --class=DemoSeederEn` bis einschließlich `FavoritesSeeder` über einen Test-Seeder, der nur diese ruft: Organisation `Fieldwork`/`en`, sechs Personen mit `@fieldwork.example.com` und gleichen Handles wie deutsch, „Agency approval“ mit sieben Status und 14 Übergängen, drei Projekte mit gleichen Kennungen, sechs Views mit gleichem Filter und gleicher Darstellung wie deutsch bis auf Namen), „seeds the English demo twice without a change“, „refuses English demo data on a German demo database“ und umgekehrt.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen** — deutsche Texte nach `German::TEXTS` verschieben (Inhalt unverändert; `DemoSeederTest` und die Seeder-Tests gegen den Klickdummy bleiben grün und belegen das), englische dazu.
- [ ] **Step 4: G1.**
- [ ] **Step 5: Commit** — `feat: seed the demo organization, people, catalog, projects and views in English too`.

### Task 22b: Englische Demo-Daten: Items, Aktivität, Kommentare, Dateien

**Modell:** sonnet

**Files:** `database/seeders/Demo/{ItemsSeeder,ActivitySeeder,CommentsSeeder,AttachmentsSeeder}.php`, `database/seeders/Demo/Texts/{German,English}.php`, `database/seeders/Demo/files/en/` (englische Gegenstücke der drei Dateien: `hero-draft.png` (Bild unverändert, nur Name), `service-pages-outline.pdf` (eine Seite mit englischem Text, von Hand geschrieben wie das Original; Größe ≤ 4 KB), `postfix-main.cf.txt` (Inhalt sprachfrei, Kommentare englisch)), `tests/Feature/Seeders/EnglishDemoItemsTest.php`

**Interfaces:**
- Schlüssel: `item.<KEY>.title|description` (Markdown wie heute, `@handle` und Keys bleiben wörtlich, so werden Erwähnungen und Verweise dieselben Knoten), `activity.<n>.*` nur, wo ein Event Text trägt (etwa ein geänderter Titel), `comment.<KEY>.<n>` (n = Reihenfolge am Item wie `c_<item>_<n>`), `file.<KEY>.<n>.name` und der Pfad der Datei je Sprache.
- Die Seeder lesen jede Zeile wie heute (Struktur aus der Zeile, `ItemsSeederTest` vergleicht sie weiter mit `seed/items.ts`), nur Titel, Beschreibung, Kommentartext und Dateiname über `DemoTexts`.

- [ ] **Step 1: Failing Tests** — `EnglishDemoItemsTest` (Seeder bis `AttachmentsSeeder` in Englisch, Datenbank wie oben): „seeds the same items as the German demo, in English“ (je Key gleiche Projekt, Nummer, Typ, Status, Priorität, Assignee, Daten, Eltern, Ersteller, Labels, Werte außer Text und Rich Text wie die Zeilen von `ItemsSeeder` deutsch; die Struktur liest der Test aus einer statischen `ItemsSeeder::rows()`, die beide Sprachen teilen), „keeps the mentions and references of every text“ (Menge der Knoten `mention`/`reference` je Beschreibung und je Kommentar gleich der deutschen, gerechnet über `Document::fromMarkdown` mit `FakeRichTextLookup`), „seeds the same comments with their reactions“, „attaches English files with the same kinds and types“, „writes no German into item texts“ (Regel wie 22a, über die Texte dieser Seeder).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Übersetzen und umsetzen** — 71 Items, 17 Kommentare, die Texte der Aktivität.
- [ ] **Step 4: G1** (auch `ItemsSeederTest`, `CommentsSeederTest`, `DemoSeederTest`).
- [ ] **Step 5: Commit** — `feat: seed the demo items, comments and files in English`.

### Task 22c: Englische Demo-Daten: Wiki, Vorlagen, Inbox, Webhooks, Automatisierungen

**Modell:** sonnet

**Files:** `database/seeders/Demo/{PagesSeeder,TemplatesSeeder,NotificationsSeeder,WebhooksSeeder,AutomationsSeeder}.php`, `database/seeders/Demo/Texts/{German,English}.php`, `tests/Feature/Seeders/EnglishDemoContentTest.php`

**Interfaces:**
- Wiki: der `PagesSeeder` sucht heute über (Projekt, Titel) und hängt neue Seiten unter den Titel des Eltern-Items; neu über einen sprachfreien Schlüssel `page.<schlüssel>.title|content` (Schlüssel aus `seed/pages.ts`, nicht der Titel), gesucht über den Titel der aktiven Sprache. Die drei Versionen von „Seitenstruktur“ je Sprache, die letzte gleich Titel und Text der Seite (T4-M1 aus Phase 9).
- Vorlagen: `template.<schlüssel>.name|title|description`; Titel behalten ihre Platzhalter wörtlich (`{week}` …), Monatsnamen kommen aus der Sprache der Organisation. Laufzeilen: der gescheiterte Lauf mit englischem Satz (`templates.run.*` aus `lang/en.json`, nicht frei erfunden).
- Inbox: `NotificationsSeeder` schreibt keine Texte außer `data.name` (Webhook) und `data.error` (Vorlage); beide aus den englischen Texten. Webhooks: „Deploy bot“, „Kira“, „Legacy CRM“, Hosts `*.fieldwork.example.com`. Automatisierungen sind sprachfrei (nur der Test).

- [ ] **Step 1: Failing Tests** — `EnglishDemoContentTest`: „seeds the same wiki tree in English“ (gleiche Zahl je Projekt, gleiche Tiefe und Reihenfolge, gleiche Versionen), „seeds the same templates with their runs“ (gleiche Zeitpläne, Läufe, verknüpfte Items), „seeds the same inbox of Mara“ (14 Zeilen, 3 ungelesen, gleiche Arten), „seeds the same webhooks and attempts“, „writes no German into the wiki, templates and webhooks“.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Übersetzen und umsetzen** — 19 Seiten samt Versionen, 3 Vorlagen, 3 Webhooks.
- [ ] **Step 4: G1.**
- [ ] **Step 5: Commit** — `feat: seed the demo wiki, templates, inbox and webhooks in English`.

### Task 22d: Englische Demo-Daten: ganzer Lauf, Gleichheit beider Fassungen

**Modell:** sonnet

**Files:** `tests/Feature/Seeders/DemoLanguagesTest.php`, ggf. `database/seeders/DemoSeederEn.php`, `docs/{en,de}/development.md`, `CLAUDE.md`

**Interfaces:**
- `DemoLanguagesTest` seedet erst `DemoSeeder`, liest einen **Fingerabdruck** der Struktur (je Tabelle die Zahl der Zeilen; Items als `KEY → [typ-schlüssel, status-kategorie, assignee-handle, due, parent-key, labels-schlüssel]`; Relationen als Key-Paare; Kommentare je Key; Seiten je Projekt als Baum der Schlüssel; Vorlagen, Läufe, Views, Favoriten, Inbox-Arten, Webhooks, Versuche, Automatisierungen; alles über Handles, Kennungen und Schlüssel, nie über Texte oder ULIDs), dann `migrate:fresh` und `DemoSeederEn`, derselbe Fingerabdruck → gleich. Dazu „keeps every mail at example.com“ und „rebuilds the search index in English“ (`searchEngine()`: Titel englisch, gleiche Zahl Dokumente).
- Kein Teil des `E2eSeeder`: die e2e-Specs bleiben auf den deutschen Demo-Daten.

- [ ] **Step 1: Failing Test** (scheitert, solange eine Fassung abweicht); RED zeigt die erste Abweichung.
- [ ] **Step 2: Abweichungen beheben.**
- [ ] **Step 3: G1;** von Hand `ddev artisan migrate:fresh --seed --seeder=DemoSeederEn`, die App ansehen (Liste, Item, Wiki, Inbox als `mara@fieldwork.example.com`), danach `ddev artisan migrate:fresh --seed --seeder=DemoSeeder`.
- [ ] **Step 4: Commit** — `test: hold the English demo data to the shape of the German one`.

### Task 22e: Screenshots: Projekte, Setup, fünf Shots

**Modell:** opus

Wie openbill (A443): Playwright-Projekte nur mit `DOCS_SCREENSHOTS=1`, nicht in der CI und nicht in `pnpm --dir e2e test`. Bilder unter `docs/public/screenshots/{en,de}/<name>.png` (hell, 1440 × 900, `deviceScaleFactor: 1`), wo `dark: true` zusätzlich `<name>-dark.png`. Deutsch zeigt die deutschen Demo-Daten mit deutscher Oberfläche, Englisch die englischen Demo-Daten (Tasks 22a–22d) mit englischer Oberfläche; angemeldet ist jeweils Mara (`mara@feldwerk.example.com` bzw. `mara@fieldwork.example.com`, `DemoSeeder::PASSWORD`, beide mit der Sprache ihrer Daten).

Frisch geseedet ist der Demo-Zustand schon da (Automatisierungen an, Vorlagen geplant, Webhooks aktiv); den pausierten Zustand macht nur der `E2eSeeder`, der hier nicht läuft. Weil beide Fassungen dieselben Keys haben, passen sie nicht in eine Datenbank: der Lauf setzt die Entwicklungsdatenbank je Sprache neu auf und am Ende per `E2eSeeder` zurück (das sagt `development.md`). Die Demo-Daten liegen im Oktober 2026: relative Zeiten (`timeAgo`, „Heute“ der Timeline, überfällige Daten) verschieben sich mit jedem Tag.

**Files:**
- Create: `e2e/tests/docs-screenshots.spec.ts`, `e2e/tests/docs-seed.setup.ts`, `e2e/optimize-screenshots.sh` (oxipng per Digest wie openbill, dort `v9.1.5@sha256:e1623b0d…`; Version und Digest nach der Zwei-Wochen-Regel prüfen), `docs/public/screenshots/{en,de}/*.png`
- Modify: `e2e/playwright.config.ts` (nur mit `DOCS_SCREENSHOTS`: Projekte `docs-seed-de` → `docs-screenshots-de` → `docs-seed-en` → `docs-screenshots-en` über `dependencies`, `teardown` `docs-reset`; ohne `DOCS_SCREENSHOTS` ignorieren die normalen Projekte `docs-*.ts`; im Docs-Lauf kein `E2eSeeder` im `globalSetup`), `e2e/package.json` (`docs:screenshots`), `tests/Unit/DocsTest.php`, `docs/{en,de}/development.md` (Abschnitt „Screenshots“: Lauf, setzt die Datenbank zurück, Uhr, Ansehen jedes Bilds), `CLAUDE.md` (Regel aus `~/development/baeroe/CLAUDE.md`: ändert sich die UI sichtbar, Screenshots im selben PR neu erzeugen; Ort und Lauf; Fallstrick „der Screenshot-Lauf setzt die Entwicklungsdatenbank zurück“)

**Interfaces:**
- `docs-seed.setup.ts`: je Sprache `artisan('migrate:fresh', '--force', '--seed', '--seeder=DemoSeeder' | 'DemoSeederEn')`, dann `cache:clear` und `syncMutagen()`; `docs-reset` (Teardown): `migrate:fresh --force --seed --seeder=E2eSeeder`. Der Scheduler-Daemon kann im Fenster einen Termin ausführen (eine Vorlage legt ein Item an, die Nacht archiviert): in Kauf genommen, der Bericht nennt es.
- **Uhr:** jeder Shot setzt `page.clock.setFixedTime('2026-10-28T09:30:00+01:00')` (der „heute“ des Seeds wie `FilterWorld`) vor dem Laden. Der Server rechnet „überfällig“ mit seiner Uhr: Shots mit Fälligkeiten wählen Items, deren Darstellung nicht vom Tag abhängt, oder maskieren (`mask`).
- **Helfer:** die Spec nutzt keine Helfer mit `variant()` und keine `PEOPLE` (`VARIANT_CODE`, `PEOPLE.inbox[variant()]`, `createE2eProject` kennen die Docs-Projekte nicht); Zugänge je Sprache in einer Konstante der Spec; ein Kommentar sagt es (ein Typecheck kann es nicht prüfen).
- Shots dieser Task: `board` (WEB, nach Status), `item` (WEB-47 mit Beschreibung, Relationen, Aktivität; `dark: true`), `palette` (offen mit Suche „WEB“), `templates` (Editor der wöchentlichen Wartung mit Zeitplan; zeigt sie aktiv), `webhooks` (Protokoll; zeigt den Webhook aktiv). Eine Vorlage, eine Seite oder ein Webhook wird über den Text der Sprache gesucht (Konstante je Sprache in der Spec), Items über ihren Key.
- Jede Aufnahme wartet auf einen Zustand (Text, Rolle), nie auf Zeit; Toasts, Live-Banner und Uhrzeit-abhängige Texte sind aus dem Bild (`mask` für relative Zeiten).
- `DocsTest`: „has the same screenshots in English and German“ (außer `api-docs`), „shows only screenshots that exist, in the language of the page“ (Muster von openbill Z. 124), „keeps every screenshot under 400 KB“.

- [ ] **Step 1:** `DocsTest` RED (Ordner fehlt).
- [ ] **Step 2:** Projekte, Setup, Spec; Lauf `pnpm --dir e2e docs:screenshots`; **jedes Bild ansehen** (Read-Tool) und im Bericht je Bild einen Satz, was es zeigt (Sprache der Oberfläche **und** der Daten, Vorlagen und Webhooks aktiv, Uhr am 2026-10-28). Danach prüfen, dass die Datenbank wieder den `E2eSeeder`-Stand hat (`E2E_COVERAGE=0 pnpm --dir e2e exec playwright test login.spec.ts`).
- [ ] **Step 3: G1** (`DocsTest`), `pnpm --dir e2e typecheck`.
- [ ] **Step 4: Commit** — `docs: take the screenshots of the docs from the demo data in both languages`.

### Task 22f: Screenshots: übrige Shots, alle ansehen

**Modell:** opus

**Files:** `e2e/tests/docs-screenshots.spec.ts`, `docs/public/screenshots/{en,de}/*.png`, `tests/Unit/DocsTest.php` (nur falls nötig)

**Interfaces:**
- Shots: `my-items` (Liste, nach Status), `table` (eine View mit Properties), `timeline` (Epics; „Heute“ über die feste Uhr), `inbox` (relative Zeiten maskiert oder über die feste Uhr), `wiki` (Seitenstruktur), `views`, `settings-workflow` (Editor der Agentur-Freigabe mit Matrix), `automations` (Projekt WEB, Schalter an), `api-docs` (`/api/docs`, nur `en`).
- Regeln wie 22e (Uhr, Warten auf Zustände, Masken, keine `variant()`-Helfer, Texte je Sprache).

- [ ] **Step 1:** Shots ergänzen; Lauf `pnpm --dir e2e docs:screenshots` (alle Bilder neu, auch die aus 22e).
- [ ] **Step 2:** **jedes Bild ansehen** (Read-Tool, en, de, dark) und im Bericht je Bild einen Satz; kein deutsches Wort in einem englischen Bild und umgekehrt (außer Eigennamen).
- [ ] **Step 3: G1** (`DocsTest`), `pnpm --dir e2e typecheck`.
- [ ] **Step 4: Commit** — `docs: take the remaining screenshots of the docs`.

### Task 23: Landingpage, README, `docs.yml`

**Modell:** sonnet

Die openbill-Vorlage pinnt **nicht** per SHA (`checkout@v4`, `upload-pages-artifact@v3`, `deploy-pages@v4`), hat keine `vars.*`, und `DOCS_URL` steht fest; für werkbuch gilt `WorkflowsTest:13` (SHA für alle Workflows). Pages ist im Repo aus (`GET …/pages` 404), es gibt keine Environments und keine Variablen. `docs/.vitepress/config.ts` verweist schon auf `docs.yml` und liest `DOCS_BASE`/`DOCS_URL` (Z. 4-8); `sitemap` setzt die Konfiguration heute nicht. `docs/en/index.md` hat einen Hero ohne `image`/`features`, der Status sagt „phase 14 of 15“. Die App verlinkt die Doku heute nirgends (geprüft 2026-11-07: kein Link in `lang/*.json`, `resources/js`, `app/`); die README verlinkt relativ (`docs/en/…`), was in der Beschreibung auf Docker Hub (`dockerhub.yml` übernimmt die README) ins Leere führt. Die Release-Notizen (`scripts/release-notes.sh`, aus `upgrading.md`) nennen die Doku nicht.

Domain (A444, Rafaels Antwort 1): `https://werkbuch.dev`, `DOCS_BASE=/`. GitHub ignoriert `CNAME` bei einem Deploy über Actions; die Datei hält die Absicht fest und schadet nicht, wirksam wird die Domain erst über die Pages-Einstellung („Nach der Phase“).

**Files:**
- Create: `.github/workflows/docs.yml`, `docs/public/CNAME` (eine Zeile `werkbuch.dev`, ohne Schema)
- Modify: `docs/.vitepress/config.ts` (`sitemap: { hostname: 'https://werkbuch.dev' }`, Kommentar Z. 4-5: veröffentlicht unter `https://werkbuch.dev`, `DOCS_BASE` nur für eine Kopie unter einem Unterpfad), `docs/{en,de}/index.md` (Landingpage: Hero mit `image` = `/screenshots/<sprache>/board.png`, `features` mit sechs Kacheln (Typen und Workflows, Views, Wiki, Vorlagen und Automatisierungen, Tastatur, REST/MCP/Webhooks) je mit Link, Aktionen „Setup“ und „GitHub“; der Abschnitt „Status“ sagt: alle Phasen fertig, manuelle Tests vor v0.1.0, noch kein Release), `README.md` (Status-Satz wie die Landingpage; Abschnitt „Screenshots“ mit drei Bildern `docs/public/screenshots/en/{board,item,palette}.png` mit Alt-Text, als absolute URL `https://raw.githubusercontent.com/baeroe/werkbuch/main/…`, damit sie auch auf Docker Hub laden; jeder Link auf eine Seite der Doku absolut nach `https://werkbuch.dev/en/<seite>`), `scripts/release-notes.sh` + `tests/Unit/ReleaseNotesTest.php` (am Ende der Notizen „Docs: https://werkbuch.dev/en/upgrading“), `tests/Unit/{DocsTest,WorkflowsTest}.php` (die README-Prüfungen stehen in `DocsTest`), `CLAUDE.md` (Doku: `docs.yml`, Pages, Domain, CNAME)
- Hinweise in der App: es gibt heute keinen Link auf die Doku; diese Task fügt keinen hinzu. Ein Test verbietet `baeroe.github.io` überall im Repo außer in Plänen und History, so führt ein späterer Link zwangsläufig auf `werkbuch.dev`.

**Interfaces:**
- `docs.yml` nach openbill, aber alle `uses:` per SHA (A425), Versionen von `actions/configure-pages` (falls nötig), `upload-pages-artifact` und `deploy-pages` nach der Zwei-Wochen-Regel, mit Datum im Bericht:
  - Auslöser: `push` auf `main` mit `paths` (`docs/**`, beide Compose-Dateien, `pnpm-lock.yaml`, die Datei selbst), `workflow_dispatch`. Oben `permissions: contents: read`, `concurrency: pages`.
  - Job `pages` (`permissions: pages: read`): `gh api repos/${{ github.repository }}/pages` mit `GITHUB_TOKEN`; Antwort 200 → Output `enabled=true`; 404 → `enabled=false` und `::notice title=GitHub Pages::Pages is not enabled for this repository (Settings → Pages → Source „GitHub Actions“, custom domain werkbuch.dev); the docs were built but not deployed.`; jede andere Antwort scheitert.
  - Job `build` (`fetch-depth: 0`, `pnpm --dir docs build` mit `DOCS_BASE: /` und `DOCS_URL: https://werkbuch.dev` fest, keine `vars.*`; prüft, dass `docs/.vitepress/dist/CNAME` `werkbuch.dev` enthält und `dist/sitemap.xml` existiert; `upload-pages-artifact`). Baut immer, damit ein Fehler der Doku auf `main` sichtbar wird.
  - Job `deploy` (`needs: [pages, build]`, `if: needs.pages.outputs.enabled == 'true'`, `permissions: pages: write, id-token: write`, Environment `github-pages`, `deploy-pages`). Ohne Pages wird er übersprungen, der Lauf ist grün. Das Environment legt GitHub beim ersten Deploy an.
  - Kein Push, kein Token außer `GITHUB_TOKEN`, keine Änderung der Pages-Einstellung aus dem Workflow. Der Workflow läuft erst auf `main`, der PR ist also nicht rot.
- Der CI-Job `docs` in `tests.yml` baut weiter mit `DOCS_BASE: /werkbuch/` (Probe, dass die Doku unter einem Unterpfad baut); `WorkflowsTest` hält fest, dass `docs.yml` `/` nimmt.
- `WorkflowsTest`: „deploys the docs only from main“, „pins the pages actions“, „skips the deploy with a notice while Pages is off“ (Job `pages` mit Output, `deploy` mit `if` darauf, `::notice`), „publishes the docs at werkbuch.dev from the root“ (`DOCS_BASE: /`, `DOCS_URL: https://werkbuch.dev`, keine `vars.`). `DocsTest`: „keeps the custom domain werkbuch.dev“ (`docs/public/CNAME` ist genau `werkbuch.dev\n`, `config.ts` nennt `hostname: 'https://werkbuch.dev'` und als Standard der Base `/`), „names the docs only at werkbuch.dev“ (kein `baeroe.github.io` in `README.md`, `docs/{en,de}`, `docs/.vitepress`, `lang/`, `resources/`, `app/`, `scripts/`, `.github/`), „links the README to the published docs“ (jeder Link auf `docs/en/*.md` ist `https://werkbuch.dev/en/<seite>` und die Seite existiert), „shows screenshots on the landing page“, „links the screenshots of the README to files that exist“, „says no phase in the status of the landing page“; `ReleaseNotesTest`: „names the docs at werkbuch.dev“.

- [ ] **Step 1: Failing Tests.**
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** `actionlint` → 0.
- [ ] **Step 4: G1;** **GD** (Base `/`, dazu `DOCS_BASE=/werkbuch/` wie der CI-Job; `dist/CNAME` und `dist/sitemap.xml` mit `https://werkbuch.dev/…` vorhanden).
- [ ] **Step 5: Commit** — `docs: a landing page and a README with screenshots, and deploy the docs to werkbuch.dev`.

### Task 24a: Doku-Durchsicht: Setup, Betrieb, Entwicklung

**Modell:** opus

Liest die Seiten gegen den Code und die Spec 10 (Seitenliste). Behebt: veraltete Stand-Sätze, Verweise auf „Phase N“, falsche Namen von Routen, Befehlen, Variablen und Tasten; tote Anker (GD prüft nur Links). `docs/en` hat 24 Seiten (≈ 48 000 Wörter); die Durchsicht ist auf drei Tasks verteilt (K23).

**Files:** `docs/{en,de}/{setup,operations,development,upgrading,backup,reverse-proxy}.md`, `docs/.vitepress/config.ts` (`theme-color` auch dunkel: heute nur hell, Z. 89), `tests/Unit/DocsTest.php`

**Punkte:** `development.md` Spaltenausrichtung; Doku des `database`-Treibers des Caches (Phase 2); gestapelte `LeaveGuard`-Dialoge dokumentieren (Phase 2, nur `development.md`); Abschnitte aus Phase 15 (Drosseln, Queue `mail`, CI je Projekt, Last, Screenshots) stimmen mit dem Code.

- [ ] **Step 1:** neue `DocsTest`-Fälle („keeps the sidebar of both languages in the same order“ — erweitert „lists every page …“ um die Reihenfolge en = de; „names no phase in the docs“ — kein `/phase \d+/i` außerhalb von `development.md`; „sets a theme color for both themes“) → RED.
- [ ] **Step 2:** Durchsicht und Korrekturen dieser Seiten.
- [ ] **Step 3: G1;** **GD**.
- [ ] **Step 4: Commit** — `docs: review setup, operations and development against the code`.

### Task 24b: Doku-Durchsicht: Konzepte

**Modell:** opus

**Files:** `docs/{en,de}/concepts/*.md` (Projekte, Workflows, Typen und Properties, Work Items, Views, Rich Text, Wiki, Vorlagen, Automatisierungen, Benachrichtigungen, Rechte)

**Punkte:** wie 24a; dazu die Konzepte-Liste der Spec 10 (Projekte, Workflows, Typen und Properties, Views, Vorlagen, Automatisierungen, Rechte) Seite für Seite gegen Kapitel 4 der Spec; jede Lücke im Bericht.

- [ ] **Step 1:** Durchsicht und Korrekturen (die `DocsTest`-Fälle aus 24a decken die Phase-Verweise).
- [ ] **Step 2: G1** (`DocsTest`); **GD**.
- [ ] **Step 3: Commit** — `docs: review the concepts against the code`.

### Task 24c: Doku-Durchsicht: API, MCP, Webhooks, Suche, Tastatur, Bots

**Modell:** opus

**Files:** `docs/{en,de}/{api,mcp,webhooks,search,keyboard,bots,index}.md`, `scripts/shortcuts-doc.mjs` (+ Test), `lang/{en,de}.json` (nur `item_hint`)

**Punkte:** wie 24a; dazu der Doku-Generator der Tastatur: Tastennamen und die Gruppe von Esc (T15-M1–M3 aus Phase 6, `scripts/shortcuts-doc.mjs`, danach `ddev exec pnpm shortcuts:doc`); `search.md` Z. 3 (RR-M2); `item_hint`-Text (RR-M1). Zum Schluss Erfolgskriterium 8 (Setup, Betrieb, Konzepte, Tastatur, API, MCP, Webhooks) über alle drei Teile Seite für Seite; jede Lücke im Bericht.

- [ ] **Step 1:** Test des Generators für Tastennamen und die Gruppe von Esc → RED.
- [ ] **Step 2:** Generator, `pnpm shortcuts:doc`, Durchsicht und Korrekturen.
- [ ] **Step 3: G1 + G2;** **GD**.
- [ ] **Step 4: Commits** — `docs: review the API, MCP, webhook, search and bot pages against the code`, `docs: name keys and the group of Esc in the keyboard pages`.

---

## Block G: Abschluss

### Task 25: Offene Minors aus Phase 14

**Modell:** sonnet · **frühestens am 2026-11-16** (siehe Reihenfolge)

**Files:** `app/Support/LiveAddress.php` + Test (IPv6-Host in `APP_URL`, `[::1]` → Host `::1`, T1-M3), `docker-compose.yml`/`docker-compose.standalone.yml` (Healthcheck mit IPv6-`APP_URL`: `Host`-Kopf mit Klammern), `docker/entrypoint.d/99-werkbuch.sh` (Upload-Warnung auch für `upload_max_filesize`, T3b-M9; `DB_WAIT_TIMEOUT` nicht numerisch → Standard mit Warnung, T3b-M10), `Dockerfile` (Kommentar zu `server-opts.d`: `performance.conf` der Basis bleibt www-data-eigen), `tests/Feature/RouteCacheTest.php` (Meldungen nennen die Bindung, T2-M3), `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (4.16 „S3-kompatibel per Env“ in den Änderungsblock von Phase 14, Verweis A424), `tests/Feature/Docker/{ImageTest,ComposeTest}.php`

Dazu nur nach der Zwei-Wochen-Regel am Tag der Task:
- Meilisearch v1.56.1 (vom 2026-11-02, ab 2026-11-16) in DDEV, CI (`tests`, `e2e`, `load`) und beiden Compose-Dateien zugleich, per Digest.
- Ist eine Version am Tag der Task jünger als 14 Tage, bleibt sie (Ruling „nach v0.1.0“ im Bericht).
- `serversideup/php` macht Task 25b.

- [ ] **Step 1: Failing Tests** (LiveAddress IPv6, Entrypoint-Harness für beide Warnungen, Compose-Healthcheck).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Umsetzen;** bei einem Versionswechsel: GI (`docker buildx build --load -t werkbuch:local .` und `scripts/compose-smoke.sh` → `smoke: ok`) und `ddev restart`; nie parallel zu e2e.
- [ ] **Step 4: G1.**
- [ ] **Step 5: Commits** je Punkt.

### Task 25b: `serversideup/php` v5.1.x

**Modell:** sonnet · **frühestens am 2026-11-19** (Rafaels Antwort 5: aus A447 vorgezogen)

v5.1.1 (vom 2026-11-05) erfüllt die Zwei-Wochen-Regel ab dem 2026-11-19 (v5.1.0 ab 11-18; das Image steht auf v5.0.4, `Dockerfile:29`). v5.0.5 betrifft `fpm-nginx` nicht und wird nicht gezogen. Am Tag der Task die neueste v5.1.x nehmen, die mindestens 14 Tage alt ist; Datum und Digest in den Bericht.

**Files:** `Dockerfile` (Tag und Digest), `docker/` (nur, falls die Basis Dateien verschiebt), `tests/Feature/Docker/ImageTest.php`, `scripts/compose-smoke.sh` (`libbrotli1`-Prüfung), `docs/{en,de}/upgrading.md` (nur falls Betreiber etwas tun müssen), `CLAUDE.md` (Tech Stack, falls genannt)

- [ ] **Step 1: Vergleich** — `security.conf`, `performance.conf` und die Entrypoint-Skripte der neuen Basis mit v5.0.4 (Release-Notes und Dateien des Images), Unterschiede in den Bericht.
- [ ] **Step 2: Failing Test** — `ImageTest` erwartet die neue Version und den Digest → RED.
- [ ] **Step 3: Umsetzen;** GI (`docker buildx build --load -t werkbuch:local .` und `scripts/compose-smoke.sh` → `smoke: ok`); nie parallel zu e2e.
- [ ] **Step 4: G1.**
- [ ] **Step 5: Commit** — `build: move the image to serversideup/php v5.1.x`.

### Task 26: Checkliste manuelle Tests

**Modell:** opus

**Files:** Create `docs/superpowers/plans/2026-10-30-werkbuch-manual-tests.md`

**Inhalt (deutsch, Spec 11.5):**
- Kopf: wie testen (DDEV mit `DemoSeeder` **und** Compose-Stack nach `docs/de/setup.md` auf Colima), Zugänge (Demo-Personen mit `DemoSeeder::PASSWORD`, Admin aus `ADMIN_*`), wie Befunde gemeldet werden (Issue oder Liste in der Datei, Korrekturen als PRs).
- Je Erfolgskriterium 1–8 ein Abschnitt mit nummerierten Schritten und erwartetem Ergebnis (`- [ ] **1.3** … → erwartet: …`), Kriterium 2 in UI, REST (curl mit Token) und MCP (Claude Code mit `skilltri`-unabhängiger Einrichtung aus `docs/de/mcp.md`).
- Je Abschnitt aus Kapitel 4 (4.1–4.17) die Regeln als prüfbare Schritte, besonders Grenzfälle: Rechte je Rolle (Viewer, Außenstehende öffentlicher Projekte, deaktiviertes Konto), frühere Kennung und 301, Konfliktschutz Beschreibung und Wiki, Zeitplan über Sommerzeit (nur Pest prüft genau: hier Plausibilität), Benachrichtigung und Mail mit Leserecht, Webhook mit Bot-Filter, Bild ohne Zugriff.
- Anmeldung (A434): Konto über Fehlversuche aus einem zweiten Browser sperren → im ersten (bekanntes Gerät) geht die Anmeldung, in einem privaten Fenster nicht, die Meldung nennt Minuten; „Passwort vergessen“ → neues Passwort hebt die Sperre auf.
- Bedienung: 1440 und 390 px, hell und dunkel, nur Tastatur (Stichprobe aus `e2e/keyboard-flows.ts`), Screenreader-Stichprobe (VoiceOver: Liste, Item-Seite, Palette, Inbox).
- Betrieb: Update (`pull`, `down`, `up -d`), Backup und Wiederherstellen nach `docs/de/backup.md`, Proxy mit WebSockets (NPM oder Caddy), System-Seite.
- Dazu aus Block E2: Board mit erschöpften Rängen (A448), Epic mit mehr als 100 Kindern (A449), Text-Property mit Zahlen sortieren (A450), öffentliches Projekt einer anderen Person erscheint ohne Neuladen (A451); Doku unter `https://werkbuch.dev` erreichbar (nach Rafaels DNS und Pages-Einstellung), englische Demo-Daten per `DemoSeederEn` ansehen.
- Am Ende: die Rulings, die noch auf Rafaels Bestätigung warten (Liste aus den Spec-Abschnitten „Änderungen vom …“, je mit Ruling-Nummer); die Antworten vom 2026-11-07 sind keine offenen Fragen mehr.

- [ ] **Step 1:** Datei schreiben; jede Zeile nennt eine Stelle in Spec oder Doku.
- [ ] **Step 2:** Selbstprüfung: jedes Erfolgskriterium und jeder Abschnitt 4.x kommt vor (Liste im Bericht).
- [ ] **Step 3: Commit** — `docs: the checklist for the manual tests`.

### Task 27: History, CLAUDE.md, Rulings, Spec, Master-Plan

**Modell:** opus

**Files:** Create `docs/history/2026-11-xx-werkbuch-bis-v0.1.0.md` (über den Skill history:history-doc: Ziel, Phasen 1–15 mit PRs, wichtigste Entscheidungen mit Ruling-Nummern, Stolpersteine, Zahlen: Tests, Abdeckung, CI-Dauer je Job aus dem PR samt `tests` (K7), Last-Tabelle). Modify `CLAUDE.md` („Stand“: Phase 15 erledigt, als Nächstes manuelle Tests und v0.1.0 nach Freigabe; jede in Phase 15 geänderte Angabe, „Last“, „CI“, „Barrierefreiheit“, „Screenshots“; veraltete Angaben weg — die Datei wird nicht kürzer gemacht, nur richtig), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A434–A451 aus diesem Plan mit Grund und „Falls falsch“, wie sie umgesetzt wurden, samt den Preflight-Änderungen an A434, A441, A443, A444 und A447 und Rafaels Antworten vom 2026-11-07 (A434, A443, A444 bestätigt bzw. entschieden, A447 verkleinert); A168, A180 und A186 um „geändert durch A450/A448/A449“ ergänzen; „Für spätere Phasen vorgemerkt“ → die Zeile „Phase 15“ als erledigt mit Verweisen, „Nach v0.1.0“ um A447 ergänzt), `docs/superpowers/specs/2026-10-28-werkbuch-design.md` („Änderungen vom …“ für A434 samt bekanntem Gerät, A435, A437, A440, A448 Ränge neu verteilen, A449 Kinder seitenweise, A450 natürliche Sortierung, A451 Live für Personen ohne Projektkanal; Spec 10 und 14: Domain `werkbuch.dev` registriert, Doku unter `https://werkbuch.dev`), `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Häkchen Phase 15, Abweichungen), `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (Kopf: „Stand 2026-11-xx: alles Gültige in Phase 15 erledigt, Rest A447“).

- [ ] **Step 1:** Dokumente schreiben.
- [ ] **Step 2:** `DocsTest`, `TranslationKeysTest`, `ArchTest` (G1 voll).
- [ ] **Step 3: Commit** — `docs: update CLAUDE.md, the rulings, the spec and the history for phase 15`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und parallel im Hintergrund der volle G3; beide in eine finale Fix-Welle. CI: `tests`, alle vier `e2e (…)`, `e2e-build`, `e2e-coverage`, `load`, `image (amd64)`, `image (arm64)` grün (`docs.yml` läuft erst auf `main`).

---

## Vorschläge für neue Rulings (ab A434; A433 ist in Phase 14 vergeben)

- **A434 · Anmeldung: Deckel je Konto mit bekanntem Gerät.** Neben `lower(email)|IP` (5, dann 60 s) und `login_per_ip` (20/min) höchstens `login_per_account` 50 Fehlversuche je Adresse (klein, getrimmt, transliteriert) und Stunde über alle IPs. Der Deckel gilt nicht für eine Anfrage mit gültigem Cookie `werkbuch_device` dieser Adresse (gesetzt nach jeder erfolgreichen Anmeldung, auch nach dem zweiten Faktor, ein Jahr). Ein Erfolg leert ihn, auch nach dem zweiten Faktor; ein neues Passwort (`SetPassword`) hebt ihn und den TOTP-Tagesdeckel auf; „Passwort vergessen“ bleibt offen; die Meldung nennt die Wartezeit ab 120 s in Minuten. *Grund:* hinter einem fälschbaren `X-Forwarded-For` ist jede IP-Grenze wirkungslos; 50 je Stunde sind 1 200 am Tag statt unbegrenzt und lassen Tippfehler einer Person durch; ohne bekanntes Gerät sperrte jeder, der die Adresse kennt, die Besitzerin dauerhaft aus (50 Fehlversuche in 2,5 min, stündlich wiederholbar; OWASP „device cookies“). Auf einem **neuen** Gerät bleibt eine Anmeldung unter Angriff bis zu einer Stunde gesperrt; Rafael hat das am 2026-11-07 bestätigt. *Falls falsch:* bei einer Sperre eine Mail an die Besitzerin mit einem einmaligen Link, der das Gerät als bekannt markiert.
- **A435 · TOTP: 30 Versuche je Konto und Tag** (Codes und Recovery-Codes zusammen, Erfolge zählen mit) neben 5 je Minute; ein neues Passwort setzt den Tag zurück; der Satz verweist auf den Betreiber (`app:reset-two-factor`). *Grund:* 7 200 Versuche am Tag gäben einem Angreifer mit Passwort rund 2,2 % je Tag; 30 senken das auf rund 0,01 %. *Falls falsch:* 100 je Tag oder Sperre bis zur Rücksetzung durch einen Admin.
- **A436 · Cache wiederholt nur Deadlocks** (1213/40001), nie Lock-Wait (ändert A433). *Grund:* Lock-Wait außerhalb einer Transaktion wartet je Versuch bis 50 s. *Falls falsch:* Lock-Wait mit gesenktem `innodb_lock_wait_timeout` der Cache-Verbindung wiederholen.
- **A437 · Queue `mail` zuerst** im Dienst `queue` (`mail,default,live,notifications,bulk`) für Reset-Link, Reset-Mail und Einladung; Sammelmails bleiben in `notifications`. *Grund:* eine Person wartet vor dem Bildschirm auf diese Mails (T5-M7). *Falls falsch:* eigener Worker `queue-mail`.
- **A438 · e2e in der CI je Playwright-Projekt** mit eigener Datenbank, Build einmal; jeder Projekt-Job lädt eine per `--remap-only` vorverdichtete Abdeckungsdatei hoch, der Merge-Job verlangt die vier Projekte beim Namen (`--expect-shards=<namen>`) und scheitert zuletzt auch, wenn ein Projekt-Job rot war; lokal unverändert seriell. *Grund:* 1 h 38 min bei 120 min Grenze; die Projekte teilen fachlich nichts (Lauf-Kennung je Variante); rohe Abdeckung wäre rund 600 MB je Projekt. *Falls falsch:* Playwright-`--shard=n/4` über alle Projekte (verteilt Tests, nicht Projekte; teilt die Datenbank nicht, braucht dann eigene Services je Shard ebenso).
- **A439 · Last: Suite `Load`** gegen die Datenbank `load` mit 50 000 Items, eigener TestCase ohne OpenAPI-Vertrag, Wächter gegen jede andere Datenbank, `migrate` je Lauf und neues Seeden nach `LoadSeeder::VERSION`; Budget 1,5 s je Antwort (Median aus drei nach einem Aufwärmlauf, `scoped`-Instanzen je Lauf vergessen), Suche 0,5 s, feste Abfragezahl als harte Zusicherung; Zeilen über Budget stehen in `OVER_BUDGET` mit Task-Verweis und laufen trotzdem; CI-Job `load` ohne Pflicht. *Grund:* A187, Spec 9; Wanduhren wackeln in geteilten Maschinen; ein `todo` liefe gar nicht. *Falls falsch:* Budget je Zeile, oder nur von Hand.
- **A440 · `work_items.created_at`/`updated_at` NOT NULL** ohne `DEFAULT` und ohne `ON UPDATE` (ersetzt A406), fehlende Werte aus der ULID. *Grund:* die Leer-Marke mit `coalesce` hebelt die Range-Bedingung des Keysets aus; vor v0.1.0 gibt es keine Daten außer Entwicklung (A427); die Ordnung mit `rank` braucht weiter einen Filesort, der Gewinn liegt in der zweiten Seite. *Falls falsch:* erzeugte Spalten mit der Marke und Index darauf.
- **A441 · axe:** WCAG-Tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`; jede Seite in allen vier Projekten, die Zustände aus `e2e/a11y-pages.ts` in `desktop-light`, `desktop-dark` und `phone-light` (nicht `phone-dark`: dunkles Theme und Handy-Layout sind sonst abgedeckt, spart rund ein Viertel der Laufzeit); Ausnahmen nur mit Grund und stabilem Selektor in `e2e/a11y-exceptions.ts`. *Grund:* Spec 5.1 (WCAG 2.2 AA). *Falls falsch:* Zustände in allen vier Projekten, oder alles nur `desktop-light`.
- **A442 · Tastatur-Nachweis per Manifest** (`e2e/keyboard-flows.ts`): jede Katalog-ID, jede Widget-Taste (`<gruppe>:<label-schlüssel>`) und jeder Ablauf; ein Test prüft Vollständigkeit, Existenz, den Rumpf per Klammerzählung auf Mausaufrufe und übersprungene Projekte (`PROJECT_GAPS` mit Grund). *Grund:* Erfolgskriterium 6 („Playwright prüft das“) braucht einen prüfbaren Beleg statt verstreuter Specs. *Falls falsch:* eine eigene Spec „Tastatur-Rundgang“, die alle Kürzel nacheinander drückt.
- **A443 · Screenshots** per Playwright statt VHS (die Regel in `~/development/baeroe/CLAUDE.md` ist für TUI-Repos geschrieben; für Web-Repos eigener Pfad je Repo), Ort `docs/public/screenshots/{en,de}/` (VitePress liefert `public/` unter der Basis aus), Playwright-Projekte `docs-screenshots-{en,de}` nur mit `DOCS_SCREENSHOTS=1`, nicht in der CI. Die deutschen Bilder zeigen die deutsche Oberfläche mit den deutschen Demo-Daten (`DemoSeeder`), die englischen die englische Oberfläche mit **englischen Demo-Daten** (`DemoSeederEn`: dieselben Seeder mit Texten aus `Database\Seeders\Demo\Texts\English`, gleiche Handles, Kennungen, Keys, Nummern, Zeiten und Beziehungen; englische Firma „Fieldwork“, Personennamen, Titel, Beschreibungen, Kommentare, Wiki-Seiten, Vorlagen, Views, Webhooks, Katalog; Mails `@fieldwork.example.com`). Beide Fassungen lassen sich nicht in einer Datenbank halten (gleiche Keys): der Screenshot-Lauf setzt die Entwicklungsdatenbank je Sprache per `migrate:fresh` mit dem passenden Seeder neu auf und am Ende per `migrate:fresh --seed --seeder=E2eSeeder` zurück; frisch geseedet ist der Demo-Zustand von Automatisierungen, Vorlagen und Webhooks schon da. Feste Browser-Uhr 2026-10-28 09:30; oxipng verlustfrei. Rafael hat Sprache und Daten am 2026-11-07 so entschieden. *Grund:* Spec 10; wie openbill; eine englische Doku mit deutschen Daten liest sich halb übersetzt. *Falls falsch:* Bilder nur auf Englisch; Ort `docs/screenshots/` nach der globalen Regel (dann mit Alias in VitePress); VHS gibt es für Web-Oberflächen nicht.
- **A444 · GitHub Pages unter `https://werkbuch.dev`** mit `DOCS_BASE=/`, Custom Domain `werkbuch.dev` (Datei `docs/public/CNAME`, wirksam erst über die Pages-Einstellung, weil GitHub die Datei bei einem Deploy über Actions ignoriert); `docs.yml` setzt beide Werte fest (keine Repository-Variablen), `sitemap.hostname`, README, Release-Notizen und jeder Hinweis der App auf die Doku nennen `https://werkbuch.dev`; ein Test hält CNAME, Base und URL fest und verbietet `baeroe.github.io/werkbuch`. Die Pages-Einstellung (Source „GitHub Actions“, Custom Domain, HTTPS erzwingen) setzt Rafael bzw. nach seiner Freigabe der Controller; ohne sie baut der Workflow und überspringt den Deploy mit einem Hinweis. Die DNS-Einträge stehen nicht in der Doku. Rafael hat die Domain am 2026-11-07 gekauft. *Grund:* Spec 10, 14; eine feste Domain macht die README auch auf Docker Hub lesbar (die Beschreibung dort kommt aus der README, relative Links laufen dort ins Leere). *Falls falsch:* Doku unter `https://baeroe.github.io/werkbuch` mit `DOCS_BASE=/werkbuch/` (Datei `CNAME` weg, zwei Werte in `docs.yml`).
- **A445 · Fortify-Pipeline bleibt;** der Konto-Deckel steckt im gebundenen `LoginRateLimiter`, nicht in einem eigenen Pipeline-Schritt; das Cookie setzt ein `Event::listen` auf `Login` im `FortifyServiceProvider`. *Grund:* `EnsureLoginIsNotThrottled` und das Zählen in `AttemptToAuthenticate` rufen genau ihn; ein eigener Schritt müsste beides nachbauen. *Falls falsch:* eigener Schritt nach `CanonicalizeUsername` plus Listener auf `Failed`.
- **A446 · Clickdummy bleibt eingefroren:** keine Screenshots in seinem README, seine Deferred-Punkte gelten nur, soweit die App sie hat (Triage 2026-11-07). *Grund:* Master-Plan „Aufräumen im Port statt im Klickdummy“. *Falls falsch:* Screenshots per `pnpm shots` nachziehen.
- **A447 · Nach v0.1.0** (die Liste „Bewusst nach v0.1.0“ oben). Rafael hat am 2026-11-07 vorgezogen: Ränge neu verteilen (A448), Kinder eines Epics seitenweise (A449), Text-Properties natürlich sortieren (A450), Live für Personen ohne Projektkanal (A451), die Punkte, die Preflight K20 hierher geschoben hatte (verwaiste neue Datei nach Rollback, Relevanz-Gegenproben, N3, Bilder je Vorlagenlauf als Messung in 13b, `MemberInput` aufteilen, die drei Wiki-Reste aus Phase 9, die offenen Phase-5-Punkte „→ 13c“), dazu `serversideup/php` v5.1.x (Task 25b). Es bleiben S3 (A424) und die übrigen Punkte der Liste. *Grund:* keine davon blockiert die Erfolgskriterien; Last-Messungen (Tasks 8b–13b) zeigen, ob eine davon vorher nötig wird — dann wird sie in Phase 15 nachgezogen und das Ruling geändert. *Falls falsch:* eine eigene Phase 16 vor dem Release.
- **A448 · Der Server verteilt die Ränge eines Projekts neu** (ändert A180): `POST /api/v1/projects/{project}/redistribute-ranks` (Recht `item.edit`, unter der Projektsperre, alle Items samt archivierten, Ordnung bleibt, kurze Ränge über `Rank::nBetween`, ohne `updated_at` und ohne Event je Item, ein Event `project.ranks_redistributed` ohne Webhook); das Board ruft es, wenn der Rang zwischen zwei Nachbarn länger als 128 Zeichen würde, und versucht den Zug einmal neu; „Hier ist kein Platz mehr“ bleibt nur, wenn die Nachbarn zu einem anderen Projekt gehören. Über Projekte hinweg (eine Liste mehrerer Projekte nach „Manuell“) kann sich die Mischung danach ändern; innerhalb eines Projekts nie. *Grund:* Rafaels Antwort 5; dieselbe Regel hat das Wiki (A320). *Falls falsch:* der Server rechnet den Rang selbst aus Nachbar-IDs (`before_id`/`after_id`) und verteilt bei Bedarf neu, der Client schickt keinen Rang mehr.
- **A449 · `include=children` endet nach 100 Kindern** (ändert A186) in manueller Ordnung; `children_progress.total` sagt, wie viele es gibt; die Item-Seite lädt weitere seitenweise über die Liste mit `parent` (archivierte eingeschlossen). *Grund:* Rafaels Antwort 5; ein Epic mit Tausenden Kindern machte jede Detail-Antwort teuer. *Falls falsch:* `include=children` mit eigenem Cursor (`children_cursor`).
- **A450 · Text-Properties und Kennungen sortieren natürlich** (ändert A168): in MariaDB über `natural_sort_key()`, im Browser über `Intl.Collator(…, { numeric: true })`, beides gegen eine gemeinsame Fixture-Datei geprüft; Eltern-Gruppen und die Sortierung `key` ordnen Kennungen ebenso (T8-M7). Wo beide Seiten sich unterscheiden (Randfälle im Bericht von 21g), entscheidet der Server die Seiten. *Grund:* Rafaels Antwort 5; „Item 10“ vor „Item 9“ liest niemand als richtig. *Falls falsch:* eine erzeugte Sortierspalte mit eigenem Schlüssel.
- **A451 · Live für Personen ohne Projektkanal:** `project.created` und ein `project.updated`, das ein Projekt öffentlich macht, gehen zusätzlich an `presence-user.{id}` jeder aktiven Person, die das Projekt nach `Visibility` sieht (gebündelt zu 100 Kanälen je Nachricht, feste Zahl Abfragen); ein privates neues Projekt erreicht so nur Mitglieder und Org-Admins. *Grund:* Final-Review Phase 8 M3, Rafaels Antwort 5; die Sichtbarkeitsregel bleibt die eine. *Falls falsch:* ein Organisationskanal mit einer Nachricht ohne Projekt-ID („Projekte neu laden“).

## Antworten von Rafael (2026-11-07)

Eingearbeitet in Rulings, Tasks und Reihenfolge; Task 27 trägt sie so in die Rulings-Datei.

1. **Domain:** `werkbuch.dev` ist gekauft. Die Doku läuft per GitHub Pages unter `https://werkbuch.dev` mit `DOCS_BASE=/`, Custom Domain über `docs/public/CNAME` (`werkbuch.dev`); alle Links (`DOCS_URL`, README, Hinweise in der App, `sitemap.hostname` von VitePress, Release-Notizen) zeigen dorthin, ein Test hält CNAME und Base fest (Task 23, A444). Die DNS-Einträge setzt Rafael beim Registrar; die Doku sagt dazu nichts. Hinweis für den Controller: bei einem Deploy über Actions **ignoriert GitHub die Datei `CNAME`** („any existing CNAME file is ignored“, GitHub-Doku „Managing a custom domain“); wirksam wird die Domain erst über Settings → Pages → Custom domain bzw. `cname` der Pages-API. Die Datei bleibt als festgehaltene Absicht (Test), siehe „Nach der Phase“.
2. **Pages-Einstellung:** bleibt wie geplant: `docs.yml` springt über den Deploy, solange Pages aus ist. Ob die Einstellung (Source „GitHub Actions“, Custom Domain) per `gh api` gesetzt wird, klärt der Controller mit Rafael; ohne Freigabe setzt kein Task sie.
3. **Screenshots:** die deutsche Doku zeigt deutsche Oberfläche mit den deutschen Demo-Daten, die englische die englische Oberfläche **mit englischen Demo-Daten** (`DemoSeederEn`, gleiche Struktur, Schlüssel und Keys, englische Firma, Personen, Titel, Texte, Kommentare, Wiki-Seiten, Vorlagen; alles fiktiv, `@example.com`). Tasks 22a–22d, die Screenshots danach in 22e/22f (A443). Screenshots per Playwright, Ort `docs/public/screenshots/{en,de}/`; ob die globale Regel in `~/development/baeroe/CLAUDE.md` für Web-Repos verallgemeinert wird, bleibt eine Setup-Frage außerhalb des Repos (Task 27 schlägt den Satz im Bericht vor).
4. **Login-Sperre auf einem neuen Gerät:** bis zu einer Stunde unter Angriff ist in Ordnung. A434 ist bestätigt.
5. **A447:** Ränge neu verteilen, Kinder eines Epics seitenweise, Text-Properties natürlich sortieren, Live-Updates für Nicht-Mitglieder und alle Punkte, die Preflight K20 nach A447 geschoben hatte, kommen in Phase 15 (Tasks 21d–21m, 25b, Messung in 13b); je Punkt nur, was gegen den Code vom 2026-11-07 noch offen ist. S3 und die übrigen, nicht genannten Punkte bleiben nach v0.1.0 (A447).

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** Die Suite `Load` lebt außerhalb von `phpunit.xml`, damit Pflicht-Job und Abdeckung unberührt bleiben; der Seeder liegt unter `database/seeders` (keine Abdeckung); der TestCase `Tests\Load\LoadTestCase` hat keinen OpenAPI-Vertrag.
- **P2** Budgets werden nicht gelockert, um grün zu werden: eine Zeile über Budget steht in `OVER_BUDGET` mit Task-Verweis (sie läuft und misst weiter, nur die Zusicherung des Medians entfällt), bis eine Task sie behebt, oder sie bekommt ein Ruling mit Messwert. Kein `->todo()` (liefe nicht).
- **P3** Screenshots laufen nie in der CI (Fonts und Rendering des Runners weichen ab); Erneuern ist ein bewusster Schritt mit Ansehen jedes Bildes.
- **P4** Block E und E2 arbeiten nur die Punkte ab, die die Triage vom 2026-11-07 (Preflight K20 und die Nachprüfung zu Rafaels Antwort 5) als offen fand; was beim Umsetzen schon erledigt ist, nennt der Bericht und überspringt es.
- **P5** `meta.total` nur auf der ersten Seite zu zählen ändert die Antwort der Folgeseiten; das kommt nur mit Messung über Budget und dann als Ruling samt „Änderungen vom …“ in Spec 6.1 (Task 10).

## Nach der Phase (nur mit Rafaels Freigabe, kein Task)

1. DNS bei Registrar (Rafael, nicht in der Doku): `werkbuch.dev` Apex mit vier A-Einträgen `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` und vier AAAA-Einträgen `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `www` als CNAME auf `baeroe.github.io` (ohne Repo-Namen); empfohlen vorher die Domain im GitHub-Profil verifizieren (TXT `_github-pages-challenge-baeroe.werkbuch.dev`, Wert aus Settings → Pages des Profils). Quelle: GitHub-Doku „Managing a custom domain for your GitHub Pages site“, abgerufen am 2026-11-07.
2. GitHub Pages im Repository auf „GitHub Actions“ stellen (Settings → Pages → Source), Custom Domain `werkbuch.dev` eintragen (die Datei `CNAME` wirkt bei einem Deploy über Actions nicht) und „Enforce HTTPS“ setzen, sobald GitHub es anbietet (bis 24 h); per `gh api` nur nach Rafaels Freigabe (klärt der Controller). Ersten Lauf von `docs.yml` auf `main` prüfen (das Environment `github-pages` legt GitHub dabei an), `https://werkbuch.dev/en/` und `/de/` öffnen.
3. Manuelle Tests nach `docs/superpowers/plans/2026-10-30-werkbuch-manual-tests.md` auf DDEV und dem Compose-Stack; Korrekturen als PRs.
4. Secrets `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`, Release-Commit (`'version' => '0.1.0'`, `### 0.1.0` in beiden `upgrading.md`), Tag `v0.1.0` (siehe Phase 14 „Nach der Phase“).
