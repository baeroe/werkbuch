/*
 * The head row of an open wiki page: the pages above it as links (the path, from the top), and on the right what acts
 * on the page (the save state; the versions and the menu follow with Tasks 15 and 16).
 */

import { Link } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { PageNode } from '@/types';

export function PageHeader({ identifier, ancestors, children }: { identifier: string; ancestors: readonly PageNode[]; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      {ancestors.length > 0 && (
        <nav aria-label={t('wiki.page.path')} className="min-w-0">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted">
            {ancestors.map((node) => (
              <li key={node.id} className="flex min-w-0 items-center gap-1">
                <Link
                  href={paths.wiki(identifier, node.id)}
                  className="inline-flex min-h-11 min-w-0 items-center gap-1 rounded-chip px-0.5 text-muted no-underline hover:text-ink hover:underline md:min-h-6"
                >
                  {node.emoji && <span aria-hidden="true">{node.emoji}</span>}
                  <span className="truncate">{node.title}</span>
                </Link>
                <span aria-hidden="true" className="text-faint">
                  /
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}
