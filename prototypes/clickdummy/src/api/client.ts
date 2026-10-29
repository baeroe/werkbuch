/*
 * What every fake API function has in common, so that a later swap for `fetch` touches only the function bodies:
 * - `ApiError { status, reason, errors? }`, built like the Problem Details of the REST API (spec 6.1)
 * - `Page<T>`, the envelope of every list (cursor pagination)
 * - the latency (150-450 ms, none in tests), the simulated outage (`localStorage['api:fail']`) and the signed-in
 *   account, which the server would read from the session.
 *
 * `read` and `write` wrap the body of a function: they wait, may fail, hand the body the database and the signed-in
 * account, and `write` stores the result, or undoes everything when the body throws.
 */

import { now } from '@/lib/clock';
import { DEFAULT_USER_ID, useSession } from '@/store/session';
import type { User } from '@/types';
import { getDb, rollbackDb, saveDb, type Db } from './db';

/** A deep copy. What leaves the API is always a copy, so nobody can change the stored data by holding on to a result. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Whether two JSON-like values are the same (key order matters, which is fine for what the API compares). */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/* ------------------------------------------------------------------------ errors */

export interface ApiErrorInit {
  status: number;
  /** A stable code such as `transition_not_allowed`; the text of the message is for people. */
  reason: string;
  /** A sentence in German for a toast or an inline message. */
  detail?: string;
  /** Field errors by path, e.g. `title` or `values.customer`. */
  errors?: Record<string, string[]>;
  /** Further members of the problem document, e.g. `current` (the stored state) of a conflict. */
  extensions?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly errors?: Record<string, string[]>;
  readonly extensions: Record<string, unknown>;

  constructor({ status, reason, detail, errors, extensions }: ApiErrorInit) {
    super(detail ?? `Fehler ${status} (${reason})`);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.errors = errors;
    this.extensions = extensions ?? {};
  }

  /** On a 409 conflict: the state stored on the server (`page_conflict`: the page, `description_conflict`: the item). */
  get current(): unknown {
    return this.extensions.current;
  }
}

/** A short German text for a reason code, e.g. for the line of a toast that lists what a bulk edit refused. */
const REASON_TEXT: Record<string, string> = {
  transition_not_allowed: 'Der Übergang ist im Workflow nicht erlaubt.',
  not_closed: 'Nur geschlossene Items lassen sich archivieren.',
  not_archived: 'Das Item ist nicht archiviert.',
  archived: 'Das Item ist archiviert und schreibgeschützt.',
  project_archived: 'Das Projekt ist archiviert und schreibgeschützt.',
  forbidden: 'Dafür fehlt die Berechtigung.',
  not_found: 'Das Item gibt es nicht oder du darfst es nicht sehen.',
  validation_failed: 'Die Eingabe ist nicht gültig.',
  description_conflict: 'Die Beschreibung wurde inzwischen geändert.',
  page_conflict: 'Die Seite wurde inzwischen geändert.',
  parent_not_epic: 'Nur Epics können Kind-Items haben.',
  epic_has_no_parent: 'Epics haben kein Eltern-Item.',
  last_admin: 'Das ist der letzte aktive Admin.',
  in_use: 'Das wird noch benutzt.',
  simulated: 'Simulierter Serverfehler.',
};

export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? `Abgelehnt (${reason}).`;
}

export const notFound = (what: string) => new ApiError({ status: 404, reason: 'not_found', detail: `${what} wurde nicht gefunden.` });

export const forbidden = (detail = 'Dafür fehlt dir die Berechtigung.') => new ApiError({ status: 403, reason: 'forbidden', detail });

export const conflict = (reason: string, detail: string, extensions?: Record<string, unknown>) =>
  new ApiError({ status: 409, reason, detail, extensions: extensions && clone(extensions) });

export const invalid = (errors: Record<string, string[]>, detail = 'Die Eingabe ist nicht gültig.') =>
  new ApiError({ status: 422, reason: 'validation_failed', detail, errors });

/** Collects field errors and throws one 422 for all of them. */
export class FieldErrors {
  private readonly errors: Record<string, string[]> = {};

  add(path: string, message: string): void {
    (this.errors[path] ??= []).push(message);
  }

  has(path: string): boolean {
    return path in this.errors;
  }

