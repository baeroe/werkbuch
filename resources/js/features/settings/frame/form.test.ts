import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { isMac } from '@/lib/platform';
import {
  errorText,
  fieldErrors,
  fieldMessage,
  focusFirstInvalid,
  focusNeighbour,
  hasReason,
  noticeOf,
  unplacedMessages,
  useDraft,
  useFieldErrors,
  useSaveShortcut,
} from './form';

const refusal = (status: number, errors?: Record<string, string[]>, reason = 'validation_failed', detail?: string) => new ApiError({ status, reason, errors, detail });

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('what a refusal tells a form', () => {
  it('fieldErrors takes the first message per field of a 422, and nothing from any other error', () => {
    expect(fieldErrors(refusal(422, { identifier: ['Vergeben.', 'Zu lang.'], 'settings.days': ['Zu klein.'], name: [] }))).toEqual({
      identifier: 'Vergeben.',
      'settings.days': 'Zu klein.',
    });
    expect(fieldErrors(refusal(409, { identifier: ['Vergeben.'] }))).toEqual({});
    expect(fieldErrors(refusal(422))).toEqual({});
    expect(fieldErrors(new Error('offline'))).toEqual({});
    expect(fieldErrors(null)).toEqual({});
  });

  it('fieldMessage gives the first message of the first path that has one', () => {
    const error = refusal(422, { key: [], options: ['Doppelt.', 'Leer.'], settings: ['Falsch.'] });

    expect(fieldMessage(error, 'key', 'options')).toBe('Doppelt.');
    expect(fieldMessage(error, 'settings', 'options')).toBe('Falsch.');
    expect(fieldMessage(error, 'key', 'unknown')).toBeUndefined();
    expect(fieldMessage(refusal(409), 'key')).toBeUndefined();
    expect(fieldMessage(new Error('offline'), 'key')).toBeUndefined();
  });

  it('unplacedMessages keeps the messages of the fields the form has no place for', () => {
    const error = refusal(422, { name: ['Fehlt.'], 'rules.0.trigger': ['Unbekannt.', 'Doppelt.'], 'rules.1.action': ['Leer.'] });

    expect(unplacedMessages(error, ['name'])).toEqual(['Unbekannt.', 'Doppelt.', 'Leer.']);
    expect(unplacedMessages(error, ['name', 'rules.0.trigger', 'rules.1.action'])).toEqual([]);
    expect(unplacedMessages(refusal(500), [])).toEqual([]);
    expect(unplacedMessages('boom', [])).toEqual([]);
  });

  it('errorText is the sentence of the API, or what no answer at all means', () => {
    expect(errorText(refusal(503, undefined, 'service_unavailable', 'Der Server ist in Wartung.'))).toBe('Der Server ist in Wartung.');
    expect(errorText(new TypeError('Failed to fetch'))).toBe('Der Server hat nicht geantwortet.');
  });

  it('hasReason knows the 409 by its reason', () => {
    expect(hasReason(refusal(409, undefined, 'last_admin'), 'last_admin')).toBe(true);
    expect(hasReason(refusal(409, undefined, 'last_admin'), 'other')).toBe(false);
    expect(hasReason(new Error('last_admin'), 'last_admin')).toBe(false);
  });

  it('noticeOf collects what has no place at a field, and says nothing when the fields show it all', () => {
    expect(noticeOf(null, [])).toBeNull();
    expect(noticeOf(undefined, [])).toBeNull();
    expect(noticeOf(refusal(422, { name: ['Fehlt.'], base: ['Zu viele.', 'Zu laut.'], other: ['Falsch.'] }), ['name'])).toBe('Zu viele. Zu laut. Falsch.');
    expect(noticeOf(refusal(422, { name: ['Fehlt.'] }), ['name'])).toBeNull();
    expect(noticeOf(refusal(409, undefined, 'last_admin', 'Das ist der letzte Admin.'), ['name'])).toBe('Das ist der letzte Admin.');
    expect(noticeOf(new TypeError('Failed to fetch'), [])).toBe('Der Server hat nicht geantwortet.');
  });
});

describe('focus', () => {
  it('focusFirstInvalid lands on the first field a 422 marked, and does nothing without a form', () => {
    document.body.innerHTML = '<form><input id="a"><input id="b" aria-invalid="true"><input id="c" aria-invalid="true"></form>';

    focusFirstInvalid(document.querySelector('form'));
    expect(document.activeElement?.id).toBe('b');

    document.body.innerHTML = '<form><input id="a"></form>';
    focusFirstInvalid(document.querySelector('form'));
    focusFirstInvalid(null);
    expect(document.activeElement).toBe(document.body);
  });

  describe('focusNeighbour', () => {
    const paint = () => new Promise((done) => requestAnimationFrame(done));
    const list = (rows: string[]) => {
      document.body.innerHTML = `<main id="main" tabindex="-1"><ul>${rows.map((id) => `<li id="${id}"><button id="${id}-edit">Bearbeiten</button><button id="${id}-delete">Löschen</button></li>`).join('')}</ul></main>`;
      return (id: string) => document.getElementById(id)!;
    };

    it('moves to the next row, after the next paint', async () => {
      const row = list(['one', 'two', 'three']);

      focusNeighbour(row('one'));
      expect(document.activeElement).toBe(document.body);
      await paint();

      expect(document.activeElement?.id).toBe('two-edit');
    });

    it('takes the row before when this is the last one', async () => {
      const row = list(['one', 'two', 'three']);

      focusNeighbour(row('three'));
      await paint();

      expect(document.activeElement?.id).toBe('two-edit');
    });

    it('goes to the page when there is no other row, or the other row has nothing to focus', async () => {
      const row = list(['only']);
      focusNeighbour(row('only'));
      await paint();
      expect(document.activeElement?.id).toBe('main');

      document.body.innerHTML = '<main id="main" tabindex="-1"><ul><li id="a"><button>x</button></li><li id="b"><button disabled>y</button></li></ul></main>';
      focusNeighbour(document.getElementById('a'));
      await paint();
      expect(document.activeElement?.id).toBe('main');
    });

    it('moves nothing when the focus was not in a row, or the target is gone by then', async () => {
      const row = list(['one', 'two']);

      focusNeighbour(null);
      focusNeighbour(undefined);
      await paint();
      expect(document.activeElement).toBe(document.body);

      focusNeighbour(row('one'));
      row('two').remove();
      document.getElementById('main')!.remove();
      await paint();
      expect(document.activeElement).toBe(document.body);
    });
  });
});

