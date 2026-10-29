/*
 * Unsaved changes of a list (spec 4.11): when filter or display differ from the saved view (or from the built-in list),
 * a bar offers "Verwerfen", "Als neue View …" and, for a view, "Speichern".
 *
 * - Speichern changes the view for the whole team: only its creator and org admins may (`view.manage_any`); everybody
 *   else sees the button with the reason and can save a copy instead.
 * - Als neue View: anybody (spec: "Alle können eine View als neue View speichern"). The new view takes the list's scope
 *   along (the project of a project list, "mir zugewiesen" …), so it shows the same items; then it opens.
 */

import { Bookmark, Info, Save, Undo2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { useSaveView } from '@/hooks/views';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Condition, View } from '@/types';
import type { ViewState } from './viewState';

/** Icons to choose for a view (Lucide names of `ViewIcon`). */
const ICONS: { value: string; label: string }[] = [
  { value: 'layers', label: 'Stapel' },
  { value: 'calendar-clock', label: 'Kalender' },
  { value: 'bug', label: 'Käfer' },
  { value: 'building-2', label: 'Gebäude' },
  { value: 'user-round-check', label: 'Person' },
  { value: 'octagon-alert', label: 'Warnung' },
  { value: 'eye', label: 'Auge' },
  { value: 'route', label: 'Route' },
  { value: 'timer', label: 'Uhr' },
  { value: 'flag', label: 'Flagge' },
  { value: 'target', label: 'Ziel' },
  { value: 'rocket', label: 'Rakete' },
];

type SaveAsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ViewState;
  /** What the list holds besides its filter, and how it reads ("Projekt ist Website-Relaunch"). */
  scope: Condition[];
  scopeText: string | null;
  defaultName: string;
  defaultIcon: string;
};

/** The form of "Als neue View": name and icon. Mounted only while open, so it starts fresh every time. */
function SaveAsForm({
  state,
  scope,
  scopeText,
  defaultName,
  defaultIcon,
  onOpenChange,
  formId,
  save,
}: Omit<SaveAsDialogProps, 'open'> & { formId: string; save: ReturnType<typeof useSaveView> }) {
  const settle = useSettle();
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName);
  const [icon, setIcon] = useState(defaultIcon);
  const [error, setError] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  /** The name is wrong: say why at the field and put the focus there. */
  function refuse(message: string) {
    setError(message);
    nameField.current?.focus();
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (save.isPending) return;
    if (name.trim() === '') {
      refuse('Gib der View einen Namen, zum Beispiel „Offene Bugs“.');
      return;
    }
    settle(save.mutateAsync({ name: name.trim(), icon, filter: { version: 1, conditions: [...scope, ...state.filter.conditions] }, display: state.display }), {
      onSuccess: (view: View) => {
        onOpenChange(false);
        toast({ title: `View „${view.name}“ angelegt`, tone: 'success' });
        navigate(`/views/${view.id}`);
      },
      onError: (failure) => {
        const field = failure instanceof ApiError ? failure.errors?.name?.[0] : undefined;
        if (field) refuse(field);
        else notifyError('View nicht angelegt', failure, () => submit());
      },
    });
  }

  // ⌘↵ submits, as the button says
  useShortcut({ id: 'view.save_as.submit', keys: 'mod+enter', scope: 'dialog', label: 'View anlegen', group: 'Dialog', run: () => submit() });

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-4" aria-busy={save.isPending || undefined}>
      <Input
        ref={nameField}
        name="view-name"
        label="Name"
        value={name}
        error={error}
        hint="Alle im Team sehen die View unter „Alle Views“."
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(null);
        }}
      />
      <Select label="Icon" value={icon} onValueChange={(next) => next && setIcon(next)} options={ICONS.map((option) => ({ ...option, icon: <ViewIcon icon={option.value} className="text-muted" /> }))} />
      {scopeText && (
        <p className="flex items-start gap-2 rounded-ctl bg-sunken px-3 py-2 text-sm text-pretty text-ink">
          <Info className="mt-px size-4 shrink-0 text-muted" aria-hidden="true" />
          <span>
            Die View übernimmt dazu die Bedingung „{scopeText}“, damit sie dieselben Items zeigt.
          </span>
        </p>
      )}
    </form>
  );
}

export function SaveAsDialog(props: SaveAsDialogProps) {
  const formId = useId();
  const save = useSaveView();
  const { open, onOpenChange } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Als neue View speichern"
      description="Die View gehört dem ganzen Team. Sie übernimmt Filter und Anzeige dieser Liste."
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" shortcut="escape">
                Abbrechen
              </Button>
            }
          />
          <Button variant="primary" type="submit" form={formId} shortcut="mod+enter" pending={save.isPending}>
            View anlegen
          </Button>
        </>
      }
    >
      {open && <SaveAsForm {...props} formId={formId} save={save} />}
    </Dialog>
  );
}

type UnsavedBarProps = {
  /** The saved view of a view list; built-in lists have none. */
  view?: View;
  /** Why "Speichern" is not allowed (not the creator, no org admin), or null. */
  saveReason: string | null;
  /** Why "Als neue View" is not possible here, or null. */
  saveAsReason: string | null;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onSaveAs: () => void;
};

export function UnsavedBar({ view, saveReason, saveAsReason, saving, onDiscard, onSave, onSaveAs }: UnsavedBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl bg-sunken px-3 py-1.5">
      <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
        <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="min-w-0 text-pretty">
          <span className="font-semibold">Ungespeicherte Änderungen</span>
          {view ? <span className="text-muted"> an „{view.name}“</span> : <span className="text-muted"> an dieser Liste</span>}
        </span>
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" icon={Undo2} onClick={onDiscard}>
          Verwerfen
        </Button>
        <Button variant="secondary" size="sm" icon={Bookmark} disabledReason={saveAsReason} onClick={onSaveAs}>
          Als neue View …
        </Button>
        {view && (
          <Button variant="primary" size="sm" icon={Save} pending={saving} disabledReason={saveReason} onClick={onSave}>
            Speichern
          </Button>
        )}
      </div>
    </div>
  );
}
