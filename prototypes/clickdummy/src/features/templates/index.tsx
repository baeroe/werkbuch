/*
 * Placeholder until Task 10 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /projects/:identifier/templates/:templateId? and reads both params itself.
 */

import { LayoutTemplate } from 'lucide-react';
import { useParams } from 'react-router';
import { ComingSoon } from '@/app/PageStates';

export default function TemplatesRoute() {
  const { identifier } = useParams();
  return (
    <ComingSoon
      title={`Vorlagen ${identifier}`}
      task={10}
      icon={LayoutTemplate}
      description="Hier entstehen die Vorlagen des Projekts mit Zeitplan, den nächsten Terminen und dem Protokoll der Läufe."
    />
  );
}
