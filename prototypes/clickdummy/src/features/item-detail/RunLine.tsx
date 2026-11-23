/*
 * A run of an agent as a line of the activity (WEBU-18, spec 10.5): kind, status, model and where it came from,
 * runner, duration, the result or why it failed. The log of the CLI unfolds below the line and grows while the run
 * runs. Whoever may change the item cancels a run that is active (after a question: it stops the CLI) and starts one
 * again that failed, ran out of time or was canceled.
 */

import { ChevronDown, CircleStop, GitCommitHorizontal, RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { isActive } from '@/domain/agents';
import { useEditReason, useUserMap } from '@/components/fields/itemData';
import { Avatar } from '@/components/ui/Avatar';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { clockTime, formatDuration, modelOrigin, RunStatusBadge, runDuration, runName, useNow } from '@/features/agents/runParts';
import { Badge } from '@/features/settings/org/parts';
import { useCancelRun, useRetryRun } from '@/hooks/agents';
import { useLabels } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import type { AgentRun, RunLogLine, WorkItem } from '@/types';
import { Actor, When } from './Activity';

const FAILED: readonly AgentRun['status'][] = ['failed', 'timed_out', 'canceled'];

/** Whether "Erneut starten" belongs to a run: it ended badly and nothing else runs at the item. */
export const canRetry = (run: AgentRun, runs: readonly AgentRun[]) => FAILED.includes(run.status) && !runs.some(isActive) && runs.at(-1)?.id === run.id;

const KIND_LABEL: Record<RunLogLine['kind'], string> = { system: 'Runner', text: 'Agent', tool: 'Werkzeug', result: 'Ergebnis', error: 'Fehler' };

/** "+4:12" after the start. */
function offsetText(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `+${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `+${minutes}:${rest}`;
}

function RunLog({ run, id }: { run: AgentRun; id: string }) {
  const list = useRef<HTMLOListElement>(null);
  const live = run.status === 'running' || run.status === 'canceling';
  // new lines scroll into view while somebody is at the bottom
  useEffect(() => {
    const box = list.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
  }, [run.log.length]);
  return (
    <div id={id} className="mt-2 rounded-ctl border border-line bg-sunken">
      {run.log.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">{run.started_at ? 'Noch keine Zeile.' : 'Das Protokoll beginnt, sobald ein Runner den Auftrag abholt.'}</p>
      ) : (
        <ol ref={list} role="log" aria-live={live ? 'polite' : 'off'} aria-label={`Protokoll: ${runName(run)}`} className="max-h-72 overflow-y-auto px-3 py-2 text-sm">
          {run.log.map((line, index) => (
            <li key={index} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 py-0.5">
              <span className="text-faint tabular-nums">{offsetText(line.offset)}</span>
              <span className={cx('min-w-0 break-words', line.kind === 'error' ? 'font-medium text-danger' : line.kind === 'text' ? 'text-ink' : line.kind === 'result' ? 'font-medium text-ink' : 'text-muted')}>
                <span className="sr-only">{`${KIND_LABEL[line.kind]}: `}</span>
                {line.kind === 'tool' ? <span translate="no">{line.text}</span> : line.text}
              </span>
            </li>
          ))}
          {live && (
            <li className="py-0.5 pl-[3.75rem] text-faint" aria-hidden="true">
              …
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

export function RunLine({ run, runs, item }: { run: AgentRun; runs: readonly AgentRun[]; item: WorkItem }) {
  const users = useUserMap();
  const labels = useLabels().data?.items;
  const settle = useSettle();
  const cancel = useCancelRun();
  const retry = useRetryRun();
  const editReason = useEditReason(item);
  const [open, setOpen] = useState(run.status === 'running');
  const [asking, setAsking] = useState(false);
  const logId = useId();
  const bot = users.get(run.bot_id);
  const active = isActive(run);
  const at = useNow(run.status === 'running' || run.status === 'canceling');
  const duration = runDuration(run, at);

  function runCancel() {
    settle(cancel.mutateAsync(run.id), {
      onSuccess: () => {
        setAsking(false);
        toast({ title: `${item.key}: Auftrag wird abgebrochen`, description: 'Der Runner beendet das CLI. Was nicht gepusht ist, bleibt im Worktree.', tone: 'success' });
      },
      onError: (error) => notifyError('Auftrag nicht abgebrochen', error, runCancel),
    });
  }

  function runRetry() {
    settle(retry.mutateAsync(run.id), {
      onSuccess: () => toast({ title: `${item.key}: ${runName(run)} neu eingereiht`, description: 'Die Bremse zählt weiter wie bisher.', tone: 'success' }),
      onError: (error) => notifyError('Auftrag nicht neu gestartet', error, runRetry),
    });
  }

  return (
    <li className="relative flex gap-2.5">
      {bot ? <Avatar user={bot} size="sm" decorative /> : <span className="size-5 shrink-0 rounded-full bg-line" aria-hidden="true" />}
      <article id={`run-${run.id}`} tabIndex={-1} aria-label={`Auftrag „${runName(run)}“ von ${bot?.name ?? 'einem Bot'}`} className="min-w-0 flex-1 scroll-mt-24 rounded-ctl border border-line bg-surface p-3 shadow-elev-1">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui">
          <span className="min-w-0">
            <Actor user={bot} />
          </span>
          <span className="text-muted">Auftrag</span>
          <span className="font-semibold text-ink">{runName(run)}</span>
          <RunStatusBadge status={run.status} />
          <span className="ml-auto">
            <When iso={run.created_at} />
          </span>
        </header>

        <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1">
        <dl className="flex min-w-0 flex-1 basis-full flex-wrap gap-x-5 gap-y-1 pt-1 text-sm sm:basis-0">
          <div className="flex gap-1.5">
            <dt className="text-muted">Modell</dt>
            <dd className="text-ink">
              <span className="font-medium" translate="no">
                {run.model}
              </span>{' '}
              <span className="text-muted">{modelOrigin(run, labels)}</span>
            </dd>
          </div>
          {run.runner_name && (
            <div className="flex gap-1.5">
              <dt className="text-muted">Runner</dt>
              <dd className="text-ink">
                <span translate="no">{run.runner_name}</span>
                {!run.runner_online && <span className="text-muted">{run.runner_last_seen_at ? ` (offline seit ${clockTime(run.runner_last_seen_at)})` : ' (offline)'}</span>}
              </dd>
            </div>
          )}
          {duration !== null && (
            <div className="flex gap-1.5">
              <dt className="text-muted">Dauer</dt>
              <dd className="text-ink tabular-nums">{formatDuration(duration)}</dd>
            </div>
          )}
          {run.attempt > 1 && (
            <div className="flex gap-1.5">
              <dt className="text-muted">Versuch</dt>
              <dd className="text-ink tabular-nums">{run.attempt}</dd>
            </div>
          )}
          {run.result?.commit && (
            <div className="flex items-center gap-1.5">
              <dt className="text-muted">Commit</dt>
              <dd className="inline-flex items-center gap-1 text-ink">
                <GitCommitHorizontal className="size-3.5 text-muted" aria-hidden="true" />
                <span className="tabular-nums" translate="no">
                  {run.result.commit}
                </span>
              </dd>
            </div>
          )}
          {run.result?.verdict && (
            <div className="flex gap-1.5">
              <dt className="text-muted">Urteil</dt>
              <dd>{run.result.verdict === 'approve' ? <Badge>Freigegeben</Badge> : <Badge tone="danger">Änderungen nötig</Badge>}</dd>
            </div>
          )}
          {run.usage && (
            <div className="flex gap-1.5">
              <dt className="text-muted">Tokens</dt>
              <dd className="text-ink tabular-nums">{`${new Intl.NumberFormat('de-DE').format(run.usage.input)} ein, ${new Intl.NumberFormat('de-DE').format(run.usage.output)} aus`}</dd>
            </div>
          )}
        </dl>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={open ? logId : undefined} onClick={() => setOpen((current) => !current)} className="-my-0.5 -mr-1.5">
          <ChevronDown className={cx('size-4 text-muted transition-transform duration-160', open && 'rotate-180')} aria-hidden="true" />
          {open ? 'Protokoll ausblenden' : `Protokoll${run.log.length > 0 ? ` (${run.log.length})` : ''}`}
        </Button>
        </div>

        {run.status === 'waiting' && run.runner_name && (
          <p className="mt-2 text-sm text-pretty text-muted">{`Wartet auf ${run.runner_name}: Korrekturen laufen auf dem Runner ihres Strangs, dort liegen Worktree und Session.`}</p>
        )}
        {run.status === 'queued' && <p className="mt-2 text-sm text-pretty text-muted">Wartet auf einen freien Platz auf einem Runner des Pools.</p>}
        {run.result?.summary && <p className="mt-2 max-w-[65ch] text-ui text-pretty text-ink">{run.result.summary}</p>}
        {run.error && (
          <p className={cx('mt-2 flex max-w-[65ch] items-start gap-1.5 text-ui text-pretty', run.status === 'canceled' || run.status === 'lost' ? 'text-muted' : 'text-danger')}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {run.error}
          </p>
        )}
        {run.status === 'canceled' && run.canceled_by && <p className="mt-2 text-sm text-muted">{`Abgebrochen von ${users.get(run.canceled_by)?.name ?? 'jemandem'}${run.finished_at ? ` um ${clockTime(run.finished_at)}` : ''}.`}</p>}

        {(active || canRetry(run, runs)) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {active && (
              <Button variant="secondary" size="sm" icon={CircleStop} pending={cancel.isPending} disabledReason={run.status === 'canceling' ? 'Wird schon abgebrochen.' : editReason} onClick={() => setAsking(true)}>
                Abbrechen
              </Button>
            )}
            {canRetry(run, runs) && (
              <Button variant="secondary" size="sm" icon={RotateCw} pending={retry.isPending} disabledReason={editReason} onClick={runRetry}>
                Erneut starten
              </Button>
            )}
          </div>
        )}
        {open && <RunLog run={run} id={logId} />}
      </article>
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title={`Auftrag „${runName(run)}“ abbrechen?`}
        description={
          run.status === 'running'
            ? 'Der Runner beendet das CLI. Was der Agent noch nicht gepusht hat, bleibt im Worktree; „Erneut starten“ macht dort weiter.'
            : 'Der Auftrag kommt aus der Warteschlange. „Erneut starten“ reiht ihn wieder ein.'
        }
        confirmLabel="Auftrag abbrechen"
        cancelLabel="Weiterlaufen lassen"
        pending={cancel.isPending}
        onConfirm={runCancel}
      />
    </li>
  );
}
