# Moodboards

Schritt 2 aus der Spec (`docs/superpowers/specs/2026-10-28-werkbuch-design.md`, Abschnitt 11). Drei Designrichtungen für werkbuch zum Vergleichen. Rafael wählt eine aus oder mischt. Die gewählte Richtung wird zur `DESIGN.md` des Klickdummys.

Jede Richtung liegt in einem eigenen Ordner mit `index.html` (eine Datei, ohne Build) und `DESIGN.md` (Tokens, Typo, Motion, No-Gos).

| Ordner | Richtung | Kurz |
|---|---|---|
| `milchglas/` | Milchglas | hell zuerst, luftig und freundlich; Glas als Markenzeichen |
| `tiefsee/` | Tiefsee | dunkel zuerst, dicht und konzentriert; dunkles Glas, Tastatur sichtbar |
| `werkbuch/` | Werkbuch | hell zuerst, handfest wie ein Arbeitsheft: Punktraster, Karteikarten, Textmarker; Glas als Transparentpapier |

## Gemeinsame Vorgaben

Diese Vorgaben stammen aus der Spec, Abschnitt 5, und gelten für alle drei Richtungen:
- **Haltung:** simpel, Tastatur zuerst, schnell, sympathisch, modern, gern glassy.
- **Glas:** nur für schwebende Flächen wie Seitenleiste, Panel, Befehlspalette, Menüs und Toasts. Lesetext steht auf ruhigen Flächen mit vollem Kontrast.
- **Product-Modus:** Das ist eine App, keine Marketingseite. Dichte, Ruhe und Wiederholbarkeit gehen vor großem Auftritt.
- **Kontraste:** WCAG 2.2 AA. Der Fokus ist sichtbar.
- **Themes:** hell und dunkel, beide gleich sorgfältig.
- **Icons:** Lucide, als Inline-SVG. Keine Emoji als Icons; Emoji gibt es nur dort, wo Nutzer sie selbst setzen (Seitentitel, Reaktionen).
- **Sprache:** UI-Texte auf Deutsch. Die Status des Standard-Workflows heißen Backlog, Todo, In Progress, Pending, Done und Cancelled.
- **Demo-Daten sind fiktiv:**
  - Projekte: WEB „Website-Relaunch“, APP „Kunden-App“, OPS „Infrastruktur“
  - Personen: Mara Lindqvist, Jonas Feld, Ida Brenner, Theo Okafor, Lene Vogt
  - Bots: „Automation“ (Standard-Bot) und „Kira“ (Agent)
  - Optionen der Property „Kunde“: Studio Nordlicht, Hafenkontor, Gärtnerei Moos

## Inhalt jeder Seite

Alle drei Seiten haben denselben Aufbau, damit man sie direkt vergleichen kann:

1. **Kopf:** Name der Richtung, 2–3 Sätze zur Haltung, 4–6 Stichworte, Schalter für hell und dunkel.
2. **Schlüsselbildschirm** (das Wichtigste, direkt unter dem Kopf):
   - **Seitenleiste:** Inbox mit Badge, Meine Items, Views (Favoriten), Projekte.
   - **Board des Projekts WEB** mit den Spalten Backlog, Todo, In Progress, Pending und Done. Jede Karte zeigt Key, Titel, Typ-Icon, Priorität, Labels, Avatar und Due-Date. Eine Karte ist „blockiert“, eine ist ein Epic mit Fortschritt.
   - **Seitenpanel eines Items** rechts:
     - Titel; Status, Assignee, Priorität, Labels, Start- und Due-Date
     - die Properties „Kunde“ (Dropdown) und „Aufwand (h)“ (Number)
     - eine Beschreibung mit @-Erwähnung und Verweis `WEB-42`
     - eine Aktivität mit Kommentar, Emoji-Reaktion und History-Einträgen, einer davon vom Bot „Automation“
   - **Befehlspalette (⌘K)** offen über allem: Eingabe, gruppierte Treffer (Aktionen, Items, Seiten), Tastaturhinweise.
3. **Zweiter Ausschnitt:** eine Liste, gruppiert nach Status, mit eingerückten Kind-Items und Inline-Chips. Dazu ein Streifen der Timeline mit drei Epics: Balken mit Fortschritt und eine Linie für heute.
4. **Tokens:**
   - Farben hell und dunkel: bg, surface, glass, text, muted, border, accent
   - die fünf Status-Kategorien, die fünf Prioritäten, die Typfarben für Task, Bug und Epic
   - Typo-Skala mit Mustern
   - Radien
   - Elevation und Glas-Rezept: Blur, Deckkraft, Kante
   - Motion: Dauern, Easing, was animiert wird
