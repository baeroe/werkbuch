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
import { isActive } from '@/domain/agents';
import { clockTime, runName, useNow } from '@/features/agents/runParts';
import { useItemAgents, useProjectAgents } from '@/hooks/agents';
import { useProjects } from '@/hooks/projects';
import { usePermissions } from '@/lib/permissions';
import type { AgentRun, WorkItem } from '@/types';
import { canRetry, useGiveBack, useRetry } from './RunLine';
import { showRun } from './runFocus';

/** After this long offline, another runner of the pool would take the strand over (spec 9, default 30 minutes). */
const TAKEOVER_MIN = 30;

export function AgentNotice({ item }: { item: WorkItem }) {
  const agents = useItemAgents(item.id);
  const settings = useProjectAgents(item.project_id);
  const users = useUserMap();
  const project = useProjects({ include_archived: true }).data?.items.find((entry) => entry.id === item.project_id);
  const editReason = useEditReason(item);
  const { can } = usePermissions();
  const runs = agents.data?.runs ?? [];
  const thread = agents.data?.thread ?? null;
  const last: AgentRun | undefined = runs.at(-1);
  const bot = users.get(thread?.bot_id ?? last?.bot_id ?? '');
  const { runRetry, pending: retrying } = useRetry(item);
  const { giveBack, pending: givingBack } = useGiveBack(item, bot);
  const active = runs.find(isActive);
  // the clock moves on while a run waits for its runner: past the deadline the notice says what would have happened
  const at = useNow(active?.status === 'waiting');
  if (!agents.data) return null;
  const { not_an_agent } = agents.data;
  const assignee = users.get(item.assignee_id ?? '');

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
    const deadline = since ? Date.parse(since) + TAKEOVER_MIN * 60_000 : null;
    const takeover = deadline ? clockTime(new Date(deadline).toISOString()) : null;
    // the demo does not move a strand to another runner: past the deadline it only says what the real one would do
    const passed = deadline !== null && at.getTime() >= deadline;
    parts.push(
      <Banner key="waiting" tone="info" icon={Hourglass} title={`${runName(active)} wartet auf ${active.runner_name}`} action={<Button variant="ghost" size="sm" onClick={() => showRun(active.id)}>Auftrag zeigen</Button>}>
        <span className="block max-w-[65ch]">
          {`${active.runner_name} ist${since ? ` seit ${clockTime(since)}` : ''} offline. Dort liegen Worktree und Session des Strangs.`}
          {takeover &&
            (passed
              ? ` Seit ${takeover} hätte ein anderer Runner des Pools mit frischer Session auf dem Branch übernommen; der Klickdummy spielt den Umzug nicht.`
              : ` Ab ${takeover} übernimmt ein anderer Runner des Pools mit frischer Session auf dem Branch, sobald einer frei ist.`)}
        </span>
      </Banner>,
    );
  }

  if (!active && thread?.status === 'paused' && bot) {
    const owner = users.get(bot.owner_id ?? '');
    const github = thread.pause_reason === 'github';
    // which brake stopped the strand: corrections and conflicts are counted apart (spec 7.2)
    const brake = github
      ? null
      : thread.corrections >= (settings.data?.max_corrections ?? 3)
        ? `nach ${thread.corrections} Korrekturen`
        : thread.conflicts >= (settings.data?.max_conflicts ?? 2)
          ? `nach ${thread.conflicts} Konflikten mit der Basis`
          : null;
    // with the item still at the bot, assigning it again changes nothing: the way back is a new assignment
    const withBot = item.assignee_id === bot.id;
    parts.push(
      <Banner
        key="paused"
        tone="neutral"
        icon={OctagonPause}
        title={github ? `${bot.name} hat aufgehört: GitHub ist getrennt` : brake ? `Bremse gezogen: ${bot.name} hat ${brake} aufgehört` : `${bot.name} arbeitet nicht mehr daran`}
        action={
          withBot ? undefined : (
            <Button variant="secondary" size="sm" icon={Bot} pending={givingBack} disabledReason={editReason} onClick={giveBack}>
              Wieder {bot.name} zuweisen
            </Button>
          )
        }
      >
        <span className="block max-w-[65ch]">
          {github
            ? `Der Strang ist pausiert; PR${thread.pr_number ? ` #${thread.pr_number}` : ''} und Branch bleiben bei GitHub. Sobald GitHub wieder verbunden ist und das Projekt sein Repo hat, geht es weiter, wenn das Item ${bot.name} neu zugewiesen wird.`
            : brake
              ? `Der Strang ist pausiert: PR${thread.pr_number ? ` #${thread.pr_number}` : ''}, Branch und Session bleiben. Das Item ging an ${owner?.name ?? 'die verantwortliche Person'}, die Befunde stehen im letzten Kommentar. Weist du es wieder ${bot.name} zu, beginnt eine Korrektur mit den Kommentaren seit dem letzten Auftrag, und die Bremse zählt von vorn.`
              : `Das Item wurde ${assignee?.name ?? 'jemand anderem'} zugewiesen; der Strang ist pausiert${thread.pr_number ? `, PR #${thread.pr_number} bleibt` : ', Branch und Worktree bleiben'}. Weist du es wieder ${bot.name} zu, macht ${bot.name} mit einer Korrektur weiter.`}
        </span>
      </Banner>,
    );
  }

  if (last && canRetry(last, runs, item, thread)) {
    const failed = last.status !== 'canceled';
    parts.push(
      <Banner
        key="failed"
        tone={failed ? 'danger' : 'neutral'}
        icon={TriangleAlert}
        title={failed ? `Auftrag gescheitert: ${runName(last)}` : `Auftrag abgebrochen: ${runName(last)}`}
        action={
          <Button variant="secondary" size="sm" icon={RotateCw} pending={retrying} disabledReason={editReason} onClick={() => runRetry(last)}>
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
      <Banner key="no-agent" tone="neutral" icon={UserRound} title={`${assignee.name} arbeitet hier nicht als Agent`}>
        <span className="block max-w-[65ch]">
          {not_an_agent} Die Zuweisung bleibt eine normale Zuweisung: kein Auftrag, kein PR. {fix}
        </span>
      </Banner>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="mt-3 flex flex-col gap-2">{parts}</div>;
}