  get any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  /** Takes over the field errors of a 422 thrown elsewhere; rethrows any other error. */
  absorb(error: unknown): void {
    if (!(error instanceof ApiError) || error.status !== 422 || !error.errors) throw error;
    for (const [path, messages] of Object.entries(error.errors)) messages.forEach((message) => this.add(path, message));
  }

  throwIfAny(detail?: string): void {
    if (this.any) throw invalid(this.errors, detail);
  }
}

/* -------------------------------------------------------------------------- lists */

/** The envelope of every list. `total` counts all matches, not only this page. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export interface PageArgs {
  cursor?: string | null;
  /** 1 to 100; 100 when omitted. */
  per_page?: number;
}

export const MAX_PER_PAGE = 100;

/** Cuts a page out of a full result. The cursor is the offset of the next page, as an opaque string. */
export function paginate<T>(all: readonly T[], { cursor, per_page }: PageArgs = {}): Page<T> {
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(per_page ?? MAX_PER_PAGE)));
  const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
  const items = all.slice(offset, offset + perPage);
  const end = offset + items.length;
  return { items, next_cursor: end < all.length ? String(end) : null, total: all.length };
}

/* ------------------------------------------------------------- latency and failure */

export const FAIL_KEY = 'api:fail';

const LATENCY_MS = { min: 150, max: 450 };

/** Waits like a network call would; not at all in tests. */
function delay(): Promise<void> {
  if (import.meta.env.MODE === 'test') return Promise.resolve();
  const ms = LATENCY_MS.min + Math.random() * (LATENCY_MS.max - LATENCY_MS.min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fails with 503 `simulated` while `localStorage['api:fail']` is set (to anything but 0 or false). */
export function maybeFail(): void {
  let flag: string | null = null;
  try {
    flag = localStorage.getItem(FAIL_KEY);
  } catch {
    // storage blocked: no switch, no failure
  }
  if (flag !== null && flag !== '' && flag !== '0' && flag !== 'false') {
    throw new ApiError({
      status: 503,
      reason: 'simulated',
      detail: 'Simulierter Serverfehler: „api:fail“ ist gesetzt.',
    });
  }
}

/* --------------------------------------------------------------------- the session */

/** The id of the signed-in account. */
export function currentUserId(): string {
  return useSession.getState().userId;
}

/** Everything a function body works with. */
export interface Ctx {
  db: Db;
  /** The signed-in account. */
  me: User;
  /** The demo clock at the start of the call; the same instant for everything the call writes. */
  now: Date;
  /** `now` as an ISO string, the format of all timestamps. */
  stamp: string;
}

export function makeCtx(db: Db, me: User, at: Date = now()): Ctx {
  return { db, me, now: at, stamp: at.toISOString() };
}

function context(): Ctx {
  const db = getDb();
  const me = db.users.find((user) => user.id === currentUserId()) ?? db.users.find((user) => user.id === DEFAULT_USER_ID);
  if (!me) throw new ApiError({ status: 401, reason: 'unauthenticated', detail: 'Niemand ist angemeldet.' });
  if (me.disabled_at !== null) {
    throw new ApiError({ status: 401, reason: 'account_disabled', detail: `Das Konto von ${me.name} ist deaktiviert.` });
  }
  return makeCtx(db, me);
}

/** A function that only reads. The result is a copy of the stored data. */
export async function read<T>(body: (ctx: Ctx) => T): Promise<T> {
  await delay();
  maybeFail();
  return clone(body(context()));
}

/** A function that changes data: stored when the body returns, undone when it throws (also when storage is full). */
export async function write<T>(body: (ctx: Ctx) => T): Promise<T> {
  await delay();
  maybeFail();
  const ctx = context();
  try {
    const result = clone(body(ctx));
    try {
      saveDb();
    } catch {
      throw new ApiError({
        status: 413,
        reason: 'storage_full',
        detail: 'Der Speicher des Browsers ist voll. Im Klickdummy sind Anhänge nur klein möglich.',
      });
    }
    return result;
  } catch (error) {
    rollbackDb();
    throw error;
  }
}

/* ------------------------------------------------------------------------- ids */

let sequence = 0;

/** A new id such as `wi_m1x2k3_a`; the prefix tells the kind of record. */
export function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
