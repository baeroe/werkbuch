/*
 * Properties (spec 4.7): the fields types are made of. A property has a label, a help text, a default value and one of
 * eight field types. Its key (`snake_case`, the name in API and MCP) and its field type are fixed once it exists; only
 * a dropdown may change from single to multiple choice. Options have a label and a tone, can be put in order and are
 * archived instead of deleted, so items that use them keep them. Deleting a property asks first and names how many
 * items lose their value; the history keeps it.
 */

import { Archive, ArchiveRestore, Lock, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { PropertyValueInput } from '@/components/fields/PropertyField';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { labelClass } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { useDeleteProperty, useProperties, useSaveProperty } from '@/hooks/properties';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { now } from '@/lib/clock';
import { notifyError } from '@/lib/errors';
import type { FieldType, Property, PropertyValue, TypeTone, WorkItemType } from '@/types';
import { ReadOnlyNotice } from './access';
import { FIELD_TYPE_HINTS, FIELD_TYPE_NAMES, FIELD_TYPES, TONES } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { focusSoon, neighbourOf } from './focus';
import { counted } from './format';
import { FormDialog } from './FormDialog';
import { localId } from './localId';
import { Badge, FieldGroup, Loaded, Panel, readOnlyField, Row, Rows, RowsSkeleton, SectionHeader, ToneMenu } from './parts';
import type { SectionProps } from './sections';
import { SortableList } from './Sortable';
import { useDialogRound } from './useDialogRound';
import { useItemCount } from './usage';

/** "Prüfstufe (intern)" becomes "pruefstufe_intern": the key a label suggests (a–z, 0–9 and _, starting with a letter). */
export function keyFrom(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return /^[0-9]/.test(key) ? `p_${key}`.slice(0, 40) : key;
}

/* ------------------------------------------------------------------------ options */

interface DraftOption {
  id: string;
  label: string;
  color: TypeTone;
  archivedAt: string | null;
  /** Known to the server: it can only be archived, never removed, because items may carry it. */
  saved: boolean;
}

function OptionRows({ options, onChange }: { options: DraftOption[]; onChange: (next: DraftOption[]) => void }) {
  const patch = (id: string, partial: Partial<DraftOption>) => onChange(options.map((option) => (option.id === id ? { ...option, ...partial } : option)));
  return (
    <div className="flex flex-col gap-2">
      {options.length > 0 && (
        <SortableList
          items={options}
          label="Optionen"
          nameOf={(option) => option.label.trim()}
          onReorder={onChange}
          className="divide-y divide-line rounded-ctl border border-line bg-surface"
          renderItem={(option, { handle, index }) => {
            const archived = option.archivedAt !== null;
            const name = option.label.trim() || `Option ${index + 1}`;
            return (
              <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                {handle}
                <ToneMenu label={`Farbe von ${name}`} value={option.color} onChange={(color) => patch(option.id, { color })} />
                <input
                  name={`option_label_${index + 1}`}
                  autoComplete="off"
                  value={option.label}
                  aria-label={`Label von Option ${index + 1}`}
                  placeholder="Label der Option"
                  onChange={(event) => patch(option.id, { label: event.target.value })}
                  className={cx(
                    'h-11 min-w-0 flex-1 basis-36 rounded-ctl border border-line bg-surface px-3 text-input text-ink shadow-[inset_0_-1.5px_0_var(--line-input)] md:h-9 md:text-md',
                    archived && 'bg-sunken text-muted',
                  )}
                />
                {archived && <Badge tone="quiet">Archiviert</Badge>}
                {option.saved ? (
                  archived ? (
                    <IconButton icon={ArchiveRestore} label={`Option „${name}“ wiederherstellen`} onClick={() => patch(option.id, { archivedAt: null })} />
                  ) : (
                    <IconButton icon={Archive} label={`Option „${name}“ archivieren`} onClick={() => patch(option.id, { archivedAt: now().toISOString() })} />
                  )
                ) : (
                  <IconButton
                    icon={X}
                    label={`Option ${index + 1} entfernen`}
                    onClick={(event) => {
                      focusSoon(neighbourOf(event.currentTarget));
                      onChange(options.filter((candidate) => candidate.id !== option.id));
                    }}
                  />
                )}
              </div>
            );
          }}
        />
      )}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={() => onChange([...options, { id: localId('opt'), label: '', color: TONES[options.length % TONES.length], archivedAt: null, saved: false }])}
        >
          Option hinzufügen
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ dialog */

type PropertyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The property to change; null creates one. */
  property: Property | null;
};

const DECIMALS = [0, 1, 2, 3, 4].map((count) => ({ value: String(count), label: count === 0 ? 'Keine (ganze Zahlen)' : count === 1 ? '1 Nachkommastelle' : `${count} Nachkommastellen` }));

function PropertyDialog({ open, onOpenChange, property }: PropertyDialogProps) {
  const settle = useSettle();
  const save = useSaveProperty();
  const [label, setLabel] = useState(property?.label ?? '');
  const [key, setKey] = useState(property?.key ?? '');
  // the key follows the label until somebody writes one themselves
  const [keyTouched, setKeyTouched] = useState(property !== null);
  const [fieldType, setFieldType] = useState<FieldType>(property?.field_type ?? 'text');
  const [help, setHelp] = useState(property?.help ?? '');
  const [decimals, setDecimals] = useState(property?.settings.decimals ?? 0);
  const [multiple, setMultiple] = useState(property?.settings.multiple ?? false);
  const [options, setOptions] = useState<DraftOption[]>(() =>
    [...(property?.options ?? [])].sort((a, b) => a.position - b.position).map((option) => ({ id: option.id, label: option.label, color: option.color, archivedAt: option.archived_at, saved: true })),
  );
  const [defaultValue, setDefaultValue] = useState<PropertyValue>(property?.default_value ?? null);
  const [attempted, setAttempted] = useState(false);

  const labelError = attempted && label.trim() === '' ? 'Gib der Property ein Label.' : fieldMessage(save.error, 'label');
  const keyError = attempted && key.trim() === '' ? 'Gib einen Schlüssel ein.' : fieldMessage(save.error, 'key');
  const optionsError = fieldMessage(save.error, 'options');
  const canHaveDefault = fieldType !== 'member' && fieldType !== 'rich_text';
  // a draft of the property as the default value's editor needs it: options and decimals as they are being edited
  const draft: Property = {
    id: property?.id ?? 'draft',
    key: key || 'draft',
    label: 'Standardwert',
    field_type: fieldType,
    help: '',
    default_value: null,
    settings: fieldType === 'number' ? { decimals } : fieldType === 'dropdown' ? { multiple } : {},
    options: options.map((option, position) => ({ id: option.id, label: option.label || 'Ohne Label', color: option.color, position, archived_at: option.archivedAt })),
  };

  function chooseType(next: FieldType) {
    setFieldType(next);
    setDefaultValue(null);
  }

  function submit() {
    setAttempted(true);
    if (label.trim() === '' || key.trim() === '') {
      document.getElementById(label.trim() === '' ? 'property-label' : 'property-key')?.focus();
      return;
    }
    // a default that points at an option which is no longer offered would be refused by every form
    const optionIds = new Set(options.filter((option) => option.archivedAt === null).map((option) => option.id));
    const stillOffered = fieldType !== 'dropdown' || defaultValue === null || [defaultValue].flat().every((value) => typeof value === 'string' && optionIds.has(value));
    settle(
      save.mutateAsync({
        id: property?.id,
        key,
        label,
        field_type: fieldType,
        help: help.trim(),
        default_value: canHaveDefault && stillOffered ? defaultValue : null,
        settings: fieldType === 'number' ? { decimals } : fieldType === 'dropdown' ? { multiple } : {},
        options: fieldType === 'dropdown' ? options.map((option, position) => ({ id: option.id, label: option.label, color: option.color, position, archived_at: option.archivedAt })) : [],
      }),
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast({ title: property ? `Property „${saved.label}“ gespeichert` : `Property „${saved.label}“ ist angelegt`, tone: 'success' });
        },
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={property ? `Property „${property.label}“ bearbeiten` : 'Property anlegen'}
      description="Eine Property ist ein Feld, das du Typen zuordnest. Aus ihm wird eine Spalte in Views und ein Feld in der API."
      submitLabel={property ? 'Speichern' : 'Anlegen'}
      pending={save.isPending}
      notice={noticeOf(save.error, ['label', 'key', 'options', 'field_type', 'settings'])}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="property-label"
          name="label"
          label="Label"
          autoComplete="off"
          value={label}
          error={labelError}
          onChange={(event) => {
            setLabel(event.target.value);
            if (!keyTouched) setKey(keyFrom(event.target.value));
          }}
        />
        <Input
          id="property-key"
          name="key"
          label="Schlüssel"
          hint={property ? 'Der Schlüssel lässt sich nach dem Anlegen nicht mehr ändern.' : 'Kleinbuchstaben, Ziffern und _. So heißt die Property in API und MCP, und das für immer.'}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={property !== null}
          value={key}
          error={keyError}
          className={property ? readOnlyField : undefined}
          onChange={(event) => {
            setKey(event.target.value);
            setKeyTouched(true);
          }}
        />
        {property ? (
          <div className="flex min-w-0 flex-col">
            <p className={cx(labelClass, 'mb-1.5')}>Feldtyp</p>
            <p className="flex h-9 items-center gap-2 text-ui text-ink">
              <Lock className="size-3.5 text-muted" aria-hidden="true" />
              {FIELD_TYPE_NAMES[property.field_type]}
            </p>
            <p className="mt-1.5 text-sm text-pretty text-muted">Auch der Feldtyp ist fest{property.field_type === 'dropdown' ? ', nur von Einfach- auf Mehrfachauswahl lässt sich wechseln' : ''}.</p>
          </div>
        ) : (
          <Select
            label="Feldtyp"
            hint={FIELD_TYPE_HINTS[fieldType]}
            value={fieldType}
            onValueChange={(next) => next && chooseType(next as FieldType)}
            options={FIELD_TYPES.map((type) => ({ value: type, label: FIELD_TYPE_NAMES[type] }))}
          />
        )}
        <Input label="Hilfetext" name="help" hint="Steht unter dem Feld, etwa „Für wen das Item gemacht wird.“" autoComplete="off" value={help} onChange={(event) => setHelp(event.target.value)} />
      </div>

      {fieldType === 'number' && (
        <Select label="Nachkommastellen" hint="Wie genau der Wert gespeichert und gezeigt wird." value={String(decimals)} onValueChange={(next) => next && setDecimals(Number(next))} options={DECIMALS} />
      )}

      {fieldType === 'dropdown' && (
        <>
          <div className="flex flex-col gap-1">
            <Switch
              label="Mehrfachauswahl"
              checked={multiple}
              disabled={property?.settings.multiple === true}
              onCheckedChange={setMultiple}
            />
            <p className="pl-12 text-sm text-pretty text-muted">
              {property?.settings.multiple ? 'Von Mehrfach- auf Einfachauswahl lässt sich nicht zurückwechseln.' : 'Mehrere Optionen pro Item. Einmal eingeschaltet, lässt es sich nicht zurücknehmen.'}
            </p>
          </div>
          <FieldGroup legend="Optionen" hint="Benutzte Optionen werden archiviert, nicht gelöscht. Items behalten sie, neu wählen lassen sie sich nicht mehr." error={optionsError}>
            <OptionRows options={options} onChange={setOptions} />
          </FieldGroup>
        </>
      )}

      {canHaveDefault ? (
        <PropertyValueInput
          property={draft}
          value={defaultValue}
          onChange={setDefaultValue}
          projectId=""
          hint="Optional. Neue Items starten mit diesem Wert."
        />
      ) : (
        <p className="text-sm text-pretty text-muted">Für {FIELD_TYPE_NAMES[fieldType]} gibt es keinen Standardwert. Das Feld beginnt leer.</p>
      )}
    </FormDialog>
  );
}

/* -------------------------------------------------------------------------- list */

/** Item count and the question "how many lose their value", as the confirmation words it. */
function AffectedText({ property }: { property: Property }) {
  const count = useItemCount({ field: `property:${property.key}`, op: 'is_not_empty' });
  if (count === undefined) return <>Die Werte der Items verschwinden. Die History behält sie.</>;
  if (count === 0) return <>Kein Item hat bisher einen Wert. Die Property verschwindet aus den Typen, Views und Vorlagen.</>;
  return <>Die Werte bei {counted(count, 'Item', 'Items')} verschwinden. Die History behält sie. Aus Typen, Views und Vorlagen verschwindet die Property auch.</>;
}

function Usage({ property }: { property: Property }) {
  const count = useItemCount({ field: `property:${property.key}`, op: 'is_not_empty' });
  if (count === undefined) return <Skeleton className="h-4 w-24" />;
  return <span className="tabular-nums">{count === 0 ? 'Kein Item hat einen Wert' : `${counted(count, 'Item hat', 'Items haben')} einen Wert`}</span>;
}

const typesWith = (property: Property, types: WorkItemType[]) => types.filter((type) => type.properties.some((entry) => entry.property_id === property.id));

export default function Properties({ readOnlyReason }: SectionProps) {
  const settle = useSettle();
  const properties = useProperties();
  const types = useWorkItemTypes();
  const remove = useDeleteProperty();
  const dialog = useDialogRound<Property>();
  const [deleting, setDeleting] = useState<Property | null>(null);
  const canEdit = readOnlyReason === null;

  function confirmDelete() {
    const property = deleting;
    if (!property) return;
    settle(remove.mutateAsync(property.id), {
      onSuccess: ({ affected_items }) => {
        setDeleting(null);
        toast({
          title: `Property „${property.label}“ gelöscht`,
          description: affected_items > 0 ? `Die Werte bei ${counted(affected_items, 'Item', 'Items')} sind weg, die History behält sie.` : undefined,
          tone: 'success',
        });
      },
      onError: (error) => {
        setDeleting(null);
        notifyError(`Property „${property.label}“ nicht gelöscht`, error, confirmDelete);
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Properties"
        description="Die Felder, aus denen Typen bestehen: Text, Zahl, Dropdown, Ja oder nein, Datum, Personenauswahl, Rich Text und URL. Eine Property gehört zu keinem Projekt, sondern wird Typen zugeordnet."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
              Property anlegen
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[properties, types]} failure="Die Properties konnten nicht geladen werden" skeleton={<RowsSkeleton rows={5} label="Die Properties werden geladen …" />}>
        {() => {
          const shown = properties.data?.items ?? [];
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={SlidersHorizontal}
                title="Noch keine Properties"
                description="Mit Properties geben Items Daten mit, die über die Kernfelder hinausgehen, etwa einen Kunden oder einen Aufwand."
                actions={
                  canEdit && (
                    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                      Property anlegen
                    </Button>
                  )
                }
              />
            );
          }
          return (
            <Panel>
              <Rows label="Properties">
                {shown.map((property) => {
                  const users = typesWith(property, types.data?.items ?? []);
                  return (
                    <Row key={property.id} className="items-start">
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-ui font-medium break-words text-ink">{property.label}</h3>
                          <Badge tone="quiet">{FIELD_TYPE_NAMES[property.field_type]}</Badge>
                          {property.settings.multiple && <Badge tone="quiet">Mehrfachauswahl</Badge>}
                        </div>
                        <p className="mt-0.5 text-sm text-muted">
                          Schlüssel <span translate="no">{property.key}</span>
                        </p>
                        {property.help && <p className="mt-1 max-w-[65ch] text-sm text-pretty text-muted">{property.help}</p>}
                      </div>
                      <div className="min-w-0 flex-1 basis-60 text-sm text-muted">
                        <p>{users.length === 0 ? 'In keinem Typ' : `Genutzt in ${users.map((type) => type.name).join(', ')}`}</p>
                        <p className="mt-0.5">
                          <Usage property={property} />
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex items-center">
                          <IconButton icon={Pencil} label={`Property „${property.label}“ bearbeiten`} onClick={() => dialog.show(property)} />
                          <IconButton icon={Trash2} label={`Property „${property.label}“ löschen`} onClick={() => setDeleting(property)} />
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
      <PropertyDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} property={dialog.target} />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Property „${deleting.label}“ löschen?` : 'Property löschen?'}
        description={deleting ? <AffectedText property={deleting} /> : undefined}
        confirmLabel="Property löschen"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
