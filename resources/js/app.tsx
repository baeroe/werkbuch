import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import '../css/app.css';
import { createInertiaApp, router } from '@inertiajs/react';
import type { ComponentType } from 'react';
import { initI18n, reloadIfLocaleChanged } from '@/lib/i18n';
import type { SharedProps } from '@/lib/page';

// Import only modules that export components here: an edit to a module with other exports would otherwise re-run
// this entry during hot reload.

// The texts of a page are those of one language: a visit that changes the language reloads the page.
router.on('navigate', (event) =>
  reloadIfLocaleChanged((event.detail.page.props as unknown as SharedProps).locale, () => window.location.reload()),
);

void createInertiaApp({
  // no `eager`: every page is a chunk of its own
  resolve: (name) => {
    const pages = import.meta.glob<{ default: ComponentType }>('./pages/**/*.tsx');
    return pages[`./pages/${name}.tsx`]!().then((page) => page.default);
  },
  strictMode: true,
  // runs once, right before the first render: from here on t() has its texts
  withApp: (app, { page }) => {
    initI18n(page.props as unknown as SharedProps);
    return app;
  },
  progress: { color: '#2f51b6', showSpinner: false },
});
