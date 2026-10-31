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
import { ida, lene, list, mara, organization, person, project, theo } from '@/test/fixtures';
import type { ProjectMember, User } from '@/types';
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
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectSettings identifier={identifier} section={section} />
    </QueryClientProvider>,
  );
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
    renderSettings('workflow');

    expect(await screen.findByText('Diesen Bereich gibt es nicht')).toBeTruthy();
    expect(screen.getByText('Die Einstellungen von WEB haben die Bereiche Allgemein und Mitglieder.')).toBeTruthy();
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
