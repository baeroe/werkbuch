import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import * as viewsApi from '@/api/views';
import { deleteView, listFavorites, listViews } from '@/api/views';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { ViewsScreen } from './ViewsScreen';

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => resetToasts());
  vi.restoreAllMocks();
});

function renderViews(path = '/views') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/views', element: <ViewsScreen /> },
      { path: '/views/:viewId', element: <p>eine View</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

/** The list once the views are there. */
const loaded = () => screen.findByRole('link', { name: 'Roadmap' });
/** The row of a view. */
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('li')!;
const toastTitles = () => currentToasts().map((item) => item.title);

describe('the list', () => {
  it('shows every team view with its creator and layout', async () => {
    renderViews();
    await loaded();

    expect(screen.getByRole('heading', { level: 1, name: 'Views' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    const nordlicht = rowOf('Studio Nordlicht');
    expect(within(nordlicht).getByText('Theo Okafor')).toBeTruthy();
    expect(within(nordlicht).getByText('Tabelle')).toBeTruthy();
    expect(within(rowOf('Roadmap')).getByText('Timeline')).toBeTruthy();
    expect(within(rowOf('Bugs in Produktion')).getByText('Board')).toBeTruthy();
    expect(within(rowOf('Fällig diese Woche')).getByText('Liste')).toBeTruthy();
  });

  it('leads to the view on a click on its name', async () => {
    const user = userEvent.setup();
    const { router } = renderViews();
    await loaded();

    await user.click(screen.getByRole('link', { name: 'Roadmap' }));

    expect(router.state.location.pathname).toBe('/views/v_roadmap');
  });

  it('is in the order of the names', async () => {
    renderViews();
    await loaded();

    const names = screen.getAllByRole('link').map((link) => link.textContent);
    expect(names).toEqual(['Blockiert', 'Bugs in Produktion', 'Fällig diese Woche', 'Für Kira', 'Roadmap', 'Studio Nordlicht']);
  });
});

describe('favorites', () => {
  it('shows the stars of the person: Mara has three of the six views in her sidebar', async () => {
    renderViews();
    await loaded();

    expect(screen.getAllByRole('button', { name: /aus der Seitenleiste nehmen/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /in die Seitenleiste legen/ })).toHaveLength(3);
    expect(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' })).toBeTruthy();
    expect(within(rowOf('Für Kira')).getByRole('button', { name: '„Für Kira“ aus der Seitenleiste nehmen' })).toBeTruthy();
  });

  it('puts a view in the sidebar and takes it out again; the star shows it, no toast does', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' }));

    expect(await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' })).toBeTruthy();
    expect((await listFavorites()).items.some((favorite) => favorite.id === 'v_roadmap')).toBe(true);

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' }));

    expect(await within(rowOf('Roadmap')).findByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' })).toBeTruthy();
    expect((await listFavorites()).items.some((favorite) => favorite.id === 'v_roadmap')).toBe(false);
    // a change that shows at once needs no toast (only a refusal does)
    expect(toastTitles()).toEqual([]);
  });

  it('shows the new state of the star at once, with a spinner for the call that is on its way', async () => {
    const user = userEvent.setup();
    // the server answers when the test says so (set up before the screen reads the function)
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const original = viewsApi.toggleFavorite;
    vi.spyOn(viewsApi, 'toggleFavorite').mockImplementation(async (target) => {
      await gate;
      return original(target);
    });
    renderViews();
    await loaded();

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' }));

    // the label already names the next step, and the button reports that it is busy
    const star = within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' });
    expect(star.getAttribute('aria-busy')).toBe('true');
    expect((await listFavorites()).items.some((favorite) => favorite.id === 'v_roadmap')).toBe(false);

    answer();
    await waitFor(() => expect(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ aus der Seitenleiste nehmen' }).getAttribute('aria-busy')).toBeNull());
    expect((await listFavorites()).items.some((favorite) => favorite.id === 'v_roadmap')).toBe(true);
  });

  it('keeps the star as it was and says why when the server fails', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    localStorage.setItem('api:fail', '1');

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' }));

    await waitFor(() => expect(currentToasts().some((item) => item.tone === 'error')).toBe(true));
    expect(currentToasts().find((item) => item.tone === 'error')?.title).toBe('Favorit nicht geändert');
    expect(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ in die Seitenleiste legen' })).toBeTruthy();
  });
});

describe('rights', () => {
  it('lets an org admin change and delete every view', async () => {
    renderViews();
    await loaded();

    for (const name of ['Roadmap', 'Studio Nordlicht', 'Blockiert']) {
      const row = rowOf(name);
      // the rights load with the people, the projects and the memberships
      await waitFor(() => expect(within(row).getByRole('button', { name: `„${name}“ bearbeiten` }).getAttribute('aria-disabled')).toBeNull());
      expect(within(row).getByRole('button', { name: `„${name}“ löschen` }).getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('lets a member change and delete their own views and gives the reason for the others', async () => {
    asUser('u_ida');
    renderViews();
    await loaded();
    // Ida made "Bugs in Produktion"; Mara made "Roadmap"
    const own = rowOf('Bugs in Produktion');
    expect(await within(own).findByRole('button', { name: '„Bugs in Produktion“ löschen' })).toBeTruthy();
    expect(within(own).getByRole('button', { name: '„Bugs in Produktion“ löschen' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(own).getByRole('button', { name: '„Bugs in Produktion“ bearbeiten' }).getAttribute('aria-disabled')).toBeNull();

    const foreign = rowOf('Roadmap');
    for (const action of ['bearbeiten', 'löschen']) {
      const button = within(foreign).getByRole('button', { name: `„Roadmap“ ${action}` });
      await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
      // the reason of the rights, readable for assistive technology as well as in the tooltip
      expect(button.getAttribute('aria-describedby')).toBeTruthy();
      expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Fremde Views ändern und löschen nur Org-Admins.');
    }
  });

  it('does not delete a view of somebody else when the disabled button is pressed', async () => {
    const user = userEvent.setup();
    asUser('u_ida');
    renderViews();
    await loaded();
    const button = within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ löschen' });
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));

    await user.click(button);

    expect(currentToasts()).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Roadmap' })).toBeTruthy();
  });

  it('lets every member duplicate every view', async () => {
    asUser('u_ida');
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
    asUser('u_ida');
    renderViews();
    await loaded();

    await user.click(within(rowOf('Roadmap')).getByRole('button', { name: '„Roadmap“ duplizieren' }));

    expect(await screen.findByRole('link', { name: 'Roadmap (Kopie)' })).toBeTruthy();
    const views = (await listViews()).items;
    const original = views.find((view) => view.id === 'v_roadmap')!;
    const copy = views.find((view) => view.name === 'Roadmap (Kopie)')!;
    expect(copy.created_by).toBe('u_ida');
    expect(copy.id).not.toBe(original.id);
    expect(copy.display).toEqual(original.display);
    expect(copy.filter).toEqual(original.filter);
    expect(copy.icon).toBe(original.icon);
    expect(toastTitles()).toContain('„Roadmap (Kopie)“ angelegt');
    // the person may change their copy
    expect(within(rowOf('Roadmap (Kopie)')).getByRole('button', { name: '„Roadmap (Kopie)“ löschen' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('offers to open the copy', async () => {
    const user = userEvent.setup();
    const { router } = renderViews();
    await loaded();

    await user.click(within(rowOf('Für Kira')).getByRole('button', { name: '„Für Kira“ duplizieren' }));
    await screen.findByRole('link', { name: 'Für Kira (Kopie)' });
    const toastItem = currentToasts().find((item) => item.title === '„Für Kira (Kopie)“ angelegt')!;
    expect(toastItem.action?.label).toBe('Öffnen');
    act(() => runToastAction(toastItem.id));

    const copy = (await listViews()).items.find((view) => view.name === 'Für Kira (Kopie)')!;
    await waitFor(() => expect(router.state.location.pathname).toBe(`/views/${copy.id}`));
  });
});

describe('deleting', () => {
  it('takes the row away at once, "Rückgängig" brings it back and nothing is deleted', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ löschen' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blockiert' })).toBeNull());
    const toastItem = currentToasts().find((item) => item.title === '„Blockiert“ gelöscht')!;
    expect(toastItem.action?.label).toBe('Rückgängig');
    expect((await listViews()).items).toHaveLength(6);

    act(() => runToastAction(toastItem.id));

    expect(await screen.findByRole('link', { name: 'Blockiert' })).toBeTruthy();
    expect((await listViews()).items).toHaveLength(6);
  });

  it('deletes for real when the toast runs out, and takes the star out of the sidebar with it', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(within(rowOf('Für Kira')).getByRole('button', { name: '„Für Kira“ löschen' }));
    act(() => dismissToast(currentToasts().find((item) => item.title === '„Für Kira“ gelöscht')!.id));

    await waitFor(async () => expect((await listViews()).items).toHaveLength(5));
    expect((await listFavorites()).items.some((favorite) => favorite.id === 'v_kira')).toBe(false);
    expect(screen.queryByRole('link', { name: 'Für Kira' })).toBeNull();
  });

  it('brings the row back with a retry when the server fails', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ löschen' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blockiert' })).toBeNull());
    localStorage.setItem('api:fail', '1');
    act(() => dismissToast(currentToasts().find((item) => item.title === '„Blockiert“ gelöscht')!.id));

    expect(await screen.findByRole('link', { name: 'Blockiert' })).toBeTruthy();
    const error = currentToasts().find((item) => item.tone === 'error')!;
    expect(error.title).toBe('„Blockiert“ nicht gelöscht');
    expect(error.action?.label).toBe('Erneut versuchen');
  });
});

describe('a new view', () => {
  it('opens a dialog from the button, creates the view and leads to it', async () => {
    const user = userEvent.setup();
    const { router } = renderViews();
    await loaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenanfragen');
    await user.click(within(dialog).getByRole('button', { name: 'Board' }));
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    const created = (await listViews()).items.find((view) => view.name === 'Kundenanfragen')!;
    expect(created.created_by).toBe('u_mara');
    expect(created.display.layout).toBe('board');
    expect(created.filter).toEqual({ version: 1, conditions: [] });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/views/${created.id}`));
    expect(toastTitles()).toContain('„Kundenanfragen“ angelegt');
  });

  it('opens by itself for /views?create=1, the link of the sidebar, and closes without a trace', async () => {
    const user = userEvent.setup();
    const { router } = renderViews('/views?create=1');

    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
    expect((await listViews()).items).toHaveLength(6);
  });

  it('shows the error of the server at the field and keeps the dialog', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.click(within(dialog).getByRole('button', { name: 'View anlegen' }));

    const name = await within(dialog).findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('Der Name darf nicht leer sein.')).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(screen.getByRole('dialog', { name: 'Neue View' })).toBeTruthy();
  });

  it('is open to every member', async () => {
    asUser('u_theo');
    renderViews();
    await loaded();

    // the rights load with the people, the projects and the memberships
    await waitFor(() => expect(screen.getByRole('button', { name: /Neue View/ }).getAttribute('aria-disabled')).toBeNull());
  });
});

describe('editing', () => {
  it('changes the name and the layout of a view and leaves its filter and its creator alone', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();
    const before = (await listViews()).items.find((view) => view.id === 'v_blocked')!;

    await user.click(within(rowOf('Blockiert')).getByRole('button', { name: '„Blockiert“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'View bearbeiten' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Blockiert');
    await user.clear(name);
    await user.type(name, 'Festgefahren');
    await user.click(within(dialog).getByRole('button', { name: 'Board' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('link', { name: 'Festgefahren' })).toBeTruthy();
    const after = (await listViews()).items.find((view) => view.id === 'v_blocked')!;
    expect(after.name).toBe('Festgefahren');
    expect(after.display.layout).toBe('board');
    expect(after.filter).toEqual(before.filter);
    expect(after.created_by).toBe(before.created_by);
    expect(toastTitles()).toContain('„Festgefahren“ gespeichert');
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
    for (const view of (await listViews()).items) await deleteView(view.id);
    renderViews();

    expect(await screen.findByText('Noch keine Views')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Neue View/ }).length).toBeGreaterThan(0);
  });

  it('shows the cause and "Erneut versuchen" when the server fails', async () => {
    const user = userEvent.setup();
    localStorage.setItem('api:fail', '1');
    renderViews();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Die Views konnten nicht geladen werden')).toBeTruthy();
    expect(within(alert).getByText(/Simulierter Serverfehler/)).toBeTruthy();

    localStorage.removeItem('api:fail');
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await loaded();
  });
});

/* ------------------------------------------------------------------------ fix round 1 */

/** The server answers when the test says so. */
function held() {
  let answer!: () => void;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  return { gate, answer };
}

const duplicateButton = (name: string) => within(rowOf(name)).getByRole('button', { name: `„${name}“ duplizieren` });

describe('calls that overlap', () => {
  it('settles two copies that are made one after the other, before the first is answered', async () => {
    const user = userEvent.setup();
    const { gate, answer } = held();
    const original = viewsApi.saveView;
    vi.spyOn(viewsApi, 'saveView').mockImplementation(async (input) => {
      await gate;
      return original(input);
    });
    renderViews();
    await loaded();

    await user.click(duplicateButton('Roadmap'));
    await user.click(duplicateButton('Für Kira'));
    expect(duplicateButton('Roadmap').getAttribute('aria-busy')).toBe('true');
    expect(duplicateButton('Für Kira').getAttribute('aria-busy')).toBe('true');

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
  });

  it('says why the first copy failed although a second one was sent after it', async () => {
    const user = userEvent.setup();
    const { gate, answer } = held();
    const original = viewsApi.saveView;
    let calls = 0;
    vi.spyOn(viewsApi, 'saveView').mockImplementation(async (input) => {
      calls += 1;
      const mine = calls;
      await gate;
      if (mine === 1) throw new ApiError({ status: 503, reason: 'simulated', detail: 'Simulierter Serverfehler.' });
      return original(input);
    });
    renderViews();
    await loaded();
    await user.click(duplicateButton('Roadmap'));
    await user.click(duplicateButton('Für Kira'));

    answer();

    await screen.findByRole('link', { name: 'Für Kira (Kopie)' });
    await waitFor(() => expect(currentToasts().find((item) => item.tone === 'error')?.title).toBe('„Roadmap“ nicht dupliziert'));
    expect(currentToasts().find((item) => item.tone === 'error')?.action?.label).toBe('Erneut versuchen');
    await waitFor(() => expect(duplicateButton('Roadmap').getAttribute('aria-busy')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Roadmap (Kopie)' })).toBeNull();
  });
});

describe('sending a form twice', () => {
  it('makes one view when mod+enter is pressed twice before the server answers', async () => {
    const user = userEvent.setup();
    const { gate, answer } = held();
    const original = viewsApi.saveView;
    vi.spyOn(viewsApi, 'saveView').mockImplementation(async (input) => {
      await gate;
      return original(input);
    });
    const { router } = renderViews();
    await loaded();
    await user.click(screen.getByRole('button', { name: /Neue View/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue View' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenanfragen');

    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    answer();

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/views\/v_/));
    expect((await listViews()).items.filter((view) => view.name === 'Kundenanfragen')).toHaveLength(1);
    expect(toastTitles().filter((title) => title === '„Kundenanfragen“ angelegt')).toHaveLength(1);
  });
});

describe('toasts and the undo', () => {
  it('keeps the 5 seconds of undo while stars are set and taken out', async () => {
    const user = userEvent.setup();
    renderViews();
    await loaded();

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
    expect((await listViews()).items).toHaveLength(6);

    act(() => runToastAction(currentToasts()[0].id));
    expect(await screen.findByRole('link', { name: 'Blockiert' })).toBeTruthy();
    expect((await listViews()).items).toHaveLength(6);
  });
});
