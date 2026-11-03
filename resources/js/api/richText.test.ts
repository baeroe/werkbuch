import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { ida, mara, web47 } from '@/test/fixtures';
import { listMentionables, resolveReferences } from './richText';

let api: MockApi;

afterEach(() => api.restore());

const sent = () => api.calls.map(({ method, url }) => `${method} ${url}`);

describe('rich text', () => {
  it('lists who can be mentioned in a project, with the typed text and a limit', async () => {
    api = mockApi({ 'GET /api/v1/mentions': () => ({ body: { data: [ida, mara] } }) });

    expect(await listMentionables('WEB', 'i', 6)).toEqual([ida, mara]);
    expect(await listMentionables('p_web', '')).toEqual([ida, mara]);
    expect(sent()).toEqual(['GET /api/v1/mentions?project=WEB&q=i&limit=6', 'GET /api/v1/mentions?project=p_web&q=']);
  });

  it('resolves the items behind references in one call: those the reader sees', async () => {
    api = mockApi({ 'GET /api/v1/references': () => ({ body: { data: { items: [web47] } } }) });

    expect(await resolveReferences(['wi_web_47', 'wi_ops_12'])).toEqual([web47]);
    expect(sent()).toEqual(['GET /api/v1/references?items=wi_web_47%2Cwi_ops_12']);
  });
});
