# Design-Richtung: Tiefsee (Moodboard B)

**Produkt**: werkbuch, ein offenes, selbst gehostetes Projektmanagement mit Tastatur zuerst. Es tritt gegen Linear, Plane und Jira an, für Teams, die den ganzen Tag darin arbeiten.
**Modus**: Product. Es ist eine App-Oberfläche, Dichte und Ruhe gehen vor Auftritt. Nur der Kopf der Moodboard-Seite präsentiert.
**Richtung**: Tiefsee, abgeleitet von „Dark Technical“ aus dem Katalog: dunkel zuerst, dicht wie ein Werkzeug, Tastatur überall sichtbar, dunkles Glas mit feinen Lichtkanten. Gemacht für Leute, die lieber tippen als zielen.
**Referenz**: keine. Die Vorgaben stehen in `prototypes/moodboards/README.md` und in der Spec, Abschnitt 5.

## Haltung

- Konzentriert und schnell. Der Bildschirm ist ein Werkzeug, kein Schaufenster.
- Jede Aktion zeigt ihr Kürzel: in Buttons, Menüs, Tooltips, in der Palette und beim Hover über Karten.
- Glas gibt es nur für Schwebendes: Seitenleiste, Item-Panel, Befehlspalette, Menüs, offene Auswahl und Toasts. Lesetext steht auf ruhigen Flächen oder auf Glas mit mindestens 90 % Deckkraft.
- Es gibt genau einen Akzent, Gletscherblau. Er markiert Fokus, Auswahl, die Primäraktion, „heute“, ungelesene Zahlen und Erwähnungen von mir. Sonst nichts.
- Farbe trägt Bedeutung: Status, Priorität, Typ und Labels. Die Flächen bleiben Tinte.

## Tokens

Dunkel steht auf dem nackten `:root`. Hell liegt unter `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) }` und noch einmal unter `:root[data-theme="light"]`, beide mit denselben Namen. `.theme-dark` und `.theme-light` setzen ein Theme für einen Teilbaum (nur für die Token-Tafeln der Moodboard-Seite).

