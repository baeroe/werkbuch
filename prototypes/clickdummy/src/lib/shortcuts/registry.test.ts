import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMac } from '@/lib/platform';
import { enterDialogScope, listShortcuts, registerShortcut, type ShortcutScope } from './registry';

const cleanups: (() => void)[] = [];
let sequence = 0;

/** Registers a shortcut for the running test; `run` is the spy behind it, `off` takes it out again. */
function shortcut(keys: string, { scope = 'global', when }: { scope?: ShortcutScope; when?: () => boolean } = {}) {
  const run = vi.fn();
  sequence += 1;
  const off = registerShortcut({ id: `test-${sequence}`, keys, scope, label: `${keys} (${scope})`, group: 'Test', run, when });
  cleanups.push(off);
  return { run, off };
}

/** A keydown on the element (the page when none is given) that bubbles up to the window, as the browser sends it. */
function press(key: string, { on = document.body, ...init }: KeyboardEventInit & { on?: Element } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  on.dispatchEvent(event);
  return event;
}

/** The modifier `mod` stands for on this platform. */
const mod = (): KeyboardEventInit => (isMac() ? { metaKey: true } : { ctrlKey: true });

/** A text field, a text area or a rich text editor (contenteditable, like Tiptap) on the page. */
function field(kind: 'input' | 'textarea' | 'editor'): HTMLElement {
  const element = document.createElement(kind === 'editor' ? 'div' : kind);
  if (kind === 'editor') element.setAttribute('contenteditable', 'true');
  document.body.append(element);
  return element;
}

afterEach(() => {
  cleanups.splice(0).forEach((off) => off());
  document.body.replaceChildren();
  Reflect.deleteProperty(window.navigator, 'platform');
  vi.useRealTimers();
});

