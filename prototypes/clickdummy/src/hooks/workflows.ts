import { useQuery } from '@tanstack/react-query';
import { assignWorkflow, deleteWorkflow, listWorkflows, saveWorkflow, type WorkflowInput } from '@/api/workflows';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useWorkflows() {
  return useQuery({ queryKey: qk.workflows.all, queryFn: listWorkflows });
}

/** Rejected with 422 (`errors` per code of `validateWorkflow`) or 409 `state_in_use` (pass `options.state_mapping`). */
export function useSaveWorkflow() {
  return useApiMutation(
    ({ workflow, options }: { workflow: WorkflowInput; options?: { state_mapping?: Record<string, string> } }) => saveWorkflow(workflow, options),
    'all',
  );
}

export function useDeleteWorkflow() {
  return useApiMutation(deleteWorkflow, [qk.workflows.all]);
}

export function useAssignWorkflow() {
  return useApiMutation(
    ({ project_id, workflow_id, mapping }: { project_id: string; workflow_id: string; mapping: Record<string, string> }) =>
      assignWorkflow(project_id, workflow_id, mapping),
    'all',
  );
}