```css
:root, .theme-dark {
  color-scheme: dark;
  --bg: oklch(0.19 0.035 257); --surface: oklch(0.23 0.035 257); --raised: oklch(0.27 0.035 257);
  --glass: oklch(0.23 0.035 257 / 0.76); --glass-strong: oklch(0.23 0.035 257 / 0.9);
  --veil: linear-gradient(180deg, oklch(1 0 0 / 0.06), oklch(1 0 0 / 0.015) 56px, oklch(1 0 0 / 0.01));
  --edge: oklch(1 0 0 / 0.12); --edge-light: inset 0 1px 0 0 oklch(1 0 0 / 0.09);
  --text: oklch(0.94 0.012 240); --muted: oklch(0.72 0.02 250); --faint: oklch(0.58 0.02 250);
  --border: oklch(1 0 0 / 0.08); --border-strong: oklch(1 0 0 / 0.14); --hover: oklch(1 0 0 / 0.05);
  --accent: oklch(0.85 0.085 218); --accent-hover: oklch(0.9 0.07 218); --accent-fg: oklch(0.2 0.04 250);
  --accent-soft: oklch(0.85 0.085 218 / 0.14); --accent-line: oklch(0.85 0.085 218 / 0.5);
  --glow: 0 0 0 1px oklch(0.85 0.085 218 / 0.6), 0 0 18px -2px oklch(0.85 0.085 218 / 0.4);
  --danger: oklch(0.72 0.16 22); --danger-soft: oklch(0.72 0.16 22 / 0.14);
  --scrim: oklch(0.13 0.035 257 / 0.45); --shade: 0 24px 56px -16px oklch(0.08 0.04 257 / 0.75);
  --kbd: oklch(1 0 0 / 0.06); --kbd-edge: oklch(1 0 0 / 0.13); --kbd-on-accent: oklch(0.2 0.04 250 / 0.12);
  --tint: 30%;
  --hue-rose: oklch(0.72 0.16 22); --hue-orange: oklch(0.78 0.13 60); --hue-amber: oklch(0.83 0.13 85);
  --hue-jade: oklch(0.78 0.1 168); --hue-lilac: oklch(0.76 0.11 295); --hue-slate: oklch(0.76 0.05 245);
  --st-backlog: oklch(0.66 0.02 255); --st-unstarted: oklch(0.86 0.015 250); --st-canceled: oklch(0.62 0.02 255);
  --pr-medium: oklch(0.84 0.015 250); --pr-low: oklch(0.7 0.02 250); --pr-none: oklch(0.58 0.02 250);
  --atmo: radial-gradient(90% 55% at 50% -12%, oklch(0.85 0.085 218 / 0.08), transparent 70%);
}
/* hell: @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { … } } und :root[data-theme="light"], .theme-light */
  color-scheme: light;
  --bg: oklch(0.975 0.005 250); --surface: oklch(0.995 0.002 250); --raised: oklch(0.955 0.008 250);
  --glass: oklch(0.99 0.004 250 / 0.74); --glass-strong: oklch(0.99 0.004 250 / 0.9);
  --veil: linear-gradient(180deg, oklch(1 0 0 / 0.75), oklch(1 0 0 / 0.25) 56px, oklch(1 0 0 / 0.15));
  --edge: oklch(0.25 0.06 260 / 0.12); --edge-light: inset 0 1px 0 0 oklch(1 0 0 / 0.95);
  --text: oklch(0.25 0.06 260); --muted: oklch(0.49 0.035 258); --faint: oklch(0.66 0.02 255);
  --border: oklch(0.25 0.06 260 / 0.1); --border-strong: oklch(0.25 0.06 260 / 0.18); --hover: oklch(0.25 0.06 260 / 0.045);
  --accent: oklch(0.49 0.095 228); --accent-hover: oklch(0.43 0.095 228); --accent-fg: oklch(0.99 0.004 250);
  --accent-soft: oklch(0.49 0.095 228 / 0.1); --accent-line: oklch(0.49 0.095 228 / 0.45);
  --glow: 0 0 0 1px oklch(0.49 0.095 228 / 0.7), 0 0 0 4px oklch(0.49 0.095 228 / 0.15);
  --danger: oklch(0.51 0.19 25); --danger-soft: oklch(0.55 0.19 25 / 0.1);
  --scrim: oklch(0.25 0.06 260 / 0.14); --shade: 0 18px 44px -14px oklch(0.25 0.06 260 / 0.25), 0 2px 6px -2px oklch(0.25 0.06 260 / 0.08);
  --kbd: oklch(0.25 0.06 260 / 0.05); --kbd-edge: oklch(0.25 0.06 260 / 0.16); --kbd-on-accent: oklch(1 0 0 / 0.18);
  --tint: 16%;
  --hue-rose: oklch(0.55 0.19 25); --hue-orange: oklch(0.6 0.15 50); --hue-amber: oklch(0.62 0.13 75);
  --hue-jade: oklch(0.55 0.11 165); --hue-lilac: oklch(0.52 0.15 295); --hue-slate: oklch(0.5 0.06 250);
  --st-backlog: oklch(0.6 0.02 255); --st-unstarted: oklch(0.45 0.025 255); --st-canceled: oklch(0.6 0.02 255);
  --pr-medium: oklch(0.42 0.03 255); --pr-low: oklch(0.58 0.02 255); --pr-none: oklch(0.64 0.015 255);
  --atmo: radial-gradient(90% 55% at 50% -12%, oklch(0.85 0.06 218 / 0.32), transparent 70%);

/* Aliase, in jedem Theme-Bereich neu aufgelöst */
:root, .theme-dark, .theme-light {
  --st-started: var(--hue-amber); --st-completed: var(--hue-jade);
  --pr-urgent: var(--hue-rose); --pr-high: var(--hue-orange);
  --ty-task: var(--hue-slate); --ty-bug: var(--hue-rose); --ty-epic: var(--hue-lilac);
}
/* themeunabhängig */
:root {
  --font-ui: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --r-sm: 4px; --r-md: 6px; --r-lg: 8px;
  --blur: 20px; --dur: 120ms; --ease: cubic-bezier(0.2, 0, 0, 1);
}
```

In `tailwind.config` sind diese Variablen die einzigen Farben (`theme.colors` ohne die Tailwind-Palette), dazu `fontSize`, `borderRadius` und `boxShadow` als feste Skalen. Avatar- und Label-Flächen mischen den Farbton in die Fläche: `color-mix(in oklch, var(--hue-…) var(--tint), var(--surface))`.

**Bedeutungsfarben**

| Gruppe | Token | Werte |
|---|---|---|
| Status-Kategorien | `--st-backlog`, `--st-unstarted`, `--st-started`, `--st-completed`, `--st-canceled` | Backlog (gestrichelter Kreis), Todo (Kreis), In Progress (halb gefüllt) und Pending (Pause) in Bernstein, Done (Haken) in Jade, Cancelled (Kreuz) |
| Prioritäten | `--pr-urgent` … `--pr-none` | Urgent Rosé mit Achteck-Warnung, High Orange mit 3 Balken, Medium, Low und None in Grautönen mit 2, 1 Balken bzw. drei Punkten |
| Typen | `--ty-task`, `--ty-bug`, `--ty-epic` | Task Schiefer (Haken im Quadrat), Bug Rosé (Käfer), Epic Flieder (Blitz) |
| Labels und Dropdown-Optionen | `--hue-*` | Rosé, Orange, Bernstein, Jade, Flieder, Schiefer; Gletscher ist für Labels gesperrt |

