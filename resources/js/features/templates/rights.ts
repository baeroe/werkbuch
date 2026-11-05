/*
 * Who may manage the templates of a project (`template.manage`, spec 4.3: members and admins; viewers read).
 * `usePermissions()` denies everything until its data has loaded; `ready` says when that is over (like `useOrgRight`),
 * so a member is not shown "read only" for a moment, nor a viewer a button that goes away.
 */

import { usePermissions } from '@/lib/permissions';

export interface TemplateRights {
  /** Whether the rights have loaded (or failed to: then `denied` says so). */
  ready: boolean;
  /** Why the person may not manage the templates of the project, or null when they may. */
  denied: string | null;
}

export function useTemplateRights(projectId: string): TemplateRights {
  const { reason, loading } = usePermissions();
  return { ready: !loading, denied: reason('template.manage', projectId) };
}
