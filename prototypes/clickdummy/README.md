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
| `pnpm build:review` | Build für Reviews nach `dist-review/` |
| `pnpm preview` | den Build lokal ansehen |
| `pnpm typecheck` | TypeScript prüfen |
| `pnpm test` | Unit-Tests (Vitest mit jsdom und Testing Library) |
| `pnpm shots <route…>` | Screenshots mit Prüfung, siehe unten |
| `pnpm e2e` | Playwright-Flows (kommen mit Task 13) |

### Screenshots

`pnpm shots` braucht einen laufenden Dev-Server. Es nimmt jede Route mit 1440, 768 und 390 px auf, jeweils hell und dunkel, in einem eigenen Headless-Chromium von Playwright.

```sh
pnpm shots /_components
pnpm shots --base=http://localhost:5174 /_components   # Dev-Server auf einem anderen Port
pnpm shots --keys="Meta+K" /my-items                   # vorher Tasten drücken (mehrere mit Komma)
pnpm shots --click='[data-shot=dialog]' /_components   # vorher klicken
pnpm shots --only=mobile --dark /_components           # nur ein Teil
```

Die Bilder landen in `.shots/<route>/<viewport>-<theme>.png` und zeigen die ganze Seite. Mit `--keys` oder `--click` zeigen sie den sichtbaren Ausschnitt, in dem Dialoge, Palette und Toasts erscheinen, und der Dateiname nennt die Aktion. Das Theme kommt vor dem Laden über `localStorage['werkbuch:theme']`.

Danach steht `FINDINGS`: Fehler und Warnungen in der Konsole, fehlgeschlagene Requests, Schriften, die nicht laden, und seitlicher Überlauf. Gibt es Findings, endet das Kommando mit Code 1.

## Ordner

```text
src/
  main.tsx           Einstieg: Schriften, Styles, App
  styles/            tokens.css (alle Tokens aus DESIGN.md), app.css (Tailwind 4, @theme inline, Grundstile)
  components/ui/     eigenes Komponentenset auf Base UI, dazu ui.test.tsx
  components/fields/ Feld-Editoren (Status, Assignee, Priorität, Labels, Datum, Typ, Eltern, Properties) und die
                     Item-Befehle mit ihren Kürzeln (commands.ts, useItemCommands)
  components/items/  Item-Bausteine: Karteikarte (ItemCard), Listenzeile (ItemRowBase), Key, Blockiert-Hinweis
  routes/            components-gallery.tsx (/_components), gallery/ (Rahmen und der Abschnitt „Felder“)
  lib/               Helfer (theme, platform, clock, richtext), Kürzel-Register und Hilfe (shortcuts/), Palette-Befehle
                     (commands.ts), Rechte (permissions.ts), Rückgängig (undo.ts), Fehler-Toast (errors.ts)
  types.ts           gemeinsame Typen
  domain/            Fachlogik als reine Funktionen; wird später nach PHP portiert
  api/               Fake-API: client.ts (Fehler, Latenz, Sitzung), db.ts (localStorage), eine Datei je Ressource, seed/ (Demo-Daten)
  hooks/             TanStack-Query-Hooks, einer je API-Funktion; keys.ts hat alle Query-Keys
  store/             Zustand: session.ts (wer angemeldet ist), ui.ts (Theme, Seitenleiste, Palette, Kürzel-Hilfe, Vorschau, Auswahl)
  app/               Router, Shell mit Seitenleiste und Profilmenü, Live-Banner, Hosts für Vorschau und Anlegen-Dialog
  features/<name>/   die Bildschirme; bis ihre Task sie baut, steht dort ein Platzhalter „Kommt in Task N“
scripts/shots.mjs    Screenshots mit Prüfung
```

Ordner, die noch fehlen, entstehen mit den späteren Tasks des Plans.

## Theme

Hell (Arbeitsheft), Nachtheft oder System. Die Wahl liegt als Text unter `localStorage['werkbuch:theme']` (`system`, `light` oder `dark`); `index.html` setzt sie vor dem ersten Zeichnen auf `<html data-theme>`.

## Fehlerfall

```js
localStorage.setItem('api:fail', '1') // jede Funktion der Fake-API scheitert mit 503 „simulated“
localStorage.removeItem('api:fail') //   wieder normal
```

So lassen sich Fehlerzustände, „Erneut versuchen“ und das Zurückrollen optimistischer Änderungen ansehen.

## Daten und Uhr

Die Demo-Daten liegen in `src/api/seed/` (alles ausgedacht: Feldwerk, sechs Personen, zwei Bots, drei Projekte) und werden beim ersten Start nach `localStorage['werkbuch:db']` geschrieben. Dort stehen auch die Änderungen. Ein alter Stand (`schema_version`) oder kaputtes JSON wird nicht migriert, sondern durch die Demo-Daten ersetzt.

```js
localStorage.removeItem('werkbuch:db') // Demo-Daten neu laden (nach dem Neuladen der Seite)
localStorage.getItem('werkbuch:session') // wer angemeldet ist; Standard ist Mara Lindqvist (u_mara)
```

Das Profilmenü unten in der Seitenleiste hat die Werkzeuge der Demo: „Als … ansehen“ (eine andere Person), „Live-Ereignis simulieren“, „Live-Verbindung trennen“ und „Demo zurücksetzen“.

„Heute“ ist Mittwoch, der 28.10.2026. Die Uhr (`src/lib/clock.ts`) startet beim Laden der Seite um 10:00 Europe/Berlin und läuft in Echtzeit weiter. Ändert sich die Seed-Form, hebt man `SCHEMA_VERSION` in `src/api/db.ts` an.

## Wo die echte API andockt

Komponenten rufen `src/api/*` nie direkt auf, nur über die Hooks in `src/hooks/`. Die Funktionen in `src/api/` tragen die Namen und Felder der REST-API aus der Spec (Abschnitt 6.1, Felder in snake_case). In der App ersetzen Aufrufe der Laravel-API diese Funktionen; Hooks und Komponenten bleiben, wie sie sind.
