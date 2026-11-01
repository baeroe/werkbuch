import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCommands, registerCommand, useCommand, useCommands, type CommandDef } from './commands';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((off) => off()));

const command = (id: string, label: string): CommandDef => ({ id, label, group: 'Aktionen', run: vi.fn() });

describe('command registry', () => {
  it('keeps the place of a command that registers again, so the palette does not reorder', () => {
    const offSidebar = registerCommand(command('sidebar', 'Seitenleiste einklappen'));
    cleanups.push(registerCommand(command('help', 'Alle Tastaturkürzel')));

    // the label follows the state: the command registers again
    offSidebar();
    cleanups.push(registerCommand(command('sidebar', 'Seitenleiste ausklappen')));

    expect(listCommands().map((entry) => entry.label)).toEqual(['Seitenleiste ausklappen', 'Alle Tastaturkürzel']);
  });

  it('replaces a command registered again under its id, and the old handle no longer removes it', () => {
    const offFirst = registerCommand(command('theme', 'Theme wechseln …'));
    cleanups.push(registerCommand(command('theme', 'Farbschema wechseln …')));

    offFirst();

    expect(listCommands().map((entry) => entry.label)).toEqual(['Farbschema wechseln …']);
  });

  it('registers a command while mounted, always with the latest callbacks, and lists it to subscribers', () => {
    const runs: number[] = [];
    let setCount!: (count: number) => void;
    function Screen() {
      const [count, set] = useState(0);
      setCount = set;
      useCommand({
        id: 'screen.count',
        label: 'Zählen',
        group: 'Screen',
        run: () => runs.push(count),
        when: () => count > 0,
        subpage: () => ({ options: [{ id: 'one', label: `Option ${count}`, run: () => {} }] }),
      });
      return null;
    }
    function Labels() {
      return <ul>{useCommands().map((entry) => <li key={entry.id}>{entry.label}</li>)}</ul>;
    }
    const view = render(
      <>
        <Screen />
        <Labels />
      </>,
    );
    const registered = () => listCommands().find((entry) => entry.id === 'screen.count')!;

    expect(view.getByText('Zählen')).toBeTruthy();
    expect(registered().when?.()).toBe(false);
    act(() => setCount(2));
    // not registered again for a new count: the callbacks read the latest render
    registered().run();
    expect(runs).toEqual([2]);
    expect(registered().when?.()).toBe(true);
    expect(registered().subpage?.().options[0]!.label).toBe('Option 2');

    view.unmount();
    expect(listCommands().some((entry) => entry.id === 'screen.count')).toBe(false);
  });
});
