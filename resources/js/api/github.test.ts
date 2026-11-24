import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import type { GitHubStatus, ProjectRepository } from '@/types';
import { confirmMergeGuard, disconnectGitHub, getGitHub, getProjectRepository, setProjectRepository, startGitHubManifest, syncGitHub } from './github';

let api: MockApi;

afterEach(() => api.restore());

const status: GitHubStatus = { app: null, installations: [], repositories: [] };
const repository = { project_id: 'p_web', base_branch: 'main', guard: null } as ProjectRepository;

describe('github', () => {
  it('reads, syncs and disconnects the connection', async () => {
    api = mockApi({
      'GET /api/v1/github': () => ({ body: { data: status } }),
      'POST /api/v1/github/sync': () => ({ body: { data: status } }),
      'DELETE /api/v1/github': () => ({ body: { canceled: 1 } }),
    });

    expect(await getGitHub()).toEqual(status);
    expect(await syncGitHub()).toEqual(status);
    expect(await disconnectGitHub()).toEqual({ canceled: 1 });
  });

  it('starts the manifest flow for an organization or the own account', async () => {
    const start = { url: 'https://github.com/settings/apps/new?state=s', manifest: { name: 'Feldwerk werkbuch' }, state: 's' };
    api = mockApi({ 'POST /api/v1/github/manifest': () => ({ body: { data: start } }) });

    expect(await startGitHubManifest('feldwerk')).toEqual(start);
    await startGitHubManifest(null);
    expect(api.calls.map((call) => call.body)).toEqual([{ organization: 'feldwerk' }, { organization: null }]);
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
