import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import '../css/app.css';
import { createInertiaApp } from '@inertiajs/react';
import type { ComponentType } from 'react';

// Import only modules that export components here: an edit to a module with other exports would otherwise re-run
// this entry during hot reload.
void createInertiaApp({
  // no `eager`: every page is a chunk of its own
  resolve: (name) => {
    const pages = import.meta.glob<{ default: ComponentType }>('./pages/**/*.tsx');
    return pages[`./pages/${name}.tsx`]!().then((page) => page.default);
  },
  strictMode: true,
  progress: { color: '#2f51b6', showSpinner: false },
});
