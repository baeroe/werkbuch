/*
 * What the editor of rich text reads: who can be mentioned (`@`) and what stored references (`#`) name, items and wiki
 * pages.
 *
 * A text can name many items and pages, and every reference shows on its own: `useItemRef` and `usePageRef` give each
 * id its own cache entry (`qk.references.item(id)`, `qk.references.page(id)`), but the ids asked for within one tick
 * go to the server together, both kinds in one `GET /references` per hundred. An id the answer leaves out is one the
 * reader does not see (or one that is gone): its entry fails with a 404 (`isGone`), and the reference shows as hidden
 * without a key or title.
 */

import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { listMentionables, resolveReferences } from '@/api/richText';
import type { ListedItem, PageSummary } from '@/types';
import { qk } from './keys';
import { queryClient as appQueryClient } from './queryClient';

/** Who can be mentioned in a project whose name or handle fits `q`; the last list stays while the next one loads. */
export function useMentionables(project: string | null | undefined, q: string, enabled = true) {
  const text = q.trim();

  return useQuery({
    queryKey: qk.mentions.list({ project, q: text }),
    queryFn: () => listMentionables(project!, text),
    enabled: !!project && enabled,
    placeholderData: keepPreviousData,
  });
}

/** As many ids as `GET /references` takes at once, items and pages together (`ResolveReferences::MAX_ITEMS`). */
const BATCH_MAX = 100;

type Kind = 'item' | 'page';

interface Asked {
  kind: Kind;
  id: string;
  waiting: { resolve: (found: ListedItem | PageSummary) => void; reject: (error: unknown) => void }[];
}

/** The ids asked for in this tick by kind and id (`item:<id>`, `page:<id>`), each with the callers waiting for it. */
let batch = new Map<string, Asked>();

async function send(entries: Asked[]): Promise<void> {
  const ids = (kind: Kind) => entries.filter((entry) => entry.kind === kind).map((entry) => entry.id);
  try {
    const answer = await resolveReferences({ items: ids('item'), pages: ids('page') });
    // a kind that was not asked for is not read: the answer names it, but need not
    const found = new Map<string, ListedItem | PageSummary>();
    if (ids('item').length > 0) answer.items.forEach((item) => found.set(`item:${item.id}`, item));
    if (ids('page').length > 0) answer.pages.forEach((page) => found.set(`page:${page.id}`, page));
    for (const { kind, id, waiting } of entries) {
      const hit = found.get(`${kind}:${id}`);
      for (const { resolve, reject } of waiting) {
        if (hit) resolve(hit);
        else reject(new ApiError({ status: 404, reason: 'not_found' }));
      }
    }
  } catch (error) {
    for (const { waiting } of entries) waiting.forEach(({ reject }) => reject(error));
  }
}

function flush(): void {
  const entries = [...batch.values()];
  batch = new Map();
  for (let start = 0; start < entries.length; start += BATCH_MAX) void send(entries.slice(start, start + BATCH_MAX));
}

/** What a reference names, asked for together with every other id of this tick. */
function load<T extends ListedItem | PageSummary>(kind: Kind, id: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (batch.size === 0) setTimeout(flush, 0);
    const asked = batch.get(`${kind}:${id}`) ?? { kind, id, waiting: [] };
    asked.waiting.push({ resolve: (found) => resolve(found as T), reject });
    batch.set(`${kind}:${id}`, asked);
  });
}

/** The item behind a stored reference (lean), or an error 404 when the reader does not see it. */
export function useItemRef(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.references.item(id ?? ''),
    queryFn: () => load<ListedItem>('item', id!),
    enabled: !!id,
  });
}

/** Puts an item the person just chose (the `#` list) into the cache, so its new reference shows without asking. */
export function primeItemRef(item: ListedItem, client: QueryClient = appQueryClient): void {
  client.setQueryData(qk.references.item(item.id), item);
}

/** The wiki page behind a stored reference (lean: title, emoji, place), or an error 404 when the reader does not see it. */
export function usePageRef(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.references.page(id ?? ''),
    queryFn: () => load<PageSummary>('page', id!),
    enabled: !!id,
  });
}

/** Puts a page the person just chose (the `#` list) into the cache, so its new reference shows without asking. */
export function primePageRef(page: PageSummary, client: QueryClient = appQueryClient): void {
  client.setQueryData(qk.references.page(page.id), page);
}
