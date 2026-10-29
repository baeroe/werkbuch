# werkbuch Klickdummy

Ein durchklickbarer Prototyp von werkbuch. Mit ihm werden Oberfläche und Abläufe korrigiert, bevor die App entsteht. Die Gestaltung legt [`DESIGN.md`](DESIGN.md) fest (bindend), den Ablauf der Plan in `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy.md`.

Alles läuft im Browser: Es gibt keinen Server, die Daten liegen in `localStorage`. Alle Personen, Projekte und Kunden sind ausgedacht.

## Starten

Voraussetzungen: Node 24 (`.node-version`; mise wechselt automatisch) und pnpm 12. Nur pnpm, nie npm oder npx.

```sh
pnpm install
pnpm dev   # http://localhost:5173, die Komponenten-Galerie liegt unter /_components
```

## Kommandos

| Kommando | Was es tut |
|---|---|
| `pnpm dev` | Dev-Server mit Hot Reload |
| `pnpm build` | Produktions-Build nach `dist/` |
| `pnpm build:review` | Review-Build nach `dist-review/`, als Fragment für ein Artifact, siehe unten |
| `pnpm preview` | den Build lokal ansehen |
| `pnpm typecheck` | TypeScript prüfen, auch `e2e/`, `vite.config.ts` und `playwright.config.ts` |
| `pnpm test` | Unit-Tests (Vitest mit jsdom und Testing Library), dazu `scripts/*.test.mjs` |
| `pnpm shots <route…>` | Screenshots mit Prüfung, siehe unten |
| `pnpm e2e` | Playwright, beide Projekte: die Flows (Dev-Server) und der Review-Build (baut ihn), siehe unten |
| `pnpm e2e:flows` | nur die Flows und die Handy-Prüfungen, mit eigenem Dev-Server; baut keinen Review-Build |
| `pnpm e2e:review` | nur der Review-Build: baut `dist-review/` und prüft ihn statisch ausgeliefert |

### Screenshots

`pnpm shots` braucht einen laufenden Dev-Server. Es nimmt jede Route mit 1440, 768 und 390 px auf, jeweils hell und dunkel, in einem eigenen Headless-Chromium von Playwright.

```sh
pnpm shots /_components
pnpm shots --base=http://localhost:5174 /_components   # Dev-Server auf einem anderen Port
pnpm shots --keys="Meta+K" /my-items                   # vorher Tasten drücken (mehrere mit Komma)
pnpm shots --click='[data-shot=dialog]' /_components   # vorher klicken
pnpm shots --only=mobile --dark /_components           # nur ein Teil
pnpm shots --fail /inbox                               # mit api:fail: die Fehlerzustände
```

Die Bilder landen in `.shots/<route>/<viewport>-<theme>.png` und zeigen die ganze Seite. Mit `--keys` oder `--click` zeigen sie den sichtbaren Ausschnitt, in dem Dialoge, Palette und Toasts erscheinen, und der Dateiname nennt die Aktion; `--fail` hängt `-fail` an. Das Theme kommt vor dem Laden über `localStorage['werkbuch:theme']`.

Danach steht `FINDINGS`: Fehler und Warnungen in der Konsole, fehlgeschlagene Requests, Schriften, die nicht laden, und seitlicher Überlauf. Gibt es Findings, endet das Kommando mit Code 1.

### Flows (Playwright)

```sh
pnpm exec playwright install chromium   # einmal; Chromium kommt in den Cache von Playwright
pnpm e2e                                # beide Projekte, wie die CI
pnpm e2e:flows                          # nur die Flows (= pnpm e2e --project flows)
pnpm e2e:flows -g "Flow 3"              # ein Flow
pnpm e2e:review                         # nur der Review-Build (= pnpm e2e --project review)
```

Es starten nur die Server der Projekte, die laufen: Das Projekt `flows` (`e2e/flows.spec.ts`) startet einen eigenen Dev-Server auf Port 5199 (`strictPort`), ein laufender Dev-Server auf 5173/5174 bleibt also stehen; das Projekt `review` baut den Review-Build und liefert ihn auf Port 5198 aus. Ohne `--project` laufen beide, auch mit `-g`. Jeder Test beginnt mit leerem `localStorage`, also mit den Demo-Daten und Mara Lindqvist. Alles läuft über die Tastatur, nur das Ziehen im Board mit der Maus. Ein Fehler in der Konsole lässt einen Test scheitern; Helfer und diese Prüfung teilen sich beide Projekte (`e2e/fixtures.ts`).

