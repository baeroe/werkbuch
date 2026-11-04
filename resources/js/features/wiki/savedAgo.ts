/*
 * How long ago a wiki page was saved, in words of the page's language: "vor wenigen Sekunden", "vor 5 Minuten"
 * ("a few seconds ago", "5 minutes ago"; Intl). The save state beside it says "Gespeichert".
 */

import { intlLocale, t } from '@/lib/i18n';

/** How long ago `savedAt` was at `at`; a clock ahead never speaks of the future. */
export function savedAgo(savedAt: Date, at: Date): string {
  const seconds = Math.max(0, Math.round((at.getTime() - savedAt.getTime()) / 1000));
  if (seconds < 45) return t('wiki.save.just_now');
  const relative = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'always' });
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return relative.format(-Math.round(hours / 24), 'day');
}
