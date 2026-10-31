import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { web47, web47Relations } from '@/test/fixtures';
import { addRelation, removeRelation } from './relations';

let api: MockApi;

afterEach(() => api.restore());

describe('relations', () => {
  it('relates the source to the target and answers the relation of the entry', async () => {
    const entry = { relation: { id: 'rel_3', type_id: 'rt_blocks', source_id: 'wi_web_47', target_id: 'wi_ops_12' }, other: web47, direction: 'outward', hidden: false };
    api = mockApi({ 'POST /api/v1/work-items/WEB-47/relations': () => ({ status: 201, body: { data: entry } }) });

    expect(await addRelation('WEB-47', 'rt_blocks', 'OPS-12')).toEqual(entry.relation);
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/v1/work-items/WEB-47/relations', body: { type_id: 'rt_blocks', target_id: 'OPS-12' } });
  });

  it('refuses a duplicate at the target with the sentence of the server', async () => {
    api = mockApi({
      'POST /api/v1/work-items/WEB-47/relations': () => ({ status: 422, body: { reason: 'validation_failed', errors: { target_id: ['Diese Relation gibt es schon.'] } } }),
    });

    await expect(addRelation('WEB-47', 'rt_blocks', 'OPS-12')).rejects.toMatchObject({ status: 422, errors: { target_id: ['Diese Relation gibt es schon.'] } });
  });

  it('removes a relation by its id', async () => {
    api = mockApi({ 'DELETE /api/v1/relations/rel_1': () => ({ status: 204 }) });

    await expect(removeRelation(web47Relations[0]!.relation.id)).resolves.toBeUndefined();
    expect(api.calls.map(({ method, url }) => `${method} ${url}`)).toEqual(['DELETE /api/v1/relations/rel_1']);
  });
});