1. ⌘K, „kontakt“, Enter öffnet WEB-47; `s`, „done“, Enter: Die Resolution „Done“ ist vorbelegt, Enter setzt den Status.
2. APP-11 im Board von Todo nach Done ziehen: Die Karte bleibt in Todo, ein Toast nennt den Grund („… nicht erlaubt“).
3. `c` in APP, Typ Kundenwunsch ohne Kunde: Fehler am Feld. Mit Kunde und ⌘⏎ entsteht APP-25 in Backlog.
4. Im Kommentar `@ma`, Enter, ⌘⏎: Der Kommentar erwähnt Mara.
5. „Seitenstruktur“ bearbeiten: Konfliktbanner; „Meine Fassung übernehmen“ hält eine Version mehr (4 statt 3).
6. Vorlage „Monatsbericht“: Die Vorschau zeigt 02.11.2026, 07.12.2026, 04.01.2027, 01.02.2027 und 01.03.2027.
7. Workflow „Agentur-Freigabe“ ohne den letzten Übergang nach Review: „Review ist vom Startstatus aus nicht erreichbar“, Speichern wird abgelehnt.

Neben den Flows prüft das Projekt `flows` am Handy (390 px), dass Zeilen, Gruppenzeilen und ihre Schalter in der Tabelle mindestens 44 px hoch sind, dass sich im Pfad eines Kind-Items (WEB-42 unter WEB-30) die Keys nicht überlappen, dass ein Item ohne Eltern-Item den Namen seines Projekts zeigt und dass auf einer schmalen Karte im Board das Epic zuerst gekürzt wird, der Key nie. In beiden Themes prüft es, wie der Textmarker „Heute“ markiert, auf der Timeline und im Kalender: hell als gelbe Fläche, im Nachtheft als gelbe Schrift mit Schein. Das Projekt `review` (`e2e/review.spec.ts`) prüft den Review-Build (siehe unten). In der CI läuft `pnpm e2e`, also beides, im Job `clickdummy-e2e`; er ist kein Pflicht-Check.

## Review-Build

```sh
pnpm build:review   # dist-review/: index.html als Fragment, daneben assets/
```

Der Build für Reviews läuft als claude.ai-Artifact, also als eine statische Seite in einem abgeschotteten Frame:
- `vite build --mode review` mit `base: './'` und `VITE_ROUTER=hash` aus `.env.review`: Die Routen stehen im Hash (`#/items/WEB-47`), die Dateien liegen relativ unter `assets/`.
- `scripts/artifact.mjs` macht aus `dist-review/index.html` das Fragment, das ein Artifact erwartet: Es beginnt mit `<title>werkbuch Klickdummy</title>` und `<meta name="claude:viewport-fit-sides" content="cover">`, hat kein `<!doctype>`, `<html>`, `<head>` oder `<body>`, behält Modul-Script, Preloads und Stylesheet unter `assets/` und das Theme-Script inline (es setzt auch `lang="de"`).
- Die App startet auch, wenn `localStorage` wirft: Die Demo-Daten leben dann im Speicher, bis die Seite neu lädt. Schriften kommen aus den gebündelten fontsource-Dateien, sonst lädt die Seite nichts von außen.

`pnpm e2e:review` baut den Review-Build, liefert `dist-review/` mit `scripts/serve.mjs` aus wie ein Host (das Fragment in einem Seitengerüst, keine Rückfallseite für unbekannte Pfade) und prüft Hash-Routen, Palette, `g`-Folgen, Theme, „Zum Inhalt“, einen Deep-Link, ein werfendes `localStorage`, einen Frame mit `sandbox="allow-scripts"` ohne eigenen Ursprung (dort auch einen neuen Kommentar, der nur im Speicher lebt), die Schriften und dass keine Anfrage die Seite verlässt.

## Routen

