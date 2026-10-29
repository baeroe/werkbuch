import { describe, expect, it } from 'vitest';
import { zoneOptions } from './zones';

describe('zoneOptions', () => {
  it('offers a short list of common zones, not the 400 of the browser: a list over 50 would have to be virtualised', () => {
    const options = zoneOptions();
    expect(options.length).toBeGreaterThan(20);
    expect(options.length).toBeLessThanOrEqual(48);
    expect(options.map((option) => option.value)).toEqual(expect.arrayContaining(['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Tokyo']));
  });

  it('adds the zones a person already has, and stays within 50', () => {
    const options = zoneOptions('Europe/Berlin', 'Atlantic/Reykjavik', 'Pacific/Fiji');
    const values = options.map((option) => option.value);

    expect(values).toContain('Atlantic/Reykjavik');
    expect(values).toContain('Pacific/Fiji');
    expect(values.filter((value) => value === 'Europe/Berlin')).toHaveLength(1);
    expect(options.length).toBeLessThanOrEqual(50);
  });

  it('offers only zones the browser knows, each once, in alphabetical order', () => {
    const values = zoneOptions('Mars/Olympus_Mons').map((option) => option.value);

    expect(values).not.toContain('Mars/Olympus_Mons');
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    for (const value of values) expect(() => new Intl.DateTimeFormat('de', { timeZone: value })).not.toThrow();
  });

  it('labels a zone with its short name at the demo date, so Berlin reads as winter time', () => {
    const berlin = zoneOptions().find((option) => option.value === 'Europe/Berlin');
    expect(berlin?.label).toBe('Europe/Berlin (MEZ)');
  });
});
