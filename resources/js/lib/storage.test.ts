import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './storage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('safeStorage', () => {
  it('stores, reads and removes like localStorage', () => {
    expect(safeStorage.getItem('k')).toBeNull();
    safeStorage.setItem('k', 'v');
    expect(safeStorage.getItem('k')).toBe('v');
    safeStorage.removeItem('k');
    expect(safeStorage.getItem('k')).toBeNull();
  });

  it('never throws when the browser refuses storage', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
    }

    expect(safeStorage.getItem('k')).toBeNull();
    expect(() => safeStorage.setItem('k', 'v')).not.toThrow();
    expect(() => safeStorage.removeItem('k')).not.toThrow();
  });
});
