/*
 * A run of an agent as a line of the activity (WEBU-28, port of the clickdummy, spec 10.6): kind, status, model and
 * where it came from, runner, duration, attempt, commit, verdict and tokens, the summary or why it failed or waits. The
 * log unfolds below the line (open at first while the run runs) and grows while the run runs. Whoever may change the
 * item cancels an active run (after a question: it stops the CLI) and starts one again that ended badly while the item
 * is with the bot on an open strand; otherwise the way back is to give the item to the bot again (spec 7.2): a
 * correction on the strand. A control that goes with the run's state (Abbrechen once it ended) hands its focus to the
 * card; a button that starts a run hands it to the new run's line.
 */

import { Bot, ChevronDown, CircleStop, GitCommitHorizontal, RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useEditReason, useUserMap } from '@/components/fields/itemData';
import { useLiveGone } from '@/lib/liveGone';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { Badge } from '@/features/settings/frame/parts';
import { clockTime, runName, useNow } from '@/features/settings/org/runners/runnerParts';
import { useLabels } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { useOrganization } from '@/hooks/organization';
import { useCancelRun } from '@/hooks/runners';
import { useRetryRun } from '@/hooks/runs';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import type { AgentRun, ItemAgentState, User, WorkItem } from '@/types';
import { Actor, When } from '../activity/EventLine';
import { RunLog } from './RunLog';
import { focusNewRun, QUEUED_WATCH_MS, runIds } from './runFocus';
import { canRetry, effortOrigin, formatDuration, isActive, isBusy, modelOrigin, needsGiveBack, runDuration, RunStatusBadge, waitingText } from './runParts';

type Thread = ItemAgentState['thread'] | undefined;

/**
 * Gives the item back to the bot: a correction on the strand starts, the brakes count from zero (spec 7.2). The focus
 * goes to the new run's line when the control that had it went away.
 */
export function useGiveBack(item: WorkItem, bot: User | undefined) {
  const update = useUpdateWorkItem();
  function giveBack() {
    if (!bot) return;
    const before = runIds();
    update.mutate(
      { id: item.id, patch: { assignee_id: bot.id } },
      {
        onSuccess: () => {
          toast({ title: t('items.agents.give_back.done', { key: item.key, bot: bot.name }), description: t('items.agents.give_back.done_description'), tone: 'success' });
          focusNewRun(before, QUEUED_WATCH_MS);
        },
      },
    );
  }
  return { giveBack, pending: update.isPending };
}

/** Starts a run again; the toast names it, and the focus goes to the new run's line when the button went away. */
export function useRetry(item: WorkItem) {
  const settle = useSettle();
  const retry = useRetryRun();
  function runRetry(run: AgentRun) {
    const before = runIds();
    settle(retry.mutateAsync(run.id), {
      onSuccess: () => {
        toast({ title: t('items.agents.retry.done', { key: item.key, run: runName(run.type) }), description: t('items.agents.retry.done_description'), tone: 'success' });
        focusNewRun(before);
      },
      onError: (error) => notifyError(t('items.agents.retry.failed'), error, () => runRetry(run)),
    });
  }
  return { runRetry, pending: retry.isPending };
}

