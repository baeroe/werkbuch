/*
 * Resolutions (spec 4.7): how an item ends. Moving into a status of the category Completed or Canceled sets one, chosen
 * or the default of the category; moving back clears it. Each category has exactly one default, and a new default takes
 * the mark from the old one. A default cannot be deleted or archived. One that items carry is archived instead of
 * deleted: it can no longer be chosen but stays on the items that have it.
 */

import { BadgeCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useDeleteResolution, useResolutions, useSaveResolution } from '@/hooks/catalog';
import { now } from '@/lib/clock';
import type { Resolution } from '@/types';
import { ReadOnlyNotice } from './access';
import { CATEGORY_NAMES } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { FormDialog } from './FormDialog';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from './parts';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';
import { useRemoval } from './useRemoval';

type Default = Resolution['default_for'];

const DEFAULT_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'Keiner' },
  { value: 'completed', label: CATEGORY_NAMES.completed },
  { value: 'canceled', label: CATEGORY_NAMES.canceled },
];

const defaultText = (resolution: Resolution) => (resolution.default_for ? `Standard für ${CATEGORY_NAMES[resolution.default_for]}` : null);

function ResolutionDialog({ open, onOpenChange, resolution }: { open: boolean; onOpenChange: (open: boolean) => void; resolution: Resolution | null }) {
  const save = useSaveResolution();
  const [label, setLabel] = useState(resolution?.label ?? '');
  const [standard, setStandard] = useState<Default>(resolution?.default_for ?? null);
  const [archived, setArchived] = useState(resolution?.archived_at != null);
  const [attempted, setAttempted] = useState(false);
  const labelError = attempted && label.trim() === '' ? 'Gib der Resolution ein Label.' : fieldMessage(save.error, 'label');

  function submit() {
    setAttempted(true);
    if (label.trim() === '') {
      document.getElementById('resolution-label')?.focus();
      return;
    }
    save.mutate(
      { id: resolution?.id, label, default_for: standard, position: resolution?.position ?? 0, archived_at: archived ? (resolution?.archived_at ?? now().toISOString()) : null },
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast({ title: resolution ? `Resolution „${saved.label}“ gespeichert` : `Resolution „${saved.label}“ ist angelegt`, tone: 'success' });
        },
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={resolution ? `Resolution „${resolution.label}“ bearbeiten` : 'Resolution anlegen'}
      submitLabel={resolution ? 'Speichern' : 'Anlegen'}
      pending={save.isPending}
      notice={noticeOf(save.error, ['label', 'archived_at'])}
      onSubmit={submit}
    >
      <Input id="resolution-label" name="label" label="Label" hint="So steht es am Item, etwa „Duplicate“ oder „Won't do“." autoComplete="off" value={label} error={labelError} onChange={(event) => setLabel(event.target.value)} />
      <Select
        label="Standard für"
        hint="Diese Resolution bekommt ein Item, wenn niemand eine wählt. Pro Kategorie gibt es genau einen Standard; ein neuer löst den alten ab."
        value={standard ?? 'none'}
        onValueChange={(next) => {
          const value = next === 'completed' || next === 'canceled' ? next : null;
          setStandard(value);
          if (value) setArchived(false);
        }}
        options={DEFAULT_OPTIONS}
      />
      {resolution && (
        <div className="flex flex-col gap-1">
          <Switch label="Archiviert" checked={archived} disabled={standard !== null} onCheckedChange={setArchived} />
          <p className="pl-12 text-sm text-pretty text-muted">
            {standard !== null ? 'Ein Standard lässt sich nicht archivieren. Bestimme zuerst einen anderen.' : 'Eine archivierte Resolution lässt sich nicht mehr wählen, bleibt aber an den Items, die sie haben.'}
          </p>
        </div>
      )}
    </FormDialog>
  );
}

export default function Resolutions({ readOnlyReason }: SectionProps) {
  const resolutions = useResolutions();
  const remove = useDeleteResolution();
  const dialog = useDialogRound<Resolution>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Resolutions"
        description="Wie ein Item endet. Beim Wechsel in einen Status der Kategorie Completed oder Canceled wird eine gesetzt, gewählt oder der Standard der Kategorie. Beim Wiedereröffnen wird sie geleert."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
              Resolution anlegen
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[resolutions]} failure="Die Resolutions konnten nicht geladen werden" skeleton={<RowsSkeleton rows={4} label="Die Resolutions werden geladen …" />}>
        {() => {
          const shown = (resolutions.data?.items ?? []).filter((resolution) => !hidden.has(resolution.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={BadgeCheck}
                title="Noch keine Resolutions"
                description="Ohne Resolution lässt sich ein Item nicht abschließen. Lege eine als Standard für Completed an."
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      Resolution anlegen
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label="Resolutions">
                {shown.map((resolution) => {
                  const standard = defaultText(resolution);
                  return (
                    <Row key={resolution.id}>
                      <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2">
                        <h3 className="text-ui font-medium break-words text-ink">{resolution.label}</h3>
                        {standard && <Badge tone="accent">{standard}</Badge>}
                        {resolution.archived_at && <Badge tone="quiet">Archiviert</Badge>}
                      </div>
                      {canEdit && (
                        <div className="flex items-center">
                          <IconButton icon={Pencil} label={`Resolution „${resolution.label}“ bearbeiten`} onClick={() => dialog.show(resolution)} />
                          <IconButton
                            icon={Trash2}
                            label={`Resolution „${resolution.label}“ löschen`}
                            disabledReason={standard ? `„${resolution.label}“ ist der ${standard}. Bestimme zuerst einen anderen.` : null}
                            onClick={() =>
                              removeWithUndo({
                                id: resolution.id,
                                label: `Resolution „${resolution.label}“ entfernt`,
                                failureTitle: `Resolution „${resolution.label}“ nicht entfernt`,
                                run: async () => {
                                  const { outcome } = await remove.mutateAsync(resolution.id);
                                  if (outcome === 'archived') toast({ title: `Resolution „${resolution.label}“ ist archiviert`, description: 'Items tragen sie noch. Sie lässt sich nur nicht mehr wählen.' });
                                },
                              })
                            }
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
      <ResolutionDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} resolution={dialog.target} />
    </div>
  );
}
