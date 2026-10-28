/*
 * "Neuer Token" (spec 4.2): a name, the abilities, and optionally a day it expires. When it is made, the dialog shows
 * the plain text, which cannot be read again, together with the setup snippets that already carry it. Closing the
 * dialog drops the plain text: it is kept nowhere else.
 */

import { CircleAlert, KeyRound } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { addDays, cachedZone } from '@/domain/tz';
import { useCreateToken } from '@/hooks/tokens';
import { today } from '@/lib/clock';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Token, TokenAbility, User } from '@/types';
import { fieldErrors, useFieldErrors } from '../project/form';
import { CopyButton } from './CopyButton';
import { SetupSnippets } from './SetupSnippets';

const ABILITIES: { id: TokenAbility; label: string; text: string }[] = [
  { id: 'read', label: 'Lesen', text: 'Items, Projekte und alles andere ansehen, per REST-API und MCP.' },
  { id: 'write', label: 'Schreiben', text: 'Anlegen, ändern, kommentieren und löschen.' },
  { id: 'mcp', label: 'MCP', text: 'Den MCP-Server für Agenten nutzen. Die Tools prüfen zusätzlich Lesen und Schreiben.' },
];

type Created = { token: Token; plain_text: string };

type Props = {
  user: User;
  onClose: () => void;
};

export function TokenDialog({ user, onClose }: Props) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const secret = useRef<HTMLInputElement>(null);
  const create = useCreateToken();
  const problems = useFieldErrors(form);
  const [name, setName] = useState('');
  const [abilities, setAbilities] = useState<TokenAbility[]>(['read', 'write', 'mcp']);
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<Created | null>(null);

  const tomorrow = addDays(today(user.timezone), 1);

  // the token is made: the button that was pressed is gone, so the focus goes to the token, which is selected for copying
  useEffect(() => {
    if (!created) return;
    const frame = requestAnimationFrame(() => secret.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [created]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    try {
      setCreated(
        await create.mutateAsync({
          user_id: user.id,
          name,
          // in the order of the list, whatever order they were ticked in
          abilities: ABILITIES.filter((ability) => abilities.includes(ability.id)).map((ability) => ability.id),
          // the token works through the end of the chosen day, in the person's time zone
          expires_at: expires ? cachedZone(user.timezone).toUtc(expires, '23:59').toISOString() : null,
        }),
      );
      problems.clearAll();
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Token nicht angelegt', error, () => form.current?.requestSubmit());
    }
  }

  // ⌘↵ anywhere in the dialog makes the token
  useShortcut({ id: 'token.create', keys: 'mod+enter', scope: 'dialog', label: 'Token anlegen', group: 'Dialog', run: () => form.current?.requestSubmit(), when: () => created === null }, [created]);

  const problem = problems.errors.abilities;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size={created ? 'lg' : 'md'}
      title={created ? 'Token angelegt' : 'Neuer Token'}
      description={
        created
          ? 'Kopiere ihn jetzt: werkbuch zeigt ihn nur dieses eine Mal. Wer den Token hat, handelt in deinem Namen.'
          : 'Mit einem Token handeln Agenten und Skripte in deinem Namen, mit den Rechten deines Kontos. Leg einen pro Gerät oder Skript an, dann kannst du sie einzeln widerrufen.'
      }
      footer={
        created ? (
          <Button variant="primary" onClick={onClose}>
            Ich habe den Token kopiert
          </Button>
        ) : (
          <>
            <DialogClose render={<Button variant="ghost">Abbrechen</Button>} />
            <Button variant="primary" type="submit" form={formId} icon={KeyRound} pending={create.isPending} shortcut="mod+enter">
              Token anlegen
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <Input ref={secret} label="Token" value={created.plain_text} readOnly translate="no" onFocus={(event) => event.currentTarget.select()} />
            </div>
            <CopyButton text={created.plain_text} target={() => secret.current} label="Token kopieren" variant="primary" />
          </div>
          <SetupSnippets token={created.plain_text} />
        </div>
      ) : (
        <form ref={form} id={formId} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Input
            label="Name"
            name="token_name"
            placeholder="z. B. Claude Code auf meinem Laptop …"
            autoComplete="off"
            value={name}
            error={problems.errors.name}
            onChange={(event) => {
              setName(event.target.value);
              problems.clear('name');
            }}
          />
          <fieldset className="flex flex-col gap-0.5">
            <legend className="mb-1 text-sm font-medium text-ink">Fähigkeiten</legend>
            {ABILITIES.map((ability, index) => (
              <Checkbox
                key={ability.id}
                // the server refused the choice: the first box takes the focus, so the person lands on what needs fixing
                aria-invalid={problem && index === 0 ? true : undefined}
                checked={abilities.includes(ability.id)}
                onCheckedChange={(on) => {
                  setAbilities((current) => (on ? [...current, ability.id] : current.filter((entry) => entry !== ability.id)));
                  problems.clear('abilities');
                }}
                label={
                  <span className="flex flex-col py-1">
                    <span className="font-medium">{ability.label}</span>
                    <span className="text-sm text-pretty text-muted">{ability.text}</span>
                  </span>
                }
              />
            ))}
            {problem && (
              <p role="alert" className="mt-1 flex items-start gap-1.5 text-sm font-medium text-danger">
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {problem}
              </p>
            )}
          </fieldset>
          <Input
            label="Ablaufdatum (optional)"
            name="expires_at"
            hint="Leer lassen für einen Token, der nicht abläuft."
            autoComplete="off"
            type="date"
            min={tomorrow}
            value={expires}
            error={problems.errors.expires_at}
            onChange={(event) => {
              setExpires(event.target.value);
              problems.clear('expires_at');
            }}
          />
        </form>
      )}
    </Dialog>
  );
}
