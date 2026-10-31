/*
 * The statuses of a workflow in the editor: shape, name and category of each, in an order to drag or move with the
 * keyboard, and a way to remove one. The start status cannot be removed (the button says why). A refusal of the server
 * stands at the row it belongs to; so does the mark of a status the start cannot reach. The divider lines run across
 * the whole row.
 */

import { CircleAlert, Trash2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { Select } from '@/components/ui/Select';
import { SortableList } from '@/components/ui/SortableList';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { fieldClass, fieldSize } from '@/components/ui/styles';
import { CATEGORY_ORDER } from '@/domain/workflow';
import { t } from '@/lib/i18n';
import type { StateCategory, StateIcon } from '@/types';
import { CATEGORY_HINTS, CATEGORY_LABELS, STATE_ICON_LABELS, STATE_ICONS } from '../../catalog/choices';
import { Badge, readOnlyField } from '../../frame/parts';
import type { DraftState } from './draft';

/** The id of the name field of a status, for the focus. */
export const stateNameId = (id: string) => `state-name-${id}`;

function ShapeMenu({ state, name, disabled, onChange }: { state: DraftState; name: string; disabled: boolean; onChange: (icon: StateIcon) => void }) {
  const shape = t(STATE_ICON_LABELS[state.icon]);
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        aria-label={t('settings.workflows.state.shape_of', { name, shape })}
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface shadow-elev-1 transition-colors duration-120 md:size-9',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-line-input hover:bg-sunken',
        )}
      >
        <StatusIcon icon={state.icon} category={state.category} label={shape} aria-hidden="true" className="size-5" />
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={state.icon} onValueChange={(next) => onChange(next as StateIcon)}>
          {STATE_ICONS.map((icon) => (
            <MenuRadioItem key={icon} value={icon}>
              <span className="flex items-center gap-2">
                <StatusIcon icon={icon} category={state.category} label={t(STATE_ICON_LABELS[icon])} aria-hidden="true" />
                {t(STATE_ICON_LABELS[icon])}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

type StateRowProps = {
  state: DraftState;
  index: number;
  handle: ReactNode;
  readOnly: boolean;
  isStart: boolean;
  unreachable: boolean;
  error: string | undefined;
  onChange: (partial: Partial<DraftState>) => void;
  onRemove: () => void;
};

function StateRow({ state, index, handle, readOnly, isStart, unreachable, error, onChange, onRemove }: StateRowProps) {
  const errorId = useId();
  const number = index + 1;
  const name = state.name.trim() || t('settings.workflows.state.fallback', { number });
  return (
    <div className="flex flex-wrap items-start gap-2 px-3 py-2">
      {!readOnly && handle}
      <ShapeMenu state={state} name={name} disabled={readOnly} onChange={(icon) => onChange({ icon })} />
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
        <input
          id={stateNameId(state.id)}
          name={`state_name_${number}`}
          autoComplete="off"
          value={state.name}
          readOnly={readOnly}
          placeholder={t('settings.workflows.state.name_placeholder')}
          aria-label={t('settings.workflows.state.name_of', { number })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange({ name: event.target.value })}
          className={cx(fieldClass(Boolean(error)), fieldSize, 'w-full', readOnly && readOnlyField)}
        />
        {unreachable && (
          <Badge tone="danger" icon={CircleAlert} className="self-start">
            {t('settings.workflows.state.unreachable')}
          </Badge>
        )}
      </div>
      {/* on a phone the category and the trash button share the second line */}
      <div className="flex basis-full items-start gap-2 sm:basis-auto">
        <Select
          aria-label={t('settings.workflows.state.category_of', { name })}
          hint={t(CATEGORY_HINTS[state.category])}
          className="min-w-0 flex-1 sm:w-52 sm:flex-none"
          disabled={readOnly}
          value={state.category}
          onValueChange={(next) => next && onChange({ category: next as StateCategory })}
          options={CATEGORY_ORDER.map((category) => ({
            value: category,
            label: t(CATEGORY_LABELS[category]),
            icon: <StatusIcon icon={state.icon} category={category} label={t(CATEGORY_LABELS[category])} aria-hidden="true" />,
          }))}
        />
        {!readOnly && (
          <IconButton
            icon={Trash2}
            label={t('settings.workflows.state.remove', { name })}
            disabledReason={isStart ? t('settings.workflows.state.keep_start') : null}
            onClick={onRemove}
          />
        )}
      </div>
      {/* the region is always there, so an error that appears is announced */}
      <div aria-live="polite" className="basis-full empty:hidden">
        {error && (
          <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

type StateRowsProps = {
  states: DraftState[];
  initialStateId: string;
  readOnly: boolean;
  /** Statuses the start cannot reach. */
  unreachable: ReadonlySet<string>;
  /** Removes a status; the editor puts the focus on the name of the row that takes its place. */
  onRemove: (id: string) => void;
  /** The message for a status: a name left empty, or the server's refusal of its row. */
  errorOf: (id: string) => string | undefined;
  onChange: (states: DraftState[]) => void;
  onPatch: (id: string, partial: Partial<DraftState>) => void;
};

export function StateRows({ states, initialStateId, readOnly, unreachable, errorOf, onChange, onPatch, onRemove }: StateRowsProps) {
  return (
    <SortableList
      items={states}
      label={t('settings.workflows.states.title')}
      disabled={readOnly}
      nameOf={(state) => state.name.trim()}
      onReorder={onChange}
      className="divide-y divide-line"
      renderItem={(state, { handle, index }) => (
        <StateRow
          state={state}
          index={index}
          handle={handle}
          readOnly={readOnly}
          isStart={state.id === initialStateId}
          unreachable={unreachable.has(state.id)}
          error={errorOf(state.id)}
          onChange={(partial) => onPatch(state.id, partial)}
          onRemove={() => onRemove(state.id)}
        />
      )}
    />
  );
}
