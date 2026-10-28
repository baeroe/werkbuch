/*
 * Placeholder until Task 9 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /inbox.
 */

import { Inbox } from 'lucide-react';
import { ComingSoon } from '@/app/PageStates';

export default function InboxRoute() {
  return (
    <ComingSoon
      title="Inbox"
      task={9}
      icon={Inbox}
      description="Hier entsteht die Inbox: Benachrichtigungen gruppiert nach Item, mit den Filtern „Ungelesen“ und „Erwähnungen“."
    />
  );
}
