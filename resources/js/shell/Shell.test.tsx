import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { Shell } from './Shell';

// What the server flashed as an error shows as a toast once per visit. The browser suite cannot provoke a flashed
// error inside the shell (a refused request needs a stale CSRF token, which a same-origin browser never sends).

type Flash = { status: string | null; error: string | null };
let flash: Flash = { status: null, error: null };

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({
    props: { auth: { user: { id: '1', type: 'person', name: 'Mara Lindqvist', handle: 'mara', email: null, locale: 'de', timezone: null, avatar_url: null }, permissions: [] }, flash, features: { mail: true, live: null } },
    url: '/my-items',
  }),
  router: { visit: vi.fn(), post: vi.fn() },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  act(() => resetToasts());
  flash = { status: null, error: null };
});

/** The error toasts with how often each was shown again (the same error refreshes the toast on screen). */
const errors = () => currentToasts().filter((item) => item.tone === 'error').map((item) => [item.title, item.round]);

describe('Shell', () => {
  it('shows a flashed error as a toast once per visit', () => {
    flash = { status: null, error: 'Die Seite ist abgelaufen.' };
    const { rerender } = render(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 0]]);

    // the same visit renders again: the toast is not shown again
    rerender(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 0]]);

    // the next visit brings a new flash, even with the same text: shown again
    flash = { status: null, error: 'Die Seite ist abgelaufen.' };
    rerender(<Shell>Inhalt</Shell>);
    expect(errors()).toEqual([['Die Seite ist abgelaufen.', 1]]);
  });

  it('shows nothing when the visit flashed no error', () => {
    render(<Shell>Inhalt</Shell>);

    expect(screen.getByText('Inhalt')).toBeTruthy();
    expect(errors()).toEqual([]);
  });
});
