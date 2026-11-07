import { describe, expect, it } from 'vitest';
import { CookieJar, inertiaPage, liveFrame, xsrfToken } from './compose-smoke.mjs';

describe('compose smoke', () => {
  it('keeps cookies across answers and reads the XSRF token', () => {
    const jar = new CookieJar();

    jar.store([
      'XSRF-TOKEN=abc%3D%3D; expires=Sat, 07 Nov 2099 14:00:00 GMT; Max-Age=7200; path=/; samesite=lax',
      'werkbuch-session=first; path=/; httponly; samesite=lax',
    ]);
    jar.store(['werkbuch-session=second; path=/; httponly']);

    expect(jar.get('werkbuch-session')).toBe('second');
    expect(jar.header()).toBe('XSRF-TOKEN=abc%3D%3D; werkbuch-session=second');
    expect(xsrfToken(jar)).toBe('abc==');

    jar.store(['werkbuch-session=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/']);

    expect(jar.get('werkbuch-session')).toBeNull();
    expect(jar.header()).toBe('XSRF-TOKEN=abc%3D%3D');
    expect(() => xsrfToken(new CookieJar())).toThrow('XSRF-TOKEN');
  });

  it('reads the Inertia page from the script tag and from data-page', () => {
    const page = { component: 'Items/MyItems', props: { features: { live: { key: 'k', host: 'localhost', port: 7740, scheme: 'http' } } } };
    const json = JSON.stringify(page);
    const entities = json.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

    expect(inertiaPage(`<body><script data-page="app" type="application/json">${json}</script></body>`)).toEqual(page);
    expect(inertiaPage(`<body><div id="app" data-page="${entities}"></div></body>`)).toEqual(page);
    expect(inertiaPage('<div data-page="{&quot;a&quot;:&quot;&#039;&lt;&#x27;&quot;}"></div>')).toEqual({ a: "'<'" });
    expect(() => inertiaPage('<html><body>no app</body></html>')).toThrow('no Inertia page');
  });

  it('unpacks a pusher frame whose data is JSON text', () => {
    expect(liveFrame('{"event":"pusher:connection_established","data":"{\\"socket_id\\":\\"123.456\\",\\"activity_timeout\\":30}"}')).toEqual({
      event: 'pusher:connection_established',
      data: { socket_id: '123.456', activity_timeout: 30 },
    });
    expect(liveFrame('{"event":"live","channel":"private-project.01abc","data":"{\\"type\\":\\"work_item.created\\"}"}')).toEqual({
      event: 'live',
      channel: 'private-project.01abc',
      data: { type: 'work_item.created' },
    });
    expect(liveFrame('{"event":"pusher_internal:subscription_succeeded","channel":"private-project.01abc"}')).toEqual({
      event: 'pusher_internal:subscription_succeeded',
      channel: 'private-project.01abc',
      data: null,
    });
    expect(liveFrame('{"event":"pusher:error","data":{"code":4009,"message":"Connection is unauthorized"}}').data).toEqual({
      code: 4009,
      message: 'Connection is unauthorized',
    });
  });
});
