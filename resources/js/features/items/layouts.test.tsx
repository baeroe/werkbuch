/*
 * The layouts that come as chunks of their own (board, table, timeline) and the boundary around them (T18-M5): a chunk
 * that does not load shows the list's error with "Erneut versuchen", which asks for the chunk again.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lateLayout, LayoutChunkError, type LayoutProps } from './layouts';
import { LayoutBoundary } from './ListStates';

const props: LayoutProps = {
  groups: [],
  groupBy: 'none',
  display: { layout: 'board', group_by: 'none', sort: { field: 'rank', direction: 'asc' }, fields: [], show_sub_items: true },
  total: 0,
  selection: [],
  onSelect: () => {},
  onOpen: () => {},
  onPeek: () => {},
  cursorId: null,
  onCursor: () => {},
};

const Board = () => <p>Das Board</p>;

/** The next boundary up, where any other error of a layout goes. */
class Outer extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error === null ? this.props.children : <p>Fehler der Seite: {String((this.state.error as Error).message)}</p>;
  }
}

function renderLayout(Layout: ReturnType<typeof lateLayout>) {
  return render(
    <Outer>
      <LayoutBoundary>
        <Suspense fallback={<p>Lädt das Layout</p>}>
          <Layout {...props} />
        </Suspense>
      </LayoutBoundary>
    </Outer>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('a layout of its own chunk', () => {
  it('shows a layout once its chunk is there', async () => {
    renderLayout(lateLayout(() => Promise.resolve(Board)));
    expect(await screen.findByText('Das Board')).toBeTruthy();
  });

  it('shows a failed layout chunk with a retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn<() => Promise<typeof Board>>().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValue(Board);
    renderLayout(lateLayout(load));

    const alert = await screen.findByRole('alert');
    // the items are there, only the code of the layout is missing (19b-M1)
    expect(alert.textContent).toContain('Das Layout konnte nicht geladen werden');
    expect(alert.textContent).toContain('Die Items sind schon da. „Erneut versuchen“ lädt das Layout noch einmal.');
    expect(alert.textContent).not.toContain('Die Items konnten nicht geladen werden');
    expect(errors.mock.calls.some(([error]) => error instanceof LayoutChunkError)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    // "Erneut versuchen" asks for the chunk again (a lazy component keeps its failure, the layout gets a new one)
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Das Board')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets any other error of a layout through to the next boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      throw new Error('kaputt');
    };
    renderLayout(lateLayout(() => Promise.resolve(Broken)));
    expect(await screen.findByText('Fehler der Seite: kaputt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });
});
