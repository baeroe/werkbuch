/*
 * Two-factor authentication with an authenticator app and recovery codes (spec 4.2), against the server (`/me/two-factor`,
 * Fortify, P19: no second password prompt). Setting it up is a sequence of two steps: the server hands out a new secret
 * with its QR code, then the first code of the app switches it on and the server answers the recovery codes. They show
 * once, right after, and can be copied; leaving the page before "Codes sind gesichert" asks first. What a step showed
 * once (the secret, the codes) is let go of when the step is over: out of the state and out of the mutation (whose cache
 * drops it at once, `gcTime: 0`), never logged. "Abbrechen" throws the unconfirmed secret away, so the next setup starts
 * anew. Switching it off, or issuing new recovery codes (the old ones stop working), asks first. After each step the
 * focus moves on to where the next one is.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { disableTwoFactor } from '@/api/security';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useConfirmTwoFactor, useDisableTwoFactor, useEnableTwoFactor, useRegenerateRecoveryCodes, useTwoFactor } from '@/hooks/security';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { isWide } from '@/lib/media';
import type { TwoFactorSetup, User } from '@/types';
import { fieldMessage, useFieldErrors } from '../frame/form';
import { formatDate } from '../frame/format';
import { LeaveGuard } from '../frame/LeaveGuard';
import { SettingsCard, SettingsError, SettingsSkeleton } from '../frame/parts';
import { CopyButton } from '../tokens/CopyButton';
import { QrCode, SetupKey } from './QrCode';

/** Fortify issues eight recovery codes at a time. */
export const RECOVERY_CODE_COUNT = 8;

type Phase = 'idle' | 'setup' | 'codes';

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line-input bg-surface text-sm font-semibold text-ink tabular-nums"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-md font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </li>
  );
}

type Props = {
  user: User;
  /** Whether the recovery codes show right now (the password form leaves the question on leaving to them). */
  onCodesShown: (shown: boolean) => void;
};

