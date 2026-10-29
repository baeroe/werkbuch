/*
 * The question that comes with a move to Completed or Canceled (spec 4.7): which resolution? The default of the
 * category is chosen already, so Enter takes it; the arrows choose another one. Escape cancels the move.
 */

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { resolutionAfterTransition } from '@/domain/resolution';
import { useResolutions } from '@/hooks/catalog';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { State, StateCategory } from '@/types';

type ResolutionPromptProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What moves, as the title says it: "WEB-47" or "3 Items". */
  subject: string;
  /** The Completed or Canceled state it moves to. */
  target: State | null;
  /** Where it comes from: within a closed category the item keeps its resolution, as the server does. */
  from?: { category: StateCategory; resolutionId: string | null };
  onConfirm: (resolutionId: string | null) => void;
  /** Where the focus goes when the question closes (the picker's trigger). */
  finalFocus?: RefObject<HTMLElement | null>;
};

export function ResolutionPrompt({ open, onOpenChange, subject, target, from, onConfirm, finalFocus }: ResolutionPromptProps) {
  const formId = useId();
  if (!target) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
      size="sm"
      title={`${subject} auf ${target.name} setzen`}
      description="Die Resolution hält fest, wie die Arbeit endet."
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" shortcut="escape">
                Abbrechen
              </Button>
            }
          />
          <Button variant="primary" type="submit" form={formId} shortcut="mod+enter">
            Auf {target.name} setzen
          </Button>
        </>
      }
    >
      <Choices
        formId={formId}
        target={target}
        from={from}
        onConfirm={(resolutionId) => {
          onConfirm(resolutionId);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

/** The list of resolutions; mounted while the dialog is open, so every question starts at the default. */
function Choices({ formId, target, from, onConfirm }: { formId: string; target: State; from: ResolutionPromptProps['from']; onConfirm: (id: string | null) => void }) {
  const resolutions = useResolutions();
  const form = useRef<HTMLFormElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const loaded = resolutions.data !== undefined;

  // the list came after the dialog had opened (and focused "Abbrechen"): the focus goes to the chosen resolution,
  // so Enter takes it
  useEffect(() => {
    if (!loaded) return;
    const checked = group.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    if (checked && !group.current?.contains(document.activeElement)) checked.focus();
  }, [loaded]);
  const all = resolutions.data?.items ?? [];
  const offered = all.filter((resolution) => resolution.archived_at === null).sort((a, b) => a.position - b.position);
  const preset = resolutionAfterTransition(from?.category ?? 'started', target.category, from?.resolutionId ?? null, null, all);
  const value = choice ?? preset;

  // mod+Enter anywhere in the dialog, and Enter in the list, take the chosen resolution
  useShortcut({ id: 'resolution.confirm', keys: 'mod+enter', scope: 'dialog', label: 'Resolution übernehmen', group: 'Dialog', run: () => form.current?.requestSubmit() });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    form.current?.requestSubmit();
  };

  if (resolutions.isPending) {
    return (
      <SkeletonGroup label="Resolutions werden geladen …" className="flex flex-col gap-3.5 py-1">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </SkeletonGroup>
    );
  }

  return (
    <form
      ref={form}
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(value);
      }}
    >
      {resolutions.isError && (
        <p role="alert" className="mb-2 text-sm text-pretty text-danger">
          Die Resolutions konnten nicht geladen werden. Ohne Auswahl gilt der Standard der Kategorie.
        </p>
      )}
      <RadioGroup ref={group} aria-label="Resolution" value={value} onValueChange={(next) => setChoice(String(next))} onKeyDown={onKeyDown} className="-mx-2 flex flex-col">
        {offered.map((resolution) => (
          <label
            key={resolution.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-ctl px-2 text-ui text-ink transition-colors duration-120 hover:bg-hover md:min-h-9"
          >
            <Radio.Root
              value={resolution.id}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-line-input bg-surface transition-colors duration-120 data-checked:border-accent"
            >
              <Radio.Indicator className="size-2 rounded-full bg-accent data-unchecked:hidden" />
            </Radio.Root>
            {resolution.label}
            {resolution.default_for === target.category && (
              <span aria-hidden="true" className="ml-auto text-sm text-muted">
                Standard
              </span>
            )}
          </label>
        ))}
      </RadioGroup>
    </form>
  );
}
