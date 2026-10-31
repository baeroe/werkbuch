/*
 * Settings → General (spec 4.4): name, identifier, description, picture, project lead and visibility, and below them
 * the danger zone. Changing the identifier renames all keys; the API keeps the old identifier as an alias, so old keys
 * and addresses keep working. A 422 of the server shows at its field; only the fields that changed are sent.
 */

import { useMemo, useRef, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { useMembers, useUpdateProject } from '@/hooks/projects';
import { useAllUsers } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import type { Project, User } from '@/types';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '../frame/form';
import { ImageField } from '../frame/ImageField';
import { LeaveGuard } from '../frame/LeaveGuard';
import { FormActions, Loaded, readOnlyField, SettingsCard, SettingsSkeleton } from '../frame/parts';
import { DangerZone } from './DangerZone';
import type { ProjectSectionProps } from './sectionProps';

const MAX_DESCRIPTION = 2000;

interface Fields {
  name: string;
  identifier: string;
  description: string;
  image_url: string | null;
  lead_id: string;
  visibility: Project['visibility'];
}

const fieldsOf = (project: Project): Fields => ({
  name: project.name,
  identifier: project.identifier,
  description: project.description,
  image_url: project.image_url,
  lead_id: project.lead_id,
  visibility: project.visibility,
});

/** Who can lead the project: the active people among its members, and the lead it has (also one deactivated meanwhile). */
function leadOptions(project: Project, memberIds: Set<string>, users: User[]) {
  return users
    .filter((user) => user.type === 'person' && (user.id === project.lead_id || (memberIds.has(user.id) && user.disabled_at === null)))
    .map((user) => ({ value: user.id, label: user.name, icon: <Avatar user={user} size="sm" decorative /> }));
}

function GeneralForm({ project, canManage, people }: ProjectSectionProps & { people: ReturnType<typeof leadOptions> }) {
  const form = useRef<HTMLFormElement>(null);
  // set by the danger zone when the deletion sends the person to the list: the guard lets that departure pass (a new
  // identifier moves the address only once the saved edits are no longer unsaved)
  const leaving = useRef(false);
  const update = useUpdateProject();
  const draft = useDraft(useMemo(() => fieldsOf(project), [project]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, canManage);
  const number = new Intl.NumberFormat(intlLocale());

  const { value } = draft;
  const next = value.identifier.trim().toUpperCase();
  const renamed = next !== '' && next !== project.identifier;

  function edit(patch: Partial<Fields>) {
    draft.set(patch);
    problems.clear(...Object.keys(patch));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canManage || update.isPending) return;
    if (!draft.dirty) {
      draft.tellNothingToSave();
      return;
    }
    const before = project.identifier;
    const patch = Object.fromEntries(draft.changed.map((key) => [key, key === 'identifier' ? next : draft.value[key]]));
    try {
      await update.mutateAsync({ id: project.id, patch });
      draft.reset();
      problems.clearAll();
      // the address moves to the new identifier under this screen, so the toast is the app's, not the form's
      if (renamed) toast({ title: t('settings.project.general.renamed'), description: t('settings.project.general.renamed_text', { old: before, new: next }), tone: 'success' });
      else toast({ title: t('settings.project.general.saved'), tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError(t('settings.project.general.not_saved'), error, () => form.current?.requestSubmit());
    }
  }

  return (
    <>
      <form ref={form} noValidate onSubmit={(event) => void save(event)}>
        {canManage && <LeaveGuard dirty={draft.dirty} bypass={leaving} what={t('settings.project.general.leave_what')} />}
        <SettingsCard
          title={t('settings.project.general.title')}
          description={t('settings.project.general.description')}
          footer={
            canManage ? (
              <FormActions
                dirty={draft.dirty}
                quiet={draft.quiet}
                pending={update.isPending}
                onReset={() => {
                  draft.reset();
                  problems.clearAll();
                }}
              />
            ) : undefined
          }
        >
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
            <Input
              label={t('settings.project.general.name')}
              name="name"
              value={value.name}
              readOnly={!canManage}
              className={cx(!canManage && readOnlyField)}
              autoComplete="off"
              error={problems.errors.name}
              onChange={(event) => edit({ name: event.target.value })}
            />
            <Input
              label={t('settings.project.general.identifier')}
              name="identifier"
              value={value.identifier}
              readOnly={!canManage}
              className={cx(!canManage && readOnlyField)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              translate="no"
              hint={t('settings.project.general.identifier_hint')}
              error={problems.errors.identifier}
              onChange={(event) => edit({ identifier: event.target.value.toUpperCase() })}
            />
          </div>
          {renamed && !problems.errors.identifier && (
            <Banner tone="info" title={t('settings.project.general.old_keys_title')}>
              <span className="block max-w-[65ch]">{t('settings.project.general.old_keys_text', { old: project.identifier, new: next })}</span>
            </Banner>
          )}
          <Textarea
            label={t('settings.project.general.project_description')}
            name="description"
            autoComplete="off"
            value={value.description}
            readOnly={!canManage}
            className={cx(!canManage && readOnlyField)}
            hint={t('settings.project.general.description_hint', { count: number.format(value.description.length), max: number.format(MAX_DESCRIPTION) })}
            error={problems.errors.description}
            onChange={(event) => edit({ description: event.target.value })}
          />
          <ImageField
            label={t('settings.project.general.image')}
            preview={<ProjectBadge project={{ identifier: next || project.identifier, image_url: value.image_url }} size="md" />}
            hasImage={value.image_url !== null}
            disabled={!canManage}
            hint={t('settings.project.general.image_hint')}
            error={problems.errors.image_url}
            onChange={(image) => edit({ image_url: image })}
          />
          <div className="grid items-start gap-4 md:grid-cols-2">
            <Select
              label={t('settings.project.general.lead')}
              hint={t('settings.project.general.lead_hint')}
              disabled={!canManage}
              value={value.lead_id}
              error={problems.errors.lead_id}
              options={people}
              onValueChange={(lead) => lead && edit({ lead_id: lead })}
            />
            <div className="flex min-w-0 flex-col">
              <p className={`${labelClass} mb-1.5`}>{t('settings.project.general.visibility')}</p>
              <div>
                <SegmentedControl
                  label={t('settings.project.general.visibility')}
                  value={value.visibility}
                  onValueChange={(visibility) => edit({ visibility })}
                  options={[
                    { value: 'public', label: t('projects.public'), disabled: !canManage },
                    { value: 'private', label: t('projects.private'), disabled: !canManage },
                  ]}
                />
              </div>
              <p className="mt-1.5 text-sm text-pretty text-muted">{t(`settings.project.general.visibility_${value.visibility}`)}</p>
            </div>
          </div>
        </SettingsCard>
      </form>
      {canManage && <DangerZone project={project} leaving={leaving} />}
    </>
  );
}

export function General({ project, canManage }: ProjectSectionProps) {
  const members = useMembers(project.id);
  const users = useAllUsers();
  return (
    <Loaded queries={[members, users]} failure={t('settings.frame.load_failed')} skeleton={<SettingsSkeleton rows={5} />}>
      {() => (
        <GeneralForm
          project={project}
          canManage={canManage}
          people={leadOptions(project, new Set(members.data!.items.map((member) => member.user_id)), users.data!.items)}
        />
      )}
    </Loaded>
  );
}
