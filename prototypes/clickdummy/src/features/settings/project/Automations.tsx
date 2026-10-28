/*
 * Settings → Automations (spec 4.13): four switches with their parameters. A switch applies at once; the days of
 * Auto-Archive and Auto-Close apply when the field is left or on Enter. Automations act as the default bot, keep to the
 * allowed transitions and appear in the history with their reason. Auto-Close needs a Canceled status in the project's
 * workflow; without one its switch stays off and says why.
 */

import { useId, useState, type KeyboardEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useAutomations, useSaveAutomation } from '@/hooks/automations';
import { useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import type { Automation, AutomationKey, Workflow } from '@/types';
import { cancelTargets, parseDays, skippedByAutoClose } from './automationRules';
import { fieldErrors } from './form';
import type { SectionProps } from './sectionProps';
import { RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton } from './SettingsParts';

interface Definition {
  key: AutomationKey;
  title: string;
  description: string;
}

const DEFINITIONS: Definition[] = [
  {
    key: 'auto_archive',
    title: 'Auto-Archiv',
    description: 'Archiviert Items, die seit der eingestellten Zeit geschlossen sind. Läuft täglich.',
  },
  {
    key: 'auto_close',
    title: 'Auto-Close',
    description:
      'Setzt Items in Backlog oder Todo, die lange nicht geändert wurden, auf einen Canceled-Status und schreibt einen Kommentar dazu. Ist der Übergang nicht erlaubt, überspringt Auto-Close das Item. Läuft täglich.',
  },
  {
    key: 'close_parent',
    title: 'Eltern schließen',
    description:
      'Sind alle Kinder eines Items geschlossen und mindestens eines davon Completed, geht das Eltern-Item in den ersten Completed-Status, zu dem der Übergang erlaubt ist. Wirkt nach oben weiter.',
  },
  {
    key: 'assign_on_start',
    title: 'Assignee beim Start',
    description: 'Startet eine Person ein Item ohne Assignee, wird sie Assignee. Bots lösen das nicht aus.',
  },
];

const DEFAULT_DAYS: Partial<Record<AutomationKey, number>> = { auto_archive: 30, auto_close: 90 };
const DAYS_TEXT = 'Die Tage sind eine ganze Zahl ab 1.';

/** "Backlog", "Backlog und Todo", "A, B und C". */
const listOf = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : (names[0] ?? ''));

export function Automations({ project, canManage }: SectionProps) {
  const automations = useAutomations(project.id);
  const workflows = useWorkflows();

  if (automations.isPending || workflows.isPending) return <SettingsSkeleton rows={4} label="Automatisierungen werden geladen …" />;
  const workflow = workflows.data?.items.find((entry) => entry.id === project.workflow_id);
  if (automations.isError || workflows.isError || !workflow) {
    return (
      <SettingsError
        title="Die Automatisierungen konnten nicht geladen werden"
        error={automations.error ?? workflows.error}
        retrying={automations.isFetching || workflows.isFetching}
        onRetry={() => {
          void automations.refetch();
          void workflows.refetch();
        }}
      />
    );
  }

  return (
    <SettingsCard
      flush
      title="Automatisierungen"
      description="Sie handeln als der Standard-Bot, halten sich an die erlaubten Übergänge und stehen in der History mit ihrem Grund, etwa „Automatisierung: Auto-Archiv“."
    >
      <RuledList label="Automatisierungen">
        {DEFINITIONS.map((definition) => {
          const stored = automations.data.items.find((entry) => entry.key === definition.key);
          return (
            <AutomationRow
              key={definition.key}
              definition={definition}
              workflow={workflow}
              canManage={canManage}
              automation={stored ?? { id: '', project_id: project.id, key: definition.key, enabled: false, settings: {} }}
            />
          );
        })}
      </RuledList>
    </SettingsCard>
  );
}

type RowProps = {
  definition: Definition;
  workflow: Workflow;
  canManage: boolean;
  automation: Automation;
};