describe('shortcut registry', () => {
  it('ignores single-key shortcuts while focus is in input, textarea or contenteditable', () => {
    const create = shortcut('c');

    for (const kind of ['input', 'textarea', 'editor'] as const) {
      const event = press('c', { on: field(kind) });
      // the letter must still reach the field
      expect(event.defaultPrevented).toBe(false);
    }
    expect(create.run).not.toHaveBeenCalled();

    press('c');
    expect(create.run).toHaveBeenCalledTimes(1);
  });

  it('still runs mod+k, escape and mod+enter while typing', () => {
    const palette = shortcut('mod+k');
    const close = shortcut('escape');
    const submit = shortcut('mod+enter');

    for (const kind of ['input', 'textarea', 'editor'] as const) {
      const on = field(kind);
      // the browser's own mod+k (search bar) must not run as well
      expect(press('k', { on, ...mod() }).defaultPrevented).toBe(true);
      press('Escape', { on });
      press('Enter', { on, ...mod() });
    }

    expect(palette.run).toHaveBeenCalledTimes(3);
    expect(close.run).toHaveBeenCalledTimes(3);
    expect(submit.run).toHaveBeenCalledTimes(3);
  });

  it('runs "g i" within 1000 ms and not after 1000 ms', () => {
    vi.useFakeTimers();
    const inbox = shortcut('g i');

    press('g');
    vi.advanceTimersByTime(999);
    press('i');
    expect(inbox.run).toHaveBeenCalledTimes(1);

    press('g');
    vi.advanceTimersByTime(1001);
    press('i');
    expect(inbox.run).toHaveBeenCalledTimes(1);
  });

  it('prefers the innermost active scope: dialog over detail over list over global', () => {
    // registered out of order, so that the order of registration cannot be what decides
    const list = shortcut('escape', { scope: 'list' });
    const dialog = shortcut('escape', { scope: 'dialog' });
    const global = shortcut('escape', { scope: 'global' });
    const detail = shortcut('escape', { scope: 'detail' });
    const calls = () => [dialog, detail, list, global].map((entry) => entry.run.mock.calls.length);

    press('Escape');
    expect(calls()).toEqual([1, 0, 0, 0]);

    dialog.off();
    press('Escape');
    expect(calls()).toEqual([1, 1, 0, 0]);

    detail.off();
    press('Escape');
    expect(calls()).toEqual([1, 1, 1, 0]);

    list.off();
    press('Escape');
    expect(calls()).toEqual([1, 1, 1, 1]);
  });

  it('reads mod as the command key on a Mac and as Control elsewhere', () => {
    const palette = shortcut('mod+k');

    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
    press('k', { ctrlKey: true });
    expect(palette.run).not.toHaveBeenCalled();
    press('k', { metaKey: true });
    expect(palette.run).toHaveBeenCalledTimes(1);

    Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true });
    press('k', { metaKey: true });
    expect(palette.run).toHaveBeenCalledTimes(1);
    press('k', { ctrlKey: true });
    expect(palette.run).toHaveBeenCalledTimes(2);
  });

  it('tells d from shift+d and takes ? however the keyboard layout produces it', () => {
    // "d" last, so that it would win a tie if shift were not told apart
    const start = shortcut('shift+d');
    const due = shortcut('d');
    const help = shortcut('?');

    press('d');
    press('D', { shiftKey: true });
    expect(due.run).toHaveBeenCalledTimes(1);
    expect(start.run).toHaveBeenCalledTimes(1);

    // US layout: shift and the slash key; German layout: shift and ß. Both arrive as "?" with shift held.
    press('?', { shiftKey: true });
    expect(help.run).toHaveBeenCalledTimes(1);
  });

  it('skips a shortcut whose condition is false and falls back to the next scope', () => {
    const clearSelection = shortcut('escape', { scope: 'list', when: () => false });
    const fallback = shortcut('escape');

    press('Escape');

    expect(clearSelection.run).not.toHaveBeenCalled();
    expect(fallback.run).toHaveBeenCalledTimes(1);
  });

  it('pauses list and detail shortcuts while a dialog is open, global ones keep working', () => {
    const next = shortcut('j', { scope: 'list' });
    const editTitle = shortcut('e', { scope: 'detail' });
    const create = shortcut('c');

    const leave = enterDialogScope();
    press('j');
    press('e');
    press('c');
    expect(next.run).not.toHaveBeenCalled();
    expect(editTitle.run).not.toHaveBeenCalled();
    expect(create.run).toHaveBeenCalledTimes(1);

    leave();
    press('j');
    press('e');
    expect(next.run).toHaveBeenCalledTimes(1);
    expect(editTitle.run).toHaveBeenCalledTimes(1);
  });

  it('leaves a key alone that a component has already handled', () => {
    const create = shortcut('c');
    // an open menu jumps to the entry starting with "c" and marks the key as handled (Base UI typeahead)
    const menu = document.createElement('div');
    menu.addEventListener('keydown', (event) => event.preventDefault());
    document.body.append(menu);

    press('c', { on: menu });
    expect(create.run).not.toHaveBeenCalled();

    // outside the menu the same key is a shortcut
    press('c');
    expect(create.run).toHaveBeenCalledTimes(1);
  });

  it('drops a started sequence when its next key is typed into a field', () => {
    vi.useFakeTimers();
    const inbox = shortcut('g i');

    press('g');
    press('i', { on: field('input') });

    expect(inbox.run).not.toHaveBeenCalled();
  });

  it('keeps the place of a shortcut that registers again, so the help does not reorder', () => {
    const def = { keys: 'e', scope: 'detail', label: 'Titel bearbeiten', group: 'Item', run: vi.fn() } as const;
    const offEdit = registerShortcut({ id: 'test.edit', ...def });
    cleanups.push(registerShortcut({ id: 'test.comment', keys: 'm', scope: 'detail', label: 'Kommentar schreiben', group: 'Item', run: vi.fn() }));

    offEdit();
    cleanups.push(registerShortcut({ id: 'test.edit', ...def, label: 'Titel ändern' }));

    expect(listShortcuts().map((entry) => entry.label)).toEqual(['Titel ändern', 'Kommentar schreiben']);
  });

  it('lists what is registered, for the help overlay', () => {
    const inbox = shortcut('g i');
    shortcut('c');
    expect(listShortcuts().map((entry) => entry.keys)).toEqual(['g i', 'c']);

    inbox.off();
    expect(listShortcuts().map((entry) => entry.keys)).toEqual(['c']);
  });
});
