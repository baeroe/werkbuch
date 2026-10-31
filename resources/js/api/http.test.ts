import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { API_BASE, del, get, getPage, one, patch, post, put, setSignedIn, toQueryString, upload } from './http';

const fetchMock = vi.fn();
const reload = vi.fn();

function json(status: number, body: unknown, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
}

function problem(status: number, body: Record<string, unknown>) {
  return json(status, { type: `urn:werkbuch:problem:${String(body.reason)}`, title: 'x', status, ...body }, 'application/problem+json');
}

/** The error a call ends with. */
async function failure(call: Promise<unknown>): Promise<ApiError> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);

  return error as ApiError;
}

function clearCookies() {
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

beforeEach(() => {
  fetchMock.mockReset();
  reload.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { ...window.location, reload });
  setSignedIn(true);
  clearCookies();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
});

describe('toQueryString', () => {
  it('builds query strings with arrays and one level of objects, skipping empties', () => {
    expect(
      toQueryString({ cursor: null, per_page: 50, ids: ['a', 'b'], filter: { project: 'WEB', assignee: 'me', empty: undefined }, open: true }),
    ).toBe('?per_page=50&ids%5B%5D=a&ids%5B%5D=b&filter%5Bproject%5D=WEB&filter%5Bassignee%5D=me&open=1');
    expect(toQueryString({})).toBe('');
  });

  it('writes false as 0 and escapes values', () => {
    expect(toQueryString({ archived: false, q: 'a b&c', gone: undefined })).toBe('?archived=0&q=a%20b%26c');
    expect(toQueryString({ cursor: null })).toBe('');
  });
});

