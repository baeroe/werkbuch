import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { labels, list, relationTypes, resolutions } from '@/test/fixtures';
import {
  deleteLabel,
  deleteRelationType,
  deleteResolution,
  listLabels,
  listRelationTypes,
  listResolutions,
  saveLabel,
  saveRelationType,
  saveResolution,
} from './catalog';

let api: MockApi;

afterEach(() => api.restore());

/** The route that answers a save with the body it got, under the given id. */
const echo = (id: string, status = 200) => (body: unknown) => ({ status, body: { data: { ...(body as object), id } } });

describe('catalog lists', () => {
  it('lists labels, relation types and resolutions of one page and passes the cursor', async () => {
    api = mockApi({
      'GET /api/v1/labels': () => ({ body: list(labels) }),
      'GET /api/v1/relation-types': () => ({ body: list(relationTypes) }),
      'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    });

    expect((await listLabels({ cursor: 'a' })).items).toEqual(labels);
    expect((await listRelationTypes({ cursor: 'b' })).items).toEqual(relationTypes);
    expect((await listResolutions({ cursor: 'c' })).items).toEqual(resolutions);
    expect((await listLabels()).total).toBe(4);
    expect((await listRelationTypes()).total).toBe(4);
    expect((await listResolutions()).total).toBe(4);
    expect(api.calls.map((call) => call.url)).toEqual([
      '/api/v1/labels?cursor=a',
      '/api/v1/relation-types?cursor=b',
      '/api/v1/resolutions?cursor=c',
      '/api/v1/labels',
      '/api/v1/relation-types',
      '/api/v1/resolutions',
    ]);
  });
});

describe('catalog saves', () => {
  it('creates with POST and changes with PUT, the id out of the body', async () => {
    api = mockApi({
      'POST /api/v1/labels': echo('lb_new', 201),
      'PUT /api/v1/labels/lb_ux': echo('lb_ux'),
      'POST /api/v1/relation-types': echo('rt_new', 201),
      'PUT /api/v1/relation-types/rt_tests': echo('rt_tests'),
      'POST /api/v1/resolutions': echo('res_new', 201),
      'PUT /api/v1/resolutions/res_duplicate': echo('res_duplicate'),
    });

    expect((await saveLabel({ name: 'Neu', color: 'sky' })).id).toBe('lb_new');
    expect((await saveLabel({ id: 'lb_ux', name: 'Bedienung', color: 'sky' })).name).toBe('Bedienung');
    expect((await saveRelationType({ name: 'ersetzt', outward_label: 'ersetzt', inward_label: null, built_in: null })).id).toBe('rt_new');
    expect((await saveRelationType({ id: 'rt_tests', name: 'prüft', outward_label: 'prüft', inward_label: 'wird geprüft von', built_in: null })).name).toBe('prüft');
    expect((await saveResolution({ label: 'Obsolete', default_for: null, position: 4, archived_at: null })).id).toBe('res_new');
    expect((await saveResolution({ id: 'res_duplicate', label: 'Doppelt', default_for: null, position: 2, archived_at: null })).label).toBe('Doppelt');
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/v1/labels', { name: 'Neu', color: 'sky' }],
      ['PUT', '/api/v1/labels/lb_ux', { name: 'Bedienung', color: 'sky' }],
      ['POST', '/api/v1/relation-types', { name: 'ersetzt', outward_label: 'ersetzt', inward_label: null, built_in: null }],
      ['PUT', '/api/v1/relation-types/rt_tests', { name: 'prüft', outward_label: 'prüft', inward_label: 'wird geprüft von', built_in: null }],
      ['POST', '/api/v1/resolutions', { label: 'Obsolete', default_for: null, position: 4, archived_at: null }],
      ['PUT', '/api/v1/resolutions/res_duplicate', { label: 'Doppelt', default_for: null, position: 2, archived_at: null }],
    ]);
  });
});

describe('catalog deletes', () => {
  it('answers what the server counted or decided unwrapped', async () => {
    api = mockApi({
      'DELETE /api/v1/labels/lb_ux': () => ({ body: { affected_items: 0 } }),
      'DELETE /api/v1/relation-types/rt_tests': () => ({ body: { affected_relations: 0 } }),
      'DELETE /api/v1/resolutions/res_duplicate': () => ({ body: { outcome: 'deleted' } }),
      'DELETE /api/v1/resolutions/res_done': () => ({ body: { outcome: 'archived' } }),
    });

    expect(await deleteLabel('lb_ux')).toEqual({ affected_items: 0 });
    expect(await deleteRelationType('rt_tests')).toEqual({ affected_relations: 0 });
    expect(await deleteResolution('res_duplicate')).toEqual({ outcome: 'deleted' });
    expect(await deleteResolution('res_done')).toEqual({ outcome: 'archived' });
  });
});
