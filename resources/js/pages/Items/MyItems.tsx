import { ItemsScreen } from '@/features/items/ItemsScreen';
import { shellLayout } from '@/shell/layout';

/** `/my-items`: the open items assigned to the signed-in person (Meine Items, "Zugewiesen"). */
export default function MyItems() {
  return <ItemsScreen preset="my" />;
}

MyItems.layout = shellLayout;
