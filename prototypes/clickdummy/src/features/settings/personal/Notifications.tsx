/*
 * Settings → Notifications (spec 4.14): one choice per event and channel, in a matrix. The inbox is on for every event
 * by default, mail for four of them; "Standardwerte" puts those back. The choices are saved together.
 */

import { useMemo, useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { toast } from '@/components/ui/toast';
import { usePreferences, useSavePreferences } from '@/hooks/notifications';
import { notifyError } from '@/lib/errors';
import type { NotificationChannel, NotificationEvent } from '@/types';
import { useDraft, useSaveShortcut } from '../project/form';
import { FormActions, SettingsCard, SettingsError, SettingsSkeleton, UnsavedGuard } from '../project/SettingsParts';
import { cellKey, changedPreferences, defaultEnabled, toChoices, type Choices } from './matrix';
import type { SectionProps } from './sectionProps';

const CHANNELS: { id: NotificationChannel; label: string }[] = [
  { id: 'inbox', label: 'In-App' },
  { id: 'mail', label: 'E-Mail' },
];

/** What each event is called and when it happens, in the words of spec 4.14. */
const EVENT_TEXT: Record<NotificationEvent, { label: string; hint: string }> = {
  assigned: { label: 'Zugewiesen', hint: 'Ein Item wird dir zugewiesen.' },
  mentioned: { label: 'Erwähnt', hint: 'Jemand erwähnt dich in einer Beschreibung oder einem Kommentar.' },
  comment: { label: 'Neuer Kommentar', hint: 'Ein Kommentar an einem Item, das du beobachtest.' },
  state_changed: { label: 'Statuswechsel', hint: 'Ein Item, das du beobachtest, bekommt einen anderen Status.' },
  item_changed: { label: 'Sonstige Änderungen', hint: 'Titel, Beschreibung, Priorität, Daten, Labels, Properties, Typ, Eltern-Item, Relationen und Anhänge.' },
  due: { label: 'Fällig oder überfällig', hint: 'Deine zugewiesenen Items, täglich um 08:00 in deiner Zeitzone.' },
  item_created: { label: 'Neues Item im Projekt', hint: 'Nur für den Lead eines Projekts.' },
  template_run_failed: { label: 'Vorlage fehlgeschlagen', hint: 'Ein Zeitplan konnte kein Item anlegen.' },
  webhook_disabled: { label: 'Webhook abgeschaltet', hint: 'Nur für Org-Admins.' },
};

/** The defaults of spec 4.14 for these events. */
const defaultsFor = (events: readonly NotificationEvent[]): Choices =>
  Object.fromEntries(events.flatMap((event) => CHANNELS.map((channel) => [cellKey(event, channel.id), defaultEnabled(event, channel.id)])));

export function Notifications({ user }: SectionProps) {
  const form = useRef<HTMLFormElement>(null);
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

  if (preferences.isPending) return <SettingsSkeleton rows={5} label="Benachrichtigungen werden geladen …" />;
  if (preferences.isError) {
    return (
      <SettingsError title="Die Benachrichtigungen konnten nicht geladen werden" error={preferences.error} retrying={preferences.isFetching} onRetry={() => void preferences.refetch()} />
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
      toast({ title: 'Benachrichtigungen gespeichert', tone: 'success' });
    } catch (error) {
      notifyError('Benachrichtigungen nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)}>
      <UnsavedGuard dirty={draft.dirty} saving={save.isPending} />
      <SettingsCard
        title="Benachrichtigungen"
        description="Wähle für jedes Ereignis, wo du davon erfährst: in der Inbox der App, per E-Mail oder beides."
        actions={
          <Button variant="secondary" onClick={() => draft.set(defaultsFor(events))}>
            Standardwerte
          </Button>
        }
        footer={<FormActions dirty={draft.dirty} quiet={draft.quiet} pending={save.isPending} onReset={draft.reset} />}
      >
        <div className="-mx-4 overflow-x-auto md:-mx-5">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Benachrichtigungen nach Ereignis und Kanal</caption>
            <thead>
              <tr className="border-y border-line text-sm text-muted">
                <th scope="col" className="px-4 py-2 font-medium md:px-5">
                  Ereignis
                </th>
                {CHANNELS.map((channel) => (
                  <th key={channel.id} scope="col" className="w-20 px-1 py-2 text-center font-medium md:w-24">
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-b border-line">
              {events.map((event) => (
                <tr key={event}>
                  <th scope="row" className="px-4 py-3 text-left font-normal md:px-5">
                    <span className="block text-md font-medium text-ink">{EVENT_TEXT[event].label}</span>
                    <span className="mt-0.5 block max-w-[52ch] text-sm text-pretty text-muted">{EVENT_TEXT[event].hint}</span>
                  </th>
                  {CHANNELS.map((channel) => (
                    <td key={channel.id} className="px-1 py-1 text-center align-middle">
                      <Checkbox
                        aria-label={`${EVENT_TEXT[event].label}, ${channel.label}`}
                        checked={draft.value[cellKey(event, channel.id)] === true}
                        onCheckedChange={(on) => draft.set({ [cellKey(event, channel.id)]: on })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex max-w-[65ch] flex-col gap-1.5 text-ui text-pretty text-muted">
          <p>Du erfährst von allem, was du beobachtest, und von allen Ereignissen der Projekte, in denen du Lead bist. Von dem, was du selbst änderst, nie.</p>
          <p>E-Mails zu einem Item werden 5&nbsp;Minuten gesammelt und als eine Mail verschickt.</p>
        </div>
      </SettingsCard>
    </form>
  );
}
