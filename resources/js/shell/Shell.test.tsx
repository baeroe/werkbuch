import { router } from '@inertiajs/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as renderDom, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, makeView, project } from '@/test/fixtures';
import { Shell } from './Shell';

// What the server flashed shows as a toast once per visit: a status as a success, an error as an error. The browser suite cannot provoke a flashed
// error inside the shell (a refused request needs a stale CSRF token, which a same-origin browser never sends).

type Flash = { status: string | null; error: string | null };
let flash: Flash = { status: null, error: null };
let url = '/my-items';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({
    props: { auth: { user: { id: '1', type: 'person', name: 'Mara Lindqvist', handle: 'mara', email: null, locale: 'de', timezone: null, avatar_url: null }, permissions: [] }, flash, features: { mail: true, live: null } },
    url,
  }),
  router: { visit: vi.fn(), post: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let api: MockApi | undefined;
let client: QueryClient;
let routes: Record<string, MockRoute>;

const web = project('WEB', 'member', { id: 'p_web', name: 'Website-Relaunch' });
const app = project('APP', 'admin', { id: 'p_app', name: 'Kunden-App' });
const old = project('OLD', 'admin', { id: 'p_old', name: 'Altes Projekt', archived_at: '2026-10-01T10:00:00.000Z' });
const favorite = (id: string, position: number) => ({ user_id: '1', kind: 'project', id, position });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  routes = {
    'GET /api/v1/projects': () => ({ body: list([web, app]) }),
    'GET /api/v1/favorites': () => ({ body: list([]) }),
    'GET /api/v1/views': () => ({ body: list([]) }),
  };
  vi.mocked(router.post).mockClear();
});

/** The shell with the data it reads (favorites, projects) from a fake API: `routes` as the test set them. */
function render(element: ReactElement) {
  api = mockApi(routes);
  const result = renderDom(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...result, rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) };
}

afterEach(() => {
  act(() => resetToasts());
  flash = { status: null, error: null };
  url = '/my-items';
  api?.restore();
  api = undefined;
});

/** The error toasts with how often each was shown again (the same error refreshes the toast on screen). */
const errors = () => currentToasts().filter((item) => item.tone === 'error').map((item) => [item.title, item.round]);
const successes = () => currentToasts().filter((item) => item.tone === 'success').map((item) => item.title);

describe('Shell', () => {
  it('shows a flashed error as a toast once per visit', () => {
    flash = { status: null, error: 'Die Seite ist abgelaufen.' };
    const { rerender } = render(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 0]]);

    // the same visit renders again: the toast is not shown again
    rerender(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 0]]);

    // the next visit brings a new flash, even with the same text: shown again
    flash = { status: null, error: 'Die Seite ist abgelaufen.' };
    rerender(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 1]]);
  });

  it('shows a flashed status as a success toast once per visit', () => {
    flash = { status: 'Willkommen, Lea.', error: null };
    const { rerender } = render(<Shell>Inhalt</Shell>);
    expect(successes()).toEqual(['Willkommen, Lea.']);
    expect(errors()).toEqual([]);

    // the same visit renders again: the toast is not shown again
    rerender(<Shell>Inhalt</Shell>);
    expect(successes()).toEqual(['Willkommen, Lea.']);

    // dismissed meanwhile, the same flash object does not bring it back
    act(() => resetToasts());
    rerender(<Shell>Inhalt</Shell>);
    expect(successes()).toEqual([]);
  });

  it('links the gear straight to the first section of the settings, marked on every section', () => {
    const { unmount } = render(<Shell>Inhalt</Shell>);
    const gear = () => screen.getAllByRole('link', { name: 'Einstellungen der Organisation' })[0]!;
    expect(gear().getAttribute('href')).toBe('/settings/general');
    expect(gear().getAttribute('aria-current')).toBeNull();
    unmount();

    url = '/settings/people';
    render(<Shell>Inhalt</Shell>);
    expect(gear().getAttribute('aria-current')).toBe('page');
  });

  it('closes the drawer when only the query of the address changes', async () => {
    url = '/projects/WEB?view=open';
    const { rerender } = render(<Shell>Inhalt</Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();

    // a view chosen in the list changes the query, not the path
    url = '/projects/WEB?view=mine';
    rerender(<Shell>Inhalt</Shell>);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows nothing when the visit flashed nothing', () => {
    render(<Shell>Inhalt</Shell>);

    expect(screen.getByText('Inhalt')).toBeTruthy();
    expect(errors()).toEqual([]);
    expect(successes()).toEqual([]);
  });
});

