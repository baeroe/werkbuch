/*
 * The date and property editors of an item against a fake REST API (`mockApi`): every field type shown, changed and
 * emptied, what the server refuses at the field, and the rules of `parse.ts`. From the clickdummy's `PropertyField`
 * tests, with numbers read as 13c decided (comma or point, thousands points only with a decimal comma).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../lang/en.json';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { initI18n } from '@/lib/i18n';
import type { WorkItemPatch } from '@/api/workItems';
import { useWorkItems } from '@/hooks/workItems';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, lene, list, makeWorkItem, organization, person, project, properties, standard, theo, web47 } from '@/test/fixtures';
import type { ListedItem, Organization, Project, ProjectMember, Property, PropertyValue, RichText, User, WorkItem } from '@/types';
import { DateField, DatePopover, DayValue, useOverdue } from '../DateField';
import { useToday } from '../itemData';
import { ambiguousNumber, isEmptyValue, parseNumber, parseTyped, readsEmpty, shownText } from './parse';
import { PropertyField } from './PropertyField';
import { PropertyValueInput } from './PropertyValueInput';

let signedIn: User = lene;
let org: Organization = organization;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization: org }, url: '/items/WEB-47' }),
}));

/* -------------------------------------------------------------------------- data */

const [customer, effort] = properties as [Property, Property];
const prop = (key: string, label: string, field_type: Property['field_type'], changes: Partial<Property> = {}): Property => ({
  id: `pr_${key}`,
  key,
  label,
  field_type,
  help: '',
  default_value: null,
  settings: {},
  options: [],
  ...changes,
});
const browser = prop('browser', 'Browser', 'text', { help: 'Name und Version.' });
const link = prop('link', 'Link', 'url');
const billable = prop('billable', 'Abrechenbar', 'boolean');
const launch = prop('launch', 'Go-Live', 'date');
const reviewer = prop('reviewer', 'Reviewer', 'member');
const reviewers = prop('reviewers', 'Reviewer', 'member', { settings: { multiple: true } });
const steps = prop('steps', 'Schritte zum Nachstellen', 'rich_text');
const channels = prop('channels', 'Kanäle', 'dropdown', {
  settings: { multiple: true },
  options: [
    { id: 'opt_mail', label: 'Mail', color: 'sky', position: 0, archived_at: null },
    { id: 'opt_phone', label: 'Telefon', color: 'moss', position: 1, archived_at: null },
    { id: 'opt_fax', label: 'Fax', color: 'slate', position: 2, archived_at: '2026-09-01T08:00:00.000Z' },
  ],
});
const hafen = customer.options[1]!;
// Gärtnerei Moos archived meanwhile, but still the customer of the item
const customerArchived: Property = { ...customer, options: customer.options.map((option) => (option.id === 'opt_moos' ? { ...option, archived_at: '2026-10-01T08:00:00.000Z' } : option)) };

const paragraph = (text: string): RichText => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: RichText[]): RichText => ({ type: 'doc', content });
const listDoc = doc(paragraph('So lässt sich der Fehler nachstellen:'), {
  type: 'orderedList',
  content: [
    { type: 'listItem', content: [paragraph('Die Formularseite öffnen.')] },
    { type: 'listItem', content: [paragraph('Auf „Absenden“ tippen.')] },
  ],
});

const web = project('WEB', 'member');
const member = (user_id: string, role: ProjectMember['role'] = 'member'): ProjectMember => ({ project_id: 'p_web', user_id, role });
const pixel: User = { ...person('u_pixel', 'Pixel', 'pixel'), type: 'bot', email: null };

const item = (values: Record<string, PropertyValue> = {}, changes: Partial<WorkItem> = {}) => makeWorkItem({ id: 'wi_web_47', key: 'WEB-47', number: 47, values, ...changes });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

/** The item as the server holds it: a change lands here, and the list answers it. */
let stored: WorkItem = item();
function store(patch: WorkItemPatch): WorkItem {
  const { values = {}, ...fields } = patch as Omit<WorkItemPatch, 'description'>;
  const merged = { ...stored.values, ...values };
  for (const key of Object.keys(values)) if (merged[key] === null) delete merged[key];
  stored = { ...stored, ...fields, values: merged };
  return stored;
}

/** The stored item as the cache of the list holds it: a change shows at once and stays after the reload. */
function Live({ children }: { children: (entry: ListedItem) => ReactNode }) {
  const entry = useWorkItems({ project_id: 'p_web' }).data?.items[0];
  return entry ? children(entry) : null;
}

function renderWith(node: ReactNode, routes: Record<string, MockRoute> = {}, { projects = [web] }: { projects?: Project[] } = {}) {
  api?.restore();
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/users': () => ({ body: list([ida, lene, theo, pixel]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list([member('u_ida', 'admin'), member('u_lene'), member('u_pixel')]) }),
    'POST /api/v1/work-items/query': () => ({ body: list([stored]) }),
    'PATCH /api/v1/work-items/wi_web_47': (body) => ({ body: { data: store(body as WorkItemPatch) } }),
    ...routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (content: ReactNode) => <QueryClientProvider client={client}>{content}</QueryClientProvider>;
  const view = render(wrap(node));
  return { ...view, rerender: (next: ReactNode) => view.rerender(wrap(next)) };
}

