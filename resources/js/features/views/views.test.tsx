/*
 * The views overview, its dialog "Neue View" / "View bearbeiten" and the stars against a fake REST API (`mockApi`),
 * ported from the clickdummy's views-overview/views.test.tsx. The server here keeps the six views of the clickdummy and
 * the favorites of the signed-in person; who that is says Inertia's `auth.user` (the clickdummy's "Als … ansehen").
 * The flows with the keyboard run in e2e/tests/views.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, lene, list, makeView, mara, organization, person, project, theo } from '@/test/fixtures';
import type { Display, Favorite, User, View, ViewInput } from '@/types';
import { copyName, namedProjects, newView } from './viewForm';
import { ViewsScreen } from './ViewsScreen';

const inertia = vi.hoisted(() => ({ replace: vi.fn(), visit: vi.fn() }));
let signedIn: User = mara;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: '/views' }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  router: { replace: inertia.replace, visit: inertia.visit, reload: vi.fn(), on: () => () => {} },
}));

/* --------------------------------------------------------------------- fake server */

const jonas = person('u_jonas', 'Jonas Wolf', 'jonas');
const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'due_date'];
const listByState = (): Display => ({ layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: [...FIELDS], show_sub_items: true });

/** The six views of the clickdummy's seed. */
const seedViews = (): View[] => [
  makeView(),
  makeView({
    id: 'v_prod_bugs',
    name: 'Bugs in Produktion',
    icon: 'bug',
    filter: { version: 1, conditions: [{ field: 'type', op: 'is', value: 't_bug' }] },
    display: { layout: 'board', group_by: 'state', sort: { field: 'priority', direction: 'asc' }, fields: ['key', 'title'], show_sub_items: false },
    created_by: 'u_ida',
  }),
  makeView({ id: 'v_kira', name: 'Für Kira', icon: 'bot', filter: { version: 1, conditions: [{ field: 'assignee', op: 'is', value: 'u_kira' }] }, display: listByState() }),
  makeView({
    id: 'v_nordlicht',
    name: 'Studio Nordlicht',
    icon: 'building-2',
    filter: { version: 1, conditions: [] },
    display: { layout: 'table', group_by: 'none', sort: { field: 'key', direction: 'asc' }, fields: ['key', 'title'], show_sub_items: true },
    created_by: 'u_theo',
  }),
  makeView({
    id: 'v_roadmap',
    name: 'Roadmap',
    icon: 'route',
    filter: { version: 1, conditions: [] },
    display: { layout: 'timeline', group_by: 'project', sort: { field: 'start_date', direction: 'asc' }, fields: ['key', 'title'], show_sub_items: false },
  }),
  makeView({ id: 'v_blocked', name: 'Blockiert', icon: 'octagon-alert', filter: { version: 1, conditions: [{ field: 'blocked', op: 'is', value: true }] }, display: listByState(), created_by: 'u_jonas' }),
];

/** Everybody's stars: Mara has three of the six views, Ida one. */
const seedFavorites = (): Favorite[] => [
  { user_id: 'u_mara', kind: 'view', id: 'v_due_week', position: 0 },
  { user_id: 'u_mara', kind: 'view', id: 'v_prod_bugs', position: 1 },
  { user_id: 'u_mara', kind: 'view', id: 'v_kira', position: 2 },
  { user_id: 'u_mara', kind: 'project', id: 'p_web', position: 3 },
  { user_id: 'u_ida', kind: 'view', id: 'v_prod_bugs', position: 0 },
];

const web = project('WEB', 'member', { name: 'Website-Relaunch' });

let views: View[];
let favorites: Favorite[];
let created: number;
/** Every call answers 503 while set (the clickdummy's `api:fail`). */
let failing: boolean;
/** Routes a test answers differently. */
let overrides: Record<string, MockRoute>;
let api: MockApi;

const unavailable = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };

