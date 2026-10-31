/*
 * The project settings against a fake REST API (`mockApi`): the branches Playwright does not reach sensibly (load
 * failures, refusals, read-only, the own demotion, undo). The main flows run in e2e/tests/projects.spec.ts and
 * e2e/tests/onboarding.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, lene, list, mara, organization, person, project, standard, theo, types } from '@/test/fixtures';
import type { ProjectMember, User, WorkItemType } from '@/types';
import { ProjectSettings } from './ProjectSettings';

type Visit = { url: URL; method: string; prefetch: boolean; preserveUrl: boolean };
const inertia = vi.hoisted(() => ({ visit: vi.fn(), replace: vi.fn(), url: '/projects/WEB/settings', listeners: new Map<string, Set<(event: never) => unknown>>() }));
let signedIn: User = ida;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: inertia.url }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: {
    visit: inertia.visit,
    replace: inertia.replace,
    reload: vi.fn(),
    on: (event: string, listener: (event: never) => unknown) => {
      const set = inertia.listeners.get(event) ?? new Set();
      set.add(listener);
      inertia.listeners.set(event, set);
      return () => set.delete(listener);
    },
  },
}));

/** What Inertia does when a visit starts: asks every `before` listener; false from one of them stops it. */
function startVisit(path: string): boolean {
  const visit: Visit = { url: new URL(path, window.location.origin), method: 'get', prefetch: false, preserveUrl: false };
  return [...(inertia.listeners.get('before') ?? [])].every((listener) => (listener as (event: { detail: { visit: Visit } }) => unknown)({ detail: { visit } }) !== false);
}

/* -------------------------------------------------------------------------- data */

const kira: User = { ...person('u_kira', 'Kira', 'kira'), type: 'bot', email: null, owner_id: 'u_mara' };
const automation: User = { ...person('u_automation', 'Automation', 'automation', 'admin'), type: 'bot', email: null, is_default_bot: true };
const sven: User = { ...person('u_sven', 'Sven Albers', 'sven'), disabled_at: '2026-09-18T15:00:00.000Z' };
const jonas = person('u_jonas', 'Jonas Feld', 'jonas');

const web = project('WEB', 'admin', { id: 'p_web', name: 'Website-Relaunch', description: 'Der neue Auftritt.', lead_id: 'u_ida' });
const member = (user_id: string, role: ProjectMember['role']): ProjectMember => ({ project_id: 'p_web', user_id, role });
const members = [member('u_ida', 'admin'), member('u_theo', 'viewer'), member('u_lene', 'member'), member('u_kira', 'member'), member('u_mara', 'member')];

/** An archived type, in the catalog after the others. */
const legacy: WorkItemType = { ...types[0]!, id: 't_legacy', name: 'Altlast', description: '', archived_at: '2026-09-01T10:00:00.000Z' };

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

function renderSettings(section: string, overrides: Record<string, MockRoute> = {}, { identifier = 'WEB', project: shown = web } = {}) {
  api = mockApi({
    'GET /api/v1/projects/WEB': () => ({ body: { data: shown } }),
    'GET /api/v1/projects': () => ({ body: list([shown]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list(members) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, theo, lene, jonas, sven, kira, automation]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/work-item-types': () => ({ body: list([...types, legacy]) }),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProjectSettings identifier={identifier} section={section} />
      </QueryClientProvider>,
    ),
  };
}

const toastTitles = () => currentToasts().map((entry) => entry.title);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title)!;
const lastCall = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path).at(-1);
const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = ida;
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  inertia.url = '/projects/WEB/settings';
  act(() => resetToasts());
});

/* ------------------------------------------------------------------------- frame */

