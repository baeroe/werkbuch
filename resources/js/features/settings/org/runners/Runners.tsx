/*
 * Settings → Runners (WEBU-27, spec 6.2, 8.4, 8.6, 10.1; port of the clickdummy): the machines that run the agents.
 * Each card says whether the runner is online, what it is, how many of its places are taken and by which runs (with
 * "Abbrechen"), and the last load it sent. Online is a question of time, not an event: the list asks again every 15 s
 * while it is shown (A580). "Runner verbinden" shows the install command with a one-time code and waits for the runner.
 * Renaming and the places are small dialogs; revoking asks first, because it stops what runs there. Members are told
 * "Nur für Admins" by the frame and load nothing.
 */

import { CircleAlert, Cpu, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { useActiveRuns, useCancelRun, useRevokeRunner, useRunners } from '@/hooks/runners';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { t, tn } from '@/lib/i18n';
import type { AgentRun, Runner } from '@/types';
import { Loaded, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import type { SectionProps } from '../sections';
import { PairingDialog } from './PairingDialog';
import { cardId, RunnerCard } from './RunnerCard';
import { PlacesDialog, RenameDialog } from './RunnerDialogs';
import { runName } from './runnerParts';

type Canceling = { runner: Runner; run: AgentRun; key: string | null };

export default function Runners(_props: SectionProps) {
  const runners = useRunners({ live: true });
  const runs = useActiveRuns({ live: true });
  const settle = useSettle();
  const revoke = useRevokeRunner();
  const cancel = useCancelRun();
  const pairing = useDialogRound();
  const rename = useDialogRound<Runner>();
  const places = useDialogRound<Runner>();
  const [revoking, setRevoking] = useState<Runner | null>(null);
  const [canceling, setCanceling] = useState<Canceling | null>(null);
  // the button in the header stays when the list changes; the one of the empty state goes with it
  const connectButton = useRef<HTMLButtonElement>(null);
  /** Where the focus goes when the revoke dialog closes: its trigger, after a revoke the next runner's card. */
  const afterRevoke = useRef<HTMLElement | null>(null);
  const runsOf = (runner: Runner) => (runs.data?.items ?? []).filter((run) => run.runner_id === runner.id);
  const connect = (ref?: typeof connectButton) => (
    <Button ref={ref} variant="primary" icon={Plus} onClick={() => pairing.show()}>
      {t('settings.runners.connect')}
    </Button>
  );

  function askRevoke(runner: Runner) {
    afterRevoke.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRevoking(runner);
  }

  function runRevoke(runner: Runner) {
    // the card goes with the revoke: the focus goes to the first button of the next runner's card ("Plätze", which
    // names the runner), or to "Runner verbinden" for the last one
    const row = document.getElementById(cardId(runner))?.closest('li');
    const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>('button');
    settle(revoke.mutateAsync(runner.id), {
      onSuccess: ({ canceled }) => {
        afterRevoke.current = next ?? connectButton.current;
        setRevoking(null);
        toast({
          title: t('settings.runners.revoke.done', { name: runner.name }),
          description: canceled > 0 ? tn('settings.runners.revoke.canceled', canceled) : t('settings.runners.revoke.token_gone'),
          tone: 'success',
        });
      },
      onError: (error) => notifyError(t('settings.runners.revoke.failed', { name: runner.name }), error, () => runRevoke(runner)),
    });
  }

  function runCancel({ runner, run, key }: Canceling) {
    settle(cancel.mutateAsync(run.id), {
      onSuccess: () => {
        setCanceling(null);
        toast({
          title: key ? t('settings.runners.cancel.done', { key }) : t('settings.runners.cancel.done_plain'),
          description: t('settings.runners.cancel.done_description', { name: runner.name }),
          tone: 'success',
        });
        // the row goes once the run ended: the focus goes to the runner's card
        focusWhenLost(() => document.getElementById(cardId(runner)), 10_000);
      },
      onError: (error) => notifyError(t('settings.runners.cancel.failed'), error, () => runCancel({ runner, run, key })),
    });
  }

  const running = revoking ? runsOf(revoking).filter((run) => run.status === 'running').length : 0;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.org.section.runners')} description={t('settings.runners.description')} actions={connect(connectButton)} />
      <Loaded queries={[runners, runs]} failure={t('settings.runners.load_failed')} skeleton={<RowsSkeleton rows={3} label={t('settings.runners.loading')} />} keepData>
        {() => {
          const list = runners.data?.items ?? [];
          if (list.length === 0) {
            return <EmptyState icon={Cpu} title={t('settings.runners.empty.title')} description={t('settings.runners.empty.description')} actions={connect()} />;
          }
          const waiting = list.filter((runner) => !runner.online && runsOf(runner).length > 0);
          return (
            <>
              {waiting.map((runner) => (
                <Banner key={runner.id} tone="neutral" icon={CircleAlert} role="status" title={tn('settings.runners.waiting', runsOf(runner).length, { name: runner.name })}>
                  {t('settings.runners.waiting_description')}
                </Banner>
              ))}
              <ul className="flex flex-col gap-3">
                {list.map((runner) => (
                  <li key={runner.id}>
                    <RunnerCard
                      runner={runner}
                      runs={runsOf(runner)}
                      onPlaces={() => places.show(runner)}
                      onRename={() => rename.show(runner)}
                      onRevoke={() => askRevoke(runner)}
                      onCancelRun={(run, key) => setCanceling({ runner, run, key })}
                    />
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Loaded>
      <PairingDialog key={`pairing-${pairing.round}`} open={pairing.open} onOpenChange={pairing.setOpen} finalFocus={pairing.returnFocus(connectButton)} />
      <PlacesDialog key={`places-${places.round}`} runner={places.target} open={places.open} onOpenChange={places.setOpen} finalFocus={places.returnFocus(connectButton)} />
      <RenameDialog key={`rename-${rename.round}`} runner={rename.target} open={rename.open} onOpenChange={rename.setOpen} finalFocus={rename.returnFocus(connectButton)} />
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('settings.runners.revoke.title', { name: revoking?.name ?? '' })}
        description={running > 0 ? tn('settings.runners.revoke.description_running', running) : t('settings.runners.revoke.description')}
        confirmLabel={t('settings.runners.action.revoke')}
        pending={revoke.isPending}
        finalFocus={afterRevoke}
        onConfirm={() => revoking && runRevoke(revoking)}
      />
      <AlertDialog
        open={canceling !== null}
        onOpenChange={(open) => !open && setCanceling(null)}
        title={
          canceling
            ? canceling.key
              ? t('settings.runners.cancel.title', { run: runName(canceling.run.type), key: canceling.key })
              : t('settings.runners.cancel.title_plain', { run: runName(canceling.run.type) })
            : ''
        }
        description={canceling?.run.status === 'running' ? t('settings.runners.cancel.running') : t('settings.runners.cancel.queued')}
        confirmLabel={t('settings.runners.cancel.confirm')}
        cancelLabel={t('settings.runners.cancel.keep')}
        pending={cancel.isPending}
        onConfirm={() => canceling && runCancel(canceling)}
      />
    </div>
  );
}
