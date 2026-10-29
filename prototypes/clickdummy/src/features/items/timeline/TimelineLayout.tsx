/*
 * The timeline (spec 4.11, moodboard "Liste und Timeline"): the epics of the list on a time axis, grouped by project,
 * each a bar from its start to its due date in the tone of its type, filled by the progress of its children. A line
 * in ink blue marks today, the highlighter names it. Zoom: Woche, Monat, Quartal (timelineScale.ts).
 *
 * - Only items of types with the "Epic" tick stand here. Epics without dates wait in "Ohne Datum" beside the axis:
 *   dragged onto it they start on the day under the pointer, "Ab heute einplanen" starts them today (two weeks).
 * - Dragging a bar moves it, dragging its ends changes start or due date, a day at a time. A click on a bar or on the
 *   title opens the preview. Touch scrolls the axis instead of dragging (on a phone the timeline is for reading).
 * - Keyboard (spec: "per Tastatur verschieben die Pfeiltasten am ausgewählten Epic um eine Einheit"): ⇧←/⇧→ move the
 *   epic under the cursor by one unit of the zoom (a day, a week, a month), ⌥←/⌥→ change its due date. Held keys move
 *   the bar at once and save once they rest. ↑/↓, j/k, x, Enter and the space bar come from `useSelection`.
 * - Dates are saved with `useUpdateWorkItem` (optimistic); a refusal puts the bar back and the toast says why.
 */

import { CalendarPlus, ChartGantt, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useParams, useSearchParams } from 'react-router';
import { formatDay, formatShortDay } from '@/components/fields/format';
import { archivedReason } from '@/components/fields/itemData';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { ItemCard } from '@/components/items/ItemCard';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink } from '@/components/items/ItemLink';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { addDays } from '@/domain/tz';
import { useProjects } from '@/hooks/projects';
import { useUpdateWorkItem, useWorkItemMeta } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { usePermissions } from '@/lib/permissions';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { Project, TypeTone, WorkItem } from '@/types';
import type { LayoutProps } from '../display/layouts';
import { revealBelowToolbar, useSelection } from '../selection/useSelection';
import {
  dateToX,
  moveRange,
  PX_PER_DAY,
  resizeRange,
  scaleTicks,
  timelineRange,
  UNIT_LABELS,
  xToDate,
  ZOOM_LABELS,
  type DateRange,
  type TimelineScale,
  type Zoom,
} from './timelineScale';

/** "Ab heute einplanen" and a drop from "Ohne Datum": two weeks, the start day included. */
const PLANNED_DAYS = 14;
/** Held keys move the bar at once; the dates are saved once the keys rest this long. */
const SAVE_DELAY = 450;

const COLLATOR = new Intl.Collator('de-DE', { numeric: true, sensitivity: 'base' });
const PERCENT = new Intl.NumberFormat('de-DE', { style: 'percent' });
const MONTH_YEAR = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthYear = (day: string) => MONTH_YEAR.format(new Date(`${day}T00:00:00Z`));

/** The bar in the tone of the epic's type: the tab colour with an edge in the tone, the progress in the tone. */
const BAR: Record<TypeTone, { bar: string; fill: string }> = {
  sky: { bar: 'bg-sky-tab ring-sky', fill: 'bg-sky' },
  ochre: { bar: 'bg-ochre-tab ring-ochre', fill: 'bg-ochre' },
  moss: { bar: 'bg-moss-tab ring-moss', fill: 'bg-moss' },
  plum: { bar: 'bg-plum-tab ring-plum', fill: 'bg-plum' },
  sand: { bar: 'bg-sand-tab ring-sand', fill: 'bg-sand' },
  slate: { bar: 'bg-slate-tab ring-slate', fill: 'bg-slate' },
};

/** How far the hit area of a bar reaches beyond its ends, and the grip that changes a date (a line shows on hover). */
const BAR_REACH = 12;
const GRIP =
  "absolute inset-y-0 cursor-ew-resize after:absolute after:inset-y-3 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-ink/40 after:opacity-0 after:transition-opacity after:duration-120 after:content-[''] hover:after:opacity-100";

/** Row looks, laid over the paper the sticky title column needs (the highlighter's wash for the selection). */
const WASH = '[background-image:linear-gradient(var(--select-wash),var(--select-wash))]';
const TINT = '[background-image:linear-gradient(var(--accent-soft),var(--accent-soft))]';
const PRESSED = '[background-image:linear-gradient(var(--pressed),var(--pressed))]';

/** No element in particular has the focus: the page itself or the main area. */
function focusIsNeutral(): boolean {
  const element = document.activeElement;
  return !element || element === document.body || element.id === 'main';
}

const earlier = (a: string, b: string) => (a < b ? a : b);
const later = (a: string, b: string) => (a > b ? a : b);

