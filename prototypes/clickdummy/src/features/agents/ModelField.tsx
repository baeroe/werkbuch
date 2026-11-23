/*
 * The model of a run (spec 7.7): a select like every other choice, with the fixed list of models of the CLI
 * (`KNOWN_MODELS`). Where an empty value inherits, the first option says what from: "Wie beim Bot (sonnet)",
 * "Wie Standard (sonnet)", "Kein Modell". Read only, it is disabled like the other choices of a settings page.
 */

import { Select } from '@/components/ui/Select';
import { CLI_NAMES, KNOWN_MODELS } from '@/domain/agents';
import type { AgentCli, ModelRef } from '@/types';

/** The value of the option that inherits; the field reports it as an empty string. */
const INHERIT = '__inherit';

type ModelFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  cli: AgentCli;
  /** What an empty value means, as the first option; without it a model has to be chosen. */
  inherit?: string;
  hint?: string;
  error?: string;
  readOnly?: boolean;
  className?: string;
};

export function ModelField({ label, value, onChange, cli, inherit, hint, error, readOnly = false, className }: ModelFieldProps) {
  const known = KNOWN_MODELS[cli];
  const options = [
    ...(inherit ? [{ value: INHERIT, label: inherit }] : []),
    ...known.map((model) => ({ value: model, label: model })),
    // a model saved before the list changed still shows what it is
    ...(value !== '' && !known.includes(value) ? [{ value, label: `${value} (nicht in der Liste)` }] : []),
  ];
  return (
    <Select
      label={label}
      hint={hint}
      error={error}
      disabled={readOnly}
      className={className}
      value={value === '' ? (inherit ? INHERIT : null) : value}
      placeholder="Modell wählen …"
      options={options}
      onValueChange={(next) => next !== null && onChange(next === INHERIT ? '' : next)}
    />
  );
}

type ModelChoiceProps = {
  label: string;
  value: ModelRef | null;
  onChange: (value: ModelRef | null) => void;
  /** What no model means, as the first option: "Wie beim Bot (…)", "Kein Modell". */
  inherit: string;
  /** Shown while no model is chosen; with one, the field says which agents it counts for. */
  hint?: string;
  error?: string;
  readOnly?: boolean;
  className?: string;
};

/**
 * A model of any CLI, the lists grouped by CLI (spec 7.7): the project per kind of run and a model label. What is chosen
 * is stored with its CLI and counts only for agents with that CLI; the line below the field says so.
 */
export function ModelChoice({ label, value, onChange, inherit, hint, error, readOnly = false, className }: ModelChoiceProps) {
  const clis = Object.keys(KNOWN_MODELS) as AgentCli[];
  const options = [
    { value: INHERIT, label: inherit },
    ...clis.flatMap((cli) => KNOWN_MODELS[cli].map((model) => ({ value: `${cli}:${model}`, label: model, group: CLI_NAMES[cli] }))),
  ];
  const current = value && value.model !== '' ? `${value.cli}:${value.model}` : INHERIT;
  return (
    <Select
      label={label}
      hint={value && value.model !== '' ? `Gilt nur für Agenten mit ${CLI_NAMES[value.cli]}.` : hint}
      error={error}
      disabled={readOnly}
      className={className}
      value={current}
      options={options}
      onValueChange={(next) => {
        if (next === null) return;
        if (next === INHERIT) return onChange(null);
        const [cli, model] = next.split(':') as [AgentCli, string];
        onChange({ cli, model });
      }}
    />
  );
}
