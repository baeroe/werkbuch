/*
 * The children of an item (spec 4.8): their progress (closed of all, the bar in the type's tone) and each child in a
 * line that opens it. "Sub-Item" opens the create dialog with this item as parent. Only epics have children (two
 * levels, `domain/hierarchy`): other items have no section. Without children and without the right to create one, the
 * section is left out as well.
 */

import { Plus } from 'lucide-react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useUserMap } from '@/components/fields/itemData';
import { canHaveChildren } from '@/domain/hierarchy';
import { childProgress } from '@/domain/progress';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { WorkItemDetail } from '@/types';
import { LinkedItem, Section } from './shared';

export function Children({ detail }: { detail: WorkItemDetail }) {
  const { item, children, workflow, type } = detail;
  const { reason } = usePermissions();
  const users = useUserMap();
  const createReason = item.archived_at ? 'Archivierte Items bekommen keine neuen Kinder.' : reason('item.create', item.project_id);
  if (!canHaveChildren(type) || (children.length === 0 && createReason)) return null;

  const categoryOf = (stateId: string) => workflow.states.find((state) => state.id === stateId)?.category ?? 'backlog';
  const progress = childProgress(children, categoryOf);

  return (
    <Section
      title="Kinder"
      aside={children.length > 0 ? <span className="tabular-nums">{new Intl.NumberFormat('de-DE').format(children.length)}</span> : null}
      actions={
        !createReason && (
          <Button variant="ghost" size="sm" icon={Plus} onClick={() => useUiStore.getState().openCreate({ project_id: item.project_id, parent_id: item.id })}>
            Sub-Item
          </Button>
        )
      }
    >
      {children.length > 0 ? (
        <>
          <ProgressBar done={progress.done} total={progress.total} label="Fortschritt der Kind-Items" tone={type.tone} className="mt-2" />
          <ul className="-mx-2 mt-2 flex flex-col">
            {children.map((child) => {
              const assignee = child.assignee_id ? users.get(child.assignee_id) : undefined;
              return (
                <li key={child.id}>
                  <LinkedItem
                    item={child}
                    trailing={assignee ? <Avatar user={assignee} size="sm" /> : <UnassignedAvatar />}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-ui text-pretty text-muted">Noch keine Kind-Items. Teile die Arbeit auf, dann zeigt sich hier der Fortschritt.</p>
      )}
    </Section>
  );
}
