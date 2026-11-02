/*
 * The keys of the timeline (spec 4.11: "per Tastatur verschieben die Pfeiltasten am ausgewählten Epic um eine
 * Einheit"): ⇧←/⇧→ move the epic under the cursor by one unit of the zoom (a day, a week, a month), ⌥←/⌥→ change its
 * due date. The board binds ⇧←/⇧→ as well (K20: `list.move_*`, one layout is mounted at a time); here held keys repeat,
 * the bar moves at once and its dates are saved once the keys rest.
 *
 * The four moves are also commands of the palette (WCAG 2.5.7: a way without dragging), listed while the cursor's epic
 * can go that way. The keys act only while the focus is on the timeline or nowhere in particular; a person who may not
 * change the epic hears why.
 */

import { ArrowLeftToLine, ArrowRightToLine, ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { useCommand } from '@/lib/commands';
import { t, type TranslationKey } from '@/lib/i18n';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts/catalog';
import { useShortcut } from '@/lib/shortcuts/useShortcut';

export type Nudge = 'move' | 'resize';

export interface TimelineKeyActions {
  /** The focus is on the timeline or nowhere in particular. */
  inTimeline(): boolean;
  /** One unit of the zoom: the epic under the cursor moves, or its due date does. */
  nudge(kind: Nudge, step: 1 | -1): void;
  /** Whether the cursor's epic can go that way; the palette lists only what can. */
  can(kind: Nudge, step: 1 | -1): boolean;
  /** One unit of the zoom in words („eine Woche“). */
  unit: string;
}

const MOVES: readonly { id: ShortcutId; label: TranslationKey; icon: LucideIcon; kind: Nudge; step: 1 | -1 }[] = [
  { id: 'list.move_left', label: 'items.timeline.command.earlier', icon: ChevronsLeft, kind: 'move', step: -1 },
  { id: 'list.move_right', label: 'items.timeline.command.later', icon: ChevronsRight, kind: 'move', step: 1 },
  { id: 'list.shorter', label: 'items.timeline.command.shorter', icon: ArrowLeftToLine, kind: 'resize', step: -1 },
  { id: 'list.longer', label: 'items.timeline.command.longer', icon: ArrowRightToLine, kind: 'resize', step: 1 },
];

function useMove(entry: (typeof MOVES)[number], actions: TimelineKeyActions) {
  const run = () => actions.nudge(entry.kind, entry.step);
  useShortcut(entry.id, run, { when: actions.inTimeline, repeat: true });
  // the label names the unit: a new zoom registers the command anew
  useCommand({
    id: `timeline.${entry.id}`,
    label: t(entry.label, { unit: actions.unit }),
    group: t('items.timeline.command.group'),
    keys: SHORTCUTS[entry.id].keys,
    icon: createElement(entry.icon),
    keywords: [t('items.timeline.command.keywords')],
    when: () => actions.can(entry.kind, entry.step),
    run,
  });
}

export function useTimelineKeys(actions: TimelineKeyActions): void {
  useMove(MOVES[0]!, actions);
  useMove(MOVES[1]!, actions);
  useMove(MOVES[2]!, actions);
  useMove(MOVES[3]!, actions);
}
