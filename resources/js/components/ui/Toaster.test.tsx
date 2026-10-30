import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/lib/i18n';
import en from '../../../../lang/en.json';
import { currentToasts, dismissToast, resetToasts, toast, waitingToasts } from './toast';
import { Toaster, ToastCard } from './Toaster';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  act(() => resetToasts());
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const titles = () => currentToasts().map((item) => item.title);

describe('Toaster', () => {
  it('renders two live regions that stay in the page while empty, so the first toast is announced', () => {
    const { container } = render(<Toaster />);

    const regions = container.querySelectorAll('[role="status"][aria-live="polite"]');
    expect(regions).toHaveLength(2);
    expect(container.querySelector('[data-paused]')).toBeNull();
  });

  it('shows the title, the description, the tone and the time line of a toast, and closes it with its button', () => {
    const onExpire = vi.fn();
    const { container } = render(<Toaster />);
    act(() => {
      toast({ title: 'Gespeichert', description: 'WEB-51 ist aktuell.', tone: 'success', duration: 2000, onExpire });
      toast({ title: 'Nicht möglich', tone: 'error' });
      toast({ title: 'Link kopiert' });
    });

    expect(screen.getByText('WEB-51 ist aktuell.')).toBeTruthy();
    expect(container.querySelector('svg.lucide-circle-check')).not.toBeNull();
    expect(container.querySelector('svg.lucide-circle-alert')).not.toBeNull();
    expect(screen.getByText('Nicht möglich').className).toContain('text-danger');
    expect(screen.getByText('Link kopiert').className).toContain('text-ink');
    const line = screen.getByText('Gespeichert').closest('div[class*="tracing-strong"]')?.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(line.style.getPropertyValue('--toast-duration')).toBe('2000ms');

    fireEvent.click(screen.getAllByRole('button', { name: 'Hinweis schließen' })[0]);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Gespeichert')).toBeNull();
  });

  it('names the close button in English on an English page', () => {
    initI18n({ locale: 'en', translations: en });
    render(<Toaster />);
    act(() => void toast({ title: 'Saved' }));

    expect(screen.getByRole('button', { name: 'Dismiss notice' })).toBeTruthy();
  });

  it('pauses the time while the pointer is on a toast and runs out the rest of it afterwards', () => {
    const expire = vi.fn();
    const { container } = render(<Toaster />);
    act(() => void toast({ title: 'WEB-51 archiviert', onExpire: expire }));
    advance(3000);

    const card = screen.getByText('WEB-51 archiviert').closest('div[class*="tracing-strong"]')!;
    fireEvent.pointerEnter(card);
    expect(container.querySelector('[data-paused]')).not.toBeNull();
    advance(60_000);
    expect(expire).not.toHaveBeenCalled();

    fireEvent.pointerLeave(card);
    expect(container.querySelector('[data-paused]')).toBeNull();
    advance(1999);
    expect(expire).not.toHaveBeenCalled();
    advance(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('pauses the time while the keyboard focus is inside a toast, also when it moves between its buttons, and runs out the rest after it left', () => {
    const expire = vi.fn();
    const { container } = render(
      <>
        <button type="button">Daneben</button>
        <Toaster />
      </>,
    );
    act(() => void toast({ title: 'WEB-51 archiviert', action: { label: 'Rückgängig', onClick: () => {} }, onExpire: expire }));
    advance(4000);

    const undo = screen.getByRole('button', { name: 'Rückgängig' });
    const close = screen.getByRole('button', { name: 'Hinweis schließen' });
    act(() => undo.focus());
    expect(container.querySelector('[data-paused]')).not.toBeNull();
    advance(60_000);
    expect(expire).not.toHaveBeenCalled();

    // from one button of the toast to the other: still held
    act(() => close.focus());
    expect(container.querySelector('[data-paused]')).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Daneben' }).focus());
    expect(container.querySelector('[data-paused]')).toBeNull();
    advance(999);
    expect(expire).not.toHaveBeenCalled();
    advance(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('pauses the time of all toasts while one of them is held', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<Toaster />);
    act(() => {
      toast({ title: 'Eins', onExpire: first });
      toast({ title: 'Zwei', onExpire: second });
    });
    advance(2000);

    fireEvent.pointerEnter(screen.getByText('Zwei').closest('div[class*="tracing-strong"]')!);
    advance(60_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    fireEvent.pointerLeave(screen.getByText('Zwei').closest('div[class*="tracing-strong"]')!);
    advance(3000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('shows three toasts at most: a fourth pushes out the oldest, which expires', () => {
    const expire = vi.fn();
    render(<Toaster />);
    act(() => {
      toast({ title: 'Eins', onExpire: expire });
      toast({ title: 'Zwei' });
      toast({ title: 'Drei' });
    });
    expect(screen.getAllByRole('button', { name: 'Hinweis schließen' })).toHaveLength(3);

    act(() => void toast({ title: 'Vier' }));

    expect(titles()).toEqual(['Zwei', 'Drei', 'Vier']);
    expect(screen.queryByText('Eins')).toBeNull();
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('does not push out a toast with an undo: it stays its whole time and the new one waits for a place', () => {
    const run = vi.fn();
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      for (const title of ['WEB-50 gelöscht', 'WEB-51 gelöscht', 'WEB-52 gelöscht']) {
        toast({ title, keep: true, action: { label: 'Rückgängig', onClick: undo }, onExpire: run });
      }
      toast({ title: 'Link kopiert' });
    });

    expect(titles()).toEqual(['WEB-50 gelöscht', 'WEB-51 gelöscht', 'WEB-52 gelöscht']);
    expect(waitingToasts().map((item) => item.title)).toEqual(['Link kopiert']);
    expect(screen.queryByText('Link kopiert')).toBeNull();
    expect(run).not.toHaveBeenCalled();

    // the first one runs out and the waiting toast takes its place
    advance(5000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Link kopiert')).toBeTruthy();
    expect(waitingToasts()).toHaveLength(0);
  });

  it('shows an error toast at once, beyond the three places, in a region below the others', () => {
    render(<Toaster />);
    act(() => {
      for (const title of ['WEB-50 gelöscht', 'WEB-51 gelöscht', 'WEB-52 gelöscht']) toast({ title, keep: true, action: { label: 'Rückgängig', onClick: () => {} } });
      toast({ title: 'Status nicht geändert', tone: 'error' });
    });

    expect(screen.getAllByRole('button', { name: 'Hinweis schließen' })).toHaveLength(4);
    const [notices, errors] = Array.from(document.querySelectorAll('[role="status"]'));
    expect(notices.textContent).not.toContain('Status nicht geändert');
    expect(errors.textContent).toContain('Status nicht geändert');
    expect(titles()).toHaveLength(4);
  });

  it('an error does not push out a notice, and a notice does not push out an error', () => {
    render(<Toaster />);
    act(() => {
      toast({ title: 'Eins' });
      toast({ title: 'Zwei' });
      toast({ title: 'Drei' });
      toast({ title: 'Status nicht geändert', tone: 'error' });
      toast({ title: 'Vier' });
    });

    // only 'Eins', the oldest notice, made room: the error took no place and is never pushed out
    expect(titles()).toEqual(['Zwei', 'Drei', 'Status nicht geändert', 'Vier']);
  });

  it('a held toast that is closed lets go of the pause', () => {
    const { container } = render(<Toaster />);
    let id = 0;
    act(() => {
      id = toast({ title: 'Eins' });
    });
    fireEvent.pointerEnter(screen.getByText('Eins').closest('div[class*="tracing-strong"]')!);
    expect(container.querySelector('[data-paused]')).not.toBeNull();

    act(() => dismissToast(id));

    expect(container.querySelector('[data-paused]')).toBeNull();
  });
});

describe('ToastCard', () => {
  it('shows a toast on its own, as the component gallery does, and runs its action', () => {
    const onClick = vi.fn();
    render(<ToastCard item={{ id: 99, title: 'Entwurf gespeichert', tone: 'success', duration: 5000, action: { label: 'Ansehen', onClick } }} className="mx-auto" />);

    expect(screen.getByText('Entwurf gespeichert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }));
    // the card is not in the store: its action does nothing, and nothing breaks
    expect(onClick).not.toHaveBeenCalled();
  });
});
