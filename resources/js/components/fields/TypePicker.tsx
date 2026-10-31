/*
 * The type of an item (spec 4.6). Values of properties the new type lacks are lost, and required properties of the new
 * type need a value: the change dialog names the values that go (the history keeps them) and asks for the required
 * ones with the property editors (P26). A change without either happens at once. Not optimistic: only the server knows
 * the values of the new type, so the trigger shows the change on its way and a toast confirms it.
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
import { canHaveChildren, typeChangeRefusal } from '@/domain/hierarchy';
import { useSettle } from '@/hooks/mutation';
import { useProperties } from '@/hooks/properties';
import { useChangeWorkItemType, useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { t, tn } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Property, PropertyValue, WorkItem, WorkItemType } from '@/types';
import { formatPropertyValue } from './format';
import { useEditReason, useItemWorkflow, useUserMap } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';
import { isEmptyValue, readsEmpty } from './property/parse';
import { PropertyValueInput } from './property/PropertyValueInput';
import { TypeGlyph } from './TypeGlyph';

export const typeOption = (type: WorkItemType): PickerOption => ({ value: type.id, label: type.name, icon: <TypeGlyph type={type} /> });

/** What a change to another type costs: the values that go, and the required properties that still need one. */
export interface TypeChange {
  lost: { property: Property; value: PropertyValue }[];
  missing: Property[];
}

export function typeChangeOf(item: WorkItem, target: WorkItemType, properties: Property[], types: WorkItemType[]): TypeChange {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const propertiesOf = (type: WorkItemType | undefined) =>
    [...(type?.properties ?? [])].sort((a, b) => a.position - b.position).flatMap((entry) => byId.get(entry.property_id) ?? []);
  const kept = new Set(propertiesOf(target).map((property) => property.key));
  // in the order of the current type's fields, then values the current type does not even know
  const current = propertiesOf(types.find((type) => type.id === item.type_id));
  const order = [...current, ...properties.filter((property) => !current.includes(property))];
  // a yes/no that is off loses nothing: it reads the same without a value (A89)
  const lost = order.flatMap((property) => {
    const value = item.values[property.key];
    return kept.has(property.key) || readsEmpty(property, value) ? [] : [{ property, value: value as PropertyValue }];
  });
  const missing = propertiesOf({ ...target, properties: target.properties.filter((entry) => entry.required) }).filter((property) =>
    isEmptyValue(item.values[property.key]),
  );
  return { lost, missing };
}

const successToast = (item: WorkItem, target: WorkItemType) => toast({ title: t('items.fields.type.changed', { key: item.key, type: target.name }), tone: 'success' });

/** Why the two levels refuse the change, or null. */
const refusalText = (item: WorkItem, hasChildren: boolean, target: WorkItemType): string | null => {
  const refusal = typeChangeRefusal(hasChildren, item.parent_id !== null, target);
  return refusal ? t(`items.hierarchy.${refusal}`, { key: item.key }) : null;
};

