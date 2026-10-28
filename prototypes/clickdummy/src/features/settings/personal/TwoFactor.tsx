/*
 * Two-factor authentication with an authenticator app and recovery codes (spec 4.2). Setting it up is a sequence of
 * two steps: scan the code (here a dummy), then type the first code the app shows (here any six digits are right). The
 * recovery codes appear once, right after, and can be copied. Switching it off, or issuing new recovery codes (the old
 * ones stop working), asks first. After each step the focus moves on to where the next one is.
 */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { now } from '@/lib/clock';
import { notifyError } from '@/lib/errors';
import type { User } from '@/types';
import { fieldErrors, useFieldErrors } from '../project/form';
import { SettingsCard } from '../project/SettingsParts';
import { CopyButton } from './CopyButton';
import { QrPlaceholder } from './QrPlaceholder';
import { useConfirmTwoFactor, useDisableTwoFactor } from './securityApi';
import { useTwoFactor, useTwoFactorOf } from './twoFactorStore';
import { generateRecoveryCodes, generateSetupKey, RECOVERY_CODE_COUNT } from './twoFactorCodes';

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

const date = (iso: string, timeZone: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(new Date(iso));

/** From md on: a field may take the focus on its own. On a phone that would open the keyboard over the QR code. */
const isWide = () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 48rem)').matches;

