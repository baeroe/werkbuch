/*
 * Setting a new password from the link of the mail (spec 4.2). The address comes with the link and stays read-only.
 * Empty fields are refused here; the rules and a used or expired link the server names at the field. For a link that
 * no longer works the screen offers a new one.
 */

import { Link, useForm, usePage } from '@inertiajs/react';
import { KeyRound } from 'lucide-react';
import { useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { AuthLayout } from './AuthLayout';
import { linkClass } from './links';

type Field = 'email' | 'password' | 'password_confirmation';

/** The props of the page `Auth/ResetPassword` (FortifyServiceProvider). */
export interface ResetPasswordProps {
  token: string;
  email: string;
}

export default function ResetPassword() {
  const { token, email } = usePage<ResetPasswordProps & Record<string, unknown>>().props;
  const form = useForm({ token, email, password: '', password_confirmation: '' });
  const refs = {
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    password_confirmation: useRef<HTMLInputElement>(null),
  };

  function focusFirst(errors: Partial<Record<Field, string>>) {
    const first = (['email', 'password', 'password_confirmation'] as const).find((field) => errors[field]);
    if (first) refs[first].current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Partial<Record<Field, string>> = {};
    if (form.data.password === '') found.password = t('reset_password.password_required');
    if (form.data.password_confirmation === '') found.password_confirmation = t('reset_password.confirmation_required');
    if (found.password || found.password_confirmation) {
      form.clearErrors();
      form.setError(found);
      return focusFirst(found);
    }

    form.post('/reset-password', { onError: focusFirst });
  }

  return (
    <AuthLayout
      tab={t('reset_password.tab')}
      tabIcon={KeyRound}
      title={t('reset_password.title')}
      description={t('reset_password.description')}
      footer={
        <Link href="/login" className={linkClass()}>
          {t('reset_password.back')}
        </Link>
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          ref={refs.email}
          label={t('reset_password.email')}
          name="email"
          type="email"
          autoComplete="username"
          readOnly
          value={form.data.email}
          error={
            form.errors.email && (
              <span>
                {form.errors.email}{' '}
                <Link href="/forgot-password" className="text-accent-text underline underline-offset-2">
                  {t('reset_password.request_new')}
                </Link>
              </span>
            )
          }
        />
        <Input
          ref={refs.password}
          label={t('reset_password.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.data.password}
          onChange={(event) => {
            form.setData('password', event.target.value);
            form.clearErrors('password');
          }}
          error={form.errors.password}
        />
        <Input
          ref={refs.password_confirmation}
          label={t('reset_password.confirmation')}
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          value={form.data.password_confirmation}
          onChange={(event) => {
            form.setData('password_confirmation', event.target.value);
            form.clearErrors('password_confirmation');
          }}
          error={form.errors.password_confirmation}
        />
        <Button type="submit" variant="primary" pending={form.processing} className="mt-1 w-full">
          {t('reset_password.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
