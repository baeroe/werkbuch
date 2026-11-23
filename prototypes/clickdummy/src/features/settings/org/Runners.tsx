/*
 * Runners (WEBU-18, spec 6.2, 8.4, 8.6 and 10.1): the machines that run the agents. Each card says whether the runner
 * is online, what it is, how many of its slots are taken in each pot and by which runs (with "Abbrechen"), and the
 * last load it sent. Its slots are set here, not on the machine ("Plätze"); every runner takes runs of every project.
 * "Runner verbinden" shows the install command with a one-time code that is valid for ten minutes; the dialog waits
 * for the runner and says when it has connected. Renaming is a small dialog; revoking asks first, because it stops
 * what runs there.
 */

import { CircleAlert, CircleStop, Cpu, Laptop, Link2, Pencil, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { CLI_NAMES } from '@/domain/agents';
import { CommandBlock } from '@/features/agents/CommandBlock';
import { clockTime, runName, statusLabel, useNow } from '@/features/agents/runParts';
import { focusWhenLost } from '@/features/item-detail/shared';
import { useCancelRun, useCreatePairing, useExpirePairing, usePairing, useRenameRunner, useRevokeRunner, useRunners, useSaveRunnerSlots, useSimulatePairing } from '@/hooks/agents';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { hrefOf } from '@/lib/links';
import type { Runner } from '@/types';
import { neighbourOf } from './focus';
import { fieldMessage, noticeOf } from './errors';
import { counted, formatDateTime, relativeTime, useOrgZone } from './format';
import { FormDialog } from './FormDialog';
import { Badge, Loaded, RowsSkeleton, SectionHeader } from './parts';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';

const SYSTEMS: Record<Runner['os'], string> = { darwin: 'macOS', linux: 'Linux' };
const ARCHS: Record<Runner['arch'], string> = { arm64: 'Apple Silicon (arm64)', amd64: 'Intel (amd64)' };

export const systemOf = (runner: Pick<Runner, 'os' | 'arch'>) => `${SYSTEMS[runner.os]}, ${runner.os === 'linux' && runner.arch === 'amd64' ? 'x86-64 (amd64)' : ARCHS[runner.arch]}`;

/* ------------------------------------------------------------------------ pairing */

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** "9:41" left of a code. */
function remaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${twoDigits(seconds % 60)}`;
}

type PairingProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Connect a runner: a fresh code at every opening, the command with it, the time it has left, and a status line that
 * waits for the runner. The two demo buttons stand in for the machine.
 */
function PairingDialog({ open, onOpenChange }: PairingProps) {
  const settle = useSettle();
  const create = useCreatePairing();
  const [code, setCode] = useState<string | null>(null);
  const pairing = usePairing(code);
  const simulate = useSimulatePairing();
  const expire = useExpirePairing();
  const zone = useOrgZone();
  const connected = pairing.data?.runner_id ? (simulate.data ?? null) : null;
  const at = useNow(open && !connected);
  const left = pairing.data ? Date.parse(pairing.data.expires_at) - at.getTime() : 0;
  const expired = pairing.data !== undefined && left <= 0 && !connected;
  const done = useRef<HTMLButtonElement>(null);

  function newCode() {
    settle(create.mutateAsync(undefined), {
      onSuccess: (created) => setCode(created.code),
      onError: (error) => notifyError('Kein Code erzeugt', error, newCode),
    });
  }

  // every opening starts with a new code
  useEffect(() => {
    if (open) newCode();
    else setCode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the button that had the focus („Verbindung simulieren“) is gone: „Fertig“ takes it, once it is drawn
  const connectedId = connected?.id;
  useEffect(() => {
    if (!connectedId) return;
    // the dialog's focus guard moves a lost focus to the dialog a moment later; hold on for a few frames
    let tries = 0;
    let frame = 0;
    const take = () => {
      const button = done.current ?? document.querySelector<HTMLButtonElement>('[data-pairing-done]');
      if (button && document.activeElement !== button) button.focus();
      if ((tries += 1) < 20) frame = requestAnimationFrame(take);
    };
    frame = requestAnimationFrame(take);
    return () => cancelAnimationFrame(frame);
  }, [connectedId]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={connected ? `„${connected.name}“ ist verbunden` : 'Runner verbinden'}
      description={
        connected
          ? 'Der Runner holt ab jetzt Aufträge ab. Trag ihn bei den Bots ein, die auf ihm arbeiten sollen.'
          : 'Führe den Befehl im Terminal der Maschine aus. Er lädt den Runner von dieser Instanz, verbindet ihn mit dem Code und startet ihn als Dienst.'
      }
      footer={
        connected ? (
          <>
            <Link to="/settings/bots" onClick={() => onOpenChange(false)} className="inline-flex h-11 items-center rounded-ctl px-3 text-ui font-medium text-accent-text hover:bg-hover md:h-8">
              Zu den Bots
            </Link>
            <DialogClose
              render={
                <Button ref={done} variant="primary" data-pairing-done="">
                  Fertig
                </Button>
              }
            />
          </>
        ) : (
          <DialogClose render={<Button variant="ghost">Schließen</Button>} />
        )
      }
    >
      {connected ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-ctl border border-line bg-surface p-3 text-ui">
          <dt className="text-muted">System</dt>
          <dd className="text-ink">{systemOf(connected)}</dd>
          <dt className="text-muted">Version</dt>
          <dd className="text-ink tabular-nums" translate="no">
            {connected.version}
          </dd>
          <dt className="text-muted">Plätze</dt>
          <dd className="text-ink">{`${connected.slots.total} gesamt, ${connected.slots.per_repo} je Repo, ${connected.slots.light} für Reviews und Antworten. Ändern kannst du sie an seiner Karte unter „Plätze“.`}</dd>
          <dt className="text-muted">Projekte</dt>
          <dd className="text-ink">Alle. Setup-Befehle und MCP-Server stehen je Projekt unter Projekteinstellungen → Agenten.</dd>
        </dl>
      ) : (
        <div className="flex flex-col gap-4">
          {pairing.data ? (
            <>
              <CommandBlock label="Befehl für das Terminal" command={pairing.data.command} hint="macOS (Apple Silicon und Intel) und Linux. Ein zweiter Aufruf mit neuem Code verbindet neu, ohne zweiten Dienst." />
              {expired ? (
                <Banner
                  tone="danger"
                  role="alert"
                  title="Der Code ist abgelaufen"
                  action={
                    <Button variant="secondary" size="sm" icon={RefreshCw} pending={create.isPending} onClick={newCode}>
                      Neuen Code erzeugen
                    </Button>
                  }
                >
                  Ein Code gilt zehn Minuten und nur einmal. Das Terminal meldet einen abgelaufenen Code, der Runner verbindet sich dann nicht.
                </Banner>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-ui text-ink">
                    Code{' '}
                    <span className="font-semibold tabular-nums" translate="no">
                      {pairing.data.code}
                    </span>
                    , gültig bis {clockTime(pairing.data.expires_at, zone)}{' '}
                    <span className="text-muted tabular-nums">(noch {remaining(left)} Min.)</span>
                  </p>
                  <Button variant="ghost" size="sm" icon={RefreshCw} pending={create.isPending} onClick={newCode}>
                    Neuer Code
                  </Button>
                </div>
              )}
              {!expired && (
                <p role="status" className="flex items-center gap-2 rounded-ctl border border-dashed border-line-strong px-3 py-2.5 text-ui text-muted">
                  <Laptop className="size-4 shrink-0" aria-hidden="true" />
                  Wartet auf den Runner …
                </p>
              )}
            </>
          ) : create.isError ? (
            <Banner tone="danger" role="alert" title="Kein Code erzeugt">
              {create.error.message}
            </Banner>
          ) : (
            <p role="status" className="text-ui text-muted">
              Code wird erzeugt …
            </p>
          )}
          <Banner tone="neutral" icon={ShieldCheck} title="Am besten unter einem eigenen Benutzer">
            Der Agent arbeitet mit den Rechten des Benutzers, unter dem der Runner läuft. Nimm einen eigenen macOS-Benutzer ohne Admin-Rechte und ohne Zugang zu privaten Daten.
          </Banner>
          {pairing.data && (
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-3">
              <span className="text-sm text-muted">Nur im Klickdummy:</span>
              <Button
                variant="secondary"
                size="sm"
                icon={Link2}
                pending={simulate.isPending}
                disabledReason={expired ? 'Der Code ist abgelaufen.' : null}
                onClick={() => settle(simulate.mutateAsync(pairing.data!.code), { onError: (error) => notifyError('Nicht verbunden', error) })}
              >
                Verbindung simulieren
              </Button>
              <Button variant="ghost" size="sm" pending={expire.isPending} disabledReason={expired ? 'Der Code ist schon abgelaufen.' : null} onClick={() => settle(expire.mutateAsync(pairing.data!.code))}>
                Ablauf simulieren
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- rename */

function RenameDialog({ runner, open, onOpenChange }: { runner: Runner | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const settle = useSettle();
  const rename = useRenameRunner();
  const [name, setName] = useState(runner?.name ?? '');
  const [attempted, setAttempted] = useState(false);
  const error = attempted && name.trim() === '' ? 'Gib dem Runner einen Namen.' : fieldMessage(rename.error, 'name');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`„${runner?.name ?? ''}“ umbenennen`}
      description="Der Name steht in der Liste und an den Aufträgen. Der Runner selbst merkt davon nichts."
      submitLabel="Umbenennen"
      pending={rename.isPending}
      notice={noticeOf(rename.error, ['name'])}
      onSubmit={() => {
        setAttempted(true);
        if (!runner || name.trim() === '') return;
        settle(rename.mutateAsync({ id: runner.id, name }), {
          onSuccess: (saved) => {
            onOpenChange(false);
            toast({ title: `Runner heißt jetzt „${saved.name}“`, tone: 'success' });
          },
        });
      }}
    >
      <Input label="Name" name="runner_name" autoComplete="off" spellCheck={false} value={name} error={error} onChange={(event) => setName(event.target.value)} />
    </FormDialog>
  );
}

/* --------------------------------------------------------------------------- list */

function OnlineBadge({ runner }: { runner: Runner }) {
  const zone = useOrgZone();
  if (runner.online) {
    return (
      <Badge tone="accent" className="gap-1.5">
        <span className="size-2 rounded-full bg-current" aria-hidden="true" />
        Online
      </Badge>
    );
  }
  return (
    <Badge tone="quiet" className="gap-1.5">
      <span className="size-2 rounded-full border border-current" aria-hidden="true" />
      Offline seit {clockTime(runner.last_seen_at, zone)}
    </Badge>
  );
}

/** A pot of slots as little boxes, filled for each run, with the count in words beside them. */
function Pot({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={cx('h-3 w-2 rounded-[2px] border', index < used ? 'border-accent bg-accent' : 'border-line-strong bg-surface')} />
        ))}
      </span>
      <span className="tabular-nums">
        <span className="text-muted">{label}</span> {`${used} von ${total}`}
      </span>
    </span>
  );
}

/** The three pots (spec 9): code runs in all and in the busiest repo, light runs apart. */
function Slots({ runner }: { runner: Runner }) {
  return (
    <span className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <Pot label="Gesamt" used={runner.slots_used.total} total={runner.slots.total} />
      <Pot label="Je Repo" used={runner.slots_used.per_repo} total={runner.slots.per_repo} />
      <Pot label="Reviews und Antworten" used={runner.slots_used.light} total={runner.slots.light} />
    </span>
  );
}

const GB = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

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

/** The last load the runner sent (spec 8.6); an offline runner's says when it was measured. */
function Load({ runner }: { runner: Runner }) {
  const zone = useOrgZone();
  const { load } = runner;
  return (
    <span className="flex flex-col gap-1">
      <span className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Meter label="CPU" share={load.cpu / 100} text={`${load.cpu} %`} />
        <Meter label="GPU" share={load.gpu === null ? null : load.gpu / 100} text={load.gpu === null ? 'nicht verfügbar' : `${load.gpu} %`} />
        <Meter label="RAM" share={load.ram_used / load.ram_total} text={`${GB.format(load.ram_used)} von ${GB.format(load.ram_total)} GB belegt`} />
        <Meter label="Speicher" share={1 - load.disk_free / load.disk_total} text={`${GB.format(load.disk_free)} von ${GB.format(load.disk_total)} GB frei`} />
      </span>
      {!runner.online && <span className="text-sm text-muted">{`Letzter Stand vom ${formatDateTime(load.measured_at, zone)}`}</span>}
    </span>
  );
}

/** The CLIs the runner reports (spec 8.8): a run goes only to a runner with its agent's CLI logged in. */
function Clis({ runner }: { runner: Runner }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {runner.clis.map((entry) => {
        const ready = entry.installed && entry.logged_in;
        return (
          <li key={entry.cli} className="flex flex-wrap items-baseline gap-x-1.5">
            <span>{CLI_NAMES[entry.cli]}</span>
            {entry.version && (
              <span className="text-muted" translate="no">
                {entry.version}
              </span>
            )}
            <span className={ready ? 'text-muted' : 'text-danger'}>{!entry.installed ? 'nicht installiert' : entry.logged_in ? 'angemeldet' : 'nicht angemeldet'}</span>
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
      {nothing && <span className="text-muted">Nichts eingerichtet: nur werkbuch</span>}
      {line('MCP', mcp_servers)}
      {skills.length > SKILLS_SHOWN ? (
        <details className="group">
          <summary className="cursor-pointer rounded-ctl text-muted hover:text-ink">{`Skills: ${skills.length}`}</summary>
          <span translate="no" className="block">
            {skills.join(', ')}
          </span>
        </details>
      ) : (
        line('Skills', skills)
      )}
      {line('Plugins', plugins)}
      {werkbuch_access.length > 0 && (
        <span className="flex items-start gap-1.5 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span translate="no">{werkbuch_access.join(', ')}</span> erreicht werkbuch mit einem persönlichen Token: Agenten hätten hier einen zweiten Zugang. Für den Runner abschalten.
          </span>
        </span>
      )}
      <span className="text-sm text-muted">Einrichtung auf der Maschine. werkbuch gibt jedem Agenten seinen eigenen Server dazu.</span>
    </span>
  );
}

/* ---------------------------------------------------------------------------- slots */

function SlotsDialog({ runner, open, onOpenChange }: { runner: Runner | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const settle = useSettle();
  const save = useSaveRunnerSlots();
  const [values, setValues] = useState({ total: String(runner?.slots.total ?? 2), per_repo: String(runner?.slots.per_repo ?? 1), light: String(runner?.slots.light ?? 2) });
  const field = (key: keyof typeof values, label: string, hint: string) => (
    <Input
      label={label}
      name={`slots_${key}`}
      inputMode="numeric"
      autoComplete="off"
      value={values[key]}
      hint={hint}
      error={fieldMessage(save.error, key)}
      onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
    />
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Plätze von „${runner?.name ?? ''}“`}
      description="Wie viele Aufträge der Runner zugleich nimmt. Er bekommt die Zahlen beim nächsten Kontakt; was läuft, läuft weiter."
      submitLabel="Speichern"
      pending={save.isPending}
      notice={noticeOf(save.error, ['total', 'per_repo', 'light'])}
      onSubmit={() => {
        if (!runner) return;
        const slots = { total: Number(values.total), per_repo: Number(values.per_repo), light: Number(values.light) };
        settle(save.mutateAsync({ id: runner.id, slots }), {
          onSuccess: (saved) => {
            onOpenChange(false);
            toast({ title: `Plätze von „${saved.name}“ gespeichert`, description: `${saved.slots.total} gesamt, ${saved.slots.per_repo} je Repo, ${saved.slots.light} für Reviews und Antworten.`, tone: 'success' });
          },
        });
      }}
    >
      {field('total', 'Gesamt', 'Aufträge, die Code ändern (Umsetzen, Korrektur, Konflikt). Standard 2.')}
      {field('per_repo', 'Je Repo', 'Höchstens so viele im selben Repo; DDEV teilt die Test-Datenbank. Standard 1.')}
      {field('light', 'Reviews und Antworten', 'Ein eigener Topf für Aufträge, die nur lesen. Standard 2.')}
    </FormDialog>
  );
}

