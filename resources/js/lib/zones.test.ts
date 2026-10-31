import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../lang/en.json';
import { initI18n } from './i18n';
import { COMMON_ZONES, zoneOptions } from './zones';

afterEach(() => vi.useRealTimers());

describe('zoneOptions', () => {
  it('offers a short list of common zones, not the 400 of the browser: a list over 50 would have to be virtualised', () => {
    const options = zoneOptions('UTC', 'Europe/Berlin');
    expect(options.length).toBeGreaterThan(20);
    expect(options.length).toBeLessThanOrEqual(48);
    expect(COMMON_ZONES).toHaveLength(48);
    expect(options.map((option) => option.value)).toEqual(expect.arrayContaining(['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Tokyo']));
  });

  it('adds the zone of the form and the fallback, and stays within 50', () => {
    const options = zoneOptions('Atlantic/Reykjavik', 'Pacific/Fiji');
    const values = options.map((option) => option.value);

    expect(values).toContain('Atlantic/Reykjavik');
    expect(values).toContain('Pacific/Fiji');
    expect(zoneOptions('Europe/Berlin', 'Europe/Berlin').filter((option) => option.value === 'Europe/Berlin')).toHaveLength(1);
    expect(options.length).toBeLessThanOrEqual(50);
  });

  it('offers only zones the browser knows, each once, in alphabetical order', () => {
    const values = zoneOptions('Mars/Olympus_Mons', 'UTC').map((option) => option.value);

    expect(values).not.toContain('Mars/Olympus_Mons');
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    for (const value of values) expect(() => new Intl.DateTimeFormat('de', { timeZone: value })).not.toThrow();
  });

  it('labels a zone with its short name today, in the language of the page', () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T09:00:00Z'), toFake: ['Date'] });
    const berlin = () => zoneOptions('UTC', 'UTC').find((option) => option.value === 'Europe/Berlin')?.label;

    expect(berlin()).toBe('Europe/Berlin (MEZ)');
    initI18n({ locale: 'en', translations: en });
    expect(berlin()).toBe('Europe/Berlin (CET)');
  });

  it('keeps the plain name when the browser has no short name for a zone', () => {
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([]);

    expect(zoneOptions('UTC', 'UTC').find((option) => option.value === 'UTC')?.label).toBe('UTC');
    format.mockRestore();
  });
});
