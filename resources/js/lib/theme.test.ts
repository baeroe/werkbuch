import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, applyTheme, readTheme } from '@/lib/theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.removeAttribute('data-theme-switching');
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads system for nothing, junk and blocked storage', () => {
    expect(readTheme()).toBe('system');
    localStorage.setItem(THEME_KEY, 'sepia');
    expect(readTheme()).toBe('system');
    localStorage.setItem(THEME_KEY, 'dark');
    expect(readTheme()).toBe('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTheme()).toBe('system');
  });

  it('sets data-theme for light and dark, removes it for system, and survives blocked storage', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('lifts the switching flag after two frames', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(false);
  });
});
