/*
 * The star that puts a view or a project into the sidebar of the signed-in person and takes it out again (spec 4.4,
 * 4.11). It only shows: the caller (a shell in `features/`) reads the favourites and runs the toggle. It shows the new
 * state at once and keeps it while the call is on its way (a spinner takes the star's place), so `active` is what the
 * caller wants to show while `pending`. A change that shows at once gets no toast of its own (spec 5.1).
 */

import { LoaderCircle, Star } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cx } from './cx';
import { IconButton } from './IconButton';

type FavoriteStarProps = {
  /** The star is filled: the item is in the sidebar (already the new state while a change is pending). */
  active: boolean;
  /** The change is on its way: a spinner replaces the star and a second press does nothing. */
  pending: boolean;
  /** For the label: "Roadmap". */
  name: string;
  onToggle: () => void;
  /** Nothing to toggle yet: the caller does not know the state (the favorites are still loading). */
  disabled?: boolean;
};

export function FavoriteStar({ active, pending, name, onToggle, disabled = false }: FavoriteStarProps) {
  return (
    <IconButton
      icon={pending ? LoaderCircle : Star}
      label={active ? t('ui.favorite_star.remove', { name }) : t('ui.favorite_star.add', { name })}
      // the filled star in ink blue is the state; the spinner replaces it while the call runs
      className={cx(pending ? '[&>svg]:animate-spin' : active && 'text-accent-text! [&>svg]:fill-current')}
      aria-busy={pending || undefined}
      disabled={disabled}
      // a second press while the first is on its way would only toggle back
      onClick={() => {
        if (!pending) onToggle();
      }}
    />
  );
}
