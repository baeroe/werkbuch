/*
 * Just enough of XMLHttpRequest for `upload` (api/http.ts): files go through it because `fetch` reports no upload
 * progress. A test installs it, starts the call and drives the request from outside:
 *
 *   installFakeXhr();
 *   const call = uploadAttachment('p_web', file, null, 'inline', { onProgress });
 *   FakeXhr.last.progress(50, 100);
 *   FakeXhr.last.answer(201, { data: attachment });
 *
 * `restoreFakeXhr()` brings the real one back (and only that one).
 */

import { vi } from 'vitest';

type ProgressEvent = { lengthComputable: boolean; loaded: number; total: number };

export class FakeXhr {
  /** The request opened last: the one the call under test just sent. */
  static last: FakeXhr;
  /** Every request since `installFakeXhr()`, in the order they were opened (several uploads at once). */
  static all: FakeXhr[] = [];

  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  /** The time limit the call set (`xhr.timeout`). */
  timeout = 0;
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
    FakeXhr.all.push(this);
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

  /** The time limit ran out without an answer. */
  timeOut() {
    this.ontimeout?.();
  }

  /** The share of the body that went out so far; `total` 0 is a progress the browser cannot measure. */
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: total > 0, loaded, total });
  }

  /** The answer: a text as it is, anything else as JSON; `type` null sends no content type. */
  answer(status: number, body: unknown, type: string | null = status >= 400 ? 'application/problem+json' : 'application/json') {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.contentType = type;
    this.onload?.();
  }
}

/** The XMLHttpRequest that was there before installFakeXhr(). */
let original: typeof XMLHttpRequest | undefined;

/** Puts FakeXhr in place of XMLHttpRequest. */
export function installFakeXhr(): void {
  FakeXhr.all = [];
  original ??= globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
}

/** Puts the real XMLHttpRequest back, and only it: globals other tests stubbed stay (T15-M5). */
export function restoreFakeXhr(): void {
  if (original !== undefined) globalThis.XMLHttpRequest = original;
  original = undefined;
}
