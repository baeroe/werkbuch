import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWide, useIsWide } from './media';

/** A matchMedia whose answer the test changes by hand and announces with `change`. */
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    listeners,
    resize(matches: boolean) {
      query.matches = matches;
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('media', () => {
  it('counts the screen as wide without matchMedia, as in jsdom', () => {
    expect(isWide()).toBe(true);
    const { result, unmount } = renderHook(() => useIsWide());
    expect(result.current).toBe(true);
    unmount();
  });

  it('renders wide on the server, where nothing can be asked', () => {
    const Probe = () => createElement('i', null, String(useIsWide()));
    expect(renderToString(createElement(Probe))).toContain('true');
  });

  it('asks matchMedia for the md breakpoint', () => {
    const media = fakeMatchMedia(false);
    expect(isWide()).toBe(false);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)');
    media.resize(true);
    expect(isWide()).toBe(true);
  });

  it('follows the change event and lets go of it on unmount', () => {
    const media = fakeMatchMedia(true);
    const { result, unmount } = renderHook(() => useIsWide());
    expect(result.current).toBe(true);

    act(() => media.resize(false));
    expect(result.current).toBe(false);
    act(() => media.resize(true));
    expect(result.current).toBe(true);

    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
