/*
 * The second step of signing in with two-factor authentication (spec 4.2): the code of the authenticator app, or one of
 * the recovery codes instead. The field in use has the focus, also after switching; an empty field is refused here,
 * everything else (a wrong or used code, the limit) the server names at the field.
 */

import { Link, useForm } from '@inertiajs/react';
import { LogIn } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { AuthLayout } from './AuthLayout';
import { linkClass } from './links';

type Mode = 'code' | 'recovery_code';

export default function TwoFactorChallenge() {
  const [mode, setMode] = useState<Mode>('code');
  const form = useForm({ code: '', recovery_code: '' });
  const field = useRef<HTMLInputElement>(null);

  // the field in use takes the focus: on arrival (right after the password) and after every switch
  useEffect(() => field.current?.focus(), [mode]);

  function switchMode() {
    const next: Mode = mode === 'code' ? 'recovery_code' : 'code';
    // only the field in use goes to the server
    form.setData(mode, '');
    form.clearErrors();
    setMode(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.data[mode].trim() === '') {
      form.setError(mode, t(mode === 'code' ? 'two_factor_challenge.code_required' : 'two_factor_challenge.recovery_code_required'));
      field.current?.focus();
      return;
    }

    form.post('/two-factor-challenge', { onError: () => field.current?.focus() });
  }

  const recovery = mode === 'recovery_code';

  return (
    <AuthLayout
      tab={t('login.tab')}
      tabIcon={LogIn}
      title={t('two_factor_challenge.title')}
      description={t(recovery ? 'two_factor_challenge.recovery_description' : 'two_factor_challenge.description')}
      footer={
        <Link href="/login" className={linkClass()}>
          {t('two_factor_challenge.back')}
        </Link>
      }
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {recovery ? (
          <Input
            key="recovery_code"
            ref={field}
            label={t('two_factor_challenge.recovery_code')}
            hint={t('two_factor_challenge.recovery_code_hint')}
            name="recovery_code"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={form.data.recovery_code}
            onChange={(event) => {
              form.setData('recovery_code', event.target.value);
              form.clearErrors('recovery_code');
            }}
            error={form.errors.recovery_code}
          />
        ) : (
          <Input
            key="code"
            ref={field}
            label={t('two_factor_challenge.code')}
            hint={t('two_factor_challenge.code_hint')}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={form.data.code}
            onChange={(event) => {
              form.setData('code', event.target.value);
              form.clearErrors('code');
            }}
            error={form.errors.code}
          />
        )}
        <Button type="submit" variant="primary" pending={form.processing} className="mt-1 w-full">
          {t('two_factor_challenge.submit')}
        </Button>
        <button type="button" onClick={switchMode} className={linkClass('self-center')}>
          {t(recovery ? 'two_factor_challenge.use_code' : 'two_factor_challenge.use_recovery_code')}
        </button>
      </form>
    </AuthLayout>
  );
}
