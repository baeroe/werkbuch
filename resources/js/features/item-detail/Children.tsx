/*
 * The children of an item (spec 4.8): their progress (closed of all, `children_progress`, the bar in the type's tone)
 * and each child in a line with its status, key, title and assignee that opens it. "Kind-Item" opens the create dialog
 * with this item as parent and a type that may have a parent (`useChildType`); without such a type the button says why.
 * Only epics have children (two levels, `domain/hierarchy`): other items have no section. Without children and without
 * the right to create one (a viewer, an archived item or project), the section is left out as well.
 */

import { Plus } from 'lucide-react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useUserMap } from '@/components/fields/itemData';
import { canHaveChildren } from '@/domain/hierarchy';
import { intlLocale, t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { WorkItemDetail } from '@/types';
import { LinkedItem, Section, useChildType } from './shared';

export function Children({ detail }: { detail: WorkItemDetail }) {
  const { item, children, type } = detail;
  const { reason } = usePermissions();
  const users = useUserMap();
  const childType = useChildType(item.project_id);
  const canCreate = item.archived_at === null && reason('item.create', item.project_id) === null;
  if (!canHaveChildren(type) || (children.length === 0 && !canCreate)) return null;

  const progress = item.children_progress;
  return (
    <Section
      title={t('items.detail.children.title')}
      aside={children.length > 0 ? <span className="tabular-nums">{new Intl.NumberFormat(intlLocale()).format(children.length)}</span> : null}
      actions={
        canCreate && (
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            disabledReason={childType.reason}
            onClick={() => childType.typeId && useUiStore.getState().openCreate({ project_id: item.project_id, parent_id: item.id, type_id: childType.typeId })}
          >
            {t('items.detail.children.add')}
          </Button>
        )
      }
    >
      {children.length > 0 ? (
        <>
          {progress && <ProgressBar done={progress.done} total={progress.total} label={t('items.detail.children.progress')} tone={type.tone} className="mt-2" />}
          <ul className="-mx-2 mt-2 flex flex-col">
            {children.map((child) => {
              const assignee = child.assignee_id ? users.get(child.assignee_id) : undefined;
              return (
                <li key={child.id}>
                  <LinkedItem item={child} trailing={assignee ? <Avatar user={assignee} size="sm" /> : <UnassignedAvatar />} />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-ui text-pretty text-muted">{t('items.detail.children.empty')}</p>
      )}
    </Section>
  );
}