/** A fact of the run in the list of facts under its header. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

export function RunLine({ run, runs, item, thread }: { run: AgentRun; runs: readonly AgentRun[]; item: WorkItem; thread: Thread }) {
  const users = useUserMap();
  const labels = useLabels().data?.items;
  const zone = useOrganization().data.timezone;
  const settle = useSettle();
  const cancel = useCancelRun();
  const { runRetry, pending: retrying } = useRetry(item);
  const editReason = useEditReason(item);
  const [open, setOpen] = useState(run.status === 'running');
  const [asking, setAsking] = useState(false);
  const logId = useId();
  const card = useRef<HTMLElement>(null);
  const focusInside = useRef(false);
  const bot = users.get(run.bot_id);
  const { giveBack, pending: givingBack } = useGiveBack(item, bot);
  const active = isActive(run);
  const at = useNow(isBusy(run));
  const duration = runDuration(run, at);
  const retryable = canRetry(run, runs, item, thread);
  // the way back is a new assignment; a strand paused with the item still at the bot says its own way (AgentNotice)
  const backWay = needsGiveBack(run, runs, item, thread) && item.assignee_id !== run.bot_id;
  const numbers = new Intl.NumberFormat(intlLocale());
  const name = runName(run.type);
  // the item or its project was deleted: the log would answer 404
  const gone = useLiveGone(item.id, item.project_id);

  // a click elsewhere puts the person somewhere else: the card does not pull the focus back later
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !card.current?.contains(event.target)) focusInside.current = false;
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, []);

  // a run that starts unfolds its log: what it does now is what the line is about
  const status = useRef(run.status);
  useEffect(() => {
    if (run.status === 'running' && status.current !== 'running') setOpen(true);
    status.current = run.status;
  }, [run.status]);

  // a control in the card that goes with the run's state takes the focus along: it goes to the card itself
  useEffect(() => {
    if (!focusInside.current) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) card.current?.focus();
  }, [run.status]);

  function runCancel() {
    settle(cancel.mutateAsync(run.id), {
      onSuccess: () => {
        setAsking(false);
        toast({ title: t('items.agents.cancel.done', { key: item.key }), description: t('items.agents.cancel.done_description'), tone: 'success' });
      },
      onError: (error) => notifyError(t('items.agents.cancel.failed'), error, runCancel),
    });
  }

  return (
    <li className="relative flex gap-2.5">
      {bot ? <Avatar user={bot} size="sm" decorative /> : <span className="size-5 shrink-0 rounded-full bg-line" aria-hidden="true" />}
      <article
        ref={card}
        id={`run-${run.id}`}
        tabIndex={-1}
        data-run-line=""
        aria-label={t('items.agents.run.label', { run: name, bot: bot?.name ?? t('items.agents.run.some_bot') })}
        onFocus={() => (focusInside.current = true)}
        onBlur={(event) => {
          // a control that is removed leaves without a new target: the focus counts as still here
          const next = event.relatedTarget;
          if (next instanceof Node && next.isConnected && !card.current?.contains(next)) focusInside.current = false;
        }}
        className="min-w-0 flex-1 scroll-mt-24 rounded-ctl border border-line bg-surface p-3 shadow-elev-1"
      >
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui">
          <span className="min-w-0">
            <Actor user={bot} />
          </span>
          <span className="text-muted">{t('items.agents.run.word')}</span>
          <span className="font-semibold text-ink">{name}</span>
          <RunStatusBadge status={run.status} />
          {run.created_at && (
            <span className="ml-auto">
              <When iso={run.created_at} />
            </span>
          )}
        </header>

        <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1">
          <dl className="flex min-w-0 flex-1 basis-full flex-wrap gap-x-5 gap-y-1 pt-1 text-sm sm:basis-0">
            <Fact term={t('items.agents.run.model')}>
              <span className="font-medium" translate="no">
                {run.model}
              </span>{' '}
              <span className="text-muted">{modelOrigin(run, labels)}</span>
            </Fact>
            {run.effort && (
              <Fact term={t('items.agents.run.effort')}>
                <span className="font-medium" translate="no">
                  {run.effort}
                </span>{' '}
                <span className="text-muted">{effortOrigin(run)}</span>
              </Fact>
            )}
            {run.runner_name && (
              <Fact term={t('items.agents.run.runner')}>
                <span translate="no">{run.runner_name}</span>
                {!run.runner_online && (
                  <span className="text-muted">
                    {run.runner_last_seen_at ? ` ${t('items.agents.run.offline_since', { time: clockTime(run.runner_last_seen_at, zone) })}` : ` ${t('items.agents.run.offline')}`}
                  </span>
                )}
              </Fact>
            )}
            {duration !== null && (
              <Fact term={t('items.agents.run.duration')}>
                <span className="tabular-nums">{formatDuration(duration)}</span>
              </Fact>
            )}
            {(run.attempt ?? 1) > 1 && (
              <Fact term={t('items.agents.run.attempt')}>
                <span className="tabular-nums">{run.attempt}</span>
              </Fact>
            )}
            {run.result?.commit && (
              <Fact term={t('items.agents.run.commit')}>
                <span className="inline-flex items-center gap-1">
                  <GitCommitHorizontal className="size-3.5 text-muted" aria-hidden="true" />
                  <span className="tabular-nums" translate="no">
                    {run.result.commit.slice(0, 7)}
                  </span>
                </span>
              </Fact>
            )}
            {run.result?.verdict && (
              <Fact term={t('items.agents.run.verdict')}>
                {run.result.verdict === 'approve' ? <Badge>{t('items.agents.run.verdict_approve')}</Badge> : <Badge tone="danger">{t('items.agents.run.verdict_changes')}</Badge>}
              </Fact>
            )}
            {typeof run.usage?.input === 'number' && typeof run.usage.output === 'number' && (
              <Fact term={t('items.agents.run.tokens')}>
                <span className="tabular-nums">{t('items.agents.run.tokens_value', { input: numbers.format(run.usage.input), output: numbers.format(run.usage.output) })}</span>
              </Fact>
            )}
          </dl>
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={open ? logId : undefined} onClick={() => setOpen((current) => !current)} className="-my-0.5 -mr-1.5">
            <ChevronDown className={cx('size-4 text-muted transition-transform duration-160', open && 'rotate-180')} aria-hidden="true" />
            {open ? t('items.agents.log.hide') : t('items.agents.log.show')}
          </Button>
        </div>

        {run.status === 'waiting' && <p className="mt-2 max-w-[65ch] text-sm text-pretty text-muted">{waitingText(run)}</p>}
        {run.status === 'queued' && <p className="mt-2 max-w-[65ch] text-sm text-pretty text-muted">{t('items.agents.waiting.place')}</p>}
        {typeof run.result?.summary === 'string' && run.result.summary !== '' && <p className="mt-2 max-w-[65ch] text-ui text-pretty whitespace-pre-line text-ink">{run.result.summary}</p>}
        {run.error && (
          <p className={cx('mt-2 flex max-w-[65ch] items-start gap-1.5 text-ui text-pretty', run.status === 'canceled' || run.status === 'lost' ? 'text-muted' : 'text-danger')}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {run.error}
          </p>
        )}
        {run.status === 'canceled' && run.canceled_by && (
          <p className="mt-2 text-sm text-muted">
            {run.finished_at
              ? t('items.agents.run.canceled_by_at', { name: users.get(run.canceled_by)?.name ?? t('items.agents.run.somebody'), time: clockTime(run.finished_at, zone) })
              : t('items.agents.run.canceled_by', { name: users.get(run.canceled_by)?.name ?? t('items.agents.run.somebody') })}
          </p>
        )}
        {backWay && bot && <p className="mt-2 max-w-[65ch] text-sm text-pretty text-muted">{t('items.agents.run.not_with_bot', { key: item.key, bot: bot.name })}</p>}

        {(active || retryable || (backWay && bot)) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {active && (
              <Button
                variant="secondary"
                size="sm"
                icon={CircleStop}
                pending={cancel.isPending}
                disabledReason={run.status === 'canceling' ? t('settings.runners.runs.canceling_reason') : editReason}
                onClick={() => setAsking(true)}
              >
                {t('settings.runners.runs.cancel')}
              </Button>
            )}
            {retryable && (
              <Button variant="secondary" size="sm" icon={RotateCw} pending={retrying} disabledReason={editReason} onClick={() => runRetry(run)}>
                {t('items.agents.retry.button')}
              </Button>
            )}
            {backWay && bot && (
              <Button variant="secondary" size="sm" icon={Bot} pending={givingBack} disabledReason={editReason} onClick={giveBack}>
                {t('items.agents.give_back.button', { bot: bot.name })}
              </Button>
            )}
          </div>
        )}
        {open && <RunLog run={run} id={logId} enabled={!gone} />}
      </article>
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('items.agents.cancel.title', { run: name })}
        description={isBusy(run) ? t('items.agents.cancel.running') : t('items.agents.cancel.waiting')}
        confirmLabel={t('items.agents.cancel.confirm')}
        cancelLabel={t('items.agents.cancel.keep')}
        pending={cancel.isPending}
        onConfirm={runCancel}
      />
    </li>
  );
}