describe('useDraft', () => {
  const server = { name: 'Feldwerk', locale: 'de' };

  it('lays the edits over the data of the server and tells which fields differ', () => {
    const { result } = renderHook(() => useDraft(server));
    expect(result.current).toMatchObject({ value: server, changed: [], dirty: false });

    act(() => result.current.set({ name: 'Feldwerk GmbH' }));
    expect(result.current.value).toEqual({ name: 'Feldwerk GmbH', locale: 'de' });
    expect(result.current.changed).toEqual(['name']);
    expect(result.current.dirty).toBe(true);

    // an edit that is back at the server's value is no change
    act(() => result.current.set({ name: 'Feldwerk' }));
    expect(result.current.changed).toEqual([]);
    expect(result.current.dirty).toBe(false);
  });

  it('lets the fields nobody touched follow the server, and keeps the edited ones until reset', () => {
    const { result, rerender } = renderHook(({ source }) => useDraft(source), { initialProps: { source: server } });

    act(() => result.current.set({ name: 'Mein Name' }));
    rerender({ source: { name: 'Neu vom Server', locale: 'en' } });
    expect(result.current.value).toEqual({ name: 'Mein Name', locale: 'en' });

    // the server caught up with the edit: nothing left to save
    rerender({ source: { name: 'Mein Name', locale: 'en' } });
    expect(result.current.dirty).toBe(false);

    act(() => result.current.set({ locale: 'de' }));
    act(() => result.current.reset());
    expect(result.current.value).toEqual({ name: 'Mein Name', locale: 'en' });
    expect(result.current.dirty).toBe(false);
  });

  it('compares objects by value, so an edited copy of the same list is no change', () => {
    const { result } = renderHook(() => useDraft({ days: [1, 2] }));

    act(() => result.current.set({ days: [1, 2] }));
    expect(result.current.dirty).toBe(false);

    act(() => result.current.set({ days: [1, 3] }));
    expect(result.current.dirty).toBe(true);
  });

  it('says "nothing to save" for three seconds, and not any longer once there is something to save', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraft(server));

    act(() => result.current.tellNothingToSave());
    expect(result.current.quiet).toBe(true);
    act(() => void vi.advanceTimersByTime(2999));
    expect(result.current.quiet).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.quiet).toBe(false);

    act(() => result.current.tellNothingToSave());
    act(() => result.current.set({ name: 'Anders' }));
    expect(result.current.quiet).toBe(false);
  });
});

describe('useFieldErrors', () => {
  it('shows the errors of a 422 and puts the focus on the first marked field once they are drawn', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<form><input id="a" aria-invalid="true"></form>';
    const form = { current: document.querySelector('form') };
    const { result } = renderHook(() => useFieldErrors(form));

    act(() => result.current.show({ identifier: 'Vergeben.' }));
    expect(result.current.errors).toEqual({ identifier: 'Vergeben.' });
    expect(document.activeElement).toBe(document.body);

    act(() => void vi.advanceTimersByTime(0));
    expect(document.activeElement?.id).toBe('a');
  });

  it('clears the error of an edited field, keeps the others, and clears all on request', () => {
    const { result } = renderHook(() => useFieldErrors({ current: null }));
    act(() => result.current.show({ name: 'Fehlt.', identifier: 'Vergeben.', color: 'Falsch.' }));

    act(() => result.current.clear('identifier', 'color'));
    expect(result.current.errors).toEqual({ name: 'Fehlt.' });

    // a field without an error leaves the state as it is
    const before = result.current.errors;
    act(() => result.current.clear('unknown'));
    expect(result.current.errors).toBe(before);

    act(() => result.current.clearAll());
    expect(result.current.errors).toEqual({});
  });
});

describe('useSaveShortcut', () => {
  const save = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...(isMac() ? { metaKey: true } : { ctrlKey: true }) }));

  it('submits the form on mod+enter, but only while it is active', () => {
    const requestSubmit = vi.fn();
    const form = { current: { requestSubmit } as unknown as HTMLFormElement };
    const { rerender, unmount } = renderHook(({ active }) => useSaveShortcut(form, active), { initialProps: { active: false } });

    save();
    expect(requestSubmit).not.toHaveBeenCalled();

    rerender({ active: true });
    save();
    expect(requestSubmit).toHaveBeenCalledTimes(1);

    unmount();
    save();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a form on the page', () => {
    const { unmount } = renderHook(() => useSaveShortcut({ current: null }, true));

    expect(save).not.toThrow();

    unmount();
  });
});
