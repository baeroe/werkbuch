/*
 * Query keys, one place for all of them. Every resource has `all` (the prefix of everything it caches, for
 * invalidation), `list(args)` and `detail(id)`:
 *
 *   qk.workItems.all            ['work-items']
 *   qk.workItems.list(args)     ['work-items', 'list', args]
 *   qk.workItems.detail('WEB-47')
 *
 * The pages of a long list are lists of their own (`qk.workItems.list({...args, cursor})`, also the pages of every
 * group), so the optimistic item changes reach them; the groups and counts of item lists (`qk.workItems.groups`,
 * `qk.workItems.counts`) lie under `qk.workItems.all` too, so every item change makes them stale.
 *
 * Hooks follow the names of the API (`@/api`): `listX` -> `useXs(args)`, `getX` -> `useX(id)`, and a mutation per
 * function (`useCreateX`, `useUpdateX`, `useSaveX`, `useDeleteX` …). The variables of a mutation are the parameter
 * of the API function when it has exactly one, otherwise an object with the parameters by name:
 *
 *   useArchiveWorkItem().mutate('WEB-42')                       archiveWorkItem(id)
 *   useUpdateWorkItem().mutate({ id, patch, base_description_version? })
 *   useTransitionWorkItem().mutate({ id, to_state_id, resolution_id? })
 *
 * Components never call `@/api` directly, only these hooks. Resources of later phases have their keys here already.
 * The work items have no `meta` key: progress, blocked and blocking come with every item (P7). `stateUsage` counts the
 * items per state for the mapping of states: whatever moves items between states, creates or deletes them makes it
 * stale (the item mutations, saving and switching a workflow). The activity of an item mixes its history and its
 * comments (A247): `qk.activity` holds the history, `qk.comments` the comments; whatever changes a comment makes both
 * stale.
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
  twoFactor: resource('two-factor'),
  projects: resource('projects'),
  members: resource('members'),
  workflows: resource('workflows'),
  workItemTypes: resource('work-item-types'),
  properties: resource('properties'),
  labels: resource('labels'),
  relationTypes: resource('relation-types'),
  resolutions: resource('resolutions'),
  workItems: {
    ...resource('work-items'),
    /** The groups of a list (`useWorkItemGroups`) and the counts of named filters (`useWorkItemCounts`). */
    groups: (args: unknown) => ['work-items', 'groups', args] as const,
    counts: (args: unknown) => ['work-items', 'counts', args] as const,
  },
  stateUsage: resource('state-usage'),
  attachments: resource('attachments'),
  activity: resource('activity'),
  /** The comments of an item: `qk.comments.list({ item, pages: 'all' })`. */
  comments: resource('comments'),
  /** Who can be mentioned with `@`: `qk.mentions.list({ project, q })`. */
  mentions: resource('mentions'),
  /** The item behind a stored reference, one entry per id (`useItemRef`); a hidden one is an error 404. */
  references: {
    all: ['references'] as const,
    item: (id: string) => ['references', 'item', id] as const,
  },
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
