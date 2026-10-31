import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
});

describe('reloadPage', () => {
  it('is not reloading until the app reloads the page, and then it is', async () => {
    const reload = vi.fn();
    const { isReloading, reloadPage } = await import('./pageReload');

    expect(isReloading()).toBe(false);
    reloadPage(reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(isReloading()).toBe(true);
  });
});
