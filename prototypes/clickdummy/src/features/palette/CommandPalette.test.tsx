import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommand } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { CommandPalette } from './CommandPalette';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  resetApi();
  useUiStore.setState({ ...useUiStore.getInitialState(), paletteOpen: true });
});

afterEach(() => cleanups.splice(0).forEach((off) => off()));

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  it('leaves Enter and the arrows to an input method that is composing (Safari sends keyCode 229)', async () => {
    const first = vi.fn();
    const second = vi.fn();
    cleanups.push(registerCommand({ id: 'test.first', label: 'Erster Befehl', group: 'Test', run: first }));
    cleanups.push(registerCommand({ id: 'test.second', label: 'Zweiter Befehl', group: 'Test', run: second }));
    renderPalette();
    const input = await screen.findByRole('combobox', { name: 'Suchen oder Befehl eingeben' });

    // choosing a word in the input method: the arrow and the Enter belong to it
    fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(useUiStore.getState().paletteOpen).toBe(true);

    // the composition is over: Enter runs the active row, still the first
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('opened in a sub-list by a shortcut (s), it puts the focus into the input, not on the chip that goes back', async () => {
    const done = vi.fn();
    cleanups.push(
      registerCommand({
        id: 'test.state',
        label: 'Status ändern …',
        group: 'Test',
        run: () => {},
        subpage: () => ({ options: [{ id: 'todo', label: 'Todo', run: vi.fn() }, { id: 'done', label: 'Done', run: done }] }),
      }),
    );
    useUiStore.setState({ paletteOpen: true, paletteCommandId: 'test.state' });
    renderPalette();

    const input = await screen.findByRole('combobox', { name: 'Status ändern …' });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
