/*
 * The dialog "Neue View" and, given a view, "View bearbeiten" (spec 4.11): name, icon and layout. A new view starts with
 * no filter and all items; the filter and the rest of the display are set in the view itself. Editing leaves them as
 * they are. Errors of the server stand at their field (422), the focus goes to the first one.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import type { ViewInput } from '@/api/views';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { useSaveView } from '@/hooks/views';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Display, View } from '@/types';
import { ICON_OPTIONS, LAYOUT_ORDER, LAYOUTS, newView } from './viewForm';

type Values = { name: string; icon: string; layout: Display['layout'] };
type FieldErrors = Record<string, string[]>;

type FormProps = {
  formId: string;
  view: View | null;
  errors: FieldErrors;
  onSubmit: (values: Values) => void;
};

function ViewForm({ formId, view, errors, onSubmit }: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(view?.name ?? '');
  const [icon, setIcon] = useState(view?.icon ?? 'layers');
  const [layout, setLayout] = useState<Display['layout']>(view?.display.layout ?? 'list');

  useShortcut({ id: 'view.dialog.submit', keys: 'mod+enter', scope: 'dialog', label: 'View speichern', group: 'Dialog', run: () => form.current?.requestSubmit() });
  // the first field with an error takes the focus, as the form could not be sent
  useEffect(() => {
    if (Object.keys(errors).length > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  // a view whose icon the list does not know (an emoji) keeps it as the first choice
  const options = ICON_OPTIONS.some((option) => option.value === icon) ? ICON_OPTIONS : [{ value: icon, label: 'Bisheriges Icon' }, ...ICON_OPTIONS];
  const other = Object.entries(errors).filter(([field]) => field !== 'name');

  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name, icon, layout });
      }}
      className="flex flex-col gap-4"
    >
      <Input
        label="Name"
        name="view_name"
        value={name}
        autoComplete="off"
        placeholder="Zum Beispiel „Kundenanfragen“ …"
        error={errors.name?.[0]}
        onChange={(event) => setName(event.target.value)}
      />
      <Select
        label="Icon"
        value={icon}
        onValueChange={(next) => next && setIcon(next)}
        options={options.map((option) => ({ value: option.value, label: option.label, icon: <ViewIcon icon={option.value} className="text-muted" /> }))}
      />
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-ink">Darstellung</p>
        <SegmentedControl
          label="Darstellung"
          value={layout}
          onValueChange={setLayout}
          options={LAYOUT_ORDER.map((value) => ({ value, label: LAYOUTS[value].label, icon: LAYOUTS[value].icon }))}
        />
      </div>
      {other.length > 0 && (
        <Banner tone="danger" role="alert" title="Die View ist nicht gültig">
          {other.map(([field, messages]) => (
            <p key={field}>{messages.join(' ')}</p>
          ))}
        </Banner>
      )}
    </form>
  );
}

type ViewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The view to change; null makes a new one. */
  view: View | null;
  onSaved: (view: View, created: boolean) => void;
};

export function ViewDialog({ open, onOpenChange, view, onSaved }: ViewDialogProps) {
  const formId = useId();
  const save = useSaveView();
  const [errors, setErrors] = useState<FieldErrors>({});
  const editing = view !== null;

  // a dialog opened again starts without the errors of the last time
  useEffect(() => {
    if (open) setErrors({});
  }, [open]);

  // one send at a time: mod+enter again before the first is answered would make a second view, and the callbacks of
  // `mutate` are only called for the last of several calls (the first one would never be heard)
  const sending = useRef(false);

  async function submit(values: Values) {
    if (sending.current) return;
    sending.current = true;
    setErrors({});
    const name = values.name.trim();
    const input: ViewInput = view ? { ...view, name, icon: values.icon, display: { ...view.display, layout: values.layout } } : newView(name, values.icon, values.layout);
    let saved: View;
    try {
      saved = await save.mutateAsync(input);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.errors) setErrors(error.errors);
      else notifyError(editing ? 'View nicht gespeichert' : 'View nicht angelegt', error, () => void submit(values));
      return;
    } finally {
      sending.current = false;
    }
    onSaved(saved, !editing);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={editing ? 'View bearbeiten' : 'Neue View'}
      description={editing ? 'Name, Icon und Darstellung. Den Filter änderst du in der View selbst.' : 'Eine View gehört dem ganzen Team. Den Filter legst du danach in der View fest.'}
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" shortcut="escape">
                Abbrechen
              </Button>
            }
          />
          <Button variant="primary" type="submit" form={formId} pending={save.isPending} shortcut="mod+enter">
            {editing ? 'Speichern' : 'View anlegen'}
          </Button>
        </>
      }
    >
      <ViewForm formId={formId} view={view} errors={errors} onSubmit={submit} />
    </Dialog>
  );
}
