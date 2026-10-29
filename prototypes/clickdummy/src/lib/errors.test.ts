import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { notifyError } from './errors';

afterEach(() => resetToasts());

const newest = () => currentToasts().at(-1);

describe('notifyError', () => {
  it('names the cause of a refusal and offers no retry, which would only be refused again', () => {
    const retry = vi.fn();

    notifyError('Statuswechsel nicht gespeichert', new ApiError({ status: 409, reason: 'transition_not_allowed', detail: 'Von Todo geht es nicht direkt nach Done.' }), retry);

    expect(newest()).toMatchObject({ title: 'Statuswechsel nicht gespeichert', description: 'Von Todo geht es nicht direkt nach Done.', tone: 'error' });
    expect(newest()?.action).toBeUndefined();
  });

  it('offers "Erneut versuchen" when the server failed or did not answer, and the button repeats the call', () => {
    const retry = vi.fn();

    notifyError('Löschen fehlgeschlagen', new ApiError({ status: 503, reason: 'simulated', detail: 'Simulierter Serverfehler.' }), retry);
    expect(newest()?.action?.label).toBe('Erneut versuchen');
    runToastAction(newest()!.id);
    expect(retry).toHaveBeenCalledTimes(1);

    // no answer at all: the browser's English message is no text for people
    notifyError('Löschen fehlgeschlagen', new TypeError('Failed to fetch'), retry);
    expect(newest()).toMatchObject({ description: 'Der Server hat nicht geantwortet.', action: { label: 'Erneut versuchen' } });
  });

  it('stays silent on a conflict that carries the stored state: the caller shows its conflict banner', () => {
    notifyError('Beschreibung nicht gespeichert', new ApiError({ status: 409, reason: 'description_conflict', extensions: { current: { title: 'neu' } } }), vi.fn());
    expect(currentToasts()).toHaveLength(0);

    // a conflict without the stored state has no banner to show it, so it gets the toast
    notifyError('Archivieren nicht gespeichert', new ApiError({ status: 409, reason: 'not_closed', detail: 'Nur geschlossene Items lassen sich archivieren.' }));
    expect(currentToasts()).toHaveLength(1);
  });
});
