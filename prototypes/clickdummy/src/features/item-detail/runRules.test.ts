/* The rules of the run line and the PR section (WEBU-18): when „Erneut starten“ belongs to a run, when the way back is
 * a new assignment, and which checks count as red. */

import { describe, expect, it } from 'vitest';
import type { AgentRun, PullRequestCheck } from '@/types';
import { ciOf } from './PullRequests';
import { canRetry, needsGiveBack } from './RunLine';

const run = (status: AgentRun['status'], id = 'r1') => ({ id, status, bot_id: 'u_kira' }) as AgentRun;

describe('Erneut starten', () => {
  it('belongs to the last run that ended badly, while the item is with the bot on an open strand', () => {
    const failed = run('timed_out');
    expect(canRetry(failed, [failed], { assignee_id: 'u_kira' }, { status: 'open' })).toBe(true);
    expect(needsGiveBack(failed, [failed], { assignee_id: 'u_kira' }, { status: 'open' })).toBe(false);
  });

  it('gives way to „Wieder Kira zuweisen“ when a person took the item over or the strand paused (spec 7.2)', () => {
    const canceled = run('canceled');
    expect(canRetry(canceled, [canceled], { assignee_id: 'u_jonas' }, { status: 'paused' })).toBe(false);
    expect(needsGiveBack(canceled, [canceled], { assignee_id: 'u_jonas' }, { status: 'paused' })).toBe(true);
    expect(canRetry(canceled, [canceled], { assignee_id: 'u_kira' }, { status: 'paused' })).toBe(false);
  });

  it('is not there for a run that succeeded, an older one, or while another one is active', () => {
    const failed = run('failed', 'r1');
    expect(canRetry(run('succeeded'), [run('succeeded')], { assignee_id: 'u_kira' }, null)).toBe(false);
    expect(canRetry(failed, [failed, run('failed', 'r2')], { assignee_id: 'u_kira' }, null)).toBe(false);
    expect(canRetry(failed, [failed, run('queued', 'r2')], { assignee_id: 'u_kira' }, null)).toBe(false);
  });
});

describe('ciOf', () => {
  const check = (status: PullRequestCheck['status'], conclusion: PullRequestCheck['conclusion']): PullRequestCheck => ({ name: 'tests', status, conclusion });

  it('is red for every end but success, skipped and neutral', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'stale'] as const) {
      expect(ciOf([check('completed', 'success'), check('completed', conclusion)]).label).toBe('CI rot');
    }
    expect(ciOf([check('completed', 'success'), check('completed', 'skipped'), check('completed', 'neutral')]).label).toBe('CI grün');
    expect(ciOf([check('completed', 'success'), check('in_progress', null)]).label).toBe('CI läuft');
    expect(ciOf([]).label).toBe('Keine Checks');
  });
});
