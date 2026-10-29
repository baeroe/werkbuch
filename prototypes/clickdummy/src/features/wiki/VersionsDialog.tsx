/*
 * The kept versions of a wiki page (spec 4.15): who saved them and when, the text of each to read, and "Diese Version
 * wiederherstellen". A version is kept after ten minutes without an edit and before a foreign version is overwritten;
 * restoring makes the old text the current one as a new version, and the state it replaces is kept first.
 */

import { History, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { RichTextView } from '@/features/editor/RichTextEditor';
import { usePageVersions, useRestorePageVersion } from '@/hooks/pages';
import { notifyError } from '@/lib/errors';
import type { Page as WikiPage, PageVersion } from '@/types';
import { useStamp } from './format';

type VersionsDialogProps = {
  page: WikiPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the person may not restore (a viewer), or null. */
  restoreReason: string | null;
  /** Saves what is typed first; false when the page cannot take a restored text right now (a conflict). */
  beforeRestore: () => Promise<boolean>;
};

function VersionsSkeleton() {
  return (
    <SkeletonGroup label="Versionen werden geladen …" className="flex flex-col gap-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-1.5 rounded-ctl px-3 py-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function VersionsDialog({ page, open, onOpenChange, restoreReason, beforeRestore }: VersionsDialogProps) {
  const versions = usePageVersions(open ? page.id : null);
  const restore = useRestorePageVersion();
  const users = useUserMap();
  const stamp = useStamp();
  const name = useId();
  const list = versions.data?.items ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = list.find((version) => version.id === chosenId) ?? list[0];

  // every opening starts with the newest version
  useEffect(() => {
    if (open) setChosenId(null);
  }, [open]);

  const current = (version: PageVersion) => version.version === page.version;
  const reason = restoreReason ?? (chosen && current(chosen) ? 'Das ist die Fassung, die gerade gilt.' : null);

  async function restoreChosen(version: PageVersion) {
    if (!(await beforeRestore())) return;
    try {
      await restore.mutateAsync({ page_id: page.id, version_id: version.id });
      toast({ title: `Version ${version.version} wiederhergestellt`, description: 'Die Fassung davor bleibt als Version erhalten.', tone: 'success' });
      onOpenChange(false);
    } catch (error) {
      notifyError(`Version ${version.version} nicht wiederhergestellt`, error, () => void restoreChosen(version));
    }
  }

  const label = (version: PageVersion) => {
    const author = users.get(version.author_id)?.name ?? 'Unbekannt';
    return `Version ${version.version}, ${author}, ${stamp(version.created_at)}${current(version) ? ', aktuell' : ''}`;
  };

  let body;
  if (versions.isPending) {
    body = <VersionsSkeleton />;
  } else if (versions.isError) {
    body = (
      <ErrorState
        title="Die Versionen konnten nicht geladen werden"
        description={versions.error instanceof ApiError ? versions.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void versions.refetch()}
        retrying={versions.isFetching}
      />
    );
  } else if (list.length === 0) {
    body = (
      <div className="dots flex flex-col items-center rounded-card border border-dashed border-line-strong bg-paper px-6 py-8 text-center">
        <History className="size-5 text-muted" aria-hidden="true" />
        <p className="mt-3 font-display text-md font-bold tracking-title text-ink">Noch keine Versionen</p>
        <p className="mt-1 max-w-[46ch] text-ui text-pretty text-muted">
          Eine Version entsteht nach zehn Minuten Pause im Schreiben und bevor jemand die Fassung einer anderen Person überschreibt.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div role="radiogroup" aria-label="Version wählen" className="flex max-h-72 flex-col gap-1 overflow-y-auto overscroll-contain md:max-h-[min(26rem,55dvh)]">
          {list.map((version) => {
            const author = users.get(version.author_id)?.name ?? 'Unbekannt';
            return (
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
                    Version {version.version}
                    {current(version) && <Chip className="h-5">aktuell</Chip>}
                  </span>
                  <span className="truncate text-sm text-muted">{author}</span>
                  <span className="text-sm text-muted tabular-nums">{stamp(version.created_at)}</span>
                </span>
              </label>
            );
          })}
        </div>
        {chosen && (
          <section aria-label="Vorschau" className="min-w-0 rounded-card border border-line bg-surface px-4 py-3 shadow-elev-1">
            <p className="font-display text-lg font-bold tracking-title break-words text-ink">{chosen.title}</p>
            <div className="mt-2 max-h-72 overflow-y-auto overscroll-contain md:max-h-[min(22rem,48dvh)]">
              <RichTextView value={chosen.content} />
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
      title={`Versionen von „${page.title}“`}
      description="Wähle eine Version, um sie zu lesen. Wiederherstellen macht sie zur aktuellen Fassung; die Fassung davor bleibt erhalten."
      footer={
        <>
          <DialogClose render={<Button variant="ghost">Schließen</Button>} />
          {chosen && (
            <Button variant="primary" icon={RotateCcw} pending={restore.isPending} disabledReason={reason} onClick={() => void restoreChosen(chosen)}>
              Diese Version wiederherstellen
            </Button>
          )}
        </>
      }
    >
      {body}
    </Dialog>
  );
}
