/*
 * "Create token" (spec 4.2), one dialog for the own tokens and for those of bots (13b): a name, the abilities, and
 * optionally a day it expires (through the end of that day in the time zone of the account it belongs to). When it is
 * made, the dialog shows the plain text, which cannot be read again, together with the setup snippets that already carry
 * it; Escape asks first, a click outside does nothing. Closing drops the plain text: it is kept nowhere else (the call's
 * answer leaves the mutation cache with the dialog). Tokens of the default bot carry admin rights, which the dialog says
 * before and after.
 */

import { CircleAlert, KeyRound } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { addDays, cachedZone } from '@/domain/tz';
import { useCreateToken } from '@/hooks/tokens';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Token, TokenAbility, User } from '@/types';
import { fieldErrors, unplacedMessages, useFieldErrors } from '../frame/form';
import { AdminWarning } from './AdminWarning';
import { CopyButton } from './CopyButton';
import { SetupSnippets } from './SetupSnippets';

/** In this order on the page and in the request, whatever order they were ticked in. */
export const ABILITIES: readonly TokenAbility[] = ['read', 'write', 'mcp'];

/** The fields of the form; a refusal of any other path shows as a notice on top. */
const PLACED = ['name', 'abilities', 'expires_at'];

type Created = { token: Token; plain_text: string };

type Props = {
  /** The account the token acts as: the signed-in person, or a bot (admins). */
  owner: User;
  onClose: () => void;
};

export function TokenDialog({ owner, onClose }: Props) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const secret = useRef<HTMLInputElement>(null);
  const create = useCreateToken();
  const problems = useFieldErrors(form);
  const bot = owner.type === 'bot';
  const [name, setName] = useState('');
  // a bot starts with reading only (an integration asks for more on purpose), the own token with everything
  const [abilities, setAbilities] = useState<TokenAbility[]>(bot ? ['read'] : [...ABILITIES]);
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tomorrow = addDays(cachedZone(owner.timezone).date(new Date()), 1);

  // the token is made: the button that was pressed is gone, so the focus goes to the token, which is selected for copying
  useEffect(() => {
    if (!created) return;
    const frame = requestAnimationFrame(() => secret.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [created]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    setNotice(null);
    try {
      setCreated(
        await create.mutateAsync({
          user_id: owner.id,
          name,
          abilities: ABILITIES.filter((ability) => abilities.includes(ability)),
          // the token works through the end of the chosen day, in the time zone of its account
          expires_at: expires ? cachedZone(owner.timezone).toUtc(expires, '23:59').toISOString() : null,
        }),
      );
      problems.clearAll();
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) {
        problems.show(Object.fromEntries(Object.entries(fields).filter(([path]) => PLACED.includes(path))));
        setNotice(unplacedMessages(error, PLACED).join(' ') || null);
      } else notifyError(t('settings.tokens.dialog.not_created'), error, () => form.current?.requestSubmit());
    }
  }

  // ⌘↵ anywhere in the dialog makes the token
  useShortcut('dialog.submit', () => form.current?.requestSubmit(), { when: () => created === null });

  const problem = problems.errors.abilities;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      // the plain text shows once: Escape asks first, a click outside does nothing (the form before it closes as usual)
      confirmClose={created ? { title: t('settings.tokens.dialog.close_title'), description: t('settings.tokens.dialog.close_description') } : undefined}
      size={created ? 'lg' : 'md'}
      title={created ? t('settings.tokens.dialog.created_title') : bot ? t('settings.tokens.dialog.new_title_bot', { name: owner.name }) : t('settings.tokens.dialog.new_title')}
      description={
        created
          ? bot
            ? t('settings.tokens.dialog.created_description_bot', { name: owner.name })
            : t('settings.tokens.dialog.created_description')
          : bot
            ? t('settings.tokens.dialog.new_description_bot')
            : t('settings.tokens.dialog.new_description')
      }
      footer={
        created ? (
          <Button variant="primary" onClick={onClose}>
            {t('settings.tokens.copied_confirm')}
          </Button>
        ) : (
          <>
            <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
            <Button variant="primary" type="submit" form={formId} icon={KeyRound} pending={create.isPending} shortcut="mod+enter">
              {t('settings.tokens.create')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex min-w-0 flex-col gap-5">
          {owner.is_default_bot && <AdminWarning title={t('settings.tokens.admin_warning.created')} />}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <Input
                ref={secret}
                label={t('settings.tokens.dialog.token')}
                name="token"
                autoComplete="off"
                value={created.plain_text}
                readOnly
                translate="no"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <CopyButton text={created.plain_text} target={() => secret.current} label={t('settings.tokens.copy')} variant="primary" />
          </div>
          <SetupSnippets token={created.plain_text} />
        </div>
      ) : (
        <form ref={form} id={formId} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          {notice && (
            <Banner tone="danger" role="alert" title={t('ui.form_dialog.error_title')}>
              {notice}
            </Banner>
          )}
          {owner.is_default_bot && <AdminWarning title={t('settings.tokens.admin_warning.create')} />}
          <Input
            label={t('settings.tokens.dialog.name')}
            name="token_name"
            placeholder={t('settings.tokens.dialog.name_placeholder')}
            autoComplete="off"
            value={name}
            error={problems.errors.name}
            onChange={(event) => {
              setName(event.target.value);
              problems.clear('name');
            }}
          />
          <fieldset className="flex flex-col gap-0.5">
            <legend className="mb-1 text-sm font-medium text-ink">{t('settings.tokens.abilities')}</legend>
            {ABILITIES.map((ability, index) => (
              <Checkbox
                key={ability}
                // the server refused the choice: the first box takes the focus, so the person lands on what needs fixing
                aria-invalid={problem && index === 0 ? true : undefined}
                checked={abilities.includes(ability)}
                onCheckedChange={(on) => {
                  setAbilities((current) => (on ? [...current, ability] : current.filter((entry) => entry !== ability)));
                  problems.clear('abilities');
                }}
                label={
                  <span className="flex flex-col py-1">
                    <span className="font-medium">{t(`settings.tokens.ability.${ability}`)}</span>
                    <span className="text-sm text-pretty text-muted">{t(`settings.tokens.ability_hint.${ability}`)}</span>
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
            label={t('settings.tokens.dialog.expires')}
            name="expires_at"
            hint={t('settings.tokens.dialog.expires_hint')}
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
