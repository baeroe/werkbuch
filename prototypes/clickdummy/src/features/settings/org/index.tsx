/*
 * Placeholder until Task 11 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /settings/:section? and reads the param itself. The sections are general, people, bots, workflows, types,
 * properties, labels, relation-types, resolutions, webhooks and system; the command palette opens a person found by
 * the search under /settings/people and a bot under /settings/bots.
 */

import { Settings } from 'lucide-react';
import { ComingSoon } from '@/app/PageStates';

export default function OrgSettingsRoute() {
  return (
    <ComingSoon
      title="Einstellungen"
      task={11}
      icon={Settings}
      description="Hier entstehen die Einstellungen der Organisation: Allgemein, Personen, Bots, Workflows, Typen, Properties, Labels, Relationstypen, Resolutions, Webhooks und System."
    />
  );
}
