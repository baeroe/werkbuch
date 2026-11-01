import { ItemsScreen } from '@/features/items/ItemsScreen';
import { shellLayout } from '@/shell/layout';

/** `/views/{viewId}`: the items of a saved view. */
export default function Show({ viewId }: { viewId: string }) {
  return <ItemsScreen preset="view" viewId={viewId} />;
}

Show.layout = shellLayout;
