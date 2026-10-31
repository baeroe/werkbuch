/*
 * A fake REST API for tests of API functions, hooks and screens: `fetch` answers from a table of routes.
 *
 *   const api = mockApi({
 *     'GET /api/v1/projects': () => ({ body: { data: [web], links: {}, meta: { next_cursor: null, total: 1 } } }),
 *     'DELETE /api/v1/projects/p1': () => ({ status: 202 }),
 *   });
 *   …
 *   api.restore();
 *
 * A route is `<METHOD> <path>` without the query; it gets the parsed JSON body and the full URL. An answer without
 * `body` is empty (204 unless `status` says otherwise); a body is sent as JSON, as a problem document from 400 on. A call
 * no route knows rejects, so a test never waits on a request it did not expect.
 */

export type MockRoute = (body: unknown, url: URL) => { status?: number; body?: unknown };

export interface MockCall {
  method: string;
  /** Path and query, as the API layer asked for it: `/api/v1/projects?include_archived=1`. */
  url: string;
  body: unknown;
}

export interface MockApi {
  calls: MockCall[];
  restore(): void;
}

function answer({ status, body }: { status?: number; body?: unknown }): Response {
  if (body === undefined) {
    return new Response(null, { status: status ?? 204 });
  }
  const code = status ?? 200;

  return new Response(JSON.stringify(body), {
    status: code,
    headers: { 'Content-Type': code >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

export function mockApi(routes: Record<string, MockRoute>): MockApi {
  const original = globalThis.fetch;
  const calls: MockCall[] = [];

  globalThis.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), window.location.origin);
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: `${url.pathname}${url.search}`, body });

    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) {
      return Promise.reject(new Error(`mockApi: no route for ${method} ${url.pathname}`));
    }

    return Promise.resolve(answer(route(body, url)));
  };

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
