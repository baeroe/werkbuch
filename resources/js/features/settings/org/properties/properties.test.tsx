/*
 * Properties against a fake REST API (`mockApi`): the list, the dialog (key from the label, options, settings and the
 * default value of every field type) and the refusals Playwright does not reach sensibly (422 at their fields, failed
 * deletes, load failures). The flows run in e2e/tests/types-properties.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, properties, types } from '@/test/fixtures';
import type { Property, PropertyValue } from '@/types';
import { DefaultValueField, type DefaultFor } from './DefaultValueField';
import Properties from './Properties';

let api: MockApi | undefined;

function renderWith(node: ReactNode, routes: Record<string, MockRoute>) {
  api = mockApi(routes);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', { detail: 'Die Eingaben sind nicht gültig.', errors });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/** Lets every answer take a moment, as a real one does (the dialog moves the focus to a refused field once it saw the call run). */
function answerSlowly() {
  const answer = globalThis.fetch;
  globalThis.fetch = (...args: Parameters<typeof fetch>) => new Promise((done) => setTimeout(done, 10)).then(() => answer(...args));
}

const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const callsTo = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.startsWith(path));
const rowOf = async (name: string) => (await screen.findByRole('heading', { name })).closest('li')!;
const MEMBER = 'Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.';

const reviewer: Property = { id: 'pr_reviewer', key: 'reviewer', label: 'Reviewer', field_type: 'member', help: '', default_value: null, settings: { multiple: true }, options: [] };
const all = [...properties, reviewer];

const routes = (props: Property[] = all, overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> => ({
  'GET /api/v1/properties': () => ({ body: list(props) }),
  'GET /api/v1/work-item-types': () => ({ body: list(types) }),
  'POST /api/v1/properties': (body) => ({ status: 201, body: { data: { id: 'pr_new', ...(body as object) } } }),
  ...overrides,
});

/** Opens "Property anlegen" and answers the dialog. */
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Property anlegen' }));
  return screen.findByRole('dialog', { name: 'Property anlegen' });
}

async function chooseFieldType(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string) {
  await user.click(within(dialog).getByRole('combobox', { name: /^Feldtyp/ }));
  await user.click(await screen.findByRole('option', { name }));
}

/** jsdom has no layout: every row is 40 px high and below the one before, which is all dnd-kit's keyboard needs. */
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = Array.from(document.querySelectorAll('li'));
    const top = Math.max(rows.indexOf(this as HTMLLIElement), 0) * 40;
    return { x: 0, y: top, top, left: 0, right: 200, bottom: top + 40, width: 200, height: 40, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api?.restore();
  api = undefined;
  act(() => resetToasts());
});

/* -------------------------------------------------------------------------- list */

