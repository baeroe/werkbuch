/*
 * The shared parts of the catalog screens: the tone menu, the local ids of new rows, and the names of the fixed choices.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TYPE_ICONS } from '@/components/ui/TypeTab';
import { t, type TranslationKey } from '@/lib/i18n';
import type { TypeTone } from '@/types';
import { CATEGORY_HINTS, CATEGORY_LABELS, FIELD_TYPE_HINTS, FIELD_TYPE_LABELS, FIELD_TYPES, STATE_ICON_LABELS, STATE_ICONS, TONE_LABELS, TONES, TYPE_ICON_LABELS } from './choices';
import { localId } from './localId';
import { ToneSelect } from './ToneSelect';

function Picker({ onChange }: { onChange: (tone: TypeTone) => void }) {
  const [tone, setTone] = useState<TypeTone>('sky');
  return (
    <ToneSelect
      label="Farbe des Labels"
      value={tone}
      onChange={(next) => {
        setTone(next);
        onChange(next);
      }}
    />
  );
}

describe('ToneSelect', () => {
  it('chooses a tone with the keyboard and names the chosen one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);

    const trigger = screen.getByRole('button', { name: 'Farbe des Labels: Himmel' });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    // every tone with its name, the chosen one checked
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['Himmel', 'Ocker', 'Moos', 'Pflaume', 'Sand', 'Schiefer']);
    expect(screen.getByRole('menuitemradio', { name: 'Himmel' }).getAttribute('aria-checked')).toBe('true');

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Himmel' })));
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Moos' })));
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('moss');
    // like every radio menu, it stays open after the choice; Escape closes it and the trigger names the new tone
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Moos' }).getAttribute('aria-checked')).toBe('true'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Farbe des Labels: Moos' })).toBe(document.activeElement);
  });

  it('can be locked', () => {
    render(<ToneSelect label="Farbe" value="plum" onChange={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Farbe: Pflaume' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('localId', () => {
  it('gives a new id with the prefix every time', () => {
    const ids = Array.from({ length: 50 }, () => localId('st'));
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^st_[0-9a-z]+$/);
  });
});

const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

describe('choices', () => {
  it('names every choice with a key that has a text', () => {
    const records: [string, readonly string[], Record<string, TranslationKey>][] = [
      ['tones', TONES, TONE_LABELS],
      ['state icons', STATE_ICONS, STATE_ICON_LABELS],
      ['categories', CATEGORIES, CATEGORY_LABELS],
      ['category hints', CATEGORIES, CATEGORY_HINTS],
      ['field types', FIELD_TYPES, FIELD_TYPE_LABELS],
      ['field type hints', FIELD_TYPES, FIELD_TYPE_HINTS],
      ['type icons', Object.keys(TYPE_ICONS), TYPE_ICON_LABELS],
    ];
    for (const [what, values, labels] of records) {
      expect(Object.keys(labels).sort(), what).toEqual([...values].sort());
      for (const value of values) {
        const key = labels[value]!;
        expect(t(key), `${what}: ${value}`).not.toBe(key);
      }
    }
    expect(t(STATE_ICON_LABELS['three-quarter'])).toBe('Dreiviertel gefüllt');
    expect(t(TYPE_ICON_LABELS['square-check'])).toBe('Häkchen im Quadrat');
    expect(t(FIELD_TYPE_LABELS.rich_text)).toBe('Rich Text');
  });
});
