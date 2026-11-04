/*
 * The activity of an item (spec 4.10): its comments and its history in one timeline, oldest first, filtered to
 * everything ("Alles"), the comments ("Kommentare") or the changes ("Änderungen"); the comment composer stands at its
 * end.
 * - The whole history and every comment load (every page, `useActivity`): the server pages from the oldest entry on,
 *   and the newest must never be missing. The timeline shows the newest `SHOWN_LINES` lines (a comment is a line);
 *   "Mehr laden" above them shows the earlier ones, `SHOWN_LINES` at a time.
 * - A comment is a card (`CommentCard`) with its actions and reactions; one deleted while its undo toast stands is left
 *   out (`useHiddenComments`).
 * - Changes by the same account, made the same way for the same reason within five minutes, read as one line
 *   (`buildTimeline`); every field change reads as old → new (`phrasesOf`), a reason stands under its line.
 * - On the page the filter is part of the address (`?activity=changes`), so it can be linked; the preview keeps it.
 * - The lines wait for the catalogs they take their names from (people, labels, resolutions, types, properties); a
 *   catalog that fails to load leaves its names as gone ("ein gelöschtes Label").
 * - A failed load says why with "Erneut versuchen"; a reload that fails keeps what was loaded.
 */

import { router, usePage } from '@inertiajs/react';
import { RotateCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUserMap } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useLabels, useResolutions } from '@/hooks/catalog';
import { useAllUsers } from '@/hooks/users';
import { useProperties } from '@/hooks/properties';
import { useActivity } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t, tn } from '@/lib/i18n';
import type { WorkItemDetail } from '@/types';
import { CommentCard, useHiddenComments } from '../comments/CommentCard';
import { CommentComposer } from '../comments/CommentComposer';
import { focusWhenLost } from '@/lib/focusOrigin';
import { Section, useDetail } from '../shared';
import { EventLine } from './EventLine';
import type { PhraseContext } from './phrases';
import { buildTimeline, type ActivityFilter } from './timeline';

/** Lines the timeline shows at first and adds with every "Mehr laden". */
export const SHOWN_LINES = 50;

const FILTERS: ActivityFilter[] = ['all', 'comments', 'changes'];

const filterOf = (value: string | null): ActivityFilter => (FILTERS.includes(value as ActivityFilter) ? (value as ActivityFilter) : 'all');

/** The page's address with `activity` set to the filter (none for "Alles"); everything else of the query stays. */
function addressWith(url: string, filter: ActivityFilter): string {
  const address = new URL(url, window.location.origin);
  if (filter === 'all') address.searchParams.delete('activity');
  else address.searchParams.set('activity', filter);
  return `${address.pathname}${address.search}`;
}

/** The filter: on the page from the address, in the preview its own. */
function useFilter(): [ActivityFilter, (next: ActivityFilter) => void] {
  const { surface } = useDetail();
  const { url } = usePage();
  const [own, setOwn] = useState<ActivityFilter>('all');
  if (surface !== 'page') return [own, setOwn];
  const linked = filterOf(new URL(url, window.location.origin).searchParams.get('activity'));
  return [linked, (next) => router.replace({ url: addressWith(url, next), preserveState: true, preserveScroll: true })];
}

export function Activity({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const activity = useActivity(item.id);
  const users = useUserMap();
  const catalogs = [useAllUsers(), useLabels(), useResolutions(), useWorkItemTypes(), useProperties()] as const;
  const [, labelsQuery, resolutionsQuery, typesQuery, propertiesQuery] = catalogs;
  const labels = labelsQuery.data?.items;
  const resolutions = resolutionsQuery.data?.items;
  const types = typesQuery.data?.items;
  const properties = propertiesQuery.data?.items;
  // the names come from the catalogs: until they answer, a line would call a label deleted (a failed one reads so)
  const named = catalogs.every((query) => !query.isPending);
  const [filter, setFilter] = useFilter();
  const [shown, setShown] = useState(SHOWN_LINES);
  const list = useRef<HTMLOListElement>(null);

  const ctx: PhraseContext = {
    detail,
    users,
    labelName: (id) => labels?.find((label) => label.id === id)?.name ?? t('items.activity.unknown.label'),
    resolutionName: (id) => resolutions?.find((resolution) => resolution.id === id)?.label ?? t('items.activity.unknown.resolution'),
    typeName: (id) => types?.find((type) => type.id === id)?.name ?? t('items.activity.unknown.type'),
    propertyOf: (key) => properties?.find((property) => property.key === key),
  };

  const hidden = useHiddenComments();
  const entries = (activity.data ?? []).filter((entry) => !(entry.kind === 'comment' && hidden.has(entry.id)));
  const lines = buildTimeline(entries, filter);
  const earlier = Math.max(0, lines.length - shown);
  const showMore = () => {
    setShown((count) => count + SHOWN_LINES);
    // the button goes once nothing earlier is left: the focus moves on to the timeline
    focusWhenLost(() => list.current);
  };

  return (
    <Section
      title={t('items.activity.title')}
      actions={
        <SegmentedControl
          label={t('items.activity.filter.label')}
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={FILTERS.map((value) => ({ value, label: t(`items.activity.filter.${value}`) }))}
        />
      }
    >
      {activity.isError && !activity.data ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui text-ink">
          <p className="min-w-0 flex-1 text-pretty">{t('items.activity.failed', { message: activity.error?.message ?? '' })}</p>
          <Button variant="secondary" size="sm" icon={RotateCw} pending={activity.isFetching} onClick={() => void activity.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !activity.data || !named ? (
        <SkeletonGroup label={t('items.activity.loading')} className="mt-3 flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-2.5">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="mt-1 h-3.5 w-3/4" />
            </div>
          ))}
        </SkeletonGroup>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-ui text-muted">{t(`items.activity.empty.${filter}`)}</p>
      ) : (
        <>
          {earlier > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={showMore}>
                {t('items.activity.more')}
              </Button>
              <span className="text-sm text-muted">{tn('items.activity.earlier', earlier)}</span>
            </div>
          )}
          <ol
            ref={list}
            tabIndex={-1}
            aria-label={t('items.activity.list')}
            className="relative mt-3 flex flex-col gap-3 outline-none before:absolute before:top-3 before:bottom-3 before:left-2.5 before:border-l before:border-dashed before:border-line-strong"
          >
            {lines
              .slice(earlier)
              .map((line) => (line.kind === 'comment' ? <CommentCard key={line.key} comment={line.comment} item={item} /> : <EventLine key={line.key} line={line} ctx={ctx} hidden={hidden} />))}
          </ol>
        </>
      )}
      <CommentComposer item={item} />
    </Section>
  );
}
