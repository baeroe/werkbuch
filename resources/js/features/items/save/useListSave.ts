/*
 * Saving what a list shows (spec 4.11): `save()` replaces the open view with it (`PUT`, the creator and org admins),
 * `saveAs(name, icon)` makes a new view of the team from it. What goes to the server is what the list asks for:
 * unfinished conditions of the filter bar stay out, a field or sort on a property that is gone is dropped (P2, the
 * server would refuse it). A built-in list hands over its scope (`scopeConditions`: the project, "mir zugewiesen",
 * "von mir erstellt", "beobachtet"), so the new view shows the same items (P28). The screen says what happened.
 */

import type { ViewState } from '@/domain/viewState';
import { useProperties } from '@/hooks/properties';
import { useSaveView } from '@/hooks/views';
import type { Condition, Filter, View } from '@/types';
import { savableDisplay } from '../display/options';
import { isComplete } from '../filter/fieldOps';

export interface ListSave {
  /** The view (a view list only) with what the list shows; answers the saved view. */
  save(): Promise<View>;
  saving: boolean;
  /** A new view of what the list shows, its scope included; answers it. */
  saveAs(name: string, icon: string): Promise<View>;
  creating: boolean;
}

export function useListSave({ view, state, scope }: { view?: View; state: ViewState; scope: Condition[] }): ListSave {
  const properties = useProperties().data?.items;
  const update = useSaveView();
  const create = useSaveView();

  const conditions = state.filter.conditions.filter(isComplete);
  const display = savableDisplay(state.display, properties);

  return {
    // only a view list offers "Speichern"
    save: () => update.mutateAsync({ id: view!.id, name: view!.name, icon: view!.icon, filter: { version: 1, conditions }, display }),
    saving: update.isPending,
    saveAs: (name, icon) => {
      const filter: Filter = { version: 1, conditions: [...scope, ...conditions] };
      return create.mutateAsync({ name, icon, filter, display });
    },
    creating: create.isPending,
  };
}
