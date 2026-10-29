# Design-Richtung

**Produkt**: werkbuch, ein offenes, selbst gehostetes Projektmanagement für kleine bis mittlere Teams (Agenturen, Produktteams), in denen auch KI-Agenten als Bots mitarbeiten.
**Modus**: Product
**Richtung**: Werkbuch („Arbeitsheft“). Am 2026-10-28 hat Rafael sie aus drei Moodboards gewählt (A Milchglas, B Tiefsee, C Werkbuch). Handfest wie ein gutes Arbeitsheft: Punktraster als Grund, Items als Karteikarten mit farbigem Reiter je Typ, Textmarker für Auswahl, Fokus und Markierung, Glas als Transparentpapier. Das macht ein dichtes Werkzeug sympathisch, ohne verspielt zu werden, und gibt Auswahl und Fokus eine eigene Geste, die man sofort liest.
**Referenz**: das Moodboard `prototypes/moodboards/werkbuch/index.html` (Tokens, Komponenten und Schlüsselbildschirm), dazu die Spec, Abschnitte 4.11 und 5.

Diese Datei gilt für den Klickdummy und danach für die App (Tokens in `resources/css/app.css`). Unterschiede zum Moodboard:
- Tailwind 4: Tokens über `@theme inline`, die Tailwind-Farbpalette ist entfernt.
- Schriften lokal über fontsource (`@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree`), keine Google Fonts.
- Das Layout ist fließend. Die festen Maße `--app-w`, `--app-h` und `--col-w` gab es nur im Moodboard-Ausschnitt.
- Die Befehlspalette fängt den Fokus.

## Tokens

Hell („Arbeitsheft“) steht auf `:root`. Dunkel („Nachtheft“) steht unter `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` und noch einmal unter `:root[data-theme="dark"]`, mit denselben Namen. Die Kernfarben beider Themes liegen zusätzlich als Konstanten `--day-*` und `--night-*` vor, damit die Token-Tabelle beide gleichzeitig zeigen kann.

