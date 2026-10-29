import { describe, expect, it, vi } from 'vitest';
import { itemResource } from '@/api/lookup';
import { buildItems } from '@/api/seed/items';
import { pages } from '@/api/seed/pages';
import { projects, users } from '@/api/seed/people';
import { views } from '@/api/seed/workspace';
import type { CommandDef } from '@/lib/commands';
import type { SearchResults } from '@/types';
import { matchingOptions, rootSections, type PaletteEntry } from './model';

const command = (id: string, label: string, group: string, extra: Partial<CommandDef> = {}): CommandDef => ({ id, label, group, run: vi.fn(), ...extra });

const commands: CommandDef[] = [
  command('create', 'Neues Item', 'Aktionen', { keys: 'c' }),
  command('theme', 'Theme wechseln …', 'Aktionen', { keywords: ['hell', 'dunkel', 'system'] }),
  command('go.inbox', 'Inbox öffnen', 'Navigation', { keys: 'g i' }),
  // registered last, by the screen: its group still comes first
  command('item.state', 'Status ändern …', 'Aktionen für WEB-47', { keys: 's' }),
  command('item.archive', 'Archivieren', 'Aktionen für WEB-47', { when: () => false }),
];

const records = buildItems();
const items = records.map((item) => itemResource({ items: records }, item));
const byKey = (key: string) => items.find((item) => item.key === key)!;

const results: SearchResults = {
  items: [byKey('WEB-47'), byKey('APP-12')],
  pages: pages.filter((page) => page.title.startsWith('Kontaktformular')),
  projects: projects.filter((project) => project.identifier === 'WEB'),
  people: users.filter((user) => user.id === 'u_ida'),
  views: views.filter((view) => view.id === 'v_kira'),
};

/** What a section shows, in a form a test can compare: the label, then one word per entry. */
const describeEntry = (entry: PaletteEntry): string => {
  switch (entry.kind) {
    case 'command':
      return entry.command.id;
    case 'jump':
      return `jump ${entry.key}`;
    case 'item':
      return entry.item.key;
    case 'page':
      return entry.page.title;
    case 'project':
      return entry.project.identifier;
    case 'person':
      return entry.user.handle;
    case 'view':
      return entry.view.name;
  }
};
const outline = (query: string, found?: SearchResults) =>
  rootSections(query, commands, found).map((section) => [section.label, ...section.entries.map(describeEntry)]);

describe('palette model', () => {
  it('lists the commands by group, the groups of the screen before the shell’s own, without hidden ones', () => {
    expect(outline('')).toEqual([
      ['Aktionen für WEB-47', 'item.state'],
      ['Aktionen', 'create', 'theme'],
      ['Navigation', 'go.inbox'],
    ]);
  });

  it('finds commands by label, group and keywords; every word must match', () => {
    expect(outline('dunkel')).toEqual([['Aktionen', 'theme']]);
    expect(outline('inbox öff')).toEqual([['Navigation', 'go.inbox']]);
    expect(outline('web-47 status')).toEqual([['Aktionen für WEB-47', 'item.state']]);
    expect(outline('inbox dunkel')).toEqual([]);
  });

  it('groups the search results as Items, Seiten, Projekte, Personen and Views after the commands', () => {
    expect(outline('kontakt', results)).toEqual([
      ['Items', 'WEB-47', 'APP-12'],
      ['Seiten', 'Kontaktformular – Technik'],
      ['Projekte', 'WEB'],
      ['Personen', 'ida'],
      ['Views', 'Für Kira'],
    ]);
  });

  it('jumps straight to an item key, even before the search has answered', () => {
    // the key leads, even before matching commands, so that Enter jumps
    expect(outline('web-47')).toEqual([
      ['Items', 'jump WEB-47'],
      ['Aktionen für WEB-47', 'item.state'],
    ]);
    // the search found it: the item itself leads, no second entry for the jump
    expect(outline('WEB-47', { ...results, items: [byKey('APP-12'), byKey('WEB-47')] })[0]).toEqual(['Items', 'WEB-47', 'APP-12']);
    // looks like a key only when it is one
    const jumps = (query: string) => outline(query).flat().filter((entry) => entry.startsWith('jump'));
    expect(jumps('web 47')).toEqual([]);
    expect(jumps('W-47')).toEqual([]);
    expect(jumps('WEB-47a')).toEqual([]);
  });

  it('narrows the options of a sub-list to those whose label or keywords match', () => {
    const options = [
      { id: 'system', label: 'System', keywords: ['automatisch'], run: vi.fn() },
      { id: 'light', label: 'Hell', keywords: ['arbeitsheft'], run: vi.fn() },
      { id: 'dark', label: 'Dunkel', keywords: ['nachtheft'], run: vi.fn() },
    ];

    expect(matchingOptions(options, '').map((option) => option.id)).toEqual(['system', 'light', 'dark']);
    expect(matchingOptions(options, 'heft').map((option) => option.id)).toEqual(['light', 'dark']);
    expect(matchingOptions(options, 'nacht').map((option) => option.id)).toEqual(['dark']);
  });
});
