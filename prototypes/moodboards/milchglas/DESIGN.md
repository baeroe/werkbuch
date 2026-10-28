# Design-Richtung

**Produkt**: werkbuch, ein offenes, selbst gehostetes Projektmanagement für kleine Teams (Board, Liste, Tabelle, Timeline, Wiki), Tastatur zuerst. Dieses Moodboard ist Richtung A von drei; die gewählte Richtung wird zur `DESIGN.md` des Klickdummys.
**Modus**: Product. Dichte, Ruhe und wiederholbare Muster gehen vor großem Auftritt. Nur der Seitenkopf des Moodboards ist etwas größer gesetzt.
**Richtung**: Milchglas. Hell zuerst, luftig und freundlich. Glas ist das Markenzeichen und trägt nur die schwebenden Flächen; gelesen wird auf ruhigen Flächen mit vollem Kontrast. Die Basis ist „Soft Product UI“ aus dem Katalog (Geist/Geist Mono, neutrale Ramp mit Blaustich, ein gedeckter Akzent, 150 ms Ease-out), erweitert um Glas und eine zarte Aurora.
**Referenz**: keine. Die Richtung ist im Moodboard-Auftrag vorgegeben (`../README.md`, Spec Abschnitt 5).

## Haltung

- **Hell zuerst.** Dunkel ist die abgeleitete Variante: eine tiefe, blaugraue Nacht mit derselben, gedimmten Aurora; aus Milchglas wird Rauchglas.
- **Glas nur, wo etwas schwebt:** Seitenleiste, Seitenpanel, Befehlspalette, Menüs, Toasts. Board, Liste, Karten, Kommentare und Beschreibungen liegen auf ruhigen, deckenden Flächen.
- **Aurora als Hintergrund**, nicht als Dekoration: Mint, Himmel und Pfirsich mit wenig Chroma, sichtbar vor allem hinter Glas. Dieselben drei Töne färben Projekte, Avatare und Labels, so hängt alles zusammen.
- **Ein Akzent:** Petrol. Er steht für Auswahl, Fokus, primäre Aktion, Fortschritt und „heute“. Kein Lila, kein Indigo, keine Verläufe von Lila nach Blau.

## Tokens

Alle Farben sind CSS-Variablen (OKLCH). Hell steht auf `:root`, Dunkel unter `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` und noch einmal unter `:root[data-theme="dark"]`. Die Blöcke gelten auch für verschachtelte `[data-theme]`-Bereiche, damit die Token-Tafel beide Themes nebeneinander zeigen kann. Tailwind (v3-Play-CDN) bildet die Variablen in `tailwind.config` ab; die Tailwind-Farbpalette ist entfernt.

