/*
 * A cell of a property the item's type does not have: a dash, and in words "Gibt es für diesen Typ nicht". Enter on it
 * says the same with the names (TableLayout); there is nothing to edit.
 */

import { Minus } from 'lucide-react';
import { t } from '@/lib/i18n';

export function NotApplicable() {
  return (
    <span className="inline-flex px-1 text-faint">
      <Minus className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{t('items.table.not_applicable')}</span>
    </span>
  );
}
