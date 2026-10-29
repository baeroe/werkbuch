/*
 * Typen (spec 4.6): Task, Bug and Epic come with werkbuch, more can be added. A type has a name, an icon and a tone (the
 * tab of its index cards), a description, the Epic mark (its items appear on the timeline) and the properties it
 * carries, each required or not, in the order the form shows them. A type that has items is archived instead of deleted:
 * no new items of it can be made, the old ones keep it. The archive button says so before anyone presses it.
 */

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Archive, ArchiveRestore, CircleAlert, Pencil, Plus, Route, Shapes, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { TYPE_ICONS, TypeTab } from '@/components/ui/TypeTab';
import { useProperties } from '@/hooks/properties';
import { useDeleteWorkItemType, useSaveWorkItemType, useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import type { Property, TypeTone, WorkItemType } from '@/types';
import { ReadOnlyNotice } from './access';
import { FIELD_TYPE_NAMES, TYPE_ICON_NAMES } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { focusSoon, neighbourOf } from './focus';
import { counted } from './format';
import { FormDialog } from './FormDialog';
import { Badge, FieldGroup, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader, TonePicker } from './parts';
import type { SectionProps } from './sections';
import { SortableList } from './Sortable';
import { useDialogRound } from './useDialogRound';
import { useItemCount } from './usage';
import { useRemoval } from './useRemoval';

/* ------------------------------------------------------------------------ dialog */

interface Assigned {
  /** The id of the property; it names the row, too. */
  id: string;
  required: boolean;
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <RadioGroup aria-label="Icon" value={value} onValueChange={(next) => onChange(String(next))} className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
      {Object.entries(TYPE_ICONS).map(([name, Icon]) => (
        <Radio.Root
          key={name}
          value={name}
          aria-label={TYPE_ICON_NAMES[name] ?? name}
          title={TYPE_ICON_NAMES[name] ?? name}
          className={cx(
            'inline-flex size-11 cursor-pointer items-center justify-center rounded-ctl border border-line bg-surface text-muted transition-colors duration-120 hover:border-line-input hover:text-ink md:size-9',
            'data-checked:border-ink data-checked:bg-raised data-checked:text-ink data-checked:ring-1 data-checked:ring-ink',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

type TypeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The type to change; null creates one. */
  type: WorkItemType | null;
  properties: Property[];
};

function TypeDialog({ open, onOpenChange, type, properties }: TypeDialogProps) {
  const settle = useSettle();
  const save = useSaveWorkItemType();
  const [name, setName] = useState(type?.name ?? '');
  const [icon, setIcon] = useState(type?.icon ?? 'square-check');
  const [tone, setTone] = useState<TypeTone>(type?.tone ?? 'sky');
  const [description, setDescription] = useState(type?.description ?? '');
  const [isEpic, setIsEpic] = useState(type?.is_epic ?? false);
  const [assigned, setAssigned] = useState<Assigned[]>(() =>
    [...(type?.properties ?? [])].sort((a, b) => a.position - b.position).map((entry) => ({ id: entry.property_id, required: entry.required })),
  );
  const [attempted, setAttempted] = useState(false);

  const nameError = attempted && name.trim() === '' ? 'Gib dem Typ einen Namen.' : fieldMessage(save.error, 'name');
  // the two levels of items keep the Epic mark (domain/hierarchy); back at the stored mark the refusal no longer holds
  const epicError = type && isEpic !== type.is_epic ? fieldMessage(save.error, 'is_epic') : undefined;
  const epicErrorId = useId();
  const byId = new Map(properties.map((property) => [property.id, property]));
  const free = properties.filter((property) => !assigned.some((entry) => entry.id === property.id));

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('type-name')?.focus();
      return;
    }
    settle(
      save.mutateAsync({
        id: type?.id,
        name,
        icon,
        tone,
        description: description.trim(),
        is_epic: isEpic,
        properties: assigned.map((entry, position) => ({ property_id: entry.id, required: entry.required, position })),
      }),
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast({ title: type ? `Typ „${saved.name}“ gespeichert` : `Typ „${saved.name}“ ist angelegt`, tone: 'success' });
        },
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={type ? `Typ „${type.name}“ bearbeiten` : 'Typ anlegen'}
      description="Der Typ gibt Items Gestalt: ein Reiter in seiner Farbe, ein Icon und die Properties, die zu ihm gehören."
      submitLabel={type ? 'Speichern' : 'Anlegen'}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name', 'icon', 'tone', 'properties', 'is_epic'])}
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <Input id="type-name" name="name" label="Name" autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
        </div>
        <div aria-hidden="true" className="pb-1.5">
          <p className="mb-1.5 text-sm text-muted">So sieht der Reiter aus</p>
          <div className="pt-1">
            <TypeTab tone={tone} icon={icon} label={name.trim() || 'Typ'} />
          </div>
        </div>
      </div>
      <FieldGroup legend="Icon">
        <IconPicker value={icon} onChange={setIcon} />
      </FieldGroup>
      <FieldGroup legend="Farbe" hint="Der Reiter trägt die Farbe, das Icon und der Name stehen immer dabei.">
        <TonePicker label="Farbe des Typs" value={tone} onChange={setTone} />
      </FieldGroup>
      <Textarea label="Beschreibung" name="description" autoComplete="off" hint="Wofür der Typ da ist. Sie erscheint in der Auswahl." rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      <div>
        <Checkbox
          label="Epic: Items dieses Typs erscheinen in der Timeline"
          checked={isEpic}
          onCheckedChange={setIsEpic}
          aria-invalid={epicError ? true : undefined}
          aria-describedby={epicError ? epicErrorId : undefined}
        />
        <div aria-live="polite">
          {epicError && (
            <p id={epicErrorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {epicError}
            </p>
          )}
        </div>
      </div>

      <FieldGroup legend="Properties" hint="Sie erscheinen im Formular und am Item in dieser Reihenfolge. Eine Pflicht-Property braucht beim Anlegen einen Wert.">
        {assigned.length > 0 && (
          <SortableList
            items={assigned}
            label="Properties des Typs"
            nameOf={(entry) => byId.get(entry.id)?.label ?? 'Property'}
            onReorder={setAssigned}
            className="mb-2 divide-y divide-line rounded-ctl border border-line bg-surface"
            renderItem={(entry, { handle }) => {
              const property = byId.get(entry.id);
              const label = property?.label ?? 'Property';
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
                  {handle}
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-ui font-medium text-ink">{label}</p>
                    {property && <p className="text-sm text-muted">{FIELD_TYPE_NAMES[property.field_type]}</p>}
                  </div>
                  <Checkbox
                    label="Pflicht"
                    aria-label={`Pflicht: ${label}`}
                    checked={entry.required}
                    onCheckedChange={(required) => setAssigned((current) => current.map((candidate) => (candidate.id === entry.id ? { ...candidate, required } : candidate)))}
                  />
                  <IconButton
                    icon={X}
                    label={`${label} entfernen`}
                    onClick={(event) => {
                      focusSoon(neighbourOf(event.currentTarget));
                      setAssigned((current) => current.filter((candidate) => candidate.id !== entry.id));
                    }}
                  />
                </div>
              );
            }}
          />
        )}
        <Select
          aria-label="Property zuordnen"
          placeholder={free.length === 0 ? 'Alle Properties sind zugeordnet' : 'Property zuordnen …'}
          disabled={free.length === 0}
          value={null}
          onValueChange={(next) => next && setAssigned((current) => [...current, { id: next, required: false }])}
          options={free.map((property) => ({ value: property.id, label: property.label }))}
        />
      </FieldGroup>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------------- list */

/** The buttons of a type: archive or delete, depending on whether items use it, and restore once it is archived. */
function TypeActions({ type, canEdit, onEdit, onDelete }: { type: WorkItemType; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const settle = useSettle();
  const items = useItemCount({ field: 'type', op: 'is', value: type.id });
  const archive = useDeleteWorkItemType();
  const save = useSaveWorkItemType();
  if (!canEdit) return null;

  function restore() {
    settle(save.mutateAsync({ id: type.id, name: type.name, icon: type.icon, tone: type.tone, description: type.description, is_epic: type.is_epic, properties: type.properties, archived_at: null }), {
      onSuccess: () => toast({ title: `Typ „${type.name}“ ist wiederhergestellt`, description: 'Neue Items dieses Typs lassen sich wieder anlegen.', tone: 'success' }),
      onError: (error) => notifyError(`Typ „${type.name}“ nicht wiederhergestellt`, error, restore),
    });
  }

  function runArchive() {
    settle(archive.mutateAsync(type.id), {
      onSuccess: () =>
        toast({
          title: `Typ „${type.name}“ ist archiviert`,
          description: 'Neue Items dieses Typs lassen sich nicht mehr anlegen. Die bestehenden behalten ihn.',
          tone: 'success',
          action: { label: 'Wiederherstellen', onClick: restore },
        }),
      onError: (error) => notifyError(`Typ „${type.name}“ nicht archiviert`, error, runArchive),
    });
  }

  return (
    <div className="flex items-center">
      <IconButton icon={Pencil} label={`Typ „${type.name}“ bearbeiten`} onClick={onEdit} />
      {type.archived_at !== null ? (
        <IconButton icon={ArchiveRestore} label={`Typ „${type.name}“ wiederherstellen`} onClick={restore} />
      ) : items === undefined ? (
        <IconButton icon={Archive} label={`Typ „${type.name}“ entfernen`} disabledReason="Die Nutzung wird noch geladen." />
      ) : items > 0 ? (
        <IconButton icon={Archive} label={`Typ „${type.name}“ archivieren`} onClick={runArchive} />
      ) : (
        <IconButton icon={Trash2} label={`Typ „${type.name}“ löschen`} onClick={onDelete} />
      )}
    </div>
  );
}

function Usage({ id }: { id: string }) {
  const count = useItemCount({ field: 'type', op: 'is', value: id });
  if (count === undefined) return <Skeleton className="h-4 w-20" />;
  return <span className="tabular-nums">{count === 0 ? 'Bei keinem Item' : `Bei ${counted(count, 'Item', 'Items')}`}</span>;
}

export default function Types({ readOnlyReason }: SectionProps) {
  const types = useWorkItemTypes();
  const properties = useProperties();
  const remove = useDeleteWorkItemType();
  const dialog = useDialogRound<WorkItemType>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const canEdit = readOnlyReason === null;
  const byId = new Map((properties.data?.items ?? []).map((property) => [property.id, property]));

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Typen"
        description="Welche Arten von Work Items es gibt. Jedes Projekt schaltet daraus eine Auswahl frei. Task, Bug und Epic sind mitgeliefert."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
              Typ anlegen
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[types, properties]} failure="Die Typen konnten nicht geladen werden" skeleton={<RowsSkeleton rows={4} label="Die Typen werden geladen …" />}>
        {() => {
          const shown = (types.data?.items ?? []).filter((type) => !hidden.has(type.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Shapes}
                title="Noch kein Typ"
                description="Ohne Typ lassen sich keine Items anlegen."
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      Typ anlegen
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label="Typen">
                {shown.map((type) => (
                  <Row key={type.id} className="items-start">
                    <div className="min-w-0 flex-1 basis-72">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 text-ui">
                          <TypeTab tone={type.tone} icon={type.icon} label={type.name} />
                        </h3>
                        {type.is_epic && (
                          <Badge tone="quiet" icon={Route}>
                            In der Timeline
                          </Badge>
                        )}
                        {type.archived_at !== null && <Badge tone="quiet">Archiviert</Badge>}
                        <span className="text-sm text-muted">
                          <Usage id={type.id} />
                        </span>
                      </div>
                      {type.description && <p className="mt-1.5 max-w-[65ch] text-ui text-pretty text-muted">{type.description}</p>}
                      {type.properties.length > 0 && (
                        <ul aria-label={`Properties von ${type.name}`} className="mt-2 flex flex-wrap gap-1.5">
                          {[...type.properties]
                            .sort((a, b) => a.position - b.position)
                            .map((entry) => {
                              const label = byId.get(entry.property_id)?.label ?? 'Property';
                              return (
                                <li key={entry.property_id}>
                                  <Chip>{entry.required ? `${label} (Pflicht)` : label}</Chip>
                                </li>
                              );
                            })}
                        </ul>
                      )}
                    </div>
                    <TypeActions
                      type={type}
                      canEdit={canEdit}
                      onEdit={() => dialog.show(type)}
                      onDelete={() =>
                        removeWithUndo({
                          id: type.id,
                          label: `Typ „${type.name}“ gelöscht`,
                          failureTitle: `Typ „${type.name}“ nicht gelöscht`,
                          run: () => remove.mutateAsync(type.id),
                        })
                      }
                    />
                  </Row>
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <TypeDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} type={dialog.target} properties={properties.data?.items ?? []} />
    </div>
  );
}
