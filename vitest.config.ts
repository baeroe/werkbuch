import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'resources/js') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./resources/js/test/setup.ts'],
    // room for the longer waits of resources/js/test/setup.ts on a slow CI runner
    testTimeout: 20_000,
    include: ['resources/js/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'istanbul',
      reporter: ['json', 'text-summary'],
      reportsDirectory: 'coverage/unit',
      include: ['resources/js/**/*.{ts,tsx}'],
      exclude: ['resources/js/**/*.test.{ts,tsx}', 'resources/js/test/**', 'resources/js/**/*.d.ts', 'resources/js/types.ts'],
      // one entry per folder, added by the task that creates the folder (plan "Abdeckung über die Tasks")
      thresholds: {
        'resources/js/lib/**': { lines: 100 },
        'resources/js/api/**': { lines: 100 },
        'resources/js/hooks/**': { lines: 100 },
        'resources/js/components/ui/**': { lines: 100 },
        'resources/js/store/**': { lines: 100 },
        'resources/js/domain/**': { lines: 100 },
        // from the task whose screens use the frame on (P30)
        'resources/js/features/settings/frame/**': { lines: 100 },
      },
    },
  },
});
