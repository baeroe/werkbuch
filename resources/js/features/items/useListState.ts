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
 * Unsaved: a saved view by any difference but the layout; a built-in list only by its filter (grouping and fields are
 * how one looks at it). Those can still be saved as a view (13c).
 *
 * The layout is the list's own (WEBU-68): remembered per person and list (`layoutMemory.ts`) and part of the base, never
 * of the address. A `?layout=` in the address wins (a shared link); a switch remembers the new one and drops it.
 */

import { router, usePage } from '@inertiajs/react';
import { useCallback, useMemo, useState } from 'react';
import { useCurrentUser } from '@/hooks/users';
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
import { layoutKey, useRememberedLayout, writeLayout } from './layoutMemory';

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

/** Which list remembers a layout: the built-in one, the project or the view. */
function listOf(preset: ItemsPreset, project: Project | undefined, view: View | undefined): string | null {
  if (view) return `view:${view.id}`;
  if (preset === 'project') return project ? `project:${project.id}` : null;
  return preset === 'view' ? null : preset;
}

export function useListState({ preset, project, view }: { preset: ItemsPreset; project?: Project; view?: View }): ListState {
  const { url } = usePage();
  const me = useCurrentUser();
  const address = new URL(url, window.location.origin);
  const list = listOf(preset, project, view);
  const key = me && list ? layoutKey(me.id, list) : null;
  const remembered = useRememberedLayout(key);
  const base = useMemo<ViewState>(() => {
    // the screen shows a view list once its view is there; without it there is no base to invent
    if (!view && preset === 'view') throw new Error('A view list needs its view.');
    const own = view ? viewStateOf(view) : presetState(preset as Exclude<ItemsPreset, 'view'>);
    return remembered ? { ...own, display: { ...own.display, layout: remembered } } : own;
  }, [view, preset, remembered]);

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

  // the state leaves the address; a `?layout=` of a link stays until the layout is switched
  const withoutState = useCallback(() => {
    const params = new URLSearchParams(search);
    VIEW_STATE_PARAMS.filter((name) => name !== 'layout').forEach((name) => params.delete(name));
    return params;
  }, [search]);

  const setState = useCallback(
    (next: ViewState) => {
      const params = withoutState();
      const switched = next.display.layout !== state.display.layout;
      // a new layout is remembered, and the address no longer names one
      if (switched) {
        params.delete('layout');
        // without a person or list to remember it for, the address keeps it
        if (key) writeLayout(key, next.display.layout);
        else params.set('layout', next.display.layout);
      }
      new URLSearchParams(encodeViewState(next, base)).forEach((value, name) => params.set(name, value));
      // a switch alone that leaves the address as it is needs no visit
      if (switched && params.toString() === new URLSearchParams(search).toString()) return;
      visit(params);
    },
    [base, key, search, state.display.layout, visit, withoutState],
  );

  const clearChanges = useCallback(() => visit(withoutState()), [visit, withoutState]);

  const unsaved = view ? hasUnsavedChanges(base, state) : !sameFilter(base.filter, state.filter);
  return { base, state, setState, clearChanges, unsaved };
}
