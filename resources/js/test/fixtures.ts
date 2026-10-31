/*
 * Fictional records for tests of the data layer, after the people and projects of the clickdummy's seed (Feldwerk).
 * Mara is org admin, Ida admin of WEB, Theo admin of APP and viewer in WEB, Lene member of WEB and APP; OPS is private.
 */

import type { Organization, Project, ProjectRole, User } from '@/types';

export const organization: Organization = {
  id: 'org_feldwerk',
  name: 'Feldwerk',
  locale: 'de',
  timezone: 'Europe/Berlin',
  week_start: 1,
  logo_url: null,
};

export function person(id: string, name: string, handle: string, org_role: User['org_role'] = 'member'): User {
  return {
    id,
    type: 'person',
    name,
    handle,
    email: `${handle}@feldwerk.example.com`,
    org_role,
    is_default_bot: false,
    owner_id: null,
    disabled_at: null,
    avatar_url: null,
    locale: 'de',
    timezone: 'Europe/Berlin',
  };
}

export const mara = person('u_mara', 'Mara Lindqvist', 'mara', 'admin');
export const ida = person('u_ida', 'Ida Brenner', 'ida');
export const theo = person('u_theo', 'Theo Okafor', 'theo');
export const lene = person('u_lene', 'Lene Vogt', 'lene');

export function project(identifier: string, my_role: ProjectRole, changes: Partial<Project> = {}): Project {
  return {
    id: `p_${identifier.toLowerCase()}`,
    identifier,
    name: identifier,
    description: '',
    image_url: null,
    lead_id: 'u_ida',
    visibility: 'public',
    workflow_id: null,
    enabled_type_ids: [],
    default_type_id: null,
    archived_at: null,
    my_role,
    ...changes,
  };
}

/** A list answer of the REST API. */
export function list<T>(data: T[], total = data.length) {
  return { data, links: {}, meta: { next_cursor: null, total } };
}