5. **Komponenten:**
   - Buttons (primär, sekundär, ghost, gefährlich; mit Kürzel), Eingabefeld, offene Auswahl
   - Chips für Status, Priorität, Label und Typ
   - Avatare: Person, und Bot mit erkennbarem Merkmal
   - `kbd`, Menü, Tooltip, Toast mit „Rückgängig“
   - Segmented Control (Liste / Board / Tabelle / Timeline), Checkbox, Switch
   - ein leerer Zustand

## Demo-Inhalt (in allen drei Richtungen gleich)

Das heutige Datum im Demo ist Mittwoch, der 28.10.2026.

**Board WEB** (Karte: Key, Typ, Titel, Priorität, Labels, Assignee, Due-Date):

| Spalte | Karten |
|---|---|
| Backlog | WEB-51 Task „Cookie-Banner auf Consent v2 umstellen“, Low · WEB-55 Task „Bildformate auf AVIF prüfen“, None |
| Todo | WEB-48 Task „Navigation für Mobilgeräte überarbeiten“, High, Label UX, Lene Vogt · WEB-50 Task „Fehlerseite 404 gestalten“, Medium |
| In Progress | WEB-30 Epic „Relaunch Phase 1“, 6/10 Kinder fertig · WEB-42 Task „Startseite: Hero und Teaser bauen“, High, Ida Brenner, fällig 30.10. · WEB-47 Bug „Kontaktformular sendet doppelt“, Urgent, Labels Formulare + Produktion, Jonas Feld, fällig 31.10., **blockiert von OPS-12** |
| Pending | WEB-45 Task „Texte der Leistungsseiten“, Medium, Kunde Studio Nordlicht, wartet auf Zulieferung |
| Done | WEB-39 Task „Domain auf neuen Server umziehen“ · WEB-40 Bug „Favicon fehlt im Safari“ |

**Seitenpanel WEB-47 „Kontaktformular sendet doppelt“:**
- **Felder:** Typ Bug, Status In Progress, Assignee Jonas Feld, Priorität Urgent, Labels Formulare und Produktion, Start 27.10., Due 31.10.
- **Properties:** Kunde Studio Nordlicht, Aufwand (h) 3,5
- **Relation:** blockiert von OPS-12 „Mail-Limits am Server erhöhen“
- **Beschreibung:** „Beim Absenden über Safari kommen zwei Mails an. @mara kannst du prüfen, ob das mit WEB-42 zusammenhängt?“
- **Aktivität:**
  - Kommentar von Mara Lindqvist: „Kann ich reproduzieren, nur unter iOS 18.“ (Reaktion 👍 2)
  - History: „Ida Brenner hat die Priorität von High auf Urgent geändert“
  - History: „Automation hat Jonas Feld als Assignee gesetzt (Assignee beim Start)“

**Befehlspalette**, Eingabe „kontakt“:
- Aktionen: „Status ändern …“ `S`, „Mir zuweisen“ `I`
- Items: WEB-47 „Kontaktformular sendet doppelt“, APP-12 „Kontaktdaten im Profil bearbeiten“
- Seiten: „Kontaktformular – Technik“ (Wiki WEB)

**Liste:** gruppiert nach Status (Todo, In Progress). WEB-30 Epic mit den eingerückten Kindern WEB-42 und WEB-48.

**Timeline** mit drei Epics:

| Epic | Zeitraum | fertig |
|---|---|---|
| WEB-30 „Relaunch Phase 1“ | 01.10.–15.11. | 60 % |
| APP-5 „Kunden-App 2.0 Beta“ | 20.10.–20.12. | 25 % |
| OPS-3 „Server-Migration“ | 01.09.–31.10. | 90 % |

**Inbox-Badge:** 3.

## Technik

Jede `index.html` ist ein Fragment, das sich auch als Artifact veröffentlichen lässt:
- **Aufbau:** kein `<!doctype>`, kein `<html>`, `<head>` oder `<body>`. Oben stehen `<title>`, `<meta name="claude:viewport-fit-sides" content="cover">` und `<style>`.
- **Laden:** Tailwind über den v3-Play-CDN, fest auf `https://cdn.tailwindcss.com/3.4.17`; Fonts von Google Fonts mit echtem Fallback. Sonst keine externen Ressourcen, JS nur Vanilla.
- **Farben:** Alle Farben sind Tokens. Hell steht auf `:root`, dunkel unter `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` und gleich noch einmal unter `:root[data-theme="dark"]`. Bei einer Richtung, die dunkel zuerst gedacht ist, ist es genau gespiegelt. `body` hat einen Hintergrund aus einem Token.
- **Ränder und Breite:**
  - Seitenrand `padding-left: max(16px, env(safe-area-inset-left, 0px))`, rechts entsprechend.
  - Der Body scrollt nie seitlich.
  - Der Schlüsselbildschirm steckt in einem eigenen Container mit `overflow-x: auto` und darf darin breiter sein.
- **Bewegung:** `prefers-reduced-motion` wird respektiert.
