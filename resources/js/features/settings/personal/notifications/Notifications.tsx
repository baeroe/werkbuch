/*
 * Settings → Notifications (spec 4.14, `/me/notifications`): one choice per event and channel, in a matrix. The inbox
 * is on for every event by default, mail for four of them; "Standardwerte" puts those back. The choices are saved
 * together, but only the cells that changed are sent (the server keeps the rest). Without a mail server
 * (`features.mail` false) the mail column is locked and says why: a choice there would change nothing. The webhook row
 * only matters to org admins.
 */

import { useId, useMemo, useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { toast } from '@/components/ui/toast';
import { usePreferences, useSavePreferences } from '@/hooks/notifications';
import { notifyError } from '@/lib/errors';
import { t, type TranslationKey } from '@/lib/i18n';
import { useSharedProps } from '@/lib/page';
import type { NotificationChannel, NotificationEvent, User } from '@/types';
import { useDraft, useSaveShortcut } from '../../frame/form';
import { LeaveGuard } from '../../frame/LeaveGuard';
import { FormActions, SettingsCard, SettingsError, SettingsSkeleton } from '../../frame/parts';
import { cellKey, changedPreferences, defaultsFor, toChoices } from './matrix';

const CHANNELS: { id: NotificationChannel; label: TranslationKey }[] = [
  { id: 'inbox', label: 'settings.notifications.channel.inbox' },
  { id: 'mail', label: 'settings.notifications.channel.mail' },
];

/** What each event is called and when it happens, in the words of spec 4.14. */
const EVENT_TEXT: Record<NotificationEvent, { label: TranslationKey; hint: TranslationKey }> = {
  assigned: { label: 'settings.notifications.event.assigned.label', hint: 'settings.notifications.event.assigned.hint' },
  mentioned: { label: 'settings.notifications.event.mentioned.label', hint: 'settings.notifications.event.mentioned.hint' },
  comment: { label: 'settings.notifications.event.comment.label', hint: 'settings.notifications.event.comment.hint' },
  state_changed: { label: 'settings.notifications.event.state_changed.label', hint: 'settings.notifications.event.state_changed.hint' },
  item_changed: { label: 'settings.notifications.event.item_changed.label', hint: 'settings.notifications.event.item_changed.hint' },
  due: { label: 'settings.notifications.event.due.label', hint: 'settings.notifications.event.due.hint' },
  item_created: { label: 'settings.notifications.event.item_created.label', hint: 'settings.notifications.event.item_created.hint' },
  template_run_failed: { label: 'settings.notifications.event.template_run_failed.label', hint: 'settings.notifications.event.template_run_failed.hint' },
  webhook_disabled: { label: 'settings.notifications.event.webhook_disabled.label', hint: 'settings.notifications.event.webhook_disabled.hint' },
};

export function Notifications({ user }: { user: User }) {
  const form = useRef<HTMLFormElement>(null);
  const noMailId = useId();
  const mailOn = useSharedProps().features.mail;
  const preferences = usePreferences();
  const save = useSavePreferences();
  const saved = useMemo(() => toChoices(preferences.data ?? []), [preferences.data]);
  const draft = useDraft(saved);
  useSaveShortcut(form, true);

  // the events in the order of the server; the one about webhooks only matters to org admins
  const events = useMemo(
    () => [...new Set((preferences.data ?? []).map((row) => row.event))].filter((event) => event !== 'webhook_disabled' || user.org_role === 'admin'),
    [preferences.data, user.org_role],
  );
  // without a mail server the mail cells stay as stored: the defaults touch only what can be chosen
  const choosable = mailOn ? CHANNELS.map((channel) => channel.id) : (['inbox'] as const);

  if (preferences.isPending) return <SettingsSkeleton rows={5} label={t('settings.notifications.loading')} />;
  if (preferences.isError) {
    return (
      <SettingsError title={t('settings.notifications.load_failed')} error={preferences.error} retrying={preferences.isFetching} onRetry={() => void preferences.refetch()} />
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    if (!draft.dirty) {
      draft.tellNothingToSave();
      return;
    }
    try {
      await save.mutateAsync(changedPreferences(user.id, saved, draft.value));
      draft.reset();
      toast({ title: t('settings.notifications.saved'), tone: 'success' });
    } catch (error) {
      notifyError(t('settings.notifications.not_saved'), error, () => form.current?.requestSubmit());
    }
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)}>
      <LeaveGuard dirty={draft.dirty} what={t('settings.notifications.leave_what')} />
      <SettingsCard
        title={t('settings.personal.section.notifications')}
        description={t('settings.notifications.description')}
        actions={
          <Button variant="secondary" onClick={() => draft.set(defaultsFor(events, choosable))}>
            {t('settings.notifications.defaults')}
          </Button>
        }
        footer={<FormActions dirty={draft.dirty} quiet={draft.quiet} pending={save.isPending} onReset={draft.reset} />}
      >
        {!mailOn && (
          <p id={noMailId} className="max-w-[65ch] text-ui text-pretty text-muted">
            {t('settings.notifications.no_mail')}
          </p>
        )}
        <div className="-mx-4 overflow-x-auto md:-mx-5">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{t('settings.notifications.caption')}</caption>
            <thead>
              <tr className="border-y border-line text-sm text-muted">
                <th scope="col" className="px-4 py-2 font-medium md:px-5">
                  {t('settings.notifications.event_column')}
                </th>
                {CHANNELS.map((channel) => (
                  <th key={channel.id} scope="col" className="w-20 px-1 py-2 text-center font-medium md:w-24">
                    {t(channel.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-b border-line">
              {events.map((event) => (
                <tr key={event}>
                  <th scope="row" className="px-4 py-3 text-left font-normal md:px-5">
                    <span className="block text-md font-medium text-ink">{t(EVENT_TEXT[event].label)}</span>
                    <span className="mt-0.5 block max-w-[52ch] text-sm text-pretty text-muted">{t(EVENT_TEXT[event].hint)}</span>
                  </th>
                  {CHANNELS.map((channel) => {
                    const locked = channel.id === 'mail' && !mailOn;
                    return (
                      <td key={channel.id} className="px-1 py-1 text-center align-middle">
                        <Checkbox
                          aria-label={t('settings.notifications.cell', { event: t(EVENT_TEXT[event].label), channel: t(channel.label) })}
                          aria-describedby={locked ? noMailId : undefined}
                          disabled={locked}
                          checked={draft.value[cellKey(event, channel.id)] === true}
                          onCheckedChange={(on) => draft.set({ [cellKey(event, channel.id)]: on })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex max-w-[65ch] flex-col gap-1.5 text-ui text-pretty text-muted">
          <p>{t('settings.notifications.scope')}</p>
          <p>{t('settings.notifications.digest')}</p>
        </div>
      </SettingsCard>
    </form>
  );
}
