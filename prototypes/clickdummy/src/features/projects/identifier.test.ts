import { describe, expect, it } from 'vitest';
import { suggestIdentifier } from './identifier';

describe('suggestIdentifier', () => {
  // the three values of the brief
  it('takes the first three characters of the first word', () => {
    expect(suggestIdentifier('Website-Relaunch', [])).toBe('WEB');
  });

  it('falls back to two characters of the first word and the first of the second when the first suggestion is taken', () => {
    expect(suggestIdentifier('Website-Relaunch', ['WEB'])).toBe('WER');
  });

  it('writes umlauts out before it uppercases: Ä becomes AE', () => {
    expect(suggestIdentifier('Ärzte-Portal', [])).toBe('AER');
  });

  describe('spelling', () => {
    it('writes Ö, Ü and ß out too, in lower case as well', () => {
      expect(suggestIdentifier('Öl-Kontor', [])).toBe('OEL');
      expect(suggestIdentifier('über uns', [])).toBe('UEB');
      expect(suggestIdentifier('Fußball', [])).toBe('FUS');
      expect(suggestIdentifier('Straße', [])).toBe('STR');
    });

    it('drops other accents instead of leaving characters an identifier cannot hold', () => {
      expect(suggestIdentifier('Café Bonjour', [])).toBe('CAF');
    });

    it('splits words at everything that is not a letter or a digit', () => {
      expect(suggestIdentifier('kunden_app/portal', ['KUN', 'KUA'])).toBe('KAP');
      expect(suggestIdentifier('  Web   Relaunch  ', ['WEB'])).toBe('WER');
    });

    it('compares with the taken identifiers regardless of their case', () => {
      expect(suggestIdentifier('Website-Relaunch', ['web'])).toBe('WER');
    });
  });

  describe('the order of the candidates', () => {
    it('3: the initials of all words, at least two', () => {
      // 1 KUN and 2 KUA are taken
      expect(suggestIdentifier('Kunden App Portal', ['KUN', 'KUA'])).toBe('KAP');
      // two words give two initials, which is enough
      expect(suggestIdentifier('Website-Relaunch', ['WEB', 'WER'])).toBe('WR');
    });

    it('3: keeps to ten characters however many words there are', () => {
      const name = 'a b c d e f g h i j k l';
      expect(suggestIdentifier(name, ['AB'])).toBe('ABCDEFGHIJ');
    });

    it('4: the first candidate with a digit from 2 to 9', () => {
      expect(suggestIdentifier('Website-Relaunch', ['WEB', 'WER', 'WR'])).toBe('WEB2');
      expect(suggestIdentifier('Website-Relaunch', ['WEB', 'WER', 'WR', 'WEB2', 'WEB3'])).toBe('WEB4');
    });

    it('a single word has no second or third candidate and goes straight to the digits', () => {
      expect(suggestIdentifier('Infrastruktur', [])).toBe('INF');
      expect(suggestIdentifier('Infrastruktur', ['INF'])).toBe('INF2');
      expect(suggestIdentifier('Infrastruktur', ['INF', 'INF2'])).toBe('INF3');
    });

    it('gives nothing when every candidate is taken', () => {
      const taken = ['INF', ...Array.from({ length: 8 }, (_, index) => `INF${index + 2}`)];
      expect(suggestIdentifier('Infrastruktur', taken)).toBe('');
    });
  });

  describe('short and odd names', () => {
    it('a short first word is used as it is while it makes a valid identifier', () => {
      expect(suggestIdentifier('Go Live', [])).toBe('GO');
    });

    it('a one-letter first word cannot stand alone and continues with the second word', () => {
      expect(suggestIdentifier('A Team', [])).toBe('AT');
    });

    it('a name that starts with digits starts at its first word with a letter, as an identifier must', () => {
      expect(suggestIdentifier('2026 Kampagne', [])).toBe('KAM');
      expect(suggestIdentifier('3D Druck', [])).toBe('DRU');
    });

    it('digits inside a name are fine', () => {
      expect(suggestIdentifier('Q4 Planung', [])).toBe('Q4');
      expect(suggestIdentifier('Portal 2026', ['POR'])).toBe('PO2');
    });

    it('gives nothing for a name without letters, and nothing yet for a single letter', () => {
      expect(suggestIdentifier('', [])).toBe('');
      expect(suggestIdentifier('  --  ', [])).toBe('');
      expect(suggestIdentifier('2026', [])).toBe('');
      expect(suggestIdentifier('W', [])).toBe('');
    });

    it('always answers something the API accepts', () => {
      const names = ['Website-Relaunch', 'Ärzte-Portal', 'Q4 Planung', 'Go Live', 'A Team', 'Straße', 'a b c d e f g h i j k l'];
      for (const name of names) expect(suggestIdentifier(name, [])).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
    });
  });
});
