import { describe, expect, it } from 'vitest';
import { initI18n } from '@/lib/i18n';
import en from '../../../../lang/en.json';
import { savedAgo } from './savedAgo';

const at = new Date('2026-10-28T09:30:00.000Z');
const before = (ms: number) => new Date(at.getTime() - ms);

describe('savedAgo', () => {
  it('says "vor wenigen Sekunden" for the first moments', () => {
    expect(savedAgo(before(0), at)).toBe('vor wenigen Sekunden');
    expect(savedAgo(before(44_000), at)).toBe('vor wenigen Sekunden');
  });

  it('counts minutes, hours and days', () => {
    expect(savedAgo(before(45_000), at)).toBe('vor 1 Minute');
    expect(savedAgo(before(5 * 60_000), at)).toBe('vor 5 Minuten');
    expect(savedAgo(before(2 * 3_600_000), at)).toBe('vor 2 Stunden');
    expect(savedAgo(before(3 * 86_400_000), at)).toBe('vor 3 Tagen');
  });

  it('never speaks of the future when the clocks disagree', () => {
    expect(savedAgo(new Date(at.getTime() + 5_000), at)).toBe('vor wenigen Sekunden');
  });

  it('speaks the language of the page', () => {
    initI18n({ locale: 'en', translations: en });
    expect(savedAgo(before(0), at)).toBe('a few seconds ago');
    expect(savedAgo(before(5 * 60_000), at)).toBe('5 minutes ago');
  });
});
