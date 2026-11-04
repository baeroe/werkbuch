import { describe, expect, it } from 'vitest';
import type { PageNode } from '@/types';
import { subpages } from './format';
import { childrenOf, dropPlacement, findPage, flattenPages, moveCandidates, movedTree, pathTo, placementOf, projectDrop, subtreeIds, withoutPages } from './tree';

/** A page of the tree; only id, parent and children matter here. */
function node(id: string, parent: string | null, children: PageNode[] = []): PageNode {
  return {
    id,
    project_id: 'p_web',
    parent_id: parent,
    rank: 'a0',
    title: id,
    emoji: null,
    version: 1,
    created_by: 'u_ida',
    created_at: '2026-10-01T10:00:00.000Z',
    updated_by: 'u_ida',
    updated_at: '2026-10-01T10:00:00.000Z',
    children,
  };
}

/** The shape of the WEB wiki in the seed. */
const tree: PageNode[] = [
  node('handbook', null, [node('structure', 'handbook'), node('design', 'handbook', [node('typography', 'design')]), node('editorial', 'handbook')]),
  node('tech', null, [node('contactform', 'tech'), node('hosting', 'tech', [node('domain', 'hosting')]), node('performance', 'tech')]),
  node('meetings', null, [node('kickoff', 'meetings')]),
];

const INDENT = 16;
const ids = (nodes: PageNode[]): unknown => nodes.map((entry) => (entry.children.length ? [entry.id, ids(entry.children)] : entry.id));

describe('flattenPages', () => {
  it('lists the pages in reading order with their depth and parent', () => {
    expect(flattenPages(tree).map(({ id, depth, parentId }) => `${id}:${depth}:${parentId ?? '-'}`)).toEqual([
      'handbook:0:-',
      'structure:1:handbook',
      'design:1:handbook',
      'typography:2:design',
      'editorial:1:handbook',
      'tech:0:-',
      'contactform:1:tech',
      'hosting:1:tech',
      'domain:2:hosting',
      'performance:1:tech',
      'meetings:0:-',
      'kickoff:1:meetings',
    ]);
  });

  it('leaves out what lies below a collapsed page', () => {
    expect(flattenPages(tree, new Set(['handbook', 'hosting'])).map((row) => row.id)).toEqual([
      'handbook',
      'tech',
      'contactform',
      'hosting',
      'performance',
      'meetings',
      'kickoff',
    ]);
  });
});

describe('subtrees and paths', () => {
  it('names a page with every page below it', () => {
    expect(subtreeIds(tree, 'tech')).toEqual(['tech', 'contactform', 'hosting', 'domain', 'performance']);
    expect(subtreeIds(tree, 'kickoff')).toEqual(['kickoff']);
    expect(subtreeIds(tree, 'unknown')).toEqual([]);
  });

  it('finds the way from the top to a page', () => {
    expect(pathTo(tree, 'domain').map((entry) => entry.id)).toEqual(['tech', 'hosting', 'domain']);
    expect(pathTo(tree, 'unknown')).toEqual([]);
  });

  it('tells where a page stands: its parent and the sibling after it', () => {
    expect(placementOf(tree, 'design')).toEqual({ parent_id: 'handbook', before_id: 'editorial' });
    expect(placementOf(tree, 'meetings')).toEqual({ parent_id: null, before_id: null });
  });
});

describe('finding pages', () => {
  it('finds a page anywhere in the tree', () => {
    expect(findPage(tree, 'typography')?.parent_id).toBe('design');
    expect(findPage(tree, 'unknown')).toBeUndefined();
  });

  it('names the siblings under a parent, the top level for null', () => {
    expect(childrenOf(tree, null).map((entry) => entry.id)).toEqual(['handbook', 'tech', 'meetings']);
    expect(childrenOf(tree, 'hosting').map((entry) => entry.id)).toEqual(['domain']);
    expect(childrenOf(tree, 'unknown')).toEqual([]);
  });

  it('counts subpages in words, one and more', () => {
    expect(subpages(1)).toBe('1 Unterseite');
    expect(subpages(4)).toBe('4 Unterseiten');
  });
});