/** The sidebar of the desktop (the drawer of the phone holds the same content, but only while open). */
const sidebar = () => screen.getAllByRole('navigation', { name: 'Seitenleiste' })[0]!;

describe('Sidebar projects', () => {
  it('lists the starred projects in the order of the favorites, without archived ones, and opens the current one', async () => {
    url = '/projects/APP/settings/members';
    routes['GET /api/v1/projects'] = () => ({ body: list([web, app, old]) });
    routes['GET /api/v1/favorites'] = () => ({ body: list([favorite('p_app', 0), favorite('p_old', 1), favorite('p_web', 2)]) });
    render(<Shell>Inhalt</Shell>);

    const nav = sidebar();
    const apps = await within(nav).findByRole('button', { name: 'Kunden-App' });
    const webs = within(nav).getByRole('button', { name: 'Website-Relaunch' });
    expect(apps.compareDocumentPosition(webs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).queryByText('Altes Projekt')).toBeNull();

    // the project of the page is open, with its settings marked
    expect(apps.getAttribute('aria-expanded')).toBe('true');
    expect(within(nav).getByRole('link', { name: 'Einstellungen' }).getAttribute('href')).toBe('/projects/APP/settings');
    expect(within(nav).getByRole('link', { name: 'Einstellungen' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Items' }).getAttribute('href')).toBe('/projects/APP');
    expect(within(nav).getByRole('link', { name: 'Wiki' }).getAttribute('href')).toBe('/projects/APP/wiki');
    expect(within(nav).getByRole('link', { name: 'Vorlagen' }).getAttribute('href')).toBe('/projects/APP/templates');
    expect(webs.getAttribute('aria-expanded')).toBe('false');

    // the chevron opens and closes a project
    await userEvent.click(webs);
    expect(webs.getAttribute('aria-expanded')).toBe('true');
    expect(within(nav).getAllByRole('link', { name: 'Einstellungen' })).toHaveLength(2);
    await userEvent.click(apps);
    expect(apps.getAttribute('aria-expanded')).toBe('false');

    // the sidebar and the rights share one list of the projects
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/projects')).map((call) => call.url)).toEqual(['/api/v1/projects?include_archived=1']);
  });

  it('says so while nothing is starred, and links "Create project" to the dialog', async () => {
    render(<Shell>Inhalt</Shell>);

    const nav = sidebar();
    expect(await within(nav).findByText('Projekte mit Stern stehen hier.')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Projekt anlegen' }).getAttribute('href')).toBe('/projects?create=1');
  });

  it('shows the projects as loading until favorites and projects are there', async () => {
    render(<Shell>Inhalt</Shell>);

    expect(within(sidebar()).getByText('Projekte werden geladen …')).toBeTruthy();
    expect(await within(sidebar()).findByText('Projekte mit Stern stehen hier.')).toBeTruthy();
  });

  it('says when the projects could not be loaded and loads them again on request', async () => {
    let fail = true;
    routes['GET /api/v1/favorites'] = () => (fail ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable' } } : { body: list([favorite('p_web', 0)]) });
    render(<Shell>Inhalt</Shell>);

    // the favorites fail for the views as well: the retry of the projects is the one of their section
    const nav = within(sidebar()).getByRole('region', { name: 'Projekte' });
    expect(await within(nav).findByText('Projekte nicht geladen.')).toBeTruthy();
    fail = false;
    await userEvent.click(within(nav).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(nav).findByRole('button', { name: 'Website-Relaunch' })).toBeTruthy();
  });
});

describe('Sidebar views', () => {
  const roadmap = makeView({ id: 'v_roadmap', name: 'Roadmap', icon: 'route' });
  const kira = makeView({ id: 'v_kira', name: 'Für Kira', icon: '🤖' });
  const view = (id: string, position: number) => ({ user_id: '1', kind: 'view', id, position });

  it('lists the starred views in the order of the sidebar', async () => {
    url = '/views/v_roadmap';
    routes['GET /api/v1/views'] = () => ({ body: list([kira, roadmap, makeView()]) });
    // a view that is gone is not among the views any more (the server leaves its favorite out as well)
    routes['GET /api/v1/favorites'] = () => ({ body: list([view('v_roadmap', 0), favorite('p_web', 1), view('v_gone', 2), view('v_kira', 3)]) });
    render(<Shell>Inhalt</Shell>);

    const nav = sidebar();
    const section = within(nav).getByRole('region', { name: 'Views' });
    const first = await within(section).findByRole('link', { name: 'Roadmap' });
    expect(within(section).getAllByRole('link').map((link) => [link.getAttribute('aria-label') ?? link.textContent, link.getAttribute('href')])).toEqual([
      ['View anlegen', '/views?create=1'],
      ['Roadmap', '/views/v_roadmap'],
      ['🤖Für Kira', '/views/v_kira'],
      ['Alle Views', '/views'],
    ]);
    // the view of the page is marked; "Fällig diese Woche" has no star
    expect(first.getAttribute('aria-current')).toBe('page');
    expect(within(section).queryByText('Fällig diese Woche')).toBeNull();
  });

  it('says so while no view is starred', async () => {
    render(<Shell>Inhalt</Shell>);

    expect(within(sidebar()).getByText('Views werden geladen …')).toBeTruthy();
    expect(await within(sidebar()).findByText('Views mit Stern stehen hier.')).toBeTruthy();
  });

  it('says when the views could not be loaded', async () => {
    let fail = true;
    routes['GET /api/v1/views'] = () => (fail ? { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable' } } : { body: list([roadmap]) });
    routes['GET /api/v1/favorites'] = () => ({ body: list([view('v_roadmap', 0)]) });
    render(<Shell>Inhalt</Shell>);

    const section = within(sidebar()).getByRole('region', { name: 'Views' });
    expect(await within(section).findByText('Views nicht geladen.')).toBeTruthy();
    fail = false;
    await userEvent.click(within(section).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(section).findByRole('link', { name: 'Roadmap' })).toBeTruthy();
  });
});

describe('ProfileMenu', () => {
  /** Signs out through the menu; answers the options the shell gave the visit. */
  async function signOut() {
    render(<Shell>Inhalt</Shell>);
    await userEvent.click(within(sidebar()).getByRole('button', { name: /Mara Lindqvist/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Abmelden' }));
    expect(router.post).toHaveBeenCalledWith('/logout', {}, expect.any(Object));
    return vi.mocked(router.post).mock.calls[0]![2] as { onHttpException: (response: { status: number }) => boolean; onNetworkError: (error: Error) => boolean };
  }

  it('names the status of the server when signing out is refused', async () => {
    const options = await signOut();

    act(() => expect(options.onHttpException({ status: 500 })).toBe(false));
    expect(currentToasts().map((entry) => [entry.title, entry.description])).toEqual([['Abmelden hat nicht geklappt', 'Der Server hat mit Status 500 geantwortet.']]);
  });

  it('says that the server did not answer when signing out gets no answer', async () => {
    const options = await signOut();

    act(() => expect(options.onNetworkError(new Error('offline'))).toBe(false));
    expect(currentToasts().map((entry) => [entry.title, entry.description])).toEqual([['Abmelden hat nicht geklappt', 'Der Server hat nicht geantwortet.']]);
  });
});
