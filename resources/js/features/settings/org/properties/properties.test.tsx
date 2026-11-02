/*
 * Properties against a fake REST API (`mockApi`): the list, the dialog (key from the label, options, settings and the
 * default value of every field type, edited with the item editors of `PropertyValueInput`) and the refusals Playwright
 * does not reach sensibly (422 at their fields, failed deletes, load failures). The flows run in
 * e2e/tests/types-properties.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { lene, list, organization, properties, types } from '@/test/fixtures';
import type { Property } from '@/types';
import Properties from './Properties';

// the date of a default is picked in the calendar of the item fields, which counts days in the organisation's zone
vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: '/settings/properties' }),
}));

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
    // no item had a value: nothing to count
    expect(toastNamed('Property „Aufwand (h)“ gelöscht')!.description).toBeUndefined();
    expect(screen.queryByRole('heading', { name: 'Aufwand (h)' })).toBeNull();
    // the focus went on to the next row
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Property „Umgebung“ bearbeiten' })));
  });

  it('names how many items lost their value with a deleted property', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'DELETE /api/v1/properties/pr_effort': () => ({ body: { affected_items: 2 } }) }));

    await user.click(within(await rowOf('Aufwand (h)')).getByRole('button', { name: 'Property „Aufwand (h)“ löschen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Property löschen' }));
    await waitFor(() => expect(toastNamed('Property „Aufwand (h)“ gelöscht')?.description).toBe('Die Werte bei 2 Items sind weg, die History behält sie.'));
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

  it('keeps a refusal of an option label with its option when the options are reordered or one is removed', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'POST /api/v1/properties': () => invalid({ 'options.1.label': ['Jede Option braucht ein Label.'] }) }));
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
    expect(await within(dialog).findByText('Jede Option braucht ein Label.')).toBeTruthy();
    const invalidLabels = () => within(dialog).getAllByRole('textbox', { name: /^Label von Option/ }).filter((input) => input.getAttribute('aria-invalid') === 'true');
    // the dialog puts the focus on the refused label first; only then does the keyboard move on
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Label von Option 2' })));

    // "Drei" moves to the top: the refusal stays at the empty option, now third (the place it had is "Eins" now)
    const handle = within(dialog).getByRole('button', { name: 'Drei verschieben' });
    handle.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(handle.getAttribute('aria-pressed')).toBe('true'));
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    await waitFor(() => expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Label von Option 1' }).value).toBe('Drei'));
    expect(invalidLabels().map((input) => (input as HTMLInputElement).value)).toEqual(['']);
    expect(invalidLabels()[0]!.getAttribute('aria-label')).toBe('Label von Option 3');

    // "Eins" goes: the refusal still stands at the empty option, now second
    await user.click(within(dialog).getByRole('button', { name: 'Option 2 entfernen' }));
    expect(invalidLabels().map((input) => input.getAttribute('aria-label'))).toEqual(['Label von Option 2']);
    // the empty option goes: the refusal goes with it and moves to no other row
    await user.click(within(dialog).getByRole('button', { name: 'Option 2 entfernen' }));
    expect(invalidLabels()).toEqual([]);
    expect(within(dialog).queryByText('Jede Option braucht ein Label.')).toBeNull();
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

    // a stored option can be archived (removing it is the other way, see below)
    await user.click(within(dialog).getByRole('button', { name: 'Option „Gärtnerei Moos“ archivieren' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option „Gärtnerei Moos“ wiederherstellen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option „Hafenkontor“ archivieren' }));
    expect(within(within(dialog).getByRole('list', { name: 'Optionen' })).getByText('Archiviert')).toBeTruthy();
    // the archived option is no longer offered as default
    expect(within(dialog).getByRole('combobox', { name: /^Standardwert/ }).textContent).toBe('Option wählen …');
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

  it('removes stored options, and says which one comes back archived because items carry it', async () => {
    const user = userEvent.setup();
    const customer = { ...properties[0]!, default_value: null, settings: { multiple: false } };
    let answer: 'one' | 'two' = 'one';
    renderWith(
      <Properties readOnlyReason={null} />,
      routes([customer], {
        'PUT /api/v1/properties/pr_customer': () => {
          // the server deletes what no item carries and archives the rest
          const archived = (id: string) => ({ ...customer.options.find((option) => option.id === id)!, archived_at: '2026-11-01T09:00:00.000Z' });
          const options = answer === 'one' ? [customer.options[0]!, archived('opt_hafenkontor')] : [customer.options[0]!, archived('opt_hafenkontor'), archived('opt_moos')];
          return { body: { data: { ...customer, options } } };
        },
      }),
    );

    await user.click(within(await rowOf('Kunde')).getByRole('button', { name: 'Property „Kunde“ bearbeiten' }));
    let dialog = await screen.findByRole('dialog', { name: 'Property „Kunde“ bearbeiten' });
    // a stored option can go as well
    await user.click(within(dialog).getByRole('button', { name: 'Option „Gärtnerei Moos“ entfernen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option „Hafenkontor“ entfernen' }));
    expect(within(within(dialog).getByRole('list', { name: 'Optionen' })).getAllByRole('listitem')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(toastNamed('Property „Kunde“ gespeichert')?.description).toBe('Items tragen die Option „Hafenkontor“ noch: Sie ist archiviert, nicht gelöscht.'));
    const body = callsTo('PUT', '/api/v1/properties/pr_customer')[0]!.body as { options: { id: string }[] };
    expect(body.options.map((option) => option.id)).toEqual(['opt_nordlicht']);

    // more than one kept are counted
    act(() => dismissToast(toastNamed('Property „Kunde“ gespeichert')!.id));
    answer = 'two';
    await user.click(within(await rowOf('Kunde')).getByRole('button', { name: 'Property „Kunde“ bearbeiten' }));
    dialog = await screen.findByRole('dialog', { name: 'Property „Kunde“ bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Option „Gärtnerei Moos“ entfernen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Option „Hafenkontor“ entfernen' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Property „Kunde“ gespeichert')?.description).toBe('Items tragen 2 der entfernten Optionen noch: Sie sind archiviert, nicht gelöscht.'));
  });

  it('switches a dropdown to multiple choice and keeps its default as a list; a stored multiple choice stays', async () => {
    const user = userEvent.setup();
    const customer = { ...properties[0]!, default_value: 'opt_moos', settings: { multiple: false } };
    renderWith(<Properties readOnlyReason={null} />, routes([customer, { ...properties[2]!, settings: { multiple: true } }]));

    await user.click(within(await rowOf('Kunde')).getByRole('button', { name: 'Property „Kunde“ bearbeiten' }));
    let dialog = await screen.findByRole('dialog', { name: 'Property „Kunde“ bearbeiten' });
    const multiple = within(dialog).getByRole('switch', { name: 'Mehrfachauswahl' });
    expect(document.getElementById(multiple.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Mehrere Optionen pro Item. Einmal eingeschaltet, lässt es sich nicht zurücknehmen.',
    );
    await user.click(multiple);
    const value = within(dialog).getByRole('combobox', { name: /^Standardwert/ });
    expect(value.getAttribute('aria-label')).toBe('Standardwert: Gärtnerei Moos');
    await user.click(value);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Gärtnerei Moos' }).getAttribute('aria-selected')).toBe('true'));
    // Base UI focuses the search field of the list a frame after it opens: an Escape before that reaches the dialog,
    // which closes instead of the list
    await waitFor(() => expect(document.activeElement?.getAttribute('name')).toBe('picker-query'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Gärtnerei Moos' })).toBeNull());
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
    const value = () => within(dialog).getByRole('combobox', { name: /^Standardwert/ });
    await user.click(multiple);
    // ticked Telefon first, then Mail: the list keeps the order of the options
    await user.click(value());
    await user.click(await screen.findByRole('option', { name: 'Telefon' }));
    await user.click(screen.getByRole('option', { name: 'Mail' }));
    await user.keyboard('{Escape}');
    expect(value().getAttribute('aria-label')).toBe('Standardwert: Mail, Telefon');
    await user.click(multiple);
    expect(value().getAttribute('aria-label')).toBe('Standardwert: Mail');
    await user.click(multiple);
    await user.click(value());
    await user.click(await screen.findByRole('option', { name: 'Mail' }));
    await user.keyboard('{Escape}');
    await user.click(multiple);
    expect(value().textContent).toBe('Option wählen …');
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
    await user.type(value, '2,5');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await within(dialog).findByText('Der Standardwert muss eine Zahl sein.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(value));
    expect(callsTo('PUT', '/api/v1/properties/pr_effort')[0]!.body).toMatchObject({ default_value: 2.5, settings: { decimals: 1 } });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });
});

/* ---------------------------------------------------------------- default values */

