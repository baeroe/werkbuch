/*
 * Workflows (spec 4.5): the statuses of a project, their categories and the allowed transitions. Only org admins
 * change them. `validateWorkflow` (`@/domain/workflow`) says beforehand what the server refuses with 422; its errors
 * come per field (`states.0.name`, `transitions.2`).
 */

import type { Project, State, Workflow } from '@/types';
import type { Page, PageArgs } from './client';
import { del, getPage, one, put, saveOne } from './http';
import { projectPath } from './projects';

/** A workflow as a client sends it: new workflows and new states come without an id. */
export type WorkflowInput = Omit<Workflow, 'id' | 'states'> & {
  id?: string;
  states: (Omit<State, 'id'> & { id?: string })[];
};

export function listWorkflows(args: PageArgs = {}): Promise<Page<Workflow>> {
  return getPage<Workflow>('/workflows', { ...args });
}

/**
 * Creates (without `id`) or replaces a workflow as a whole. `state_mapping` (state id → state that takes over) is for
 * states that are removed while items sit in them.
 */
export function saveWorkflow(spec: WorkflowInput, options: { state_mapping?: Record<string, string> } = {}): Promise<Workflow> {
  const { id, ...body } = spec;

  return saveOne<Workflow>('/workflows', id, { ...body, ...options });
}

export function deleteWorkflow(id: string): Promise<void> {
  return del<void>(`/workflows/${encodeURIComponent(id)}`);
}

/** Switches the workflow of a project (project admins); `mapping` says which new state takes over each old one. */
export function assignWorkflow(project_id: string, workflow_id: string, mapping: Record<string, string>): Promise<Project> {
  return one(put<{ data: Project }>(`${projectPath(project_id)}/workflow`, { workflow_id, mapping }));
}
