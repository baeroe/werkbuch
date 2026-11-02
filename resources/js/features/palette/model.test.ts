import { describe, expect, it, vi } from 'vitest';
import en from '../../../../lang/en.json';
import type { CommandDef } from '@/lib/commands';
import { initI18n } from '@/lib/i18n';
import { lene, makeView, makeWorkItem, mara, project, searchResults } from '@/test/fixtures';
import type { SearchResults } from '@/types';
import { LIMITS, matchingOptions, rootSections, typedKey } from './model';

const command = (id: string, label: string, group: string, extra: Partial<CommandDef> = {}): CommandDef => ({ id, label, group, run: vi.fn(), ...extra });

const commands: CommandDef[] = [
  command('create', 'Neues Item', 'Aktionen', { keys: 'c' }),
  command('theme', 'Theme wechseln …', 'Aktionen', { keywords: ['hell', 'dunkel', 'system'] }),
  command('go.inbox', 'Inbox öffnen', 'Navigation', { keys: 'g i' }),
  // registered last, by the screen: its group still comes first
  command('item.state', 'Status ändern …', 'Aktionen für WEB-47', { keys: 's' }),
  command('item.archive', 'Archivieren', 'Aktionen für WEB-47', { when: () => false }),
  command('item.delete', 'Löschen', 'Aktionen für WEB-47', { when: () => true, keywords: ['entfernen'] }),
];

const outline = (query: string, list = commands, results?: SearchResults, options?: { people: boolean }) =>
  rootSections(query, list, results, options).map((section) => [section.label, ...section.entries.map((entry) => (entry.kind === 'command' ? entry.command.id : entry.id))]);

const kontakt = makeWorkItem({ id: 'wi_47', key: 'WEB-47', title: 'Kontaktformular sendet doppelt' });
const hits = searchResults({
  items: [kontakt, makeWorkItem({ id: 'wi_12', key: 'OPS-12', title: 'Kontakt-Mails hängen' })],
  projects: [project('WEB', 'member', { name: 'Website Kontakt' })],
  people: [mara],
  views: [makeView({ id: 'v_kontakt', name: 'Kontakt-Bugs' })],
});

