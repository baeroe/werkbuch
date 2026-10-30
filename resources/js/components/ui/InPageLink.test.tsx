import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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

it('takes the focus away from a heading again when it leaves it, and scrolls to it', () => {
  const scrollIntoView = vi.fn();
  render(
    <>
      <InPageLink to="section">Zum Abschnitt</InPageLink>
      <h2 id="section">Abschnitt</h2>
    </>,
  );
  const heading = screen.getByRole('heading', { name: 'Abschnitt' });
  heading.scrollIntoView = scrollIntoView;

  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'Zum Abschnitt' }));
  });
  expect(heading.getAttribute('tabindex')).toBe('-1');
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

  act(() => heading.blur());
  expect(heading.hasAttribute('tabindex')).toBe(false);
});

it('leaves the click alone when its own handler prevents it or when the target is missing', () => {
  render(
    <>
      <InPageLink to="main" onClick={(event) => event.preventDefault()}>
        Zum Inhalt
      </InPageLink>
      <main id="main">Inhalt</main>
      <InPageLink to="nirgends">Ins Leere</InPageLink>
    </>,
  );

  act(() => {
    fireEvent.click(screen.getByRole('link', { name: 'Zum Inhalt' }));
  });
  expect(document.activeElement).not.toBe(screen.getByRole('main'));

  // no target: the browser's own behaviour stays
  expect(fireEvent.click(screen.getByRole('link', { name: 'Ins Leere' }))).toBe(true);
});
