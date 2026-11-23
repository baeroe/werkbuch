/*
 * The working rules werkbuch ships per kind of run (spec 7.3, layer 2), in the language of the organisation. A project
 * without a text of its own uses these; "Standard wiederherstellen" goes back to them. The contract (layer 1: output
 * format, what is never allowed) is fixed in code and not shown here; the rules of the code live in the repo
 * (`CLAUDE.md`, `AGENTS.md`, layer 3).
 */

import type { RunType } from '@/types';

export const DEFAULT_RULES: Record<RunType, string> = {
  task: `## Umsetzen

1. Lies das Item mit \`werkbuch_work-items get\`, auch Beschreibung, Kommentare und verknüpfte Wiki-Seiten.
2. Arbeite im gegebenen Worktree und halte dich an \`CLAUDE.md\` bzw. \`AGENTS.md\` des Repos.
3. Schreib zuerst einen Test, der das gewünschte Verhalten zeigt, dann die Umsetzung.
4. Lass die Tests laufen, die die Änderung betreffen. Rot gepusht wird nicht.
5. Committe in kleinen Schritten (Conventional Commits) und pushe den Branch.
6. Öffne den PR: Titel mit dem Key, im Body \`Fixes KEY-n\`, was sich ändert und wie du geprüft hast.
7. Hat das Projekt die Property „Lösung“, setze dort den Nachweis: Vorher, Jetzt, wie geprüft, mindestens ein Bild.`,
  correction: `## Korrektur

1. Lies die Befunde: den Auszug aus dem CI-Log, die Befunde des Reviews oder die Kommentare seit dem letzten Auftrag.
2. Arbeite jeden Befund ab; widersprich nur mit einer Begründung im PR.
3. Pushe auf denselben Branch, kein Force-Push.
4. Passe den Nachweis in „Lösung“ an den neuen Stand an.`,
  conflict: `## Konflikt lösen

1. Merge die Basis in den Branch (kein Rebase, kein Force-Push).
2. Löse jeden Konflikt so, dass beide Seiten erhalten bleiben. Im Zweifel gewinnt die Basis, und du schreibst es in den PR.
3. Lass die Tests laufen, die die Dateien der Konflikte betreffen, und pushe.`,
  review: `## Review

- Prüfe unvoreingenommen: nur das Ziel des Tickets und der PR, nicht die Umsetzung, die du vielleicht kennst.
- Achte auf Regressionen, Tests, die nur die Umsetzung spiegeln, Barrierefreiheit, Doku und die Abnahme des Tickets.
- Jeder Befund mit \`datei:zeile\`, Problem und Vorschlag, nach Schwere.
- Keine Tests gegen die Datenbank; du liest nur.`,
  comment: `## Antwort

- Antworte kurz und direkt auf die Frage.
- Nutze Wiki, Items und Code des Projekts und nenne die Quellen (Seite, Key, \`datei:zeile\`).
- Weißt du etwas nicht sicher, sag es.`,
};
