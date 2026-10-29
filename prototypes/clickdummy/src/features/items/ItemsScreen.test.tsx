import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAIL_KEY } from '@/api/client';
import { getDb, saveDb } from '@/api/db';
import { getWorkItem } from '@/api/workItems';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import type { WorkItem } from '@/types';
import ItemsRoute from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/projects/:identifier', element: <ItemsRoute preset="project" /> },
      { path: '/views/:viewId', element: <ItemsRoute preset="view" /> },
      { path: '/elsewhere', element: <p>Woanders</p> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

const filterOf = (conditions: unknown[]) => encodeURIComponent(JSON.stringify(conditions));
/** The screen's one polite region for what changes without the focus moving. */
const announcer = () => screen.getByRole('status', { name: 'Mitteilungen der Liste' });
/** A key on the page, as the shortcut registry hears it. */
const press = (key: string) => act(() => void fireEvent.keyDown(document.body, { key }));

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
  // the list is virtualized against the window; jsdom has no layout to scroll
  window.scrollTo = vi.fn();
});

describe('the item list screen', () => {
  it('empties the selection when the list goes away, so no other screen acts on it', async () => {
    const router = renderAt('/projects/WEB');
    expect(await screen.findByRole('heading', { level: 1, name: 'Website-Relaunch' })).toBeTruthy();
    act(() => useUiStore.getState().setSelection(['wi_web_47']));

    await act(() => router.navigate('/elsewhere'));
    expect(await screen.findByText('Woanders')).toBeTruthy();
    expect(useUiStore.getState().selection).toEqual([]);
    router.dispose();
  });

  it('shows a changed view as unsaved, and "Verwerfen" brings the saved state back', async () => {
    const router = renderAt('/views/v_kira?group=priority');
    expect(await screen.findByText('Ungespeicherte Änderungen')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(router.state.location.search).toBe('');
    expect(screen.queryByText('Ungespeicherte Änderungen')).toBeNull();
    router.dispose();
  });

  it('names a project that does not exist instead of showing an empty list', async () => {
    const router = renderAt('/projects/NOPE');
    expect(await screen.findByRole('heading', { level: 1, name: 'Das Projekt NOPE gibt es nicht' })).toBeTruthy();
    router.dispose();
  });

  it('keeps / and f working while items are selected: the filter bar stays beside the bulk bar', async () => {
    const router = renderAt('/projects/WEB');
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
    act(() => useUiStore.getState().setSelection(['wi_web_47']));
    expect(await screen.findByText(/von 34 ausgewählt/)).toBeTruthy();

    press('/');
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Titel durchsuchen' }));
    act(() => (document.activeElement as HTMLElement).blur());

    press('f');
    expect(await screen.findByRole('menu')).toBeTruthy();
    // "Anzeige" and "Neues Item" stay within reach as well
    expect(screen.getByRole('button', { name: 'Anzeige' })).toBeTruthy();
    expect(useUiStore.getState().selection).toEqual(['wi_web_47']);
    router.dispose();
  });

  it('announces changes of the selection and of the results in one polite status region', async () => {
    const router = renderAt('/projects/WEB');
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
    expect(announcer().getAttribute('aria-live') ?? 'polite').toBe('polite');

    act(() => useUiStore.getState().setSelection(['wi_web_47']));
    await waitFor(() => expect(announcer().textContent).toBe('WEB-47 ausgewählt, 1 von 34'));
    // the focused row says it too
    expect(screen.getByRole('group', { name: 'WEB-47 Kontaktformular sendet doppelt, ausgewählt' })).toBeTruthy();

    act(() => useUiStore.getState().setSelection([]));
    await waitFor(() => expect(announcer().textContent).toBe('Auswahl aufgehoben'));

    await act(() => router.navigate(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'zzz' }])}`));
    await waitFor(() => expect(announcer().textContent).toBe('Kein Item passt zum Filter'));
    await act(() => router.navigate(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Formular' }])}`));
    await waitFor(() => expect(announcer().textContent).toBe('2 Items'));
    router.dispose();
  });

  it('shows archived items again once the filter asks for them', async () => {
    const router = renderAt('/projects/OPS');
    expect(await screen.findByText('Bestandsaufnahme der alten Server')).toBeTruthy();
    act(() => useUiStore.getState().setSelection(['wi_ops_4']));
    fireEvent.click(await screen.findByRole('button', { name: 'Archivieren' }));

    // the undo time runs out: now the item is archived
    const undo = currentToasts().find((entry) => entry.title === 'OPS-4 archiviert');
    expect(undo).toBeTruthy();
    act(() => dismissToast(undo!.id));
    await waitFor(async () => expect((await getWorkItem('OPS-4')).item.archived_at).not.toBeNull());

    await act(() => router.navigate(`/projects/OPS?filter=${filterOf([{ field: 'archived', op: 'is', value: true }])}`));
    expect(await screen.findByText('Bestandsaufnahme der alten Server')).toBeTruthy();
    router.dispose();
  });
});

