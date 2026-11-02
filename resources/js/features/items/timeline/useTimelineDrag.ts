/*
 * The pointer on the timeline, ported from the clickdummy:
 *
 * - A bar: dragged it moves, dragged at its ends it changes the start or the due date, a day at a time; let go, its
 *   dates are saved (`save`). A press without a move is a click: the preview. Touch scrolls the axis instead (on a
 *   phone the timeline is for reading); a tap opens the preview. A bar the person may not change does not move.
 * - A card of "Ohne Datum": dragged onto the axis it starts on the day under the pointer (`plan`); let go anywhere
 *   else it springs back into the list.
 * - Escape cancels a drag that runs (13c): the bar takes its saved dates again, the card goes back. That Escape is the
 *   drag's alone: it is marked as handled before the shortcuts (on the window) hear it, so the selection stays.
 *
 * The listeners of a drag sit on the window (the pointer may leave the bar) and on the document (Escape); they end
 * with the drag, and at the latest when the timeline unmounts.
 */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays } from '@/domain/tz';
import type { DateRange, TimelineScale } from '@/domain/timeline';
import type { ListedItem } from '@/types';
import type { BarHandlers } from './TimelineBar';

/** How far the pointer goes before a press becomes a drag: a bar, and a card of "Ohne Datum". */
const BAR_SLOP = 4;
const CARD_SLOP = 5;
/** How long a card that was let go off the axis takes to spring back into its place. */
const RETURN_MS = 420;

export interface PlanDrag {
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

export interface TimelineDragDeps {
  scale: TimelineScale;
  /** The dates a bar shows now. */
  datesOf(item: ListedItem): DateRange | null;
  /** Why the person may not change the item, or null. */
  editReason(item: ListedItem): string | null;
  setDraft(id: string, dates: DateRange): void;
  /** Takes the draft of a bar away again: it shows its saved dates. */
  dropDraft(id: string, dates: DateRange): void;
  save(id: string, dates: DateRange): void;
  /** Puts an epic of "Ohne Datum" on the axis from a day on. */
  plan(item: ListedItem, day: string): void;
  onPeek(id: string): void;
  /** The pressed bar's row becomes the cursor (without the keyboard's ring). */
  press(id: string): void;
  /** The day under a point of the window, when it lies on the axis. */
  dayAt(x: number, y: number): string | null;
  /** A drag that was cancelled or came to nothing: what the status line says. */
  cancelled(item: ListedItem): void;
  /** A card of "Ohne Datum" was let go off the axis. */
  stayed(item: ListedItem): void;
}

const earlier = (a: string, b: string) => (a < b ? a : b);
const later = (a: string, b: string) => (a > b ? a : b);

export function useTimelineDrag(deps: TimelineDragDeps) {
  const latest = useRef(deps);
  useLayoutEffect(() => {
    latest.current = deps;
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [planning, setPlanning] = useState<PlanDrag | null>(null);
  /** Ends the drag that runs: its listeners go. */
  const stop = useRef<(() => void) | null>(null);
  const returning = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** How the last press on a bar came: a tap opens the preview (touch scrolls the axis instead of dragging). */
  const lastPointer = useRef('mouse');

  useEffect(
    () => () => {
      stop.current?.();
      clearTimeout(returning.current);
    },
    [],
  );

  /** Listens on the window for the pointer and on the document for Escape, until `end()`. */
  function listen(move: (event: PointerEvent) => void, up: (event: PointerEvent) => void, cancel: () => void, escape: (event: KeyboardEvent) => void) {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escape(event);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    stop.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      stop.current = null;
    };
  }

  /* --------------------------------------------------------------------------- bars */

  function pressBar(event: ReactPointerEvent<HTMLElement>, item: ListedItem) {
    lastPointer.current = event.pointerType;
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const { datesOf, editReason } = latest.current;
    const range = datesOf(item)!;
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge;
    const mode = edge === 'start' || edge === 'due' ? edge : 'move';
    const locked = editReason(item) !== null;
    const origin = event.clientX;
    let moved = false;
    let last = range;
    // the row becomes the cursor; a pointer shows no keyboard ring, and the wide row must not scroll into view
    event.preventDefault();
    latest.current.press(item.id);
    stop.current?.();

    const end = () => {
      stop.current?.();
      setDragging(null);
    };
    listen(
      (pointer) => {
        const dx = pointer.clientX - origin;
        if (locked || (!moved && Math.abs(dx) < BAR_SLOP)) return;
        if (!moved) {
          moved = true;
          setDragging(item.id);
        }
        const days = Math.round(dx / latest.current.scale.px_per_day);
        const { start, due } = range;
        last =
          mode === 'move'
            ? { start: addDays(start, days), due: addDays(due, days) }
            : mode === 'start'
              ? { start: earlier(addDays(start, days), due), due }
              : { start, due: later(addDays(due, days), start) };
        latest.current.setDraft(item.id, last);
      },
      () => {
        end();
        // a click on the bar: the preview
        if (!moved) latest.current.onPeek(item.id);
        else latest.current.save(item.id, last);
      },
      () => {
        end();
        if (moved) latest.current.dropDraft(item.id, last);
      },
      (key) => {
        // Escape before the bar moved is no drag to cancel: it stays the list's
        if (!moved) return;
        key.preventDefault();
        end();
        latest.current.dropDraft(item.id, last);
        latest.current.cancelled(item);
      },
    );
  }

  const barHandlers = (item: ListedItem): BarHandlers => ({
    onPointerDown: (event) => pressBar(event, item),
    onClick: () => {
      if (lastPointer.current === 'touch') latest.current.onPeek(item.id);
    },
  });

  /* ----------------------------------------------------------------------- planning */

  function onPlanPointerDown(event: ReactPointerEvent<HTMLElement>, item: ListedItem) {
    if (event.button !== 0 || event.pointerType === 'touch' || latest.current.editReason(item) !== null) return;
    const card = event.currentTarget.getBoundingClientRect();
    const grip = { x: event.clientX - card.left, y: event.clientY - card.top };
    const home = { x: card.left, y: card.top, width: card.width };
    const origin = { x: event.clientX, y: event.clientY };
    let started = false;
    stop.current?.();

    const finish = (day: string | null) => {
      stop.current?.();
      if (!started) return;
      if (day) {
        setPlanning(null);
        latest.current.plan(item, day);
        return;
      }
      // not over the axis: the card springs back into the list
      setPlanning((current) => current && { ...current, returning: true });
      clearTimeout(returning.current);
      returning.current = setTimeout(() => setPlanning(null), RETURN_MS);
      latest.current.stayed(item);
    };
    listen(
      (pointer) => {
        if (!started && Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < CARD_SLOP) return;
        started = true;
        setPlanning({ id: item.id, x: pointer.clientX, y: pointer.clientY, grip, home, day: latest.current.dayAt(pointer.clientX, pointer.clientY), returning: false });
      },
      (pointer) => finish(latest.current.dayAt(pointer.clientX, pointer.clientY)),
      () => finish(null),
      (key) => {
        if (!started) return;
        key.preventDefault();
        finish(null);
      },
    );
  }

  return { dragging, planning, barHandlers, onPlanPointerDown };
}
