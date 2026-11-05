/*
 * The automations of a project (`@/api/automations`): always four, one per key. Switching one waits for the server and
 * makes the automations stale. Each call carries the mutation key of its project and key
 * (`qk.automations.save(project, key)`), so a screen can hold one key's control while its call runs (one at a time per
 * key) and leave the other three alone.
 */

import { useQuery } from '@tanstack/react-query';
import { listAutomations, saveAutomation } from '@/api/automations';
import type { AutomationKey, AutomationSettings } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useAutomations(projectId: string | null | undefined) {
  return useQuery({ queryKey: qk.automations.list({ project: projectId }), queryFn: () => listAutomations(projectId!), enabled: !!projectId });
}

/** Variables: `{ enabled, settings }` of the automation `key` of the project. */
export function useSaveAutomation(projectId: string, key: AutomationKey) {
  return useApiMutation(
    (input: { enabled: boolean; settings: AutomationSettings }) => saveAutomation({ project_id: projectId, key, ...input }),
    [qk.automations.all],
    { mutationKey: qk.automations.save(projectId, key) },
  );
}
