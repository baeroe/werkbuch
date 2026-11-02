/*
 * A date value: a popover with "Heute", "Diese Woche", "Dieser Monat", a distance from today in days or weeks ("In 7
 * Tagen", "Vor 2 Wochen") or a day from the calendar; "zwischen" has two of them. The days count in the time zone of
 * the organisation (the server reads them there, P7). While the popover is open, the page's shortcuts wait.
 */

import { useId, useRef, useState } from 'react';
import { useToday } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { t } from '@/lib/i18n';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { DAY, dateValueLabel, readRelative, relativeValue } from '../fieldOps';
import { chipPart, type ValueEditorProps } from './shared';

const PRESETS = ['today', 'this_week', 'this_month'] as const;
const PRESET_KEYS = { today: 'items.filter.date.preset.today', this_week: 'items.filter.date.preset.this_week', this_month: 'items.filter.date.preset.this_month' } as const;

/** Mounted while the popover is open: the page's shortcuts (f, j, 1–4) wait. */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

type DateChoiceProps = { label: string; value: unknown; onChoose: (value: unknown) => void; open: boolean; onOpenChange: (open: boolean) => void };

/** One date value and its popover. */
function DateChoice({ label, value, onChoose, open, onOpenChange }: DateChoiceProps) {
  const { today, weekStart } = useToday();
  const relative = readRelative(value);
  const [direction, setDirection] = useState<'in' | 'ago'>(relative && relative.amount < 0 ? 'ago' : 'in');
  const [amount, setAmount] = useState(relative ? String(Math.abs(relative.amount)) : '7');
  const [unit, setUnit] = useState<'d' | 'w'>(relative?.unit ?? 'd');
  const [error, setError] = useState<string | null>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const ids = useId();
  const day = typeof value === 'string' && DAY.test(value) ? value : null;
  const empty = value === undefined || value === null;
  const words = dateValueLabel(value);

  const choose = (next: unknown) => {
    onChoose(next);
    onOpenChange(false);
  };
  function applyRelative() {
    const trimmed = amount.trim();
    if (!/^\d{1,4}$/.test(trimmed)) {
      setError(t('items.filter.date.amount_invalid'));
      amountField.current?.focus();
      return;
    }
    setError(null);
    choose(relativeValue(Number(trimmed) * (direction === 'ago' ? -1 : 1), unit));
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<button type="button" aria-label={t('items.fields.picker.name', { label, value: empty ? t('items.filter.value.none') : words })} className={cx(chipPart, empty ? 'text-muted' : 'text-ink')} />}
      >
        <span className="truncate tabular-nums">{words}</span>
      </PopoverTrigger>
      <PopoverContent title={label} className="w-[min(21rem,calc(100vw-2rem))] p-3">
        {open && <PausePageShortcuts />}
        <div className="mt-3 flex flex-col gap-4">
          <SegmentedControl
            label={t('items.filter.date.presets')}
            size="sm"
            value={(PRESETS as readonly unknown[]).includes(value) ? (value as string) : ''}
            onValueChange={choose}
            options={PRESETS.map((preset) => ({ value: preset, label: t(PRESET_KEYS[preset]) }))}
          />
          <form
            aria-labelledby={`${ids}-label`}
            onSubmit={(event) => {
              event.preventDefault();
              applyRelative();
            }}
          >
            <p id={`${ids}-label`} className="text-sm font-medium text-ink">
              {t('items.filter.date.distance')}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <Select
                aria-label={t('items.filter.date.direction')}
                value={direction}
                onValueChange={(next) => setDirection(next === 'ago' ? 'ago' : 'in')}
                options={[
                  { value: 'in', label: t('items.filter.date.in') },
                  { value: 'ago', label: t('items.filter.date.ago') },
                ]}
                className="w-20 shrink-0"
              />
              {/* the field fills its box (w-full): the box sets the width */}
              <div className="w-16 shrink-0">
                <Input
                  ref={amountField}
                  name="relative-amount"
                  aria-label={t('items.filter.date.amount')}
                  aria-describedby={`${ids}-note`}
                  aria-invalid={error ? true : undefined}
                  value={amount}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(event) => setAmount(event.target.value)}
                  className="tabular-nums"
                />
              </div>
              <Select
                aria-label={t('items.filter.date.unit')}
                value={unit}
                onValueChange={(next) => setUnit(next === 'w' ? 'w' : 'd')}
                options={[
                  { value: 'd', label: t('items.filter.date.days') },
                  { value: 'w', label: t('items.filter.date.weeks') },
                ]}
                className="min-w-0 flex-1"
              />
            </div>
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p id={`${ids}-note`} aria-live="polite" className={cx('text-sm text-pretty', error ? 'font-medium text-danger' : 'text-muted')}>
                {error ?? t('items.filter.date.distance_note')}
              </p>
              <Button type="submit" variant="secondary" size="sm">
                {t('items.filter.date.apply')}
              </Button>
            </div>
          </form>
          <Calendar value={day} today={today} weekStartsOn={weekStart} label={label} onChange={(next) => next && choose(next)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DateValue({ condition, label, onChange, open, onOpenChange }: ValueEditorProps) {
  const [second, setSecond] = useState(false);
  if (condition.op === 'between') {
    const [from, to] = Array.isArray(condition.value) ? condition.value : [null, null];
    return (
      <>
        <DateChoice
          label={t('items.filter.value.from', { field: label })}
          value={from}
          open={open}
          onOpenChange={onOpenChange}
          onChoose={(next) => onChange({ ...condition, value: [next, to ?? next] })}
        />
        <span className="text-sm text-muted">{t('items.filter.value.and')}</span>
        <DateChoice
          label={t('items.filter.value.to', { field: label })}
          value={to}
          open={second}
          onOpenChange={setSecond}
          onChoose={(next) => onChange({ ...condition, value: [from ?? next, next] })}
        />
      </>
    );
  }
  return <DateChoice label={label} value={condition.value} open={open} onOpenChange={onOpenChange} onChoose={(next) => onChange({ ...condition, value: next })} />;
}
