/*
 * The timeline (spec 4.11, moodboard "Liste und Timeline"), ported from the clickdummy (13b: split into the axis, the
 * rows, the bar, "Ohne Datum", the pointer and the keys): the epics of the list on a time axis, grouped by project,
 * each a bar from its start to its due date in the tone of its type, filled by the progress of its children. A line in
 * ink blue marks today in the zone of the organisation, the highlighter names it. Zoom: Woche, Monat, Quartal, in the
 * address (`?zoom=`, month without it).
 *
 * - The list asks the server for the epics only, by project, all pages (`useListData`, P20); a group the layout gets
 *   holds a project's epics in the order of their start. While the list still shows the answer of the layout before
 *   (another grouping), the timeline shows its skeleton. Epics without dates wait in "Ohne Datum" beside the axis
 *   (`Unplanned`): dragged onto it they start on the day under the pointer, "Ab heute einplanen" starts them today
 *   (`PLANNED_DAYS`).
 * - Dragging a bar moves it, dragging its ends changes start or due date, a day at a time; Escape cancels a drag
 *   (`useTimelineDrag`). A click on a bar or on the title opens the preview.
 * - Keyboard (`useTimelineKeys`): ⇧←/⇧→ move the epic under the cursor by one unit of the zoom, ⌥←/⌥→ change its due
 *   date. Held keys move the bar at once and save once they rest (`SAVE_DELAY`). ↑/↓, j/k, x, Enter and the space bar
 *   come from `useSelection`. A refusal says why in a toast and changes nothing.
 * - Dates are saved with `useUpdateWorkItem` (optimistic, start and due in one patch); a refusal of the server puts the
 *   bar back and the toast of the mutation says why. A polite status line says what moved and what was saved.
 * - The rows are virtualized (`TimelineRows`, R34), and so is "Ohne Datum" in a box of its own (T21-M8); the row or card
 *   of the cursor stays rendered.
 */

