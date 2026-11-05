/*
 * The schedule of a template, ported from the schedule part of the clickdummy's templates.test.tsx: what the editor does
 * to a schedule (`scheduleForm.ts`: the first one, the switch of the frequency, the time as typed), the settings of each
 * frequency in the normal form the server keeps, the refusals at their fields, and the next five terms as the server
 * counts them (A335: `POST /api/v1/templates/preview` through `mockApi`). Inertia is a fake with the organisation in
 * the shared props; today is 2026-10-28, a Wednesday, in Europe/Berlin.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { firstMonday, mara, organization } from '@/test/fixtures';
import type { Schedule } from '@/types';
import { NextRuns } from './NextRuns';
import { ScheduleEditor } from './ScheduleEditor';
import { defaultSchedule, normalizeTime, withFrequency } from './scheduleForm';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization }, url: '/projects/APP/templates/tpl_app_report' }),
}));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());

/* --------------------------------------------------------------------- fake server */

/** The first Mondays from November 2026 at 09:00 in Berlin, as the server answers for any schedule that is not paused. */
const TERMS = ['2026-11-02T08:00:00.000Z', '2026-12-07T08:00:00.000Z', '2027-01-04T08:00:00.000Z', '2027-02-01T08:00:00.000Z', '2027-03-01T08:00:00.000Z'];

let overrides: Record<string, MockRoute>;
let api: MockApi;
let changes: (Schedule | null)[];
let unreadable: [string, string | null][];
/** Sets the schedule as a saved template from outside would. */
let setFromOutside: (schedule: Schedule | null) => void;

const refused = { status: 422, body: { type: 'about:blank', title: 'invalid', status: 422, reason: 'validation_failed', detail: 'Ungültig.', errors: { 'schedule.starts_on': ['Das Datum muss zwischen 2000-01-01 und 2099-12-31 liegen.'] } } };
const unavailable = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };

beforeEach(() => {
  overrides = {};
  changes = [];
  unreadable = [];
  const base: Record<string, MockRoute> = {
    'POST /api/v1/templates/preview': (body) => {
      const { schedule } = body as { schedule: Schedule };
      return { body: { data: { runs: schedule.paused ? [] : TERMS, title: null } } };
    },
  };
  api = mockApi(new Proxy(base, { get: (target, key: string) => overrides[key] ?? target[key] }));
});

afterEach(() => api.restore());

const previews = () => api.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/templates/preview').map((call) => call.body as { schedule: Schedule; title: string; run_count: number });
const last = () => changes.at(-1);

/** Holds every answer of the preview until `release`. */
function holdPreviews() {
  const real = globalThis.fetch;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (new URL(String(input), window.location.origin).pathname === '/api/v1/templates/preview') await held;
    return real(input, init);
  };
  return { release, restore: () => (globalThis.fetch = real) };
}

type HarnessProps = { initial: Schedule | null; readOnly?: boolean; runCount?: number; errors?: Record<string, string> };

/** The editor with its schedule held as the template editor holds it. */
function Harness({ initial, readOnly = false, runCount = 0, errors }: HarnessProps) {
  const [schedule, setSchedule] = useState(initial);
  setFromOutside = setSchedule;
  return (
    <ScheduleEditor
      schedule={schedule}
      onChange={(next) => {
        changes.push(next);
        setSchedule(next);
      }}
      readOnly={readOnly}
      runCount={runCount}
      errors={errors}
      fieldId={(path) => `field-${path}`}
      onUnreadable={(path, message) => unreadable.push([path, message])}
    />
  );
}

function renderEditor(props: HarnessProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: option }));
}

const region = () => screen.getByRole('region', { name: 'Zeitplan' });
const weekly: Schedule = { frequency: 'weekly', interval: 1, weekdays: [1], time: '08:00', starts_on: '2026-11-02', ends: { type: 'never' }, paused: false };

