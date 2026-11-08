/*
 * What a move of a card does once the board's rules allow it (`checkMove`, `nearestAllowed` in `domain/boardRules.ts`):
 * a status change goes out as a transition, a move into Completed or Canceled first asks for the resolution
 * (`askResolution`, the shell's dialog), a priority or assignee column changes the field. Both mutations are optimistic
 * (`useItemMutation`): the card stands in its new column at once and the counts follow (`placeItems`); a refusal of the
 * server puts it back and says why in the hook's toast.
 *
 * The sentence of a refusal of the rules is `items.board.reason.<code>` (`reasonText`), or the finished sentence of the
 * permissions.
 */

import { askResolution } from '@/components/fields/ItemDialogs';
import type { BoardReason, MoveCheck } from '@/domain/boardRules';
import type { useTransitionWorkItem, useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import type { ListedItem, State } from '@/types';

/** The parameters that name a status: one the rules do not know (empty) reads as an unknown status. */
const STATE_PARAMS = ['from', 'initial'];

/** The sentence of a refusal, for the toast, the status line and the drag's announcement. */
export function reasonText(reason: BoardReason): string {
  if ('sentence' in reason) return reason.sentence;
  const params = { ...reason.params };
  for (const key of STATE_PARAMS) if (params[key] === '') params[key] = t('items.group.unknown.state');
  return t(`items.board.reason.${reason.code}`, params);
}

export interface MoveDeps {
  transition: Pick<ReturnType<typeof useTransitionWorkItem>, 'mutateAsync'>;
  update: Pick<ReturnType<typeof useUpdateWorkItem>, 'mutateAsync'>;
  /** The status the item stands in now: the question of the resolution starts from its category and resolution. */
  from?: State;
  /** The move goes out now (after the resolution was chosen): the board follows the card with the focus. */
  onSend?: () => void;
}

/**
 * Sends a move the rules allowed. Resolves `true` once the server took it, `false` when the server refused it (the
 * mutation put the card back and said why) or the question of the resolution was cancelled (nothing went out).
 */
export function applyMove(item: ListedItem, check: Extract<MoveCheck, { ok: true }>, deps: MoveDeps): Promise<boolean> {
  const { state_id, ...fields } = check.patch;
  const send = (call: () => Promise<unknown>) => {
    deps.onSend?.();
    return call().then(
      () => true,
      () => false,
    );
  };

  if (state_id !== undefined) {
    const move = (resolutionId?: string | null) =>
      send(() => deps.transition.mutateAsync({ id: item.id, to_state_id: state_id, ...(resolutionId !== undefined && { resolution_id: resolutionId }) }));
    const target = check.closing;
    if (!target) return move();
    const { from } = deps;
    return new Promise((resolve) =>
      askResolution({
        subject: item.key,
        target,
        from: from && { category: from.category, resolutionId: item.resolution_id },
        onConfirm: (resolutionId) => void move(resolutionId).then(resolve),
        onCancel: () => resolve(false),
      }),
    );
  }
  return send(() => deps.update.mutateAsync({ id: item.id, patch: fields }));
}
