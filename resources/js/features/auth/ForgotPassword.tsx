/*
 * "Forgot password" (spec 4.2): a link to set a new password goes out by mail. The answer does not tell whether an
 * account exists for the address: after sending, the confirmation replaces the form either way. Without a mail server
 * the screen says who resets the password instead.
 */

import { Link, useForm } from '@inertiajs/react';
import { KeyRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { buttonClass, Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { useSharedProps } from '@/lib/page';
import { AuthLayout } from './AuthLayout';
import { linkClass } from './links';

const RESET_COMMAND = 'php artisan app:reset-password';

export default function ForgotPassword() {
  const { features } = useSharedProps();
  const form = useForm({ email: '' });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);

  // the form is gone: the focus moves to the answer, so screen readers read it
  useEffect(() => {
    if (sentTo) confirmation.current?.focus();
  }, [sentTo]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = form.data.email.trim();
    if (email === '') {
      form.setError('email', t('forgot_password.email_required'));
      emailRef.current?.focus();
      return;
    }

    form.post('/forgot-password', {
      onSuccess: () => setSentTo(email),
      onError: () => emailRef.current?.focus(),
    });
  }

  const [sentBefore, sentAfter] = t('forgot_password.sent').split(':email');
  const [noMailBefore, noMailAfter] = t('forgot_password.no_mail').split(':command');

  return (
    <AuthLayout
      tab={t('forgot_password.tab')}
      tabIcon={KeyRound}
      title={t('forgot_password.title')}
      description={t('forgot_password.description')}
      // the confirmation below is the answer of the server
      hideStatus
      // once the link is out, the card itself leads back
      footer={
        !sentTo && (
          <Link href="/login" className={linkClass()}>
            {t('forgot_password.back')}
          </Link>
        )
      }
    >
      {!features.mail ? (
        <Banner
          tone="info"
          title={
            <>
              {noMailBefore}
              <code className="break-all">{RESET_COMMAND}</code>
              {noMailAfter}
            </>
          }
        />
      ) : sentTo ? (
        <div className="flex flex-col gap-5">
          <p ref={confirmation} tabIndex={-1} data-focus-ring="none" className="rounded-ctl bg-sunken px-3 py-2.5 text-ui text-pretty text-ink outline-none">
            {sentBefore}
            <span className="font-semibold break-all">{sentTo}</span>
            {sentAfter}
          </p>
          <Link href="/login" className={buttonClass({ variant: 'primary' }, 'w-full')}>
            {t('forgot_password.to_login')}
          </Link>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Input
            ref={emailRef}
            label={t('forgot_password.email')}
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
            hint={t('forgot_password.email_hint')}
            error={form.errors.email}
          />
          <Button type="submit" variant="primary" pending={form.processing} className="mt-1 w-full">
            {t('forgot_password.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