/** The server: views by name, favorites of the signed-in person, toggling and deleting as `ToggleFavorite` and `DeleteView` do. */
function route(method: string, path: string): MockRoute | undefined {
  const key = `${method} ${path}`;
  if (overrides[key]) return overrides[key];
  const viewId = /^\/api\/v1\/views\/([^/]+)$/.exec(path)?.[1];
  if (key === 'GET /api/v1/views') return () => ({ body: list([...views].sort((a, b) => a.name.localeCompare(b.name))) });
  if (key === 'GET /api/v1/favorites') return () => ({ body: list(favorites.filter((favorite) => favorite.user_id === signedIn.id)) });
  if (key === 'GET /api/v1/users') return () => ({ body: list([mara, ida, theo, lene, jonas]) });
  if (key === 'GET /api/v1/projects') return () => ({ body: list([web]) });
  if (key === 'POST /api/v1/favorites/toggle')
    return (body) => {
      const { kind, id } = body as { kind: Favorite['kind']; id: string };
      const mine = favorites.find((favorite) => favorite.user_id === signedIn.id && favorite.kind === kind && favorite.id === id);
      favorites = mine ? favorites.filter((favorite) => favorite !== mine) : [...favorites, { user_id: signedIn.id, kind, id, position: favorites.length }];
      return { body: { kind, id, favorite: !mine } };
    };
  if (key === 'POST /api/v1/views')
    return (body) => {
      created += 1;
      const view: View = { ...(body as ViewInput), id: `v_new_${created}`, created_by: signedIn.id, created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z' };
      views = [...views, view];
      return { status: 201, body: { data: view } };
    };
  if (method === 'PUT' && viewId)
    return (body) => {
      const before = views.find((view) => view.id === viewId)!;
      const after: View = { ...before, ...(body as ViewInput), id: before.id, created_by: before.created_by };
      views = views.map((view) => (view.id === viewId ? after : view));
      return { body: { data: after } };
    };
  if (method === 'DELETE' && viewId)
    return () => {
      views = views.filter((view) => view.id !== viewId);
      favorites = favorites.filter((favorite) => !(favorite.kind === 'view' && favorite.id === viewId));
      return { status: 204 };
    };
  return undefined;
}

const server = new Proxy({} as Record<string, MockRoute>, {
  get: (_, key: string) => {
    const [method, path] = key.split(' ') as [string, string];
    const answer = route(method, path);
    return answer && ((body: unknown, url: URL) => (failing ? unavailable : answer(body, url)));
  },
});

beforeEach(() => {
  signedIn = mara;
  views = seedViews();
  favorites = seedFavorites();
  created = 0;
  failing = false;
  overrides = {};
  useUiStore.setState(useUiStore.getInitialState());
  api = mockApi(server);
});

afterEach(() => {
  api.restore();
  inertia.replace.mockReset();
  inertia.visit.mockReset();
  act(() => resetToasts());
  vi.restoreAllMocks();
});

/** Calls of `method` to a path starting with `path` wait for `gate` (the server answers when the test says so). */
function hold(method: string, path: string) {
  let answer!: () => void;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if ((init?.method ?? 'GET') === method && new URL(String(input), window.location.origin).pathname.startsWith(path)) await gate;
    return inner(input, init);
  };
  return answer;
}

function renderViews({ create = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ViewsScreen create={create} />
    </QueryClientProvider>,
  );
  return { client };
}

/** The list once the views are there. */
const loaded = () => screen.findByRole('link', { name: 'Roadmap' });
/** The row of a view. */
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('li')!;
const toastTitles = () => currentToasts().map((item) => item.title);
const isStarred = (id: string) => favorites.some((favorite) => favorite.user_id === signedIn.id && favorite.kind === 'view' && favorite.id === id);
/** The rights load with the projects: until then every button that needs them is off. */
const rightsLoaded = () => waitFor(() => expect(screen.getAllByRole('button', { name: /Neue View/ })[0]!.getAttribute('aria-disabled')).toBeNull());