```css
:root, [data-theme="light"] {
  color-scheme: light;
  /* Flächen */
  --bg: oklch(0.972 0.006 245);            /* Seite, ruhig und kühl */
  --surface: oklch(0.993 0.003 245);       /* deckende Fläche für Lesetext */
  --surface-2: oklch(0.955 0.008 245);     /* Füllungen, Gruppenköpfe */
  --sheet: oklch(0.99 0.004 245 / 0.78);   /* Arbeitsfläche im App-Fenster, Aurora schimmert durch */
  --card: oklch(0.998 0.002 245);          /* Karten, Kommentare */
  --glass: oklch(0.99 0.004 245 / 0.64);   /* Milchglas: Weiß 64 % */
  --glass-strong: oklch(0.99 0.004 245 / 0.7); /* Befehlspalette: Weiß 70 % */
  --glass-line: oklch(0.42 0.03 250 / 0.14);   /* Haarlinie außen */
  --glass-edge: oklch(1 0 0 / 0.9);            /* Lichtkante oben innen */
  --glass-inner: oklch(1 0 0 / 0.4);           /* Lichtring innen */
  --scrim: oklch(0.3 0.03 250 / 0.14);
  --hover: oklch(0.42 0.03 250 / 0.07);
  /* Text und Linien */
  --text: oklch(0.25 0.025 255);
  --text-muted: oklch(0.48 0.022 255);
  --border: oklch(0.9 0.008 250);
  --border-strong: oklch(0.8 0.012 250);
  /* Akzent Petrol */
  --accent: oklch(0.5 0.085 220);
  --accent-hover: oklch(0.45 0.085 220);
  --accent-fg: oklch(0.99 0.004 220);
  --accent-soft: oklch(0.5 0.085 220 / 0.11);
  --accent-text: oklch(0.45 0.08 220);
  --accent-veil: oklch(0.2 0.05 230 / 0.22); /* kbd auf Akzentflächen */
  --focus: oklch(0.52 0.1 220);
  /* Semantik */
  --danger: oklch(0.54 0.17 25);
  --danger-hover: oklch(0.49 0.17 25);
  --danger-fg: oklch(0.99 0.004 25);
  --danger-soft: oklch(0.6 0.17 25 / 0.1);
  --danger-text: oklch(0.48 0.16 25);
  /* Aurora */
  --aurora-mint: oklch(0.9 0.055 170);
  --aurora-sky: oklch(0.88 0.055 230);
  --aurora-peach: oklch(0.91 0.055 55);
  /* Status-Kategorien */
  --st-backlog: oklch(0.6 0.012 250);
  --st-unstarted: oklch(0.5 0.02 250);
  --st-started: oklch(0.62 0.13 72);
  --st-completed: oklch(0.57 0.12 152);
  --st-canceled: oklch(0.58 0.05 20);
  /* Prioritäten */
  --pr-urgent: oklch(0.56 0.18 27);
  --pr-high: oklch(0.62 0.14 48);
  --pr-medium: oklch(0.5 0.03 250);
  --pr-low: oklch(0.6 0.02 250);
  --pr-none: oklch(0.62 0.01 250);
  /* Typen */
  --ty-task: oklch(0.55 0.07 245);
  --ty-bug: oklch(0.57 0.16 25);
  --ty-epic: oklch(0.62 0.12 80);
  /* Labels (Punkt) und Tönungen (Avatare, Projekte, Timeline) */
  --label-sky: oklch(0.6 0.1 235);
  --label-peach: oklch(0.63 0.12 52);
  --label-rose: oklch(0.6 0.14 10);
  --label-mint: oklch(0.6 0.1 170);
  --tint-sky: oklch(0.92 0.04 235);
  --tint-mint: oklch(0.92 0.045 170);
  --tint-peach: oklch(0.93 0.045 60);
  --tint-rose: oklch(0.92 0.04 10);
  --tint-sand: oklch(0.93 0.04 85);
  --tint-ink: oklch(0.3 0.03 250);
  /* Elevation, 3 Stufen, Schatten blaugrau getönt */
  --elev-1: 0 1px 2px oklch(0.35 0.04 250 / 0.07), 0 1px 1px oklch(0.35 0.04 250 / 0.04);
  --elev-2: 0 2px 6px oklch(0.35 0.04 250 / 0.06), 0 12px 32px -8px oklch(0.35 0.05 250 / 0.18);
  --elev-3: 0 6px 16px oklch(0.3 0.05 250 / 0.08), 0 32px 80px -16px oklch(0.3 0.06 250 / 0.32);
}

/* Dunkel: gleiche Namen, neu belegt */
:root[data-theme="dark"], [data-theme="dark"] {
  color-scheme: dark;
  --bg: oklch(0.19 0.018 252);
  --surface: oklch(0.225 0.018 252);
  --surface-2: oklch(0.27 0.018 252);
  --sheet: oklch(0.21 0.018 252 / 0.74);
  --card: oklch(0.255 0.018 252);
  --glass: oklch(0.22 0.02 252 / 0.6);         /* Rauchglas: Tinte 60 % */
  --glass-strong: oklch(0.22 0.02 252 / 0.66); /* Palette: Tinte 66 % */
  --glass-line: oklch(0.05 0.02 250 / 0.55);
  --glass-edge: oklch(1 0 0 / 0.12);
  --glass-inner: oklch(1 0 0 / 0.04);
  --scrim: oklch(0.08 0.02 250 / 0.45);
  --hover: oklch(0.95 0.01 250 / 0.07);
  --text: oklch(0.94 0.008 250);
  --text-muted: oklch(0.74 0.015 250);
  --border: oklch(0.95 0.01 250 / 0.1);
  --border-strong: oklch(0.95 0.01 250 / 0.2);
  --accent: oklch(0.72 0.09 210);
  --accent-hover: oklch(0.78 0.085 210);
  --accent-fg: oklch(0.2 0.03 230);
  --accent-soft: oklch(0.72 0.09 210 / 0.16);
  --accent-text: oklch(0.8 0.08 210);
  --accent-veil: oklch(0.2 0.05 230 / 0.12);
  --focus: oklch(0.76 0.09 210);
  --danger: oklch(0.68 0.16 25);
  --danger-hover: oklch(0.74 0.15 25);
  --danger-fg: oklch(0.18 0.03 25);
  --danger-soft: oklch(0.68 0.16 25 / 0.14);
  --danger-text: oklch(0.8 0.11 25);
  --aurora-mint: oklch(0.34 0.05 175);
  --aurora-sky: oklch(0.33 0.06 235);
  --aurora-peach: oklch(0.35 0.045 50);
  --st-backlog: oklch(0.6 0.012 250);
  --st-unstarted: oklch(0.74 0.02 250);
  --st-started: oklch(0.78 0.13 75);
  --st-completed: oklch(0.72 0.13 152);
  --st-canceled: oklch(0.68 0.05 20);
  --pr-urgent: oklch(0.68 0.17 27);
  --pr-high: oklch(0.74 0.13 52);
  --pr-medium: oklch(0.78 0.02 250);
  --pr-low: oklch(0.66 0.02 250);
  --pr-none: oklch(0.56 0.01 250);
  --ty-task: oklch(0.72 0.07 245);
  --ty-bug: oklch(0.7 0.15 25);
  --ty-epic: oklch(0.8 0.12 85);
  --label-sky: oklch(0.72 0.1 235);
  --label-peach: oklch(0.76 0.11 55);
  --label-rose: oklch(0.72 0.13 10);
  --label-mint: oklch(0.74 0.1 170);
  --tint-sky: oklch(0.42 0.05 235);
  --tint-mint: oklch(0.42 0.05 170);
  --tint-peach: oklch(0.44 0.05 55);
  --tint-rose: oklch(0.42 0.05 10);
  --tint-sand: oklch(0.44 0.045 85);
  --tint-ink: oklch(0.95 0.01 250);
  --elev-1: 0 1px 2px oklch(0.05 0.02 250 / 0.5), 0 1px 1px oklch(0.05 0.02 250 / 0.3);
  --elev-2: 0 2px 6px oklch(0.05 0.02 250 / 0.35), 0 12px 32px -8px oklch(0.05 0.02 250 / 0.55);
  --elev-3: 0 6px 16px oklch(0.05 0.02 250 / 0.4), 0 32px 80px -16px oklch(0.02 0.02 250 / 0.7);
}

/* Zusammengesetzt, je Theme-Bereich neu aufgelöst */
:root, [data-theme] {
  --aurora: radial-gradient(…mint links oben…), radial-gradient(…himmel rechts…), radial-gradient(…pfirsich unten…);
  --glass-shadow-1: inset 0 1px 0 var(--glass-edge), inset 0 0 0 1px var(--glass-inner), var(--elev-1);
  --glass-shadow-2: inset 0 1px 0 var(--glass-edge), inset 0 0 0 1px var(--glass-inner), var(--elev-2);
  --glass-shadow-3: inset 0 1px 0 var(--glass-edge), inset 0 0 0 1px var(--glass-inner), var(--elev-3);
}

/* Form, Typo, Motion: themeunabhängig */
:root {
  --font-ui: "Geist", ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --r-xs: 6px; --r-control: 8px; --r-card: 12px; --r-panel: 16px;
  --glass-blur: 20px;
  --dur: 150ms; --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1); --slide: 8px;
  --dur-spring: 480ms; --drop: 24px;
  --ease-spring: linear(0, 0.052, 0.176, 0.335, 0.502, 0.657, 0.79, 0.896, 0.974, 1.027, 1.058, 1.073,
                        1.075, 1.07, 1.059, 1.047, 1.034, 1.023, 1.014, 1.006, 1.001, 0.997, 0.995, 0.994, 1);
  --w-sidebar: 232px; --w-panel: 420px; --w-palette: 560px;
}
```

