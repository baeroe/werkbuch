/*
 * Building blocks the sections of the organisation settings share: the header of a section, panels and rows, badges,
 * a group of fields, the tone picker, and the loading and error states of a section. Plain DESIGN.md: cards on the
 * dot paper, tracing paper only on floating layers (dialogs and menus bring their own).
 */

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { UseQueryResult } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { Check, CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { labelClass } from '@/components/ui/styles';
import type { TypeTone } from '@/types';
import { TONE_NAMES, TONES } from './catalog';
import { causeOf } from './errors';

/* ------------------------------------------------------------------------ header */

type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right; they wrap below the title on a phone. */
  actions?: ReactNode;
  /** A link back to the list, above the title. */
  back?: ReactNode;
};

/** Title, one sentence about what the section is for, and its main actions. */
export function SectionHeader({ title, description, actions, back }: SectionHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h2 className="scroll-mt-20 font-display text-xl font-bold tracking-title text-balance break-words text-ink">{title}</h2>
        {description && <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ----------------------------------------------------------------------- panels */

type PanelProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A group of things on a card: white, one line, elevation 1. */
export function Panel({ title, description, actions, children, className }: PanelProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cx('rounded-card border border-line bg-surface shadow-elev-1', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h3 id={titleId} className="scroll-mt-20 font-display text-md font-bold tracking-title text-ink">
                {title}
              </h3>
            )}
            {description && <p className="mt-0.5 max-w-[65ch] text-sm text-pretty text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** The rows of a panel, set apart by lines. */
export function Rows({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cx('divide-y divide-line', className)}>
      {children}
    </ul>
  );
}

/** One row: the main cell takes the room, the rest wraps below it on a phone. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', className)}>{children}</li>;
}

/* ------------------------------------------------------------------------ badges */

type BadgeTone = 'neutral' | 'quiet' | 'accent' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface text-ink',
  quiet: 'border-line bg-sunken text-muted',
  accent: 'border-transparent bg-accent-soft text-accent-text',
  danger: 'border-transparent bg-danger-soft text-danger',
};

/** A small status word with its icon. The word carries the meaning, the tone only underlines it. */
export function Badge({ tone = 'neutral', icon: Icon, children, className }: { tone?: BadgeTone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 shrink-0 items-center gap-1 rounded-chip border px-1.5 text-sm font-medium whitespace-nowrap', BADGE_TONES[tone], className)}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * A field the person may read but not change (DESIGN.md): the value stays in full ink and focusable, and lies on the
 * sunken ground without a writing line, so it does not look like something to fill in. The `!` beats the field's own
 * white ground, which `fieldClass` sets in the same layer.
 */
export const readOnlyField = 'bg-sunken! shadow-none!';

/* ------------------------------------------------------------------ field groups */

type FieldGroupProps = {
  legend: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Several controls that answer one question: a legend like a label, then the hint or the error. */
export function FieldGroup({ legend, hint, error, children, className }: FieldGroupProps) {
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={cx('min-w-0', className)}>
      <legend className={cx(labelClass, 'mb-1.5 p-0')}>{legend}</legend>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-pretty text-muted">
          {hint}
        </p>
      )}
      <div aria-live="polite">
        {error && (
          <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </fieldset>
  );
}

type TonePickerProps = {
  value: TypeTone;
  onChange: (tone: TypeTone) => void;
  /** Names the group for screen readers: "Farbe des Labels". */
  label: string;
  disabled?: boolean;
};

/** The six muted tones as swatches. The chosen one carries a tick and its name stands beside them, never colour alone. */
export function TonePicker({ value, onChange, label, disabled }: TonePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <RadioGroup aria-label={label} value={value} onValueChange={(next) => onChange(next as TypeTone)} disabled={disabled} className="flex flex-wrap gap-1.5">
        {TONES.map((tone) => (
          <Radio.Root
            key={tone}
            value={tone}
            data-tone={tone}
            aria-label={TONE_NAMES[tone]}
            className={cx(
              'inline-flex size-11 items-center justify-center rounded-chip border border-line bg-[var(--tab-bg)] text-[var(--tab-ink)] transition-colors duration-120 md:size-7',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-line-input',
              'data-checked:border-ink data-checked:ring-1 data-checked:ring-ink',
            )}
          >
            <Radio.Indicator className="flex data-unchecked:hidden">
              <Check className="size-4" strokeWidth={3} aria-hidden="true" />
            </Radio.Indicator>
          </Radio.Root>
        ))}
      </RadioGroup>
      <span className="text-ui text-muted" aria-hidden="true">
        {TONE_NAMES[value]}
      </span>
    </div>
  );
}

/** A tone chosen from a menu, for rows that have no room for six swatches (the options of a dropdown). */
export function ToneMenu({ value, onChange, label, disabled }: TonePickerProps) {
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        aria-label={`${label}: ${TONE_NAMES[value]}`}
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface shadow-elev-1 transition-colors duration-120 md:size-9',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-line-input hover:bg-sunken',
        )}
      >
        <ToneDot tone={value} className="size-3" />
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as TypeTone)}>
          {TONES.map((tone) => (
            <MenuRadioItem key={tone} value={tone}>
              <span className="flex items-center gap-2">
                <ToneDot tone={tone} className="size-2.5" />
                {TONE_NAMES[tone]}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/* ----------------------------------------------------------------------- states */

/** Running text inside a notice: lines stay at a readable length however wide the notice is (65 characters). */
export function Measure({ children }: { children: ReactNode }) {
  return <span className="block max-w-[65ch]">{children}</span>;
}

/** Rows in outline while a list loads. */
export function RowsSkeleton({ rows = 4, label = 'Wird geladen …' }: { rows?: number; label?: string }) {
  return (
    <SkeletonGroup label={label} className="rounded-card border border-line bg-surface shadow-elev-1">
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-20 shrink-0 rounded-ctl" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** A form in outline: the settings of the organisation while they load. */
export function FormSkeleton({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <SkeletonGroup label={label} className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4 shadow-elev-1">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-9 w-full max-w-md rounded-ctl" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

type Query = Pick<UseQueryResult, 'isPending' | 'isError' | 'error' | 'refetch' | 'isFetching'>;

type LoadedProps = {
  queries: Query[];
  /** The title of the error state: "Die Personen konnten nicht geladen werden". */
  failure: string;
  skeleton: ReactNode;
  /** What loaded; a function when it reads the data, because the data are not there while the view loads or failed. */
  children: ReactNode | (() => ReactNode);
};

/**
 * The four states of a view with data: loading (the skeleton), error (cause and "Erneut versuchen"), and content.
 * The empty state is the content's own business, because only it knows what is missing.
 */
export function Loaded({ queries, failure, skeleton, children }: LoadedProps) {
  const failed = queries.find((query) => query.isError);
  if (failed) {
    return (
      <ErrorState
        title={failure}
        description={causeOf(failed.error)}
        retrying={queries.some((query) => query.isFetching)}
        onRetry={() => queries.filter((query) => query.isError).forEach((query) => void query.refetch())}
      />
    );
  }
  if (queries.some((query) => query.isPending)) return skeleton;
  return typeof children === 'function' ? children() : children;
}
