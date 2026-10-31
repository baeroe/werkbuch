/*
 * Types against a fake REST API (`mockApi`): the list, the dialog with icon, tone, Epic and the properties in their
 * order, and the refusals Playwright does not reach sensibly (422 at the icon, 409 for the default type of a project,
 * load failures). The flows run in e2e/tests/types-properties.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, properties, types } from '@/test/fixtures';
import type { Property, WorkItemType } from '@/types';
import Types from './Types';

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
/** The row of a type, found by its name in the tab. */
const rowOf = async (name: string) => (await screen.findByRole('heading', { name })).closest('li')!;
const MEMBER = 'Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.';

// an archived type with its properties out of order, and one without any
const archived: WorkItemType = { ...types[1]!, id: 't_old', name: 'Altlast', properties: [...types[1]!.properties].reverse(), archived_at: '2026-10-01T08:00:00.000Z' };
const plain: WorkItemType = { ...types[0]!, id: 't_plain', name: 'Schlicht', description: '', properties: [] };

const routes = (all: WorkItemType[] = types, overrides: Record<string, MockRoute> = {}, props: Property[] = properties): Record<string, MockRoute> => ({
  'GET /api/v1/work-item-types': () => ({ body: list(all) }),
  'GET /api/v1/properties': () => ({ body: list(props) }),
  ...overrides,
});

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