Die vollständigen Werte für `--aurora` stehen in `index.html`. Geprüfte Kontraste (WCAG 2, Glas im Browser-Verfahren über Aurora bzw. geblurrter Karte verrechnet): `--text` auf Flächen und Glas mindestens 13,8:1 (hell) bzw. 12:1 (dunkel); `--text-muted` auf Flächen und Glas mindestens 5,6:1, direkt auf der Aurora mindestens 4,6:1; `--accent-text` mindestens 5,1:1; Status-, Prioritäts-, Typ- und Label-Glyphen mindestens 3:1 auf Karte und Glas.

### Glas-Rezept

| | Hell | Dunkel |
|---|---|---|
| Füllung | Weiß 64 %, Palette 70 % | Tinte 60 %, Palette 66 % |
| Blur | `backdrop-filter: blur(20px) saturate(150%)` | gleich |
| Kante | 1 px Licht oben innen (`--glass-edge`), 1 px Lichtring innen (`--glass-inner`) | gleich, sehr zurückhaltend |
| Rand | 1 px Haarlinie außen (`--glass-line`) | 1 px dunkle Haarlinie |
| Schatten | Elevation-Stufe der Fläche | gleich, dunkler |

In Tailwind: `border border-glass-line bg-glass shadow-glass-2 backdrop-blur-glass backdrop-saturate-150`. Glas liegt nie in Glas. Lange Lesetexte (Kommentare) stehen auch im Glaspanel auf einer deckenden Karte.

