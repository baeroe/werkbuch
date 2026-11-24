/*
 * One runner in the list (spec 6.2, 8.4, 8.6, 8.8, 10.1; port of the clickdummy): whether it is online, what it is, how
 * many of its places are taken in each pot, the last load it sent, its CLIs and what the harness of the machine offers
 * (read-only), and the runs on it with "Abbrechen". A runner that has not reported yet says so instead of a load.
 */

import { Link } from '@inertiajs/react';
import { CircleStop, Cpu, Pencil, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { CLI_NAMES } from '@/domain/agents';
import { useItemRef } from '@/hooks/richText';
import { t, tx } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { AgentCli, AgentRun, Runner } from '@/types';
import { formatDate, formatDateTime, relativeTime, useOrgZone } from '../../frame/format';
import { Badge } from '../../frame/parts';
import { clockTime, gigabytes, percent, runName, statusLabel, systemOf } from './runnerParts';

/** The id of a runner's card: the focus goes there after a run of it was canceled, and to the next one after a revoke. */
export const cardId = (runner: Pick<Runner, 'id'>) => `runner-card-${runner.id}`;

/** "09:41" today, "27.10.2026, 09:41" before: since when a runner is offline, in the zone of the organisation. */
function sinceText(iso: string, zone: string): string {
  return formatDate(iso, zone) === formatDate(new Date().toISOString(), zone) ? clockTime(iso, zone) : formatDateTime(iso, zone);
}

function OnlineBadge({ runner }: { runner: Runner }) {
  const zone = useOrgZone();
  if (runner.online) {
    return (
      <Badge tone="accent" className="gap-1.5">
        <span className="size-2 rounded-full bg-current" aria-hidden="true" />
        {t('settings.runners.online')}
      </Badge>
    );
  }
  return (
    <Badge tone="quiet" className="gap-1.5">
      <span className="size-2 rounded-full border border-current" aria-hidden="true" />
      {runner.last_seen_at ? t('settings.runners.offline_since', { time: sinceText(runner.last_seen_at, zone) }) : t('settings.runners.offline')}
    </Badge>
  );
}

/** A pot of places as little boxes, filled for each run, with the count in words beside them. */
function Pot({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={cx('h-3 w-2 rounded-[2px] border', index < used ? 'border-accent bg-accent' : 'border-line-strong bg-surface')} />
        ))}
      </span>
      <span className="tabular-nums">
        <span className="text-muted">{label}</span> {t('settings.runners.pot.count', { used, total })}
      </span>
    </span>
  );
}

/** The three pots (spec 9): code runs in all and in the busiest repo, light runs apart. */
function Places({ runner }: { runner: Runner }) {
  return (
    <span className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <Pot label={t('settings.runners.pot.total')} used={runner.slots_used.total} total={runner.slots.total} />
      <Pot label={t('settings.runners.pot.per_repo')} used={runner.slots_used.per_repo} total={runner.slots.per_repo} />
      <Pot label={t('settings.runners.pot.light')} used={runner.slots_used.light} total={runner.slots.light} />
    </span>
  );
}

/** One measure of the load: a short bar and the value in words; a full one in red. */
function Meter({ label, share, text }: { label: string; share: number | null; text: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      {share !== null && (
        <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-sunken ring-1 ring-line" aria-hidden="true">
          <span className={cx('block h-full rounded-full', share >= 0.9 ? 'bg-danger' : 'bg-accent')} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
        </span>
      )}
      <span className={cx('tabular-nums', share === null ? 'text-muted' : 'text-ink')}>{text}</span>
    </span>
  );
}

/** A share of a whole, none for a whole of nothing (a report without a size). */
const shareOf = (part: number, whole: number) => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : null);

