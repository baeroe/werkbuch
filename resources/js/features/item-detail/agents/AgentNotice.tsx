/*
 * What an agent does at an item, under its title (WEBU-28, port of the clickdummy, spec 10.6): the chip "Kira
 * arbeitet" while a run is queued, runs or stops (a click shows the run in the activity), and a notice for the states
 * that need a person:
 * - a run waits: for the runner of its strand, which is offline (after 30 minutes another runner of the pool takes the
 *   strand over), or because no runner of the pool has its CLI, its agent is off, the guard holds the project, GitHub
 *   gave no token;
 * - the strand pauses: the brake (after so many corrections or conflicts), a run that pushed nothing, an unauthorized
 *   merge in the project (only project admins confirm it), GitHub disconnected ("Weitermachen" once the project has its
 *   repo again), or somebody else has the item; the way back is to give it to the bot again;
 * - the last run failed, ran out of time, was canceled or lost its runner: why, and "Erneut starten";
 * - the assignee is a bot that does not work as an agent here: why, and where to change it.
 */

import { Bot, CircleDot, Hourglass, OctagonPause, Play, RotateCw, TriangleAlert, UserRound } from 'lucide-react';
import { Link } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { useEditReason, useUserMap } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { clockTime, runName, useNow } from '@/features/settings/org/runners/runnerParts';
import { useSettle } from '@/hooks/mutation';
import { useOrganization } from '@/hooks/organization';
import { useProjectsWith } from '@/hooks/projects';
import { useResumeThread } from '@/hooks/runs';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { t, tn } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import type { AgentRefusal, AgentRun, ItemAgentState, WorkItem } from '@/types';
import { canRetry, isActive, waitingText } from './runParts';
import { focusNewRun, runIds, showRun } from './runFocus';
import { useGiveBack, useRetry } from './RunLine';

/** After this long offline, another runner of the pool takes a strand over (spec 9, `Protocol::TAKEOVER_MINUTES`). */
export const TAKEOVER_MINUTES = 30;

const linkClass = 'font-medium text-accent-text underline-offset-2 hover:underline';

