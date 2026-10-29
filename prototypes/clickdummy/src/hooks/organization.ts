import { useQuery } from '@tanstack/react-query';
import { getOrganization, updateOrganization } from '@/api/organization';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useOrganization() {
  return useQuery({ queryKey: qk.organization.all, queryFn: getOrganization });
}

export function useUpdateOrganization() {
  return useApiMutation(updateOrganization, [qk.organization.all]);
}
