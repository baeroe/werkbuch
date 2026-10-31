/*
 * Labels, relation types and resolutions against a fake REST API (`mockApi`): the states and refusals Playwright does
 * not reach sensibly (load failures, empty lists, 422 and 409, a call that fails after the undo time). The flows run in
 * e2e/tests/catalogs.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { labels, list, relationTypes, resolutions } from '@/test/fixtures';
import type { Label, RelationType, Resolution } from '@/types';
import Labels from './Labels';
import RelationTypes from './RelationTypes';
import Resolutions from './Resolutions';

let api: MockApi | undefined;

function renderWith(node: ReactNode, routes: Record<string, MockRoute>) {
  api = mockApi(routes);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', { detail: 'Die Eingaben sind nicht gültig.', errors });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/**
 * Lets every answer take a moment, as a real one does: an answer in the same tick can end the call before React has
 * drawn it as running, and the dialog only moves the focus to a refused field once it saw the call run.
 */
function answerSlowly() {
  const answer = globalThis.fetch;
  globalThis.fetch = (...args: Parameters<typeof fetch>) => new Promise((done) => setTimeout(done, 10)).then(() => answer(...args));
}

const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const callsTo = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.startsWith(path));
const rowOf = (name: string) => screen.getByRole('heading', { name }).closest('li')!;
const MEMBER = 'Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.';

afterEach(() => {
  api?.restore();
  api = undefined;
  act(() => resetToasts());
});

/* ------------------------------------------------------------------------ labels */

