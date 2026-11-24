/*
 * The small dialogs of a runner (spec 8.4, 10.1; port of the clickdummy): its places, set here and not on the machine
 * (whole numbers from 1 to 16, per repo at most as many as in all; the server says so at the field), and its name, which
 * only werkbuch knows. Both send only their own key; a refusal stands at its field.
 */

import { useState, type RefObject } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useUpdateRunner } from '@/hooks/runners';
import { useSettle } from '@/hooks/mutation';
import { isTransient, notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Runner, RunnerSlots } from '@/types';
import { fieldMessage, noticeOf } from '../../frame/form';

type DialogProps = {
  runner: Runner | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
};

const POTS: { key: keyof RunnerSlots; label: () => string; hint: () => string }[] = [
  { key: 'total', label: () => t('settings.runners.pot.total'), hint: () => t('settings.runners.slots.total_hint') },
  { key: 'per_repo', label: () => t('settings.runners.pot.per_repo'), hint: () => t('settings.runners.slots.per_repo_hint') },
  { key: 'light', label: () => t('settings.runners.pot.light'), hint: () => t('settings.runners.slots.light_hint') },
];

/** "2 gesamt, 1 je Repo, 2 für Reviews und Antworten." */
export const placesSummary = (slots: RunnerSlots) => t('settings.runners.slots.summary', { total: slots.total, per_repo: slots.per_repo, light: slots.light });

/** A number as typed: digits only, otherwise `null` (the server names it at the field). */
const whole = (text: string): number | null => (/^\s*\d+\s*$/.test(text) ? Number(text) : null);

export function PlacesDialog({ runner, open, onOpenChange, finalFocus }: DialogProps) {
  const settle = useSettle();
  const save = useUpdateRunner();
  const [values, setValues] = useState<Record<keyof RunnerSlots, string>>({
    total: String(runner?.slots.total ?? ''),
    per_repo: String(runner?.slots.per_repo ?? ''),
    light: String(runner?.slots.light ?? ''),
  });

  function send() {
    if (!runner) return;
    // as typed: what is no whole number goes as null, and the server's sentence stands at the field
    const slots = { total: whole(values.total), per_repo: whole(values.per_repo), light: whole(values.light) } as unknown as RunnerSlots;
    settle(save.mutateAsync({ id: runner.id, slots }), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: t('settings.runners.slots.done', { name: saved.name }), description: placesSummary(saved.slots), tone: 'success' });
      },
      onError: (error) => {
        if (isTransient(error)) notifyError(t('settings.runners.slots.failed', { name: runner.name }), error, send);
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('settings.runners.slots.title', { name: runner?.name ?? '' })}
      description={t('settings.runners.slots.description')}
      submitLabel={t('settings.frame.save')}
      pending={save.isPending}
      notice={isTransient(save.error) ? null : noticeOf(save.error, ['slots.total', 'slots.per_repo', 'slots.light'])}
      finalFocus={finalFocus}
      onSubmit={send}
    >
      {POTS.map((pot) => (
        <Input
          key={pot.key}
          label={pot.label()}
          name={`slots_${pot.key}`}
          inputMode="numeric"
          autoComplete="off"
          value={values[pot.key]}
          hint={pot.hint()}
          error={fieldMessage(save.error, `slots.${pot.key}`)}
          onChange={(event) => setValues((current) => ({ ...current, [pot.key]: event.target.value }))}
        />
      ))}
    </FormDialog>
  );
}

export function RenameDialog({ runner, open, onOpenChange, finalFocus }: DialogProps) {
  const settle = useSettle();
  const rename = useUpdateRunner();
  const [name, setName] = useState(runner?.name ?? '');
  const [attempted, setAttempted] = useState(false);
  const error = attempted && name.trim() === '' ? t('settings.runners.rename.required') : fieldMessage(rename.error, 'name');

  function send() {
    setAttempted(true);
    if (!runner || name.trim() === '') return;
    settle(rename.mutateAsync({ id: runner.id, name }), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: t('settings.runners.rename.done', { name: saved.name }), tone: 'success' });
      },
      onError: (error) => {
        if (isTransient(error)) notifyError(t('settings.runners.rename.failed', { name: runner.name }), error, send);
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('settings.runners.rename.title', { name: runner?.name ?? '' })}
      description={t('settings.runners.rename.description')}
      submitLabel={t('settings.runners.action.rename')}
      pending={rename.isPending}
      notice={isTransient(rename.error) ? null : noticeOf(rename.error, ['name'])}
      finalFocus={finalFocus}
      onSubmit={send}
    >
      <Input
        label={t('settings.runners.rename.name')}
        name="runner_name"
        autoComplete="off"
        spellCheck={false}
        value={name}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          setAttempted(false);
        }}
      />
    </FormDialog>
  );
}
