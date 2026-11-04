/*
 * The wiki screen against a fake REST API (`mockApi`), ported from the clickdummy's wiki.test.tsx: the project, the
 * tree beside the overview or the open page, the empty wiki, creating a page, the 404, the error and the skeleton.
 * Inertia is a fake whose address the tests move (`inertia.go`); the screen gets its props as the page would.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { clearLiveGone, markLiveGone } from '@/lib/liveGone';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, makePage, mara, organization, project, theo, webTree } from '@/test/fixtures';
import type { PageNode, Project } from '@/types';
import { WikiScreen, type WikiScreenProps } from './WikiScreen';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/WEB/wiki';
  const listeners = new Set<() => void>();
  return {
    get url() {
      return url;
    },
    go(next: string) {
      url = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    visit: vi.fn(),
    replace: vi.fn(),
  };
});

vi.mock('@inertiajs/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePage: () => ({
      props: { auth: { user: mara, permissions: [] }, organization },
      url: useSyncExternalStore(inertia.subscribe, () => inertia.url),
    }),
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
    router: { visit: inertia.visit, replace: inertia.replace, reload: vi.fn(), on: () => () => {} },
  };
});

/* --------------------------------------------------------------------- fake server */

const web = project('WEB', 'member', { name: 'Website-Relaunch' });

/** The tree of WEB with Domain-Umzug changed last by Theo, Meetings by somebody nobody knows. */
const changedTree = (): PageNode[] => {
  const change = (nodes: PageNode[]): PageNode[] =>
    nodes.map((node) => ({
      ...node,
      ...(node.id === 'pg_web_domain' ? { updated_at: '2026-10-30T15:00:00.000Z', updated_by: 'u_theo' } : {}),
      ...(node.id === 'pg_web_meetings' ? { updated_at: '2026-10-29T08:00:00.000Z', updated_by: 'u_gone' } : {}),
      children: change(node.children),
    }));
  return change(webTree);
};

let projects: Project[];
let tree: PageNode[];
let overrides: Record<string, MockRoute>;
let api: MockApi;

const unavailable = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };
const missing = { status: 404, body: { type: 'about:blank', title: 'Not Found', status: 404, reason: 'not_found' } };

function routes(): Record<string, MockRoute> {
  const base: Record<string, MockRoute> = {
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/projects/WEB': () => ({ body: { data: projects[0] } }),
    'GET /api/v1/projects/p_web/pages': () => ({ body: list(tree) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, theo]) }),
    'GET /api/v1/pages/pg_web_domain': () => ({ body: { data: makePage({ id: 'pg_web_domain', parent_id: 'pg_web_hosting', title: 'Domain-Umzug' }) } }),
    'POST /api/v1/projects/p_web/pages': (body) => ({ status: 201, body: { data: makePage({ id: 'pg_web_new', title: (body as { title: string }).title }) } }),
  };
  return new Proxy(base, { get: (target, key: string) => overrides[key] ?? target[key] });
}

beforeEach(() => {
  projects = [web];
  tree = changedTree();
  overrides = {};
  inertia.go('/projects/WEB/wiki');
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  api = mockApi(routes());
});

afterEach(() => {
  api.restore();
  clearLiveGone();
  act(() => resetToasts());
});

function renderWiki(props: Partial<WikiScreenProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const all: WikiScreenProps = { identifier: 'WEB', pageId: null, pageFound: false, ...props };
  const view = render(
    <QueryClientProvider client={client}>
      <WikiScreen {...all} />
    </QueryClientProvider>,
  );
  /** A visit to another page of the wiki: the address and the props of the page change together. */
  const go = (url: string, next: Partial<WikiScreenProps>) => {
    act(() => inertia.go(url));
    view.rerender(
      <QueryClientProvider client={client}>
        <WikiScreen {...all} {...next} />
      </QueryClientProvider>,
    );
  };
  return { client, go, unmount: view.unmount };
}

const pagesTree = () => screen.findByRole('tree', { name: 'Seiten' });
const rightsLoaded = () => waitFor(() => expect(screen.getByRole('button', { name: 'Neue Seite' }).getAttribute('aria-disabled')).toBeNull());
const toastTitles = () => currentToasts().map((item) => item.title);
const gets = (path: string) => api.calls.filter((call) => call.method === 'GET' && call.url.startsWith(path));

