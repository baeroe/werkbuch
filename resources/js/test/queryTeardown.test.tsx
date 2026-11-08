/*
 * The end of a test file, played with one test: a request answers while its component is still mounted and the test
 * ends with TanStack's notice for it still waiting. Then the `afterEach` of test/setup.ts runs (unmount, then
 * `dropQueryNotices`), and only after it `onTestFinished` (Vitest calls `test.onFinished` after every `afterEach` of
 * the test, runner `run.js`): there no notice may wait any more, and none may come once jsdom is gone. Without the drop
 * in setup.ts the notice reaches React for the unmounted component, React reads `window.event`, and the run fails with
 * an unhandled `ReferenceError: window is not defined` (see queryTeardown.ts).
 *
 * The file keeps this one test: the last step takes `window` away from the whole file for a moment.
 */

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, onTestFinished } from 'vitest';
import { pendingQueryNotices } from './queryTeardown';

function Reads({ request }: { request: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['teardown'], queryFn: request });
  return <p>{query.data ?? 'lädt'}</p>;
}

/** Lets promises settle and nothing else: no macrotask runs, so a notice of TanStack stays where it waits. */
async function settlePromises(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

it('leaves no notice of an answer for after the end of the test that unmounted its component', async () => {
  onTestFinished(async () => {
    expect(pendingQueryNotices()).toBe(0);

    // what Vitest does after the last test of a file: jsdom goes, then the timers left behind fire. A notice comes
    // with `setTimeout(…, 0)`, so a timer of 0 set now runs after any that waits: one macrotask without `window` is enough.
    const window = Object.getOwnPropertyDescriptor(globalThis, 'window')!;
    delete (globalThis as { window?: unknown }).window;
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      Object.defineProperty(globalThis, 'window', window);
    }
  });

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
});
