import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCommands } from '@/lib/commands';
import { isWide } from '@/lib/media';
import { resetApi } from '@/test/api';
import { useShellBindings } from './bindings';

function Bindings() {
  useShellBindings();
  return null;
}

/** What `matchMedia('(min-width: 48rem)')` answers: a phone or a wider screen. */
const screenWidth = (wide: boolean) => {
  window.matchMedia = vi.fn((media: string) => ({
    matches: wide,
    media,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => Reflect.deleteProperty(window, 'matchMedia'));

describe('the md breakpoint', () => {
  it('counts a screen without matchMedia as wide, and otherwise asks for 48rem', () => {
    expect(isWide()).toBe(true);
    screenWidth(false);
    expect(isWide()).toBe(false);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)');
    screenWidth(true);
    expect(isWide()).toBe(true);
  });

  it('offers "Seitenleiste einklappen" on wide screens only, with the same default as the preview', () => {
    resetApi();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bindings />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const sidebar = () => listCommands().find((command) => command.id === 'shell.sidebar');
    try {
      // jsdom has no matchMedia: wide, as PeekHost counts it
      expect(sidebar()?.when?.()).toBe(true);
      screenWidth(false);
      expect(sidebar()?.when?.()).toBe(false);
    } finally {
      view.unmount();
    }
  });
});