```css
:root {
  /* core colours of both themes as constants (used by the token table) */
  --day-bg: oklch(0.975 0.004 250);          --night-bg: oklch(0.235 0.02 258);
  --day-surface: oklch(1 0 0);               --night-surface: oklch(0.275 0.022 258);
  --day-glass: oklch(0.988 0.007 85 / 0.74); --night-glass: oklch(0.285 0.022 258 / 0.76);
  --day-text: oklch(0.255 0.04 262);         --night-text: oklch(0.94 0.012 250);
  --day-muted: oklch(0.5 0.03 260);          --night-muted: oklch(0.75 0.02 255);
  --day-border: oklch(0.895 0.012 255);      --night-border: oklch(0.355 0.022 258);
  --day-accent: oklch(0.47 0.165 266);       --night-accent: oklch(0.74 0.12 266);
  --day-marker: oklch(0.93 0.175 104);       --night-marker: oklch(0.91 0.18 104);
  /* paper, ink, lines */
  --bg: var(--day-bg); --bg-sunken: oklch(0.955 0.006 250); --surface: var(--day-surface);
  --text: var(--day-text); --muted: var(--day-muted); --faint: oklch(0.6 0.022 258);
  --border: var(--day-border); --border-strong: oklch(0.8 0.016 255); --line-input: oklch(0.6 0.022 258);
  --dot: oklch(0.255 0.04 262 / 0.16); --hover: oklch(0.255 0.04 262 / 0.05); --pressed: oklch(0.255 0.04 262 / 0.09);
  /* accent: ink blue, the only one */
  --accent: var(--day-accent); --accent-hover: oklch(0.42 0.16 266); --accent-text: var(--day-accent);
  --accent-soft: oklch(0.945 0.025 266); --on-accent: oklch(1 0 0);
  /* highlighter: selection, focus and marking only */
  --marker: var(--day-marker); --on-marker: var(--day-text);
  --mark-bg: var(--day-marker); --mark-fg: var(--day-text); --mark-glow: none;
  --select-wash: oklch(0.93 0.175 104 / 0.5);
  --focus-ring: var(--day-accent); --focus-halo: 0 0 0 6px oklch(0.93 0.175 104 / 0.85);
  /* tracing paper (glass) */
  --glass: var(--day-glass); --glass-strong: oklch(0.988 0.007 85 / 0.88); --raised: var(--day-surface);
  --glass-edge: oklch(0.255 0.04 262 / 0.11); --glass-light: inset 0 1px 0 oklch(1 0 0 / 0.7);
  --glass-blur: 8px;
  --grain: url("data:image/svg+xml,…"); /* feTurbulence noise, dark specks, about 5 % */
  --scrim: oklch(0.975 0.004 250 / 0.22); --knock: var(--surface);
  /* semantic */
  --danger: oklch(0.53 0.19 25); --danger-hover: oklch(0.48 0.19 25);
  --danger-soft: oklch(0.955 0.02 25); --on-danger: oklch(1 0 0);
  /* type tabs: task sky, bug ochre, epic moss; plum, sand and slate for further types */
  --sky: oklch(0.63 0.08 232);   --sky-tab: oklch(0.895 0.045 228); --sky-ink: oklch(0.4 0.07 236);
  --ochre: oklch(0.65 0.115 76); --ochre-tab: oklch(0.875 0.07 80); --ochre-ink: oklch(0.42 0.075 70);
  --moss: oklch(0.6 0.095 132);  --moss-tab: oklch(0.885 0.055 132); --moss-ink: oklch(0.39 0.07 132);
  --plum: oklch(0.58 0.09 340);  --plum-tab: oklch(0.89 0.04 340);  --plum-ink: oklch(0.4 0.075 340);
  --sand: oklch(0.62 0.06 72);   --sand-tab: oklch(0.905 0.03 72);  --sand-ink: oklch(0.42 0.05 66);
  --slate: oklch(0.6 0.03 258);  --slate-tab: oklch(0.87 0.014 262); --slate-ink: oklch(0.38 0.035 260);
  /* status categories: colour = category, shape = status */
  --st-backlog: oklch(0.6 0.02 258); --st-unstarted: oklch(0.5 0.03 260); --st-started: var(--day-accent);
  --st-completed: oklch(0.55 0.11 155); --st-canceled: oklch(0.56 0.04 20);
  /* elevation */
  --elev-1: 0 1px 0 oklch(0.255 0.04 262 / 0.04), 0 1px 3px oklch(0.255 0.04 262 / 0.08);
  --elev-2: 0 1px 2px oklch(0.255 0.04 262 / 0.06), 0 12px 28px -8px oklch(0.255 0.04 262 / 0.2);
  --elev-3: 0 2px 6px oklch(0.255 0.04 262 / 0.08), 0 28px 60px -16px oklch(0.255 0.04 262 / 0.34);
  --elev-drag: 0 6px 12px oklch(0.255 0.04 262 / 0.1), 0 24px 40px -12px oklch(0.255 0.04 262 / 0.36);
  color-scheme: light;
  /* theme independent: shape, type, motion, sizes */
  --r-chip: 6px; --r-ctl: 10px; --r-card: 14px;
  --font-display: "Bricolage Grotesque Variable", "Bricolage Grotesque", "Avenir Next", "Segoe UI Variable Display", "Segoe UI", sans-serif;
  --font-ui: "Figtree Variable", Figtree, "Avenir Next", "Segoe UI Variable Text", "Segoe UI", sans-serif;
  --dur-fast: 120ms; --dur: 160ms; --dur-spring: 420ms;
  --ease-out: cubic-bezier(0.25, 1, 0.5, 1); --ease-spring: cubic-bezier(0.34, 1.3, 0.64, 1);
  --app-w: 1392px; --app-h: 960px; --side-w: 200px; --panel-w: 384px; --col-w: 180px; --palette-w: 540px;
}
@supports (transition-timing-function: linear(0, 1)) {
  :root { --ease-spring: linear(0, 0.053 5%, 0.178 10%, 0.336 15%, 0.499 20%, 0.649 25%, 0.776 30%, 0.877 35%, 0.951 40%, 1.002 45%, 1.033 50%, 1.049 55%, 1.054 60%, 1.052 65%, 1.046 70%, 1.037 75%, 1.028 80%, 1.02 85%, 1.013 90%, 1.007 95%, 1); }
}
```

Nachtheft (beide Dark-Blöcke identisch):

