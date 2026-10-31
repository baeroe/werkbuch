/*
 * Building blocks the sections of the settings screens share: the header of a section, the sheet a group of settings sits
 * on, panels and rows, badges, a group of fields, the save buttons, and the loading, error and read-only states. Plain
 * DESIGN.md: cards on the dot paper, tracing paper only on floating layers (dialogs and menus bring their own).
 */

import type { UseQueryResult } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Lock } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { labelClass } from '@/components/ui/styles';
import { t } from '@/lib/i18n';
import { errorText } from './form';

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

/* ------------------------------------------------------------------------ a sheet */

type CardProps = {
  title: ReactNode;
  description?: ReactNode;
  /** In the header, right of the title (a button). */
  actions?: ReactNode;
  /** The save buttons and the like, below a line. */
  footer?: ReactNode;
  tone?: 'neutral' | 'danger';
  /** The content ends with a `RuledList`: it runs down to the bottom edge of the sheet instead of leaving a gap. */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
};

/** A group of settings on one sheet: title, what it is for, the controls, and the buttons that save them. */
export function SettingsCard({ title, description, actions, footer, tone = 'neutral', flush = false, className, children }: CardProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cx('rounded-card border bg-surface shadow-elev-1', tone === 'danger' ? 'border-danger/40' : 'border-line', className)}>
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pt-4 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className={cx('scroll-mt-20 font-display text-lg font-bold tracking-title break-words', tone === 'danger' ? 'text-danger' : 'text-ink')}>
            {title}
          </h2>
          {description && <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className={cx('flex flex-col gap-4 px-4 md:px-5', !children ? 'pb-4' : flush ? 'pt-4' : 'py-4')}>{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-edge px-4 py-3 md:px-5">{footer}</footer>}
    </section>
  );
}

/** Rows separated by lines that run across the whole sheet, like the ruled lines of a notebook. */
export function RuledList({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    // role="list": a list without bullets loses its meaning in Safari otherwise
    <ul role="list" aria-label={label} className={cx('-mx-4 divide-y divide-line border-t border-line md:-mx-5', className)}>
      {children}
    </ul>
  );
}

/** One row of a `RuledList`. */
export function RuledRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cx('px-4 py-3 md:px-5', className)}>{children}</li>;
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

/** Running text inside a notice: lines stay at a readable length however wide the notice is (65 characters). */
export function Measure({ children }: { children: ReactNode }) {
  return <span className="block max-w-[65ch]">{children}</span>;
}

/* ---------------------------------------------------------------------- save buttons */

type FormActionsProps = {
  dirty: boolean;
  pending: boolean;
  /** "Save" was pressed with nothing to save. */
  quiet?: boolean;
  onReset: () => void;
  saveLabel?: string;
};

/**
 * "Reset" and "Save" for the footer of a sheet; saving is also ⌘↵ (registered by `useSaveShortcut`). Saving stays
 * possible while nothing changed, so the form never leaves a person wondering why a button is dead: it says there is
 * nothing to save.
 */
export function FormActions({ dirty, pending, quiet = false, onReset, saveLabel = t('settings.frame.save') }: FormActionsProps) {
  return (
    <>
      <p role="status" className="mr-auto text-sm text-muted">
        {dirty && !pending ? t('settings.frame.unsaved') : quiet ? t('settings.frame.nothing_to_save') : ''}
      </p>
      <Button variant="ghost" disabled={!dirty || pending} onClick={onReset}>
        {t('settings.frame.reset')}
      </Button>
      <Button variant="primary" type="submit" pending={pending} shortcut="mod+enter">
        {saveLabel}
      </Button>
    </>
  );
}

/* ----------------------------------------------------------------------- states */

/** A sheet in outline while a section loads. */
export function SettingsSkeleton({ rows = 3, label = t('settings.frame.loading_settings') }: { rows?: number; label?: string }) {
  return (
    <SkeletonGroup label={label} className="rounded-card border border-line bg-surface p-5 shadow-elev-1">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-3 w-2/3 max-w-80" />
      <div className="mt-6 flex flex-col gap-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full rounded-ctl" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** Rows in outline while a list loads. */
export function RowsSkeleton({ rows = 4, label = t('settings.frame.loading') }: { rows?: number; label?: string }) {
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
export function FormSkeleton({ label = t('settings.frame.loading') }: { label?: string }) {
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
  /** The title of the error state: "The people could not be loaded". */
  failure: string;
  skeleton: ReactNode;
  /** What loaded; a function when it reads the data, because the data are not there while the view loads or failed. */
  children: ReactNode | (() => ReactNode);
};

/**
 * The four states of a view with data: loading (the skeleton), error (cause and "Try again"), and content. The empty
 * state is the content's own business, because only it knows what is missing.
 */
export function Loaded({ queries, failure, skeleton, children }: LoadedProps) {
  const failed = queries.find((query) => query.isError);
  if (failed) {
    return (
      <ErrorState
        title={failure}
        description={errorText(failed.error)}
        retrying={queries.some((query) => query.isFetching)}
        onRetry={() => queries.filter((query) => query.isError).forEach((query) => void query.refetch())}
      />
    );
  }
  if (queries.some((query) => query.isPending)) return skeleton;
  return typeof children === 'function' ? children() : children;
}

/** A section that could not load: the cause and "Try again". */
export function SettingsError({
  error,
  onRetry,
  retrying,
  title = t('settings.frame.load_failed'),
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return <ErrorState title={title} description={errorText(error)} onRetry={onRetry} retrying={retrying} />;
}

/** "You may only read this", with the reason from `usePermissions`. */
export function ReadOnlyBanner({ title = t('settings.frame.read_only'), reason }: { title?: string; reason: string }) {
  return (
    <Banner role="status" icon={Lock} title={title}>
      {reason}
    </Banner>
  );
}