Bedeutung hängt nie nur an der Farbe: Jeder Status, jede Priorität und jeder Typ hat ein eigenes Lucide-Icon, im Text immer mit Namen.

## Typo-Regeln

- **UI:** IBM Plex Sans 400, 500 und 600. **Mono:** IBM Plex Mono 400 und 500, nur für Keys (`WEB-47`), Kürzel, Daten, Uhrzeiten und Zahlen. Mono nie für Labels oder Fließtext.
- **Skala** (Größe/Zeilenhöhe in px): 11/16 kbd und Mikro, 12/16 Meta und Chips, **13/20 UI-Grundtext**, 14/22 Lesetext (Beschreibung, Kommentare), 16/24 Panel-Titel, 20/28 Abschnitte, 28/34 Seitentitel.
- **Gewichte:** 400 Text, 500 Labels und Buttons, 600 Titel. Kein 700.
- Satzschreibung, keine Versalien-Labels, kein Sperrsatz. Lesetext höchstens 65ch breit.
- Zahlen tabellarisch, Datum deutsch: `28.10.2026`, auf Karten kurz `31.10.`.

## Abstände, Radien, Elevation

- **Abstände:** ein 4er-Raster mit Halbstufen für Dichte: 2, 4, 6, 8, 12, 16, 24, 32, 48, 64 px (Tailwind 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16). Nichts dazwischen.
- **Zeilen:** 28 px für Menüs, Properties und die Seitenleiste; 32 px für Buttons und Eingaben; 36 px für Listenzeilen und Treffer in der Palette.
- **Radien:** 4 px für kbd, Chips und Bot-Avatare; 6 px für Bedienelemente (Buttons, Eingaben, Segmente, Menüeinträge); 8 px für Karten, Panels, Palette, Menüs und Toasts. Rund sind nur Personen-Avatare und Farbpunkte. Verschachtelt gilt: innen ≤ außen.
- **Rahmen:** 1 px, dunkel Weiß 8 % (stark 14 %), hell Tinte 10 % (stark 18 %).
- **Elevation:** Grund → Fläche (+4 % L) → Erhöht (+4 % L) → Glas. Fokus und Auswahl bekommen keinen Schatten, sondern den Gletscher-Glow. Schwebende Flächen tragen zusätzlich `--shade`, einen tiefen Tintenschatten: im Dunkeln kaum sichtbar, im Hellen weich.

## Glas-Rezept

| Teil | Dunkel | Hell |
|---|---|---|
| Schicht | `--glass`: Flächen-Ton mit 76 % Deckkraft; Panel 90 % (`--glass-strong`) | Papierweiß mit 74 %, Panel 90 % |
| Schleier | `--veil`: Weiß 6 % auf 1,5 % über die ersten 56 px | Weiß 75 % auf 25 % |
| Blur | 20 px, Sättigung 150 % | gleich |
| Kante | 1 px `--edge` (Weiß 12 %) und oben eine Lichtkante `inset 0 1px 0` Weiß 9 % | 1 px Tinte 12 %, Lichtkante Weiß 95 % |
| Hintergrund | Scrim Tinte 45 % hinter der Palette | Scrim Tinte 14 % |

Text auf Glas wurde gegen den ungünstigen Fall gerechnet (25 % heller Inhalt dahinter): Text über 11:1, gedämpfter Text über 5,5:1.

## Motion

- 120 ms, `cubic-bezier(0.2, 0, 0, 1)`, kein Overshoot. Animiert werden nur `opacity` und `transform`.
- **Animiert:** Palette, Menüs und Toasts beim Öffnen (Deckkraft und 4 px Weg), Kürzel auf Karten (Deckkraft), Switch-Knopf (Weg).
- **Sofort, ohne Übergang:** Hover, Auswahl und Fokus-Glow. Farbe und Schatten springen, die Rückmeldung bleibt unter 100 ms.
- **Nicht animiert:** Layout, Spaltenbreiten, Theme-Wechsel, Zahlen, Scrollen.
- `prefers-reduced-motion: reduce`: Es bleibt nur Deckkraft, keine Bewegung.

## Tastatur

