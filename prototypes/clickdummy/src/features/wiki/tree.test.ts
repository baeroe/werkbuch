import { describe, expect, it } from 'vitest';
import type { PageNode } from '@/types';
import { dropPlacement, flattenPages, moveCandidates, movedTree, pathTo, placementOf, projectDrop, subtreeIds, withoutPages } from './tree';

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

  it('dropped below a collapsed page, it becomes that page’s last subpage', () => {
    expect(dropPlacement(tree, new Set(['hosting']), 'performance', 'performance', INDENT, INDENT)).toEqual({ parent_id: 'hosting', before_id: null });
  });

  it('answers null when the page stays where it is', () => {
    expect(dropPlacement(tree, new Set(), 'design', 'design', 0, INDENT)).toBeNull();
    expect(dropPlacement(tree, new Set(), 'design', 'unknown', 0, INDENT)).toBeNull();
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
  });

  it('leaves out pages that wait for their delete', () => {
    expect(ids(withoutPages(tree, new Set(subtreeIds(tree, 'tech'))))).toEqual([['handbook', ['structure', ['design', ['typography']], 'editorial']], ['meetings', ['kickoff']]]);
  });

  it('offers every page as new parent except the page itself and its subtree', () => {
    expect(moveCandidates(tree, 'handbook').map((row) => row.id)).toEqual(['tech', 'contactform', 'hosting', 'domain', 'performance', 'meetings', 'kickoff']);
    expect(moveCandidates(tree, 'domain').map((row) => row.id)).not.toContain('domain');
  });
});
