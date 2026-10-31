/*
 * An editor that renders before the tables arrived waits once and then shows up, keeping the rules of hooks: React
 * must see the same `use()` before and after the wait. This file loads the editor on its own, without
 * `preloadEditor()` first, and holds the table chunk back for a moment. The root is React's own, outside act(), so
 * React retries the editor when the chunk arrives, as it does in the browser.
 */

import { screen, waitFor } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;

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
  root.render(
    <>
      <RichTextEditor preset="description" value={null} onChange={() => {}} />
      <RichTextView preset="description" value={null} />
    </>,
  );

  // the frames stand while the chunk is on its way, then the editor and the view take their place
  await waitFor(() => expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Beschreibung' })).toBeTruthy(), { timeout: 3000 });
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelectorAll('.rt-content')).toHaveLength(2);
  // React reports nothing at all: no broken rule of hooks, no use() called conditionally
  expect(errors).not.toHaveBeenCalled();
});
