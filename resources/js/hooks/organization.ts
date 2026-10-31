import { router } from '@inertiajs/react';
import { useQuery } from '@tanstack/react-query';
import { getOrganization, updateOrganization } from '@/api/organization';
import { useSharedProps } from '@/lib/page';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The organisation; it starts with what the page brought along (shared props), so it is there at once. */
export function useOrganization() {
  const { organization } = useSharedProps();
  return useQuery({ queryKey: qk.organization.all, queryFn: getOrganization, initialData: organization });
}

/** The shared props (logo, name, the default language of guests) come with the page: it reloads after the change. */
export function useUpdateOrganization() {
  return useApiMutation(updateOrganization, [qk.organization.all], { onSuccess: () => router.reload() });
}
