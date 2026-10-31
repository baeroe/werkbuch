/*
 * The projects overview, its dialog "New project" and the star against a fake REST API (`mockApi`): the branches
 * Playwright does not reach sensibly (load failures, empty states, refusals). The main flows run in
 * e2e/tests/projects.spec.ts and e2e/tests/onboarding.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, lene, list, mara, organization, project, standard, types } from '@/test/fixtures';
import type { Project, User } from '@/types';
import { ProjectsScreen } from './ProjectsScreen';

const inertia = vi.hoisted(() => ({ replace: vi.fn(), visit: vi.fn(), url: '/projects' }));
let signedIn: User = lene;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: inertia.url }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  router: { replace: inertia.replace, visit: inertia.visit, reload: vi.fn(), on: () => () => {} },
}));

/* -------------------------------------------------------------------------- data */

const web = project('WEB', 'member', { name: 'Website-Relaunch', description: 'Der neue Auftritt.' });
const app = project('APP', 'viewer', { name: 'Kunden-App', lead_id: 'u_mara', is_member: false });
const ops = project('OPS', 'admin', { name: 'Infrastruktur', visibility: 'private', is_member: false, lead_id: 'u_gone' });
const old = project('OLD', 'admin', { name: 'Altes Projekt', archived_at: '2026-09-01T10:00:00.000Z' });

const archivedType = { ...types[0]!, id: 't_old', name: 'Altlast', archived_at: '2026-09-01T10:00:00.000Z' };

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

function renderScreen(overrides: Record<string, MockRoute> = {}, { create = false, offline = false, hold = '' } = {}) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([web, app, old]) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/favorites': () => ({ body: list([{ user_id: 'u_lene', kind: 'project', id: 'p_web', position: 0 }]) }),
    'GET /api/v1/workflows': () => ({ body: list([agency, standard]) }),
    'GET /api/v1/work-item-types': () => ({ body: list([...types, archivedType]) }),
    ...overrides,
  });
  if (offline) globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  // calls to a path with `hold` in it never answer
  const fetching = globalThis.fetch;
  if (hold) globalThis.fetch = (input, init) => (String(input).includes(hold) ? new Promise<Response>(() => {}) : fetching(input, init));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProjectsScreen create={create} />
      </QueryClientProvider>,
    ),
  };
}

const toastTitles = () => currentToasts().map((entry) => entry.title);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title)!;
const lastCall = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.startsWith(path)).at(-1);
const cards = () => within(screen.getByRole('list', { name: 'Alle Projekte' })).getAllByRole('listitem');
const card = (name: string) => cards().find((entry) => entry.textContent?.includes(name))!;

beforeEach(() => {
  inertia.url = '/projects';
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = lene;
  inertia.replace.mockReset();
  inertia.visit.mockReset();
  act(() => resetToasts());
});

/* ---------------------------------------------------------------------- overview */

