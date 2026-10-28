/*
 * Settings → Profile (spec 4.2): name, handle, avatar, language and time zone. The handle is how others mention the
 * person; language and time zone decide the language of mails and when "fällig" reminders go out (08:00 their time).
 * The e-mail address is read-only here: it is how the person signs in.
 */

import { useMemo, useRef, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useOrganization } from '@/hooks/organization';
import { useUpdateUser } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import type { Locale, User } from '@/types';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '../project/form';
import { ImageField } from '../project/ImageField';
import { FormActions, SettingsCard, UnsavedGuard } from '../project/SettingsParts';
import type { SectionProps } from './sectionProps';
import { zoneOptions } from './zones';

interface Fields {
  name: string;
  handle: string;
  locale: Locale;
  timezone: string;
  avatar_url: string | null;
}

const fieldsOf = (user: User): Fields => ({ name: user.name, handle: user.handle, locale: user.locale, timezone: user.timezone, avatar_url: user.avatar_url });

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
];

/** The avatar a bit larger, or the picture the person chose. The shared Avatar only knows initials. */
function ProfileAvatar({ user, image }: { user: User; image: string | null }) {
  if (image) return <img src={image} alt={`Avatar von ${user.name}`} className="size-16 rounded-full object-cover" />;
  return <Avatar user={user} className="size-16! text-xl!" />;
}

export function Profile({ user }: SectionProps) {
  const form = useRef<HTMLFormElement>(null);
  const update = useUpdateUser();
  const organization = useOrganization().data;
  const draft = useDraft(useMemo(() => fieldsOf(user), [user]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, true);
  const zones = useMemo(() => zoneOptions(user.timezone, organization?.timezone ?? user.timezone), [user.timezone, organization?.timezone]);
  const { value } = draft;

  function edit(patch: Partial<Fields>) {
    draft.set(patch);
    problems.clear(...Object.keys(patch));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    if (!draft.dirty) {
      draft.tellNothingToSave();
      return;
    }
    // trailing blanks (from autofill or text expansion) are no part of a handle
    const patch = Object.fromEntries(draft.changed.map((key) => [key, key === 'handle' ? draft.value.handle.trim() : draft.value[key]]));
    try {
      await update.mutateAsync({ user_id: user.id, patch });
      draft.reset();
      problems.clearAll();
      toast({ title: 'Profil gespeichert', tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Profil nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void save(event)}>
      <UnsavedGuard dirty={draft.dirty} saving={update.isPending} />
      <SettingsCard
        title="Profil"
        description="So sehen dich andere in werkbuch: in Listen, Kommentaren und Erwähnungen."
        footer={
          <FormActions
            dirty={draft.dirty}
            quiet={draft.quiet}
            pending={update.isPending}
            onReset={() => {
              draft.reset();
              problems.clearAll();
            }}
          />
        }
      >
        <dl className="grid gap-x-6 gap-y-1 text-ui sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted">E-Mail</dt>
          <dd className="min-w-0 truncate font-medium text-ink">{user.email}</dd>
          <dt className="text-muted">Rolle</dt>
          <dd className="font-medium text-ink">{user.org_role === 'admin' ? 'Org-Admin' : 'Member'}</dd>
        </dl>
        <ImageField
          label="Avatar"
          preview={<ProfileAvatar user={{ ...user, name: value.name || user.name }} image={value.avatar_url} />}
          hasImage={value.avatar_url !== null}
          hint="Ohne Bild zeigt werkbuch deine Initialen."
          onChange={(image) => edit({ avatar_url: image })}
        />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Input label="Name" name="name" value={value.name} autoComplete="name" error={problems.errors.name} onChange={(event) => edit({ name: event.target.value })} />
          <Input
            label="Kürzel"
            name="handle"
            value={value.handle}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            translate="no"
            hint={`Damit erwähnen dich andere: @${value.handle || 'kürzel'}. 3 bis 32 Zeichen: a–z, 0–9 und -.`}
            error={problems.errors.handle}
            onChange={(event) => edit({ handle: event.target.value.toLowerCase() })}
          />
        </div>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Select
            label="Sprache"
            hint="Gilt für E-Mails. Der Klickdummy zeigt die Oberfläche immer auf Deutsch."
            value={value.locale}
            options={LOCALES}
            error={problems.errors.locale}
            onValueChange={(locale) => locale && edit({ locale: locale as Locale })}
          />
          <Combobox
            label="Zeitzone"
            hint={`Fällige Items meldet werkbuch dir täglich um 08:00 in dieser Zeitzone.${organization ? ` Voreinstellung der Organisation: ${organization.timezone}.` : ''}`}
            placeholder="Zeitzone suchen …"
            emptyText="Keine Zeitzone gefunden"
            value={value.timezone}
            options={zones}
            error={problems.errors.timezone}
            onValueChange={(zone) => zone && edit({ timezone: zone })}
          />
        </div>
      </SettingsCard>
    </form>
  );
}
