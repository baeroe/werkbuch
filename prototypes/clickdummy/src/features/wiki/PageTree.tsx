/*
 * The page tree of a wiki (spec 4.15; 5.2: "Baum links, Seite rechts"): an ARIA tree of links in one flat list.
 * - Keyboard: one tab stop (the open page). The arrows move, Right opens a page's subpages or steps into them, Left
 *   closes them or steps to the parent, Home and End jump; Enter opens the page (each row is a link); mod+backspace
 *   deletes the page of the row (with its subtree, as on the page). Other keys with Ctrl, Cmd or Alt are left to the app.
 * - Pointer: the chevron opens and closes subpages; the handle on the left of a row drags the page (dnd-kit's sortable
 *   tree: up and down chooses the neighbours, sideways the depth). A line in ink blue shows where it lands, a lifted
 *   copy of the row floats along (DESIGN.md: drag), the subpages travel with it. The handle is no tab stop and hidden
 *   on touch screens: without a mouse, "Verschieben nach …" on the page does the same (WCAG 2.5.7).
 */

import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, GripVertical } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { cx } from '@/components/ui/cx';
import { isMac } from '@/lib/platform';
import type { PageNode } from '@/types';
import { subpages } from './format';
import { PageGlyph } from './MovePageDialog';
import { dropPlacement, findPage, flattenPages, projectDrop, subtreeIds, type PageRow, type Placement } from './tree';

/** Indentation per level in px; dragging this far sideways changes the depth by one. */
const INDENT = 16;

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'Seiten lassen sich mit der Maus ziehen. Ohne Maus öffnest du die Seite und wählst „Verschieben nach …“.',
};

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type PageTreeProps = {
  nodes: PageNode[];
  /** Where a page leads. */
  hrefOf: (id: string) => string;
  currentId: string | undefined;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
  /** Dragging is offered only to people who may edit the wiki. */
  canMove: boolean;
  onMove: (id: string, placement: Placement) => void;
  /** mod+backspace on a row; only for people who may edit the wiki. */
  onDelete?: (id: string) => void;
};

type RowProps = {
  row: PageRow;
  href: string;
  /** Place among its siblings, for aria-posinset and aria-setsize. */
  position: { size: number; pos: number };
  open: boolean;
  current: boolean;
  tabStop: boolean;
  canMove: boolean;
  /** While this row is dragged: the depth it would land at. */
  landing: number | null;
  onToggle: (open: boolean) => void;
  onFocus: () => void;
};

function TreeRow({ row, href, position, open, current, tabStop, canMove, landing, onToggle, onFocus }: RowProps) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !canMove });
  const hasChildren = row.node.children.length > 0;
  const style = { transform: CSS.Translate.toString(transform), transition };

  if (isDragging) {
    // the gap the page will fill: a line at the depth it lands at
    return (
      <li role="none" ref={setNodeRef} style={style}>
        <div className="flex min-h-11 items-center pr-2 lg:min-h-8" style={{ paddingLeft: (landing ?? row.depth) * INDENT + 6 }}>
          <span className="relative h-0.5 flex-1 rounded-full bg-accent">
            <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface" />
          </span>
        </div>
      </li>
    );
  }

  return (
    <li role="none" ref={setNodeRef} style={style}>
      <div className="group relative flex items-center" style={{ paddingLeft: row.depth * INDENT }}>
        {canMove && (
          <span
            ref={setActivatorNodeRef}
            {...listeners}
            aria-hidden="true"
            title="Ziehen, um die Seite zu verschieben"
            style={{ left: row.depth * INDENT - 24 }}
            className="absolute top-1/2 flex h-7 w-6 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-chip text-faint opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:text-ink active:cursor-grabbing pointer-coarse:hidden"
          >
            <GripVertical className="size-3.5" />
          </span>
        )}
        {/* the chevron opens and closes with the pointer; the keyboard has Right and Left on the row */}
        <span
          aria-hidden="true"
          onClick={hasChildren ? () => onToggle(!open) : undefined}
          className={cx('flex h-11 w-6 shrink-0 touch-manipulation items-center justify-center rounded-chip text-muted lg:h-7', hasChildren && 'cursor-pointer hover:bg-hover hover:text-ink')}
        >
          {hasChildren && <ChevronRight className={cx('size-3.5 transition-transform duration-160', open && 'rotate-90')} />}
        </span>
        <Link
          to={href}
          role="treeitem"
          data-page-id={row.id}
          aria-level={row.depth + 1}
          aria-setsize={position.size}
          aria-posinset={position.pos}
          aria-expanded={hasChildren ? open : undefined}
          aria-current={current ? 'page' : undefined}
          tabIndex={tabStop ? 0 : -1}
          onFocus={onFocus}
          className={cx(
            'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-ctl px-2 text-ui text-ink no-underline transition-colors duration-120 [--focus-offset:-2px] lg:min-h-8',
            current ? 'bg-raised font-medium shadow-elev-1 ring-1 ring-line-input ring-inset' : 'hover:bg-hover',
          )}
        >
          <PageGlyph emoji={row.node.emoji} className="w-4 shrink-0 text-center text-sm" />
          <span className="min-w-0 truncate">{row.node.title}</span>
        </Link>
      </div>
    </li>
  );
}