const patches = () => api!.calls.filter((call) => call.method === 'PATCH').map((call) => call.body);
const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', { detail: 'Die Eingaben sind nicht gültig.', errors });
const toastTitles = () => currentToasts().map((entry) => entry.title);

/** A text field once the rights have loaded (read-only until then). */
async function editable(name: string | RegExp) {
  const field = await screen.findByRole<HTMLInputElement>('textbox', { name });
  await waitFor(() => expect(field.readOnly || field.getAttribute('aria-disabled') === 'true').toBe(false));
  return field;
}
const picker = (name: RegExp) => screen.findByRole('combobox', { name });
/** A button once the rights have loaded (a read-only one stands there until then, another element). */
const writable = (name: string | RegExp) =>
  waitFor(() => {
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    return button;
  });
/** What an element shows in words, without its decorative parts (icons, avatars with initials). */
function visibleText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent ?? '';
}
const optionTexts = async () => (await screen.findAllByRole('option')).map(visibleText);
/** The day of the open calendar. */
const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = lene;
  org = organization;
  stored = item();
  vi.useRealTimers();
  act(() => resetToasts());
});

/* ------------------------------------------------------------------------- parse */

describe('parse', () => {
  it('reads a comma or a point as the decimal sign, a thousands separator only before the other sign', () => {
    expect(parseNumber('3,46', 1)).toBe(3.5);
    expect(parseNumber(' 3.5 ', 1)).toBe(3.5);
    expect(parseNumber('1234.567', 3)).toBe(1234.567);
    expect(parseNumber('12.345.678,9', 1)).toBe(12345678.9);
    expect(parseNumber('12,345,678.9', 1)).toBe(12345678.9);
    // rounded half away from zero, in decimals (2,6750 is no 2,67 in binary)
    expect([parseNumber('2,6750', 2), parseNumber('-2,6750', 2), parseNumber('-0,04', 1)]).toEqual([2.68, -2.68, 0]);
    expect(Object.is(parseNumber('-0,04', 1), -0)).toBe(false);
    expect([parseNumber('drei', 1), parseNumber('1.2.3', 1), parseNumber('1.23,4', 1), parseNumber('1,23.4', 1), parseNumber('', 1), parseNumber('.5', 1)]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('refuses "1.500" and "1,500": one separator, three digits after it, no leading zero reads either way', () => {
    for (const text of ['1.500', '1,500', '-1.500', '12.345', '999,999']) {
      expect(parseNumber(text, 3)).toBeNull();
    }
    expect(ambiguousNumber('1.500')).toEqual({ whole: 1500, decimal: 1.5 });
    expect(ambiguousNumber('1,500')).toEqual({ whole: 1500, decimal: 1.5 });
    expect(ambiguousNumber('-12.345')).toEqual({ whole: -12345, decimal: -12.345 });
  });

  it('keeps "0.500" at 0,5: a leading zero is never a thousands group', () => {
    expect([parseNumber('0.500', 1), parseNumber('0,500', 3), parseNumber('-0.500', 1)]).toEqual([0.5, 0.5, -0.5]);
    expect(ambiguousNumber('0.500')).toBeNull();
  });

  it('reads "1.500,5" and "1,500.5" one way: the separator before the decimal sign groups thousands', () => {
    expect([parseNumber('1.500,5', 1), parseNumber('1,500.5', 1)]).toEqual([1500.5, 1500.5]);
    expect([ambiguousNumber('1.500,5'), ambiguousNumber('1,500.5')]).toEqual([null, null]);
  });

  it('keeps "1500", "1,5" and "1.5" as they are, and so are two or four digits after the sign', () => {
    expect([parseNumber('1500', 0), parseNumber('1,5', 1), parseNumber('1.5', 1), parseNumber('1.50', 2), parseNumber('1,5000', 4)]).toEqual([1500, 1.5, 1.5, 1.5, 1.5]);
    expect([ambiguousNumber('1500'), ambiguousNumber('1,5'), ambiguousNumber('1.5'), ambiguousNumber('1.5000')]).toEqual([null, null, null, null]);
  });

  it('refuses numbers the server cannot store: less than 10^20 in absolute value', () => {
    expect(parseNumber('99999999999999983616', 0)).toBe(99999999999999983616);
    expect(parseNumber('-99999999999999983616,5', 4)).toBe(-99999999999999983616);
    expect([parseNumber('100000000000000000000', 0), parseNumber('-100000000000000000000', 2), parseNumber('99999999999999999999,6', 0)]).toEqual([null, null, null]);
    expect(parseTyped(effort, '100000000000000000000')).toEqual({ error: 'Dem Betrag nach kleiner als 10²⁰', partial: false });
    expect(parseTyped(effort, '-1.000.000.000.000.000.000.000,5')).toEqual({ error: 'Dem Betrag nach kleiner als 10²⁰', partial: false });
  });

  it('asks which reading is meant, in the language of the page, once the typing is over', () => {
    expect(parseTyped(effort, '1.500')).toEqual({ error: 'Mehrdeutig: 1500 oder 1,5? Schreib 1500 oder 1,5.', partial: true });
    expect(parseTyped(effort, '1,500')).toEqual({ error: 'Mehrdeutig: 1500 oder 1,5? Schreib 1500 oder 1,5.', partial: true });
    initI18n({ locale: 'en', translations: en });
    expect(parseTyped(effort, '1,500')).toEqual({ error: 'Ambiguous: 1500 or 1.5? Write 1500 or 1.5.', partial: true });
  });

  it('says what a typed text means for each field type, and when its error may wait', () => {
    expect(parseTyped(effort, '  ')).toEqual({ value: null });
    expect(parseTyped(effort, 'drei')).toEqual({ error: 'Nur eine Zahl eingeben, zum Beispiel 3,5', partial: false });
    expect(parseTyped({ ...effort, settings: {} }, '1,')).toEqual({ error: 'Nur eine Zahl eingeben, zum Beispiel 4', partial: true });
    expect(parseTyped(link, ' https://bäckerei-moos.example/a ')).toEqual({ value: 'https://bäckerei-moos.example/a' });
    // as the server refuses them: without //, with a zero width space or a C1 control, longer than 2048 characters
    for (const text of ['example.com', 'ftp://example.com', 'https://example.com/a b', 'http:/x.de', 'https:x.de', 'https://exa\u200Bmple.com', 'https://example.com/\u0085', `https://example.com/${'a'.repeat(2029)}`]) {
      expect(parseTyped(link, text)).toEqual({ error: 'Die Adresse beginnt mit http:// oder https://, zum Beispiel https://example.com', partial: true });
    }
    expect(parseTyped(browser, '  Safari 18 ')).toEqual({ value: 'Safari 18' });
    expect(parseTyped(browser, 'x'.repeat(256))).toEqual({ error: 'Höchstens 255 Zeichen, jetzt sind es 256', partial: false });
    // characters as the server counts them, not UTF-16 units
    expect(parseTyped(browser, '🚀'.repeat(255))).toEqual({ value: '🚀'.repeat(255) });
    expect(parseTyped(steps, ' \n ')).toEqual({ value: null });
    expect(parseTyped(steps, 'Eins\n\nZwei')).toEqual({ value: doc(paragraph('Eins'), paragraph('Zwei')) });

    initI18n({ locale: 'en', translations: en });
    expect(parseTyped(effort, 'three')).toEqual({ error: 'Enter a number only, for example 3.5', partial: false });
  });

  it('counts empty as the server does, and a yes/no that is off as empty for readers (A89)', () => {
    expect([undefined, null, ' ', [], doc({ type: 'paragraph' })].map(isEmptyValue)).toEqual([true, true, true, true, true]);
    expect([0, false, 'a', ['opt_mail'], doc(paragraph('a'))].map(isEmptyValue)).toEqual([false, false, false, false, false]);
    expect([readsEmpty(billable, false), readsEmpty(billable, undefined), readsEmpty(billable, true), readsEmpty(effort, 0)]).toEqual([true, true, false, false]);
    expect([shownText(effort, 1234.5), shownText(effort, undefined), shownText(browser, 'Safari'), shownText(steps, doc(paragraph('a'), paragraph('b')))]).toEqual([
      '1234,5',
      '',
      'Safari',
      'a\n\nb',
    ]);
  });
});

/* -------------------------------------------------------------- typed field types */

describe('PropertyField, typed', () => {
  it('shows, changes and empties a text, with the help below it', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ browser: 'Safari 18' })} property={browser} required={false} />);

    const input = await editable('Browser');
    expect(input.value).toBe('Safari 18');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Name und Version.');

    await user.clear(input);
    // the Enter that ends an IME composition (Safari: keyCode 229) commits nothing
    await user.type(input, '  Firefox 131 ');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(patches()).toEqual([]);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(patches()).toEqual([{ values: { browser: 'Firefox 131' } }]));
    expect(input.value).toBe('Firefox 131');

    await user.clear(input);
    await user.tab();
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { browser: null } }));
  });

  it('reads "3,46" as 3,5 and "0.500" as 0,5 with one decimal, and empties the number', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ effort: 3.5 })} property={effort} required={false} />);

    const input = await editable('Aufwand (h)');
    expect(input.value).toBe('3,5');
    expect(input.getAttribute('inputmode')).toBe('decimal');

    await user.clear(input);
    await user.type(input, '3,46{Enter}');
    // the same value after rounding: nothing to save
    expect(patches()).toEqual([]);
    expect(input.value).toBe('3,5');

    await user.clear(input);
    await user.type(input, '0.500{Enter}');
    await waitFor(() => expect(patches()).toEqual([{ values: { effort: 0.5 } }]));
    expect(input.value).toBe('0,5');

    await user.clear(input);
    await user.type(input, '1.234,56{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { effort: 1234.6 } }));
    // edited without the thousands point
    expect(input.value).toBe('1234,6');

    await user.clear(input);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { effort: null } }));
  });

  it('does not save a number it cannot read', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ effort: 3.5 })} property={effort} required={false} />);

    const input = await editable('Aufwand (h)');
    await user.clear(input);
    await user.type(input, 'drei');
    // a text that can never become a number says so at once
    expect(screen.getByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(input);

    // one that may still become one waits for Enter or for leaving the field
    await user.clear(input);
    await user.type(input, '1,');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    await user.tab();
    expect(await screen.findByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeTruthy();
    expect(patches()).toEqual([]);
  });

  it('does not guess a number that reads either way, and says both readings at the field', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ effort: 3.5 })} property={effort} required={false} />);

    const input = await editable('Aufwand (h)');
    await user.clear(input);
    // on the way to "1.500,5" nothing is said yet
    await user.type(input, '1.500');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Mehrdeutig: 1500 oder 1,5? Schreib 1500 oder 1,5.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(patches()).toEqual([]);

    await user.type(input, ',5{Enter}');
    await waitFor(() => expect(patches()).toEqual([{ values: { effort: 1500.5 } }]));
  });

  it('takes the typing back with Escape', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ browser: 'Safari 18' })} property={browser} required={false} />);

    const input = await editable('Browser');
    await user.type(input, 'x'.repeat(250));
    expect(screen.getByText('Höchstens 255 Zeichen, jetzt sind es 259')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(input.value).toBe('Safari 18');
    expect(screen.queryByText(/Höchstens 255 Zeichen/)).toBeNull();
    // nothing to take back: Escape is left to whatever holds the field
    await user.keyboard('{Escape}');
    await user.tab();
    expect(patches()).toEqual([]);
  });

  it('keeps an address only when it starts with http or https, and opens it in a new tab', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ link: 'https://example.com/a' })} property={link} required={false} />);

    const input = await editable('Link');
    expect([input.type, input.getAttribute('inputmode')]).toEqual(['url', 'url']);
    const open = screen.getByRole('link', { name: 'Link in neuem Tab öffnen' });
    expect([open.getAttribute('href'), open.getAttribute('target'), open.getAttribute('rel')]).toEqual(['https://example.com/a', '_blank', 'noopener noreferrer']);

    await user.clear(input);
    await user.type(input, 'example.com/b');
    // while it is typed there is no link to a half address, and no error yet
    expect(screen.queryByRole('link')).toBeNull();
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Die Adresse beginnt mit http:// oder https://, zum Beispiel https://example.com')).toBeTruthy();

    await user.clear(input);
    await user.type(input, 'https://example.com/b{Enter}');
    await waitFor(() => expect(patches()).toEqual([{ values: { link: 'https://example.com/b' } }]));
  });

  it('shows a value that changed outside while the field is not being edited', async () => {
    const { rerender } = renderWith(<PropertyField item={item({ browser: 'Safari 18' })} property={browser} required={false} />);
    const input = await editable('Browser');
    rerender(<PropertyField item={item({ browser: 'Edge 130' })} property={browser} required={false} />);
    expect(input.value).toBe('Edge 130');
  });
});

