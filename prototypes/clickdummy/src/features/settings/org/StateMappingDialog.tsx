/*
 * "Status ersetzen" (spec 4.5): a status that still holds items cannot just vanish. The dialog names every such status
 * with the number of items in it and asks which of the remaining statuses takes them over. The rewrite runs without
 * the transition rules and shows in the history with the name of the person who did it. Opened when saving a workflow
 * is refused with 409 `state_in_use`; "Ersetzen und speichern" saves again with the mapping.
 */

import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import type { State, StateCategory } from '@/types';
import { CATEGORY_NAMES } from './catalog';
import { counted } from './format';
import { FormDialog } from './FormDialog';

export interface AffectedState {
  state_id: string;
  name: string;
  /** How many items sit in it. */
  items: number;
  /** The category it had, to suggest a home of the same kind. */
  category: StateCategory;
}

type StateMappingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  affected: AffectedState[];
  /** The statuses that stay; one of them takes over each removed status. */
  targets: State[];
  onConfirm: (mapping: Record<string, string>) => void;
  pending?: boolean;
  /** The server's refusal of the mapping, if there was one. */
  notice?: string | null;
};

/** A home of the same category if there is one, otherwise the first status that stays. */
function suggestion(entry: AffectedState, targets: State[]): string {
  return (targets.find((target) => target.category === entry.category) ?? targets[0])?.id ?? '';
}

export function StateMappingDialog({ open, onOpenChange, workflowName, affected, targets, onConfirm, pending, notice }: StateMappingDialogProps) {
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(affected.map((entry) => [entry.state_id, suggestion(entry, targets)])));
  const total = affected.reduce((sum, entry) => sum + entry.items, 0);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Status ersetzen"
      description={`${affected.length === 1 ? 'Im gelöschten Status' : 'In den gelöschten Status'} von „${workflowName}“ ${total === 1 ? 'liegt' : 'liegen'} noch ${counted(total, 'Item', 'Items')}. Wähle, welcher Status ${total === 1 ? 'es' : 'sie'} übernimmt. Das Umschreiben ignoriert die Übergangsregeln und steht mit deinem Namen in der History.`}
      submitLabel="Ersetzen und speichern"
      pending={pending}
      notice={notice}
      onSubmit={() => onConfirm(choices)}
    >
      <ul className="flex flex-col gap-3">
        {affected.map((entry) => (
          <li key={entry.state_id} className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-ui font-medium text-ink">{entry.name}</p>
              <p className="text-sm text-muted">
                {counted(entry.items, 'Item', 'Items')} in {CATEGORY_NAMES[entry.category]}
              </p>
            </div>
            <ArrowRight className="mb-2.5 hidden size-4 shrink-0 text-muted sm:block" aria-hidden="true" />
            <Select
              label={`Neuer Status für „${entry.name}“`}
              className="min-w-0 flex-1 basis-48"
              value={choices[entry.state_id] ?? null}
              onValueChange={(next) => next && setChoices((current) => ({ ...current, [entry.state_id]: next }))}
              options={targets.map((target) => ({
                value: target.id,
                label: target.name,
                icon: <StatusIcon icon={target.icon} category={target.category} label={target.name} aria-hidden="true" />,
              }))}
            />
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
