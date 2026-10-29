import { describe, expect, it, vi } from 'vitest';
import { helpGroups } from './HelpOverlay';
import type { ShortcutDef } from './registry';

const def = (id: string, keys: string, scope: ShortcutDef['scope'], label: string, group: string): ShortcutDef => ({ id, keys, scope, label, group, run: vi.fn() });

describe('helpGroups', () => {
  it('leaves out a global shortcut that a page scope binds again, however its keys are spelled', () => {
    const groups = helpGroups([
      def('shell.search', '/', 'global', 'Suchen', 'Allgemein'),
      def('shell.create', 'c', 'global', 'Neues Item', 'Allgemein'),
      def('shell.close', 'esc', 'global', 'Schließen', 'Allgemein'),
      def('list.filter', '/', 'list', 'Filter', 'Liste'),
      def('list.clear', 'escape', 'list', 'Auswahl aufheben', 'Liste'),
    ]);

    expect(groups.map(({ group, entries }) => [group, ...entries.map((entry) => `${entry.keys} ${entry.label}`)])).toEqual([
      ['Allgemein', 'c Neues Item'],
      ['Liste', '/ Filter', 'escape Auswahl aufheben'],
    ]);
  });
});