export function TwoFactorCard({ user }: { user: User }) {
  const record = useTwoFactorOf(user.id);
  const enable = useTwoFactor((state) => state.enable);
  const disable = useTwoFactor((state) => state.disable);
  const renewCodes = useTwoFactor((state) => state.renewCodes);
  const confirm = useConfirmTwoFactor();
  const switchOff = useDisableTwoFactor();

  const form = useRef<HTMLFormElement>(null);
  const codeList = useRef<HTMLUListElement>(null);
  const keyText = useRef<HTMLElement>(null);
  const steps = useRef<HTMLOListElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const problems = useFieldErrors(form);
  const [phase, setPhase] = useState<Phase>('idle');
  const [setupKey, setSetupKey] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [switchingOff, setSwitchingOff] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const on = record !== undefined;

  // after a step, the focus goes to where the next one is (never on the first draw)
  useEffect(() => {
    if (!moved.current) return;
    const target = phase === 'setup' ? (isWide() ? codeField.current : steps.current) : phase === 'codes' ? codeList.current : on ? status.current : startButton.current;
    // a closing dialog gives its focus back first
    const frame = requestAnimationFrame(() => target?.focus());
    return () => cancelAnimationFrame(frame);
  }, [phase, on]);

  function go(next: Phase) {
    moved.current = true;
    setPhase(next);
  }

  function startSetup() {
    setSetupKey(generateSetupKey());
    setTyped('');
    problems.clearAll();
    go('setup');
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (confirm.isPending) return;
    try {
      await confirm.mutateAsync(typed);
      enable(user.id, now().toISOString());
      setCodes(generateRecoveryCodes());
      go('codes');
      toast({ title: 'Zwei-Faktor-Authentifizierung eingeschaltet', tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (fields.code) problems.show(fields);
      else notifyError('Der Code wurde nicht geprüft', error, () => form.current?.requestSubmit());
    }
  }

  function newCodes() {
    renewCodes(user.id);
    setCodes(generateRecoveryCodes());
    setRenewing(false);
    go('codes');
    toast({ title: 'Neue Recovery-Codes erzeugt', description: 'Die alten gelten nicht mehr.', tone: 'success' });
  }

  async function switchTwoFactorOff() {
    try {
      await switchOff.mutateAsync();
      moved.current = true;
      disable(user.id);
      setSwitchingOff(false);
      setPhase('idle');
      toast({ title: 'Zwei-Faktor-Authentifizierung ausgeschaltet', tone: 'success' });
    } catch (error) {
      notifyError('Zwei-Faktor nicht ausgeschaltet', error, () => void switchTwoFactorOff());
    }
  }

  return (
    <>
      <SettingsCard
        title="Zwei-Faktor-Authentifizierung"
        description="Schütze dein Konto zusätzlich mit einem Code aus einer Authenticator-App. Beim Anmelden gibst du dann Passwort und Code ein."
        actions={<Chip>{on ? 'Aktiv' : 'Aus'}</Chip>}
        footer={
          phase === 'idle' ? (
            on ? (
              <>
                <Button variant="secondary" onClick={() => setRenewing(true)}>
                  Neue Recovery-Codes
                </Button>
                <Button variant="danger" onClick={() => setSwitchingOff(true)}>
                  Deaktivieren
                </Button>
              </>
            ) : (
              <Button ref={startButton} variant="primary" onClick={startSetup}>
                Einrichten
              </Button>
            )
          ) : phase === 'codes' ? (
            <>
              <CopyButton text={codes.join('\n')} target={() => codeList.current} label="Alle kopieren" />
              <Button variant="primary" onClick={() => go('idle')}>
                Codes sind gesichert
              </Button>
            </>
          ) : undefined
        }
      >
        {phase === 'idle' && record && (
          <div ref={status} tabIndex={-1} data-focus-ring="none" className="flex flex-col gap-1 text-ui text-ink tabular-nums outline-none">
            <p>{`Aktiv seit ${date(record.enabled_at, user.timezone)}.`}</p>
            <p className="text-muted">{`${record.recovery_codes_left} von ${RECOVERY_CODE_COUNT} Recovery-Codes sind noch übrig.`}</p>
          </div>
        )}

        {phase === 'setup' && (
          <ol ref={steps} tabIndex={-1} data-focus-ring="none" className="flex flex-col gap-6 outline-none">
            <Step number={1} title="Code scannen">
              <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">Öffne deine Authenticator-App und scanne den Code. Geht das nicht, tippst du den Schlüssel ein.</p>
              <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-3">
                <QrPlaceholder seed={setupKey} />
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <p className="text-sm text-muted">Schlüssel</p>
                  <code ref={keyText} translate="no" className="rounded-chip bg-sunken px-2 py-1 text-md font-semibold tracking-wide whitespace-nowrap text-ink tabular-nums">
                    {setupKey}
                  </code>
                  <CopyButton size="sm" text={setupKey.replaceAll(' ', '')} target={() => keyText.current} label="Schlüssel kopieren" />
                </div>
              </div>
              <p className="mt-3 max-w-[65ch] text-sm text-pretty text-muted">Attrappe: Der Klickdummy hat keinen echten Schlüssel, der Code lässt sich nicht scannen.</p>
            </Step>
            <Step number={2} title="Code bestätigen">
              <form ref={form} noValidate onSubmit={(event) => void confirmCode(event)} className="mt-2 flex max-w-xs flex-col gap-3">
                <Input
                  ref={codeField}
                  label="Code aus der App"
                  name="otp"
                  hint="Sechs Ziffern. Im Klickdummy gilt jeder Code."
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
                    Bestätigen
                  </Button>
                  <Button variant="ghost" disabled={confirm.isPending} onClick={() => go('idle')}>
                    Abbrechen
                  </Button>
                </div>
              </form>
            </Step>
          </ol>
        )}

        {phase === 'codes' && (
          <>
            <Banner tone="info" role="status" title="Speichere diese Codes jetzt">
              Jeder Code funktioniert einmal, falls du keinen Zugriff auf die App hast. werkbuch zeigt sie nur dieses eine Mal.
            </Banner>
            <ul ref={codeList} role="list" aria-label="Recovery-Codes" tabIndex={-1} className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-ctl bg-sunken p-4">
              {codes.map((code) => (
                <li key={code} translate="no" className="text-md font-semibold tabular-nums">
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
        title="Neue Recovery-Codes erzeugen?"
        description="Die bisherigen Codes werden ungültig. Die neuen siehst du einmal, gleich danach."
        confirmLabel="Erzeugen"
        onConfirm={newCodes}
      />
      <AlertDialog
        open={switchingOff}
        onOpenChange={setSwitchingOff}
        pending={switchOff.isPending}
        title="Zwei-Faktor ausschalten?"
        description="Beim Anmelden reicht danach das Passwort. Deine Recovery-Codes werden ungültig."
        confirmLabel="Ausschalten"
        onConfirm={() => void switchTwoFactorOff()}
      />
    </>
  );
}
