/*
 * The log of a run (WEBU-28, spec 6.4, 10.6): the lines the runner read from the CLI, each with its time after the
 * start ("+4:12") and its kind for screen readers (runner, agent, tool, result, error). While the run runs the list
 * grows by the lines `agent_run.log` announces; new lines scroll into view while the reader is at the bottom. The log
 * itself is no live region (a screen reader would read every line); a status says "3 new lines" at most every
 * `ANNOUNCE_MS`. Lines past the limits of a run (2 000 lines, 1 MB) went, the oldest first: a note says how many.
 */

import { RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useRunLog } from '@/hooks/runs';
import { runName } from '@/features/settings/org/runners/runnerParts';
import { t, tn, type TranslationKey } from '@/lib/i18n';
import type { AgentRun, RunEvent } from '@/types';
import { isBusy, offsetText } from './runParts';

const KIND_TEXT: Record<RunEvent['kind'], TranslationKey> = {
  system: 'items.agents.log.kind.system',
  text: 'items.agents.log.kind.text',
  tool: 'items.agents.log.kind.tool',
  result: 'items.agents.log.kind.result',
  error: 'items.agents.log.kind.error',
};

const KIND_LOOK: Record<RunEvent['kind'], string> = {
  system: 'text-muted',
  text: 'text-ink',
  tool: 'text-muted',
  result: 'font-medium text-ink',
  error: 'font-medium text-danger',
};

/** How often the status says how many new lines came, at most. */
export const ANNOUNCE_MS = 5000;

/**
 * "3 neue Zeilen": what came since the last announcement, at most every `ANNOUNCE_MS` while the run runs; the lines
 * the log had when it opened are not new.
 */
function useNewLines(count: number, live: boolean): { text: string; at: number } {
  const [said, setSaid] = useState({ text: '', at: 0 });
  /** The lines already told about (or there when the log loaded); null before. */
  const known = useRef<number | null>(null);
  const current = useRef(count);
  current.current = count;
  const last = useRef(Number.NEGATIVE_INFINITY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!live) return;
    if (known.current === null) {
      known.current = count;
      return;
    }
    if (count <= known.current || timer.current !== null) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        last.current = Date.now();
        // the same words twice are no change to a screen reader: say them as new text
        setSaid({ text: tn('items.agents.log.new_lines', current.current - known.current!), at: Date.now() });
        known.current = current.current;
      },
      Math.max(0, last.current + ANNOUNCE_MS - Date.now()),
    );
  }, [count, live]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return said;
}

export function RunLog({ run, id, enabled = true }: { run: AgentRun; id: string; enabled?: boolean }) {
  const log = useRunLog(run.id, { enabled });
  const list = useRef<HTMLDivElement>(null);
  const live = isBusy(run);
  const lines = log.data ?? [];
  const start = run.started_at ? Date.parse(run.started_at) : null;
  const said = useNewLines(log.data === undefined ? 0 : lines.length, live && log.data !== undefined);

  // new lines scroll into view while the reader is at the bottom
  useEffect(() => {
    const box = list.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  return (
    <div id={id} className="mt-2 rounded-ctl border border-line bg-sunken">
      <p role="status" className="sr-only">
        <span key={said.at}>{said.text}</span>
      </p>
      {log.isError && !log.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <p className="min-w-0 flex-1 text-pretty text-ink">{t('items.agents.log.failed')}</p>
          <Button variant="secondary" size="sm" icon={RotateCw} pending={log.isFetching} onClick={() => void log.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !log.data ? (
        <SkeletonGroup label={t('items.agents.log.loading')} className="flex flex-col gap-1.5 px-3 py-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </SkeletonGroup>
      ) : lines.length === 0 ? (
        <p className="px-3 py-2 text-sm text-pretty text-muted">{run.started_at ? t('items.agents.log.empty') : t('items.agents.log.not_started')}</p>
      ) : (
        <>
          {(run.events_dropped ?? 0) > 0 && <p className="border-b border-line px-3 py-1.5 text-sm text-muted">{tn('items.agents.log.dropped', run.events_dropped ?? 0)}</p>}
          {/* the log role sits on a box around the list: a list with another role would lose its items (axe listitem) */}
          <div
            ref={list}
            role="log"
            aria-live="off"
            aria-label={t('items.agents.log.label', { run: runName(run.type) })}
            className="max-h-72 overflow-y-auto px-3 py-2 text-sm"
          >
            <ol>
            {lines.map((line) => (
              <li key={line.id} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 py-0.5">
                <span className="text-muted tabular-nums">{start === null ? '' : offsetText((Date.parse(line.at) - start) / 1000)}</span>
                <span className={cx('min-w-0 break-words whitespace-pre-wrap', KIND_LOOK[line.kind])}>
                  <span className="sr-only">{`${t(KIND_TEXT[line.kind])}: `}</span>
                  {line.kind === 'tool' ? <span translate="no">{line.text}</span> : line.text}
                </span>
              </li>
            ))}
              {live && (
                <li className="py-0.5 pl-[4.25rem] text-muted" aria-hidden="true">
                  …
                </li>
              )}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
