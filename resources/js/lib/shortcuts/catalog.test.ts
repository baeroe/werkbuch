import { describe, expect, it } from 'vitest';
import de from '../../../../lang/de.json';
import en from '../../../../lang/en.json';
import { SHORTCUTS, type ShortcutId } from './catalog';
import { canonicalKeys } from './registry';

describe('shortcut catalog', () => {
  /**
   * Entries that share a key in one scope and still never meet (A324, K3): the settings and the wiki are screens of
   * their own, so `settings.save` and `wiki.save` are never bound together; `wiki.delete` steps aside (its `when`)
   * while the preview of an item is open, whose `item.remove` acts then.
   */
  const SHARED = [
    ['settings.save', 'wiki.save'],
    ['item.remove', 'wiki.delete'],
  ];

  it('binds no key twice within one scope, apart from the pairs that never meet', () => {
    const seen = new Map<string, string>();
    for (const [id, entry] of Object.entries(SHORTCUTS)) {
      const slot = `${entry.scope}|${canonicalKeys(entry.keys)}`;
      const other = seen.get(slot);
      if (other === undefined || !SHARED.some((pair) => pair.includes(id) && pair.includes(other))) {
        expect(other, `${id} and ${other} share ${entry.keys}`).toBeUndefined();
      }
      seen.set(slot, id);
    }
  });

  it('saves and deletes a wiki page in the detail scope, beside the keys it shares', () => {
    expect(SHORTCUTS['wiki.save']).toMatchObject({ keys: 'mod+enter', scope: 'detail', group: 'shortcuts.group.wiki' });
    expect(SHORTCUTS['wiki.delete']).toMatchObject({ keys: 'mod+backspace', scope: 'detail', group: 'shortcuts.group.wiki' });
    for (const [one, other] of SHARED) {
      const [a, b] = [SHORTCUTS[one as ShortcutId], SHORTCUTS[other as ShortcutId]];
      expect([a.scope, canonicalKeys(a.keys)]).toEqual([b.scope, canonicalKeys(b.keys)]);
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

  it('saves the settings form with mod+enter on the page, apart from the dialog that uses the same keys', () => {
    expect(SHORTCUTS['settings.save']).toMatchObject({ keys: 'mod+enter', scope: 'detail' });
    expect(SHORTCUTS['dialog.submit']).toMatchObject({ keys: 'mod+enter', scope: 'dialog' });
  });

  it('works the inbox in the list scope, so e of the preview’s title (detail) wins only where the preview acts', () => {
    expect(SHORTCUTS['inbox.read']).toMatchObject({ keys: 'e', scope: 'list', group: 'shortcuts.group.inbox' });
    expect(SHORTCUTS['inbox.unread']).toMatchObject({ keys: 'u', scope: 'list', group: 'shortcuts.group.inbox' });
    expect(SHORTCUTS['inbox.read_all']).toMatchObject({ keys: 'shift+e', scope: 'list', group: 'shortcuts.group.inbox' });
    expect(SHORTCUTS['inbox.delete']).toMatchObject({ keys: '#', scope: 'list', group: 'shortcuts.group.inbox' });
    expect(SHORTCUTS['item.title']).toMatchObject({ keys: 'e', scope: 'detail' });
  });

  it('starts no sequence with a key that is a shortcut of its own', () => {
    // the registry begins a sequence before it looks at single keys, so a "g" of its own would never run
    const singles = new Set(
      Object.values(SHORTCUTS)
        .filter((entry) => !entry.keys.includes(' '))
        .map((entry) => canonicalKeys(entry.keys)),
    );
    for (const [id, entry] of Object.entries(SHORTCUTS)) {
      if (!entry.keys.includes(' ')) continue;
      const first = canonicalKeys(entry.keys.split(' ')[0]);
      expect(singles.has(first), `${id} starts with ${first}, which is a shortcut of its own`).toBe(false);
    }
  });

  it('binds every entry somewhere', () => {
    // an entry nobody binds shows up in the help and the docs and does nothing
    const sources = import.meta.glob(
      ['/resources/js/**/*.{ts,tsx}', '!/resources/js/**/*.test.{ts,tsx}', '!/resources/js/lib/shortcuts/catalog.ts'],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    const code = Object.values(sources);
    for (const id of Object.keys(SHORTCUTS)) {
      expect(
        code.some((source) => source.includes(`'${id}'`)),
        `${id} is bound nowhere`,
      ).toBe(true);
    }
  });
});