type TypeChangeDialogProps = {
  item: WorkItem;
  /** The new type; null renders nothing. */
  target: WorkItemType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when the dialog closes (the picker's trigger). */
  finalFocus?: RefObject<HTMLElement | null>;
  /** Whether the item has children, as far as the caller knows (`t` from a list); the item, once loaded, says it. */
  hasChildren?: boolean;
};

/**
 * The change dialog; the type picker and the command `t` open it when a change costs values or needs some, or when the
 * two levels refuse it: then it says why and offers only "Typ behalten". Until it knows whether the item has children
 * (the caller's `hasChildren`, then the loaded item), a type that takes none waits instead of offering the change; when
 * the item fails to load it waits no longer and leaves the decision to the server.
 */
export function TypeChangeDialog({ item, target, open, onOpenChange, finalFocus, hasChildren }: TypeChangeDialogProps) {
  const formId = useId();
  const change = useChangeWorkItemType();
  // the children and the parent as they are now; also while the dialog fades out, so a refusal does not turn into the
  // form for a moment
  const detailQuery = useWorkItem(item.id);
  const detail = detailQuery.data;
  if (!target) return null;
  const current = detail?.item ?? item;
  const children = detail ? detail.children.length > 0 : hasChildren;
  const refusal = refusalText(current, children ?? false, target);
  // an item that fails to load ends the wait: the form goes on, and a refusal of the server names its reason
  const waiting = refusal === null && children === undefined && !canHaveChildren(target) && !detailQuery.isError;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus}
      title={t('items.fields.type.title', { key: item.key, type: target.name })}
      description={refusal ?? t('items.fields.type.description', { key: item.key, type: target.name })}
      footer={
        refusal ? (
          <DialogClose
            render={
              <Button variant="secondary" shortcut="escape">
                {t('items.fields.type.keep')}
              </Button>
            }
          />
        ) : (
          <>
            <DialogClose
              render={
                <Button variant="ghost" shortcut="escape">
                  {t('common.cancel')}
                </Button>
              }
            />
            {!waiting && (
              <Button variant="primary" type="submit" form={formId} pending={change.isPending} shortcut={SHORTCUTS['dialog.submit'].keys}>
                {t('items.fields.type.submit', { type: target.name })}
              </Button>
            )}
          </>
        )
      }
    >
      {waiting ? (
        <SkeletonGroup label={t('items.fields.type.loading_item')} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-full rounded-ctl" />
        </SkeletonGroup>
      ) : (
        !refusal && <TypeChangeForm key={target.id} formId={formId} item={current} target={target} change={change} onDone={() => onOpenChange(false)} />
      )}
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
  useShortcut('dialog.submit', () => form.current?.requestSubmit());

  if (!properties.data || !types.data) {
    return (
      <SkeletonGroup label={t('items.fields.type.loading_fields')} className="flex flex-col gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-full rounded-ctl" />
      </SkeletonGroup>
    );
  }

  const { lost, missing } = typeChangeOf(item, target, properties.data.items, types.data.items);
  const nameOf = (userId: string) => users.get(userId)?.name ?? t('items.fields.property.unknown_person');
  // a required yes/no starts off, and off is what it sends (A89: what is set is stored)
  const sent = { ...Object.fromEntries(missing.filter((property) => property.field_type === 'boolean').map((property) => [property.key, false])), ...values };

  function submit() {
    settle(change.mutateAsync({ id: item.id, type_id: target.id, values: sent }), {
      onSuccess: () => {
        onDone();
        successToast(item, target);
      },
      // field errors (422) show at their field, a refusal of the type itself above them; anything else in a toast
      onError: (error) => {
        if (!(error instanceof ApiError && error.status === 422 && error.errors)) {
          notifyError(t('items.fields.type.failed'), error, submit);
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
        <Banner tone="danger" role="alert" title={t('items.fields.type.failed')}>
          {errors.type_id[0]}
        </Banner>
      )}
      {lost.length > 0 && (
        <Banner tone="danger" title={<span id={lostId}>{t('items.fields.type.lost')}</span>}>
          <ul aria-labelledby={lostId} className="mt-1 flex flex-col gap-1">
            {lost.map(({ property, value }) => (
              <li key={property.key} className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-medium">{property.label}</span>
                <span className="min-w-0 truncate text-muted">{formatPropertyValue(property, value, nameOf)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sm text-muted">{t('items.fields.type.lost_hint')}</p>
        </Banner>
      )}
      {missing.length > 0 && (
        <section aria-label={t('items.fields.type.required_of', { type: target.name })} className="flex flex-col gap-4">
          <p className="text-ui text-pretty text-ink">{tn('items.fields.type.needs', missing.length, { type: target.name })}</p>
          {missing.map((property) => (
            <PropertyValueInput
              key={property.key}
              property={property}
              value={sent[property.key]}
              onChange={(value) => setValues((current) => ({ ...current, [property.key]: value }))}
              projectId={item.project_id}
              required
              error={errors[`values.${property.key}`]?.[0] ?? null}
            />
          ))}
        </section>
      )}
      {lost.length === 0 && missing.length === 0 && <p className="text-ui text-ink">{t('items.fields.type.all_kept')}</p>}
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
  // a choice that opens the dialog: the dialog, not the list, decides where the focus goes
  const asks = useRef(false);

  const all = types.data?.items ?? [];
  const current = all.find((type) => type.id === item.type_id);
  // types of the project; archived types take no new items, and an item keeps its own even when archived
  const offered = all.filter((type) => (type.archived_at === null && project?.enabled_type_ids.includes(type.id)) || type.id === item.type_id);

  function choose(typeId: string) {
    const next = offered.find((type) => type.id === typeId)!;
    const { lost, missing } = typeChangeOf(item, next, properties.data!.items, all);
    if (lost.length > 0 || missing.length > 0 || refusalText(item, (children?.length ?? 0) > 0, next)) {
      asks.current = true;
      setTarget(next);
      setDialogOpen(true);
      return;
    }
    settle(change.mutateAsync({ id: item.id, type_id: next.id }), {
      onSuccess: () => successToast(item, next),
      onError: (failure) => notifyError(t('items.fields.type.failed'), failure, () => choose(typeId)),
    });
  }

  return (
    <>
      <Picker
        {...extras}
        look={look}
        shortcut={shortcut ?? (look === 'field' ? SHORTCUTS['item.type'].keys : undefined)}
        triggerRef={trigger}
        returnFocus={() => !asks.current}
        label={t('items.fields.type.label')}
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
        displayText={current?.name ?? t('items.fields.loading')}
        options={offered.map(typeOption)}
        value={item.type_id}
        onValueChange={choose}
        placeholder={t('items.fields.type.placeholder')}
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
        onOpenChange={(open) => {
          extras.onOpenChange?.(open);
          if (open) asks.current = false;
        }}
      />
      <TypeChangeDialog item={item} target={target} open={dialogOpen} onOpenChange={setDialogOpen} finalFocus={trigger} />
    </>
  );
}
