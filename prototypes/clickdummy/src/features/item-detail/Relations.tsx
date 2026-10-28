/*
 * The relations of an item (spec 4.9), grouped by what they say from this item's side ("blockiert", "wird blockiert
 * von", "testet" …). Each other item opens where the detail is; an item the reader may not see is "verborgenes
 * Item", without key or title, and it can't be removed here (the server answers 404 for it). Removing waits for its
 * undo toast. `r` (or "Relation") opens the dialog: the kind of relation in both directions, then the item.
 */

import { EyeOff, Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { useEditReason } from '@/components/fields/itemData';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { ItemKey } from '@/components/items/ItemKey';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { describedBy, Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useRelationTypes } from '@/hooks/catalog';
import { useAddRelation, useRemoveRelation } from '@/hooks/relations';
import { useWorkItems } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { runWithUndo } from '@/lib/undo';
import type { RelationEntry, RelationType, WorkItem, WorkItemDetail } from '@/types';
import { focusWhenLost, LinkedItem, Section, useDetail } from './shared';

/** What a relation says from the side of the item that shows it. */
export function relationLabel(type: RelationType | undefined, direction: RelationEntry['direction']): string {
  if (!type) return 'verknüpft mit';
  return direction === 'inward' && type.inward_label !== null ? type.inward_label : type.outward_label;
}

/** The kinds of relation to choose from, both directions of each type: `rt_blocks:out` "blockiert" … */
function kindsOf(types: readonly RelationType[]) {
  return types.flatMap((type) => [
    { value: `${type.id}:out`, label: type.outward_label },
    ...(type.inward_label !== null ? [{ value: `${type.id}:in`, label: type.inward_label }] : []),
  ]);
}

/* ------------------------------------------------------------------------- the dialog */

const ITEM_HINT = 'Key oder Titel tippen, Enter wählt.';

type RelationDialogProps = { item: WorkItem; open: boolean; onOpenChange: (open: boolean) => void };

function RelationDialog({ item, open, onOpenChange }: RelationDialogProps) {
  const formId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Relation hinzufügen"
      description={`Wie hängt ${item.key} mit einem anderen Item zusammen? Nur „blockiert“ hat eine Folge: Das blockierte Item zeigt einen Hinweis.`}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">Abbrechen</Button>} />
          <Button variant="primary" type="submit" form={formId} shortcut="mod+enter">
            Hinzufügen
          </Button>
        </>
      }
    >
      {open && <RelationForm formId={formId} item={item} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function RelationForm({ formId, item, onDone }: { formId: string; item: WorkItem; onDone: () => void }) {
  const relationTypes = useRelationTypes();
  const workItems = useWorkItems({ per_page: 100 });
  const types = useWorkItemTypes().data?.items;
  const add = useAddRelation();
  const form = useRef<HTMLFormElement>(null);
  const itemFieldId = useId();
  const kinds = kindsOf(relationTypes.data?.items ?? []);
  const [kind, setKind] = useState<string | null>(null);
  const chosenKind = kind ?? kinds.find((entry) => entry.value.startsWith('rt_relates'))?.value ?? kinds[0]?.value ?? null;
  const [targetId, setTargetId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errors, setErrorState] = useState<{ kind?: string; target?: string; form?: string }>({});
  const [refused, setRefused] = useState(0);
  /** Errors of a submit: shown at their fields, and the focus goes to the first of them. */
  const setErrors = (next: { kind?: string; target?: string; form?: string }) => {
    setErrorState(next);
    if (next.kind || next.target) setRefused((count) => count + 1);
  };

  // the list opens with the dialog: typing a key or title finds the item at once
  useEffect(() => {
    const timer = setTimeout(() => setPickerOpen(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (refused > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refused]);

  useShortcut({ id: 'relation.add', keys: 'mod+enter', scope: 'dialog', label: 'Relation hinzufügen', group: 'Dialog', run: () => form.current?.requestSubmit() });

  const candidates = useMemo(() => (workItems.data?.items ?? []).filter((entry) => entry.id !== item.id), [workItems.data, item.id]);
  const options: PickerOption[] = candidates.map((entry) => {
    const type = types?.find((candidate) => candidate.id === entry.type_id);
    return { value: entry.id, label: entry.title, hint: entry.key, keywords: [entry.key], icon: type ? <TypeGlyph type={type} /> : undefined };
  });
  const target = candidates.find((entry) => entry.id === targetId);
  const label = kinds.find((entry) => entry.value === chosenKind)?.label ?? '';

  function submit() {
    if (!chosenKind) return setErrors({ kind: 'Wähle, wie die Items zusammenhängen.' });
    if (!target) return setErrors({ target: 'Wähle das Item, mit dem es zusammenhängt.' });
    const [typeId, direction] = chosenKind.split(':');
    const [source, other] = direction === 'out' ? [item, target] : [target, item];
    setErrors({});
    add.mutate(
      { source_id: source.id, type_id: typeId, target_id: other.id },
      {
        onSuccess: () => {
          toast({ title: 'Relation hinzugefügt', description: `${item.key} ${label} ${target.key}`, tone: 'success' });
          onDone();
        },
        onError: (error) => {
          const fields = error instanceof ApiError ? error.errors : undefined;
          if (fields?.target_id || fields?.type_id) setErrors({ target: fields.target_id?.[0], kind: fields.type_id?.[0] });
          else if (error instanceof ApiError && error.status < 500) setErrors({ form: error.message });
          else notifyError('Relation nicht hinzugefügt', error, submit);
        },
      },
    );
  }

  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      {errors.form && (
        <Banner tone="danger" role="alert" title="Nicht hinzugefügt">
          {errors.form}
        </Banner>
      )}
      <Select
        label="Art der Relation"
        options={kinds}
        value={chosenKind}
        onValueChange={(next) => {
          setKind(next);
          setErrors({});
        }}
        error={errors.kind}
      />
      <Field id={itemFieldId} label="Item" hint={workItems.isError ? undefined : ITEM_HINT} error={errors.target}>
        <Picker
          id={itemFieldId}
          look="form"
          label="Item"
          display={
            target ? (
              <span className="flex min-w-0 items-center gap-2">
                <ItemKey value={target.key} className="text-muted" />
                <span className="truncate">{target.title}</span>
              </span>
            ) : (
              <span className="text-muted">Item wählen …</span>
            )
          }
          displayText={target ? `${target.key} ${target.title}` : 'keins gewählt'}
          options={options}
          value={targetId}
          onValueChange={(next) => {
            setTargetId(next);
            setErrors({});
          }}
          placeholder="Key oder Titel suchen …"
          emptyText="Kein Item passt."
          load={{ isLoading: workItems.isPending, error: workItems.error, retry: () => void workItems.refetch(), retrying: workItems.isFetching }}
          describedBy={describedBy(itemFieldId, { hint: workItems.isError ? undefined : ITEM_HINT, error: errors.target })}
          invalid={Boolean(errors.target)}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />
      </Field>
      {target && label && (
        <p className="text-ui text-pretty text-muted">
          <ItemKey value={item.key} className="text-ink" /> {label} <ItemKey value={target.key} className="text-ink" />
        </p>
      )}
    </form>
  );
}

/* ----------------------------------------------------------------------------- section */

export function Relations({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const { actions } = useDetail();
  const editReason = useEditReason(item);
  const { reason } = usePermissions();
  const relationTypes = useRelationTypes().data?.items;
  const remove = useRemoveRelation();
  const [adding, setAdding] = useState(false);
  /** Removed, while their undo toast stands. */
  const [gone, setGone] = useState<string[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const own = actions.current;
    const start = () => (editReason ? toast({ title: 'Nicht möglich', description: editReason, tone: 'error' }) : setAdding(true));
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

  function removeEntry(entry: RelationEntry, label: string) {
    const other = entry.other;
    if (!other) return;
    const id = entry.relation.id;
    setGone((current) => [...current, id]);
    // its remove button goes with it: the focus moves on to "Relation"
    focusWhenLost(() => addButton.current);
    const back = () => setGone((current) => current.filter((entryId) => entryId !== id));
    runWithUndo({
      label: `Relation entfernt: ${label} ${other.key}`,
      undo: back,
      failureTitle: `Relation zu ${other.key} nicht entfernt`,
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
      title="Relationen"
      actions={
        !editReason && (
          <Button ref={addButton} variant="ghost" size="sm" icon={Plus} shortcut="r" onClick={() => setAdding(true)}>
            Relation
          </Button>
        )
      }
    >
      {[...groups].map(([label, entries]) => (
        <div key={label} className="mt-2">
          <p className="text-sm text-muted">{label}</p>
          <ul className="-mx-2 flex flex-col">
            {entries.map((entry) => {
              if (entry.hidden || !entry.other) {
                return (
                  <li key={entry.relation.id} className="flex min-h-11 items-center gap-2 px-2 text-ui text-muted md:min-h-8">
                    <EyeOff className="size-3.5 shrink-0" aria-hidden="true" />
                    verborgenes Item
                  </li>
                );
              }
              const other = entry.other;
              // the server checks the right in the project of the relation's source
              const source = entry.direction === 'outward' ? item : other;
              const removeReason = editReason ?? reason('item.edit', source.project_id);
              return (
                <li key={entry.relation.id}>
                  <LinkedItem
                    item={other}
                    trailing={
                      !editReason && (
                        <IconButton icon={X} size="sm" label={`Relation „${label} ${other.key}“ entfernen`} disabledReason={removeReason} onClick={() => removeEntry(entry, label)} />
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {shown.length === 0 && (
        <p className="mt-1 text-ui text-pretty text-muted">Keine Relationen. Mit R verknüpfst du das Item, zum Beispiel „blockiert“ oder „testet“.</p>
      )}
      <RelationDialog item={item} open={adding} onOpenChange={setAdding} />
    </Section>
  );
}
