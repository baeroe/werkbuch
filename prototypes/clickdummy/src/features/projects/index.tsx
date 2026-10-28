/*
 * Placeholder until Task 9 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /projects. The sidebar's "Projekt anlegen" leads to /projects?create=1; the screen then opens the dialog
 * "Neues Projekt".
 */

import { FolderKanban } from 'lucide-react';
import { ComingSoon } from '@/app/PageStates';

export default function ProjectsRoute() {
  return (
    <ComingSoon
      title="Projekte"
      task={9}
      icon={FolderKanban}
      description="Hier entsteht die Übersicht aller Projekte mit Lead, Sichtbarkeit und offenen Items, dazu „Beitreten“ und „Neues Projekt“."
    />
  );
}
