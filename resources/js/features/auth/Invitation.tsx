/*
 * Accepting an invitation (spec 4.2): the invited person chooses a name and a password and is signed in. The page and its
 * form belong to the signed link (Auth/InvitationController), so the form posts to the address the page was opened
 * with. Empty fields are refused here; the rules of the password and a link that stopped working in the meantime the
 * server names. A link that is expired or closed shows a notice and the way to the sign-in instead of the form.
 */

import { Link, useForm, usePage } from '@inertiajs/react';
import { MailOpen } from 'lucide-react';
import { useRef, type FormEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useSharedProps } from '@/lib/page';
import { AuthLayout } from './AuthLayout';
import { linkClass } from './links';

type Field = 'name' | 'password';

/** The props of the page `Auth/Invitation` (Auth\InvitationController); the address only comes with a link that can be accepted. */
export interface InvitationProps {
  state: 'open' | 'expired' | 'closed';
  email: string | null;
}

export default function Invitation() {
  const { state, email } = usePage<InvitationProps & Record<string, unknown>>().props;
  const { url } = usePage();
  const { organization } = useSharedProps();
  const form = useForm({ name: '', password: '' });
  const refs = { name: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  function focusFirst(errors: Partial<Record<Field, string>>) {
    const first = (['name', 'password'] as const).find((field) => errors[field]);
    if (first) refs[first].current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Partial<Record<Field, string>> = {};
    if (form.data.name.trim() === '') found.name = t('invitation.name_required');
    if (form.data.password === '') found.password = t('invitation.password_required');
    if (found.name || found.password) {
      form.clearErrors();
      form.setError(found);
      return focusFirst(found);
    }

    form.post(url, { onError: focusFirst });
  }

  const open = state === 'open';
  // the server also answers at `invitation` (the limit, a link that stopped working): no field of the form, so no key of its type
  const linkError = (form.errors as Partial<Record<string, string>>).invitation;

  return (
    <AuthLayout
      tab={t('invitation.tab')}
      tabIcon={MailOpen}
      title={t('invitation.title')}
      description={open ? t('invitation.description', { organization: organization.name }) : null}
    >
      {open ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {/* the address of the invitation is the user name of the new account: password managers save it with the password */}
          <input type="email" name="email" autoComplete="username" value={email ?? ''} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
          {linkError && <Banner tone="danger" role="alert" title={linkError} />}
          <Input
            ref={refs.name}
            label={t('invitation.name')}
            name="name"
            autoComplete="name"
            value={form.data.name}
            onChange={(event) => {
              form.setData('name', event.target.value);
              form.clearErrors('name');
            }}
            hint={t('invitation.name_hint')}
            error={form.errors.name}
          />
          <Input
            ref={refs.password}
            label={t('invitation.password')}
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.data.password}
            onChange={(event) => {
              form.setData('password', event.target.value);
              form.clearErrors('password');
            }}
            hint={t('invitation.password_hint')}
            error={form.errors.password}
          />
          <Button type="submit" variant="primary" pending={form.processing} className="mt-1 w-full">
            {t('invitation.submit')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Banner tone="danger" title={t(state === 'expired' ? 'invitation.expired' : 'invitation.closed')} />
          <Link href={paths.login()} className={linkClass()}>
            {t('invitation.to_login')}
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
