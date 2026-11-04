/*
 * The relations of an item (spec 4.9), grouped by what they say from this item's side ("blockiert", "wird blockiert
 * von", "testet" …) in the order of the relation types, outward before inward. Each other item opens where the detail
 * is; an item the reader may not see is "verborgenes Item", without key or title (nothing of it leaves the server,
 * P19), and it can't be removed here. Removing waits for its undo toast.
 *
 * `r`, "Relation" or "Relation hinzufügen …" in the item's menu open the dialog: the kind of relation in both
 * directions, then the item, found through the search (`GET /api/v1/search?types=items`, P16) by key, title or
 * description in every project the reader sees; a typed key, also with a former identifier and of an archived item,
 * leads the hits (`key_match`). Nothing is asked before something is typed. A refusal of the server stands at its field
 * (`target_id`: duplicate, self, unknown; `type_id`), any other one on top of the form.
 */

import { EyeOff, Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { useEditReason } from '@/components/fields/itemData';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { ItemKey } from '@/components/items/ItemKey';
import { Button } from '@/components/ui/Button';
import { describedBy, Field } from '@/components/ui/Field';
import { FormDialog } from '@/components/ui/FormDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useRelationTypes } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { useAddRelation, useRemoveRelation } from '@/hooks/relations';
import { useSearch } from '@/hooks/search';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { runWithUndo } from '@/lib/undo';
import type { ListedItem, RelationEntry, RelationType, WorkItem, WorkItemDetail } from '@/types';
import { focusWhenLost } from '@/lib/focusOrigin';
import { LinkedItem, Section, useDetail } from './shared';

/** How long typing in the item search pauses before the server is asked. */
export const SEARCH_PAUSE_MS = 200;

/** Hits the search shows at once; typing narrows them. */
const SEARCH_LIMIT = 20;

/** What a relation says from the side of the item that shows it. */
export function relationLabel(type: RelationType | undefined, direction: RelationEntry['direction']): string {
  if (!type) return t('items.detail.relations.related');
  return direction === 'inward' && type.inward_label !== null ? type.inward_label : type.outward_label;
}

/** The kinds of relation to choose from, both directions of each type: `<type id>:out` "blockiert" … */
function kindsOf(types: readonly RelationType[]) {
  return types.flatMap((type) => [
    { value: `${type.id}:out`, label: type.outward_label },
    ...(type.inward_label !== null ? [{ value: `${type.id}:in`, label: type.inward_label }] : []),
  ]);
}

/* ---------------------------------------------------------------------------- the dialog */

type Errors = { kind?: string; target?: string; form?: string };

type RelationDialogProps = {
  item: WorkItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: RefObject<HTMLElement | null>;
};

function RelationDialog({ item, open, onOpenChange, finalFocus }: RelationDialogProps) {
  const settle = useSettle();
  const relationTypes = useRelationTypes();
  const types = useWorkItemTypes().data?.items;
  const add = useAddRelation();
  const itemFieldId = useId();
  const kinds = kindsOf(relationTypes.data?.items ?? []);
  const [kind, setKind] = useState<string | null>(null);
  // "verwandt mit" unless the person chooses another kind
  const relates = relationTypes.data?.items.find((type) => type.built_in === 'relates');
  const chosenKind = kind ?? (relates ? `${relates.id}:out` : (kinds[0]?.value ?? null));
  const [target, setTarget] = useState<ListedItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const { reason } = usePermissions();
  // asked only while the dialog is open and something is typed; the hits of the last search stay while the next one is
  // on its way (the list does not blink)
  const found = useSearch(search, { types: ['items'], limit: SEARCH_LIMIT }, { enabled: open });
  const typed = query.trim() !== '';
  const [errors, setErrorState] = useState<Errors>({});
  const [refused, setRefused] = useState(0);
  /** Errors of a submit: shown at their fields, and the focus goes to the first of them. */
  const setErrors = (next: Errors) => {
    setErrorState(next);
    if (next.kind || next.target) setRefused((count) => count + 1);
  };

  // the list opens with the dialog: typing a key or title finds the item at once
  useEffect(() => {
    const timer = setTimeout(() => setPickerOpen(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (refused > 0) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-relation-form] [aria-invalid="true"]`)?.focus());
  }, [refused]);

  // an emptied field forgets the hits: they belong to the last text, not to none
  const candidates = useMemo(() => (typed ? (found.data?.items ?? []) : []).filter((entry) => entry.id !== item.id), [typed, found.data, item.id]);
  // an inward kind makes the chosen item the source: it has to be one the person may change
  const inward = chosenKind?.endsWith(':in') ?? false;
  const denied = (entry: ListedItem) => (inward ? reason('item.edit', entry.project_id) : null);
  const options: PickerOption[] = candidates.map((entry) => {
    const type = types?.find((candidate) => candidate.id === entry.type_id);
    const why = denied(entry);
    return { value: entry.id, label: entry.title, hint: why ? `${entry.key} · ${why}` : entry.key, icon: type ? <TypeGlyph type={type} /> : undefined, disabled: why !== null };
  });
  const label = kinds.find((entry) => entry.value === chosenKind)?.label ?? '';
  const hint = typed && found.isError ? undefined : t('items.detail.relations.dialog.item_hint');

  function submit() {
    if (!chosenKind) return setErrors({ kind: t('items.detail.relations.dialog.kind_required') });
    if (!target) return setErrors({ target: t('items.detail.relations.dialog.item_required') });
    const refusal = denied(target);
    if (refusal) return setErrors({ target: refusal });
    const [typeId, direction] = chosenKind.split(':') as [string, string];
    const [source, other] = direction === 'out' ? [item, target] : [target, item];
    setErrors({});
    settle(add.mutateAsync({ source_id: source.id, type_id: typeId, target_id: other.id }), {
      onSuccess: () => {
        toast({ title: t('items.detail.relations.added'), description: `${item.key} ${label} ${target.key}`, tone: 'success' });
        onOpenChange(false);
      },
      onError: (error) => {
        const fields = error instanceof ApiError ? error.errors : undefined;
        if (fields?.target_id || fields?.type_id) setErrors({ target: fields.target_id?.[0], kind: fields.type_id?.[0] });
        else if (error instanceof ApiError && error.status < 500) setErrors({ form: error.message });
        else notifyError(t('items.detail.relations.add_failed'), error, submit);
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('items.detail.relations.dialog.title')}
      description={t('items.detail.relations.dialog.description', { key: item.key })}
      submitLabel={t('items.detail.relations.dialog.submit')}
      onSubmit={submit}
      pending={add.isPending}
      notice={errors.form}
      finalFocus={finalFocus}
    >
      <div data-relation-form="" className="contents">
        <Select
          label={t('items.detail.relations.dialog.kind')}
          options={kinds}
          value={chosenKind}
          onValueChange={(next) => {
            setKind(next);
            setErrors({});
          }}
          error={errors.kind}
        />
        <Field id={itemFieldId} label={t('items.detail.relations.dialog.item')} hint={hint} error={errors.target}>
          <Picker
            id={itemFieldId}
            look="form"
            label={t('items.detail.relations.dialog.item')}
            display={
              target ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ItemKey value={target.key} className="text-muted" />
                  <span className="truncate">{target.title}</span>
                </span>
              ) : (
                <span className="text-muted">{t('items.detail.relations.dialog.choose')}</span>
              )
            }
            displayText={target ? `${target.key} ${target.title}` : t('items.detail.relations.dialog.none')}
            options={options}
            value={target?.id ?? null}
            onValueChange={(next) => {
              setTarget(candidates.find((entry) => entry.id === next) ?? null);
              setErrors({});
            }}
            placeholder={t('items.detail.relations.dialog.search')}
            emptyText={t(typed ? 'items.detail.relations.dialog.no_match' : 'items.detail.relations.dialog.type_to_search')}
            load={{ isLoading: typed && found.data === undefined && !found.isError, error: typed ? found.error : null, retry: () => void found.refetch(), retrying: found.isFetching }}
            describedBy={describedBy(itemFieldId, { hint, error: errors.target })}
            invalid={Boolean(errors.target)}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onQueryChange={setQuery}
          />
        </Field>
        {target && label && (
          <p className="text-ui text-pretty text-muted">
            <ItemKey value={item.key} className="text-ink" /> {label} <ItemKey value={target.key} className="text-ink" />
          </p>
        )}
      </div>
    </FormDialog>
  );
}

/* -------------------------------------------------------------------------------- section */

export function Relations({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const { actions } = useDetail();
  const editReason = useEditReason(item);
  const relationTypes = useRelationTypes().data?.items;
  const remove = useRemoveRelation();
  const [adding, setAdding] = useState(false);
  /** Each opening starts from an empty form. */
  const [round, setRound] = useState(0);
  /** Removed, while their undo toast stands. */
  const [gone, setGone] = useState<string[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);

  const start = () => {
    if (editReason) return void toast({ title: t('items.commands.denied'), description: editReason, tone: 'error' });
    setRound((count) => count + 1);
    setAdding(true);
  };

  useEffect(() => {
    const own = actions.current;
    own.addRelation = start;
    return () => {
      if (own.addRelation === start) own.addRelation = undefined;
    };
  });

  const shown = detail.relations.filter((entry) => !gone.includes(entry.relation.id));
  // groups in the order of the types, outward before inward
  const order = (entry: RelationEntry) => (relationTypes?.findIndex((type) => type.id === entry.relation.type_id) ?? 0) * 2 + (entry.direction === 'inward' ? 1 : 0);
  const groups = new Map<string, RelationEntry[]>();
  for (const entry of [...shown].sort((a, b) => order(a) - order(b))) {
    const label = relationLabel(
      relationTypes?.find((type) => type.id === entry.relation.type_id),
      entry.direction,
    );
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }

  if (shown.length === 0 && editReason) return null;

  function removeEntry(entry: RelationEntry, other: WorkItem, label: string) {
    const id = entry.relation.id;
    setGone((current) => [...current, id]);
    // its remove button goes with it: the focus moves on to "Relation"
    focusWhenLost(() => addButton.current);
    const back = () => setGone((current) => current.filter((entryId) => entryId !== id));
    runWithUndo({
      label: t('items.detail.relations.removed', { label, key: other.key }),
      undo: back,
      failureTitle: t('items.detail.relations.remove_failed', { key: other.key }),
      run: async () => {
        try {
          await remove.mutateAsync(id);
        } catch (error) {
          back();
          throw error;
        }
      },
    });
  }

  return (
    <Section
      title={t('items.detail.relations.title')}
      actions={
        !editReason && (
          <Button ref={addButton} variant="ghost" size="sm" icon={Plus} shortcut={SHORTCUTS['item.relation'].keys} onClick={start}>
            {t('items.detail.relations.add')}
          </Button>
        )
      }
    >
      {[...groups].map(([label, entries]) => (
        <div key={label} className="mt-2">
          <p className="text-sm text-muted">{label}</p>
          <ul className="-mx-2 flex flex-col">
            {entries.map((entry) => {
              const other = entry.other;
              if (entry.hidden || !other) {
                return (
                  <li key={entry.relation.id} className="flex min-h-11 items-center gap-2 px-2 text-ui text-muted md:min-h-8">
                    <EyeOff className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('items.detail.relations.hidden')}
                  </li>
                );
              }
              return (
                <li key={entry.relation.id}>
                  <LinkedItem
                    item={other}
                    trailing={
                      !editReason && (
                        <IconButton icon={X} size="sm" label={t('items.detail.relations.remove', { label, key: other.key })} onClick={() => removeEntry(entry, other, label)} />
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {shown.length === 0 && <p className="mt-1 text-ui text-pretty text-muted">{t('items.detail.relations.empty')}</p>}
      {round > 0 && <RelationDialog key={round} item={item} open={adding} onOpenChange={setAdding} finalFocus={addButton} />}
    </Section>
  );
}