describe('ProjectsScreen', () => {
  it('shows the projects as cards by name, with lead, visibility and what the person is there', async () => {
    renderScreen();

    expect(screen.getByText('Projekte werden geladen …')).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Alle Projekte' })).toBeTruthy();
    expect(document.title).toBe('Projekte – werkbuch');
    // archived ones wait behind the switch
    expect(cards().map((entry) => entry.querySelector('h2')!.textContent)).toEqual(['Kunden-App', 'Website-Relaunch']);

    const website = card('Website-Relaunch');
    expect(within(website).getByRole('link', { name: 'Website-Relaunch' }).getAttribute('href')).toBe('/projects/WEB');
    expect(website.textContent).toContain('Der neue Auftritt.');
    expect(website.textContent).toContain('Ida Brenner');
    expect(website.textContent).toContain('Öffentlich');
    expect(website.textContent).toContain('Deine Rolle: Member');

    // a public project of others: read along, or join
    const kunden = card('Kunden-App');
    expect(kunden.textContent).toContain('Keine Beschreibung.');
    expect(kunden.textContent).toContain('Mara Lindqvist');
    expect(kunden.textContent).toContain('Du liest nur mit.');
    expect(within(kunden).getByRole('button', { name: 'Beitreten' })).toBeTruthy();
  });

  it('shows an org admin private projects without a membership, and no "reading along" in public ones', async () => {
    signedIn = mara;
    renderScreen({ 'GET /api/v1/projects': () => ({ body: list([web, app, ops]) }) });

    await screen.findByRole('list', { name: 'Alle Projekte' });
    const infra = card('Infrastruktur');
    expect(infra.textContent).toContain('Privat');
    expect(infra.textContent).toContain('Kein Mitglied');
    expect(infra.textContent).toContain('Unbekannt');
    expect(card('Kunden-App').textContent).not.toContain('Du liest nur mit.');
    expect(within(card('Kunden-App')).getByRole('button', { name: 'Beitreten' })).toBeTruthy();
  });

  it('keeps the switch for archived projects in the address, and shows them read-only', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('switch', { name: 'Archivierte zeigen' }));
    expect(inertia.replace).toHaveBeenCalledWith(expect.objectContaining({ url: '/projects?archived=1', preserveState: true }));
  });

  it('shows the archived projects when the address asks for them, and leaves them again', async () => {
    const user = userEvent.setup();
    inertia.url = '/projects?archived=1&sort=name';
    renderScreen();

    expect(await screen.findByText('Altes Projekt')).toBeTruthy();
    expect(card('Altes Projekt').textContent).toContain('Archiviert');
    await user.click(screen.getByRole('switch', { name: 'Archivierte zeigen' }));
    expect(inertia.replace).toHaveBeenCalledWith(expect.objectContaining({ url: '/projects?sort=name' }));
  });

  it('says when the projects could not be loaded and loads them again on request', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderScreen({ 'GET /api/v1/projects': () => (fail ? unavailable() : { body: list([web]) }) });

    expect(await screen.findByText('Die Projekte konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Website-Relaunch')).toBeTruthy();
  });

  it('says that the server did not answer when there was no answer at all', async () => {
    renderScreen({}, { offline: true });

    expect(await screen.findByText('Der Server hat nicht geantwortet.')).toBeTruthy();
  });

  it('invites to the first project while there is none', async () => {
    const user = userEvent.setup();
    renderScreen({ 'GET /api/v1/projects': () => ({ body: list([]) }) });

    expect(await screen.findByText('Noch keine Projekte')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'Neues Projekt' }).at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'Neues Projekt' })).toBeTruthy();
  });

  it('says that every project is archived and offers to show them', async () => {
    const user = userEvent.setup();
    renderScreen({ 'GET /api/v1/projects': () => ({ body: list([old]) }) });

    expect(await screen.findByText('Alle Projekte sind archiviert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Archivierte zeigen' }));
    expect(inertia.replace).toHaveBeenCalledWith(expect.objectContaining({ url: '/projects?archived=1' }));
  });

  it('joins a public project with one click, and keeps the focus on its card', async () => {
    const user = userEvent.setup();
    let joined = false;
    renderScreen({
      'GET /api/v1/projects': () => ({ body: list([web, joined ? { ...app, my_role: 'member', is_member: true } : app, old]) }),
      'POST /api/v1/projects/p_app/join': () => {
        joined = true;
        return { status: 201, body: { data: { project_id: 'p_app', user_id: 'u_lene', role: 'member' } } };
      },
    });

    await screen.findByText('Kunden-App');
    await user.click(within(card('Kunden-App')).getByRole('button', { name: 'Beitreten' }));

    await waitFor(() => expect(toastTitles()).toContain('Du bist Kunden-App beigetreten'));
    // the button is gone with the membership: the focus is on the card's link, not on the page
    expect(within(card('Kunden-App')).queryByRole('button', { name: 'Beitreten' })).toBeNull();
    expect(card('Kunden-App').textContent).toContain('Deine Rolle: Member');
    expect(document.activeElement).toBe(within(card('Kunden-App')).getByRole('link', { name: 'Kunden-App' }));
  });

  it('says why joining failed, and tries again from the toast when the server failed', async () => {
    const user = userEvent.setup();
    let answer: () => { status?: number; body?: unknown } = unavailable;
    renderScreen({ 'POST /api/v1/projects/p_app/join': () => answer() });

    await screen.findByText('Kunden-App');
    await user.click(within(card('Kunden-App')).getByRole('button', { name: 'Beitreten' }));
    await waitFor(() => expect(toastTitles()).toContain('Beitritt zu Kunden-App nicht möglich'));
    expect(toastNamed('Beitritt zu Kunden-App nicht möglich').description).toBe('Der Server ist gerade nicht erreichbar.');

    answer = () => ({ status: 201, body: { data: { project_id: 'p_app', user_id: 'u_lene', role: 'member' } } });
    act(() => runToastAction(toastNamed('Beitritt zu Kunden-App nicht möglich').id));
    await waitFor(() => expect(toastTitles()).toContain('Du bist Kunden-App beigetreten'));
  });

  it('puts a project into the sidebar with the star, which waits for the favorites', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/favorites/toggle': () => ({ body: { kind: 'project', id: 'p_app', favorite: true } }) });

    await screen.findByText('Kunden-App');
    const star = within(card('Kunden-App')).getByRole('button', { name: '„Kunden-App“ in die Seitenleiste legen' });
    await waitFor(() => expect(star.getAttribute('aria-disabled')).toBeNull());
    expect(within(card('Website-Relaunch')).getByRole('button', { name: '„Website-Relaunch“ aus der Seitenleiste nehmen' })).toBeTruthy();

    await user.click(star);
    expect(lastCall('POST', '/api/v1/favorites/toggle')!.body).toEqual({ kind: 'project', id: 'p_app' });
  });

  it('keeps the star focusable and says why while the favorites load or could not be loaded', async () => {
    const user = userEvent.setup();
    renderScreen({ 'GET /api/v1/favorites': unavailable });

    await screen.findByText('Kunden-App');
    const star = within(card('Kunden-App')).getByRole('button', { name: '„Kunden-App“ in die Seitenleiste legen' });
    expect(star.getAttribute('aria-disabled')).toBe('true');
    expect(star.hasAttribute('disabled')).toBe(false);
    await waitFor(() => expect(star.textContent).toContain('Die Favoriten konnten nicht geladen werden.'));
    await user.click(star);
    expect(api!.calls.some((call) => call.url === '/api/v1/favorites/toggle')).toBe(false);
  });

  it('says that the favorites are on their way while they load', async () => {
    renderScreen({}, { hold: '/favorites' });

    await screen.findByText('Kunden-App');
    const star = within(card('Kunden-App')).getByRole('button', { name: '„Kunden-App“ in die Seitenleiste legen' });
    expect(star.getAttribute('aria-disabled')).toBe('true');
    expect(star.textContent).toContain('Favoriten werden geladen …');
  });

  it('says why the star could not change, and tries again from the toast', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/favorites/toggle': unavailable });

    await screen.findByText('Kunden-App');
    const star = within(card('Kunden-App')).getByRole('button', { name: '„Kunden-App“ in die Seitenleiste legen' });
    await waitFor(() => expect(star.getAttribute('aria-disabled')).toBeNull());
    await user.click(star);
    await waitFor(() => expect(toastTitles()).toContain('Favorit nicht geändert'));

    act(() => runToastAction(toastNamed('Favorit nicht geändert').id));
    await waitFor(() => expect(api!.calls.filter((call) => call.url === '/api/v1/favorites/toggle')).toHaveLength(2));
  });
});

