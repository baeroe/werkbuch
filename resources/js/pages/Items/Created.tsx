import { ItemsScreen } from '@/features/items/ItemsScreen';
import { shellLayout } from '@/shell/layout';

/** `/created`: the items the signed-in person created (Meine Items, "Erstellt"). */
export default function Created() {
  return <ItemsScreen preset="created" />;
}

Created.layout = shellLayout;
