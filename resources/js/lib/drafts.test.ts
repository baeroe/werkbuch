import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePage } from '@/test/fixtures';
import type { RichText } from '@/types';
import { commentDraft, commentEditDraft, descriptionDraft, drafts, pageDraft, useDraft, useDraftSending, usePageDraft, type PageDraft } from './drafts';

const doc = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const leaving = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => drafts.clear());

describe('drafts', () => {
  it('keeps a text under its key and forgets it again', () => {
    expect(commentDraft('wi_1')).toBe('comment:wi_1');
    expect(commentEditDraft('c_1')).toBe('comment-edit:c_1');
    expect(descriptionDraft('wi_1')).toBe('description:wi_1');
    expect(drafts.get('comment:wi_1')).toBeNull();

    const text = doc('Erstens');
    drafts.set('comment:wi_1', text);
    drafts.set('description:wi_1', doc('Beschreibung'));
    expect(drafts.get('comment:wi_1')).toBe(text);
    expect(drafts.pending()).toEqual(['comment:wi_1', 'description:wi_1']);

    drafts.set('comment:wi_1', null);
    expect(drafts.get('comment:wi_1')).toBeNull();
    expect(drafts.pending()).toEqual(['description:wi_1']);
  });

  it('tells its listeners about every change under their key, and no other', () => {
    const one = vi.fn();
    const other = vi.fn();
    const stop = drafts.subscribe('comment:wi_1', one);
    drafts.subscribe('comment:wi_2', other);

    const text = doc('Erstens');
    drafts.set('comment:wi_1', text);
    // the same text again is no change
    drafts.set('comment:wi_1', text);
    drafts.set('comment:wi_1', null);
    drafts.set('comment:wi_1', null);
    expect(one).toHaveBeenCalledTimes(2);
    expect(other).not.toHaveBeenCalled();

    stop();
    drafts.set('comment:wi_1', text);
    expect(one).toHaveBeenCalledTimes(2);
    drafts.clear();
    expect(other).not.toHaveBeenCalled();
  });

  it('asks before leaving the page while any text is unsent', () => {
    expect(leaving()).toBe(false);
    drafts.set('comment-edit:c_1', doc('Neu'));
    expect(leaving()).toBe(true);
    drafts.set('comment-edit:c_1', null);
    expect(leaving()).toBe(false);
  });

  it('asks before leaving the page while work on its way holds it, also through a clear', () => {
    const first = drafts.hold();
    const second = drafts.hold();
    expect(leaving()).toBe(true);
    // another person signs in: the uploads on their way still run
    drafts.clear();
    expect(leaving()).toBe(true);
    first();
    // released once only: a second call changes nothing
    first();
    expect(leaving()).toBe(true);
    second();
    expect(leaving()).toBe(false);
  });

  it('renders the text anew when it changes', () => {
    const { result, rerender } = renderHook(({ key }) => useDraft(key), { initialProps: { key: commentDraft('wi_1') } });
    expect(result.current).toBeNull();
    const text = doc('Erstens');
    act(() => drafts.set('comment:wi_1', text));
    expect(result.current).toBe(text);
    rerender({ key: commentDraft('wi_2') });
    expect(result.current).toBeNull();
  });

  it('counts the calls on their way per key and ends each once', () => {
    const { result } = renderHook(() => useDraftSending(commentDraft('wi_1')));
    expect(result.current).toBe(false);
    let first = () => {};
    act(() => {
      first = drafts.startSending('comment:wi_1');
    });
    const second = drafts.startSending('comment:wi_1');
    expect(result.current).toBe(true);
    act(() => first());
    act(() => first());
    expect(drafts.sending('comment:wi_1')).toBe(true);
    act(() => second());
    expect(result.current).toBe(false);
  });

  it('forgets texts and calls on their way when cleared, and tells who keeps more', () => {
    const hook = vi.fn();
    const stop = drafts.onClear(hook);
    const listener = vi.fn();
    drafts.subscribe('comment:wi_1', listener);
    const before = drafts.epoch();
    drafts.set('description:wi_1', doc('Beschreibung'));
    const end = drafts.startSending('comment:wi_1');
    listener.mockClear();

    drafts.clear();
    expect(drafts.epoch()).toBe(before + 1);
    expect(drafts.pending()).toEqual([]);
    expect(drafts.sending('comment:wi_1')).toBe(false);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);

    // a call that began before the clear ends without touching the new count
    const now = drafts.startSending('comment:wi_1');
    end();
    expect(drafts.sending('comment:wi_1')).toBe(true);
    now();
    stop();
    drafts.clear();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('keeps what a page holds unsaved with the version it was typed on, asks before leaving and forgets it on clear', () => {
    expect(pageDraft('pg_1')).toBe('page:pg_1');
    const { result } = renderHook(() => usePageDraft(pageDraft('pg_1')));
    expect(result.current).toBeNull();
    const kept: PageDraft = { title: 'Ablauf', emoji: '🧭', content: doc('Erstens'), base_version: 3, conflict: null };
    const listener = vi.fn();
    drafts.subscribe('page:pg_1', listener);

    act(() => drafts.setPage('page:pg_1', kept));
    expect(result.current).toBe(kept);
    // the same draft again is no change
    drafts.setPage('page:pg_1', kept);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(drafts.page('page:pg_1')).toBe(kept);
    expect(drafts.pending()).toEqual(['page:pg_1']);
    expect(leaving()).toBe(true);

    // with the conflict a save met, the page as the server stores it
    const conflicted = { ...kept, conflict: { message: 'Ida hat die Seite inzwischen geändert.', current: makePage({ id: 'pg_1', version: 4 }) } };
    act(() => drafts.setPage('page:pg_1', conflicted));
    expect(result.current?.conflict?.current.version).toBe(4);

    act(() => drafts.setPage('page:pg_1', null));
    expect(result.current).toBeNull();
    expect(leaving()).toBe(false);

    drafts.setPage('page:pg_1', kept);
    const end = drafts.startSending('page:pg_1');
    expect(drafts.sending('page:pg_1')).toBe(true);
    // another person signs in: the page's draft goes with every text
    act(() => drafts.clear());
    expect(result.current).toBeNull();
    expect(drafts.sending('page:pg_1')).toBe(false);
    expect(leaving()).toBe(false);
    end();
  });
});
