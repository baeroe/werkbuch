import { usePage } from '@inertiajs/react';
import { describe, expect, it, vi } from 'vitest';
import { useSharedProps } from '@/lib/page';

vi.mock('@inertiajs/react');

describe('useSharedProps', () => {
  it('returns the props of the current page', () => {
    const props = { auth: { user: null, permissions: [] }, flash: { status: null, error: null } };
    vi.mocked(usePage).mockReturnValue({ props } as unknown as ReturnType<typeof usePage>);
    expect(useSharedProps()).toBe(props);
  });
});
