import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Input } from './Input';
import { Kbd } from './Kbd';
import { currentToasts, dismissToast, toast } from './toast';
import { Toaster } from './Toaster';

// The toast store is shared by all tests: close whatever a test left open.
afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

describe('Kbd on a Mac', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
  });
  afterEach(() => {
    // drop the own property again, so the jsdom default applies
    Reflect.deleteProperty(window.navigator, 'platform');
  });

  it('Kbd renders "mod+k" with the accessible name "Befehl K"', () => {
    const { container } = render(<Kbd keys="mod+k" />);

    expect(screen.getByRole('img', { name: 'Befehl K' })).toBeTruthy();
    // macOS glyph: mod is the command key, not "Strg"
    expect(container.querySelector('svg.lucide-command')).not.toBeNull();
    expect(container.textContent).not.toContain('Strg');
  });
});

it('Button with pending shows a busy state and is disabled', () => {
  render(
    <Button variant="primary" pending>
      Speichern
    </Button>,
  );

  const button = screen.getByRole('button', { name: 'Speichern' });
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.hasAttribute('disabled')).toBe(true);
});

it('toast with action calls onExpire after the duration unless the action ran', () => {
  vi.useFakeTimers();
  try {
    render(<Toaster />);

    const undo = vi.fn();
    const expireAfterUndo = vi.fn();
    act(() => {
      toast({ title: 'WEB-51 archiviert', action: { label: 'Rückgängig', onClick: undo }, onExpire: expireAfterUndo });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(undo).toHaveBeenCalledTimes(1);

    const expire = vi.fn();
    act(() => {
      toast({ title: 'WEB-52 archiviert', action: { label: 'Rückgängig', onClick: vi.fn() }, onExpire: expire });
    });
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(expire).not.toHaveBeenCalled();
    expect(screen.getByText('WEB-52 archiviert')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('WEB-52 archiviert')).toBeNull();
    expect(expireAfterUndo).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('toast still expires after the focused toast was closed by hand', () => {
  vi.useFakeTimers();
  try {
    render(<Toaster />);
    act(() => {
      toast({ title: 'WEB-51 archiviert' });
    });
    const close = screen.getByRole('button', { name: 'Hinweis schließen' });
    // the focus sits on the close button when it is pressed; the removed button sends no blur
    fireEvent.focus(close);
    fireEvent.click(close);

    const expire = vi.fn();
    act(() => {
      toast({ title: 'WEB-52 archiviert', onExpire: expire });
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(expire).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('toast still expires after a hovered toast was closed while the pointer stayed', () => {
  vi.useFakeTimers();
  try {
    render(<Toaster />);
    let first = 0;
    act(() => {
      first = toast({ title: 'WEB-51 archiviert' });
    });
    // a mouse hover sends pointer and mouse events
    const title = screen.getByText('WEB-51 archiviert');
    fireEvent.pointerEnter(title);
    fireEvent.mouseEnter(title);
    // closed from elsewhere (e.g. mod+z): the pointer never leaves the removed toast
    act(() => dismissToast(first));

    const expire = vi.fn();
    act(() => {
      toast({ title: 'WEB-52 archiviert', onExpire: expire });
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(expire).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('toast waits while the pointer is on it and runs out the rest of its time after the pointer left', () => {
  vi.useFakeTimers();
  try {
    render(<Toaster />);
    const expire = vi.fn();
    act(() => {
      toast({ title: 'WEB-51 archiviert', onExpire: expire });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const title = screen.getByText('WEB-51 archiviert');
    fireEvent.pointerEnter(title);
    fireEvent.mouseEnter(title);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(expire).not.toHaveBeenCalled();

    fireEvent.pointerLeave(title);
    fireEvent.mouseLeave(title);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(expire).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(expire).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('Field keeps a polite live region for errors, so an error that appears is announced', () => {
  const { container, rerender } = render(<Input label="Aufwand (h)" name="effort" />);
  const region = container.querySelector('[aria-live="polite"]');
  expect(region).not.toBeNull();

  rerender(<Input label="Aufwand (h)" name="effort" error="Nur eine Zahl eingeben, zum Beispiel 3,5" />);
  // the same region, rendered before the error, now carries the message
  expect(region?.textContent).toContain('Nur eine Zahl eingeben, zum Beispiel 3,5');
  expect(screen.getByRole('textbox', { name: 'Aufwand (h)' }).getAttribute('aria-invalid')).toBe('true');
});

it('an open Dialog pauses the list shortcuts of the page behind it', async () => {
  const next = vi.fn();
  const off = registerShortcut({ id: 'test.list.next', keys: 'j', scope: 'list', label: 'Nächstes Item', group: 'Liste', run: next });
  const press = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
  try {
    const { rerender } = render(<Dialog open title="Neues Item" />);
    expect(await screen.findByRole('dialog', { name: 'Neues Item' })).toBeTruthy();
    press();
    expect(next).not.toHaveBeenCalled();

    rerender(<Dialog open={false} title="Neues Item" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    press();
    expect(next).toHaveBeenCalledTimes(1);
  } finally {
    off();
  }
});
