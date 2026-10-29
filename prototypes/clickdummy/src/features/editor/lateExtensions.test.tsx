/*
 * An editor that renders before its late chunks (tables, code highlighting) arrived waits once and then shows up,
 * keeping the rules of hooks: React must see the same `use()` before and after the wait. This file loads the editor
 * on its own, without `preloadEditor()` first, and holds the highlighting chunk back for a moment. The root is
 * React's own, outside act(), so React retries the editor when the chunk arrives, as it does in the browser.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  vi.doUnmock('./codeBlocks');
  vi.restoreAllMocks();
});

it('waits for its late extensions without calling use() conditionally', async () => {
  vi.doMock('./codeBlocks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./codeBlocks')>();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return actual;
  });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { RichTextEditor } = await import('./RichTextEditor');

  (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <RichTextEditor preset="comment" projectId="p_web" value={null} onChange={() => {}} aria-label="Kommentar" />
    </QueryClientProvider>,
  );

  // the frame stands while the chunk is on its way, then the editor takes its place
  await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Kommentar' })).toBeTruthy(), { timeout: 3000 });
  const reported = errors.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
  expect(reported).not.toMatch(/called use\(\)|order of Hooks/);
});