describe('a list of more than 100 items', () => {
  /** WEB gets 180 more open items (or items with the fields given), in this test only; they sort after the seed's. */
  function moreItems(count = 180, fields: Partial<WorkItem> = {}) {
    const db = getDb();
    const model = db.items.find((item) => item.key === 'WEB-43')!;
    for (let n = 0; n < count; n += 1) {
      const number = 1000 + n;
      db.items.push({
        ...structuredClone(model),
        id: `wi_web_${number}`,
        number,
        key: `WEB-${number}`,
        title: `Zusatzaufgabe ${number}`,
        parent_id: null,
        rank: `z${String(n).padStart(4, '0')}`,
        subscriber_ids: [],
        ...fields,
      });
    }
    saveDb();
  }

  // these render a few hundred rows in jsdom: more time than the default under a full parallel run
  const SLOW = 20_000;

  it(
    'counts every matching item and says "x von N" of all of them, the first 100 loaded',
    async () => {
      moreItems();
      const router = renderAt('/projects/WEB?group=none');
      // the 34 top-level items of the seed and the 180 new ones; the first 100 load
      expect(await screen.findByText('100 von 214 Items geladen')).toBeTruthy();

      act(() => useUiStore.getState().setSelection(['wi_web_47']));
      await waitFor(() => expect(announcer().textContent).toBe('WEB-47 ausgewählt, 1 von 214'));
      expect(screen.getByText(/von 214 ausgewählt/)).toBeTruthy();
      router.dispose();
    },
    SLOW,
  );

  it(
    '"Mehr laden" keeps the focus while the next page loads, and a page that fails can be asked for again',
    async () => {
      moreItems();
      const router = renderAt('/projects/WEB?group=none');
      const more = await screen.findByRole('button', { name: 'Mehr laden' });
      act(() => more.focus());
      fireEvent.click(more);
      expect(await screen.findByText('200 von 214 Items geladen')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Mehr laden' })).toBe(more);
      expect(document.activeElement).toBe(more);

      // a page that fails says so in the footer, which offers to try again
      localStorage.setItem(FAIL_KEY, '1');
      fireEvent.click(more);
      expect(await screen.findByText('Weitere Items ließen sich nicht laden.')).toBeTruthy();
      localStorage.removeItem(FAIL_KEY);
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Mehr laden|Erneut versuchen/ })).toBeNull());
      router.dispose();
    },
    SLOW,
  );

  it(
    'loads every page of a grouped list, so the group and column counts count every item of their group',
    async () => {
      moreItems(180, { state_id: 'std_done', resolution_id: 'res_done', closed_at: '2026-10-27T15:00:00.000Z' });
      // the board: its columns are not virtualized, so every count is in the DOM (the list's rows are, in jsdom)
      const router = renderAt('/projects/WEB?layout=board');
      // the project list shows sub-items too
      const done = getDb().items.filter((item) => item.project_id === 'p_web' && item.state_id === 'std_done' && item.archived_at === null).length;
      expect(done).toBeGreaterThan(180);

      const column = await screen.findByRole('region', { name: 'Done' }, { timeout: 5000 });
      await waitFor(() => expect(within(column).getByRole('heading', { name: 'Done' }).parentElement?.textContent).toContain(`${done} Items`), { timeout: 5000 });
      expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
      router.dispose();
    },
    SLOW,
  );

  it(
    'selects every matching item from the table header too, also the ones that were not loaded yet',
    async () => {
      moreItems();
      const router = renderAt('/projects/WEB?group=none&layout=table');
      expect(await screen.findByText('100 von 214 Items geladen', {}, { timeout: 5000 })).toBeTruthy();

      fireEvent.click(screen.getAllByRole('checkbox', { name: 'Alle Items auswählen' })[0]);
      await waitFor(() => expect(useUiStore.getState().selection).toHaveLength(214));
      router.dispose();
    },
    SLOW,
  );

  it(
    'selects every matching item with mod+a, also the ones that were not loaded yet',
    async () => {
      moreItems();
      const router = renderAt('/projects/WEB?group=none');
      expect(await screen.findByText('100 von 214 Items geladen')).toBeTruthy();

      act(() => void fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true }));
      await waitFor(() => expect(useUiStore.getState().selection).toHaveLength(214));
      await waitFor(() => expect(announcer().textContent).toBe('Alle 214 Items ausgewählt'));
      expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
      router.dispose();
    },
    SLOW,
  );
});
