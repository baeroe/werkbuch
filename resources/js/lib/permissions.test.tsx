import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { ida, lene, list, mara, project, theo } from '@/test/fixtures';
import type { Project, ProjectRole, User } from '@/types';
import { deniedReason, usePermissions, type Permission, type PermissionData } from './permissions';

/**
 * The projects as one person sees them, with the role the server computes (`my_role`): Mara is org admin (admin
 * everywhere), Ida admin of WEB, Theo admin of APP and viewer in WEB, Lene member of WEB and APP. OPS is private: only
 * Mara sees it.
 */
let signedIn: User | null = lene;

vi.mock('@inertiajs/react', () => ({ usePage: () => ({ props: { auth: { user: signedIn, permissions: [] } } }) }));

const ROLES: Record<string, Record<string, ProjectRole>> = {
  u_mara: { WEB: 'admin', APP: 'admin', OPS: 'admin' },
  u_ida: { WEB: 'admin', APP: 'viewer' },
  u_theo: { WEB: 'viewer', APP: 'admin' },
  u_lene: { WEB: 'member', APP: 'member' },
};
const PEOPLE: Record<string, User> = { u_mara: mara, u_ida: ida, u_theo: theo, u_lene: lene };

const as = (userId: string, change: (projects: Project[]) => Project[] = (projects) => projects): PermissionData => ({
  user: PEOPLE[userId]!,
  projects: change(Object.entries(ROLES[userId]!).map(([identifier, role]) => project(identifier, role))),
});

/** WEB archived (read-only). */
const webArchived = (projects: Project[]) => projects.map((entry) => (entry.identifier === 'WEB' ? { ...entry, archived_at: '2026-10-20T10:00:00.000Z' } : entry));

