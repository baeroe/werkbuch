import type { Page } from '@/api/client';

/**
 * Every page of a list (`next_cursor` followed to the end) as one page, for the screens that must show every entry:
 * the people and bots of the settings, the projects, the invitations. One page holds at most 100.
 */
export async function allPages<T>(page: (cursor: string | null) => Promise<Page<T>>): Promise<Page<T>> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const next = await page(cursor);
    items.push(...next.items);
    cursor = next.next_cursor;
  } while (cursor !== null);
  return { items, next_cursor: null, total: items.length };
}
