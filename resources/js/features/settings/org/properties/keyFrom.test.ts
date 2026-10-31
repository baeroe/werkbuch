import { describe, expect, it } from 'vitest';
import { keyFrom } from './keyFrom';

describe('keyFrom', () => {
  it('writes umlauts out and joins words with _', () => {
    expect(keyFrom('Prüfstufe (intern)')).toBe('pruefstufe_intern');
    expect(keyFrom('Größe')).toBe('groesse');
    expect(keyFrom('Café Crème')).toBe('cafe_creme');
  });

  it('puts p_ in front of a digit', () => {
    expect(keyFrom('2. Kunde')).toBe('p_2_kunde');
  });

  it('keeps at most 40 characters and never ends on _', () => {
    const key = keyFrom(`${'a'.repeat(39)} ${'b'.repeat(20)}`);
    expect(key).toBe('a'.repeat(39));
    expect(keyFrom('x'.repeat(60))).toHaveLength(40);
    // p_ in front pushes a cut to a blank: still no _ at the end
    expect(keyFrom(`1${'a'.repeat(36)} bcd`)).toBe(`p_1${'a'.repeat(36)}`);
  });

  it('answers nothing for blanks', () => {
    expect(keyFrom('  ')).toBe('');
  });
});
