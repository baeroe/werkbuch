/*
 * The end of a test file, played inside one test: a request answers while its component is still mounted, the test ends
 * (Testing Library unmounts), and Vitest tears jsdom down before the macrotask with TanStack's notice comes. Without
 * `dropQueryNotices` the notice reaches React for the unmounted component, React reads `window.event`, and the run fails
 * with an unhandled `ReferenceError: window is not defined` (see queryTeardown.ts).
 */

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { dropQueryNotices, pendingQueryNotices } from './queryTeardown';

function Reads({ request }: { request: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['teardown'], queryFn: request });
  return <p>{query.data ?? 'lädt'}</p>;
}

/** Lets promises settle and nothing else: no macrotask runs, so a notice of TanStack stays where it waits. */
async function settlePromises(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

it('drops the notice an answer left for a component the end of the test unmounted', async () => {
  let answer!: (value: string) => void;
  const request = () => new Promise<string>((resolve) => (answer = resolve));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Reads request={request} />
    </QueryClientProvider>,
  );
  expect(screen.getByText('lädt')).toBeTruthy();
  await settlePromises();

  answer('da');
  await settlePromises();
  expect(pendingQueryNotices()).toBeGreaterThan(0);

  cleanup();
  dropQueryNotices();
  expect(pendingQueryNotices()).toBe(0);

  // what Vitest does after the last test of a file: jsdom goes, then the timers left behind fire
  const window = Object.getOwnPropertyDescriptor(globalThis, 'window')!;
  delete (globalThis as { window?: unknown }).window;
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    Object.defineProperty(globalThis, 'window', window);
  }
});
