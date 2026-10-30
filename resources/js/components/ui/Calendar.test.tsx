import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/lib/i18n';
import en from '../../../../lang/en.json';
import { Calendar } from './Calendar';

const TODAY = '2026-10-15'; // a Thursday

const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;
const focusDay = (iso: string) => act(() => day(iso).focus());
const focusedDay = () => (document.activeElement as HTMLElement).dataset.day;

function Harness({ start = null, onChange, ...rest }: { start?: string | null; onChange?: (value: string | null) => void } & Partial<Parameters<typeof Calendar>[0]>) {
  const [value, setValue] = useState<string | null>(start);
  return (
    <Calendar
      value={value}
      today={TODAY}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

afterEach(() => vi.useRealTimers());

describe('Calendar', () => {
  it('names the month and the grid in the language of the page, with the weekdays as headers', () => {
    const { unmount } = render(<Harness />);

    expect(screen.getByText('Oktober 2026')).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Datum, Oktober 2026' })).toBeTruthy();
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(headers[0].getAttribute('abbr')).toBe('Montag');
    unmount();

    initI18n({ locale: 'en', translations: en });
    render(<Harness />);
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Date, October 2026' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(screen.getByRole('button', { name: /^Thursday,? 15 October 2026, today$/ })).toBeTruthy();
  });

  it('shows six full weeks, marks today for assistive technology and names what is picked', () => {
    render(<Harness label="Fälligkeit" />);

    expect(screen.getByRole('grid', { name: 'Fälligkeit, Oktober 2026' })).toBeTruthy();
    expect(document.querySelectorAll('[data-day]')).toHaveLength(42);
    const today = screen.getByRole('button', { name: 'Donnerstag, 15. Oktober 2026, heute' });
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('button', { name: 'Freitag, 16. Oktober 2026' }).hasAttribute('aria-current')).toBe(false);
    // one tab stop: the focused day
    expect(document.querySelectorAll('[data-day][tabindex="0"]')).toHaveLength(1);
    expect(today.tabIndex).toBe(0);
  });

  it('takes the date of the device as today when none is given', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 1, 9, 12));
    render(<Calendar value={null} onChange={() => {}} />);

    expect(screen.getByText('Februar 2027')).toBeTruthy();
    expect(document.querySelector('[aria-current="date"]')?.getAttribute('data-day')).toBe('2027-02-09');
  });

  it.each([
    ['ArrowRight', '2026-10-16'],
    ['ArrowLeft', '2026-10-14'],
    ['ArrowDown', '2026-10-22'],
    ['ArrowUp', '2026-10-08'],
  ])('%s moves the focus from the 15th to %s', async (key, expected) => {
    const user = userEvent.setup();
    render(<Harness />);
    focusDay(TODAY);

    await user.keyboard(`{${key}}`);

    expect(focusedDay()).toBe(expected);
  });

  it('carries the focus over the edge of the month and shows that month', async () => {
    const user = userEvent.setup();
    render(<Harness start="2026-10-31" />);
    focusDay('2026-10-31');

    await user.keyboard('{ArrowRight}');

    expect(focusedDay()).toBe('2026-11-01');
    expect(screen.getByText('November 2026')).toBeTruthy();
  });

  it.each([
    [1, '2026-10-12', '2026-10-18'],
    [0, '2026-10-11', '2026-10-17'],
  ] as const)('Home and End go to the ends of the week when the week starts on %i', async (weekStartsOn, home, end) => {
    const user = userEvent.setup();
    render(<Harness weekStartsOn={weekStartsOn} />);
    focusDay(TODAY);

    await user.keyboard('{Home}');
    expect(focusedDay()).toBe(home);
    await user.keyboard('{End}');
    expect(focusedDay()).toBe(end);
  });

  it('starts the week on Sunday when asked to', () => {
    render(<Harness weekStartsOn={0} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']);
  });

  it('Page Up and Page Down move by a month and cut to the last day: 31 January becomes 28 February 2027', async () => {
    const user = userEvent.setup();
    render(<Harness start="2027-01-31" />);
    focusDay('2027-01-31');

    await user.keyboard('{PageDown}');
    expect(focusedDay()).toBe('2027-02-28');
    expect(screen.getByText('Februar 2027')).toBeTruthy();

    await user.keyboard('{PageUp}');
    expect(focusedDay()).toBe('2027-01-28');
    expect(screen.getByText('Januar 2027')).toBeTruthy();
  });

  it('Shift with Page Up and Page Down moves by a year', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    focusDay(TODAY);

    await user.keyboard('{Shift>}{PageDown}{/Shift}');
    expect(focusedDay()).toBe('2027-10-15');
    await user.keyboard('{Shift>}{PageUp}{PageUp}{/Shift}');
    expect(focusedDay()).toBe('2025-10-15');
  });

  it('leaves other keys alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    focusDay(TODAY);

    await user.keyboard('a');
    const prevented = fireEvent.keyDown(day(TODAY), { key: 'Tab' });

    expect(focusedDay()).toBe(TODAY);
    expect(prevented).toBe(true);
  });

  it('picks the day with a click, Enter or Space, and marks it as selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(day('2026-10-20'));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-20');
    expect(day('2026-10-20').closest('td')?.getAttribute('aria-selected')).toBe('true');
    expect(day('2026-10-21').closest('td')?.getAttribute('aria-selected')).toBe('false');

    focusDay('2026-10-20');
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-21');
    await user.keyboard('{ArrowRight} ');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-22');
  });

  it('picks a day of the neighbouring month and shows that month', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(day('2026-11-01'));

    expect(onChange).toHaveBeenLastCalledWith('2026-11-01');
    expect(screen.getByText('November 2026')).toBeTruthy();
  });

  it('removes the choice with "Entfernen", which only shows while a day is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start="2026-10-20" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Entfernen' }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
    expect(day('2026-10-20').closest('td')?.getAttribute('aria-selected')).toBe('false');
  });

  it('"Heute" jumps to today, chooses it and puts the focus on it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start="2027-03-04" onChange={onChange} />);
    expect(screen.getByText('März 2027')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Heute' }));

    expect(onChange).toHaveBeenLastCalledWith(TODAY);
    expect(screen.getByText('Oktober 2026')).toBeTruthy();
    expect(focusedDay()).toBe(TODAY);
  });

  it('shows the month of a value that is set from outside', () => {
    const { rerender } = render(<Calendar value={null} today={TODAY} onChange={() => {}} />);
    expect(screen.getByText('Oktober 2026')).toBeTruthy();

    rerender(<Calendar value="2027-06-02" today={TODAY} onChange={() => {}} />);

    expect(screen.getByText('Juni 2027')).toBeTruthy();
    expect(day('2027-06-02').tabIndex).toBe(0);
  });

  it('the month buttons page by month and keep the focus on themselves', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Nächster Monat' }));
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nächster Monat' }));

    await user.click(screen.getByRole('button', { name: 'Voriger Monat' }));
    await user.click(screen.getByRole('button', { name: 'Voriger Monat' }));
    expect(screen.getByText('September 2026')).toBeTruthy();
    // the focused day went along: 15 September
    expect(day('2026-09-15').tabIndex).toBe(0);
  });

  it('does not pull the focus out of a button after a jump that changed nothing', async () => {
    const user = userEvent.setup();
    // "Heute" while today already is the focused day moves nothing; a later page of the month must not move the focus either
    render(<Calendar value={null} today={TODAY} onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Heute' }));
    await user.click(screen.getByRole('button', { name: 'Nächster Monat' }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nächster Monat' }));
  });
});
