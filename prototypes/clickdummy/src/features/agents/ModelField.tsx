/*
 * The model of a run (spec 7.7): a select like every other choice, with the fixed list of models of the CLI
 * (`KNOWN_MODELS`). Where an empty value inherits, the first option says what from: "Wie beim Bot (sonnet)",
 * "Wie Standard (sonnet)", "Kein Modell". Read only, it is disabled like the other choices of a settings page.
 */

import { Select } from '@/components/ui/Select';
import { KNOWN_MODELS } from '@/domain/agents';
import type { AgentCli } from '@/types';

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