describe('Labels', () => {
  const routes = (all: Label[] = labels, overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> => ({
    'GET /api/v1/labels': () => ({ body: list(all) }),
    ...overrides,
  });

  it('lists the labels with the name of their colour', async () => {
    renderWith(<Labels readOnlyReason={null} />, routes());

    const forms = (await screen.findByRole('heading', { name: 'Formulare' })).closest('li')!;
    expect(within(forms).getByText('Ocker')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Labels' })).getAllByRole('listitem')).toHaveLength(4);
    // no count of items yet: that comes with the items
    expect(screen.queryByText(/^Bei /)).toBeNull();
  });

  it('says when the labels could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<Labels readOnlyReason={null} />, routes(labels, { 'GET /api/v1/labels': () => (fail ? unavailable() : { body: list(labels) }) }));

    expect(await screen.findByText('Die Labels konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { name: 'UX' })).toBeTruthy();
  });

  it('offers the first label in the empty state, and puts the focus on "Label anlegen" once the list replaced it', async () => {
    const user = userEvent.setup();
    let all: Label[] = [];
    renderWith(
      <Labels readOnlyReason={null} />,
      routes([], {
        'GET /api/v1/labels': () => ({ body: list(all) }),
        'POST /api/v1/labels': (body) => {
          const created = { id: 'lb_new', ...(body as Omit<Label, 'id'>) };
          all = [created];
          return { status: 201, body: { data: created } };
        },
      }),
    );

    expect(await screen.findByText('Noch keine Labels')).toBeTruthy();
    const [header, empty] = screen.getAllByRole('button', { name: 'Label anlegen' });
    await user.click(empty!);
    const dialog = await screen.findByRole('dialog', { name: 'Label anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Barrierefreiheit');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { name: 'Barrierefreiheit' })).toBeTruthy();
    expect(toastNamed('Label „Barrierefreiheit“ ist angelegt')).toBeDefined();
    expect(callsTo('POST', '/api/v1/labels')[0]!.body).toEqual({ name: 'Barrierefreiheit', color: 'sky' });
    await waitFor(() => expect(document.activeElement).toBe(header));
  });

  it('creates a label with a tone, asks for a name, and shows a refusal of the name at the field', async () => {
    const user = userEvent.setup();
    let refuse = true;
    renderWith(
      <Labels readOnlyReason={null} />,
      routes(labels, {
        'POST /api/v1/labels': (body) => (refuse ? invalid({ name: ['Diesen Namen gibt es schon.'] }) : { status: 201, body: { data: { id: 'lb_new', ...(body as object) } } }),
      }),
    );
    answerSlowly();

    await user.click(await screen.findByRole('button', { name: 'Label anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Label anlegen' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(within(dialog).getByText('Gib dem Label einen Namen.')).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(callsTo('POST', '/api/v1/labels')).toHaveLength(0);

    await user.type(name, 'ux');
    await user.click(within(dialog).getByRole('button', { name: 'Farbe des Labels: Himmel' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Moos' }));
    await user.keyboard('{Escape}');
    expect(within(dialog).getByText('Moos')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    expect(await within(dialog).findByText('Diesen Namen gibt es schon.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(callsTo('POST', '/api/v1/labels')[0]!.body).toEqual({ name: 'ux', color: 'moss' });

    refuse = false;
    await user.clear(name);
    await user.type(name, 'Kundenwunsch');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Label „Kundenwunsch“ ist angelegt')).toBeDefined());
  });

  it('renames a label, and shows a refusal it has no field for on top of the dialog', async () => {
    const user = userEvent.setup();
    let refuse = true;
    renderWith(
      <Labels readOnlyReason={null} />,
      routes(labels, {
        'PUT /api/v1/labels/lb_ux': (body) => (refuse ? invalid({ color: ['Diese Farbe gibt es nicht.'] }) : { body: { data: { id: 'lb_ux', ...(body as object) } } }),
      }),
    );

    const edit = await screen.findByRole('button', { name: 'Label „UX“ bearbeiten' });
    await user.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Label „UX“ bearbeiten' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect((name as HTMLInputElement).value).toBe('UX');
    await user.clear(name);
    await user.type(name, 'UX-Design');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await within(dialog).findByText('Diese Farbe gibt es nicht.')).toBeTruthy();
    refuse = false;
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Label „UX-Design“ gespeichert')).toBeDefined());
    expect(callsTo('PUT', '/api/v1/labels/lb_ux').at(-1)!.body).toEqual({ name: 'UX-Design', color: 'sky' });
    // the button that opened the dialog is still there: the focus goes back to it
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('deletes a label after the undo time, takes it back before, and brings it back when the call fails', async () => {
    const user = userEvent.setup();
    let fail = false;
    renderWith(
      <Labels readOnlyReason={null} />,
      routes(labels, {
        'DELETE /api/v1/labels/lb_forms': () => (fail ? problem(404, 'not_found', { detail: 'Dieses Label gibt es nicht mehr.' }) : { body: { affected_items: 0 } }),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Label „Formulare“ löschen' }));
    expect(screen.queryByRole('heading', { name: 'Formulare' })).toBeNull();
    // the focus moves on to the next row instead of falling to the top
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Label „Produktion“ bearbeiten' })));
    act(() => runToastAction(toastNamed('Label „Formulare“ gelöscht')!.id));
    expect(await screen.findByRole('heading', { name: 'Formulare' })).toBeTruthy();
    expect(callsTo('DELETE', '/api/v1/labels')).toHaveLength(0);

    fail = true;
    await user.click(screen.getByRole('button', { name: 'Label „Formulare“ löschen' }));
    act(() => dismissToast(toastNamed('Label „Formulare“ gelöscht')!.id));
    await waitFor(() => expect(toastNamed('Label „Formulare“ nicht gelöscht')?.description).toBe('Dieses Label gibt es nicht mehr.'));
    expect(await screen.findByRole('heading', { name: 'Formulare' })).toBeTruthy();
    expect(callsTo('DELETE', '/api/v1/labels/lb_forms')).toHaveLength(1);
  });

  it('shows a member the labels without any way to change them', async () => {
    renderWith(<Labels readOnlyReason={MEMBER} />, routes());

    expect(await screen.findByRole('heading', { name: 'UX' })).toBeTruthy();
    expect(screen.getByText('Nur lesen')).toBeTruthy();
    expect(screen.getByText(MEMBER)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a member an empty list without the button', async () => {
    renderWith(<Labels readOnlyReason={MEMBER} />, routes([]));

    expect(await screen.findByText('Noch keine Labels')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

/* --------------------------------------------------------------- relation types */

describe('RelationTypes', () => {
  const routes = (all: RelationType[] = relationTypes, overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> => ({
    'GET /api/v1/relation-types': () => ({ body: list(all) }),
    ...overrides,
  });

  it('marks the built-in types and keeps them from being deleted, with the reason', async () => {
    renderWith(<RelationTypes readOnlyReason={null} />, routes());

    const blocks = (await screen.findByRole('heading', { name: 'blockiert' })).closest('li')!;
    expect(within(blocks).getByText('Mitgeliefert')).toBeTruthy();
    expect(within(blocks).getByText('wird blockiert von')).toBeTruthy();
    expect(within(blocks).getByText(/Das blockierte Item zeigt einen Hinweis/)).toBeTruthy();
    expect(within(blocks).getByText('Lässt sich nicht löschen.')).toBeTruthy();
    const remove = within(blocks).getByRole('button', { name: 'Relationstyp „blockiert“ löschen' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(remove.getAttribute('aria-describedby')!)?.textContent).toBe('„blockiert“ ist mitgeliefert und lässt sich nicht löschen.');

    // the related type is symmetric: one label, no counterpart
    const relates = rowOf('verwandt');
    expect(within(relates).getByText('Symmetrisch')).toBeTruthy();
    expect([...relates.querySelectorAll('p')].map((line) => line.textContent)).toEqual(['Item A verwandt mit Item B', 'Lässt sich nicht löschen.']);
    // a type of one's own can go
    const tests = rowOf('testet');
    expect(within(tests).queryByText('Mitgeliefert')).toBeNull();
    expect(within(tests).getByRole('button', { name: 'Relationstyp „testet“ löschen' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('creates a directed type, and a symmetric one; switching "Symmetrisch" off puts the focus on the opposite direction', async () => {
    const user = userEvent.setup();
    renderWith(
      <RelationTypes readOnlyReason={null} />,
      routes(relationTypes, { 'POST /api/v1/relation-types': (body) => ({ status: 201, body: { data: { id: 'rt_new', ...(body as object) } } }) }),
    );

    await user.click(await screen.findByRole('button', { name: 'Relationstyp anlegen' }));
    let dialog = await screen.findByRole('dialog', { name: 'Relationstyp anlegen' });
    expect(within(dialog).getByText('Zwischen zwei Items lässt sich dann eine Beziehung mit diesem Namen eintragen.')).toBeTruthy();
    // each missing label is named, the focus goes to the first
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(within(dialog).getByText('Gib dem Relationstyp einen Namen.')).toBeTruthy();
    expect(within(dialog).getByText('Beschrifte die Richtung, etwa „blockiert“.')).toBeTruthy();
    expect(within(dialog).getByText(/Beschrifte die Gegenrichtung/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'ersetzt');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Beschriftung' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschriftung' }), 'ersetzt');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Beschriftung der Gegenrichtung' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschriftung der Gegenrichtung' }), 'wird ersetzt von');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Relationstyp „ersetzt“ ist angelegt')).toBeDefined());
    expect(callsTo('POST', '/api/v1/relation-types')[0]!.body).toEqual({ name: 'ersetzt', outward_label: 'ersetzt', inward_label: 'wird ersetzt von', built_in: null });

    await user.click(screen.getByRole('button', { name: 'Relationstyp anlegen' }));
    dialog = await screen.findByRole('dialog', { name: 'Relationstyp anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'gehört zu');
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschriftung' }), 'gehört zu');
    const symmetric = within(dialog).getByRole('switch', { name: /Symmetrisch/ });
    await user.click(symmetric);
    expect(within(dialog).queryByRole('textbox', { name: 'Beschriftung der Gegenrichtung' })).toBeNull();
    // off again: the field comes back and takes the focus
    await user.click(symmetric);
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Beschriftung der Gegenrichtung' }));
    await user.click(symmetric);
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Relationstyp „gehört zu“ ist angelegt')).toBeDefined());
    expect(callsTo('POST', '/api/v1/relation-types')[1]!.body).toMatchObject({ name: 'gehört zu', inward_label: null });
  });

  it('renames a built-in type and says it stays, with the refusals of the server at their fields', async () => {
    const user = userEvent.setup();
    let refuse = true;
    renderWith(
      <RelationTypes readOnlyReason={null} />,
      routes(relationTypes, {
        'PUT /api/v1/relation-types/rt_blocks': (body) =>
          refuse
            ? invalid({ outward_label: ['Die Beschriftung darf höchstens 60 Zeichen haben.'], inward_label: ['Die Gegenrichtung darf höchstens 60 Zeichen haben.'] })
            : { body: { data: { id: 'rt_blocks', ...(body as object) } } },
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Relationstyp „blockiert“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Relationstyp „blockiert“ bearbeiten' });
    expect(within(dialog).getByText('Dieser Typ ist mitgeliefert. Du kannst ihn umbenennen, aber nicht löschen.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Die Beschriftung darf höchstens 60 Zeichen haben.')).toBeTruthy();
    expect(within(dialog).getByText('Die Gegenrichtung darf höchstens 60 Zeichen haben.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Beschriftung' })));
    expect(callsTo('PUT', '/api/v1/relation-types/rt_blocks')[0]!.body).toEqual({ name: 'blockiert', outward_label: 'blockiert', inward_label: 'wird blockiert von', built_in: 'blocks' });

    refuse = false;
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Relationstyp „blockiert“ gespeichert')).toBeDefined());
  });

  it('says why the server refused to delete a type it holds for built in', async () => {
    const user = userEvent.setup();
    renderWith(
      <RelationTypes readOnlyReason={null} />,
      routes(relationTypes, {
        'DELETE /api/v1/relation-types/rt_tests': () => problem(409, 'built_in', { detail: '„testet“ ist mitgeliefert und lässt sich nicht löschen.' }),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Relationstyp „testet“ löschen' }));
    act(() => dismissToast(toastNamed('Relationstyp „testet“ gelöscht')!.id));
    await waitFor(() => expect(toastNamed('Relationstyp „testet“ nicht gelöscht')?.description).toBe('„testet“ ist mitgeliefert und lässt sich nicht löschen.'));
    // a refusal is not worth trying again
    expect(toastNamed('Relationstyp „testet“ nicht gelöscht')!.action).toBeUndefined();
    expect(await screen.findByRole('heading', { name: 'testet' })).toBeTruthy();
  });

  it('deletes a type of its own after the undo time', async () => {
    const user = userEvent.setup();
    renderWith(<RelationTypes readOnlyReason={null} />, routes(relationTypes, { 'DELETE /api/v1/relation-types/rt_tests': () => ({ body: { affected_relations: 0 } }) }));

    await user.click(await screen.findByRole('button', { name: 'Relationstyp „testet“ löschen' }));
    expect(screen.queryByRole('heading', { name: 'testet' })).toBeNull();
    act(() => dismissToast(toastNamed('Relationstyp „testet“ gelöscht')!.id));
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/relation-types/rt_tests')).toHaveLength(1));
  });

  it('offers the first relation type in the empty state, and shows a member the list without buttons', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWith(<RelationTypes readOnlyReason={null} />, routes([]));

    expect(await screen.findByText('Noch kein Relationstyp')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Relationstyp anlegen' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    expect(await screen.findByRole('dialog', { name: 'Relationstyp anlegen' })).toBeTruthy();
    unmount();
    api!.restore();

    renderWith(<RelationTypes readOnlyReason={MEMBER} />, routes());
    expect(await screen.findByRole('heading', { name: 'blockiert' })).toBeTruthy();
    expect(screen.getByText('Nur lesen')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says when the relation types could not be loaded', async () => {
    renderWith(<RelationTypes readOnlyReason={MEMBER} />, routes([], { 'GET /api/v1/relation-types': unavailable }));
    expect(await screen.findByText('Die Relationstypen konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------- resolutions */

describe('Resolutions', () => {
  const archived: Resolution = { id: 'res_old', label: 'Veraltet', default_for: null, position: 4, archived_at: '2026-10-01T10:00:00.000Z' };

  const routes = (all: Resolution[] = [...resolutions, archived], overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> => ({
    'GET /api/v1/resolutions': () => ({ body: list(all) }),
    ...overrides,
  });

  const saved = (id: string) => (body: unknown) => ({ body: { data: { id, position: 0, ...(body as object) } } });

  it('lists the resolutions by position, marks the defaults and the archived ones, and keeps the defaults from being deleted', async () => {
    renderWith(<Resolutions readOnlyReason={null} />, routes([archived, ...[...resolutions].reverse()]));

    await screen.findByRole('heading', { name: 'Done' });
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Done', "Won't do", 'Duplicate', 'Cannot reproduce', 'Veraltet']);
    expect(within(rowOf('Done')).getByText('Standard für Completed')).toBeTruthy();
    expect(within(rowOf("Won't do")).getByText('Standard für Canceled')).toBeTruthy();
    expect(within(rowOf('Veraltet')).getByText('Archiviert')).toBeTruthy();

    const remove = within(rowOf('Done')).getByRole('button', { name: 'Resolution „Done“ löschen' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(remove.getAttribute('aria-describedby')!)?.textContent).toBe('„Done“ ist der Standard für Completed. Bestimme zuerst einen anderen.');
    expect(within(rowOf('Duplicate')).getByRole('button', { name: 'Resolution „Duplicate“ löschen' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('keeps a default from losing its mark or being archived in its dialog', async () => {
    const user = userEvent.setup();
    renderWith(<Resolutions readOnlyReason={null} />, routes(resolutions, { 'PUT /api/v1/resolutions/res_done': saved('res_done') }));

    await user.click(await screen.findByRole('button', { name: 'Resolution „Done“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolution „Done“ bearbeiten' });
    const standard = within(dialog).getByRole('combobox', { name: /^Standard für/ });
    expect(standard.textContent).toContain('Completed');
    expect(standard.getAttribute('aria-readonly')).toBe('true');
    expect(within(dialog).getByText('Ein Standard bleibt es, bis eine andere Resolution ihn übernimmt.')).toBeTruthy();
    expect(within(dialog).getByRole('switch', { name: 'Archiviert' }).hasAttribute('data-disabled')).toBe(true);
    expect(within(dialog).getByText('Ein Standard lässt sich nicht archivieren. Bestimme zuerst einen anderen.')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Resolution „Done“ gespeichert')).toBeDefined());
    // the whole resolution, every time (P24)
    expect(callsTo('PUT', '/api/v1/resolutions/res_done')[0]!.body).toEqual({ label: 'Done', default_for: 'completed', position: 0, archived_at: null });
  });

  it('archives a resolution and sends the default and the stamp along; a new default takes the archive away', async () => {
    const user = userEvent.setup();
    renderWith(
      <Resolutions readOnlyReason={null} />,
      routes([...resolutions, archived], { 'PUT /api/v1/resolutions/res_duplicate': saved('res_duplicate'), 'PUT /api/v1/resolutions/res_old': saved('res_old') }),
    );

    await user.click(await screen.findByRole('button', { name: 'Resolution „Duplicate“ bearbeiten' }));
    let dialog = await screen.findByRole('dialog', { name: 'Resolution „Duplicate“ bearbeiten' });
    expect(within(dialog).getByText(/Eine archivierte Resolution lässt sich nicht mehr wählen/)).toBeTruthy();
    await user.click(within(dialog).getByRole('switch', { name: 'Archiviert' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Resolution „Duplicate“ gespeichert')).toBeDefined());
    const sent = callsTo('PUT', '/api/v1/resolutions/res_duplicate')[0]!.body as Resolution;
    expect(sent).toMatchObject({ label: 'Duplicate', default_for: null, position: 2 });
    expect(Date.parse(sent.archived_at!)).not.toBeNaN();

    // one archived already keeps its stamp; choosing a category makes it a default, which is never archived
    await user.click(screen.getByRole('button', { name: 'Resolution „Veraltet“ bearbeiten' }));
    dialog = await screen.findByRole('dialog', { name: 'Resolution „Veraltet“ bearbeiten' });
    const switchOf = () => within(dialog).getByRole('switch', { name: 'Archiviert' });
    expect(switchOf().getAttribute('aria-checked')).toBe('true');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(callsTo('PUT', '/api/v1/resolutions/res_old')).toHaveLength(1));
    expect(callsTo('PUT', '/api/v1/resolutions/res_old')[0]!.body).toMatchObject({ default_for: null, archived_at: archived.archived_at });

    await user.click(screen.getByRole('button', { name: 'Resolution „Veraltet“ bearbeiten' }));
    dialog = await screen.findByRole('dialog', { name: 'Resolution „Veraltet“ bearbeiten' });
    await user.click(within(dialog).getByRole('combobox', { name: /^Standard für/ }));
    await user.click(await screen.findByRole('option', { name: 'Canceled' }));
    expect(switchOf().getAttribute('aria-checked')).toBe('false');
    expect(switchOf().hasAttribute('data-disabled')).toBe(true);
    await user.click(within(dialog).getByRole('combobox', { name: /^Standard für/ }));
    await user.click(await screen.findByRole('option', { name: 'Kein Standard' }));
    expect(switchOf().hasAttribute('data-disabled')).toBe(false);
    await user.click(within(dialog).getByRole('combobox', { name: /^Standard für/ }));
    await user.click(await screen.findByRole('option', { name: 'Canceled' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(callsTo('PUT', '/api/v1/resolutions/res_old')).toHaveLength(2));
    expect(callsTo('PUT', '/api/v1/resolutions/res_old')[1]!.body).toMatchObject({ default_for: 'canceled', archived_at: null });
  });

  it('creates a resolution, asks for a label, and shows a refusal of the default in the dialog', async () => {
    const user = userEvent.setup();
    let refuse = true;
    renderWith(
      <Resolutions readOnlyReason={null} />,
      routes(resolutions, {
        'POST /api/v1/resolutions': (body) =>
          refuse ? invalid({ default_for: ['Jede Kategorie braucht einen Standard. Mache zuerst eine andere Resolution zum Standard.'] }) : { status: 201, body: { data: { id: 'res_new', ...(body as object) } } },
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Resolution anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolution anlegen' });
    // archiving is for resolutions that exist
    expect(within(dialog).queryByRole('switch')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(within(dialog).getByText('Gib der Resolution ein Label.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Label' }));

    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Abgelehnt');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Jede Kategorie braucht einen Standard. Mache zuerst eine andere Resolution zum Standard.')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: /^Standard für/ }).getAttribute('aria-invalid')).toBe('true');
    expect(callsTo('POST', '/api/v1/resolutions')[0]!.body).toEqual({ label: 'Abgelehnt', default_for: null, position: 0, archived_at: null });

    refuse = false;
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Resolution „Abgelehnt“ ist angelegt')).toBeDefined());
  });

  it('removes a resolution after the undo time, and shows a member the list without buttons', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWith(<Resolutions readOnlyReason={null} />, routes(resolutions, { 'DELETE /api/v1/resolutions/res_cannot': () => ({ body: { outcome: 'deleted' } }) }));

    await user.click(await screen.findByRole('button', { name: 'Resolution „Cannot reproduce“ löschen' }));
    expect(screen.queryByRole('heading', { name: 'Cannot reproduce' })).toBeNull();
    act(() => dismissToast(toastNamed('Resolution „Cannot reproduce“ entfernt')!.id));
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/resolutions/res_cannot')).toHaveLength(1));
    expect(toastNamed('Resolution „Cannot reproduce“ nicht entfernt')).toBeUndefined();
    unmount();
    api!.restore();

    renderWith(<Resolutions readOnlyReason={MEMBER} />, routes());
    expect(await screen.findByRole('heading', { name: 'Done' })).toBeTruthy();
    expect(screen.getByText('Nur lesen')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says when the resolutions could not be loaded', async () => {
    renderWith(<Resolutions readOnlyReason={MEMBER} />, routes([], { 'GET /api/v1/resolutions': unavailable }));
    expect(await screen.findByText('Die Resolutions konnten nicht geladen werden')).toBeTruthy();
  });
});
