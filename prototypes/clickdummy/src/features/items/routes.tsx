/*
 * The item lists of five routes (contract with src/app/router.tsx, which lazy-loads this file): the default export
 * gets the preset as a prop and reads the route's params itself:
 *   /my-items → "my", /created → "created", /subscribed → "subscribed",
 *   /views/:viewId → "view" (viewId), /projects/:identifier → "project" (identifier).
 * The router keys it by preset and param: every change of either (another list, view or project) mounts it anew, so
 * local state (selection, cursor, scroll) starts fresh and never leaks from one list into the next. Changes of the
 * search (`?layout=board`, the view state in the URL, see viewState.ts) keep it mounted.
 */

import { useParams } from 'react-router';
import { ItemsScreen } from './ItemsScreen';
import type { ItemsPreset } from './viewState';

export type { ItemsPreset } from './viewState';

export default function ItemsRoute({ preset }: { preset: ItemsPreset }) {
  const { identifier, viewId } = useParams();
  return <ItemsScreen preset={preset} projectIdentifier={identifier} viewId={viewId} />;
}