/* ------------------------------------------------------------------ rich text */

describe('PropertyField, rich text', () => {
  it('edits a plain text as paragraphs: a blank line starts one, a single line break stays a hard break', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item()} property={steps} required={false} />);

    const area = await editable('Schritte zum Nachstellen');
    await user.type(area, 'Erst das.{Enter}Und das.{Enter}{Enter}Dann das.');
    // Enter is a line break here; mod+Enter keeps the text
    expect(patches()).toEqual([]);
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() =>
      expect(patches()).toEqual([
        {
          values: {
            steps: doc(
              { type: 'paragraph', content: [{ type: 'text', text: 'Erst das.' }, { type: 'hardBreak' }, { type: 'text', text: 'Und das.' }] },
              paragraph('Dann das.'),
            ),
          },
        },
      ]),
    );
    expect(area.value).toBe('Erst das.\nUnd das.\n\nDann das.');
  });

  it('shows a richer text read-only, to be edited in the editor', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ steps: listDoc })} property={steps} required={false} />);

    const area = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Schritte zum Nachstellen' });
    await waitFor(() => expect(screen.getByText('Im Editor bearbeiten')).toBeTruthy());
    expect(area.readOnly).toBe(true);
    expect(area.value.split('\n')).toEqual(['So lässt sich der Fehler nachstellen:', '', '1. Die Formularseite öffnen.', '2. Auf „Absenden“ tippen.']);
    await user.type(area, 'mehr');
    await user.tab();
    expect(patches()).toEqual([]);
  });
});