```css
--bg: var(--night-bg); --bg-sunken: oklch(0.21 0.02 258); --surface: var(--night-surface);
--text: var(--night-text); --muted: var(--night-muted); --faint: oklch(0.62 0.02 255);
--border: var(--night-border); --border-strong: oklch(0.45 0.025 258); --line-input: oklch(0.62 0.02 255);
--dot: oklch(0.94 0.012 250 / 0.07); --hover: oklch(0.94 0.012 250 / 0.06); --pressed: oklch(0.94 0.012 250 / 0.1);
--accent: var(--night-accent); --accent-hover: oklch(0.8 0.1 266); --accent-text: oklch(0.78 0.11 266);
--accent-soft: oklch(0.335 0.06 266); --on-accent: oklch(0.2 0.035 266);
--marker: var(--night-marker); --on-marker: var(--night-bg);
--mark-bg: oklch(0.91 0.18 104 / 0.14); --mark-fg: oklch(0.93 0.17 104); --mark-glow: 0 0 12px oklch(0.91 0.18 104 / 0.5);
--select-wash: oklch(0.91 0.18 104 / 0.09);
--focus-ring: var(--night-marker); --focus-halo: 0 0 0 4px oklch(0.91 0.18 104 / 0.2), 0 0 20px 2px oklch(0.91 0.18 104 / 0.35);
--glass: var(--night-glass); --glass-strong: oklch(0.285 0.022 258 / 0.88); --raised: oklch(0.345 0.026 258);
--glass-edge: oklch(0.94 0.012 250 / 0.1); --glass-light: inset 0 1px 0 oklch(1 0 0 / 0.06);
--grain: url("data:image/svg+xml,…"); /* feTurbulence noise, light specks, about 4 % */
--scrim: oklch(0.17 0.02 258 / 0.32);
--danger: oklch(0.7 0.16 25); --danger-hover: oklch(0.76 0.14 25); --danger-soft: oklch(0.32 0.06 25); --on-danger: oklch(0.2 0.03 25);
--sky: oklch(0.7 0.08 232);   --sky-tab: oklch(0.41 0.05 234);  --sky-ink: oklch(0.92 0.04 228);
--ochre: oklch(0.74 0.11 78); --ochre-tab: oklch(0.42 0.065 76); --ochre-ink: oklch(0.93 0.055 82);
--moss: oklch(0.68 0.1 132);  --moss-tab: oklch(0.4 0.06 132);   --moss-ink: oklch(0.92 0.05 132);
--plum: oklch(0.7 0.09 340);  --plum-tab: oklch(0.41 0.055 340); --plum-ink: oklch(0.92 0.04 340);
--sand: oklch(0.74 0.06 75);  --sand-tab: oklch(0.46 0.028 68);  --sand-ink: oklch(0.94 0.03 76);
--slate: oklch(0.7 0.03 255); --slate-tab: oklch(0.37 0.016 262); --slate-ink: oklch(0.92 0.015 255);
--st-backlog: oklch(0.62 0.02 258); --st-unstarted: oklch(0.75 0.02 255); --st-started: var(--night-accent);
--st-completed: oklch(0.72 0.12 155); --st-canceled: oklch(0.66 0.04 20);
--elev-1: 0 1px 0 oklch(0.12 0.02 258 / 0.3), 0 1px 3px oklch(0.12 0.02 258 / 0.35);
--elev-2: 0 1px 2px oklch(0.12 0.02 258 / 0.35), 0 14px 32px -8px oklch(0.12 0.02 258 / 0.55);
--elev-3: 0 2px 6px oklch(0.12 0.02 258 / 0.4), 0 28px 64px -16px oklch(0.12 0.02 258 / 0.7);
--elev-drag: 0 6px 12px oklch(0.12 0.02 258 / 0.4), 0 24px 44px -12px oklch(0.12 0.02 258 / 0.7);
color-scheme: dark;
```