### Elevation

| Stufe | Wo |
|---|---|
| 1 | Karten, Seitenleiste, Arbeitsfläche, Buttons |
| 2 | Seitenpanel, Menüs, offene Auswahl, Toasts, App-Fenster |
| 3 | Befehlspalette, Dialoge |

### Radien

Ein System, nach Größe der Fläche: **6** inline (kbd, Checkbox, Bot-Avatar, Projekt-Glyph, Segmente), **8** Controls (Buttons, Eingaben, Menüeinträge, Hinweise), **12** Karten, Menüs, Toasts, **16** Panels (Seitenleiste, Seitenpanel, Palette, Fenster). Rund nur für Avatare von Personen, Chips, Badges und den Switch. Verschachtelt gilt: innen = außen minus Abstand (Menü 12, Padding 4, Eintrag 8).

### Abstände

4-px-Raster, nur diese Stufen: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96. In Tailwind sind das die Standardstufen `0.5 1 1.5 2 3 4 5 6 8 10 12 16 24`. Seitenrand `max(16px, env(safe-area-inset-*))`, ab `md` 32 px.

## Typo-Regeln

- **UI: Geist** 400, 500, 600. **Mono: Geist Mono** 400, 500 für Keys wie `WEB-47`, Tastenkürzel, Zahlen, Daten und Token-Werte. Beide von Google Fonts mit echtem Fallback. Keine dritte Familie.
- Skala (Tailwind `fontSize` ersetzt, keine Zwischenwerte):

| Token | Größe/Zeile | Gewicht | Wofür |
|---|---|---|---|
| `text-2xl` | 44/48, −0,03em | 600 | Titel des Moodboards |
| `text-xl` | 28/34, −0,02em | 600 | Abschnitte |
| `text-lg` | 20/28, −0,01em | 600 | Item-Titel im Panel |
| `text-md` | 16/24 | 400 | Eingaben (nie kleiner, kein iOS-Zoom), Lead |
| `text-base` | 14/22 | 400 | Lesetext: Beschreibung, Kommentare |
| `text-sm` | 13/20 | 400, 500 | Standard der UI |
| `text-xs` | 12/16 | 400, 500 | Chips, Meta, Gruppenköpfe |
| `text-2xs` | 11/16 | 500 | kbd, Badges, Initialen |

- Gruppenköpfe in Satzschreibung, nie in Versalien. Zeilenlänge für Lesetext höchstens 65ch.
- Zahlen in Mono oder mit `tabular-nums`. Deutsche Formate: `31.10.`, `3,5`, `60 %` mit geschütztem Leerzeichen.

## Motion

