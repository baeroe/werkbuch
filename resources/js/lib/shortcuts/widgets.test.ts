import { describe, expect, it } from 'vitest';
import de from '../../../../lang/de.json';
import en from '../../../../lang/en.json';
import { canonicalKeys } from './registry';
import { WIDGET_KEYS } from './widgets';

describe('keys of the widgets', () => {
  it('has every label and group in both languages', () => {
    for (const group of WIDGET_KEYS) {
      for (const key of [group.group, ...group.entries.map((entry) => entry.label)]) {
        for (const language of [en, de]) expect(Object.keys(language)).toContain(key);
      }
    }
  });

  it('names no key of a widget that the catalog binds in the same place', () => {
    for (const keys of ['mod+k', '?', 'c']) {
      const taken = canonicalKeys(keys);
      for (const group of WIDGET_KEYS) {
        for (const entry of group.entries) expect(canonicalKeys(entry.keys), group.group).not.toBe(taken);
      }
    }
  });

  it('lists five groups, each with entries', () => {
    expect(WIDGET_KEYS.map((group) => group.group)).toEqual([
      'shortcuts.widget.group.palette',
      'shortcuts.widget.group.table',
      'shortcuts.widget.group.groups',
      'shortcuts.widget.group.tree',
      'shortcuts.widget.group.editor',
    ]);
    for (const group of WIDGET_KEYS) expect(group.entries.length).toBeGreaterThan(0);
  });

  it('folds a group header with enter and space, as its button does', () => {
    const headers = WIDGET_KEYS.find((group) => group.group === 'shortcuts.widget.group.groups');
    expect(headers?.entries.filter((entry) => entry.label === 'shortcuts.widget.groups.toggle').map((entry) => entry.keys)).toEqual(['enter', 'space']);
  });
});
