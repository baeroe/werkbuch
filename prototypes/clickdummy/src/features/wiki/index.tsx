/*
 * Placeholder until Task 10 replaces this file. Contract with the router (lazy-loaded): the default export is the
 * screen of /projects/:identifier/wiki/:pageId? and reads both params itself.
 */

import { BookOpen } from 'lucide-react';
import { useParams } from 'react-router';
import { ComingSoon } from '@/app/PageStates';

export default function WikiRoute() {
  const { identifier } = useParams();
  return <ComingSoon title={`Wiki ${identifier}`} task={10} icon={BookOpen} description="Hier entsteht das Wiki des Projekts: der Seitenbaum links, die Seite rechts, mit Versionen und Konfliktwarnung." />;
}
