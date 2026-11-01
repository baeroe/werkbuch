/*
 * Commands of the command palette (spec 4.17): navigation, "New item", the theme, and whatever a screen adds for its
 * context, such as the actions on the item it shows. A screen registers its commands while it is mounted:
 *
 *   useCommand({ id: 'projects.create', label, group, icon: <Plus />, run: openCreate, when: () => allowed }, [allowed]);
 *
 * Choosing a command calls `run` and closes the palette; with `subpage` the palette shows that list instead (e.g. the
 * status choice) and an option's `run` closes it. `keys` is only shown as a hint: the shortcut itself is bound through
 * the catalog (`lib/shortcuts/catalog.ts`). The palette lists the groups of screens first and the shell's own groups
 * (`SHELL_COMMAND_GROUPS`) last. Labels, hints and groups are texts in the language of the page (`t()`).
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type DependencyList, type ReactNode } from 'react';
import type { TranslationKey } from '@/lib/i18n';

/** One entry of a command's sub-list. */
export interface CommandOption {
  id: string;
  label: string;
  /** 16 px icon, e.g. a status icon. */
  icon?: ReactNode;
  /** Muted text on the right, e.g. "active". */
  hint?: string;
  /** More words that find the option. */
  keywords?: string[];
  run: () => void;
}

/** The list a command opens inside the palette. */
export interface CommandSubpage {
  /** Placeholder of the palette's input while the list is open, e.g. "Choose a status …". */
  placeholder?: string;
  options: CommandOption[];
  /** Shown when nothing matches what was typed (or there is nothing to choose). */
  emptyText?: string;
}

export interface CommandDef {
  /** Unique; registering the same id again replaces the earlier command. */
  id: string;
  label: string;
  /** Heading of its group in the palette, e.g. "Navigation" or "Actions for WEB-47". */
  group: string;
  /** The shortcut in register notation, shown next to the command. */
  keys?: string;
  icon?: ReactNode;
  /** More words that find the command, e.g. "dark" for the theme. */
  keywords?: string[];
  run: () => void;
  /** Shown only while this answers true. */
  when?: () => boolean;
  subpage?: () => CommandSubpage;
}

/** The groups of the shell's own commands (translation keys); they come after the groups of the current screen. */
export const SHELL_COMMAND_GROUPS = ['commands.group.actions', 'commands.group.navigation'] as const satisfies readonly TranslationKey[];

const commands = new Map<string, CommandDef>();
/** Where an id was first registered: a command that registers again (e.g. with a new label) keeps its place. */
const places = new Map<string, number>();
let snapshot: CommandDef[] = [];
const listeners = new Set<() => void>();

function changed(): void {
  snapshot = [...commands.values()].sort((a, b) => places.get(a.id)! - places.get(b.id)!);
  listeners.forEach((listener) => listener());
}

/** Registers a command; the returned function takes it out again (it does nothing once the id was replaced). */
export function registerCommand(def: CommandDef): () => void {
  if (!places.has(def.id)) places.set(def.id, places.size);
  commands.set(def.id, def);
  changed();
  return () => {
    if (commands.get(def.id) !== def) return;
    commands.delete(def.id);
    changed();
  };
}

/** All registered commands in the order their ids were first registered, `when` not applied. */
export function listCommands(): CommandDef[] {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The registered commands; re-renders when one comes or goes. */
export function useCommands(): CommandDef[] {
  return useSyncExternalStore(subscribe, listCommands, listCommands);
}

/**
 * Registers a command while the component is mounted. `run`, `when` and `subpage` always see the latest render; the
 * command is registered again when its id, label, group or keys change, or one of `deps`.
 */
export function useCommand(def: CommandDef, deps: DependencyList = []): void {
  const latest = useRef(def);
  useLayoutEffect(() => {
    latest.current = def;
  });
  const { id, label, group, keys } = def;
  const conditional = def.when !== undefined;
  const withSubpage = def.subpage !== undefined;
  useEffect(
    () =>
      registerCommand({
        ...latest.current,
        run: () => latest.current.run(),
        when: conditional ? () => latest.current.when?.() ?? true : undefined,
        subpage: withSubpage ? () => latest.current.subpage?.() ?? { options: [] } : undefined,
      }),
    // the latest callbacks come through the ref, so they need not be dependencies
    [id, label, group, keys, conditional, withSubpage, ...deps],
  );
}
