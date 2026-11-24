/*
 * Organisation → Agenten (spec 7.3, 10.5): the working rules per kind of run, for every project. The order in the prompt
 * stands on top; per kind the contract werkbuch always gives is folded above the text. Org admins with the catalogs
 * change the rules (`org.manage_catalog`), members read them. Saving sends one call per kind that changed (the API takes
 * one kind at a time); a refusal opens the tab of its kind. A port of the click dummy's `AgentRules.tsx`.
 */

import { Link } from '@inertiajs/react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { toast } from '@/components/ui/toast';
import { RUN_TYPES } from '@/domain/agents';
import { useAgentRules, useSaveAgentRule } from '@/hooks/agents';
import { notifyError } from '@/lib/errors';
import { t, tx } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { AgentRule, RunType } from '@/types';
import { RulesEditor, type RulesValue } from '../../agents/RulesEditor';
import { SaveBar } from '../../agents/SaveBar';
import { ReadOnlyNotice } from '../../frame/access';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '../../frame/form';
import { LeaveGuard } from '../../frame/LeaveGuard';
import { FormSkeleton, Loaded, SectionHeader, SettingsCard } from '../../frame/parts';
import type { SectionProps } from '../sections';

const linkClass = 'font-medium text-accent-text underline-offset-2 hover:underline';

/** The layers of a prompt, in their order (spec 7.3). */
function PromptOrder() {
  const layer = (name: string, text: ReactNode) => (
    <li>
      <span className="font-medium">{name}</span> <span className="text-muted">{text}</span>
    </li>
  );
  return (
    <SettingsCard title={t('settings.agent_rules.order.title')} description={t('settings.agent_rules.order.description')}>
      <ol className="flex max-w-[70ch] list-decimal flex-col gap-1 pl-5 text-ui text-pretty text-ink marker:text-muted">
        {layer(t('settings.agent_rules.order.contract'), t('settings.agent_rules.order.contract_text'))}
        {layer(t('settings.agent_rules.order.rules'), t('settings.agent_rules.order.rules_text'))}
        {layer(
          t('settings.agent_rules.order.guidance'),
          tx('settings.agent_rules.order.guidance_text', {
            link: (
              <Link href={paths.settings('types')} className={linkClass}>
                {t('settings.org.section.types')}
              </Link>
            ),
          }),
        )}
        {layer(t('settings.agent_rules.order.project'), t('settings.agent_rules.order.project_text'))}
        {layer(t('settings.agent_rules.order.repo'), t('settings.agent_rules.order.repo_text'))}
      </ol>
    </SettingsCard>
  );
}

const valueOf = (rules: readonly AgentRule[]): RulesValue =>
  Object.fromEntries(RUN_TYPES.map((type) => {
    const rule = rules.find((entry) => entry.type === type);
    return [type, !rule || rule.standard ? null : rule.body];
  })) as RulesValue;

function RulesForm({ rules, readOnly }: { rules: AgentRule[]; readOnly: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const save = useSaveAgentRule();
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<RunType>('task');
  const source = useMemo(() => valueOf(rules), [rules]);
  const draft = useDraft(source);
  const problems = useFieldErrors(form);
  useSaveShortcut(form, !readOnly);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || saving) return;
    const changed = RUN_TYPES.filter((type) => draft.value[type] !== source[type]);
    if (changed.length === 0) return draft.tellNothingToSave();
    setSaving(true);
    for (const type of changed) {
      try {
        await save.mutateAsync({ type, body: draft.value[type] });
      } catch (error) {
        setSaving(false);
        const fields = fieldErrors(error);
        if (error instanceof ApiError && error.status === 422 && Object.keys(fields).length > 0) {
          setTab(type);
          problems.show({ [`rules.${type}`]: Object.values(fields)[0]! });
        } else notifyError(t('settings.agent_rules.not_saved'), error, () => form.current?.requestSubmit());
        return;
      }
    }
    setSaving(false);
    draft.reset();
    problems.clearAll();
    toast({ title: t('settings.agent_rules.saved'), description: t('settings.agent_rules.saved_text'), tone: 'success' });
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {!readOnly && <LeaveGuard dirty={draft.dirty} what={t('settings.agent_rules.leave_what')} />}
      <SettingsCard title={t('settings.agent_rules.card.title')} description={t('settings.agent_rules.card.description')}>
        <RulesEditor
          value={draft.value}
          rules={rules}
          readOnly={readOnly}
          errors={problems.errors}
          tab={tab}
          onTabChange={setTab}
          onChange={(type, text) => {
            draft.set({ [type]: text });
            problems.clear(`rules.${type}`);
          }}
        />
      </SettingsCard>
      {!readOnly && (
        <SaveBar
          dirty={draft.dirty}
          pending={saving}
          quiet={draft.quiet}
          onReset={() => {
            draft.reset();
            problems.clearAll();
          }}
        />
      )}
    </form>
  );
}

export default function AgentRules({ readOnlyReason }: SectionProps) {
  const rules = useAgentRules();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.org.section.agents')} description={t('settings.agent_rules.description')} />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <PromptOrder />
      <Loaded queries={[rules]} keepData failure={t('settings.agent_rules.load_failed')} skeleton={<FormSkeleton label={t('settings.agent_rules.loading')} />}>
        {() => <RulesForm rules={rules.data!} readOnly={readOnlyReason !== null} />}
      </Loaded>
    </div>
  );
}
