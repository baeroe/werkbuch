/*
 * The save state of a wiki page in words: "Gespeichert vor wenigen Sekunden", "Gespeichert vor 5 Minuten" (Intl).
 */

const RELATIVE = new Intl.RelativeTimeFormat('de-DE', { numeric: 'always' });

/** How long ago `savedAt` was at `at`, as the page shows it. */
export function savedAgo(savedAt: Date, at: Date): string {
  const seconds = Math.max(0, Math.round((at.getTime() - savedAt.getTime()) / 1000));
  if (seconds < 45) return 'Gespeichert vor wenigen Sekunden';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `Gespeichert ${RELATIVE.format(-minutes, 'minute')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Gespeichert ${RELATIVE.format(-hours, 'hour')}`;
  return `Gespeichert ${RELATIVE.format(-Math.round(hours / 24), 'day')}`;
}