describe('the wiki', () => {
  it('shows the tree beside the overview and marks the open page', async () => {
    const user = userEvent.setup();
    const { go } = renderWiki();
    const nav = await screen.findByRole('navigation', { name: 'Seiten des Wikis' });
    const pages = await pagesTree();
    expect(nav.contains(pages)).toBe(true);
    expect(within(pages).getAllByRole('treeitem')).toHaveLength(12);
    expect(screen.getByRole('heading', { level: 1, name: 'Wiki' }).hasAttribute('data-screen-heading')).toBe(true);
    expect(document.title).toBe('Wiki WEB – werkbuch');
    expect(screen.getByRole('link', { name: 'Website-Relaunch' }).getAttribute('href')).toBe('/projects/WEB');
    // the tree is read by the project's ULID, never its identifier: one cache for live updates and deletes
    expect(gets('/api/v1/projects/p_web/pages')).toHaveLength(1);

    // the overview: the newest first, six of them, who changed them, on which day, under which page
    const latest = await screen.findByRole('list', { name: 'Zuletzt geändert' });
    const entries = within(latest).getAllByRole('listitem');
    expect(entries).toHaveLength(6);
    expect(within(entries[0]).getByRole('link').textContent).toBe('Domain-Umzug');
    expect(within(entries[0]).getByRole('link').getAttribute('href')).toBe('/projects/WEB/wiki/pg_web_domain');
    expect(await within(entries[0]).findByText('Theo Okafor, 30.10.2026 in „Deployment und Hosting“')).toBeTruthy();
    expect(within(entries[1]).getByText('Unbekannt, 29.10.2026')).toBeTruthy();
    expect(screen.getByText(/^12 Seiten im Wiki\./)).toBeTruthy();

    // fold Technik away, then open a page below it: the tree unfolds the way to the open page
    const pagesNow = await pagesTree();
    act(() => within(pagesNow).getByRole('treeitem', { name: 'Technik' }).focus());
    await user.keyboard('{ArrowLeft}');
    expect(within(pagesNow).queryByRole('treeitem', { name: 'Domain-Umzug' })).toBeNull();

    go('/projects/WEB/wiki/pg_web_domain', { pageId: 'pg_web_domain', pageFound: true });
    const current = await within(pagesNow).findByRole('treeitem', { name: 'Domain-Umzug' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.tabIndex).toBe(0);
    expect(within(pagesNow).getByRole('treeitem', { name: 'Technik' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('list', { name: 'Zuletzt geändert' })).toBeNull();
    // "Wiki" leads back to the overview; the page shows its title
    expect(screen.getByRole('link', { name: 'Wiki' }).getAttribute('href')).toBe('/projects/WEB/wiki');
    expect(((await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement).value).toBe('Domain-Umzug');
    // below lg an open page shows alone
    expect(nav.className).toContain('max-lg:hidden');
  });

  it('shows the empty wiki with the first page to create, and a viewer without it', async () => {
    tree = [];
    renderWiki();
    expect(await screen.findByText('Noch keine Seiten')).toBeTruthy();
    expect(screen.getByText(/Leg die erste Seite an\./)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Erste Seite anlegen' }).getAttribute('aria-disabled')).toBeNull());
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Seiten des Wikis' })).toBeNull();
  });

  it('shows the empty wiki to a viewer without the first page, and "Neue Seite" off with the reason', async () => {
    tree = [];
    projects = [project('WEB', 'viewer', { name: 'Website-Relaunch' })];
    renderWiki();
    expect(await screen.findByText('Noch keine Seiten')).toBeTruthy();
    expect(await screen.findByText(/Seiten legen Member und Admins des Projekts an\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Erste Seite anlegen' })).toBeNull();
    const create = screen.getByRole('button', { name: 'Neue Seite' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Im Projekt WEB darfst du nur lesen. Das Wiki bearbeiten dürfen Member und Admins.')).toBeTruthy();
    // the palette offers no new page either
    expect(listCommands().find((command) => command.id === 'wiki.create')?.when?.()).toBe(false);
  });

  it('creates a page and opens it with the title selected', async () => {
    const user = userEvent.setup();
    const { go } = renderWiki();
    await pagesTree();
    await rightsLoaded();
    await user.click(screen.getByRole('button', { name: 'Neue Seite' }));

    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_new?focus=title'));
    const posted = api.calls.find((call) => call.method === 'POST');
    expect(posted).toMatchObject({ url: '/api/v1/projects/p_web/pages', body: { title: 'Neue Seite', parent_id: null, emoji: null, content_json: null } });
    expect(toastTitles()).toContain('Seite angelegt');

    // the visit lands: the page, from the cache, takes the focus on its title, selected; the address loses the wish
    go('/projects/WEB/wiki/pg_web_new?focus=title&from=x', { pageId: 'pg_web_new', pageFound: true });
    const title = (await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(title);
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 'Neue Seite'.length]);
    expect(inertia.replace).toHaveBeenCalledWith({ url: '/projects/WEB/wiki/pg_web_new?from=x', preserveState: true, preserveScroll: true });
    await user.keyboard('Impressum');
    expect(title.value).toBe('Impressum');
    act(() => title.blur());

    // to another page and back: the title is not selected again
    go('/projects/WEB/wiki/pg_web_domain', { pageId: 'pg_web_domain', pageFound: true });
    expect(((await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement).value).toBe('Domain-Umzug');
    go('/projects/WEB/wiki/pg_web_new', { pageId: 'pg_web_new', pageFound: true });
    expect(((await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement).value).toBe('Neue Seite');
    expect(document.activeElement).toBe(document.body);
  });

  it('creates a page from the palette, and says when it was not created with a retry', async () => {
    renderWiki();
    await pagesTree();
    await rightsLoaded();
    overrides['POST /api/v1/projects/p_web/pages'] = () => unavailable;
    const command = listCommands().find((entry) => entry.id === 'wiki.create')!;
    expect(command.label).toBe('Neue Seite');
    expect(command.group).toBe('Wiki WEB');
    expect(command.when?.()).toBe(true);
    act(() => command.run());

    await waitFor(() => expect(toastTitles()).toContain('Seite nicht angelegt'));
    expect(inertia.visit).not.toHaveBeenCalled();
    delete overrides['POST /api/v1/projects/p_web/pages'];
    const failed = currentToasts().find((item) => item.title === 'Seite nicht angelegt')!;
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_new?focus=title'));
  });

  it('creates the first page of an empty wiki', async () => {
    const user = userEvent.setup();
    tree = [];
    renderWiki();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Erste Seite anlegen' }).getAttribute('aria-disabled')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Erste Seite anlegen' }));
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/WEB/wiki/pg_web_new?focus=title'));
  });

  it('shows the project not found, the error with retry and the skeleton', async () => {
    const user = userEvent.setup();
    let answer: { status: number; body: unknown } | null = missing;
    overrides['GET /api/v1/projects/WEB'] = () => answer ?? { body: { data: web } };
    const first = renderWiki();
    expect(await screen.findByRole('heading', { level: 1, name: 'Das Projekt WEB gibt es nicht' })).toBeTruthy();
    expect(screen.getByText(/Über die Suche findest du Projekte, Items und Seiten\./)).toBeTruthy();
    first.unmount();

    answer = unavailable;
    renderWiki();
    expect(await screen.findByText('Das Wiki konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    answer = null;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Wiki' })).toBeTruthy();
  });

  it('shows the skeleton while the project loads, and the tree while its pages load', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input), window.location.origin).pathname === '/api/v1/projects/WEB') await held;
      return inner(input, init);
    };
    renderWiki();
    expect(screen.getByText('Wiki wird geladen …')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    release();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wiki' })).toBeTruthy();
    globalThis.fetch = inner;
  });

  it('says when the pages could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let failing = true;
    overrides['GET /api/v1/projects/p_web/pages'] = () => (failing ? unavailable : { body: list(tree) });
    renderWiki();
    expect(await screen.findByText('Die Seiten konnten nicht geladen werden')).toBeTruthy();
    // no empty overview while the pages are unknown
    expect(screen.queryByText('Noch keine Seiten')).toBeNull();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await pagesTree()).toBeTruthy();
  });

  it('replaces another spelling of the identifier', async () => {
    inertia.go('/projects/web/wiki/pg_web_domain?activity=1');
    renderWiki({ pageId: 'pg_web_domain', pageFound: true });
    await waitFor(() => expect(inertia.replace).toHaveBeenCalledWith({ url: '/projects/WEB/wiki/pg_web_domain?activity=1', preserveState: true, preserveScroll: true }));
    expect(inertia.visit).not.toHaveBeenCalled();
  });
});

