import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, properties } from '@/test/fixtures';
import { deleteProperty, listProperties, saveProperty, type PropertyInput } from './properties';

let api: MockApi;

afterEach(() => api.restore());

const [customer, effort] = properties as [(typeof properties)[number], (typeof properties)[number]];

describe('properties', () => {
  it('lists the properties of one page and passes the cursor', async () => {
    api = mockApi({ 'GET /api/v1/properties': () => ({ body: list(properties) }) });

    expect(await listProperties({ cursor: 'c1' })).toEqual({ items: properties, next_cursor: null, total: 3 });
    expect(await listProperties()).toEqual({ items: properties, next_cursor: null, total: 3 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/properties?cursor=c1', '/api/v1/properties']);
  });

  it('creates a property with POST and changes one with PUT, new options without an id', async () => {
    api = mockApi({
      'POST /api/v1/properties': (body) => ({ status: 201, body: { data: { ...effort, ...(body as object), id: 'pr_new' } } }),
      'PUT /api/v1/properties/pr_customer': (body) => ({ body: { data: { ...customer, ...(body as object), id: 'pr_customer' } } }),
    });
    const { id: _effortId, ...created } = effort;
    const { id: _customerId, ...rest } = customer;
    const changed: PropertyInput = {
      ...rest,
      id: 'pr_customer',
      label: 'Auftraggeber',
      options: [...customer.options, { label: 'Neu', color: 'plum', position: 3 }],
    };

    expect((await saveProperty(created)).id).toBe('pr_new');
    expect((await saveProperty(changed)).label).toBe('Auftraggeber');
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/v1/properties', created],
      ['PUT', '/api/v1/properties/pr_customer', { ...changed, id: undefined }],
    ]);
  });

  it('answers the number of affected items of deleting a property unwrapped', async () => {
    api = mockApi({ 'DELETE /api/v1/properties/pr_effort': () => ({ body: { affected_items: 0 } }) });

    expect(await deleteProperty('pr_effort')).toEqual({ affected_items: 0 });
  });
});
