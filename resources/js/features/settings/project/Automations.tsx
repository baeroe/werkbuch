/*
 * Settings → Automations (spec 4.13, port of the clickdummy): four switches with their parameters. A switch applies at
 * once; the days of Auto-Archive and Auto-Close apply when the field is left or on Enter, the Canceled status of
 * Auto-Close when it is chosen. Automations act as the default bot, keep to the allowed transitions and appear in the
 * history with their reason; the nightly ones notify nobody (A357). Auto-Close needs a Canceled status in the project's
 * workflow; without one its switch stays off and says why. Whoever does not manage the project reads (the frame shows
 * the reason).
 *
 * No save twice (13c): one call per automation at a time. What is committed while one runs waits for it, merged into
 * one waiting change (the newest value wins), and a commit that changes nothing of what is shown (Enter, then the blur
 * that follows) sends nothing. The queue lives per query client, project and key, outside the screen: what is on its
 * way survives leaving the section and coming back, and the switch shows it meanwhile. The other three automations do
 * not wait.
 */

import { useIsMutating, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useId, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Page } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useAutomations, useSaveAutomation } from '@/hooks/automations';
import { qk } from '@/hooks/keys';
import { useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import type { Automation, AutomationKey, AutomationSettings, Workflow } from '@/types';
import { fieldErrors } from '../frame/form';
import { readOnlyField, RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton } from '../frame/parts';
import { cancelTargets, MAX_DAYS, parseDays, skippedByAutoClose } from './automationRules';
import type { ProjectSectionProps } from './sectionProps';

const TITLE = {
  auto_archive: 'automations.auto_archive.title',
  auto_close: 'automations.auto_close.title',
  close_parent: 'automations.close_parent.title',
  assign_on_start: 'automations.assign_on_start.title',
} as const;

const DESCRIPTION = {
  auto_archive: 'automations.auto_archive.description',
  auto_close: 'automations.auto_close.description',
  close_parent: 'automations.close_parent.description',
  assign_on_start: 'automations.assign_on_start.description',
} as const;

/** The order of the rows when the server's list misses a key. */
const KEYS: AutomationKey[] = ['auto_archive', 'auto_close', 'close_parent', 'assign_on_start'];

/** Where the nightly ones start (`AutomationKey::defaults`). */
const DEFAULT_DAYS: Partial<Record<AutomationKey, number>> = { auto_archive: 30, auto_close: 90 };

const isNightly = (key: AutomationKey) => key === 'auto_archive' || key === 'auto_close';

const daysText = () => t('field.settings.days', { min: 1, max: MAX_DAYS });

/** "Backlog", "Backlog und Todo", "A, B und C" in the language of the page. */
const listOf = (names: string[]) => new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' }).format(names);

/* ------------------------------------------------------------------- the queue */

/** What an automation is: on or off, and its settings. */
interface Value {
  enabled: boolean;
  settings: AutomationSettings;
}

/** One commit: a switch, the days, or the Canceled status. */
type Change = { enabled?: boolean; days?: number; state_id?: string };

interface Problems {
  days?: string;
  state?: string;
}

interface Deferred {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
}

function deferred(): Deferred {
  let resolve: (ok: boolean) => void = () => {};
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
}

/**
 * What is on its way for one automation. `read` is the stored value as the screen sees it now (from the cache), `send`
 * the call of the screen that committed last; both are set anew on every render, so a call that ends after the screen
 * left reads and sends through the latest ones.
 */
interface Slot {
  running: Value | null;
  runningDone: Promise<boolean> | null;
  waiting: Change | null;
  waitingDone: Deferred | null;
  problems: Problems;
  version: number;
  listeners: Set<() => void>;
  read: () => Value;
  send: (value: Value, change: Change) => Promise<boolean>;
}

const slots = new WeakMap<QueryClient, Map<string, Slot>>();

function slotOf(client: QueryClient, id: string, through: Pick<Slot, 'read' | 'send'>): Slot {
  const forClient = slots.get(client) ?? new Map<string, Slot>();
  slots.set(client, forClient);
  let slot = forClient.get(id);
  if (!slot) {
    slot = {
      running: null,
      runningDone: null,
      waiting: null,
      waitingDone: null,
      problems: {},
      version: 0,
      listeners: new Set(),
      ...through,
    };
    forClient.set(id, slot);
  }
  Object.assign(slot, through);
  return slot;
}

function emit(slot: Slot) {
  slot.version += 1;
  for (const listener of slot.listeners) listener();
}

function apply(change: Change | null, base: Value): Value {
  if (!change) return base;
  return {
    enabled: change.enabled ?? base.enabled,
    settings: {
      ...base.settings,
      ...(change.days !== undefined ? { days: change.days } : {}),
      ...(change.state_id !== undefined ? { state_id: change.state_id } : {}),
    },
  };
}

const same = (a: Value, b: Value) => a.enabled === b.enabled && a.settings.days === b.settings.days && (a.settings.state_id ?? null) === (b.settings.state_id ?? null);

/** What the row shows: the stored value with the call on its way and the change waiting for it. */
const shownOf = (slot: Slot) => apply(slot.waiting, slot.running ?? slot.read());

/** Starts the waiting change when nothing runs; a change that is what is stored by then sends nothing. */
function pump(slot: Slot) {
  if (slot.running || !slot.waiting) return;
  const change = slot.waiting;
  const done = slot.waitingDone!;
  slot.waiting = null;
  slot.waitingDone = null;
  const base = slot.read();
  const next = apply(change, base);
  if (same(next, base)) {
    done.resolve(true);
    emit(slot);
    return;
  }
  slot.running = next;
  slot.runningDone = done.promise;
  emit(slot);
  void slot.send(next, change).then((ok) => {
    slot.running = null;
    slot.runningDone = null;
    done.resolve(ok);
    emit(slot);
    pump(slot);
  });
}

/** Commits a change; resolves with whether the server took it (or had it already). */
function commit(slot: Slot, change: Change): Promise<boolean> {
  const shown = shownOf(slot);
  if (same(apply(change, shown), shown)) return slot.waitingDone?.promise ?? slot.runningDone ?? Promise.resolve(true);
  slot.problems = {};
  slot.waiting = { ...slot.waiting, ...change };
  slot.waitingDone ??= deferred();
  const promise = slot.waitingDone.promise;
  emit(slot);
  pump(slot);
  return promise;
}

/** The slot of the automation; `through` are the screen's latest ways to read and to send. */
function useSlot(id: string, through: Pick<Slot, 'read' | 'send'>): Slot {
  const client = useQueryClient();
  const slot = slotOf(client, id, through);
  useSyncExternalStore(
    (listener) => {
      slot.listeners.add(listener);
      return () => slot.listeners.delete(listener);
    },
    () => slot.version,
  );
  return slot;
}

/* ------------------------------------------------------------------- the screen */

export function Automations({ project, canManage }: ProjectSectionProps) {
  const automations = useAutomations(project.id);
  const workflows = useWorkflows();

  if (automations.isPending || workflows.isPending) return <SettingsSkeleton rows={4} label={t('automations.loading')} />;
  const workflow = workflows.data?.items.find((entry) => entry.id === project.workflow_id);
  // only without data: a failed refetch in the background keeps the rows
  if (!automations.data || !workflow) {
    return (
      <SettingsError
        title={t('automations.load_failed')}
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
    <SettingsCard flush title={t('settings.project.section.automations')} description={t('automations.description')}>
      <RuledList label={t('settings.project.section.automations')}>
        {KEYS.map((key) => (
          <AutomationRow
            key={key}
            projectId={project.id}
            workflow={workflow}
            canManage={canManage}
            automation={automations.data.items.find((entry) => entry.key === key) ?? { id: null, project_id: project.id, key, enabled: false, settings: {} }}
          />
        ))}
      </RuledList>
    </SettingsCard>
  );
}

type RowProps = {
  projectId: string;
  workflow: Workflow;
  canManage: boolean;
  automation: Automation;
};

function AutomationRow({ projectId, workflow, canManage, automation }: RowProps) {
  const descriptionId = useId();
  const reasonId = useId();
  const client = useQueryClient();
  const { key } = automation;
  const title = t(TITLE[key]);
  const save = useSaveAutomation(projectId, key);
  const saving = useIsMutating({ mutationKey: qk.automations.save(projectId, key) }) > 0;
  const listKey = qk.automations.list({ project: projectId });

  const canceled = cancelTargets(workflow);
  // Auto-Close cannot work, and so is shown off, in a workflow without a Canceled status
  const unusable = key === 'auto_close' && canceled.length === 0;

  /** The stored value as it is to be sent: the days with their default, the Canceled status Auto-Close would take. */
  function normal(stored: Automation): Value {
    const settings: AutomationSettings = {};
    if (isNightly(key)) settings.days = stored.settings.days ?? DEFAULT_DAYS[key];
    if (key === 'auto_close') settings.state_id = (canceled.find((state) => state.id === stored.settings.state_id) ?? canceled[0])?.id ?? null;
    return { enabled: stored.enabled, settings };
  }

  const read = () => normal(client.getQueryData<Page<Automation>>(listKey)?.items.find((entry) => entry.key === key) ?? automation);
  const send = async (value: Value, change: Change): Promise<boolean> => {
    const switched = change.enabled !== undefined;
    const settings: AutomationSettings = { ...value.settings };
    if (settings.state_id === null) delete settings.state_id;
    try {
      const saved = await save.mutateAsync({ enabled: value.enabled, settings });
      // the list keeps the answer, also when no screen reads it now
      client.setQueryData<Page<Automation>>(listKey, (page) => page && { ...page, items: page.items.map((entry) => (entry.key === key ? saved : entry)) });
      toast({ title: t(switched ? (value.enabled ? 'automations.saved.on' : 'automations.saved.off') : 'automations.saved.settings', { name: title }), tone: 'success' });
      return true;
    } catch (error) {
      const fields = fieldErrors(error);
      const notSaved = t('automations.not_saved', { name: title });
      const message = fields['settings.days'] ?? fields['settings.state_id'];
      if (message && !switched) {
        // the field that was changed is there to show it
        slot.problems = { days: fields['settings.days'], state: fields['settings.state_id'] };
        emit(slot);
      } else if (message) toast({ title: notSaved, description: message, tone: 'error' });
      else notifyError(notSaved, error, () => void commit(slot, change));
      return false;
    }
  };
  const slot = useSlot(`${projectId}:${key}`, { read, send });

  const shown = shownOf(slot);
  const enabled = !unusable && shown.enabled;
  const target = canceled.find((state) => state.id === shown.settings.state_id);

  const [typedDays, setTypedDays] = useState<string | null>(null);
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  const shownDays = typedDays ?? String(shown.settings.days ?? '');

  async function commitDays() {
    if (typedDays === null) return;
    const days = parseDays(typedDays);
    if (days === null) {
      setTypedProblem(daysText());
      return;
    }
    // what was typed meanwhile stays: only the text that was just saved gives way to the saved value
    if (await commit(slot, { days })) setTypedDays((current) => (current !== null && parseDays(current) === days ? null : current));
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
            {t(DESCRIPTION[key])}
          </p>
        </div>
        <Switch
          label={<span className="sr-only">{title}</span>}
          // a hit area of 44 px on the phone, in width as well
          className="min-w-11 justify-center md:min-w-0"
          aria-describedby={unusable ? `${descriptionId} ${reasonId}` : descriptionId}
          aria-busy={saving || undefined}
          checked={enabled}
          disabled={!canManage || unusable}
          // Auto-Close goes on with the Canceled status it shows (`normal`)
          onCheckedChange={(on) => void commit(slot, { enabled: on })}
        />
      </div>
      {unusable && (
        <p id={reasonId} className="max-w-[65ch] text-ui text-pretty text-muted">
          {t('automations.auto_close.no_canceled', { name: workflow.name })}
        </p>
      )}
      {enabled && isNightly(key) && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Input
            label={t(key === 'auto_archive' ? 'automations.days.auto_archive' : 'automations.days.auto_close')}
            hint={t(key === 'auto_archive' ? 'automations.days.auto_archive_hint' : 'automations.days.auto_close_hint')}
            name="days"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={shownDays}
            readOnly={!canManage}
            className={canManage ? undefined : readOnlyField}
            error={typedProblem ?? slot.problems.days}
            onChange={(event) => {
              setTypedDays(event.target.value);
              setTypedProblem(null);
              if (slot.problems.days) {
                slot.problems = { ...slot.problems, days: undefined };
                emit(slot);
              }
            }}
            onBlur={() => void commitDays()}
            onKeyDown={onDaysKeyDown}
          />
          {key === 'auto_close' && (
            <Select
              label={t('automations.state.label')}
              hint={t('automations.state.hint')}
              readOnly={!canManage}
              value={target?.id ?? null}
              error={slot.problems.state}
              options={canceled.map((state) => ({ value: state.id, label: state.name, icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" /> }))}
              onValueChange={(next) => next && void commit(slot, { state_id: next })}
            />
          )}
        </div>
      )}
      {skipped.length > 0 && target && (
        <Banner role="status" title={t('automations.auto_close.skipped', { states: listOf(skipped.map((state) => state.name)) })}>
          {t('automations.auto_close.skipped_text', { workflow: workflow.name, state: target.name })}
        </Banner>
      )}
    </RuledRow>
  );
}
