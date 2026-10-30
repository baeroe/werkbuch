/*
 * React bindings of the shortcut registry.
 *
 *   useShortcut('shell.help', () => openHelp());
 *   useShortcut('detail.title', edit, { instance: 'peek', when: canEdit });
 *
 * The keys, scope, label, group and `repeat` come from the catalog. `run` and `when` always see the latest render, so
 * they need no dependencies; the shortcut is registered again when its id or `instance` change, or one of `deps`.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type DependencyList } from 'react';
import { SHORTCUTS, type CatalogEntry, type ShortcutId } from './catalog';
import { enterDialogScope, listShortcuts, registerShortcut, subscribeShortcuts, type ShortcutDef } from './registry';

interface ShortcutOptions {
  /** Takes part only while this answers true. */
  when?: () => boolean;
  /** Tells apart the same catalog entry bound twice at once (the page and its peek): registers as `id:instance`. */
  instance?: string;
  deps?: DependencyList;
}

/** Binds a shortcut of the catalog while the component is mounted. */
export function useShortcut(id: ShortcutId, run: (event: KeyboardEvent) => void, options: ShortcutOptions = {}): void {
  const { when, instance, deps = [] } = options;
  const latest = useRef({ run, when });
  useLayoutEffect(() => {
    latest.current = { run, when };
  });
  const entry: CatalogEntry = SHORTCUTS[id];
  const key = instance === undefined ? id : `${id}:${instance}`;
  const conditional = when !== undefined;
  useEffect(
    () =>
      registerShortcut({
        id: key,
        keys: entry.keys,
        scope: entry.scope,
        label: entry.label,
        group: entry.group,
        repeat: entry.repeat,
        run: (event) => latest.current.run(event),
        when: conditional ? () => latest.current.when?.() ?? true : undefined,
      }),
    // the latest callbacks come through the ref, so they need not be dependencies
    [key, entry, conditional, ...deps],
  );
}

/**
 * While `active`, a modal dialog is open: only `dialog` shortcuts and the global mod+k, escape and mod+enter run, the
 * rest of the page's shortcuts pause (`enterDialogScope`).
 */
export function useDialogScope(active = true): void {
  useEffect(() => (active ? enterDialogScope() : undefined), [active]);
}

/** Everything registered, kept current (the help overlay). */
export function useShortcutList(): ShortcutDef[] {
  return useSyncExternalStore(subscribeShortcuts, listShortcuts, listShortcuts);
}
