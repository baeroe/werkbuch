/*
 * Quick add at the top of a board column (spec 4.11: "Schnellanlage oben in jeder Spalte"). A title and Enter make an
 * item with the column's value of the grouped field (`quickAddFields`): its status, priority, assignee, type, label or
 * parent. A status other than the start status is checked like a move from the start status, so the column offers no
 * quick add where the workflow forbids it (BoardColumn shows the reason). The form stays open for the next title;
 * Escape closes it. On a board that spans projects a select chooses the project.
 */

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { Select } from '@/components/ui/Select';
import { useCreateWorkItem } from '@/hooks/workItems';
import { notifyError } from '@/lib/errors';
import type { Project, WorkItem } from '@/types';
import type { QuickAddFields } from './rules';

export interface QuickAddOption {
  project: Project;
  fields: QuickAddFields;
}

type QuickAddProps = {
  /** The column's name: "Neues Item in Todo". */
  columnLabel: string;
  /** The projects an item can be made in here, the likeliest first; never empty. */
  options: QuickAddOption[];
  /** Fields the list itself implies (Meine Items: assigned to me), where the column sets none. */
  defaults?: Pick<QuickAddFields, 'assignee_id'>;
  onCreated: (item: WorkItem) => void;
  onClose: () => void;
};

export function QuickAdd({ columnLabel, options, defaults, onCreated, onClose }: QuickAddProps) {
  const create = useCreateWorkItem();
  const formId = useId();
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(options[0].project.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const option = options.find((entry) => entry.project.id === projectId) ?? options[0];
  /** An error belongs to the title: the field says it and takes the focus (also after a click on "Anlegen"). */
  const fail = (message: string) => {
    setError(message);
    field.current?.focus();
  };

  async function send(text: string) {
    setBusy(true);
    setError(null);
    try {
      const { fields, project } = option;
      const item = await create.mutateAsync({
        ...fields,
        assignee_id: fields.assignee_id ?? defaults?.assignee_id,
        type_id: fields.type_id ?? project.default_type_id,
        title: text,
      });
      // ready for the next one
      setTitle((current) => (current.trim() === text ? '' : current));
      onCreated(item);
    } catch (failure) {
      // a refusal belongs to the field; a server that did not answer gets the toast with "Erneut versuchen"
      if (failure instanceof ApiError && failure.status < 500) fail(failure.errors?.title?.[0] ?? failure.message);
      else notifyError('Item nicht angelegt', failure, () => void send(text));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (busy) return;
    if (text === '') {
      fail('Gib einen Titel ein.');
      return;
    }
    void send(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // Escape belongs to the form: it closes it (the page's own Escape would move the focus elsewhere); an Escape from
    // the project list (a portal) only closes that list
    if (event.key !== 'Escape' || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <form id={formId} onSubmit={submit} onKeyDown={onKeyDown} className="mt-1 flex flex-col gap-2 rounded-card border border-line bg-surface p-2.5 shadow-elev-1">
      <Input
        ref={field}
        label={`Neues Item in ${columnLabel}`}
        name="title"
        placeholder="Titel …"
        autoComplete="off"
        // the "+" of the column asked for this field
        autoFocus
        value={title}
        error={error}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(null);
        }}
      />
      {options.length > 1 && (
        <Select
          aria-label="Projekt"
          value={option.project.id}
          onValueChange={(next) => next && setProjectId(next)}
          options={options.map((entry) => ({ value: entry.project.id, label: `${entry.project.name} (${entry.project.identifier})` }))}
        />
      )}
      <div className="flex items-center gap-1.5 text-sm text-muted">
        <span className="inline-flex items-center gap-1 max-md:hidden">
          <Kbd keys="enter" /> anlegen
        </span>
        <span className="inline-flex items-center gap-1 max-md:hidden">
          <Kbd keys="escape" /> schließen
        </span>
        <Button type="submit" variant="primary" size="sm" pending={busy} className="ml-auto">
          Anlegen
        </Button>
      </div>
    </form>
  );
}
