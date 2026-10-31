import { describe, expect, it } from 'vitest';
import type { User } from '@/types';
import { canTakeWork } from './people';

const account = (overrides: Partial<User>): Pick<User, 'type' | 'org_role' | 'is_default_bot' | 'disabled_at'> => ({
  type: 'person',
  org_role: 'member',
  is_default_bot: false,
  disabled_at: null,
  ...overrides,
});

describe('canTakeWork: who can be assigned and mentioned (spec 4.2, 4.8, 4.16)', () => {
  it('takes the members of the project, people and bots', () => {
    expect(canTakeWork(account({}), true)).toBe(true);
    expect(canTakeWork(account({ type: 'bot' }), true)).toBe(true);
  });

  it('takes people who are org admins also without membership, but no bot without it', () => {
    expect(canTakeWork(account({ org_role: 'admin' }), false)).toBe(true);
    expect(canTakeWork(account({ type: 'bot', org_role: 'admin' }), false)).toBe(false);
    // the default bot is an org admin only so that automations may act everywhere: it counts as a member only
    expect(canTakeWork(account({ type: 'bot', org_role: 'admin', is_default_bot: true }), false)).toBe(false);
    expect(canTakeWork(account({ type: 'bot', org_role: 'admin', is_default_bot: true }), true)).toBe(true);
  });

  it('takes nobody who only sees a public project, and no deactivated account', () => {
    expect(canTakeWork(account({}), false)).toBe(false);
    expect(canTakeWork(account({ disabled_at: '2026-09-18T15:00:00.000Z' }), true)).toBe(false);
  });
});
