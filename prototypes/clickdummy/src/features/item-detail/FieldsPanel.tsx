/*
 * The fields of an item (moodboard panel): type, status, assignee, priority, labels, dates and parent with the pickers
 * of the field layer, each with its shortcut in the tooltip; below them the properties of the item's type. A required
 * property without a value says so. Rich text properties get the editor (the shared `PropertyField` only edits plain
 * paragraphs); they save after a short pause and when the focus leaves them.
 */

import { RotateCw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { AssigneePicker } from '@/components/fields/AssigneePicker';
import { DateField } from '@/components/fields/DateField';
import { useEditReason, useUserMap } from '@/components/fields/itemData';
import { LabelsPicker } from '@/components/fields/LabelsPicker';
import { ParentPicker } from '@/components/fields/ParentPicker';
import { PriorityPicker } from '@/components/fields/PriorityPicker';
import { isEmptyValue, PropertyField } from '@/components/fields/PropertyField';
import { StatePicker } from '@/components/fields/StatePicker';
import { TypePicker } from '@/components/fields/TypePicker';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { canHaveParent } from '@/domain/hierarchy';
import { isClosedCategory } from '@/domain/workflow';
import { useResolutions } from '@/hooks/catalog';
import { useProperties } from '@/hooks/properties';
import { useUpdateWorkItem } from '@/hooks/workItems';
import type { Property, RichText, WorkItem, WorkItemDetail } from '@/types';
import { isEmptyDoc, RichTextEditor, RichTextView } from '@/features/editor/RichTextEditor';
import { Section } from './shared';

const SAVE_PAUSE_MS = 1000;

const STAMP = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** The label of a property in the grid, with "Pflicht" under it when the type requires it. */
function PropertyLabel({ property, required }: { property: Property; required: boolean }) {
  return (
    <dt className="pt-2.5 text-muted md:pt-2">
      {property.label}
      {required && <span className="block text-sm">Pflicht</span>}
    </dt>
  );
}

/** A rich text value as a save sends it (without content: null), for comparing. */
const asSent = (doc: RichText | null) => JSON.stringify(isEmptyDoc(doc) ? null : doc);

/** A rich text property in the editor: saved after a pause in typing and when the focus leaves it. */
function RichTextProperty({ item, property, required }: { item: WorkItem; property: Property; required: boolean }) {
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const stored = (item.values[property.key] ?? null) as RichText | null;
  const [draft, setDraft] = useState<RichText | null>(stored);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(draft);
  /** Typed text the server does not have yet. Cleared only by a save that went through. */
  const dirty = useRef(false);
  const inFlight = useRef(false);
  /**
   * What failed saves sent. "Erneut versuchen" on their toast sends it once more, possibly after a newer save went
   * through: that older text coming back is not taken, the newer one is saved again.
   */
  const failedSends = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const labelId = useId();
  const hintId = useId();

  // a value from outside (another window, a live event) shows while nothing is typed; a failed save rolls the item
  // back and fetches it again, and the text stays all the same. The text of a failed save is no value from outside:
  // back on the server (its retry landed after a newer save), the newer text is saved again.
  useEffect(() => {
    if (dirty.current) return;
    if (failedSends.current.has(asSent(stored)) && asSent(stored) !== asSent(latest.current)) {
      dirty.current = true;
      save.current();
      return;
    }
    latest.current = stored;
    setDraft(stored);
  }, [stored]);

  const save = useRef(() => {});
  save.current = () => {
    clearTimeout(timer.current);
    if (!dirty.current || inFlight.current) return;
    const sent = latest.current;
    const next = isEmptyDoc(sent) ? null : sent;
    if (next === null && required && !isEmptyValue(stored)) {
      setError(`„${property.label}“ ist ein Pflichtfeld und lässt sich nicht leeren.`);
      return;
    }
    inFlight.current = true;
    // the promise of this very call, not callbacks of mutate: those follow the newest call of the mutation, and
    // "Erneut versuchen" on the error toast makes one while this save is still out (inFlight would stay set for good)
    update
      .mutateAsync({ id: item.id, patch: { values: { [property.key]: next } } })
      .then(
        () => {
          // typed on while it saved: that is still to save
          if (latest.current === sent) dirty.current = false;
          else timer.current = setTimeout(() => save.current(), SAVE_PAUSE_MS);
        },
        // the text stays unsaved; the item mutation's toast names the cause
        (failure: unknown) => {
          failedSends.current.add(asSent(next));
          const message = failure instanceof ApiError ? failure.errors?.[`values.${property.key}`]?.[0] : undefined;
          if (message) setError(message);
        },
      )
      .finally(() => {
        inFlight.current = false;
      });
  };
  // what is typed is saved when the editor goes away
  useEffect(() => () => save.current(), []);

  const hint = error ?? (required && isEmptyValue(stored) ? 'Pflichtfeld, noch leer. Bitte ergänzen.' : null);
  return (
    <div className="contents">
      <dt id={labelId} className="col-span-2 text-muted">
        {property.label}
        {required && <span className="ml-1.5 text-sm">Pflicht</span>}
      </dt>
      <dd className="col-span-2 min-w-0" onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && save.current()}>
        {reason ? (
          stored && !isEmptyDoc(stored) ? (
            <div className="rounded-ctl border border-line bg-sunken px-3 py-2">
              <RichTextView value={stored} />
            </div>
          ) : (
            <p className="text-muted">Kein Wert</p>
          )
        ) : (
          <RichTextEditor
            value={draft}
            onChange={(doc) => {
              latest.current = doc;
              dirty.current = true;
              setDraft(doc);
              setError(null);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => save.current(), SAVE_PAUSE_MS);
            }}
            onSubmit={() => save.current()}
            preset="description"
            projectId={item.project_id}
            placeholder={`${property.label} …`}
            aria-labelledby={labelId}
            aria-describedby={hint ? hintId : undefined}
          />
        )}
        <div aria-live="polite">
          {hint && (
            <p id={hintId} className={error ? 'mt-1.5 text-sm font-medium text-danger' : 'mt-1.5 text-sm text-muted'}>
              {hint}
            </p>
          )}
        </div>
      </dd>
    </div>
  );
}