| Route | Bildschirm |
|---|---|
| `/` | leitet auf `/my-items` |
| `/my-items`, `/created`, `/subscribed` | Meine Items: Zugewiesen, Erstellt, Beobachtet |
| `/inbox` | Inbox |
| `/views`, `/views/:viewId` | alle Views, eine View (`v_due_week`, `v_prod_bugs`, `v_kira`, `v_nordlicht`, `v_roadmap`, `v_blocked`) |
| `/projects`, `/projects/:identifier` | alle Projekte, die Items eines Projekts (`WEB`, `APP`, `OPS`); `?layout=board`, `table`, `timeline` |
| `/projects/:identifier/wiki/:pageId?` | Wiki, z. B. `/projects/WEB/wiki/pg_web_structure` |
| `/projects/:identifier/templates/:templateId?` | Vorlagen, z. B. `/projects/APP/templates/tpl_app_report` |
| `/projects/:identifier/settings/:section?` | Projekt: `general`, `members`, `workflow`, `types`, `automations` |
| `/items/:key` | ein Item als Seite, z. B. `/items/WEB-47` |
| `/settings/:section?` | Organisation: `general`, `people`, `bots`, `workflows` (`?workflow=wf_agency`), `types`, `properties`, `labels`, `relation-types`, `resolutions`, `webhooks`, `system` |
| `/me/:section?` | Persönlich: `profile`, `security`, `notifications`, `api` |
| `/login`, `/forgot-password`, `/invitations/:token` | Bildschirme vor der Anmeldung |
| `/_components` | Komponenten-Galerie |

Eine unbekannte Route zeigt „Diese Seite gibt es nicht“ in der Shell. Im Review-Build steht vor jeder Route ein `#`.

## Tastatur

`?` zeigt alle Kürzel des Bildschirms, die Palette (⌘K, auf Windows und Linux Strg+K) nennt sie neben den Befehlen. In Eingabefeldern und im Editor wirken nur ⌘K, Esc und ⌘⏎; solange ein Dialog offen ist, ruhen die Einzeltasten der Seite.

| Kürzel | Aktion |
|---|---|
| ⌘K, `/` | Befehlspalette und Suche; in Listen filtert `/` nach Titel |
| `?` | alle Kürzel |
| `c` | neues Item (im Projekt mit dem Projekt vorbelegt) |
| `g` dann `i` / `m` / `v` / `p` | Inbox / Meine Items / Views / Projekte |
| `j` `k`, ↓ ↑ | nächstes / voriges Item; mit ⇧ die Auswahl erweitern |
| Enter / Leertaste | Item öffnen / Vorschau |
| `x`, ⇧X, ⌘A, Esc | auswählen, Bereich, alle, Auswahl aufheben |
| `s` `a` `i` `p` `l` `t` | Status, Assignee, mir zuweisen, Priorität, Labels, Typ |
| `d`, ⇧D, ⇧P, `r` | Due-Date, Start-Date, Eltern-Item, Relation |
| `e`, `m` | Titel bearbeiten, Kommentar schreiben |
| `f` | Filterbedingung hinzufügen |
| `1`–`4` | Liste, Board, Tabelle, Timeline |
| ⌘⏎ | speichern bzw. absenden |
| ⌘⌫ | archivieren bzw. löschen, mit Rückgängig (eine Wiki-Seite erst nach Rückfrage) |
| ⌘Z | letzte Aktion zurücknehmen, solange ihr Toast steht |
| Board: ← →, ⇧← ⇧→, ⌥↑ ⌥↓ | Spalte wechseln, Karte in die nächste erlaubte Spalte, Karte in der Spalte verschieben |
| Timeline: ⇧← ⇧→, ⌥← ⌥→ | Epic verschieben, Epic kürzer oder länger machen (je eine Einheit des Zooms: Tag, Woche oder Monat) |
| Inbox: `e`, `u`, ⇧E, `#` | als gelesen markieren, wieder als ungelesen markieren, alle als gelesen, löschen |

## Demo-Rollen („Als … ansehen“)

Das Profilmenü unten in der Seitenleiste wechselt die angemeldete Person. Die Wahl übersteht ein Neuladen (`localStorage['werkbuch:session']`).

| Person | Organisation | WEB (öffentlich) | APP (öffentlich) | OPS (privat) |
|---|---|---|---|---|
| Mara Lindqvist | Org-Admin, Standard | Admin | Member | Member |
| Jonas Feld | Member | Member | Member | Admin |
| Ida Brenner | Member | Admin | liest mit (kein Mitglied) | sieht es nicht |
| Theo Okafor | Member | Viewer | Admin | sieht es nicht |
| Lene Vogt | Member | Member | Member | sieht es nicht |
| Sven Albers | deaktiviert, nicht wählbar | | | |

Bots: „Automation“ (Standard-Bot, Org-Admin; legt Items aus Vorlagen an) und „Kira“ (Bot von Mara, Member in WEB und OPS).

