/*
 * Saving, discarding and copying what a list shows (spec 4.11), and the display menu, against a fake REST API
 * (`mockApi`). The lists answer without items (the rows are list.test.tsx's and screen.test.tsx's business); Inertia is a
 * fake whose address the tests set and whose `router.get` moves it as the server would answer.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { mockApi, type MockApi } from '@/test/api';
import { agency, labels, lene, list, makeView, mara, organization, project, properties, standard, types } from '@/test/fixtures';
import { useUiStore } from '@/store/ui';
import type { Condition, Display, View, ViewInput } from '@/types';
import { DisplayMenu, fieldLabel } from '../display/DisplayMenu';
import { ItemsScreen, type ItemsScreenProps } from '../ItemsScreen';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/WEB';
  const listeners = new Set<() => void>();
  return {
    user: null as unknown,
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
  };
});

vi.mock('@inertiajs/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePage: () => ({
      props: { auth: { user: inertia.user, permissions: [] }, organization },
      url: useSyncExternalStore(inertia.subscribe, () => inertia.url),
    }),
    router: {
      get: (url: string, _data: unknown, options: { onSuccess?: () => void; onFinish?: () => void }) => {
        inertia.go(url);
        options.onSuccess?.();
        options.onFinish?.();
      },
      visit: inertia.visit,
      replace: vi.fn(),
      on: () => () => {},
    },
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

/* --------------------------------------------------------------------- fake server */

const display = (changes: Partial<Display> = {}): Display => ({
  layout: 'list',
  group_by: 'state',
  sort: { field: 'rank', direction: 'asc' },
  fields: ['key', 'state'],
  show_sub_items: true,
  ...changes,
});

const ownView = () => makeView({ created_by: 'u_lene', filter: { version: 1, conditions: [] }, display: display() });

let views: View[];
let api: MockApi;
/** `PUT /views/…` answers 503 while set. */
let saveFails: boolean;
/** How the next `POST /views` answers; by default it makes the view. */
let createAnswer: ((body: ViewInput) => { status: number; body: unknown }) | null;

beforeEach(() => {
  inertia.user = lene;
  inertia.go('/projects/WEB');
  inertia.visit.mockClear();
  views = [];
  saveFails = false;
  createAnswer = null;
  useUiStore.setState({ selection: [], peekItemId: null });
  resetToasts();
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list([project('WEB', 'member', { name: 'Website-Relaunch' })]) }),
    'GET /api/v1/projects/WEB': () => ({ body: { data: project('WEB', 'member', { name: 'Website-Relaunch' }) } }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/users': () => ({ body: list([mara, lene]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/favorites': () => ({ body: list([]) }),
    'GET /api/v1/views/v_due_week': () => ({ body: { data: views.find((entry) => entry.id === 'v_due_week') } }),
    'PUT /api/v1/views/v_due_week': (body) => {
      if (saveFails) return { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };
      const saved = { ...views[0]!, ...(body as ViewInput), updated_at: '2026-11-01T10:00:00.000Z' };
      views = [saved];
      return { body: { data: saved } };
    },
    'POST /api/v1/views': (body) => {
      if (createAnswer) return createAnswer(body as ViewInput);
      const made = { ...makeView(), ...(body as ViewInput), id: 'v_new', created_by: 'u_lene' };
      return { status: 201, body: { data: made } };
    },
    'POST /api/v1/work-items/groups': (body) => ({ body: { data: { group_by: (body as { group_by: string }).group_by, total: 0, groups: [] } } }),
    'POST /api/v1/work-items/query': () => ({ body: list([], 0) }),
  });
});

afterEach(() => api.restore());

