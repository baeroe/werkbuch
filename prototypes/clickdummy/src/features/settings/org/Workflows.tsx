/*
 * Workflows (spec 4.5): the list with what each one is made of and which projects use it, and the editor behind it.
 * The editor is a view of the same section (`?workflow=<id>`, `?workflow=new`, `?workflow=new&from=<id>` for a copy),
 * so the back button and a link to a workflow work. A workflow that a project uses, and the standard workflow, cannot
 * be deleted; the button says so. Deleting has five seconds of undo like everything else.
 */

import { Copy, Pencil, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Button, buttonClass } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { statesInOrder } from '@/domain/workflow';
import { useProjects } from '@/hooks/projects';
import { useDeleteWorkflow, useWorkflows } from '@/hooks/workflows';
import type { Project, Workflow } from '@/types';
import { ReadOnlyNotice } from './access';
import { counted } from './format';
import { Badge, Loaded, RowsSkeleton, SectionHeader } from './parts';
import type { SectionProps } from './sections';
import { useRemoval } from './useRemoval';
import { WorkflowEditor } from './WorkflowEditor';

type CardProps = {
  workflow: Workflow;
  users: Project[];
  canEdit: boolean;
  onDelete: () => void;
};

/** Why a workflow cannot be deleted, or null when it can. */
function keepReason(workflow: Workflow, users: Project[]): string | null {
  if (workflow.is_default) return 'Der Standard-Workflow lässt sich nie löschen. Mache zuerst einen anderen zum Standard.';
  if (users.length > 0) return `${users.map((project) => project.identifier).join(', ')} ${users.length === 1 ? 'benutzt' : 'benutzen'} ihn noch. Wechsle dort zuerst den Workflow.`;
  return null;
}

function WorkflowCard({ workflow, users, canEdit, onDelete }: CardProps) {
  const states = statesInOrder(workflow);
  const start = states.find((state) => state.id === workflow.initial_state_id);
  const reason = keepReason(workflow, users);
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1" aria-labelledby={`workflow-${workflow.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`workflow-${workflow.id}`} className="font-display text-lg font-bold tracking-title break-words text-ink">
              {workflow.name}
            </h3>
            {workflow.is_default && <Badge tone="accent">Standard</Badge>}
            <Badge tone="quiet">{workflow.is_free ? 'Frei' : 'Mit Übergangsmatrix'}</Badge>
          </div>
          {workflow.description && <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{workflow.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={{ search: `?workflow=${workflow.id}` }} className={buttonClass({ variant: 'secondary' })}>
            <Pencil className="size-4 text-muted" aria-hidden="true" />
            {canEdit ? 'Bearbeiten' : 'Ansehen'}
            {' '}<span className="sr-only">{workflow.name}</span>
          </Link>
          {canEdit && (
            <>
              <Link to={{ search: `?workflow=new&from=${workflow.id}` }} className={buttonClass({ variant: 'ghost' })}>
                <Copy className="size-4 text-muted" aria-hidden="true" />
                Duplizieren
                {' '}<span className="sr-only">{workflow.name}</span>
              </Link>
              <Button variant="ghost" icon={Trash2} disabledReason={reason} onClick={onDelete}>
                Löschen
                {' '}<span className="sr-only">{workflow.name}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <ul aria-label={`Status von ${workflow.name}`} className="flex flex-wrap gap-1.5">
        {states.map((state) => (
          <li key={state.id}>
            <Chip icon={<StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />}>{state.name}</Chip>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">Startstatus</dt>
        <dd className="text-ink">{start?.name ?? 'Keiner'}</dd>
        <dt className="text-muted">Übergänge</dt>
        <dd className="text-ink">{workflow.is_free ? 'Jeder Status darf in jeden wechseln.' : `${counted(workflow.transitions.length, 'erlaubter Übergang', 'erlaubte Übergänge')}.`}</dd>
        <dt className="text-muted">Benutzt von</dt>
        <dd className="min-w-0 text-ink">
          {users.length === 0 ? (
            'Keinem Projekt'
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {users.map((project) => (
                <li key={project.id}>
                  <Chip icon={<ProjectBadge project={project} />} className="max-w-64">
                    <span translate="no">{project.identifier}</span> {project.name}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </article>
  );
}

function WorkflowList({ readOnlyReason }: SectionProps) {
  const workflows = useWorkflows();
  const projects = useProjects({ include_archived: true });
  const remove = useDeleteWorkflow();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Workflows"
        description="Status und erlaubte Übergänge. Jedes Projekt benutzt genau einen Workflow, der Standard-Workflow geht an neue Projekte."
        actions={
          canEdit && (
            <Link to={{ search: '?workflow=new' }} className={buttonClass({ variant: 'primary' })}>
              <Plus className="size-4" aria-hidden="true" />
              Workflow anlegen
            </Link>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[workflows, projects]} failure="Die Workflows konnten nicht geladen werden" skeleton={<RowsSkeleton rows={2} label="Die Workflows werden geladen …" />}>
        {() => {
          const shown = (workflows.data?.items ?? []).filter((workflow) => !hidden.has(workflow.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={WorkflowIcon}
                title="Noch kein Workflow"
                description="Ein Workflow legt fest, welche Status ein Item durchläuft und welche Übergänge erlaubt sind."
                actions={
                  canEdit && (
                    <Link to={{ search: '?workflow=new' }} className={buttonClass({ variant: 'primary' })}>
                      Workflow anlegen
                    </Link>
                  )
                }
              />
            );
          }
          return (
            <ul className="flex flex-col gap-3">
              {shown.map((workflow) => (
                <li key={workflow.id}>
                  <WorkflowCard
                    workflow={workflow}
                    users={(projects.data?.items ?? []).filter((project) => project.workflow_id === workflow.id)}
                    canEdit={canEdit}
                    onDelete={() =>
                      removeWithUndo({
                        id: workflow.id,
                        label: `Workflow „${workflow.name}“ gelöscht`,
                        failureTitle: `Workflow „${workflow.name}“ nicht gelöscht`,
                        run: () => remove.mutateAsync(workflow.id),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
    </div>
  );
}

export default function Workflows({ readOnlyReason }: SectionProps) {
  const [params, setParams] = useSearchParams();
  const editing = params.get('workflow');

  if (editing) {
    return (
      <WorkflowEditor
        workflowId={editing === 'new' ? null : editing}
        copyOf={editing === 'new' ? params.get('from') : null}
        readOnlyReason={readOnlyReason}
        onClose={() => setParams({})}
        closeTo={{ search: '' }}
        onSaved={(id) => setParams({ workflow: id }, { replace: true })}
      />
    );
  }
  return <WorkflowList readOnlyReason={readOnlyReason} />;
}
