/*
 * The one question for states that hold items (spec 4.5, R26): switching the workflow of a project ("Workflow
 * wechseln") and removing states in the workflow editor ("Status ersetzen") both ask it. One row per state that items
 * use, with the number of items and the state that takes them over (proposed: the same name, otherwise the same
 * category), below it what the mapping does to the items (they open again, close, change their resolution). The main
 * button waits until every row has its target and names the first one without. Without rows it is a plain
 * confirmation. A refusal of the server marks its rows: a 422 at `<field>.<state id>`, and a 409 `state_in_use` for
 * states that got items meanwhile (the caller adds them to `usage`, so they have a row).
 */

import { ArrowRight } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { FormDialog } from '@/components/ui/FormDialog';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { t, tn } from '@/lib/i18n';
import type { State, StateUsage } from '@/types';
import { fieldErrors, hasReason } from '../frame/form';
import { complete, effectsOf, mappingOf, rowsFor, type MappingEffect } from './mapping';

/** Where the server puts its refusals of a mapping: `AssignWorkflow` at `mapping.<id>`, `SaveWorkflow` at `state_mapping.<id>`. */
export type MappingField = 'mapping' | 'state_mapping';

/** The states the server names in a refusal, with their items: `extensions.states` of the 422 and of the 409. */
export function refusedStates(error: unknown): StateUsage[] {
  if (!(error instanceof ApiError)) return [];
  const states = error.extensions.states;
  return Array.isArray(states) ? (states as StateUsage[]).map(({ state_id, items }) => ({ state_id, items })) : [];
}

/** The message of each row a refusal marks, by state id. */
function marksOf(error: unknown, field: MappingField): Record<string, string> {
  const marks: Record<string, string> = {};
  if (hasReason(error, 'state_in_use')) {
    for (const state of refusedStates(error)) marks[state.state_id] = t('settings.state_mapping.in_use_now');
  }
  for (const [path, message] of Object.entries(fieldErrors(error))) {
    if (path.startsWith(`${field}.`)) marks[path.slice(field.length + 1)] = message;
  }
  return marks;
}

/** The fields of a refusal the rows show; the caller leaves them out of its notice. */
export function markedPaths(error: unknown, field: MappingField): string[] {
  return Object.keys(fieldErrors(error)).filter((path) => path.startsWith(`${field}.`));
}

const EFFECT_TITLE = {
  reopened: 'settings.state_mapping.effect.reopened',
  closed: 'settings.state_mapping.effect.closed',
  resolution: 'settings.state_mapping.effect.resolution',
} as const;

const EFFECT_BODY = {
  reopened: 'settings.state_mapping.effect.reopened_body',
  closed: 'settings.state_mapping.effect.closed_body',
  resolution: 'settings.state_mapping.effect.resolution_body',
} as const;

function Effect({ effect }: { effect: MappingEffect }) {
  return (
    <Banner role="status" title={tn(EFFECT_TITLE[effect.kind], effect.items)}>
      {tn(EFFECT_BODY[effect.kind], effect.items)}
    </Banner>
  );
}

function StateLabel({ state }: { state: State }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
      <span className="min-w-0 truncate">{state.name}</span>
    </span>
  );
}

/** The id of the choice of a row, for the focus. */
const choiceId = (stateId: string) => `state-mapping-${stateId}`;

export type StateMappingDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  /** Items per state of `from`; states without items get no row. */
  usage: readonly StateUsage[];
  /** The states whose items move. */
  from: readonly State[];
  /** The states that can take them over, in their order (in the workflow editor new ones with their local ids). */
  to: readonly State[];
  onConfirm: (mapping: Record<string, string>) => void;
  /** The call is running: the dialog stays open until it ends. */
  pending?: boolean;
  /** The refusal of the last send; its rows are marked. */
  refusal?: unknown;
  field: MappingField;
  /** A refusal without a row of its own. */
  notice?: string | null;
  finalFocus?: RefObject<HTMLElement | null>;
};

export function StateMappingDialog({ open, onClose, title, description, submitLabel, usage, from, to, onConfirm, pending = false, refusal, field, notice, finalFocus }: StateMappingDialogProps) {
  // only what the person chose; the rest follows the proposal
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // rows whose target changed after the refusal: their mark is answered
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState(refusal);
  if (refused !== refusal) {
    setRefused(refusal);
    setAnswered(new Set());
  }

  const rows = rowsFor(usage, from, to).map((row) => (chosen[row.state.id] ? { ...row, target: chosen[row.state.id]! } : row));
  const marks = marksOf(refusal, field);
  const missing = rows.find((row) => row.target === null);
  const effects = effectsOf(rows, to);
  const options = [...to]
    .sort((a, b) => a.position - b.position)
    .map((state) => ({ value: state.id, label: state.name, icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" /> }));

  function choose(stateId: string, target: string) {
    setChosen((current) => ({ ...current, [stateId]: target }));
    setAnswered((current) => new Set(current).add(stateId));
  }

  function submit() {
    if (!complete(rows)) {
      // ⌘↵ sends past the blocked button: the choice that is missing takes the focus
      document.getElementById(choiceId(missing!.state.id))?.focus();
      return;
    }
    onConfirm(mappingOf(rows));
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title={title}
      description={description}
      submitLabel={submitLabel}
      pending={pending}
      // the change runs to its end with the dialog open: closing it now would leave the person without its answer
      locked={pending}
      notice={notice}
      submitDisabledReason={missing ? t('settings.state_mapping.missing', { name: missing.state.name }) : null}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      {rows.length > 0 && (
        <ul role="list" aria-label={t('settings.state_mapping.rows')} className="flex flex-col gap-3">
          {rows.map((row) => {
            const mark = answered.has(row.state.id) ? undefined : marks[row.state.id];
            return (
              <li key={row.state.id} className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3">
                <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-md font-medium text-ink">
                  <StateLabel state={row.state} />
                  <span className="text-sm font-normal text-muted tabular-nums">{tn('settings.state_mapping.items', row.items)}</span>
                </div>
                <ArrowRight className="mt-2.5 hidden size-4 text-muted md:block" aria-hidden="true" />
                <Select
                  id={choiceId(row.state.id)}
                  aria-label={t('settings.state_mapping.target', { name: row.state.name })}
                  placeholder={t('settings.state_mapping.placeholder')}
                  value={row.target}
                  error={mark}
                  options={options}
                  onValueChange={(next) => next && choose(row.state.id, next)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {effects.map((effect) => (
        <Effect key={effect.kind} effect={effect} />
      ))}
    </FormDialog>
  );
}