describe('ProjectSettings', () => {
  it('waits for the project and the rights, then shows General with the sections of the project', async () => {
    renderSettings('general');

    expect(screen.getByText('Projekteinstellungen werden geladen …')).toBeTruthy();
    expect(screen.getByText('Bereiche werden geladen …')).toBeTruthy();
    expect(document.title).toBe('Projekteinstellungen – werkbuch');

    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Website-Relaunch');
    const nav = screen.getByRole('navigation', { name: 'Bereiche der Projekteinstellungen' });
    expect(within(nav).getByRole('link', { name: 'Allgemein' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Mitglieder' }).getAttribute('href')).toBe('/projects/WEB/settings/members');
    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeTruthy();
    expect(document.title).toBe('Allgemein – Einstellungen WEB – werkbuch');
    expect(screen.queryByText('Du kannst das nur lesen')).toBeNull();
  });

  it('names a project that is not there (any more)', async () => {
    renderSettings('general', { 'GET /api/v1/projects/NOPE': () => problem(404, 'not_found') }, { identifier: 'NOPE' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Das Projekt NOPE gibt es nicht' })).toBeTruthy();
  });

  it('says when the project could not be loaded and loads it again on request', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSettings('general', { 'GET /api/v1/projects/WEB': () => (fail ? unavailable() : { body: { data: web } }) });

    expect(await screen.findByText('Das Projekt konnte nicht geladen werden')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('says when the rights could not be loaded and loads them again on request', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSettings('general', { 'GET /api/v1/projects': () => (fail ? unavailable() : { body: list([web]) }) });

    expect(await screen.findByText('Das Projekt konnte nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('moves to the address of the current identifier when the project has another one now', async () => {
    renderSettings('members', {}, { project: { ...web, identifier: 'SITE' } });

    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/SITE/settings/members', { replace: true }));
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  });

  it('puts the identifier in the address in its own spelling, and leaves a right one alone', async () => {
    inertia.url = '/projects/web/settings/members?tab=1';
    const { unmount } = renderSettings('members');

    await waitFor(() => expect(inertia.replace).toHaveBeenCalledWith({ url: '/projects/WEB/settings/members?tab=1', preserveState: true, preserveScroll: true }));
    unmount();
    inertia.replace.mockReset();
    api?.restore();

    inertia.url = '/projects/WEB/settings/members';
    renderSettings('members');
    expect(await screen.findByRole('list', { name: 'Mitglieder von WEB' })).toBeTruthy();
    expect(inertia.replace).not.toHaveBeenCalled();
  });

  it('says that an unknown section does not exist, keeps the list and leads to General', async () => {
    renderSettings('automations');

    expect(await screen.findByText('Diesen Bereich gibt es nicht')).toBeTruthy();
    expect(screen.getByText('Die Einstellungen von WEB haben die Bereiche Allgemein, Mitglieder, Workflow und Typen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zu Allgemein' }).getAttribute('href')).toBe('/projects/WEB/settings/general');
    expect(screen.getByRole('navigation', { name: 'Bereiche der Projekteinstellungen' }).querySelector('[aria-current]')).toBeNull();
    expect(document.title).toBe('Projekteinstellungen – werkbuch');
  });

  it('lets somebody who does not manage the project read General, without the danger zone', async () => {
    signedIn = lene;
    renderSettings('general', {}, { project: { ...web, my_role: 'member' } });

    expect(await screen.findByText('Projekteinstellungen ändern dürfen nur Admins des Projekts WEB.')).toBeTruthy();
    expect((await screen.findByRole('textbox', { name: 'Name' })).hasAttribute('readonly')).toBe(true);
    expect(screen.queryByRole('button', { name: /Speichern/ })).toBeNull();
    expect(screen.queryByText('Gefahrenzone')).toBeNull();
  });

  it('says that an archived project is read-only, and where admins restore it', async () => {
    const archived = { ...web, archived_at: '2026-10-01T10:00:00.000Z' };
    const { unmount } = renderSettings('general', {}, { project: archived });

    expect(await screen.findByText('Dieses Projekt ist archiviert')).toBeTruthy();
    expect(screen.getByText(/Unter Allgemein lässt es sich wiederherstellen\./)).toBeTruthy();
    unmount();
    api?.restore();

    signedIn = lene;
    renderSettings('general', {}, { project: { ...archived, my_role: 'member' } });
    expect(await screen.findByText('Es ist schreibgeschützt und aus Navigation und Views ausgeblendet.')).toBeTruthy();
  });
});

/* ----------------------------------------------------------------------- general */

describe('General', () => {
  it('sends only what changed', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'PATCH /api/v1/projects/p_web': (body) => ({ body: { data: { ...web, ...(body as object) } } }) }, { project: { ...web, image_url: '/media/abc' } });

    const name = await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Website');
    await user.type(screen.getByRole('textbox', { name: 'Beschreibung' }), ' Jetzt.');
    expect(screen.getByText('Klartext. 25 von 2.000 Zeichen.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Privat' }));
    expect(screen.getByText('Nur Mitglieder und Org-Admins sehen das Projekt.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Entfernen/ }));
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(toastTitles()).toContain('Einstellungen gespeichert'));
    expect(lastCall('PATCH', '/api/v1/projects/p_web')!.body).toEqual({ name: 'Website', description: 'Der neue Auftritt. Jetzt.', visibility: 'private', image_url: null });
  });

  it('makes the lead one of the active people among the members', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'PATCH /api/v1/projects/p_web': (body) => ({ body: { data: { ...web, ...(body as object) } } }) });

    await user.click(await screen.findByRole('combobox', { name: /Lead/ }));
    expect(await screen.findAllByRole('option')).toHaveLength(4);
    for (const name of ['Mara Lindqvist', 'Ida Brenner', 'Theo Okafor', 'Lene Vogt']) expect(screen.getByRole('option', { name })).toBeTruthy();
    await user.click(screen.getByRole('option', { name: 'Lene Vogt' }));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(lastCall('PATCH', '/api/v1/projects/p_web')!.body).toEqual({ lead_id: 'u_lene' }));
  });

  it('renames the identifier, with a word on the old keys', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'PATCH /api/v1/projects/p_web': () => ({ body: { data: { ...web, identifier: 'SITE' } } }) });

    const identifier = await screen.findByRole('textbox', { name: 'Kennung' });
    await user.clear(identifier);
    await user.type(identifier, 'site ');
    expect(screen.getByText('WEB-12 leitet danach auf SITE-12 um. Die API behält die alte Kennung als Alias, Links und Verweise bleiben gültig.')).toBeTruthy();
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(toastTitles()).toContain('Kennung geändert'));
    expect(toastNamed('Kennung geändert').description).toBe('WEB-12 heißt jetzt SITE-12. Alte Keys funktionieren weiter.');
    expect(lastCall('PATCH', '/api/v1/projects/p_web')!.body).toEqual({ identifier: 'SITE' });
  });

  it('says when there is nothing to save, and sets the form back', async () => {
    const user = userEvent.setup();
    renderSettings('general');

    await user.click(await screen.findByRole('button', { name: /Speichern/ }));
    expect(screen.getByText('Keine Änderungen zu speichern.')).toBeTruthy();

    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.type(name, '!');
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(name).toHaveProperty('value', 'Website-Relaunch');
    expect(calls('PATCH', '/api/v1/projects/p_web')).toHaveLength(0);
  });

  it('shows a refusal at its field with the focus there, and asks before leaving the edits', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'PATCH /api/v1/projects/p_web': () => problem(422, 'validation_failed', { errors: { identifier: ['Die Kennung ist schon vergeben.'] } }) });

    const identifier = await screen.findByRole('textbox', { name: 'Kennung' });
    await user.clear(identifier);
    await user.type(identifier, 'APP');
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    expect(await screen.findByText('Die Kennung ist schon vergeben.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(identifier));
    // the banner on the old keys waits until the identifier is valid
    expect(screen.queryByText('Alte Keys funktionieren weiter')).toBeNull();

    let allowed = true;
    act(() => {
      allowed = startVisit('/projects');
    });
    expect(allowed).toBe(false);
    expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
    expect(screen.getByText('Deine Änderungen am Projekt sind nicht gespeichert. Gehst du jetzt weiter, sind sie weg.')).toBeTruthy();
  });

  it('says why saving failed and tries again from the toast', async () => {
    const user = userEvent.setup();
    let answer: () => { status?: number; body?: unknown } = unavailable;
    renderSettings('general', { 'PATCH /api/v1/projects/p_web': () => answer() });

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), '!');
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(toastTitles()).toContain('Einstellungen nicht gespeichert'));

    answer = () => ({ body: { data: { ...web, name: 'Website-Relaunch!' } } });
    act(() => runToastAction(toastNamed('Einstellungen nicht gespeichert').id));
    await waitFor(() => expect(toastTitles()).toContain('Einstellungen gespeichert'));
  });

  it('says when the members or the people could not be loaded', async () => {
    renderSettings('general', { 'GET /api/v1/projects/p_web/members': unavailable });

    expect(await screen.findByText('Die Einstellungen konnten nicht geladen werden')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------- danger zone */

describe('DangerZone', () => {
  it('archives after the undo time, and not when it is taken back', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'POST /api/v1/projects/p_web/archive': () => ({ body: { data: { ...web, archived_at: '2026-10-31T10:00:00.000Z' } } }) });

    const archive = await screen.findByRole('button', { name: 'Archivieren' });
    await user.click(archive);
    act(() => runToastAction(toastNamed('Projekt WEB archiviert').id));
    expect(calls('POST', '/api/v1/projects/p_web/archive')).toHaveLength(0);

    await user.click(archive);
    act(() => dismissToast(toastNamed('Projekt WEB archiviert').id));
    await waitFor(() => expect(calls('POST', '/api/v1/projects/p_web/archive')).toHaveLength(1));
  });

  it('restores an archived project, and says why it could not', async () => {
    const user = userEvent.setup();
    let answer: () => { status?: number; body?: unknown } = unavailable;
    renderSettings('general', { 'POST /api/v1/projects/p_web/restore': () => answer() }, { project: { ...web, archived_at: '2026-10-01T10:00:00.000Z' } });

    expect(await screen.findByText('Dieses Projekt ist archiviert. Hier holst du es zurück oder löschst es endgültig.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(toastTitles()).toContain('Projekt nicht wiederhergestellt'));

    answer = () => ({ body: { data: web } });
    act(() => runToastAction(toastNamed('Projekt nicht wiederhergestellt').id));
    await waitFor(() => expect(toastTitles()).toContain('Projekt WEB wiederhergestellt'));
  });

  it('deletes only after the identifier is typed, leaves for the list and comes back on undo', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'DELETE /api/v1/projects/p_web': () => ({ status: 202 }) });

    await user.click(await screen.findByRole('button', { name: 'Projekt löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'WEB löschen?' });
    expect(within(dialog).getByText('„Website-Relaunch“ wird mit allem gelöscht, was darin liegt.')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Projekt löschen' });

    // a wrong identifier keeps the button blocked, and Enter in the field says what it wants
    const field = within(dialog).getByRole('textbox', { name: 'Kennung eintippen' });
    await user.type(field, 'web');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await user.keyboard('{Enter}');
    expect(inertia.visit).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByText('Das ist nicht die Kennung. Tippe genau WEB ein.')).toBeTruthy();
    // the message goes with the next edit
    await user.type(field, 'x');
    expect(field.getAttribute('aria-invalid')).toBeNull();

    await user.clear(field);
    await user.type(field, ' WEB ');
    expect(confirm.getAttribute('aria-disabled')).toBeNull();
    await user.click(confirm);

    expect(inertia.visit).toHaveBeenCalledWith('/projects');
    act(() => runToastAction(toastNamed('Projekt WEB gelöscht').id));
    expect(inertia.visit).toHaveBeenLastCalledWith(window.location.pathname);
    expect(calls('DELETE', '/api/v1/projects/p_web')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Projekt löschen …' }));
    const again = await screen.findByRole('dialog', { name: 'WEB löschen?' });
    // every question starts empty
    expect(within(again).getByRole('textbox', { name: 'Kennung eintippen' })).toHaveProperty('value', '');
    await user.type(within(again).getByRole('textbox', { name: 'Kennung eintippen' }), 'WEB{Enter}');
    act(() => dismissToast(toastNamed('Projekt WEB gelöscht').id));
    await waitFor(() => expect(calls('DELETE', '/api/v1/projects/p_web')).toHaveLength(1));
  });
});

/* ----------------------------------------------------------------------- members */

describe('Members', () => {
  const rows = () => within(screen.getByRole('list', { name: 'Mitglieder von WEB' })).getAllByRole('listitem');

  it('lists the members by role and name, with lead, org admin and bot marked', async () => {
    renderSettings('members');

    await screen.findByRole('list', { name: 'Mitglieder von WEB' });
    expect(rows().map((row) => row.querySelector('p')!.textContent)).toEqual(['Ida BrennerLead', 'KiraBot', 'Lene Vogt', 'Mara LindqvistOrg-Admin', 'Theo Okafor']);
    expect(within(rows()[0]!).getByRole('combobox', { name: 'Rolle von Ida Brenner' }).textContent).toContain('Admin');
    expect(within(rows()[0]!).getByRole('button', { name: 'Ida Brenner entfernen' }).getAttribute('aria-disabled')).toBe('true');
    expect(rows()[0]!.textContent).toContain('@ida');
  });

  it('marks the default bot', async () => {
    renderSettings('members', { 'GET /api/v1/projects/p_web/members': () => ({ body: list([member('u_automation', 'member')]) }) });
    expect(await screen.findByText('Standard-Bot')).toBeTruthy();
  });

  it('says when there are no members', async () => {
    renderSettings('members', { 'GET /api/v1/projects/p_web/members': () => ({ body: list([]) }) });
    expect(await screen.findByText('Noch keine Mitglieder')).toBeTruthy();
  });

  it('adds an active person or bot that is no member yet', async () => {
    const user = userEvent.setup();
    renderSettings('members', { 'POST /api/v1/projects/p_web/members': () => ({ status: 201, body: { data: member('u_jonas', 'viewer') } }) });

    const add = await screen.findByRole('button', { name: /Hinzufügen/ });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    const field = screen.getByRole('combobox', { name: 'Person oder Bot' });
    await user.click(field);
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Jonas Feld' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Automation' })).toBeTruthy();
    await user.click(screen.getByRole('option', { name: 'Jonas Feld' }));
    await user.click(within(screen.getByRole('form', { name: 'Mitglied hinzufügen' })).getByRole('combobox', { name: /^Rolle/ }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await user.click(add);

    await waitFor(() => expect(toastTitles()).toContain('Jonas Feld ist jetzt Viewer in WEB'));
    expect(lastCall('POST', '/api/v1/projects/p_web/members')!.body).toEqual({ user_id: 'u_jonas', role: 'viewer' });
    expect(document.activeElement).toBe(field);
  });

  it('says why adding failed and tries again from the toast', async () => {
    const user = userEvent.setup();
    renderSettings('members', { 'POST /api/v1/projects/p_web/members': unavailable });

    await user.click(await screen.findByRole('combobox', { name: 'Person oder Bot' }));
    await user.click(await screen.findByRole('option', { name: 'Jonas Feld' }));
    await user.click(screen.getByRole('button', { name: /Hinzufügen/ }));
    await waitFor(() => expect(toastTitles()).toContain('Mitglied nicht hinzugefügt'));

    act(() => runToastAction(toastNamed('Mitglied nicht hinzugefügt').id));
    await waitFor(() => expect(calls('POST', '/api/v1/projects/p_web/members')).toHaveLength(2));
  });

  it('changes the role of a member, and says why it could not', async () => {
    const user = userEvent.setup();
    let answer: () => { status?: number; body?: unknown } = () => ({ body: { data: member('u_lene', 'admin') } });
    renderSettings('members', { 'PATCH /api/v1/projects/p_web/members/u_lene': () => answer() });

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Lene Vogt' }));
    // the same role again changes nothing
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    await user.click(screen.getByRole('combobox', { name: 'Rolle von Lene Vogt' }));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));
    await waitFor(() => expect(toastTitles()).toContain('Lene Vogt ist jetzt Admin in WEB'));
    expect(calls('PATCH', '/api/v1/projects/p_web/members/u_lene')).toHaveLength(1);

    answer = unavailable;
    await user.click(screen.getByRole('combobox', { name: 'Rolle von Lene Vogt' }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await waitFor(() => expect(toastTitles()).toContain('Rolle nicht geändert'));
    act(() => runToastAction(toastNamed('Rolle nicht geändert').id));
    await waitFor(() => expect(calls('PATCH', '/api/v1/projects/p_web/members/u_lene')).toHaveLength(3));
  });

  it('asks before a project admin takes the own admin rights away', async () => {
    const user = userEvent.setup();
    renderSettings('members', { 'PATCH /api/v1/projects/p_web/members/u_ida': () => ({ body: { data: member('u_ida', 'member') } }) });

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Ida Brenner' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    const question = await screen.findByRole('alertdialog', { name: 'Dir die Admin-Rechte nehmen?' });
    expect(question.textContent).toContain('Danach kannst du die Einstellungen von WEB nicht mehr ändern.');
    await user.click(within(question).getByRole('button', { name: 'Abbrechen' }));
    expect(calls('PATCH', '/api/v1/projects/p_web/members/u_ida')).toHaveLength(0);

    await user.click(screen.getByRole('combobox', { name: 'Rolle von Ida Brenner' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rolle ändern' }));
    await waitFor(() => expect(toastTitles()).toContain('Ida Brenner ist jetzt Member in WEB'));
  });

  it('removes a member after the undo time', async () => {
    const user = userEvent.setup();
    renderSettings('members', { 'DELETE /api/v1/projects/p_web/members/u_theo': () => ({ status: 204 }) });

    await user.click(await screen.findByRole('button', { name: 'Theo Okafor entfernen' }));
    expect(screen.queryByText('Theo Okafor')).toBeNull();
    act(() => dismissToast(toastNamed('Theo Okafor aus WEB entfernt').id));
    await waitFor(() => expect(calls('DELETE', '/api/v1/projects/p_web/members/u_theo')).toHaveLength(1));
  });

  it('lets somebody who does not manage the project only read the members', async () => {
    signedIn = lene;
    renderSettings('members', {}, { project: { ...web, my_role: 'member' } });

    expect(await screen.findByRole('combobox', { name: 'Rolle von Lene Vogt' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('form', { name: 'Mitglied hinzufügen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Theo Okafor entfernen' })).toBeNull();
  });

  it('says when the members could not be loaded', async () => {
    renderSettings('members', { 'GET /api/v1/users': unavailable });

    expect(await screen.findByText('Die Mitglieder konnten nicht geladen werden')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------- workflow */

describe('Workflow', () => {
  /** Calls whose path contains `fragment` wait until `release()`; everything else answers at once. */
  let release = () => {};
  const holdCalls = (fragment: string) => {
    const fetching = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      String(input).includes(fragment) ? new Promise<Response>((resolve) => (release = () => resolve(fetching(input, init)))) : fetching(input, init);
  };
  /** The project as the server has it: the switch changes its workflow, and every reload reads the new one. */
  const switchable = () => {
    let stored = web;
    return {
      'GET /api/v1/projects/WEB': () => ({ body: { data: stored } }),
      'GET /api/v1/projects': () => ({ body: list([stored]) }),
      'PUT /api/v1/projects/p_web/workflow': (body: unknown) => {
        stored = { ...stored, workflow_id: (body as { workflow_id: string }).workflow_id };
        return { body: { data: stored } };
      },
    };
  };
  const chooseAgency = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('combobox', { name: /Neuer Workflow/ }));
    await user.click(await screen.findByRole('option', { name: 'Agentur-Freigabe' }));
  };

  it('shows the workflow of the project with its statuses and rules, and where org admins change it', async () => {
    const { unmount } = renderSettings('workflow');

    const heading = await screen.findByRole('heading', { level: 3, name: 'Standard' });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('Der Standard-Workflow: Jeder Status ist von überall erreichbar.')).toBeTruthy();
    const states = within(screen.getAllByRole('list', { name: 'Status des Workflows' })[0]!).getAllByRole('listitem');
    expect(states.map((state) => state.textContent)).toEqual(['Backlog', 'Todo', 'In Progress', 'Pending', 'Done', 'Cancelled']);
    expect(screen.getByText('Freie Übergänge: Jeder Status ist von überall erreichbar. Neue Items starten in „Backlog“.')).toBeTruthy();
    // a project admin who is no org admin does not get the way to the editor
    expect(screen.queryByRole('link', { name: 'Organisation, Workflows' })).toBeNull();
    unmount();
    api?.restore();

    signedIn = mara;
    renderSettings('workflow', {}, { project: { ...web, workflow_id: 'wf_agency' } });
    expect(await screen.findByRole('heading', { level: 3, name: 'Agentur-Freigabe' })).toBeTruthy();
    expect(screen.getByText('Mit Übergangsmatrix: 14 erlaubte Übergänge. Neue Items starten in „Backlog“.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Organisation, Workflows' }).getAttribute('href')).toBe('/settings/workflows?workflow=wf_agency');
    // the other one is offered with its mark
    await userEvent.setup().click(screen.getByRole('combobox', { name: /Neuer Workflow/ }));
    expect(await screen.findByRole('option', { name: 'Standard (Standard)' })).toBeTruthy();
  });

  it('says when the workflows could not be loaded and loads them again on request', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSettings('workflow', { 'GET /api/v1/workflows': () => (fail ? unavailable() : { body: list([standard, agency]) }) });

    expect(await screen.findByText('Der Workflow konnte nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Standard' })).toBeTruthy();
  });

  it('blocks the switch until a workflow is chosen, and says so', async () => {
    const user = userEvent.setup();
    renderSettings('workflow');

    const open = await screen.findByRole('button', { name: /Workflow wechseln …/ });
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(open.getAttribute('aria-describedby')!)!.textContent).toBe('Wähle zuerst den neuen Workflow.');
    await user.click(open);
    expect(screen.queryByRole('dialog')).toBeNull();

    await chooseAgency(user);
    expect(open.getAttribute('aria-disabled')).toBeNull();
    // the summary of the chosen one
    expect(screen.getByText('Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.')).toBeTruthy();
  });

  it('lets somebody who does not manage the project only read the workflow', async () => {
    signedIn = lene;
    renderSettings('workflow', {}, { project: { ...web, my_role: 'member' } });

    const open = await screen.findByRole('button', { name: /Workflow wechseln …/ });
    expect(document.getElementById(open.getAttribute('aria-describedby')!)!.textContent).toBe('Projekteinstellungen ändern dürfen nur Admins des Projekts WEB.');
    expect(screen.getByRole('combobox', { name: /Neuer Workflow/ })).toHaveProperty('disabled', true);
  });

  it('says when there is no other workflow', async () => {
    renderSettings('workflow', { 'GET /api/v1/workflows': () => ({ body: list([standard]) }) });

    expect(await screen.findByText('Es gibt keinen anderen Workflow. Org-Admins legen weitere in den Organisationseinstellungen an.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Neuer Workflow/ })).toBeNull();
  });

  it('switches after a plain confirmation with an empty mapping, then names the new workflow with the focus on it', async () => {
    const user = userEvent.setup();
    renderSettings('workflow', switchable());

    await chooseAgency(user);
    const open = screen.getByRole('button', { name: /Workflow wechseln …/ });
    await user.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Zu „Agentur-Freigabe“ wechseln' });
    expect(within(dialog).getByText('WEB nutzt bisher „Standard“. Neue Items starten im Startstatus „Backlog“.')).toBeTruthy();

    // "Cancel" goes back to the button that asked
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(open));

    await user.click(open);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Workflow wechseln/ }));

    await waitFor(() => expect(toastTitles()).toContain('Workflow gewechselt'));
    expect(toastNamed('Workflow gewechselt').description).toBe('WEB nutzt jetzt „Agentur-Freigabe“.');
    expect(lastCall('PUT', '/api/v1/projects/p_web/workflow')!.body).toEqual({ workflow_id: 'wf_agency', mapping: {} });
    const heading = await screen.findByRole('heading', { level: 3, name: 'Agentur-Freigabe' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // the choice is gone: the workflow it named is the current one now
    expect(screen.getByRole('combobox', { name: /Neuer Workflow/ }).textContent).toContain('Workflow wählen …');
    expect(screen.getByRole('button', { name: /Workflow wechseln …/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('stays open while the switch runs: Escape and "Abbrechen" do not close it', async () => {
    const user = userEvent.setup();
    renderSettings('workflow', switchable());
    holdCalls('/p_web/workflow');

    await chooseAgency(user);
    await user.click(screen.getByRole('button', { name: /Workflow wechseln …/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Workflow wechseln/ }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Abbrechen' }).getAttribute('aria-disabled')).toBe('true'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBe(dialog);

    act(() => release());
    await waitFor(() => expect(toastTitles()).toContain('Workflow gewechselt'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a refusal of the server as a notice in the dialog', async () => {
    const user = userEvent.setup();
    renderSettings('workflow', { 'PUT /api/v1/projects/p_web/workflow': () => problem(422, 'validation_failed', { errors: { workflow_id: ['Diesen Workflow gibt es nicht.'] } }) });

    await chooseAgency(user);
    await user.click(screen.getByRole('button', { name: /Workflow wechseln …/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Workflow wechseln/ }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Diesen Workflow gibt es nicht.');
    expect(toastTitles()).not.toContain('Workflow nicht gewechselt');
  });

  it('keeps the chosen workflow when the workflows fail to load again in the background', async () => {
    const user = userEvent.setup();
    let fail = false;
    const { client } = renderSettings('workflow', { 'GET /api/v1/workflows': () => (fail ? unavailable() : { body: list([standard, agency]) }) });

    await chooseAgency(user);
    fail = true;
    await act(() => client.refetchQueries());
    // the observers hear of the failure a tick later
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.getByRole('combobox', { name: /Neuer Workflow/ }).textContent).toContain('Agentur-Freigabe');
    expect(screen.getByRole('button', { name: /Workflow wechseln …/ }).getAttribute('aria-disabled')).toBeNull();
  });

  it('names a refusal of a retry from the toast in a toast when the dialog was closed meanwhile', async () => {
    const user = userEvent.setup();
    let answer = unavailable;
    renderSettings('workflow', { 'PUT /api/v1/projects/p_web/workflow': () => answer() });

    await chooseAgency(user);
    await user.click(screen.getByRole('button', { name: /Workflow wechseln …/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Workflow wechseln/ }));
    await waitFor(() => expect(toastTitles()).toContain('Workflow nicht gewechselt'));
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    answer = () => problem(422, 'validation_failed', { detail: 'Diesen Workflow gibt es nicht.', errors: { workflow_id: ['Diesen Workflow gibt es nicht.'] } });
    act(() => runToastAction(toastNamed('Workflow nicht gewechselt').id));

    await waitFor(() => expect(calls('PUT', '/api/v1/projects/p_web/workflow')).toHaveLength(2));
    await waitFor(() => expect(currentToasts().filter((entry) => entry.title === 'Workflow nicht gewechselt')).toHaveLength(1));
    expect(toastNamed('Workflow nicht gewechselt').description).toContain('Diesen Workflow gibt es nicht.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says why the switch failed and tries again from the toast', async () => {
    const user = userEvent.setup();
    let fail = true;
    const server = switchable();
    renderSettings('workflow', { ...server, 'PUT /api/v1/projects/p_web/workflow': (body) => (fail ? unavailable() : server['PUT /api/v1/projects/p_web/workflow'](body)) });

    await chooseAgency(user);
    await user.click(screen.getByRole('button', { name: /Workflow wechseln …/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Workflow wechseln/ }));
    await waitFor(() => expect(toastTitles()).toContain('Workflow nicht gewechselt'));
    expect(toastNamed('Workflow nicht gewechselt').description).toBe('Der Server ist gerade nicht erreichbar.');
    expect(screen.getByRole('dialog')).toBeTruthy();

    fail = false;
    act(() => runToastAction(toastNamed('Workflow nicht gewechselt').id));
    await waitFor(() => expect(toastTitles()).toContain('Workflow gewechselt'));
    expect(calls('PUT', '/api/v1/projects/p_web/workflow')).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------- types */

describe('Types', () => {
  const box = (name: string) => screen.getByRole('checkbox', { name: `${name} verwenden` });
  const radio = (name: string) => screen.getByRole('radio', { name: `${name} als Standardtyp` });
  const saved = (body: unknown) => ({ body: { data: { ...web, ...(body as object) } } });

  it('lists the types of the organisation with the ones the project has on, archived ones only while they are on', async () => {
    renderSettings('types', {}, { project: { ...web, enabled_type_ids: ['t_task', 't_bug', 't_legacy'] } });

    const rows = within(await screen.findByRole('list', { name: 'Typen der Organisation' })).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(box('Task').getAttribute('aria-checked')).toBe('true');
    expect(box('Epic').getAttribute('aria-checked')).toBe('false');
    // every checkbox keeps its tab stop next to the radios of the default type
    expect(box('Epic').tabIndex).toBe(0);
    expect(box('Altlast').getAttribute('aria-checked')).toBe('true');
    expect(within(rows[4]!).getByText('Archiviert')).toBeTruthy();
    expect(radio('Task')).toHaveProperty('checked', true);
    // only types that are on can be the default
    expect(radio('Epic')).toHaveProperty('disabled', true);

    api?.restore();
    renderSettings('types');
    await screen.findAllByRole('list', { name: 'Typen der Organisation' });
    // an archived type the project does not have stays out
    expect(screen.getAllByRole('checkbox', { name: 'Altlast verwenden' })).toHaveLength(1);
  });

  it('lets the default follow when its type is switched off, and sends only what changed', async () => {
    const user = userEvent.setup();
    renderSettings('types', { 'PATCH /api/v1/projects/p_web': saved });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    await user.click(box('Task'));
    expect(radio('Bug')).toHaveProperty('checked', true);
    await user.click(box('Kundenwunsch'));
    await user.click(radio('Kundenwunsch'));
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(toastTitles()).toContain('Einstellungen gespeichert'));
    expect(lastCall('PATCH', '/api/v1/projects/p_web')!.body).toEqual({ enabled_type_ids: ['t_bug', 't_epic', 't_wish'], default_type_id: 't_wish' });
  });

  it('keeps the last active type on', async () => {
    const user = userEvent.setup();
    renderSettings('types', {}, { project: { ...web, enabled_type_ids: ['t_task', 't_legacy'] } });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    expect(box('Task').hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByText('Mindestens ein Typ bleibt aktiv.')).toBeTruthy();
    // the archived one may go; the active one stays
    expect(box('Altlast').hasAttribute('data-disabled')).toBe(false);
    await user.click(box('Bug'));
    expect(box('Task').hasAttribute('data-disabled')).toBe(false);
    expect(screen.queryByText('Mindestens ein Typ bleibt aktiv.')).toBeNull();
  });

  it('never makes an archived type the default: its radio is blocked with the reason', async () => {
    const user = userEvent.setup();
    renderSettings('types', { 'PATCH /api/v1/projects/p_web': saved }, { project: { ...web, enabled_type_ids: ['t_task', 't_legacy'] } });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    const archived = radio('Altlast');
    expect(archived).toHaveProperty('disabled', true);
    const why = document.getElementById(archived.getAttribute('aria-describedby')!)!;
    expect(why.textContent).toBe('Ein archivierter Typ kann nicht Standardtyp sein.');
    // in the row for everybody to read: the blocked radio takes no focus, a tooltip alone would be out of reach
    expect(why.hidden).toBe(false);
    expect(screen.getByText('Ein archivierter Typ kann nicht Standardtyp sein.')).toBe(why);
    expect(radio('Task').getAttribute('aria-describedby')).toBeNull();

    // the counter-check: a click on it would have sent the archived type as the default; blocked, nothing changes
    await user.click(archived);
    expect(radio('Task')).toHaveProperty('checked', true);
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    expect(screen.getByText('Keine Änderungen zu speichern.')).toBeTruthy();

    // switched off it stays in the list, and on again it is the one the project had
    await user.click(box('Altlast'));
    expect(box('Altlast').getAttribute('aria-checked')).toBe('false');
    await user.click(box('Altlast'));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    expect(calls('PATCH', '/api/v1/projects/p_web')).toHaveLength(0);
  });

  it('shows a refusal of the server below the list, with the focus on the default type', async () => {
    const user = userEvent.setup();
    renderSettings('types', { 'PATCH /api/v1/projects/p_web': () => problem(422, 'validation_failed', { errors: { default_type_id: ['Ein archivierter Typ kann nicht Standardtyp sein.'] } }) });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    await user.click(radio('Bug'));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    expect((await screen.findByRole('alert')).textContent).toBe('Ein archivierter Typ kann nicht Standardtyp sein.');
    const group = screen.getByRole('group', { name: 'Standardtyp' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(group));

    // a new choice takes the refusal away
    await user.click(radio('Epic'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when there is nothing to save, sets the form back, and asks before leaving the edits', async () => {
    const user = userEvent.setup();
    renderSettings('types');

    await user.click(await screen.findByRole('button', { name: /Speichern/ }));
    expect(screen.getByText('Keine Änderungen zu speichern.')).toBeTruthy();

    await user.click(box('Epic'));
    let allowed = true;
    act(() => {
      allowed = startVisit('/projects');
    });
    expect(allowed).toBe(false);
    expect(await screen.findByText('Deine Änderungen an den Typen sind nicht gespeichert. Gehst du jetzt weiter, sind sie weg.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));

    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(box('Epic').getAttribute('aria-checked')).toBe('true');
    expect(calls('PATCH', '/api/v1/projects/p_web')).toHaveLength(0);
  });

  it('says why saving failed and tries again from the toast', async () => {
    const user = userEvent.setup();
    let answer: (body: unknown) => { status?: number; body?: unknown } = unavailable;
    renderSettings('types', { 'PATCH /api/v1/projects/p_web': (body) => answer(body) });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    await user.click(box('Epic'));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(toastTitles()).toContain('Typen nicht gespeichert'));

    answer = saved;
    act(() => runToastAction(toastNamed('Typen nicht gespeichert').id));
    await waitFor(() => expect(toastTitles()).toContain('Einstellungen gespeichert'));
  });

  it('lets somebody who does not manage the project only read the types', async () => {
    signedIn = lene;
    renderSettings('types', {}, { project: { ...web, my_role: 'member' } });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    expect(box('Epic').hasAttribute('data-disabled')).toBe(true);
    expect(radio('Bug')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /Speichern/ })).toBeNull();
  });

  it('keeps the draft when the types fail to load again in the background', async () => {
    const user = userEvent.setup();
    let fail = false;
    const { client } = renderSettings('types', { 'GET /api/v1/work-item-types': () => (fail ? unavailable() : { body: list([...types, legacy]) }) });

    await screen.findByRole('list', { name: 'Typen der Organisation' });
    await user.click(box('Epic'));
    fail = true;
    await act(() => client.refetchQueries());
    // the observers hear of the failure a tick later
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.queryByText('Die Typen konnten nicht geladen werden')).toBeNull();
    expect(box('Epic').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
  });

  it('says when the types could not be loaded and loads them again on request', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSettings('types', { 'GET /api/v1/work-item-types': () => (fail ? unavailable() : { body: list(types) }) });

    expect(await screen.findByText('Die Typen konnten nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('list', { name: 'Typen der Organisation' })).toBeTruthy();
  });
});