- **kbd-Chip:** Mono 11 px, 20 px hoch, Radius 4, Fläche Weiß 6 %, Kante Weiß 13 % (hell Tinte 5 % und 16 %). Auf der Primärfarbe wird er zur getönten Fläche ohne Kante.
- Kürzel stehen rechts im Element: Button, Menüeintrag, Treffer in der Palette, Property-Zeile. In Hinweistexten stehen sie inline.
- Karten zeigen beim Hover und Fokus `↵ S A`. Die Seitenleiste zeigt `G I`, `G M`, `G V` und `G P`.
- **Fokus:** 2 px Gletscher-Outline mit 2 px Abstand. Karten, Eingaben und die aktive Auswahl bekommen zusätzlich den Glow.
- **Touch:** Bei `pointer: coarse` wachsen Buttons, Eingaben, Segmente, Listenzeilen, Menüeinträge und Optionen auf 44 px. Der Schlüsselbildschirm bleibt ein Desktop-Ausschnitt und scrollt am Handy seitlich.

## No-Gos

- Die verbotenen Defaults aus der Richtungsreferenz: Inter, Roboto, Arial, Helvetica, Space Grotesk, Open Sans, Lato, Montserrat, Poppins, Nunito, Raleway, `system-ui` als einzige Angabe, Tailwind `font-sans` unverändert.
- Reines Schwarz oder Weiß als Text, Neon-Grün, Zinnober, „fast Schwarz plus ein greller Akzent“.
- Ein zweiter Akzent; Gletscherblau für irgendetwas anderes als Fokus, Auswahl, Primäraktion, heute, Zähler und Erwähnungen von mir.
- Glas auf ruhigen Flächen (Board, Liste, Tabelle) und Lesetext auf Glas unter 90 % Deckkraft.
- Gestapelte Tailwind-Schatten, gemischte Radien, Versalien-Labels mit Sperrung, Mono für Labels.
- Bewegung über 120 ms, Overshoot, Dauer-Animationen, `transition: all`, animierte Farben oder Schatten.
- Emoji als Icons. Emoji gibt es nur, wo Nutzer sie setzen (Reaktionen, Seitentitel).

## Entscheidungen

- 2026-10-28: Grund ist tiefe Tinte `oklch(0.19 0.035 257)` statt Schwarz. Sie trägt Blau, damit Glas und Gletscherakzent zusammengehören.
- 2026-10-28: Der Akzent ist im Hellen tiefer (`oklch(0.49 0.095 228)`), damit Text, Erwähnungen und Zähler auf Papierweiß und auf der Akzent-Tönung AA schaffen. Gefährlich ist im Hellen aus demselben Grund `oklch(0.51 0.19 25)`.
- 2026-10-28: Fortschritt zeigt Jade, die Farbe der Kategorie Completed: Der gefüllte Teil sind die erledigten Kinder. Der Akzent bleibt für Fokus und Auswahl frei.
- 2026-10-28: Bots sind eckig (Radius 4) mit Bot-Zeichen, Personen rund. „Automation“ zeigt das Bot-Icon, „Kira“ ihr Initial mit einem Funken-Abzeichen als Agent.
- 2026-10-28: In der Liste stehen Kind-Items unter ihrem Eltern-Item, auch wenn ihr Status zu einer anderen Gruppe gehört. Ihr Chip zeigt den eigenen Status.
- 2026-10-28: Die Tailwind-Palette ist abgeschaltet (`theme.colors` enthält nur Tokens), wie die Spec es für die App vorsieht.
- 2026-10-28: Farben und Schatten wechseln ohne Übergang (Review-Regel „nur `transform` und `opacity` animieren“). Die 120 ms gelten für Deckkraft und Weg.
- 2026-10-28: Das Item-Panel liegt als Glas rechts über dem Board. Solange es offen ist, rücken Kopf- und Filterleiste zur Seite, und die Layout-Segmente zeigen nur Icon und Ziffer. `Esc` schließt erst die Palette, dann das Panel.
- 2026-10-28: Der Kommentar-Editor steht am Ende der Aktivität und sendet mit `⌘↵`. Er ist kein festes Element am Panelrand, damit Kommentar und Reaktion sichtbar bleiben.
- 2026-10-28: In der Timeline steht das Datum im Balken in voller Textfarbe (gedämpft war es auf der Fortschrittsfüllung unter AA), die Prozentzahl rechts neben dem Balken. „Heute“ hängt links an der Linie, damit es die Monatsnamen nicht verdeckt.
- 2026-10-28: Fehler stehen direkt am Feld: rote Kante, Icon und ein Satz mit dem erwarteten Format, verbunden über `aria-invalid` und `aria-describedby`.
