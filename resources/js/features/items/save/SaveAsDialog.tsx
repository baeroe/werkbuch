/*
 * "Als neue View speichern" (spec 4.11), ported from the clickdummy: name and icon (`ViewFields`), then a new view of the
 * team with the filter and the display of the list; a built-in list hands over its scope and says which condition that
 * is (P28). The new view opens. ⌘↵ sends, once per press (`FormDialog`); a refusal of a field stands at it with the
 * focus, one without a field on top, and a call that failed (5xx, no answer) says so in a toast with a retry.
 */

import { router } from '@inertiajs/react';
import { Info } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { FormDialog } from '@/components/ui/FormDialog';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { View } from '@/types';
import { ViewFields } from './ViewFields';

type SaveAsDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Makes the view (`useListSave().saveAs`). */
  saveAs(name: string, icon: string): Promise<View>;
  pending: boolean;
  /** Why the view cannot be sent (a condition on a field that is gone), or null. */
  blocked?: string | null;
  /** The scope a built-in list hands over, as it reads ("Projekt ist Website-Relaunch"), or null. */
  scopeText: string | null;
  defaultName: string;
  defaultIcon: string;
  finalFocus?: RefObject<HTMLElement | null>;
};

type Errors = { name?: string | undefined; icon?: string | undefined };

export function SaveAsDialog({ open, onOpenChange, saveAs, pending, blocked = null, scopeText, defaultName, defaultIcon, finalFocus }: SaveAsDialogProps) {
  const settle = useSettle();
  const [name, setName] = useState(defaultName);
  const [icon, setIcon] = useState(defaultIcon);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  // every opening starts afresh
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setIcon(defaultIcon);
    setErrors({});
    setNotice(null);
  }, [open, defaultName, defaultIcon]);

  function submit() {
    // ⌘↵ reaches here past the blocked button: nothing goes to a server that would refuse it
    if (blocked) return;
    const trimmed = name.trim();
    setNotice(null);
    if (trimmed === '') {
      setErrors({ name: t('views.fields.name_required') });
      nameField.current?.focus();
      return;
    }
    setErrors({});
    settle(saveAs(trimmed, icon), {
      onSuccess: (view) => {
        onOpenChange(false);
        toast({ title: t('items.save.created', { name: view.name }), tone: 'success' });
        router.visit(paths.view(view.id));
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status < 500) {
          const fields: Errors = { name: error.errors?.name?.[0], icon: error.errors?.icon?.[0] };
          if (fields.name || fields.icon) setErrors(fields);
          // the sentences of the fields the dialog does not have (the filter, the display) say more than the general one
          else setNotice(Object.values(error.errors ?? {}).flat().join(' ') || error.message);
          return;
        }
        notifyError(t('items.save.create_failed'), error, submit);
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('items.save.dialog.title')}
      description={t('items.save.dialog.description')}
      submitLabel={t('items.save.dialog.submit')}
      onSubmit={submit}
      pending={pending}
      submitDisabledReason={blocked}
      notice={notice}
      finalFocus={finalFocus}
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
      {scopeText && (
        <p className="flex items-start gap-2 rounded-ctl bg-sunken px-3 py-2 text-sm text-pretty text-ink">
          <Info className="mt-px size-4 shrink-0 text-muted" aria-hidden="true" />
          <span>{t('items.save.dialog.scope', { condition: scopeText })}</span>
        </p>
      )}
    </FormDialog>
  );
}
