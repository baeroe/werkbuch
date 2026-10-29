/*
 * What the command palette lists, as plain data (spec 4.17): the registered commands grouped by their group, then the
 * search results grouped as Items, Seiten, Projekte, Personen and Views. Every word typed must occur somewhere
 * (label, group or keywords of a command); the search itself runs on the server (`useSearch`).
 *
 * A key such as `WEB-47` jumps straight to the item: its entry leads the list, so Enter opens it even before the
 * search has answered.
 */

import { SHELL_COMMAND_GROUPS, type CommandDef, type CommandOption } from '@/lib/commands';
import type { Project, SearchResults, User, View, WorkItem, Page as WikiPage } from '@/types';

/** An item key as typed: 2–10 letters or digits starting with a letter, a dash and the number. */
export const ITEM_KEY = /^[A-Z][A-Z0-9]{1,9}-\d+$/i;

export type PaletteEntry =
  | { kind: 'command'; id: string; command: CommandDef }
  | { kind: 'jump'; id: string; key: string }
  | { kind: 'item'; id: string; item: WorkItem }
  | { kind: 'page'; id: string; page: WikiPage }
  | { kind: 'project'; id: string; project: Project }
  | { kind: 'person'; id: string; user: User }
  | { kind: 'view'; id: string; view: View };

export interface PaletteSection {
  id: string;
  label: string;
  entries: PaletteEntry[];
}

/** How many search results each group shows; the palette stays a short list. */
const LIMITS = { items: 8, others: 4 };

/** The words of a query, lower case. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

const matchesAll = (texts: (string | undefined)[], terms: string[]): boolean => {
  const haystack = texts.join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

/** The typed key in upper case, or null when the query is no key. */
export function typedKey(query: string): string | null {
  const trimmed = query.trim();
  return ITEM_KEY.test(trimmed) ? trimmed.toUpperCase() : null;
}

function commandSections(commands: CommandDef[], terms: string[]): PaletteSection[] {
  const groups = new Map<string, CommandDef[]>();
  for (const command of commands) {
    if (!(command.when?.() ?? true) || !matchesAll([command.label, command.group, ...(command.keywords ?? [])], terms)) continue;
    groups.set(command.group, [...(groups.get(command.group) ?? []), command]);
  }
  const shell: readonly string[] = SHELL_COMMAND_GROUPS;
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

function resultSections(key: string | null, results: SearchResults | undefined): PaletteSection[] {
  const found = results?.items ?? [];
  const exact = key ? found.find((item) => item.key === key) : undefined;
  const items = exact ? [exact, ...found.filter((item) => item !== exact)] : found;

  const sections: PaletteSection[] = [
    {
      id: 'items',
      label: 'Items',
      entries: [
        ...(key && !exact ? [{ kind: 'jump', id: `jump:${key}`, key } as const] : []),
        ...items.slice(0, LIMITS.items).map((item): PaletteEntry => ({ kind: 'item', id: `item:${item.id}`, item })),
      ],
    },
    { id: 'pages', label: 'Seiten', entries: (results?.pages ?? []).slice(0, LIMITS.others).map((page) => ({ kind: 'page', id: `page:${page.id}`, page })) },
    {
      id: 'projects',
      label: 'Projekte',
      entries: (results?.projects ?? []).slice(0, LIMITS.others).map((project) => ({ kind: 'project', id: `project:${project.id}`, project })),
    },
    { id: 'people', label: 'Personen', entries: (results?.people ?? []).slice(0, LIMITS.others).map((user) => ({ kind: 'person', id: `person:${user.id}`, user })) },
    { id: 'views', label: 'Views', entries: (results?.views ?? []).slice(0, LIMITS.others).map((view) => ({ kind: 'view', id: `view:${view.id}`, view })) },
  ];
  return sections.filter((section) => section.entries.length > 0);
}

/** The palette's list for a query: commands, then the search results; a key leads. */
export function rootSections(query: string, commands: CommandDef[], results: SearchResults | undefined): PaletteSection[] {
  const terms = searchTerms(query);
  const commandsPart = commandSections(commands, terms);
  if (terms.length === 0) return commandsPart;

  const key = typedKey(query);
  const resultsPart = resultSections(key, results);
  if (key && resultsPart[0]?.id === 'items') return [resultsPart[0], ...commandsPart, ...resultsPart.slice(1)];
  return [...commandsPart, ...resultsPart];
}

/** The options of a command's sub-list that match what was typed. */
export function matchingOptions(options: CommandOption[], query: string): CommandOption[] {
  const terms = searchTerms(query);
  return options.filter((option) => matchesAll([option.label, ...(option.keywords ?? [])], terms));
}
