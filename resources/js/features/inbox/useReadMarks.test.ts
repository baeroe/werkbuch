/*
 * The read marks of the inbox against a fake server whose answers the test holds back: the count of the header and the
 * rows stay right while a mark is on its way, while the server's count and the list load again one after the other,
 * and when the server refuses. The keys and the screen around it: inbox.test.tsx.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useNotifications } from '@/hooks/notifications';
import { mockApi, type MockApi } from '@/test/api';
import { list, maraInbox } from '@/test/fixtures';
import type { Notification } from '@/types';
import { countUnread, useReadMarks, type Mark } from './useReadMarks';

let notifications: Notification[];
let api: MockApi;
let client: QueryClient;
/** Requests the test holds back, by a part of their address: released one by one. */
let gates: { match: (url: string, method: string) => boolean; open: Promise<void>; release: () => void }[];
/** The server refuses every mark while set. */
let refusing: boolean;
/** The marks as they left the browser, before any gate. */
let sent: string[];

function gate(match: (url: string, method: string) => boolean): () => void {
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  gates.push({ match, open, release });
  return release;
}

const LIST = { per_page: 50 };
const COUNT = { unread_only: true, per_page: 1 };

beforeEach(() => {
  notifications = maraInbox.map((entry) => ({ ...entry }));
  gates = [];
  refusing = false;
  sent = [];
  resetToasts();
  api = mockApi({
    'GET /api/v1/notifications': (_, url) => {
      const unreadOnly = url.searchParams.get('unread_only') === '1';
      const perPage = Number(url.searchParams.get('per_page') ?? 100);
      const matching = notifications.filter((entry) => !unreadOnly || entry.read_at === null);
      return { body: list(matching.slice(0, perPage), matching.length) };
    },
    'POST /api/v1/notifications/read': (body) => {
      if (refusing) return { status: 403, body: { type: 'about:blank', title: 'no', status: 403, reason: 'forbidden', detail: 'Das darfst du nicht.' } };
      const { ids, all, mentions_only: mentionsOnly } = body as { ids?: string[]; all?: true; mentions_only?: boolean };
      const hits = (entry: Notification) => entry.read_at === null && (all ? !mentionsOnly || entry.event === 'mentioned' : ids!.includes(entry.id));
      const updated = notifications.filter(hits).length;
      notifications = notifications.map((entry) => (hits(entry) ? { ...entry, read_at: '2026-10-28T09:00:00.000Z' } : entry));
      return { body: { updated } };
    },
    'POST /api/v1/notifications/unread': (body) => {
      const { ids } = body as { ids: string[] };
      notifications = notifications.map((entry) => (ids.includes(entry.id) ? { ...entry, read_at: null } : entry));
      return { body: { updated: ids.length } };
    },
  });
  // the answers wait at their gate (held when the request starts, the server acts once it opens)
  const mocked = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') sent.push(url);
    const held = gates.find((entry) => entry.match(url, init?.method ?? 'GET'));
    if (held) {
      gates.splice(gates.indexOf(held), 1);
      await held.open;
    }
    return mocked(input, init);
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  api.restore();
});

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

/** The inbox as the screen holds it: the list, the server's count and the marks over both. */
function useInbox() {
  const listQuery = useNotifications(LIST);
  const countQuery = useNotifications(COUNT);
  const marks = useReadMarks([qk.notifications.list(LIST), qk.notifications.list(COUNT)]);
  const stored = listQuery.data?.items ?? [];
  return {
    marks,
    stored,
    count: countQuery.data ? marks.unread(countQuery.data.total, qk.notifications.list(COUNT)) : null,
    shownRead: (id: string) => marks.isRead(stored.find((entry) => entry.id === id)!),
  };
}

async function renderInbox() {
  const hook = renderHook(useInbox, { wrapper });
  await waitFor(() => expect(hook.result.current.count).toBe(3));
  return hook;
}