import { usePage, router } from '@inertiajs/react';
import { ChartGantt, FunnelX, Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { formatDay } from '@/components/fields/format';
import { archivedReason, useToday } from '@/components/fields/itemData';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { ItemCard } from '@/components/items/ItemCard';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink } from '@/components/items/ItemLink';
import { listItemName } from '@/components/items/names';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { toast } from '@/components/ui/toast';
import { dateToX, moveRange, PX_PER_DAY, resizeRange, scaleTicks, timelineRange, xToDate, type DateRange, type TimelineScale, type Zoom } from '@/domain/timeline';
import { addDays } from '@/domain/tz';
import { useProjects } from '@/hooks/projects';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { intlLocale, t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { ListedItem } from '@/types';
import type { LayoutProps } from '../layouts';
import { ListSkeleton } from '../ListStates';
import { focusIsNeutral, revealBelowToolbar, useSelection } from '../selection/useSelection';
import { useDocumentTop } from '../useDocumentTop';
import { AXIS_HEIGHT, TimelineAxis, TimelineGrid } from './TimelineAxis';
import { TimelineBar } from './TimelineBar';
import { TimelineRows, useTimelineRows, type TimelineSection } from './TimelineRows';
import { Unplanned } from './Unplanned';
import { useTimelineDrag } from './useTimelineDrag';
import { useTimelineKeys, type Nudge } from './useTimelineKeys';

/** "Ab heute einplanen" and a drop from "Ohne Datum": two weeks, the start day included. */
export const PLANNED_DAYS = 14;
/** Held keys move the bar at once; the dates are saved once the keys rest this long. */
export const SAVE_DELAY = 450;
/** How long an epic that moves between "Ohne Datum" and the axis takes the focus along. */
const FOLLOW_MS = 1500;

const ZOOMS: readonly Zoom[] = ['week', 'month', 'quarter'];
const zoomOf = (value: string | null): Zoom => (value === 'week' || value === 'quarter' ? value : 'month');

/** Row looks, laid over the paper the sticky title column needs (the highlighter's wash for the selection). */
const WASH = '[background-image:linear-gradient(var(--select-wash),var(--select-wash))]';
const TINT = '[background-image:linear-gradient(var(--accent-soft),var(--accent-soft))]';
const PRESSED = '[background-image:linear-gradient(var(--pressed),var(--pressed))]';
const HOVER = 'hover:[background-image:linear-gradient(var(--hover),var(--hover))]';

/** The keyboard part of a row or card: the cursor follows the focus, ⇧ and a click on the title select a range. */
export interface NavProps {
  ref(element: HTMLElement | null): (() => void) | undefined;
  onFocus(): void;
  onClickCapture(event: MouseEvent<HTMLElement>): void;
}

/** The page's address with `zoom` set (none for the month); everything else of the query stays. */
function addressWith(url: string, zoom: Zoom): string {
  const address = new URL(url, window.location.origin);
  if (zoom === 'month') address.searchParams.delete('zoom');
  else address.searchParams.set('zoom', zoom);
  return `${address.pathname}${address.search}`;
}

export function TimelineLayout({ groups, groupBy, project, createDefaults, filtered = false, onResetFilter, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const types = useWorkItemTypes().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;
  const { reason } = usePermissions();
  const update = useUpdateWorkItem();
  const { today, weekStart } = useToday();
  const flashIds = useUiStore((state) => state.flashIds);
  const peekItemId = useUiStore((state) => state.peekItemId);
  const headingId = useId();

  // the zoom is part of the address (a link shows the same zoom); the list state leaves the parameter alone
  const { url } = usePage();
  const zoom = zoomOf(new URL(url, window.location.origin).searchParams.get('zoom'));
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DateRange>>(() => new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');

  /* --------------------------------------------------------------------------- epics */

  // the list asks for epics only; an item whose type is no epic (any more) does not stand here all the same
  const epicTypes = useMemo(() => new Map((types ?? []).filter((type) => type.is_epic).map((type) => [type.id, type])), [types]);
  const sections = useMemo<TimelineSection[]>(
    () =>
      groups.map((group) => ({
        key: group.key,
        label: group.label,
        project: projects?.find((entry) => entry.id === group.key),
        items: group.items.filter((item) => epicTypes.has(item.type_id)),
      })),
    [groups, projects, epicTypes],
  );
  const epics = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const epicById = useMemo(() => new Map(epics.map((item) => [item.id, item])), [epics]);

  /** The dates a bar shows: the draft of a drag or held key, else the saved ones; one date alone stands for both. */
  const datesOf = useCallback(
    (item: ListedItem): DateRange | null => {
      const draft = drafts.get(item.id);
      if (draft) return draft;
      const start = item.start_date ?? item.due_date;
      const due = item.due_date ?? item.start_date;
      return start && due ? { start, due } : null;
    },
    [drafts],
  );
  const dated = useMemo(
    () => sections.map((section) => ({ ...section, items: section.items.filter((item) => datesOf(item)) })).filter((section) => section.items.length > 0),
    [sections, datesOf],
  );
  const undated = useMemo(() => epics.filter((item) => !datesOf(item)), [epics, datesOf]);
  const order = useMemo(() => [...dated.flatMap((section) => section.items.map((item) => item.id)), ...undated.map((item) => item.id)], [dated, undated]);
  const all = useMemo(() => epics.map((item) => item.id), [epics]);

  const latest = useRef({ drafts, epicById });
  useLayoutEffect(() => {
    latest.current = { drafts, epicById };
  });

  /* ---------------------------------------------------------------------------- axis */

  // compared as one string: a new array with the same days keeps the axis as it is
  const dayKey = epics.flatMap((item) => Object.values(datesOf(item) ?? {})).join(',');
  const range = useMemo(() => timelineRange(dayKey ? dayKey.split(',') : [], today, zoom, weekStart), [dayKey, today, zoom, weekStart]);
  const scale = useMemo<TimelineScale>(() => ({ start: range.start, zoom, px_per_day: PX_PER_DAY[zoom] }), [range.start, zoom]);
  const width = dateToX(addDays(range.end, 1), scale);
  const ticks = useMemo(() => scaleTicks(range, zoom, weekStart), [range, zoom, weekStart]);

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  /** Scrolls "Ohne Datum" to an epic's card (its list is virtualized as well). */
  const revealUnplanned = useRef<((id: string) => void) | null>(null);
  const labelWidth = () => scroller.current?.querySelector<HTMLElement>('[data-timeline-label]')?.offsetWidth ?? 0;
  const { entries, virtualizer, indexOf } = useTimelineRows(dated, scroller, cursorId);

  /** Scrolls the axis so that a day stands at a share of the visible width. */
  const scrollToDay = useCallback(
    (day: string, share: number) => {
      const box = scroller.current!;
      box.scrollLeft = Math.max(0, dateToX(day, scale) - (box.clientWidth - labelWidth()) * share);
    },
    [scale],
  );

  // today stands at a third on the first view; a new zoom keeps the day in the middle; an axis that grows to the left
  // (a bar dragged before its start) keeps what is shown in place
  const shown = useRef<{ start: string; zoom: Zoom } | null>(null);
  const keepDay = useRef<string | null>(null);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const before = shown.current;
    shown.current = { start: scale.start, zoom };
    if (!before) scrollToDay(today, 1 / 3);
    else if (before.zoom !== zoom) scrollToDay(keepDay.current ?? today, 1 / 2);
    else if (before.start !== scale.start) box.scrollLeft += dateToX(before.start, scale);
  });

  function changeZoom(next: Zoom) {
    const box = scroller.current!;
    keepDay.current = xToDate(box.scrollLeft + (box.clientWidth - labelWidth()) / 2, scale);
    router.replace({ url: addressWith(url, next), preserveState: true, preserveScroll: true });
  }

  // the box fills the window below the bars of the screen
  const top = useDocumentTop(scroller, [entries.length, width]);

  /* --------------------------------------------------------------------------- focus */

  /** Scrolls the axis just enough that a day stands in view, clear of the titles. */
  const revealDay = useCallback(
    (day: string) => {
      const box = scroller.current;
      if (!box) return;
      const visible = box.clientWidth - labelWidth();
      const x = dateToX(day, scale);
      if (x < box.scrollLeft + 24) box.scrollLeft = x - 24;
      else if (x + scale.px_per_day > box.scrollLeft + visible - 24) box.scrollLeft = x + scale.px_per_day - visible + 24;
    },
    [scale],
  );

  /**
   * Brings an epic into view: its row below the axis and the page below the toolbar. The axis only scrolls when no part
   * of the bar is in view (to its start), so the cursor does not drag the view along.
   */
  const reveal = useCallback(
    (element: HTMLElement, id: string) => {
      const box = scroller.current;
      if (box?.contains(element)) {
        const outer = box.getBoundingClientRect();
        const inner = element.getBoundingClientRect();
        if (inner.top < outer.top + AXIS_HEIGHT) box.scrollTop -= outer.top + AXIS_HEIGHT - inner.top;
        else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
        const item = latest.current.epicById.get(id)!;
        const dates = latest.current.drafts.get(id) ?? { start: item.start_date ?? item.due_date!, due: item.due_date ?? item.start_date! };
        const visible = box.clientWidth - labelWidth();
        const left = dateToX(dates.start, scale);
        const right = dateToX(dates.due, scale) + scale.px_per_day;
        if (right < box.scrollLeft || left > box.scrollLeft + visible) revealDay(dates.start);
      }
      revealBelowToolbar(element);
    },
    [scale, revealDay],
  );

  /** Focuses an epic's row or card now, or as soon as it is rendered (a row far down comes into view first). */
  const focusRow = useCallback(
    (id: string) => {
      const index = indexOf(id);
      if (index >= 0 && !rows.current.get(id)?.isConnected) virtualizer.scrollToIndex(index, { align: 'auto' });
      // a card of "Ohne Datum" scrolls into its box (its own scroll, not the axis's)
      if (index < 0) revealUnplanned.current?.(id);
      let attempts = 0;
      const attempt = () => {
        const element = rows.current.get(id);
        if (element?.isConnected) {
          element.focus({ preventScroll: true });
          reveal(element, id);
        } else if (attempts++ < 12) requestAnimationFrame(attempt);
      };
      attempt();
    },
    [indexOf, virtualizer, reveal],
  );

  /** An epic that moves between "Ohne Datum" and the axis is mounted anew: the focus goes with it. */
  const following = useRef<string | null>(null);
  const follow = (id: string) => {
    following.current = id;
    setTimeout(() => {
      if (following.current === id) following.current = null;
    }, FOLLOW_MS);
  };
  useLayoutEffect(() => {
    const id = following.current;
    if (!id || !focusIsNeutral()) return;
    rows.current.get(id)?.focus({ preventScroll: true });
  });

  const { clickSelect } = useSelection({ order, all, onSelectAll, cursorId, onCursor, selection, onSelect, onOpen, onPeek, focus: focusRow, container: root });

  /* --------------------------------------------------------------------------- dates */

  const editReason = (item: ListedItem) => (item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id));
  // the same refusal again refreshes the error toast on screen in place instead of stacking a second one
  const refuse = (item: ListedItem, why: string) => toast({ title: t('items.timeline.not_changed', { key: item.key }), description: why, tone: 'error' });
  const rangeText = (dates: DateRange) => t('items.timeline.range', { start: formatDay(dates.start), due: formatDay(dates.due) });

  const setDraft = (id: string, dates: DateRange) => setDrafts((current) => new Map(current).set(id, dates));
  /** Drops a draft once its dates are saved (or refused, or a drag cancelled), unless a newer one replaced it. */
  const dropDraft = (id: string, dates: DateRange) =>
    setDrafts((current) => {
      if (current.get(id) !== dates) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  const mark = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function save(id: string, dates: DateRange) {
    const item = latest.current.epicById.get(id);
    if (!item || (dates.start === item.start_date && dates.due === item.due_date)) {
      dropDraft(id, dates);
      return;
    }
    mark(id, true);
    try {
      await update.mutateAsync({ id, patch: { start_date: dates.start, due_date: dates.due } });
      setAnnouncement(t('items.timeline.saved', { key: item.key, range: rangeText(dates) }));
    } catch {
      // the mutation has put the dates back and named the cause in a toast
    } finally {
      mark(id, false);
      dropDraft(id, dates);
    }
  }
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });

  /** Held keys: the bar moves at once, the dates are saved when the keys rest. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // dates that are moved but not saved yet (keys that have not rested, a save on its way) would go with the page: the
  // browser asks first (T21-M2); a draft lives until its save is done
  const unsaved = drafts.size > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(
    () => () => {
      // a layout switch (1–4) right after a key: save what was moved
      for (const [id, timer] of timers.current) {
        clearTimeout(timer);
        const dates = latest.current.drafts.get(id);
        if (dates) void saveRef.current(id, dates);
      }
    },
    [],
  );

  /** Puts an epic from "Ohne Datum" on the axis, from a day on (today by default). */
  function plan(item: ListedItem, start = today) {
    const denied = editReason(item);
    if (denied) return refuse(item, denied);
    const dates = { start, due: addDays(start, PLANNED_DAYS - 1) };
    setDraft(item.id, dates);
    follow(item.id);
    setAnnouncement(t('items.timeline.planned', { key: item.key, range: rangeText(dates) }));
    void save(item.id, dates);
  }

  function nudge(kind: Nudge, step: 1 | -1) {
    const item = cursorId ? epicById.get(cursorId) : undefined;
    if (!item) return;
    const denied = editReason(item);
    if (denied) return refuse(item, denied);
    const current = datesOf(item);
    if (!current) {
      if (kind === 'move' && step === 1) plan(item);
      else setAnnouncement(t('items.timeline.no_dates_yet', { key: item.key }));
      return;
    }
    const next = kind === 'move' ? moveRange(current, zoom, step) : resizeRange(current, zoom, step);
    setDraft(item.id, next);
    setAnnouncement(t('items.timeline.moving', { key: item.key, range: rangeText(next) }));
    clearTimeout(timers.current.get(item.id));
    timers.current.set(
      item.id,
      setTimeout(() => {
        timers.current.delete(item.id);
        // only the dates of the last key: a drag since then saved its own (T21-M3)
        if (latest.current.drafts.get(item.id) === next) void saveRef.current(item.id, next);
      }, SAVE_DELAY),
    );
    // the edge that moves stays in view: the start of a moved bar, the end of a longer or shorter one
    requestAnimationFrame(() => revealDay(kind === 'move' ? next.start : next.due));
  }

  /** Whether the cursor's epic can go that way: one it may change, with dates, or ⇧→ that plans it. */
  function can(kind: Nudge, step: 1 | -1) {
    const item = cursorId ? epicById.get(cursorId) : undefined;
    return item !== undefined && editReason(item) === null && (datesOf(item) !== null || (kind === 'move' && step === 1));
  }

  const inTimeline = () => focusIsNeutral() || Boolean(root.current?.contains(document.activeElement));
  useTimelineKeys({ inTimeline, nudge, can, unit: t(`items.timeline.unit.${zoom}`) });

  /* ------------------------------------------------------------------------- pointer */

  /** The day under a point of the window, when it lies on the axis (not under the titles). */
  function dayAt(x: number, y: number): string | null {
    const box = scroller.current!.getBoundingClientRect();
    const area = grid.current!.getBoundingClientRect();
    if (y < box.top || y > box.bottom || x > box.right || x < box.left + labelWidth()) return null;
    return xToDate(x - area.left, scale);
  }

  const drag = useTimelineDrag({
    scale,
    datesOf,
    editReason,
    setDraft,
    dropDraft,
    save: (id, dates) => void save(id, dates),
    plan,
    onPeek,
    press: (id) => rows.current.get(id)?.focus({ preventScroll: true, focusVisible: false }),
    dayAt,
    cancelled: (item) => setAnnouncement(t('items.timeline.drag_cancelled', { key: item.key })),
    stayed: (item) => setAnnouncement(t('items.timeline.stays_undated', { key: item.key })),
  });

  /* ---------------------------------------------------------------------------- view */

  // the answer of the layout before (1–4 switched to the timeline) stands until the epics by project are there: the
  // skeleton, so the focus waits for the row of the cursor (the screen's focus rescue) instead of a row that goes again
  if (groupBy !== 'project') return <ListSkeleton layout="timeline" loadingLayout />;
  if (epics.length === 0) return <TimelineEmpty project={project} createDefaults={createDefaults} filtered={filtered} onResetFilter={onResetFilter} />;

  const stop = cursorId !== null && order.includes(cursorId) ? cursorId : order[0];
  const planningItem = drag.planning ? epicById.get(drag.planning.id) : undefined;
  const draftList = [...drafts];

  /** What an epic says to a screen reader besides key and title: its dates, the progress of its children. */
  const nameParts = (item: ListedItem, dates: DateRange | null) => {
    const progress = item.children_progress;
    return [dates ? rangeText(dates) : t('items.timeline.no_dates'), ...(progress ? [t('items.timeline.progress', { done: progress.done, total: progress.total })] : [])];
  };
  const lookOf = (item: ListedItem) => (flashIds.includes(item.id) ? TINT : peekItemId === item.id ? PRESSED : undefined);

  function navProps(item: ListedItem): NavProps {
    return {
      ref: (element) => {
        if (!element) return undefined;
        rows.current.set(item.id, element);
        return () => {
          if (rows.current.get(item.id) === element) rows.current.delete(item.id);
        };
      },
      onFocus: () => {
        if (cursorId !== item.id) onCursor(item.id);
      },
      onClickCapture: (event) => {
        if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
        event.preventDefault();
        event.stopPropagation();
        clickSelect(item.id, true);
      },
    };
  }

  function renderRow(item: ListedItem) {
    const dates = datesOf(item)!;
    const type = epicTypes.get(item.type_id)!;
    const selected = selection.includes(item.id);
    const look = selected ? WASH : (lookOf(item) ?? HOVER);
    return (
      <div
        {...navProps(item)}
        data-nav-target=""
        tabIndex={item.id === stop ? 0 : -1}
        role="group"
        aria-label={listItemName(item, selected, ...nameParts(item, dates))}
        aria-busy={busy.has(item.id) || undefined}
        // the ring is drawn by the last child, above the sticky title cell that would cover it
        data-focus-ring="none"
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onOpen(item.id);
          }
        }}
        className={cx('group/row relative flex h-11 w-full outline-none', look)}
      >
        <div className={cx('sticky left-0 z-10 flex w-(--label-w) shrink-0 items-center gap-2 bg-paper px-4', look)}>
          <TypeGlyph type={type} />
          <ItemKey value={item.key} className="shrink-0 text-sm text-muted max-sm:hidden" />
          <ItemLink item={item} onOpen={onPeek} tabIndex={-1} className="min-w-0 truncate text-ui text-ink">
            <span className="sr-only sm:hidden">{item.key} </span>
            <span className={cx(selected && 'hl')}>{item.title}</span>
          </ItemLink>
        </div>
        <div className="relative shrink-0" style={{ width }}>
          <TimelineBar
            item={item}
            tone={type.tone}
            dates={dates}
            scale={scale}
            editable={editReason(item) === null}
            dragging={drag.dragging === item.id}
            handlers={drag.barHandlers(item)}
          />
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[15] hidden outline-2 -outline-offset-2 outline-(--focus-ring) [box-shadow:var(--focus-halo)] group-focus-visible/row:block"
        />
      </div>
    );
  }

  const monthYear = new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthOf = (day: string) => monthYear.format(new Date(`${day}T00:00:00Z`));

  return (
    <div ref={root} className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div role="status" aria-label={t('items.timeline.announcements')} className="sr-only">
        {announcement}
      </div>

      <section aria-labelledby={headingId} className="dots min-w-0 flex-1 overflow-hidden rounded-card border border-line-strong bg-paper shadow-elev-1">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <h2 id={headingId} className="font-display text-lg font-bold tracking-title text-ink">
            {t('items.timeline.title')}
          </h2>
          <p className="text-ui text-muted">{t('items.timeline.span', { from: monthOf(range.start), to: monthOf(range.end) })}</p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => scrollToDay(today, 1 / 3)}>
              {t('items.timeline.today_button')}
            </Button>
            <SegmentedControl
              label={t('items.timeline.zoom.label')}
              size="sm"
              value={zoom}
              onValueChange={changeZoom}
              options={ZOOMS.map((value) => ({ value, label: t(`items.timeline.zoom.${value}`) }))}
            />
          </div>
        </header>

        <div
          ref={scroller}
          data-timeline-scroller=""
          className="relative overflow-auto overscroll-contain [--label-w:8.5rem] sm:[--label-w:14.5rem]"
          style={{ maxHeight: `max(16rem, calc(100dvh - ${top}px - 1rem))` }}
        >
          <div className="relative w-max min-w-full">
            <TimelineAxis scale={scale} width={width} ticks={ticks} today={today} drafts={draftList} planningDay={drag.planning?.day ?? null} />
            <TimelineGrid
              scale={scale}
              width={width}
              ticks={ticks}
              today={today}
              drafts={draftList}
              planningDay={drag.planning?.day ?? null}
              days={zoom === 'week'}
              gridRef={grid}
            />
            <TimelineRows entries={entries} virtual={virtualizer.getVirtualItems()} totalSize={virtualizer.getTotalSize()} renderRow={renderRow} />
            {dated.length === 0 && <p className="sticky left-0 w-[min(100%,40rem)] px-4 py-6 text-ui text-pretty text-muted">{t('items.timeline.none_dated')}</p>}
          </div>
        </div>
      </section>

      <Unplanned
        items={undated}
        stop={stop}
        selection={selection}
        planningId={drag.planning?.id ?? null}
        navProps={navProps}
        lookOf={lookOf}
        nameParts={(item) => nameParts(item, null)}
        editReason={editReason}
        busy={(item) => busy.has(item.id)}
        onPlan={(item) => plan(item)}
        onPlanPointerDown={drag.onPlanPointerDown}
        onOpen={onOpen}
        onPeek={onPeek}
        revealRef={revealUnplanned}
      />

      {drag.planning && planningItem && (
        <div
          aria-hidden="true"
          className={cx('pointer-events-none fixed top-0 left-0 z-40 flow-root', drag.planning.returning && 'transition-transform duration-420 ease-spring')}
          style={{
            width: drag.planning.home.width,
            transform: drag.planning.returning
              ? `translate3d(${drag.planning.home.x}px, ${drag.planning.home.y}px, 0)`
              : `translate3d(${drag.planning.x - drag.planning.grip.x}px, ${drag.planning.y - drag.planning.grip.y}px, 0)`,
          }}
        >
          <ItemCard item={planningItem} compact onOpen={() => {}} lifted={!drag.planning.returning} />
        </div>
      )}
    </div>
  );
}

