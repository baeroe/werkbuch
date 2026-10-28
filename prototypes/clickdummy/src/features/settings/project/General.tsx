/*
 * Settings → General (spec 4.4): name, identifier, description, picture, project lead and visibility, and below them
 * the danger zone. Changing the identifier renames all keys; the API keeps the old identifier as an alias, so old keys
 * keep working. A 422 of the server shows at its field.
 */

import { useMemo, useRef, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Input } from '@/components/ui/Input';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { useMembers, useUpdateProject } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import type { Project } from '@/types';
import { DangerZone } from './DangerZone';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from './form';
import { ImageField } from './ImageField';
import type { SectionProps } from './sectionProps';
import { FormActions, SettingsCard, SettingsError, SettingsSkeleton, UnsavedGuard } from './SettingsParts';

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

const VISIBILITY_TEXT: Record<Project['visibility'], string> = {
  public: 'Alle Personen der Organisation sehen das Projekt und treten mit einem Klick bei.',
  private: 'Nur Mitglieder und Org-Admins sehen das Projekt.',
};

const number = new Intl.NumberFormat('de');

/** A value that cannot be changed lies on the sunken surface without the writing line, so it does not look like a field to fill in. */
const READ_ONLY_LOOK = 'bg-sunken! shadow-none!';

export function General({ project, canManage }: SectionProps) {
  const form = useRef<HTMLFormElement>(null);
  const members = useMembers(project.id);
  const users = useUsers();
  const update = useUpdateProject();
  const draft = useDraft(useMemo(() => fieldsOf(project), [project]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, canManage);

  const people = useMemo(() => {
    const memberIds = new Set(members.data?.items.map((member) => member.user_id));
    return (users.data?.items ?? []).filter((user) => user.type === 'person' && (user.id === project.lead_id || (memberIds.has(user.id) && user.disabled_at === null)));
  }, [members.data, users.data, project.lead_id]);

  if (members.isPending || users.isPending) return <SettingsSkeleton rows={5} />;
  if (members.isError || users.isError) {
    return (
      <SettingsError
        error={members.error ?? users.error}
        retrying={members.isFetching || users.isFetching}
        onRetry={() => {
          void members.refetch();
          void users.refetch();
        }}
      />
    );
  }

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
    const patch = Object.fromEntries(draft.changed.map((key) => [key, draft.value[key]]));
    try {
      await update.mutateAsync({ id: project.id, patch });
      draft.reset();
      problems.clearAll();
      // the address may have changed under this screen (the frame follows the new identifier), so the toast is global
      if (renamed) toast({ title: 'Kennung geändert', description: `${project.identifier}-12 heißt jetzt ${next}-12. Alte Keys funktionieren weiter.`, tone: 'success' });
      else toast({ title: 'Einstellungen gespeichert', tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Einstellungen nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  return (
    <>
      <form ref={form} noValidate onSubmit={(event) => void save(event)}>
        {canManage && <UnsavedGuard dirty={draft.dirty} saving={update.isPending} />}
        <SettingsCard
          title="Projekt"
          description="So erscheint das Projekt in der Seitenleiste, in Views und in den Keys seiner Items."
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
              label="Name"
              name="name"
              value={value.name}
              readOnly={!canManage}
              className={canManage ? undefined : READ_ONLY_LOOK}
              autoComplete="off"
              error={problems.errors.name}
              onChange={(event) => edit({ name: event.target.value })}
            />
            <Input
              label="Kennung"
              name="identifier"
              value={value.identifier}
              readOnly={!canManage}
              className={canManage ? undefined : READ_ONLY_LOOK}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              translate="no"
              hint={'2 bis 10 Großbuchstaben oder Ziffern, beginnt mit einem Buchstaben.'}
              error={problems.errors.identifier}
              onChange={(event) => edit({ identifier: event.target.value.toUpperCase() })}
            />
          </div>
          {renamed && !problems.errors.identifier && (
            <Banner tone="info" title="Alte Keys funktionieren weiter">
              <span className="block max-w-[65ch]">{`${project.identifier}-12 leitet danach auf ${next}-12 um. Die API behält die alte Kennung als Alias, Links und Verweise bleiben gültig.`}</span>
            </Banner>
          )}
          <Textarea
            label="Beschreibung"
            name="description"
            value={value.description}
            readOnly={!canManage}
            className={canManage ? undefined : READ_ONLY_LOOK}
            hint={`Klartext. ${number.format(value.description.length)} von ${number.format(MAX_DESCRIPTION)} Zeichen.`}
            error={problems.errors.description}
            onChange={(event) => edit({ description: event.target.value })}
          />
          <ImageField
            label="Bild"
            preview={<ProjectBadge project={{ identifier: next || project.identifier, image_url: value.image_url }} size="md" />}
            hasImage={value.image_url !== null}
            disabled={!canManage}
            hint="Ohne Bild zeigt werkbuch den ersten Buchstaben der Kennung auf einer Farbe."
            onChange={(image) => edit({ image_url: image })}
          />
          <div className="grid items-start gap-4 md:grid-cols-2">
            <Select
              label="Lead"
              hint="Der Lead bekommt alle Benachrichtigungen des Projekts und hat keine zusätzlichen Rechte."
              disabled={!canManage}
              value={value.lead_id}
              error={problems.errors.lead_id}
              options={people.map((user) => ({ value: user.id, label: user.name, icon: <Avatar user={user} size="sm" decorative /> }))}
              onValueChange={(lead) => lead && edit({ lead_id: lead })}
            />
            <div className="flex min-w-0 flex-col">
              <p className={`${labelClass} mb-1.5`}>Sichtbarkeit</p>
              <div>
                <SegmentedControl
                  label="Sichtbarkeit"
                  value={value.visibility}
                  onValueChange={(visibility) => edit({ visibility })}
                  options={[
                    { value: 'public', label: 'Öffentlich', disabled: !canManage },
                    { value: 'private', label: 'Privat', disabled: !canManage },
                  ]}
                />
              </div>
              <p className="mt-1.5 text-sm text-pretty text-muted">{VISIBILITY_TEXT[value.visibility]}</p>
            </div>
          </div>
        </SettingsCard>
      </form>
      {canManage && <DangerZone project={project} canManage={canManage} />}
    </>
  );
}
