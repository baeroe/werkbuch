/*
 * Allgemein (spec 4.1): name and logo of the organisation, the default language, the time zone schedules and daily
 * jobs run in, and the first day of the week. Only org admins change them; members read them.
 */

import { ImagePlus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { projectTone } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useOrganization, useUpdateOrganization } from '@/hooks/organization';
import { now } from '@/lib/clock';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Locale, Organization } from '@/types';
import { ReadOnlyNotice } from './access';
import { COMMON_ZONES } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { LeaveGuard } from './LeaveGuard';
import { FieldGroup, FormSkeleton, Loaded, Panel, readOnlyField, SectionHeader } from './parts';
import type { SectionProps } from './sections';

const MAX_LOGO_BYTES = 256 * 1024;

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
];

/** The common time zones and the current one, each with its offset today: "Europe/Berlin (GMT+1)". */
function useZoneOptions(current: string): { value: string; label: string }[] {
  return useMemo(() => {
    const names = Array.from(new Set([current, ...COMMON_ZONES])).sort((a, b) => a.localeCompare(b));
    const at = now();
    return names.map((name) => {
      let offset = '';
      try {
        offset = new Intl.DateTimeFormat('de-DE', { timeZone: name, timeZoneName: 'shortOffset' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? '';
      } catch {
        // a name the browser does not know keeps its plain name
      }
      return { value: name, label: offset ? `${name} (${offset})` : name };
    });
  }, [current]);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** The logo, or the first letter of the name on a tone when there is none. */
function OrgMark({ name, url }: { name: string; url: string | null }) {
  if (url) return <img src={url} alt="" className="size-14 shrink-0 rounded-card border border-line bg-surface object-cover" />;
  return (
    <span
      aria-hidden="true"
      data-tone={projectTone(name || 'W')}
      className="inline-flex size-14 shrink-0 items-center justify-center rounded-card bg-[var(--tab-bg)] font-display text-xl font-bold text-[var(--tab-ink)]"
    >
      {(name.trim().charAt(0) || 'W').toUpperCase()}
    </span>
  );
}

function GeneralForm({ organization, readOnly }: { organization: Organization; readOnly: boolean }) {
  const [name, setName] = useState(organization.name);
  const [logo, setLogo] = useState(organization.logo_url);
  const [locale, setLocale] = useState<Locale>(organization.locale);
  const [timezone, setTimezone] = useState(organization.timezone);
  const [weekStart, setWeekStart] = useState<0 | 1>(organization.week_start);
  const [attempted, setAttempted] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const update = useUpdateOrganization();
  const picker = useRef<HTMLInputElement>(null);
  const zones = useZoneOptions(timezone);

  const dirty = name.trim() !== organization.name || logo !== organization.logo_url || locale !== organization.locale || timezone !== organization.timezone || weekStart !== organization.week_start;
  const nameError = attempted && name.trim() === '' ? 'Gib der Organisation einen Namen.' : fieldMessage(update.error, 'name');

  async function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('Das ist kein Bild. Wähle eine PNG-, JPG- oder SVG-Datei.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(`Das Bild ist ${Math.ceil(file.size / 1024)}\u00a0KB groß. Erlaubt sind höchstens 256\u00a0KB.`);
      return;
    }
    setLogoError(null);
    setLogo(await readAsDataUrl(file));
  }

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('org-name')?.focus();
      return;
    }
    if (!dirty) {
      toast({ title: 'Es gibt nichts zu speichern', description: 'Die Einstellungen sind so, wie sie gespeichert sind.' });
      return;
    }
    update.mutate(
      { name, logo_url: logo, locale, timezone, week_start: weekStart },
      {
        onSuccess: () => toast({ title: 'Einstellungen gespeichert', tone: 'success' }),
        onError: (error) => notifyError('Einstellungen nicht gespeichert', error, submit),
      },
    );
  }

  useShortcut({ id: 'org.general.save', keys: 'mod+enter', scope: 'detail', label: 'Einstellungen speichern', group: 'Einstellungen', run: submit, when: () => !readOnly && !update.isPending });

  const notice = noticeOf(update.error, ['name', 'locale', 'timezone', 'week_start']);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && !update.isPending) submit();
      }}
      className="flex flex-col gap-4"
    >
      {notice && (
        <Banner tone="danger" role="alert" title="Das hat nicht geklappt">
          {notice}
        </Banner>
      )}

      <Panel title="Organisation">
        <div className="flex flex-col gap-5 p-4">
          <Input
            id="org-name"
            label="Name"
            name="organization"
            hint="So heißt die Organisation in der App und in Mails."
            value={name}
            readOnly={readOnly}
            error={nameError}
            autoComplete="organization"
            onChange={(event) => setName(event.target.value)}
            className={cx('max-w-md', readOnly && readOnlyField)}
          />
          <FieldGroup legend="Logo" hint="Ein Bild bis 256\u00a0KB, am besten quadratisch." error={logoError}>
            <div className="flex flex-wrap items-center gap-3">
              <OrgMark name={name} url={logo} />
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <input ref={picker} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Logo-Datei wählen" onChange={(event) => void chooseLogo(event)} />
                  <Button variant="secondary" icon={ImagePlus} onClick={() => picker.current?.click()}>
                    {logo ? 'Logo ersetzen' : 'Logo hochladen'}
                  </Button>
                  {logo && (
                    <Button variant="ghost" icon={Trash2} onClick={() => setLogo(null)}>
                      Logo entfernen
                    </Button>
                  )}
                </div>
              )}
            </div>
          </FieldGroup>
        </div>
      </Panel>

      <Panel title="Sprache und Zeit">
        <div className="grid gap-5 p-4 md:grid-cols-2">
          <Select
            label="Standardsprache"
            hint="Gilt für neue Konten und für Mails an Konten ohne eigene Einstellung."
            value={locale}
            disabled={readOnly}
            onValueChange={(next) => next && setLocale(next as Locale)}
            options={LOCALES}
          />
          <Combobox
            label="Zeitzone"
            hint="Gilt für Zeitpläne und für die täglichen Jobs."
            placeholder="Zeitzone suchen …"
            emptyText="Keine Zeitzone gefunden"
            value={timezone}
            disabled={readOnly}
            onValueChange={(next) => next && setTimezone(next)}
            options={zones}
          />
          <FieldGroup legend="Wochenbeginn" hint="Gilt für Filter wie „diese Woche“.">
            <SegmentedControl
              label="Wochenbeginn"
              value={String(weekStart)}
              onValueChange={(next) => !readOnly && setWeekStart(next === '0' ? 0 : 1)}
              options={[
                { value: '1', label: 'Montag', disabled: readOnly },
                { value: '0', label: 'Sonntag', disabled: readOnly },
              ]}
            />
          </FieldGroup>
        </div>
      </Panel>

      <LeaveGuard dirty={dirty && !readOnly} what="Deine Änderungen an den Einstellungen" />

      {!readOnly && (
        <div className="flex justify-end">
          <Button variant="primary" type="submit" shortcut="mod+enter" pending={update.isPending}>
            Speichern
          </Button>
        </div>
      )}
    </form>
  );
}

export default function General({ readOnlyReason }: SectionProps) {
  const organization = useOrganization();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Allgemein" description="Name, Sprache, Zeitzone und Wochenbeginn der Organisation." />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[organization]} failure="Die Organisation konnte nicht geladen werden" skeleton={<FormSkeleton label="Die Organisation wird geladen …" />}>
        {() => <GeneralForm key={organization.data!.id} organization={organization.data!} readOnly={readOnlyReason !== null} />}
      </Loaded>
    </div>
  );
}
