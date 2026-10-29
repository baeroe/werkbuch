import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { CreateHost } from './CreateHost';

const cleanups: (() => void)[] = [];

beforeEach(() => useUiStore.setState(useUiStore.getInitialState()));
afterEach(() => cleanups.splice(0).forEach((off) => off()));

describe('CreateHost', () => {
  it('holds the page’s shortcuts from the moment the dialog opens, before its code has loaded', () => {
    const help = vi.fn();
    cleanups.push(registerShortcut({ id: 'test.help', keys: '?', scope: 'global', label: 'Alle Kürzel', group: 'Test', run: help }));
    render(<CreateHost />);

    // "c", then "?" a moment later: the dialog's code is still on its way, nothing of it is mounted yet
    act(() => useUiStore.getState().openCreate());
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
    expect(help).not.toHaveBeenCalled();

    act(() => useUiStore.getState().closeCreate());
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
    expect(help).toHaveBeenCalledTimes(1);
  });
});