## Theme

Hell (Arbeitsheft), Nachtheft oder System. Die Wahl liegt als Text unter `localStorage['werkbuch:theme']` (`system`, `light` oder `dark`); `index.html` setzt sie vor dem ersten Zeichnen auf `<html data-theme>`.

## Fehlerfall

```js
localStorage.setItem('api:fail', '1') // jede Funktion der Fake-API scheitert mit 503 „simulated“
localStorage.removeItem('api:fail') //   wieder normal
```

So lassen sich Fehlerzustände, „Erneut versuchen“ und das Zurückrollen optimistischer Änderungen ansehen; `pnpm shots --fail` nimmt sie auf.

## Daten, Uhr und Demo-Werkzeuge

Die Demo-Daten liegen in `src/api/seed/` (alles ausgedacht: Feldwerk, sechs Personen, zwei Bots, drei Projekte) und werden beim ersten Start nach `localStorage['werkbuch:db']` geschrieben. Dort stehen auch die Änderungen. Ein alter Stand (`schema_version`) oder kaputtes JSON wird nicht migriert, sondern durch die Demo-Daten ersetzt.

```js
localStorage.removeItem('werkbuch:db') // Demo-Daten neu laden (nach dem Neuladen der Seite)
localStorage.getItem('werkbuch:session') // wer angemeldet ist; Standard ist Mara Lindqvist (u_mara)
```

„Heute“ ist Mittwoch, der 28.10.2026. Die Uhr (`src/lib/clock.ts`) startet beim Laden der Seite um 10:00 Europe/Berlin und läuft in Echtzeit weiter. Ändert sich die Seed-Form, hebt man `SCHEMA_VERSION` in `src/api/db.ts` an.

Werkzeuge, die es nur im Klickdummy gibt:
- Profilmenü: „Als … ansehen“, „Live-Ereignis simulieren“ (Ida ändert Status oder Priorität eines WEB-Items), „Live-Verbindung trennen“ und „Demo zurücksetzen …“.
- Item-Menü („Weitere Aktionen“): „Beschreibungskonflikt simulieren“ spielt einen Konflikt in der Beschreibung.
- Die Wiki-Seite „Seitenstruktur“ meldet beim ersten Speichern einen Konflikt, als hätte Jonas kurz vorher gespeichert.

## Ordner

```text
src/
  main.tsx           Einstieg: Schriften, Styles, App
  vite-env.d.ts      VITE_ROUTER (hash im Review-Build)
  styles/            tokens.css (alle Tokens aus DESIGN.md), app.css (Tailwind 4, @theme inline, Grundstile)
  components/ui/     eigenes Komponentenset auf Base UI, dazu ui.test.tsx
  components/fields/ Feld-Editoren (Status, Assignee, Priorität, Labels, Datum, Typ, Eltern, Properties) und die
                     Item-Befehle mit ihren Kürzeln (commands.ts, useItemCommands)
  components/items/  Item-Bausteine: Karteikarte (ItemCard), Listenzeile (ItemRowBase), Key, Blockiert-Hinweis
  routes/            components-gallery.tsx (/_components), gallery/ (Rahmen und der Abschnitt „Felder“)
  lib/               Helfer (theme, platform, clock, richtext), Kürzel-Register und Hilfe (shortcuts/), Palette-Befehle
                     (commands.ts), Rechte (permissions.ts), Rückgängig (undo.ts), Fehler-Toast (errors.ts),
                     md-Breakpoint (media.ts), Links und Adressen für beide Router (links.ts), localStorage ohne
                     Ausnahmen (storage.ts)
  types.ts           gemeinsame Typen
  domain/            Fachlogik als reine Funktionen; wird später nach PHP portiert. people.ts: wer Items übernehmen
                     und erwähnt werden kann; hierarchy.ts: wer Kind-Items und wer ein Eltern-Item haben kann und
                     welchen Typ ein neues Kind-Item bekommt
  api/               Fake-API: client.ts (Fehler, Latenz, Sitzung), db.ts (localStorage), eine Datei je Ressource, seed/ (Demo-Daten)
  hooks/             TanStack-Query-Hooks, einer je API-Funktion; keys.ts hat alle Query-Keys
  store/             Zustand: session.ts (wer angemeldet ist), ui.ts (Theme, Seitenleiste, Palette, Kürzel-Hilfe, Vorschau, Auswahl)
  app/               Router (Browser- oder Hash-Router), Shell mit Seitenleiste und Profilmenü, Live-Banner, Hosts für
                     Vorschau und Anlegen-Dialog
  features/<name>/   die Bildschirme, je Bereich ein Ordner
e2e/                 Playwright: flows.spec.ts (die sieben Flows und die Handy-Prüfungen), review.spec.ts (der
                     Review-Build), fixtures.ts (Fehlerprüfung und Palette für beide)
scripts/
  shots.mjs          Screenshots mit Prüfung
  artifact.mjs       macht aus dist-review/index.html das Fragment für ein Artifact (Test: artifact.test.mjs)
  serve.mjs          statischer Server für den Review-Build, wie ein Host ihn ausliefert
```

