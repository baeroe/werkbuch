import { InboxScreen } from '@/features/inbox/InboxScreen';
import { shellLayout } from '@/shell/layout';

/** `/inbox`: the notifications of the signed-in person; the filters stay in the address (`?unread=1&mentions=1`). */
export default function Index() {
  return <InboxScreen />;
}

Index.layout = shellLayout;
