/*
 * Seed: comments, history and attachments of 15 items, and who watches which item. Comments and events are the
 * activity of an item; the history of WEB-47 is the one of the moodboard (priority raised by Ida, assignee set by
 * the default bot when Jonas started the item, Mara's comment with two thumbs up).
 */

import { mentionedIds } from '@/lib/richtext';
import type { Attachment, Comment, ItemEvent, WorkItem } from '@/types';
import { HERO_PNG, OUTLINE_PDF, POSTFIX_TXT } from './files';
import { at, rt, USER_IDS, type UserShort } from './helpers';
import { itemId } from './items';

const PROJECT_OF: Record<string, string> = { WEB: 'p_web', APP: 'p_app', OPS: 'p_ops' };

function comment(id: string, itemKey: string, author: UserShort, when: string, text: string, reactions: { emoji: string; users: UserShort[] }[] = []): Comment {
  return {
    id,
    work_item_id: itemId(itemKey),
    author_id: USER_IDS[author],
    body: rt(text),
    created_at: at(when),
    edited_at: null,
    reactions: reactions.map(({ emoji, users }) => ({ emoji, user_ids: users.map((user) => USER_IDS[user]) })),
  };
}

type Changes = Record<string, { old: unknown; new: unknown }>;

function event(id: string, type: string, itemKey: string, actor: UserShort, when: string, changes: Changes, reason: string | null = null, seconds = 0): ItemEvent {
  return {
    id,
    type,
    actor_id: USER_IDS[actor],
    subject: { type: 'work_item', id: itemId(itemKey) },
    project_id: PROJECT_OF[itemKey.split('-')[0]],
    changes,
    reason,
    occurred_at: at(when, seconds),
  };
}

const state = (from: string, to: string): Changes => ({ state_id: { old: from, new: to } });
const closing = (from: string, to: string): Changes => ({ ...state(from, to), resolution_id: { old: null, new: 'res_done' } });

export const comments: Comment[] = [
  comment('c_web47_1', 'WEB-47', 'mara', '10-27 14:42', 'Kann ich reproduzieren, nur unter iOS 18.', [{ emoji: '👍', users: ['ida', 'jonas'] }]),
  comment('c_web47_2', 'WEB-47', 'jonas', '10-28 08:50', 'Ich schaue mir den Submit-Handler an. Vermutlich feuert das Formular-Plugin zweimal.'),
  comment('c_web42_1', 'WEB-42', 'ida', '10-28 08:40', 'Hero-Entwurf ist drin, die Teaser kommen heute Nachmittag. @mara kannst du die Texte kurz gegenlesen?'),
  comment('c_web42_2', 'WEB-42', 'lene', '10-28 09:05', 'Die Bildzuschnitte für Mobil schicke ich dir bis mittags.', [{ emoji: '🙌', users: ['ida'] }]),
  comment('c_web30_1', 'WEB-30', 'mara', '10-05 11:10', 'Phase 1 endet am 15.11. Danach starten wir mit den Leistungsseiten und dem Journal.'),
  comment('c_web45_1', 'WEB-45', 'ida', '10-22 09:32', 'Studio Nordlicht liefert die Texte bis Freitag nach. Ohne sie kann ich die Leistungsseiten nicht befüllen.'),
  comment('c_web45_2', 'WEB-45', 'mara', '10-27 15:00', 'Ich erinnere den Kunden morgen noch einmal.'),
  comment('c_web48_1', 'WEB-48', 'lene', '10-27 16:30', 'Burger-Menü oder Tab-Leiste? Ich skizziere beides bis Donnerstag.'),
  comment('c_web41_1', 'WEB-41', 'ida', '10-27 11:00', 'Hängt an den neuen Angaben zur Geschäftsführung. Ich habe heute noch einmal nachgefragt.'),
  comment('c_web39_1', 'WEB-39', 'jonas', '10-27 16:25', 'Umzug ist durch. Die TTL war vorher gesenkt, die alte Instanz bleibt noch eine Woche als Fallback.', [{ emoji: '🎉', users: ['mara', 'ida', 'lene'] }]),
  comment('c_web40_1', 'WEB-40', 'lene', '10-23 14:12', 'Es fehlte das apple-touch-icon. Ist ergänzt und in Safari geprüft.'),
  comment('c_ops12_1', 'OPS-12', 'kira', '10-26 15:30', 'Postfix erlaubt aktuell 100 Mails pro Stunde. Die Formularmails und der Wochenreport reichen damit nicht.'),
  comment('c_ops12_2', 'OPS-12', 'jonas', '10-26 16:30', 'Setze ich um, sobald das Wartungsfenster steht.'),
  comment('c_ops3_1', 'OPS-3', 'jonas', '10-26 17:00', 'Fehlt nur noch das Mail-Limit (OPS-12). @mara das Wartungsfenster für die alten Server brauche ich noch von dir.'),
  comment('c_app5_1', 'APP-5', 'theo', '10-20 09:10', 'Die Beta startet heute. Ziel ist eine TestFlight-Version für den Kunden bis Mitte Dezember.'),
  comment('c_app12_1', 'APP-12', 'lene', '10-27 17:10', 'Telefonnummer und Adresse sind fertig, bei der E-Mail-Adresse fehlt noch die Bestätigungsmail.'),
  comment('c_app15_1', 'APP-15', 'theo', '10-27 15:10', 'Hafenkontor möchte das bis Ende November. Wir brauchen noch das PDF-Layout vom Kunden.'),
];