## Wo die echte API andockt

Komponenten rufen `src/api/*` nie direkt auf, nur über die Hooks in `src/hooks/`. Die Funktionen in `src/api/` tragen die Namen und Felder der REST-API aus der Spec (Abschnitt 6.1, Felder in snake_case). In der App ersetzen Aufrufe der Laravel-API diese Funktionen; Hooks und Komponenten bleiben, wie sie sind.

Ein Item bringt neben `parent_id` eine kleine Zusammenfassung seines Eltern-Items mit: `parent` mit `id`, `key` und `title`, sonst `null`. So nennt eine Karte ihr Epic, auch wenn der Filter der Liste das Epic ausschließt. Die Fake-API berechnet `parent` bei jedem Lesen (Listen, Detail, Antworten auf Änderungen) und speichert es nicht (`WorkItemRecord` in `src/types.ts`); die REST-API bettet es genauso ein. Optimistische Änderungen halten es richtig: Ein neues Eltern-Item steht sofort da, sofern es geladen ist; sonst nennt die Karte bis zur Antwort des Servers keins. Ein umbenanntes Epic steht sofort auch auf den Karten seiner Kinder.

An zwei Stellen ist die Fake-API breiter als 6.1. Der Port übernimmt ihre Form nicht, sondern plant sie bewusst:
- `getWorkItemMeta()` rechnet für alle sichtbaren Items auf einmal den Fortschritt der Kind-Items und „blockiert“ bzw. „blockiert andere“ aus; `useFilterContext` und die Listen hängen daran. Der Server liefert stattdessen `children_progress`, `blocked` und `blocking` am Item oder je Seite mit.
- `listMembers()` ohne Projekt gibt die Mitgliedschaften aller sichtbaren Projekte zurück; daraus rechnen `usePermissions` und die Personenlisten der Felder. Eine Liste über alle Projekte hinweg sieht 6.1 nicht vor.

## Abweichungen von der Spec

Was der Klickdummy anders macht als die Spec (`docs/superpowers/specs/2026-10-28-werkbuch-design.md`) oder genauer festlegt. Die Entscheidungen während der Umsetzung (R1, R2, …) stehen mit Grund in `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-rulings.md`.

**Gestaltung und Sprache**
- **Status-Icons statt freier Statusfarbe** (4.5): Jeder Status hat eine Form aus sieben (`dashed`, `circle`, `half`, `three-quarter`, `pause`, `check`, `cross`), die Farbe folgt der Kategorie. Der Spec-Nachtrag folgt nach den Korrekturrunden.
- **Sechs Typ-Töne statt freier Typfarbe** (4.6): Himmel, Ocker, Moos, Pflaume, Sand, Schiefer, je mit Reiter- und Tintenvariante für hell und dunkel (DESIGN.md).
- **Nur Deutsch:** keine i18n-Schicht, auch die Spracheinstellungen ändern die Oberfläche nicht.

**Nur im Klickdummy**
- „Beschreibungskonflikt simulieren“ im Item-Menü, der Konflikt beim ersten Speichern von „Seitenstruktur“, „Live-Ereignis simulieren“ und „Live-Verbindung trennen“, „Als … ansehen“ und „Demo zurücksetzen …“ (mit Rückfrage).
- Die Demo-Uhr steht beim Laden auf Mittwoch, 28.10.2026, 10:00 Europe/Berlin.
- Fake-Grenzen: Anhänge höchstens 1 MB (`localStorage`); Passwort, zweiter Faktor und Profilbild nur lokal, der zweite Faktor vergisst sich beim Neuladen; die Zeitzonen sind eine kuratierte Liste; die Inbox zeigt die neuesten 50 ohne Blättern (R20); Mehrfachbearbeitung wirkt je Item, nicht atomar.
- Der Review-Build routet im Hash (`#/…`), weil er als eine statische Seite läuft.

