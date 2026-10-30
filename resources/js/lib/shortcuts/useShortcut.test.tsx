import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listShortcuts, registerShortcut } from './registry';
import { useDialogScope, useShortcut, useShortcutList } from './useShortcut';

const press = (key: string, init: KeyboardEventInit = {}) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

afterEach(() => document.body.replaceChildren());

describe('useShortcut', () => {
  it('registers with the keys, scope, label and group of the catalog, and leaves on unmount', () => {
    const { unmount } = renderHook(() => useShortcut('shell.help', vi.fn()));

    expect(listShortcuts()).toMatchObject([
      { id: 'shell.help', keys: '?', scope: 'global', label: 'shortcuts.shell.help', group: 'shortcuts.group.general' },
    ]);

    unmount();
    expect(listShortcuts()).toEqual([]);
  });

  it('registers an instance as id:instance, so the same entry can be bound twice', () => {
    const page = renderHook(() => useShortcut('shell.help', vi.fn()));
    const peek = renderHook(() => useShortcut('shell.help', vi.fn(), { instance: 'peek' }));

    expect(listShortcuts().map((entry) => entry.id)).toEqual(['shell.help', 'shell.help:peek']);

    page.unmount();
    peek.unmount();
  });

  it('runs on its keys', () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => useShortcut('shell.go.inbox', run));

    press('g');
    press('i');
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('skips the run while its condition is false', () => {
    const run = vi.fn();
    let allowed = false;
    const { unmount } = renderHook(() => useShortcut('shell.help', run, { when: () => allowed }));

    press('?', { shiftKey: true });
    expect(run).not.toHaveBeenCalled();

    allowed = true;
    press('?', { shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('runs the callback of the latest render without registering again', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ run }) => useShortcut('shell.help', run), { initialProps: { run: first } });
    const registered = listShortcuts()[0];

    rerender({ run: second });
    press('?', { shiftKey: true });

    expect(listShortcuts()[0]).toBe(registered);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('registers again when a dependency changes', () => {
    const { rerender, unmount } = renderHook(({ dep }) => useShortcut('shell.help', vi.fn(), { deps: [dep] }), { initialProps: { dep: 1 } });
    const registered = listShortcuts()[0];

    rerender({ dep: 1 });
    expect(listShortcuts()[0]).toBe(registered);
    rerender({ dep: 2 });
    expect(listShortcuts()[0]).not.toBe(registered);

    unmount();
  });
});

describe('useDialogScope', () => {
  it('pauses a list key while a dialog is open and frees it on unmount', () => {
    const next = vi.fn();
    const off = registerShortcut({ id: 'test.next', keys: 'j', scope: 'list', label: 'shortcuts.shell.help', group: 'shortcuts.group.general', run: next });

    const dialog = renderHook(() => useDialogScope());
    press('j');
    expect(next).not.toHaveBeenCalled();

    dialog.unmount();
    press('j');
    expect(next).toHaveBeenCalledTimes(1);

    off();
  });

  it('does nothing while inactive', () => {
    const next = vi.fn();
    const off = registerShortcut({ id: 'test.next', keys: 'j', scope: 'list', label: 'shortcuts.shell.help', group: 'shortcuts.group.general', run: next });

    const { rerender, unmount } = renderHook(({ active }) => useDialogScope(active), { initialProps: { active: false } });
    press('j');
    expect(next).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    press('j');
    expect(next).toHaveBeenCalledTimes(1);

    unmount();
    off();
  });
});

describe('useShortcutList', () => {
  it('follows what is registered', () => {
    const list = renderHook(() => useShortcutList());
    expect(list.result.current).toEqual([]);

    const shortcut = renderHook(() => useShortcut('shell.help', vi.fn()));
    expect(list.result.current.map((entry) => entry.id)).toEqual(['shell.help']);

    shortcut.unmount();
    expect(list.result.current).toEqual([]);
    list.unmount();
  });
});
