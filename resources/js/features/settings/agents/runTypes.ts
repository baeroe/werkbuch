/*
 * The kinds of run as the settings of the agents name them (spec 7.1): the name is the one of the runner cards, the hint
 * says in a sentence what the kind is for.
 */

import { t, type TranslationKey } from '@/lib/i18n';
import type { RunType } from '@/types';
import { runName } from '../org/runners/runnerParts';

const HINTS: Record<RunType, TranslationKey> = {
  task: 'settings.agents.run_hint.task',
  correction: 'settings.agents.run_hint.correction',
  conflict: 'settings.agents.run_hint.conflict',
  review: 'settings.agents.run_hint.review',
  comment: 'settings.agents.run_hint.comment',
};

export { runName };

/** What a kind of run is for, in one sentence. */
export const runHint = (type: RunType): string => t(HINTS[type]);