**Bedienung**
- Tastatur, zusätzlich zu 5.3: `/` öffnet die Palette, in Listen filtert es nach Titel; `f` für eine Filterbedingung; Board mit ← →, ⇧← ⇧→ und ⌥↑ ⌥↓ (auch als Palette-Befehle, R30); Timeline mit ⇧← ⇧→ (verschieben) und ⌥← ⌥→ (kürzer, länger), wo 4.11 für das Verschieben die Pfeiltasten allein nennt; Inbox mit `e`, `u`, ⇧E und `#`.
- Esc in einem Feld der Vorschau verlässt erst das Feld, das zweite Esc schließt die Vorschau (R14).
- Öffnen: Klick auf Zeile oder Karte zeigt die Vorschau, Enter öffnet die Seite, ⌘-Klick einen neuen Tab, ⇧-Klick wählt einen Bereich. In der Inbox öffnet Enter die Vorschau, und jedes Öffnen markiert als gelesen: Enter, Klick, ⌘- oder Mittelklick (neuer Tab), die Seite einer Benachrichtigung ohne Item und der Titel einer Karte (dann alle ihre Benachrichtigungen). Im Filter „Ungelesen“ verlässt die geöffnete Zeile die Liste, Cursor und Fokus gehen weiter, die Vorschau bleibt offen. `u`, die Zeile und die Palette markieren wieder als ungelesen.
- „Vorlage anwenden …“ in der Palette (4.12, 4.17) listet die Vorlagen aller Projekte, in denen du Items anlegen darfst, jeweils mit ihrem Projekt; die Wahl öffnet den Anlegen-Dialog mit Projekt und Vorlage. Ist keine anwendbar, sagt ein Toast, warum.
- Die Leiste der Mehrfachbearbeitung ersetzt die Filterleiste oben, solange Items gewählt sind (unten würden die Toasts sie verdecken).
- Ein Zug im Board bekommt keinen Erfolgs-Toast: Die Karte zeigt das Ergebnis, eine Statuszeile sagt es Screenreadern. Abgelehnte Züge melden sich per Toast.
- Toasts: drei Plätze; Rückgängig-Toasts werden nie verdrängt, neue warten dann. Fehler stehen außerhalb der drei, werden wie alle Toasts höflich angesagt (`aria-live="polite"`), und derselbe Fehler noch einmal frischt den stehenden Toast auf (neueste Aktion, Zeit beginnt von vorn), statt sich zu stapeln; angesagt wird er dabei nicht noch einmal. Nur Fehler, bei denen Wiederholen hilft (5xx, keine Antwort), bieten „Erneut versuchen“; ein 409 mit Konfliktstand zeigt das Banner statt eines Toasts (R12).
- Die Speichern-Knöpfe der Projekteinstellungen bleiben aktiv und antworten „Keine Änderungen zu speichern.“, statt grau zu sein (Guideline: Absenden bleibt aktiv). Verlässt man ein geändertes Einstellungsformular, fragt die App nach.
- „Neu laden“ im Wiki-Konflikt lässt sich zurücknehmen; neue Seiten heißen „Neue Seite“ mit markiertem Titel.
- Kind-Items stehen nur in ihrer eigenen Statusgruppe, so stimmen die Zähler (R21, in der Korrekturrunde bestätigt).
- Karten von Kind-Items zeigen auf dem Board ihr Epic vor dem Key, außer das Board ist nach Eltern-Item gruppiert.

