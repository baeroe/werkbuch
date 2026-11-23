/*
 * The working rules per kind of run (spec 7.3, 10.8): a tab per kind, the text as Markdown with "Standard
 * wiederherstellen", and above it, read only and folded, what werkbuch always gives: the contract of the kind, in
 * English as it stands in the prompt, so nobody writes it again.
 */

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Tab, Tabs, TabsList, TabsPanel } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { RUN_TYPE_HINTS, RUN_TYPE_NAMES, RUN_TYPES } from '@/domain/agents';
import type { AgentRules, RunType } from '@/types';

const READ_ONLY = 'bg-sunken! shadow-none!';

type RulesEditorProps = {
  value: AgentRules;
  /** The standard werkbuch ships per kind. */
  defaults: Record<RunType, string>;
  /** The contract per kind: always first in the prompt. */
  contracts: Record<RunType, string>;
  /** Takes a change of the rules as they are when it applies: the undo of a toast comes later. */
  onChange: (change: (rules: AgentRules) => AgentRules) => void;
  readOnly: boolean;
  errors?: Partial<Record<string, string>>;
};

export function RulesEditor({ value, defaults, contracts, onChange, readOnly, errors = {} }: RulesEditorProps) {
  const [tab, setTab] = useState<RunType>('task');
  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as RunType)}>
      <TabsList aria-label="Arbeitsregeln je Auftragstyp" className="-mx-4 px-4 md:mx-0 md:px-0">
        {RUN_TYPES.map((type) => (
          <Tab key={type} value={type}>
            {RUN_TYPE_NAMES[type]}
            {value[type] !== null && <span className="size-1.5 rounded-full bg-accent" aria-label="eigener Text" role="img" />}
          </Tab>
        ))}
      </TabsList>
      {RUN_TYPES.map((type) => {
        const own = value[type];
        const text = own ?? defaults[type];
        return (
          <TabsPanel key={type} value={type} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-[60ch] text-sm text-pretty text-muted">{RUN_TYPE_HINTS[type]}</p>
              <span className="inline-flex h-6 items-center rounded-chip border border-line bg-sunken px-1.5 text-sm font-medium text-muted">{own === null ? 'Standard von werkbuch' : 'Eigener Text'}</span>
            </div>
            <details className="group rounded-card border border-line bg-sunken">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-card px-3 py-2 text-ui font-medium text-ink md:min-h-9">
                <span aria-hidden="true" className="inline-block text-muted transition-transform duration-160 group-open:rotate-90">
                  ›
                </span>
                {`Gibt werkbuch immer vor („${RUN_TYPE_NAMES[type]}“)`}
              </summary>
              <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
                <p className="max-w-[65ch] text-sm text-pretty text-muted">Steht schon im Prompt, vor den Arbeitsregeln; hier nicht wiederholen. Platzhalter wie {'{key}'} füllt werkbuch je Auftrag.</p>
                <pre lang="en" translate="no" className="max-w-full overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink">
                  {contracts[type]}
                </pre>
              </div>
            </details>
            <Textarea
              label={`Arbeitsregeln für „${RUN_TYPE_NAMES[type]}“`}
              rows={11}
              value={text}
              readOnly={readOnly}
              className={readOnly ? READ_ONLY : undefined}
              spellCheck
              error={errors[`rules.${type}`]}
              hint="Markdown. Steht in jedem Auftrag dieses Typs nach dem Vertrag oben; danach folgen das Vorgehen des Item-Typs, die Projektinformationen und CLAUDE.md im Repo."
              onChange={(event) => {
                const next = event.target.value === defaults[type] ? null : event.target.value;
                onChange((rules) => ({ ...rules, [type]: next }));
              }}
            />
            {!readOnly && own !== null && (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => {
                    onChange((rules) => ({ ...rules, [type]: null }));
                    // the undo puts back this one text, into the rules as they are by then
                    toast({ title: `Standard für „${RUN_TYPE_NAMES[type]}“ wiederhergestellt`, description: 'Gilt nach dem Speichern.', action: { label: 'Rückgängig', onClick: () => onChange((rules) => ({ ...rules, [type]: own })) } });
                  }}
                >
                  Standard wiederherstellen
                </Button>
              </div>
            )}
          </TabsPanel>
        );
      })}
    </Tabs>
  );
}
