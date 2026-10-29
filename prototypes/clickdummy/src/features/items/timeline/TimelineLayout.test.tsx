import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkItem, getWorkItem, listWorkItems } from '@/api/workItems';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import ItemsRoute from '../routes';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/projects/:identifier', element: <ItemsRoute preset="project" /> },
      { path: '/views/:viewId', element: <ItemsRoute preset="view" /> },
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

/** An epic's row on the time axis (or its card in "Ohne Datum"), named by its key. */
const epic = (key: string) => screen.findByRole('group', { name: new RegExp(`^${key} `) });
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init }));
const filterOf = (conditions: unknown[]) => encodeURIComponent(JSON.stringify(conditions));

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
  resetToasts();
  window.scrollTo = vi.fn();
});

describe('the timeline', () => {
  it('shows only the epics, grouped by project', async () => {
    const router = renderAt('/views/v_roadmap');
    expect(within(await screen.findByRole('region', { name: 'Website-Relaunch' })).getByRole('group', { name: /^WEB-30 Relaunch Phase 1, 01\.10\.2026 bis 15\.11\.2026/ })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Kunden-App' })).getByRole('group', { name: /^APP-5 / })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Infrastruktur' })).getByRole('group', { name: /^OPS-3 / })).toBeTruthy();
    // a task is no epic
    expect(screen.queryByText('Kontaktformular sendet doppelt')).toBeNull();
    router.dispose();
  });

  it('moves the selected epic by one unit with ⇧→ and saves both dates', async () => {
    const router = renderAt('/views/v_roadmap');
    const row = await epic('WEB-30');
    act(() => row.focus());

    // month zoom: one unit is a week
    press('ArrowRight', { shiftKey: true });
    await waitFor(async () => expect((await getWorkItem('WEB-30')).item).toMatchObject({ start_date: '2026-10-08', due_date: '2026-11-22' }), { timeout: 2000 });
    router.dispose();
  });

  it('changes the duration of the selected epic with ⌥→ and ⌥←', async () => {
    const router = renderAt('/views/v_roadmap');
    const row = await epic('WEB-30');
    act(() => row.focus());

    press('ArrowRight', { altKey: true });
    press('ArrowRight', { altKey: true });
    press('ArrowLeft', { altKey: true });
    await waitFor(async () => expect((await getWorkItem('WEB-30')).item).toMatchObject({ start_date: '2026-10-01', due_date: '2026-11-22' }), { timeout: 2000 });
    router.dispose();
  });

  it('moves by a day at week zoom', async () => {
    const router = renderAt('/views/v_roadmap');
    const row = await epic('APP-5');
    fireEvent.click(screen.getByRole('button', { name: 'Woche' }));
    // the zoom is part of the address
    expect(router.state.location.search).toContain('zoom=week');
    act(() => row.focus());

    press('ArrowLeft', { shiftKey: true });
    await waitFor(async () => expect((await getWorkItem('APP-5')).item).toMatchObject({ start_date: '2026-10-19', due_date: '2026-12-19' }), { timeout: 2000 });
    router.dispose();
  });

  it('opens at the zoom the address names', async () => {
    const router = renderAt('/views/v_roadmap?zoom=quarter');
    await epic('WEB-30');
    expect(screen.getByRole('button', { name: 'Quartal' }).getAttribute('aria-pressed')).toBe('true');
    router.dispose();
  });

  it('lists epics without dates under "Ohne Datum" and plans one from today', async () => {
    const planned = await createWorkItem({ project_id: 'p_web', type_id: 't_epic', title: 'Journal und Blog' });
    const router = renderAt('/views/v_roadmap');
    const aside = await screen.findByRole('complementary', { name: 'Ohne Datum' });
    expect(within(aside).getByRole('group', { name: new RegExp(`^${planned.key} Journal und Blog`) })).toBeTruthy();

    fireEvent.click(within(aside).getByRole('button', { name: `${planned.key} ab heute einplanen` }));
    await waitFor(async () => {
      const page = await listWorkItems({ filter: { version: 1, conditions: [{ field: 'title', op: 'contains', value: 'Journal und Blog' }] } });
      expect(page.items[0]).toMatchObject({ start_date: '2026-10-28', due_date: '2026-11-10' });
    });
    expect(await within(screen.getByRole('region', { name: 'Website-Relaunch' })).findByRole('group', { name: new RegExp(`^${planned.key} `) })).toBeTruthy();
    router.dispose();
  });

  it('keeps the dates of a viewer and says why', async () => {
    asUser('u_theo');
    const router = renderAt('/views/v_roadmap');
    const row = await epic('WEB-30');
    act(() => row.focus());

    press('ArrowRight', { shiftKey: true });
    expect(currentToasts().at(-1)).toMatchObject({ tone: 'error', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.' });
    expect((await getWorkItem('WEB-30')).item.start_date).toBe('2026-10-01');
    router.dispose();
  });

  it('explains an empty timeline: only epics stand on it', async () => {
    const router = renderAt(`/projects/WEB?layout=timeline&filter=${filterOf([{ field: 'type', op: 'is', value: 't_task' }])}`);
    expect(await screen.findByText('Keine Epics in dieser Liste')).toBeTruthy();
    router.dispose();
  });
});
