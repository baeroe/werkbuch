/*
 * The parts both settings screens (project and personal) are built from, so they look and behave alike: the page with
 * its title and section navigation, the sheet a group of settings sits on, the save buttons, and the loading, error
 * and read-only states. The organisation settings (Task 11) have their own frame; Task 13 can merge the two.
 */

import { Lock } from 'lucide-react';
import { useEffect, useId, type ReactNode, type RefObject } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { registerCommand } from '@/lib/commands';
import { errorText } from './form';

/* ------------------------------------------------------------------------ the page */

export interface SectionItem {
  /** The last part of the address, e.g. `members`. */
  slug: string;
  label: string;
}

type FrameProps = {
  /** The h1. */
  title: string;
  /** What the page is about, under the title (e.g. the project). */
  lead?: ReactNode;
  nav: ReactNode;
  children: ReactNode;
};

/** Title, section navigation and the content, left aligned and no wider than a form needs. */
export function SettingsFrame({ title, lead, nav, children }: FrameProps) {
  return (
    <div className="w-full max-w-3xl">
      <header className="min-w-0">
        <h1 className="scroll-mt-20 font-display text-xl font-bold tracking-title text-ink">{title}</h1>
        {lead && <div className="mt-1 min-w-0 text-ui text-muted">{lead}</div>}
      </header>
      <div className="mt-4">{nav}</div>
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </div>
  );
}

type SectionNavProps = {
  /** Names the navigation, e.g. "Bereiche der Projekteinstellungen". */
  label: string;
  items: readonly SectionItem[];
  current: string;
  /** The address of a section. */
  hrefFor: (slug: string) => string;
};

/** The sections as links, so ⌘-click and the back button work; the current one is underlined in ink blue. */
export function SectionNav({ label, items, current, hrefFor }: SectionNavProps) {
  return (
    <nav aria-label={label}>
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {items.map((item) => {
          const active = item.slug === current;
          return (
            <li key={item.slug} className="shrink-0">
              <Link
                to={hrefFor(item.slug)}
                aria-current={active ? 'page' : undefined}
                // the list scrolls sideways and clips: the focus ring sits inside the link
                className={cx(
                  '-mb-px inline-flex h-11 items-center border-b-2 px-2.5 text-ui font-medium whitespace-nowrap transition-colors duration-120 [--focus-offset:-2px] md:h-9',
                  active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** One palette command per section ("Mitglieder öffnen"), while the screen is open. `items` must be a stable list. */
export function useSectionCommands(prefix: string, group: string, items: readonly SectionItem[], hrefFor: (slug: string) => string): void {
  const navigate = useNavigate();
  useEffect(() => {
    const offs = items.map((item) =>
      registerCommand({ id: `${prefix}.${item.slug}`, label: `${item.label} öffnen`, group, keywords: ['einstellungen', item.label.toLowerCase()], run: () => navigate(hrefFor(item.slug)) }),
    );
    return () => offs.forEach((off) => off());
  }, [prefix, group, items, hrefFor, navigate]);
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

/* ---------------------------------------------------------------------- save buttons */

type FormActionsProps = {
  dirty: boolean;
  pending: boolean;
  /** "Speichern" was pressed with nothing to save. */
  quiet?: boolean;
  onReset: () => void;
  saveLabel?: string;
};

/**
 * "Zurücksetzen" and "Speichern" for the footer of a sheet; saving is also ⌘↵ (registered by `useSaveShortcut`). Saving
 * stays possible while nothing changed, so the form never leaves a person wondering why a button is dead: it says there
 * is nothing to save.
 */
export function FormActions({ dirty, pending, quiet = false, onReset, saveLabel = 'Speichern' }: FormActionsProps) {
  return (
    <>
      <p role="status" className="mr-auto text-sm text-muted">
        {dirty && !pending ? 'Nicht gespeicherte Änderungen' : quiet ? 'Keine Änderungen zu speichern.' : ''}
      </p>
      <Button variant="ghost" disabled={!dirty || pending} onClick={onReset}>
        Zurücksetzen
      </Button>
      <Button variant="primary" type="submit" pending={pending} shortcut="mod+enter">
        {saveLabel}
      </Button>
    </>
  );
}

/**
 * Asks before a person leaves the page with changes that are not saved: for a click inside the app, and for closing or
 * reloading the tab. `saving` lets the form's own save pass, which may move the address (a new identifier).
 *
 * `bypass` lets a departure pass that the person has confirmed in another way already (deleting the project, which
 * leaves its settings for the list): the one who leaves sets it just before the navigation. It is a flag in a ref and
 * not a prop, because the guard is asked in the same breath as the navigation starts, before a state change would have
 * reached it.
 */
export function UnsavedGuard({ dirty, saving = false, bypass }: { dirty: boolean; saving?: boolean; bypass?: RefObject<boolean> }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && !bypass?.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // older browsers want the return value as well
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
      title="Änderungen verwerfen?"
      description="Du hast Änderungen, die noch nicht gespeichert sind. Sie gehen verloren, wenn du diese Seite verlässt."
      cancelLabel="Weiter bearbeiten"
      confirmLabel="Verwerfen"
      onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
    />
  );
}

/* -------------------------------------------------------------------------- states */

/** A sheet in outline while a section loads. */
export function SettingsSkeleton({ rows = 3, label = 'Einstellungen werden geladen …' }: { rows?: number; label?: string }) {
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

/** A section that could not load: the cause and "Erneut versuchen". */
export function SettingsError({
  error,
  onRetry,
  retrying,
  title = 'Die Einstellungen konnten nicht geladen werden',
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return <ErrorState title={title} description={errorText(error)} onRetry={onRetry} retrying={retrying} />;
}

/** "Du darfst das nur lesen", with the reason from `usePermissions`. */
export function ReadOnlyBanner({ title = 'Du kannst das nur lesen', reason }: { title?: string; reason: string }) {
  return (
    <Banner role="status" icon={Lock} title={title}>
      {reason}
    </Banner>
  );
}
