import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, project } from '@/test/fixtures';
import type { ProjectMember } from '@/types';
import {
  addMember,
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  joinProject,
  listMembers,
  listProjects,
  removeMember,
  updateMemberRole,
  updateProject,
} from './projects';

let api: MockApi;

afterEach(() => api.restore());

const web = project('WEB', 'admin', { id: 'p1' });

describe('projects', () => {
  it('lists projects as a page and archives through archive or restore', async () => {
    api = mockApi({
      'GET /api/v1/projects': () => ({ body: { data: [web], links: {}, meta: { next_cursor: null, total: 1 } } }),
      'POST /api/v1/projects/p1/archive': () => ({ body: { data: { ...web, archived_at: '2026-10-28T09:00:00.000Z' } } }),
      'POST /api/v1/projects/p1/restore': () => ({ body: { data: { ...web, archived_at: null } } }),
    });

    expect(await listProjects({ include_archived: true })).toEqual({ items: [web], next_cursor: null, total: 1 });
    expect(api.calls[0]!.url).toBe('/api/v1/projects?include_archived=1');
    expect((await archiveProject('p1')).archived_at).toBe('2026-10-28T09:00:00.000Z');
    expect(await archiveProject('p1', false)).toEqual(web);
    expect(api.calls.slice(1).map(({ method, url }) => `${method} ${url}`)).toEqual(['POST /api/v1/projects/p1/archive', 'POST /api/v1/projects/p1/restore']);

    await listProjects();
    expect(api.calls[3]!.url).toBe('/api/v1/projects');
  });

  it('reads one project by an identifier, escaped for the path', async () => {
    api = mockApi({ 'GET /api/v1/projects/WEB': () => ({ body: { data: web } }), 'GET /api/v1/projects/a%2Fb': () => ({ status: 404, body: { reason: 'not_found' } }) });

    expect(await getProject('WEB')).toEqual(web);
    await expect(getProject('a/b')).rejects.toMatchObject({ status: 404, reason: 'not_found' });
  });

  it('creates, changes and deletes a project', async () => {
    api = mockApi({
      'POST /api/v1/projects': () => ({ status: 201, body: { data: web } }),
      'PATCH /api/v1/projects/p1': (body) => ({ body: { data: { ...web, ...(body as object) } } }),
      'DELETE /api/v1/projects/p1': () => ({ status: 202 }),
    });

    const input = { name: 'Website', identifier: 'WEB', visibility: 'public' as const };
    expect(await createProject(input)).toEqual(web);
    expect(await updateProject('p1', { name: 'Webseite' })).toEqual({ ...web, name: 'Webseite' });
    await expect(deleteProject('p1')).resolves.toBeUndefined();
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/v1/projects', input],
      ['PATCH', '/api/v1/projects/p1', { name: 'Webseite' }],
      ['DELETE', '/api/v1/projects/p1', undefined],
    ]);
  });

  it('lists the members of one project, joins, adds, changes and removes members', async () => {
    const ida: ProjectMember = { project_id: 'p1', user_id: 'u_ida', role: 'admin' };
    const lene: ProjectMember = { project_id: 'p1', user_id: 'u_lene', role: 'member' };
    api = mockApi({
      'GET /api/v1/projects/WEB/members': () => ({ body: list([ida]) }),
      'POST /api/v1/projects/p1/join': () => ({ status: 201, body: { data: lene } }),
      'POST /api/v1/projects/p1/members': (body) => ({ status: 201, body: { data: { project_id: 'p1', ...(body as object) } } }),
      'PATCH /api/v1/projects/p1/members/u_lene': (body) => ({ body: { data: { ...lene, ...(body as object) } } }),
      'DELETE /api/v1/projects/p1/members/u_lene': () => ({}),
    });

    expect(await listMembers('WEB')).toEqual({ items: [ida], next_cursor: null, total: 1 });
    expect(await joinProject('p1')).toEqual(lene);
    expect(await addMember('p1', 'u_lene', 'viewer')).toEqual({ ...lene, role: 'viewer' });
    expect(await updateMemberRole('p1', 'u_lene', 'admin')).toEqual({ ...lene, role: 'admin' });
    await expect(removeMember('p1', 'u_lene')).resolves.toBeUndefined();
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['GET', '/api/v1/projects/WEB/members', undefined],
      ['POST', '/api/v1/projects/p1/join', undefined],
      ['POST', '/api/v1/projects/p1/members', { user_id: 'u_lene', role: 'viewer' }],
      ['PATCH', '/api/v1/projects/p1/members/u_lene', { role: 'admin' }],
      ['DELETE', '/api/v1/projects/p1/members/u_lene', undefined],
    ]);
  });
});