/* ------------------------------------------------------------- chosen field types */

describe('PropertyField, chosen', () => {
  it('keeps the archived option an item has, offers another and takes it away', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ customer: 'opt_moos' })} property={customerArchived} required={false} />);

    const trigger = await picker(/^Kunde: Gärtnerei Moos$/);
    await user.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Keine Auswahl', 'Studio Nordlicht', 'Hafenkontor', 'Gärtnerei Moosarchiviert']);
    await user.click(screen.getByRole('option', { name: 'Hafenkontor' }));
    await waitFor(() => expect(patches()).toEqual([{ values: { customer: hafen.id } }]));

    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Keine Auswahl' }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { customer: null } }));
  });

  it('ticks several options in the order of the list, the archived one only while it is set, and none is no value', async () => {
    const user = userEvent.setup();
    stored = item({ channels: ['opt_fax'] });
    renderWith(<Live>{(entry) => <PropertyField item={entry} property={channels} required={false} />}</Live>);

    await user.click(await picker(/^Kanäle: Fax$/));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Mail', 'Telefon', 'Faxarchiviert']);
    await user.click(screen.getByRole('option', { name: 'Telefon' }));
    await user.click(screen.getByRole('option', { name: 'Mail' }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { channels: ['opt_mail', 'opt_phone', 'opt_fax'] } }));
    await user.keyboard('{Escape}');

    act(() => resetToasts());
    stored = item({ channels: ['opt_mail'] });
    renderWith(<Live>{(entry) => <PropertyField item={entry} property={channels} required={false} />}</Live>);
    await user.click(await picker(/^Kanäle: Mail$/));
    // the archived option is no longer offered
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Mail', 'Telefon']);
    await user.click(screen.getByRole('option', { name: 'Mail' }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { channels: null } }));
  });

  it('switches yes or no: off reads "Nein" with or without a value, and what is set is stored (A89)', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWith(<PropertyField item={item()} property={billable} required />);

    const toggle = await screen.findByRole('switch', { name: 'Abrechenbar' });
    expect(toggle.closest('label')!.textContent).toBe('Nein');
    // no value of a required yes/no is no gap: it reads "Nein"
    expect(screen.queryByText('Pflichtfeld, noch leer. Bitte ergänzen.')).toBeNull();
    await waitFor(() => expect(toggle.hasAttribute('data-disabled')).toBe(false));
    await user.click(toggle);
    await waitFor(() => expect(patches()).toEqual([{ values: { billable: true } }]));

    rerender(<PropertyField item={item({ billable: true })} property={billable} required />);
    expect(toggle.closest('label')!.textContent).toBe('Ja');
    await user.click(toggle);
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { billable: false } }));
    rerender(<PropertyField item={item({ billable: false })} property={billable} required />);
    expect(toggle.closest('label')!.textContent).toBe('Nein');
  });

  it('picks a day from the calendar and removes it', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ launch: '2026-11-02' })} property={launch} required={false} />);

    const trigger = await writable('Go-Live: 02.11.2026');
    await user.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(day('2026-11-02')));
    await user.click(day('2026-11-05'));
    await waitFor(() => expect(patches()).toEqual([{ values: { launch: '2026-11-05' } }]));

    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { launch: null } }));
  });

  it('keeps a required day: removing it is refused in the calendar', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ launch: '2026-11-02' })} property={launch} required />);

    const trigger = await writable('Go-Live: 02.11.2026');
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }));
    expect(await screen.findByText('„Go-Live“ ist ein Pflichtfeld und lässt sich nicht leeren.')).toBeTruthy();
    expect(patches()).toEqual([]);
  });

  it('chooses a person of the project, several ones in the order of the list, and nobody', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item()} property={reviewer} required={false} />);

    const trigger = await picker(/^Reviewer: niemand$/);
    await user.click(trigger);
    expect(await optionTexts()).toEqual(['Niemand', 'Ida Brenner', 'Lene Vogt', 'PixelBot']);
    await user.click(screen.getByRole('option', { name: /Ida Brenner/ }));
    await waitFor(() => expect(patches()).toEqual([{ values: { reviewer: 'u_ida' } }]));

    stored = item({ reviewers: ['u_lene'] });
    renderWith(<Live>{(entry) => <PropertyField item={entry} property={reviewers} required={false} />}</Live>);
    await user.click(await picker(/^Reviewer: Lene Vogt$/));
    await user.click(await screen.findByRole('option', { name: /Pixel/ }));
    await user.click(screen.getByRole('option', { name: /Ida Brenner/ }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { reviewers: ['u_ida', 'u_lene', 'u_pixel'] } }));
    await user.click(screen.getByRole('option', { name: /Ida Brenner/ }));
    await user.click(screen.getByRole('option', { name: /Lene Vogt/ }));
    await user.click(screen.getByRole('option', { name: /Pixel/ }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { reviewers: null } }));
  });

  it('keeps the people an item has who can no longer be chosen, while they are set', async () => {
    const user = userEvent.setup();
    // Theo is no member of WEB, and the second account is gone
    stored = item({ reviewers: ['u_theo', 'u_gone'] });
    renderWith(<Live>{(entry) => <PropertyField item={entry} property={reviewers} required={false} />}</Live>);

    await user.click(await picker(/^Reviewer: Theo Okafor$/));
    expect(await optionTexts()).toEqual(['Ida Brenner', 'Lene Vogt', 'PixelBot', 'Theo Okafornicht mehr wählbar', 'Unbekanntnicht mehr wählbar']);
    await user.click(screen.getByRole('option', { name: /Ida Brenner/ }));
    await waitFor(() => expect(patches()).toEqual([{ values: { reviewers: ['u_ida', 'u_theo', 'u_gone'] } }]));

    // taken away, Theo can no longer be chosen
    await user.click(screen.getByRole('option', { name: /Theo Okafor/ }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ values: { reviewers: ['u_ida', 'u_gone'] } }));
    await waitFor(() => expect(screen.queryByRole('option', { name: /Theo Okafor/ })).toBeNull());
  });

  it('offers no "Niemand" or "Keine Auswahl" when the value is required', async () => {
    const user = userEvent.setup();
    renderWith(
      <>
        <PropertyField item={item({ reviewer: 'u_ida' })} property={reviewer} required />
        <PropertyField item={item({ customer: 'opt_nordlicht' })} property={customer} required />
      </>,
    );

    await user.click(await picker(/^Reviewer: Ida Brenner$/));
    expect(await optionTexts()).toEqual(['Ida Brenner', 'Lene Vogt', 'PixelBot']);
    await user.keyboard('{Escape}');
    await user.click(await picker(/^Kunde: Studio Nordlicht$/));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Studio Nordlicht', 'Hafenkontor', 'Gärtnerei Moos']);
  });
});

