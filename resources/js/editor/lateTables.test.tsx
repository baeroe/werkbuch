/*
 * An editor that renders before the tables arrived waits once and then shows up, keeping the rules of hooks: React
 * must see the same `use()` before and after the wait. This file loads the editor on its own, without
 * `preloadEditor()` first, and holds the table chunk back for a moment. The root is React's own, outside act(), so
 * React retries the editor when the chunk arrives, as it does in the browser.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;

// jsdom has no layout: ProseMirror measures the selection to scroll it into view
beforeAll(() => {
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
  (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true;
  vi.doUnmock('@tiptap/extension-table');
  vi.restoreAllMocks();
});

it('waits for the tables without calling use() conditionally', async () => {
  vi.doMock('@tiptap/extension-table', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tiptap/extension-table')>();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return actual;
  });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { RichTextEditor } = await import('./RichTextEditor');
  const { RichTextView } = await import('./RichTextView');

  (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  const onChange = vi.fn();
  const editorRef = createRef<Editor | null>();
  root.render(
    <>
      <RichTextEditor preset="description" value={null} onChange={onChange} editorRef={editorRef} />
      <RichTextView preset="description" value={null} />
    </>,
  );

  // the frames stand while the chunk is on its way, then the editor and the view take their place
  await waitFor(() => expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Beschreibung' })).toBeTruthy(), { timeout: 3000 });
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelectorAll('.rt-content')).toHaveLength(2);
  // the editor that shows is the live one (the first was replaced when the boundary showed the tree again)
  expect(editorRef.current?.isDestroyed).toBe(false);
  await userEvent.setup().type(screen.getByRole('textbox', { name: 'Beschreibung' }), 'Lebt');
  await waitFor(() => expect(editorRef.current?.getText()).toBe('Lebt'));
  expect(onChange).toHaveBeenLastCalledWith({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lebt' }] }] });
  // React reports nothing at all: no broken rule of hooks, no use() called conditionally
  expect(errors).not.toHaveBeenCalled();
});