/** A bar dragged by the pointer: its ends move a day at a time. */
interface BarDrag {
  id: string;
  mode: 'move' | 'start' | 'due';
  x: number;
  range: DateRange;
  last: DateRange;
  moved: boolean;
  /** The person may not change the item: the bar does not move, a click still opens the preview. */
  locked: boolean;
}

/** An epic from "Ohne Datum" on its way to the axis. */
interface PlanDrag {
  id: string;
  x: number;
  y: number;
  /** Where the pointer holds the card, and the card's place in the list (it springs back there). */
  grip: { x: number; y: number };
  home: { x: number; y: number; width: number };
  /** The day under the pointer, when it is over the axis. */
  day: string | null;
  returning: boolean;
}

export function TimelineLayout({ items, ctx, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const { identifier } = useParams();
  const types = useWorkItemTypes().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;
  const meta = useWorkItemMeta().data;
  const { reason } = usePermissions();
  const update = useUpdateWorkItem();
  const flashIds = useUiStore((state) => state.flashIds);
  const peekItemId = useUiStore((state) => state.peekItemId);
  const headingId = useId();
  const asideHeadingId = useId();

  // the zoom is part of the address (a link shows the same zoom); the list screen leaves the parameter alone
  const [params, setParams] = useSearchParams();
  const zoomParam = params.get('zoom');
  const zoom: Zoom = zoomParam === 'week' || zoomParam === 'quarter' ? zoomParam : 'month';
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DateRange>>(() => new Map());
  const draftsRef = useRef(drafts);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    draftsRef.current = drafts;
    itemsRef.current = items;
  });
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');

  /* --------------------------------------------------------------------------- epics */

  const epicTypes = useMemo(() => new Map((types ?? []).filter((type) => type.is_epic).map((type) => [type.id, type])), [types]);
  const epics = useMemo(() => items.filter((item) => epicTypes.has(item.type_id)), [items, epicTypes]);
  const epicById = useMemo(() => new Map(epics.map((item) => [item.id, item])), [epics]);

  /** The dates a bar shows: the draft of a drag or held key, else the saved ones; one date alone stands for both. */
  const datesOf = useCallback(
    (item: WorkItem): DateRange | null => {
      const draft = drafts.get(item.id);
      if (draft) return draft;
      const start = item.start_date ?? item.due_date;
      const due = item.due_date ?? item.start_date;
      return start && due ? { start, due } : null;
    },
    [drafts],
  );

  const sections = useMemo(() => {
    const byProject = new Map<string, WorkItem[]>();
    for (const item of epics) {
      if (!datesOf(item)) continue;
      byProject.set(item.project_id, [...(byProject.get(item.project_id) ?? []), item]);
    }
    // rows keep their order while a bar is dragged: by the saved start, then by key
    const saved = (item: WorkItem) => item.start_date ?? item.due_date ?? '';
    return [...byProject]
      .map(([projectId, list]) => ({
        project: projects?.find((project) => project.id === projectId),
        projectId,
        items: [...list].sort((a, b) => (saved(a) < saved(b) ? -1 : saved(a) > saved(b) ? 1 : COLLATOR.compare(a.key, b.key))),
      }))
      .sort((a, b) => COLLATOR.compare(a.project?.name ?? '', b.project?.name ?? ''));
  }, [epics, datesOf, projects]);
  const undated = useMemo(() => epics.filter((item) => !datesOf(item)), [epics, datesOf]);
  const order = useMemo(() => [...sections.flatMap((section) => section.items.map((item) => item.id)), ...undated.map((item) => item.id)], [sections, undated]);
  const all = useMemo(() => epics.map((item) => item.id), [epics]);

  /* ---------------------------------------------------------------------------- axis */

  const dayList = epics.flatMap((item) => {
    const range = datesOf(item);
    return range ? [range.start, range.due] : [];
  });
  // compared as one string: a new array with the same days keeps the axis as it is
  const dayKey = dayList.join(',');
  const range = useMemo(() => timelineRange(dayKey ? dayKey.split(',') : [], ctx.today, zoom), [dayKey, ctx.today, zoom]);
  const scale = useMemo<TimelineScale>(() => ({ start: range.start, zoom, px_per_day: PX_PER_DAY[zoom] }), [range.start, zoom]);
  const width = dateToX(addDays(range.end, 1), scale);
  const ticks = useMemo(() => scaleTicks(range, zoom), [range, zoom]);
  const todayX = dateToX(ctx.today, scale) + scale.px_per_day / 2;

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const labelWidth = () => scroller.current?.querySelector<HTMLElement>('[data-timeline-label]')?.offsetWidth ?? 0;

  /** Scrolls the axis so that a day stands at a share of the visible width. */
  const scrollToDay = useCallback(
    (day: string, share: number) => {
      const box = scroller.current;
      if (!box) return;
      const visible = box.clientWidth - labelWidth();
      box.scrollLeft = Math.max(0, dateToX(day, scale) - visible * share);
    },
    [scale],
  );

  // today stands at a third on the first view; a new zoom keeps the day in the middle; an axis that grows to the
  // left (a bar dragged before its start) keeps what is shown in place
  const shown = useRef<{ start: string; zoom: Zoom } | null>(null);
  const keepDay = useRef<string | null>(null);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const before = shown.current;
    shown.current = { start: scale.start, zoom };
    if (!before) scrollToDay(ctx.today, 1 / 3);
    else if (before.zoom !== zoom) scrollToDay(keepDay.current ?? ctx.today, 1 / 2);
    else if (before.start !== scale.start) box.scrollLeft += dateToX(before.start, scale);
  });

  function changeZoom(next: Zoom) {
    const box = scroller.current;
    if (box) keepDay.current = xToDate(box.scrollLeft + (box.clientWidth - labelWidth()) / 2, scale);
    setParams(
      (previous) => {
        const nextParams = new URLSearchParams(previous);
        if (next === 'month') nextParams.delete('zoom');
        else nextParams.set('zoom', next);
        return nextParams;
      },
      { replace: true },
    );
  }

  // the box fills the window below the bars of the screen
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    const next = Math.round((scroller.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    setTop((previous) => (previous === next ? previous : next));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

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
        const axis = box.querySelector<HTMLElement>('[data-timeline-axis]')?.offsetHeight ?? 0;
        const outer = box.getBoundingClientRect();
        const inner = element.getBoundingClientRect();
        if (inner.top < outer.top + axis) box.scrollTop -= outer.top + axis - inner.top;
        else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
        const item = itemsRef.current.find((entry) => entry.id === id);
        const dates = item ? (draftsRef.current.get(id) ?? (item.start_date && item.due_date ? { start: item.start_date, due: item.due_date } : null)) : null;
        if (dates) {
          const visible = box.clientWidth - labelWidth();
          const left = dateToX(dates.start, scale);
          const right = dateToX(dates.due, scale) + scale.px_per_day;
          if (right < box.scrollLeft || left > box.scrollLeft + visible) revealDay(dates.start);
        }
      }
      revealBelowToolbar(element);
    },
    [scale, revealDay],
  );

  const focusRow = useCallback(
    (id: string) => {
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
    [reveal],
  );

  /** An epic that moves between "Ohne Datum" and the axis is mounted anew: the focus goes with it. */
  const following = useRef<string | null>(null);
  const follow = (id: string) => {
    following.current = id;
    setTimeout(() => {
      if (following.current === id) following.current = null;
    }, 1500);
  };
  useLayoutEffect(() => {
    const id = following.current;
    if (!id || !focusIsNeutral()) return;
    const element = rows.current.get(id);
    if (element?.isConnected) element.focus({ preventScroll: true });
  });

  const { clickSelect } = useSelection({ order, all, onSelectAll, cursorId, onCursor, selection, onSelect, onOpen, onPeek, focus: focusRow, container: root });

  /* --------------------------------------------------------------------------- dates */

  const editReason = (item: WorkItem) => (item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id));
  // the same refusal again replaces its toast instead of stacking a second one: toast() does that for errors
  const refuse = (item: WorkItem, why: string) => toast({ title: `${item.key} nicht geändert`, description: why, tone: 'error' });
  const rangeText = (dates: DateRange) => `${formatDay(dates.start)} bis ${formatDay(dates.due)}`;

  const setDraft = (id: string, dates: DateRange) => setDrafts((current) => new Map(current).set(id, dates));
  /** Drops a draft once its dates are saved (or refused), unless a newer one replaced it meanwhile. */
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

  async function save(id: string, dates = draftsRef.current.get(id)) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || !dates) return;
    if (dates.start === item.start_date && dates.due === item.due_date) {
      dropDraft(id, dates);
      return;
    }
    mark(id, true);
    try {
      await update.mutateAsync({ id, patch: { start_date: dates.start, due_date: dates.due } });
      setAnnouncement(`${item.key} gespeichert: ${rangeText(dates)}.`);
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
  useEffect(
    () => () => {
      // a layout switch (1–4) right after a key: save what was moved
      for (const [id, timer] of timers.current) {
        clearTimeout(timer);
        void saveRef.current(id);
      }
    },
    [],
  );

  /** Puts an epic from "Ohne Datum" on the axis, from a day on (today by default). */
  function plan(item: WorkItem, start = ctx.today) {
    const denied = editReason(item);
    if (denied) return refuse(item, denied);
    const dates = { start, due: addDays(start, PLANNED_DAYS - 1) };
    setDraft(item.id, dates);
    follow(item.id);
    setAnnouncement(`${item.key} eingeplant: ${rangeText(dates)}.`);
    void save(item.id, dates);
  }

  function nudge(kind: 'move' | 'resize', step: 1 | -1) {
    const item = cursorId ? epicById.get(cursorId) : undefined;
    if (!item) return;
    const denied = editReason(item);
    if (denied) return refuse(item, denied);
    const current = datesOf(item);
    if (!current) {
      if (kind === 'move' && step === 1) plan(item);
      else setAnnouncement(`${item.key} hat noch keine Daten. Umschalt mit Pfeil rechts plant es ab heute ein.`);
      return;
    }
    const next = kind === 'move' ? moveRange(current, zoom, step) : resizeRange(current, zoom, step);
    setDraft(item.id, next);
    setAnnouncement(`${item.key}: ${rangeText(next)}`);
    clearTimeout(timers.current.get(item.id));
    timers.current.set(
      item.id,
      setTimeout(() => {
        timers.current.delete(item.id);
        void saveRef.current(item.id);
      }, SAVE_DELAY),
    );
    // the edge that moves stays in view: the start of a moved bar, the end of a longer or shorter one
    requestAnimationFrame(() => revealDay(kind === 'move' ? next.start : next.due));
  }

  const inTimeline = () => focusIsNeutral() || Boolean(root.current?.contains(document.activeElement));
  const unit = UNIT_LABELS[zoom].one;
  useShortcut({ id: 'timeline.later', keys: 'shift+arrowright', scope: 'list', label: `Epic ${unit} später`, group: 'Timeline', repeat: true, when: inTimeline, run: () => nudge('move', 1) });
  useShortcut({ id: 'timeline.earlier', keys: 'shift+arrowleft', scope: 'list', label: `Epic ${unit} früher`, group: 'Timeline', repeat: true, when: inTimeline, run: () => nudge('move', -1) });
  useShortcut({ id: 'timeline.longer', keys: 'alt+arrowright', scope: 'list', label: `Epic ${unit} länger`, group: 'Timeline', repeat: true, when: inTimeline, run: () => nudge('resize', 1) });
  useShortcut({ id: 'timeline.shorter', keys: 'alt+arrowleft', scope: 'list', label: `Epic ${unit} kürzer`, group: 'Timeline', repeat: true, when: inTimeline, run: () => nudge('resize', -1) });

  /* --------------------------------------------------------------------- bar dragging */

  const barDrag = useRef<BarDrag | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  /** How the last press on a bar came: a tap opens the preview (touch scrolls the axis instead of dragging). */
  const lastPointer = useRef<string>('mouse');
  function onBarPointerDown(event: ReactPointerEvent<HTMLElement>, item: WorkItem) {
    lastPointer.current = event.pointerType;
    // touch scrolls the axis; a phone shows the timeline for reading
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const dates = datesOf(item);
    if (!dates) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge;
    // the row becomes the cursor; a pointer shows no keyboard ring, and the wide row must not scroll into view
    event.preventDefault();
    rows.current.get(item.id)?.focus({ preventScroll: true, focusVisible: false });
    event.currentTarget.setPointerCapture(event.pointerId);
    barDrag.current = { id: item.id, mode: edge === 'start' || edge === 'due' ? edge : 'move', x: event.clientX, range: dates, last: dates, moved: false, locked: editReason(item) !== null };
  }

  function onBarPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = barDrag.current;
    if (!state || state.locked) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 4) return;
    if (!state.moved) {
      state.moved = true;
      setDragging(state.id);
    }
    const days = Math.round(dx / scale.px_per_day);
    const { start, due } = state.range;
    state.last =
      state.mode === 'move'
        ? { start: addDays(start, days), due: addDays(due, days) }
        : state.mode === 'start'
          ? { start: earlier(addDays(start, days), due), due }
          : { start, due: later(addDays(due, days), start) };
    setDraft(state.id, state.last);
  }

  function onBarPointerUp() {
    const state = barDrag.current;
    barDrag.current = null;
    if (!state) return;
    setDragging(null);
    // a click on the bar: the preview
    if (!state.moved) return onPeek(state.id);
    void save(state.id, state.last);
  }

  function onBarPointerCancel() {
    const state = barDrag.current;
    barDrag.current = null;
    setDragging(null);
    if (state?.moved) dropDraft(state.id, state.last);
  }

  /* ------------------------------------------------------------- planning by dragging */

  const [planning, setPlanning] = useState<PlanDrag | null>(null);
  /** The day under a point of the window, when it lies on the axis (not under the titles). */
  function dayAt(x: number, y: number): string | null {
    const box = scroller.current?.getBoundingClientRect();
    const area = grid.current?.getBoundingClientRect();
    if (!box || !area || y < box.top || y > box.bottom || x > box.right || x < box.left + labelWidth()) return null;
    return xToDate(x - area.left, scale);
  }

  function onPlanPointerDown(event: ReactPointerEvent<HTMLElement>, item: WorkItem) {
    if (event.button !== 0 || event.pointerType === 'touch' || editReason(item) !== null) return;
    const card = event.currentTarget.getBoundingClientRect();
    const grip = { x: event.clientX - card.left, y: event.clientY - card.top };
    const home = { x: card.left, y: card.top, width: card.width };
    const origin = { x: event.clientX, y: event.clientY };
    let started = false;
    const move = (pointer: PointerEvent) => {
      if (!started && Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < 5) return;
      started = true;
      setPlanning({ id: item.id, x: pointer.clientX, y: pointer.clientY, grip, home, day: dayAt(pointer.clientX, pointer.clientY), returning: false });
    };
    const finish = (pointer: PointerEvent | null) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (!started) return;
      const day = pointer ? dayAt(pointer.clientX, pointer.clientY) : null;
      if (day) {
        setPlanning(null);
        plan(item, day);
        return;
      }
      // not over the axis: the card springs back into the list
      setPlanning((current) => current && { ...current, returning: true });
      setTimeout(() => setPlanning(null), 420);
      setAnnouncement(`${item.key} bleibt ohne Datum.`);
    };
    const up = (pointer: PointerEvent) => finish(pointer);
    const cancel = () => finish(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  /* ---------------------------------------------------------------------------- view */

  const ready = types !== undefined && projects !== undefined;
  const routeProject: Project | undefined = identifier ? projects?.find((project) => project.identifier === identifier) : undefined;
  const epicType = [...epicTypes.values()].find((type) => type.archived_at === null && (!routeProject || routeProject.enabled_type_ids.includes(type.id)));
  const createReason = reason('item.create', routeProject?.id);
  const wanted = cursorId !== null && order.includes(cursorId) ? cursorId : order[0];
  const planningItem = planning ? epicById.get(planning.id) : undefined;

  if (!ready) return <TimelineSkeleton />;

  if (epics.length === 0) {
    return (
      <EmptyState
        icon={ChartGantt}
        title="Keine Epics in dieser Liste"
        description="Die Timeline zeigt nur Items von Typen mit dem Häkchen „Epic“, nach Projekt gruppiert. Lege ein Epic an, oder wechsle mit 1 zur Liste."
        actions={
          epicType && (
            <Button
              variant="primary"
              icon={Plus}
              disabledReason={createReason}
              onClick={() => useUiStore.getState().openCreate({ type_id: epicType.id, ...(routeProject ? { project_id: routeProject.id } : {}) })}
            >
              Neues {epicType.name}
            </Button>
          )
        }
      />
    );
  }

  /** What the row of an epic says to a screen reader, and the look of a row. */
  function rowLabel(item: WorkItem, dates: DateRange | null) {
    const progress = meta?.progress[item.id];
    const parts = [`${item.key} ${item.title}`, dates ? rangeText(dates) : 'ohne Datum'];
    if (progress) parts.push(`${progress.done} von ${progress.total} Kind-Items fertig`);
    if (selection.includes(item.id)) parts.push('ausgewählt');
    return parts.join(', ');
  }
  const lookOf = (item: WorkItem) =>
    selection.includes(item.id) ? WASH : flashIds.includes(item.id) ? TINT : peekItemId === item.id ? PRESSED : 'hover:[background-image:linear-gradient(var(--hover),var(--hover))]';

  /** The keyboard part of a row or card: the cursor, Enter for the page, ⇧ and a click on the title for a range. */
  function navProps(item: WorkItem) {
    return {
      'data-nav-target': '',
      tabIndex: item.id === wanted ? 0 : -1,
      ref: (element: HTMLElement | null) => {
        if (!element) return;
        rows.current.set(item.id, element);
        return () => {
          if (rows.current.get(item.id) === element) rows.current.delete(item.id);
        };
      },
      onFocus: () => {
        if (cursorId !== item.id) onCursor(item.id);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onOpen(item.id);
        }
      },
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
        event.preventDefault();
        event.stopPropagation();
        clickSelect(item.id, true);
      },
    };
  }

  return (
    <div ref={root} className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div role="status" aria-label="Mitteilungen der Timeline" className="sr-only">
        {announcement}
      </div>

      <section aria-labelledby={headingId} className="dots min-w-0 flex-1 overflow-hidden rounded-card border border-line-strong bg-paper shadow-elev-1">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <h2 id={headingId} className="font-display text-lg font-bold tracking-title text-ink">
            Timeline
          </h2>
          <p className="text-ui text-muted">
            Epics nach Projekt, {monthYear(range.start)} bis {monthYear(range.end)}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => scrollToDay(ctx.today, 1 / 3)}>
              Heute
            </Button>
            <SegmentedControl label="Zoom" size="sm" value={zoom} onValueChange={changeZoom} options={(['week', 'month', 'quarter'] as const).map((value) => ({ value, label: ZOOM_LABELS[value] }))} />
          </div>
        </header>

        <div
          ref={scroller}
          className="relative overflow-auto overscroll-contain [--label-w:8.5rem] sm:[--label-w:14.5rem]"
          style={{ maxHeight: `max(16rem, calc(100dvh - ${top}px - 1rem))` }}
        >
          <div className="relative w-max min-w-full">
            {/* the axis: months over days, calendar weeks or months; today in the highlighter */}
            <div data-timeline-axis="" aria-hidden="true" className="sticky top-0 z-20 flex h-14 border-b border-line bg-paper">
              <div data-timeline-label="" className="sticky left-0 z-20 flex w-(--label-w) shrink-0 items-end bg-paper px-4 pb-2 text-sm text-muted">
                Epic
              </div>
              <div className="relative shrink-0 overflow-clip" style={{ width }}>
                {/* a month (or quarter) keeps its name at the left edge while it is in view */}
                {ticks.major.map((tick, index) => {
                  const left = dateToX(tick.date, scale);
                  const right = index + 1 < ticks.major.length ? dateToX(ticks.major[index + 1].date, scale) : width;
                  return (
                    <div key={tick.date} className="absolute top-0 h-7" style={{ left, width: right - left }}>
                      <span className="sticky left-(--label-w) inline-block pt-1.5 pl-1.5 text-sm font-semibold whitespace-nowrap text-ink">{tick.label}</span>
                    </div>
                  );
                })}
                {ticks.minor.map((tick) => (
                  <span key={tick.date} className="absolute bottom-1.5 pl-1.5 text-sm whitespace-nowrap text-muted tabular-nums" style={{ left: dateToX(tick.date, scale) }}>
                    {tick.label}
                  </span>
                ))}
                {planning?.day && (
                  <span className="absolute bottom-1 z-10 -translate-x-1/2 rounded-chip bg-accent px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap text-on-accent tabular-nums" style={{ left: dateToX(planning.day, scale) }}>
                    ab {formatShortDay(planning.day)}
                  </span>
                )}
                {/* a bar that moves (pointer or held keys) shows its first and last day here */}
                {[...drafts].map(([id, dates]) => (
                  <span key={id} className="contents">
                    <span className="absolute bottom-1 z-10 rounded-chip bg-accent px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap text-on-accent tabular-nums" style={{ left: dateToX(dates.start, scale) }}>
                      {formatShortDay(dates.start)}
                    </span>
                    <span
                      className="absolute bottom-1 z-10 -translate-x-full rounded-chip bg-accent px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap text-on-accent tabular-nums"
                      style={{ left: dateToX(dates.due, scale) + scale.px_per_day }}
                    >
                      {formatShortDay(dates.due)}
                    </span>
                  </span>
                ))}
                {/* in the row of the weeks or days, so the name of the month beside it stays readable */}
                <span
                  className="absolute bottom-1 z-10 inline-flex h-6 -translate-x-1/2 items-center rounded-chip bg-marker px-1.5 text-sm font-semibold whitespace-nowrap text-on-marker tabular-nums [box-shadow:var(--mark-glow)]"
                  style={{ left: todayX }}
                >
                  Heute {formatShortDay(ctx.today)}
                </span>
              </div>
            </div>

            {/* the grid behind the rows: unit lines, weekends at week zoom, today */}
            <div ref={grid} aria-hidden="true" className="pointer-events-none absolute top-14 bottom-0 left-(--label-w)" style={{ width }}>
              {zoom === 'week' &&
                ticks.minor
                  .filter((tick) => {
                    const weekday = new Date(`${tick.date}T00:00:00Z`).getUTCDay();
                    return weekday === 0 || weekday === 6;
                  })
                  .map((tick) => <span key={`weekend-${tick.date}`} className="absolute inset-y-0 bg-hover" style={{ left: dateToX(tick.date, scale), width: scale.px_per_day }} />)}
              {ticks.minor.map((tick) => (
                <span key={`minor-${tick.date}`} className={cx('absolute inset-y-0 border-l', tick.strong ? 'border-line-strong' : 'border-line')} style={{ left: dateToX(tick.date, scale) }} />
              ))}
              {ticks.major.slice(1).map((tick) => (
                <span key={`major-${tick.date}`} className="absolute inset-y-0 border-l border-line-strong" style={{ left: dateToX(tick.date, scale) }} />
              ))}
              {planning?.day && <span className="absolute inset-y-0 border-l-2 border-dashed border-accent" style={{ left: dateToX(planning.day, scale) }} />}
              {[...drafts].flatMap(([id, dates]) => [
                <span key={`start-${id}`} className="absolute inset-y-0 border-l border-dashed border-accent" style={{ left: dateToX(dates.start, scale) }} />,
                <span key={`due-${id}`} className="absolute inset-y-0 border-l border-dashed border-accent" style={{ left: dateToX(dates.due, scale) + scale.px_per_day }} />,
              ])}
              <span className="absolute inset-y-0 w-2 -translate-x-1/2 bg-wash" style={{ left: todayX }} />
              <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent" style={{ left: todayX }} />
            </div>

            {sections.map((section) => (
              <ProjectRows key={section.projectId} name={section.project?.name ?? 'Unbekanntes Projekt'} project={section.project}>
                {section.items.map((item) => {
                  const dates = datesOf(item)!;
                  const type = epicTypes.get(item.type_id)!;
                  const progress = meta?.progress[item.id];
                  const x = dateToX(dates.start, scale);
                  const barWidth = dateToX(dates.due, scale) + scale.px_per_day - x;
                  const editable = editReason(item) === null;
                  const tone = BAR[type.tone];
                  // a bar of one day at quarter zoom is 4 px: it is drawn at least 6 px wide, and its grips share it
                  const shown = Math.max(barWidth, 6);
                  const grip = Math.min(24, Math.max(8, shown / 3));
                  return (
                    <li key={item.id}>
                      <div
                        {...navProps(item)}
                        role="group"
                        aria-label={rowLabel(item, dates)}
                        aria-busy={busy.has(item.id) || undefined}
                        // the ring is drawn by the last child, above the sticky title cell that would cover it
                        data-focus-ring="none"
                        className={cx('group/row relative flex h-11 w-max min-w-full outline-none', lookOf(item))}
                      >
                        <div className={cx('sticky left-0 z-10 flex w-(--label-w) shrink-0 items-center gap-2 bg-paper px-4', lookOf(item))}>
                          <TypeGlyph type={type} />
                          <ItemKey value={item.key} className="shrink-0 text-sm text-muted max-sm:hidden" />
                          <ItemLink item={item} onOpen={onPeek} tabIndex={-1} className="min-w-0 truncate text-ui text-ink">
                            <span className="sr-only sm:hidden">{item.key} </span>
                            <span className={cx(selection.includes(item.id) && 'hl')}>{item.title}</span>
                          </ItemLink>
                        </div>
                        <div className="relative shrink-0" style={{ width }}>
                          {/* a dragged bar lifts off the paper: the drag elevation lies under it (the ring of the bar is a shadow too) */}
                          {dragging === item.id && (
                            <span aria-hidden="true" className="absolute top-1/2 h-5 -translate-y-1/2 rounded-chip shadow-elev-drag" style={{ left: x, width: shown }} />
                          )}
                          {/* the hit area: the height of the row and a little wider than the bar, with 24 px grips at its ends */}
                          <div
                            aria-hidden="true"
                            onPointerDown={(event) => onBarPointerDown(event, item)}
                            onPointerMove={onBarPointerMove}
                            onPointerUp={onBarPointerUp}
                            onPointerCancel={onBarPointerCancel}
                            onClick={() => {
                              if (lastPointer.current === 'touch') onPeek(item.id);
                            }}
                            className={cx('absolute inset-y-0 select-none', editable ? (dragging === item.id ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer')}
                            style={{ left: x - BAR_REACH, width: shown + 2 * BAR_REACH }}
                          >
                            <div className={cx('absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-chip ring-1 ring-inset', tone.bar)} style={{ left: BAR_REACH, width: shown }}>
                              {progress && progress.total > 0 && <span className={cx('block h-full', tone.fill)} style={{ width: `${(progress.done / progress.total) * 100}%` }} />}
                            </div>
                            {editable && (
                              <>
                                <span data-edge="start" className={GRIP} style={{ left: BAR_REACH - grip / 2, width: grip }} />
                                <span data-edge="due" className={GRIP} style={{ left: BAR_REACH + shown - grip / 2, width: grip }} />
                              </>
                            )}
                          </div>
                          {progress && progress.total > 0 && (
                            <span aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 pl-2 text-sm font-semibold whitespace-nowrap text-muted tabular-nums" style={{ left: x + shown }}>
                              {PERCENT.format(progress.done / progress.total)}
                            </span>
                          )}
                        </div>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-[15] hidden outline-2 -outline-offset-2 outline-(--focus-ring) [box-shadow:var(--focus-halo)] group-focus-visible/row:block"
                        />
                      </div>
                    </li>
                  );
                })}
              </ProjectRows>
            ))}
            {sections.length === 0 && (
              <p className="sticky left-0 w-[min(100%,40rem)] px-4 py-6 text-ui text-pretty text-muted">
                Noch hat kein Epic dieser Liste ein Datum. Ziehe eines aus „Ohne Datum“ auf die Zeitachse oder plane es ab heute ein.
              </p>
            )}
          </div>
        </div>
      </section>

      <aside aria-labelledby={asideHeadingId} className="flex shrink-0 flex-col rounded-card border border-line bg-surface p-3 shadow-elev-1 lg:w-72">
        <div className="flex items-baseline gap-2 px-1">
          <h2 id={asideHeadingId} className="font-display text-md font-bold tracking-title text-ink">
            Ohne Datum
          </h2>
          <span className="text-sm text-muted tabular-nums">{undated.length}</span>
        </div>
        <p className="mt-0.5 px-1 text-sm text-pretty text-muted">
          {undated.length > 0 ? 'Ziehe ein Epic auf die Zeitachse, oder plane es ab heute für zwei Wochen ein.' : 'Alle Epics dieser Liste haben ein Start- und ein Due-Date.'}
        </p>
        {undated.length > 0 && (
          <ul className="mt-1 flex flex-col gap-2.5">
            {undated.map((item) => {
              const denied = editReason(item);
              return (
                <li key={item.id} className="flex flex-col gap-2">
                  <div
                    onPointerDown={(event) => onPlanPointerDown(event, item)}
                    // the title is a link, which the browser would drag itself
                    onDragStart={(event) => event.preventDefault()}
                    className={cx('flow-root', planning?.id === item.id && 'opacity-40', !denied && 'cursor-grab')}
                  >
                    <ItemCard
                      item={item}
                      compact
                      onOpen={onPeek}
                      selected={selection.includes(item.id)}
                      {...navProps(item)}
                      role="group"
                      aria-label={rowLabel(item, null)}
                      aria-busy={busy.has(item.id) || undefined}
                      className={cx('select-none', !selection.includes(item.id) && (flashIds.includes(item.id) ? TINT : peekItemId === item.id && PRESSED))}
                    />
                  </div>
                  <Button variant="secondary" size="sm" icon={CalendarPlus} disabledReason={denied} aria-label={`${item.key} ab heute einplanen`} onClick={() => plan(item)} className="self-start">
                    Ab heute einplanen
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {planning && planningItem && (
        <div
          aria-hidden="true"
          className={cx('pointer-events-none fixed top-0 left-0 z-40 flow-root', planning.returning && 'transition-transform duration-420 ease-spring')}
          style={{
            width: planning.home.width,
            transform: planning.returning ? `translate3d(${planning.home.x}px, ${planning.home.y}px, 0)` : `translate3d(${planning.x - planning.grip.x}px, ${planning.y - planning.grip.y}px, 0)`,
          }}
        >
          <ItemCard item={planningItem} compact onOpen={() => {}} lifted={!planning.returning} />
        </div>
      )}
    </div>
  );
}

/** One project's epics under its name. */
function ProjectRows({ name, project, children }: { name: string; project?: Project; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="relative">
      <div className="flex h-8 w-max min-w-full items-center border-t border-line">
        <h3 id={headingId} className="sticky left-0 z-10 flex h-full w-(--label-w) shrink-0 items-center gap-2 bg-paper px-4 text-sm font-semibold whitespace-nowrap text-muted">
          {project && <ProjectBadge project={project} />}
          <span className="min-w-0 truncate">{name}</span>
        </h3>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

/** The timeline in outline: the axis and a few bars. */
function TimelineSkeleton() {
  const bars = [
    ['ml-[8%]', 'w-[34%]'],
    ['ml-[30%]', 'w-[45%]'],
    ['ml-[2%]', 'w-[40%]'],
  ];
  return (
    <SkeletonGroup label="Timeline wird geladen …" className="dots overflow-hidden rounded-card border border-line-strong bg-paper shadow-elev-1">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-56 max-sm:hidden" />
        <Skeleton className="ml-auto h-7 w-44" />
      </div>
      <div className="flex h-14 items-end border-b border-line px-4 pb-2">
        <Skeleton className="h-3.5 w-16" />
      </div>
      {bars.map(([offset, length], index) => (
        <div key={index}>
          <div className="flex h-8 items-center gap-2 border-t border-line px-4">
            <Skeleton className="size-5" />
            <Skeleton className="h-3.5 w-28" />
          </div>
          <div className="flex h-11 items-center">
            <span className="flex w-34 shrink-0 items-center gap-2 px-4 sm:w-58">
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="h-3.5 flex-1" />
            </span>
            <span className="relative flex-1">
              <Skeleton className={cx('h-5', offset, length)} />
            </span>
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}