**Fachliche Präzisierungen**
- Wer Items übernehmen und erwähnt werden kann: Mitglieder des Projekts und Org-Admins (Personen), Bots nur als Mitglied, der Standard-Bot also nur, wenn er ausdrücklich Mitglied ist (R33, präzisiert 4.8 „Zugriff“).
- Typ Bug hat zusätzlich die optionale Property „Aufwand (h)“, damit WEB-47 dem Moodboard entspricht (R6). Labels haben keine Standard-Markierung (R23).
- Rich-Text-Properties lassen sich in Listen und Formularen nur als schlichte Absätze bearbeiten; reichere Dokumente stehen dort schreibgeschützt mit „Im Editor bearbeiten“ (R17).
- Filter: „blockiert andere“ ist ein eigenes Feld (R9); „heute“ und Zeitstempel zählen in der Zeitzone der Organisation (R10). Eine Bedingung auf eine Property trifft Items, deren Typ sie nicht hat, nie, auch nicht `ist leer`.
- Zeitpläne: Wochentage zählen 0 = Sonntag; Wochenintervalle zählen ab Montag; `{week}` und `{month}` sind zweistellig (KW 05); ein Plan, der nach N Läufen endet, holt auch höchstens bis N nach (R8).
- Board nach Kategorie gruppiert: Ein Zug in die Spalte der eigenen Kategorie behält den Status, ein Zug in eine andere nimmt deren ersten erlaubten Status.
- Zähler pro Gruppe zählen im Browser über alle geladenen Seiten (gruppierte Listen laden alle Seiten), nicht auf dem Server.
- Die Relation heißt „wird blockiert von“ (4.9), nicht „blockiert von“ wie im Moodboard.
- Ein Löschen im Wiki fragt immer nach (4.15 „mit Bestätigung“) und nennt mitgehende Unterseiten; nach dem Ja bleiben fünf Sekunden Rückgängig (5.1). Das Ziehen im Baum bleibt, wie es ist.
- Nur Epics (Typen mit Häkchen „Epic“) können Kind-Items haben, und Epics haben selbst kein Eltern-Item: zwei Ebenen (Korrekturrunde 2026-10-29; Spec 4.8 sagte „beliebig tief“).
- Ein neues Kind-Item bekommt den Standardtyp des Projekts, außer der ist ein Epic; dann den ersten aktivierten Typ, der ein Eltern-Item haben kann. Hat das Projekt keinen solchen Typ, sagen „Kind-Item“, das Item-Menü und die Spalte im Board, warum nicht.
- Ein neu angelegtes Projekt wird nicht automatisch Favorit; Maras Favoriten enthalten auch die drei Projekte (R13).
- Das JSON-Snippet für MCP hat die Form `mcpServers.werkbuch` mit `type`, `url` und `headers.Authorization`.

## Entschieden in der Korrekturrunde (2026-10-29)

- Öffnen markiert als gelesen; neu `u` für ungelesen. „Alle als gelesen“ bleibt global.
- Neue Kind-Items starten im Startstatus des Workflows (war schon so); Kinder stehen in ihrer eigenen Gruppe (R21 bleibt).
- Löschen im Wiki fragt immer; das Ziehen im Baum bleibt.
- Im Anlegen-Dialog zuerst der Titel (bleibt so).
- Nur Epics (Typen mit Häkchen „Epic“) können Kind-Items haben, und Epics haben selbst kein Eltern-Item: zwei Ebenen (Korrekturrunde 2026-10-29; Spec 4.8 sagte „beliebig tief“).
- Die Heute-Markierung folgt im Nachtheft der Textmarker-Regel: gelbe Schrift mit Schein statt gelber Fläche.
- Karten von Kind-Items zeigen auf dem Board ihr Epic vor dem Key, außer das Board ist nach Eltern-Item gruppiert.
- Bots heißen in der Oberfläche durchgehend „Bot“, auch wenn sie einer Person gehören.
- Die Geschmacksfragen bleiben vorerst.

## Fragen für die Korrekturrunde

- **Geschmack:** Rafael lässt diese Punkte vorerst, wie sie sind (2026-10-29).
  - Enter öffnet in Listen die Seite, in der Inbox die Vorschau.
  - Kein Erfolgs-Toast nach einem Zug im Board.
  - Die Speichern-Knöpfe der Projekteinstellungen bleiben aktiv, auch ohne Änderung.
  - Die Mehrfachbearbeitung ersetzt oben die Filterleiste.
  - Derselbe Fehler noch einmal frischt den stehenden Toast auf und wird nicht erneut angesagt; „Erneut versuchen“ wiederholt dann den neuesten Versuch.
  - Der Versionen-Dialog hat zwei „Schließen“ (Kreuz oben, Knopf unten).
  - Unterhalb von 1024 px zeigt die Wiki-Seite den Baum nicht daneben; zurück geht es über „Wiki“.
  - Tabellen auf dem Handy: Die Tabelle scrollt seitlich, man sieht nur Item und Status. Reicht die Liste fürs Handy?
  - Die Vorschau in der Inbox folgt `j` und `k` nicht, anders als in den Listen. Soll sie?
  - Die Prioritäten heißen wie in 4.8 Urgent, High, Medium, Low und None. So lassen oder auf Deutsch (Dringend, Hoch, Mittel, Niedrig, Keine)?

