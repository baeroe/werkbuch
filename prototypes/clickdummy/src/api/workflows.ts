/*
 * Workflows (spec 4.5). They live in the organisation; only org admins change them. A project switches workflow
 * by mapping the states its items are in.
 */

import { resolutionAfterTransition } from '@/domain/resolution';
import { isClosedCategory, validateWorkflow } from '@/domain/workflow';
import type { Project, StateIcon, Workflow } from '@/types';
import { requireOrgAdmin, requireRole } from './access';
import { ApiError, conflict, FieldErrors, invalid, newId, notFound, paginate, read, write, type Ctx, type Page } from './client';
import type { Db } from './db';
import { recordEvent } from './events';
import { findProject } from './lookup';

export const STATE_ICONS: readonly StateIcon[] = ['dashed', 'circle', 'half', 'three-quarter', 'pause', 'check', 'cross'];

export function listWorkflows(): Promise<Page<Workflow>> {
  return read(({ db }) => paginate(db.workflows));
}

/** A workflow as a client sends it: new workflows and new states come without an id. */
export type WorkflowInput = Omit<Workflow, 'id' | 'states'> & {
  id?: string;
  states: (Omit<Workflow['states'][number], 'id'> & { id?: string })[];
};

/** How many items sit in each state of a workflow. */
function itemsPerState(db: Db, workflowId: string): Map<string, number> {
  const counts = new Map<string, number>();
  const projects = new Set(db.projects.filter((project) => project.workflow_id === workflowId).map((project) => project.id));
  for (const item of db.items) {
    if (projects.has(item.project_id)) counts.set(item.state_id, (counts.get(item.state_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Creates or changes a workflow. Refused with 422 when it cannot be saved (`errors` has an entry per code of
 * `validateWorkflow`, and `extensions.issues` the issues with their state ids). Removing a state that still holds
 * items needs `state_mapping`, state id → state that takes over (409 `state_in_use` lists the states otherwise).
 */
export function saveWorkflow(spec: WorkflowInput, options: { state_mapping?: Record<string, string> } = {}): Promise<Workflow> {
  return write((ctx) => {
    const { db, me } = ctx;
    requireOrgAdmin(me, 'Workflows ändern nur Org-Admins.');
    const existing = spec.id ? db.workflows.find((other) => other.id === spec.id) : undefined;
    const errors = new FieldErrors();

    if (spec.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    if (db.workflows.some((other) => other.id !== existing?.id && other.name.trim().toLowerCase() === spec.name.trim().toLowerCase())) {
      errors.add('name', 'Diesen Namen gibt es schon.');
    }
    if (spec.states.some((state) => state.name.trim() === '')) errors.add('states', 'Jeder Status braucht einen Namen.');
    if (spec.states.some((state) => !STATE_ICONS.includes(state.icon))) errors.add('states', 'Ein Status hat ein unbekanntes Icon.');
    errors.throwIfAny();

    const states = spec.states.map((state, index) => ({
      ...state,
      id: state.id ?? newId('st'),
      name: state.name.trim(),
      position: index,
    }));
    // ids of the states a client leaves out are gone; new states have fresh ids that cannot be the start state yet
    const saved: Workflow = {
      id: existing?.id ?? newId('wf'),
      name: spec.name.trim(),
      description: spec.description,
      is_default: spec.is_default,
      is_free: spec.is_free,
      initial_state_id: spec.initial_state_id,
      states,
      transitions: spec.transitions
        .filter(([from, to]) => from !== to && states.some((s) => s.id === from) && states.some((s) => s.id === to))
        .map(([from, to]): [string, string] => [from, to]),
    };

    const issues = validateWorkflow(saved);
    if (issues.length > 0) {
      const messages: Record<string, string[]> = {};
      for (const issue of issues) {
        const name = states.find((state) => state.id === issue.state_id)?.name;
        const text =
          issue.code === 'no_initial_state'
            ? 'Der Workflow braucht einen Startstatus.'
            : issue.code === 'no_completed_state'
              ? 'Der Workflow braucht mindestens einen Status der Kategorie Completed.'
              : `${name} ist vom Startstatus aus nicht erreichbar.`;
        (messages[issue.code] ??= []).push(text);
      }
      throw new ApiError({ status: 422, reason: 'invalid_workflow', detail: 'Der Workflow lässt sich so nicht speichern.', errors: messages, extensions: { issues } });
    }
    if (!saved.is_default && existing?.is_default && !db.workflows.some((other) => other.id !== existing.id && other.is_default)) {
      throw invalid({ is_default: ['Einer der Workflows muss der Standard-Workflow sein.'] });
    }

    // states that disappear: their items need a new home
    if (existing) {
      const removed = existing.states.filter((state) => !states.some((kept) => kept.id === state.id));
      const counts = itemsPerState(db, existing.id);
      const mapping = options.state_mapping ?? {};
      const unmapped = removed.filter((state) => (counts.get(state.id) ?? 0) > 0 && !states.some((s) => s.id === mapping[state.id]));
      if (unmapped.length > 0) {
        throw conflict('state_in_use', 'Für gelöschte Status mit Items fehlt ein neuer Status.', {
          states: unmapped.map((state) => ({ state_id: state.id, name: state.name, items: counts.get(state.id) })),
        });
      }
      const projectIds = new Set(db.projects.filter((project) => project.workflow_id === existing.id).map((project) => project.id));
      for (const item of db.items) {
        const next = projectIds.has(item.project_id) ? mapping[item.state_id] : undefined;
        if (next && removed.some((state) => state.id === item.state_id)) rewriteState(ctx, item, existing, saved, next, 'Status gelöscht');
      }
      for (const automation of db.automations) {
        if (projectIds.has(automation.project_id) && automation.settings.state_id && !states.some((s) => s.id === automation.settings.state_id)) {
          automation.settings = { ...automation.settings, state_id: states.find((s) => s.category === 'canceled')?.id };
        }
      }
    }

    if (saved.is_default) db.workflows.forEach((other) => (other.is_default = other.id === saved.id));
    if (existing) db.workflows[db.workflows.indexOf(existing)] = saved;
    else db.workflows.push(saved);
    return saved;
  });
}

/** Moves an item to a state of another (or the changed) workflow without asking the transition rules. */
function rewriteState(ctx: Ctx, item: Db['items'][number], from: Workflow, to: Workflow, toStateId: string, reason: string): void {
  const fromState = from.states.find((state) => state.id === item.state_id)!;
  const target = to.states.find((state) => state.id === toStateId)!;
  const resolution = resolutionAfterTransition(fromState.category, target.category, item.resolution_id, null, ctx.db.resolutions);
  const changes: Record<string, { old: unknown; new: unknown }> = { state_id: { old: item.state_id, new: toStateId } };
  if (resolution !== item.resolution_id) changes.resolution_id = { old: item.resolution_id, new: resolution };

  item.state_id = toStateId;
  item.resolution_id = resolution;
  if (target.category === 'started' && item.started_at === null) item.started_at = ctx.stamp;
  if (!isClosedCategory(target.category)) item.closed_at = null;
  else if (item.closed_at === null) item.closed_at = ctx.stamp;
  item.updated_at = ctx.stamp;
  recordEvent(ctx, {
    type: 'work_item.state_changed',
    actor_id: ctx.me.id,
    subject: { type: 'work_item', id: item.id },
    project_id: item.project_id,
    changes,
    reason,
  });
}

/** Deletes an unused workflow (409 `in_use` while a project uses it; the default one cannot be deleted). */
export function deleteWorkflow(id: string): Promise<void> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Workflows löschen nur Org-Admins.');
    const workflow = db.workflows.find((entry) => entry.id === id);
    if (!workflow) throw notFound('Der Workflow');
    if (workflow.is_default) throw conflict('default_workflow', 'Der Standard-Workflow lässt sich nie löschen.');
    const users = db.projects.filter((project) => project.workflow_id === id);
    if (users.length > 0) {
      throw conflict('in_use', `Der Workflow wird noch von ${users.map((project) => project.identifier).join(', ')} benutzt.`, {
        projects: users.map((project) => project.identifier),
      });
    }
    db.workflows = db.workflows.filter((entry) => entry.id !== id);
  });
}

/**
 * Gives a project another workflow. `mapping` says for each state its items are in (state id of the old workflow)
 * which state of the new one takes them. The items are rewritten without transition rules; the history keeps who
 * did it. Returns the updated project.
 */
export function assignWorkflow(project_id: string, workflow_id: string, mapping: Record<string, string>): Promise<Project> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = findProject(db, project_id);
    if (!project) throw notFound('Das Projekt');
    requireRole(db, me, project, 'admin', 'Den Workflow wechseln nur Admins des Projekts.');
    const next = db.workflows.find((entry) => entry.id === workflow_id);
    if (!next) throw invalid({ workflow_id: ['Diesen Workflow gibt es nicht.'] });
    if (next.id === project.workflow_id) return project;
    const previous = db.workflows.find((entry) => entry.id === project.workflow_id)!;

    const items = db.items.filter((item) => item.project_id === project.id);
    const inUse = [...new Set(items.map((item) => item.state_id))];
    const missing = inUse.filter((stateId) => !next.states.some((state) => state.id === mapping[stateId]));
    if (missing.length > 0) {
      throw invalid(
        Object.fromEntries(missing.map((stateId) => [`mapping.${stateId}`, [`Für „${previous.states.find((s) => s.id === stateId)?.name}“ fehlt ein Status im neuen Workflow.`]])),
        'Jeder benutzte Status braucht einen neuen Status.',
      );
    }

    for (const item of items) rewriteState(ctx, item, previous, next, mapping[item.state_id], 'Workflow gewechselt');
    for (const automation of db.automations.filter((entry) => entry.project_id === project.id)) {
      if (automation.settings.state_id) {
        automation.settings = { ...automation.settings, state_id: next.states.find((state) => state.category === 'canceled')?.id };
      }
    }
    recordEvent(ctx, {
      type: 'project.updated',
      actor_id: me.id,
      subject: { type: 'project', id: project.id },
      project_id: project.id,
      changes: { workflow_id: { old: previous.id, new: next.id } },
    });
    project.workflow_id = next.id;
    return project;
  });
}
