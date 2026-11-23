/*
 * What an agent does at an item, under its title (WEBU-18, spec 10.5): the chip "Kira arbeitet" while a run is active
 * (a click shows the run in the activity), and a notice for the states that need a person:
 * - the brake: the strand is paused, the item is back with the responsible person; "Wieder Kira zuweisen" starts a
 *   correction with the comments since the last run, and the brake counts from zero;
 * - the last run failed or ran out of time, or was canceled: why, and "Erneut starten";
 * - a correction waits for the runner of its strand, which is offline;
 * - the assignee is a bot that does not work as an agent here: why, and where to change it.
 */

import { Bot, CircleDot, Hourglass, OctagonPause, RotateCw, TriangleAlert, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { useEditReason, useUserMap } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { isActive } from '@/domain/agents';
import { clockTime, runName } from '@/features/agents/runParts';
import { useItemAgents, useProjectAgents, useRetryRun } from '@/hooks/agents';
import { useProjects } from '@/hooks/projects';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import type { AgentRun, WorkItem } from '@/types';
import { canRetry } from './RunLine';

/** Shows a run in the activity: scrolls it into view and puts the focus on it. */
export function showRun(id: string): void {
  const target = document.getElementById(`run-${id}`);
  target?.scrollIntoView({ block: 'center' });
  target?.focus();
}

const TAKEOVER_MIN = 30;

export function AgentNotice({ item }: { item: WorkItem }) {
  const agents = useItemAgents(item.id);
  const settings = useProjectAgents(item.project_id);
  const users = useUserMap();
  const project = useProjects({ include_archived: true }).data?.items.find((entry) => entry.id === item.project_id);
  const editReason = useEditReason(item);
  const { can } = usePermissions();
  const settle = useSettle();
  const retry = useRetryRun();
  const update = useUpdateWorkItem();
  if (!agents.data) return null;
  const { runs, thread, not_an_agent } = agents.data;
  const active = runs.find(isActive);
  const last: AgentRun | undefined = runs.at(-1);
  const bot = users.get(thread?.bot_id ?? last?.bot_id ?? '');
  const assignee = users.get(item.assignee_id ?? '');

  function runRetry(run: AgentRun) {
    settle(retry.mutateAsync(run.id), {
      onSuccess: () => toast({ title: `${item.key}: ${runName(run)} neu eingereiht`, tone: 'success' }),
      onError: (error) => notifyError('Auftrag nicht neu gestartet', error, () => runRetry(run)),
    });
  }

  function giveBack() {
    if (!bot) return;
    const name = bot.name;
    update.mutate(
      { id: item.id, patch: { assignee_id: bot.id } },
      { onSuccess: () => toast({ title: `${item.key} ist wieder bei ${name}`, description: 'Eine Korrektur mit den Kommentaren seit dem letzten Auftrag ist eingereiht. Die Bremse zählt von vorn.', tone: 'success' }) },
    );
  }

  const parts = [];

  if (active && (active.status === 'running' || active.status === 'canceling' || active.status === 'queued')) {
    parts.push(
      <button
        key="chip"
        type="button"
        onClick={() => showRun(active.id)}
        className="inline-flex h-11 max-w-full cursor-pointer items-center gap-1.5 self-start rounded-chip border border-transparent bg-accent-soft px-2 text-sm font-medium text-accent-text transition-colors duration-120 hover:border-accent md:h-7"
      >
        {active.status === 'queued' ? <Hourglass className="size-3.5 shrink-0" aria-hidden="true" /> : <CircleDot className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">
          {active.status === 'running'
            ? `${bot?.name ?? 'Agent'} arbeitet: ${runName(active)}`
            : active.status === 'canceling'
              ? `${bot?.name ?? 'Agent'} hört auf: ${runName(active)} wird abgebrochen`
              : `${runName(active)} wartet auf einen Runner`}
        </span>
        {active.started_at && <span className="shrink-0 font-normal tabular-nums">seit {clockTime(active.started_at)}</span>}
      </button>,
    );
  }

  if (active?.status === 'waiting' && active.runner_name) {
    const since = active.runner_last_seen_at;
    const takeover = since ? clockTime(new Date(Date.parse(since) + TAKEOVER_MIN * 60_000).toISOString()) : null;
    parts.push(
      <Banner key="waiting" tone="info" icon={Hourglass} role="status" title={`${runName(active)} wartet auf ${active.runner_name}`} action={<Button variant="ghost" size="sm" onClick={() => showRun(active.id)}>Auftrag zeigen</Button>}>
        <span className="block max-w-[65ch]">
          {`${active.runner_name} ist${since ? ` seit ${clockTime(since)}` : ''} offline. Dort liegen Worktree und Session des Strangs.${takeover ? ` Ab ${takeover} übernimmt ein anderer Runner des Pools mit frischer Session auf dem Branch, sobald einer frei ist.` : ''}`}
        </span>
      </Banner>,
    );
  }

  if (!active && thread?.status === 'paused' && bot) {
    const owner = users.get(bot.owner_id ?? '');
    const limit = settings.data?.max_corrections ?? 3;
    const braked = thread.corrections >= limit;
    parts.push(
      <Banner
        key="paused"
        tone="neutral"
        icon={OctagonPause}
        role="status"
        title={braked ? `Bremse gezogen: ${bot.name} hat nach ${thread.corrections} Korrekturen aufgehört` : `${bot.name} arbeitet nicht mehr daran`}
        action={
          <Button variant="secondary" size="sm" icon={Bot} pending={update.isPending} disabledReason={editReason} onClick={giveBack}>
            Wieder {bot.name} zuweisen
          </Button>
        }
      >
        <span className="block max-w-[65ch]">
          {braked
            ? `Der Strang ist pausiert: PR${thread.pr_number ? ` #${thread.pr_number}` : ''}, Branch und Session bleiben. Das Item ging an ${owner?.name ?? 'die verantwortliche Person'}, die Befunde stehen im letzten Kommentar. Weist du es wieder ${bot.name} zu, beginnt eine Korrektur mit den Kommentaren seit dem letzten Auftrag, und die Bremse zählt von vorn.`
            : `Das Item wurde ${assignee?.name ?? 'jemand anderem'} zugewiesen; der Strang ist pausiert, der PR bleibt. Weist du es wieder ${bot.name} zu, macht ${bot.name} mit einer Korrektur weiter.`}
        </span>
      </Banner>,
    );
  }

  if (last && canRetry(last, runs) && thread?.status !== 'paused') {
    const failed = last.status !== 'canceled';
    parts.push(
      <Banner
        key="failed"
        tone={failed ? 'danger' : 'neutral'}
        icon={TriangleAlert}
        role="status"
        title={failed ? `Auftrag gescheitert: ${runName(last)}` : `Auftrag abgebrochen: ${runName(last)}`}
        action={
          <Button variant="secondary" size="sm" icon={RotateCw} pending={retry.isPending} disabledReason={editReason} onClick={() => runRetry(last)}>
            Erneut starten
          </Button>
        }
      >
        <span className="block max-w-[65ch]">
          {last.error ?? (failed ? 'Der Runner hat einen Fehler gemeldet.' : `Abgebrochen von ${users.get(last.canceled_by ?? '')?.name ?? 'jemandem'}.`)} {failed && 'Das Ticket steht auf „Korrektur“. Erneut starten macht im selben Strang weiter; die Bremse zählt weiter.'}
        </span>
      </Banner>,
    );
  }

  if (not_an_agent && assignee) {
    const fix =
      project && not_an_agent.includes('nicht eingerichtet') ? (
        can('project.manage', project.id) ? (
          <Link to={`/projects/${project.identifier}/settings/agents`} className="font-medium text-accent-text underline-offset-2 hover:underline">
            Agenten von {project.identifier} einrichten
          </Link>
        ) : null
      ) : can('org.manage') ? (
        <Link to={`/settings/bots?agent=${assignee.id}`} className="font-medium text-accent-text underline-offset-2 hover:underline">
          {assignee.name} als Agent einrichten
        </Link>
      ) : null;
    parts.push(
      <Banner key="no-agent" tone="neutral" icon={UserRound} role="status" title={`${assignee.name} arbeitet hier nicht als Agent`}>
        <span className="block max-w-[65ch]">
          {not_an_agent} Die Zuweisung bleibt eine normale Zuweisung: kein Auftrag, kein PR. {fix}
        </span>
      </Banner>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="mt-3 flex flex-col gap-2">{parts}</div>;
}
