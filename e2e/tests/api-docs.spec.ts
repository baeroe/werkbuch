import { expect, test } from '../fixtures';

// The public API docs (GET /api/docs, spec 8.2): Stoplight Elements from this origin, under a strict CSP (K6), and the
// helper public/api-docs.js that gives "Try it" the CSRF token of the session, for this origin only.

test('renders the api docs without a console error or a CSP violation', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${event.violatedDirective} ${event.blockedURI}`];
    });
  });
  // registered before the navigation: Stoplight fetches the document at start-up
  const specResponse = page.waitForResponse((r) => r.url().endsWith('/api/openapi.json'));
  const response = await page.goto('/api/docs');
  expect(response!.status()).toBe(200);
  expect(response!.headers()['content-security-policy']).toContain("default-src 'none'");

  // the document is loaded from this origin and Stoplight renders it
  const spec = await specResponse;
  expect(spec.status()).toBe(200);
  await expect(page.locator('elements-api')).toBeVisible();
  await expect(page.getByText('werkbuch API').first()).toBeVisible({ timeout: 30_000 });

  violations.push(...((await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp)) ?? []));
  expect(violations).toEqual([]);
});

test('sends the CSRF token of the session to this origin only', async ({ page }) => {
  // a page without the app's JS (so nothing renews the cookie in the background), the real helper script on top of it
  await page.goto('/api/openapi.json');
  const mark = `csrf-${Date.now()}`;
  const own = new RegExp(`/api/v1/me\\?${mark}$`);
  const samePortless = new URL(page.url());
  const otherPort = `${samePortless.protocol}//${samePortless.hostname}:${Number(samePortless.port || (samePortless.protocol === 'https:' ? 443 : 80)) + 1}`;

  const seen: { url: string; token: string | undefined }[] = [];
  const reply = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    seen.push({ url: request.url(), token: (await request.headerValue('x-xsrf-token')) ?? undefined });
    await route.fulfill({ status: 200, body: '{}', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' } });
  };
  await page.route(own, reply);
  await page.route(/other\.example\.test/, reply);
  await page.route(`${otherPort}/**`, reply);
  await page.addScriptTag({ url: '/api-docs.js' });

  // the cookie is read in the page, right before the calls
  const token = await page.evaluate(
    async ({ mark, otherPort }) => {
      const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('XSRF-TOKEN='));
      await fetch(`/api/v1/me?${mark}`, { method: 'GET' });
      await fetch(new Request(`/api/v1/me?${mark}`));
      await fetch('https://other.example.test/x', { method: 'POST' });
      await fetch(`${otherPort}/x`, { method: 'POST' }).catch(() => undefined);
      return cookie === undefined ? null : decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
    },
    { mark, otherPort },
  );
  expect(token, 'the session has an XSRF cookie').not.toBeNull();

  const mine = seen.filter((s) => own.test(s.url));
  const foreign = seen.filter((s) => !own.test(s.url));
  expect(mine).toHaveLength(2);
  for (const s of mine) expect(s.token).toBe(token);
  expect(foreign.length).toBeGreaterThan(0);
  for (const s of foreign) expect(s.token).toBeUndefined();
});