type ActiveRun = Runner['active_runs'][number];

function RunnerCard({ runner, onSlots, onRename, onRevoke, onCancelRun }: { runner: Runner; onSlots: () => void; onRename: () => void; onRevoke: () => void; onCancelRun: (run: ActiveRun) => void }) {
  const zone = useOrgZone();
  const titleId = `runner-${runner.id}`;
  return (
    <article id={`runner-card-${runner.id}`} tabIndex={-1} aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1">
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
            <p className="text-sm text-muted">{runner.online ? `Zuletzt gemeldet ${relativeTime(runner.last_seen_at)}` : `Letzter Kontakt am ${formatDateTime(runner.last_seen_at, zone)}`}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={SlidersHorizontal} onClick={onSlots}>
            Plätze <span className="sr-only">{runner.name}</span>
          </Button>
          <Button variant="ghost" icon={Pencil} onClick={onRename}>
            Umbenennen <span className="sr-only">{runner.name}</span>
          </Button>
          <Button variant="ghost" icon={Trash2} onClick={onRevoke}>
            Widerrufen <span className="sr-only">{runner.name}</span>
          </Button>
        </div>
      </div>

      {runner.update_error && (
        <Banner tone="danger" icon={TriangleAlert} title="Update gescheitert">
          {runner.update_error}
        </Banner>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">System</dt>
        <dd className="text-ink">{systemOf(runner)}</dd>
        <dt className="text-muted">Version</dt>
        <dd className="text-ink tabular-nums" translate="no">
          {runner.version}
        </dd>
        <dt className="text-muted">Plätze</dt>
        <dd className="text-ink">
          <Slots runner={runner} />
        </dd>
        <dt className="text-muted">Auslastung</dt>
        <dd className="text-ink">
          <Load runner={runner} />
        </dd>
        <dt className="text-muted">CLIs</dt>
        <dd className="text-ink">
          <Clis runner={runner} />
        </dd>
        <dt className="text-muted">Ausstattung</dt>
        <dd className="text-ink">
          <Equipment runner={runner} />
        </dd>
        <dt className="text-muted">Aufträge</dt>
        <dd className="min-w-0 text-ink">
          {runner.active_runs.length === 0 ? (
            <span className="text-muted">{runner.online ? 'Frei' : 'Keine'}</span>
          ) : (
            <ul className="flex flex-col gap-1" aria-label={`Aufträge auf ${runner.name}`}>
              {runner.active_runs.map((run) => (
                <li key={run.id} className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <a href={hrefOf(`/items/${run.item_key}`)} className="min-w-0 truncate font-medium text-accent-text underline-offset-2 hover:underline">
                    <span className="tabular-nums" translate="no">
                      {run.item_key}
                    </span>{' '}
                    {run.item_title}
                  </a>
                  <span className="text-sm text-muted">{`${runName(run)}, ${statusLabel(run.status)}${run.started_at ? ` seit ${clockTime(run.started_at, zone)}` : ''}`}</span>
                  <Button variant="ghost" size="sm" icon={CircleStop} disabledReason={run.status === 'canceling' ? 'Wird schon abgebrochen.' : null} onClick={() => onCancelRun(run)}>
                    Abbrechen <span className="sr-only">{`${runName(run)} an ${run.item_key}`}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </article>
  );
}

export default function Runners(_props: SectionProps) {
  const runners = useRunners();
  const settle = useSettle();
  const revoke = useRevokeRunner();
  const pairing = useDialogRound();
  const rename = useDialogRound<Runner>();
  const slots = useDialogRound<Runner>();
  const cancel = useCancelRun();
  const [revoking, setRevoking] = useState<Runner | null>(null);
  const [canceling, setCanceling] = useState<{ runner: Runner; run: ActiveRun } | null>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  /** Where the focus goes when the revoke dialog closes: its trigger, after a revoke the next runner's card. */
  const afterRevoke = useRef<HTMLElement | null>(null);
  const connect = (
    <Button ref={connectButton} variant="primary" icon={Plus} onClick={() => pairing.show()}>
      Runner verbinden
    </Button>
  );

  function askRevoke(runner: Runner) {
    afterRevoke.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRevoking(runner);
  }

  function runRevoke(runner: Runner) {
    // the card goes with the revoke: the focus goes to the next runner's, or to „Runner verbinden“ for the last one
    const trigger = document.getElementById(`runner-card-${runner.id}`);
    const next = neighbourOf(trigger);
    const target = next && next.id !== 'main' ? next : connectButton.current;
    settle(revoke.mutateAsync(runner.id), {
      onSuccess: ({ canceled }) => {
        afterRevoke.current = target;
        setRevoking(null);
        toast({ title: `„${runner.name}“ widerrufen`, description: canceled > 0 ? `${counted(canceled, 'Auftrag', 'Aufträge')} abgebrochen. Wartende Aufträge gehen an die anderen Runner des Pools.` : 'Sein Token gilt nicht mehr.', tone: 'success' });
      },
      onError: (error) => notifyError(`„${runner.name}“ nicht widerrufen`, error, () => runRevoke(runner)),
    });
  }

  function runCancel(runner: Runner, run: ActiveRun) {
    settle(cancel.mutateAsync(run.id), {
      onSuccess: () => {
        setCanceling(null);
        toast({ title: `${run.item_key}: Auftrag wird abgebrochen`, description: `„${runner.name}“ beendet das CLI beim nächsten Kontakt. Was nicht gepusht ist, bleibt im Worktree.`, tone: 'success' });
        // the row goes once the run ended: the focus goes to the runner's card
        focusWhenLost(() => document.getElementById(`runner-card-${runner.id}`), 10_000);
      },
      onError: (error) => notifyError('Auftrag nicht abgebrochen', error, () => runCancel(runner, run)),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Runner"
        description="Maschinen, auf denen Agenten mit Claude Code oder Codex arbeiten. Ein Runner holt Aufträge selbst ab und braucht keinen offenen Port."
        actions={connect}
      />
      <Loaded queries={[runners]} failure="Die Runner konnten nicht geladen werden" skeleton={<RowsSkeleton rows={3} label="Die Runner werden geladen …" />}>
        {() => {
          const list = runners.data?.items ?? [];
          if (list.length === 0) {
            return <EmptyState icon={Cpu} title="Noch kein Runner" description="Ein Runner ist ein Mac oder ein Linux-Rechner, auf dem Agenten arbeiten. Verbinde einen mit einem Befehl im Terminal." actions={connect} />;
          }
          const offline = list.filter((runner) => !runner.online && runner.active_runs.length > 0);
          return (
            <>
              {offline.map((runner) => (
                <Banner key={runner.id} tone="neutral" icon={CircleAlert} role="status" title={`${counted(runner.active_runs.length, 'Auftrag wartet', 'Aufträge warten')} auf „${runner.name}“`}>
                  Der Runner ist offline. Nach 30 Minuten übernimmt ein anderer Runner des Pools den Strang mit frischer Session, sobald einer frei ist.
                </Banner>
              ))}
              <ul className="flex flex-col gap-3">
                {list.map((runner) => (
                  <li key={runner.id}>
                    <RunnerCard runner={runner} onSlots={() => slots.show(runner)} onRename={() => rename.show(runner)} onRevoke={() => askRevoke(runner)} onCancelRun={(run) => setCanceling({ runner, run })} />
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Loaded>
      <PairingDialog key={`pairing-${pairing.round}`} open={pairing.open} onOpenChange={pairing.setOpen} />
      <SlotsDialog key={`slots-${slots.round}`} runner={slots.target} open={slots.open} onOpenChange={slots.setOpen} />
      <RenameDialog key={`rename-${rename.round}`} runner={rename.target} open={rename.open} onOpenChange={rename.setOpen} />
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`„${revoking?.name ?? ''}“ widerrufen?`}
        description={
          revoking && revoking.active_runs.some((run) => run.status === 'running')
            ? `Sein Token gilt danach nicht mehr. ${counted(revoking.active_runs.filter((run) => run.status === 'running').length, 'laufender Auftrag wird', 'laufende Aufträge werden')} abgebrochen. Um ihn wieder zu nutzen, verbindest du ihn mit einem neuen Code.`
            : 'Sein Token gilt danach nicht mehr. Um ihn wieder zu nutzen, verbindest du ihn mit einem neuen Code.'
        }
        confirmLabel="Widerrufen"
        pending={revoke.isPending}
        finalFocus={afterRevoke}
        onConfirm={() => revoking && runRevoke(revoking)}
      />
      <AlertDialog
        open={canceling !== null}
        onOpenChange={(open) => !open && setCanceling(null)}
        title={canceling ? `Auftrag „${runName(canceling.run)}“ an ${canceling.run.item_key} abbrechen?` : ''}
        description={
          canceling?.run.status === 'running'
            ? 'Der Runner beendet das CLI. Was der Agent noch nicht gepusht hat, bleibt im Worktree; am Item lässt er sich erneut starten.'
            : 'Der Auftrag kommt aus der Warteschlange. Am Item lässt er sich erneut starten.'
        }
        confirmLabel="Auftrag abbrechen"
        cancelLabel="Weiterlaufen lassen"
        pending={cancel.isPending}
        onConfirm={() => canceling && runCancel(canceling.runner, canceling.run)}
      />
    </div>
  );
}