describe('requests', () => {
  it('sends JSON with session cookie and CSRF header, and parses the answer', async () => {
    document.cookie = 'XSRF-TOKEN=abc%3D';
    fetchMock.mockResolvedValue(json(201, { id: 'x' }));

    await expect(post('/work-items', { title: 'A' })).resolves.toEqual({ id: 'x' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/work-items',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: '{"title":"A"}',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': 'abc=',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      }),
    );
  });

  it('sends no token before there is one, and no content type without a body', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [], next_cursor: null, total: 0 }));

    await get('/work-items', { filter: { project: 'WEB' }, per_page: 10 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_BASE}/work-items?filter%5Bproject%5D=WEB&per_page=10`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('X-XSRF-TOKEN');
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it.each([
    ['PATCH', patch],
    ['PUT', put],
    ['DELETE', del],
  ] as const)('sends %s with its body', async (method, call) => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));

    await call('/work-items/1', { title: 'B' });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method, body: '{"title":"B"}' });
  });

  it('answers undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(del('/work-items/1')).resolves.toBeUndefined();
  });

  it('answers undefined for an empty body', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));

    await expect(post('/work-items/1/archive')).resolves.toBeUndefined();
  });

  it('turns a 2xx answer that is no JSON into an http_error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Proxy</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));

    const error = await failure(get('/work-items'));

    expect(error.status).toBe(200);
    expect(error.reason).toBe('http_error');
  });

  it('unwraps data of a single resource', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { id: 'p1', name: 'Website' } }));

    await expect(one(get<{ data: { id: string; name: string } }>('/projects/p1'))).resolves.toEqual({ id: 'p1', name: 'Website' });
  });

  it('hands the abort signal to fetch', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(json(200, {}));

    await get('/work-items', {}, { signal: controller.signal });

    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });
});

describe('errors', () => {
  it('turns a problem document into an ApiError with the conflicting state', async () => {
    const current = { id: 'wi_1', title: 'Server' };
    fetchMock.mockResolvedValue(
      problem(409, { reason: 'description_conflict', detail: 'Die Beschreibung wurde inzwischen geändert.', current }),
    );

    const error = await failure(patch('/work-items/wi_1', {}));

    expect(error.status).toBe(409);
    expect(error.reason).toBe('description_conflict');
    expect(error.message).toBe('Die Beschreibung wurde inzwischen geändert.');
    expect(error.current).toEqual(current);
    expect(error.extensions).toEqual({ current });
  });

  it('keeps the field errors of a 422 by path', async () => {
    fetchMock.mockResolvedValue(
      problem(422, { reason: 'validation_failed', detail: 'Die Eingabe ist nicht gültig.', errors: { title: ['Pflichtfeld'], 'values.customer': ['Unbekannt'] } }),
    );

    const error = await failure(post('/work-items', {}));

    expect(error.status).toBe(422);
    expect(error.errors).toEqual({ title: ['Pflichtfeld'], 'values.customer': ['Unbekannt'] });
    expect(error.extensions).toEqual({});
  });

  it('takes the message of a 404 from the reason, since it carries no detail', async () => {
    fetchMock.mockResolvedValue(problem(404, { reason: 'not_found' }));

    const error = await failure(get('/work-items/nope'));

    expect(error.message).toBe('Das Item gibt es nicht oder du darfst es nicht sehen.');
  });

  it('knows an answer without JSON as http_error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));

    const error = await failure(get('/work-items'));

    expect(error.status).toBe(502);
    expect(error.reason).toBe('http_error');
  });

  it('knows a broken JSON body, and one that is no object, as http_error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{', { status: 500, headers: { 'Content-Type': 'application/json' } }));
    fetchMock.mockResolvedValueOnce(json(500, ['x']));

    expect((await failure(get('/a'))).reason).toBe('http_error');
    expect((await failure(get('/b'))).reason).toBe('http_error');
  });

  it('ignores members of a problem document that have the wrong shape', async () => {
    fetchMock.mockResolvedValue(json(400, { reason: 7, detail: 7, errors: 'x' }, 'application/problem+json'));

    const error = await failure(get('/work-items'));

    expect(error.reason).toBe('http_error');
    expect(error.errors).toBeUndefined();
    expect(error.message).toBe('Die Anfrage wurde abgelehnt.');
  });

  it('lets a network failure through unchanged', async () => {
    const down = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(down);

    await expect(get('/work-items')).rejects.toBe(down);
  });

  it('knows a 401 without a problem document as unauthenticated', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));

    expect((await failure(get('/work-items'))).reason).toBe('unauthenticated');
  });

  it('reloads on a 401 of a signed-in page, so the server can send the person to the sign-in', async () => {
    fetchMock.mockResolvedValue(problem(401, { reason: 'unauthenticated' }));

    const error = await failure(get('/work-items'));

    expect(error.reason).toBe('unauthenticated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on a 401 while nobody is signed in: a guest page would reload for ever', async () => {
    setSignedIn(false);
    fetchMock.mockResolvedValue(problem(401, { reason: 'unauthenticated' }));

    const error = await failure(get('/organization'));

    expect(error.status).toBe(401);
    expect(error.reason).toBe('unauthenticated');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('getPage', () => {
  it('turns a Laravel list into a page with the cursor and the total', async () => {
    fetchMock.mockResolvedValue(
      json(200, { data: [{ id: 'a' }], links: {}, meta: { path: '/api/v1/users', per_page: 1, next_cursor: 'c2', prev_cursor: null, total: 3 } }),
    );

    await expect(getPage<{ id: string }>('/users', { per_page: 1 })).resolves.toEqual({ items: [{ id: 'a' }], next_cursor: 'c2', total: 3 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/users?per_page=1');
  });

  it('counts the items when the list brings no total, and has no next cursor without one', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [{ id: 'a' }, { id: 'b' }], links: {}, meta: {} }));

    await expect(getPage('/favorites')).resolves.toEqual({ items: [{ id: 'a' }, { id: 'b' }], next_cursor: null, total: 2 });
  });

  it('hands the abort signal to fetch', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(json(200, { data: [], links: {}, meta: { next_cursor: null, total: 0 } }));

    await getPage('/users', {}, { signal: controller.signal });

    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });
});

describe('CSRF', () => {
  it('fetches a new token cookie on 419 and sends the call once more', async () => {
    fetchMock
      .mockResolvedValueOnce(problem(419, { reason: 'csrf_token_mismatch' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(200, { id: 'x' }));

    await expect(post('/work-items', { title: 'A' })).resolves.toEqual({ id: 'x' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/work-items', '/sanctum/csrf-cookie', '/api/v1/work-items']);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('gives up after a second 419', async () => {
    fetchMock
      .mockResolvedValueOnce(problem(419, { reason: 'csrf_token_mismatch' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('expired', { status: 419, headers: { 'Content-Type': 'text/plain' } }));

    const error = await failure(post('/work-items', {}));

    expect(error.status).toBe(419);
    expect(error.reason).toBe('csrf_token_mismatch');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

/** Just enough of XMLHttpRequest for `upload`: the test drives the events. */
class FakeXhr {
  static last: FakeXhr;

  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  withCredentials = false;
  status = 0;
  responseText = '';
  contentType: string | null = 'application/json';
  headers: Record<string, string> = {};
  opened: [string, string] | null = null;
  sent: FormData | null = null;
  abort = vi.fn(() => this.onabort?.());

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string) {
    this.opened = [method, url];
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  getResponseHeader() {
    return this.contentType;
  }

  send(form: FormData) {
    this.sent = form;
  }

  answer(status: number, text: string, contentType: string | null = 'application/json') {
    this.status = status;
    this.responseText = text;
    this.contentType = contentType;
    this.onload?.();
  }
}

describe('upload', () => {
  const form = () => {
    const data = new FormData();
    data.append('file', new Blob(['x']), 'x.txt');

    return data;
  };

  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  it('posts the form with cookie and token, reports the progress and resolves with the JSON', async () => {
    document.cookie = 'XSRF-TOKEN=abc%3D';
    const onProgress = vi.fn();
    const data = form();

    const result = upload<{ id: string }>('/attachments', data, onProgress);
    const xhr = FakeXhr.last;
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 0, total: 0 });
    xhr.answer(201, '{"id":"a1"}');

    await expect(result).resolves.toEqual({ id: 'a1' });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(xhr.opened).toEqual(['POST', '/api/v1/attachments']);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers).toMatchObject({ Accept: 'application/json', 'X-XSRF-TOKEN': 'abc=', 'X-Requested-With': 'XMLHttpRequest' });
    expect(xhr.headers).not.toHaveProperty('Content-Type');
    expect(xhr.sent).toBe(data);
  });

  it('needs no progress callback', async () => {
    const result = upload('/attachments', form());
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 2 });
    FakeXhr.last.answer(204, '');

    await expect(result).resolves.toBeUndefined();
  });

  it('turns a 413 problem document into an ApiError', async () => {
    const result = upload('/attachments', form());
    FakeXhr.last.answer(413, JSON.stringify({ reason: 'payload_too_large', detail: 'Die Datei ist zu groß.' }), 'application/problem+json');

    const error = await failure(result);

    expect(error.status).toBe(413);
    expect(error.reason).toBe('payload_too_large');
    expect(error.message).toBe('Die Datei ist zu groß.');
  });

  it('knows an answer without a content type as http_error', async () => {
    const result = upload('/attachments', form());
    FakeXhr.last.answer(502, 'Bad Gateway', null);

    expect((await failure(result)).reason).toBe('http_error');
  });

  it('refreshes the token on 419 and sends the form once more', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const result = upload('/attachments', form());
    const first = FakeXhr.last;
    first.answer(419, '{"reason":"csrf_token_mismatch"}');
    await vi.waitFor(() => expect(FakeXhr.last).not.toBe(first));
    FakeXhr.last.answer(201, '{"id":"a2"}');

    await expect(result).resolves.toEqual({ id: 'a2' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/sanctum/csrf-cookie');
  });

  it('lets a network failure through as a TypeError', async () => {
    const result = upload('/attachments', form());
    FakeXhr.last.onerror!();

    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  it('calls xhr.abort() when the signal fires, and rejects with an AbortError', async () => {
    const controller = new AbortController();

    const result = upload('/attachments', form(), undefined, { signal: controller.signal });
    controller.abort();

    expect(FakeXhr.last.abort).toHaveBeenCalledTimes(1);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with the reason of the signal when it is aborted, and does not send, when it has already fired', async () => {
    const reason = new Error('Abgebrochen');
    const controller = new AbortController();
    controller.abort(reason);
    const before = FakeXhr.last;

    await expect(upload('/attachments', form(), undefined, { signal: controller.signal })).rejects.toBe(reason);

    expect(FakeXhr.last).toBe(before);
  });

  it('stops listening to the signal once the answer is in', async () => {
    const controller = new AbortController();

    const result = upload('/attachments', form(), undefined, { signal: controller.signal });
    FakeXhr.last.answer(200, '{}');
    await result;
    controller.abort();

    expect(FakeXhr.last.abort).not.toHaveBeenCalled();
  });

  it('stops listening to the signal after a network failure', async () => {
    const controller = new AbortController();

    const result = upload('/attachments', form(), undefined, { signal: controller.signal });
    FakeXhr.last.onerror!();
    await result.catch(() => undefined);
    controller.abort();

    expect(FakeXhr.last.abort).not.toHaveBeenCalled();
  });
});
