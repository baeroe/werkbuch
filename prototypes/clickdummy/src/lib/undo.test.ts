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
