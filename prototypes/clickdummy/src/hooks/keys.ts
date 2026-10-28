/*
 * Query keys, one place for all of them. Every resource has `all` (the prefix of everything it caches, for
 * invalidation), `list(args)` and `detail(id)`:
 *
 *   qk.workItems.all            ['work-items']
 *   qk.workItems.list(args)     ['work-items', 'list', args]
 *   qk.workItems.detail('WEB-47')
 *
 * Hooks follow the names of the API (src/api): `listX` -> `useXs(args)`, `getX` -> `useX(id)`, and a mutation per
 * function (`useCreateX`, `useUpdateX`, `useSaveX`, `useDeleteX` …). The variables of a mutation are the parameter
 * of the API function when it has exactly one, otherwise an object with the parameters by name:
 *
 *   useArchiveWorkItem().mutate('WEB-42')                       archiveWorkItem(id)
 *   useUpdateWorkItem().mutate({ id, patch, base_description_version? })
 *   useTransitionWorkItem().mutate({ id, to_state_id, resolution_id? })
 *
 * Components never call src/api directly, only these hooks.
 */

function resource<Name extends string>(name: Name) {
  return {
    all: [name] as const,
    list: (args: unknown = {}) => [name, 'list', args] as const,
    detail: (id: string) => [name, 'detail', id] as const,
  };
}

export const qk = {
  organization: resource('organization'),
  users: resource('users'),
  invitations: resource('invitations'),
  tokens: resource('tokens'),
  projects: resource('projects'),
  members: resource('members'),
  workflows: resource('workflows'),
  workItemTypes: resource('work-item-types'),
  properties: resource('properties'),
  labels: resource('labels'),
  relationTypes: resource('relation-types'),
  resolutions: resource('resolutions'),
  workItems: { ...resource('work-items'), meta: () => ['work-items', 'meta'] as const },
  activity: resource('activity'),
  views: resource('views'),
  favorites: resource('favorites'),
  notifications: resource('notifications'),
  preferences: resource('preferences'),
  pages: resource('pages'),
  pageVersions: resource('page-versions'),
  templates: resource('templates'),
  templateRuns: resource('template-runs'),
  automations: resource('automations'),
  webhooks: resource('webhooks'),
  deliveries: resource('deliveries'),
  system: resource('system'),
  search: resource('search'),
} as const;

/** What every query hook takes besides its arguments. */
export interface HookOptions {
  /** `false` waits, e.g. until an id is known. */
  enabled?: boolean;
}
