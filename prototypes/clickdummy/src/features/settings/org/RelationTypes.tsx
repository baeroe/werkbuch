/*
 * Relationstypen (spec 4.9): how items can be connected. A type has a name and a label for each direction ("blockiert"
 * and "wird blockiert von"), or one label when it is symmetric ("verwandt mit"). The three built-in types (blockiert,
 * Duplikat, verwandt) can be renamed but not deleted. Only "blockiert" does anything: the blocked item shows a hint
 * while its blocker is open. Types of one's own are labels only.
 */

import { Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useDeleteRelationType, useRelationTypes, useSaveRelationType } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import type { RelationType } from '@/types';
import { ReadOnlyNotice } from './access';
import { fieldMessage, noticeOf } from './errors';
import { counted } from './format';
import { FormDialog } from './FormDialog';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from './parts';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';
import { useRemoval } from './useRemoval';

function RelationTypeDialog({ open, onOpenChange, type }: { open: boolean; onOpenChange: (open: boolean) => void; type: RelationType | null }) {
  const settle = useSettle();
  const save = useSaveRelationType();
  const [name, setName] = useState(type?.name ?? '');
  const [outward, setOutward] = useState(type?.outward_label ?? '');
  const [symmetric, setSymmetric] = useState(type ? type.inward_label === null : false);
  const [inward, setInward] = useState(type?.inward_label ?? '');
  const [attempted, setAttempted] = useState(false);

  const nameError = attempted && name.trim() === '' ? 'Gib dem Relationstyp einen Namen.' : fieldMessage(save.error, 'name');
  const outwardError = attempted && outward.trim() === '' ? 'Beschrifte die Richtung, etwa „blockiert“.' : fieldMessage(save.error, 'outward_label');
  const inwardError = attempted && !symmetric && inward.trim() === '' ? 'Beschrifte die Gegenrichtung, etwa „wird blockiert von“, oder mache den Typ symmetrisch.' : fieldMessage(save.error, 'inward_label');

  function submit() {
    setAttempted(true);
    if (name.trim() === '' || outward.trim() === '' || (!symmetric && inward.trim() === '')) {
      document.getElementById(name.trim() === '' ? 'relation-name' : outward.trim() === '' ? 'relation-outward' : 'relation-inward')?.focus();
      return;
    }
    settle(save.mutateAsync({ id: type?.id, name, outward_label: outward, inward_label: symmetric ? null : inward, built_in: type?.built_in ?? null }), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: type ? `Relationstyp „${saved.name}“ gespeichert` : `Relationstyp „${saved.name}“ ist angelegt`, tone: 'success' });
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={type ? `Relationstyp „${type.name}“ bearbeiten` : 'Relationstyp anlegen'}
      description={type?.built_in ? 'Dieser Typ ist mitgeliefert. Du kannst ihn umbenennen, aber nicht löschen.' : 'Zwischen zwei Items lässt sich dann eine Beziehung mit diesem Namen eintragen.'}
      submitLabel={type ? 'Speichern' : 'Anlegen'}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name', 'outward_label', 'inward_label'])}
      onSubmit={submit}
    >
      <Input id="relation-name" name="name" label="Name" hint="So heißt der Typ in der Auswahl, etwa „blockiert“." autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <Input
        id="relation-outward"
        label="Beschriftung"
        hint="So liest sich die Beziehung vom ersten Item aus: „WEB-1 blockiert WEB-2“."
        autoComplete="off"
        value={outward}
        error={outwardError}
        onChange={(event) => setOutward(event.target.value)}
      />
      <Switch label="Symmetrisch: Beide Richtungen heißen gleich" checked={symmetric} onCheckedChange={setSymmetric} />
      {!symmetric && (
        <Input
          id="relation-inward"
          label="Beschriftung der Gegenrichtung"
          hint="So liest sie sich vom zweiten Item aus: „WEB-2 wird blockiert von WEB-1“."
          autoComplete="off"
          value={inward}
          error={inwardError}
          onChange={(event) => setInward(event.target.value)}
        />
      )}
    </FormDialog>
  );
}

function TypeRow({ type, canEdit, onEdit, onDelete }: { type: RelationType; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-ui font-medium break-words text-ink">{type.name}</h3>
          {type.built_in && <Badge tone="quiet">Mitgeliefert</Badge>}
          {type.inward_label === null && <Badge tone="quiet">Symmetrisch</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">
          Item A <span className="font-medium text-ink">{type.outward_label}</span> Item B
        </p>
        {type.inward_label !== null && (
          <p className="text-sm text-muted">
            Item B <span className="font-medium text-ink">{type.inward_label}</span> Item A
          </p>
        )}
        {type.built_in === 'blocks' && <p className="mt-1 max-w-[60ch] text-sm text-pretty text-muted">Das blockierte Item zeigt einen Hinweis, solange der Blocker offen ist. Erzwungen wird nichts.</p>}
        {type.built_in && <p className="mt-1 text-sm text-muted">Lässt sich nicht löschen.</p>}
      </div>
      {canEdit && (
        <div className="flex items-center">
          <IconButton icon={Pencil} label={`Relationstyp „${type.name}“ bearbeiten`} onClick={onEdit} />
          {!type.built_in && <IconButton icon={Trash2} label={`Relationstyp „${type.name}“ löschen`} onClick={onDelete} />}
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
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Relationstypen"
        description="Wie Items miteinander zusammenhängen. Mitgeliefert sind blockiert, Duplikat und verwandt; eigene Typen sind reine Beschriftung."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
              Relationstyp anlegen
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[types]} failure="Die Relationstypen konnten nicht geladen werden" skeleton={<RowsSkeleton rows={4} label="Die Relationstypen werden geladen …" />}>
        {() => {
          const shown = (types.data?.items ?? []).filter((type) => !hidden.has(type.id));
          if (shown.length === 0) {
            return <EmptyState icon={Link2} title="Noch kein Relationstyp" description="Ohne Relationstypen lassen sich Items nicht verknüpfen." />;
          }
          return (
            <Panel>
              <Rows label="Relationstypen">
                {shown.map((type) => (
                  <TypeRow
                    key={type.id}
                    type={type}
                    canEdit={canEdit}
                    onEdit={() => dialog.show(type)}
                    onDelete={() =>
                      removeWithUndo({
                        id: type.id,
                        label: `Relationstyp „${type.name}“ gelöscht`,
                        failureTitle: `Relationstyp „${type.name}“ nicht gelöscht`,
                        run: async () => {
                          const { affected_relations } = await remove.mutateAsync(type.id);
                          if (affected_relations > 0) toast({ title: `${counted(affected_relations, 'Relation', 'Relationen')} dieses Typs ${affected_relations === 1 ? 'ist' : 'sind'} mit ihm verschwunden` });
                        },
                      })
                    }
                  />
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <RelationTypeDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} type={dialog.target} />
    </div>
  );
}
