/*
 * "Passwort vergessen" (spec 4.2): a link to set a new password goes out by mail. The answer does not tell whether an
 * account exists for the address. In the clickdummy no mail is sent; only an empty field is refused.
 */

import { KeyRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthLayout } from './AuthLayout';

const SEND_MS = 400;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);

  // the form is gone: the focus moves to the answer, so screen readers read it
  useEffect(() => {
    if (sentTo) confirmation.current?.focus();
  }, [sentTo]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim() === '') {
      setError('Gib die E-Mail-Adresse deines Kontos ein.');
      emailRef.current?.focus();
      return;
    }
    setPending(true);
    window.setTimeout(() => setSentTo(email.trim()), SEND_MS);
  }

  return (
    <AuthLayout
      tab="Passwort"
      tabIcon={KeyRound}
      title="Passwort vergessen"
      description="Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst."
      // once the link is out, the card itself leads back
      footer={
        !sentTo && (
          <Link to="/login" className="inline-flex h-11 items-center rounded-chip px-2 font-medium text-accent-text underline-offset-2 hover:underline md:h-8">
            Zurück zur Anmeldung
          </Link>
        )
      }
    >
      {sentTo ? (
        <div className="flex flex-col gap-5">
          <p ref={confirmation} tabIndex={-1} data-focus-ring="none" className="rounded-ctl bg-sunken px-3 py-2.5 text-ui text-pretty text-ink outline-none">
            Wenn es ein Konto für <span className="font-semibold break-all">{sentTo}</span> gibt, ist der Link jetzt unterwegs. Schau auch im Spam-Ordner nach.
          </p>
          <Link to="/login" className={buttonClass({ variant: 'primary' }, 'w-full')}>
            Zur Anmeldung
          </Link>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Input
            ref={emailRef}
            label="E-Mail"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(undefined);
            }}
            hint="Die Adresse, mit der du dich anmeldest."
            error={error}
          />
          <Button type="submit" variant="primary" pending={pending} className="mt-1 w-full">
            Link senden
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
