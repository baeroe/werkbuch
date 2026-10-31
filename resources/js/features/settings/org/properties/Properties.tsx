/*
 * Properties (spec 4.7): the fields types are made of. A property has a label, a help text, a default value and one of
 * eight field types. Its key (`snake_case`, the name in API and MCP) and its field type are fixed once it exists; only a
 * dropdown or a choice of people may change from single to multiple choice. Options have a label and a tone, can be put
 * in order and are archived instead of deleted. Deleting a property asks first (spec 4.7); how many items lose their
 * value comes with the items (P6). Members see the list, admins change it.
 */

import { Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { toast } from '@/components/ui/toast';
import { useDeleteProperty, useProperties } from '@/hooks/properties';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Property, WorkItemType } from '@/types';
import { FIELD_TYPE_LABELS } from '../../catalog/choices';
import { ReadOnlyNotice } from '../../frame/access';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import type { SectionProps } from '../sections';
import { PropertyDialog } from './PropertyDialog';

const typesWith = (property: Property, types: WorkItemType[]) => types.filter((type) => type.properties.some((entry) => entry.property_id === property.id));

export default function Properties({ readOnlyReason }: SectionProps) {
  const settle = useSettle();
  const properties = useProperties();
  const types = useWorkItemTypes();
  const remove = useDeleteProperty();
  const dialog = useDialogRound<Property>();
  const create = useRef<HTMLButtonElement>(null);
  // the property in question stays while the question fades out, so its title does not change on the way
  const [question, setQuestion] = useState<{ property: Property; open: boolean } | null>(null);
  // where the focus goes when the question closes: back to "Delete", or on to the next row once the property is gone
  const deleteButton = useRef<HTMLElement | null>(null);
  const afterDelete = useRef<HTMLElement | null>(null);
  const deleteFocus = {
    get current() {
      return afterDelete.current ?? deleteButton.current;
    },
  };
  const canEdit = readOnlyReason === null;

  function askDelete(property: Property, button: HTMLElement) {
    deleteButton.current = button;
    afterDelete.current = null;
    setQuestion({ property, open: true });
  }

  const asking = useRef(false);
  asking.current = question?.open === true;
  const close = () => setQuestion((current) => current && { ...current, open: false });

  function confirmDelete(property: Property) {
    const row = deleteButton.current?.closest('li');
    const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
    settle(remove.mutateAsync(property.id), {
      onSuccess: () => {
        // the next row, the one before, or "Create property" above the empty list
        afterDelete.current = neighbour?.querySelector<HTMLElement>('button') ?? create.current;
        // a retry from the error toast runs without the question: nothing closes that would move the focus
        if (asking.current) close();
        else afterDelete.current?.focus();
        toast({ title: t('settings.properties.deleted', { label: property.label }), tone: 'success' });
      },
      onError: (error) => {
        close();
        notifyError(t('settings.properties.not_deleted', { label: property.label }), error, () => confirmDelete(property));
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.properties')}
        description={t('settings.properties.description')}
        actions={
          canEdit && (
            <Button ref={create} variant="primary" icon={Plus} onClick={() => dialog.show()}>
              {t('settings.properties.create')}
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[properties, types]} failure={t('settings.properties.load_failed')} skeleton={<RowsSkeleton rows={5} label={t('settings.properties.loading')} />}>
        {() => {
          const shown = properties.data?.items ?? [];
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={SlidersHorizontal}
                title={t('settings.properties.empty.title')}
                description={t('settings.properties.empty.description')}
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      {t('settings.properties.create')}
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label={t('settings.org.section.properties')}>
                {shown.map((property) => {
                  const users = typesWith(property, types.data?.items ?? []);
                  const options = [...property.options].filter((option) => option.archived_at === null).sort((a, b) => a.position - b.position);
                  return (
                    <Row key={property.id} className="items-start">
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-ui font-medium break-words text-ink">{property.label}</h3>
                          <Badge tone="quiet">{t(FIELD_TYPE_LABELS[property.field_type])}</Badge>
                          {property.settings.multiple && <Badge tone="quiet">{t('settings.properties.multiple')}</Badge>}
                        </div>
                        <p className="mt-0.5 text-sm text-muted">
                          {t('settings.properties.key')} <span translate="no">{property.key}</span>
                        </p>
                        {property.help && <p className="mt-1 max-w-[65ch] text-sm text-pretty text-muted">{property.help}</p>}
                        {options.length > 0 && (
                          <ul aria-label={t('settings.properties.options_of', { label: property.label })} className="mt-2 flex flex-wrap gap-1.5">
                            {options.map((option) => (
                              <li key={option.id}>
                                <Chip dot={option.color}>{option.label}</Chip>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 basis-60 text-sm text-muted">
                        <p>{users.length === 0 ? t('settings.properties.in_no_type') : t('settings.properties.used_in', { types: users.map((type) => type.name).join(', ') })}</p>
                      </div>
                      {canEdit && (
                        <div className="flex items-center">
                          <IconButton icon={Pencil} label={t('settings.properties.edit', { label: property.label })} onClick={() => dialog.show(property)} />
                          <IconButton
                            icon={Trash2}
                            label={t('settings.properties.delete', { label: property.label })}
                            onClick={(event) => askDelete(property, event.currentTarget)}
                          />
                        </div>
                      )}
                    </Row>
                  );
                })}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <PropertyDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} property={dialog.target} finalFocus={dialog.returnFocus(create)} />
      <AlertDialog
        open={question?.open === true}
        onOpenChange={(open) => !open && close()}
        title={t('settings.properties.delete_title', { label: question?.property.label ?? '' })}
        description={t('settings.properties.delete_description')}
        confirmLabel={t('settings.properties.delete_confirm')}
        pending={remove.isPending}
        finalFocus={deleteFocus}
        onConfirm={() => question && confirmDelete(question.property)}
      />
    </div>
  );
}
