/*
 * "Meine Items" until the item lists arrive (Phase 5): the heading and the empty state of the preset `my`.
 */

import { Link } from '@inertiajs/react';
import { List } from 'lucide-react';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export function MyItemsEmpty() {
  useDocumentTitle(t('items.my.title'));
  return (
    <>
      <header className="flex min-h-8 items-center">
        <h1 className="truncate font-display text-lg font-bold tracking-title text-ink">{t('items.my.title')}</h1>
      </header>
      <EmptyState
        className="mt-4"
        icon={List}
        title={t('items.empty.my.title')}
        description={t('items.empty.my.description')}
        actions={
          <Link href={paths.projects()} className={buttonClass({ variant: 'secondary' })}>
            {t('items.empty.projects_link')}
          </Link>
        }
      />
    </>
  );
}
