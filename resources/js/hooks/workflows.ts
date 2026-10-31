import { useQuery } from '@tanstack/react-query';
import { assignWorkflow, deleteWorkflow, listWorkflows, saveWorkflow, type WorkflowInput } from '@/api/workflows';
import { qk } from './keys';
import { useApiMutation } from './mutation';
import { allPages } from './pages';

/** Every workflow, all pages: the editor and the project settings need the whole catalog. */
export function useWorkflows() {
  return useQuery({ queryKey: qk.workflows.all, queryFn: () => allPages((cursor) => listWorkflows({ cursor })) });
}

/**
 * Rejected with 422, `errors` per field (`states.0.name`, `states.1.id`, `transitions.2`). A workflow a project uses
 * changes that project's statuses, so everything is reloaded.
 */
export function useSaveWorkflow() {
  return useApiMutation(
    ({ workflow, options }: { workflow: WorkflowInput; options?: { state_mapping?: Record<string, string> } }) => saveWorkflow(workflow, options),
    'all',
  );
}

export function useDeleteWorkflow() {
  return useApiMutation(deleteWorkflow, [qk.workflows.all]);
}

/** The project takes the new workflow (`workflow_id` of the project), so everything is reloaded. */
export function useAssignWorkflow() {
  return useApiMutation(
    ({ project_id, workflow_id, mapping }: { project_id: string; workflow_id: string; mapping: Record<string, string> }) =>
      assignWorkflow(project_id, workflow_id, mapping),
    'all',
  );
}
