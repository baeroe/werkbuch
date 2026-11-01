/*
 * The name of an item as a row or card of a list with a keyboard cursor says it. Its own module, so the board's chunk
 * (which shows cards only) does not pull the rows and their pickers.
 */

import { t } from '@/lib/i18n';
import type { ListedItem } from '@/types';

/** The name of a row or card of a list with a keyboard cursor: key, title, more parts, and whether it is selected. */
export const listItemName = (item: Pick<ListedItem, 'key' | 'title'>, selected: boolean, ...more: string[]): string =>
  [t('items.row.name', { key: item.key, title: item.title }), ...more, ...(selected ? [t('items.row.selected')] : [])].join(', ');
