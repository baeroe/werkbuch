/*
 * Accepting an invitation (spec 4.2): the invited person chooses a name and a password and is signed in. In the
 * clickdummy every token is valid and every input counts; only empty fields are refused.
 */

import { MailOpen } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useOrganization } from '@/hooks/organization';
import { AuthLayout } from './AuthLayout';

const ACCEPT_MS = 400;

export default function Invitation() {
  const navigate = useNavigate();
  const organization = useOrganization().data;
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = {
      name: name.trim() === '' ? 'Gib deinen Namen ein, so wie ihn dein Team sehen soll.' : undefined,
      password: password === '' ? 'Lege ein Passwort fest.' : undefined,
    };
    setErrors(found);
    if (found.name) return nameRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setPending(true);
    window.setTimeout(() => {
      toast({ title: `Willkommen, ${name.trim()}`, description: organization ? `Du bist jetzt in ${organization.name} angemeldet.` : undefined, tone: 'success' });
      navigate('/my-items', { replace: true });
    }, ACCEPT_MS);
  }

  return (
    <AuthLayout
      tab="Einladung"
      tabIcon={MailOpen}
      title="Einladung annehmen"
      description={`Du wurdest ${organization ? `zu ${organization.name} ` : ''}eingeladen. Lege deinen Namen und ein Passwort fest, danach bist du angemeldet.`}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          ref={nameRef}
          label="Name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setErrors((current) => ({ ...current, name: undefined }));
          }}
          hint="Erscheint bei deinen Kommentaren und Zuweisungen."
          error={errors.name}
        />
        <Input
          ref={passwordRef}
          label="Passwort"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((current) => ({ ...current, password: undefined }));
          }}
          hint="Im Klickdummy gilt jedes Passwort."
          error={errors.password}
        />
        <Button type="submit" variant="primary" pending={pending} className="mt-1 w-full">
          Einladung annehmen
        </Button>
      </form>
    </AuthLayout>
  );
}