/** The last load the runner sent (spec 8.6); an offline runner's says when it was measured. */
function Load({ runner }: { runner: Runner }) {
  const zone = useOrgZone();
  const { load } = runner;
  if (!load) return <span className="text-muted">{t('settings.runners.no_report')}</span>;
  return (
    <span className="flex flex-col gap-1">
      <span className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Meter label={t('settings.runners.load.cpu')} share={load.cpu / 100} text={percent(load.cpu)} />
        <Meter label={t('settings.runners.load.gpu')} share={load.gpu === null ? null : load.gpu / 100} text={load.gpu === null ? t('settings.runners.load.unavailable') : percent(load.gpu)} />
        <Meter label={t('settings.runners.load.ram')} share={shareOf(load.ram_used, load.ram_total)} text={t('settings.runners.load.ram_used', { used: gigabytes(load.ram_used), total: gigabytes(load.ram_total) })} />
        <Meter
          label={t('settings.runners.load.disk')}
          share={shareOf(load.disk_total - load.disk_free, load.disk_total)}
          text={t('settings.runners.load.disk_free', { free: gigabytes(load.disk_free), total: gigabytes(load.disk_total) })}
        />
      </span>
      {!runner.online && load.measured_at && <span className="text-sm text-muted">{t('settings.runners.load.measured', { when: formatDateTime(load.measured_at, zone) })}</span>}
    </span>
  );
}