describe('the open page', () => {
  it('shows a page the server did not find without asking for it', async () => {
    renderWiki({ pageId: 'pg_nope', pageFound: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zur Übersicht des Wikis' }).getAttribute('href')).toBe('/projects/WEB/wiki');
    await pagesTree();
    expect(gets('/api/v1/pages/')).toHaveLength(0);
  });

  it('never asks for a page known to be deleted', async () => {
    markLiveGone('pg_web_domain', 'page');
    renderWiki({ pageId: 'pg_web_domain', pageFound: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite wurde gelöscht' })).toBeTruthy();
    await pagesTree();
    expect(gets('/api/v1/pages/')).toHaveLength(0);
  });

  it('shows the skeleton while the page loads, a page gone meanwhile, and an error with retry', async () => {
    const user = userEvent.setup();
    let answer: { status: number; body: unknown } | null = missing;
    overrides['GET /api/v1/pages/pg_web_domain'] = () => answer ?? { body: { data: makePage({ id: 'pg_web_domain', title: 'Domain-Umzug' }) } };
    const first = renderWiki({ pageId: 'pg_web_domain', pageFound: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht' })).toBeTruthy();
    first.unmount();

    answer = unavailable;
    renderWiki({ pageId: 'pg_web_domain', pageFound: true });
    expect(await screen.findByText('Seite wird geladen …')).toBeTruthy();
    expect(await screen.findByText('Die Seite konnte nicht geladen werden')).toBeTruthy();
    answer = null;
    await user.click(screen.getAllByRole('button', { name: 'Erneut versuchen' })[0]);
    expect(((await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement).value).toBe('Domain-Umzug');
  });

  it('lets a viewer read the title only', async () => {
    projects = [project('WEB', 'viewer', { name: 'Website-Relaunch' })];
    renderWiki({ pageId: 'pg_web_domain', pageFound: true });
    const title = (await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement;
    await waitFor(() => expect(title.readOnly).toBe(true));
  });
});
