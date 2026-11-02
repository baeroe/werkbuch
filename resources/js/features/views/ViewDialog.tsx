/*
 * The dialog "Neue View" and, given a view, "View bearbeiten" (spec 4.11), ported from the clickdummy: name and icon
 * (`ViewFields`, shared with "Als neue View speichern", K23) and the layout. A new view starts with no filter and all
 * items (`newView`); the filter and the rest of the display are set in the view itself. Editing leaves the filter, the
 * rest of the display and the creator as they are. ⌘↵ sends once per press (`FormDialog`); a refusal of the name or
 * the icon stands at its field with the focus, any other on top, and a call that failed (5xx, no answer) says so in a
 * toast with a retry.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { FormDialog } from '@/components/ui/FormDialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ViewFields } from '@/features/items/save/ViewFields';
import { useSettle } from '@/hooks/mutation';
import { useSaveView } from '@/hooks/views';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Display, View, ViewInput } from '@/types';
import { LAYOUT_ORDER, LAYOUTS, newView } from './viewForm';

type Errors = { name?: string | undefined; icon?: string | undefined };

type ViewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The view to change; without one the dialog makes a new one. */
  view?: View | null;
  /** The view as the server saved it; `created` for a new one. */
  onSaved: (view: View, created: boolean) => void;
};

export function ViewDialog({ open, onOpenChange, view = null, onSaved }: ViewDialogProps) {
  const save = useSaveView();
  const settle = useSettle();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('layers');
  const [layout, setLayout] = useState<Display['layout']>('list');
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const editing = view !== null;

  // every opening starts afresh, from the view or empty
  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? '');
    setIcon(view?.icon ?? 'layers');
    setLayout(view?.display.layout ?? 'list');
    setErrors({});
    setNotice(null);
  }, [open, view]);

  function submit() {
    const trimmed = name.trim();
    setNotice(null);
    if (trimmed === '') {
      setErrors({ name: t('views.fields.name_required') });
      nameField.current?.focus();
      return;
    }
    setErrors({});
    const input: ViewInput = view
      ? { id: view.id, name: trimmed, icon, filter: view.filter, display: { ...view.display, layout } }
      : newView(trimmed, icon, layout);
    settle(save.mutateAsync(input), {
      onSuccess: (saved) => onSaved(saved, !editing),
      onError: (error) => {
        if (error instanceof ApiError && error.status < 500) {
          const fields: Errors = { name: error.errors?.name?.[0], icon: error.errors?.icon?.[0] };
          if (fields.name || fields.icon) setErrors(fields);
          else setNotice(Object.values(error.errors ?? {}).flat().join(' ') || error.message);
          return;
        }
        notifyError(t(editing ? 'views.dialog.save_failed' : 'views.dialog.create_failed'), error, submit);
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t(editing ? 'views.dialog.edit_title' : 'views.dialog.new_title')}
      description={t(editing ? 'views.dialog.edit_description' : 'views.dialog.new_description')}
      submitLabel={t(editing ? 'views.dialog.save' : 'views.dialog.create')}
      onSubmit={submit}
      pending={save.isPending}
      notice={notice}
    >
      <ViewFields
        name={name}
        onName={(next) => {
          setName(next);
          if (errors.name) setErrors({ ...errors, name: undefined });
        }}
        icon={icon}
        onIcon={(next) => {
          setIcon(next);
          if (errors.icon) setErrors({ ...errors, icon: undefined });
        }}
        errors={errors}
        nameRef={nameField}
      />
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-ink">{t('views.dialog.layout')}</p>
        <SegmentedControl
          label={t('views.dialog.layout')}
          value={layout}
          onValueChange={setLayout}
          options={LAYOUT_ORDER.map((value) => ({ value, label: t(LAYOUTS[value].label), icon: LAYOUTS[value].icon }))}
        />
      </div>
    </FormDialog>
  );
}
