import type { ReactNode } from 'react';
import { useSharedProps } from '@/lib/page';
import { Shell } from './Shell';

/**
 * The persistent layout of every screen behind the sign-in: `Page.layout = shellLayout`. It must stay an arrow function:
 * Inertia v3 treats only functions without a `prototype` as `(page) => layout`; a `function` declaration would be
 * rendered as a layout component with the page's props (React error #31).
 */
export const shellLayout = (page: ReactNode) => <Shell>{page}</Shell>;

/**
 * The layout of the error pages: they can also be shown to a guest (a 503 or a 404 of a page without sign-in), who has
 * no shell. A `function` declaration on purpose, so Inertia renders it as a layout component.
 */
export function ErrorLayout({ children }: { children: ReactNode }) {
  const { auth } = useSharedProps();
  if (auth.user) return <Shell>{children}</Shell>;
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 pt-[max(3rem,12vh)] pb-12">
      {children}
    </main>
  );
}
