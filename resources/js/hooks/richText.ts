/*
 * What the editor of rich text reads: who can be mentioned (`@`) and the items behind stored references (`#`).
 *
 * A text can name many items, and every reference shows on its own: `useItemRef` gives each id its own cache entry
 * (`qk.references.item(id)`), but the ids asked for within one tick go to the server together, in one
 * `GET /references` per hundred. An id the answer leaves out is an item the reader does not see (or one that is gone):
 * its entry fails with a 404 (`isGone`), and the reference shows as hidden without a key or title.
 */

import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { listMentionables, resolveReferences } from '@/api/richText';
import type { ListedItem } from '@/types';
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

/** As many ids as `GET /references` takes at once (`ResolveReferences::MAX_ITEMS`). */
const BATCH_MAX = 100;

interface Waiting {
  resolve: (item: ListedItem) => void;
  reject: (error: unknown) => void;
}

/** The ids asked for in this tick, each with the callers waiting for it. */
let batch = new Map<string, Waiting[]>();

async function send(entries: [string, Waiting[]][]): Promise<void> {
  try {
    const items = new Map((await resolveReferences(entries.map(([id]) => id))).map((item) => [item.id, item]));
    for (const [id, waiting] of entries) {
      const item = items.get(id);
      for (const { resolve, reject } of waiting) {
        if (item) resolve(item);
        else reject(new ApiError({ status: 404, reason: 'not_found' }));
      }
    }
  } catch (error) {
    for (const [, waiting] of entries) waiting.forEach(({ reject }) => reject(error));
  }
}

function flush(): void {
  const entries = [...batch];
  batch = new Map();
  for (let start = 0; start < entries.length; start += BATCH_MAX) void send(entries.slice(start, start + BATCH_MAX));
}

/** The item of a reference, asked for together with every other id of this tick. */
function loadItem(id: string): Promise<ListedItem> {
  return new Promise((resolve, reject) => {
    if (batch.size === 0) setTimeout(flush, 0);
    const waiting = batch.get(id) ?? [];
    waiting.push({ resolve, reject });
    batch.set(id, waiting);
  });
}

/** The item behind a stored reference (lean), or an error 404 when the reader does not see it. */
export function useItemRef(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.references.item(id ?? ''),
    queryFn: () => loadItem(id!),
    enabled: !!id,
  });
}

/** Puts an item the person just chose (the `#` list) into the cache, so its new reference shows without asking. */
export function primeItemRef(item: ListedItem, client: QueryClient = appQueryClient): void {
  client.setQueryData(qk.references.item(item.id), item);
}
