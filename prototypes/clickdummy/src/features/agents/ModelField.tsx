/*
 * A model is free text per CLI (spec 7.7): the field takes any name or a full id, the known ones stand below it as
 * buttons that fill it in. An empty field takes what the placeholder says ("wie beim Bot: sonnet").
 */

import { useId } from 'react';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { KNOWN_MODELS } from '@/domain/agents';
import { readOnlyField } from '@/features/settings/org/parts';
import type { AgentCli } from '@/types';

type ModelFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  cli: AgentCli;
  placeholder?: string;
  hint?: string;
  error?: string;
  readOnly?: boolean;
  /** The suggestions only on the field where they help most; rows of many fields leave them out. */
  suggestions?: boolean;
  hideLabel?: boolean;
  className?: string;
};

export function ModelField({ label, value, onChange, cli, placeholder, hint, error, readOnly = false, suggestions = true, hideLabel = false, className }: ModelFieldProps) {
  const listId = useId();
  return (
    <div className={cx('min-w-0', className)}>
      <Input
        label={hideLabel ? undefined : label}
        aria-label={hideLabel ? label : undefined}
        value={value}
        placeholder={placeholder}
        hint={hint}
        error={error}
        readOnly={readOnly}
        className={readOnly ? readOnlyField : undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        translate="no"
        list={listId}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {KNOWN_MODELS[cli].map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {suggestions && !readOnly && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Vorschläge für ${label}`}>
          {KNOWN_MODELS[cli].map((model) => (
            <button
              key={model}
              type="button"
              aria-pressed={value === model}
              onClick={() => onChange(model)}
              className="inline-flex h-11 cursor-pointer items-center rounded-chip border border-line bg-surface px-2 text-sm text-ink transition-colors duration-120 hover:border-line-input aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-text md:h-6"
              translate="no"
            >
              {model}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
