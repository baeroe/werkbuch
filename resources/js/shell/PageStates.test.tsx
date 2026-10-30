import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorPage, NotFound } from './PageStates';

vi.mock('@inertiajs/react', () => ({
  Link: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  document.title = '';
  vi.unstubAllGlobals();
});

describe('NotFound', () => {
  it('says the page does not exist and leads to "Meine Items"', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Meine Items öffnen' }).getAttribute('href')).toBe('/my-items');
    expect(document.title).toBe('Nicht gefunden – werkbuch');
  });

  it('names what is missing when the screen knows more', () => {
    render(<NotFound title="WEB-999 gibt es nicht" description="Der Schlüssel stimmt nicht." />);

    expect(screen.getByRole('heading', { level: 1, name: 'WEB-999 gibt es nicht' })).toBeTruthy();
    expect(screen.getByText('Der Schlüssel stimmt nicht.')).toBeTruthy();
  });
});

describe('ErrorPage', () => {
  it.each([
    [403, 'Kein Zugriff', 'Dein Konto darf diese Seite nicht sehen.'],
    [500, 'Da ist etwas schiefgelaufen', 'Auf dem Server ist etwas schiefgelaufen.'],
    [503, 'werkbuch ist gerade nicht erreichbar', 'Der Server ist gerade in Wartung oder überlastet.'],
  ] as const)('says what happened at status %i', (status, title, description) => {
    render(<ErrorPage status={status} />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${description}`))).toBeTruthy();
    expect(document.title).toBe(`${title} – werkbuch`);
  });

  it('reloads the page on "Neu laden"', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(<ErrorPage status={503} />);

    await user.click(screen.getByRole('button', { name: 'Neu laden' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
