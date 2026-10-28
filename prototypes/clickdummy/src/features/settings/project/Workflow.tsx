/*
 * Settings → Workflow (spec 4.5): which workflow the project uses, and switching to another one. The workflows live in
 * the organisation; a project only picks one. Switching asks, in a dialog, which new status each status with items
 * gets (`StateMappingDialog`) and rewrites the items.
 */

import { ArrowRightLeft } from 'lucide-react';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { statesInOrder } from '@/domain/workflow';
import { useAutomations } from '@/hooks/automations';
import { useWorkflows } from '@/hooks/workflows';
import { usePermissions } from '@/lib/permissions';
import type { Workflow as WorkflowRecord } from '@/types';
import type { SectionProps } from './sectionProps';
import { SettingsCard, SettingsError, SettingsSkeleton } from './SettingsParts';
import { countByState } from './mapping';
import { StateMappingDialog, type MappingPlan } from './StateMappingDialog';
import { useProjectItems } from './useProjectItems';

/** How the states of a workflow may be reached, in a sentence. */
function transitionText(workflow: WorkflowRecord): string {
  const start = workflow.states.find((state) => state.id === workflow.initial_state_id)?.name;
  const how = workflow.is_free
    ? 'Freie Übergänge: Jeder Status ist von überall erreichbar.'
    : `Mit Übergangsmatrix: ${workflow.transitions.length} erlaubte ${workflow.transitions.length === 1 ? 'Übergang' : 'Übergänge'}.`;
  return start ? `${how} Neue Items starten in „${start}“.` : how;
}

/**
 * Name, description, the states in their order and the rule for moving between them. With `headingRef` the name can
 * take the focus (programmatically, not by Tab): after a switch it is the one place on the screen that is still there.
 */
function WorkflowSummary({ workflow, headingRef }: { workflow: WorkflowRecord; headingRef?: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <h3 ref={headingRef} tabIndex={headingRef ? -1 : undefined} data-focus-ring={headingRef ? 'none' : undefined} className="font-display text-md font-bold tracking-title text-ink outline-none">
          {workflow.name}
        </h3>
        {workflow.description && <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">{workflow.description}</p>}
      </div>
      <ul role="list" aria-label="Status des Workflows" className="flex flex-wrap gap-1.5">
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

export function Workflow({ project, canManage }: SectionProps) {
  const workflows = useWorkflows();
  const items = useProjectItems(project.id);
  const automations = useAutomations(project.id);
  const { can, reason } = usePermissions();
  const [target, setTarget] = useState<string | null>(null);
  // the question as it was when it opened; `asking` shows or hides it
  const [plan, setPlan] = useState<MappingPlan | null>(null);
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // where the focus goes when the question closes: back to the button that asked, and after a switch to the name of the
  // workflow the project has now. The button is blocked then (the workflow that was chosen is the current one) and drawn
  // anew inside its tooltip, so the one that had the focus is gone.
  const returnTo = useRef<HTMLElement | null>(null);

  const current = workflows.data?.items.find((workflow) => workflow.id === project.workflow_id);
  const others = useMemo(() => (workflows.data?.items ?? []).filter((workflow) => workflow.id !== project.workflow_id), [workflows.data, project.workflow_id]);
  const next = others.find((workflow) => workflow.id === target);

  if (workflows.isPending) return <SettingsSkeleton rows={2} label="Workflows werden geladen …" />;
  if (workflows.isError || !current) {
    return <SettingsError title="Der Workflow konnte nicht geladen werden" error={workflows.error} retrying={workflows.isFetching} onRetry={() => void workflows.refetch()} />;
  }

  // what keeps the button from asking, in the order of what the person can do about it
  const blocked =
    reason('project.manage', project.id) ??
    (next ? null : 'Wähle zuerst den neuen Workflow.') ??
    (items.isPending ? 'Die Items des Projekts werden noch geladen.' : items.isError ? 'Die Items des Projekts konnten nicht geladen werden.' : null);

  function ask() {
    if (!next || !items.data) return;
    setPlan({
      from: current!,
      to: next,
      counts: countByState(items.data.items),
      autoClose: automations.data?.items.find((entry) => entry.key === 'auto_close' && entry.enabled),
    });
    returnTo.current = trigger.current;
    setAsking(true);
  }

  function switched() {
    returnTo.current = heading.current;
  }

  return (
    <>
      <SettingsCard
        title="Aktueller Workflow"
        description="Der Workflow legt fest, welche Status ein Item durchläuft und welche Übergänge erlaubt sind."
      >
        <WorkflowSummary workflow={current} headingRef={heading} />
        {can('org.manage_catalog') && (
          <p className="text-ui text-muted">
            Die Status und Übergänge ändern Org-Admins unter{' '}
            <Link to="/settings/workflows" className="font-medium text-accent-text underline-offset-2 hover:underline">
              Organisation, Workflows
            </Link>
            .
          </p>
        )}
      </SettingsCard>
      <SettingsCard
        title="Workflow wechseln"
        description="Alle Items des Projekts bekommen einen Status des neuen Workflows. Dafür ordnest du im nächsten Schritt jedem Status mit Items einen neuen zu."
        footer={
          <Button ref={trigger} variant="primary" icon={ArrowRightLeft} disabledReason={blocked} onClick={ask}>
            Workflow wechseln …
          </Button>
        }
      >
        {others.length === 0 ? (
          <p className="text-ui text-pretty text-muted">Es gibt keinen anderen Workflow. Org-Admins legen weitere in den Organisationseinstellungen an.</p>
        ) : (
          <>
            <Select
              label="Neuer Workflow"
              placeholder="Workflow wählen …"
              disabled={!canManage}
              value={target}
              options={others.map((workflow) => ({ value: workflow.id, label: workflow.is_default ? `${workflow.name} (Standard)` : workflow.name }))}
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
      {plan && <StateMappingDialog open={asking} onOpenChange={setAsking} project={project} plan={plan} finalFocus={returnTo} onSwitched={switched} />}
    </>
  );
}
