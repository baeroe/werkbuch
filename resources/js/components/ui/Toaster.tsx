import { CircleAlert, CircleCheck, X } from 'lucide-react';
import type { ComponentProps, CSSProperties } from 'react';
import { t } from '@/lib/i18n';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { dismissToast, runToastAction, setToastFocused, setToastHovered, useToasts, useToastsPaused, type Toast } from './toast';

/**
 * Toasts on tracing paper at the bottom, errors below the others. Every toast is announced politely, errors too: they
 * answer what the person just did, so they need not cut into what a screen reader is saying (web guidelines). Pointer
 * or keyboard focus on a toast pauses all of them (the line at the bottom drains with the time).
 */
export function Toaster() {
  const toasts = useToasts();
  const paused = useToastsPaused();

  // the holds are kept per toast in the store, so closing a toast also releases them
  const card = (item: Toast) => (
    <ToastCard
      key={item.id}
      item={item}
      onPointerEnter={() => setToastHovered(item.id, true)}
      onPointerLeave={() => setToastHovered(item.id, false)}
      onFocus={() => setToastFocused(item.id, true)}
      onBlur={(event) => {
        // only when the focus leaves the toast, not when it moves between its buttons
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setToastFocused(item.id, false);
      }}
    />
  );

  return (
    <div
      data-paused={paused || undefined}
      className="group pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"
    >
      {/* both live regions stay rendered while empty, so screen readers pick up the first toast */}
      <div role="status" aria-live="polite" className="flex w-full flex-col items-center gap-2">
        {toasts.filter((item) => item.tone !== 'error').map(card)}
      </div>
      <div role="status" aria-live="polite" className="flex w-full flex-col items-center gap-2">
        {toasts.filter((item) => item.tone === 'error').map(card)}
      </div>
    </div>
  );
}

/** One toast; exported so the component gallery can show it in place. */
export function ToastCard({ item, className, ...rest }: { item: Omit<Toast, 'keep' | 'round'> & { round?: number } } & Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div
      className={cx(
        'tracing-strong pointer-events-auto relative flex w-full max-w-sm animate-toast-in gap-2.5 overflow-hidden rounded-card py-1.5 pr-1.5 pl-3 text-ui [--glass-shadow:var(--elev-2)]',
        item.stack ? 'items-start' : 'items-center',
        className,
      )}
      {...rest}
    >
      {item.tone === 'success' && <CircleCheck className={cx('size-4 shrink-0 text-st-completed', item.stack && 'mt-2')} aria-hidden="true" />}
      {item.tone === 'error' && <CircleAlert className={cx('size-4 shrink-0 text-danger', item.stack && 'mt-2')} aria-hidden="true" />}
      <div className="min-w-0 flex-1 py-1">
        <p className={cx('font-medium break-words text-pretty', item.tone === 'error' ? 'text-danger' : 'text-ink')}>{item.title}</p>
        {item.description && <p className="mt-0.5 text-sm break-words text-pretty text-muted">{item.description}</p>}
        {/* a long message keeps its width: the action stands below it */}
        {item.stack && item.action && <ToastActionButton id={item.id} label={item.action.label} className="mt-1 -ml-2" />}
      </div>
      {!item.stack && item.action && <ToastActionButton id={item.id} label={item.action.label} />}
      <IconButton icon={X} label={t('ui.toaster.close')} tooltip={false} onClick={() => dismissToast(item.id)} />
      {/* a new round (the same error again) draws the time line anew */}
      <span
        key={item.round ?? 0}
        aria-hidden="true"
        style={{ '--toast-duration': `${item.duration}ms` } as CSSProperties}
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-drain bg-line-strong group-data-paused:[animation-play-state:paused]"
      />
    </div>
  );
}

function ToastActionButton({ id, label, className }: { id: number; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => runToastAction(id)}
      className={cx(
        'inline-flex h-11 shrink-0 cursor-pointer items-center rounded-ctl px-2 text-ui font-semibold text-accent-text transition-colors duration-120 hover:bg-hover md:h-7',
        className,
      )}
    >
      {label}
    </button>
  );
}
