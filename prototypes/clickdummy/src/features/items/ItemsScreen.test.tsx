import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
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
});