## Bekannte Punkte nach der Korrekturrunde

Kurzfassung der zurückgestellten Befunde (vollständige Liste: `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md`, R32). Sie warten, weil die Korrekturen diese Bildschirme ohnehin ändern.

- **Aufräumen (13b):** große Dateien teilen (Items-Bildschirm, Board, Timeline, Anlegen-Dialog, Aktivität, Item-Kopf, Vorlagen-Editor, Wiki-Seite, Workflow-Editor, Item-Befehle, Seitenleiste, Galerie). Doppeltes zusammenführen: Einstellungsrahmen, Verlassen-Schutz, Status-Zuordnung, Zeitzonen und Entfernen-Helfer aus den Organisations- und Projekt-Einstellungen; Formatierer, Status-Icons, Hilfen der Listen und Tabellen. FavoriteStar, FormDialog, CopyField und Sortable in die gemeinsamen Komponenten; den lokalen Retry-Umweg der Felder durch einen Retry in der gemeinsamen Mutation ersetzen.
- **Verhalten (13c):**
  - Listen: Fokus geht verloren, wenn die fokussierte Zeile aus dem Bild scrollt; Gruppenschalter der Tabelle sind zusätzliche Tab-Stopps; der Filterentwurf geht über das Operator-Menü verloren; reine Anzeigeänderungen an eingebauten Listen werden keine View; das Skelett hat für alle Layouts die Form der Liste; ein Fehler beim Nachladen ersetzt eine volle Liste.
  - Board und Timeline: Folgen nach einer Umsortierung durch den Server; Timeline-Ziehen lässt sich nicht mit Esc abbrechen; gleiche Ränge über Projekte hinweg.
  - Item: Hinweis „verborgenes Item“ auch bei 5xx; Zeitzone an drei Stellen fest auf Berlin statt der der Organisation; Uploads aus verworfenen Entwürfen bleiben liegen; der Anlegen-Dialog verliert beim Fehlschlag des Katalogs seinen Entwurf.
  - Wiki und Vorlagen: Schwelle beim Verschachteln, Zeitangabe „gespeichert“ vor Screenreadern versteckt, Fallanimation beim Ablegen, Wiederholschutz für ⌘⏎ im Vorlagen-Editor, „Meine Fassung übernehmen“ nach zurückgenommenem „Neu laden“.
  - Einstellungen: Steuerelemente ohne Recht sind ausgegraut statt im Lese-Look; leere Zustände ohne nächsten Schritt (Mitglieder, Relationstypen); Bots und Personen laden ohne Skelett; ein 422 auf ein nicht gezeigtes Feld bleibt stumm; Automatisierungen können doppelt speichern.
  - Inbox, Views, Projekte: falscher Hinweistext bei gelesenen Einträgen; Zeilenaktionen nicht per Tab erreichbar; „Du liest nur mit.“ auch bei Org-Admins; in der Inbox heißt jeder Ladefehler eines Items „gibt es nicht mehr“.
  - Fake-API: der Lead bekommt beim Anlegen in einem späteren Status zwei Benachrichtigungen; Anhänge prüfen beim Verknüpfen die hochladende Person nicht (für den PHP-Port merken).
- **Guidelines aus dem Durchgang:** Board und Timeline sind nicht virtualisiert; die Regel gilt ab 50 Items, der Punkt bleibt nach R34 offen und kommt mit 13c (Liste und Tabelle sind virtualisiert). Die Auswahlfelder in den Zellen der Tabelle sind am Handy nur etwa 24 px hoch (Zeilen und Gruppenschalter haben 44 px); auch diese Regel (MUST) ist offen und kommt mit 13c, je nachdem, wie die Frage „Reicht die Liste fürs Handy?“ ausgeht. Die Galerie lässt geöffnete Muster stehen, die den Rest für Screenreader verdecken; Skelette erscheinen sofort statt nach etwa 300 ms; Witwen in langen Seitentiteln („– Technik“ allein auf der Zeile).
- **Tests:** Zeigerziehen im Board, ⌥↑/⌥↓, Abbruch der Resolution-Abfrage, Fokus nach 1–4, Rechte-Gating der Board-Befehle, Kalender-Rechnen und -Tastatur, `Kbd`-Folgen, Bildansicht und Upload-Besitz im Wiki, Entwurf nach fehlgeschlagenem Speichern, Tippen während des Speicherns.
