import { CircleAlert, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRefetchFailed } from '@/hooks/retry';
import { t } from '@/lib/i18n';
import { Button } from './Button';
import { cx } from './cx';

type ErrorStateProps = {
  title?: ReactNode;
  /** The cause in plain words, e.g. "The server is not answering right now (503)." */
  description: ReactNode;
  onRetry: () => void;
  /** The retry is running. */
  retrying?: boolean;
  className?: string;
};

/**
 * A view that could not load: names the cause and offers "Try again". The retry runs `onRetry` and then fetches
 * every other failed query as well (`useRefetchFailed`), so after an outage one click brings the whole screen back.
 */
export function ErrorState({ title = t('ui.error_state.title'), description, onRetry, retrying = false, className }: ErrorStateProps) {
  const refetchFailed = useRefetchFailed();
  const retry = () => {
    onRetry();
    refetchFailed();
  };
  return (
    <div role="alert" className={cx('flex flex-col items-center rounded-card border border-line bg-surface px-6 py-10 text-center shadow-elev-1', className)}>
      <span className="inline-flex size-14 items-center justify-center rounded-card bg-danger-soft" aria-hidden="true">
        <CircleAlert className="size-6 text-danger" />
      </span>
      <p className="mt-4 max-w-full font-display text-lg font-bold tracking-title break-words text-balance text-ink">{title}</p>
      <p className="mt-1 max-w-[46ch] text-ui break-words text-pretty text-muted">{description}</p>
      <Button variant="secondary" icon={RotateCw} pending={retrying} onClick={retry} className="mt-5">
        {t('common.retry')}
      </Button>
    </div>
  );
}
