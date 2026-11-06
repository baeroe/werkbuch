/*
 * The HTTP layer of the REST API (`/api/v1`): the session cookie and the CSRF token go with every call, and a Problem
 * Details answer (RFC 9457) becomes the `ApiError` of `./client`, so a screen handles one kind of error whatever the
 * transport. A network failure (`fetch` throws) passes through unchanged: it is no answer of the API.
 *
 * A single resource comes wrapped in `{data}` like a list (P27): the API functions unwrap it with `one()`, a list
 * becomes a `Page` with `getPage()`. Answers that are no resource (`{token, plain_text}`, 204) pass through as they are.
 * While the tab has a live connection, every call names its socket (`X-Socket-ID`, `setSocketId`).
 *
 * A read (`GET`, `readPost`) that the rate limit refuses (429) waits once, as long as `Retry-After` says but at most
 * `RETRY_AFTER_MAX_MS`, and asks again (K9): a burst of live updates reloads every query of a screen at once. A call that
 * writes never goes twice by itself.
 */

import { ApiError, type Page } from './client';

export const API_BASE = '/api/v1';

const CSRF_COOKIE_URL = '/sanctum/csrf-cookie';

/** The longest a read waits after a 429 before it asks once more; a longer `Retry-After` is cut to this. */
export const RETRY_AFTER_MAX_MS = 10_000;

/** The wait after a 429 whose `Retry-After` is missing or no number of seconds. */
const RETRY_AFTER_FALLBACK_MS = 1000;

/** The members of a problem document that `ApiError` has fields for; every other member is an extension. */
const PROBLEM_MEMBERS = ['type', 'title', 'status', 'detail', 'reason', 'errors'];

type Scalar = string | number | boolean | null | undefined;

export type QueryValue = Scalar | readonly (string | number)[] | Record<string, Scalar>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  signal?: AbortSignal;
}

interface Raw {
  status: number;
  contentType: string;
  text: string;
  retryAfter?: string | null;
}

function scalarText(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
}

