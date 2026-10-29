# Klickdummy: Entscheidungen während der Umsetzung

Plan: `2026-10-28-werkbuch-clickdummy.md` · Spec: `../specs/2026-10-28-werkbuch-design.md`

Der Plan lief über Subagents, ohne bei jeder Unklarheit zu warten. Konflikte, Lücken im Plan und Abwägungen hat Claude als Controller selbst entschieden. Hier steht jede dieser Entscheidungen (R1, R2, …) mit Grund und dem, was sie kostet, falls sie falsch ist. Das README des Klickdummys verweist mit diesen Nummern hierher. Was davon die Oberfläche betrifft, steht dort auch unter „Abweichungen von der Spec“ und „Fragen für die Korrekturrunde“.

## Für die Korrekturrunde wichtig

- **R6 · Aufwand bei Bugs.** Typ Bug hat die optionale Property „Aufwand (h)“, damit WEB-47 (Bug, Aufwand 3,5) zum Moodboard passt. *Grund:* fehlte in der Typ-Tabelle des Plans. *Falls falsch:* nichts.
- **R12 · Fehler-Toasts.** „Erneut versuchen“ gibt es nur bei 5xx oder ohne Antwort. Ein 409 mit aktuellem Stand zeigt das Konflikt-Banner statt eines Toasts. *Grund:* Eine Ablehnung zu wiederholen hilft nicht. *Falls falsch:* manchen Ablehnungen fehlt der Knopf.
- **R13 · Favoriten.** Maras Favoriten enthalten neben den drei Views auch die drei Projekte. *Grund:* Spec 4.4 kennt Favoriten für beides, die Seitenleiste wäre sonst leer. *Falls falsch:* nichts.
- **R14 · Esc in der Vorschau.** Esc in einem Feld verlässt erst das Feld, das zweite Esc schließt die Vorschau. *Grund:* Sonst gehen Entwürfe mit einem Tastendruck verloren. *Falls falsch:* ein Tastendruck mehr.
- **R17 · Rich-Text in Listen.** Rich-Text-Properties lassen sich in Listen und Formularen nur als schlichte Absätze bearbeiten; reichere Dokumente stehen schreibgeschützt mit „Im Editor bearbeiten“. *Grund:* Eine schlichte Textarea hätte Formatierung zerstört. *Falls falsch:* manche Properties nur im Editor bearbeitbar.
- **R20 · Inbox.** Öffnen markiert eine Benachrichtigung nicht als gelesen, weil es kein „als ungelesen markieren“ gibt und ein versehentliches Enter sonst endgültig wäre. „Alle als gelesen“ wirkt global, die Inbox zeigt die neuesten 50 ohne Blättern. Steht als Frage im README. *Falls falsch:* kleine Änderung.
- **R21 · Kind-Items.** Kinder stehen nur in ihrer eigenen Statusgruppe, anders als im Moodboard (WEB-42 und WEB-48 unter WEB-30). *Grund:* So stimmen die Zähler. Steht als Frage im README. *Falls falsch:* Gruppierung umbauen.
- **R23 · Labels.** Labels haben keine Standard-Markierung. *Grund:* Die Zeile im Plan war falsch, Spec 4.7 kennt kein solches Merkmal. *Falls falsch:* später ergänzen.
- **R32 · Task 13 geteilt.** 13a (gemeinsame Schicht, Fake-API, sichtbare Fehler, Syntax-Hervorhebung) und 13d (Flows, Review-Build, README) sind fertig. 13b (Aufräumen, Dateien teilen) und 13c (restlicher Feinschliff) kommen nach der Korrekturrunde, weil die Korrekturen diese Bildschirme ohnehin ändern. Die Liste steht in `2026-10-28-werkbuch-clickdummy-deferred.md`. *Falls falsch:* Feinschliff kommt später, keine fachliche Lücke.
- **R33 · Wer Items übernehmen kann.** Übernehmen und erwähnt werden können Mitglieder des Projekts und Org-Admins (Personen) sowie Bots, die Mitglied sind; der Standard-Bot nur als ausdrückliches Mitglied. Fake-API und Auswahllisten folgen derselben Regel. *Grund:* Spec 4.8 „Zugriff“ war für Leser öffentlicher Projekte mehrdeutig. *Falls falsch:* später erweitern.
- **R34 · Virtualisierung.** Board und Timeline sind nicht virtualisiert (Guideline-Regel ab 50 Items), Liste und Tabelle schon. Kommt in 13c. *Grund:* Der Seed bleibt weit unter 100 Items pro Ansicht, und die Korrekturrunde baut diese Layouts ohnehin um. *Falls falsch:* langsames Rendern mit großen Demo-Daten bis 13c.

## Ablauf und Technik

