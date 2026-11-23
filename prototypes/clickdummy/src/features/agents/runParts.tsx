/*
 * Building blocks of runs, shared by the runner list, the item detail and the bot settings (WEBU-18): the status of a
 * run as a word with an icon, where its model came from, durations, and a clock that ticks while something runs.
 */

import type { LucideIcon } from 'lucide-react';
import { Ban, CircleCheck, CircleDot, CircleStop, CircleX, Clock, Hourglass, TimerOff, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RUN_TYPE_NAMES } from '@/domain/agents';
import { Badge } from '@/features/settings/org/parts';
import { now } from '@/lib/clock';
import type { AgentRun, Label, RunStatus } from '@/types';

const STATUS: Record<RunStatus, { label: string; icon: LucideIcon; tone: 'neutral' | 'quiet' | 'accent' | 'danger' }> = {
  queued: { label: 'In der Warteschlange', icon: Clock, tone: 'quiet' },
  waiting: { label: 'Wartet auf Runner', icon: Hourglass, tone: 'quiet' },
  running: { label: 'Läuft', icon: CircleDot, tone: 'accent' },
  canceling: { label: 'Wird abgebrochen', icon: CircleStop, tone: 'quiet' },
  succeeded: { label: 'Erledigt', icon: CircleCheck, tone: 'neutral' },
  failed: { label: 'Gescheitert', icon: CircleX, tone: 'danger' },
  canceled: { label: 'Abgebrochen', icon: Ban, tone: 'quiet' },
  timed_out: { label: 'Zeitlimit erreicht', icon: TimerOff, tone: 'danger' },
  lost: { label: 'Verbindung verloren', icon: Unplug, tone: 'quiet' },
};

export const statusLabel = (status: RunStatus) => STATUS[status].label;

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const look = STATUS[status];
  return (
    <Badge tone={look.tone} icon={look.icon}>
      {look.label}
    </Badge>
  );
}

export const runName = (run: Pick<AgentRun, 'type'>) => RUN_TYPE_NAMES[run.type];

/** Where the model of a run came from: „vom Label Opus Agent“, „aus dem Projekt“, „vom Bot“. */
export function modelOrigin(run: Pick<AgentRun, 'model_source' | 'model_label_id'>, labels: readonly Label[] | undefined): string {
  if (run.model_source === 'label') return `vom Label ${labels?.find((label) => label.id === run.model_label_id)?.name ?? '(gelöscht)'}`;
  return run.model_source === 'project' ? 'aus dem Projekt' : 'vom Bot';
}

/** "42 s", "4 Min. 12 s", "1 Std. 3 Min.". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} Min.` : `${minutes} Min. ${seconds % 60} s`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)} Std.` : `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}

/** How long a run took, or runs until now. Null before it started. */
export function runDuration(run: Pick<AgentRun, 'started_at' | 'finished_at'>, at: Date): number | null {
  if (!run.started_at) return null;
  return (run.finished_at ? Date.parse(run.finished_at) : at.getTime()) - Date.parse(run.started_at);
}

/** The demo clock, drawn anew every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): Date {
  const [at, setAt] = useState(now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setAt(now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return active ? at : now();
}

const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

/** "09:41" in the organisation's zone (Berlin in the demo). */
export const clockTime = (iso: string, timeZone = 'Europe/Berlin') =>
  timeZone === 'Europe/Berlin' ? TIME.format(new Date(iso)) : new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