/* --------------------------------------------------------------------- the rules */

describe('scheduleForm', () => {
  it('starts every week on the weekday of today at 09:00, from today on, without end', () => {
    // 2026-10-28 is a Wednesday
    expect(defaultSchedule('2026-10-28')).toEqual({ frequency: 'weekly', interval: 1, weekdays: [3], time: '09:00', starts_on: '2026-10-28', ends: { type: 'never' }, paused: false });
  });

  it('keeps interval, time, start, end and pause, and drops what the old frequency needed', () => {
    expect(withFrequency({ ...firstMonday, interval: 2, time: '07:30', ends: { type: 'count', count: 4 }, paused: true }, 'daily')).toEqual({
      frequency: 'daily',
      interval: 2,
      time: '07:30',
      starts_on: '2026-09-01',
      ends: { type: 'count', count: 4 },
      paused: true,
    });
  });

  it('weekly: keeps chosen days, else takes the weekday of an n-th weekday, else the weekday of the start', () => {
    expect(withFrequency({ ...weekly, weekdays: [4, 1] }, 'weekly').weekdays).toEqual([1, 4]);
    expect(withFrequency(firstMonday, 'weekly')).toEqual({ frequency: 'weekly', interval: 1, weekdays: [1], time: '09:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: false });
    // 2026-09-01 is a Tuesday
    expect(withFrequency(withFrequency(firstMonday, 'daily'), 'weekly').weekdays).toEqual([2]);
  });

  it('monthly: keeps a day or an n-th weekday, else takes the day of the start', () => {
    expect(withFrequency({ ...weekly, frequency: 'monthly', month_day: 'last' }, 'monthly')).toMatchObject({ month_day: 'last' });
    expect(withFrequency(firstMonday, 'monthly')).toEqual(firstMonday);
    expect(withFrequency({ ...weekly, starts_on: '2026-03-15' }, 'monthly')).toEqual({ frequency: 'monthly', interval: 1, month_day: 15, time: '08:00', starts_on: '2026-03-15', ends: { type: 'never' }, paused: false });
  });

  it('yearly: keeps a date, else takes the date of the start', () => {
    expect(withFrequency({ ...weekly, frequency: 'yearly', yearly_date: '12-24' }, 'yearly').yearly_date).toBe('12-24');
    expect(withFrequency({ ...weekly, starts_on: '2026-03-05' }, 'yearly')).toEqual({ frequency: 'yearly', interval: 1, yearly_date: '03-05', time: '08:00', starts_on: '2026-03-05', ends: { type: 'never' }, paused: false });
  });
});

describe('normalizeTime', () => {
  it('reads hours and minutes with a colon or a point, hours alone and four digits', () => {
    expect(normalizeTime('09:00')).toBe('09:00');
    expect(normalizeTime(' 7.30 ')).toBe('07:30');
    expect(normalizeTime('23:59')).toBe('23:59');
    expect(normalizeTime('9')).toBe('09:00');
    expect(normalizeTime('9:5')).toBe('09:05');
    expect(normalizeTime('0930')).toBe('09:30');
    expect(normalizeTime('930')).toBe('09:30');
    expect(normalizeTime('0')).toBe('00:00');
  });

  it('refuses what is no time of day', () => {
    for (const text of ['', '24', '24:00', '9:60', '093', '12345', '9 Uhr', '09:00 AM', ':30', '9:']) expect(normalizeTime(text), text).toBeNull();
  });
});

/* --------------------------------------------------------------------- the editor */

describe('ScheduleEditor', () => {
  it('switches a schedule on as every week on the weekday of today, off, and back on with the one it had', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: null });
    expect(within(region()).getByText('Ohne Zeitplan wird die Vorlage von Hand angewendet: im Anlegen-Dialog oder mit „Jetzt ausführen“.')).toBeTruthy();
    await user.click(screen.getByRole('switch', { name: 'Nach Zeitplan anlegen' }));
    expect(last()).toEqual(defaultSchedule('2026-10-28'));
    expect(within(region()).getByText('Wöchentlich am Mittwoch um 09:00')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Donnerstag' }));
    await user.click(screen.getByRole('switch', { name: 'Nach Zeitplan anlegen' }));
    expect(last()).toBeNull();
    expect(screen.queryByRole('group', { name: 'Frequenz' })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Nach Zeitplan anlegen' }));
    expect(last()).toMatchObject({ frequency: 'weekly', weekdays: [3, 4] });
  });

  it('builds the normal form of every frequency', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: firstMonday });
    const frequency = screen.getByRole('group', { name: 'Frequenz' });
    await user.click(within(frequency).getByRole('button', { name: 'Wöchentlich' }));
    expect(last()).toEqual({ frequency: 'weekly', interval: 1, weekdays: [1], time: '09:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: false });
    await user.click(within(frequency).getByRole('button', { name: 'Jährlich' }));
    expect(last()).toEqual({ frequency: 'yearly', interval: 1, yearly_date: '09-01', time: '09:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: false });
    await user.click(within(frequency).getByRole('button', { name: 'Monatlich' }));
    expect(last()).toEqual({ frequency: 'monthly', interval: 1, month_day: 1, time: '09:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: false });
    await user.click(within(frequency).getByRole('button', { name: 'Täglich' }));
    expect(last()).toEqual({ frequency: 'daily', interval: 1, time: '09:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: false });
    expect(within(region()).getByText('Täglich um 09:00')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Intervall in Tagen' })).toBeTruthy();
  });

  it('toggles weekdays with Monday first, and keeps the last one pressed', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    const days = screen.getByRole('group', { name: 'Wochentage' });
    expect(within(days).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']);
    expect(within(days).getAllByRole('button').map((button) => button.textContent)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    await user.click(within(days).getByRole('button', { name: 'Sonntag' }));
    // the normal form of the server: 0 = Sunday first
    expect(last()).toMatchObject({ weekdays: [0, 1] });
    await user.click(within(days).getByRole('button', { name: 'Montag' }));
    expect(last()).toMatchObject({ weekdays: [0] });
    const count = changes.length;
    await user.click(within(days).getByRole('button', { name: 'Sonntag' }));
    expect(changes).toHaveLength(count);
    expect(within(days).getByRole('button', { name: 'Sonntag' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('runs monthly on a day, on the last one, and says that a short month takes its last day', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: { ...weekly, frequency: 'monthly', weekdays: undefined, month_day: 15, starts_on: '2026-10-15' } });
    await choose(user, screen.getByRole('combobox', { name: /^Tag/ }), 'Letzter Tag');
    expect(last()).toMatchObject({ frequency: 'monthly', month_day: 'last' });
    expect(within(region()).getByText('Monatlich am letzten Tag um 08:00')).toBeTruthy();
    await choose(user, screen.getByRole('combobox', { name: /^Tag/ }), '31.');
    expect(last()).toMatchObject({ month_day: 31 });
    expect(screen.getByText('Monate ohne diesen Tag nehmen ihren letzten Tag.')).toBeTruthy();
  });

  it('runs monthly on the n-th weekday, and back on the day of the start', async () => {
    const user = userEvent.setup();
    // 2026-10-15 is a Thursday
    renderEditor({ initial: { ...weekly, frequency: 'monthly', weekdays: undefined, month_day: 15, starts_on: '2026-10-15' } });
    await user.click(screen.getByRole('button', { name: 'Wochentag im Monat' }));
    expect(last()).toEqual({ frequency: 'monthly', interval: 1, nth_weekday: { n: 1, weekday: 4 }, time: '08:00', starts_on: '2026-10-15', ends: { type: 'never' }, paused: false });
    await choose(user, screen.getByRole('combobox', { name: /^Woche im Monat/ }), 'Letzte');
    await choose(user, screen.getByRole('combobox', { name: /^Wochentag/ }), 'Freitag');
    expect(last()).toMatchObject({ nth_weekday: { n: -1, weekday: 5 } });
    expect(within(region()).getByText('Jeden letzten Freitag im Monat um 08:00')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tag im Monat' }));
    expect(last()).toEqual({ frequency: 'monthly', interval: 1, month_day: 15, time: '08:00', starts_on: '2026-10-15', ends: { type: 'never' }, paused: false });
  });

  it('runs yearly on a date, cut to the length of its month', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: { ...weekly, frequency: 'yearly', weekdays: undefined, yearly_date: '01-31' } });
    await choose(user, screen.getByRole('combobox', { name: /^Monat/ }), 'Februar');
    expect(last()).toMatchObject({ yearly_date: '02-29' });
    await choose(user, screen.getByRole('combobox', { name: /^Tag/ }), '14.');
    expect(last()).toMatchObject({ yearly_date: '02-14' });
  });

  it('reads the time as typed: hours alone, a short minute and four digits', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    const time = screen.getByRole('textbox', { name: /^Uhrzeit/ });
    expect(screen.getByText('24-Stunden-Zeit, Zeitzone Europe/Berlin')).toBeTruthy();
    for (const [typed, read] of [
      ['9', '09:00'],
      ['9:5', '09:05'],
      ['0930', '09:30'],
    ]) {
      await user.clear(time);
      await user.type(time, typed);
      await user.tab();
      expect(last()).toMatchObject({ time: read });
    }
    // a time from outside shows
    expect((time as HTMLInputElement).value).toBe('0930');
  });

  it('marks a time it cannot read once the field is left, and keeps it from saving', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    const time = screen.getByRole('textbox', { name: /^Uhrzeit/ });
    await user.clear(time);
    await user.type(time, '25');
    expect(unreadable.at(-1)).toEqual(['schedule.time', 'Gib eine Uhrzeit als Stunden und Minuten an, zum Beispiel 09:00.']);
    // not at every key on the way
    expect(time.getAttribute('aria-invalid')).toBeNull();
    await user.tab();
    expect(time.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Gib eine Uhrzeit als Stunden und Minuten an, zum Beispiel 09:00.')).toBeTruthy();
    expect(time.id).toBe('field-schedule.time');
    await user.type(time, '{Backspace}');
    expect(unreadable.at(-1)).toEqual(['schedule.time', null]);
  });

  it('shows a time from outside instead of a text it could not read', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    const time = screen.getByRole('textbox', { name: /^Uhrzeit/ });
    await user.clear(time);
    await user.type(time, '25');
    await user.tab();
    act(() => setFromOutside({ ...weekly, time: '10:15' }));
    expect((time as HTMLInputElement).value).toBe('10:15');
    expect(time.getAttribute('aria-invalid')).toBeNull();
    expect(unreadable.at(-1)).toEqual(['schedule.time', null]);
  });

  it('takes a whole interval, and refuses another one on Enter', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    const interval = screen.getByRole('textbox', { name: 'Intervall in Wochen' });
    await user.clear(interval);
    await user.type(interval, '2');
    expect(last()).toMatchObject({ interval: 2 });
    expect(within(region()).getByText('Alle 2 Wochen am Montag um 08:00')).toBeTruthy();
    await user.clear(interval);
    expect(unreadable.at(-1)).toEqual(['schedule.interval', 'Eine ganze Zahl von 1 bis 999.']);
    await user.type(interval, '{Enter}');
    expect(interval.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Eine ganze Zahl von 1 bis 999.')).toBeTruthy();
  });

  it('ends never, on a date or after a number of runs', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly, runCount: 2 });
    const end = screen.getByRole('group', { name: 'Ende' });
    await user.click(within(end).getByRole('button', { name: 'Am Datum' }));
    // 90 days after the start, which lies after today
    expect(last()).toMatchObject({ ends: { type: 'on', date: '2027-01-31' } });
    await user.click(within(end).getByRole('button', { name: 'Nach Läufen' }));
    expect(last()).toMatchObject({ ends: { type: 'count', count: 12 } });
    expect(screen.getByText('Bisher 2 Läufe nach Zeitplan.')).toBeTruthy();
    const count = screen.getByRole('textbox', { name: 'Anzahl der Läufe' });
    await user.clear(count);
    await user.type(count, '3');
    expect(last()).toMatchObject({ ends: { type: 'count', count: 3 } });
    expect(screen.getByText('Läufen')).toBeTruthy();
    await user.clear(count);
    // the field goes: what it could not read goes with it
    await user.click(within(end).getByRole('button', { name: 'Nie' }));
    expect(last()).toMatchObject({ ends: { type: 'never' } });
    expect(unreadable.at(-1)).toEqual(['schedule.ends', null]);
  });

  it('takes the end from today when the start lies before, and counts one run in words', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: { ...weekly, starts_on: '2026-09-01', ends: { type: 'count', count: 1 } }, runCount: 1 });
    expect(screen.getByText('Bisher ein Lauf nach Zeitplan.')).toBeTruthy();
    expect(screen.getByText('Lauf')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Am Datum' }));
    expect(last()).toMatchObject({ ends: { type: 'on', date: '2027-01-26' } });
  });

  it('refuses a start after the end and an end before the start, and takes the days in between', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: { ...weekly, ends: { type: 'on', date: '2026-11-20' } } });
    await user.click(screen.getByRole('button', { name: /^Beginn:/ }));
    await user.click(await screen.findByRole('button', { name: 'Montag, 30. November 2026' }));
    expect(await screen.findByText('Der Beginn läge nach dem Ende (20.11.2026). Wähle einen früheren Tag oder verschiebe zuerst das Ende.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(await screen.findByText('Ein Zeitplan braucht einen Beginn.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Montag, 9. November 2026' }));
    expect(last()).toMatchObject({ starts_on: '2026-11-09' });

    await user.click(screen.getByRole('button', { name: /^Ende:/ }));
    await user.click(await screen.findByRole('button', { name: 'Donnerstag, 5. November 2026' }));
    expect(await screen.findByText('Das Ende läge vor dem Beginn (09.11.2026). Wähle einen Tag ab dann.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(await screen.findByText('Wähle einen Tag, oder stell das Ende auf „Nie“.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Montag, 30. November 2026' }));
    expect(last()).toMatchObject({ ends: { type: 'on', date: '2026-11-30' } });
  });

  it('pauses: the schedule is marked, and plans no terms', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    await screen.findByRole('list', { name: 'Nächste Termine' });
    await user.click(screen.getByRole('switch', { name: 'Pausiert' }));
    expect(last()).toMatchObject({ paused: true });
    // the chip beside the sentence, besides the label of the switch
    expect(within(region()).getAllByText('Pausiert')).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Nächste Termine' })).toBeNull();
    expect(screen.getByText('Pausiert: Solange er pausiert, legt der Zeitplan keine Items an. „Jetzt ausführen“ geht trotzdem.')).toBeTruthy();
  });

  it('reads a schedule without its settings: start, end, zone and the next terms', async () => {
    renderEditor({ initial: { ...firstMonday, ends: { type: 'count', count: 12 } }, readOnly: true });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Frequenz' })).toBeNull();
    expect(within(region()).getByText('Jeden ersten Montag im Monat um 09:00, endet nach 12 Läufen')).toBeTruthy();
    expect(screen.getByText('01.09.2026')).toBeTruthy();
    expect(screen.getByText('Nach 12 Läufen')).toBeTruthy();
    expect(screen.getByText('Europe/Berlin')).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Nächste Termine' })).toBeTruthy();
  });

  it('reads the end of a schedule that never ends or ends on a day, and that one without a schedule runs by hand', () => {
    const { unmount } = renderEditor({ initial: firstMonday, readOnly: true });
    expect(screen.getByText('Nie')).toBeTruthy();
    unmount();
    const ended = renderEditor({ initial: { ...firstMonday, ends: { type: 'on', date: '2027-06-30' } }, readOnly: true });
    expect(screen.getByText('30.06.2027')).toBeTruthy();
    ended.unmount();
    renderEditor({ initial: null, readOnly: true });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Ohne Zeitplan wird die Vorlage von Hand angewendet: im Anlegen-Dialog oder mit „Jetzt ausführen“.')).toBeTruthy();
  });

  it('shows the refusals of the server at their fields, and the others below', () => {
    renderEditor({
      initial: { ...weekly, ends: { type: 'on', date: '2027-01-31' } },
      errors: {
        'schedule.time': 'Eine Uhrzeit wie 09:00.',
        'schedule.interval': 'Das Intervall muss eine ganze Zahl von 1 bis 999 sein.',
        'schedule.starts_on': 'Der Beginn muss ein Datum sein.',
        'schedule.ends': 'Das Ende muss nach dem Beginn liegen.',
        'schedule.frequency': 'Wähle täglich, wöchentlich, monatlich oder jährlich.',
        'schedule.month_day': 'Der Tag des Monats muss 1 bis 31 sein.',
      },
    });
    expect(screen.getByRole('textbox', { name: /^Uhrzeit/ }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Eine Uhrzeit wie 09:00.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Intervall in Wochen' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Das Intervall muss eine ganze Zahl von 1 bis 999 sein.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Beginn:/ }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Der Beginn muss ein Datum sein.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ende:/ }).getAttribute('aria-invalid')).toBe('true');
    // a weekly schedule shows no day of the month: that refusal and the frequency's stand below the settings
    const others = region().querySelector('[data-refused]')!;
    expect(others.textContent).toContain('Wähle täglich, wöchentlich, monatlich oder jährlich.');
    expect(others.textContent).toContain('Der Tag des Monats muss 1 bis 31 sein.');
    expect(others.textContent).not.toContain('Eine Uhrzeit wie 09:00.');
  });

  it('shows the refusals of the day, the n-th weekday and the date at their selects, and of a count at its field', () => {
    const monthly: Schedule = { ...weekly, frequency: 'monthly', weekdays: undefined, month_day: 3, ends: { type: 'count', count: 5 } };
    const { unmount } = renderEditor({ initial: monthly, errors: { 'schedule.month_day': 'Kein Tag.', 'schedule.ends': 'Zu viele Läufe.' } });
    expect(screen.getByRole('combobox', { name: /^Tag/ }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Anzahl der Läufe' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Zu viele Läufe.')).toBeTruthy();
    unmount();
    const nth = renderEditor({ initial: { ...monthly, month_day: undefined, nth_weekday: { n: 2, weekday: 3 } }, errors: { 'schedule.nth_weekday': 'Kein Wochentag.' } });
    expect(screen.getByRole('combobox', { name: /^Woche im Monat/ }).getAttribute('aria-invalid')).toBe('true');
    nth.unmount();
    renderEditor({ initial: { ...weekly, frequency: 'yearly', weekdays: undefined, yearly_date: '05-04' }, errors: { 'schedule.yearly_date': 'Kein Datum.' } });
    expect(screen.getByRole('combobox', { name: /^Monat/ }).getAttribute('aria-invalid')).toBe('true');
    expect(region().querySelector('[data-refused]')).toBeNull();
  });
});

/* --------------------------------------------------------------------- the next terms */

describe('NextRuns', () => {
  it('shows the terms of the server as day and time in the zone of the organisation', async () => {
    renderEditor({ initial: firstMonday, runCount: 2 });
    const runs = await screen.findByRole('list', { name: 'Nächste Termine' });
    const items = within(runs).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    const first = items[0].querySelector('time')!;
    expect(first.textContent).toBe('Montag, 2. November 2026 um 09:00');
    expect(first.getAttribute('dateTime')).toBe(TERMS[0]);
    expect(items[0].textContent).toContain('Mo.');
    expect(items[0].textContent).toContain('Nov.');
    expect(previews()[0]).toEqual({ schedule: firstMonday, title: '', run_count: 2 });
  });

  it('asks once the schedule rests, not at every key', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: weekly });
    await screen.findByRole('list', { name: 'Nächste Termine' });
    const time = screen.getByRole('textbox', { name: /^Uhrzeit/ });
    await user.clear(time);
    await user.type(time, '0930');
    await waitFor(() => expect(previews().filter((body) => body.schedule.time === '09:30')).toHaveLength(1));
    expect(previews().filter((body) => body.schedule.time === '00:00' || body.schedule.time === '09:00')).toEqual([]);
  });

  it('says that a schedule has ended', async () => {
    overrides['POST /api/v1/templates/preview'] = () => ({ body: { data: { runs: [], title: null } } });
    renderEditor({ initial: weekly });
    expect(await screen.findByText('Der Zeitplan ist zu Ende und legt keine Items mehr an. Ein späteres Ende oder mehr Läufe setzen ihn fort.')).toBeTruthy();
  });

  it('says that the server cannot read the schedule, and offers a retry when it did not answer', async () => {
    const user = userEvent.setup();
    overrides['POST /api/v1/templates/preview'] = () => refused;
    const { unmount } = renderEditor({ initial: weekly });
    expect(await screen.findByText('Der Zeitplan lässt sich so nicht lesen. Prüfe Beginn, Uhrzeit und Ende.')).toBeTruthy();
    unmount();

    overrides['POST /api/v1/templates/preview'] = () => unavailable;
    renderEditor({ initial: weekly });
    expect(await screen.findByText('Termine nicht geladen: Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    delete overrides['POST /api/v1/templates/preview'];
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('list', { name: 'Nächste Termine' })).toBeTruthy();
  });

  it('shows a skeleton at first, and the old terms until the next answer', async () => {
    const user = userEvent.setup();
    let held = holdPreviews();
    try {
      renderEditor({ initial: weekly });
      expect(screen.getByText('Termine laden …')).toBeTruthy();
      held.release();
      const runs = await screen.findByRole('list', { name: 'Nächste Termine' });
      held.restore();
      held = holdPreviews();
      const interval = screen.getByRole('textbox', { name: 'Intervall in Wochen' });
      await user.clear(interval);
      await user.type(interval, '3');
      await waitFor(() => expect(runs.getAttribute('aria-busy')).toBe('true'));
      expect(screen.getByRole('list', { name: 'Nächste Termine' })).toBe(runs);
      held.release();
      await waitFor(() => expect(runs.hasAttribute('aria-busy')).toBe(false));
    } finally {
      held.restore();
    }
  });

  it('can stand alone with the title of the template', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NextRuns schedule={weekly} runCount={0} title="  Bericht {week} " />
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Nächste Termine' });
    expect(previews()[0]).toEqual({ schedule: weekly, title: 'Bericht {week}', run_count: 0 });
  });

  it('is busy only while a new schedule is asked for, and keeps the paused note without asking anew', async () => {
    const user = userEvent.setup();
    renderEditor({ initial: { ...weekly, paused: true } });
    expect(screen.getByText('Pausiert: Solange er pausiert, legt der Zeitplan keine Items an. „Jetzt ausführen“ geht trotzdem.')).toBeTruthy();
    await user.click(screen.getByRole('switch', { name: 'Pausiert' }));
    expect(await screen.findByRole('list', { name: 'Nächste Termine' })).toBeTruthy();
    await act(async () => {});
  });
});
