/*
 * Workflows (spec 4.5): the list with what each one is made of and which projects use it, and the editor behind it.
 * The editor is a view of the same section (`?workflow=<id>`, `?workflow=new`, `?workflow=new&from=<id>` for a copy;
 * P17), so Back, Forward and a link to a workflow work, and the server renders the same page. The default workflow and
 * one that a project uses cannot be deleted; the button says why. Deleting has five seconds of undo like everything
 * else; a refusal of the server (a project took the workflow meanwhile) brings the card back with the reason.
 */

import { Link, router } from '@inertiajs/react';
import { Copy, Pencil, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonClass } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { statesInOrder } from '@/domain/workflow';
import { useProjects } from '@/hooks/projects';
import { useDeleteWorkflow, useWorkflows } from '@/hooks/workflows';
import { t, tn } from '@/lib/i18n';
import { paths, useSearchParam } from '@/lib/links';
import type { Project, Workflow } from '@/types';
import { ReadOnlyNotice } from '../../frame/access';
import { Badge, Loaded, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useRemoval } from '../../frame/useRemoval';
import type { SectionProps } from '../sections';
import { WorkflowEditor } from './WorkflowEditor';

/** Why a workflow cannot be deleted, or null when it can. */
function keepReason(workflow: Workflow, users: Project[]): string | null {
  if (workflow.is_default) return t('settings.workflows.keep_default');
  if (users.length > 0) return tn('settings.workflows.keep_used', users.length, { projects: users.map((project) => project.identifier).join(', ') });
  return null;
}

type CardProps = {
  workflow: Workflow;
  users: Project[];
  canEdit: boolean;
  onDelete: () => void;
};

function WorkflowCard({ workflow, users, canEdit, onDelete }: CardProps) {
  const states = statesInOrder(workflow);
  const start = states.find((state) => state.id === workflow.initial_state_id);
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1" aria-labelledby={`workflow-${workflow.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`workflow-${workflow.id}`} className="font-display text-lg font-bold tracking-title break-words text-ink">
              {workflow.name}
            </h3>
            {workflow.is_default && <Badge tone="accent">{t('settings.workflows.default_badge')}</Badge>}
            <Badge tone="quiet">{workflow.is_free ? t('settings.workflows.free_badge') : t('settings.workflows.matrix_badge')}</Badge>
          </div>
          {workflow.description && <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{workflow.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={paths.workflow(workflow.id)} className={buttonClass({ variant: 'secondary' })}>
            <Pencil className="size-4 text-muted" aria-hidden="true" />
            {canEdit ? t('settings.workflows.edit') : t('settings.workflows.view')}
            {' '}<span className="sr-only">{workflow.name}</span>
          </Link>
          {canEdit && (
            <>
              <Link href={paths.newWorkflow(workflow.id)} className={buttonClass({ variant: 'ghost' })}>
                <Copy className="size-4 text-muted" aria-hidden="true" />
                {t('settings.workflows.duplicate')}
                {' '}<span className="sr-only">{workflow.name}</span>
              </Link>
              <Button variant="ghost" icon={Trash2} disabledReason={keepReason(workflow, users)} onClick={onDelete}>
                {t('settings.workflows.delete')}
                {' '}<span className="sr-only">{workflow.name}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <ul aria-label={t('settings.workflows.states_of', { name: workflow.name })} className="flex flex-wrap gap-1.5">
        {states.map((state) => (
          <li key={state.id}>
            <Chip icon={<StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />}>{state.name}</Chip>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">{t('settings.workflows.start')}</dt>
        <dd className="text-ink">{start?.name ?? t('settings.workflows.start_none')}</dd>
        <dt className="text-muted">{t('settings.workflows.transitions_label')}</dt>
        <dd className="text-ink">{workflow.is_free ? t('settings.workflows.transitions_free') : tn('settings.workflows.transitions_count', workflow.transitions.length)}</dd>
        <dt className="text-muted">{t('settings.workflows.used_by')}</dt>
        <dd className="min-w-0 text-ink">
          {users.length === 0 ? (
            t('settings.workflows.used_by_none')
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {users.map((project) => (
                <li key={project.id}>
                  <Link href={paths.projectSettings(project.identifier)} className="inline-flex max-w-64 rounded-chip no-underline">
                    <Chip icon={<ProjectBadge project={project} />}>
                      <span translate="no">{project.identifier}</span> {project.name}
                    </Chip>
                  </Link>
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
  const create = (
    <Link href={paths.newWorkflow()} className={buttonClass({ variant: 'primary' })}>
      <Plus className="size-4" aria-hidden="true" />
      {t('settings.workflows.create')}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.org.section.workflows')} description={t('settings.workflows.description')} actions={canEdit && create} />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[workflows, projects]} failure={t('settings.workflows.load_failed')} skeleton={<RowsSkeleton rows={2} label={t('settings.workflows.loading')} />}>
        {() => {
          const shown = workflows.data!.items.filter((workflow) => !hidden.has(workflow.id));
          if (shown.length === 0) {
            return <EmptyState icon={WorkflowIcon} title={t('settings.workflows.empty.title')} description={t('settings.workflows.empty.description')} actions={canEdit && create} />;
          }
          return (
            <ul aria-label={t('settings.org.section.workflows')} className="flex flex-col gap-3">
              {shown.map((workflow) => (
                <li key={workflow.id}>
                  <WorkflowCard
                    workflow={workflow}
                    users={projects.data!.items.filter((project) => project.workflow_id === workflow.id)}
                    canEdit={canEdit}
                    onDelete={() =>
                      removeWithUndo({
                        id: workflow.id,
                        label: t('settings.workflows.deleted', { name: workflow.name }),
                        failureTitle: t('settings.workflows.not_deleted', { name: workflow.name }),
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
  const editing = useSearchParam('workflow');
  const from = useSearchParam('from');
  // a new workflow moves to its own address once saved; its title then takes the focus
  const [created, setCreated] = useState<string | null>(null);

  if (editing) {
    return (
      <WorkflowEditor
        workflowId={editing === 'new' ? null : editing}
        copyOf={editing === 'new' ? from : null}
        readOnlyReason={readOnlyReason}
        focusTitleOf={created}
        onCreated={(id) => {
          setCreated(id);
          router.visit(paths.workflow(id), { replace: true, preserveState: true, preserveScroll: true });
        }}
      />
    );
  }
  return <WorkflowList readOnlyReason={readOnlyReason} />;
}