function Properties({ detail }: { detail: WorkItemDetail }) {
  const properties = useProperties();
  const { item, type } = detail;
  if (type.properties.length === 0) return null;

  if (properties.isError) {
    return (
      <Section title="Properties">
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-ui text-ink">
          <p className="min-w-0 flex-1">Die Properties ließen sich nicht laden: {properties.error.message}</p>
          <Button variant="secondary" size="sm" icon={RotateCw} pending={properties.isFetching} onClick={() => void properties.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      </Section>
    );
  }

  const fields = [...type.properties]
    .sort((a, b) => a.position - b.position)
    .flatMap((entry) => {
      const property = properties.data?.items.find((candidate) => candidate.id === entry.property_id);
      return property ? [{ property, required: entry.required }] : [];
    });

  return (
    <Section title="Properties">
      {properties.isPending ? (
        <SkeletonGroup label="Properties werden geladen …" className="mt-2 flex flex-col gap-3">
          <Skeleton className="h-8 w-full rounded-ctl" />
          <Skeleton className="h-8 w-2/3 rounded-ctl" />
        </SkeletonGroup>
      ) : (
        <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-2 text-ui">
          {fields.map(({ property, required }) =>
            property.field_type === 'rich_text' ? (
              <RichTextProperty key={property.id} item={item} property={property} required={required} />
            ) : (
              <div key={property.id} className="contents">
                <PropertyLabel property={property} required={required} />
                <dd className="min-w-0">
                  <PropertyField item={item} property={property} required={required} hideLabel />
                </dd>
              </div>
            ),
          )}
        </dl>
      )}
    </Section>
  );
}

/** Who created the item and when it last changed. */
function Stamps({ item }: { item: WorkItem }) {
  const users = useUserMap();
  const creator = users.get(item.created_by);
  return (
    <>
      <Row label="Erstellt">
        <span className="flex min-h-11 min-w-0 items-center gap-1.5 text-ink md:min-h-7">
          {creator && <Avatar user={creator} size="sm" decorative />}
          <span className="truncate">{creator?.name ?? 'Unbekannt'}</span>
          <span className="shrink-0 text-muted tabular-nums">{STAMP.format(new Date(item.created_at))}</span>
        </span>
      </Row>
      <Row label="Geändert">
        <span className="flex min-h-11 items-center text-ink tabular-nums md:min-h-7">{STAMP.format(new Date(item.updated_at))}</span>
      </Row>
    </>
  );
}

export function FieldsPanel({ detail }: { detail: WorkItemDetail }) {
  const { item, state } = detail;
  const resolutions = useResolutions().data?.items;
  const resolution = item.resolution_id ? resolutions?.find((entry) => entry.id === item.resolution_id) : undefined;

  return (
    <div>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-ui">
        <Row label="Typ">
          <TypePicker item={item} />
        </Row>
        <Row label="Status">
          <StatePicker item={item} />
        </Row>
        {isClosedCategory(state.category) && resolution && (
          <Row label="Resolution">
            <span className="flex min-h-11 items-center text-ink md:min-h-7">{resolution.label}</span>
          </Row>
        )}
        <Row label="Assignee">
          <AssigneePicker item={item} />
        </Row>
        <Row label="Priorität">
          <PriorityPicker item={item} />
        </Row>
        <Row label="Labels">
          <LabelsPicker item={item} />
        </Row>
        <Row label="Start">
          <DateField item={item} field="start_date" />
        </Row>
        <Row label="Due">
          <DateField item={item} field="due_date" />
        </Row>
        {/* an epic stands at the top: it has no parent */}
        {canHaveParent(detail.type) && (
          <Row label="Eltern">
            <ParentPicker item={item} />
          </Row>
        )}
        <Stamps item={item} />
      </dl>
      <Properties detail={detail} />
    </div>
  );
}