/** `runs` oldest first; `agent` as `include=agent` answered it. */
export function AgentNotice({ item, runs, agent }: { item: WorkItem; runs: readonly AgentRun[]; agent: ItemAgentState | null | undefined }) {
  const users = useUserMap();
  const zone = useOrganization().data.timezone;
  const project = useProjectsWith(item.project_id).data?.items.find((entry) => entry.id === item.project_id);
  const editReason = useEditReason(item);
  const { can } = usePermissions();
  const thread = agent?.thread ?? null;
  const last = runs.at(-1);
  const bot = users.get(thread?.bot_id ?? last?.bot_id ?? '');
  const { runRetry, pending: retrying } = useRetry(item);
  const { giveBack, pending: givingBack } = useGiveBack(item, bot);
  const resume = useResumeThread();
  const settle = useSettle();
  const active = runs.findLast(isActive);
  // the clock moves on while a run waits for its runner: past the takeover the notice says so
  const at = useNow(active?.status === 'waiting' && active.waiting_reason === 'runner_offline');
  const identifier = project?.identifier ?? t('items.agents.this_project');

  function runResume() {
    const before = runIds();
    settle(resume.mutateAsync(item.id), {
      onSuccess: ({ braked }) => {
        if (braked) {
          // not a success: nothing goes on. The button goes; the focus moves to the way back, else to the title
          toast({ title: t('items.agents.resume.braked', { key: item.key }), description: t('items.agents.resume.braked_description', { bot: bot?.name ?? t('items.agents.run.some_bot') }) });
          focusWhenLost(() => document.querySelector<HTMLElement>('[data-give-back]') ?? document.querySelector<HTMLElement>('[data-item-title]'), 4000);
          return;
        }
        toast({ title: t('items.agents.resume.done', { key: item.key, bot: bot?.name ?? t('items.agents.run.some_bot') }), description: t('items.agents.resume.done_description'), tone: 'success' });
        // the answer names the correction: its line comes with the reload of the runs
        focusNewRun(before);
      },
      onError: (error) => notifyError(t('items.agents.resume.failed'), error, runResume),
    });
  }

  const parts: ReactNode[] = [];
  const botName = bot?.name ?? t('items.agents.run.some_bot');

  if (active && active.status !== 'waiting') {
    const words =
      active.status === 'running'
        ? t('items.agents.chip.running', { bot: botName, run: runName(active.type) })
        : active.status === 'canceling'
          ? t('items.agents.chip.canceling', { bot: botName, run: runName(active.type) })
          : t('items.agents.chip.queued', { run: runName(active.type) });
    parts.push(
      <button
        key="chip"
        type="button"
        data-agent-chip=""
        onClick={() => showRun(active.id)}
        className="inline-flex h-11 max-w-full cursor-pointer items-center gap-1.5 self-start rounded-chip border border-transparent bg-accent-soft px-2 text-sm font-medium text-accent-text transition-colors duration-120 hover:border-accent md:h-7"
      >
        {active.status === 'queued' ? <Hourglass className="size-3.5 shrink-0" aria-hidden="true" /> : <CircleDot className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{words}</span>
        {active.started_at && <span className="shrink-0 font-normal tabular-nums">{t('items.agents.chip.since', { time: clockTime(active.started_at, zone) })}</span>}
      </button>,
    );
  }

  if (active?.status === 'waiting') {
    const show = (
      <Button variant="ghost" size="sm" onClick={() => showRun(active.id)}>
        {t('items.agents.show_run')}
      </Button>
    );
    if (active.waiting_reason === 'runner_offline' && active.runner_name) {
      const since = active.runner_last_seen_at ?? null;
      const deadline = since ? Date.parse(since) + TAKEOVER_MINUTES * 60_000 : null;
      const takeover = deadline === null ? null : clockTime(new Date(deadline).toISOString(), zone);
      parts.push(
        <Banner key="waiting" tone="info" icon={Hourglass} title={t('items.agents.waiting.runner_title', { run: runName(active.type), runner: active.runner_name })} action={show}>
          <span className="block max-w-[65ch]">
            {since ? t('items.agents.waiting.offline_since', { runner: active.runner_name, time: clockTime(since, zone) }) : t('items.agents.waiting.offline', { runner: active.runner_name })}
            {takeover && ` ${deadline !== null && at >= deadline ? t('items.agents.waiting.takeover_due', { time: takeover }) : t('items.agents.waiting.takeover_at', { time: takeover })}`}
          </span>
        </Banner>,
      );
    } else {
      parts.push(
        <Banner key="waiting" tone="info" icon={Hourglass} title={t('items.agents.waiting.title', { run: runName(active.type) })} action={show}>
          <span className="block max-w-[65ch]">
            {waitingText(active)} {active.waiting_reason === 'no_cli' && t('items.agents.waiting.no_cli_hint')}
          </span>
        </Banner>,
      );
    }
  }

  // an unauthorized merge says so at once, while the canceled run is still stopping
  if ((!active || thread?.pause_reason === 'guard') && thread?.status === 'paused' && bot) {
    const withBot = item.assignee_id === bot.id;
    const owner = users.get(bot.owner_id ?? '');
    const reason = thread.pause_reason;
    const guard = reason === 'guard' ? (agent?.guard ?? null) : null;
    // which brake stopped the strand: corrections and conflicts are counted apart (spec 7.2)
    const brakes = agent?.brakes;
    const brake =
      reason !== 'brake' || !brakes
        ? null
        : thread.corrections >= brakes.max_corrections
          ? tn('items.agents.paused.after_corrections', thread.corrections)
          : thread.conflicts >= brakes.max_conflicts
            ? tn('items.agents.paused.after_conflicts', thread.conflicts)
            : null;
    const pr = thread.pr_number === null ? '' : ` #${thread.pr_number}`;
    let title: string;
    let text: string;
    let action: ReactNode = null;
    if (reason === 'guard') {
      title = guard?.here
        ? t('items.agents.paused.guard_here_title', { bot: bot.name, branch: guard.branch ?? '?' })
        : t('items.agents.paused.guard_title', { bot: bot.name, project: identifier });
      text = guard?.here
        ? t('items.agents.paused.guard_here', { branch: guard.branch ?? '?', sha: (guard.sha ?? '').slice(0, 7), project: identifier })
        : t('items.agents.paused.guard', { branch: guard?.branch ?? '?', sha: (guard?.sha ?? '').slice(0, 7), bot: bot.name });
      if (project && can('project.manage', project.id)) {
        action = (
          <Link href={paths.projectSettings(project.identifier, 'agents')} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            {t('items.agents.paused.guard_confirm')}
          </Link>
        );
      }
    } else if (reason === 'github' && withBot) {
      title = t('items.agents.paused.github_title', { bot: bot.name });
      text = t('items.agents.paused.github', { pr, bot: bot.name });
      action = (
        <Button
          variant="secondary"
          size="sm"
          icon={Play}
          pending={resume.isPending}
          disabledReason={editReason ?? (agent?.repository ? null : t('items.agents.paused.github_no_repo', { project: identifier }))}
          onClick={runResume}
        >
          {t('items.agents.resume.button')}
        </Button>
      );
    } else if (reason === 'github') {
      // somebody else has the item: first back to the bot, then "Weitermachen" (assigning alone goes on with nothing)
      title = t('items.agents.paused.github_title', { bot: bot.name });
      text = t('items.agents.paused.github_reassigned', { assignee: users.get(item.assignee_id ?? '')?.name ?? t('items.agents.paused.someone'), bot: bot.name });
      action = (
        <Button variant="secondary" size="sm" icon={Bot} pending={givingBack} disabledReason={editReason} onClick={giveBack} data-give-back="">
          {t('items.agents.give_back.button', { bot: bot.name })}
        </Button>
      );
    } else {
      title =
        brake
          ? t('items.agents.paused.brake_title', { bot: bot.name, after: brake })
          : reason === 'no_change'
            ? t('items.agents.paused.no_change_title', { bot: bot.name })
            : reason === 'needs_person'
              ? t('items.agents.paused.needs_person_title', { bot: bot.name })
              : t('items.agents.paused.stopped_title', { bot: bot.name });
      text =
        reason === 'brake'
          ? t('items.agents.paused.brake', { pr, owner: owner?.name ?? t('items.agents.paused.owner'), bot: bot.name })
          : reason === 'no_change'
            ? t('items.agents.paused.no_change', { owner: owner?.name ?? t('items.agents.paused.owner'), bot: bot.name })
            : reason === 'needs_person'
              ? t('items.agents.paused.needs_person', { owner: owner?.name ?? t('items.agents.paused.owner'), bot: bot.name })
              : t('items.agents.paused.stopped', { assignee: users.get(item.assignee_id ?? '')?.name ?? t('items.agents.paused.someone'), pr, bot: bot.name });
      if (!withBot) {
        action = (
          <Button variant="secondary" size="sm" icon={Bot} pending={givingBack} disabledReason={editReason} onClick={giveBack} data-give-back="">
            {t('items.agents.give_back.button', { bot: bot.name })}
          </Button>
        );
      }
    }
    parts.push(
      <Banner key="paused" tone="neutral" icon={OctagonPause} title={title} action={action}>
        <span className="block max-w-[65ch]">{text}</span>
      </Banner>,
    );
  }

  if (last && canRetry(last, runs, item, thread)) {
    const failed = last.status !== 'canceled';
    const canceledBy = users.get(last.canceled_by ?? '')?.name ?? t('items.agents.run.somebody');
    parts.push(
      <Banner
        key="failed"
        tone={failed ? 'danger' : 'neutral'}
        icon={TriangleAlert}
        title={failed ? t('items.agents.failed.title', { run: runName(last.type) }) : t('items.agents.failed.canceled_title', { run: runName(last.type) })}
        action={
          <Button variant="secondary" size="sm" icon={RotateCw} pending={retrying} disabledReason={editReason} onClick={() => runRetry(last)}>
            {t('items.agents.retry.button')}
          </Button>
        }
      >
        <span className="block max-w-[65ch]">
          {last.error ?? (failed ? t('items.agents.failed.no_error') : t('items.agents.failed.canceled_by', { name: canceledBy }))} {failed && t('items.agents.failed.hint')}
        </span>
      </Banner>,
    );
  }

  // a strand paused by an unauthorized merge says it above; the same reason would only repeat it
  const assignee = users.get(item.assignee_id ?? '');
  const refusal = agent?.refusal ?? null;
  if (refusal && assignee && thread?.pause_reason !== 'guard') {
    parts.push(
      <Banner key="no-agent" tone="neutral" icon={UserRound} title={t('items.agents.refusal.title', { bot: assignee.name })}>
        <span className="block max-w-[65ch]">
          {t(REFUSAL_TEXT[refusal], { bot: assignee.name, project: identifier })} {t('items.agents.refusal.plain')} <RefusalFix refusal={refusal} botId={assignee.id} botName={assignee.name} project={project} />
        </span>
      </Banner>,
    );
  }

  if (agent?.ready_state && assignee) {
    parts.push(
      <Banner key="ready" tone="neutral" icon={Hourglass} title={t('items.agents.ready.title', { bot: assignee.name, state: agent.ready_state })}>
        <span className="block max-w-[65ch]">{t('items.agents.ready.text', { bot: assignee.name, state: agent.ready_state })}</span>
      </Banner>,
    );
  }

  if (agent?.blocked_by?.length && assignee) {
    const keys = agent.blocked_by.join(', ');
    parts.push(
      <Banner key="blocked-by" tone="neutral" icon={Hourglass} title={t('items.agents.blocked_by.title', { bot: assignee.name, keys })}>
        <span className="block max-w-[65ch]">{t('items.agents.blocked_by.text', { bot: assignee.name, keys })}</span>
      </Banner>,
    );
  }

  if (parts.length === 0) return null;
  return (
    <div data-agent-notice="" className="mt-3 flex flex-col gap-2">
      {parts}
    </div>
  );
}

const REFUSAL_TEXT = {
  agent_off: 'items.agents.refusal.agent_off',
  default_bot: 'items.agents.refusal.default_bot',
  disabled: 'items.agents.refusal.disabled',
  no_owner: 'items.agents.refusal.no_owner',
  archived: 'items.agents.refusal.archived',
  no_steps: 'items.agents.refusal.no_steps',
  not_member: 'items.agents.refusal.not_member',
} as const satisfies Record<AgentRefusal, string>;

/**
 * Where the reason is changed, for who may: the agent of the bot (org admins), the bots to reactivate one, the agents or
 * the members of the project. The default bot never is an agent: no way.
 */
function RefusalFix({ refusal, botId, botName, project }: { refusal: AgentRefusal; botId: string; botName: string; project: { id: string; identifier: string } | undefined }) {
  const { can } = usePermissions();
  if ((refusal === 'agent_off' || refusal === 'no_owner') && can('org.manage')) {
    return (
      <Link href={paths.botAgent(botId)} className={linkClass}>
        {t('items.agents.refusal.fix_bot', { bot: botName })}
      </Link>
    );
  }
  if (refusal === 'disabled' && can('org.manage')) {
    return (
      <Link href={paths.settings('bots')} className={linkClass}>
        {t('items.agents.refusal.fix_disabled')}
      </Link>
    );
  }
  if (project && (refusal === 'no_steps' || refusal === 'not_member') && can('project.manage', project.id)) {
    return (
      <Link href={paths.projectSettings(project.identifier, refusal === 'no_steps' ? 'agents' : 'members')} className={linkClass}>
        {refusal === 'no_steps' ? t('items.agents.refusal.fix_steps', { project: project.identifier }) : t('items.agents.refusal.fix_members', { project: project.identifier })}
      </Link>
    );
  }
  return null;
}
