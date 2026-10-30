/*
 * Sign-in (spec 4.2). Empty fields are refused here; everything else the server decides and names at the field (wrong
 * address or password, a locked address), with the focus on the first field it names.
 */

import { Link, useForm } from '@inertiajs/react';
import { LogIn } from 'lucide-react';
import { useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { AuthLayout } from './AuthLayout';
import { linkClass } from './links';

export default function Login() {
  const form = useForm({ email: '', password: '' });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function focusFirst(errors: Partial<Record<'email' | 'password', string>>) {
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Partial<Record<'email' | 'password', string>> = {};
    if (form.data.email.trim() === '') found.email = t('login.email_required');
    if (form.data.password === '') found.password = t('login.password_required');
    if (found.email || found.password) {
      form.clearErrors();
      form.setError(found);
      return focusFirst(found);
    }

    form.post('/login', { onError: focusFirst });
  }

  return (
    <AuthLayout tab={t('login.tab')} tabIcon={LogIn} title={t('login.title')} description={t('login.description')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          ref={emailRef}
          label={t('login.email')}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={form.data.email}
          onChange={(event) => {
            form.setData('email', event.target.value);
            form.clearErrors('email');
          }}
          error={form.errors.email}
        />
        <Input
          ref={passwordRef}
          label={t('login.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={form.data.password}
          onChange={(event) => {
            form.setData('password', event.target.value);
            form.clearErrors('password');
          }}
          error={form.errors.password}
        />
        <Button type="submit" variant="primary" pending={form.processing} className="mt-1 w-full">
          {t('login.submit')}
        </Button>
        <Link href="/forgot-password" className={linkClass('self-center')}>
          {t('login.forgot_link')}
        </Link>
      </form>
    </AuthLayout>
  );
}