**Rollen der Farben**
- Papier `--bg` mit Punktraster (`--dot`, 2 px Punkte im 16-px-Raster) ist der Grund von Seite und Board. Karten sind reines Weiß, im Nachtheft eine Stufe heller als das Papier.
- Tinte `--text` ist Blauschwarz, Bleistift `--muted` ist zweite Ordnung; beide halten AA auf Papier, Karte und Transparentpapier (geprüft: Tinte 10,3–15,8 : 1, Bleistift ≥ 5,1 : 1, auch über dunklem Untergrund unter Glas).
- **Tintenblau ist der einzige Akzent**: primäre Aktion, Links, Erwähnungen, Inbox-Zähler, Status-Kategorie Started, Heute-Linie.
- **Textmarker nur semantisch**: Auswahl (Karte, Zeile, `::selection`), Tastaturfokus (Halo um den Tinten-Ring), Treffer in der Suche, „Heute“. Nie Deko, nie Buttonfläche. Im Nachtheft leuchtet er: gelbe Schrift mit Schein statt gelber Fläche.
- **Typ-Reiter gedeckt**: Task Himmel, Bug Ocker, Epic Moos; weitere Typen nehmen Pflaume, Sand oder Schiefer (`plum`, `sand`, `slate`). Der Typ steht immer zusätzlich als Icon im Reiter.
- **Status**: Farbe = Kategorie (5), Form = Status (gestrichelter Kreis, Kreis, halb gefüllt, drei Viertel gefüllt, Pause, Haken gefüllt, Kreuz).
- **Priorität**: drei schräge Federstriche, gefüllt nach Stufe (Low 1, Medium 2, High 3, None 0); Urgent ist ein rotes Quadrat mit „!“. Immer mit zugänglichem Namen.

## Form und Glas

- **Radien**: 6 für Chips, `kbd`, Reiter, Checkbox; 10 für Buttons, Eingaben, Menüeinträge und eingelassene Flächen (Kommentar, Hinweis); 14 für Karten, Panel, Palette, Fenster; rund nur für Personen-Avatare, Switch und Zähler. Verschachtelt konzentrisch: Segmented 10 mit 4 px Innenabstand → Segmente 6.
- **Karteikarte**: weiß, 1 px Linie, Elevation 1, oben links ein echter Reiter (Lasche als Trapez mit 6er-Rundung über `perspective` + `rotateX`, deckt die Kante der Karte ab), Farbe nach Typ, darin Typ-Icon und Key in Tabellenziffern. Kein farbiger Rand links.
- **Transparentpapier** (Glas, nur schwebende Flächen): Papierweiß, leicht warm, `oklch(0.988 0.007 85)` bei 74 % (Seitenleiste, Panel; Nachtheft 76 %) bzw. 88 % (Palette, Menüs, Auswahl, Toasts); `backdrop-filter: blur(8px) saturate(1.08)`; Körnung als SVG-Rauschen ≈ 5 % (Nachtheft ≈ 4 %); Kante 1 px Tinte 11 % plus Lichtkante innen oben. Nachtheft: dunkles Blaugrau. Board, Liste und Lesetext stehen auf ruhigen Flächen. Hinter einer offenen Palette liegt ein leichter Schleier (`--scrim`, 22 % Papier bzw. 32 % Nacht), damit das Board lesbar bleibt.
- **Aktive Streifen** (Treffer in der Palette, Menüeintrag, gewählte Option, aktuelle Seite): eine Lage Karte (`--raised`) mit Elevation 1 und 1 px Bleistiftkante (`--line-input`). Die Kante trägt den Zustand, weil Weiß auf Transparentpapier nur 1,04 : 1 hat.
- **Elevation**: 1 = Karte liegt auf, 2 = Bogen schwebt (Panel, Menü), 3 = Palette, Ziehen = eigene Stufe plus Neigung.
- **Eingaben** haben unten eine Schreiblinie in `--line-input` (≥ 3 : 1), damit das Feld als Feld erkennbar ist. Fehler: Rahmen und Schreiblinie in `--danger`, darunter die Meldung mit Icon und konkreter Abhilfe.
- **Avatare**: Personen rund mit Initialen auf gedeckter Fläche; Bots eckig (Radius 6) in Tinte mit Lucide-`bot` bzw. Initiale und dem Zusatz „Bot“ oder „Agent“.

## Typo-Regeln

Display: Bricolage Grotesque 700/800 mit automatischer optischer Größe, für Seitentitel, Abschnitte, Board- und Item-Titel, Gruppen im Moodboard und den Leerzustand. UI: Figtree 400/500/600 für alles andere. Kürzel, Keys, Daten und Zähler in Figtree mit `tabular-nums` (echte Tabellenziffern); Modifier-Tasten (⌘ ⇧ ⌫ ↵) als Lucide-Icons im `kbd`. Keine dritte Familie, keine Mono.

