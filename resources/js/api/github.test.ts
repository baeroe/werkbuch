import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import type { GitHubStatus, ProjectRepository } from '@/types';
import { confirmMergeGuard, disconnectGitHub, getGitHub, getProjectRepository, setProjectRepository, startGitHubManifest, syncGitHub } from './github';

let api: MockApi;

afterEach(() => api.restore());

const status: GitHubStatus = { apps: [], repositories: [] };
const repository = { project_id: 'p_web', base_branch: 'main', guard: null } as ProjectRepository;

describe('github', () => {
  it('reads, syncs and disconnects one app', async () => {
    api = mockApi({
      'GET /api/v1/github': () => ({ body: { data: status } }),
      'POST /api/v1/github/sync': () => ({ body: { data: status } }),
      'DELETE /api/v1/github/apps/app_1': () => ({ body: { canceled: 1 } }),
    });

    expect(await getGitHub()).toEqual(status);
    expect(await syncGitHub()).toEqual(status);
    expect(await disconnectGitHub('app_1')).toEqual({ canceled: 1 });
  });

  it('starts the manifest flow for an organization or the own account', async () => {
    const start = { url: 'https://github.com/settings/apps/new?state=s', manifest: { name: 'feldwerk werkbuch' }, state: 's' };
    api = mockApi({ 'POST /api/v1/github/manifest': () => ({ body: { data: start } }) });

    expect(await startGitHubManifest({ owner: 'feldwerk', owner_type: 'Organization' })).toEqual(start);
    await startGitHubManifest({ owner: 'mara', owner_type: 'User' });
    expect(api.calls.map((call) => call.body)).toEqual([{ owner: 'feldwerk', owner_type: 'Organization' }, { owner: 'mara', owner_type: 'User' }]);
  });

  it('reads and sets the repo of a project and confirms its guard', async () => {
    api = mockApi({
      'GET /api/v1/projects/WEB/repository': () => ({ body: { data: null } }),
      'PUT /api/v1/projects/WEB/repository': () => ({ body: { data: repository } }),
      'POST /api/v1/projects/WEB/repository/confirm-guard': () => ({ body: { data: repository } }),
    });

    expect(await getProjectRepository('WEB')).toBeNull();
    expect(await setProjectRepository('WEB', { repository_id: 'feldwerk/website', base_branch: null })).toEqual(repository);
    expect(await confirmMergeGuard('WEB')).toEqual(repository);
    expect(api.calls[1]!.body).toEqual({ repository_id: 'feldwerk/website', base_branch: null });
  });
});
