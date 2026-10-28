/*
 * Settings → Types (spec 4.4, 4.6): the types live in the organisation, a project switches on a selection of them
 * (at least one) and picks one as the default for new items. Items of a type that is switched off keep it.
 */

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { CircleAlert } from 'lucide-react';
import { useMemo, useRef, type FormEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { toast } from '@/components/ui/toast';
import { TypeTab } from '@/components/ui/TypeTab';
import { useUpdateProject } from '@/hooks/projects';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from './form';
import type { SectionProps } from './sectionProps';
import { FormActions, RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton, UnsavedGuard } from './SettingsParts';
import { useProjectItems } from './useProjectItems';

const number = new Intl.NumberFormat('de');

export function Types({ project, canManage }: SectionProps) {
  const form = useRef<HTMLFormElement>(null);
  const types = useWorkItemTypes();
  const items = useProjectItems(project.id);
  const update = useUpdateProject();
  const draft = useDraft(useMemo(() => ({ enabled_type_ids: project.enabled_type_ids, default_type_id: project.default_type_id }), [project]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, canManage);

  const { enabled_type_ids: enabled, default_type_id: standard } = draft.value;

  const shown = useMemo(() => (types.data?.items ?? []).filter((type) => type.archived_at === null || enabled.includes(type.id)), [types.data, enabled]);
  const perType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items.data?.items ?? []) counts.set(item.type_id, (counts.get(item.type_id) ?? 0) + 1);
    return counts;
  }, [items.data]);

  if (types.isPending) return <SettingsSkeleton rows={4} label="Typen werden geladen …" />;
  if (types.isError) return <SettingsError title="Die Typen konnten nicht geladen werden" error={types.error} retrying={types.isFetching} onRetry={() => void types.refetch()} />;

  const allIds = types.data.items.map((type) => type.id);

  function toggle(typeId: string, on: boolean) {
    const chosen = new Set(enabled);
    if (on) chosen.add(typeId);
    else chosen.delete(typeId);
    // in the order of the organisation, not of the clicks
    const ordered = [...allIds.filter((id) => chosen.has(id)), ...[...chosen].filter((id) => !allIds.includes(id))];
    // the default must stay one of the types that are on
    draft.set({ enabled_type_ids: ordered, default_type_id: ordered.includes(standard) ? standard : (ordered[0] ?? standard) });
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
      toast({ title: 'Einstellungen gespeichert', tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Typen nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  const problem = problems.errors.enabled_type_ids ?? problems.errors.default_type_id;

  return (
    <form ref={form} noValidate onSubmit={(event) => void save(event)}>
      {canManage && <UnsavedGuard dirty={draft.dirty} saving={update.isPending} />}
      <SettingsCard
        flush={enabled.length > 1 && !problem}
        title="Typen"
        description="Die Typen legen Org-Admins zentral an. Hier wählst du, welche in diesem Projekt zur Verfügung stehen und welcher beim Anlegen eines Items vorgewählt ist."
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
        <RadioGroup
          aria-label="Standardtyp"
          // the server refused the choice: the group takes the focus, so the person lands on what needs fixing
          aria-invalid={problem ? true : undefined}
          tabIndex={problem ? -1 : undefined}
          value={standard}
          onValueChange={(next) => draft.set({ default_type_id: String(next) })}
        >
          <RuledList label="Typen der Organisation">
            {shown.map((type) => {
              const on = enabled.includes(type.id);
              const count = items.data ? (perType.get(type.id) ?? 0) : undefined;
              return (
                <RuledRow key={type.id} className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <Checkbox
                    aria-label={`${type.name} verwenden`}
                    checked={on}
                    disabled={!canManage || (on && enabled.length === 1)}
                    onCheckedChange={(next) => toggle(type.id, next)}
                  />
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <TypeTab tone={type.tone} icon={type.icon} label={type.name} />
                      {type.archived_at !== null && <Chip>Archiviert</Chip>}
                      {count !== undefined && <span className="text-sm text-muted tabular-nums">{count === 0 ? 'Keine Items' : `${number.format(count)} ${count === 1 ? 'Item' : 'Items'}`}</span>}
                    </div>
                    {type.description && <p className="mt-1.5 max-w-[65ch] text-ui text-pretty text-muted">{type.description}</p>}
                    {!on && count !== undefined && count > 0 && (
                      <p className="mt-1 max-w-[65ch] text-sm text-pretty text-muted">Bestehende Items behalten den Typ. Neue lassen sich damit nicht mehr anlegen.</p>
                    )}
                  </div>
                  <label className={`flex min-h-11 items-center gap-2 text-ui text-ink md:min-h-8 ${on && canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                    <Radio.Root
                      value={type.id}
                      disabled={!canManage || !on}
                      aria-label={`${type.name} als Standardtyp`}
                      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-line-input bg-surface transition-colors duration-120 data-checked:border-accent"
                    >
                      <Radio.Indicator className="size-2 rounded-full bg-accent data-unchecked:hidden" />
                    </Radio.Root>
                    Standard
                  </label>
                </RuledRow>
              );
            })}
          </RuledList>
        </RadioGroup>
        {enabled.length === 1 && <p className="text-ui text-pretty text-muted">Mindestens ein Typ bleibt aktiv.</p>}
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
