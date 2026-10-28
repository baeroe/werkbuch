# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Diese Datei aktuell halten.** Wer Stack, Ablauf, Kommandos oder Konventionen ändert, passt CLAUDE.md im selben Commit an. Veraltete Angaben hier sind schlimmer als keine.

## Was werkbuch ist

Offenes, selbst gehostetes Projektmanagement-Tool: Projekte, Work Items mit eigenen Typen, Properties und Workflows, Wiki pro Projekt, teamweite Views, Vorlagen mit Zeitplan, Automatisierungen, Benachrichtigungen, Omni-Suche, REST-API, MCP und Webhooks. Betrieb wie openbill und prevju: Docker-Image `baeroe/werkbuch`, `docker compose up -d`, Doku per VitePress auf GitHub Pages.

**Spec (bindend):** `docs/superpowers/specs/2026-10-28-werkbuch-design.md`. Konzeptänderungen dort nachtragen (Abschnitt „Änderungen vom …“).

## Stand

Spec freigegeben am 2026-10-28. Es gibt noch keinen App-Code. Ablauf laut Spec, Abschnitt 11:

1. Drei Moodboards in `prototypes/moodboards/`, daraus wird `DESIGN.md`.
2. Klickdummy in `prototypes/clickdummy/`.
3. Umsetzung in Phasen, aber erst nach den Korrekturen am Klickdummy.
4. Manuelle Tests.
5. Release v0.1.0, nur nach Freigabe durch Rafael.

## Regeln

- Nur pnpm, nie npm oder npx; Einmal-Tools mit `pnpm dlx`.
- Git: ein Branch je Änderung (`feat/…`, `fix/…`, `docs/…`), PR gegen `main`, Conventional Commits.
- Der CI-Pflicht-Job heißt `tests` (`.github/workflows/tests.yml`). Den Namen nie ändern. Bis zur Fundament-Phase ist er ein Platzhalter.
- Demo- und Testdaten sind nur fiktiv (`@example.com`, ausgedachte Firmen und Personen). Keine echten Kunden, Hosts oder Firmen.
- README auf Englisch; Doku auf Englisch und Deutsch.
