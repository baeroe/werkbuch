/*
 * An editor that renders before its late chunks (tables, code highlighting) arrived waits once and then shows up,
 * keeping the rules of hooks: React must see the same `use()` before and after the wait. A comment has no tables and
 * never waits for them; a chunk that failed is asked for again. Each test loads the editor anew (`vi.resetModules`),
 * without `preloadEditor()` first, and holds a chunk back or lets it fail. The root is React's own, outside act(), so
 * React retries the editor when the chunk arrives, as it does in the browser.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import de from '../../../lang/de.json';

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
  vi.doUnmock('./codeBlocks');
  vi.restoreAllMocks();
});

/** A fresh editor module (its chunks not yet loaded), with the texts of the page set up for it. */
async function freshModules() {
  vi.resetModules();
  const { initI18n } = await import('@/lib/i18n');
  initI18n({ locale: 'de', translations: de });
}

/** A root of React's own, outside act(). */
function renderOutsideAct(node: ReactNode): HTMLElement {
  (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  root.render(node);
  return container;
}

it('waits for the tables without calling use() conditionally', async () => {
  await freshModules();
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

it('shows a comment without waiting for the tables, which it does not have', async () => {
  await freshModules();
  let release: () => void = () => {};
  vi.doMock('@tiptap/extension-table', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tiptap/extension-table')>();
    await new Promise<void>((resolve) => (release = resolve));
    return actual;
  });
  const { RichTextEditor } = await import('./RichTextEditor');

  const container = renderOutsideAct(
    <>
      <RichTextEditor preset="comment" value={null} onChange={() => {}} />
      <RichTextEditor preset="description" value={null} onChange={() => {}} />
    </>,
  );

  // the comment is there while the description still waits for the tables
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Kommentar' })).toBeTruthy(), { timeout: 3000 });
  expect(screen.queryByRole('textbox', { name: 'Beschreibung' })).toBeNull();
  expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);

  release();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Beschreibung' })).toBeTruthy(), { timeout: 3000 });
});

it('retries the extension chunk after a failed load', async () => {
  await freshModules();
  // the chunk fails until the network is back
  let online = false;
  let attempts = 0;
  vi.doMock('./codeBlocks', async (importOriginal) => {
    attempts += 1;
    if (!online) throw new Error('chunk failed');
    return importOriginal<typeof import('./codeBlocks')>();
  });
  // React reports the error the boundary caught
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { RichTextEditor } = await import('./RichTextEditor');
  const { RichTextView } = await import('./RichTextView');

  renderOutsideAct(
    <>
      <RichTextEditor preset="comment" value={null} onChange={() => {}} />
      <RichTextView preset="comment" value={null} />
    </>,
  );

  // the editor and the view say so, instead of taking the page down
  await waitFor(() => expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Der Editor ließ sich nicht laden.Erneut versuchen', 'Der Editor ließ sich nicht laden.Erneut versuchen']), {
    timeout: 3000,
  });

  // trying again asks for the chunk again, and both come back
  const failed = attempts;
  online = true;
  // a click outside act(), as the root is React's own
  screen.getAllByRole('button', { name: 'Erneut versuchen' })[0].click();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Kommentar' })).toBeTruthy(), { timeout: 3000 });
  screen.getByRole('button', { name: 'Erneut versuchen' }).click();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), { timeout: 3000 });
  expect(document.querySelectorAll('.rt-content')).toHaveLength(2);
  expect(attempts).toBe(failed + 1);
});
