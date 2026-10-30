import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { currentToasts, dismissToast, resetToasts, runToastAction, toast } from '@/components/ui/toast';
import en from '../../../lang/en.json';
import { initI18n } from './i18n';
import { canUndo, runWithUndo, undoLabel, undoLatest } from './undo';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  resetToasts();
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

describe('runWithUndo failures and language', () => {
  it('names the failure "Nicht ausgeführt: <label>" unless a title is given, also when the action throws at once', () => {
    runWithUndo({
      label: 'WEB-51 gelöscht',
      run: () => {
        throw new ApiError({ status: 422, reason: 'validation_failed', detail: 'Das geht nicht.' });
      },
    });
    vi.advanceTimersByTime(5000);

    expect(currentToasts().at(-1)).toMatchObject({ title: 'Nicht ausgeführt: WEB-51 gelöscht', description: 'Das geht nicht.', tone: 'error' });
    // a refusal is not worth repeating
    expect(currentToasts().at(-1)?.action).toBeUndefined();
  });

  it('takes the label of the undo button from the language of the page', () => {
    expect(undoLabel()).toBe('Rückgängig');
    initI18n({ locale: 'en', translations: en });

    runWithUndo({ label: 'WEB-51 deleted', run: vi.fn() });

    expect(undoLabel()).toBe('Undo');
    expect(currentToasts().map((item) => [item.title, item.action?.label])).toEqual([['WEB-51 deleted', 'Undo']]);
    expect(canUndo()).toBe(true);
  });
});

describe('undo toasts and newer toasts', () => {
  it('keeps the undo of a delete when three other toasts come after it: the delete runs only after 5 s', () => {
    const run = vi.fn();
    runWithUndo({ label: 'WEB-51 gelöscht', run });
    toast({ title: 'Link kopiert' });
    toast({ title: 'WEB-47: Priorität High', tone: 'success' });
    toast({ title: 'Ansicht gespeichert', tone: 'success' });

    // the oldest toast without undo made room; the undo toast still stands
    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-51 gelöscht', 'WEB-47: Priorität High', 'Ansicht gespeichert']);
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

describe('the queue behind three undo toasts', () => {
  const threeUndos = () => [1, 2, 3].map((n) => ({ id: runWithUndo({ label: `WEB-5${n} gelöscht`, run: vi.fn(), undo: vi.fn() }) }));

  it('shows an error toast at once, beyond the three, instead of letting it wait', () => {
    threeUndos();
    toast({ title: 'Status nicht geändert', tone: 'error' });

    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-51 gelöscht', 'WEB-52 gelöscht', 'WEB-53 gelöscht', 'Status nicht geändert']);
  });

  it('does not push out a toast that got its place in the same pass', () => {
    const [first] = threeUndos();
    toast({ title: 'Link kopiert' });
    const late = vi.fn();
    runWithUndo({ label: 'WEB-60 gelöscht', run: late });

    // a place comes free: the toast that waited longest takes it, and the undo toast behind it does not push it out
    dismissToast(first.id);
    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-52 gelöscht', 'WEB-53 gelöscht', 'Link kopiert']);
    expect(late).not.toHaveBeenCalled();

    // the next place goes to the waiting undo toast, with its whole time
    vi.advanceTimersByTime(5000);
    expect(currentToasts().map((item) => item.title)).toEqual(['WEB-60 gelöscht']);
    expect(late).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('takes back the newest action with mod+z, also while its toast still waits', () => {
    const shown = [vi.fn(), vi.fn(), vi.fn()];
    shown.forEach((undo, index) => runWithUndo({ label: `WEB-5${index} gelöscht`, run: vi.fn(), undo }));
    const newest = vi.fn();
    const newestRun = vi.fn();
    runWithUndo({ label: 'WEB-60 gelöscht', run: newestRun, undo: newest });

    expect(canUndo()).toBe(true);
    expect(undoLatest()).toBe(true);
    expect(newest).toHaveBeenCalledTimes(1);
    shown.forEach((undo) => expect(undo).not.toHaveBeenCalled());
    vi.advanceTimersByTime(20_000);
    expect(newestRun).not.toHaveBeenCalled();
  });
});

describe('the same error again', () => {
  const errors = () => currentToasts().filter((item) => item.tone === 'error');

  it('refreshes the error on screen instead of stacking a second one: same toast, the newest action, its whole time', () => {
    const first = vi.fn();
    const newest = vi.fn();
    const shown = toast({ title: 'Statuswechsel nicht gespeichert', description: 'Simulierter Serverfehler.', tone: 'error', action: { label: 'Erneut versuchen', onClick: first } });
    for (let press = 0; press < 4; press += 1) toast({ title: 'Nicht möglich', description: 'Du liest in WEB nur mit.', tone: 'error' });
    expect(errors().map((item) => item.title)).toEqual(['Statuswechsel nicht gespeichert', 'Nicht möglich']);

    vi.advanceTimersByTime(4000);
    const again = toast({ title: 'Statuswechsel nicht gespeichert', description: 'Simulierter Serverfehler.', tone: 'error', action: { label: 'Erneut versuchen', onClick: newest } });
    // the toast on screen stays where it is, as the same toast
    expect(again).toBe(shown);
    expect(errors().map((item) => item.title)).toEqual(['Statuswechsel nicht gespeichert', 'Nicht möglich']);

    // its time starts anew: it outlasts the burst shown at the same moment as the first one
    vi.advanceTimersByTime(1000);
    expect(errors().map((item) => item.title)).toEqual(['Statuswechsel nicht gespeichert']);
    vi.advanceTimersByTime(3999);
    expect(errors()).toHaveLength(1);
    runToastAction(errors()[0].id);
    expect(newest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(errors()).toHaveLength(0);
  });

  it('keeps errors with another description side by side, beyond the three places', () => {
    threeLinks();
    toast({ title: 'Nicht möglich', description: 'Du liest in WEB nur mit.', tone: 'error' });
    toast({ title: 'Nicht möglich', description: 'APP-21 ist archiviert.', tone: 'error' });

    expect(errors().map((item) => item.description)).toEqual(['Du liest in WEB nur mit.', 'APP-21 ist archiviert.']);
    expect(currentToasts()).toHaveLength(5);
  });

  const threeLinks = () => ['Eins', 'Zwei', 'Drei'].forEach((title) => toast({ title }));
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
