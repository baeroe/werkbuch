/*
 * One condition of the filter bar as a chip (moodboard "Status ist nicht Cancelled ×"): the field, the operator (a menu
 * with the operators of the field), the value (`ConditionEditor`) and × to remove it; Backspace or Delete on a part of
 * the chip removes it too.
 *
 * A condition without its value yet (new, or its values taken away) stays while the focus is within the chip, also in
 * its popups: changing the operator or tabbing from the first value of "zwischen" to the second keeps it (13c). Once
 * the focus leaves the chip, `onLeave` tells the filter bar, which drops it if it is still unfinished. A condition on
 * a field that is gone (a deleted property in a saved view) reads "Unbekanntes Feld" and can only be removed (P2); one on
 * a property while the properties failed to load reads "Nicht geladen" with "Erneut versuchen" (T16-M5).
 */

import { RotateCw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { t } from '@/lib/i18n';
import type { Condition, ConditionOp, Project } from '@/types';
import { ConditionEditor, useConditionText } from './ConditionEditor';
import { fieldLabel, isComplete, menuOperators, operatorFamily, operatorLabelKey, PROPERTY_PREFIX, valuesOf, withOperator, type FieldDef } from './fieldOps';
import { chipPart } from './values/shared';

type ConditionChipProps = {
  condition: Condition;
  /** Null: a field the filter bar does not know; it can only be removed. */
  def: FieldDef | null;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  /** The focus left the chip and its popups. */
  onLeave: () => void;
  /** Just added: the value editor opens at once. */
  fresh?: boolean;
  /** The project of a project list: its workflow's states. */
  project?: Project;
  /** The properties failed to load: a chip on a property says so and offers to load them again (T16-M5). */
  failed?: { retry: () => void; retrying: boolean };
};

/** Frames to wait for the focus to land after it left an element (a popup gives it back to its trigger a frame later). */
const SETTLE_FRAMES = 5;

/** Calls `onLeave` once the focus has left the chip (its popups count as part of it: React events cross portals). */
function useFocusLeave(onLeave: () => void) {
  const inside = useRef(false);
  const latest = useRef(onLeave);
  useLayoutEffect(() => {
    latest.current = onLeave;
  });
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const check = (left: number) => {
    if (inside.current) return;
    // the focus is on its way (to a trigger, a popup): wait for it a few frames
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost && left > 0) frame.current = requestAnimationFrame(() => check(left - 1));
    else latest.current();
  };
  return {
    onFocus: () => {
      inside.current = true;
      cancelAnimationFrame(frame.current);
    },
    onBlur: () => {
      inside.current = false;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => check(SETTLE_FRAMES));
    },
  };
}

export function ConditionChip({ condition, def, onChange, onRemove, onLeave, fresh = false, project, failed }: ConditionChipProps) {
  const [open, setOpen] = useState(fresh);
  const root = useRef<HTMLDivElement>(null);
  /** The operator menu changed to one that needs a value: the value editor opens once the menu is closed. */
  const askValue = useRef(false);
  const focus = useFocusLeave(onLeave);
  const text = useConditionText(condition, def, project, open);

  if (!def && failed && condition.field.startsWith(PROPERTY_PREFIX)) {
    // not an unknown field: the list of properties did not come, the condition goes to the server as it is
    const key = condition.field.slice(PROPERTY_PREFIX.length);
    return (
      <div role="group" aria-label={t('items.filter.chip.not_loaded_name', { field: key })} className="inline-flex h-11 max-w-full min-w-0 items-center gap-1 rounded-ctl border border-dashed border-line bg-surface pr-0.5 pl-2 text-sm md:h-7">
        <span translate="no" className="truncate font-medium text-ink">
          {key}
        </span>
        <span className="shrink-0 text-muted">{t('items.filter.chip.not_loaded')}</span>
        <Button variant="ghost" size="sm" icon={RotateCw} pending={failed.retrying} onClick={failed.retry}>
          {t('common.retry')}
        </Button>
        <IconButton icon={X} size="sm" label={t('items.filter.chip.remove', { field: key })} tooltip={false} onClick={onRemove} />
      </div>
    );
  }

  if (!def) {
    return (
      <div role="group" aria-label={t('items.filter.chip.unknown_name', { field: condition.field })} className="inline-flex h-11 max-w-full min-w-0 items-center gap-0.5 rounded-ctl border border-dashed border-line bg-surface pr-0.5 pl-2 text-sm text-muted md:h-7">
        <span className="truncate">{t('items.filter.chip.unknown')}</span>
        <IconButton icon={X} size="sm" label={t('items.filter.chip.remove', { field: t('items.filter.chip.unknown') })} tooltip={false} onClick={onRemove} />
      </div>
    );
  }

  const label = fieldLabel(def);
  const operator = t(operatorLabelKey(condition.op, valuesOf(condition).length));
  const name = [label, operator, text].filter(Boolean).join(' ');
  const ops = menuOperators(def);

  /** After the operator menu: the value editor of a condition that still needs one. */
  function openValue() {
    if (!askValue.current) return;
    askValue.current = false;
    // a field in the chip takes the focus; a picker or a calendar opens and takes it itself
    const field = root.current?.querySelector<HTMLInputElement>('input[name^="filter-"]');
    if (field) field.focus();
    else setOpen(true);
  }

  return (
    <div
      ref={root}
      role="group"
      data-condition-chip=""
      aria-label={isComplete(condition) ? t('items.filter.chip.name', { name }) : t('items.filter.chip.unfinished', { name })}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        // Backspace on a part of the chip (not in its field, not in a popup) removes it
        const target = event.target as HTMLElement;
        if ((event.key === 'Backspace' || event.key === 'Delete') && target.tagName === 'BUTTON' && event.currentTarget.contains(target)) {
          event.preventDefault();
          onRemove();
        }
      }}
      className="inline-flex h-11 max-w-full min-w-0 items-center gap-0.5 rounded-ctl border border-line bg-surface pr-0.5 pl-2 text-sm text-ink shadow-elev-1 md:h-7"
    >
      <span className="shrink-0 font-medium">{label}</span>
      {ops.length > 1 ? (
        // the menu gives the focus back to its trigger as it closes: from there on to the value (and if it did not, once
        // the menu is gone)
        <Menu onOpenChangeComplete={(next) => !next && openValue()}>
          <MenuTrigger
            render={<button type="button" aria-label={t('items.filter.chip.operator', { operator })} onFocus={() => requestAnimationFrame(openValue)} className={cx(chipPart, 'text-muted hover:text-ink')} />}
          >
            {operator}
          </MenuTrigger>
          <MenuContent className="min-w-44">
            <MenuRadioGroup
              value={operatorFamily(condition.op, def.kind)}
              onValueChange={(next) => {
                const changed = withOperator(condition, next as ConditionOp, def);
                onChange(changed);
                askValue.current = !isComplete(changed);
              }}
            >
              {ops.map((op) => (
                <MenuRadioItem key={op} value={op} closeOnClick>
                  {t(operatorLabelKey(op))}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      ) : (
        <span className="shrink-0 px-1.5 text-muted">{operator}</span>
      )}
      <ConditionEditor condition={condition} def={def} label={label} onChange={onChange} open={open} onOpenChange={setOpen} project={project} />
      <IconButton icon={X} size="sm" label={t('items.filter.chip.remove', { field: label })} tooltip={false} onClick={onRemove} />
    </div>
  );
}
