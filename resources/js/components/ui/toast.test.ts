import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction, setToastFocused, setToastHovered, toast, waitingToasts } from './toast';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  resetToasts();
  vi.useRealTimers();
});

const titles = () => currentToasts().map((item) => item.title);

describe('the toast store', () => {
  it('gives every toast its own id, five seconds by default and the neutral tone', () => {
    const first = toast({ title: 'Eins' });
    const second = toast({ title: 'Zwei', tone: 'success', duration: 1000 });

    expect(second).toBe(first + 1);
    expect(currentToasts()).toMatchObject([
      { id: first, duration: 5000, tone: 'neutral', keep: false },
      { id: second, duration: 1000, tone: 'success' },
    ]);
  });

  it('ignores hover and focus of a toast that is not shown (the gallery shows specimens)', () => {
    const expire = vi.fn();
    toast({ title: 'Eins', onExpire: expire });

    setToastHovered(9999, true);
    setToastFocused(9999, true);
    vi.advanceTimersByTime(5000);

    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('dismissing and running the action of an unknown toast does nothing', () => {
    expect(() => {
      dismissToast(9999);
      runToastAction(9999);
    }).not.toThrow();
  });

  it('closing a toast that still waits drops it without its action and without a trace', () => {
    const expire = vi.fn();
    for (const title of ['K1', 'K2', 'K3']) toast({ title, keep: true });
    const waiting = toast({ title: 'Wartet', onExpire: expire });
    expect(waitingToasts().map((item) => item.title)).toEqual(['Wartet']);

    dismissToast(waiting);

    expect(waitingToasts()).toHaveLength(0);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('a toast that took the place of a kept one is pushed out when an error leaves and another toast still waits', () => {
    const expire = vi.fn();
    const kept = ['K1', 'K2', 'K3'].map((title) => toast({ title, keep: true }));
    const error = toast({ title: 'Fehler', tone: 'error' });
    toast({ title: 'W1', onExpire: expire });
    toast({ title: 'W2' });
    // a place comes free: W1 takes it, W2 cannot push W1 out in the same pass
    dismissToast(kept[0]);
    expect(titles()).toEqual(['K2', 'K3', 'Fehler', 'W1']);
    expect(waitingToasts().map((item) => item.title)).toEqual(['W2']);

    // the error leaves; no place is free, so W2 pushes out W1, which has been on screen since the pass before
    dismissToast(error);

    expect(titles()).toEqual(['K2', 'K3', 'W2']);
    expect(waitingToasts()).toHaveLength(0);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('keeps the rest of the time of every toast while one is held, also for a toast that comes while it is held', () => {
    const early = vi.fn();
    const late = vi.fn();
    const first = toast({ title: 'Eins', onExpire: early });
    vi.advanceTimersByTime(1000);

    setToastHovered(first, true);
    toast({ title: 'Zwei', onExpire: late });
    vi.advanceTimersByTime(30_000);
    expect(early).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();

    setToastHovered(first, false);
    vi.advanceTimersByTime(4000);
    expect(early).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('refreshes the same error while the time is held: no time runs until it is released', () => {
    const refusal = { title: 'Nicht möglich', description: 'Du liest in WEB nur mit.', tone: 'error' } as const;
    const id = toast(refusal);
    setToastFocused(id, true);

    expect(toast(refusal)).toBe(id);
    vi.advanceTimersByTime(30_000);
    expect(titles()).toEqual(['Nicht möglich']);

    setToastFocused(id, false);
    vi.advanceTimersByTime(5000);
    expect(titles()).toEqual([]);
  });

  it('resetToasts clears everything, including what waits and what is held', () => {
    for (const title of ['K1', 'K2', 'K3', 'Wartet']) toast({ title, keep: true });
    setToastHovered(currentToasts()[0].id, true);

    resetToasts();

    expect(currentToasts()).toHaveLength(0);
    expect(waitingToasts()).toHaveLength(0);
    // nothing is held any more: a new toast runs out
    const expire = vi.fn();
    toast({ title: 'Neu', onExpire: expire });
    vi.advanceTimersByTime(5000);
    expect(expire).toHaveBeenCalledTimes(1);
  });
});
