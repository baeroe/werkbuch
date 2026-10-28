/*
 * Placeholder until Task 12 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /me/:section? and reads the param itself. The sections are profile, security, notifications and api.
 */

import { UserRound } from 'lucide-react';
import { ComingSoon } from '@/app/PageStates';

export default function PersonalSettingsRoute() {
  return (
    <ComingSoon
      title="Persönliche Einstellungen"
      task={12}
      icon={UserRound}
      description="Hier entstehen die persönlichen Einstellungen: Profil, Sicherheit, Benachrichtigungen sowie API und MCP."
    />
  );
}