const byId = (stored: Notification[], id: string) => stored.find((entry) => entry.id === id)!;
const isListRead = (url: string, method: string) => method === 'GET' && url.includes('per_page=50');
const isCount = (url: string, method: string) => method === 'GET' && url.includes('unread_only=1');
const isMark = (path: string) => (url: string, method: string) => method === 'POST' && url.endsWith(path);

describe('the read marks', () => {
  it('keeps the count right between the mark and the reload', async () => {
    const { result } = await renderInbox();
    const releaseMark = gate(isMark('/notifications/read'));
    // the list loads again after the server's count (the order 13c saw one too few with)
    const releaseList = gate(isListRead);

    let done!: Promise<void>;
    act(() => {
      done = result.current.marks.setRead([byId(result.current.stored, 'n_01')], true);
    });
    // at once, before the server answered
    expect(result.current.count).toBe(2);
    expect(result.current.shownRead('n_01')).toBe(true);

    await act(async () => releaseMark());
    // the server's count has loaded again (2), the list still holds n_01 unread: counted once
    await waitFor(() => expect(api.calls.filter((call) => call.url.includes('unread_only=1'))).toHaveLength(2));
    await waitFor(() => expect(client.getQueryData<{ total: number }>(qk.notifications.list(COUNT))!.total).toBe(2));
    expect(result.current.count).toBe(2);
    expect(result.current.shownRead('n_01')).toBe(true);
    expect(result.current.marks.marks.size).toBe(1);

    await act(async () => {
      releaseList();
      await done;
    });
    // both have loaded again: the mark is forgotten, the server says it
    await waitFor(() => expect(result.current.marks.marks.size).toBe(0));
    expect(result.current.count).toBe(2);
    expect(result.current.shownRead('n_01')).toBe(true);
  });

  it('counts the mark until the server’s count has loaded after it, also when the list loaded first', async () => {
    const { result } = await renderInbox();
    const releaseCount = gate(isCount);

    let done!: Promise<void>;
    act(() => {
      done = result.current.marks.setRead([byId(result.current.stored, 'n_01')], true);
    });
    expect(result.current.count).toBe(2);
    // the list has loaded again (n_01 read there), the count not yet: still one less
    await waitFor(() => expect(byId(result.current.stored, 'n_01').read_at).not.toBeNull());
    expect(result.current.count).toBe(2);

    await act(async () => {
      releaseCount();
      await done;
    });
    await waitFor(() => expect(result.current.marks.marks.size).toBe(0));
    expect(result.current.count).toBe(2);
  });

  it('sends marks one after another and ends where the last key left it', async () => {
    const { result } = await renderInbox();
    const releaseRead = gate(isMark('/notifications/read'));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.marks.setRead([byId(result.current.stored, 'n_01')], true);
    });
    act(() => {
      second = result.current.marks.setRead([byId(result.current.stored, 'n_01')], false);
    });
    // the last key counts at once
    expect(result.current.count).toBe(3);
    expect(result.current.shownRead('n_01')).toBe(false);
    // the second call waits for the first, however long the server takes
    await act(() => Promise.resolve());
    expect(sent).toEqual(['/api/v1/notifications/read']);

    await act(async () => {
      releaseRead();
      await Promise.all([first, second]);
    });
    expect(api.calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual(['/api/v1/notifications/read', '/api/v1/notifications/unread']);
    expect(byId(notifications, 'n_01').read_at).toBeNull();
    await waitFor(() => expect(result.current.marks.marks.size).toBe(0));
    expect(result.current.count).toBe(3);
    expect(result.current.shownRead('n_01')).toBe(false);
  });

  it('keeps the count right when the earlier call lands while the later one waits', async () => {
    const { result } = await renderInbox();
    const releaseUnread = gate(isMark('/notifications/unread'));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.marks.setRead([byId(result.current.stored, 'n_01')], true);
    });
    act(() => {
      second = result.current.marks.setRead([byId(result.current.stored, 'n_01')], false);
    });
    // the read lands and the count loads again (2) while the unread waits: still 3, as the last key said
    await act(() => first);
    expect(client.getQueryData<{ total: number }>(qk.notifications.list(COUNT))!.total).toBe(2);
    expect(result.current.count).toBe(3);

    await act(async () => {
      releaseUnread();
      await second;
    });
    await waitFor(() => expect(result.current.marks.marks.size).toBe(0));
    expect(result.current.count).toBe(3);
  });

  it('restores the state when the server refuses', async () => {
    const { result } = await renderInbox();
    refusing = true;

    await act(() => result.current.marks.setRead([byId(result.current.stored, 'n_01')], true));
    expect(result.current.count).toBe(3);
    expect(result.current.shownRead('n_01')).toBe(false);
    expect(result.current.marks.marks.size).toBe(0);
    // a refusal says why, without a retry that would only be refused again
    const toast = currentToasts().find((entry) => entry.title === 'Nicht als gelesen markiert')!;
    expect(toast.description).toBe('Das darfst du nicht.');
    expect(toast.action).toBeUndefined();
  });

  it('marks everything a filter shows read with one call and answers how many', async () => {
    const { result } = await renderInbox();
    const releaseAll = gate(isMark('/notifications/read'));

    const mentions = result.current.stored.filter((entry) => entry.event === 'mentioned' && entry.read_at === null);
    let call!: Promise<number | null>;
    act(() => {
      call = result.current.marks.readAll(mentions, { mentions_only: true });
    });
    // at once, while the server works
    expect(result.current.marks.readingAll).toBe(true);
    expect(result.current.count).toBe(2);
    expect(result.current.shownRead('n_01')).toBe(true);

    let updated: number | null = null;
    await act(async () => {
      releaseAll();
      updated = await call;
    });
    expect(updated).toBe(1);
    expect(api.calls.filter((entry) => entry.method === 'POST').map((entry) => entry.body)).toEqual([{ all: true, mentions_only: true }]);
    await waitFor(() => expect(result.current.marks.marks.size).toBe(0));
    expect(result.current.count).toBe(2);
    expect(result.current.marks.readingAll).toBe(false);
  });

  it('brings everything back when marking all fails', async () => {
    const { result } = await renderInbox();
    refusing = true;

    const unread = result.current.stored.filter((entry) => entry.read_at === null);
    let updated: number | null = 0;
    await act(async () => {
      updated = await result.current.marks.readAll(unread, {});
    });
    expect(updated).toBeNull();
    expect(result.current.count).toBe(3);
    expect(result.current.marks.marks.size).toBe(0);
    expect(currentToasts().map((entry) => entry.title)).toContain('Nicht als gelesen markiert');
  });
});

