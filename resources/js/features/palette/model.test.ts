import { describe, expect, it, vi } from 'vitest';
import en from '../../../../lang/en.json';
import type { CommandDef } from '@/lib/commands';
import { initI18n } from '@/lib/i18n';
import { matchingOptions, rootSections } from './model';

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

const outline = (query: string, list = commands) => rootSections(query, list).map((section) => [section.label, ...section.entries.map((entry) => entry.command.id)]);

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
