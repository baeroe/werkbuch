import { describe, expect, it } from 'vitest';
import { projectMembers, projects, users } from '@/api/seed/people';
import { deniedReason, type Permission, type PermissionData } from './permissions';

/** The seed as one person sees it: Mara is org admin, Ida admin of WEB, Theo admin of APP and viewer in WEB, Lene member. */
const as = (userId: string, change: (data: PermissionData) => PermissionData = (data) => data): PermissionData =>
  change({ user: users.find((user) => user.id === userId)!, projects, members: projectMembers });

/** WEB archived (read-only). */
const webArchived = (data: PermissionData): PermissionData => ({
  ...data,
  projects: data.projects.map((project) => (project.identifier === 'WEB' ? { ...project, archived_at: '2026-10-20T10:00:00.000Z' } : project)),
});

describe('deniedReason (spec 4.3)', () => {
  it.each<[string, Permission, string | undefined]>([
    ['u_mara', 'org.manage', undefined],
    ['u_mara', 'org.manage_catalog', undefined],
    ['u_mara', 'view.manage_any', undefined],
    ['u_jonas', 'project.create', undefined],
    ['u_jonas', 'view.create', undefined],
    // org admins have admin rights in every project, member or not
    ['u_mara', 'project.manage', 'OPS'],
    ['u_mara', 'item.delete', 'APP'],
    ['u_theo', 'item.delete', 'APP'],
    ['u_theo', 'item.comment', 'WEB'],
    ['u_lene', 'item.create', 'p_web'],
    ['u_lene', 'wiki.edit', 'WEB'],
    ['u_lene', 'template.manage', 'APP'],
    ['u_ida', 'item.edit', 'WEB'],
  ])('%s may %s (project %s)', (userId, permission, project) => {
    expect(deniedReason(as(userId), permission, project)).toBeNull();
  });

  it.each<[string, Permission, string | undefined, RegExp]>([
    ['u_jonas', 'org.manage', undefined, /Org-Admins/],
    ['u_jonas', 'org.manage_catalog', undefined, /Org-Admins/],
    ['u_jonas', 'view.manage_any', undefined, /Org-Admins/],
    // a viewer reads and comments, but does not change
    ['u_theo', 'item.edit', 'WEB', /WEB.*nur lesen/],
    ['u_theo', 'item.create', 'WEB', /WEB.*nur lesen/],
    ['u_theo', 'wiki.edit', 'WEB', /WEB.*nur lesen/],
    ['u_theo', 'template.manage', 'WEB', /WEB.*nur lesen/],
    // deleting and the settings are for project admins
    ['u_lene', 'item.delete', 'WEB', /nur Admins des Projekts WEB/],
    ['u_lene', 'project.manage', 'WEB', /nur Admins des Projekts WEB/],
    // a private project of others stays hidden
    ['u_ida', 'item.comment', 'OPS', /siehst du nicht/],
    ['u_ida', 'item.comment', 'p_ops', /siehst du nicht/],
  ])('%s may not %s (project %s)', (userId, permission, project, reason) => {
    expect(deniedReason(as(userId), permission, project)).toMatch(reason);
  });

  it('keeps an archived project read-only, but its admins may still manage it', () => {
    expect(deniedReason(as('u_lene', webArchived), 'item.create', 'WEB')).toMatch(/WEB ist archiviert/);
    expect(deniedReason(as('u_ida', webArchived), 'item.comment', 'WEB')).toMatch(/WEB ist archiviert/);
    expect(deniedReason(as('u_ida', webArchived), 'project.manage', 'WEB')).toBeNull();
  });

  it('without a project asks whether any project allows it', () => {
    // Theo only reads WEB, but he is admin of APP
    expect(deniedReason(as('u_theo'), 'item.create')).toBeNull();
    expect(deniedReason(as('u_lene'), 'item.delete')).toMatch(/in keinem Projekt/);

    const viewerOnly = as('u_theo', (data) => ({ ...data, members: data.members.filter((member) => member.project_id !== 'p_app') }));
    // without his APP membership, Theo sees APP as a public project, read-only like WEB
    expect(deniedReason(viewerOnly, 'item.create')).toMatch(/in keinem Projekt/);
    expect(deniedReason(viewerOnly, 'item.comment')).toBeNull();
  });
});
