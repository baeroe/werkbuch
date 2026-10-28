/*
 * Placeholder until Task 12 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /projects/:identifier/settings/:section? and reads both params itself. The shell links to the screen
 * without a section; the sections are general, members, workflow, types and automations.
 */

import { Settings } from 'lucide-react';
import { useParams } from 'react-router';
import { ComingSoon } from '@/app/PageStates';

export default function ProjectSettingsRoute() {
  const { identifier } = useParams();
  return (
    <ComingSoon
      title={`Einstellungen ${identifier}`}
      task={12}
      icon={Settings}
      description="Hier entstehen die Einstellungen des Projekts: Allgemein, Mitglieder, Workflow, Typen und Automatisierungen."
    />
  );
}
