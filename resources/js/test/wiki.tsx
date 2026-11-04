/*
 * The fake REST API of the wiki tests that move and delete pages (`features/wiki/{move,delete}.test.tsx`): the tree of
 * WEB (`webTree`) answers from `wiki.tree`, a move (`POST …/move`) and a delete (`DELETE`) change it the way the server
 * does, and every page answers its detail from the tree. `wiki.overrides` replaces a route for one test.
 *
 * Each test file mocks `@inertiajs/react` itself (`vi.mock` is hoisted per file) and hands its `go(url)` to
 * `renderWiki`, which moves the address and the props of the page together, as a visit does.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { movedTree, withoutPages, subtreeIds, findPage } from '@/features/wiki/tree';
import { WikiScreen, type WikiScreenProps } from '@/features/wiki/WikiScreen';
import type { PageNode, Project } from '@/types';
import { mockApi, type MockApi, type MockRoute } from './api';
import { ida, list, makePage, mara, project, theo, webTree } from './fixtures';

export const wiki: { project: Project; tree: PageNode[]; overrides: Record<string, MockRoute>; api: MockApi | null } = {
  project: project('WEB', 'member', { name: 'Website-Relaunch' }),
  tree: webTree,
  overrides: {},
  api: null,
};

const PAGE = /^(GET|PATCH|DELETE) \/api\/v1\/pages\/([^/]+)$/;
const MOVE = /^POST \/api\/v1\/pages\/([^/]+)\/move$/;

/** A page of the tree as its detail answers it. */
function detail(id: string) {
  const node = findPage(wiki.tree, id);
  if (!node) return { status: 404, body: { type: 'about:blank', title: 'Not Found', status: 404, reason: 'not_found' } };
  const { children: _children, ...page } = node;
  return { body: { data: makePage({ ...page }) } };
}

function route(key: string): MockRoute | undefined {
  if (wiki.overrides[key]) return wiki.overrides[key];
  const base: Record<string, MockRoute> = {
    'GET /api/v1/projects': () => ({ body: list([wiki.project]) }),
    'GET /api/v1/projects/WEB': () => ({ body: { data: wiki.project } }),
    'GET /api/v1/projects/p_web/pages': () => ({ body: list(wiki.tree) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, theo]) }),
    'POST /api/v1/projects/p_web/pages': (body) => {
      const sent = body as { title: string; parent_id: string | null };
      return { status: 201, body: { data: makePage({ id: 'pg_web_new', title: sent.title, parent_id: sent.parent_id }) } };
    },
  };
  if (base[key]) return base[key];
  const move = MOVE.exec(key);
  if (move) {
    return (body) => {
      const { parent_id, before_id } = body as { parent_id: string | null; before_id: string | null };
      wiki.tree = movedTree(wiki.tree, move[1], parent_id, before_id);
      return detail(move[1]);
    };
  }
  const page = PAGE.exec(key);
  if (!page) return undefined;
  const [, method, id] = page;
  if (method === 'GET') return () => detail(id);
  if (method === 'DELETE') {
    return () => {
      const ids = subtreeIds(wiki.tree, id);
      wiki.tree = withoutPages(wiki.tree, new Set(ids));
      return { body: { deleted: ids.length } };
    };
  }
  return (body) => ({ body: { data: makePage({ ...(detail(id).body as { data: object }).data, ...(body as object), version: 2 }) } });
}

export function startWikiServer(): MockApi {
  wiki.tree = webTree;
  wiki.overrides = {};
  wiki.api = mockApi(new Proxy({} as Record<string, MockRoute>, { get: (_target, key: string) => route(key) }));
  return wiki.api;
}

export function stopWikiServer(): void {
  wiki.api?.restore();
  wiki.api = null;
}

/** The calls of a method to a path (without the query). */
export const callsTo = (method: string, path: string) => (wiki.api?.calls ?? []).filter((call) => call.method === method && call.url.split('?')[0] === path);

/**
 * Renders the wiki of WEB. `move(url)` moves the fake address; the returned `go(url, props)` visits another page of
 * the wiki: the address and the props change together.
 */
export function renderWiki(props: Partial<WikiScreenProps>, move: (url: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const all: WikiScreenProps = { identifier: 'WEB', pageId: null, pageFound: false, ...props };
  const view = render(
    <QueryClientProvider client={client}>
      <WikiScreen {...all} />
    </QueryClientProvider>,
  );
  const go = (url: string, next: Partial<WikiScreenProps>) => {
    act(() => move(url));
    view.rerender(
      <QueryClientProvider client={client}>
        <WikiScreen {...all} {...next} />
      </QueryClientProvider>,
    );
  };
  return { client, go, unmount: view.unmount };
}
