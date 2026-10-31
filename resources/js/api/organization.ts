/*
 * The one organisation of the instance (spec 4.1). Only org admins change it.
 */

import type { Organization } from '@/types';
import { get, one, patch as sendPatch } from './http';

export function getOrganization(): Promise<Organization> {
  return one(get<{ data: Organization }>('/organization'));
}

export type UpdateOrganizationPatch = Partial<Pick<Organization, 'name' | 'locale' | 'timezone' | 'week_start' | 'logo_url'>>;

export function updateOrganization(patch: UpdateOrganizationPatch): Promise<Organization> {
  return one(sendPatch<{ data: Organization }>('/organization', patch));
}
