/*
 * The gallery's section "Felder": every field editor closed and open, the property editors in all their states, the
 * fields as the detail panel shows them, and the item card and row in their variants. The editors work on the demo
 * data, so a change here changes the demo (the profile menu resets it).
 */

import { ArrowRightLeft, CircleCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AssigneePicker } from '@/components/fields/AssigneePicker';
import { DateField } from '@/components/fields/DateField';
import { LabelsPicker } from '@/components/fields/LabelsPicker';
import { ParentPicker } from '@/components/fields/ParentPicker';
import { Picker } from '@/components/fields/Picker';
import { PriorityPicker } from '@/components/fields/PriorityPicker';
import { PropertyField, PropertyValueInput } from '@/components/fields/PropertyField';
import { ResolutionPrompt } from '@/components/fields/ResolutionPrompt';
import { StatePicker } from '@/components/fields/StatePicker';
import { TypeChangeDialog, TypePicker } from '@/components/fields/TypePicker';
import { BlockedHint } from '@/components/items/BlockedHint';
import { ItemCard } from '@/components/items/ItemCard';
import { ItemRowBase } from '@/components/items/ItemRowBase';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { useProperties } from '@/hooks/properties';
import { useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { textDoc } from '@/lib/richtext';
import type { FieldType, Property, PropertyValue, State as WorkflowState, WorkItem } from '@/types';
import { Section, Specimen, State, States } from './layout';

/* Demo data: everything here is made up. */

/** The gallery opens nothing: a card or row says what it would open. */
const open = (key: string) => () => toast({ title: `${key} öffnen`, description: 'In der App öffnet sich hier die Seite oder die Vorschau.' });

/** One item of the demo, or its outline while it loads. */
function WithItem({ itemKey, children }: { itemKey: string; children: (item: WorkItem) => ReactNode }) {
  const item = useWorkItem(itemKey).data?.item;
  if (!item) {
    return (
      <SkeletonGroup label={`${itemKey} wird geladen …`}>
        <Skeleton className="h-7 w-40 rounded-ctl" />
      </SkeletonGroup>
    );
  }
  return <>{children(item)}</>;
}

/** An open specimen keeps its list below the trigger; the room below is reserved for it. */
const openProps = { defaultOpen: true, modal: false, keepSide: true } as const;

/** The open state of a picker, under the closed ones: caption, trigger, and room for the list. */
function OpenState({ room, children }: { room: string; children: ReactNode }) {
  return (
    <div className={cx('mt-6', room)}>
      <p className="mb-2 text-sm text-muted">Offen</p>
      {/* the field look reaches 8 px to the left (its ghost padding); the room for it keeps it in the column */}
      <div className="pl-2">{children}</div>
    </div>
  );
}

export function FieldsSection() {
  return (
    <Section id="fields" title="Felder" intro="Feld-Editoren und Item-Bausteine, auf den Demo-Daten.">
      <PanelSpecimen />
      <StateSpecimen />
      <AssigneeSpecimen />
      <PrioritySpecimen />
      <LabelsSpecimen />
      <DateSpecimen />
      <TypeSpecimen />
      <ParentSpecimen />
      <PickerStatesSpecimen />
      <PropertiesSpecimen />
      <CardsSpecimen />
      <RowsSpecimen />
      <BlockedSpecimen />
    </Section>
  );
}

/* Panel */

function PanelSpecimen() {
  const types = useWorkItemTypes().data?.items;
  const properties = useProperties().data?.items;
  return (
    <Specimen title="Im Detail-Panel" note="So stehen die Editoren im Panel: Kürzel im Tooltip, darunter die Properties des Typs. Ein Klick oder Enter öffnet die Liste, Tippen filtert.">
      <WithItem itemKey="WEB-47">
        {(item) => {
          const type = types?.find((entry) => entry.id === item.type_id);
          const fields = [...(type?.properties ?? [])]
            .sort((a, b) => a.position - b.position)
            .flatMap((entry) => {
              const property = properties?.find((candidate) => candidate.id === entry.property_id);
              return property ? [{ property, required: entry.required }] : [];
            });
          return (
            <div className="rounded-card border border-line bg-surface p-4 shadow-elev-1">
              <p className="font-display text-xl font-bold tracking-title text-balance text-ink">{item.title}</p>
              <BlockedHint item={item} variant="banner" onOpen={(id) => open(id)()} className="mt-3" />
              <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-ui">
                <PanelRow label="Typ">
                  <TypePicker item={item} />
                </PanelRow>
                <PanelRow label="Status">
                  <StatePicker item={item} />
                </PanelRow>
                <PanelRow label="Assignee">
                  <AssigneePicker item={item} />
                </PanelRow>
                <PanelRow label="Priorität">
                  <PriorityPicker item={item} />
                </PanelRow>
                <PanelRow label="Labels">
                  <LabelsPicker item={item} />
                </PanelRow>
                <PanelRow label="Start">
                  <DateField item={item} field="start_date" />
                </PanelRow>
                <PanelRow label="Due">
                  <DateField item={item} field="due_date" />
                </PanelRow>
                <PanelRow label="Eltern">
                  <ParentPicker item={item} />
                </PanelRow>
              </dl>
              <section aria-label="Properties" className="mt-4 flex flex-col gap-3 border-t border-edge pt-3">
                {fields.map(({ property, required }) => (
                  <div key={property.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-2">
                    <span className="pt-2.5 text-ui text-muted md:pt-2">
                      {property.label}
                      {required && <span className="block text-sm">Pflicht</span>}
                    </span>
                    <PropertyField item={item} property={property} required={required} hideLabel />
                  </div>
                ))}
              </section>
            </div>
          );
        }}
      </WithItem>
    </Specimen>
  );
}

function PanelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/* Pickers */

function StateSpecimen() {
  const [asking, setAsking] = useState(false);
  const done: WorkflowState = { id: 'std_done', name: 'Done', icon: 'check', category: 'completed', position: 4 };
  return (
    <Specimen title="Status" note="Nur die Übergänge, die der Workflow erlaubt. Nach Completed oder Canceled fragt die Resolution nach.">
      <States>
        <State label="Feld">
          <WithItem itemKey="WEB-42">{(item) => <StatePicker item={item} />}</WithItem>
        </State>
        <State label="Chip">
          <WithItem itemKey="WEB-42">{(item) => <StatePicker item={item} look="chip" />}</WithItem>
        </State>
        <State label="Nur lesen">
          <WithItem itemKey="WEB-8">{(item) => <StatePicker item={item} />}</WithItem>
        </State>
        <State label="Resolution">
          <Button variant="secondary" icon={CircleCheck} data-shot="resolution" onClick={() => setAsking(true)}>
            WEB-42 auf Done setzen …
          </Button>
          <ResolutionPrompt
            open={asking}
            onOpenChange={setAsking}
            subject="WEB-42"
            target={done}
            from={{ category: 'started', resolutionId: null }}
            onConfirm={(resolution) => toast({ title: `Resolution gewählt: ${resolution === 'res_done' ? 'Done' : resolution}`, description: 'In der Galerie bleibt WEB-42, wie es ist.' })}
          />
        </State>
      </States>
      <OpenState room="pb-36">
        <WithItem itemKey="APP-11">{(item) => <StatePicker item={item} {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

function AssigneeSpecimen() {
  return (
    <Specimen title="Assignee" note="Nur Mitglieder des Projekts. „Mir zuweisen“ steht oben, Bots tragen ihr Wort.">
      <States>
        <State label="Feld">
          <WithItem itemKey="WEB-47">{(item) => <AssigneePicker item={item} />}</WithItem>
        </State>
        <State label="Bot">
          <WithItem itemKey="WEB-44">{(item) => <AssigneePicker item={item} />}</WithItem>
        </State>
        <State label="Leer">
          <WithItem itemKey="WEB-50">{(item) => <AssigneePicker item={item} />}</WithItem>
        </State>
        <State label="Avatar">
          <WithItem itemKey="WEB-47">{(item) => <AssigneePicker item={item} look="avatar" />}</WithItem>
          <WithItem itemKey="WEB-50">{(item) => <AssigneePicker item={item} look="avatar" />}</WithItem>
        </State>
      </States>
      <OpenState room="pb-80">
        <WithItem itemKey="WEB-50">{(item) => <AssigneePicker item={item} {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

function PrioritySpecimen() {
  return (
    <Specimen title="Priorität" note="Federstriche nach Stufe, Urgent als rotes Quadrat.">
      <States>
        <State label="Feld">
          <WithItem itemKey="WEB-47">{(item) => <PriorityPicker item={item} />}</WithItem>
          <WithItem itemKey="WEB-55">{(item) => <PriorityPicker item={item} />}</WithItem>
        </State>
        <State label="Chip">
          <WithItem itemKey="WEB-42">{(item) => <PriorityPicker item={item} look="chip" />}</WithItem>
        </State>
      </States>
      <OpenState room="pb-60">
        <WithItem itemKey="WEB-42">{(item) => <PriorityPicker item={item} {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

function LabelsSpecimen() {
  return (
    <Specimen title="Labels" note="Mehrere auf einmal: Enter schaltet ein Label an oder aus, die Liste bleibt offen.">
      <States>
        <State label="Feld">
          <WithItem itemKey="WEB-47">{(item) => <LabelsPicker item={item} />}</WithItem>
        </State>
        <State label="Leer">
          <WithItem itemKey="WEB-50">{(item) => <LabelsPicker item={item} />}</WithItem>
        </State>
        <State label="In der Zeile">
          <WithItem itemKey="WEB-47">{(item) => <LabelsPicker item={item} look="chip" />}</WithItem>
        </State>
      </States>
      <OpenState room="pb-80">
        <WithItem itemKey="WEB-48">{(item) => <LabelsPicker item={item} {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

function DateSpecimen() {
  return (
    <Specimen title="Datum" note="Start und Due-Date. Ein Start nach dem Due-Date wird abgelehnt, mit Abhilfe. Überfällig: eigenes Icon und das Wort.">
      <States>
        <State label="Due-Date">
          <WithItem itemKey="WEB-47">{(item) => <DateField item={item} field="due_date" />}</WithItem>
        </State>
        <State label="Überfällig">
          <WithItem itemKey="WEB-41">{(item) => <DateField item={item} field="due_date" />}</WithItem>
        </State>
        <State label="Leer">
          <WithItem itemKey="WEB-50">{(item) => <DateField item={item} field="start_date" />}</WithItem>
        </State>
        <State label="Chip">
          <WithItem itemKey="WEB-47">{(item) => <DateField item={item} field="due_date" look="chip" />}</WithItem>
          <WithItem itemKey="WEB-41">{(item) => <DateField item={item} field="due_date" look="chip" />}</WithItem>
        </State>
      </States>
      <OpenState room="pb-96">
        <WithItem itemKey="WEB-47">{(item) => <DateField item={item} field="due_date" {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

function TypeSpecimen() {
  const [changing, setChanging] = useState(false);
  return (
    <Specimen title="Typ" note="Gehen beim Wechsel Werte verloren oder fehlen Pflichtfelder, fragt der Wechseldialog nach.">
      <States>
        <State label="Feld">
          <WithItem itemKey="WEB-47">{(item) => <TypePicker item={item} />}</WithItem>
          <WithItem itemKey="WEB-30">{(item) => <TypePicker item={item} />}</WithItem>
        </State>
        <State label="Wechsel">
          <WithItem itemKey="WEB-47">
            {(item) => (
              <>
                <Button variant="secondary" icon={ArrowRightLeft} data-shot="type-change" onClick={() => setChanging(true)}>
                  Bug zu Task …
                </Button>
                <TypeChangeDialogPreview item={item} open={changing} onOpenChange={setChanging} />
              </>
            )}
          </WithItem>
        </State>
      </States>
      <OpenState room="pb-56">
        <WithItem itemKey="APP-12">{(item) => <TypePicker item={item} {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

/** The type change dialog of WEB-47 towards Task. */
function TypeChangeDialogPreview({ item, open: shown, onOpenChange }: { item: WorkItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const task = useWorkItemTypes().data?.items.find((type) => type.id === 't_task') ?? null;
  return <TypeChangeDialog item={item} target={task} open={shown} onOpenChange={onOpenChange} />;
}

function ParentSpecimen() {
  return (
    <Specimen title="Eltern-Item" note="Items des Projekts, Epics zuerst. Das Item selbst und seine Kinder fehlen: keine Zyklen.">
      <States>
        <State label="Feld">
          <WithItem itemKey="WEB-42">{(item) => <ParentPicker item={item} />}</WithItem>
        </State>
        <State label="Leer">
          <WithItem itemKey="WEB-50">{(item) => <ParentPicker item={item} />}</WithItem>
        </State>
      </States>
      <OpenState room="pb-80">
        <WithItem itemKey="WEB-48">{(item) => <ParentPicker item={item} {...openProps} />}</WithItem>
      </OpenState>
    </Specimen>
  );
}

function PickerStatesSpecimen() {
  const common = { label: 'Assignee', display: <span className="text-muted">Nicht zugewiesen</span>, displayText: 'Nicht zugewiesen', placeholder: 'Person suchen …', value: null, onValueChange: () => undefined };
  return (
    <Specimen title="Liste lädt oder scheitert" note="Die Liste lädt in Inhaltsform; scheitert sie, nennt sie die Ursache und bietet „Erneut versuchen“." wide>
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <div className="w-full pb-44 sm:w-72">
          <Picker {...common} options={[]} load={{ isLoading: true, error: null, retry: () => undefined, retrying: false }} {...openProps} />
        </div>
        <div className="w-full pb-44 sm:w-72">
          <Picker
            {...common}
            options={[]}
            load={{ isLoading: false, error: new Error('Der Server antwortet gerade nicht (503).'), retry: () => toast({ title: 'Erneut versucht' }), retrying: false }}
            {...openProps}
          />
        </div>
        <div className="w-full sm:w-72">
          <Picker {...common} options={[]} disabledReason="Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins." />
          <p className="mt-2 text-sm text-muted">Nur lesen: der Grund steht im Tooltip.</p>
        </div>
      </div>
    </Specimen>
  );
}

/* Properties */

const option = (id: string, label: string, color: Property['options'][number]['color'], position: number) => ({ id, label, color, position, archived_at: null });

/** One property per field type, as the organisation could define them. */
const PROPERTIES: Property[] = [
  { id: 'g_text', key: 'browser', label: 'Browser', field_type: 'text', help: 'Browser und Version, z. B. „Safari 18 auf iOS“.', default_value: null, settings: {}, options: [] },
  { id: 'g_number', key: 'effort', label: 'Aufwand (h)', field_type: 'number', help: 'Geschätzte Stunden, auf eine Nachkommastelle.', default_value: null, settings: { decimals: 1 }, options: [] },
  {
    id: 'g_dropdown',
    key: 'customer',
    label: 'Kunde',
    field_type: 'dropdown',
    help: 'Für wen das Item gemacht wird.',
    default_value: null,
    settings: {},
    options: [option('opt_nordlicht', 'Studio Nordlicht', 'sky', 0), option('opt_hafenkontor', 'Hafenkontor', 'ochre', 1), option('opt_moos', 'Gärtnerei Moos', 'moss', 2)],
  },
  { id: 'g_boolean', key: 'approved', label: 'Abgenommen', field_type: 'boolean', help: 'Der Kunde hat die Umsetzung abgenommen.', default_value: false, settings: {}, options: [] },
  { id: 'g_date', key: 'acceptance', label: 'Abnahme am', field_type: 'date', help: 'Der Termin für die Abnahme.', default_value: null, settings: {}, options: [] },
  { id: 'g_member', key: 'reviewer', label: 'Reviewer', field_type: 'member', help: 'Wer das Ergebnis prüft.', default_value: null, settings: { multiple: true }, options: [] },
  { id: 'g_rich', key: 'steps', label: 'Schritte zum Nachstellen', field_type: 'rich_text', help: 'So lässt sich der Fehler reproduzieren.', default_value: null, settings: {}, options: [] },
  { id: 'g_url', key: 'ticket_url', label: 'Ticket beim Kunden', field_type: 'url', help: 'Link auf das Ticket im System des Kunden.', default_value: null, settings: {}, options: [] },
];

const SAMPLES: Record<string, PropertyValue> = {
  browser: 'Safari 18 (iOS)',
  effort: 3.5,
  customer: 'opt_nordlicht',
  approved: true,
  acceptance: '2026-11-06',
  reviewer: ['u_theo', 'u_kira'],
  steps: textDoc('Formular in Safari öffnen.\n\nAbsenden: Es kommen zwei Mails an.'),
  ticket_url: 'https://tickets.hafenkontor.example.com/HK-2291',
};

const ERRORS: Record<string, string> = {
  browser: 'Höchstens 255 Zeichen, jetzt sind es 312',
  effort: 'Nur eine Zahl eingeben, zum Beispiel 3,5',
  customer: 'Diese Option ist archiviert. Wähle eine andere.',
  approved: 'Abnehmen darf nur der Reviewer.',
  acceptance: 'Die Abnahme liegt vor dem Start. Wähle einen späteren Tag.',
  reviewer: 'Lene Vogt hat keinen Zugriff mehr auf das Projekt.',
  steps: 'Beschreibe auch, was du erwartet hast.',
  ticket_url: 'Die Adresse beginnt mit http:// oder https://, zum Beispiel https://example.com',
};

/** The field types as spec 4.7 names them. */
const TYPE_NAMES: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  dropdown: 'Dropdown',
  boolean: 'Boolean',
  date: 'Date',
  member: 'Member picker',
  rich_text: 'Rich text',
  url: 'URL',
};

type Variant = 'value' | 'empty' | 'error' | 'required' | 'readOnly';

const VARIANTS: { variant: Variant; label: string }[] = [
  { variant: 'value', label: 'Mit Wert' },
  { variant: 'empty', label: 'Leer' },
  { variant: 'error', label: 'Fehler' },
  { variant: 'required', label: 'Pflicht, noch leer' },
  { variant: 'readOnly', label: 'Nur lesen' },
];

/** One editor in one state; it keeps what one types or picks. */
function PropertyDemo({ property, variant }: { property: Property; variant: Variant }) {
  const [value, setValue] = useState<PropertyValue | undefined>(variant === 'value' || variant === 'error' || variant === 'readOnly' ? SAMPLES[property.key] : undefined);
  return (
    <PropertyValueInput
      property={property}
      value={value}
      onChange={setValue}
      projectId="p_web"
      required={variant === 'required'}
      error={variant === 'error' ? ERRORS[property.key] : null}
      hint={variant === 'required' && value === undefined ? 'Pflichtfeld, noch leer. Bitte ergänzen.' : undefined}
      disabledReason={variant === 'readOnly' ? 'Im Projekt WEB darfst du nur lesen.' : null}
    />
  );
}

function PropertiesSpecimen() {
  return (
    <Specimen title="Properties" note="Alle acht Feldtypen, je mit Wert, leer, mit Fehler, als leeres Pflichtfeld und nur lesbar. Getippte Werte zählen bei Enter oder beim Verlassen." wide>
      <div className="flex flex-col gap-10">
        {PROPERTIES.map((property) => (
          <section key={property.id} aria-labelledby={`type-${property.id}`}>
            <h4 id={`type-${property.id}`} className="border-b border-line pb-1.5 font-display text-md font-bold tracking-title text-ink">
              {TYPE_NAMES[property.field_type]}
            </h4>
            <div className="mt-3 grid gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">
              {VARIANTS.map(({ variant, label }) => (
                <div key={variant} className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-sm text-muted">{label}</span>
                  <PropertyDemo property={property} variant={variant} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Specimen>
  );
}

/* Cards and rows */

const CARDS: { key: string; note: string; compact?: boolean; selected?: boolean; showParent?: boolean }[] = [
  { key: 'WEB-50', note: 'Task' },
  { key: 'WEB-47', note: 'Bug, blockiert, ausgewählt', selected: true },
  { key: 'WEB-30', note: 'Epic mit Fortschritt' },
  { key: 'WEB-43', note: 'Kind-Item, wie im Board: das Epic vor dem Key', showParent: true },
  { key: 'WEB-41', note: 'Überfällig' },
  { key: 'WEB-8', note: 'Archiviert' },
  { key: 'WEB-42', note: 'Kompakt', compact: true },
  { key: 'APP-15', note: 'Kundenwunsch' },
  { key: 'APP-5', note: 'Epic, kompakt', compact: true },
];

function CardsSpecimen() {
  return (
    <Specimen
      title="Items als Karteikarte"
      note="Reiter mit Typ und Key (im Board bei Kind-Items das Epic davor), Titel, Blockiert-Hinweis, Labels, Fortschritt bei Kindern, Priorität, Fälligkeit, Assignee. Der Titel öffnet das Item."
      wide
    >
      <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((card) => (
          <li key={card.key} className="flex min-w-0 flex-col">
            <WithItem itemKey={card.key}>
              {(item) => <ItemCard item={item} compact={card.compact} selected={card.selected} showParent={card.showParent} onOpen={open(item.key)} />}
            </WithItem>
            <span className="mt-2 text-sm text-muted">{card.note}</span>
          </li>
        ))}
      </ul>
    </Specimen>
  );
}

const ROW_FIELDS = ['key', 'state', 'priority', 'labels', 'due_date', 'property:customer', 'assignee'];

const ROWS: { key: string; depth: number; selected?: boolean }[] = [
  { key: 'WEB-30', depth: 0 },
  { key: 'WEB-42', depth: 1 },
  { key: 'WEB-48', depth: 1 },
  { key: 'WEB-49', depth: 1 },
  { key: 'WEB-47', depth: 0, selected: true },
  { key: 'WEB-41', depth: 0 },
];

function RowsSpecimen() {
  return (
    <Specimen title="Items als Listenzeile" note="Kinder hängen eingerückt am Eltern-Item. Die Chips öffnen ihre Editoren, per Tastatur die Kürzel der Liste." wide>
      <div className="dots overflow-hidden rounded-card border border-line-strong bg-paper p-2 shadow-elev-1">
        <ul className="flex flex-col gap-0.5">
          {ROWS.map((row) => (
            <li key={row.key}>
              <WithItem itemKey={row.key}>
                {(item) => (
                  <ItemRowBase
                    item={item}
                    depth={row.depth}
                    fields={ROW_FIELDS}
                    selected={row.selected}
                    onOpen={open(item.key)}
                    lead={<Checkbox aria-label={`${item.key} auswählen`} checked={row.selected === true} />}
                  />
                )}
              </WithItem>
            </li>
          ))}
        </ul>
      </div>
    </Specimen>
  );
}

function BlockedSpecimen() {
  return (
    <Specimen title="Blockiert-Hinweis" note="Solange ein Blocker offen ist. Erzwungen wird nichts; ein Blocker, den man nicht sehen darf, bleibt verborgen.">
      <WithItem itemKey="WEB-47">
        {(item) => (
          <div className="flex flex-col items-start gap-3">
            <BlockedHint item={item} />
            <BlockedHint item={item} variant="card" />
            <BlockedHint item={item} variant="banner" onOpen={(id) => open(id)()} className="w-full" />
          </div>
        )}
      </WithItem>
    </Specimen>
  );
}