describe('deniedReason (spec 4.3)', () => {
  it.each<[string, Permission, string | undefined]>([
    ['u_mara', 'org.manage', undefined],
    ['u_mara', 'org.manage_catalog', undefined],
    ['u_mara', 'view.manage_any', undefined],
    ['u_lene', 'project.create', undefined],
    ['u_lene', 'view.create', undefined],
    // org admins have admin rights in every project, member or not: the server says so in my_role
    ['u_mara', 'project.manage', 'OPS'],
    ['u_mara', 'item.delete', 'APP'],
    ['u_theo', 'item.delete', 'APP'],
    ['u_theo', 'item.comment', 'WEB'],
    ['u_lene', 'item.create', 'p_web'],
    ['u_lene', 'item.edit', 'WEB'],
    ['u_lene', 'wiki.edit', 'WEB'],
    ['u_lene', 'template.manage', 'APP'],
    ['u_ida', 'project.manage', 'WEB'],
  ])('%s may %s (project %s)', (userId, permission, ref) => {
    expect(deniedReason(as(userId), permission, ref)).toBeNull();
  });

  it.each<[string, Permission, string | undefined, string]>([
    ['u_lene', 'org.manage', undefined, 'Organisation, Personen, Bots und Webhooks verwalten nur Org-Admins.'],
    ['u_lene', 'org.manage_catalog', undefined, 'Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.'],
    ['u_lene', 'view.manage_any', undefined, 'Fremde Views ändern und löschen nur Org-Admins.'],
    // a viewer reads and comments, but does not change
    ['u_theo', 'item.create', 'WEB', 'Im Projekt WEB darfst du nur lesen. Items anlegen dürfen Member und Admins.'],
    ['u_theo', 'item.edit', 'WEB', 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.'],
    ['u_theo', 'wiki.edit', 'WEB', 'Im Projekt WEB darfst du nur lesen. Das Wiki bearbeiten dürfen Member und Admins.'],
    ['u_theo', 'template.manage', 'WEB', 'Im Projekt WEB darfst du nur lesen. Vorlagen verwalten dürfen Member und Admins.'],
    // deleting and the settings are for project admins
    ['u_lene', 'item.delete', 'WEB', 'Items löschen dürfen nur Admins des Projekts WEB.'],
    ['u_lene', 'project.manage', 'WEB', 'Projekteinstellungen ändern dürfen nur Admins des Projekts WEB.'],
    // a private project of others is not in the list
    ['u_ida', 'item.comment', 'OPS', 'Dieses Projekt siehst du nicht.'],
    ['u_ida', 'item.comment', 'p_ops', 'Dieses Projekt siehst du nicht.'],
  ])('%s may not %s (project %s)', (userId, permission, ref, reason) => {
    expect(deniedReason(as(userId), permission, ref)).toBe(reason);
  });

  it('keeps an archived project read-only, but its admins may still manage it', () => {
    expect(deniedReason(as('u_lene', webArchived), 'item.create', 'WEB')).toBe('Das Projekt WEB ist archiviert und schreibgeschützt.');
    expect(deniedReason(as('u_ida', webArchived), 'item.comment', 'WEB')).toBe('Das Projekt WEB ist archiviert und schreibgeschützt.');
    expect(deniedReason(as('u_ida', webArchived), 'project.manage', 'WEB')).toBeNull();
  });

  it('without a project asks whether any project allows it', () => {
    // Theo only reads WEB, but he is admin of APP
    expect(deniedReason(as('u_theo'), 'item.create')).toBeNull();
    expect(deniedReason(as('u_lene'), 'item.delete')).toBe('Items löschen darfst du in keinem Projekt.');

    // without his APP membership, Theo sees APP as a public project, read-only like WEB
    const viewerOnly = as('u_theo', (projects) => projects.map((entry) => ({ ...entry, my_role: 'viewer' as const })));
    expect(deniedReason(viewerOnly, 'item.create')).toBe('Items anlegen darfst du in keinem Projekt.');
    expect(deniedReason(viewerOnly, 'item.comment')).toBeNull();
  });

  it.each<[Permission, string]>([
    ['project.manage', 'Projekteinstellungen ändern darfst du in keinem Projekt.'],
    ['item.create', 'Items anlegen darfst du in keinem Projekt.'],
    ['item.edit', 'Items ändern darfst du in keinem Projekt.'],
    ['item.delete', 'Items löschen darfst du in keinem Projekt.'],
    ['item.comment', 'Kommentieren darfst du in keinem Projekt.'],
    ['wiki.edit', 'Das Wiki bearbeiten darfst du in keinem Projekt.'],
    ['template.manage', 'Vorlagen verwalten darfst du in keinem Projekt.'],
  ])('names %s as allowed in no project when there is none to see', (permission, reason) => {
    expect(deniedReason(as('u_lene', () => []), permission)).toBe(reason);
  });
});

describe('usePermissions', () => {
  let api: MockApi;

  function Probe() {
    const { loading, can, reason } = usePermissions();
    return <p>{loading ? 'lädt' : can('item.edit', 'WEB') ? 'darf ändern' : `nein: ${reason('item.edit', 'WEB')}`}</p>;
  }

  const show = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Probe />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    signedIn = lene;
  });

  afterEach(() => api.restore());

  it('says that the rights still load, until the projects are there, archived ones included', async () => {
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'member')]) }) });
    show();

    expect(screen.getByText('lädt')).toBeTruthy();
    expect(await screen.findByText('darf ändern')).toBeTruthy();
    expect(api.calls[0]!.url).toBe('/api/v1/projects?include_archived=1');
  });

  it('names the reason once the rights are there', async () => {
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'viewer')]) }) });
    show();

    expect(await screen.findByText('nein: Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.')).toBeTruthy();
  });

  it('stops loading when the rights cannot be loaded, and gives that as the reason', async () => {
    api = mockApi({ 'GET /api/v1/projects': () => ({ status: 503, body: { reason: 'service_unavailable' } }) });
    show();

    expect(await screen.findByText('nein: Die Rechte konnten nicht geladen werden.')).toBeTruthy();
  });

  it('allows nothing on a page without a signed-in person, and asks the API for nothing', async () => {
    signedIn = null;
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }) });
    show();

    await new Promise((done) => setTimeout(done, 20));
    expect(api.calls).toHaveLength(0);
    expect(screen.getByText('lädt')).toBeTruthy();
  });
});
