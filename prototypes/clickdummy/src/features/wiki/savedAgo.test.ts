import { describe, expect, it } from 'vitest';
import { savedAgo } from './savedAgo';

const at = new Date('2026-10-28T09:30:00.000Z');
const before = (ms: number) => new Date(at.getTime() - ms);

describe('savedAgo', () => {
  it('says "vor wenigen Sekunden" for the first moments', () => {
    expect(savedAgo(before(0), at)).toBe('Gespeichert vor wenigen Sekunden');
    expect(savedAgo(before(44_000), at)).toBe('Gespeichert vor wenigen Sekunden');
  });

  it('counts minutes, hours and days', () => {
    expect(savedAgo(before(60_000), at)).toBe('Gespeichert vor 1 Minute');
    expect(savedAgo(before(5 * 60_000), at)).toBe('Gespeichert vor 5 Minuten');
    expect(savedAgo(before(2 * 3_600_000), at)).toBe('Gespeichert vor 2 Stunden');
    expect(savedAgo(before(3 * 86_400_000), at)).toBe('Gespeichert vor 3 Tagen');
  });

  it('never speaks of the future when the clocks disagree', () => {
    expect(savedAgo(new Date(at.getTime() + 5_000), at)).toBe('Gespeichert vor wenigen Sekunden');
  });
});
