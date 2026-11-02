/*
 * What the command palette lists, as plain data (spec 4.17): the registered commands grouped by their group, the
 * groups of the screen before the shell's own, then the search results grouped as Items, Projekte, Personen and Views.
 * Every word typed must occur somewhere in a command (label, group or keywords); the search itself runs on the server
 * (`useSearch`). Wiki pages join the results with phase 9.
 *
 * A key such as `WEB-47` jumps straight to the item: its section leads the list, so Enter opens it even before the
 * search has answered. When the search names the item of the key (`key_match`, also over a former identifier such as
 * `OLD-12`), that item leads instead.
 */

import { parseKey } from '@/domain/keys';
import { SHELL_COMMAND_GROUPS, type CommandDef, type CommandOption } from '@/lib/commands';
import { intlLocale, t } from '@/lib/i18n';
import type { ListedItem, Project, SearchResults, User, View } from '@/types';

export type PaletteEntry =
  | { kind: 'command'; id: string; command: CommandDef }
  | { kind: 'jump'; id: string; key: string }
  | { kind: 'item'; id: string; item: ListedItem }
  | { kind: 'project'; id: string; project: Project }
  | { kind: 'person'; id: string; user: User }
  | { kind: 'view'; id: string; view: View };

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

/** How many search results each section shows; the palette stays a short list. */
export const LIMITS = { items: 8, others: 4 };

/** The typed key in upper case (`web-47` → `WEB-47`), or null when the query is no key. */
export function typedKey(query: string): string | null {
  const key = parseKey(query);
  return key && `${key.identifier}-${key.number}`;
}

function commandSections(commands: CommandDef[], terms: string[]): PaletteSection[] {
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

function resultSections(key: string | null, results: SearchResults | undefined, people: boolean): PaletteSection[] {
  const found = results?.items ?? [];
  const match = results?.key_match ? found.find((item) => item.id === results.key_match) : undefined;
  const items = match ? [match, ...found.filter((item) => item !== match)] : found;
  const others = <T,>(list: T[] | undefined) => (list ?? []).slice(0, LIMITS.others);

  const sections: PaletteSection[] = [
    {
      id: 'items',
      label: t('palette.section.items'),
      entries: [
        ...(key && !match ? [{ kind: 'jump', id: `jump:${key}`, key } as const] : []),
        ...items.slice(0, LIMITS.items).map((item): PaletteEntry => ({ kind: 'item', id: `item:${item.id}`, item })),
      ],
    },
    {
      id: 'projects',
      label: t('palette.section.projects'),
      entries: others(results?.projects).map((project): PaletteEntry => ({ kind: 'project', id: `project:${project.id}`, project })),
    },
    {
      id: 'people',
      label: t('palette.section.people'),
      entries: people ? others(results?.people).map((user): PaletteEntry => ({ kind: 'person', id: `person:${user.id}`, user })) : [],
    },
    { id: 'views', label: t('palette.section.views'), entries: others(results?.views).map((view): PaletteEntry => ({ kind: 'view', id: `view:${view.id}`, view })) },
  ];
  return sections.filter((section) => section.entries.length > 0);
}

/**
 * The palette's list for a query: the matching commands that are shown now, by group, then the search results. A typed
 * key puts the items first. `people` only for those who may open the settings of people and bots.
 */
export function rootSections(query: string, commands: CommandDef[], results?: SearchResults, options: { people: boolean } = { people: false }): PaletteSection[] {
  const terms = searchTerms(query);
  const commandsPart = commandSections(commands, terms);
  if (terms.length === 0) return commandsPart;

  const key = typedKey(query);
  const resultsPart = resultSections(key, results, options.people);
  if (key && resultsPart[0]?.id === 'items') return [resultsPart[0], ...commandsPart, ...resultsPart.slice(1)];
  return [...commandsPart, ...resultsPart];
}

/** The options of a command's sub-list that match what was typed. */
export function matchingOptions(options: CommandOption[], query: string): CommandOption[] {
  const terms = searchTerms(query);
  return options.filter((option) => matchesAll([option.label, ...(option.keywords ?? [])], terms));
}
