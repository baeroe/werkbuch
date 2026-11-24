/*
 * "Runner verbinden" (spec 6.2, A473; port of the clickdummy): every opening makes a new one-time code, and with it the
 * command that installs the runner from this instance. The dialog says how long the code holds (the clock ticks), offers
 * a new one, and asks every two seconds whether a runner redeemed it (A580). Once one did, it names the runner as the
 * list has it now and gives the focus to "Fertig". The code is in the answer of making it only: it lives in this dialog
 * and goes with it.
 */

import { Link } from '@inertiajs/react';
import { useQueryClient } from '@tanstack/react-query';
import { Laptop, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { qk } from '@/hooks/keys';
import { useSettle } from '@/hooks/mutation';
import { useCreatePairing, usePairing, useRunners } from '@/hooks/runners';
import { notifyError } from '@/lib/errors';
import { t, tx } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { RunnerPairing } from '@/types';
import { errorText } from '../../frame/form';
import { useOrgZone } from '../../frame/format';
import { CommandBlock } from './CommandBlock';
import { placesSummary } from './RunnerDialogs';
import { clockTime, remaining, systemOf, useNow } from './runnerParts';

type PairingProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
};

export function PairingDialog({ open, onOpenChange, finalFocus }: PairingProps) {
  const settle = useSettle();
  const queryClient = useQueryClient();
  const create = useCreatePairing();
  const [made, setMade] = useState<RunnerPairing | null>(null);
  const zone = useOrgZone();
  const runners = useRunners();
  const at = useNow(open);
  const left = made ? Date.parse(made.expires_at) - at : 0;
  const expired = made !== null && left <= 0;
  const pairing = usePairing(made?.id ?? null, { waiting: open && !expired });
  const runnerId = pairing.data?.runner_id ?? null;
  const connected = runnerId ? (runners.data?.items.find((runner) => runner.id === runnerId) ?? null) : null;
  const done = useRef<HTMLButtonElement>(null);

  function newCode() {
    settle(create.mutateAsync(undefined), {
      onSuccess: (created) => setMade(created),
      // without a code the dialog says so itself (with "Erneut versuchen"); a new code that failed leaves the old one
      onError: (error) => made && notifyError(t('settings.runners.pairing.failed'), error, newCode),
    });
  }

  // every opening starts with a new code (the dialog is mounted anew for each round); once, also in strict mode, where a
  // second code would end the first
  const asked = useRef(false);
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    newCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `newCode` is a new function every render; the effect runs once
  }, [open]);

  // a runner redeemed the code: the list loads it (it is new), then the dialog names it
  useEffect(() => {
    if (runnerId) void queryClient.invalidateQueries({ queryKey: qk.runners.all });
  }, [runnerId, queryClient]);

  // the button that had the focus („Neuer Code“) is gone: „Fertig“ takes it once it is drawn; the dialog's focus guard
  // moves a lost focus to the dialog a moment later, so it holds on for a few frames
  const connectedId = connected?.id;
  useEffect(() => {
    if (!connectedId) return;
    let tries = 0;
    let frame = 0;
    const take = () => {
      if (done.current && document.activeElement !== done.current) done.current.focus();
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
      finalFocus={finalFocus}
      title={connected ? t('settings.runners.pairing.connected_title', { name: connected.name }) : t('settings.runners.connect')}
      description={connected ? t('settings.runners.pairing.connected_description') : t('settings.runners.pairing.description')}
      footer={
        connected ? (
          <>
            <Link href={paths.settings('bots')} onClick={() => onOpenChange(false)} className="inline-flex h-11 items-center rounded-ctl px-3 text-ui font-medium text-accent-text hover:bg-hover md:h-8">
              {t('settings.runners.pairing.to_bots')}
            </Link>
            <DialogClose
              render={
                <Button ref={done} variant="primary" data-pairing-done="">
                  {t('settings.runners.pairing.done')}
                </Button>
              }
            />
          </>
        ) : (
          <DialogClose render={<Button variant="ghost">{t('common.close')}</Button>} />
        )
      }
    >
      {connected ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-ctl border border-line bg-surface p-3 text-ui">
          <dt className="text-muted">{t('settings.runners.field.system')}</dt>
          <dd className="text-ink">{systemOf(connected)}</dd>
          <dt className="text-muted">{t('settings.runners.field.version')}</dt>
          <dd className="text-ink tabular-nums" translate="no">
            {connected.version}
          </dd>
          <dt className="text-muted">{t('settings.runners.field.places')}</dt>
          <dd className="text-ink">{t('settings.runners.pairing.places', { places: placesSummary(connected.slots) })}</dd>
          <dt className="text-muted">{t('settings.runners.pairing.projects')}</dt>
          <dd className="text-ink">{t('settings.runners.pairing.projects_all')}</dd>
        </dl>
      ) : (
        <div className="flex flex-col gap-4">
          {made ? (
            <>
              <CommandBlock label={t('settings.runners.pairing.command')} command={made.command ?? ''} hint={t('settings.runners.pairing.command_hint')} />
              {expired ? (
                <Banner
                  tone="danger"
                  role="alert"
                  title={t('settings.runners.pairing.expired_title')}
                  action={
                    <Button variant="secondary" size="sm" icon={RefreshCw} pending={create.isPending} onClick={newCode}>
                      {t('settings.runners.pairing.new_code_again')}
                    </Button>
                  }
                >
                  {t('settings.runners.pairing.expired')}
                </Banner>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-ui text-ink">
                    {tx('settings.runners.pairing.code', {
                      code: (
                        <span className="font-semibold tabular-nums" translate="no">
                          {made.code}
                        </span>
                      ),
                      time: clockTime(made.expires_at, zone),
                    })}{' '}
                    <span className="text-muted tabular-nums">{t('settings.runners.pairing.left', { left: remaining(left) })}</span>
                  </p>
                  <Button variant="ghost" size="sm" icon={RefreshCw} pending={create.isPending} onClick={newCode}>
                    {t('settings.runners.pairing.new_code')}
                  </Button>
                </div>
              )}
              {!expired && (
                <p role="status" className="flex items-center gap-2 rounded-ctl border border-dashed border-line-strong px-3 py-2.5 text-ui text-muted">
                  <Laptop className="size-4 shrink-0" aria-hidden="true" />
                  {runnerId ? t('settings.runners.pairing.redeemed') : t('settings.runners.pairing.waiting')}
                </p>
              )}
            </>
          ) : create.isError ? (
            <Banner
              tone="danger"
              role="alert"
              title={t('settings.runners.pairing.failed')}
              action={
                <Button variant="secondary" size="sm" icon={RefreshCw} pending={create.isPending} onClick={newCode}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorText(create.error)}
            </Banner>
          ) : (
            <p role="status" className="text-ui text-muted">
              {t('settings.runners.pairing.creating')}
            </p>
          )}
          <Banner tone="neutral" icon={ShieldCheck} title={t('settings.runners.pairing.user_title')}>
            {t('settings.runners.pairing.user')}
          </Banner>
        </div>
      )}
    </Dialog>
  );
}