/** `?a=1&ids[]=x&filter[project]=WEB`: arrays as `key[]`, one level of objects as `key[name]`, no empty values. */
export function toQueryString(query: Query): string {
  const parts: string[] = [];
  const add = (key: string, value: Scalar) => {
    if (value !== null && value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(scalarText(value))}`);
    }
  };

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => add(`${key}[]`, entry));
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([name, entry]) => add(`${key}[${name}]`, entry as Scalar));
    } else {
      add(key, value as Scalar);
    }
  }

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** The CSRF token Laravel keeps in the `XSRF-TOKEN` cookie, or null before the first answer. */
function csrfToken(): string | null {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith('XSRF-TOKEN='));

  return entry === undefined ? null : decodeURIComponent(entry.slice('XSRF-TOKEN='.length));
}

/** The socket of this tab's live connection (Reverb), or null while there is none. */
let socketId: string | null = null;

/**
 * Tells the HTTP layer the socket of this tab's live connection: every call sends it as `X-Socket-ID`, so the change it
 * makes comes back to every other tab but not to this one (A282), which shows it already.
 */
export function setSocketId(id: string | null): void {
  socketId = id;
}

function baseHeaders(): Record<string, string> {
  const token = csrfToken();

  return {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(token === null ? {} : { 'X-XSRF-TOKEN': token }),
    ...(socketId === null ? {} : { 'X-Socket-ID': socketId }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A reason for an answer that is no problem document, e.g. the HTML of a proxy. */
function fallbackReason(status: number): string {
  if (status === 419) return 'csrf_token_mismatch';
  if (status === 401) return 'unauthenticated';
  // a web server in front refuses a large body with its own page, not a problem document
  if (status === 413) return 'payload_too_large';

  return 'http_error';
}

function toApiError({ status, contentType, text }: Raw): ApiError {
  let body: unknown;

  if (contentType.includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      // a broken body is as good as none
    }
  }

  if (!isObject(body)) {
    return new ApiError({ status, reason: fallbackReason(status) });
  }

  return new ApiError({
    status,
    reason: typeof body.reason === 'string' ? body.reason : fallbackReason(status),
    detail: typeof body.detail === 'string' ? body.detail : undefined,
    errors: isObject(body.errors) ? (body.errors as Record<string, string[]>) : undefined,
    extensions: Object.fromEntries(Object.entries(body).filter(([member]) => !PROBLEM_MEMBERS.includes(member))),
  });
}

/** Whether somebody is signed in on this page; `app.tsx` keeps it up to date from the shared props. */
let signedIn = false;

/**
 * Tells the HTTP layer whether the page belongs to a signed-in person. Only then does a 401 reload the page: the
 * session ended, and the server sends the person to the sign-in. A guest page that reloaded on a 401 would do so for ever.
 */
export function setSignedIn(value: boolean): void {
  signedIn = value;
}

function settle<T>(raw: Raw): T {
  if (raw.status === 401 && signedIn) {
    window.location.reload();
  }
  if (raw.status < 200 || raw.status >= 300) {
    throw toApiError(raw);
  }
  if (raw.status === 204 || raw.text === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(raw.text) as T;
  } catch {
    // a success without JSON is no answer of the API, e.g. the HTML of a captive portal or a proxy
    throw new ApiError({ status: raw.status, reason: 'http_error' });
  }
}

/** How long to wait after a 429: the seconds of `Retry-After`, at most `RETRY_AFTER_MAX_MS`. */
function retryDelay(header: string | null | undefined): number {
  const seconds = header === null || header === undefined || header.trim() === '' ? Number.NaN : Number(header);

  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, RETRY_AFTER_MAX_MS) : RETRY_AFTER_FALLBACK_MS;
}

/** Waits `ms`; an abort of the call ends the wait with the abort's reason, like `fetch` would. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Sends the call; after a 419 (token or session out of date) it fetches a fresh token cookie and sends it once more, and
 * a read refused by the rate limit (429) waits once and asks again.
 */
async function send<T>(attempt: () => Promise<Raw>, options: RequestOptions, read = false): Promise<T> {
  let raw = await attempt();

  if (raw.status === 419) {
    await fetch(CSRF_COOKIE_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: options.signal });
    raw = await attempt();
  }
  if (raw.status === 429 && read) {
    await pause(retryDelay(raw.retryAfter), options.signal);
    raw = await attempt();
  }

  return settle<T>(raw);
}

async function viaFetch(method: string, url: string, body: unknown, options: RequestOptions): Promise<Raw> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { ...baseHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });

  return {
    status: response.status,
    contentType: response.headers.get('Content-Type') ?? '',
    text: await response.text(),
    retryAfter: response.headers.get('Retry-After'),
  };
}

function request<T>(method: string, path: string, body: unknown, options: RequestOptions, read = false): Promise<T> {
  return send<T>(() => viaFetch(method, `${API_BASE}${path}`, body, options), options, read);
}

export function get<T>(path: string, query: Query = {}, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', `${path}${toQueryString(query)}`, undefined, options, true);
}

/** The resource of an answer wrapped in `{data}`: every API function with a single resource unwraps it here. */
export async function one<T>(call: Promise<{ data: T }>): Promise<T> {
  return (await call).data;
}

/**
 * A resource that is saved as a whole: `POST` to the collection without an id (an empty one too, like the clickdummy),
 * `PUT` to the resource with one.
 */
export function saveOne<T>(path: string, id: string | undefined, body: unknown): Promise<T> {
  return one(id ? put<{ data: T }>(`${path}/${encodeURIComponent(id)}`, body) : post<{ data: T }>(path, body));
}

interface ListAnswer<T> {
  data: T[];
  meta: { next_cursor?: string | null; total?: number };
}

/** A list of the API (`{data, links, meta}`) as a `Page`; without `meta.total` the total is what came. */
export async function getPage<T>(path: string, query: Query = {}, options: RequestOptions = {}): Promise<Page<T>> {
  const { data, meta } = await get<ListAnswer<T>>(path, query, options);

  return { items: data, next_cursor: meta.next_cursor ?? null, total: meta.total ?? data.length };
}

/** A list the API answers to a read `POST` (a query body instead of a query string), as a `Page`. */
export async function postPage<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<Page<T>> {
  const { data, meta } = await readPost<ListAnswer<T>>(path, body, options);

  return { items: data, next_cursor: meta.next_cursor ?? null, total: meta.total ?? data.length };
}

export function post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, body, options);
}

/**
 * A `POST` that only reads (a query body instead of a query string; the routes with `token_ability` `read`): it waits
 * once after a 429 like a `GET`.
 */
export function readPost<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, body, options, true);
}

/**
 * A `POST` to a path of the web app outside `/api/v1`, e.g. `/broadcasting/batch` for the live channels: with session
 * cookie, CSRF token and its renewal after a 419, the answer read as JSON like any call of the API.
 */
export function webPost<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return send<T>(() => viaFetch('POST', path, body, options), options);
}

export function patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

export function put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('PUT', path, body, options);
}

export function del<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('DELETE', path, body, options);
}

/** `fetch` has no upload progress, so a file goes through `XMLHttpRequest`; the answer is read like any other. */
/** How long an upload may take before it counts as failed (no answer): 30 minutes, 25 MB at about 110 kbit/s. */
export const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

function viaXhr(url: string, form: FormData, onProgress: ((fraction: number) => void) | undefined, options: RequestOptions): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();

    xhr.open('POST', url);
    xhr.withCredentials = true;
    // an upload that never ends would hold the page and the form for ever: after this long it failed (F29)
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    Object.entries(baseHeaders()).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort);
      resolve({ status: xhr.status, contentType: xhr.getResponseHeader('Content-Type') ?? '', text: xhr.responseText });
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(new TypeError('Network request failed'));
    };
    xhr.ontimeout = () => {
      signal?.removeEventListener('abort', abort);
      reject(new TypeError('The upload timed out'));
    };
    xhr.onabort = () => reject(signal?.reason ?? new DOMException('The upload was aborted.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(form);
  });
}

/** Posts a form with files; `onProgress` gets the sent share (0 to 1) while the body goes out. */
export function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, options: RequestOptions = {}): Promise<T> {
  return send<T>(() => viaXhr(`${API_BASE}${path}`, form, onProgress, options), options);
}