- **Zustände:** 150 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)` (Ease-out). Animiert werden Farbe, Rahmen, Schatten. Nie `transition: all`.
- **Panels:** 8 px Weg plus Fade in 150 ms. Seitenpanel von rechts, Palette und Menüs von oben. Nur beim Öffnen durch eine Aktion, nicht beim Laden.
- **Feder nur beim Ziehen:** `linear()`-Feder (480 ms, 7,6 % Überschwingen) beim Ablegen einer Karte.
- **Nicht animiert:** Layout-Eigenschaften (Breite, Höhe, Position), Seitenwechsel, Laden von Listen, Dauerschleifen.
- **`prefers-reduced-motion: reduce`:** `--slide` und `--drop` werden 0; es bleibt nur Opazität.

## No-Gos

- Verbotene Fonts: Inter, Roboto, Arial, Helvetica, Space Grotesk, Open Sans, Lato, Montserrat, Poppins, Nunito, Raleway, `system-ui` als einzige Angabe, unverändertes Tailwind-`font-sans`.
- Lila oder Indigo, Verläufe von Lila nach Blau, ein zweiter Akzent.
- Glas hinter Lesetext oder Glas in Glas; Glas als Deko auf ruhigen Flächen.
- Reines Schwarz auf reinem Weiß; ungetönte Schatten (`rgba(0,0,0,.1)`); gestapelte Tailwind-Default-Schatten.
- Radien außerhalb des Systems (6/8/12/16/rund).
- Versalien-Eyebrows über Überschriften, Pfeile `→` an Link- und Buttontexten, Meta-Ketten mit Mittelpunkten.
- Emoji als Icons. Icons sind Lucide (inline, Pfade aus `lucide-static`); Emoji nur bei Reaktionen und dort, wo Nutzer sie selbst setzen.
- Echte Firmen, Kunden, Hosts oder Personen in Demo-Daten.

## Entscheidungen

- 2026-10-28: Richtung A „Milchglas“ als Moodboard angelegt. Basis „Soft Product UI“, erweitert um Glas und Aurora.
- 2026-10-28: Akzent Petrol `oklch(0.5 0.085 220)` statt Blau. Er bleibt neben dem Grün von Done und dem Rot von Bug unterscheidbar und ist weit weg von Lila.
- 2026-10-28: Prioritäten Medium, Low und None bleiben neutral (Tinte bis Grau). Nur Urgent (Rot) und High (Orange) bekommen Farbe; das hält Board und Liste ruhig.
- 2026-10-28: Die Aurora-Töne Mint, Himmel und Pfirsich färben auch Projekte, Avatare, Labels und die Timeline. So ist der Hintergrund kein Fremdkörper.
- 2026-10-28: Status-Glyphen nach Linear-Art (gestrichelt, leer, halb gefüllt, Pause, Haken, Kreuz), damit der Status nie nur an der Farbe hängt.
- 2026-10-28: Bots erkennt man am eckigen Avatar (Radius 6) mit Glyphe statt Initialen und am Zusatz „Bot“.
- 2026-10-28: Seitenpanel und Palette liegen im Schlüsselbildschirm über dem Board. Esc schließt die Palette, das Panel schließt über X; ein Klick auf WEB-47 öffnet es wieder.
- 2026-10-28 (Feedback-Loop): Seitenpanel 420 px statt 392 px, Eigenschaftszeilen 28 px. So sind Beschreibung, Bot-Eintrag, Prioritätswechsel und Kommentar mit Reaktion ohne Scrollen sichtbar.
- 2026-10-28 (Feedback-Loop): Spalten, die das offene Panel ganz verdeckt, sind solange `inert`. Der Tastaturfokus landet nie hinter Glas (WCAG 2.2, 2.4.11).
- 2026-10-28 (Feedback-Loop): Trefferflächen auf Mobile 44 px über Pseudo-Elemente (`after:-inset-*`), ohne die Größe der Controls zu ändern; Eingaben 44 px hoch bis `md`.
- 2026-10-28 (Feedback-Loop): Symboltasten (⌘ ⇧ ⌫ ↵) im `kbd` kommen aus der UI-Schrift bzw. deren Fallback, weil Geist Mono diese Glyphen nicht hat.
- 2026-10-28 (Feedback-Loop): Die Linie für heute liegt in der Timeline hinter den Balken; das Label „Heute“ sitzt unter den Monatsnamen.
