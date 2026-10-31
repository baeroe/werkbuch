/*
 * The star that puts a project (views from Phase 5) into the sidebar of the signed-in person and takes it out again
 * (spec 4.4, 4.11). It shows the new state at once and keeps it while the call is on its way; when the call fails the
 * star is as it was and a toast says why. A change that shows at once gets no toast of its own (spec 5.1). Until the
 * favorites have loaded the state is unknown: the star waits and says why (or that they could not be loaded).
 */

import { FavoriteStar } from '@/components/ui/FavoriteStar';
import { useFavorites, useToggleFavorite } from '@/hooks/views';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Favorite } from '@/types';

type FavoriteToggleProps = {
  kind: Favorite['kind'];
  id: string;
  /** For the label: "Website-Relaunch". */
  name: string;
};

export function FavoriteToggle({ kind, id, name }: FavoriteToggleProps) {
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const stored = favorites.data?.items.some((favorite) => favorite.kind === kind && favorite.id === id) ?? false;

  async function change() {
    try {
      await toggle.mutateAsync({ kind, id });
    } catch (error) {
      notifyError(t('favorites.not_changed'), error, () => void change());
    }
  }

  return (
    <FavoriteStar
      active={toggle.isPending ? !stored : stored}
      pending={toggle.isPending}
      name={name}
      disabledReason={favorites.data ? null : favorites.isError ? t('favorites.load_failed') : t('favorites.loading')}
      onToggle={() => void change()}
    />
  );
}