function renderScreen(props: ItemsScreenProps = { preset: 'project', projectIdentifier: 'WEB' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <main id="main">
          <ItemsScreen {...props} />
        </main>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const openView = async (view: View, query = '') => {
  views = [view];
  inertia.go(`/views/v_due_week${query}`);
  renderScreen({ preset: 'view', viewId: 'v_due_week' });
  await screen.findByRole('heading', { level: 1, name: view.name });
};

const posted = () => api.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/views').map((call) => call.body as ViewInput);
const dialog = () => screen.getByRole('dialog', { name: 'Als neue View speichern' });
const filterOf = (conditions: Condition[]) => encodeURIComponent(JSON.stringify(conditions));
/** "Als neue View speichern …" of the bar, once the rights allow it. */
async function openSaveAs() {
  const button = await screen.findByRole('button', { name: 'Als neue View speichern …' });
  await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(button);
  return dialog();
}
const reasonOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent;

/* -------------------------------------------------------------------------- tests */

describe('unsaved changes', () => {
  it('shows a changed view as unsaved, and "Verwerfen" brings the saved state back', async () => {
    await openView(ownView(), '?group=priority');
    expect(await screen.findByText('Ungespeicherte Änderungen')).toBeTruthy();
    expect(screen.getByText('an „Fällig diese Woche“')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(inertia.url).toBe('/views/v_due_week');
    await waitFor(() => expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull());

    // the changes lived only in the address: "Rückgängig" brings them back
    const discarded = currentToasts().find((entry) => entry.title === 'Änderungen verworfen')!;
    act(() => discarded.action!.onClick());
    expect(inertia.url).toBe('/views/v_due_week?group=priority');
    expect(await screen.findByText('Ungespeicherte Änderungen')).toBeTruthy();
  });

  it('shows a built-in list as unsaved only by its filter, and "Verwerfen" keeps its display', async () => {
    inertia.go('/projects/WEB?group=priority');
    renderScreen();
    await screen.findByRole('heading', { level: 1, name: 'Website-Relaunch' });
    await screen.findByRole('button', { name: 'Anzeige' });
    expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull();

    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}&group=priority`));
    expect(await screen.findByText('an dieser Liste')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(inertia.url).toBe('/projects/WEB?group=priority');
  });

  it('saves the changes of an own view', async () => {
    await openView(ownView(), '?group=priority&sort=property:gone:desc');
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(currentToasts().map((entry) => entry.title)).toContain('„Fällig diese Woche“ gespeichert'));
    const put = api.calls.find((call) => call.method === 'PUT')!;
    // a sort on a property that is gone is saved as the manual order (the server would refuse it, P2)
    expect(put.body).toEqual({ name: 'Fällig diese Woche', icon: 'calendar-clock', filter: { version: 1, conditions: [] }, display: display({ group_by: 'priority' }) });
    // the view holds what was shown: the address has no changes any more
    expect(inertia.url).toBe('/views/v_due_week');
    await waitFor(() => expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull());
  });

  it('says what failed when a view cannot be saved', async () => {
    await openView(ownView(), '?group=priority');
    saveFails = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(currentToasts().map((entry) => entry.title)).toContain('View nicht gespeichert'));
    const failed = currentToasts().find((entry) => entry.title === 'View nicht gespeichert')!;
    expect(failed.description).toBe('Wartung.');
    expect(screen.getByText('Ungespeicherte Änderungen')).toBeTruthy();
    saveFails = false;
    act(() => failed.action!.onClick());
    await waitFor(() => expect(currentToasts().map((entry) => entry.title)).toContain('„Fällig diese Woche“ gespeichert'));
  });

  it('says who may save a view of somebody else and offers save as', async () => {
    await openView(makeView({ created_by: 'u_mara', display: display() }), '?group=priority');
    const save = await screen.findByRole('button', { name: 'Speichern' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => expect(reasonOf(save)).toBe('Nur Mara Lindqvist und Org-Admins dürfen „Fällig diese Woche“ ändern. Speichere deine Änderungen als neue View.'));
    fireEvent.click(save);
    expect(api.calls.some((call) => call.method === 'PUT')).toBe(false);

    await openSaveAs();
    const name = within(dialog()).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Fällig diese Woche (Kopie)');
    // a view takes no scope along
    expect(within(dialog()).queryByText(/übernimmt dazu die Bedingung/)).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/views/v_new'));
    expect(posted()[0]).toEqual({ name: 'Fällig diese Woche (Kopie)', icon: 'calendar-clock', filter: makeView().filter, display: display({ group_by: 'priority' }) });
    expect(currentToasts().map((entry) => entry.title)).toContain('View „Fällig diese Woche (Kopie)“ angelegt');
  });

  it('blocks saving a view with a condition on a field that is gone, and says how to get on', async () => {
    const gone: Condition = { field: 'property:gone', op: 'is', value: 'opt_x' };
    await openView(makeView({ created_by: 'u_lene', filter: { version: 1, conditions: [gone] }, display: display() }), '?group=priority');
    const sentence = 'Eine Bedingung nennt ein Feld, das es nicht mehr gibt. Entferne sie mit × am Chip „Unbekanntes Feld“, dann lässt sich die View speichern.';
    const save = await screen.findByRole('button', { name: 'Speichern' });
    await waitFor(() => expect(reasonOf(save)).toBe(sentence));
    expect(save.getAttribute('aria-disabled')).toBe('true');
    const saveAs = screen.getByRole('button', { name: 'Als neue View speichern …' });
    expect(reasonOf(saveAs)).toBe(sentence);
    fireEvent.click(save);
    fireEvent.click(saveAs);
    expect(screen.queryByRole('dialog', { name: 'Als neue View speichern' })).toBeNull();
    expect(api.calls.some((call) => call.method === 'PUT' || (call.method === 'POST' && call.url === '/api/v1/views'))).toBe(false);

    // the × of the chip takes the condition away: both may be sent again
    fireEvent.click(screen.getByRole('button', { name: 'Filter „Unbekanntes Feld“ entfernen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ filter: { version: 1, conditions: [] } }));
  });

  it('refuses mod+enter in the dialog while a condition names a field that is gone', async () => {
    const user = userEvent.setup();
    inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`);
    renderScreen();
    const form = await openSaveAs();
    // the field goes while the dialog is open (a link that names it in another tab is the same thing)
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'nonsense', op: 'is', value: 'x' }])}`));
    const submit = within(form).getByRole('button', { name: /View anlegen/ });
    await waitFor(() => expect(submit.getAttribute('aria-disabled')).toBe('true'));
    const name = within(form).getByRole('textbox', { name: 'Name' });
    await user.click(name);
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
    fireEvent.submit(name.closest('form')!);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(posted()).toHaveLength(0);
  });

  it('lets an org admin save the view of somebody else', async () => {
    inertia.user = mara;
    await openView(makeView({ created_by: 'u_lene', display: display() }), '?group=priority');
    const save = await screen.findByRole('button', { name: 'Speichern' });
    await waitFor(() => expect(save.getAttribute('aria-disabled')).toBeNull());
  });

  it('names a copy of a long name within the 60 characters of a name', async () => {
    const long = 'Eine View mit einem Namen, der fast die ganzen sechzig Zeichen';
    await openView(makeView({ name: long, created_by: 'u_lene', display: display() }), '?group=priority');
    await openSaveAs();
    const name = (within(dialog()).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value;
    expect([...name]).toHaveLength(60);
    expect(name.endsWith(' (Kopie)')).toBe(true);
  });
});

describe('save as a new view', () => {
  it('saves a built-in list as a new view with its scope, also Beobachtet', async () => {
    const logo: Condition = { field: 'title', op: 'contains', value: 'Logo' };
    inertia.go(`/projects/WEB?filter=${filterOf([logo])}`);
    const { unmount } = renderScreen();
    await openSaveAs();
    expect(within(dialog()).getByText('Die View übernimmt dazu die Bedingung „Projekt ist Website-Relaunch“, damit sie dieselben Items zeigt.')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]!.name).toBe('Website-Relaunch');
    expect(posted()[0]!.filter.conditions).toEqual([{ field: 'project', op: 'is', value: 'p_web' }, logo]);
    unmount();

    for (const [preset, path, title, scope, condition] of [
      ['my', '/my-items', 'Meine Items', 'Assignee ist ich', { field: 'assignee', op: 'is', value: 'me' }],
      ['created', '/my-items/created', 'Von mir erstellt', 'Ersteller ist ich', { field: 'created_by', op: 'is', value: 'me' }],
      ['subscribed', '/my-items/subscribed', 'Beobachtet', 'Beobachtet ist ja', { field: 'subscribed', op: 'is', value: true }],
    ] as const) {
      inertia.go(`${path}?filter=${filterOf([logo])}`);
      const rendered = renderScreen({ preset });
      await openSaveAs();
      expect(within(dialog()).getByText(`Die View übernimmt dazu die Bedingung „${scope}“, damit sie dieselben Items zeigt.`)).toBeTruthy();
      expect((within(dialog()).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(title);
      fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
      await waitFor(() => expect(inertia.visit).toHaveBeenLastCalledWith('/views/v_new'));
      expect(posted().at(-1)!.filter.conditions).toContainEqual(condition);
      expect(posted().at(-1)!.filter.conditions.at(-1)).toEqual(logo);
      rendered.unmount();
    }
  });

  it('saves a display-only change of a built-in list as a new view', async () => {
    const user = userEvent.setup();
    inertia.go('/projects/WEB?fields=key,property:gone');
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Anzeige' }));
    const menu = await screen.findByRole('dialog', { name: 'Anzeige' });
    await user.click(within(menu).getByRole('combobox', { name: /^Gruppierung/ }));
    await user.click(await screen.findByRole('option', { name: 'Priorität' }));
    expect(inertia.url).toBe('/projects/WEB?group=priority&fields=key%2Cproperty%3Agone');
    // no unsaved change: the display is how one looks at a built-in list (P28)
    expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: 'Als neue View speichern …' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Anzeige' })).toBeNull());

    const name = within(dialog()).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Nach Priorität');
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    // a field whose property is gone stays out (the server would refuse it)
    expect(posted()[0]).toMatchObject({ name: 'Nach Priorität', icon: 'layers', display: { group_by: 'priority', fields: ['key'] } });
    expect(posted()[0]!.filter.conditions).toEqual([{ field: 'project', op: 'is', value: 'p_web' }]);
  });

  it('picks an emoji as the icon of the new view', async () => {
    inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`);
    renderScreen();
    await openSaveAs();
    const user = userEvent.setup();
    await user.click(within(dialog()).getByRole('combobox', { name: /^Icon/ }));
    await user.click(await screen.findByRole('option', { name: 'Käfer' }));
    expect(within(dialog()).getByRole('combobox', { name: /^Icon/ }).textContent).toContain('Käfer');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Emoji wählen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Rakete|rocket/i }));
    await waitFor(() => expect(within(dialog()).getByRole('combobox', { name: /^Icon/ }).textContent).toContain('Eigenes Icon'));
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    await waitFor(() => expect(posted()[0]?.icon).toBe('🚀'));
  });

  it('shows the error of the server at the name field', async () => {
    inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`);
    renderScreen();
    await openSaveAs();
    const user = userEvent.setup();
    const name = within(dialog()).getByRole('textbox', { name: 'Name' });

    // an empty name never goes to the server
    await user.clear(name);
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    expect(await within(dialog()).findByText('Gib der View einen Namen, zum Beispiel „Offene Bugs“.')).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(posted()).toHaveLength(0);

    createAnswer = () => ({ status: 422, body: { reason: 'validation_failed', errors: { name: ['Der Name ist zu lang.'], icon: ['Wähle ein Icon aus der Liste.'] } } });
    await user.type(name, 'Zu lang');
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    expect(await within(dialog()).findByText('Der Name ist zu lang.')).toBeTruthy();
    expect(within(dialog()).getByText('Wähle ein Icon aus der Liste.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.getAttribute('aria-invalid')).toBe('true');
    // typing takes the error of the field away
    await user.type(name, '!');
    expect(within(dialog()).queryByText('Der Name ist zu lang.')).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Emoji wählen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Rakete|rocket/i }));
    await waitFor(() => expect(within(dialog()).queryByText('Wähle ein Icon aus der Liste.')).toBeNull());

    // a refusal without a field stands on top; a failure says so in a toast with a retry, and the dialog stays
    // as the server answers it: the general sentence, the cause at the path (a property deleted since the list loaded)
    createAnswer = () => ({
      status: 422,
      body: { reason: 'validation_failed', detail: 'Die Eingabe ist nicht gültig.', errors: { 'filter.conditions.1.field': ['Dieses Feld gibt es nicht.'] } },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    expect(await within(dialog()).findByText('Dieses Feld gibt es nicht.')).toBeTruthy();
    // without a sentence of its own, the general one
    createAnswer = () => ({ status: 409, body: { reason: 'conflict', detail: 'Die Eingabe ist nicht gültig.' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    expect(await within(dialog()).findByText('Die Eingabe ist nicht gültig.')).toBeTruthy();
    createAnswer = () => ({ status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /View anlegen/ }));
    await waitFor(() => expect(currentToasts().map((entry) => entry.title)).toContain('View nicht angelegt'));
    expect(dialog()).toBeTruthy();
    createAnswer = null;
    act(() => currentToasts().find((entry) => entry.title === 'View nicht angelegt')!.action!.onClick());
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/views/v_new'));
  });

  it('makes one view when mod+enter is pressed twice', async () => {
    inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`);
    renderScreen();
    await openSaveAs();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/views')) await gate;
      return inner(input, init);
    };
    try {
      const name = within(dialog()).getByRole('textbox', { name: 'Name' });
      act(() => name.focus());
      fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
      await waitFor(() => expect(within(dialog()).getByRole('button', { name: /View anlegen/ }).getAttribute('aria-busy')).toBe('true'));
      fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
      release();
      await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/views/v_new'));
      expect(posted()).toHaveLength(1);
    } finally {
      globalThis.fetch = inner;
    }
  });
});

