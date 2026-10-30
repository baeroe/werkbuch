import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorLayout } from '@/shell/layout';
import ErrorScreen from './Error';
import NotFoundPage from './NotFound';

// The browser suite (e2e/) cannot reach these: no route answers 403, 500 or 503 yet, and an unknown path sends a guest
// to the sign-in, so the error pages without a session only show here.

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: null, permissions: [] }, flash: { status: null, error: null } }, url: '/' }),
  Link: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe('error pages', () => {
  it('show a guest the page alone, without the shell', () => {
    render(
      <ErrorLayout>
        <ErrorScreen status={503} />
      </ErrorLayout>,
    );

    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('heading', { level: 1, name: 'werkbuch ist gerade nicht erreichbar' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('use the error layout, so signed-in people see them in the shell', () => {
    expect(ErrorScreen.layout).toBe(ErrorLayout);
    expect(NotFoundPage.layout).toBe(ErrorLayout);
  });

  it('name the status of the server', () => {
    render(<ErrorScreen status={403} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kein Zugriff' })).toBeTruthy();
  });
});
