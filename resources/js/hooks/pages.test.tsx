import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLiveGone, markLiveGone, usePageGone } from '@/lib/liveGone';
import { mockApi, type MockApi } from '@/test/api';
import { list, makePage, seitenstruktur, webTree } from '@/test/fixtures';
import type { PageVersion, PageVersionDetail } from '@/types';
import { qk } from './keys';
import {
  useCreatePage,
  useDeletePage,
  useMovePage,
  usePage,
  usePages,
  usePageVersion,
  usePageVersions,
  useRestorePageVersion,
  useSavePage,
} from './pages';

let queryClient: QueryClient;
let api: MockApi | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  clearLiveGone();
});

const version: PageVersion = { id: 'pv_structure_2', page_id: 'pg_web_structure', version: 2, title: 'Seitenstruktur', author_id: 'u_ida', created_at: '2026-10-08T09:00:00.000Z' };
const versionDetail: PageVersionDetail = { ...version, content: null, content_json: null };

describe('pages', () => {
  it('reads the tree, a page, its versions and one version, and waits without an id', async () => {
    api = mockApi({
      'GET /api/v1/projects/p_web/pages': () => ({ body: { data: webTree, meta: { total: 12 } } }),
      'GET /api/v1/pages/pg_web_structure': () => ({ body: { data: seitenstruktur } }),
      'GET /api/v1/pages/pg_web_structure/versions': () => ({ body: list([version]) }),
      'GET /api/v1/pages/pg_web_structure/versions/pv_structure_2': () => ({ body: { data: versionDetail } }),
    });
    const { result } = renderHook(
      () => ({
        tree: usePages('p_web'),
        page: usePage('pg_web_structure'),
        versions: usePageVersions('pg_web_structure'),
        version: usePageVersion('pg_web_structure', 'pv_structure_2'),
        idle: [usePages(null), usePage(undefined), usePageVersions(null), usePageVersion('pg_web_structure', null)],
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.version.data).toEqual(versionDetail));
    await waitFor(() => expect(result.current.versions.data?.items).toEqual([version]));
    expect(result.current.tree.data).toEqual({ items: webTree, next_cursor: null, total: 12 });
    expect(result.current.page.data).toEqual(seitenstruktur);
    expect(result.current.idle.map((query) => query.fetchStatus)).toEqual(['idle', 'idle', 'idle', 'idle']);
    expect(queryClient.getQueryData(qk.pages.list({ project: 'p_web' }))).toBeDefined();
    expect(queryClient.getQueryData(qk.pageVersions.list({ page: 'pg_web_structure' }))).toBeDefined();
    expect(queryClient.getQueryData(qk.pageVersions.detail('pv_structure_2'))).toEqual(versionDetail);
    expect(api.calls).toHaveLength(4);
  });

  it('does not ask for a page, or its versions, the tab knows is deleted', () => {
    api = mockApi({});
    markLiveGone('pg_web_structure', 'page');
    const { result } = renderHook(
      () => [usePage('pg_web_structure'), usePageVersions('pg_web_structure'), usePageVersion('pg_web_structure', 'pv_structure_2')],
      { wrapper },
    );

    expect(result.current.map((query) => query.fetchStatus)).toEqual(['idle', 'idle', 'idle']);
    expect(api.calls).toEqual([]);
  });

  it('makes the pages, their versions and the search stale after every change', async () => {
    api = mockApi({
      'POST /api/v1/projects/p_web/pages': () => ({ status: 201, body: { data: makePage() } }),
      'PATCH /api/v1/pages/pg_web_structure': () => ({ body: { data: { ...seitenstruktur, version: 4 } } }),
      'POST /api/v1/pages/pg_web_structure/move': () => ({ body: { data: seitenstruktur } }),
      'POST /api/v1/pages/pg_web_structure/versions/pv_structure_2/restore': () => ({ body: { data: { ...seitenstruktur, version: 5 } } }),
      'DELETE /api/v1/pages/pg_web_kickoff': () => ({ body: { deleted: 1 } }),
    });
    const probes = [qk.pages.list({ project: 'p_web' }), qk.pageVersions.list({ page: 'pg_web_design' }), qk.search.list({ q: 'seite' }), qk.workItems.all];
    const fill = () => probes.forEach((queryKey) => queryClient.setQueryData(queryKey, { items: [], next_cursor: null, total: 0 }));
    const stale = () => probes.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated);
    const { result } = renderHook(
      () => ({ create: useCreatePage(), save: useSavePage(), move: useMovePage(), restore: useRestorePageVersion(), remove: useDeletePage() }),
      { wrapper },
    );

    const changes: (() => Promise<unknown>)[] = [
      () => result.current.create.mutateAsync({ project_id: 'p_web', title: 'Neue Seite' }),
      () => result.current.save.mutateAsync({ id: 'pg_web_structure', input: { title: 'Seitenstruktur', emoji: '🧭', content: null, base_version: 3 } }),
      () => result.current.move.mutateAsync({ id: 'pg_web_structure', parent_id: null, before_id: 'pg_web_tech' }),
      () => result.current.restore.mutateAsync({ page_id: 'pg_web_structure', version_id: 'pv_structure_2' }),
      () => result.current.remove.mutateAsync('pg_web_kickoff'),
    ];
    for (const change of changes) {
      fill();
      await act(change);
      expect(stale()).toEqual([true, true, true, false]);
    }
    expect(api.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /api/v1/projects/p_web/pages',
      'PATCH /api/v1/pages/pg_web_structure',
      'POST /api/v1/pages/pg_web_structure/move',
      'POST /api/v1/pages/pg_web_structure/versions/pv_structure_2/restore',
      'DELETE /api/v1/pages/pg_web_kickoff',
    ]);
  });

  it('removes the deleted subtree from the cache before it refreshes', async () => {
    let tree = webTree;
    let cachedWhenAsked: unknown[] = [];
    const hosting = makePage({ id: 'pg_web_hosting', parent_id: 'pg_web_tech', title: 'Deployment und Hosting' });
    const domainVersion: PageVersionDetail = { ...versionDetail, id: 'pv_domain_1', page_id: 'pg_web_domain' };
    api = mockApi({
      'GET /api/v1/projects/p_web/pages': () => {
        cachedWhenAsked = [qk.pages.detail('pg_web_hosting'), qk.pageVersions.list({ page: 'pg_web_tech' }), qk.pageVersions.detail('pv_domain_1')].map((queryKey) =>
          queryClient.getQueryState(queryKey),
        );
        return { body: { data: tree, meta: { total: 12 } } };
      },
      'GET /api/v1/pages/pg_web_hosting': () => ({ body: { data: hosting } }),
      'GET /api/v1/pages/pg_web_tech/versions': () => ({ body: list([]) }),
      'GET /api/v1/pages/pg_web_domain/versions/pv_domain_1': () => ({ body: { data: domainVersion } }),
      'GET /api/v1/pages/pg_web_structure': () => ({ body: { data: seitenstruktur } }),
      'DELETE /api/v1/pages/pg_web_tech': () => ({ body: { deleted: 5 } }),
    });
    const { result } = renderHook(
      () => ({
        tree: usePages('p_web'),
        hosting: usePage('pg_web_hosting'),
        versions: usePageVersions('pg_web_tech'),
        domain: usePageVersion('pg_web_domain', 'pv_domain_1'),
        other: usePage('pg_web_structure'),
        gone: usePageGone('pg_web_performance'),
        remove: useDeletePage(),
      }),
      { wrapper },
    );
    await waitFor(() => expect([result.current.hosting.data, result.current.domain.data, result.current.other.data, result.current.versions.data]).not.toContain(undefined));
    await waitFor(() => expect(result.current.tree.data).toBeDefined());

    tree = webTree.filter((node) => node.id !== 'pg_web_tech');
    await act(() => result.current.remove.mutateAsync('pg_web_tech'));

    // the tree asked again only once the queries of the subtree were gone: none of them asks (it would answer 404)
    expect(cachedWhenAsked).toEqual([undefined, undefined, undefined]);
    await waitFor(() => expect(result.current.tree.data?.items).toEqual(tree));
    expect(result.current.gone).toBe(true);
    expect(api.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/v1/projects/p_web/pages',
      'GET /api/v1/pages/pg_web_hosting',
      'GET /api/v1/pages/pg_web_tech/versions',
      'GET /api/v1/pages/pg_web_domain/versions/pv_domain_1',
      'GET /api/v1/pages/pg_web_structure',
      'DELETE /api/v1/pages/pg_web_tech',
      'GET /api/v1/projects/p_web/pages',
      'GET /api/v1/pages/pg_web_structure',
    ]);
  });

  it('removes only the page itself when no tree in the cache names it', async () => {
    api = mockApi({ 'DELETE /api/v1/pages/pg_app_vision': () => ({ body: { deleted: 1 } }) });
    queryClient.setQueryData(qk.pages.detail('pg_app_vision'), makePage({ id: 'pg_app_vision', project_id: 'p_app' }));
    queryClient.setQueryData(qk.pages.detail('pg_web_tech'), makePage({ id: 'pg_web_tech' }));
    queryClient.setQueryData(qk.pages.list({ project: 'p_web' }), { items: webTree, next_cursor: null, total: 12 });
    const { result } = renderHook(() => useDeletePage(), { wrapper });

    await act(() => result.current.mutateAsync('pg_app_vision'));

    expect(queryClient.getQueryState(qk.pages.detail('pg_app_vision'))).toBeUndefined();
    expect(queryClient.getQueryData(qk.pages.detail('pg_web_tech'))).toBeDefined();
  });

  it('keeps a newer cached page when a save answers late', async () => {
    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    let saved = { ...seitenstruktur, version: 4 };
    api = mockApi({ 'PATCH /api/v1/pages/pg_web_structure': () => ({ body: { data: saved } }) });
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      await held;
      return original(...args);
    };
    queryClient.setQueryData(qk.pages.detail('pg_web_structure'), seitenstruktur);
    const { result } = renderHook(() => useSavePage(), { wrapper });
    const input = { title: 'Seitenstruktur', emoji: '🧭', content: null, base_version: 3 };

    try {
      const save = act(() => result.current.mutateAsync({ id: 'pg_web_structure', input }));
      // meanwhile the page loaded again with a later save of somebody else
      const newer = { ...seitenstruktur, version: 5, updated_by: 'u_lene' };
      queryClient.setQueryData(qk.pages.detail('pg_web_structure'), newer);
      answer();
      await save;
      expect(queryClient.getQueryData(qk.pages.detail('pg_web_structure'))).toEqual(newer);
    } finally {
      globalThis.fetch = original;
    }

    // an answer at least as new as the cache is what the page shows now
    saved = { ...seitenstruktur, title: 'Struktur', version: 6 };
    await act(() => result.current.mutateAsync({ id: 'pg_web_structure', input: { ...input, base_version: 5 } }));
    expect(queryClient.getQueryData(qk.pages.detail('pg_web_structure'))).toEqual(saved);
    queryClient.removeQueries({ queryKey: qk.pages.detail('pg_web_structure') });
    await act(() => result.current.mutateAsync({ id: 'pg_web_structure', input: { ...input, base_version: 6 } }));
    expect(queryClient.getQueryData(qk.pages.detail('pg_web_structure'))).toEqual(saved);
  });
});
