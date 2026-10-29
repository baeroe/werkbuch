import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { InPageLink } from './InPageLink';

it('moves the focus to its target and leaves the address alone, so a router in the hash keeps its route', () => {
  window.history.replaceState(null, '', '/#/inbox');
  render(
    <>
      <InPageLink to="main">Zum Inhalt</InPageLink>
      <main id="main" tabIndex={-1}>
        Inhalt
      </main>
      <h2 id="section">Abschnitt</h2>
      <InPageLink to="section">Zum Abschnitt</InPageLink>
    </>,
  );

  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'Zum Inhalt' }));
  });
  expect(document.activeElement).toBe(screen.getByRole('main'));
  expect(window.location.hash).toBe('#/inbox');

  // a heading takes the focus only for the jump
  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'Zum Abschnitt' }));
  });
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Abschnitt' }));
  expect(window.location.hash).toBe('#/inbox');
  window.history.replaceState(null, '', '/');
});