describe('the display menu', () => {
  function renderMenu(props: Partial<Parameters<typeof DisplayMenu>[0]> = {}) {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <DisplayMenu display={display()} onChange={onChange} fellBack={false} properties={properties} {...props} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Anzeige' }));
    return { onChange, menu: screen.getByRole('dialog', { name: 'Anzeige' }) };
  }

  it('offers no grouping by status when the items span several workflows', async () => {
    const user = userEvent.setup();
    const { menu } = renderMenu({ fellBack: true });
    const grouping = within(menu).getByRole('combobox', { name: /^Gruppierung/ });
    expect(grouping.textContent).toContain('Kategorie');
    expect(within(menu).getByText('Die Items haben mehrere Workflows, darum nach Kategorie.')).toBeTruthy();
    await user.click(grouping);
    expect(await screen.findByRole('option', { name: 'Assignee' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Status' })).toBeNull();
  });

  it('groups by status when the items have one workflow', async () => {
    const user = userEvent.setup();
    const { menu, onChange } = renderMenu();
    await user.click(within(menu).getByRole('combobox', { name: /^Gruppierung/ }));
    await user.click(await screen.findByRole('option', { name: 'Assignee' }));
    expect(onChange).toHaveBeenLastCalledWith(display({ group_by: 'assignee' }));
  });

  it('sorts by a number property', async () => {
    const user = userEvent.setup();
    const { menu, onChange } = renderMenu();
    await user.click(within(menu).getByRole('combobox', { name: /^Sortierung/ }));
    // number, date, text and URL sort; a dropdown does not
    expect(screen.queryByRole('option', { name: 'Kunde' })).toBeNull();
    await user.click(await screen.findByRole('option', { name: 'Aufwand (h)' }));
    expect(onChange).toHaveBeenLastCalledWith(display({ sort: { field: 'property:effort', direction: 'asc' } }));
    fireEvent.click(within(menu).getByRole('button', { name: /Absteigend/ }));
    expect(onChange).toHaveBeenLastCalledWith(display({ sort: { field: 'rank', direction: 'desc' } }));
  });

  it('shows a sort on a property that is gone as an unknown field', () => {
    const { menu } = renderMenu({ display: display({ sort: { field: 'property:gone', direction: 'asc' } }) });
    expect(within(menu).getByRole('combobox', { name: /^Sortierung/ }).textContent).toContain('Unbekanntes Feld');
    expect(within(menu).getByText('Das Feld gibt es nicht mehr. Bis du ein anderes wählst, ist die Liste manuell sortiert.')).toBeTruthy();
  });

  it('hides sub-items', () => {
    const { menu, onChange } = renderMenu();
    fireEvent.click(within(menu).getByRole('switch', { name: 'Kind-Items zeigen' }));
    expect(onChange).toHaveBeenLastCalledWith(display({ show_sub_items: false }));
  });

  it('shows and hides fields, properties included, and switches the layout', () => {
    const { menu, onChange } = renderMenu();
    expect(within(menu).getByText('Chips in der Liste, Spalten in der Tabelle. Karten im Board zeigen davon Labels, Priorität, Due-Date und Assignee.')).toBeTruthy();
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Assignee' }));
    expect(onChange).toHaveBeenLastCalledWith(display({ fields: ['key', 'state', 'assignee'] }));
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Status' }));
    expect(onChange).toHaveBeenLastCalledWith(display({ fields: ['key'] }));
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Aufwand (h)' }));
    expect(onChange).toHaveBeenLastCalledWith(display({ fields: ['key', 'state', 'property:effort'] }));
    fireEvent.click(within(menu).getByRole('button', { name: /Board/ }));
    expect(onChange).toHaveBeenLastCalledWith(display({ layout: 'board' }));
    // a view saves from its bar, not from the menu
    expect(within(menu).queryByRole('button', { name: 'Als neue View speichern …' })).toBeNull();
  });

  it('names the display fields', () => {
    expect(fieldLabel('title', properties)).toBe('Titel');
    expect(fieldLabel('due_date', properties)).toBe('Due-Date');
    expect(fieldLabel('property:effort', properties)).toBe('Aufwand (h)');
    expect(fieldLabel('property:gone', properties)).toBe('property:gone');
  });

  it('says why a list cannot be saved as a view yet', () => {
    const onSaveAs = vi.fn();
    const { menu } = renderMenu({ onSaveAs, saveAsReason: 'Rechte werden geladen …' });
    const button = within(menu).getByRole('button', { name: 'Als neue View speichern …' });
    fireEvent.click(button);
    expect(onSaveAs).not.toHaveBeenCalled();
    expect(reasonOf(button)).toBe('Rechte werden geladen …');
  });
});