- **R1 · Parallele Wellen.** Die Tasks der Wellen A (6, 8, 9, 11, 12) und B (7, 10) liefen parallel in eigenen Git-Worktrees und wurden nach bestandenem Review in `feat/clickdummy` gemergt. *Grund:* Parallele Wellen waren freigegeben, der Plan trennt die Dateien. *Falls falsch:* Merge-Konflikte, etwas Nacharbeit.
- **R2 · Fixtures.** Task 2 exportiert die Zeitplan-, Workflow- und Resolution-Fixtures aus `src/domain/fixtures.ts`, Task 10 nutzt sie. *Grund:* Lücke im Plan. *Falls falsch:* nichts.
- **R3 · Seed für den Bulk-Test.** Der Seed hat je ein APP-Item in `app_review` und `app_todo`. *Grund:* vom Test vorausgesetzt. *Falls falsch:* nichts.
- **R4 · Kleine Aufträge.** Implementer und Reviewer bekommen den Kopf des Plans statt des ganzen Plans. *Falls falsch:* nichts.
- **R5 · Keine neuen Abhängigkeiten in den Feature-Tasks.** Was fehlte, kam in Task 13. *Grund:* `pnpm-lock.yaml` bleibt über parallele Worktrees konfliktfrei. *Falls falsch:* ein Feature wartet auf Task 13.
- **R7 · Commit-Trailer.** Subagents nennen im Co-Authored-By-Trailer ihr tatsächliches Modell; ältere Commits bleiben, wie sie sind. *Falls falsch:* uneinheitliche Trailer.
- **R8 · Nachholen begrenzt.** `missedRunToCatchUp` hat einen optionalen Parameter `runCount`, damit „endet nach N Läufen“ auch das Nachholen begrenzt. *Falls falsch:* nichts.
- **R9 · Filter „blockiert andere“.** Eigenes Filterfeld `blocking`. *Grund:* Spec 4.11 nennt beide Richtungen, der Plan nur eine. *Falls falsch:* ein ungenutztes Feld.
- **R10 · Zeitzone im Filter.** „Heute“ und Zeitstempel zählen nach dem Tag der Organisation (Fallback UTC). *Grund:* Spec legt „heute“ in die Zeit der Organisation. *Falls falsch:* nichts.
- **R11 · Uhr früher.** `src/lib/clock.ts` entstand in Task 3 statt Task 4, weil die Fake-API sie zuerst brauchte. *Falls falsch:* nichts.
- **R15, R16 · Mängel der gemeinsamen Schicht sofort behoben.** Kleinere Befunde aus Task 4 und 5 (u. a. Tastenwiederholung, Safari-IME, englische Fehlertexte, „Neues Item“ ohne Recht, modale Vorschau auf dem Handy, Kalender als Dialog-Ebene) kamen in deren Fix-Runde statt in Task 13. *Grund:* Sonst hätten fünf parallele Tasks auf den Fehlern aufgebaut. *Falls falsch:* längere Fix-Runden.
- **R18 · Eine Instanz für Item-Befehle.** Die Vorschau und die Listen haben je eine Instanz von `useItemCommands`, Board und Timeline keine eigene. Ziel eines Befehls: Fokus in der Vorschau, sonst Auswahl, dann Cursor, dann Vorschau. *Falls falsch:* doppelte oder fehlende Kürzel.
- **R19 · Cursor aus Board und Timeline.** `LayoutProps` meldet den Cursor (`cursorId`, `onCursor`) an diese Instanz. *Falls falsch:* Task 7 passt sich an.
- **R22, R24, R25, R28, R31, R35 · Gleich mit behoben.** Kleine, geprüfte Fehler kamen in die laufende Fix-Runde statt auf die Liste: Textmarker beim Live-Aufblitzen, verlorener Ablehnungs-Toast, mod+Enter in der Übergangsmatrix unter Windows/Linux, Verlassen-Schutz nach dem Löschen, doppeltes Speichern von Automatisierungen, Datenverlust bei Rich-Text-Properties und Konflikt-Entwürfen, Ansage des Speicherstands, Plural „1 Unterseiten“, Basisversion nach „Neu laden“, Entwürfe über „Als … ansehen“; in 13d die Kleinigkeiten aus dem Review (Fokus beim Ersetzen eines Fehler-Toasts, Feldnamen, getrennte E2E-Läufe, gemeinsame Test-Helfer). *Falls falsch:* längere Fix-Runden.
- **R36 · README des Klickdummys auf Deutsch.** Es ist Arbeitsdokument für die Korrekturrunde wie Spec und Plan; „README auf Englisch“ in `CLAUDE.md` meint das README des Repos. *Falls falsch:* rund 275 Zeilen übersetzen.
- **R26 · Doppelter Code in den Einstellungen.** Rahmen, Verlassen-Schutz, Status-Zuordnung, Zeitzonen und Entfernen-Helfer gibt es in Organisations- und Projekt-Einstellungen doppelt; 13b führt sie zusammen. *Grund:* Preis der parallelen Wellen. *Falls falsch:* mehr Arbeit in 13b.
- **R27 · Syntax-Hervorhebung in 13a.** lowlight kam erst mit Task 13a, weil Feature-Tasks keine Abhängigkeiten hinzufügen durften. *Falls falsch:* nichts.
- **R29 · Lokaler Schutz gegen veraltete Saves.** Die Felder speichern neueren Text nach einem veralteten Wiederholversuch erneut. 13b ersetzt das durch einen Retry in der gemeinsamen Mutation. *Falls falsch:* kurz veralteter Text auf dem Server.
- **R30 · Board-Befehle in der Palette.** Gruppe „Board“ mit „Karte nach oben/unten“ (⌥↑/⌥↓) ist erlaubt; R18 verbietet nur doppelte Item-Befehle. *Falls falsch:* später ein Kartenmenü.
