/*
 * Settings → Profile (spec 4.2): name, handle, avatar, language and time zone. The handle is how others mention the
 * person; the language is the one of the interface and the mails, the time zone decides when "due" reminders go out
 * (08:00 their time). The e-mail address is read-only here: it is how the person signs in. Only the fields that changed
 * are sent; the avatar goes as a 128 px PNG data URL (`ImageField`, P15). Saving reloads the page (`useUpdateUser`), so
 * the shared props follow, and a new language loads the page in it.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useOrganization } from '@/hooks/organization';
import { useUpdateUser } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { zoneOptions } from '@/lib/zones';
import type { Locale, User } from '@/types';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '../frame/form';
import { ImageField } from '../frame/ImageField';
import { LeaveGuard } from '../frame/LeaveGuard';
import { FormActions, SettingsCard } from '../frame/parts';

interface Fields {
  name: string;
  handle: string;
  locale: Locale;
  timezone: string;
  avatar_url: string | null;
}

const fieldsOf = (user: User): Fields => ({ name: user.name, handle: user.handle, locale: user.locale, timezone: user.timezone, avatar_url: user.avatar_url });

/** The avatar a bit larger, or the picture the person chose. */
function ProfileAvatar({ user, image }: { user: User; image: string | null }) {
  if (image) return <img src={image} alt={t('settings.personal.profile.avatar_of', { name: user.name })} className="size-16 rounded-full object-cover" />;
  return <Avatar user={{ ...user, avatar_url: null }} className="size-16! text-xl!" />;
}

export function Profile({ user }: { user: User }) {
  const form = useRef<HTMLFormElement>(null);
  // a save may load the page in another language: that reload is no leave
  const saving = useRef(false);
  const update = useUpdateUser();
  const organization = useOrganization().data;
  // the server's answer to a save until the reload brings the account in the shared props: the form does not flash back
  const [shown, setShown] = useState(user);
  useEffect(() => setShown(user), [user]);
  const draft = useDraft(useMemo(() => fieldsOf(shown), [shown]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, true);
  const { value } = draft;
  const orgZone = organization?.timezone ?? shown.timezone;
  const zones = useMemo(() => zoneOptions(value.timezone, orgZone), [value.timezone, orgZone]);

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
    saving.current = true;
    try {
      setShown(await update.mutateAsync({ user_id: user.id, patch }));
      draft.reset();
      problems.clearAll();
      toast({ title: t('settings.personal.profile.saved'), tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError(t('settings.personal.profile.not_saved'), error, () => form.current?.requestSubmit());
    } finally {
      saving.current = false;
    }
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void save(event)}>
      <LeaveGuard dirty={draft.dirty} what={t('settings.personal.profile.leave_what')} bypass={saving} />
      <SettingsCard
        title={t('settings.personal.section.profile')}
        description={t('settings.personal.profile.description')}
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
          <dt className="text-muted">{t('settings.personal.profile.email')}</dt>
          <dd className="min-w-0 truncate font-medium text-ink">{user.email}</dd>
          <dt className="text-muted">{t('settings.personal.profile.role')}</dt>
          <dd className="font-medium text-ink">{t(`roles.org.${user.org_role}`)}</dd>
        </dl>
        <ImageField
          label={t('settings.personal.profile.avatar')}
          preview={<ProfileAvatar user={{ ...shown, name: value.name || shown.name }} image={value.avatar_url} />}
          hasImage={value.avatar_url !== null}
          hint={t('settings.personal.profile.avatar_hint')}
          error={problems.errors.avatar_url}
          onChange={(image) => edit({ avatar_url: image })}
        />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Input
            label={t('settings.personal.profile.name')}
            name="name"
            value={value.name}
            autoComplete="name"
            error={problems.errors.name}
            onChange={(event) => edit({ name: event.target.value })}
          />
          <Input
            label={t('settings.personal.profile.handle')}
            name="handle"
            value={value.handle}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            translate="no"
            hint={t('settings.personal.profile.handle_hint', { handle: value.handle || t('settings.personal.profile.handle_placeholder') })}
            error={problems.errors.handle}
            onChange={(event) => edit({ handle: event.target.value.toLowerCase() })}
          />
        </div>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Select
            label={t('settings.personal.profile.locale')}
            hint={t('settings.personal.profile.locale_hint')}
            value={value.locale}
            options={[
              { value: 'de', label: t('settings.personal.profile.locale_de') },
              { value: 'en', label: t('settings.personal.profile.locale_en') },
            ]}
            error={problems.errors.locale}
            onValueChange={(locale) => locale && edit({ locale: locale as Locale })}
          />
          <Combobox
            label={t('settings.personal.profile.timezone')}
            name="timezone"
            hint={t('settings.personal.profile.timezone_hint', { zone: orgZone })}
            placeholder={t('settings.personal.profile.timezone_placeholder')}
            emptyText={t('settings.personal.profile.timezone_empty')}
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
