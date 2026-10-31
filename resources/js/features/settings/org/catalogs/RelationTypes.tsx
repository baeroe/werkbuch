/*
 * Relation types (spec 4.9): how items can be connected. A type has a name and a label for each direction ("blocks"
 * and "is blocked by"), or one label when it is symmetric ("relates to"). The three built-in types (blocks, duplicate,
 * related) can be renamed but not deleted. Only "blocks" does anything: the blocked item shows a hint while its blocker
 * is open. Types of one's own are labels only. How many relations went with a deleted type comes with the items (P5).
 */

import { Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormDialog } from '@/components/ui/FormDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useDeleteRelationType, useRelationTypes, useSaveRelationType } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { t } from '@/lib/i18n';
import type { RelationType } from '@/types';
import { ReadOnlyNotice } from '../../frame/access';
import { fieldMessage, noticeOf } from '../../frame/form';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import { useRemoval } from '../../frame/useRemoval';
import type { SectionProps } from '../sections';

type RelationTypeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The type to change; null creates a new one. */
  type: RelationType | null;
  finalFocus: RefObject<HTMLElement | null>;
};

function RelationTypeDialog({ open, onOpenChange, type, finalFocus }: RelationTypeDialogProps) {
  const settle = useSettle();
  const save = useSaveRelationType();
  const [name, setName] = useState(type?.name ?? '');
  const [outward, setOutward] = useState(type?.outward_label ?? '');
  const [symmetric, setSymmetric] = useState(type ? type.inward_label === null : false);
  const [inward, setInward] = useState(type?.inward_label ?? '');
  const [attempted, setAttempted] = useState(false);
  // the field of the opposite direction appears when the switch goes off, and takes the focus then
  const focusInward = useRef(false);

  const nameError = attempted && name.trim() === '' ? t('settings.relation_types.dialog.name_required') : fieldMessage(save.error, 'name');
  const outwardError = attempted && outward.trim() === '' ? t('settings.relation_types.dialog.outward_required') : fieldMessage(save.error, 'outward_label');
  const inwardError = attempted && !symmetric && inward.trim() === '' ? t('settings.relation_types.dialog.inward_required') : fieldMessage(save.error, 'inward_label');

  function submit() {
    setAttempted(true);
    if (name.trim() === '' || outward.trim() === '' || (!symmetric && inward.trim() === '')) {
      document.getElementById(name.trim() === '' ? 'relation-name' : outward.trim() === '' ? 'relation-outward' : 'relation-inward')?.focus();
      return;
    }
    settle(save.mutateAsync({ id: type?.id, name, outward_label: outward, inward_label: symmetric ? null : inward, built_in: type?.built_in ?? null }), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: type ? t('settings.relation_types.dialog.saved', { name: saved.name }) : t('settings.relation_types.dialog.created', { name: saved.name }), tone: 'success' });
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={type ? t('settings.relation_types.edit', { name: type.name }) : t('settings.relation_types.create')}
      description={type?.built_in ? t('settings.relation_types.dialog.built_in_description') : t('settings.relation_types.dialog.description')}
      submitLabel={type ? t('settings.frame.save') : t('settings.catalog.submit_create')}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name', 'outward_label', 'inward_label'])}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      <Input
        id="relation-name"
        name="name"
        label={t('settings.catalog.name')}
        hint={t('settings.relation_types.dialog.name_hint')}
        autoComplete="off"
        value={name}
        error={nameError}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        id="relation-outward"
        name="outward_label"
        label={t('settings.relation_types.dialog.outward')}
        hint={t('settings.relation_types.dialog.outward_hint')}
        autoComplete="off"
        value={outward}
        error={outwardError}
        onChange={(event) => setOutward(event.target.value)}
      />
      <Switch
        label={t('settings.relation_types.dialog.symmetric')}
        checked={symmetric}
        onCheckedChange={(next) => {
          focusInward.current = !next;
          setSymmetric(next);
        }}
      />
      {!symmetric && (
        <Input
          ref={(field) => {
            if (field && focusInward.current) {
              focusInward.current = false;
              field.focus();
            }
          }}
          id="relation-inward"
          name="inward_label"
          label={t('settings.relation_types.dialog.inward')}
          hint={t('settings.relation_types.dialog.inward_hint')}
          autoComplete="off"
          value={inward}
          error={inwardError}
          onChange={(event) => setInward(event.target.value)}
        />
      )}
    </FormDialog>
  );
}

type TypeRowProps = {
  type: RelationType;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

function TypeRow({ type, canEdit, onEdit, onDelete }: TypeRowProps) {
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-ui font-medium break-words text-ink">{type.name}</h3>
          {type.built_in && <Badge tone="quiet">{t('settings.relation_types.built_in')}</Badge>}
          {type.inward_label === null && <Badge tone="quiet">{t('settings.relation_types.symmetric')}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">
          {t('settings.relation_types.item_a')} <span className="font-medium text-ink">{type.outward_label}</span> {t('settings.relation_types.item_b')}
        </p>
        {type.inward_label !== null && (
          <p className="text-sm text-muted">
            {t('settings.relation_types.item_b')} <span className="font-medium text-ink">{type.inward_label}</span> {t('settings.relation_types.item_a')}
          </p>
        )}
        {type.built_in === 'blocks' && <p className="mt-1 max-w-[60ch] text-sm text-pretty text-muted">{t('settings.relation_types.blocks_note')}</p>}
        {type.built_in && <p className="mt-1 text-sm text-muted">{t('settings.relation_types.not_deletable')}</p>}
      </div>
      {canEdit && (
        <div className="flex items-center">
          <IconButton icon={Pencil} label={t('settings.relation_types.edit', { name: type.name })} onClick={onEdit} />
          <IconButton
            icon={Trash2}
            label={t('settings.relation_types.delete', { name: type.name })}
            disabledReason={type.built_in ? t('settings.relation_types.built_in_reason', { name: type.name }) : null}
            onClick={onDelete}
          />
        </div>
      )}
    </Row>
  );
}

export default function RelationTypes({ readOnlyReason }: SectionProps) {
  const types = useRelationTypes();
  const remove = useDeleteRelationType();
  const dialog = useDialogRound<RelationType>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const create = useRef<HTMLButtonElement>(null);
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.relation_types')}
        description={t('settings.relation_types.description')}
        actions={
          canEdit && (
            <Button ref={create} variant="primary" icon={Plus} onClick={() => dialog.show()}>
              {t('settings.relation_types.create')}
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[types]} failure={t('settings.relation_types.load_failed')} skeleton={<RowsSkeleton rows={4} label={t('settings.relation_types.loading')} />}>
        {() => {
          const shown = (types.data?.items ?? []).filter((type) => !hidden.has(type.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Link2}
                title={t('settings.relation_types.empty.title')}
                description={t('settings.relation_types.empty.description')}
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      {t('settings.relation_types.create')}
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label={t('settings.org.section.relation_types')}>
                {shown.map((type) => (
                  <TypeRow
                    key={type.id}
                    type={type}
                    canEdit={canEdit}
                    onEdit={() => dialog.show(type)}
                    onDelete={() =>
                      removeWithUndo({
                        id: type.id,
                        label: t('settings.relation_types.deleted', { name: type.name }),
                        failureTitle: t('settings.relation_types.not_deleted', { name: type.name }),
                        run: () => remove.mutateAsync(type.id),
                      })
                    }
                  />
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <RelationTypeDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} type={dialog.target} finalFocus={dialog.returnFocus(create)} />
    </div>
  );
}
