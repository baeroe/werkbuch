/*
 * How many items use a catalog entry (A61): the counts come from the same engine as the lists (`/work-items/groups` and
 * `/work-items/counts`), so they name only what the reader sees (an org admin sees everything). One call serves a whole
 * screen; a failed load shows "not loaded" only while there is no number, a failed refetch keeps the last one.
 */

import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { countWorkItems } from '@/api/workItems';
import { Skeleton, useLate } from '@/components/ui/Skeleton';
import { qk } from '@/hooks/keys';
import { useWorkItemGroups } from '@/hooks/workItems';
import { t, tn } from '@/lib/i18n';
import type { Condition, Filter, GroupBy, Property } from '@/types';

/** What a usage query knows: the numbers by key (no key: none), or why there are none. */
export interface Usage {
  /** The count per key; `undefined` while loading or after a failed first load. */
  counts: Record<string, number> | undefined;
  pending: boolean;
  failed: boolean;
}

/** The items per group of `groupBy` (archived ones included), optionally narrowed by conditions. */
export function useGroupUsage(groupBy: GroupBy, conditions: Condition[] = []): Usage {
  const answer = useWorkItemGroups({
    group_by: groupBy,
    include_archived: true,
    ...(conditions.length > 0 ? { filter: { version: 1, conditions } } : {}),
  });
  const counts = answer.data ? Object.fromEntries(answer.data.groups.map((group) => [group.key, group.count])) : undefined;
  return { counts, pending: answer.isPending, failed: answer.isError && !answer.data };
}

/** `CountWorkItems` takes at most this many filters (K10). */
export const MAX_COUNT_FILTERS = 50;

/**
 * The filter that finds the items with a value for the property: a yes/no property that is switched off reads like an
 * empty one (A89) and its only operator is `is`, so it asks `is true`; every other kind asks `is_not_empty` (K10).
 */
export function valueFilter(property: Property): Filter {
  const field = `property:${property.key}`;
  const condition: Condition = property.field_type === 'boolean' ? { field, op: 'is', value: true } : { field, op: 'is_not_empty' };
  return { version: 1, conditions: [condition] };
}

/**
 * The items with a value per property, asked in calls of at most 50 filters, each named by the key of its property (a
 * key fits a filter name: `PropertyKey` allows 40 of `[a-z0-9_]`). While a new set of properties is asked (one was
 * deleted, one came), the numbers of the last answer stay (`keepPreviousData`): they hang on keys, never on a position.
 */
export function usePropertyUsage(properties: readonly Property[] | undefined): Usage {
  const chunks: Property[][] = [];
  for (let at = 0; at < (properties?.length ?? 0); at += MAX_COUNT_FILTERS) chunks.push(properties!.slice(at, at + MAX_COUNT_FILTERS));
  const answers = useQueries({
    queries: chunks.map((chunk) => {
      const filters = Object.fromEntries(chunk.map((property) => [property.key, valueFilter(property)]));
      return {
        queryKey: qk.workItems.counts({ filters, include_archived: true }),
        queryFn: () => countWorkItems(filters, { include_archived: true }),
        placeholderData: keepPreviousData,
      };
    }),
  });
  const failed = answers.some((answer) => answer.isError && !answer.data);
  const pending = !failed && (properties === undefined || answers.some((answer) => answer.isPending));
  const byKey: Record<string, number> = pending || failed ? {} : Object.assign({}, ...answers.map((answer) => answer.data));
  const counts = pending || failed ? undefined : Object.fromEntries((properties ?? []).map((property) => [property.key, byKey[property.key] ?? 0] as const));
  return { counts, pending, failed };
}

/**
 * "3 items", a skeleton while loading, "Count not loaded" when it failed. The skeleton is a picture only (aria-hidden):
 * that the counts load says `UsageStatus` once for the list (T23-M8), not a status per row.
 */
export function UsageCount({ usage, id }: { usage: Usage; id: string }) {
  if (usage.pending)
    return (
      <span className="inline-block w-14 align-middle">
        <Skeleton className="h-3.5 w-full" />
      </span>
    );
  if (usage.counts === undefined) return <span>{t('catalog.usage_failed')}</span>;
  return <span>{tn('catalog.usage', usage.counts[id] ?? 0)}</span>;
}

/**
 * The one status of a list's counts: there from the start, so what it says is announced, and it says "Counts loading"
 * only once the skeletons of the rows show (after their delay, M3).
 */
export function UsageStatus({ usage }: { usage: Usage }) {
  const late = useLate(undefined, usage.pending);
  return (
    <span role="status" className="sr-only">
      {usage.pending && late ? t('catalog.usage_loading') : ''}
    </span>
  );
}
