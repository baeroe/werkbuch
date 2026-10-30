import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import path from 'node:path';
import { defineConfig } from 'vite';
import istanbul from 'vite-plugin-istanbul';

// Set inside the DDEV web container, e.g. https://werkbuch.ddev.site
const ddevUrl = process.env.DDEV_PRIMARY_URL_WITHOUT_PORT;

// `vite build --mode coverage` (pnpm build:coverage): the same build, instrumented for the Playwright suite
// (e2e/fixtures.ts collects `window.__coverage__`, scripts/coverage-merge.mjs merges it with Vitest's)
export default defineConfig(({ mode }) => ({
  plugins: [
    laravel({
      input: ['resources/css/app.css', 'resources/js/app.tsx'],
      refresh: true,
    }),
    react(),
    tailwindcss(),
    ...(mode === 'coverage'
      ? [
          istanbul({
            include: 'resources/js/**',
            exclude: ['resources/js/**/*.test.*', 'resources/js/test/**'],
            extension: ['.ts', '.tsx'],
            requireEnv: false,
            forceBuildInstrument: true,
          }),
        ]
      : []),
  ],
  ...(mode === 'coverage' ? { build: { sourcemap: true } } : {}),
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'resources/js') },
  },
  server: {
    // DDEV routes https://werkbuch.ddev.site:5173 to this port inside the container
    ...(ddevUrl
      ? {
          host: '0.0.0.0',
          port: 5173,
          strictPort: true,
          origin: `${ddevUrl}:5173`,
          cors: { origin: /https?:\/\/([A-Za-z0-9\-.]+)?(\.ddev\.site)(?::\d+)?$/ },
        }
      : {}),
    watch: {
      ignored: [
        '**/storage/framework/views/**',
        '**/vendor/**',
        '**/prototypes/**',
        '**/docs/**',
        '**/e2e/**',
        '**/coverage/**',
        '**/.pnpm-store/**',
      ],
    },
  },
}));
