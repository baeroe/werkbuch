import { useQuery } from '@tanstack/react-query';
import { listAutomations, saveAutomation } from '@/api/automations';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useAutomations(projectId: string | null | undefined) {
  return useQuery({ queryKey: qk.automations.list({ project: projectId }), queryFn: () => listAutomations(projectId!), enabled: !!projectId });
}

export function useSaveAutomation() {
  return useApiMutation(saveAutomation, [qk.automations.all]);
}
