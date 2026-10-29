import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { closePeekOnNavigation, PeekHost } from './PeekHost';

/** The page with a filter field in its main region, and the host beside it. */
function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <main id="main">
          <input aria-label="Filter" />
        </main>
        <PeekHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A phone (below md) or a wider screen: what `matchMedia('(min-width: 48rem)')` answers. */
function screenWidth(wide: boolean) {
  window.matchMedia = vi.fn((media: string) => ({
    matches: wide,
    media,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('PeekHost', () => {
  it('the first Escape in a field leaves the field for the panel, the second closes the preview', async () => {
    screenWidth(true);
    renderHost();
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    const panel = await screen.findByRole('complementary', { name: 'Vorschau' });
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    filter.focus();

    fireEvent.keyDown(filter, { key: 'Escape' });
    // the draft in the field survives: the preview stays, only the focus moved
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    expect(document.activeElement).toBe(panel);

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('below md the preview is modal: the page behind it is inert and the panel has the focus', async () => {
    screenWidth(false);
    renderHost();
    const main = document.getElementById('main')!;

    act(() => useUiStore.getState().openPeek('wi_web_47'));
    const panel = await screen.findByRole('complementary', { name: 'Vorschau' });
    expect(main.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(panel);

    act(() => useUiStore.getState().openPeek(null));
    expect(main.hasAttribute('inert')).toBe(false);
  });

  it('from md on the list beside the preview stays usable and keeps the focus', async () => {
    screenWidth(true);
    renderHost();
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    filter.focus();

    act(() => useUiStore.getState().openPeek('wi_web_47'));
    await screen.findByRole('complementary', { name: 'Vorschau' });

    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(filter);
  });
});

describe('closePeekOnNavigation', () => {
  it('a new route closes the preview, but not one opened along with the navigation or on the same route', async () => {
    const router = createMemoryRouter(
      [
        { path: '/inbox', element: null },
        { path: '/my-items', element: null },
        { path: '/projects/:identifier', element: null },
      ],
      { initialEntries: ['/inbox'] },
    );
    const stop = closePeekOnNavigation(router);
    try {
      useUiStore.getState().openPeek('wi_web_47');
      await router.navigate('/my-items');
      expect(useUiStore.getState().peekItemId).toBeNull();

      // navigate(x); openPeek(id): the preview opens on the new screen
      const navigation = router.navigate('/projects/WEB');
      useUiStore.getState().openPeek('wi_web_47');
      await navigation;
      expect(useUiStore.getState().peekItemId).toBe('wi_web_47');

      // only the search changes (e.g. the layout): the same screen, the preview stays
      await router.navigate('/projects/WEB?layout=board');
      expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    } finally {
      stop();
      router.dispose();
    }
  });
});
