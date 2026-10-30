import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { ariaKeyshortcuts, Kbd } from './Kbd';

function onMac() {
  Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
}

afterEach(() => {
  // drop the own property again, so the jsdom default applies
  Reflect.deleteProperty(window.navigator, 'platform');
});

describe('Kbd away from a Mac', () => {
  it('reads "mod+k" as "Steuerung K" and shows "Strg"', () => {
    const { container } = render(<Kbd keys="mod+k" />);

    expect(screen.getByRole('img', { name: 'Steuerung K' })).toBeTruthy();
    expect(container.textContent).toBe('StrgK');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('reads a sequence "g i" as "G dann I" with the word between the steps', () => {
    const { container } = render(<Kbd keys="g i" />);

    expect(screen.getByRole('img', { name: 'G dann I' })).toBeTruthy();
    expect(container.textContent).toBe('GdannI');
  });

  it('speaks symbols as words', () => {
    render(
      <>
        <Kbd keys="/" />
        <Kbd keys="?" />
        <Kbd keys="," />
        <Kbd keys="." />
        <Kbd keys="-" />
      </>,
    );

    for (const name of ['Schrägstrich', 'Fragezeichen', 'Komma', 'Punkt', 'Minus']) {
      expect(screen.getByRole('img', { name })).toBeTruthy();
    }
  });

  it('names every special key and shows its glyph or text', () => {
    const keys: [string, string, string][] = [
      ['ctrl', 'Steuerung', 'Strg'],
      ['alt', 'Alt', 'Alt'],
      ['shift', 'Umschalt', ''],
      ['enter', 'Eingabe', ''],
      ['esc', 'Escape', 'Esc'],
      ['backspace', 'Rückschritt', ''],
      ['delete', 'Entfernen', 'Entf'],
      ['tab', 'Tabulator', 'Tab'],
      ['space', 'Leertaste', 'Leertaste'],
      ['up', 'Pfeil hoch', ''],
      ['down', 'Pfeil runter', ''],
      ['left', 'Pfeil links', ''],
      ['right', 'Pfeil rechts', ''],
    ];

    for (const [key, spoken, text] of keys) {
      const { container, unmount } = render(<Kbd keys={key} />);
      expect(screen.getByRole('img', { name: spoken }), key).toBeTruthy();
      expect(container.textContent, key).toBe(text);
      unmount();
    }
  });

  it('draws the tone and the size: muted sm by default, current and md on request', () => {
    const { container } = render(
      <>
        <Kbd keys="k" />
        <Kbd keys="k" tone="current" size="md" />
      </>,
    );

    const [muted, current] = [...container.querySelectorAll('kbd[role="img"]')].map((outer) => outer.querySelector('kbd')!);
    expect(muted.className).toContain('h-5');
    expect(muted.className).toContain('text-muted');
    expect(current.className).toContain('h-6');
    expect(current.className).toContain('opacity-80');
  });

  it('gives no aria-keyshortcuts for a sequence, and names the keys for a single step', () => {
    expect(ariaKeyshortcuts('g i')).toBeUndefined();
    expect(ariaKeyshortcuts('mod+k')).toBe('Control+K');
    expect(ariaKeyshortcuts('esc')).toBe('Escape');
    expect(ariaKeyshortcuts('shift+d')).toBe('Shift+D');
  });
});

describe('Kbd on a Mac', () => {
  it('names the modifiers for aria-keyshortcuts in English', () => {
    onMac();

    expect(ariaKeyshortcuts('shift+mod+k')).toBe('Shift+Meta+K');
    expect(ariaKeyshortcuts('alt+ctrl+k')).toBe('Alt+Control+K');
  });

  it('shows glyphs for the modifiers and reads them in the language of the page', () => {
    onMac();
    const { container } = render(<Kbd keys="mod+ctrl+alt+k" />);

    expect(screen.getByRole('img', { name: 'Befehl Control Wahl K' })).toBeTruthy();
    for (const glyph of ['command', 'chevron-up', 'option']) {
      expect(container.querySelector(`svg.lucide-${glyph}`), glyph).not.toBeNull();
    }
  });
});

describe('Kbd in English', () => {
  it('reads "Command K" on a Mac, "Control K" elsewhere and "G then I" for a sequence', () => {
    initI18n({ locale: 'en', translations: en });
    onMac();
    const mac = render(<Kbd keys="mod+k" />);
    expect(screen.getByRole('img', { name: 'Command K' })).toBeTruthy();
    mac.unmount();

    Reflect.deleteProperty(window.navigator, 'platform');
    const other = render(
      <>
        <Kbd keys="mod+k" />
        <Kbd keys="g i" />
        <Kbd keys="delete" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Control K' }).textContent).toBe('CtrlK');
    expect(screen.getByRole('img', { name: 'G then I' }).textContent).toBe('GthenI');
    expect(screen.getByRole('img', { name: 'Delete' }).textContent).toBe('Del');
    other.unmount();
  });
});
