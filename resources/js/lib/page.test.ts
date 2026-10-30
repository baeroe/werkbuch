import { usePage } from '@inertiajs/react';
import { describe, expect, it, vi } from 'vitest';
import { type SharedProps, useSharedProps } from '@/lib/page';

vi.mock('@inertiajs/react');

const props: SharedProps = {
  auth: {
    user: {
      id: '01k8z0a1b2c3d4e5f6g7h8j9k0',
      type: 'person',
      name: 'Mara Lindqvist',
      handle: 'mara',
      email: 'mara@example.com',
      org_role: 'admin',
      is_default_bot: false,
      owner_id: null,
      disabled_at: null,
      avatar_url: null,
      locale: 'de',
      timezone: 'Europe/Berlin',
    },
    permissions: ['org.manage', 'project.create'],
  },
  organization: { id: '01k8z0a1b2c3d4e5f6g7h8j9k1', name: 'Feldwerk', locale: 'de', timezone: 'Europe/Berlin', week_start: 1, logo_url: null },
  locale: 'de',
  translations: {},
  features: { mail: true, live: null },
  flash: { status: null, error: null },
  errors: {},
};

describe('useSharedProps', () => {
  it('returns the props of the current page', () => {
    vi.mocked(usePage).mockReturnValue({ props } as unknown as ReturnType<typeof usePage>);
    expect(useSharedProps()).toBe(props);
  });
});
