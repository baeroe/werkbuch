/*
 * Labels (spec 4.7): the organisation's list of tags, each with a name and one of the six muted tones. Items carry any
 * number of them. A label can name a model for agents (spec 7.7, `agent_model` `cli:model`): an item with it runs its agent
 * on that model, before the project's and the bot's; choosing one suggests the name "Haiku Agent". Deleting a label takes it off all items; the five seconds of undo come first, and a toast after the
 * call says how many items lost it (`affected_items`). Each row says how many items carry the label (A61). Members see the list, admins change it.
 */

import { Bot, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { ToneDot } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormDialog } from '@/components/ui/FormDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { CLI_NAMES, isModelLabel, modelLabelName, parseModel } from '@/domain/agents';
import { useDeleteLabel, useLabels, useSaveLabel } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { t, tn, tx } from '@/lib/i18n';
import type { Label, TypeTone } from '@/types';
import { TONE_LABELS } from '../../catalog/choices';
import { ToneSelect } from '../../catalog/ToneSelect';
import { ReadOnlyNotice } from '../../frame/access';
import { fieldMessage, noticeOf } from '../../frame/form';
import { Badge, FieldGroup, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import { useRemoval } from '../../frame/useRemoval';
import { UsageCount, UsageStatus, useGroupUsage } from '../../catalog/usage';
import { ModelChoice } from '../../agents/ModelField';
import type { SectionProps } from '../sections';

/** The model of a model label in its row: "Modell für Agenten: haiku", with the CLI when it is not Claude Code. */
function ModelBadge({ value }: { value: string }) {
  const ref = parseModel(value);
  return (
    <Badge icon={Bot}>
      {tx(ref && ref.cli !== 'claude' ? 'settings.labels.model_badge_cli' : 'settings.labels.model_badge', {
        model: <span translate="no">{ref?.model ?? value}</span>,
        cli: ref ? CLI_NAMES[ref.cli] : '',
      })}
    </Badge>
  );
}

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
  const [model, setModel] = useState<string | null>(label?.agent_model ?? null);
  const [attempted, setAttempted] = useState(false);

  // the name follows the model while it is empty or still the suggestion of the model before
  function chooseModel(next: string | null) {
    if (name.trim() === '' || name === modelLabelName(parseModel(model)?.model ?? '')) setName(modelLabelName(parseModel(next)?.model ?? ''));
    setModel(next);
  }
  const nameError = attempted && name.trim() === '' ? t('settings.labels.dialog.name_required') : fieldMessage(save.error, 'name');

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('label-name')?.focus();
      return;
    }
    settle(save.mutateAsync({ id: label?.id, name, color: tone, agent_model: model }), {
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
      notice={noticeOf(save.error, ['name', 'agent_model'])}
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
      <ModelChoice
        id="label-model"
        label={t('settings.labels.dialog.model')}
        value={model}
        onChange={chooseModel}
        inherit={t('settings.labels.dialog.no_model')}
        hint={t('settings.labels.dialog.model_hint')}
        error={fieldMessage(save.error, 'agent_model')}
      />
    </FormDialog>
  );
}

export default function Labels({ readOnlyReason }: SectionProps) {
  const labels = useLabels();
  const remove = useDeleteLabel();
  const dialog = useDialogRound<Label>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const create = useRef<HTMLButtonElement>(null);
  const usage = useGroupUsage('label');
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
              {/* one status for the counts of the whole list (T23-M8) */}
              <UsageStatus usage={usage} />
              <Rows label={t('settings.org.section.labels')}>
                {shown.map((label) => (
                  <Row key={label.id}>
                    <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                      <ToneDot tone={label.color} className="size-2.5" />
                      <h3 className="min-w-0 truncate text-ui font-medium text-ink">{label.name}</h3>
                    </div>
                    {isModelLabel(label) && <ModelBadge value={label.agent_model!} />}
                    <span className="w-24 text-sm text-muted">{t(TONE_LABELS[label.color])}</span>
                    <span className="w-28 text-sm text-muted tabular-nums">
                      <UsageCount usage={usage} id={label.id} />
                    </span>
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
                              onDone: ({ affected_items }) => {
                                if (affected_items > 0) toast({ title: tn('settings.labels.removed_from', affected_items, { name: label.name }), tone: 'success' });
                              },
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
