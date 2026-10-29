/*
 * All shortcuts that work right now (`?`), straight from the registry: the shell's own and those of the screen that
 * is open. Spec 5.1: the shortcuts have one source, and the help is made from it.
 */

import { Fragment, useId, useRef } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui/Kbd';
import { useUiStore } from '@/store/ui';
import { canonicalKeys, type ShortcutDef } from './registry';
import { useShortcutList } from './useShortcut';

/** The groups that work everywhere come first, the screen's groups follow in the order they were registered. */
const FIRST_GROUPS = ['Allgemein', 'Navigation'];

/** The lines of the help, grouped. A global shortcut the page binds again (e.g. `/` as the list's filter) is left out. */
export function helpGroups(shortcuts: ShortcutDef[]): { group: string; entries: ShortcutDef[] }[] {
  const groups = new Map<string, ShortcutDef[]>(FIRST_GROUPS.map((group) => [group, []]));
  const pageKeys = new Set(shortcuts.filter((shortcut) => shortcut.scope === 'list' || shortcut.scope === 'detail').map((shortcut) => canonicalKeys(shortcut.keys)));
  const seen = new Set<string>();
  for (const shortcut of shortcuts) {
    if (shortcut.scope === 'global' && pageKeys.has(canonicalKeys(shortcut.keys))) continue;
    // the same keys for the same thing in two scopes is one line
    const line = `${shortcut.keys}|${shortcut.label}`;
    if (seen.has(line)) continue;
    seen.add(line);
    groups.set(shortcut.group, [...(groups.get(shortcut.group) ?? []), shortcut]);
  }
  return [...groups].filter(([, entries]) => entries.length > 0).map(([group, entries]) => ({ group, entries }));
}

function Group({ group, entries }: { group: string; entries: ShortcutDef[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="font-display text-md font-bold tracking-title text-ink">
        {group}
      </h3>
      <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        {entries.map((entry) => (
          <Fragment key={entry.id}>
            <dt className="flex">
              <Kbd keys={entry.keys} size="md" />
            </dt>
            <dd className="text-ui text-pretty text-ink">{entry.label}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

export function HelpOverlay() {
  const open = useUiStore((state) => state.helpOpen);
  const setOpen = useUiStore((state) => state.setHelpOpen);
  const shortcuts = useShortcutList();
  const start = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      // nothing to fill in: the focus starts on the list, not on the close button
      initialFocus={start}
      size="lg"
      title="Tastaturkürzel"
      description={
        <>
          Was hier gerade gilt. Beim Schreiben in einem Feld wirken nur <Kbd keys="mod+k" />, <Kbd keys="escape" /> und <Kbd keys="mod+enter" />.
        </>
      }
    >
      <div ref={start} tabIndex={-1} data-focus-ring="none" className="grid gap-x-10 gap-y-6 outline-none sm:grid-cols-2">
        {helpGroups(shortcuts).map(({ group, entries }) => (
          <Group key={group} group={group} entries={entries} />
        ))}
      </div>
    </Dialog>
  );
}
