import { describe, expect, it } from 'vitest';
import type { AgentRun } from '@/types';
import type { TimelineEntry } from './timeline';
import { withRuns } from './Activity';

describe('withRuns', () => {
  it('places a run and a comment of the same second by their microseconds', () => {
    const comment = { kind: 'comment', key: 'c', at: '2026-11-26T10:00:00.100000Z', comment: {} } as unknown as TimelineEntry;
    const run = { id: 'r', created_at: '2026-11-26T10:00:00.250000Z' } as AgentRun;
    const later = { kind: 'comment', key: 'd', at: '2026-11-26T10:00:00.300000Z', comment: {} } as unknown as TimelineEntry;

    expect(withRuns([later, comment], [run], 'all').map((line) => line.key)).toEqual(['c', 'r', 'd']);
  });
});