/* ------------------------------------------------------------- required, refusals */

describe('PropertyField, required and refused', () => {
  it('refuses to empty a required value, at the field', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ effort: 3.5 })} property={effort} required />);

    const input = await editable(/^Aufwand \(h\)/);
    expect(screen.getByText('Pflicht')).toBeTruthy();
    expect(input.getAttribute('aria-required')).toBe('true');
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(screen.getByText('„Aufwand (h)“ ist ein Pflichtfeld und lässt sich nicht leeren.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(patches()).toEqual([]);
  });

  it('shows the refusal of the server at the field, and the focus stays', async () => {
    const user = userEvent.setup();
    // the type made Kunde required meanwhile: the server refuses to empty it at `values.customer`
    renderWith(<PropertyField item={item({ customer: 'opt_nordlicht' })} property={customer} required={false} />, {
      'PATCH /api/v1/work-items/wi_web_47': () => invalid({ 'values.customer': ['„Kunde“ ist ein Pflichtfeld.'] }),
    });

    const trigger = await picker(/^Kunde: Studio Nordlicht$/);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Keine Auswahl' }));

    expect(await screen.findByText('„Kunde“ ist ein Pflichtfeld.')).toBeTruthy();
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(trigger.getAttribute('aria-describedby')!)!.textContent).toBe('„Kunde“ ist ein Pflichtfeld.');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // the old value is back, and the toast says it too
    expect(trigger.getAttribute('aria-label')).toBe('Kunde: Studio Nordlicht');
    expect(toastTitles()).toContain('Änderung nicht gespeichert');
  });

  it('leaves a refusal without a field to the toast', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item({ browser: 'Safari' })} property={browser} required={false} />, {
      'PATCH /api/v1/work-items/wi_web_47': () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' }),
    });

    const input = await editable('Browser');
    await user.type(input, ' 18{Enter}');
    await waitFor(() => expect(toastTitles()).toContain('Änderung nicht gespeichert'));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('marks a required value that an older item lacks', async () => {
    const user = userEvent.setup();
    renderWith(<PropertyField item={item()} property={customer} required />);

    const trigger = await picker(/^Kunde: keine Auswahl$/);
    expect(document.getElementById(trigger.getAttribute('aria-describedby')!)!.textContent).toBe('Pflichtfeld, noch leer. Bitte ergänzen.');
    // the item stays valid: the value can be set, nothing else is asked
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Hafenkontor' }));
    await waitFor(() => expect(patches()).toEqual([{ values: { customer: hafen.id } }]));
  });

  it('shows a read-only value with the reason, in words', async () => {
    signedIn = theo;
    renderWith(
      <>
        <PropertyField item={item({ customer: 'opt_nordlicht', reviewer: 'u_gone' })} property={customer} required={false} />
        <PropertyField item={item({ reviewer: 'u_gone' })} property={reviewer} required={false} />
        <PropertyField item={item()} property={billable} required={false} />
        <PropertyField item={item()} property={launch} required={false} />
      </>,
      {},
      { projects: [project('WEB', 'viewer')] },
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Kunde: Studio Nordlicht' }).textContent).toContain('darfst du nur lesen'));
    expect(screen.getByRole('button', { name: 'Kunde: Studio Nordlicht' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Reviewer: Unbekannt' })).toBeTruthy();
    // yes/no without a value reads "Nein" (A89), anything else without one "Kein Wert"
    expect(screen.getByRole('button', { name: 'Abrechenbar: Nein' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go-Live: kein Wert' }).textContent).toContain('Kein Wert');
  });
});

/* ------------------------------------------------------------ PropertyValueInput */

describe('PropertyValueInput in a form', () => {
  function Form({ property, initial = null, onUnreadable }: { property: Property; initial?: PropertyValue; onUnreadable?: (error: string | null) => void }) {
    const [value, setValue] = useState<PropertyValue>(initial);
    return (
      <>
        <PropertyValueInput property={property} value={value} onChange={setValue} onUnreadable={onUnreadable} projectId="p_web" hint="Optional." hideLabel />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }

  it('reports a typed value while one types, only when it can be read, and says when it cannot', async () => {
    const user = userEvent.setup();
    const unreadable: (string | null)[] = [];
    renderWith(<Form property={effort} onUnreadable={(error) => unreadable.push(error)} />);

    const input = screen.getByRole('textbox', { name: 'Aufwand (h)' });
    // the label only names the control: the grid around it shows it
    expect(document.querySelector('label')).toBeNull();
    await user.type(input, '2,5');
    expect(document.querySelector('output')!.textContent).toBe('2.5');
    await user.type(input, 'x');
    expect(document.querySelector('output')!.textContent).toBe('2.5');
    expect(unreadable.at(-1)).toBe('Nur eine Zahl eingeben, zum Beispiel 3,5');
    await user.keyboard('{Backspace}');
    expect(unreadable.at(-1)).toBeNull();
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Optional.');
  });

  it('lets a kept Enter go on to the form, and keeps a refused one in the field', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderWith(
      <form onSubmit={submit}>
        <Form property={effort} />
      </form>,
    );

    const input = screen.getByRole('textbox', { name: 'Aufwand (h)' });
    await user.type(input, 'drei{Enter}');
    expect(submit).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '3{Enter}');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- dates */

describe('DateField', () => {
  const today = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
  };

  it('marks an overdue day', async () => {
    today();
    const late = item({}, { due_date: '2026-10-28', start_date: '2026-10-20', state_id: 'std_progress' });
    renderWith(
      <>
        <DateField item={late} field="due_date" />
        <DateField item={late} field="start_date" />
        <DateField item={{ ...late, id: 'wi_done', state_id: 'std_done' }} field="due_date" look="chip" />
      </>,
    );

    const due = await screen.findByRole('button', { name: 'Due-Date: 28.10.2026, überfällig' });
    expect(within(due).getByText('überfällig')).toBeTruthy();
    expect(due.getAttribute('aria-keyshortcuts')).toBe('D');
    // the start is no deadline, and a done item is overdue no more
    expect(screen.getByRole('button', { name: 'Start-Date: 20.10.2026' }).textContent).toContain('vor 11 Tagen');
    const done = screen.getByRole('button', { name: 'Due-Date: 28.10.2026' });
    expect(done.textContent).toBe('28.10.');
    expect(done.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('sets a day, removes it, and says when there is none', async () => {
    // the calendar opens on the month of today
    today();
    const user = userEvent.setup();
    renderWith(<Live>{(entry) => <DateField item={entry} field="due_date" />}</Live>);

    const trigger = await writable('Due-Date: nicht gesetzt');
    expect(trigger.textContent).toBe('Kein Due-Date');
    await user.click(trigger);
    await user.click(day('2026-11-04'));
    await waitFor(() => expect(patches()).toEqual([{ due_date: '2026-11-04' }]));
    await waitFor(() => expect(trigger.getAttribute('aria-label')).toMatch(/^Due-Date: 04.11.2026/));
    // the same day again changes nothing
    await user.click(trigger);
    await user.click(day('2026-11-04'));
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(patches()).toEqual([{ due_date: '2026-11-04' }, { due_date: null }]));
  });

  it('refuses a start after the due date at the field', async () => {
    // on the due date itself, so it does not read as overdue
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
    const user = userEvent.setup();
    const dated = item({}, { start_date: '2026-10-27', due_date: '2026-10-31' });
    renderWith(
      <>
        <DateField item={dated} field="start_date" />
        <DateField item={dated} field="due_date" />
      </>,
      // someone moved the due date meanwhile: the server names it at `due_date`, though only the start was sent
      { 'PATCH /api/v1/work-items/wi_web_47': () => invalid({ due_date: ['Das Start-Date liegt nach dem Due-Date.'] }) },
    );

    const start = await writable('Start-Date: 27.10.2026');
    expect(start.getAttribute('aria-keyshortcuts')).toBe('Shift+D');
    await user.click(start);
    // a day after the due date is refused in the calendar, which stays open
    await user.click(day('2026-11-03'));
    expect(await screen.findByText('Der Start liegt nach dem Due-Date (31.10.2026). Wähle einen Tag bis dahin oder verschiebe zuerst das Due-Date.')).toBeTruthy();
    expect(patches()).toEqual([]);

    await user.click(day('2026-10-29'));
    await waitFor(() => expect(patches()).toEqual([{ start_date: '2026-10-29' }]));
    expect(await screen.findByText('Das Start-Date liegt nach dem Due-Date.')).toBeTruthy();
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(start.getAttribute('aria-describedby')!)!.textContent).toBe('Das Start-Date liegt nach dem Due-Date.');
    await waitFor(() => expect(document.activeElement).toBe(start));
    expect(toastTitles()).toContain('Änderung nicht gespeichert');

    // the due date before the start is refused in its calendar as well
    await user.click(screen.getByRole('button', { name: 'Due-Date: 31.10.2026' }));
    await user.click(day('2026-10-26'));
    expect(await screen.findByText('Das Due-Date liegt vor dem Start (27.10.2026). Wähle einen Tag ab dann oder verschiebe zuerst den Start.')).toBeTruthy();
  });

  it('leaves a refusal of the server without a date to the toast', async () => {
    today();
    const user = userEvent.setup();
    renderWith(<DateField item={item()} field="due_date" />, {
      'PATCH /api/v1/work-items/wi_web_47': () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' }),
    });

    const trigger = await writable(/^Due-Date/);
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: /heute$/ }));
    await waitFor(() => expect(toastTitles()).toContain('Änderung nicht gespeichert'));
    expect(trigger.hasAttribute('aria-invalid')).toBe(false);
  });

  it('is read-only with the reason, and a calendar that starts open leaves the focus where it is', async () => {
    // on the due date of WEB-47, so it does not read as overdue
    today();
    signedIn = theo;
    renderWith(<DateField item={web47} field="due_date" />, {}, { projects: [project('WEB', 'viewer')] });
    const value = await screen.findByRole('button', { name: 'Due-Date: 31.10.2026' });
    await waitFor(() => expect(value.getAttribute('aria-disabled')).toBe('true'));

    const before = document.activeElement;
    function Open() {
      const { today: now } = useToday();
      const [open, setOpen] = useState(true);
      return (
        <DatePopover
          label="Termin"
          value={null}
          onChoose={() => undefined}
          display={<DayValue value={null} today={now} overdue={false} empty="Kein Termin" />}
          displayText="nicht gesetzt"
          look="form"
          defaultOpen
          open={open}
          onOpenChange={setOpen}
        />
      );
    }
    renderWith(<Open />);
    expect(await screen.findByRole('grid', { name: /^Termin/ })).toBeTruthy();
    expect(document.activeElement).toBe(before);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
  });

  it('keeps the focus on the trigger when the rights arrive or go, also from an open calendar', async () => {
    const user = userEvent.setup();
    function Dated({ reason }: { reason?: string }) {
      const { today: now } = useToday();
      return (
        <DatePopover
          label="Termin"
          value={null}
          onChoose={() => undefined}
          display={<DayValue value={null} today={now} overdue={false} empty="Kein Termin" />}
          displayText="nicht gesetzt"
          disabledReason={reason}
        />
      );
    }
    const view = renderWith(<Dated reason="Rechte laden noch." />);
    const readOnly = screen.getByRole('button', { name: 'Termin: nicht gesetzt' });
    act(() => readOnly.focus());

    // the rights arrive: the calendar's trigger takes the focus over
    view.rerender(<Dated />);
    const trigger = screen.getByRole('button', { name: 'Termin: nicht gesetzt' });
    expect(trigger).not.toBe(readOnly);
    expect(trigger.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // they go while the calendar is open: the focus lands on the read-only trigger
    await user.click(trigger);
    const day = await screen.findByRole('grid', { name: /^Termin/ });
    await waitFor(() => expect(day.contains(document.activeElement)).toBe(true));
    view.rerender(<Dated reason="Im Projekt darfst du nur lesen." />);
    const back = screen.getByRole('button', { name: 'Termin: nicht gesetzt' });
    expect(back.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(back);

    // a trigger that never had the focus does not take it
    act(() => back.blur());
    view.rerender(<Dated />);
    expect(document.activeElement).toBe(document.body);
  });

  it('knows overdue items, as the filter does', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
    const seen: boolean[] = [];
    function Probe({ entry }: { entry: WorkItem }) {
      seen.push(useOverdue(entry));
      return null;
    }
    renderWith(<Probe entry={item({}, { due_date: null })} />);
    expect(seen.at(-1)).toBe(false);
  });

  it('reads overdue against today in the time zone of the organisation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 UTC: already the 31st in Berlin, still the 30th in New York
    vi.setSystemTime(new Date('2026-10-30T23:30:00.000Z'));
    const due = item({}, { due_date: '2026-10-30', state_id: 'std_progress' });

    const first = renderWith(<DateField item={due} field="due_date" />);
    expect(await screen.findByRole('button', { name: 'Due-Date: 30.10.2026, überfällig' })).toBeTruthy();
    first.unmount();

    org = { ...organization, timezone: 'America/New_York' };
    renderWith(<DateField item={due} field="due_date" />);
    expect(await screen.findByRole('button', { name: 'Due-Date: 30.10.2026' })).toBeTruthy();
  });
});
