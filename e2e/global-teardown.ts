import { execFileSync } from 'node:child_process';
import { COVERAGE } from './fixtures';
import { ROOT, syncMutagen } from './helpers';

/**
 * After the run: the coverage of the browser and of Vitest merged, with the gate of 100 % lines over resources/js
 * (scripts/coverage-merge.mjs). It runs where Vitest ran: `E2E_EXEC ?? 'ddev exec'` (empty in CI). `E2E_MERGE=0` leaves
 * the coverage in coverage/e2e/<project>/ unmerged: a CI job of one project remaps and uploads it, the merge of all
 * projects runs elsewhere (one project alone never reaches the gate).
 */
export default function globalTeardown(): void {
  if (!COVERAGE || process.env.E2E_MERGE === '0') return;

  const [command, ...prefix] = (process.env.E2E_EXEC ?? 'ddev exec').split(/\s+/).filter(Boolean);

  // the Mac wrote coverage/e2e: bring it into the container first (DDEV with Mutagen)
  syncMutagen();

  const merge = command ? [command, [...prefix, 'pnpm', 'coverage:merge']] as const : ['pnpm', ['coverage:merge']] as const;
  // a failed merge (missing unit coverage, lines below 100 %) throws and fails the run
  execFileSync(merge[0], merge[1], { cwd: ROOT, stdio: 'inherit' });
}
