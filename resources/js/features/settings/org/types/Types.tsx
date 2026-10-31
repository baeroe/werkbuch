/*
 * Types (spec 4.6): Task, Bug and Epic come with werkbuch, more can be added. A type has a name, an icon and a tone (the
 * tab of its index cards), a description, the Epic mark (its items appear on the timeline) and the properties it
 * carries, each required or not, in the order the form shows them. An active type can be deleted, after the five seconds
 * of undo; the default type of a project cannot (409 `default_type`, the toast names the projects). An archived one can
 * be restored. How many items use a type, and archiving instead of deleting a type that items carry, come with the
 * items (P6, P28). Members see the list, admins change it.
 */

import { ArchiveRestore, Pencil, Plus, Route, Shapes, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { toast } from '@/components/ui/toast';
import { TypeTab } from '@/components/ui/TypeTab';
import { useProperties } from '@/hooks/properties';
import { useDeleteWorkItemType, useSaveWorkItemType, useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Property, WorkItemType } from '@/types';
import { ReadOnlyNotice } from '../../frame/access';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import { useRemoval } from '../../frame/useRemoval';
import type { SectionProps } from '../sections';
import { TypeDialog } from './TypeDialog';

/** The properties of a type in their order, as chips; the required ones say so. */
function PropertyChips({ type, byId }: { type: WorkItemType; byId: Map<string, Property> }) {
  const entries = [...type.properties].sort((a, b) => a.position - b.position).filter((entry) => byId.has(entry.property_id));
  if (entries.length === 0) return null;
  return (
    <ul aria-label={t('settings.types.properties_of', { name: type.name })} className="mt-2 flex flex-wrap gap-1.5">
      {entries.map((entry) => {
        const label = byId.get(entry.property_id)!.label;
        return (
          <li key={entry.property_id}>
            <Chip>{entry.required ? t('settings.types.required_chip', { label }) : label}</Chip>
          </li>
        );
      })}
    </ul>
  );
}

export default function Types({ readOnlyReason }: SectionProps) {
  const settle = useSettle();
  const types = useWorkItemTypes();
  const properties = useProperties();
  const remove = useDeleteWorkItemType();
  const save = useSaveWorkItemType();
  const dialog = useDialogRound<WorkItemType>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const create = useRef<HTMLButtonElement>(null);
  const canEdit = readOnlyReason === null;
  const byId = new Map((properties.data?.items ?? []).map((property) => [property.id, property]));

  function restore(type: WorkItemType) {
    // the whole type (P24), only without its archive stamp
    const spec = {
      id: type.id,
      name: type.name,
      icon: type.icon,
      tone: type.tone,
      description: type.description,
      is_epic: type.is_epic,
      properties: [...type.properties].sort((a, b) => a.position - b.position).map(({ property_id, required }) => ({ property_id, required })),
      archived_at: null,
    };
    settle(save.mutateAsync(spec), {
      onSuccess: () => toast({ title: t('settings.types.restored', { name: type.name }), description: t('settings.types.restored_description'), tone: 'success' }),
      onError: (error) => notifyError(t('settings.types.not_restored', { name: type.name }), error, () => restore(type)),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.types')}
        description={t('settings.types.description')}
        actions={
          canEdit && (
            <Button ref={create} variant="primary" icon={Plus} onClick={() => dialog.show()}>
              {t('settings.types.create')}
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[types, properties]} failure={t('settings.types.load_failed')} skeleton={<RowsSkeleton rows={4} label={t('settings.types.loading')} />}>
        {() => {
          const shown = (types.data?.items ?? []).filter((type) => !hidden.has(type.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Shapes}
                title={t('settings.types.empty.title')}
                description={t('settings.types.empty.description')}
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      {t('settings.types.create')}
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label={t('settings.org.section.types')}>
                {shown.map((type) => (
                  <Row key={type.id} className="items-start">
                    <div className="min-w-0 flex-1 basis-72">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 text-ui">
                          <TypeTab tone={type.tone} icon={type.icon} label={type.name} />
                        </h3>
                        {type.is_epic && (
                          <Badge tone="quiet" icon={Route}>
                            {t('settings.types.timeline')}
                          </Badge>
                        )}
                        {type.archived_at !== null && <Badge tone="quiet">{t('settings.types.archived')}</Badge>}
                      </div>
                      {type.description && <p className="mt-1.5 max-w-[65ch] text-ui text-pretty text-muted">{type.description}</p>}
                      <PropertyChips type={type} byId={byId} />
                    </div>
                    {canEdit && (
                      <div className="flex items-center">
                        <IconButton icon={Pencil} label={t('settings.types.edit', { name: type.name })} onClick={() => dialog.show(type)} />
                        {type.archived_at !== null ? (
                          <IconButton icon={ArchiveRestore} label={t('settings.types.restore', { name: type.name })} onClick={() => restore(type)} />
                        ) : (
                          <IconButton
                            icon={Trash2}
                            label={t('settings.types.delete', { name: type.name })}
                            onClick={() =>
                              removeWithUndo({
                                id: type.id,
                                label: t('settings.types.deleted', { name: type.name }),
                                failureTitle: t('settings.types.not_deleted', { name: type.name }),
                                run: () => remove.mutateAsync(type.id),
                              })
                            }
                          />
                        )}
                      </div>
                    )}
                  </Row>
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <TypeDialog
        key={dialog.round}
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        type={dialog.target}
        properties={properties.data?.items ?? []}
        finalFocus={dialog.returnFocus(create)}
      />
    </div>
  );
}
