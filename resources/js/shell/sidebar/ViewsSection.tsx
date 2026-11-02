/*
 * The starred views of the sidebar (spec 4.11, 5.2), ported from the clickdummy: in the order of the favorites, each
 * with its icon, and the link to all of them; the "+" leads to the overview with the dialog "Neue View" open. A view
 * that was deleted is no longer among the favorites the server answers, so it is gone from here as well.
 */

import { useId, type ReactNode } from 'react';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { useFavorites, useViews } from '@/hooks/views';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { AddLink, SectionError, SectionHeader, SectionLoading, SideLink } from './parts';

export function ViewsSection() {
  const id = useId();
  const favorites = useFavorites();
  const views = useViews();
  const { reason } = usePermissions();
  const favoriteViews = (favorites.data?.items ?? [])
    .filter((favorite) => favorite.kind === 'view')
    .flatMap((favorite) => views.data?.items.filter((view) => view.id === favorite.id) ?? []);

  let rows: ReactNode;
  if (favorites.isError || views.isError) {
    rows = (
      <SectionError
        message={t('shell.nav.views_failed')}
        onRetry={() => {
          void favorites.refetch();
          void views.refetch();
        }}
      />
    );
  } else if (!favorites.data || !views.data) {
    rows = <SectionLoading label={t('shell.nav.views_loading')} />;
  } else if (favoriteViews.length === 0) {
    rows = <li className="px-2 py-1 text-sm text-pretty text-muted">{t('shell.nav.starred_views_empty')}</li>;
  } else {
    rows = favoriteViews.map((view) => (
      <li key={view.id}>
        <SideLink href={paths.view(view.id)} end leading={<ViewIcon icon={view.icon} />}>
          {view.name}
        </SideLink>
      </li>
    ));
  }

  return (
    <section aria-labelledby={id}>
      <SectionHeader id={id} title={t('shell.nav.views')} action={<AddLink href={paths.newView()} label={t('shell.nav.create_view')} reason={reason('view.create')} />} />
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {rows}
        <li>
          <SideLink href={paths.views()} end indent quiet>
            {t('shell.nav.all_views')}
          </SideLink>
        </li>
      </ul>
    </section>
  );
}
