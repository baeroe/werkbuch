import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';
import '../css/app.css';
import { createInertiaApp, router } from '@inertiajs/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { setSignedIn } from '@/api/http';
import { Toaster } from '@/components/ui/Toaster';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { queryClient, resetForUser } from '@/hooks/queryClient';
import { initI18n, reloadIfLocaleChanged } from '@/lib/i18n';
import type { SharedProps } from '@/lib/page';

let lastUserId: string | null = null;

router.on('navigate', (event) => {
  const props = event.detail.page.props as unknown as SharedProps;

  // The texts of a page are those of one language: a visit that changes the language reloads the page.
  reloadIfLocaleChanged(props.locale, () => window.location.reload());

  // What the cache holds belongs to one person: sign-in, sign-out and a switch of account start with an empty one.
  const userId = props.auth.user?.id ?? null;
  resetForUser(lastUserId, userId);
  lastUserId = userId;

  // a 401 reloads the page only where somebody was signed in: a guest page would reload for ever
  setSignedIn(props.auth.user !== null);
});

// A visit that replaces the page (`router.reload()` after saving the profile or the organisation) ends without
// `navigate`; when it brings another language, the page loads anew all the same.
router.on('success', (event) => {
  reloadIfLocaleChanged((event.detail.page.props as unknown as SharedProps).locale, () => window.location.reload());
});

void createInertiaApp({
  // no `eager`: every page is a chunk of its own
  resolve: (name) => {
    const pages = import.meta.glob<{ default: ComponentType }>('./pages/**/*.tsx');
    return pages[`./pages/${name}.tsx`]!().then((page) => page.default);
  },
  strictMode: true,
  // runs once, right before the first render: from here on t() has its texts
  withApp: (app, { page }) => {
    const props = page.props as unknown as SharedProps;
    initI18n(props);
    lastUserId = props.auth.user?.id ?? null;
    setSignedIn(props.auth.user !== null);

    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {app}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  },
  progress: { color: '#2f51b6', showSpinner: false },
});