Skala (px Größe/Zeilenhöhe): 10/12 Initialen · 11/14 Kürzel, Reiter · 12/16 Chips, Meta · 13/18 UI-Standard · 14/20 Panel-Text · 15/24 Fließtext · 18/24 Board- und Gruppentitel · 22/28 Item-Titel · 28/32 Abschnitt · 44/46 Seitentitel.

Fließtext max. 65ch. Überschriften `text-wrap: balance`, Display mit −0,02em Laufweite und Zeilenhöhe 1,05–1,2. Keine Versalien-Labels, keine gesperrten Eyebrows.

## Motion

- **160 ms ease-out** (`cubic-bezier(0.25, 1, 0.5, 1)`): Hover, Fokus, Auf- und Zuklappen, Palette und Menüs; 120 ms für reine Farbwechsel.
- **Feder 420 ms, ≈ 5 % Überschwinger** (`linear()`, Fallback `cubic-bezier(0.34, 1.3, 0.64, 1)`): Ziehen und Ablegen, Toasts.
- **Ziehen**: Die Karte hebt sich (−6 px, 102 %), kippt um −2° und bekommt `--elev-drag`; beim Ablegen federt sie zurück.
- Nicht animiert: Layout-Eigenschaften, Text, Filtern und Sortieren von Listen, Theme-Wechsel.
- `prefers-reduced-motion: reduce`: alle Dauern auf 1 ms; Zustände (Neigung, Toast) bleiben sichtbar.

## No-Gos

