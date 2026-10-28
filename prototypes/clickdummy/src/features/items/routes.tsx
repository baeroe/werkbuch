/*
 * Placeholder until Task 6 replaces this file.
 *
 * Contract with the router (src/app/router.tsx, lazy-loaded): the default export renders the item lists of five
 * routes. It gets the preset as a prop and reads the route's params itself:
 *   /my-items → "my", /created → "created", /subscribed → "subscribed",
 *   /views/:viewId → "view" (viewId), /projects/:identifier → "project" (identifier).
 * Task 6 renders `ItemsScreen({ preset, projectIdentifier, viewId })` here.
 */

import { ListTodo } from 'lucide-react';
import { useParams } from 'react-router';
import { ComingSoon } from '@/app/PageStates';
import { useProjects } from '@/hooks/projects';
import { useViews } from '@/hooks/views';

export type ItemsPreset = 'my' | 'created' | 'subscribed' | 'view' | 'project';

const TITLES: Record<ItemsPreset, string> = { my: 'Meine Items', created: 'Von mir erstellt', subscribed: 'Beobachtet', view: 'View', project: 'Projekt' };

export default function ItemsRoute({ preset }: { preset: ItemsPreset }) {
  const { identifier, viewId } = useParams();
  const view = useViews().data?.items.find((entry) => entry.id === viewId);
  const project = useProjects().data?.items.find((entry) => entry.identifier === identifier);
  const title = (preset === 'view' && view?.name) || (preset === 'project' && project?.name) || TITLES[preset];

  return (
    <ComingSoon
      title={title}
      task={6}
      icon={ListTodo}
      description="Hier entsteht die Item-Liste: Filter, Anzeige, Liste und Tabelle, Mehrfachauswahl und gespeicherte Views. Board und Timeline folgen mit Task 7."
    />
  );
}