/** No epic in the list: only epics stand on the timeline; with a filter that hides items, the way back to all of them. */
function TimelineEmpty({ project, createDefaults, filtered, onResetFilter }: Pick<LayoutProps, 'project' | 'createDefaults' | 'filtered' | 'onResetFilter'>) {
  const types = useWorkItemTypes().data?.items ?? [];
  const { reason } = usePermissions();
  if (filtered && onResetFilter) {
    return (
      <EmptyState
        icon={FunnelX}
        title={t('items.timeline.empty.filtered_title')}
        description={t('items.empty.filtered.changed')}
        actions={
          <Button variant="secondary" icon={FunnelX} onClick={onResetFilter}>
            {t('items.empty.filtered.reset')}
          </Button>
        }
      />
    );
  }
  const epicType = types.find((type) => type.is_epic && type.archived_at === null && (!project || project.enabled_type_ids.includes(type.id)));
  return (
    <EmptyState
      icon={ChartGantt}
      title={t('items.timeline.empty.title')}
      description={t('items.timeline.empty.description')}
      actions={
        epicType && (
          <Button
            variant="primary"
            icon={Plus}
            disabledReason={reason('item.create', project?.id)}
            onClick={() => useUiStore.getState().openCreate({ ...createDefaults, type_id: epicType.id })}
          >
            {t('items.timeline.empty.create', { type: epicType.name })}
          </Button>
        )
      }
    />
  );
}
