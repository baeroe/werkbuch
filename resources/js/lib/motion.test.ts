import { afterEach, describe, expect, it, vi } from 'vitest';
import { reducedMotion, springEasing } from './motion';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--ease-spring');
});

describe('motion', () => {
  it('springs with the curve of the design where the browser takes it, else with a plain one', () => {
    const fallback = 'cubic-bezier(0.34, 1.3, 0.64, 1)';
    // jsdom knows neither the tokens nor Web Animations
    expect(springEasing()).toBe(fallback);

    document.documentElement.style.setProperty('--ease-spring', 'linear(0, 1.2, 1)');
    vi.stubGlobal(
      'KeyframeEffect',
      class {
        constructor(_target: unknown, _frames: unknown, options: { easing: string }) {
          if (options.easing.startsWith('linear(')) throw new TypeError('unknown easing');
        }
      },
    );
    expect(springEasing()).toBe(fallback);
    document.documentElement.style.setProperty('--ease-spring', 'cubic-bezier(0.3, 1.2, 0.6, 1)');
    expect(springEasing()).toBe('cubic-bezier(0.3, 1.2, 0.6, 1)');
  });

  it('knows when the person asked for less motion', () => {
    expect(reducedMotion()).toBe(false);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }));
    expect(reducedMotion()).toBe(true);
  });
});
