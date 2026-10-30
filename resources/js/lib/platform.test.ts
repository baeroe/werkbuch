import { afterEach, describe, expect, it } from 'vitest';
import { isMac } from './platform';

const setUserAgentData = (platform: string | undefined) =>
  Object.defineProperty(window.navigator, 'userAgentData', { value: platform === undefined ? undefined : { platform }, configurable: true });
const setPlatform = (platform: string) => Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgentData');
  Reflect.deleteProperty(window.navigator, 'platform');
});

describe('isMac', () => {
  it('reads the platform from userAgentData first', () => {
    setUserAgentData('macOS');
    setPlatform('Win32');
    expect(isMac()).toBe(true);

    setUserAgentData('Windows');
    setPlatform('MacIntel');
    expect(isMac()).toBe(false);
  });

  it('falls back to navigator.platform, which also names iPhone and iPad', () => {
    setPlatform('MacIntel');
    expect(isMac()).toBe(true);
    setPlatform('iPhone');
    expect(isMac()).toBe(true);
    setPlatform('Win32');
    expect(isMac()).toBe(false);
    setPlatform('');
    expect(isMac()).toBe(false);
  });

  it('is false without a navigator', () => {
    const navigator = window.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    try {
      expect(isMac()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
    }
  });
});
