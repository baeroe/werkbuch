import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { COVERAGE } from './fixtures';
import { artisan, ROOT, runId } from './helpers';

/**
 * Before the run: against DDEV (no WERKBUCH_URL) the app has to serve the Istanbul build from this working copy; the
 * coverage of earlier runs goes; the cache (and with it the limits of sign-in and reset links) is emptied and the
 * e2e data are seeded; the id of the run is drawn for all workers.
 */
export default function globalSetup(): void {
  if (!process.env.WERKBUCH_URL && COVERAGE) {
    if (existsSync(path.join(ROOT, 'public/hot'))) {
      throw new Error('public/hot exists: stop `ddev exec pnpm dev` and run `ddev exec pnpm build:coverage` first.');
    }
    if (!existsSync(path.join(ROOT, 'public/build/manifest.json'))) {
      throw new Error('No frontend build: run `ddev exec pnpm build:coverage` first.');
    }
  }

  runId();
  rmSync(path.join(ROOT, 'coverage/e2e'), { recursive: true, force: true });

  artisan('cache:clear');
  artisan('db:seed', '--class=E2eSeeder', '--no-interaction');
}
