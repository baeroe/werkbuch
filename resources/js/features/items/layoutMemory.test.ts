import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drafts } from '@/lib/drafts';
import { layoutKey, readLayout, useRememberedLayout, writeLayout } from './layoutMemory';

afterEach(() => {
  vi.restoreAllMocks();
  drafts.clear();
});

describe('the remembered layout of a list (WEBU-68)', () => {
  it('keeps a layout per person and list in the storage', () => {
    const key = layoutKey('u_lene', 'project:p_web');
    expect(key).toBe('werkbuch.layout.u_lene.project:p_web');
    expect(readLayout(key)).toBeNull();

    writeLayout(key, 'board');
    expect(readLayout(key)).toBe('board');
    expect(window.localStorage.getItem(key)).toBe('board');
    expect(readLayout(layoutKey('u_mara', 'project:p_web'))).toBeNull();
  });

  it('reads nothing it does not know as a layout', () => {
    window.localStorage.setItem(layoutKey('u_lene', 'my'), 'gallery');
    expect(readLayout(layoutKey('u_lene', 'my'))).toBeNull();
  });

  it('keeps the layout for the visit when the storage fails, and forgets it with the person', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const key = layoutKey('u_lene', 'created');
    writeLayout(key, 'table');
    expect(readLayout(key)).toBe('table');

    drafts.clear();
    expect(readLayout(key)).toBeNull();
  });

  it('tells a list when its layout changes; a list without a key reads none', () => {
    const key = layoutKey('u_lene', 'subscribed');
    const { result } = renderHook(() => useRememberedLayout(key));
    expect(result.current).toBeNull();
    act(() => writeLayout(key, 'timeline'));
    expect(result.current).toBe('timeline');
    // the same again tells nobody
    act(() => writeLayout(key, 'timeline'));
    expect(result.current).toBe('timeline');
    expect(renderHook(() => useRememberedLayout(null)).result.current).toBeNull();
  });
});
