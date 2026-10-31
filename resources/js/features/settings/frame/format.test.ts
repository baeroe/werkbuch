import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import de from '../../../../../lang/de.json';
import en from '../../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { mockApi, type MockApi } from '@/test/api';
import { organization } from '@/test/fixtures';
import type { Organization } from '@/types';
import { formatDate, formatDateTime, relativeTime, useOrgZone } from './format';

let shared: Organization = organization;
let api: MockApi | undefined;

vi.mock('@inertiajs/react', () => ({ usePage: () => ({ props: { organization: shared } }) }));

afterEach(() => {
  initI18n({ locale: 'de', translations: de });
  vi.useRealTimers();
  shared = organization;
  api?.restore();
  api = undefined;
});

describe('formatDate and formatDateTime', () => {
  // 23:30 UTC on the 27th is already the 28th in Berlin (CET, UTC+1 after the clocks went back on 25 October)
  const iso = '2026-10-27T23:30:00Z';

  it('print the day in the zone: the day changes at midnight of the zone, not of UTC', () => {
    expect(formatDate(iso, 'UTC')).toBe('27.10.2026');
    expect(formatDate(iso, 'Europe/Berlin')).toBe('28.10.2026');
    expect(formatDateTime(iso, 'UTC')).toBe('27.10.2026, 23:30');
    expect(formatDateTime(iso, 'Europe/Berlin')).toBe('28.10.2026, 00:30');
  });

  it('follow the language of the page', () => {
    initI18n({ locale: 'en', translations: en });

    expect(formatDate(iso, 'UTC')).toBe('27 Oct 2026');
    expect(formatDateTime(iso, 'Europe/Berlin')).toBe('28 Oct 2026, 00:30');

    initI18n({ locale: 'de', translations: de });
    expect(formatDate(iso, 'UTC')).toBe('27.10.2026');
  });
});

describe('relativeTime', () => {
  const clock = '2026-10-30T12:00:00Z';
  const at = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(clock));
    return relativeTime(iso);
  };

  it('says how far an instant is from now, in days, hours or minutes', () => {
    expect(at('2026-10-27T12:00:00Z')).toBe('vor 3 Tagen');
    expect(at('2026-10-29T12:00:00Z')).toBe('gestern');
    expect(at('2026-10-30T15:00:00Z')).toBe('in 3 Stunden');
    expect(at('2026-10-30T11:15:00Z')).toBe('vor 45 Minuten');
    expect(at('2026-10-30T12:01:00Z')).toBe('in 1 Minute');
  });

  it('says "gerade eben" for less than a minute, either way', () => {
    expect(at('2026-10-30T11:59:30Z')).toBe('gerade eben');
    expect(at('2026-10-30T12:00:59Z')).toBe('gerade eben');
  });

  it('follows the language of the page', () => {
    initI18n({ locale: 'en', translations: en });

    expect(at('2026-10-28T12:00:00Z')).toBe('2 days ago');
    expect(at('2026-10-30T11:59:30Z')).toBe('just now');
  });
});

describe('useOrgZone', () => {
  const zone = () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    return renderHook(() => useOrgZone(), { wrapper }).result.current;
  };

  it('is the zone of the organisation', () => {
    shared = { ...organization, timezone: 'America/New_York' };

    expect(zone()).toBe('America/New_York');
  });

  it('is Berlin while the organisation is not there', () => {
    // the page did not bring it along: the first render has nothing yet, the answer of the API comes later
    shared = undefined as unknown as Organization;
    api = mockApi({ 'GET /api/v1/organization': () => ({ body: { data: organization } }) });

    expect(zone()).toBe('Europe/Berlin');
  });
});