describe('dragging in the tree', () => {
  /** The rows while `active` is dragged: its own subtree travels with it. */
  const rowsFor = (active: string, collapsed: ReadonlySet<string> = new Set()) => {
    const hidden = new Set(subtreeIds(tree, active).filter((id) => id !== active));
    return flattenPages(tree, collapsed).filter((row) => !hidden.has(row.id));
  };

  it('puts a page in front of the sibling it is dropped on', () => {
    expect(projectDrop(rowsFor('editorial'), 'editorial', 'structure', 0, INDENT)).toEqual({ depth: 1, parentId: 'handbook' });
    expect(dropPlacement(tree, new Set(), 'editorial', 'structure', 0, INDENT)).toEqual({ parent_id: 'handbook', before_id: 'structure' });
  });

  it('under a deeper row above, a page keeps the parent of the row of its own depth', () => {
    // typography (depth 2) stands above editorial (depth 1): editorial stays below handbook
    expect(projectDrop(rowsFor('editorial'), 'editorial', 'editorial', 0, INDENT)).toEqual({ depth: 1, parentId: 'handbook' });
  });

  it('moves a page with its subpages to the top level', () => {
    expect(dropPlacement(tree, new Set(), 'meetings', 'tech', 0, INDENT)).toEqual({ parent_id: null, before_id: 'tech' });
  });

  it('dragged to the left, a page leaves its parent', () => {
    expect(dropPlacement(tree, new Set(), 'kickoff', 'kickoff', -INDENT, INDENT)).toEqual({ parent_id: null, before_id: null });
  });

  it('dragged to the right, a page goes below the page above it, as deep as that allows', () => {
    // performance under hosting, after domain; four steps to the right end at the deepest place there is
    expect(dropPlacement(tree, new Set(), 'performance', 'performance', INDENT, INDENT)).toEqual({ parent_id: 'hosting', before_id: null });
    expect(projectDrop(rowsFor('performance'), 'performance', 'performance', 4 * INDENT, INDENT)).toEqual({ depth: 3, parentId: 'domain' });
  });

  it('changes the depth only from three quarters of an indent', () => {
    // 11 px sideways is a hand that wobbles: the page stays; 12 px (¾ of 16) takes it one level, each further 16 px one more
    expect(dropPlacement(tree, new Set(), 'performance', 'performance', 11, INDENT)).toBeNull();
    expect(dropPlacement(tree, new Set(), 'performance', 'performance', 12, INDENT)).toEqual({ parent_id: 'hosting', before_id: null });
    expect(dropPlacement(tree, new Set(), 'kickoff', 'kickoff', -11, INDENT)).toBeNull();
    expect(dropPlacement(tree, new Set(), 'kickoff', 'kickoff', -12, INDENT)).toEqual({ parent_id: null, before_id: null });
    expect(projectDrop(rowsFor('performance'), 'performance', 'performance', 8, INDENT).depth).toBe(1);
    expect(projectDrop(rowsFor('performance'), 'performance', 'performance', 27, INDENT).depth).toBe(2);
    expect(projectDrop(rowsFor('performance'), 'performance', 'performance', 28, INDENT).depth).toBe(3);
  });

  it('dropped below a collapsed page, it becomes that page’s last subpage, after the hidden ones', () => {
    // hosting is folded away: domain is no row, but performance still lands behind it
    expect(flattenPages(tree, new Set(['hosting'])).map((row) => row.id)).not.toContain('domain');
    expect(dropPlacement(tree, new Set(['hosting']), 'performance', 'performance', INDENT, INDENT)).toEqual({ parent_id: 'hosting', before_id: null });
    const moved = movedTree(tree, 'performance', 'hosting', null);
    expect(findPage(moved, 'hosting')?.children.map((child) => child.id)).toEqual(['domain', 'performance']);
  });

  it('dropped on a collapsed page from above, it lands after that page and its hidden subpages', () => {
    expect(dropPlacement(tree, new Set(['hosting']), 'contactform', 'hosting', 0, INDENT)).toEqual({ parent_id: 'tech', before_id: 'performance' });
  });

  it('answers null when the page stays where it is', () => {
    expect(dropPlacement(tree, new Set(), 'design', 'design', 0, INDENT)).toBeNull();
    expect(dropPlacement(tree, new Set(), 'design', 'unknown', 0, INDENT)).toBeNull();
    expect(projectDrop(rowsFor('design'), 'design', 'unknown', 0, INDENT)).toEqual({ depth: 0, parentId: null });
  });
});

describe('changing the tree', () => {
  it('moves a page with its subtree under a new parent, in front of a sibling or at the end', () => {
    expect(ids(movedTree(tree, 'hosting', 'meetings', 'kickoff'))).toEqual([
      ['handbook', ['structure', ['design', ['typography']], 'editorial']],
      ['tech', ['contactform', 'performance']],
      ['meetings', [['hosting', ['domain']], 'kickoff']],
    ]);
    expect(ids(movedTree(tree, 'kickoff', null, null))).toEqual([
      ['handbook', ['structure', ['design', ['typography']], 'editorial']],
      ['tech', ['contactform', ['hosting', ['domain']], 'performance']],
      'meetings',
      'kickoff',
    ]);
    const moved = movedTree(tree, 'kickoff', 'tech', 'contactform');
    expect(moved[1].children[0]).toMatchObject({ id: 'kickoff', parent_id: 'tech' });
    expect(ids(movedTree(tree, 'unknown', null, null))).toEqual(ids(tree));
  });

  it('leaves out pages that wait for their delete', () => {
    expect(ids(withoutPages(tree, new Set(subtreeIds(tree, 'tech'))))).toEqual([['handbook', ['structure', ['design', ['typography']], 'editorial']], ['meetings', ['kickoff']]]);
  });

  it('offers every page as new parent except the page itself and its subtree', () => {
    expect(moveCandidates(tree, 'handbook').map((row) => row.id)).toEqual(['tech', 'contactform', 'hosting', 'domain', 'performance', 'meetings', 'kickoff']);
    expect(moveCandidates(tree, 'domain').map((row) => row.id)).not.toContain('domain');
  });
});
