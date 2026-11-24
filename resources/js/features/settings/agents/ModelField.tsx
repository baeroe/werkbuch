/*
 * The model of a run (spec 7.7): a select like every other choice, with the fixed list of models of the CLIs
 * (`CLI_MODELS`). `ModelField` picks a model of one CLI (a bot: its default and per kind of run); where an empty value
 * inherits, the first option says from what ("Wie Standard (sonnet)"). `ModelChoice` picks a model of any CLI, the lists
 * grouped by CLI, and gives `cli:model` (a label, a project per kind of run): it counts only for agents with that CLI,
 * and the line below the field says so; read only, it shows its value in the read-only look of the settings.
 */

import { Select } from '@/components/ui/Select';
import { CLI_MODELS, CLI_NAMES, parseModel } from '@/domain/agents';
import { t } from '@/lib/i18n';
import type { AgentCli } from '@/types';
import { ReadOnlyValue } from '../frame/parts';

/** The value of the option that inherits; the field reports it as an empty string or null. */
const INHERIT = '__inherit';

const CLIS = Object.keys(CLI_MODELS) as AgentCli[];

type ModelFieldProps = {
  label: string;
  /** A model of the CLI, `''` for none (inherits). */
  value: string;
  onChange: (value: string) => void;
  cli: AgentCli;
  /** What an empty value means, as the first option; without it a model has to be chosen. */
  inherit?: string;
  hint?: string;
  error?: string;
  className?: string;
};

/** Only org admins set up a bot as an agent, so this one is never read only. */
export function ModelField({ label, value, onChange, cli, inherit, hint, error, className }: ModelFieldProps) {
  const known = CLI_MODELS[cli];
  const options = [
    ...(inherit ? [{ value: INHERIT, label: inherit }] : []),
    ...known.map((model) => ({ value: model, label: model })),
    // a model saved before the list changed still shows what it is
    ...(value !== '' && !known.includes(value) ? [{ value, label: t('settings.agents.model_unlisted', { model: value }) }] : []),
  ];
  return (
    <Select
      label={label}
      hint={hint}
      error={error}
      className={className}
      value={value === '' ? (inherit ? INHERIT : null) : value}
      placeholder={t('settings.agents.model_placeholder')}
      options={options}
      onValueChange={(next) => next !== null && onChange(next === INHERIT ? '' : next)}
    />
  );
}

type ModelChoiceProps = {
  label: string;
  /** `cli:model`, or null for none. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** What no model means, as the first option: "Wie beim Bot (…)", "Kein Modell". */
  inherit: string;
  /** Shown while no model is chosen; with one, the field says which agents it counts for. */
  hint?: string;
  error?: string;
  readOnlyReason?: string | null;
  className?: string;
  id?: string;
};

export function ModelChoice({ label, value, onChange, inherit, hint, error, readOnlyReason = null, className, id }: ModelChoiceProps) {
  const options = [
    { value: INHERIT, label: inherit },
    ...CLIS.flatMap((cli) => CLI_MODELS[cli].map((model) => ({ value: `${cli}:${model}`, label: model, group: CLI_NAMES[cli] }))),
  ];
  const ref = parseModel(value);
  // a value no list knows (a model taken out of a CLI) still shows what it is
  if (value && !ref) options.push({ value, label: t('settings.agents.model_unlisted', { model: value }), group: t('settings.agents.model_other') });
  const current = value ?? INHERIT;
  const shownHint = ref ? t('settings.agents.model_for_cli', { cli: CLI_NAMES[ref.cli] }) : hint;
  if (readOnlyReason !== null) {
    const chosen = options.find((option) => option.value === current)!;
    return <ReadOnlyValue label={label} value={ref ? `${chosen.label} (${CLI_NAMES[ref.cli]})` : chosen.label} reason={readOnlyReason} hint={shownHint} className={className} />;
  }
  return (
    <Select
      id={id}
      label={label}
      hint={shownHint}
      error={error}
      className={className}
      value={current}
      options={options}
      onValueChange={(next) => next !== null && onChange(next === INHERIT ? null : next)}
    />
  );
}
