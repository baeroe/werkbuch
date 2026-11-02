import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RichText } from '@/types';
import { commentDraft, commentEditDraft, descriptionDraft, drafts, useDraft } from './drafts';

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

  it('renders the text anew when it changes', () => {
    const { result, rerender } = renderHook(({ key }) => useDraft(key), { initialProps: { key: commentDraft('wi_1') } });
    expect(result.current).toBeNull();
    const text = doc('Erstens');
    act(() => drafts.set('comment:wi_1', text));
    expect(result.current).toBe(text);
    rerender({ key: commentDraft('wi_2') });
    expect(result.current).toBeNull();
  });
});
