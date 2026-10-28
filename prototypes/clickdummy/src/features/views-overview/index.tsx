/*
 * Placeholder until Task 9 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /views. The sidebar's "View anlegen" leads to /views?create=1; the screen then starts a new view.
 */

import { Layers } from 'lucide-react';
import { ComingSoon } from '@/app/PageStates';

export default function ViewsRoute() {
  return <ComingSoon title="Views" task={9} icon={Layers} description="Hier entsteht die Übersicht aller Team-Views mit Ersteller, Darstellung und dem Stern für die Favoriten." />;
}