export const events: ItemEvent[] = [
  // WEB-47: the history of the moodboard, oldest first
  event('ev_web47_created', 'work_item.created', 'WEB-47', 'ida', '10-20 11:30', { title: { old: null, new: 'Kontaktformular sendet doppelt' } }),
  event('ev_web47_started', 'work_item.state_changed', 'WEB-47', 'jonas', '10-27 09:15', state('std_todo', 'std_progress')),
  event('ev_web47_assigned', 'work_item.assigned', 'WEB-47', 'automation', '10-27 09:15', { assignee_id: { old: null, new: USER_IDS.jonas } }, 'Automatisierung: Assignee beim Start', 2),
  event('ev_web47_priority', 'work_item.updated', 'WEB-47', 'ida', '10-27 10:20', { priority: { old: 'high', new: 'urgent' } }),

  event('ev_web42_created', 'work_item.created', 'WEB-42', 'ida', '10-15 10:05', { title: { old: null, new: 'Startseite: Hero und Teaser bauen' } }),
  event('ev_web42_started', 'work_item.state_changed', 'WEB-42', 'ida', '10-26 10:00', state('std_todo', 'std_progress')),

  event('ev_web30_created', 'work_item.created', 'WEB-30', 'ida', '10-01 09:00', { title: { old: null, new: 'Relaunch Phase 1' } }),
  event('ev_web30_started', 'work_item.state_changed', 'WEB-30', 'ida', '10-01 10:00', state('std_backlog', 'std_progress')),

  event('ev_web45_pending', 'work_item.state_changed', 'WEB-45', 'ida', '10-22 09:30', state('std_progress', 'std_pending')),
  event('ev_web48_assigned', 'work_item.assigned', 'WEB-48', 'ida', '10-21 09:40', { assignee_id: { old: null, new: USER_IDS.lene } }),

  event('ev_web41_started', 'work_item.state_changed', 'WEB-41', 'ida', '10-22 09:45', state('std_todo', 'std_progress')),
  event('ev_web41_due', 'work_item.updated', 'WEB-41', 'ida', '10-24 12:00', { due_date: { old: '2026-10-25', new: '2026-10-27' } }),

  event('ev_web39_started', 'work_item.state_changed', 'WEB-39', 'jonas', '10-19 10:00', state('std_todo', 'std_progress')),
  event('ev_web39_done', 'work_item.state_changed', 'WEB-39', 'jonas', '10-27 16:20', closing('std_progress', 'std_done')),
  event('ev_web40_done', 'work_item.state_changed', 'WEB-40', 'lene', '10-23 14:10', closing('std_todo', 'std_done')),

  event('ev_ops12_created', 'work_item.created', 'OPS-12', 'mara', '10-20 14:00', { title: { old: null, new: 'Mail-Limits am Server erhöhen' } }),
  event('ev_ops3_started', 'work_item.state_changed', 'OPS-3', 'jonas', '09-01 09:00', state('std_backlog', 'std_progress')),
  event('ev_ops11_done', 'work_item.state_changed', 'OPS-11', 'jonas', '10-27 14:00', closing('std_progress', 'std_done')),

  event('ev_app5_created', 'work_item.created', 'APP-5', 'theo', '10-02 09:00', { title: { old: null, new: 'Kunden-App 2.0 Beta' } }),
  event('ev_app5_started', 'work_item.state_changed', 'APP-5', 'theo', '10-20 09:00', state('app_todo', 'app_progress')),
  event('ev_app12_review', 'work_item.state_changed', 'APP-12', 'lene', '10-27 17:15', state('app_progress', 'app_review')),
  event('ev_app15_created', 'work_item.created', 'APP-15', 'mara', '10-16 09:30', { title: { old: null, new: 'Bestellhistorie als PDF exportieren' } }),
  event('ev_app15_approval', 'work_item.state_changed', 'APP-15', 'theo', '10-24 10:00', state('app_review', 'app_approval')),
  event('ev_app24_assigned', 'work_item.assigned', 'APP-24', 'theo', '10-27 16:05', { assignee_id: { old: null, new: USER_IDS.mara } }),
];

export const attachments: Attachment[] = [
  { id: 'att_web42_hero', project_id: 'p_web', owner: { type: 'work_item', id: itemId('WEB-42') }, kind: 'file', ...HERO_PNG },
  { id: 'att_web45_outline', project_id: 'p_web', owner: { type: 'work_item', id: itemId('WEB-45') }, kind: 'file', ...OUTLINE_PDF },
  { id: 'att_ops12_config', project_id: 'p_ops', owner: { type: 'work_item', id: itemId('OPS-12') }, kind: 'file', ...POSTFIX_TXT },
];

/**
 * Who watches an item: its creator, its assignee, everybody who commented and everybody mentioned in the text or in
 * a comment (spec 4.10). Bots and deactivated accounts do not watch (they get no notifications).
 */
export function watchers(items: WorkItem[], inactive: ReadonlySet<string>): void {
  for (const item of items) {
    const itemComments = comments.filter((entry) => entry.work_item_id === item.id);
    const candidates = [
      item.created_by,
      item.assignee_id,
      ...itemComments.map((entry) => entry.author_id),
      ...mentionedIds(item.description),
      ...itemComments.flatMap((entry) => mentionedIds(entry.body)),
    ];
    item.subscriber_ids = [...new Set(candidates.filter((id): id is string => id !== null && !inactive.has(id)))];
  }
}
