import type { Project } from '@/types';

/** What every section of the project settings gets from the frame. */
export interface ProjectSectionProps {
  project: Project;
  /** Whether the person may change the settings (project admins and org admins). Everybody else reads. */
  canManage: boolean;
  /** Why the person may only read (from `usePermissions`); null when they manage. Read-only values carry it. */
  readOnlyReason: string | null;
}
