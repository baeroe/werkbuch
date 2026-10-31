/*
 * What stops a workflow from being saved, as it happens: one line per finding of `validateWorkflow` (or of the server's
 * 422 `invalid_workflow`), the finding and what to do about it. Before the first send the list is a polite status
 * region, after a send an alert; a send with findings puts the focus here (`tabIndex={-1}`), so nobody has to look for
 * what stopped it.
 */

import { CircleAlert, CircleCheck } from 'lucide-react';
import type { Ref } from 'react';
import { Banner } from '@/components/ui/Banner';
import type { WorkflowIssue } from '@/domain/workflow';
import { t, tn } from '@/lib/i18n';
import { Measure } from '../../frame/parts';
import type { DraftState } from './draft';

interface IssueText {
  /** The finding as one sentence without a full stop: "Review is not reachable from the start status". */
  text: string;
  /** What to do about it. */
  fix: string;
}

function describe(issue: WorkflowIssue, states: readonly DraftState[]): IssueText {
  switch (issue.code) {
    case 'no_initial_state':
      return { text: t('settings.workflows.issue.no_initial_state'), fix: t('settings.workflows.issue.no_initial_state_fix') };
    case 'no_completed_state':
      return { text: t('settings.workflows.issue.no_completed_state'), fix: t('settings.workflows.issue.no_completed_state_fix') };
    case 'unreachable_state': {
      const name = states.find((state) => state.id === issue.state_id)?.name.trim() || t('settings.workflows.issue.unnamed');
      return { text: t('settings.workflows.issue.unreachable', { name }), fix: t('settings.workflows.issue.unreachable_fix') };
    }
  }
}

type IssueListProps = {
  issues: readonly WorkflowIssue[];
  states: readonly DraftState[];
  /** A send happened: from now on a change of the list is announced at once. */
  attempted: boolean;
  ref?: Ref<HTMLDivElement>;
};

export function IssueList({ issues, states, attempted, ref }: IssueListProps) {
  return (
    <div ref={ref} id="workflow-issues" tabIndex={-1} data-focus-ring="none" role={attempted ? 'alert' : 'status'} className="outline-none">
      {issues.length === 0 ? (
        <Banner tone="neutral" icon={CircleCheck} title={t('settings.workflows.issues.none')}>
          <Measure>{t('settings.workflows.issues.none_description')}</Measure>
        </Banner>
      ) : (
        <Banner tone="danger" icon={CircleAlert} title={tn('settings.workflows.issues.count', issues.length)}>
          <ul className="mt-1 flex flex-col gap-1">
            {issues.map((issue, index) => {
              const { text, fix } = describe(issue, states);
              return (
                <li key={`${issue.code}:${issue.state_id ?? index}`}>
                  <span className="font-medium">{text}</span> <span className="text-muted">{fix}</span>
                </li>
              );
            })}
          </ul>
        </Banner>
      )}
    </div>
  );
}
