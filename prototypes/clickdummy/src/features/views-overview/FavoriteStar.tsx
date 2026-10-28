/*
 * The star that puts a view or a project into the sidebar of the signed-in person and takes it out again (spec 4.4,
 * 4.11). It shows the new state at once and keeps it while the call is on its way (a spinner takes the star's place);
 * when the call fails the star is as it was and a toast says why. A change that shows at once gets no toast of its own
 * (spec 5.1): the toasts are three at most, and one more would push out the undo of a delete. The views overview and
 * the projects overview share this star.
 */

import { LoaderCircle, Star } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { useFavorites, useToggleFavorite } from '@/hooks/views';
import { notifyError } from '@/lib/errors';
import type { Favorite } from '@/types';

type FavoriteStarProps = {
  kind: Favorite['kind'];
  id: string;
  /** For the label: "Roadmap". */
  name: string;
};

export function FavoriteStar({ kind, id, name }: FavoriteStarProps) {
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const stored = favorites.data?.items.some((favorite) => favorite.kind === kind && favorite.id === id) ?? false;
  const on = toggle.isPending ? !stored : stored;

  async function change() {
    try {
      await toggle.mutateAsync({ kind, id });
    } catch (error) {
      notifyError('Favorit nicht geändert', error, () => void change());
    }
  }

  return (
    <IconButton
      icon={toggle.isPending ? LoaderCircle : Star}
      label={on ? `„${name}“ aus der Seitenleiste nehmen` : `„${name}“ in die Seitenleiste legen`}
      disabled={!favorites.data}
      // the filled star in ink blue is the state; the spinner replaces it while the call runs
      className={cx(toggle.isPending ? '[&>svg]:animate-spin' : on && 'text-accent-text! [&>svg]:fill-current')}
      aria-busy={toggle.isPending || undefined}
      // a second press while the first is on its way would only toggle back
      onClick={() => {
        if (!toggle.isPending) void change();
      }}
    />
  );
}
