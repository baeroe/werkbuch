import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { searchResults, web47 } from '@/test/fixtures';
import { search } from './search';

let api: MockApi;

afterEach(() => api.restore());

describe('search', () => {
  it('asks the search with the query and only the options given', async () => {
    api = mockApi({ 'GET /api/v1/search': () => ({ body: { data: searchResults() } }) });

    await search('kontakt');
    await search('kontakt', { types: ['items', 'projects'], limit: 20, include_archived: true });
    await search('kontakt', { limit: 5 });

    expect(api.calls.map((call) => call.url)).toEqual([
      '/api/v1/search?q=kontakt',
      '/api/v1/search?q=kontakt&types=items%2Cprojects&limit=20&include_archived=1',
      '/api/v1/search?q=kontakt&limit=5',
    ]);
  });

  it('unwraps data', async () => {
    const hits = searchResults({ items: [web47], key_match: web47.id });
    api = mockApi({ 'GET /api/v1/search': () => ({ body: { data: hits } }) });

    expect(await search('WEB-47')).toEqual(hits);
  });
});
