import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { organization } from '@/test/fixtures';
import { getOrganization, updateOrganization } from './organization';

let api: MockApi;

afterEach(() => api.restore());

describe('organization', () => {
  it('reads the organisation and changes it with a patch, both unwrapped', async () => {
    api = mockApi({
      'GET /api/v1/organization': () => ({ body: { data: organization } }),
      'PATCH /api/v1/organization': (body) => ({ body: { data: { ...organization, ...(body as object) } } }),
    });

    expect(await getOrganization()).toEqual(organization);
    expect(await updateOrganization({ name: 'Feldwerk GmbH', week_start: 0 })).toEqual({ ...organization, name: 'Feldwerk GmbH', week_start: 0 });
    expect(api.calls).toEqual([
      { method: 'GET', url: '/api/v1/organization', body: undefined },
      { method: 'PATCH', url: '/api/v1/organization', body: { name: 'Feldwerk GmbH', week_start: 0 } },
    ]);
  });
});
