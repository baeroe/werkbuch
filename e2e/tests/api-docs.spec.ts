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
  const response = await page.goto('/api/docs');
  expect(response!.status()).toBe(200);
  expect(response!.headers()['content-security-policy']).toContain("default-src 'none'");

  // the document is loaded from this origin and Stoplight renders it
  const spec = await page.waitForResponse((r) => r.url().endsWith('/api/openapi.json'));
  expect(spec.status()).toBe(200);
  await expect(page.locator('elements-api')).toBeVisible();
  await expect(page.getByText('werkbuch API').first()).toBeVisible({ timeout: 30_000 });

  violations.push(...((await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp)) ?? []));
  expect(violations).toEqual([]);
});

test('sends the CSRF token of the session to this origin only', async ({ page }) => {
  // a page of the app (no CSP), the real helper script on top of it
  await page.goto('/my-items');
  await page.waitForLoadState('networkidle');

  const seen: { url: string; token: string | undefined }[] = [];
  await page.route(/other\.example\.test|\/api\/v1\/me$/, async (route) => {
    const request = route.request();
    seen.push({ url: request.url(), token: await request.headerValue('x-xsrf-token') ?? undefined });
    await route.fulfill({ status: 200, body: '{}', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' } });
  });
  await page.addScriptTag({ url: '/api-docs.js' });

  // the cookie is read in the page, right before the calls: the app renews it with its own requests
  const token = await page.evaluate(async () => {
    const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('XSRF-TOKEN='));
    await fetch('/api/v1/me', { method: 'GET' });
    await fetch(new Request('/api/v1/me'));
    await fetch('https://other.example.test/x', { method: 'POST' });
    return cookie === undefined ? null : decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
  });
  expect(token, 'the session has an XSRF cookie').not.toBeNull();

  const own = seen.filter((s) => s.url.endsWith('/api/v1/me'));
  const foreign = seen.filter((s) => s.url.includes('other.example.test'));
  expect(own).toHaveLength(2);
  for (const s of own) expect(s.token).toBe(token);
  expect(foreign.length).toBeGreaterThan(0);
  for (const s of foreign) expect(s.token).toBeUndefined();
});
