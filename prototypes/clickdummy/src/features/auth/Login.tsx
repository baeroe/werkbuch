/*
 * Sign-in (spec 4.2). In the clickdummy every input counts as valid: the address of an active demo person signs in as
 * that person, any other address keeps whoever is signed in now. Only empty fields are refused.
 */

import { LogIn } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useUsers } from '@/hooks/users';
import { useSession } from '@/store/session';
import { AuthLayout } from './AuthLayout';

/** The demo answers after a moment, like a server would. */
const SIGN_IN_MS = 400;

export default function Login() {
  const navigate = useNavigate();
  const users = useUsers();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = {
      email: email.trim() === '' ? 'Gib die E-Mail-Adresse deines Kontos ein.' : undefined,
      password: password === '' ? 'Gib dein Passwort ein.' : undefined,
    };
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setPending(true);
    const people = users.data?.items ?? [];
    const person = people.find((user) => user.type === 'person' && user.disabled_at === null && user.email?.toLowerCase() === email.trim().toLowerCase());
    window.setTimeout(() => {
      if (person) useSession.getState().setUserId(person.id);
      const me = person ?? people.find((user) => user.id === useSession.getState().userId);
      toast({ title: me ? `Angemeldet als ${me.name}` : 'Angemeldet', tone: 'success' });
      navigate('/my-items', { replace: true });
    }, SIGN_IN_MS);
  }

  return (
    <AuthLayout tab="Anmelden" tabIcon={LogIn} title="Willkommen zurück" description="Melde dich mit der E-Mail-Adresse deines Kontos an.">
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
            setErrors((current) => ({ ...current, email: undefined }));
          }}
          hint="Die Adresse einer Demo-Person meldet dich als sie an, etwa ida@feldwerk.example.com."
          error={errors.email}
        />
        <Input
          ref={passwordRef}
          label="Passwort"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((current) => ({ ...current, password: undefined }));
          }}
          error={errors.password}
        />
        <Button type="submit" variant="primary" pending={pending} className="mt-1 w-full">
          Anmelden
        </Button>
        <Link to="/forgot-password" className="inline-flex h-11 items-center self-center rounded-chip px-2 text-ui font-medium text-accent-text underline-offset-2 hover:underline md:h-8">
          Passwort vergessen?
        </Link>
      </form>
    </AuthLayout>
  );
}
