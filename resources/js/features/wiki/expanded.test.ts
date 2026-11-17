/*
 * The open pages of a wiki's tree (WEBU-5): the module store over localStorage and the pure helpers. The screen with
 * them is in screen.test.tsx ("the folds of the tree").
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drafts } from '@/lib/drafts';
import { webTree } from '@/test/fixtures';
import { collapsedOf, expandedKey, folded, idsOf, opened, readExpanded, useExpanded, writeExpanded } from './expanded';

const key = expandedKey('u_mara', 'p_web');

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the store', () => {
  it('names its key after the person and the project', () => {
    expect(key).toBe('werkbuch.wiki.expanded.u_mara.p_web');
  });

  it('reads nothing as folded, and answers the same set until it changes', () => {
    const first = readExpanded(key);
    expect(first.size).toBe(0);
    expect(readExpanded(key)).toBe(first);
  });

  it('keeps open pages in the storage, and the same ones again change nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    writeExpanded(key, new Set(['pg_a', 'pg_b']));
    writeExpanded(key, new Set(['pg_b', 'pg_a']));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(['pg_a', 'pg_b']);

    // a reload reads it back
    drafts.clear();
    expect([...readExpanded(key)]).toEqual(['pg_a', 'pg_b']);
  });

  it('takes the entry out of the storage when nothing is open', () => {
    writeExpanded(key, new Set(['pg_a']));
    writeExpanded(key, new Set());
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('reads what is no list of texts as folded', () => {
    window.localStorage.setItem(key, '{"pg_a": true}');
    expect(readExpanded(key).size).toBe(0);
    drafts.clear();
    window.localStorage.setItem(key, 'not json');
    expect(readExpanded(key).size).toBe(0);
    drafts.clear();
    window.localStorage.setItem(key, '["pg_a", 7, null]');
    expect([...readExpanded(key)]).toEqual(['pg_a']);
  });

  it('follows another tab, which writes the storage, and leaves keys of others alone', () => {
    const { result } = renderHook(() => useExpanded(key));
    act(() => writeExpanded(key, new Set(['pg_a'])));
    expect([...result.current[0]]).toEqual(['pg_a']);

    // another tab opened a page: this one reads it again instead of writing its old state back
    window.localStorage.setItem(key, JSON.stringify(['pg_a', 'pg_b']));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    expect([...result.current[0]]).toEqual(['pg_a', 'pg_b']);

    // a key of something else changes nothing; a cleared storage folds everything
    const before = result.current[0];
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'theme' })));
    expect(result.current[0]).toBe(before);
    window.localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(result.current[0].size).toBe(0);
  });
});

describe('the helpers', () => {
  const open = new Set(['pg_web_tech']);

  it('opens and folds pages, and answers the same set when nothing changes', () => {
    expect(opened(open, ['pg_web_tech'])).toBe(open);
    expect([...opened(open, ['pg_web_hosting'])]).toEqual(['pg_web_tech', 'pg_web_hosting']);
    expect(folded(open, ['pg_web_hosting'])).toBe(open);
    expect([...folded(open, ['pg_web_tech'])]).toEqual([]);
  });

  it('folds every page with subpages that is not open, at every depth', () => {
    const closed = collapsedOf(webTree, open);
    expect(closed.has('pg_web_tech')).toBe(false);
    expect(closed.has('pg_web_hosting')).toBe(true);
    expect(closed.has('pg_web_handbook')).toBe(true);
    // a page without subpages has nothing to fold
    expect(closed.has('pg_web_domain')).toBe(false);
  });

  it('names every page of the tree', () => {
    const ids = idsOf(webTree);
    expect(ids.size).toBe(12);
    expect(ids.has('pg_web_domain')).toBe(true);
  });
});
