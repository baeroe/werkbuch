/*
 * The page tree of a wiki as rows, and what moving a page does to it (spec 4.15). Pure functions on the tree the API
 * lists (`PageNode`, ordered by rank): the tree component draws `flattenPages`, dragging works out the drop with
 * `projectDrop` and `dropPlacement` (the approach of dnd-kit's sortable tree: the list order decides the neighbours, the
 * sideways offset the depth), and the screen shows a move or a delete at once with `movedTree` and `withoutPages`.
 * The API takes a move as `{ parent_id, before_id }`: under which page, in front of which sibling (null: at the end).
 */

import type { PageNode } from '@/types';

/** A page as a row of the tree. */
export interface PageRow {
  id: string;
  parentId: string | null;
  depth: number;
  node: PageNode;
}

/** Where a page stands: its parent (null: top level) and the sibling after it (null: the last one). */
export interface Placement {
  parent_id: string | null;
  before_id: string | null;
}

/** The pages in reading order; what lies below a collapsed page is left out. */
export function flattenPages(nodes: readonly PageNode[], collapsed: ReadonlySet<string> = new Set(), depth = 0, parentId: string | null = null): PageRow[] {
  return nodes.flatMap((node) => [
    { id: node.id, parentId, depth, node },
    ...(collapsed.has(node.id) ? [] : flattenPages(node.children, collapsed, depth + 1, node.id)),
  ]);
}

export function findPage(nodes: readonly PageNode[], id: string): PageNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findPage(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/** A page with every page below it, in reading order; empty for a page that is not in the tree. */
export function subtreeIds(nodes: readonly PageNode[], id: string): string[] {
  const root = findPage(nodes, id);
  return root ? flattenPages([root]).map((row) => row.id) : [];
}

/** The pages from the top down to the page, the page last; empty when it is not in the tree. */
export function pathTo(nodes: readonly PageNode[], id: string): PageNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node];
    const below = pathTo(node.children, id);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

/** Where the page stands now, or null when it is not in the tree. */
export function placementOf(nodes: readonly PageNode[], id: string, parentId: string | null = null): Placement | null {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) return { parent_id: parentId, before_id: nodes[index + 1]?.id ?? null };
  for (const node of nodes) {
    const found = placementOf(node.children, id, node.id);
    if (found) return found;
  }
  return null;
}

/** The siblings under a parent (null: the top level). */
export function childrenOf(nodes: readonly PageNode[], parentId: string | null): readonly PageNode[] {
  return parentId === null ? nodes : (findPage(nodes, parentId)?.children ?? []);
}

function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Where the dragged row would land: `rows` are the rows on screen without the subtree of the dragged page (it travels
 * along), `overId` the row it is over, `offset` how far it was pulled sideways. The depth lies between the next row's
 * (it must not lose its parent) and one deeper than the row above.
 */
export function projectDrop(rows: readonly PageRow[], activeId: string, overId: string, offset: number, indent: number): { depth: number; parentId: string | null } {
  const activeIndex = rows.findIndex((row) => row.id === activeId);
  const overIndex = rows.findIndex((row) => row.id === overId);
  if (activeIndex < 0 || overIndex < 0) return { depth: 0, parentId: null };

  const moved = arrayMove(rows, activeIndex, overIndex);
  const previous = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const maxDepth = previous ? previous.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.min(maxDepth, Math.max(minDepth, rows[activeIndex].depth + Math.round(offset / indent)));

  let parentId: string | null = null;
  if (depth > 0 && previous) {
    if (depth === previous.depth) parentId = previous.parentId;
    else if (depth > previous.depth) parentId = previous.id;
    else parentId = moved.slice(0, overIndex).reverse().find((row) => row.depth === depth)?.parentId ?? null;
  }
  return { depth, parentId };
}

/** The tree again from rows in reading order: each row joins its parent's children in the order it comes. */
function buildTree(rows: readonly PageRow[]): PageNode[] {
  const top: PageNode[] = [];
  const built = new Map<string, PageNode>();
  for (const row of rows) built.set(row.id, { ...row.node, parent_id: row.parentId, children: [] });
  for (const row of rows) {
    const node = built.get(row.id)!;
    const parent = row.parentId === null ? undefined : built.get(row.parentId);
    (parent ? parent.children : top).push(node);
  }
  return top;
}

/**
 * The move a drop asks for, or null when the page stays where it is (or the row it was dropped on is gone). The
 * neighbours come from the rows on screen (`collapsed` hides subtrees); the new place is worked out on the whole tree, so
 * a page dropped below a collapsed page lands after that page's hidden subpages.
 */
export function dropPlacement(nodes: readonly PageNode[], collapsed: ReadonlySet<string>, activeId: string, overId: string, offset: number, indent: number): Placement | null {
  const travelling = new Set(subtreeIds(nodes, activeId).filter((id) => id !== activeId));
  const rows = flattenPages(nodes, collapsed).filter((row) => !travelling.has(row.id));
  if (!rows.some((row) => row.id === activeId) || !rows.some((row) => row.id === overId)) return null;
  const { depth, parentId } = projectDrop(rows, activeId, overId, offset, indent);

  const all = flattenPages(nodes);
  const activeIndex = all.findIndex((row) => row.id === activeId);
  const overIndex = all.findIndex((row) => row.id === overId);
  const reordered = arrayMove(
    all.map((row, index) => (index === activeIndex ? { ...row, depth, parentId } : row)),
    activeIndex,
    overIndex,
  );
  const before = placementOf(nodes, activeId);
  const after = placementOf(buildTree(reordered), activeId);
  if (!after || (before && before.parent_id === after.parent_id && before.before_id === after.before_id)) return null;
  return after;
}

/** The tree with a page (and its subtree) moved under `parentId`, in front of `beforeId` (null: at the end). */
export function movedTree(nodes: readonly PageNode[], id: string, parentId: string | null, beforeId: string | null): PageNode[] {
  const page = findPage(nodes, id);
  if (!page) return [...nodes];
  const without = withoutPages(nodes, new Set([id]));
  const moved: PageNode = { ...page, parent_id: parentId };
  const insert = (siblings: readonly PageNode[]): PageNode[] => {
    const index = beforeId === null ? -1 : siblings.findIndex((node) => node.id === beforeId);
    return index < 0 ? [...siblings, moved] : [...siblings.slice(0, index), moved, ...siblings.slice(index)];
  };
  if (parentId === null) return insert(without);
  const place = (list: readonly PageNode[]): PageNode[] =>
    list.map((node) => (node.id === parentId ? { ...node, children: insert(node.children) } : { ...node, children: place(node.children) }));
  return place(without);
}

/** The tree without these pages and what lies below them. */
export function withoutPages(nodes: readonly PageNode[], ids: ReadonlySet<string>): PageNode[] {
  return nodes.filter((node) => !ids.has(node.id)).map((node) => ({ ...node, children: withoutPages(node.children, ids) }));
}

/** Every page that can take the page as a subpage: all but the page itself and its subtree. */
export function moveCandidates(nodes: readonly PageNode[], id: string): PageRow[] {
  const own = new Set(subtreeIds(nodes, id));
  return flattenPages(nodes).filter((row) => !own.has(row.id));
}