describe('countUnread', () => {
  const mark = (read: boolean, wasUnread: boolean, extra: Partial<Mark> = {}): Mark => ({ read, call: 1, wasUnread, mention: false, answered: null, prior: null, ...extra });
  const answered = new Map([['count', 1]]);

  it('counts a mark only where it differs from what the count holds', () => {
    const never = () => false;
    expect(countUnread(3, new Map([['a', mark(true, true)]]), never)).toBe(2);
    expect(countUnread(3, new Map([['a', mark(true, false)]]), never)).toBe(3);
    expect(countUnread(3, new Map([['a', mark(false, false)]]), never)).toBe(4);
    expect(countUnread(0, new Map([['a', mark(true, true)]]), never)).toBe(0);
    // only the marks a count is about
    expect(countUnread(3, new Map([['a', mark(true, true)], ['b', mark(true, true, { mention: true })]]), never, (entry) => entry.mention)).toBe(2);
  });

  it('leaves a mark out once the count loaded after the server took it, and counts from an earlier one the count holds', () => {
    const always = () => true;
    expect(countUnread(2, new Map([['a', mark(true, true, { answered })]]), always)).toBe(2);
    // the read landed and is counted, the unread after it is on its way
    expect(countUnread(2, new Map([['a', mark(false, true, { prior: { unread: false, answered } })]]), always)).toBe(3);
    expect(countUnread(3, new Map([['a', mark(false, true, { prior: { unread: false, answered } })]]), () => false)).toBe(3);
  });
});
