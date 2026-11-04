import { afterEach, describe, expect, it } from 'vitest';
import { textDoc } from '@/lib/richtext';
import { mockApi, type MockApi } from '@/test/api';
import { list, makePage, seitenstruktur, webTree } from '@/test/fixtures';
import type { PageVersion, PageVersionDetail } from '@/types';
import { createPage, deletePage, getPage, getPageVersion, listPages, listPageVersions, movePage, restorePageVersion, savePage } from './pages';

let api: MockApi;

afterEach(() => api.restore());

const sent = () => api.calls.map(({ method, url }) => `${method} ${url}`);

const version = (number: number): PageVersion => ({
  id: `pv_structure_${number}`,
  page_id: 'pg_web_structure',
  version: number,
  title: 'Seitenstruktur',
  author_id: 'u_ida',
  created_at: `2026-10-0${number}T09:00:00.000Z`,
});

describe('pages', () => {
  it('lists the tree of a project as one page: the whole tree, its total and no cursor', async () => {
    api = mockApi({ 'GET /api/v1/projects/WEB/pages': () => ({ body: { data: webTree, meta: { total: 12 } } }) });

    expect(await listPages('WEB')).toEqual({ items: webTree, next_cursor: null, total: 12 });
    expect(sent()).toEqual(['GET /api/v1/projects/WEB/pages']);
  });

  it('reads a page with its text as Markdown and Tiptap JSON', async () => {
    api = mockApi({ 'GET /api/v1/pages/pg_web_structure': () => ({ body: { data: seitenstruktur } }) });

    expect(await getPage('pg_web_structure')).toEqual(seitenstruktur);
  });

  it('creates a page with its text as content_json, and what was left out as null', async () => {
    const content = textDoc('Erste Notizen.');
    const page = makePage({ content: 'Erste Notizen.', content_json: content });
    api = mockApi({ 'POST /api/v1/projects/p_web/pages': () => ({ status: 201, body: { data: page } }) });

    expect(await createPage({ project_id: 'p_web', parent_id: 'pg_web_tech', title: 'Neue Seite', emoji: '📝', content })).toEqual(page);
    await createPage({ project_id: 'p_web', title: 'Leer' });
    expect(api.calls.map((call) => call.body)).toEqual([
      { title: 'Neue Seite', emoji: '📝', parent_id: 'pg_web_tech', content_json: content },
      { title: 'Leer', emoji: null, parent_id: null, content_json: null },
    ]);
  });

  it('saves a page with a PATCH of its text as content_json on its base version, keep_current only when given', async () => {
    const content = textDoc('Neu.');
    const saved = { ...seitenstruktur, content: 'Neu.', content_json: content, version: 4 };
    api = mockApi({ 'PATCH /api/v1/pages/pg_web_structure': () => ({ body: { data: saved } }) });

    expect(await savePage('pg_web_structure', { title: 'Seitenstruktur', emoji: '🧭', content, base_version: 3 })).toEqual(saved);
    await savePage('pg_web_structure', { title: 'Seitenstruktur', emoji: null, content: null, base_version: 4, keep_current: true });
    expect(api.calls.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'PATCH', url: '/api/v1/pages/pg_web_structure', body: { title: 'Seitenstruktur', emoji: '🧭', content_json: content, base_version: 3 } },
      { method: 'PATCH', url: '/api/v1/pages/pg_web_structure', body: { title: 'Seitenstruktur', emoji: null, content_json: null, base_version: 4, keep_current: true } },
    ]);
  });

  it('refuses a save on an outdated version with page_conflict and the stored page as current', async () => {
    const current = { ...seitenstruktur, version: 4, updated_by: 'u_lene' };
    api = mockApi({
      'PATCH /api/v1/pages/pg_web_structure': () => ({
        status: 409,
        body: { reason: 'page_conflict', detail: 'Lene Vogt hat die Seite inzwischen geändert.', current },
      }),
    });

    const error = await savePage('pg_web_structure', { title: 'Seitenstruktur', emoji: '🧭', content: null, base_version: 3 }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 409, reason: 'page_conflict', message: 'Lene Vogt hat die Seite inzwischen geändert.' });
    expect((error as { current: unknown }).current).toEqual(current);
  });

  it('moves a page below a parent in front of a sibling, or to the end of the top level', async () => {
    const moved = { ...seitenstruktur, parent_id: 'pg_web_tech', rank: 'Zz' };
    api = mockApi({ 'POST /api/v1/pages/pg_web_structure/move': () => ({ body: { data: moved } }) });

    expect(await movePage('pg_web_structure', 'pg_web_tech', 'pg_web_contactform')).toEqual(moved);
    await movePage('pg_web_structure', null, null);
    expect(api.calls.map((call) => call.body)).toEqual([
      { parent_id: 'pg_web_tech', before_id: 'pg_web_contactform' },
      { parent_id: null, before_id: null },
    ]);
  });

  it('deletes a page with its subtree and answers how many pages went', async () => {
    api = mockApi({ 'DELETE /api/v1/pages/pg_web_tech': () => ({ body: { deleted: 5 } }) });

    expect(await deletePage('pg_web_tech')).toEqual({ deleted: 5 });
    expect(sent()).toEqual(['DELETE /api/v1/pages/pg_web_tech']);
  });

  it('lists every version of a page, following the cursor to the end', async () => {
    api = mockApi({
      'GET /api/v1/pages/pg_web_structure/versions': (_body, url) =>
        url.searchParams.get('cursor') === null
          ? { body: { ...list([version(3), version(2)], 3), meta: { next_cursor: 'v2', total: 3 } } }
          : { body: { ...list([version(1)], 3), meta: { next_cursor: null, total: 3 } } },
    });

    expect(await listPageVersions('pg_web_structure')).toEqual({ items: [version(3), version(2), version(1)], next_cursor: null, total: 3 });
    expect(sent()).toEqual(['GET /api/v1/pages/pg_web_structure/versions', 'GET /api/v1/pages/pg_web_structure/versions?cursor=v2']);
  });

  it('reads one version with its text', async () => {
    const detail: PageVersionDetail = { ...version(2), content: 'Alt.', content_json: textDoc('Alt.') };
    api = mockApi({ 'GET /api/v1/pages/pg_web_structure/versions/pv_structure_2': () => ({ body: { data: detail } }) });

    expect(await getPageVersion('pg_web_structure', 'pv_structure_2')).toEqual(detail);
  });

  it('restores a version and answers the page in its new version', async () => {
    const restored = { ...seitenstruktur, version: 4 };
    api = mockApi({ 'POST /api/v1/pages/pg_web_structure/versions/pv_structure_2/restore': () => ({ body: { data: restored } }) });

    expect(await restorePageVersion('pg_web_structure', 'pv_structure_2')).toEqual(restored);
    expect(sent()).toEqual(['POST /api/v1/pages/pg_web_structure/versions/pv_structure_2/restore']);
  });
});
