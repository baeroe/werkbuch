/*
 * Settings → Workflow (spec 4.5): which workflow the project uses, and switching to another one. The workflows live in
 * the organisation; a project only picks one. In Phase 3 a project has no items, so a switch is a plain confirmation
 * with an empty mapping (P28); the rows that give each status with items a new one come with Phase 4.
 */

import { Link } from '@inertiajs/react';
import { ArrowRightLeft } from 'lucide-react';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { FormDialog } from '@/components/ui/FormDialog';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { toast } from '@/components/ui/toast';
import { statesInOrder } from '@/domain/workflow';
import { useAssignWorkflow, useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { t, tn } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import type { Workflow as WorkflowRecord } from '@/types';
import { noticeOf } from '../frame/form';
import { SettingsCard, SettingsError, SettingsSkeleton } from '../frame/parts';
import type { ProjectSectionProps } from './sectionProps';

const startOf = (workflow: WorkflowRecord) => workflow.states.find((state) => state.id === workflow.initial_state_id);

/** How the states of a workflow may be reached, and where new items start, in a sentence. */
function transitionText(workflow: WorkflowRecord): string {
  const how = workflow.is_free ? t('settings.project.workflow.transitions_free') : tn('settings.project.workflow.transitions_matrix', workflow.transitions.length);
  const start = startOf(workflow);
  return start ? `${how} ${t('settings.project.workflow.start', { name: start.name })}` : how;
}

/**
 * Name, description, the states in their order and the rule for moving between them. With `headingRef` the name can
 * take the focus (programmatically, not by Tab): after a switch it is the one place on the screen that is still there.
 */
function WorkflowSummary({ workflow, headingRef }: { workflow: WorkflowRecord; headingRef?: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <h3
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          data-focus-ring={headingRef ? 'none' : undefined}
          className="font-display text-md font-bold tracking-title break-words text-ink outline-none"
        >
          {workflow.name}
        </h3>
        {workflow.description && <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">{workflow.description}</p>}
      </div>
      <ul role="list" aria-label={t('settings.project.workflow.states_label')} className="flex flex-wrap gap-1.5">
        {statesInOrder(workflow).map((state) => (
          <li key={state.id}>
            <Chip icon={<StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />}>{state.name}</Chip>
          </li>
        ))}
      </ul>
      <p className="max-w-[65ch] text-ui text-pretty text-muted">{transitionText(workflow)}</p>
    </div>
  );
}

export function Workflow({ project, canManage }: ProjectSectionProps) {
  const workflows = useWorkflows();
  const assign = useAssignWorkflow();
  const { can, reason } = usePermissions();
  const [target, setTarget] = useState<string | null>(null);
  // the workflow the question is about, fixed when it opens, so it does not change under the person while the call runs
  const [asking, setAsking] = useState<WorkflowRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // where the focus goes when the question closes: back to the button that asked, and after a switch to the name of the
  // workflow the project has now (the button is blocked then, and the name says what changed)
  const returnTo = useRef<HTMLElement | null>(null);

  const current = workflows.data?.items.find((workflow) => workflow.id === project.workflow_id);
  const others = useMemo(() => (workflows.data?.items ?? []).filter((workflow) => workflow.id !== project.workflow_id), [workflows.data, project.workflow_id]);
  const next = others.find((workflow) => workflow.id === target);

  if (workflows.isPending) return <SettingsSkeleton rows={2} label={t('settings.project.workflow.loading')} />;
  if (workflows.isError || !current) {
    return (
      <SettingsError title={t('settings.project.workflow.load_failed')} error={workflows.error} retrying={workflows.isFetching} onRetry={() => void workflows.refetch()} />
    );
  }

  // what keeps the button from asking, in the order of what the person can do about it
  const blocked = reason('project.manage', project.id) ?? (next ? null : t('settings.project.workflow.choose_first'));

  function ask() {
    if (!next) return;
    setAsking(next);
    setRefusal(null);
    returnTo.current = trigger.current;
    setOpen(true);
  }

  async function confirm(to: WorkflowRecord) {
    setRefusal(null);
    try {
      await assign.mutateAsync({ project_id: project.id, workflow_id: to.id, mapping: {} });
    } catch (error) {
      // a refusal of the server stays in the dialog; a failure (or no answer) gets the toast with "Try again"
      if (error instanceof ApiError && error.status === 422) setRefusal(error);
      else notifyError(t('settings.project.workflow.not_switched'), error, () => void confirm(to));
      return;
    }
    returnTo.current = heading.current;
    setTarget(null);
    setOpen(false);
    toast({ title: t('settings.project.workflow.switched'), description: t('settings.project.workflow.switched_text', { identifier: project.identifier, name: to.name }), tone: 'success' });
  }

  return (
    <>
      <SettingsCard title={t('settings.project.workflow.current_title')} description={t('settings.project.workflow.current_description')}>
        <WorkflowSummary workflow={current} headingRef={heading} />
        {can('org.manage_catalog') && (
          <p className="text-ui text-muted">
            {t('settings.project.workflow.org_admins')}{' '}
            <Link href={paths.workflow(current.id)} className="font-medium text-accent-text underline-offset-2 hover:underline">
              {t('settings.project.workflow.org_link')}
            </Link>
            .
          </p>
        )}
      </SettingsCard>
      <SettingsCard
        title={t('settings.project.workflow.switch_title')}
        description={t('settings.project.workflow.switch_description')}
        footer={
          <Button ref={trigger} variant="primary" icon={ArrowRightLeft} disabledReason={blocked} onClick={ask}>
            {t('settings.project.workflow.switch_open')}
          </Button>
        }
      >
        {others.length === 0 ? (
          <p className="text-ui text-pretty text-muted">{t('settings.project.workflow.no_other')}</p>
        ) : (
          <>
            <Select
              label={t('settings.project.workflow.new_workflow')}
              placeholder={t('settings.project.workflow.placeholder')}
              disabled={!canManage}
              value={next ? target : null}
              options={others.map((workflow) => ({
                value: workflow.id,
                label: workflow.is_default ? t('settings.project.workflow.default_option', { name: workflow.name }) : workflow.name,
              }))}
              onValueChange={setTarget}
            />
            {next && (
              <div className="rounded-ctl bg-sunken p-3">
                <WorkflowSummary workflow={next} />
              </div>
            )}
          </>
        )}
      </SettingsCard>
      {asking && (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={t('settings.project.workflow.confirm_title', { name: asking.name })}
          submitLabel={t('settings.project.workflow.confirm')}
          pending={assign.isPending}
          // the switch runs to its end with the dialog open: closing it now would leave the person without its answer
          locked={assign.isPending}
          notice={noticeOf(refusal, [])}
          finalFocus={returnTo}
          onSubmit={() => void confirm(asking)}
        >
          <p className="max-w-[65ch] text-ui text-pretty text-muted">
            {t('settings.project.workflow.confirm_text', { identifier: project.identifier, from: current.name, state: startOf(asking)?.name ?? '' })}
          </p>
        </FormDialog>
      )}
    </>
  );
}
