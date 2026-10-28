import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Kbd } from './Kbd';
import { toast } from './toast';
import { Toaster } from './Toaster';

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