/** The CLIs the runner reports (spec 8.8): a run goes only to a runner with its agent's CLI logged in. */
function Clis({ runner }: { runner: Runner }) {
  if (runner.clis.length === 0) return <span className="text-muted">{t('settings.runners.cli.none')}</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {runner.clis.map((entry) => {
        const ready = entry.installed && entry.logged_in;
        return (
          <li key={entry.cli} className="flex flex-wrap items-baseline gap-x-1.5">
            <span>{CLI_NAMES[entry.cli as AgentCli] ?? entry.cli}</span>
            {entry.version && (
              <span className="text-muted" translate="no">
                {entry.version}
              </span>
            )}
            <span className={ready ? 'text-muted' : 'text-danger'}>
              {!entry.installed ? t('settings.runners.cli.not_installed') : entry.logged_in ? t('settings.runners.cli.logged_in') : t('settings.runners.cli.logged_out')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Up to this many skills stand in the row; more fold into a list that opens. */
const SKILLS_SHOWN = 4;

/** What the harness offers an agent, read-only: it is set up on the machine (spec 8.7). */
function Equipment({ runner }: { runner: Runner }) {
  if (!runner.equipment) return <span className="text-muted">{t('settings.runners.no_report')}</span>;
  const { mcp_servers, skills, plugins, werkbuch_access } = runner.equipment;
  const nothing = mcp_servers.length === 0 && skills.length === 0 && plugins.length === 0;
  const line = (label: string, names: string[]) =>
    names.length > 0 && (
      <span>
        <span className="text-muted">{label}: </span>
        <span translate="no">{names.join(', ')}</span>
      </span>
    );
  return (
    <span className="flex flex-col gap-0.5">
      {nothing && <span className="text-muted">{t('settings.runners.equipment.nothing')}</span>}
      {line(t('settings.runners.equipment.mcp'), mcp_servers)}
      {skills.length > SKILLS_SHOWN ? (
        <details className="group">
          <summary className="cursor-pointer rounded-ctl text-muted hover:text-ink">{t('settings.runners.equipment.skills_count', { count: skills.length })}</summary>
          <span translate="no" className="block">
            {skills.join(', ')}
          </span>
        </details>
      ) : (
        line(t('settings.runners.equipment.skills'), skills)
      )}
      {line(t('settings.runners.equipment.plugins'), plugins)}
      {werkbuch_access.length > 0 && (
        <span className="flex items-start gap-1.5 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{tx('settings.runners.equipment.werkbuch_access', { servers: <span translate="no">{werkbuch_access.join(', ')}</span> })}</span>
        </span>
      )}
      <span className="text-sm text-muted">{t('settings.runners.equipment.hint')}</span>
    </span>
  );
}

/** One run on the runner: the item it works on (by its reference), what it does since when, and "Abbrechen". */
function RunRow({ run, onCancel }: { run: AgentRun; onCancel: (key: string | null) => void }) {
  const zone = useOrgZone();
  const item = useItemRef(run.work_item_id);
  const key = item.data?.key ?? null;
  const subject = key ?? (run.work_item_id ? (item.isPending ? '…' : t('settings.runners.runs.item_hidden')) : t('settings.runners.runs.no_item'));
  const state = run.started_at
    ? t('settings.runners.runs.since', { type: runName(run.type), status: statusLabel(run.status), time: clockTime(run.started_at, zone) })
    : t('settings.runners.runs.state', { type: runName(run.type), status: statusLabel(run.status) });
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2">
      {item.data ? (
        <Link href={paths.item(item.data.key)} className="min-w-0 truncate font-medium text-accent-text underline-offset-2 hover:underline">
          <span className="tabular-nums" translate="no">
            {item.data.key}
          </span>{' '}
          {item.data.title}
        </Link>
      ) : (
        <span className="text-muted">{subject}</span>
      )}
      <span className="text-sm text-muted">{state}</span>
      <Button
        variant="ghost"
        size="sm"
        icon={CircleStop}
        aria-label={t('settings.runners.runs.cancel_named', { run: runName(run.type), subject })}
        disabledReason={run.status === 'canceling' ? t('settings.runners.runs.canceling_reason') : null}
        onClick={() => onCancel(key)}
      >
        {t('settings.runners.runs.cancel')}
      </Button>
    </li>
  );
}

type RunnerCardProps = {
  runner: Runner;
  /** The runs that wait for this runner or run on it. */
  runs: AgentRun[];
  onPlaces: () => void;
  onRename: () => void;
  onRevoke: () => void;
  onCancelRun: (run: AgentRun, key: string | null) => void;
};

export function RunnerCard({ runner, runs, onPlaces, onRename, onRevoke, onCancelRun }: RunnerCardProps) {
  const zone = useOrgZone();
  const titleId = `runner-${runner.id}`;
  const contact = runner.online
    ? t('settings.runners.seen', { when: relativeTime(runner.last_seen_at!) })
    : runner.last_seen_at
      ? t('settings.runners.last_contact', { when: formatDateTime(runner.last_seen_at, zone) })
      : t('settings.runners.no_contact');
  return (
    <article id={cardId(runner)} tabIndex={-1} aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-ctl bg-sunken text-muted" aria-hidden="true">
            <Cpu className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={titleId} className="font-display text-lg font-bold tracking-title break-all text-ink" translate="no">
                {runner.name}
              </h3>
              <OnlineBadge runner={runner} />
            </div>
            <p className="text-sm text-muted">{contact}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={SlidersHorizontal} aria-label={t('settings.runners.action.places_named', { name: runner.name })} onClick={onPlaces}>
            {t('settings.runners.action.places')}
          </Button>
          <Button variant="ghost" icon={Pencil} aria-label={t('settings.runners.action.rename_named', { name: runner.name })} onClick={onRename}>
            {t('settings.runners.action.rename')}
          </Button>
          <Button variant="ghost" icon={Trash2} aria-label={t('settings.runners.action.revoke_named', { name: runner.name })} onClick={onRevoke}>
            {t('settings.runners.action.revoke')}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">{t('settings.runners.field.system')}</dt>
        <dd className="text-ink">{systemOf(runner)}</dd>
        <dt className="text-muted">{t('settings.runners.field.version')}</dt>
        <dd className="text-ink tabular-nums" translate="no">
          {runner.version}
        </dd>
        <dt className="text-muted">{t('settings.runners.field.places')}</dt>
        <dd className="text-ink">
          <Places runner={runner} />
        </dd>
        <dt className="text-muted">{t('settings.runners.field.load')}</dt>
        <dd className="text-ink">
          <Load runner={runner} />
        </dd>
        <dt className="text-muted">{t('settings.runners.field.clis')}</dt>
        <dd className="text-ink">
          <Clis runner={runner} />
        </dd>
        <dt className="text-muted">{t('settings.runners.field.equipment')}</dt>
        <dd className="text-ink">
          <Equipment runner={runner} />
        </dd>
        <dt className="text-muted">{t('settings.runners.field.runs')}</dt>
        <dd className="min-w-0 text-ink">
          {runs.length === 0 ? (
            <span className="text-muted">{runner.online ? t('settings.runners.runs.free') : t('settings.runners.runs.none')}</span>
          ) : (
            <ul className="flex flex-col gap-1" aria-label={t('settings.runners.runs.list', { name: runner.name })}>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} onCancel={(key) => onCancelRun(run, key)} />
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </article>
  );
}
