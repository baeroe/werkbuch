import { execFileSync } from 'node:child_process';
import { COVERAGE } from './fixtures';
import { ROOT } from './helpers';

/**
 * After the run: the coverage of the browser and of Vitest merged, with the gate of 100 % lines over resources/js
 * (scripts/coverage-merge.mjs). It runs where Vitest ran: `E2E_EXEC ?? 'ddev exec'` (empty in CI).
 */
export default function globalTeardown(): void {
  if (!COVERAGE) return;

  const [command, ...prefix] = (process.env.E2E_EXEC ?? 'ddev exec').split(/\s+/).filter(Boolean);

  // the Mac wrote coverage/e2e: bring it into the container first (DDEV with Mutagen), whatever the sync answers
  if (command === 'ddev') {
    try {
      execFileSync('ddev', ['mutagen', 'sync'], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      // no Mutagen: the files are there already
    }
  }

  const merge = command ? [command, [...prefix, 'pnpm', 'coverage:merge']] as const : ['pnpm', ['coverage:merge']] as const;
  // a failed merge (missing unit coverage, lines below 100 %) throws and fails the run
  execFileSync(merge[0], merge[1], { cwd: ROOT, stdio: 'inherit' });
}