describe('default value', () => {
  const prop = (key: string, field_type: Property['field_type'], extra: Partial<Property> = {}): Property => ({
    id: `pr_${key}`,
    key,
    label: key[0]!.toUpperCase() + key.slice(1),
    field_type,
    help: '',
    default_value: null,
    settings: {},
    options: [],
    ...extra,
  });
  const options = [
    { id: 'o_a', label: 'Alpha', color: 'sky' as const, position: 0, archived_at: null },
    { id: 'o_b', label: '', color: 'moss' as const, position: 1, archived_at: null },
    { id: 'o_c', label: 'Gamma', color: 'plum' as const, position: 2, archived_at: null },
    { id: 'o_old', label: 'Alt', color: 'sand' as const, position: 3, archived_at: '2026-10-01T08:00:00.000Z' },
  ];

  /** The list with this one property; a save answers with what was sent, or with `answer`. */
  function renderProperty(property: Property, answer?: MockRoute) {
    renderWith(
      <Properties readOnlyReason={null} />,
      routes([property], { [`PUT /api/v1/properties/${property.id}`]: answer ?? ((body) => ({ body: { data: { ...property, ...(body as object) } } })) }),
    );
  }

  async function openEdit(user: ReturnType<typeof userEvent.setup>, property: Property) {
    await user.click(within(await rowOf(property.label)).getByRole('button', { name: `Property „${property.label}“ bearbeiten` }));
    return screen.findByRole('dialog', { name: `Property „${property.label}“ bearbeiten` });
  }

  /** Saves the dialog and answers the default value it sent. */
  async function save(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<unknown> {
    const before = callsTo('PUT', '/api/v1/properties/').length;
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(callsTo('PUT', '/api/v1/properties/')).toHaveLength(before + 1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    return (callsTo('PUT', '/api/v1/properties/').at(-1)!.body as { default_value: unknown }).default_value;
  }

  it('takes a text trimmed, and a blank as none', async () => {
    const user = userEvent.setup();
    const motto = prop('motto', 'text', { default_value: 'Alt' });
    renderProperty(motto);

    let dialog = await openEdit(user, motto);
    const input = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Standardwert' });
    expect(input.value).toBe('Alt');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Optional. Neue Items starten mit diesem Wert.');
    await user.clear(input);
    await user.type(input, '  Studio  ');
    expect(await save(user, dialog)).toBe('Studio');

    dialog = await openEdit(user, motto);
    await user.clear(within(dialog).getByRole('textbox', { name: 'Standardwert' }));
    expect(await save(user, dialog)).toBeNull();
  });

  it('takes an address as it is, trimmed', async () => {
    const user = userEvent.setup();
    const link = prop('link', 'url');
    renderProperty(link);

    const dialog = await openEdit(user, link);
    const input = within(dialog).getByRole('textbox', { name: 'Standardwert' });
    expect([input.getAttribute('type'), input.getAttribute('inputmode')]).toEqual(['url', 'url']);
    await user.type(input, ' https://example.com/a ');
    expect(await save(user, dialog)).toBe('https://example.com/a');
  });

  it('takes the default of a number as an item field reads it, and sends it as before', async () => {
    const user = userEvent.setup();
    const quote = prop('quote', 'number', { settings: { decimals: 1 } });
    renderProperty(quote);

    let dialog = await openEdit(user, quote);
    const input = within(dialog).getByRole('textbox', { name: 'Standardwert' });
    expect(input.getAttribute('inputmode')).toBe('decimal');
    await user.type(input, '-0.500');
    expect(await save(user, dialog)).toBe(-0.5);

    // a thousands point before a decimal comma
    dialog = await openEdit(user, quote);
    await user.type(within(dialog).getByRole('textbox', { name: 'Standardwert' }), '1.000,5');
    expect(await save(user, dialog)).toBe(1000.5);
  });

  it('sends no default it cannot read, and puts the focus there', async () => {
    const user = userEvent.setup();
    const quote = prop('quote', 'number', { settings: { decimals: 1 } });
    renderProperty(quote);

    const dialog = await openEdit(user, quote);
    const input = within(dialog).getByRole('textbox', { name: 'Standardwert' });
    // a text that may still become a number shows nothing while it is typed …
    await user.type(input, '1,');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    // … and keeps the dialog from sending, with the fix at the field
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(callsTo('PUT', '/api/v1/properties/')).toEqual([]);

    await user.type(input, '5');
    expect(within(dialog).queryByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeNull();
    expect(await save(user, dialog)).toBe(1.5);
  });

  it('offers the active options of a single dropdown and "Keine Auswahl"', async () => {
    const user = userEvent.setup();
    const stage = prop('stage', 'dropdown', { options, default_value: 'o_c' });
    renderProperty(stage);

    let dialog = await openEdit(user, stage);
    const value = within(dialog).getByRole('combobox', { name: /^Standardwert/ });
    expect(value.getAttribute('aria-label')).toBe('Standardwert: Gamma');
    await user.click(value);
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Keine Auswahl', 'Alpha', 'Ohne Label', 'Gamma']);
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(await save(user, dialog)).toBe('o_a');

    dialog = await openEdit(user, stage);
    await user.click(within(dialog).getByRole('combobox', { name: /^Standardwert/ }));
    await user.click(await screen.findByRole('option', { name: 'Keine Auswahl' }));
    expect(await save(user, dialog)).toBeNull();
  });

  it('ticks the options of a multiple dropdown into a list in their order, and none is no default', async () => {
    const user = userEvent.setup();
    const stage = prop('stage', 'dropdown', { options, settings: { multiple: true } });
    renderProperty(stage);

    let dialog = await openEdit(user, stage);
    await user.click(within(dialog).getByRole('combobox', { name: /^Standardwert/ }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Alpha', 'Ohne Label', 'Gamma']);
    await user.click(screen.getByRole('option', { name: 'Gamma' }));
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    await user.keyboard('{Escape}');
    expect(await save(user, dialog)).toEqual(['o_a', 'o_c']);

    dialog = await openEdit(user, { ...stage, default_value: ['o_a'] });
    expect(await save(user, dialog)).toBeNull();
  });

  it('asks for options first when a dropdown has none', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes());

    const dialog = await openCreate(user);
    await chooseFieldType(user, dialog, 'Dropdown');
    expect(within(dialog).getByText('Lege zuerst Optionen an.')).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: /^Standardwert/ })).toBeNull();
    await user.click(within(dialog).getByRole('switch', { name: 'Mehrfachauswahl' }));
    expect(within(dialog).getByText('Lege zuerst Optionen an.')).toBeTruthy();
  });

  it('switches yes or no, named by its label and described by the hint, and stores no as no (A89)', async () => {
    const user = userEvent.setup();
    const billable = prop('billable', 'boolean');
    renderProperty(billable);

    let dialog = await openEdit(user, billable);
    const toggle = within(dialog).getByRole('switch', { name: 'Standardwert' });
    // the visible label above names it; the word beside it says the state
    expect(within(dialog).getByText('Standardwert', { selector: 'label' })).toBeTruthy();
    expect(toggle.closest('label')!.textContent).toBe('Nein');
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe('Optional. Neue Items starten mit diesem Wert.');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(await save(user, dialog)).toBe(true);

    dialog = await openEdit(user, billable);
    await user.click(within(dialog).getByRole('switch', { name: 'Standardwert' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Standardwert' }));
    expect(await save(user, dialog)).toBe(false);
  });

  it('picks a day in the calendar, and removing it is none', async () => {
    const user = userEvent.setup();
    const launch = prop('launch', 'date', { default_value: '2026-01-02' });
    renderProperty(launch);

    let dialog = await openEdit(user, launch);
    await user.click(within(dialog).getByRole('button', { name: 'Standardwert: 02.01.2026' }));
    await user.click(document.querySelector<HTMLElement>('[data-day="2026-01-05"]')!);
    expect(await save(user, dialog)).toBe('2026-01-05');

    dialog = await openEdit(user, launch);
    await user.click(within(dialog).getByRole('button', { name: 'Standardwert: 02.01.2026' }));
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }));
    expect(await save(user, dialog)).toBeNull();
  });

  it('marks a refusal at the control, in place of the hint', async () => {
    const user = userEvent.setup();
    const billable = prop('billable', 'boolean');
    renderProperty(billable, () => invalid({ default_value: ['Der Standardwert ist Ja oder Nein.'] }));

    const dialog = await openEdit(user, billable);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    const toggle = within(dialog).getByRole('switch', { name: 'Standardwert' });
    await waitFor(() => expect(toggle.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe('Der Standardwert ist Ja oder Nein.');
    expect(within(dialog).queryByText('Optional. Neue Items starten mit diesem Wert.')).toBeNull();
  });

  it('marks a refused default of a multiple dropdown at its control', async () => {
    const user = userEvent.setup();
    const stage = prop('stage', 'dropdown', { options, settings: { multiple: true }, default_value: ['o_a'] });
    renderProperty(stage, () => invalid({ default_value: ['Diese Auswahl gibt es nicht.'] }));

    const dialog = await openEdit(user, stage);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    const value = within(dialog).getByRole('combobox', { name: /^Standardwert/ });
    await waitFor(() => expect(value.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(value.getAttribute('aria-describedby')!)?.textContent).toBe('Diese Auswahl gibt es nicht.');
  });
});

/* ---------------------------------------------------------------------- usage */

describe('Properties usage', () => {
  const flag: Property = { id: 'pr_flag', key: 'billable', label: 'Abrechenbar', field_type: 'boolean', help: '', default_value: null, settings: {}, options: [] };
  const countCalls = () => api!.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/work-items/counts');

  it('names the number of items of each property, a yes/no property by its on value (K10)', async () => {
    renderWith(<Properties readOnlyReason={null} />, routes([...all, flag], { 'POST /api/v1/work-items/counts': () => ({ body: { data: { customer: 3, effort: 1, billable: 2 } } }) }));

    expect(await within(await rowOf('Kunde')).findByText('3 Items')).toBeTruthy();
    expect(within(await rowOf('Aufwand (h)')).getByText('1 Item')).toBeTruthy();
    expect(within(await rowOf('Abrechenbar')).getByText('2 Items')).toBeTruthy();
    // a property no item has a value for is not in the answer
    expect(within(await rowOf('Umgebung')).getByText('0 Items')).toBeTruthy();
    expect(countCalls()).toHaveLength(1);
    const filters = (countCalls()[0]!.body as { filters: Record<string, unknown>; include_archived: boolean }).filters;
    expect(filters.billable).toEqual({ version: 1, conditions: [{ field: 'property:billable', op: 'is', value: true }] });
    expect(filters.effort).toEqual({ version: 1, conditions: [{ field: 'property:effort', op: 'is_not_empty' }] });
    expect((countCalls()[0]!.body as { include_archived: boolean }).include_archived).toBe(true);
  });

  it('asks for at most 50 properties per call', async () => {
    const many = Array.from({ length: 51 }, (_, index): Property => ({ ...reviewer, id: `pr_m${index}`, key: `m_${index}`, label: `Feld ${index}` }));
    renderWith(<Properties readOnlyReason={null} />, routes(many, { 'POST /api/v1/work-items/counts': (body) => ({ body: { data: Object.fromEntries(Object.keys((body as { filters: object }).filters).map((key) => [key, 1])) } }) }));

    expect(await within(await rowOf('Feld 50')).findByText('1 Item')).toBeTruthy();
    expect(countCalls().map((call) => Object.keys((call.body as { filters: object }).filters).length).sort()).toEqual([1, 50]);
  });

  it('says when the numbers could not be loaded, and still lists the properties', async () => {
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'POST /api/v1/work-items/counts': unavailable }));

    expect(await within(await rowOf('Kunde')).findByText('Anzahl nicht geladen')).toBeTruthy();
  });

  it('names the number in the question of deleting a property', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'POST /api/v1/work-items/counts': () => ({ body: { data: { effort: 2 } } }) }));

    await within(await rowOf('Aufwand (h)')).findByText('2 Items');
    await user.click(within(await rowOf('Aufwand (h)')).getByRole('button', { name: 'Property „Aufwand (h)“ löschen' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText(/Die Werte bei 2 Items gehen verloren\./)).toBeTruthy();
  });

  it('takes the property out of the counts once its deletion is confirmed, and keeps the number in the question meanwhile', async () => {
    const user = userEvent.setup();
    renderWith(
      <Properties readOnlyReason={null} />,
      routes(all, {
        'POST /api/v1/work-items/counts': (body) => ({ body: { data: Object.fromEntries(Object.keys((body as { filters: object }).filters).map((key) => [key, 2])) } }),
        'DELETE /api/v1/properties/pr_effort': () => ({ body: { affected_items: 2 } }),
      }),
    );
    // the deletion waits until the test lets it go
    let release = () => {};
    const deleting = new Promise<void>((resolve) => (release = resolve));
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'DELETE') await deleting;
      return inner(input, init);
    };
    onTestFinished(() => {
      globalThis.fetch = inner;
    });

    await within(await rowOf('Aufwand (h)')).findByText('2 Items');
    await user.click(within(await rowOf('Aufwand (h)')).getByRole('button', { name: 'Property „Aufwand (h)“ löschen' }));
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Property löschen' }));

    // the next count no longer names it: once it is gone the server would refuse a filter on it
    await waitFor(() => expect(Object.keys((countCalls().at(-1)!.body as { filters: object }).filters)).not.toContain('effort'));
    expect(Object.values((countCalls().at(-1)!.body as { filters: Record<string, { conditions: { field: string }[] }> }).filters).flatMap((filter) => filter.conditions.map((condition) => condition.field))).not.toContain('property:effort');
    // while the deletion runs, the question keeps its number and the other rows theirs, no skeleton
    expect(within(question).getByText(/Die Werte bei 2 Items gehen verloren\./)).toBeTruthy();
    // (behind the modal question the page is hidden from the roles)
    expect(within(screen.getByRole('heading', { name: 'Kunde', hidden: true }).closest('li')!).getByText('2 Items')).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('does not name a number in the question while there is none', async () => {
    const user = userEvent.setup();
    renderWith(<Properties readOnlyReason={null} />, routes(all, { 'POST /api/v1/work-items/counts': unavailable }));

    await user.click(within(await rowOf('Aufwand (h)')).getByRole('button', { name: 'Property „Aufwand (h)“ löschen' }));
    expect(within(await screen.findByRole('alertdialog')).queryByText(/gehen? verloren/)).toBeNull();
  });
});
