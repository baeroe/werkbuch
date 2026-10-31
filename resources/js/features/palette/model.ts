/*
 * What the command palette lists, as plain data (spec 4.17): the registered commands grouped by their group, the
 * groups of the screen before the shell's own. Every word typed must occur somewhere (label, group or keywords of a
 * command). Search results (items, pages, projects, people, views) and the jump to a typed key come with the search
 * (Phase 6, P14); they will be further kinds of `PaletteEntry` and further sections after the commands.
 */

import { SHELL_COMMAND_GROUPS, type CommandDef, type CommandOption } from '@/lib/commands';
import { intlLocale, t } from '@/lib/i18n';

export type PaletteEntry = { kind: 'command'; id: string; command: CommandDef };

export interface PaletteSection {
  id: string;
  label: string;
  entries: PaletteEntry[];
}

/** The words of a query, lower case. */
export function searchTerms(query: string): string[] {
  return query.toLocaleLowerCase(intlLocale()).split(/\s+/).filter(Boolean);
}

const matchesAll = (texts: (string | undefined)[], terms: string[]): boolean => {
  const haystack = texts.join(' ').toLocaleLowerCase(intlLocale());
  return terms.every((term) => haystack.includes(term));
};

/** The palette's list for a query: the matching commands that are shown now, by group. */
export function rootSections(query: string, commands: CommandDef[]): PaletteSection[] {
  const terms = searchTerms(query);
  const groups = new Map<string, CommandDef[]>();
  for (const command of commands) {
    if (!(command.when?.() ?? true) || !matchesAll([command.label, command.group, ...(command.keywords ?? [])], terms)) continue;
    groups.set(command.group, [...(groups.get(command.group) ?? []), command]);
  }
  const shell = SHELL_COMMAND_GROUPS.map((key) => t(key));
  const rank = (group: string) => shell.indexOf(group);
  // the screen's groups (rank -1) first in their order, then the shell's own in theirs (the sort is stable)
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((group) => ({
      id: `commands:${group}`,
      label: group,
      entries: groups.get(group)!.map((command): PaletteEntry => ({ kind: 'command', id: `command:${command.id}`, command })),
    }));
}

/** The options of a command's sub-list that match what was typed. */
export function matchingOptions(options: CommandOption[], query: string): CommandOption[] {
  const terms = searchTerms(query);
  return options.filter((option) => matchesAll([option.label, ...(option.keywords ?? [])], terms));
}
