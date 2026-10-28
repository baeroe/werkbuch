import { describe, expect, it } from 'vitest';
import type { Resolution } from '@/types';
import { resolutions as res } from './fixtures';
import { resolutionAfterTransition } from './resolution';

describe('resolutionAfterTransition', () => {
  it('sets the default of Completed when the transition gives no choice', () => {
    expect(resolutionAfterTransition('started', 'completed', null, null, res)).toBe('res_done');
  });

  it('sets the default of Canceled when the transition gives no choice', () => {
    expect(resolutionAfterTransition('started', 'canceled', null, null, res)).toBe('res_wontdo');
  });

  it('takes the chosen resolution over the default', () => {
    expect(resolutionAfterTransition('started', 'canceled', null, 'res_duplicate', res)).toBe('res_duplicate');
  });

  it('clears the resolution when the item is reopened', () => {
    expect(resolutionAfterTransition('completed', 'unstarted', 'res_done', null, res)).toBeNull();
    expect(resolutionAfterTransition('canceled', 'backlog', 'res_wontdo', null, res)).toBeNull();
    expect(resolutionAfterTransition('completed', 'started', 'res_done', 'res_duplicate', res)).toBeNull();
  });

  it('keeps the resolution while the item stays in a closed category', () => {
    expect(resolutionAfterTransition('completed', 'completed', 'res_done', null, res)).toBe('res_done');
    expect(resolutionAfterTransition('canceled', 'canceled', 'res_duplicate', null, res)).toBe('res_duplicate');
  });

  it('switches to the default of the new category when an item moves between closed categories', () => {
    expect(resolutionAfterTransition('completed', 'canceled', 'res_done', null, res)).toBe('res_wontdo');
  });

  it('stays empty on moves between open categories', () => {
    expect(resolutionAfterTransition('backlog', 'started', null, null, res)).toBeNull();
  });

  it('ignores a chosen resolution that is archived or unknown', () => {
    const archived: Resolution[] = res.map((r) => (r.id === 'res_duplicate' ? { ...r, archived_at: '2026-10-01T00:00:00.000Z' } : r));

    expect(resolutionAfterTransition('started', 'canceled', null, 'res_duplicate', archived)).toBe('res_wontdo');
    expect(resolutionAfterTransition('started', 'canceled', null, 'res_nope', res)).toBe('res_wontdo');
  });

  it('skips an archived default and gives nothing when no default is left', () => {
    const noDefault: Resolution[] = res.map((r) => (r.id === 'res_done' ? { ...r, archived_at: '2026-10-01T00:00:00.000Z' } : r));

    expect(resolutionAfterTransition('started', 'completed', null, null, noDefault)).toBeNull();
  });
});
