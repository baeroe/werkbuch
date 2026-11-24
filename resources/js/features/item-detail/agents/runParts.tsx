/*
 * Building blocks of the runs at an item (WEBU-28, port of the clickdummy's runParts and RunLine rules): the status of
 * a run as a word with an icon, where its model came from, durations, the offset of a log line, why a run waits, and
 * which way back a run that ended badly offers ("Erneut starten" while the item is with the bot on an open strand,
 * otherwise assigning the item to the bot again).
 */

import type { LucideIcon } from 'lucide-react';
import { Ban, CircleCheck, CircleDot, CircleStop, CircleX, Clock, Hourglass, TimerOff, Unplug } from 'lucide-react';
import { statusLabel } from '@/features/settings/org/runners/runnerParts';
import { Badge } from '@/features/settings/frame/parts';
import { t } from '@/lib/i18n';
import type { AgentCli, AgentRun, ItemAgentState, Label, ListedItem, RunStatus } from '@/types';

type Look = { icon: LucideIcon; tone: 'neutral' | 'quiet' | 'accent' | 'danger' };

const LOOKS: Record<RunStatus, Look> = {
  queued: { icon: Clock, tone: 'quiet' },
  waiting: { icon: Hourglass, tone: 'quiet' },
  running: { icon: CircleDot, tone: 'accent' },
  canceling: { icon: CircleStop, tone: 'quiet' },
  succeeded: { icon: CircleCheck, tone: 'neutral' },
  failed: { icon: CircleX, tone: 'danger' },
  canceled: { icon: Ban, tone: 'quiet' },
  timed_out: { icon: TimerOff, tone: 'danger' },
  lost: { icon: Unplug, tone: 'quiet' },
};

/** "Läuft", "Gescheitert": the status of a run with its icon. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const look = LOOKS[status];
  return (
    <Badge tone={look.tone} icon={look.icon}>
      {statusLabel(status)}
    </Badge>
  );
}

/** A run that still has to happen or happens now. */
export const isActive = (run: Pick<AgentRun, 'status'>) => run.status === 'queued' || run.status === 'waiting' || run.status === 'running' || run.status === 'canceling';

/** On a runner: the clock of its duration ticks. */
export const isBusy = (run: Pick<AgentRun, 'status'>) => run.status === 'running' || run.status === 'canceling';

/** The names of the CLIs, the same in every language. */
export const CLI_NAMES: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Where the model of a run came from: "vom Label Opus Agent", "aus dem Projekt", "vom Bot", "Standard". */
export function modelOrigin(run: Pick<AgentRun, 'model_source' | 'model_label_id'>, labels: readonly Label[] | undefined): string {
  if (run.model_source === 'label') {
    const name = labels?.find((label) => label.id === run.model_label_id)?.name;
    return name ? t('items.agents.run.origin.label', { label: name }) : t('items.agents.run.origin.label_gone');
  }
  if (run.model_source === 'project') return t('items.agents.run.origin.project');
  if (run.model_source === 'bot') return t('items.agents.run.origin.bot');
  return t('items.agents.run.origin.default');
}

/** "42 s", "4 min 12 s", "1 h 3 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t('items.agents.duration.seconds', { s: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? t('items.agents.duration.minutes', { m: minutes }) : t('items.agents.duration.minutes_seconds', { m: minutes, s: seconds % 60 });
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? t('items.agents.duration.hours', { h: hours }) : t('items.agents.duration.hours_minutes', { h: hours, m: minutes % 60 });
}

/** How long a run took, or runs until `at`; null before it started. */
export function runDuration(run: Pick<AgentRun, 'started_at' | 'finished_at'>, at: number): number | null {
  if (!run.started_at) return null;
  return (run.finished_at ? Date.parse(run.finished_at) : at) - Date.parse(run.started_at);
}

/** "+4:12" or "+1:04:12" after the start of the run. */
export function offsetText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `+${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `+${minutes}:${rest}`;
}

/** Why a run waits, as a sentence; the runner of a strand that is offline names itself. */
export function waitingText(run: Pick<AgentRun, 'waiting_reason' | 'cli' | 'runner_name'>): string {
  switch (run.waiting_reason) {
    case 'no_cli':
      return t('items.agents.waiting.no_cli', { cli: CLI_NAMES[run.cli] });
    case 'runner_offline':
      return t('items.agents.waiting.runner_offline', { runner: run.runner_name ?? t('items.agents.waiting.its_runner') });
    case 'agent_off':
      return t('items.agents.waiting.agent_off');
    case 'merge_guard':
      return t('items.agents.waiting.merge_guard');
    case 'github_unavailable':
      return t('items.agents.waiting.github_unavailable');
    default:
      return t('items.agents.waiting.place');
  }
}

/** The ends of a run "Erneut starten" or a new assignment answers: failed, out of time, canceled, lost. */
const BAD_ENDS: readonly RunStatus[] = ['failed', 'timed_out', 'canceled', 'lost'];

type Thread = Pick<NonNullable<ItemAgentState['thread']>, 'status'> | null | undefined;

/** The newest run of the item ended badly and nothing else waits or runs there (runs oldest first). */
const endedBadly = (run: AgentRun, runs: readonly AgentRun[]) => BAD_ENDS.includes(run.status) && !runs.some(isActive) && runs.at(-1)?.id === run.id;

/** Whether the item is still with the run's bot on an open strand: only then may the run start again. */
const stillWithBot = (run: AgentRun, item: Pick<ListedItem, 'assignee_id'>, thread: Thread) => item.assignee_id === run.bot_id && thread?.status !== 'paused';

/** "Erneut starten" belongs to a run: it ended badly, nothing else runs, and the item is with the bot. */
export const canRetry = (run: AgentRun, runs: readonly AgentRun[], item: Pick<ListedItem, 'assignee_id'>, thread: Thread) => endedBadly(run, runs) && stillWithBot(run, item, thread);

/** The way back is a new assignment: the run ended badly, but somebody else has the item (or its strand pauses). */
export const needsGiveBack = (run: AgentRun, runs: readonly AgentRun[], item: Pick<ListedItem, 'assignee_id'>, thread: Thread) =>
  endedBadly(run, runs) && !stillWithBot(run, item, thread);
