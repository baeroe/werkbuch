# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Diese Datei aktuell halten.** Wer Stack, Ablauf, Kommandos oder Konventionen ändert, passt CLAUDE.md im selben Commit an. Veraltete Angaben hier sind schlimmer als keine.

## Was werkbuch ist

Offenes, selbst gehostetes Projektmanagement-Tool: Projekte, Work Items mit eigenen Typen, Properties und Workflows, Wiki pro Projekt, teamweite Views, Vorlagen mit Zeitplan, Automatisierungen, Benachrichtigungen, Omni-Suche, REST-API, MCP und Webhooks. Betrieb wie openbill und prevju: Docker-Image `baeroe/werkbuch`, `docker compose up -d`, Doku per VitePress auf GitHub Pages.

**Spec (bindend):** `docs/superpowers/specs/2026-10-28-werkbuch-design.md`. Konzeptänderungen dort nachtragen (Abschnitt „Änderungen vom …“).

## Stand

Spec freigegeben am 2026-10-28. Es gibt noch keinen App-Code. Ablauf laut Spec, Abschnitt 11:

1. Drei Moodboards in `prototypes/moodboards/`. Erledigt: Am 2026-10-28 ist die Richtung **Werkbuch („Arbeitsheft“)** gewählt. Gestaltungsgrundlage ist `prototypes/clickdummy/DESIGN.md`; vor jeder UI-Arbeit lesen.
2. Klickdummy in `prototypes/clickdummy/` (Branch `feat/clickdummy`): steht und wartet auf Rafaels Korrekturrunde. Eigenes pnpm-Projekt mit Vite, React, Tailwind 4 und Base UI. Kommandos, Ordner, Abweichungen von der Spec und die offenen Fragen stehen in dessen `README.md`; die Komponenten-Galerie liegt unter `/_components`. Die Entscheidungen während der Umsetzung stehen in `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-rulings.md`. Nach der Korrekturrunde folgen der Spec-Nachtrag („Änderungen vom …“) und das Aufräumen (13b/13c, Liste in `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md`).
3. Umsetzung in Phasen, aber erst nach den Korrekturen am Klickdummy.
4. Manuelle Tests.
5. Release v0.1.0, nur nach Freigabe durch Rafael.

## Regeln

- Nur pnpm, nie npm oder npx; Einmal-Tools mit `pnpm dlx`.
- Git: ein Branch je Änderung (`feat/…`, `fix/…`, `docs/…`), PR gegen `main`, Conventional Commits.
- Der CI-Pflicht-Job heißt `tests` (`.github/workflows/tests.yml`). Den Namen nie ändern. Bis zur Fundament-Phase prüft er den Klickdummy (`typecheck`, `test`, `build` in `prototypes/clickdummy`). Daneben läuft `clickdummy-e2e` (Playwright: die Flows und der Review-Build); er ist kein Pflicht-Check.
- Demo- und Testdaten sind nur fiktiv (`@example.com`, ausgedachte Firmen und Personen). Keine echten Kunden, Hosts oder Firmen.
- Das README des Repos ist Englisch, die VitePress-Doku Englisch und Deutsch. Arbeitsdokumente (Spec, Pläne, README und DESIGN.md des Klickdummys) sind Deutsch.