describe('the list', () => {
  it('shows every team view with its creator and layout', async () => {
    renderViews();
    await loaded();

    expect(screen.getByRole('heading', { level: 1, name: 'Views' })).toBeTruthy();
    expect(document.title).toBe('Views – werkbuch');
    expect(within(screen.getByRole('list', { name: 'Alle Views' })).getAllByRole('listitem')).toHaveLength(6);
    const nordlicht = rowOf('Studio Nordlicht');
    expect(await within(nordlicht).findByText('Theo Okafor')).toBeTruthy();
    expect(within(nordlicht).getByText('Tabelle')).toBeTruthy();
    expect(within(nordlicht).getByText('nicht gruppiert')).toBeTruthy();
    expect(within(rowOf('Roadmap')).getByText('Timeline')).toBeTruthy();
    expect(within(rowOf('Roadmap')).getByText('nach Projekt gruppiert')).toBeTruthy();
    expect(within(rowOf('Bugs in Produktion')).getByText('Board')).toBeTruthy();
    expect(within(rowOf('Fällig diese Woche')).getByText('Liste')).toBeTruthy();
  });

  it('leads to the view on a click on its name', async () => {
    renderViews();
    await loaded();

    expect(screen.getByRole('link', { name: 'Roadmap' }).getAttribute('href')).toBe('/views/v_roadmap');
  });

  it('is in the order of the names', async () => {
    renderViews();
    await loaded();

    const names = within(screen.getByRole('list', { name: 'Alle Views' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(['Blockiert', 'Bugs in Produktion', 'Fällig diese Woche', 'Für Kira', 'Roadmap', 'Studio Nordlicht']);
  });

  it('names a project of the filter the reader does not see as hidden', async () => {
    views = [makeView({ id: 'v_mixed', name: 'Gemischt', filter: { version: 1, conditions: [{ field: 'project', op: 'in', value: ['p_secret', 'p_web'] }] }, display: listByState() })];
    renderViews();

    const row = (await screen.findByRole('link', { name: 'Gemischt' })).closest('li')!;
    expect(await within(row).findByText('Verborgenes Projekt, Website-Relaunch · nach Status gruppiert')).toBeTruthy();
    expect(row.textContent).not.toContain('p_secret');
  });

  it('names the creator as unknown when the account is not in the list', async () => {
    views = [makeView({ id: 'v_gone', name: 'Verwaist', created_by: 'u_gone' })];
    renderViews();

    const row = (await screen.findByRole('link', { name: 'Verwaist' })).closest('li')!;
    await waitFor(() => expect(row.textContent).toContain('Erstellt von Unbekannt'));
  });

  it('reaches the actions of a row with Tab', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();
    await within(rowOf('Blockiert')).findByRole('button', { name: '„Blockiert“ in die Seitenleiste legen' });

    act(() => screen.getByRole('link', { name: 'Blockiert' }).focus());
    const reached: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await user.tab();
      reached.push(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
    }

    expect(reached).toEqual(['„Blockiert“ in die Seitenleiste legen', '„Blockiert“ duplizieren', '„Blockiert“ bearbeiten', '„Blockiert“ löschen', 'Bugs in Produktion']);
  });
});

describe('favorites', () => {
  it('shows the stars of the person: Mara has three of the six views in her sidebar', async () => {
    renderViews();
    await loaded();

    await waitFor(() => expect(screen.getAllByRole('button', { name: /aus der Seitenleiste nehmen/ })).toHaveLength(3));
    expect(screen.getAllByRole('button', { name: /in die Seitenleiste legen/ })).toHaveLength(3);
    expect(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' })).toBeTruthy();
    expect(within(rowOf('Für Kira')).getByRole('button', { name: '„Für Kira“ aus der Seitenleiste nehmen' })).toBeTruthy();
  });

  it('puts a view in the sidebar and takes it out again; the star shows it, no toast does', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' }));

    expect(await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' })).toBeTruthy();
    expect(isStarred('v_roadmap')).toBe(true);
    expect(api.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/favorites/toggle').map((call) => call.body)).toEqual([{ kind: 'view', id: 'v_roadmap' }]);

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' }));

    expect(await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' })).toBeTruthy();
    expect(isStarred('v_roadmap')).toBe(false);
    // a change that shows at once needs no toast (only a refusal does)
    expect(toastTitles()).toEqual([]);
  });

  it('shows the new state of the star at once, with a spinner for the call that is on its way', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    const star = await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' });
    const answer = hold('POST', '/api/v1/favorites/toggle');

    await user.click(star);

    // the label already names the next step, and the button reports that it is busy
    const busy = within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(isStarred('v_roadmap')).toBe(false);

    answer();
    await waitFor(() => expect(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' }).getAttribute('aria-busy')).toBeNull());
    expect(isStarred('v_roadmap')).toBe(true);
  });

  it('keeps the star as it was and says why when the server fails', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    const star = await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' });
    failing = true;

    await user.click(star);

    await waitFor(() => expect(currentToasts().find((item) => item.tone === 'error')?.title).toBe('Favorit nicht geändert'));
    expect(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' })).toBeTruthy();
  });
});

describe('rights', () => {
  it('lets an org admin change and delete every view', async () => {
    renderViews();
    await loaded();

    for (const name of ['Roadmap', 'Studio Nordlicht', 'Blockiert']) {
      const row = rowOf(name);
      // the rights load with the projects
      await waitFor(() => expect(within(row).getByRole('button', { name: `„${name}“ bearbeiten` }).getAttribute('aria-disabled')).toBeNull());
      expect(within(row).getByRole('button', { name: `„${name}“ löschen` }).getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('lets a member change and delete their own views and gives the reason for the others', async () => {
    signedIn = ida;
    renderViews();
    await loaded();
    await rightsLoaded();
    // Ida made "Bugs in Produktion"; Mara made "Roadmap"
    const own = rowOf('Bugs in Produktion');
    expect(within(own).getByRole('button', { name: '„Bugs in Produktion“ löschen' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(own).getByRole('button', { name: '„Bugs in Produktion“ bearbeiten' }).getAttribute('aria-disabled')).toBeNull();

    const foreign = rowOf('Roadmap');
    for (const action of ['bearbeiten', 'löschen']) {
      const button = within(foreign).getByRole('button', { name: `„Roadmap“ ${action}` });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      // the reason of the rights, readable for assistive technology as well as in the tooltip
      expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Fremde Views ändern und löschen nur Org-Admins.');
    }
  });

  it('does not delete a view of somebody else when the disabled button is pressed', async () => {
    const user = userEvent.setup();
    signedIn = ida;
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ löschen' }));

    expect(currentToasts()).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Roadmap' })).toBeTruthy();
  });

  it('lets every member duplicate every view', async () => {
    signedIn = ida;
    renderViews();
    await loaded();

    for (const name of ['Roadmap', 'Bugs in Produktion']) {
      expect(within(rowOf(name)).getByRole('button', { name: `„${name}“ duplizieren` }).getAttribute('aria-disabled')).toBeNull();
    }
  });
});

describe('duplicating', () => {
  it('saves a copy as a new view of the person, with the filter and the display of the original', async () => {
    const user = userEvent.setup();
    signedIn = ida;
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ duplizieren' }));

    expect(await screen.findByRole('link', { name: 'Roadmap (Kopie)' })).toBeTruthy();
    const original = views.find((view) => view.id === 'v_roadmap')!;
    const copy = views.find((view) => view.name === 'Roadmap (Kopie)')!;
    expect(copy.created_by).toBe('u_ida');
    expect(copy.id).not.toBe(original.id);
    expect(copy.display).toEqual(original.display);
    expect(copy.filter).toEqual(original.filter);
    expect(copy.icon).toBe(original.icon);
    expect(toastTitles()).toContain('„Roadmap (Kopie)“ angelegt');
    expect(useUiStore.getState().flashIds).toEqual([copy.id]);
    // the person may change their copy
    expect(within(rowOf('Roadmap (Kopie)')).getByRole('button', { name: '„Roadmap (Kopie)“ löschen' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('offers to open the copy', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(within(rowOf('Für Kira')).getByRole('button', { name: '„Für Kira“ duplizieren' }));
    await screen.findByRole('link', { name: 'Für Kira (Kopie)' });
    const toastItem = currentToasts().find((item) => item.title === '„Für Kira (Kopie)“ angelegt')!;
    expect(toastItem.action?.label).toBe('Öffnen');
    act(() => runToastAction(toastItem.id));

    expect(inertia.visit).toHaveBeenCalledWith('/views/v_new_1');
  });

  it('cuts a long name before the suffix, so the copy keeps within 60 characters (K26)', () => {
    const long = 'Sehr lange Übersicht über alle offenen Kundenanfragen 2026 x';
    expect(Array.from(long)).toHaveLength(60);
    const copy = copyName(long);
    expect(Array.from(copy)).toHaveLength(60);
    expect(copy).toBe('Sehr lange Übersicht über alle offenen Kundenanfrage (Kopie)');
    // a cut that ends in a space leaves it out
    expect(copyName(`${'a'.repeat(51)} ${'b'.repeat(20)}`)).toBe(`${'a'.repeat(51)} (Kopie)`);
    expect(copyName('Roadmap')).toBe('Roadmap (Kopie)');
  });
});

describe('deleting', () => {
  it('takes the row away at once, "Rückgängig" brings it back and nothing is deleted', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ löschen' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blockiert' })).toBeNull());
    const toastItem = currentToasts().find((item) => item.title === '„Blockiert“ gelöscht')!;
    expect(toastItem.action?.label).toBe('Rückgängig');
    expect(views).toHaveLength(6);

    act(() => runToastAction(toastItem.id));

    expect(await screen.findByRole('link', { name: 'Blockiert' })).toBeTruthy();
    expect(views).toHaveLength(6);
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('deletes for real when the toast runs out, and takes the star out of the sidebar with it', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Für Kira')).getByRole('button', { name: '„Für Kira“ löschen' }));
    act(() => dismissToast(currentToasts().find((item) => item.title === '„Für Kira“ gelöscht')!.id));

    await waitFor(() => expect(views).toHaveLength(5));
    expect(api.calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/v1/views/v_kira']);
    expect(isStarred('v_kira')).toBe(false);
    // the list and the favorites are read again: the row stays away
    await waitFor(() => expect(api.calls.filter((call) => call.url === '/api/v1/favorites')).toHaveLength(2));
    expect(screen.queryByRole('link', { name: 'Für Kira' })).toBeNull();
  });

  it('brings the row back with a retry when the server fails', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ löschen' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blockiert' })).toBeNull());
    failing = true;
    act(() => dismissToast(currentToasts().find((item) => item.title === '„Blockiert“ gelöscht')!.id));

    expect(await screen.findByRole('link', { name: 'Blockiert' })).toBeTruthy();
    const error = await waitFor(() => currentToasts().find((item) => item.tone === 'error')!);
    expect(error.title).toBe('„Blockiert“ nicht gelöscht');
    expect(error.action?.label).toBe('Erneut versuchen');
  });

  it('moves the focus to the next row, and to "Neue View" after the last one', async () => {
    const user = userEvent.setup();
    views = [makeView({ id: 'v_a', name: 'Alpha' }), makeView({ id: 'v_b', name: 'Beta' })];
    renderViews();
    await screen.findByRole('link', { name: 'Alpha' });
    await rightsLoaded();

    await user.click(within(screen.getByRole('link', { name: 'Alpha' }).closest('li')!).getByRole('button', { name: '„Alpha“ löschen' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Beta' })));

    await user.click(within(screen.getByRole('link', { name: 'Beta' }).closest('li')!).getByRole('button', { name: '„Beta“ löschen' }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Neue View'));
    expect(screen.getByText('Noch keine Views')).toBeTruthy();
  });
});

describe('a new view', () => {
  const command = () => listCommands().find((entry) => entry.id === 'views.create');

  it('offers Neue View in the palette with the right and opens the dialog', async () => {
    renderViews();
    await rightsLoaded();

    expect(command()?.when!()).toBe(true);
    expect([command()!.label, command()!.group]).toEqual(['Neue View', 'Views']);
    act(() => command()!.run());

    expect(await screen.findByRole('dialog', { name: 'Neue View' })).toBeTruthy();
  });

  it('leaves it out without the right', async () => {
    // the rights come with the projects: while they load, nobody may create a view
    hold('GET', '/api/v1/projects');
    renderViews();
    await loaded();

    expect(command()?.when!()).toBe(false);
  });

  it('opens a dialog from the button, creates the view and leads to it', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenanfragen');
    await user.click(within(dialog).getByRole('button', { name: 'Board' }));
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/views/v_new_1'));
    const made = views.find((view) => view.name === 'Kundenanfragen')!;
    expect(made.created_by).toBe('u_mara');
    expect(made.display.layout).toBe('board');
    expect(made.filter).toEqual({ version: 1, conditions: [] });
    expect(toastTitles()).toContain('„Kundenanfragen“ angelegt');
  });

  it('opens by itself for /views?create=1, the link of the sidebar, and closes without a trace', async () => {
    const user = userEvent.setup();
    renderViews({ create: true });

    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    // the address asked for the dialog once and keeps nothing of it
    expect(inertia.replace).toHaveBeenCalledWith(expect.objectContaining({ url: '/views', preserveState: true }));
    const { props } = inertia.replace.mock.calls[0]![0] as { props: (props: Record<string, unknown>) => Record<string, unknown> };
    expect(props({ create: true, other: 1 })).toEqual({ create: false, other: 1 });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
    expect(views).toHaveLength(6);
  });

  it('shows the error of the server at the field and keeps the dialog', async () => {
    const user = userEvent.setup();
    overrides['POST /api/v1/views'] = () => ({
      status: 422,
      body: { type: 'about:blank', title: 'invalid', status: 422, reason: 'validation_failed', errors: { name: ['Der Name ist zu lang.'], icon: ['Wähle ein Icon aus der Liste.'] } },
    });
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenanfragen');
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('Der Name ist zu lang.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(screen.getByRole('dialog', { name: 'Neue View' })).toBeTruthy();
    expect(within(dialog).getByText('Wähle ein Icon aus der Liste.')).toBeTruthy();
    // typing takes the error away, and so does another icon
    await user.type(name, 'x');
    expect(name.getAttribute('aria-invalid')).not.toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emoji wählen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Rakete|rocket/i }));
    await waitFor(() => expect(within(dialog).queryByText('Wähle ein Icon aus der Liste.')).toBeNull());
  });

  it('asks for a name before it sends anything', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    expect(within(dialog).getByText('Gib der View einen Namen, zum Beispiel „Offene Bugs“.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Name' }));
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows a refusal without a field of the dialog on top', async () => {
    const user = userEvent.setup();
    overrides['POST /api/v1/views'] = () => ({
      status: 422,
      body: { type: 'about:blank', title: 'invalid', status: 422, reason: 'validation_failed', errors: { 'display.layout': ['Diese Darstellung gibt es nicht.'] } },
    });
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenanfragen');
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    expect(await within(dialog).findByText('Diese Darstellung gibt es nicht.')).toBeTruthy();
  });

  it('says so in a toast with a retry when the server fails', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenanfragen');
    failing = true;
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    const error = await waitFor(() => currentToasts().find((item) => item.tone === 'error')!);
    expect(error.title).toBe('View nicht angelegt');
    failing = false;
    act(() => runToastAction(error.id));
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/views/v_new_1'));
  });

  it('is open to every member', async () => {
    signedIn = theo;
    renderViews();
    await loaded();

    // the rights load with the projects
    await rightsLoaded();
  });
});

describe('editing', () => {
  it('changes the name and the layout of a view and leaves its filter and its creator alone', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();
    const before = views.find((view) => view.id === 'v_blocked')!;

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'View bearbeiten' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Blockiert');
    await user.clear(name);
    await user.type(name, 'Festgefahren');
    await user.click(within(dialog).getByRole('button', { name: 'Board' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('link', { name: 'Festgefahren' })).toBeTruthy();
    const after = views.find((view) => view.id === 'v_blocked')!;
    expect(after.name).toBe('Festgefahren');
    expect(after.display).toEqual({ ...before.display, layout: 'board' });
    expect(after.filter).toEqual(before.filter);
    expect(after.created_by).toBe(before.created_by);
    expect(api.calls.find((call) => call.method === 'PUT')!.body).toEqual({ name: 'Festgefahren', icon: 'octagon-alert', filter: before.filter, display: after.display });
    expect(toastTitles()).toContain('„Festgefahren“ gespeichert');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(inertia.visit).not.toHaveBeenCalled();
  });

  it('says so in a toast when the server fails', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'View bearbeiten' });
    failing = true;
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(currentToasts().find((item) => item.tone === 'error')?.title).toBe('View nicht gespeichert'));
  });
});

describe('the states', () => {
  it('shows a skeleton in the shape of the rows while the views load', async () => {
    renderViews();

    expect(screen.getByText('Views werden geladen …')).toBeTruthy();
    await loaded();
    expect(screen.queryByText('Views werden geladen …')).toBeNull();
  });

  it('explains an empty list and offers the first view', async () => {
    const user = userEvent.setup();
    views = [];
    renderViews();

    expect(await screen.findByText('Noch keine Views')).toBeTruthy();
    await rightsLoaded();
    const buttons = screen.getAllByRole('button', { name: /Neue View/ });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    expect(await screen.findByRole('dialog', { name: 'Neue View' })).toBeTruthy();
  });

  it('shows the cause and "Erneut versuchen" when the server fails', async () => {
    const user = userEvent.setup();
    failing = true;
    renderViews();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Die Views konnten nicht geladen werden')).toBeTruthy();
    expect(within(alert).getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();

    failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await loaded();
  });

  it('says that the server did not answer when there is no answer', async () => {
    api.restore();
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    renderViews();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Der Server hat nicht geantwortet.')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------ fix round 1 */

const duplicateButton = (name: string) => within(rowOf(name)).getByRole('button', { name: `„${name}“ duplizieren` });

describe('calls that overlap', () => {
  it('settles two copies that are made one after the other, before the first is answered', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    const answer = hold('POST', '/api/v1/views');

    await user.click(duplicateButton('Roadmap'));
    await user.click(duplicateButton('Für Kira'));
    expect(duplicateButton('Roadmap').getAttribute('aria-busy')).toBe('true');
    expect(duplicateButton('Für Kira').getAttribute('aria-busy')).toBe('true');
    // a second press on a busy row makes no second copy
    await user.click(duplicateButton('Roadmap'));

    answer();

    // both copies are there, both rows are free again (and can be copied once more), both toasts came
    await screen.findByRole('link', { name: 'Roadmap (Kopie)' });
    await screen.findByRole('link', { name: 'Für Kira (Kopie)' });
    await waitFor(() => {
      expect(duplicateButton('Roadmap').getAttribute('aria-busy')).toBeNull();
      expect(duplicateButton('Für Kira').getAttribute('aria-busy')).toBeNull();
    });
    expect(toastTitles()).toEqual(expect.arrayContaining(['„Roadmap (Kopie)“ angelegt', '„Für Kira (Kopie)“ angelegt']));
    expect(useUiStore.getState().flashIds).toHaveLength(2);
    expect(views).toHaveLength(8);
  });

  it('says why the first copy failed although a second one was sent after it', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    let calls = 0;
    const make = route('POST', '/api/v1/views')!;
    overrides['POST /api/v1/views'] = (body, url) => {
      calls += 1;
      return calls === 1 ? unavailable : make(body, url);
    };
    const answer = hold('POST', '/api/v1/views');
    await user.click(duplicateButton('Roadmap'));
    await user.click(duplicateButton('Für Kira'));

    answer();

    await screen.findByRole('link', { name: 'Für Kira (Kopie)' });
    await waitFor(() => expect(currentToasts().find((item) => item.tone === 'error')?.title).toBe('„Roadmap“ nicht dupliziert'));
    const error = currentToasts().find((item) => item.tone === 'error')!;
    expect(error.action?.label).toBe('Erneut versuchen');
    await waitFor(() => expect(duplicateButton('Roadmap').getAttribute('aria-busy')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Roadmap (Kopie)' })).toBeNull();

    // the retry makes the copy after all
    act(() => runToastAction(error.id));
    expect(await screen.findByRole('link', { name: 'Roadmap (Kopie)' })).toBeTruthy();
  });
});

describe('sending a form twice', () => {
  it('makes one view when mod+enter is pressed twice before the server answers', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();
    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.type(name, 'Kundenanfragen');
    const answer = hold('POST', '/api/v1/views');

    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /View anlegen/ }).getAttribute('aria-busy')).toBe('true'));
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
    answer();

    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/views/v_new_1'));
    expect(views.filter((view) => view.name === 'Kundenanfragen')).toHaveLength(1);
    expect(toastTitles().filter((title) => title === '„Kundenanfragen“ angelegt')).toHaveLength(1);
  });
});

describe('toasts and the undo', () => {
  it('keeps the 5 seconds of undo while stars are set and taken out', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    await rightsLoaded();

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ löschen' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blockiert' })).toBeNull());
    // four changes of the sidebar after the delete: a toast each would have pushed the undo out
    for (const [name, now] of [
      ['Roadmap', true],
      ['Studio Nordlicht', true],
      ['Bugs in Produktion', false],
      ['Fällig diese Woche', false],
    ] as const) {
      const label = now ? `„${name}“ in die Seitenleiste legen` : `„${name}“ aus der Seitenleiste nehmen`;
      await user.click(within(rowOf(name)).getByRole('button', { name: label }));
      const next = now ? `„${name}“ aus der Seitenleiste nehmen` : `„${name}“ in die Seitenleiste legen`;
      await within(rowOf(name)).findByRole('button', { name: next });
    }

    expect(toastTitles()).toEqual(['„Blockiert“ gelöscht']);
    expect(views).toHaveLength(6);

    act(() => runToastAction(currentToasts()[0]!.id));
    expect(await screen.findByRole('link', { name: 'Blockiert' })).toBeTruthy();
    expect(views).toHaveLength(6);
  });
});

describe('viewForm', () => {
  it('starts a new timeline grouped by project with key and title, every other layout by status', () => {
    expect(newView('Plan', 'route', 'timeline').display).toEqual({ layout: 'timeline', group_by: 'project', sort: { field: 'rank', direction: 'asc' }, fields: ['key', 'title'], show_sub_items: true });
    expect(newView('Liste', 'layers', 'list').display.group_by).toBe('state');
    expect(newView('Liste', 'layers', 'list').filter).toEqual({ version: 1, conditions: [] });
  });

  it('reads the projects a filter names with is and in, each once, and nothing else', () => {
    expect(
      namedProjects({
        version: 1,
        conditions: [
          { field: 'project', op: 'is', value: 'p_a' },
          { field: 'project', op: 'in', value: ['p_b', 'p_a'] },
          { field: 'project', op: 'not_in', value: ['p_c'] },
          { field: 'type', op: 'is', value: 't_bug' },
        ],
      }),
    ).toEqual(['p_a', 'p_b']);
  });
});