describe('Types', () => {
  it('lists the types with their properties in order, the required ones marked, and the Epic and archive badges', async () => {
    renderWith(<Types readOnlyReason={null} />, routes([...types, archived, plain]));

    const bug = await rowOf('Bug');
    expect(within(within(bug).getByRole('list', { name: 'Properties von Bug' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Kunde',
      'Aufwand (h)',
      'Umgebung (Pflicht)',
    ]);
    expect(within(await rowOf('Epic')).getByText('In der Timeline')).toBeTruthy();
    expect(within(await rowOf('Task')).queryByText('In der Timeline')).toBeNull();
    expect(within(await rowOf('Altlast')).getByText('Archiviert')).toBeTruthy();
    expect(within(await rowOf('Task')).queryByText('Archiviert')).toBeNull();
    // no count of items yet: that comes with the items
    expect(screen.queryByText(/^Bei /)).toBeNull();
    // an active type can be deleted, an archived one restored
    expect(within(bug).getByRole('button', { name: 'Typ „Bug“ löschen' })).toBeTruthy();
    expect(within(await rowOf('Altlast')).getByRole('button', { name: 'Typ „Altlast“ wiederherstellen' })).toBeTruthy();
    expect(within(await rowOf('Altlast')).queryByRole('button', { name: 'Typ „Altlast“ löschen' })).toBeNull();
    // a type without properties has no list of them
    expect(within(await rowOf('Schlicht')).queryByRole('list')).toBeNull();
  });

  it('creates a type with an icon, a tone and its properties in the order set by keyboard, one of them required', async () => {
    const user = userEvent.setup();
    renderWith(
      <Types readOnlyReason={null} />,
      routes(types, { 'POST /api/v1/work-item-types': (body) => ({ status: 201, body: { data: { id: 't_new', ...(body as object) } } }) }),
    );

    const create = await screen.findByRole('button', { name: 'Typ anlegen' });
    await user.click(create);
    const dialog = await screen.findByRole('dialog', { name: 'Typ anlegen' });
    expect(within(dialog).getByText('Typ')).toBeTruthy();
    // a name is needed, and the focus goes there
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(within(dialog).getByText('Gib dem Typ einen Namen.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Idee');
    // the preview of the tab follows the name
    expect(within(dialog).getByText('Idee')).toBeTruthy();

    await user.click(within(dialog).getByRole('radio', { name: 'Glühbirne' }));
    expect(within(dialog).getByRole('radio', { name: 'Glühbirne' }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(dialog).getByRole('button', { name: 'Farbe des Typs: Himmel' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Pflaume' }));
    await user.keyboard('{Escape}');
    expect(within(dialog).getByText('Pflaume')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschreibung' }), '  Ein Einfall.  ');
    await user.click(within(dialog).getByRole('switch', { name: 'Epic' }));

    const add = within(dialog).getByRole('combobox', { name: 'Property hinzufügen' });
    await user.click(add);
    await user.click(await screen.findByRole('option', { name: 'Kunde' }));
    await user.click(add);
    await user.click(await screen.findByRole('option', { name: 'Umgebung' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Pflicht: Kunde' }));

    // Umgebung up above Kunde: Space lifts, the arrow moves, Space puts it down
    const handle = within(dialog).getByRole('button', { name: 'Umgebung verschieben' });
    handle.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(handle.getAttribute('aria-pressed')).toBe('true'));
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    await waitFor(() =>
      expect(within(within(dialog).getByRole('list', { name: 'Properties des Typs' })).getAllByRole('listitem').map((row) => row.querySelector('p')!.textContent)).toEqual([
        'Umgebung',
        'Kunde',
      ]),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Typ „Idee“ ist angelegt')).toBeDefined());
    expect(callsTo('POST', '/api/v1/work-item-types')[0]!.body).toEqual({
      name: 'Idee',
      icon: 'lightbulb',
      tone: 'plum',
      description: 'Ein Einfall.',
      is_epic: true,
      properties: [
        { property_id: 'pr_environment', required: false },
        { property_id: 'pr_customer', required: true },
      ],
      archived_at: null,
    });
    await waitFor(() => expect(document.activeElement).toBe(create));
  });

  it('removes a property of the type, the focus going on to the next one and after the last to the choice below', async () => {
    const user = userEvent.setup();
    renderWith(<Types readOnlyReason={null} />, routes());

    await user.click(within(await rowOf('Task')).getByRole('button', { name: 'Typ „Task“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ „Task“ bearbeiten' });
    const add = within(dialog).getByRole('combobox', { name: 'Property hinzufügen' });

    await user.click(within(dialog).getByRole('button', { name: 'Kunde entfernen' }));
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Aufwand (h) verschieben' })));
    await user.click(within(dialog).getByRole('button', { name: 'Aufwand (h) entfernen' }));
    await waitFor(() => expect(document.activeElement).toBe(add));
    expect(within(dialog).queryByRole('list', { name: 'Properties des Typs' })).toBeNull();
  });

  it('says when every property is added already', async () => {
    const user = userEvent.setup();
    renderWith(<Types readOnlyReason={null} />, routes());

    await user.click(within(await rowOf('Bug')).getByRole('button', { name: 'Typ „Bug“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ „Bug“ bearbeiten' });
    const add = within(dialog).getByRole('combobox', { name: 'Property hinzufügen' });
    expect(add.textContent).toContain('Alle Properties sind zugeordnet');
    expect(add.hasAttribute('data-disabled')).toBe(true);
  });

  it('shows a refusal of the icon at the icons, with the focus on the chosen one, and one without a field on top', async () => {
    const user = userEvent.setup();
    let answer: 'icon' | 'other' = 'icon';
    renderWith(
      <Types readOnlyReason={null} />,
      routes(types, {
        'PUT /api/v1/work-item-types/t_task': () =>
          answer === 'icon' ? invalid({ icon: ['Dieses Icon gibt es nicht.'] }) : invalid({ tone: ['Diese Farbe gibt es nicht.'], is_epic: ['Nicht jetzt.'] }),
      }),
    );
    answerSlowly();

    await user.click(within(await rowOf('Task')).getByRole('button', { name: 'Typ „Task“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ „Task“ bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    const chosen = within(dialog).getByRole('radio', { name: 'Häkchen im Quadrat' });
    expect(await within(dialog).findByText('Dieses Icon gibt es nicht.')).toBeTruthy();
    expect(chosen.getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: 'Käfer' }).hasAttribute('aria-invalid')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(chosen));
    expect(within(dialog).queryByRole('alert')).toBeNull();

    answer = 'other';
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Diese Farbe gibt es nicht.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Farbe des Typs: Himmel' }).getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByRole('alert').textContent).toContain('Nicht jetzt.');
  });

  it('shows a refusal of the properties at the choice of properties', async () => {
    const user = userEvent.setup();
    renderWith(<Types readOnlyReason={null} />, routes(types, { 'PUT /api/v1/work-item-types/t_epic': () => invalid({ properties: ['Diese Property gibt es nicht.'] }) }));
    answerSlowly();

    await user.click(within(await rowOf('Epic')).getByRole('button', { name: 'Typ „Epic“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ „Epic“ bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await within(dialog).findByText('Diese Property gibt es nicht.')).toBeTruthy();
    const add = within(dialog).getByRole('combobox', { name: 'Property hinzufügen' });
    expect(add.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(add));
  });

  it('keeps the archive stamp of an archived type when it is changed, and restores it with null', async () => {
    const user = userEvent.setup();
    let all = [...types, archived];
    renderWith(
      <Types readOnlyReason={null} />,
      routes(types, {
        'GET /api/v1/work-item-types': () => ({ body: list(all) }),
        'PUT /api/v1/work-item-types/t_old': (body) => {
          const saved = { ...archived, ...(body as object), archived_at: (body as WorkItemType).archived_at ? archived.archived_at : null };
          all = [...types, saved];
          return { body: { data: saved } };
        },
      }),
    );

    const edit = within(await rowOf('Altlast')).getByRole('button', { name: 'Typ „Altlast“ bearbeiten' });
    await user.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Typ „Altlast“ bearbeiten' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Altlast');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Typ „Altlast“ gespeichert')).toBeDefined());
    expect(callsTo('PUT', '/api/v1/work-item-types/t_old')[0]!.body).toEqual({
      name: 'Altlast',
      icon: 'bug',
      tone: 'ochre',
      description: archived.description,
      is_epic: false,
      properties: [
        { property_id: 'pr_customer', required: false },
        { property_id: 'pr_effort', required: false },
        { property_id: 'pr_environment', required: true },
      ],
      archived_at: '2026-10-01T08:00:00.000Z',
    });
    await waitFor(() => expect(document.activeElement).toBe(edit));

    // restore: the whole type, without the stamp; the focus stays on the button, which offers deleting now
    const restore = within(await rowOf('Altlast')).getByRole('button', { name: 'Typ „Altlast“ wiederherstellen' });
    restore.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(toastNamed('Typ „Altlast“ ist wiederhergestellt')?.description).toBe('Neue Items dieses Typs lassen sich wieder anlegen.'));
    expect(callsTo('PUT', '/api/v1/work-item-types/t_old')[1]!.body).toEqual({
      name: 'Altlast',
      icon: 'bug',
      tone: 'ochre',
      description: archived.description,
      is_epic: false,
      properties: [
        { property_id: 'pr_customer', required: false },
        { property_id: 'pr_effort', required: false },
        { property_id: 'pr_environment', required: true },
      ],
      archived_at: null,
    });
    await waitFor(() => expect(within(screen.getByRole('heading', { name: 'Altlast' }).closest('li')!).queryByText('Archiviert')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Typ „Altlast“ löschen' }));
  });

  it('says when a type could not be restored, and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(
      <Types readOnlyReason={null} />,
      routes([...types, archived], { 'PUT /api/v1/work-item-types/t_old': (body) => (fail ? unavailable() : { body: { data: { ...archived, ...(body as object) } } }) }),
    );

    await user.click(within(await rowOf('Altlast')).getByRole('button', { name: 'Typ „Altlast“ wiederherstellen' }));
    await waitFor(() => expect(toastNamed('Typ „Altlast“ nicht wiederhergestellt')?.description).toBe('Der Server ist gerade nicht erreichbar.'));
    fail = false;
    act(() => toastNamed('Typ „Altlast“ nicht wiederhergestellt')!.action!.onClick());
    await waitFor(() => expect(toastNamed('Typ „Altlast“ ist wiederhergestellt')).toBeDefined());
    expect(callsTo('PUT', '/api/v1/work-item-types/t_old')).toHaveLength(2);
  });

  it('deletes a type after the undo time, and brings back the default type of a project with the reason', async () => {
    const user = userEvent.setup();
    let all = types;
    renderWith(
      <Types readOnlyReason={null} />,
      routes(types, {
        'GET /api/v1/work-item-types': () => ({ body: list(all) }),
        'DELETE /api/v1/work-item-types/t_task': () =>
          problem(409, 'default_type', { detail: 'Der Typ ist der Standardtyp von WEB, OPS.', projects: ['WEB', 'OPS'] }),
        'DELETE /api/v1/work-item-types/t_wish': () => {
          all = types.filter((type) => type.id !== 't_wish');
          return { body: { outcome: 'deleted' } };
        },
      }),
    );

    await user.click(within(await rowOf('Task')).getByRole('button', { name: 'Typ „Task“ löschen' }));
    expect(screen.queryByRole('heading', { name: 'Task' })).toBeNull();
    // the focus moves on to the next row instead of falling to the top
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Typ „Bug“ bearbeiten' })));
    act(() => dismissToast(toastNamed('Typ „Task“ gelöscht')!.id));
    await waitFor(() => expect(toastNamed('Typ „Task“ nicht gelöscht')?.description).toBe('Der Typ ist der Standardtyp von WEB, OPS.'));
    expect(await rowOf('Task')).toBeTruthy();

    await user.click(within(await rowOf('Kundenwunsch')).getByRole('button', { name: 'Typ „Kundenwunsch“ löschen' }));
    act(() => dismissToast(toastNamed('Typ „Kundenwunsch“ gelöscht')!.id));
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/work-item-types/t_wish')).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).not.toContain('Kundenwunsch'));
  });

  it('offers the first type in the empty state', async () => {
    const user = userEvent.setup();
    renderWith(<Types readOnlyReason={null} />, routes([]));

    expect(await screen.findByText('Noch kein Typ')).toBeTruthy();
    expect(screen.getByText('Ohne Typ lassen sich keine Items anlegen.')).toBeTruthy();
    const [, empty] = screen.getAllByRole('button', { name: 'Typ anlegen' });
    await user.click(empty!);
    expect(await screen.findByRole('dialog', { name: 'Typ anlegen' })).toBeTruthy();
  });

  it('shows a member the types without any way to change them', async () => {
    renderWith(<Types readOnlyReason={MEMBER} />, routes([...types, archived]));

    expect(await rowOf('Bug')).toBeTruthy();
    expect(screen.getByText(MEMBER)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a member an empty list without the button', async () => {
    renderWith(<Types readOnlyReason={MEMBER} />, routes([]));

    expect(await screen.findByText('Noch kein Typ')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says when the types could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<Types readOnlyReason={null} />, routes(types, { 'GET /api/v1/properties': () => (fail ? unavailable() : { body: list(properties) }) }));

    expect(await screen.findByText('Die Typen konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await rowOf('Bug')).toBeTruthy();
  });
});