describe('Properties', () => {
  it('lists the properties with field type, key, options and the types that use them', async () => {
    const archivedOption = { id: 'opt_old', label: 'Altkunde', color: 'sand' as const, position: 3, archived_at: '2026-10-01T08:00:00.000Z' };
    renderWith(<Properties readOnlyReason={null} />, routes([{ ...properties[0]!, options: [...properties[0]!.options, archivedOption] }, ...properties.slice(1), reviewer]));

    const customer = await rowOf('Kunde');
    expect(within(customer).getByText('customer').getAttribute('translate')).toBe('no');
    expect(within(customer).getByText('Dropdown')).toBeTruthy();
    expect(within(customer).getByText('Für wen das Item gemacht wird.')).toBeTruthy();
    expect(within(customer).getByText('Genutzt in Task, Bug, Epic, Kundenwunsch')).toBeTruthy();
    // the options as chips, in their order; archived ones are no longer offered
    expect(within(within(customer).getByRole('list', { name: 'Optionen von Kunde' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Studio Nordlicht',
      'Hafenkontor',
      'Gärtnerei Moos',
    ]);
    const people = await rowOf('Reviewer');
    expect(within(people).getByText('Personenauswahl')).toBeTruthy();
    expect(within(people).getByText('Mehrfachauswahl')).toBeTruthy();
    expect(within(people).getByText('In keinem Typ')).toBeTruthy();
    expect(within(people).queryByRole('list')).toBeNull();
    // no count of items yet: that comes with the items
    expect(screen.queryByText(/einen Wert/)).toBeNull();
  });

  it('says when the properties could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'GET /api/v1/properties': () => (fail ? unavailable() : { body: list(all) }) }));

    expect(await screen.findByText('Die Properties konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await rowOf('Kunde')).toBeTruthy();
  });

  it('offers the first property in the empty state, and shows a member the list without buttons', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWith(<Properties readOnlyReason={null} />, routes([]));

    expect(await screen.findByText('Noch keine Properties')).toBeTruthy();
    const [, empty] = screen.getAllByRole('button', { name: 'Property anlegen' });
    await user.click(empty!);
    expect(await screen.findByRole('dialog', { name: 'Property anlegen' })).toBeTruthy();
    unmount();
    api!.restore();

    renderWith(<Properties readOnlyReason={MEMBER} />, routes([]));
    expect(await screen.findByText('Noch keine Properties')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a member the properties without any way to change them', async () => {
    renderWith(<Properties readOnlyReason={MEMBER} />, routes());

    expect(await rowOf('Kunde')).toBeTruthy();
    expect(screen.getByText(MEMBER)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  /* ------------------------------------------------------------------------ delete */

  it('deletes a property only after the question, keeps it on "Abbrechen", and moves the focus on', async () => {
    const user = userEvent.setup();
    let shown = all;
    renderWith(
      <Properties readOnlyReason={null} />,
      routes(all, {
        'GET /api/v1/properties': () => ({ body: list(shown) }),
        'DELETE /api/v1/properties/pr_effort': () => {
          shown = shown.filter((property) => property.id !== 'pr_effort');
          return { body: { affected_items: 0 } };
        },
      }),
    );

    const remove = within(await rowOf('Aufwand (h)')).getByRole('button', { name: 'Property „Aufwand (h)“ löschen' });
    await user.click(remove);
    let question = await screen.findByRole('alertdialog', { name: 'Property „Aufwand (h)“ löschen?' });
    expect(within(question).getByText('Die Werte der Items verschwinden. Die History behält sie. Aus Typen, Views und Vorlagen verschwindet die Property auch.')).toBeTruthy();
    await user.click(within(question).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(callsTo('DELETE', '/api/v1/properties')).toHaveLength(0);
    expect(await rowOf('Aufwand (h)')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(remove));

    await user.click(remove);
    question = await screen.findByRole('alertdialog', { name: 'Property „Aufwand (h)“ löschen?' });
    await user.click(within(question).getByRole('button', { name: 'Property löschen' }));
    await waitFor(() => expect(toastNamed('Property „Aufwand (h)“ gelöscht')).toBeDefined());
    expect(screen.queryByRole('heading', { name: 'Aufwand (h)' })).toBeNull();
    // the focus went on to the next row
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Property „Umgebung“ bearbeiten' })));
  });

  it('puts the focus on "Property anlegen" once the last property is gone, and says when a delete failed', async () => {
    const user = userEvent.setup();
    let shown = [reviewer];
    let fail = true;
    renderWith(
      <Properties readOnlyReason={null} />,
      routes(all, {
        'GET /api/v1/properties': () => ({ body: list(shown) }),
        'DELETE /api/v1/properties/pr_reviewer': () => {
          if (fail) return unavailable();
          shown = [];
          return { body: { affected_items: 0 } };
        },
      }),
    );

    await user.click(within(await rowOf('Reviewer')).getByRole('button', { name: 'Property „Reviewer“ löschen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Property löschen' }));
    await waitFor(() => expect(toastNamed('Property „Reviewer“ nicht gelöscht')?.description).toBe('Der Server ist gerade nicht erreichbar.'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await rowOf('Reviewer')).toBeTruthy();

    fail = false;
    act(() => toastNamed('Property „Reviewer“ nicht gelöscht')!.action!.onClick());
    await waitFor(() => expect(toastNamed('Property „Reviewer“ gelöscht')).toBeDefined());
    expect(await screen.findByText('Noch keine Properties')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Property anlegen' })[0]);
  });

  /* ------------------------------------------------------------------------ dialog */

  it('lets the key follow the label until somebody types one', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes());

    const dialog = await openCreate(user);
    const label = within(dialog).getByRole('textbox', { name: 'Label' });
    const key = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Schlüssel' });
    expect(within(dialog).getByText('Kleinbuchstaben, Ziffern und _. So heißt die Property in API und MCP, und das für immer.')).toBeTruthy();
    await user.type(label, 'Prüfstufe (intern)');
    expect(key.value).toBe('pruefstufe_intern');

    await user.clear(key);
    await user.type(key, 'stufe');
    await user.type(label, ' neu');
    expect(key.value).toBe('stufe');

    // label and key are needed; the focus goes to the first missing one
    await user.clear(label);
    await user.clear(key);
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(within(dialog).getByText('Gib der Property ein Label.')).toBeTruthy();
    expect(within(dialog).getByText('Gib einen Schlüssel ein.')).toBeTruthy();
    expect(document.activeElement).toBe(label);
    await user.type(label, 'Notiz');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(document.activeElement).toBe(key);
    expect(callsTo('POST', '/api/v1/properties')).toHaveLength(0);
  });

  it('shows the refusal of a core key at the key, with the focus there, and one without a field on top', async () => {
    const user = userEvent.setup();
    let refusal = invalid({ key: ['Der Schlüssel gehört einem Kernfeld.'] });
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'POST /api/v1/properties': () => refusal }));
    answerSlowly();

    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Title');
    await user.type(within(dialog).getByRole('textbox', { name: 'Hilfetext' }), '  Der Titel.  ');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    const key = within(dialog).getByRole('textbox', { name: 'Schlüssel' });
    expect(await within(dialog).findByText('Der Schlüssel gehört einem Kernfeld.')).toBeTruthy();
    expect(key.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(key));
    expect(callsTo('POST', '/api/v1/properties')[0]!.body).toEqual({
      key: 'title',
      label: 'Title',
      field_type: 'text',
      help: 'Der Titel.',
      default_value: null,
      settings: {},
      options: [],
    });

    refusal = invalid({ help: ['Höchstens 500 Zeichen.'], settings: ['Diese Einstellung gibt es für diesen Feldtyp nicht.'] });
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Höchstens 500 Zeichen.')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain('Diese Einstellung gibt es für diesen Feldtyp nicht.');
  });

  it('creates a dropdown with two new options and the second as default: the body names its local id', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes());

    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Phase');
    await chooseFieldType(user, dialog, 'Dropdown');

    // a dropdown needs an option: the focus goes to "Option hinzufügen"
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(within(dialog).getByText('Ein Dropdown braucht mindestens eine Option.')).toBeTruthy();
    const add = within(dialog).getByRole('button', { name: 'Option hinzufügen' });
    expect(document.activeElement).toBe(add);

    await user.click(add);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Label von Option 1' })));
    await user.keyboard('Entwurf');
    await user.click(add);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Label von Option 2' })));
    await user.keyboard('Geprüft');
    expect(within(dialog).queryByText('Ein Dropdown braucht mindestens eine Option.')).toBeNull();
    // the second option gets the next tone, and another one from its menu
    await user.click(within(dialog).getByRole('button', { name: 'Farbe von Geprüft: Ocker' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Moos' }));
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Farbe von Geprüft: Moos' })).toBeTruthy();

    await user.click(within(dialog).getByRole('combobox', { name: /^Standardwert/ }));
    await user.click(await screen.findByRole('option', { name: 'Geprüft' }));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(toastNamed('Property „Phase“ ist angelegt')).toBeDefined());
    const body = callsTo('POST', '/api/v1/properties')[0]!.body as { default_value: string; options: { id: string; label: string; color: string; archived_at: null }[]; settings: object };
    expect(body.options.map(({ label, color, archived_at }) => [label, color, archived_at])).toEqual([
      ['Entwurf', 'sky', null],
      ['Geprüft', 'moss', null],
    ]);
    expect(body.options[1]!.id).toMatch(/^opt_/);
    expect(body.default_value).toBe(body.options[1]!.id);
    expect(body.settings).toEqual({ multiple: false });
  });

  it('removes a new option with the focus going on, shows a refused option label at its row, and takes back a default of a removed option', async () => {
    const user = userEvent.setup();
    let refuse = true;
    renderWith(
      <Properties readOnlyReason={null} />,
      routes(all, { 'POST /api/v1/properties': (body) => (refuse ? invalid({ 'options.1.label': ['Jede Option braucht ein Label.'] }) : { status: 201, body: { data: { id: 'pr_new', ...(body as object) } } }) }),
    );
    answerSlowly();

    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Stufe');
    await chooseFieldType(user, dialog, 'Dropdown');
    const add = within(dialog).getByRole('button', { name: 'Option hinzufügen' });
    await user.click(add);
    await user.keyboard('Eins');
    await user.click(add);
    await user.click(add);
    await user.keyboard('Drei');

    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    const second = within(dialog).getByRole('textbox', { name: 'Label von Option 2' });
    expect(await within(dialog).findByText('Jede Option braucht ein Label.')).toBeTruthy();
    expect(second.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(second));
    // a row without a label is named by its place
    expect(within(dialog).getByRole('button', { name: 'Farbe von Option 2: Ocker' })).toBeTruthy();

    // the empty option goes; the focus moves on to the next one
    await user.click(within(dialog).getByRole('button', { name: 'Option 2 entfernen' }));
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Drei verschieben' })));

    // "Drei" becomes the default, then goes: the default goes with it
    await user.click(within(dialog).getByRole('combobox', { name: /^Standardwert/ }));
    await user.click(await screen.findByRole('option', { name: 'Drei' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option 2 entfernen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option 1 entfernen' }));
    // the last one is gone: on to "Option hinzufügen"
    await waitFor(() => expect(document.activeElement).toBe(add));
    await user.click(add);
    await user.keyboard('Vier');

    refuse = false;
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Property „Stufe“ ist angelegt')).toBeDefined());
    const body = callsTo('POST', '/api/v1/properties').at(-1)!.body as { default_value: unknown; options: { label: string }[] };
    expect(body.options.map((option) => option.label)).toEqual(['Vier']);
    expect(body.default_value).toBeNull();
  });

  it('archives a stored option and brings it back, sends every option with its stamp, and drops a default that is archived', async () => {
    const user = userEvent.setup();
    const customer = { ...properties[0]!, default_value: 'opt_hafenkontor', settings: { multiple: false } };
    renderWith(<Properties readOnlyReason={null} />, routes([customer], { 'PUT /api/v1/properties/pr_customer': (body) => ({ body: { data: { ...customer, ...(body as object) } } }) }));

    await user.click(within(await rowOf('Kunde')).getByRole('button', { name: 'Property „Kunde“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Property „Kunde“ bearbeiten' });
    // key and field type are fixed
    const key = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Schlüssel' });
    expect(key.readOnly).toBe(true);
    expect(within(dialog).getByText('Der Schlüssel lässt sich nach dem Anlegen nicht mehr ändern.')).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: /^Feldtyp/ })).toBeNull();
    expect(within(dialog).getByText('Auch der Feldtyp ist fest, nur von Einfach- auf Mehrfachauswahl lässt sich wechseln.')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: /^Standardwert/ }).textContent).toContain('Hafenkontor');

    // a stored option is archived, not removed
    expect(within(dialog).queryByRole('button', { name: /entfernen$/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Option „Gärtnerei Moos“ archivieren' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option „Gärtnerei Moos“ wiederherstellen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option „Hafenkontor“ archivieren' }));
    expect(within(within(dialog).getByRole('list', { name: 'Optionen' })).getByText('Archiviert')).toBeTruthy();
    // the archived option is no longer offered as default
    expect(within(dialog).getByRole('combobox', { name: /^Standardwert/ }).textContent).toContain('Kein Standardwert');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(toastNamed('Property „Kunde“ gespeichert')).toBeDefined());
    const body = callsTo('PUT', '/api/v1/properties/pr_customer')[0]!.body as { key: string; field_type: string; default_value: unknown; options: { id: string; archived_at: string | null }[] };
    expect([body.key, body.field_type, body.default_value]).toEqual(['customer', 'dropdown', null]);
    expect(body.options.map((option) => [option.id, option.archived_at !== null])).toEqual([
      ['opt_nordlicht', false],
      ['opt_hafenkontor', true],
      ['opt_moos', false],
    ]);
  });

  it('switches a dropdown to multiple choice and keeps its default as a list; a stored multiple choice stays', async () => {
    const user = userEvent.setup();
    const customer = { ...properties[0]!, default_value: 'opt_moos', settings: { multiple: false } };
    renderWith(<Properties readOnlyReason={null} />, routes([customer, { ...properties[2]!, settings: { multiple: true } }]));

    await user.click(within(await rowOf('Kunde')).getByRole('button', { name: 'Property „Kunde“ bearbeiten' }));
    let dialog = await screen.findByRole('dialog', { name: 'Property „Kunde“ bearbeiten' });
    expect(within(dialog).getByText('Mehrere Optionen pro Item. Einmal eingeschaltet, lässt es sich nicht zurücknehmen.')).toBeTruthy();
    await user.click(within(dialog).getByRole('switch', { name: 'Mehrfachauswahl' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Gärtnerei Moos' }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(within(await rowOf('Umgebung')).getByRole('button', { name: 'Property „Umgebung“ bearbeiten' }));
    dialog = await screen.findByRole('dialog', { name: 'Property „Umgebung“ bearbeiten' });
    expect(within(dialog).getByRole('switch', { name: 'Mehrfachauswahl' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Von Mehrfach- auf Einfachauswahl lässt sich nicht zurückwechseln.')).toBeTruthy();
  });

  it('turns a multiple choice back into a single one before it is saved, keeping the first option', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes());

    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Kanal');
    await chooseFieldType(user, dialog, 'Dropdown');
    const add = within(dialog).getByRole('button', { name: 'Option hinzufügen' });
    await user.click(add);
    await user.keyboard('Mail');
    await user.click(add);
    await user.keyboard('Telefon');
    const multiple = within(dialog).getByRole('switch', { name: 'Mehrfachauswahl' });
    await user.click(multiple);
    await user.click(within(dialog).getByRole('checkbox', { name: 'Telefon' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Mail' }));
    await user.click(multiple);
    expect(within(dialog).getByRole('combobox', { name: /^Standardwert/ }).textContent).toContain('Mail');
    await user.click(multiple);
    await user.click(within(dialog).getByRole('checkbox', { name: 'Mail' }));
    await user.click(multiple);
    expect(within(dialog).getByRole('combobox', { name: /^Standardwert/ }).textContent).toContain('Kein Standardwert');
  });

  it('clears the default when the field type changes, and has decimals for a number', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes());

    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Aufwand');
    expect(within(dialog).getByText('Eine Zeile, bis 255 Zeichen.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: /^Standardwert/ }), 'viel');
    await chooseFieldType(user, dialog, 'Zahl');
    expect(within(dialog).getByText('Eine Dezimalzahl mit 0 bis 4 Nachkommastellen.')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: /^Standardwert/ }).value).toBe('');

    await user.click(within(dialog).getByRole('combobox', { name: /^Nachkommastellen/ }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Keine (ganze Zahlen)',
      '1 Nachkommastelle',
      '2 Nachkommastellen',
      '3 Nachkommastellen',
      '4 Nachkommastellen',
    ]);
    await user.click(screen.getByRole('option', { name: '2 Nachkommastellen' }));
    await user.type(within(dialog).getByRole('textbox', { name: /^Standardwert/ }), '2,25');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(toastNamed('Property „Aufwand“ ist angelegt')).toBeDefined());
    expect(callsTo('POST', '/api/v1/properties')[0]!.body).toMatchObject({ field_type: 'number', settings: { decimals: 2 }, default_value: 2.25, options: [] });
  });

  it('has no default for a choice of people and says so, but multiple choice', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes());

    const dialog = await openCreate(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Prüfer');
    await chooseFieldType(user, dialog, 'Personenauswahl');
    expect(within(dialog).getByText('Für Personenauswahl gibt es keinen Standardwert. Das Feld beginnt leer.')).toBeTruthy();
    expect(within(dialog).queryByRole('textbox', { name: /^Standardwert/ })).toBeNull();
    expect(within(dialog).getByText('Mehrere Personen pro Item. Einmal eingeschaltet, lässt es sich nicht zurücknehmen.')).toBeTruthy();
    await user.click(within(dialog).getByRole('switch', { name: 'Mehrfachauswahl' }));
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(toastNamed('Property „Prüfer“ ist angelegt')).toBeDefined());
    expect(callsTo('POST', '/api/v1/properties')[0]!.body).toMatchObject({ key: 'pruefer', field_type: 'member', settings: { multiple: true }, default_value: null, options: [] });
  });

  it('shows a refusal of the default at the default, and keeps a stored number default in the language of the page', async () => {
    const user = userEvent.setup();
    const effort = { ...properties[1]!, default_value: 3.5 };
    renderWith(<Properties readOnlyReason={null} />, routes([effort], { 'PUT /api/v1/properties/pr_effort': () => invalid({ default_value: ['Der Standardwert muss eine Zahl sein.'] }) }));
    answerSlowly();

    const edit = within(await rowOf('Aufwand (h)')).getByRole('button', { name: 'Property „Aufwand (h)“ bearbeiten' });
    await user.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Property „Aufwand (h)“ bearbeiten' });
    expect(within(dialog).getByText('Auch der Feldtyp ist fest.')).toBeTruthy();
    const value = within(dialog).getByRole<HTMLInputElement>('textbox', { name: /^Standardwert/ });
    expect(value.value).toBe('3,5');
    await user.clear(value);
    await user.type(value, 'drei');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await within(dialog).findByText('Der Standardwert muss eine Zahl sein.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(value));
    expect(callsTo('PUT', '/api/v1/properties/pr_effort')[0]!.body).toMatchObject({ default_value: 'drei', settings: { decimals: 1 } });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });
});

/* ---------------------------------------------------------------- default values */

describe('DefaultValueField', () => {
  const field = (field_type: DefaultFor['field_type'], extra: Partial<DefaultFor> = {}): DefaultFor => ({ field_type, settings: {}, options: [], ...extra });
  const options = [
    { id: 'o_a', label: 'Alpha', color: 'sky' as const, position: 0, archived_at: null },
    { id: 'o_b', label: '', color: 'moss' as const, position: 1, archived_at: null },
    { id: 'o_c', label: 'Gamma', color: 'plum' as const, position: 2, archived_at: null },
    { id: 'o_old', label: 'Alt', color: 'sand' as const, position: 3, archived_at: '2026-10-01T08:00:00.000Z' },
  ];

  function renderField(property: DefaultFor, initial: PropertyValue = null) {
    const seen: PropertyValue[] = [];
    function Harness() {
      const [value, setValue] = useState<PropertyValue>(initial);
      return (
        <DefaultValueField
          property={property}
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Harness />);
    return seen;
  }

  it('takes a text trimmed, and a blank as none', async () => {
    const user = userEvent.setup();
    const seen = renderField(field('text'));
    const input = screen.getByRole('textbox', { name: /^Standardwert/ });
    expect(screen.getByText('Optional. Neue Items starten mit diesem Wert.')).toBeTruthy();
    await user.type(input, '  Studio  ');
    expect(seen.at(-1)).toBe('Studio');
    await user.clear(input);
    expect(seen.at(-1)).toBeNull();
  });

  it('takes an address as it is, trimmed', async () => {
    const user = userEvent.setup();
    const seen = renderField(field('url'));
    const input = screen.getByRole('textbox', { name: /^Standardwert/ });
    expect(input.getAttribute('type')).toBe('url');
    expect(input.getAttribute('inputmode')).toBe('url');
    await user.type(input, ' https://example.com/a ');
    expect(seen.at(-1)).toBe('https://example.com/a');
  });

  it('takes a number with a comma or a point, a blank as none, and leaves the rest to the server', async () => {
    const user = userEvent.setup();
    const seen = renderField(field('number', { settings: { decimals: 1 } }));
    const input = screen.getByRole('textbox', { name: /^Standardwert/ });
    expect(input.getAttribute('inputmode')).toBe('decimal');
    await user.type(input, '3,5');
    expect(seen.at(-1)).toBe(3.5);
    await user.clear(input);
    await user.type(input, '-0.500');
    expect(seen.at(-1)).toBe(-0.5);
    await user.clear(input);
    expect(seen.at(-1)).toBeNull();
    await user.type(input, '1.000,5');
    expect(seen.at(-1)).toBe('1.000,5');
  });

  it('offers the active options of a single dropdown and "Kein Standardwert"', async () => {
    const user = userEvent.setup();
    const seen = renderField(field('dropdown', { options }), 'o_c');
    const select = screen.getByRole('combobox', { name: /^Standardwert/ });
    expect(select.textContent).toContain('Gamma');
    await user.click(select);
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Kein Standardwert', 'Alpha', 'Ohne Label', 'Gamma']);
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(seen.at(-1)).toBe('o_a');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Kein Standardwert' }));
    expect(seen.at(-1)).toBeNull();
  });

  it('ticks the options of a multiple dropdown into a list in their order, and none is no default', async () => {
    const user = userEvent.setup();
    const seen = renderField(field('dropdown', { settings: { multiple: true }, options }));
    expect(screen.queryByRole('checkbox', { name: 'Alt' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Gamma' }));
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(seen.at(-1)).toEqual(['o_a', 'o_c']);
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await user.click(screen.getByRole('checkbox', { name: 'Gamma' }));
    expect(seen.at(-1)).toBeNull();
  });

  it('asks for options first when a multiple dropdown has none', () => {
    renderField(field('dropdown', { settings: { multiple: true } }));
    expect(screen.getByText('Lege zuerst Optionen an.')).toBeTruthy();
  });

  it('switches yes or no', async () => {
    const user = userEvent.setup();
    const seen = renderField(field('boolean'));
    const toggle = screen.getByRole('switch', { name: 'Standardwert' });
    expect(screen.getByText('Nein')).toBeTruthy();
    await user.click(toggle);
    expect(seen.at(-1)).toBe(true);
    expect(screen.getByText('Ja')).toBeTruthy();
    await user.click(toggle);
    expect(seen.at(-1)).toBe(false);
  });

  it('takes a day, and an empty field as none', () => {
    const seen = renderField(field('date'), '2026-01-02');
    const input = screen.getByLabelText(/^Standardwert/) as HTMLInputElement;
    expect([input.type, input.value]).toEqual(['date', '2026-01-02']);
    fireEvent.change(input, { target: { value: '2026-10-31' } });
    expect(seen.at(-1)).toBe('2026-10-31');
    fireEvent.change(input, { target: { value: '' } });
    expect(seen.at(-1)).toBeNull();
  });

  it('marks a refusal at the control', () => {
    render(<DefaultValueField property={field('boolean')} value={null} onChange={() => {}} error="Der Standardwert ist Ja oder Nein." />);
    expect(screen.getByText('Der Standardwert ist Ja oder Nein.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Standardwert' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('marks the first option of a multiple dropdown at a refusal', () => {
    render(<DefaultValueField property={field('dropdown', { settings: { multiple: true }, options })} value={null} onChange={() => {}} error="Diese Auswahl gibt es nicht." />);
    expect(screen.getByRole('checkbox', { name: 'Alpha' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Gamma' }).hasAttribute('aria-invalid')).toBe(false);
  });
});
