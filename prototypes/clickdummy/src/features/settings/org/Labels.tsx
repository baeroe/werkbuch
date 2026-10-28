/*
 * Labels (spec 4.7): the organisation's list of tags, each with a name and one of the six muted tones. Items carry any
 * number of them. Deleting a label takes it off all items; the five seconds of undo come first, and the count of the
 * items that had it is told afterwards. Members see the list, admins change it.
 */

import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ToneDot } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { useDeleteLabel, useLabels, useSaveLabel } from '@/hooks/catalog';
import type { Label, TypeTone } from '@/types';
import { ReadOnlyNotice } from './access';
import { TONE_NAMES } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { counted } from './format';
import { FormDialog } from './FormDialog';
import { FieldGroup, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader, TonePicker } from './parts';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';
import { useItemCount } from './usage';
import { useRemoval } from './useRemoval';

function LabelDialog({ open, onOpenChange, label }: { open: boolean; onOpenChange: (open: boolean) => void; label: Label | null }) {
  const save = useSaveLabel();
  const [name, setName] = useState(label?.name ?? '');
  const [tone, setTone] = useState<TypeTone>(label?.color ?? 'sky');
  const [attempted, setAttempted] = useState(false);
  const nameError = attempted && name.trim() === '' ? 'Gib dem Label einen Namen.' : fieldMessage(save.error, 'name');

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('label-name')?.focus();
      return;
    }
    save.mutate(
      { id: label?.id, name, color: tone },
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast({ title: label ? `Label „${saved.name}“ gespeichert` : `Label „${saved.name}“ ist angelegt`, tone: 'success' });
        },
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={label ? `Label „${label.name}“ bearbeiten` : 'Label anlegen'}
      submitLabel={label ? 'Speichern' : 'Anlegen'}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name', 'color'])}
      onSubmit={submit}
    >
      <Input id="label-name" name="name" label="Name" autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <FieldGroup legend="Farbe" hint="Die Farbe hilft beim Überfliegen. Der Name steht immer dabei.">
        <TonePicker label="Farbe des Labels" value={tone} onChange={setTone} />
      </FieldGroup>
    </FormDialog>
  );
}

/** How many items carry the label; the count comes from the items themselves. */
function Usage({ id }: { id: string }) {
  const count = useItemCount({ field: 'label', op: 'in', value: [id] });
  if (count === undefined) return <Skeleton className="h-4 w-20" />;
  return <span className="tabular-nums">{count === 0 ? 'Bei keinem Item' : `Bei ${counted(count, 'Item', 'Items')}`}</span>;
}

export default function Labels({ readOnlyReason }: SectionProps) {
  const labels = useLabels();
  const remove = useDeleteLabel();
  const dialog = useDialogRound<Label>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Labels"
        description="Schlagwörter für Items. Ein Item kann mehrere tragen, in jedem Projekt."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
              Label anlegen
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[labels]} failure="Die Labels konnten nicht geladen werden" skeleton={<RowsSkeleton rows={5} label="Die Labels werden geladen …" />}>
        {() => {
          const shown = (labels.data?.items ?? []).filter((label) => !hidden.has(label.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Tags}
                title="Noch keine Labels"
                description="Mit Labels ordnest du Items nach Themen, etwa „Formulare“ oder „Performance“."
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      Label anlegen
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label="Labels">
                {shown.map((label) => (
                  <Row key={label.id}>
                    <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                      <ToneDot tone={label.color} className="size-2.5" />
                      <h3 className="min-w-0 truncate text-ui font-medium text-ink">{label.name}</h3>
                    </div>
                    <span className="w-24 text-sm text-muted">{TONE_NAMES[label.color]}</span>
                    <span className="min-w-28 text-sm text-muted">
                      <Usage id={label.id} />
                    </span>
                    {canEdit && (
                      <div className="flex items-center">
                        <IconButton icon={Pencil} label={`Label „${label.name}“ bearbeiten`} onClick={() => dialog.show(label)} />
                        <IconButton
                          icon={Trash2}
                          label={`Label „${label.name}“ löschen`}
                          onClick={() =>
                            removeWithUndo({
                              id: label.id,
                              label: `Label „${label.name}“ gelöscht`,
                              failureTitle: `Label „${label.name}“ nicht gelöscht`,
                              run: async () => {
                                const { affected_items } = await remove.mutateAsync(label.id);
                                if (affected_items > 0) toast({ title: `Label „${label.name}“ ist von ${counted(affected_items, 'Item', 'Items')} entfernt` });
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
      <LabelDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} label={dialog.target} />
    </div>
  );
}
