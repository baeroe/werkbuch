/*
 * The page tree of a wiki (spec 4.15; 5.2: "Baum links, Seite rechts"), ported from the clickdummy without dragging
 * (Task 17): an ARIA tree of Inertia links in one flat list.
 * - Keyboard (the keys of the widget, `widgets.ts` group `shortcuts.widget.group.tree`): one tab stop, the open page,
 *   else the first; once the person moves, the row last focused. Up and Down move, Right opens a page's subpages or
 *   steps into them, Left closes them or steps to the parent, Home and End jump; Enter opens the page (each row is a
 *   link). mod+backspace asks to delete the page of the row (`onDelete`, with its subtree; the page's own shortcut would
 *   take the open page). Other keys with Ctrl, Cmd, Alt or Shift are left to the app.
 * - Pointer: the chevron opens and closes subpages; it is no tab stop (the keyboard has Right and Left on the row).
 * - The wiki keeps the ancestors of the open page unfolded; folding a page whose subpage has the focus moves the focus
 *   to the page, so it never falls to the document.
 */

import { Link } from '@inertiajs/react';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/components/ui/cx';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/platform';
import type { PageNode } from '@/types';
import { PageGlyph } from './PageGlyph';
import { flattenPages, subtreeIds, type PageRow, type Placement } from './tree';

/** Indentation per level in px. */
const INDENT = 16;

export interface PageTreeProps {
  nodes: readonly PageNode[];
  /** Where a page leads. */
  hrefOf: (id: string) => string;
  currentId: string | null | undefined;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
  /** Dragging (Task 17) is offered only to people who may edit the wiki. */
  canMove?: boolean;
  onMove?: (id: string, placement: Placement) => void;
  /** mod+backspace on a row asks to delete its page; only for people who may edit the wiki. */
  onDelete?: (id: string) => void;
}

type RowProps = {
  row: PageRow;
  href: string;
  /** Place among its siblings, for aria-posinset and aria-setsize. */
  position: { size: number; pos: number };
  open: boolean;
  current: boolean;
  tabStop: boolean;
  onToggle: (open: boolean) => void;
  onFocus: () => void;
};

function TreeRow({ row, href, position, open, current, tabStop, onToggle, onFocus }: RowProps) {
  const hasChildren = row.node.children.length > 0;
  return (
    <li role="none">
      <div className="relative flex items-center" style={{ paddingLeft: row.depth * INDENT }}>
        {/* the chevron opens and closes with the pointer (the focus stays where it is); the keyboard has Right and Left */}
        <span
          aria-hidden="true"
          data-toggle={row.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={hasChildren ? () => onToggle(!open) : undefined}
          className={cx(
            'flex h-11 w-6 shrink-0 touch-manipulation items-center justify-center rounded-chip text-muted lg:h-7',
            hasChildren && 'cursor-pointer hover:bg-hover hover:text-ink',
          )}
        >
          {hasChildren && <ChevronRight className={cx('size-3.5 transition-transform duration-160', open && 'rotate-90')} />}
        </span>
        <Link
          href={href}
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

export function PageTree({ nodes, hrefOf, currentId, collapsed, onToggle, onDelete }: PageTreeProps) {
  const list = useRef<HTMLUListElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rows = useMemo(() => flattenPages(nodes, collapsed), [nodes, collapsed]);

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

  const focusRow = (id: string | null | undefined) => {
    if (!id) return;
    [...list.current!.querySelectorAll<HTMLElement>('[data-page-id]')].find((element) => element.dataset.pageId === id)?.focus();
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
    const index = rows.findIndex((row) => row.id === id);
    if (!id || index < 0) return;
    // mod+backspace deletes the page whose row has the focus (the page's own shortcut would take the open page)
    const mod = isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (onDelete && mod && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
      event.preventDefault();
      onDelete(id);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
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
        focusRow(rows[0].id);
        break;
      case 'End':
        focusRow(rows.at(-1)!.id);
        break;
      case 'ArrowRight':
        if (open) focusRow(rows[index + 1].id);
        else if (hasChildren) toggle(id, true);
        break;
      case 'ArrowLeft':
        if (open) toggle(id, false);
        else focusRow(row.parentId);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <ul ref={list} role="tree" aria-label={t('wiki.tree.label')} onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <TreeRow
          key={row.id}
          row={row}
          href={hrefOf(row.id)}
          position={positions.get(row.id)!}
          open={row.node.children.length > 0 && !collapsed.has(row.id)}
          current={row.id === currentId}
          tabStop={row.id === tabStop}
          onToggle={(open) => toggle(row.id, open)}
          onFocus={() => setFocusId(row.id)}
        />
      ))}
    </ul>
  );
}