describe('palette model', () => {
  it('lists the commands by group, the groups of the screen before the shell’s own, without hidden ones', () => {
    expect(outline('')).toEqual([
      ['Aktionen für WEB-47', 'item.state', 'item.delete'],
      ['Aktionen', 'create', 'theme'],
      ['Navigation', 'go.inbox'],
    ]);
  });

  it('finds commands by label, group and keywords; every word must match, in any case', () => {
    expect(outline('dunkel')).toEqual([['Aktionen', 'theme']]);
    expect(outline('INBOX öff')).toEqual([['Navigation', 'go.inbox']]);
    expect(outline('web-47 status')).toEqual([['Aktionen für WEB-47', 'item.state']]);
    expect(outline('entfernen')).toEqual([['Aktionen für WEB-47', 'item.delete']]);
    expect(outline('inbox dunkel')).toEqual([]);
  });

  it('knows the shell’s groups in the language of the page', () => {
    initI18n({ locale: 'en', translations: en });
    const english = [command('go.inbox', 'Open inbox', 'Navigation'), command('create', 'New item', 'Actions'), command('item.state', 'Change status …', 'Actions for WEB-47')];

    expect(outline('', english).map(([label]) => label)).toEqual(['Actions for WEB-47', 'Actions', 'Navigation']);
  });

  it('lists the commands first, then items, projects, people and views', () => {
    const withKontakt = [...commands, command('kontakt', 'Kontakt aufnehmen', 'Aktionen')];

    expect(outline('kontakt', withKontakt, hits, { people: true })).toEqual([
      ['Aktionen', 'kontakt'],
      ['Items', 'item:wi_47', 'item:wi_12'],
      ['Projekte', 'project:p_web'],
      ['Personen', 'person:u_mara'],
      ['Views', 'view:v_kontakt'],
    ]);
    // without words there is nothing to search: the commands alone, whatever the last answer held
    expect(outline('  ', commands, hits, { people: true }).map(([label]) => label)).toEqual(['Aktionen für WEB-47', 'Aktionen', 'Navigation']);
  });

  it('puts the item of key_match first, also when it came by a former identifier', () => {
    const renamed = makeWorkItem({ id: 'wi_new_12', key: 'NEW-12', title: 'Umgezogen' });
    const results = searchResults({ items: [makeWorkItem({ id: 'wi_other', key: 'NEW-120' }), renamed], key_match: 'wi_new_12' });

    const [items] = rootSections('OLD-12', commands, results);
    expect(items!.id).toBe('items');
    expect(items!.entries.map((entry) => entry.id)).toEqual(['item:wi_new_12', 'item:wi_other']);
  });

  it('offers the jump to a typed key before the search answered', () => {
    expect(typedKey(' web-47 ')).toBe('WEB-47');
    expect(typedKey('web 47')).toBeNull();
    expect(typedKey('WEB-0')).toBeNull();

    const sections = rootSections('web-47', [...commands, command('web', 'Web-47 teilen', 'Aktionen', { keywords: ['web-47'] })], undefined);
    expect(sections.map((section) => section.id)).toEqual(['items', 'commands:Aktionen für WEB-47', 'commands:Aktionen']);
    expect(sections[0]!.entries).toEqual([{ kind: 'jump', id: 'jump:WEB-47', key: 'WEB-47' }]);

    // the search found other items for the key, but not the one it names: the jump still leads
    const others = rootSections('web-47', [], searchResults({ items: [kontakt] }));
    expect(others[0]!.entries.map((entry) => entry.id)).toEqual(['jump:WEB-47', 'item:wi_47']);
  });

  it('leaves the people out unless asked for', () => {
    expect(outline('kontakt', [], hits).map(([label]) => label)).toEqual(['Items', 'Projekte', 'Views']);
    expect(outline('kontakt', [], searchResults({ people: [lene] }), { people: false })).toEqual([]);
  });

  it('shows eight items and four of the others', () => {
    expect(LIMITS).toEqual({ items: 8, others: 4 });
    const many = <T,>(make: (n: number) => T) => Array.from({ length: 10 }, (_, n) => make(n));
    const results = searchResults({
      items: many((n) => makeWorkItem({ id: `wi_${n}`, key: `WEB-${n + 1}` })),
      projects: many((n) => project(`P${n}X`, 'member')),
      people: many((n) => ({ ...lene, id: `u_${n}` })),
      views: many((n) => makeView({ id: `v_${n}` })),
    });

    expect(rootSections('x', [], results, { people: true }).map((section) => [section.id, section.entries.length])).toEqual([
      ['items', 8],
      ['projects', 4],
      ['people', 4],
      ['views', 4],
    ]);
  });

  it('searches nothing for a query of spaces', () => {
    expect(rootSections('   ', [], hits, { people: true })).toEqual([]);
  });

  it('narrows the options of a sub-list to those whose label or keywords match', () => {
    const options = [
      { id: 'system', label: 'System', keywords: ['automatisch'], run: vi.fn() },
      { id: 'light', label: 'Hell', keywords: ['arbeitsheft'], run: vi.fn() },
      { id: 'dark', label: 'Dunkel', keywords: ['nachtheft'], run: vi.fn() },
      { id: 'plain', label: 'Ohne Wörter', run: vi.fn() },
    ];

    expect(matchingOptions(options, '').map((option) => option.id)).toEqual(['system', 'light', 'dark', 'plain']);
    expect(matchingOptions(options, 'heft').map((option) => option.id)).toEqual(['light', 'dark']);
    expect(matchingOptions(options, 'NACHT').map((option) => option.id)).toEqual(['dark']);
  });
});
