/*
 * The way into the search with the pointer: the command palette searches items, projects, people and views. `full` is
 * the field at the head of the sidebar ("Suchen …" with ⌘K, as in the clickdummy), `rail` the icon of the collapsed
 * sidebar. The phone bar has its own icon (`MobileBar`), the 404 page a button (`NotFound`).
 */

import { Search } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { ariaKeyshortcuts, Kbd } from '@/components/ui/Kbd';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useUiStore } from '@/store/ui';

/** Opens the command palette, the search of the app. */
export const openSearch = () => useUiStore.getState().setPaletteOpen(true);

const KEYS = SHORTCUTS['shell.palette'].keys;

export function SearchButton({ variant }: { variant: 'full' | 'rail' }) {
  if (variant === 'rail') return <IconButton icon={Search} label={t('shell.search_icon')} shortcut={KEYS} onClick={openSearch} className="md:size-9" />;
  return (
    <button
      type="button"
      aria-keyshortcuts={ariaKeyshortcuts(KEYS)}
      onClick={openSearch}
      className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-ctl border border-line bg-surface px-2 text-ui text-muted shadow-elev-1 transition-colors duration-120 hover:text-ink md:h-8"
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      {t('shell.search')}
      <Kbd keys={KEYS} className="ml-auto" aria-hidden="true" />
    </button>
  );
}
