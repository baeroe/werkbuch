/*
 * The state of an item list (filter and display, spec 4.11) between its base and the address. The base is a saved view
 * (`viewStateOf`) or a built-in list (`presetState`); what differs from it lives in the query of the address
 * (`encodeViewState`), so a link shows the same list and a reload keeps it. Every other parameter of the address stays.
 *
 * A change goes through Inertia (`router.get` with `preserveState`, `replace`): the page stays mounted and keeps
 * cursor, selection and scroll; the address the server answers is the new state, also one with another state than the
 * change asked for. Until it is there, the state of the change shows already (a layout switch with 2 shows the board at
 * once); a second change meanwhile builds on it. A visit that fails or is cancelled shows the address again.
 *
 * Unsaved: a saved view by any difference; a built-in list only by its filter (layout, grouping and fields are how one
 * looks at it). Those can still be saved as a view (13c).
 */

import { router, usePage } from '@inertiajs/react';
import { useCallback, useMemo, useState } from 'react';
import {
  applyViewState,
  decodeViewState,
  encodeViewState,
  hasUnsavedChanges,
  presetState,
  sameFilter,
  VIEW_STATE_PARAMS,
  viewStateOf,
  type ItemsPreset,
  type ViewState,
} from '@/domain/viewState';
import type { Project, View } from '@/types';

export interface ListState {
  /** What the list shows without changes. */
  base: ViewState;
  /** What it shows now: the base with the changes of the address. */
  state: ViewState;
  setState(next: ViewState): void;
  /** Back to the base: the address without the view state. */
  clearChanges(): void;
  unsaved: boolean;
}

export function useListState({ preset, view }: { preset: ItemsPreset; project?: Project; view?: View }): ListState {
  const { url } = usePage();
  const address = new URL(url, window.location.origin);
  const base = useMemo<ViewState>(() => {
    if (view) return viewStateOf(view);
    // the screen shows a view list once its view is there; without it there is no base to invent
    if (preset === 'view') throw new Error('A view list needs its view.');
    return presetState(preset);
  }, [view, preset]);

  // the change on its way to the server; it shows until the server answers (its address is the state then) or the visit
  // fails
  const [pending, setPending] = useState<string | null>(null);
  const search = pending ?? address.search;
  const state = useMemo(() => applyViewState(base, decodeViewState(search)), [base, search]);

  const visit = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      const next = query === '' ? '' : `?${query}`;
      setPending(next);
      router.get(`${address.pathname}${next}`, {}, {
        preserveState: true,
        preserveScroll: true,
        replace: true,
        // answered, failed or cancelled: the address shows, also one whose state differs from the one asked for (a newer
        // change keeps its own)
        onFinish: () => setPending((current) => (current === next ? null : current)),
      });
    },
    [address.pathname],
  );

  const withoutState = useCallback(() => {
    const params = new URLSearchParams(search);
    VIEW_STATE_PARAMS.forEach((key) => params.delete(key));
    return params;
  }, [search]);

  const setState = useCallback(
    (next: ViewState) => {
      const params = withoutState();
      new URLSearchParams(encodeViewState(next, base)).forEach((value, key) => params.set(key, value));
      visit(params);
    },
    [base, visit, withoutState],
  );

  const clearChanges = useCallback(() => visit(withoutState()), [visit, withoutState]);

  const unsaved = view ? hasUnsavedChanges(base, state) : !sameFilter(base.filter, state.filter);
  return { base, state, setState, clearChanges, unsaved };
}
