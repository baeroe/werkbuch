/*
 * Settings → Security (spec 4.2): the password, and two-factor authentication with recovery codes. Changing the password
 * keeps this session and ends every other one (the server does that, the toast says it). The form checks what it can
 * before it asks (the current password is there, the new one is long enough and typed twice the same); what the server
 * refuses shows at its field.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useChangePassword } from '@/hooks/security';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { User } from '@/types';
import { fieldMessage, useFieldErrors } from '../frame/form';
import { LeaveGuard } from '../frame/LeaveGuard';
import { SettingsCard } from '../frame/parts';
import { TwoFactorCard } from './TwoFactor';

/** PasswordRules::MIN_LENGTH on the server. */
const MIN_LENGTH = 8;
const EMPTY = { current: '', next: '', again: '' };
type PasswordField = keyof typeof EMPTY;

/** The fields of the request and the field of the form each one belongs to. */
const FIELD_OF: Record<string, PasswordField> = { current_password: 'current', password: 'next', password_confirmation: 'again' };

function PasswordCard({ email, guarded }: { email: string | null; guarded: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const change = useChangePassword();
  const problems = useFieldErrors(form);
  const [values, setValues] = useState(EMPTY);

  const edit = (field: PasswordField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    problems.clear(field);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    const errors: Record<string, string> = {};
    if (values.current === '') errors.current = t('settings.security.password.current_required');
    if (values.next.length < MIN_LENGTH) errors.next = t('settings.security.password.too_short', { min: MIN_LENGTH });
    if (values.again !== values.next) errors.again = t('settings.security.password.mismatch');
    if (Object.keys(errors).length > 0) {
      problems.show(errors);
      return;
    }
    try {
      await change.mutateAsync({ current_password: values.current, password: values.next, password_confirmation: values.again });
      setValues(EMPTY);
      problems.clearAll();
      toast({ title: t('settings.security.password.changed'), description: t('settings.security.password.changed_description'), tone: 'success' });
    } catch (error) {
      // a refusal (422), and the limit of tries (429), which the server names at the current password
      const fields = Object.entries(FIELD_OF).flatMap(([path, field]) => {
        const message = fieldMessage(error, path);
        return message ? [[field, message]] : [];
      });
      if (fields.length > 0) problems.show(Object.fromEntries(fields));
      else notifyError(t('settings.security.password.not_changed'), error, () => form.current?.requestSubmit());
    }
  }

  const dirty = values.current !== '' || values.next !== '' || values.again !== '';

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)}>
      <LeaveGuard dirty={dirty && guarded} what={t('settings.security.password.leave_what')} />
      <SettingsCard
        title={t('settings.security.password.title')}
        description={t('settings.security.password.description', { min: MIN_LENGTH })}
        footer={
          <Button variant="primary" type="submit" pending={change.isPending}>
            {t('settings.security.password.submit')}
          </Button>
        }
      >
        {/* lets password managers attach the new password to the right account */}
        <input type="hidden" name="username" autoComplete="username" value={email ?? ''} />
        <div className="flex max-w-sm flex-col gap-4">
          <Input
            label={t('settings.security.password.current')}
            name="current-password"
            type="password"
            autoComplete="current-password"
            value={values.current}
            error={problems.errors.current}
            onChange={(event) => edit('current', event.target.value)}
          />
          <Input
            label={t('settings.security.password.new')}
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={values.next}
            error={problems.errors.next}
            onChange={(event) => edit('next', event.target.value)}
          />
          <Input
            label={t('settings.security.password.again')}
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={values.again}
            error={problems.errors.again}
            onChange={(event) => edit('again', event.target.value)}
          />
        </div>
      </SettingsCard>
    </form>
  );
}

export function Security({ user }: { user: User }) {
  // while the recovery codes show, their question is the one that counts: one dialog, not two
  const [codesShown, setCodesShown] = useState(false);
  return (
    <>
      <PasswordCard email={user.email} guarded={!codesShown} />
      <TwoFactorCard user={user} onCodesShown={setCodesShown} />
    </>
  );
}
