import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDocumentTitle } from './useDocumentTitle';

afterEach(() => {
  document.title = '';
});

describe('useDocumentTitle', () => {
  it('names the tab after the screen and restores the old title when the screen goes', () => {
    document.title = 'werkbuch';
    const { unmount } = renderHook(() => useDocumentTitle('Inbox'));

    expect(document.title).toBe('Inbox – werkbuch');

    unmount();
    expect(document.title).toBe('werkbuch');
  });

  it('follows a changed title', () => {
    document.title = 'werkbuch';
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), { initialProps: { title: 'Inbox' } });

    rerender({ title: 'Projekte' });

    expect(document.title).toBe('Projekte – werkbuch');
  });

  it.each([null, undefined, ''])('leaves the title alone without a name (%s)', (title) => {
    document.title = 'werkbuch';
    renderHook(() => useDocumentTitle(title));

    expect(document.title).toBe('werkbuch');
  });
});
