import { MyItemsEmpty } from '@/features/items/MyItemsEmpty';
import { shellLayout } from '@/shell/layout';

export default function MyItems() {
  return <MyItemsEmpty />;
}

MyItems.layout = shellLayout;
