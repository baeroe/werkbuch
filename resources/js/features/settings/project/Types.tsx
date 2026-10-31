/*
 * Settings → Types (spec 4.4, 4.6): the types live in the organisation, a project switches on a selection of them
 * (at least one) and picks one as the default for new items. An archived type the project has switched on may stay on,
 * but it cannot come back once switched off, and it cannot be the default (P11). Without items there are no counts per
 * type yet (P6).
 */

import { CircleAlert } from 'lucide-react';
import { useId, useMemo, useRef, type FormEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { TypeTab } from '@/components/ui/TypeTab';
import { useUpdateProject } from '@/hooks/projects';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { WorkItemType } from '@/types';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '../frame/form';
import { LeaveGuard } from '../frame/LeaveGuard';
import { FormActions, RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton } from '../frame/parts';
import type { ProjectSectionProps } from './sectionProps';

type RowProps = {
  type: WorkItemType;
  on: boolean;
  /** The name the radios of the default type share. */
  group: string;
  isDefault: boolean;
  onDefault: () => void;
  /** The checkbox cannot be cleared: the last active type that is on. */
  last: boolean;
  canManage: boolean;
  onToggle: (on: boolean) => void;
};

function TypeRow({ type, on, group, isDefault, onDefault, last, canManage, onToggle }: RowProps) {
  const reasonId = useId();
  const archived = type.archived_at !== null;
  // an archived type that is on stays on, but it cannot be the default: the radio says why
  const reason = on && archived ? t('settings.project.types.archived_default') : null;
  const choosable = canManage && on && !archived;
  return (
    <RuledRow className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Checkbox aria-label={t('settings.project.types.use', { name: type.name })} checked={on} disabled={!canManage || last} onCheckedChange={onToggle} />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TypeTab tone={type.tone} icon={type.icon} label={type.name} />
          {archived && <Chip>{t('settings.project.types.archived')}</Chip>}
        </div>
        {type.description && <p className="mt-1.5 max-w-[65ch] text-ui text-pretty text-muted">{type.description}</p>}
      </div>
      <Tooltip content={reason} disabled={reason === null}>
        <label className={cx('flex min-h-11 items-center gap-2 text-ui text-ink md:min-h-8', choosable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}>
          <input
            type="radio"
            name={group}
            value={type.id}
            checked={isDefault}
            disabled={!choosable}
            onChange={onDefault}
            aria-label={t('settings.project.types.as_default', { name: type.name })}
            aria-describedby={reason ? reasonId : undefined}
            className="size-4 shrink-0 cursor-[inherit] appearance-none rounded-full border border-line-input bg-surface transition-colors duration-120 checked:border-accent checked:[box-shadow:inset_0_0_0_3px_var(--color-surface),inset_0_0_0_8px_var(--color-accent)]"
          />
          {t('settings.project.types.default')}
          {reason && (
            <span id={reasonId} hidden>
              {reason}
            </span>
          )}
        </label>
      </Tooltip>
    </RuledRow>
  );
}

export function Types({ project, canManage }: ProjectSectionProps) {
  const form = useRef<HTMLFormElement>(null);
  const group = useId();
  const types = useWorkItemTypes();
  const update = useUpdateProject();
  const draft = useDraft(useMemo(() => ({ enabled_type_ids: project.enabled_type_ids, default_type_id: project.default_type_id }), [project]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, canManage);

  const { enabled_type_ids: enabled, default_type_id: standard } = draft.value;
  const all = types.data?.items ?? [];
  // archived types only while the project has them on (on the server or in the draft): they cannot be switched on anew
  const shown = all.filter((type) => type.archived_at === null || project.enabled_type_ids.includes(type.id) || enabled.includes(type.id));
  const active = new Set(all.filter((type) => type.archived_at === null).map((type) => type.id));
  const activeOn = enabled.filter((id) => active.has(id));

  if (types.isPending) return <SettingsSkeleton rows={4} label={t('settings.project.types.loading')} />;
  if (types.isError) return <SettingsError title={t('settings.project.types.load_failed')} error={types.error} retrying={types.isFetching} onRetry={() => void types.refetch()} />;

  function toggle(typeId: string, on: boolean) {
    const chosen = new Set(enabled);
    if (on) chosen.add(typeId);
    else chosen.delete(typeId);
    // in the order of the organisation, not of the clicks
    const ordered = all.map((type) => type.id).filter((id) => chosen.has(id));
    // the default stays one of the active types that are on
    const fallback = ordered.find((id) => active.has(id)) ?? standard;
    draft.set({ enabled_type_ids: ordered, default_type_id: ordered.includes(standard) ? standard : fallback });
    problems.clearAll();
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
      toast({ title: t('settings.project.types.saved'), tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError(t('settings.project.types.not_saved'), error, () => form.current?.requestSubmit());
    }
  }

  // every refusal of this form is about the choice in the list, so it stands below the list
  const problem = Object.values(problems.errors)[0];

  return (
    <form ref={form} noValidate onSubmit={(event) => void save(event)}>
      {canManage && <LeaveGuard dirty={draft.dirty} what={t('settings.project.types.leave_what')} />}
      <SettingsCard
        flush={activeOn.length > 1 && !problem}
        title={t('settings.project.types.title')}
        description={t('settings.project.types.description')}
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
        {/* Native radios in a plain group: Base UI's RadioGroup is a composite widget and would take the tab stop away
            from the checkboxes in its rows. Tab reaches the chosen radio, the arrows move the choice. */}
        <div
          role="radiogroup"
          aria-label={t('settings.project.types.default_group')}
          // the server refused the choice: the group takes the focus, so the person lands on what needs fixing
          aria-invalid={problem ? true : undefined}
          tabIndex={problem ? -1 : undefined}
        >
          <RuledList label={t('settings.project.types.list_label')}>
            {shown.map((type) => {
              const on = enabled.includes(type.id);
              return (
                <TypeRow
                  key={type.id}
                  type={type}
                  on={on}
                  group={group}
                  isDefault={type.id === standard}
                  onDefault={() => {
                    draft.set({ default_type_id: type.id });
                    problems.clearAll();
                  }}
                  last={on && activeOn.length === 1 && active.has(type.id)}
                  canManage={canManage}
                  onToggle={(next) => toggle(type.id, next)}
                />
              );
            })}
          </RuledList>
        </div>
        {activeOn.length === 1 && <p className="text-ui text-pretty text-muted">{t('settings.project.types.last')}</p>}
        {problem && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {problem}
          </p>
        )}
      </SettingsCard>
    </form>
  );
}
