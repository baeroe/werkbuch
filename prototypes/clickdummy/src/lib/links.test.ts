import { afterEach, describe, expect, it, vi } from 'vitest';
import { appUrl, hrefOf, instanceOrigin } from './links';

afterEach(() => vi.unstubAllEnvs());

describe('links of the app', () => {
  it('point at the path itself with the browser router', () => {
    expect(hrefOf('/items/WEB-47')).toBe('/items/WEB-47');
    expect(appUrl('/items/WEB-47')).toBe(`${window.location.origin}/items/WEB-47`);
  });

  it('carry the path in the hash in the review build (VITE_ROUTER=hash), on the page the app runs on', () => {
    vi.stubEnv('VITE_ROUTER', 'hash');
    window.history.replaceState(null, '', '/artifact/index.html?v=2#/inbox');

    expect(hrefOf('/items/WEB-47')).toBe('#/items/WEB-47');
    expect(appUrl('/invitations/abc')).toBe(`${window.location.origin}/artifact/index.html?v=2#/invitations/abc`);
    // the review build is no instance: the snippets show the demo address
    expect(instanceOrigin()).toBe('https://werkbuch.example.com');
    window.history.replaceState(null, '', '/');
  });
});

describe('instanceOrigin', () => {
  it('is the origin of the page, or a made-up one in a frame without an origin of its own', () => {
    expect(instanceOrigin()).toBe(window.location.origin);
    expect(instanceOrigin('null')).toBe('https://werkbuch.example.com');
  });
});