/* ------------------------------------------------------------------- new project */

describe('CreateProjectDialog', () => {
  const created = (input: Partial<Project>) => project(String(input.identifier), 'admin', { id: 'p_new', name: String(input.name), visibility: input.visibility });

  it('opens once when the address asks for it, and takes the request out of the address', async () => {
    renderScreen({}, { create: true });

    expect(await screen.findByRole('dialog', { name: 'Neues Projekt' })).toBeTruthy();
    expect(inertia.replace).toHaveBeenCalledOnce();
    const options = inertia.replace.mock.calls[0]![0] as { url: string; props: (props: Record<string, unknown>) => Record<string, unknown> };
    expect(options.url).toBe('/');
    expect(options.props({ create: true, other: 1 })).toEqual({ create: false, other: 1 });
  });

  it('suggests the identifier from the name, knows the taken ones, and creates the project', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/projects': (body) => ({ status: 201, body: { data: created(body as Partial<Project>) } }) });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await within(dialog).findByRole('textbox', { name: 'Name' });
    const identifier = within(dialog).getByRole('textbox', { name: 'Kennung' });
    expect(within(dialog).getByText(/Die Items heißen dann KEY-1, KEY-2 und so weiter\./)).toBeTruthy();

    // WEB is taken: the second candidate
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Website Relaunch');
    expect(identifier).toHaveProperty('value', 'WER');
    expect(within(dialog).getByText(/^Vorschlag aus dem Namen\. 2 bis 10/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Privat' }));
    expect(within(dialog).getByText('Nur Mitglieder und Org-Admins sehen das Projekt.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Projekt anlegen/ }));

    await waitFor(() => expect(toastTitles()).toContain('Projekt WER angelegt'));
    expect(lastCall('POST', '/api/v1/projects')!.body).toEqual({
      name: 'Website Relaunch',
      identifier: 'WER',
      visibility: 'private',
      workflow_id: 'wf_standard',
      enabled_type_ids: ['t_task', 't_bug', 't_epic', 't_wish'],
      default_type_id: 't_task',
    });
    expect(useUiStore.getState().flashIds).toContain('p_new');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Neues Projekt' })).toBeNull());

    act(() => runToastAction(toastNamed('Projekt WER angelegt').id));
    expect(inertia.visit).toHaveBeenCalledWith('/projects/WER');
  });

  it('keeps an identifier the person wrote, in capitals', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/projects': (body) => ({ status: 201, body: { data: created(body as Partial<Project>) } }) });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await within(dialog).findByRole('textbox', { name: 'Name' });
    const identifier = within(dialog).getByRole('textbox', { name: 'Kennung' });
    await user.clear(identifier);
    await user.type(identifier, 'site');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Website');
    expect(identifier).toHaveProperty('value', 'SITE');
    expect(within(dialog).queryByText(/^Vorschlag aus dem Namen/)).toBeNull();
  });

  it('shows the refusal of the server at the identifier, with the focus there, and drops it when the field changes', async () => {
    const user = userEvent.setup();
    renderScreen({
      'POST /api/v1/projects': () => problem(422, 'validation_failed', { errors: { identifier: ['Die Kennung ist schon vergeben.'] } }),
    });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await within(dialog).findByRole('textbox', { name: 'Name' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Betrieb');
    await user.click(within(dialog).getByRole('button', { name: /Projekt anlegen/ }));

    const identifier = within(dialog).getByRole('textbox', { name: 'Kennung' });
    expect(await within(dialog).findByText('Die Kennung ist schon vergeben.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(identifier));
    expect(identifier.getAttribute('aria-invalid')).toBe('true');

    // the name changes the suggestion and with it the identifier: its error goes, the focus stays where it is
    await user.click(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'x');
    expect(within(dialog).queryByText('Die Kennung ist schon vergeben.')).toBeNull();
  });

  it('shows refusals without a field of their own above the buttons', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/projects': () => problem(422, 'validation_failed', { errors: { lead_id: ['Die Person gibt es nicht.'] } }) });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await within(dialog).findByRole('textbox', { name: 'Name' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Betrieb');
    await user.click(within(dialog).getByRole('button', { name: /Projekt anlegen/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Das Projekt ist nicht gültig');
    expect(alert.textContent).toContain('Die Person gibt es nicht.');
  });

  it('waits with the form until the workflows and types are there, and says so on the button', async () => {
    const user = userEvent.setup();
    renderScreen({}, { hold: '/work-item-types' });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    expect(within(dialog).getByText('Das Formular wird geladen …')).toBeTruthy();
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).toBeNull();
    const send = within(dialog).getByRole('button', { name: /Projekt anlegen/ });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(send.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(send.getAttribute('aria-describedby')!)!.textContent).toBe('Das Formular lädt noch …');
  });

  it('preselects the default workflow and every active type, and sends what it picks with the topmost type as the default', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/projects': (body) => ({ status: 201, body: { data: created(body as Partial<Project>) } }) });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    const name = await within(dialog).findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    const workflow = within(dialog).getByRole('combobox', { name: /Workflow/ });
    expect(workflow.textContent).toContain('Standard');
    expect(within(dialog).getByText('Der Standard-Workflow: Jeder Status ist von überall erreichbar.')).toBeTruthy();
    // archived types are not offered
    expect(within(dialog).queryByText('Altlast')).toBeNull();
    expect(within(dialog).getByText('Standardtyp ist Task, der oberste angehakte.')).toBeTruthy();

    await user.type(name, 'Agentur');
    await user.click(workflow);
    await user.click(await screen.findByRole('option', { name: 'Agentur-Freigabe' }));
    expect(within(dialog).getByText('Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.')).toBeTruthy();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Task' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Kundenwunsch' }));
    expect(within(dialog).getByText('Standardtyp ist Bug, der oberste angehakte.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Projekt anlegen/ }));

    await waitFor(() => expect(toastTitles()).toContain('Projekt AGE angelegt'));
    expect(lastCall('POST', '/api/v1/projects')!.body).toEqual({
      name: 'Agentur',
      identifier: 'AGE',
      visibility: 'public',
      workflow_id: 'wf_agency',
      enabled_type_ids: ['t_bug', 't_epic'],
      default_type_id: 't_bug',
    });
  });

  it('says that a type must stay ticked, and shows the refusal of the server at the list of types', async () => {
    const user = userEvent.setup();
    renderScreen({
      'POST /api/v1/projects': () => problem(422, 'validation_failed', { errors: { enabled_type_ids: ['Mindestens ein Typ muss aktiviert sein.'] } }),
    });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await user.type(await within(dialog).findByRole('textbox', { name: 'Name' }), 'Leer');
    for (const name of ['Task', 'Bug', 'Epic', 'Kundenwunsch']) await user.click(within(dialog).getByRole('checkbox', { name }));
    expect(within(dialog).getByText('Mindestens ein Typ muss aktiviert sein.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Projekt anlegen/ }));

    const task = within(dialog).getByRole('checkbox', { name: 'Task' });
    await waitFor(() => expect(task.getAttribute('aria-invalid')).toBe('true'));
    await waitFor(() => expect(document.activeElement).toBe(task));
    // the box with the focus names the error, not only the live region
    expect(document.getElementById(task.getAttribute('aria-describedby')!)!.textContent).toBe('Mindestens ein Typ muss aktiviert sein.');
    expect(lastCall('POST', '/api/v1/projects')!.body).toMatchObject({ enabled_type_ids: [] });
    expect(lastCall('POST', '/api/v1/projects')!.body).not.toHaveProperty('default_type_id');
    expect(within(dialog).queryByRole('alert')).toBeNull();

    // ticking a type again takes the error away
    await user.click(task);
    expect(task.getAttribute('aria-invalid')).toBeNull();
    expect(within(dialog).getByText('Standardtyp ist Task, der oberste angehakte.')).toBeTruthy();
  });

  it('keeps the form and what is typed in it when the catalogs fail to load again in the background', async () => {
    const user = userEvent.setup();
    let fail = false;
    const { client } = renderScreen({
      'GET /api/v1/workflows': () => (fail ? unavailable() : { body: list([agency, standard]) }),
      'GET /api/v1/work-item-types': () => (fail ? unavailable() : { body: list([...types, archivedType]) }),
    });
    await screen.findByText('Kunden-App');
    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await user.type(await within(dialog).findByRole('textbox', { name: 'Name' }), 'Halb fertig');

    fail = true;
    await act(() => client.refetchQueries());
    // the observers hear of the failure a tick later
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Halb fertig');
  });

  it('says when the workflows or the types could not be loaded, and loads them again on request', async () => {
    const user = userEvent.setup();
    let failWorkflows = true;
    let failTypes = true;
    renderScreen({
      'GET /api/v1/workflows': () => (failWorkflows ? unavailable() : { body: list([standard]) }),
      'GET /api/v1/work-item-types': () => (failTypes ? unavailable() : { body: list(types) }),
    });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Workflows und Typen konnten nicht geladen werden');
    expect(alert.textContent).toContain('Ohne sie lässt sich kein Projekt anlegen.');
    const send = within(dialog).getByRole('button', { name: /Projekt anlegen/ });
    expect(document.getElementById(send.getAttribute('aria-describedby')!)!.textContent).toBe('Ohne Workflows und Typen lässt sich kein Projekt anlegen.');

    // only the types fail now: one more try loads what failed
    failWorkflows = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/workflows'))).toHaveLength(2));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    failTypes = false;
    await user.click(within(within(dialog).getByRole('alert')).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(dialog).findByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/workflows'))).toHaveLength(2);
  });

  it('creates one project for a double send, and says when the server failed', async () => {
    const user = userEvent.setup();
    renderScreen({ 'POST /api/v1/projects': unavailable });
    await screen.findByText('Kunden-App');

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await within(dialog).findByRole('textbox', { name: 'Name' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Betrieb');
    const form = dialog.querySelector('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    await waitFor(() => expect(toastTitles()).toContain('Projekt nicht angelegt'));
    expect(api!.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    act(() => runToastAction(toastNamed('Projekt nicht angelegt').id));
    await waitFor(() => expect(api!.calls.filter((call) => call.method === 'POST')).toHaveLength(2));
  });
});