export function TwoFactorCard({ user, onCodesShown }: Props) {
  const status = useTwoFactor();
  const enable = useEnableTwoFactor();
  const confirm = useConfirmTwoFactor();
  const discard = useDisableTwoFactor();
  const switchOff = useDisableTwoFactor();
  const regenerate = useRegenerateRecoveryCodes();

  const form = useRef<HTMLFormElement>(null);
  const codeList = useRef<HTMLUListElement>(null);
  const steps = useRef<HTMLOListElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const statusText = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const problems = useFieldErrors(form);
  const [phase, setPhase] = useState<Phase>('idle');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [switchingOff, setSwitchingOff] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const on = status.data?.enabled === true;

  useEffect(() => onCodesShown(phase === 'codes'), [phase, onCodesShown]);

  // a setup left half-way (another section, another page) is thrown away like "Abbrechen": no secret stays pending
  const queryClient = useQueryClient();
  const current = useRef(phase);
  useEffect(() => {
    current.current = phase;
  }, [phase]);
  useEffect(
    () => () => {
      if (current.current !== 'setup') return;
      // the screen is gone, there is nobody to tell about a failure: the next setup starts anew anyway
      void disableTwoFactor().then(
        () => queryClient.invalidateQueries({ queryKey: qk.twoFactor.all }),
        () => undefined,
      );
    },
    [queryClient],
  );

  // after a step, the focus goes to where the next one is (never on the first draw)
  useEffect(() => {
    if (!moved.current) return;
    // from md on the code field may take the focus on its own; on a phone that would open the keyboard over the QR code
    const target = phase === 'setup' ? (isWide() ? codeField.current : steps.current) : phase === 'codes' ? codeList.current : on ? statusText.current : startButton.current;
    // a closing dialog gives its focus back first
    const frame = requestAnimationFrame(() => target?.focus());
    return () => cancelAnimationFrame(frame);
  }, [phase, on]);

  function go(next: Phase) {
    moved.current = true;
    // what a step showed once goes with it: the secret once the setup is over, the codes once they are saved
    if (next !== 'setup') {
      setSetup(null);
      enable.reset();
    }
    if (next !== 'codes') {
      setCodes([]);
      confirm.reset();
      regenerate.reset();
    }
    setPhase(next);
  }

  async function startSetup() {
    if (enable.isPending) return;
    try {
      const started = await enable.mutateAsync(undefined);
      setSetup(started);
      setTyped('');
      problems.clearAll();
      go('setup');
    } catch (error) {
      notifyError(t('settings.two_factor.not_started'), error, () => void startSetup());
    }
  }

  async function discardSetup() {
    try {
      await discard.mutateAsync(undefined);
    } catch (error) {
      notifyError(t('settings.two_factor.not_discarded'), error, () => void discardSetup());
    }
  }

  function cancelSetup() {
    go('idle');
    void discardSetup();
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (confirm.isPending) return;
    try {
      // apps show the code as `123 456`
      const { recovery_codes } = await confirm.mutateAsync(typed.replace(/\s+/g, ''));
      setCodes(recovery_codes);
      go('codes');
      toast({ title: t('settings.two_factor.enabled'), tone: 'success' });
    } catch (error) {
      const message = fieldMessage(error, 'code');
      if (message) problems.show({ code: message });
      else notifyError(t('settings.two_factor.not_checked'), error, () => form.current?.requestSubmit());
    }
  }

  async function newCodes() {
    try {
      const { recovery_codes } = await regenerate.mutateAsync(undefined);
      setRenewing(false);
      setCodes(recovery_codes);
      go('codes');
      toast({ title: t('settings.two_factor.renewed'), description: t('settings.two_factor.renewed_description'), tone: 'success' });
    } catch (error) {
      notifyError(t('settings.two_factor.not_renewed'), error, () => void newCodes());
    }
  }

  async function switchTwoFactorOff() {
    try {
      await switchOff.mutateAsync(undefined);
      moved.current = true;
      setSwitchingOff(false);
      setPhase('idle');
      toast({ title: t('settings.two_factor.disabled'), tone: 'success' });
    } catch (error) {
      notifyError(t('settings.two_factor.not_disabled'), error, () => void switchTwoFactorOff());
    }
  }

  if (status.isPending) return <SettingsSkeleton rows={1} label={t('settings.two_factor.loading')} />;
  // a refetch that fails later (after the codes came) keeps the card and its codes: only a first load shows the error
  if (status.isError && !status.data) {
    return <SettingsError title={t('settings.two_factor.load_failed')} error={status.error} retrying={status.isFetching} onRetry={() => void status.refetch()} />;
  }

  return (
    <>
      <LeaveGuard
        dirty={phase === 'codes'}
        question={{
          title: t('settings.two_factor.leave.title'),
          description: t('settings.two_factor.leave.description'),
          cancelLabel: t('settings.two_factor.leave.cancel'),
          confirmLabel: t('settings.two_factor.leave.confirm'),
        }}
      />
      <SettingsCard
        title={t('settings.two_factor.title')}
        description={t('settings.two_factor.description')}
        actions={<Chip>{on ? t('settings.two_factor.on') : t('settings.two_factor.off')}</Chip>}
        footer={
          phase === 'idle' ? (
            on ? (
              <>
                <Button variant="secondary" onClick={() => setRenewing(true)}>
                  {t('settings.two_factor.renew')}
                </Button>
                <Button variant="danger" onClick={() => setSwitchingOff(true)}>
                  {t('settings.two_factor.disable')}
                </Button>
              </>
            ) : (
              <Button ref={startButton} variant="primary" pending={enable.isPending} onClick={() => void startSetup()}>
                {t('settings.two_factor.setup')}
              </Button>
            )
          ) : phase === 'codes' ? (
            <>
              <CopyButton text={codes.join('\n')} target={() => codeList.current} label={t('settings.two_factor.copy_all')} />
              <Button variant="primary" onClick={() => go('idle')}>
                {t('settings.two_factor.codes_saved')}
              </Button>
            </>
          ) : undefined
        }
      >
        {phase === 'idle' && on && (
          <div ref={statusText} tabIndex={-1} data-focus-ring="none" className="flex flex-col gap-1 text-ui text-ink tabular-nums outline-none">
            {status.data.confirmed_at && <p>{t('settings.two_factor.active_since', { date: formatDate(status.data.confirmed_at, user.timezone) })}</p>}
            <p className="text-muted">{t('settings.two_factor.codes_left', { left: status.data.recovery_codes_left, total: RECOVERY_CODE_COUNT })}</p>
          </div>
        )}

        {phase === 'setup' && setup && (
          <ol ref={steps} tabIndex={-1} data-focus-ring="none" className="flex flex-col gap-6 outline-none">
            <Step number={1} title={t('settings.two_factor.scan.title')}>
              <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">{t('settings.two_factor.scan.text')}</p>
              <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-3">
                <QrCode src={setup.qr_svg} />
                <SetupKey secret={setup.secret} />
              </div>
            </Step>
            <Step number={2} title={t('settings.two_factor.confirm.title')}>
              <form ref={form} noValidate onSubmit={(event) => void confirmCode(event)} className="mt-2 flex max-w-xs flex-col gap-3">
                <Input
                  ref={codeField}
                  label={t('settings.two_factor.confirm.code')}
                  name="otp"
                  hint={t('settings.two_factor.confirm.code_hint')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={7}
                  value={typed}
                  error={problems.errors.code}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    problems.clear('code');
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" type="submit" pending={confirm.isPending}>
                    {t('settings.two_factor.confirm.submit')}
                  </Button>
                  <Button variant="ghost" disabled={confirm.isPending} onClick={cancelSetup}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            </Step>
          </ol>
        )}

        {phase === 'codes' && (
          <>
            <Banner tone="info" role="status" title={t('settings.two_factor.codes.title')}>
              {t('settings.two_factor.codes.text')}
            </Banner>
            <ul
              ref={codeList}
              role="list"
              aria-label={t('settings.two_factor.codes.label')}
              tabIndex={-1}
              className="grid gap-x-6 gap-y-2 rounded-ctl bg-sunken p-4 sm:grid-cols-2"
            >
              {codes.map((code) => (
                <li key={code} translate="no" className="text-md font-semibold [overflow-wrap:anywhere] tabular-nums">
                  {code}
                </li>
              ))}
            </ul>
          </>
        )}
      </SettingsCard>
      <AlertDialog
        open={renewing}
        onOpenChange={setRenewing}
        pending={regenerate.isPending}
        title={t('settings.two_factor.renew_dialog.title')}
        description={t('settings.two_factor.renew_dialog.description')}
        confirmLabel={t('settings.two_factor.renew_dialog.confirm')}
        onConfirm={() => void newCodes()}
      />
      <AlertDialog
        open={switchingOff}
        onOpenChange={setSwitchingOff}
        pending={switchOff.isPending}
        title={t('settings.two_factor.disable_dialog.title')}
        description={t('settings.two_factor.disable_dialog.description')}
        confirmLabel={t('settings.two_factor.disable_dialog.confirm')}
        onConfirm={() => void switchTwoFactorOff()}
      />
    </>
  );
}
