/*
 * React bindings of the shortcut registry.
 *
 *   useShortcut({ id: 'list.next', keys: 'j', scope: 'list', label: 'Nächstes Item', group: 'Liste', run: next }, []);
 *
 * `run` and `when` always see the latest render, so they need no dependencies; the shortcut is registered again when
 * its id, keys, scope, label, group or `repeat` change, or one of `deps`.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type DependencyList } from 'react';
import { enterDialogScope, listShortcuts, registerShortcut, subscribeShortcuts, type ShortcutDef } from './registry';

/** Registers a shortcut while the component is mounted. */
export function useShortcut(def: ShortcutDef, deps: DependencyList = []): void {
  const latest = useRef(def);
  useLayoutEffect(() => {
    latest.current = def;
  });
  const { id, keys, scope, label, group, repeat } = def;
  const conditional = def.when !== undefined;
  useEffect(
    () =>
      registerShortcut({
        id,
        keys,
        scope,
        label,
        group,
        repeat,
        run: (event) => latest.current.run(event),
        when: conditional ? () => latest.current.when?.() ?? true : undefined,
      }),
    // the latest callbacks come through the ref, so they need not be dependencies
    [id, keys, scope, label, group, repeat, conditional, ...deps],
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
