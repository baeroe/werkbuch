/*
 * "Agenten" in the workflow editor (spec 7.4): the status werkbuch sets in each of the four steps of an agent, a status
 * of this workflow of a category the step accepts. Only with all four do agents work in the projects of the workflow.
 * A proposal by name and category is only a proposal until it is taken, and taking it fills only empty steps. A step
 * on a status the draft removes says before the save what becomes of it (it follows the status that takes over the
 * items, when that one has the category; `agentStatesToSend`). "In Arbeit" and "In Review" need two statuses. A port of
 * `AgentSteps` of the click dummy's `WorkflowEditor.tsx`; members read it locked like the rest of the editor.
 */

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { AGENT_STEPS, ALL_STEPS, fitsStep, missingSteps, STEP_CATEGORIES, suggestSteps, type AgentSteps as Steps } from '@/domain/agents';
import { intlLocale, t, type TranslationKey } from '@/lib/i18n';
import type { AgentStep, StateCategory, Workflow } from '@/types';
import { CATEGORY_LABELS } from '../../catalog/choices';
import { Panel } from '../../frame/parts';
import type { Draft } from './draft';

/** The name of a step, as the server says it too (`AgentStep::label`). */
export const STEP_NAMES: Record<AgentStep, TranslationKey> = {
  working: 'catalog.agent_step.working',
  review: 'catalog.agent_step.review',
  correction: 'catalog.agent_step.correction',
  merged: 'catalog.agent_step.merged',
  ready: 'catalog.agent_step.ready',
};

const STEP_HINTS: Record<AgentStep, TranslationKey> = {
  working: 'settings.workflows.agents.hint.working',
  review: 'settings.workflows.agents.hint.review',
  correction: 'settings.workflows.agents.hint.correction',
  merged: 'settings.workflows.agents.hint.merged',
  ready: 'settings.workflows.agents.hint.ready',
};

/** "Started", "Unstarted oder Backlog": the categories a step accepts, in words. */
export const categoriesText = (categories: readonly StateCategory[]): string =>
  new Intl.ListFormat(intlLocale(), { type: 'disjunction' }).format(categories.map((category) => t(CATEGORY_LABELS[category])));

/** The id of the select of a step, for the focus. */
export const agentStepId = (step: AgentStep) => `agent-step-${step}`;

/** "In Arbeit" and "In Review" on one status would make the steps indistinguishable (A540): the error stands at review. */
export const sameStatus = (steps: Steps): boolean => steps.working !== null && steps.working === steps.review;

/**
 * The proposal for the steps of a draft (`suggestSteps`), without a review on the status of "In Arbeit" (a workflow
 * with one started status has no second one to offer).
 */
export function proposalOf(draft: Draft): Steps {
  const raw = suggestSteps(draft.states.map((state) => ({ ...state, name: state.name.trim() })));
  return { ...raw, review: raw.review !== null && raw.review === (draft.agent_states.working ?? raw.working) ? null : raw.review };
}

type AgentStepsProps = {
  draft: Draft;
  /** The saved workflow: a step whose status is not in the draft any more says its name. */
  saved: Workflow | null;
  readOnly: boolean;
  /** The refusal per step: the server's (`agent_states.<step>`) or the one of two equal statuses. */
  errorOf: (step: AgentStep) => string | undefined;
  onChange: (agent_states: Steps) => void;
};

/** The status per step of the agents (spec 7.4): only statuses of this workflow whose category the step accepts. */
export function AgentSteps({ draft, saved, readOnly, errorOf, onChange }: AgentStepsProps) {
  const proposal = proposalOf(draft);
  // a proposal only fills what is empty; taking it is a change like any other, saved with the workflow
  const proposed = AGENT_STEPS.filter((step) => draft.agent_states[step] === null && proposal[step] !== null);
  const missing = missingSteps(draft.agent_states);
  const nameOf = (id: string) => {
    const index = draft.states.findIndex((state) => state.id === id);
    return draft.states[index]!.name.trim() || t('settings.workflows.state.fallback', { number: index + 1 });
  };
  const quoted = (text: string) => t('settings.agents.quoted', { text });

  function take() {
    onChange({ ...draft.agent_states, ...Object.fromEntries(proposed.map((step) => [step, proposal[step]])) });
    // the button goes with the proposal taken: the focus moves to the first step
    requestAnimationFrame(() => document.getElementById(agentStepId('working'))?.focus());
  }

  return (
    <Panel
      title={t('settings.workflows.agents.title')}
      description={t('settings.workflows.agents.description')}
      actions={
        readOnly || proposed.length === 0 ? null : (
          <Button variant="secondary" size="sm" onClick={take}>
            {t('settings.workflows.agents.suggest')}
          </Button>
        )
      }
    >
      <div className="flex flex-col divide-y divide-line">
        {ALL_STEPS.map((step) => {
          const value = draft.agent_states[step];
          const current = value === null ? undefined : draft.states.find((state) => state.id === value);
          const removedName = value !== null && !current ? (saved?.states.find((state) => state.id === value)?.name ?? t('settings.workflows.agents.removed_unknown')) : null;
          const categories = categoriesText(STEP_CATEGORIES[step]);
          // the fitting statuses, and the chosen one when it does not fit (any more): its row says why
          const offered = draft.states.filter((state) => fitsStep(step, state.category) || state.id === value);
          const suggested = proposal[step];
          const hint =
            removedName !== null
              ? t('settings.workflows.agents.removed_note', { name: removedName })
              : value !== null || step === 'ready'
                ? undefined
                : suggested !== null
                  ? t('settings.workflows.agents.proposal', { name: nameOf(suggested) })
                  : offered.length > 0
                    ? t('settings.workflows.agents.needs_second', { categories })
                    : t('settings.workflows.agents.no_fitting', { categories });
          return (
            <div key={step} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start">
              <div>
                <p className="text-ui font-medium text-ink">{t(STEP_NAMES[step])}</p>
                <p className="text-sm text-pretty text-muted">
                  {t(STEP_HINTS[step])} {t('settings.workflows.agents.categories', { categories })}
                </p>
              </div>
              <Select
                id={agentStepId(step)}
                aria-label={t('settings.workflows.agents.status_for', { step: t(STEP_NAMES[step]) })}
                className="min-w-0 sm:max-w-sm"
                disabled={readOnly}
                value={removedName !== null ? null : (value ?? 'none')}
                placeholder={removedName !== null ? t('settings.workflows.agents.removed_placeholder', { name: removedName }) : undefined}
                hint={hint}
                error={errorOf(step)}
                onValueChange={(next) => next && onChange({ ...draft.agent_states, [step]: next === 'none' ? null : next })}
                options={[
                  { value: 'none', label: t('settings.workflows.agents.none') },
                  ...offered.map((state) => ({
                    value: state.id,
                    label: nameOf(state.id),
                    icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />,
                  })),
                ]}
              />
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <p className="max-w-[65ch] border-t border-line px-4 py-3 text-sm text-pretty text-muted">
          {missing.length === AGENT_STEPS.length
            ? t('settings.workflows.agents.missing_all')
            : t('settings.workflows.agents.missing_some', {
                steps: new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(missing.map((step) => quoted(t(STEP_NAMES[step])))),
              })}
        </p>
      )}
    </Panel>
  );
}