export function PageTree({ nodes, hrefOf, currentId, collapsed, onToggle, canMove, onMove, onDelete }: PageTreeProps) {
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ active: string; over: string | null; offset: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // the dragged page's subtree travels with it, so its rows leave the list meanwhile
  const rows = useMemo(() => {
    const all = flattenPages(nodes, collapsed);
    if (!drag) return all;
    const travelling = new Set(subtreeIds(nodes, drag.active).filter((id) => id !== drag.active));
    return all.filter((row) => !travelling.has(row.id));
  }, [nodes, collapsed, drag]);

  const positions = useMemo(() => {
    const map = new Map<string, { size: number; pos: number }>();
    const walk = (siblings: readonly PageNode[]) =>
      siblings.forEach((node, index) => {
        map.set(node.id, { size: siblings.length, pos: index + 1 });
        walk(node.children);
      });
    walk(nodes);
    return map;
  }, [nodes]);

  // a page opened elsewhere (a link, the palette) becomes the tab stop
  useEffect(() => setFocusId(null), [currentId]);

  const visible = new Set(rows.map((row) => row.id));
  const tabStop = focusId && visible.has(focusId) ? focusId : currentId && visible.has(currentId) ? currentId : rows[0]?.id;
  const landing = drag?.over ? projectDrop(rows, drag.active, drag.over, drag.offset, INDENT).depth : null;
  const dragged = drag ? findPage(nodes, drag.active) : undefined;
  const draggedDepth = drag ? rows.find((row) => row.id === drag.active)?.depth : undefined;

  const focusRow = (id: string | undefined) => {
    if (!id || !list.current) return;
    [...list.current.querySelectorAll<HTMLElement>('[data-page-id]')].find((element) => element.dataset.pageId === id)?.focus();
  };

  /** Closing a page whose subpage has the focus moves the focus to the page, so it does not fall to the document. */
  function toggle(id: string, open: boolean) {
    if (!open) {
      const focused = (document.activeElement as HTMLElement | null)?.dataset.pageId;
      if (focused && focused !== id && subtreeIds(nodes, id).includes(focused)) focusRow(id);
    }
    onToggle(id, open);
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const id = (event.target as HTMLElement).dataset.pageId;
    // mod+backspace deletes the page whose row has the focus (the page's own shortcut would take the open page)
    const mod = isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (id && onDelete && mod && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
      event.preventDefault();
      onDelete(id);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = rows.findIndex((row) => row.id === id);
    if (!id || index < 0) return;
    const row = rows[index];
    const hasChildren = row.node.children.length > 0;
    const open = hasChildren && !collapsed.has(id);
    switch (event.key) {
      case 'ArrowDown':
        focusRow(rows[index + 1]?.id);
        break;
      case 'ArrowUp':
        focusRow(rows[index - 1]?.id);
        break;
      case 'Home':
        focusRow(rows[0]?.id);
        break;
      case 'End':
        focusRow(rows.at(-1)?.id);
        break;
      case 'ArrowRight':
        if (hasChildren && !open) toggle(id, true);
        else if (open) focusRow(rows[index + 1]?.id);
        break;
      case 'ArrowLeft':
        if (open) toggle(id, false);
        else focusRow(row.parentId ?? undefined);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const titleOf = (id: UniqueIdentifier) => findPage(nodes, String(id))?.title ?? 'Seite';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `„${titleOf(active.id)}“ aufgenommen.`,
    onDragOver: ({ active, over }) => (over && over.id !== active.id ? `„${titleOf(active.id)}“ liegt bei „${titleOf(over.id)}“.` : undefined),
    onDragEnd: ({ active }) => `„${titleOf(active.id)}“ abgelegt.`,
    onDragCancel: ({ active }) => `Verschieben abgebrochen. „${titleOf(active.id)}“ bleibt, wo sie war.`,
  };

  function end({ active, over, delta }: DragEndEvent) {
    setDrag(null);
    if (!over) return;
    const placement = dropPlacement(nodes, collapsed, String(active.id), String(over.id), delta.x, INDENT);
    if (placement) onMove(String(active.id), placement);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={({ active }) => setDrag({ active: String(active.id), over: String(active.id), offset: 0 })}
      onDragMove={({ delta }) => setDrag((state) => (state ? { ...state, offset: delta.x } : state))}
      onDragOver={({ over }) => setDrag((state) => (state ? { ...state, over: over ? String(over.id) : null } : state))}
      onDragEnd={end}
      onDragCancel={() => setDrag(null)}
      accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
    >
      <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
        <ul ref={list} role="tree" aria-label="Seiten" onKeyDown={onKeyDown} className={cx('flex flex-col gap-0.5', canMove && 'pl-6', drag && 'select-none')}>
          {rows.map((row) => (
            <TreeRow
              key={row.id}
              row={row}
              href={hrefOf(row.id)}
              position={positions.get(row.id) ?? { size: 1, pos: 1 }}
              open={row.node.children.length > 0 && !collapsed.has(row.id)}
              current={row.id === currentId}
              tabStop={row.id === tabStop}
              canMove={canMove}
              landing={drag?.active === row.id ? landing : null}
              onToggle={(open) => toggle(row.id, open)}
              onFocus={() => setFocusId(row.id)}
            />
          ))}
        </ul>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined} zIndex={70}>
          {dragged && (
            // the copy only shows the row: inert, hidden from screen readers, not selectable. It starts where the row's
            // title stood, so the start of the line that shows the landing depth stays in sight to its left.
            <div inert aria-hidden="true" className="flex select-none" style={{ paddingLeft: (draggedDepth ?? 0) * INDENT + 24 }}>
              <div className="flex h-8 max-w-64 min-w-0 -translate-y-1.5 -rotate-2 scale-[1.02] items-center gap-2 rounded-ctl border border-line-strong bg-surface px-2 text-ui font-medium text-ink shadow-elev-drag">
                <PageGlyph emoji={dragged.emoji} className="w-4 shrink-0 text-center text-sm" />
                <span className="min-w-0 truncate">{dragged.title}</span>
                {dragged.children.length > 0 && (
                  <span className="shrink-0 text-sm font-normal text-muted tabular-nums">mit {subpages(subtreeIds(nodes, dragged.id).length - 1)}</span>
                )}
              </div>
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