function AutomationRow({ definition, workflow, canManage, automation }: RowProps) {
  const descriptionId = useId();
  const save = useSaveAutomation();
  const { key, title } = definition;
  const settings = automation.settings;

  const canceled = cancelTargets(workflow);
  // Auto-Close cannot work, and so is shown off, in a workflow without a Canceled status
  const unusable = key === 'auto_close' && canceled.length === 0;
  const target = canceled.find((state) => state.id === settings.state_id) ?? canceled[0];

  // what the switch shows while the call runs: the new state at once
  const enabled = !unusable && (save.isPending && save.variables ? save.variables.enabled : automation.enabled);

  const [typedDays, setTypedDays] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ days?: string; state?: string }>({});
  const savedDays = settings.days ?? DEFAULT_DAYS[key];
  const shownDays = typedDays ?? String(savedDays ?? '');

  /** Saves the automation with a change; true when the server took it. */
  async function persist(change: { enabled?: boolean; days?: number; state_id?: string }, done: string): Promise<boolean> {
    const next: Automation = {
      ...automation,
      enabled: change.enabled ?? automation.enabled,
      settings: {
        ...settings,
        ...(savedDays !== undefined || change.days !== undefined ? { days: change.days ?? savedDays } : {}),
        ...(key === 'auto_close' ? { state_id: change.state_id ?? target?.id } : {}),
      },
    };
    try {
      await save.mutateAsync(next);
      setProblems({});
      toast({ title: done, tone: 'success' });
      return true;
    } catch (error) {
      const fields = fieldErrors(error);
      if (fields['settings.days'] || fields['settings.state_id']) setProblems({ days: fields['settings.days'], state: fields['settings.state_id'] });
      else notifyError(`${title} nicht gespeichert`, error, () => void persist(change, done));
      return false;
    }
  }

  async function commitDays() {
    if (typedDays === null) return;
    const days = parseDays(typedDays);
    if (days === null) {
      setProblems({ days: DAYS_TEXT });
      return;
    }
    if (days === savedDays) {
      setTypedDays(null);
      setProblems({});
      return;
    }
    if (await persist({ days }, `${title} gespeichert`)) setTypedDays(null);
  }

  function onDaysKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void commitDays();
  }

  const skipped = key === 'auto_close' && enabled && target ? skippedByAutoClose(workflow, target.id) : [];

  return (
    <RuledRow className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-ink">{title}</h3>
          <p id={descriptionId} className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">
            {definition.description}
          </p>
        </div>
        <Switch
          label={<span className="sr-only">{title}</span>}
          // a hit area of 44 px on the phone, in width as well
          className="min-w-11 justify-center md:min-w-0"
          aria-describedby={descriptionId}
          checked={enabled}
          disabled={!canManage || unusable}
          onCheckedChange={(on) => void persist({ enabled: on }, `${title} ${on ? 'eingeschaltet' : 'ausgeschaltet'}`)}
        />
      </div>
      {unusable && (
        <p className="max-w-[65ch] text-ui text-pretty text-muted">{`Der Workflow „${workflow.name}“ hat keinen Status der Kategorie Canceled. Org-Admins können einen ergänzen; bis dahin bleibt Auto-Close aus.`}</p>
      )}
      {enabled && (key === 'auto_archive' || key === 'auto_close') && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Input
            label={key === 'auto_archive' ? 'Tage nach dem Schließen' : 'Tage ohne Änderung'}
            hint={key === 'auto_archive' ? 'So lange bleibt ein Item geschlossen, bevor es archiviert wird.' : 'So lange darf ein Item in Backlog oder Todo ruhen.'}
            name="days"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={shownDays}
            readOnly={!canManage}
            className={canManage ? undefined : 'bg-sunken! shadow-none!'}
            error={problems.days}
            onChange={(event) => {
              setTypedDays(event.target.value);
              setProblems((current) => ({ ...current, days: undefined }));
            }}
            onBlur={() => void commitDays()}
            onKeyDown={onDaysKeyDown}
          />
          {key === 'auto_close' && (
            <Select
              label="Canceled-Status"
              hint="Dorthin setzt Auto-Close die Items."
              disabled={!canManage}
              value={target?.id ?? null}
              error={problems.state}
              options={canceled.map((state) => ({ value: state.id, label: state.name, icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" /> }))}
              onValueChange={(next) => next && void persist({ state_id: next }, `${title} gespeichert`)}
            />
          )}
        </div>
      )}
      {skipped.length > 0 && target && (
        <Banner role="status" title={`Auto-Close überspringt Items in ${listOf(skipped.map((state) => state.name))}.`}>
          {`„${workflow.name}“ erlaubt von dort keinen Übergang nach „${target.name}“. Wähle einen anderen Status oder erlaube den Übergang im Workflow.`}
        </Banner>
      )}
    </RuledRow>
  );
}