- Verbotene Default-Fonts (Inter, Roboto, Arial, Helvetica, Space Grotesk, Open Sans, Lato, Montserrat, Poppins, Nunito, Raleway, `system-ui` allein), Serif-Display, Mono-Schrift.
- Cremepapier (#F4F1EA), Terrakotta, lila-blauer SaaS-Verlauf, reines Schwarz auf reinem Weiß.
- Textmarker als Deko oder zweiter Akzent, gelbe Buttons, Gelb als einziges Fokuszeichen im hellen Theme (nur 1,1 : 1 auf Papier).
- Farbiger Rand links an Karten statt Reiter; Typ, Status oder Priorität nur über Farbe.
- Glas unter langen Lesetexten ohne geprüften Kontrast; Glas für ruhige Flächen wie Board oder Liste.
- Radien außerhalb von 6/10/14/rund; gestapelte Default-Schatten statt der Elevation-Stufen.
- Emoji als Icons (Emoji nur in Reaktionen und von Nutzern gesetzten Seitentiteln), Versalien-Eyebrows, Metazeilen mit Mittelpunkten.
- Animation von Layout-Eigenschaften, `transition: all`, Dauer-Loops.

## Entscheidungen

- 2026-10-28: Rafael hat die Richtung Werkbuch („Arbeitsheft“) aus drei Moodboards gewählt. Diese Datei ist ab jetzt die Gestaltungsgrundlage für Klickdummy und App.
- 2026-10-28: Figtree statt Hanken Grotesk als UI-Schrift. Die Google-Fonts-Fassung von Hanken Grotesk hat keine `tnum`-Funktion (Ziffern immer tabellarisch, nicht umschaltbar). Figtree hat proportionale Ziffern für Text und echte Tabellenziffern für Kürzel, Keys und Daten, dazu die Pfeile ↑↓.
- 2026-10-28: Fokus im hellen Theme ist ein 2-px-Ring in Tintenblau mit Textmarker-Halo, im Nachtheft ein gelber Ring mit Leuchten. Grund: Gelb hat auf Papier nur 1,1 : 1.
- 2026-10-28: Status-Farbe nach Kategorie, Status-Form nach Status. Die Palette bleibt klein, Pending und In Progress bleiben trotzdem unterscheidbar.
- 2026-10-28: Das Panel liegt als Transparentpapier über dem Board, mit dem Reiter des Items oben. Die Spalten laufen darunter weiter (Done liegt unter dem Panel), die Kopfzeile rückt ein. Die Relation „blockiert von“ steht als Hinweis direkt unter dem Titel; ein eigener Abschnitt hätte das Panel überlaufen lassen.
- 2026-10-28: Die Palette hat im Moodboard keinen Fokus-Trap, weil sie Teil einer Vorschau in der Seite ist. In der App fängt sie den Fokus und gibt ihn beim Schließen zurück.
- 2026-10-28: Das Moodboard lädt Fonts von Google Fonts; in der App kommen sie lokal über fontsource (Spec 5.4). Lucide-Icons stammen aus `lucide-static` 1.63.0.
- 2026-10-28 (Loop): Glas von 80/90 % auf 74/88 % und Blur von 10 auf 8 px, damit das Transparentpapier als Papier lesbar wird; Bleistift bleibt dabei ≥ 5,1 : 1.
- 2026-10-28 (Loop): Neues Token `--raised` für aktive Streifen; im Nachtheft war `--surface` auf dunklem Glas nicht zu sehen.
- 2026-10-28 (Loop): Schatten mit Variablen nie als `shadow-[var(--x)]` schreiben; Tailwind v3 liest das als Schattenfarbe. Richtig ist `[box-shadow:var(--x)]`.
- 2026-10-28 (Klickdummy): Drei weitere Typ-Töne für eigene Typen: Pflaume (`plum`), Sand (`sand`) und Schiefer (`slate`), gebaut wie die ersten drei (Grundton, `-tab` und `-ink`, hell und dunkel). Tinte auf Reiter hält überall mindestens 5,9 : 1, der Grundton auf Karte und Papier mindestens 3 : 1 (Punkte, Fortschritt). Sand ist heller und blasser als Ocker, Schiefer grauer als Himmel; nebeneinander liegen alle Reiter mindestens ΔE 0,04 (OKLab) auseinander.
- 2026-10-28 (Klickdummy): Status-Formen sind eine feste Menge von sieben (`dashed`, `circle`, `half`, `three-quarter`, `pause`, `check`, `cross`); `three-quarter` kam für Status wie Review dazu.
- 2026-10-28 (Klickdummy): fontsource nennt die Schriften „Bricolage Grotesque Variable“ (mit `opsz`-Achse aus `opsz.css`) und „Figtree Variable“. Die Font-Stacks nennen diese Namen zuerst; `kbd`, `code` und `pre` nutzen die UI-Schrift (Tailwinds Mono-Standard zeigt auf `--font-ui`).
- 2026-10-28 (Klickdummy, Felder): Feld-Editoren sind Listen auf Transparentpapier mit einem Suchfeld oben. Dessen Schreiblinie färbt sich beim Fokus in der Fokusfarbe; der aktive Eintrag zeigt den aktiven Streifen.
- 2026-10-28 (Klickdummy, Felder): Ohne Recht (Viewer, archiviertes Item) bleibt ein Wert in voller Tinte lesbar und fokussierbar; der Tooltip nennt den Grund. Im Formular liegt er auf `--bg-sunken` ohne Schreiblinie, damit er nicht wie ein auszufüllendes Feld aussieht.
- 2026-10-28 (Klickdummy, Felder): Überfällig heißt Datum in `--danger`, das Icon `calendar-x-2` und das Wort „überfällig“, nie nur Farbe.
- 2026-10-28 (Klickdummy, Felder): In Listenzeilen sind die Chips am Handy nur Anzeige (24 px sind zu klein zum Zielen); ein Tipp öffnet das Item mit 44 px hohen Feldern.
- 2026-10-29 (Klickdummy, Code): Syntax-Highlighting in Code-Blöcken nur mit Tinte, Bleistift und Tintenblau, keine eigene Farbe. Sprachwörter (Keywords, Typen, Tags) in Tintenblau und halbfett, Werte (Strings, Zahlen) in Tintenblau, Namen (Funktionen, Attribute) in Tinte und halbfett, Kommentare und Satzzeichen in Bleistift, Kommentare kursiv. Auf `--bg-sunken` hält jede Stufe in beiden Themes mindestens 5 : 1.
- 2026-10-29 (Klickdummy, Dialoge): Eine Rückfrage über einem Dialog (etwa „Ohne Kopie schließen?“ vor dem Schließen eines Tokens) legt ihren Schleier auch über den Dialog darunter, damit sie als oberste Lage lesbar ist.
