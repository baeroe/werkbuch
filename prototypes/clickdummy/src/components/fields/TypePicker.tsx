/*
 * The type of an item (spec 4.6). Values of properties the new type lacks are lost, and required properties of the new
 * type need a value: the change dialog names the values that go (the history keeps them) and asks for the required
 * ones. A change without either happens at once. Not optimistic: only the server knows the values of the new type, so
 * the trigger shows the change on its way and a toast confirms it.
 * The two levels of items hold (`domain/hierarchy`): an epic with children stays an epic, an item with a parent becomes
 * none. Such a choice opens the dialog, which says why and offers only "Typ behalten"; a refusal of the server shows
 * there too.
 */

import { useId, useRef, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { typeIcon } from '@/components/ui/TypeTab';
import { canHaveChildren, canHaveParent } from '@/domain/hierarchy';
import { useProperties } from '@/hooks/properties';
import { useChangeWorkItemType, useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Property, PropertyValue, WorkItem, WorkItemType } from '@/types';
import { formatPropertyValue } from './format';
import { useEditReason, useItemWorkflow, useUserMap } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';
import { isEmptyValue, PropertyValueInput } from './PropertyField';

/** A type's icon in the ink of its tone, as the tab of its cards shows it. */
export function TypeGlyph({ type, className = 'size-4' }: { type: Pick<WorkItemType, 'icon' | 'tone'>; className?: string }) {
  const Icon = typeIcon(type.icon);
  return (
    <span data-tone={type.tone} aria-hidden="true" className="inline-flex shrink-0 text-[var(--tab-ink)]">
      <Icon className={className} />
    </span>
  );
}

export const typeOption = (type: WorkItemType): PickerOption => ({ value: type.id, label: type.name, icon: <TypeGlyph type={type} /> });

/** What a change to another type costs: the values that go, and the required properties that still need one. */
export interface TypeChange {
  lost: { property: Property; value: PropertyValue }[];
  missing: Property[];
}

export function typeChangeOf(item: WorkItem, target: WorkItemType, properties: Property[], types: WorkItemType[]): TypeChange {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const keysOf = (type: WorkItemType | undefined) =>
    [...(type?.properties ?? [])].sort((a, b) => a.position - b.position).flatMap((entry) => byId.get(entry.property_id) ?? []);
  const kept = new Set(keysOf(target).map((property) => property.key));
  // in the order of the current type's fields, then values the current type does not even know
  const current = keysOf(types.find((type) => type.id === item.type_id));
  const order = [...current, ...properties.filter((property) => !current.includes(property))];
  const lost = order.flatMap((property) => {
    const value = item.values[property.key];
    return kept.has(property.key) || isEmptyValue(value) ? [] : [{ property, value: value as PropertyValue }];
  });
  const missing = [...target.properties]
    .filter((entry) => entry.required)
    .sort((a, b) => a.position - b.position)
    .flatMap((entry) => byId.get(entry.property_id) ?? [])
    .filter((property) => isEmptyValue(item.values[property.key]));
  return { lost, missing };
}

/** Why the item cannot take the type, by the two levels of items; null when it can. */
export function typeRefusal(item: WorkItem, target: WorkItemType, hasChildren: boolean): string | null {
  if (hasChildren && !canHaveChildren(target)) return `${item.key} hat Kind-Items. Nur Epics können Kind-Items haben.`;
  if (item.parent_id !== null && !canHaveParent(target)) return `${item.key} hat ein Eltern-Item. Epics haben kein Eltern-Item.`;
  return null;
}

const successToast = (item: WorkItem, target: WorkItemType) => toast({ title: `${item.key} hat jetzt den Typ ${target.name}`, tone: 'success' });

type TypeChangeDialogProps = {
  item: WorkItem;
  /** The new type; null renders nothing. */
  target: WorkItemType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when the dialog closes (the picker's trigger). */
  finalFocus?: RefObject<HTMLElement | null>;
};

/**
 * The change dialog; the type picker and the command `t` open it when a change costs values or needs some, or when the
 * two levels refuse it: then it says why and offers only "Typ behalten".
 */
export function TypeChangeDialog({ item, target, open, onOpenChange, finalFocus }: TypeChangeDialogProps) {
  const formId = useId();
  const change = useChangeWorkItemType();
  // the children and the parent as they are now
  const detail = useWorkItem(open ? item.id : null).data;
  if (!target) return null;
  const refusal = typeRefusal(detail?.item ?? item, target, (detail?.children.length ?? 0) > 0);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
      title={`Typ von ${item.key} auf ${target.name} ändern`}
      description={refusal ?? `Die Felder von ${item.key} richten sich danach nach ${target.name}.`}
      footer={
        refusal ? (
          <DialogClose
            render={
              <Button variant="secondary" shortcut="escape">
                Typ behalten
              </Button>
            }
          />
        ) : (
          <>
            <DialogClose
              render={
                <Button variant="ghost" shortcut="escape">
                  Abbrechen
                </Button>
              }
            />
            <Button variant="primary" type="submit" form={formId} pending={change.isPending} shortcut="mod+enter">
              Zu {target.name} wechseln
            </Button>
          </>
        )
      }
    >
      {!refusal && <TypeChangeForm key={target.id} formId={formId} item={item} target={target} change={change} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

type TypeChangeFormProps = {
  formId: string;
  item: WorkItem;
  target: WorkItemType;
  change: ReturnType<typeof useChangeWorkItemType>;
  onDone: () => void;
};

/** The dialog's content; mounted while it is open, so every change starts empty. */
function TypeChangeForm({ formId, item, target, change, onDone }: TypeChangeFormProps) {
  const settle = useSettle();
  const properties = useProperties();
  const types = useWorkItemTypes();
  const users = useUserMap();
  const form = useRef<HTMLFormElement>(null);
  const lostId = useId();
  const [values, setValues] = useState<Record<string, PropertyValue>>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  // mod+Enter sends the form from anywhere in the dialog (the focus starts on "Abbrechen" when nothing is to fill in)
  useShortcut({ id: 'type-change.confirm', keys: 'mod+enter', scope: 'dialog', label: 'Typ wechseln', group: 'Dialog', run: () => form.current?.requestSubmit() });

  if (!properties.data || !types.data) {
    return (
      <SkeletonGroup label="Felder werden geladen …" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-full rounded-ctl" />
      </SkeletonGroup>
    );
  }

  const { lost, missing } = typeChangeOf(item, target, properties.data.items, types.data.items);
  const nameOf = (userId: string) => users.get(userId)?.name ?? 'Unbekannt';

  function submit() {
    settle(change.mutateAsync({ id: item.id, type_id: target.id, values }), {
      onSuccess: () => {
        onDone();
        successToast(item, target);
      },
      // field errors (422) show at their field, a refusal of the type itself above them; anything else in a toast
      onError: (error) => {
        if (!(error instanceof ApiError && error.status === 422 && error.errors)) {
          notifyError('Typ nicht geändert', error, submit);
          return;
        }
        setErrors(error.errors);
        // the focus goes to the first field the server refused, once it shows its error
        requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      },
    });
  }

  return (
    <form
      ref={form}
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-5"
    >
      {errors.type_id && (
        <Banner tone="danger" role="alert" title="Typ nicht geändert">
          {errors.type_id[0]}
        </Banner>
      )}
      {lost.length > 0 && (
        <Banner tone="danger" title={<span id={lostId}>Diese Werte gehen verloren</span>}>
          <ul aria-labelledby={lostId} className="mt-1 flex flex-col gap-1">
            {lost.map(({ property, value }) => (
              <li key={property.key} className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-medium">{property.label}</span>
                <span className="min-w-0 truncate text-muted">{formatPropertyValue(property, value, nameOf)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sm text-muted">In der History bleiben sie erhalten.</p>
        </Banner>
      )}
      {missing.length > 0 && (
        <section aria-label={`Pflichtfelder von ${target.name}`} className="flex flex-col gap-4">
          <p className="text-ui text-pretty text-ink">
            {target.name} braucht {missing.length === 1 ? 'dieses Pflichtfeld' : 'diese Pflichtfelder'}, bevor der Typ wechselt.
          </p>
          {missing.map((property) => (
            <PropertyValueInput
              key={property.key}
              property={property}
              value={values[property.key]}
              onChange={(value) => setValues((current) => ({ ...current, [property.key]: value }))}
              projectId={item.project_id}
              required
              error={errors[`values.${property.key}`]?.[0] ?? null}
            />
          ))}
        </section>
      )}
      {lost.length === 0 && missing.length === 0 && <p className="text-ui text-ink">Alle Werte bleiben erhalten.</p>}
    </form>
  );
}

type TypePickerProps = PickerExtras & { item: WorkItem };

export function TypePicker({ item, look = 'field', shortcut, ...extras }: TypePickerProps) {
  const settle = useSettle();
  const types = useWorkItemTypes();
  const properties = useProperties();
  const { project, isLoading, error, retry, retrying } = useItemWorkflow(item);
  const change = useChangeWorkItemType();
  const reason = useEditReason(item);
  // whether the item has children: an epic with children keeps its type (the dialog says why)
  const children = useWorkItem(item.id).data?.children;
  const trigger = useRef<HTMLButtonElement>(null);
  // the target stays while the dialog fades out
  const [target, setTarget] = useState<WorkItemType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const all = types.data?.items ?? [];
  const current = all.find((type) => type.id === item.type_id);
  // types of the project; archived types take no new items, and an item keeps its own even when archived
  const offered = all.filter((type) => (type.archived_at === null && project?.enabled_type_ids.includes(type.id)) || type.id === item.type_id);

  function choose(typeId: string) {
    const next = offered.find((type) => type.id === typeId);
    if (!next || !properties.data) return;
    const { lost, missing } = typeChangeOf(item, next, properties.data.items, all);
    if (lost.length > 0 || missing.length > 0 || typeRefusal(item, next, (children?.length ?? 0) > 0)) {
      setTarget(next);
      setDialogOpen(true);
      return;
    }
    settle(change.mutateAsync({ id: item.id, type_id: next.id }), {
      onSuccess: () => successToast(item, next),
      onError: (failure) => notifyError('Typ nicht geändert', failure, () => choose(typeId)),
    });
  }

  return (
    <>
      <Picker
        {...extras}
        look={look}
        shortcut={shortcut ?? (look === 'field' ? 't' : undefined)}
        triggerRef={trigger}
        label="Typ"
        display={
          current ? (
            <>
              <TypeGlyph type={current} />
              <span className="truncate">{current.name}</span>
            </>
          ) : (
            <Skeleton className="h-3 w-14" />
          )
        }
        displayText={current?.name ?? 'wird geladen'}
        options={offered.map(typeOption)}
        value={item.type_id}
        onValueChange={choose}
        placeholder="Typ suchen …"
        load={{
          isLoading: isLoading || types.isPending || properties.isPending,
          error: error ?? types.error ?? properties.error,
          retry: () => {
            retry();
            void types.refetch();
            void properties.refetch();
          },
          retrying: retrying || types.isFetching || properties.isFetching,
        }}
        disabledReason={reason}
        pending={change.isPending}
      />
      <TypeChangeDialog item={item} target={target} open={dialogOpen} onOpenChange={setDialogOpen} finalFocus={trigger} />
    </>
  );
}
