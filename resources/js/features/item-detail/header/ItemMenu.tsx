/*
 * The actions of the detail's header: watch (on and off), copy the link, in the preview "Als Seite öffnen", and the
 * "more" menu with the item's own actions: a child item (epics only; without a type that can be a child the entry says
 * why instead of a toast, 13c), a relation (the dialog of the relations section, as `r`), archive (closed items only)
 * or restore, delete (with the right `item.delete`). Archive and delete wait for their undo toast (5 s,
 * `useItemRemoval`).
 */

import { Link } from '@inertiajs/react';
import { Archive, ArchiveRestore, ArrowRightLeft, CornerDownRight, Ellipsis, Eye, Link2, Maximize2, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useEditReason } from '@/components/fields/itemData';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { canHaveChildren } from '@/domain/hierarchy';
import { isClosedCategory } from '@/domain/workflow';
import { useSettle } from '@/hooks/mutation';
import { useSetSubscribed } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { appUrl, paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useUiStore } from '@/store/ui';
import type { WorkItem, WorkItemDetail } from '@/types';
import { useChildType, useDetail } from '../shared';
import { useRestore } from './ArchivedNote';
import { useItemRemoval } from './useItemRemoval';

export function WatchButton({ detail }: { detail: WorkItemDetail }) {
  const settle = useSettle();
  const watch = useSetSubscribed();
  const { item, subscribed } = detail;
  const toggle = () =>
    settle(watch.mutateAsync({ id: item.id, on: !subscribed }), {
      onSuccess: () =>
        toast(
          subscribed
            ? { title: t('items.detail.watch.off', { key: item.key }), description: t('items.detail.watch.off_description') }
            : { title: t('items.detail.watch.on', { key: item.key }), description: t('items.detail.watch.on_description'), tone: 'success' },
        ),
    });
  return <IconButton icon={Eye} label={t('items.detail.watch.label')} aria-pressed={subscribed} onClick={toggle} />;
}

export function CopyLinkButton({ item }: { item: WorkItem }) {
  const copy = async () => {
    const url = appUrl(paths.item(item.key));
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t('items.detail.link.copied', { key: item.key }), tone: 'success' });
    } catch {
      toast({ title: t('items.detail.link.failed'), description: t('items.detail.link.failed_description', { url }), tone: 'error' });
    }
  };
  return <IconButton icon={Link2} label={t('items.detail.link.copy')} onClick={() => void copy()} />;
}

/** The preview's way to the item's page. */
export function OpenAsPage({ item }: { item: WorkItem }) {
  const label = t('items.detail.open_page');
  return (
    <Tooltip content={label}>
      <Link
        href={paths.item(item.key)}
        aria-label={label}
        className="inline-flex size-11 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-7"
      >
        <Maximize2 className="size-4" aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

/** A menu entry that cannot act now: it stays, greyed, and says why under its name. */
function Refused({ children, reason }: { children: ReactNode; reason: string }) {
  return (
    <>
      <span className="block truncate">{children}</span>
      <span className="block text-sm whitespace-normal text-muted">{reason}</span>
    </>
  );
}

export function ItemMenu({ detail }: { detail: WorkItemDetail }) {
  const { item, state } = detail;
  const { can, reason } = usePermissions();
  const { restore } = useRestore(item);
  const removal = useItemRemoval(item);
  const editReason = useEditReason(item);
  const { actions } = useDetail();
  const child = useChildType(item.project_id);
  const archived = item.archived_at !== null;
  const closed = isClosedCategory(state.category);
  const canDelete = can('item.delete', item.project_id);
  // a child item only under an epic (two levels, domain/hierarchy)
  const canCreate = !archived && canHaveChildren(detail.type) && can('item.create', item.project_id);
  const canRestore = archived && reason('item.edit', item.project_id) === null;
  const canArchive = !archived && closed && !editReason;
  const removeKeys = SHORTCUTS['item.remove'].keys;

  // the menu holds only what the person may do; with nothing to offer there is no menu
  const sections: ReactNode[] = [
    (canCreate || !editReason) && (
      <MenuGroup key="add">
        {canCreate && (
          <MenuItem
            icon={CornerDownRight}
            disabled={child.typeId === null}
            onClick={() => useUiStore.getState().openCreate({ project_id: item.project_id, parent_id: item.id, type_id: child.typeId! })}
          >
            {child.reason ? <Refused reason={child.reason}>{t('items.detail.child.create')}</Refused> : t('items.detail.child.create')}
          </MenuItem>
        )}
        {!editReason && (
          <MenuItem icon={ArrowRightLeft} shortcut={SHORTCUTS['item.relation'].keys} onClick={() => actions.current.addRelation?.()}>
            {t('items.detail.relations.menu')}
          </MenuItem>
        )}
      </MenuGroup>
    ),
    (canRestore || canArchive || canDelete) && (
      <MenuGroup key="remove">
        {canRestore && (
          <MenuItem icon={ArchiveRestore} onClick={restore}>
            {t('items.detail.restore')}
          </MenuItem>
        )}
        {canArchive && (
          <MenuItem icon={Archive} shortcut={removeKeys} onClick={removal.archive}>
            {t('items.commands.archive')}
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem icon={Trash2} danger shortcut={canArchive ? undefined : removeKeys} onClick={removal.remove}>
            {t('items.commands.delete')}
          </MenuItem>
        )}
      </MenuGroup>
    ),
  ].filter(Boolean);
  if (sections.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger render={<IconButton icon={Ellipsis} label={t('items.detail.more')} tooltip={false} />} />
      <MenuContent align="end" className="w-64">
        {sections.map((section, index) => (
          <Fragment key={index}>
            {index > 0 && <MenuSeparator />}
            {section}
          </Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}
