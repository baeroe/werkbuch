import { ItemsScreen } from '@/features/items/ItemsScreen';
import { shellLayout } from '@/shell/layout';

/** `/subscribed`: the items the signed-in person watches (Meine Items, "Beobachtet"). */
export default function Subscribed() {
  return <ItemsScreen preset="subscribed" />;
}

Subscribed.layout = shellLayout;
