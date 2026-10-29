import { describe, expect, it } from 'vitest';
import { routeErrorText } from './PageStates';

describe('routeErrorText', () => {
  it('names a screen whose code did not load in German, whichever browser reports it', () => {
    const notLoaded = 'Der Programmcode dieser Ansicht ließ sich nicht laden, etwa nach einem Update oder ohne Verbindung.';
    // Chrome, Safari, Firefox
    expect(routeErrorText(new TypeError('Failed to fetch dynamically imported module: http://localhost:5174/src/features/inbox/index.tsx'))).toBe(notLoaded);
    expect(routeErrorText(new TypeError('Importing a module script failed.'))).toBe(notLoaded);
    expect(routeErrorText(new TypeError('error loading dynamically imported module: http://localhost:5174/src/features/wiki/index.tsx'))).toBe(notLoaded);
  });

  it('names a screen that crashed in German, without the English message of the error', () => {
    expect(routeErrorText(new TypeError("Cannot read properties of undefined (reading 'title')"))).toBe('In dieser Ansicht ist ein unerwarteter Fehler aufgetreten.');
    expect(routeErrorText('kaputt')).toBe('In dieser Ansicht ist ein unerwarteter Fehler aufgetreten.');
  });
});
