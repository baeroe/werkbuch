/*
 * Settings → Security (spec 4.2): the password, and two-factor authentication with recovery codes. There is no server
 * for either in the prototype (`securityApi.ts`); the checks that are made are the ones the real app would show.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { notifyError } from '@/lib/errors';
import { useFieldErrors } from '../project/form';
import { SettingsCard, UnsavedGuard } from '../project/SettingsParts';
import { useChangePassword } from './securityApi';
import type { SectionProps } from './sectionProps';
import { TwoFactorCard } from './TwoFactor';

const MIN_LENGTH = 8;
const EMPTY = { current: '', next: '', again: '' };

function PasswordCard({ email }: { email: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  const change = useChangePassword();
  const problems = useFieldErrors(form);
  const [values, setValues] = useState(EMPTY);

  const edit = (field: keyof typeof EMPTY, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    problems.clear(field);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    const errors: Record<string, string> = {};
    if (values.current === '') errors.current = 'Gib dein aktuelles Passwort ein.';
    if (values.next.length < MIN_LENGTH) errors.next = `Mindestens ${MIN_LENGTH} Zeichen.`;
    if (values.again !== values.next) errors.again = 'Die Passwörter stimmen nicht überein.';
    if (Object.keys(errors).length > 0) {
      problems.show(errors);
      return;
    }
    try {
      await change.mutateAsync();
      setValues(EMPTY);
      problems.clearAll();
      toast({ title: 'Passwort geändert', description: 'Das neue Passwort gilt ab sofort.', tone: 'success' });
    } catch (error) {
      notifyError('Passwort nicht geändert', error, () => form.current?.requestSubmit());
    }
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)}>
      <UnsavedGuard dirty={values.current !== '' || values.next !== '' || values.again !== ''} saving={change.isPending} />
      <SettingsCard
        title="Passwort"
        description={`Wähle ein neues Passwort mit mindestens ${MIN_LENGTH} Zeichen.`}
        footer={
          <Button variant="primary" type="submit" pending={change.isPending}>
            Passwort ändern
          </Button>
        }
      >
        {/* lets password managers attach the new password to the right account */}
        <input type="hidden" name="username" autoComplete="username" value={email ?? ''} />
        <div className="flex max-w-sm flex-col gap-4">
          <Input
            label="Aktuelles Passwort"
            name="current-password"
            type="password"
            autoComplete="current-password"
            value={values.current}
            error={problems.errors.current}
            onChange={(event) => edit('current', event.target.value)}
          />
          <Input
            label="Neues Passwort"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={values.next}
            error={problems.errors.next}
            onChange={(event) => edit('next', event.target.value)}
          />
          <Input
            label="Neues Passwort wiederholen"
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

export function Security({ user }: SectionProps) {
  return (
    <>
      <PasswordCard email={user.email} />
      {/* a new person starts with a fresh card: no half-finished setup of somebody else */}
      <TwoFactorCard key={user.id} user={user} />
    </>
  );
}
