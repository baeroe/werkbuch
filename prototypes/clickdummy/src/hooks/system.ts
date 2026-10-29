import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSystemStatus, resetDemo, retryFailedJobs, sendTestMail } from '@/api/system';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useSystemStatus() {
  return useQuery({ queryKey: qk.system.all, queryFn: getSystemStatus });
}

export function useRetryFailedJobs() {
  return useApiMutation(retryFailedJobs, [qk.system.all]);
}

export function useSendTestMail() {
  return useApiMutation(sendTestMail, []);
}

/** "Demo zurücksetzen": the seed data are back and Mara is signed in; everything is loaded again. */
export function useResetDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resetDemo,
    onSuccess: () => queryClient.resetQueries(),
  });
}
