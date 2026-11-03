import { useQuery } from '@tanstack/react-query';
import { getSystemStatus, retryFailedJobs, sendTestMail } from '@/api/system';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The system page (org admins). */
export function useSystemStatus() {
  return useQuery({ queryKey: qk.system.all, queryFn: getSystemStatus });
}

/** Variable: the UUIDs of the failed jobs, or nothing for all of them. */
export function useRetryFailedJobs() {
  return useApiMutation(retryFailedJobs, [qk.system.all]);
}

/** The test mail changes nothing the page shows. */
export function useSendTestMail() {
  return useApiMutation(sendTestMail, []);
}
