/*
 * The HTTP layer of the REST API (`/api/v1`): the session cookie and the CSRF token go with every call, and a Problem
 * Details answer (RFC 9457) becomes the `ApiError` of `./client`, so a screen handles one kind of error whatever the
 * transport. A network failure (`fetch` throws) passes through unchanged: it is no answer of the API.
 */

import { ApiError } from './client';

export const API_BASE = '/api/v1';

const CSRF_COOKIE_URL = '/sanctum/csrf-cookie';

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

function baseHeaders(): Record<string, string> {
  const token = csrfToken();

  return {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(token === null ? {} : { 'X-XSRF-TOKEN': token }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A reason for an answer that is no problem document, e.g. the HTML of a proxy. */
function fallbackReason(status: number): string {
  if (status === 419) return 'csrf_token_mismatch';
  if (status === 401) return 'unauthenticated';

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

function settle<T>(raw: Raw): T {
  if (raw.status === 401) {
    // the session is gone: the reload lets the server send the person to the sign-in
    window.location.reload();
    throw toApiError(raw);
  }
  if (raw.status < 200 || raw.status >= 300) {
    throw toApiError(raw);
  }

  return (raw.status === 204 || raw.text === '' ? undefined : JSON.parse(raw.text)) as T;
}

/** Sends the call; after a 419 (token or session out of date) it fetches a fresh token cookie and sends it once more. */
async function send<T>(attempt: () => Promise<Raw>, options: RequestOptions): Promise<T> {
  let raw = await attempt();

  if (raw.status === 419) {
    await fetch(CSRF_COOKIE_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: options.signal });
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

  return { status: response.status, contentType: response.headers.get('Content-Type') ?? '', text: await response.text() };
}

function request<T>(method: string, path: string, body: unknown, options: RequestOptions): Promise<T> {
  return send<T>(() => viaFetch(method, `${API_BASE}${path}`, body, options), options);
}

export function get<T>(path: string, query: Query = {}, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', `${path}${toQueryString(query)}`, undefined, options);
}

export function post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, body, options);
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
    xhr.onabort = () => reject(signal?.reason ?? new DOMException('The upload was aborted.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(form);
  });
}

/** Posts a form with files; `onProgress` gets the sent share (0 to 1) while the body goes out. */
export function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, options: RequestOptions = {}): Promise<T> {
  return send<T>(() => viaXhr(`${API_BASE}${path}`, form, onProgress, options), options);
}
