/*
 * Archived (spec 4.8): read-only and out of the lists; who may change the item can bring it back right here. The day
 * is the organisation's. When "Wiederherstellen" goes away with the note, the focus goes to the title.
 */

import { Archive, ArchiveRestore } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { useRestoreWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import type { WorkItem } from '@/types';
import { focusWhenLost, useInstantDay } from '../shared';

/** Restores with its confirmation; a failure names itself (the item mutation's toast). */
export function useRestore(item: WorkItem): { restore: () => void; pending: boolean } {
  const settle = useSettle();
  const mutation = useRestoreWorkItem();
  return {
    restore: () => settle(mutation.mutateAsync(item.id), { onSuccess: () => toast({ title: t('items.detail.restored', { key: item.key }), tone: 'success' }) }),
    pending: mutation.isPending,
  };
}

export function ArchivedNote({ item }: { item: WorkItem }) {
  const { reason } = usePermissions();
  const { restore, pending } = useRestore(item);
  const day = useInstantDay();
  if (item.archived_at === null) return null;
  const allowed = reason('item.edit', item.project_id) === null;
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl bg-sunken px-3 py-2">
      <Archive className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-ui text-pretty text-ink">
        <span className="font-semibold">{t('items.detail.archived.title', { day: day(item.archived_at) })}</span> {t('items.detail.archived.description')}
      </p>
      {allowed && (
        <button
          type="button"
          onClick={(event) => {
            const detail = event.currentTarget.closest('[data-item-detail]');
            restore();
            // the note goes with the restore, and its button with it: the title of the same detail takes the focus
            focusWhenLost(() => detail?.querySelector<HTMLElement>('[data-item-title]'));
          }}
          disabled={pending}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-ctl border border-line-strong bg-surface px-2.5 text-sm font-semibold text-ink shadow-elev-1 transition-colors duration-120 hover:bg-sunken md:h-7"
        >
          <ArchiveRestore className="size-4 text-muted" aria-hidden="true" />
          {t('items.detail.restore')}
        </button>
      )}
    </div>
  );
}
