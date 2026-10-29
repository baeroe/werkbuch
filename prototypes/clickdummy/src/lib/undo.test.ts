import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { currentToasts, dismissToast, runToastAction, toast } from '@/components/ui/toast';
import { canUndo, runWithUndo, undoLatest } from './undo';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  currentToasts().forEach((item) => dismissToast(item.id));
  vi.useRealTimers();
});

describe('runWithUndo', () => {
  it('shows the toast at once and runs the action only when the toast runs out', () => {
    const run = vi.fn();

    runWithUndo({ label: 'WEB-51 gelöscht', run });
    expect(currentToasts().map((item) => [item.title, item.action?.label])).toEqual([['WEB-51 gelöscht', 'Rückgängig']]);

    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(currentToasts()).toHaveLength(0);
  });

  it('"Rückgängig" calls undo, and the action never runs', () => {
    const run = vi.fn();
    const undo = vi.fn();

    const id = runWithUndo({ label: 'WEB-51 archiviert', run, undo, delay: 3000 });
    runToastAction(id);
    vi.advanceTimersByTime(10_000);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('closing the toast runs the action right away', () => {
    const run = vi.fn();

    const id = runWithUndo({ label: 'Kommentar gelöscht', run });
    dismissToast(id);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a failed action leaves an error toast whose "Erneut versuchen" runs it again', async () => {
    const run = vi.fn().mockRejectedValueOnce(new ApiError({ status: 503, reason: 'simulated', detail: 'Simulierter Serverfehler.' })).mockResolvedValueOnce(undefined);

    runWithUndo({ label: 'WEB-51 gelöscht', run, failureTitle: 'WEB-51 nicht gelöscht' });
    await vi.advanceTimersByTimeAsync(5000);

    const error = currentToasts().at(-1);
    expect(error).toMatchObject({ title: 'WEB-51 nicht gelöscht', description: 'Simulierter Serverfehler.', tone: 'error' });
    runToastAction(error!.id);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('undo toasts and newer toasts', () => {
  it('keeps the undo of a delete when three other toasts come after it: the delete runs only after 5 s', () => {
    const run = vi.fn();
    runWithUndo({ label: 'WEB-51 gelöscht', run });
    toast({ title: 'Link kopiert' });
    toast({ title: 'WEB-47: Priorität High', tone: 'success' });
    toast({ title: 'Nicht möglich', tone: 'error' });

    // the oldest toast without undo made room; the undo toast still stands
    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-51 gelöscht', 'WEB-47: Priorität High', 'Nicht möglich']);
    expect(canUndo()).toBe(true);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('takes the delete back with mod+z after three other toasts', () => {
    const run = vi.fn();
    const undo = vi.fn();
    runWithUndo({ label: 'WEB-51 gelöscht', run, undo });
    toast({ title: 'Eins' });
    toast({ title: 'Zwei' });
    toast({ title: 'Drei' });

    expect(undoLatest()).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('lets a new toast wait while three undo toasts stand; its time starts when it shows', () => {
    const runs = [vi.fn(), vi.fn(), vi.fn()];
    runs.forEach((run, index) => runWithUndo({ label: `WEB-5${index} gelöscht`, run }));
    toast({ title: 'Link kopiert', duration: 3000 });

    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-50 gelöscht', 'WEB-51 gelöscht', 'WEB-52 gelöscht']);
    runs.forEach((run) => expect(run).not.toHaveBeenCalled());

    // the first undo toast runs out: the waiting toast takes its place, with its whole time
    vi.advanceTimersByTime(5000);
    runs.forEach((run) => expect(run).toHaveBeenCalledTimes(1));
    expect(currentToasts().map((item) => item.title)).toEqual(['Link kopiert']);
    vi.advanceTimersByTime(2999);
    expect(currentToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(currentToasts()).toHaveLength(0);
  });

  it('a waiting undo toast keeps its whole time and runs only after it was shown', () => {
    const first = [vi.fn(), vi.fn(), vi.fn()];
    first.forEach((run, index) => runWithUndo({ label: `WEB-5${index} gelöscht`, run }));
    const late = vi.fn();
    runWithUndo({ label: 'WEB-60 gelöscht', run: late });

    vi.advanceTimersByTime(5000);
    expect(late).not.toHaveBeenCalled();
    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-60 gelöscht']);
    vi.advanceTimersByTime(4999);
    expect(late).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

describe('undoLatest (mod+z)', () => {
  it('takes back the newest action that can still be undone, as long as its toast stands', () => {
    const first = vi.fn();
    const second = vi.fn();
    runWithUndo({ label: 'WEB-50 gelöscht', run: vi.fn(), undo: first });
    runWithUndo({ label: 'WEB-51 gelöscht', run: vi.fn(), undo: second });
    // a newer toast without undo does not get in the way
    toast({ title: 'Link kopiert' });

    expect(undoLatest()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(canUndo()).toBe(false);
    expect(undoLatest()).toBe(false);
    expect(first).not.toHaveBeenCalled();
  });
});
