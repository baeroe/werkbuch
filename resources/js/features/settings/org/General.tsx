/*
 * General (spec 4.1): name and logo of the organisation, the default language, the time zone schedules and daily jobs
 * run in, and the first day of the week. Only org admins change them; members read them. The logo goes to the server
 * as a 128 px PNG data URL (`ImageField`, P15); only the fields that changed are sent.
 */

import { useMemo, useRef, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { projectTone } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { useOrganization, useUpdateOrganization } from '@/hooks/organization';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { zoneOptions } from '@/lib/zones';
import type { Locale, Organization } from '@/types';
import { ReadOnlyNotice } from '../frame/access';
import { fieldMessage, noticeOf, useDraft, useSaveShortcut } from '../frame/form';
import { ImageField } from '../frame/ImageField';
import { LeaveGuard } from '../frame/LeaveGuard';
import { FieldGroup, FormSkeleton, Loaded, Panel, readOnlyField, SectionHeader } from '../frame/parts';
import type { SectionProps } from './sections';

type GeneralFields = Pick<Organization, 'name' | 'logo_url' | 'locale' | 'timezone' | 'week_start'>;

const FIELDS: (keyof GeneralFields)[] = ['name', 'logo_url', 'locale', 'timezone', 'week_start'];

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
  const settle = useSettle();
  const form = useRef<HTMLFormElement>(null);
  const source = useMemo<GeneralFields>(
    () => ({ name: organization.name, logo_url: organization.logo_url, locale: organization.locale, timezone: organization.timezone, week_start: organization.week_start }),
    [organization],
  );
  const draft = useDraft(source);
  const { name, logo_url: logo, locale, timezone, week_start: weekStart } = draft.value;
  const [attempted, setAttempted] = useState(false);
  const update = useUpdateOrganization();
  const zones = useMemo(() => zoneOptions(timezone, organization.timezone), [timezone, organization.timezone]);

  const nameError = attempted && name.trim() === '' ? t('settings.org.general.name_required') : fieldMessage(update.error, 'name');

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('org-name')?.focus();
      return;
    }
    if (!draft.dirty) {
      toast({ title: t('settings.org.general.nothing.title'), description: t('settings.org.general.nothing.description') });
      return;
    }
    const patch = Object.fromEntries(draft.changed.map((field) => [field, draft.value[field]])) as Partial<GeneralFields>;
    settle(update.mutateAsync(patch), {
      onSuccess: () => {
        draft.reset();
        toast({ title: t('settings.org.general.saved'), tone: 'success' });
      },
      onError: (error) => notifyError(t('settings.org.general.not_saved'), error, submit),
    });
  }

  useSaveShortcut(form, !readOnly && !update.isPending);

  const notice = noticeOf(update.error, FIELDS);

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && !update.isPending) submit();
      }}
      className="flex flex-col gap-4"
    >
      {notice && (
        <Banner tone="danger" role="alert" title={t('settings.org.general.failed')}>
          {notice}
        </Banner>
      )}

      <Panel title={t('settings.org.general.panel_organization')}>
        <div className="flex flex-col gap-5 p-4">
          <Input
            id="org-name"
            label={t('settings.org.general.name')}
            name="organization"
            hint={t('settings.org.general.name_hint')}
            value={name}
            readOnly={readOnly}
            error={nameError}
            autoComplete="organization"
            onChange={(event) => draft.set({ name: event.target.value })}
            className={cx('max-w-md', readOnly && readOnlyField)}
          />
          {readOnly ? (
            <FieldGroup legend={t('settings.org.general.logo')}>
              <OrgMark name={name} url={logo} />
            </FieldGroup>
          ) : (
            <ImageField
              label={t('settings.org.general.logo')}
              hint={t('settings.org.general.logo_hint')}
              preview={<OrgMark name={name} url={logo} />}
              hasImage={logo !== null}
              error={fieldMessage(update.error, 'logo_url')}
              onChange={(image) => draft.set({ logo_url: image })}
            />
          )}
        </div>
      </Panel>

      <Panel title={t('settings.org.general.panel_time')}>
        <div className="grid gap-5 p-4 md:grid-cols-2">
          <Select
            label={t('settings.org.general.locale')}
            hint={t('settings.org.general.locale_hint')}
            error={fieldMessage(update.error, 'locale')}
            value={locale}
            disabled={readOnly}
            onValueChange={(next) => next && draft.set({ locale: next as Locale })}
            options={[
              { value: 'de', label: t('settings.org.general.locale_de') },
              { value: 'en', label: t('settings.org.general.locale_en') },
            ]}
          />
          <Combobox
            label={t('settings.org.general.timezone')}
            name="timezone"
            hint={t('settings.org.general.timezone_hint')}
            error={fieldMessage(update.error, 'timezone')}
            placeholder={t('settings.org.general.timezone_placeholder')}
            emptyText={t('settings.org.general.timezone_empty')}
            value={timezone}
            disabled={readOnly}
            onValueChange={(next) => next && draft.set({ timezone: next })}
            options={zones}
          />
          <FieldGroup legend={t('settings.org.general.week_start')} hint={t('settings.org.general.week_start_hint')} error={fieldMessage(update.error, 'week_start')}>
            <SegmentedControl
              label={t('settings.org.general.week_start')}
              value={String(weekStart)}
              onValueChange={(next) => !readOnly && draft.set({ week_start: next === '0' ? 0 : 1 })}
              options={[
                { value: '1', label: t('settings.org.general.monday'), disabled: readOnly },
                { value: '0', label: t('settings.org.general.sunday'), disabled: readOnly },
              ]}
            />
          </FieldGroup>
        </div>
      </Panel>

      <LeaveGuard dirty={draft.dirty && !readOnly} what={t('settings.org.general.leave_what')} />

      {!readOnly && (
        <div className="flex justify-end">
          <Button variant="primary" type="submit" shortcut="mod+enter" pending={update.isPending}>
            {t('settings.frame.save')}
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
      <SectionHeader title={t('settings.org.section.general')} description={t('settings.org.general.description')} />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[organization]} failure={t('settings.org.general.load_failed')} skeleton={<FormSkeleton label={t('settings.org.general.loading')} />}>
        {() => <GeneralForm key={organization.data.id} organization={organization.data} readOnly={readOnlyReason !== null} />}
      </Loaded>
    </div>
  );
}
