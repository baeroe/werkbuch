import { ItemPage } from '@/features/item-detail/ItemPage';
import { shellLayout } from '@/shell/layout';

/** `/items/{key}`: the page of an item, by its key in the spelling the item has. */
export default function Show({ itemKey }: { itemKey: string }) {
  return <ItemPage itemKey={itemKey} />;
}

Show.layout = shellLayout;
