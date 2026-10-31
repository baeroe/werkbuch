/*
 * Labels (spec 4.7): the organisation's list of tags, each with a name and one of the six muted tones. Items carry any
 * number of them. Deleting a label takes it off all items; the five seconds of undo come first. How many items carry a
 * label comes with the items (P6). Members see the list, admins change it.
 */

import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { ToneDot } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormDialog } from '@/components/ui/FormDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useDeleteLabel, useLabels, useSaveLabel } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { t } from '@/lib/i18n';
import type { Label, TypeTone } from '@/types';
import { TONE_LABELS } from '../../catalog/choices';
import { ToneSelect } from '../../catalog/ToneSelect';
import { ReadOnlyNotice } from '../../frame/access';
import { fieldMessage, noticeOf } from '../../frame/form';
import { FieldGroup, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import { useRemoval } from '../../frame/useRemoval';
import type { SectionProps } from '../sections';

type LabelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The label to change; null creates a new one. */
  label: Label | null;
  finalFocus: RefObject<HTMLElement | null>;
};

function LabelDialog({ open, onOpenChange, label, finalFocus }: LabelDialogProps) {
  const settle = useSettle();
  const save = useSaveLabel();
  const [name, setName] = useState(label?.name ?? '');
  const [tone, setTone] = useState<TypeTone>(label?.color ?? 'sky');
  const [attempted, setAttempted] = useState(false);
  const nameError = attempted && name.trim() === '' ? t('settings.labels.dialog.name_required') : fieldMessage(save.error, 'name');

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('label-name')?.focus();
      return;
    }
    settle(save.mutateAsync({ id: label?.id, name, color: tone }), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: label ? t('settings.labels.dialog.saved', { name: saved.name }) : t('settings.labels.dialog.created', { name: saved.name }), tone: 'success' });
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={label ? t('settings.labels.edit', { name: label.name }) : t('settings.labels.create')}
      submitLabel={label ? t('settings.frame.save') : t('settings.catalog.submit_create')}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name'])}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      <Input id="label-name" name="name" label={t('settings.catalog.name')} autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <FieldGroup legend={t('settings.labels.dialog.color')} hint={t('settings.labels.dialog.color_hint')}>
        <div className="flex items-center gap-3">
          <ToneSelect label={t('settings.labels.dialog.color_label')} value={tone} onChange={setTone} />
          <span className="text-ui text-muted" aria-hidden="true">
            {t(TONE_LABELS[tone])}
          </span>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}

export default function Labels({ readOnlyReason }: SectionProps) {
  const labels = useLabels();
  const remove = useDeleteLabel();
  const dialog = useDialogRound<Label>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const create = useRef<HTMLButtonElement>(null);
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.labels')}
        description={t('settings.labels.description')}
        actions={
          canEdit && (
            <Button ref={create} variant="primary" icon={Plus} onClick={() => dialog.show()}>
              {t('settings.labels.create')}
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[labels]} failure={t('settings.labels.load_failed')} skeleton={<RowsSkeleton rows={5} label={t('settings.labels.loading')} />}>
        {() => {
          const shown = (labels.data?.items ?? []).filter((label) => !hidden.has(label.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Tags}
                title={t('settings.labels.empty.title')}
                description={t('settings.labels.empty.description')}
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      {t('settings.labels.create')}
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label={t('settings.org.section.labels')}>
                {shown.map((label) => (
                  <Row key={label.id}>
                    <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                      <ToneDot tone={label.color} className="size-2.5" />
                      <h3 className="min-w-0 truncate text-ui font-medium text-ink">{label.name}</h3>
                    </div>
                    <span className="w-24 text-sm text-muted">{t(TONE_LABELS[label.color])}</span>
                    {canEdit && (
                      <div className="flex items-center">
                        <IconButton icon={Pencil} label={t('settings.labels.edit', { name: label.name })} onClick={() => dialog.show(label)} />
                        <IconButton
                          icon={Trash2}
                          label={t('settings.labels.delete', { name: label.name })}
                          onClick={() =>
                            removeWithUndo({
                              id: label.id,
                              label: t('settings.labels.deleted', { name: label.name }),
                              failureTitle: t('settings.labels.not_deleted', { name: label.name }),
                              run: () => remove.mutateAsync(label.id),
                            })
                          }
                        />
                      </div>
                    )}
                  </Row>
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <LabelDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} label={dialog.target} finalFocus={dialog.returnFocus(create)} />
    </div>
  );
}
