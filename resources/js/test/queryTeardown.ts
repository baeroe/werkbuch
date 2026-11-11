/*
 * TanStack Query tells its subscribers of a change one macrotask later (`notifyManager`, by default
 * `setTimeout(…, 0)`). A test that ends while a request is answering leaves such a notice behind for a component
 * Testing Library has just unmounted. Normally it fires harmlessly before the next test; after the last test of a file
 * Vitest can tear jsdom down first (more likely under load), and then the notice hands React an update, React reads
 * `window.event`, and the run ends with an unhandled `ReferenceError: window is not defined` although every test passed.
 *
 * The notices go through a scheduler that knows them, and test/setup.ts drops the waiting ones after each test's
 * unmount: whoever they were for is gone. Fake timers still decide when a notice comes (`setTimeout` is looked up at
 * the moment of scheduling, as TanStack's own scheduler does).
 */

import { notifyManager } from '@tanstack/react-query';

const waiting = new Set<ReturnType<typeof setTimeout>>();

/** Routes TanStack's notices through a scheduler that remembers them until they ran. */
export function trackQueryNotices(): void {
  notifyManager.setScheduler((callback) => {
    const timer = setTimeout(() => {
      waiting.delete(timer);
      callback();
    }, 0);
    waiting.add(timer);
  });
}

/** How many notices are scheduled and have not run yet. */
export function pendingQueryNotices(): number {
  return waiting.size;
}

/** Drops the notices that have not run yet. Only after the unmount: a mounted component would miss its update. */
export function dropQueryNotices(): void {
  waiting.forEach((timer) => clearTimeout(timer));
  waiting.clear();
}
