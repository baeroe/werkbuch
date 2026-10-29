/*
 * Building blocks of the seed data: ids of the people, local times in the organisation's zone, and small builders for
 * Tiptap documents (paragraphs, headings, lists and mention nodes, the nodes StarterKit and the mention extension
 * know). Everything is made up.
 */

import { createZone } from '@/domain/tz';
import type { RichText } from '@/types';

export const ZONE = 'Europe/Berlin';
const zone = createZone(ZONE);

/** The year the demo plays in. */
export const YEAR = 2026;

/** Short names of the people, as used in the seed tables. */
export const USER_IDS = {
  mara: 'u_mara',
  jonas: 'u_jonas',
  ida: 'u_ida',
  theo: 'u_theo',
  lene: 'u_lene',
  sven: 'u_sven',
  automation: 'u_automation',
  kira: 'u_kira',
} as const;
export type UserShort = keyof typeof USER_IDS;

/** '10-27' -> '2026-10-27'; a full date stays as it is. */
export function day(date: string): string {
  return date.length === 5 ? `${YEAR}-${date}` : date;
}

/**
 * A wall-clock time in Europe/Berlin as an ISO instant. `when` is 'MM-DD' or 'MM-DD HH:mm' (09:00 without a time).
 * `seconds` shifts it a little, for events that follow each other within a minute.
 */
export function at(when: string, seconds = 0): string {
  const [date, time = '09:00'] = when.split(' ');
  return new Date(zone.toUtc(day(date), time).getTime() + seconds * 1000).toISOString();
}

/* ---------------------------------------------------------------- rich text */

const MENTION = /(@[a-z0-9-]{3,32})/;

/** Inline nodes of a text: `@handle` becomes a mention node of a known person, the rest is text. */
function inline(text: string): RichText[] {
  return text
    .split(MENTION)
    .filter((part) => part !== '')
    .map((part): RichText => {
      const handle = part.startsWith('@') ? part.slice(1) : null;
      const id = handle && handle in USER_IDS ? USER_IDS[handle as UserShort] : null;
      return id ? { type: 'mention', attrs: { id, label: handle } } : { type: 'text', text: part };
    });
}

export const p = (text: string): RichText => ({ type: 'paragraph', content: inline(text) });
export const h = (level: 1 | 2 | 3, text: string): RichText => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const li = (text: string): RichText => ({ type: 'listItem', content: [p(text)] });
export const ul = (...items: string[]): RichText => ({ type: 'bulletList', content: items.map(li) });
export const ol = (...items: string[]): RichText => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map(li) });
export const code = (text: string): RichText => ({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text }] });
export const doc = (...blocks: RichText[]): RichText => ({ type: 'doc', content: blocks });

/** A document of paragraphs, separated by blank lines in `text`; `@handle` becomes a mention. */
export const rt = (text: string): RichText => doc(...text.split(/\n{2,}/).map(p));
