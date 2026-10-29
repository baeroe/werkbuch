import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { routes } from './router';

// the item lists (Task 6) as a stand-in that counts its mounts: a new number means a fresh component with fresh state.
// Counted in an effect, which runs once per committed mount (render attempts React throws away do not count).
vi.mock('@/features/items/routes', async () => {
  const { useEffect, useState } = await import('react');
  let mounts = 0;
  return {
    default: function CountingItems({ preset }: { preset: string }) {
      const [mount, setMount] = useState(0);
      useEffect(() => setMount(++mounts), []);
      return <p>{`${preset} ${mount}`}</p>;
    },
  };
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
  // ScrollRestoration scrolls; jsdom has no layout to scroll
  window.scrollTo = vi.fn();
});

describe('routes', () => {
  it('mount the item list anew for every list, view and project, so no state leaks from one list to the next', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/my-items'] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('my 1')).toBeTruthy();

    const visits: [string, string][] = [
      ['/created', 'created 2'],
      ['/subscribed', 'subscribed 3'],
      ['/views/v_kira', 'view 4'],
      ['/views/v_prod_bugs', 'view 5'],
      ['/projects/WEB', 'project 6'],
      ['/projects/APP', 'project 7'],
    ];
    for (const [path, shown] of visits) {
      await act(() => router.navigate(path));
      expect(await screen.findByText(shown)).toBeTruthy();
    }
    router.dispose();
  });
});
