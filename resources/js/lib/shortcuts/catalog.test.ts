import { describe, expect, it } from 'vitest';
import de from '../../../../lang/de.json';
import en from '../../../../lang/en.json';
import { SHORTCUTS } from './catalog';
import { canonicalKeys } from './registry';

describe('shortcut catalog', () => {
  it('binds no key twice within one scope', () => {
    const seen = new Map<string, string>();
    for (const [id, entry] of Object.entries(SHORTCUTS)) {
      const slot = `${entry.scope}|${canonicalKeys(entry.keys)}`;
      expect(seen.get(slot), `${id} and ${seen.get(slot)} share ${entry.keys}`).toBeUndefined();
      seen.set(slot, id);
    }
  });

  it('has a label and a group in both languages for every shortcut', () => {
    for (const entry of Object.values(SHORTCUTS)) {
      for (const language of [en, de]) {
        expect(Object.keys(language)).toContain(entry.label);
        expect(Object.keys(language)).toContain(entry.group);
      }
    }
  });
});
