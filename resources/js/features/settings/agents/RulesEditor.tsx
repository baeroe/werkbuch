/*
 * The working rules per kind of run (spec 7.3, 10.5): a tab per kind, the text as Markdown with "Standard
 * wiederherstellen", and above it, read only and folded, what werkbuch always gives: the contract of the kind, in English
 * as it stands in the prompt, so nobody writes it again. A port of the click dummy's `RulesEditor`.
 */

import { CircleAlert, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tab, Tabs, TabsList, TabsPanel } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { RUN_TYPES } from '@/domain/agents';
import { t } from '@/lib/i18n';
import type { AgentRule, RunType } from '@/types';
import { readOnlyField } from '../frame/parts';
import { runHint, runName } from './runTypes';

/** Per kind: the own text, or null for the standard of werkbuch. */
export type RulesValue = Record<RunType, string | null>;

type RulesEditorProps = {
  value: RulesValue;
  /** The rules as the server gives them: the standard and the contract per kind. */
  rules: readonly AgentRule[];
  /** A new text of a kind (null: the standard); one kind at a time, so the undo of a toast later puts back only its own. */
  onChange: (type: RunType, text: string | null) => void;
  readOnly: boolean;
  errors?: Partial<Record<string, string>>;
  /** The kind shown; the form opens the one a refusal names. */
  tab: RunType;
  onTabChange: (tab: RunType) => void;
};

export const rulesId = (type: RunType) => `rules-${type}`;

export function RulesEditor({ value, rules, onChange, readOnly, errors = {}, tab, onTabChange }: RulesEditorProps) {
  const ruleOf = (type: RunType) => rules.find((rule) => rule.type === type)!;
  return (
    <Tabs value={tab} onValueChange={(next) => onTabChange(next as RunType)}>
      <TabsList aria-label={t('settings.agent_rules.tabs')} className="-mx-4 px-4 md:mx-0 md:px-0">
        {RUN_TYPES.map((type) => (
          <Tab key={type} value={type} data-error={errors[`rules.${type}`] ? '' : undefined} className="data-error:text-danger">
            {runName(type)}
            {value[type] !== null && <span className="size-1.5 rounded-full bg-accent" aria-label={t('settings.agent_rules.own_mark')} role="img" />}
            {/* a refused kind is told by its icon and its name, not by the colour alone */}
            {errors[`rules.${type}`] && <CircleAlert className="size-3.5" role="img" aria-label={t('settings.agent_rules.refused_mark')} />}
          </Tab>
        ))}
      </TabsList>
      {RUN_TYPES.map((type) => {
        const own = value[type];
        const rule = ruleOf(type);
        return (
          <TabsPanel key={type} value={type} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-[60ch] text-sm text-pretty text-muted">{runHint(type)}</p>
              <span className="inline-flex h-6 items-center rounded-chip border border-line bg-sunken px-1.5 text-sm font-medium text-muted">
                {own === null ? t('settings.agent_rules.standard') : t('settings.agent_rules.own')}
              </span>
            </div>
            <details className="group rounded-card border border-line bg-sunken">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-card px-3 py-2 text-ui font-medium text-ink md:min-h-9">
                <span aria-hidden="true" className="inline-block text-muted transition-transform duration-160 group-open:rotate-90">
                  ›
                </span>
                {t('settings.agent_rules.contract.title', { type: runName(type) })}
              </summary>
              <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
                <p className="max-w-[65ch] text-sm text-pretty text-muted">{t('settings.agent_rules.contract.hint')}</p>
                <pre lang="en" translate="no" className="max-w-full overflow-x-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink">
                  {rule.contract}
                </pre>
              </div>
            </details>
            <Textarea
              id={rulesId(type)}
              label={t('settings.agent_rules.label', { type: runName(type) })}
              rows={11}
              value={own ?? rule.standard_body}
              readOnly={readOnly}
              className={readOnly ? readOnlyField : undefined}
              spellCheck
              error={errors[`rules.${type}`]}
              hint={t('settings.agent_rules.hint')}
              onChange={(event) => {
                const next = event.target.value === rule.standard_body ? null : event.target.value;
                onChange(type, next);
              }}
            />
            {!readOnly && own !== null && (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => {
                    onChange(type, null);
                    // the button goes with the own text: the focus moves to the text, now the standard
                    requestAnimationFrame(() => document.getElementById(rulesId(type))?.focus());
                    // the undo puts back this one text, into the rules as they are by then
                    toast({
                      title: t('settings.agent_rules.restored', { type: runName(type) }),
                      description: t('settings.agent_rules.restored_text'),
                      action: { label: t('common.undo'), onClick: () => onChange(type, own) },
                    });
                  }}
                >
                  {t('settings.agent_rules.restore')}
                </Button>
              </div>
            )}
          </TabsPanel>
        );
      })}
    </Tabs>
  );
}
