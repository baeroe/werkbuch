/*
 * The kept versions of a wiki page (spec 4.15; ported from the clickdummy): who saved each and when, the text of the
 * chosen one to read, and "Diese Version wiederherstellen". A version is kept after ten minutes without an edit, before
 * a foreign state is overwritten and when somebody keeps their own text over another ("Meine Fassung übernehmen");
 * restoring makes the old title and text the current state as a new version, and the state it replaces is kept first.
 * - The list comes without texts; the text of the chosen version is read on its own (A315), with its skeleton and its
 *   error with "Erneut versuchen". Every opening starts with the newest version.
 * - The version that holds the state of the page now is "aktuell" and cannot be restored.
 * - Restoring saves what is typed first (`beforeRestore`, false: a conflict stands or the save failed, nothing is
 *   restored); the button waits for the answer, so a second press restores nothing twice (T7). The page in its new
 *   version goes into the cache, and the editor shows it.
 * - Who may not edit reads the versions; the button says why it is locked (`restoreReason`).
 */

import { History, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useUserMap } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { formatMoment } from '@/features/item-detail/activity/when';
import { usePageVersion, usePageVersions, useRestorePageVersion } from '@/hooks/pages';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSharedProps } from '@/lib/page';
import type { PageVersion, Page as WikiPage } from '@/types';

interface VersionsDialogProps {
  page: WikiPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the person may not restore (a viewer, an archived project), or null. */
  restoreReason: string | null;
  /** Saves what is typed first; false when the page cannot take a restored text right now (a conflict, a failure). */
  beforeRestore: () => Promise<boolean>;
}

function ListSkeleton() {
  return (
    <SkeletonGroup label={t('wiki.versions.loading')} className="flex flex-col gap-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-1.5 rounded-ctl px-3 py-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** The text of the chosen version, read on its own. */
function VersionText({ page, version }: { page: WikiPage; version: PageVersion }) {
  const text = usePageVersion(page.id, version.id);
  if (text.isError && !text.data) {
    return (
      <ErrorState
        title={t('wiki.versions.text_failed')}
        description={text.error.message || t('errors.no_answer')}
        onRetry={() => void text.refetch()}
        retrying={text.isFetching}
      />
    );
  }
  if (!text.data) {
    return (
      <SkeletonGroup label={t('wiki.versions.text_loading')} className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
      </SkeletonGroup>
    );
  }
  return text.data.content_json && !isEmptyDoc(text.data.content_json) ? (
    <RichTextView value={text.data.content_json} preset="page" />
  ) : (
    <p className="text-ui text-muted">{t('wiki.versions.no_text')}</p>
  );
}

export function VersionsDialog({ page, open, onOpenChange, restoreReason, beforeRestore }: VersionsDialogProps) {
  const versions = usePageVersions(open ? page.id : null);
  const restore = useRestorePageVersion();
  const users = useUserMap();
  const timeZone = useSharedProps().organization.timezone;
  const name = useId();
  const list = versions.data?.items ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = list.find((version) => version.id === chosenId) ?? list[0];
  /** A restore on its way, from the first press on (saving the own text comes first). */
  const [restoring, setRestoring] = useState(false);
  const busy = useRef(false);

  // every opening starts with the newest version
  useEffect(() => {
    if (open) setChosenId(null);
  }, [open]);

  const isCurrent = (version: PageVersion) => version.version === page.version;
  const reason = restoreReason ?? (chosen && isCurrent(chosen) ? t('wiki.versions.is_current') : null);
  const author = (version: PageVersion) => users.get(version.author_id)?.name ?? t('wiki.home.unknown_person');

  async function restoreChosen(version: PageVersion) {
    if (busy.current) return;
    busy.current = true;
    setRestoring(true);
    try {
      if (!(await beforeRestore())) return;
      await restore.mutateAsync({ page_id: page.id, version_id: version.id });
      toast({ title: t('wiki.versions.restored.title', { number: version.version }), description: t('wiki.versions.restored.description'), tone: 'success' });
      onOpenChange(false);
    } catch (error) {
      notifyError(t('wiki.versions.restore_failed', { number: version.version }), error, () => void restoreChosen(version));
    } finally {
      busy.current = false;
      setRestoring(false);
    }
  }

  const label = (version: PageVersion) => {
    const parts = { number: version.version, author: author(version), time: formatMoment(version.created_at, timeZone) };
    return isCurrent(version) ? t('wiki.versions.option_current', parts) : t('wiki.versions.option', parts);
  };

  let body;
  if (versions.isError && !versions.data) {
    body = (
      <ErrorState
        title={t('wiki.versions.failed')}
        description={versions.error.message || t('errors.no_answer')}
        onRetry={() => void versions.refetch()}
        retrying={versions.isFetching}
      />
    );
  } else if (!versions.data) {
    body = <ListSkeleton />;
  } else if (list.length === 0) {
    body = (
      <div className="dots flex flex-col items-center rounded-card border border-dashed border-line-strong bg-paper px-6 py-8 text-center">
        <History className="size-5 text-muted" aria-hidden="true" />
        <p className="mt-3 font-display text-md font-bold tracking-title text-ink">{t('wiki.versions.empty.title')}</p>
        <p className="mt-1 max-w-[46ch] text-ui text-pretty text-muted">{t('wiki.versions.empty.description')}</p>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div role="radiogroup" aria-label={t('wiki.versions.choose')} className="flex max-h-72 flex-col gap-1 overflow-y-auto overscroll-contain md:max-h-[min(26rem,55dvh)]">
          {list.map((version) => (
            <label
              key={version.id}
              className={cx(
                'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-ctl px-3 py-2 transition-colors duration-120 hover:bg-hover',
                'has-[:checked]:bg-raised has-[:checked]:shadow-elev-1 has-[:checked]:ring-1 has-[:checked]:ring-line-input has-[:checked]:ring-inset',
              )}
            >
              <input
                type="radio"
                name={name}
                value={version.id}
                checked={chosen?.id === version.id}
                onChange={() => setChosenId(version.id)}
                aria-label={label(version)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-ui font-semibold text-ink">
                  {t('wiki.versions.number', { number: version.version })}
                  {isCurrent(version) && <Chip className="h-5">{t('wiki.versions.current')}</Chip>}
                </span>
                <span className="truncate text-sm text-muted">{author(version)}</span>
                <span className="text-sm text-muted tabular-nums">{formatMoment(version.created_at, timeZone)}</span>
              </span>
            </label>
          ))}
        </div>
        {chosen && (
          <section aria-label={t('wiki.versions.preview')} className="min-w-0 rounded-card border border-line bg-surface px-4 py-3 shadow-elev-1">
            <p className="font-display text-lg font-bold tracking-title break-words text-ink">{chosen.title}</p>
            <div className="mt-2 max-h-72 overflow-y-auto overscroll-contain md:max-h-[min(22rem,48dvh)]">
              <VersionText key={chosen.id} page={page} version={chosen} />
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('wiki.versions.title', { title: page.title })}
      description={t('wiki.versions.description')}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">{t('common.close')}</Button>} />
          {chosen && (
            <Button variant="primary" icon={RotateCcw} pending={restoring} disabledReason={reason} onClick={() => void restoreChosen(chosen)}>
              {t('wiki.versions.restore')}
            </Button>
          )}
        </>
      }
    >
      {body}
    </Dialog>
  );
}
