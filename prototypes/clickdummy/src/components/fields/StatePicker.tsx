/*
 * The status of an item (spec 4.5). The list offers only the states the workflow allows from the current one; a move
 * to Completed or Canceled asks for the resolution first (`ResolutionPrompt`). The move itself is optimistic.
 */

import { useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { allowedTargets, isClosedCategory } from '@/domain/workflow';
import { useResolutions } from '@/hooks/catalog';
import { useTransitionWorkItem } from '@/hooks/workItems';
import type { State, WorkItem } from '@/types';
import { useEditReason, useItemWorkflow } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';
import { ResolutionPrompt } from './ResolutionPrompt';

/** A status as a picker option: its icon in the colour of its category, then its name. */
export function stateOption(state: State): PickerOption {
  return { value: state.id, label: state.name, icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" /> };
}

type StatePickerProps = PickerExtras & {
  item: WorkItem;
  /** The choice is over: a state was chosen, or the list or the resolution question was closed without one. */
  onDone?: () => void;
};

export function StatePicker({ item, onDone, onOpenChange, look = 'field', shortcut, ...extras }: StatePickerProps) {
  const { workflow, isLoading, error, retry, retrying } = useItemWorkflow(item);
  const reason = useEditReason(item);
  const transition = useTransitionWorkItem();
  // loaded ahead, so the resolution question opens with its list
  useResolutions();
  const trigger = useRef<HTMLButtonElement>(null);
  // the target stays while the question fades out; `askOpen` says whether it is shown
  const [asking, setAsking] = useState<State | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const chosen = useRef(false);

  const current = workflow?.states.find((state) => state.id === item.state_id);
  const targets = workflow ? allowedTargets(workflow, item.state_id) : [];

  function choose(stateId: string) {
    const target = targets.find((state) => state.id === stateId);
    if (!target) return;
    chosen.current = true;
    if (isClosedCategory(target.category)) {
      setAsking(target);
      setAskOpen(true);
      return;
    }
    transition.mutate({ id: item.id, to_state_id: target.id });
    onDone?.();
  }

  return (
    <>
      <Picker
        {...extras}
        look={look}
        shortcut={shortcut ?? (look === 'field' ? 's' : undefined)}
        triggerRef={trigger}
        label="Status"
        display={
          current ? (
            <>
              <StatusIcon icon={current.icon} category={current.category} label={current.name} aria-hidden="true" />
              <span className="truncate">{current.name}</span>
            </>
          ) : (
            <Skeleton className="h-3 w-16" />
          )
        }
        displayText={current?.name ?? 'wird geladen'}
        options={targets.map(stateOption)}
        value={null}
        onValueChange={choose}
        placeholder="Status suchen …"
        emptyText={current && workflow && targets.length === 0 ? `Von „${current.name}“ führt im Workflow „${workflow.name}“ kein Übergang weiter.` : 'Kein Status passt.'}
        load={{ isLoading, error, retry, retrying }}
        disabledReason={reason}
        pending={transition.isPending}
        onOpenChange={(open) => {
          onOpenChange?.(open);
          if (open) {
            chosen.current = false;
            return;
          }
          // closed without a choice (the choice may arrive after the close, so look a moment later)
          queueMicrotask(() => {
            if (!chosen.current) onDone?.();
          });
        }}
      />
      <ResolutionPrompt
        open={askOpen}
        onOpenChange={(open) => {
          setAskOpen(open);
          if (!open) onDone?.();
        }}
        subject={item.key}
        target={asking}
        from={current ? { category: current.category, resolutionId: item.resolution_id } : undefined}
        onConfirm={(resolutionId) => {
          if (asking) transition.mutate({ id: item.id, to_state_id: asking.id, resolution_id: resolutionId });
        }}
        finalFocus={trigger}
      />
    </>
  );
}
