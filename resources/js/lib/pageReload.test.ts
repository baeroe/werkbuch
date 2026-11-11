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

  it('is no reload any more when the person stays on the page after the browser asked', async () => {
    vi.useFakeTimers();
    const { isReloading, reloadPage } = await import('./pageReload');

    reloadPage(vi.fn());
    window.dispatchEvent(new Event('beforeunload'));
    expect(isReloading()).toBe(true); // the guards still read it while the other listeners run

    vi.runAllTimers();
    expect(isReloading()).toBe(false);
    vi.useRealTimers();
  });

  it('is no reload when the reload could not start', async () => {
    const { isReloading, reloadPage } = await import('./pageReload');

    expect(() =>
      reloadPage(() => {
        throw new Error('blocked');
      }),
    ).toThrow('blocked');
    expect(isReloading()).toBe(false);
  });
});
