/*
 * The organisation settings against a fake REST API (`mockApi`): the branches Playwright does not reach sensibly (load
 * failures, refusals, one's own account, the last admin, expired tokens, pictures). The main flows run in
 * e2e/tests/settings-organization.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { lene, list, mara, organization, person, project } from '@/test/fixtures';
import type { Invitation, Token, User } from '@/types';
import { handleFrom } from './Bots';
import { OrgSettings } from './OrgSettings';

const inertia = vi.hoisted(() => ({ reload: vi.fn() }));
let signedIn: User = mara;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: inertia.reload, visit: vi.fn(), on: () => () => {} },
}));

/* -------------------------------------------------------------------------- data */

const sven: User = { ...person('u_sven', 'Sven Albers', 'sven'), disabled_at: '2026-09-18T15:00:00.000Z' };
const jonas = person('u_jonas', 'Jonas Feld', 'jonas', 'admin');
const automation: User = {
  ...person('u_automation', 'Automation', 'automation', 'admin'),
  type: 'bot',
  email: null,
  is_default_bot: true,
  description: 'Der Standard-Bot.',
};
const kira: User = { ...person('u_kira', 'Kira', 'kira'), type: 'bot', email: null, owner_id: 'u_mara', description: 'Bot von Mara.' };
const rex: User = { ...person('u_rex', 'Rex', 'rex'), type: 'bot', email: null, owner_id: 'u_gone', disabled_at: '2026-10-01T10:00:00.000Z' };

const web = project('WEB', 'admin', { name: 'Website-Relaunch' });
const app = project('APP', 'admin', { name: 'Kunden-App' });

const invitation = (changes: Partial<Invitation> = {}): Invitation => ({
  id: 'inv_1',
  email: 'nora@example.com',
  org_role: 'member',
  projects: [{ project_id: 'p_web', role: 'viewer' }],
  link: 'https://werkbuch.example.com/invitations/inv_1?signature=abc',
  state: 'open',
  created_by: 'u_mara',
  created_at: '2026-10-28T10:00:00.000Z',
  expires_at: '2026-11-04T10:00:00.000Z',
  ...changes,
});

const token = (id: string, changes: Partial<Token> = {}): Token => ({
  id,
  user_id: 'u_kira',
  name: `Token ${id}`,
  abilities: ['read'],
  expires_at: null,
  last_used_at: null,
  created_at: '2026-10-05T12:30:00.000Z',
  ...changes,
});

/** The accounts endpoint with its type filter, all on one page. */
const accounts =
  (all: User[]): MockRoute =>
  (_body, url) => ({ body: list(all.filter((user) => !url.searchParams.get('type') || user.type === url.searchParams.get('type'))) });

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

function routes(overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  return {
    'GET /api/v1/projects': () => ({ body: list([web, app]) }),
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/users': accounts([mara, lene, sven, automation, kira]),
    'GET /api/v1/invitations': () => ({ body: list([invitation()]) }),
    'GET /api/v1/tokens': (_body, url) => ({
      body: list(
        url.searchParams.get('user_id') === 'u_kira'
          ? [
              token('t_old', { name: 'CI-Skript', expires_at: '2026-09-30T21:59:00.000Z', last_used_at: '2026-09-29T20:15:00.000Z' }),
              token('t_mcp', { name: 'MCP', abilities: ['read', 'write', 'mcp'], expires_at: '2099-01-01T12:00:00.000Z' }),
              token('t_new', { name: 'Neu' }),
            ]
          : [],
      ),
    }),
    ...overrides,
  };
}

function renderSettings(section: string, overrides: Record<string, MockRoute> = {}) {
  api = mockApi(routes(overrides));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrgSettings section={section} />
    </QueryClientProvider>,
  );
}

const toastTitles = () => currentToasts().map((entry) => entry.title);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title)!;
const lastCall = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.startsWith(path)).at(-1);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-30T09:00:00.000Z'));
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = mara;
  inertia.reload.mockReset();
  resetToasts();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------- frame */

describe('OrgSettings', () => {
  it('lists the sections of the organisation and marks the current one; the tab is named after it', async () => {
    renderSettings('general');

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByText('Organisation')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Allgemein' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Personen' }).getAttribute('href')).toBe('/settings/people');
    expect(within(nav).getByRole('link', { name: 'Bots' }).getAttribute('href')).toBe('/settings/bots');
    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeTruthy();
    expect(document.title).toBe('Allgemein – Einstellungen – werkbuch');
    // the rights are on their way: the section waits in outline
    expect(screen.getByText('Allgemein wird geladen …')).toBeTruthy();
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('says that an unknown section does not exist, keeps the list and leads to General', () => {
    renderSettings('nothing');

    expect(screen.getByText('Diesen Bereich gibt es nicht')).toBeTruthy();
    expect(screen.getByText('„nothing“ gehört nicht zu den Einstellungen der Organisation. Die Liste links zeigt, was es gibt.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zu Allgemein' }).getAttribute('href')).toBe('/settings/general');
    expect(screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' }).querySelector('[aria-current]')).toBeNull();
    expect(document.title).toBe('Einstellungen – werkbuch');
  });

  it('tells a member that people and bots are for admins, with a lock in the list', async () => {
    signedIn = lene;
    renderSettings('people');

    expect(await screen.findByText('Nur für Admins')).toBeTruthy();
    expect(screen.getByText(/Organisation, Personen, Bots und Webhooks verwalten nur Org-Admins\. .*„Personen“/)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByRole('link', { name: /Personen/ }).textContent).toContain('nur für Admins');
    expect(within(nav).getByRole('link', { name: 'Allgemein' }).textContent).not.toContain('nur für Admins');
    expect(api!.calls.some((call) => call.url.startsWith('/api/v1/users'))).toBe(false);
  });

  it('says when the rights could not be loaded, and loads the section once they can', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSettings('general', { 'GET /api/v1/projects': () => (fail ? unavailable() : { body: list([web]) }) });

    expect(await screen.findByText('Die Rechte konnten nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
  });
});

/* ----------------------------------------------------------------------- general */

describe('General', () => {
  /** The picture the browser hands over: decoded by a fake image, drawn on a fake canvas. */
  function fakePictures() {
    class FakeImage {
      onload: (() => void) | null = null;
      naturalWidth = 256;
      naturalHeight = 256;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    URL.createObjectURL = vi.fn(() => 'blob:logo');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,TE9HTw==');
  }

  it('saves only what changed, says so, and the page follows the saved state', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'PATCH /api/v1/organization': (body) => ({ body: { data: { ...organization, ...(body as object) } } }) });
    const name = await screen.findByRole('textbox', { name: 'Name' });

    await user.clear(name);
    await user.type(name, 'Feldwerk GmbH');
    await user.click(screen.getByRole('button', { name: 'Sonntag' }));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(toastTitles()).toContain('Einstellungen gespeichert'));
    expect(lastCall('PATCH', '/api/v1/organization')!.body).toEqual({ name: 'Feldwerk GmbH', week_start: 0 });
    expect(inertia.reload).toHaveBeenCalled();
  });

  it('says there is nothing to save, and asks for a name before sending an empty one', async () => {
    const user = userEvent.setup();
    renderSettings('general');
    const name = await screen.findByRole('textbox', { name: 'Name' });

    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    expect(toastTitles()).toContain('Es gibt nichts zu speichern');

    await user.clear(name);
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    expect(screen.getByText('Gib der Organisation einen Namen.')).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(api!.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('shows a refusal of a field it has no place for as a notice, one of its own fields at the field', async () => {
    const user = userEvent.setup();
    let errors: Record<string, string[]> = { organization: ['Die Organisation ist gesperrt.'] };
    renderSettings('general', { 'PATCH /api/v1/organization': () => problem(422, 'validation_failed', { errors }) });
    const name = await screen.findByRole('textbox', { name: 'Name' });

    await user.type(name, ' Nord');
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('Das hat nicht geklappt');
    expect(notice.textContent).toContain('Die Organisation ist gesperrt.');
    expect(toastTitles()).toContain('Einstellungen nicht gespeichert');

    errors = { name: ['Der Name ist zu lang.'] };
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    expect(await screen.findByText('Der Name ist zu lang.')).toBeTruthy();
    expect(screen.queryByText('Die Organisation ist gesperrt.')).toBeNull();
  });

  it('takes a logo as a square PNG and removes it again', async () => {
    fakePictures();
    const user = userEvent.setup();
    let stored = organization;
    renderSettings('general', {
      'GET /api/v1/organization': () => ({ body: { data: stored } }),
      'PATCH /api/v1/organization': (body) => {
        stored = { ...stored, ...(body as object) };
        return { body: { data: stored } };
      },
    });
    await screen.findByRole('textbox', { name: 'Name' });
    // without a logo the first letter stands in
    expect(screen.getByRole('group', { name: 'Logo' }).textContent).toContain('F');

    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(picker, { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Logo' }).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,TE9HTw=='));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(lastCall('PATCH', '/api/v1/organization')!.body).toEqual({ logo_url: 'data:image/png;base64,TE9HTw==' }));

    await user.click(await screen.findByRole('button', { name: 'Entfernen Logo' }));
    expect(screen.getByRole('group', { name: 'Logo' }).querySelector('img')).toBeNull();
  });

  it('changes language and time zone', async () => {
    const user = userEvent.setup();
    renderSettings('general', { 'PATCH /api/v1/organization': (body) => ({ body: { data: { ...organization, ...(body as object) } } }) });
    await screen.findByRole('textbox', { name: 'Name' });

    await user.click(screen.getByRole('combobox', { name: /Standardsprache/ }));
    await user.click(await screen.findByRole('option', { name: 'English' }));
    const zone = screen.getByRole('combobox', { name: /Zeitzone/ });
    await user.clear(zone);
    await user.type(zone, 'Tokyo');
    await user.click(await screen.findByRole('option', { name: /Asia\/Tokyo/ }));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(lastCall('PATCH', '/api/v1/organization')!.body).toEqual({ locale: 'en', timezone: 'Asia/Tokyo' }));
  });

  it('lets members read the settings without a way to change them', async () => {
    signedIn = lene;
    renderSettings('general', { 'GET /api/v1/organization': () => ({ body: { data: { ...organization, logo_url: '/media/logo' } } }) });

    const name = await screen.findByRole('textbox', { name: 'Name' });
    expect(name.hasAttribute('readonly')).toBe(true);
    expect(screen.getByText('Nur lesen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Speichern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bild wählen … Logo' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Logo' }).querySelector('img')?.getAttribute('src')).toBe('/media/logo'));
    // a member's click on a day changes nothing
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sonntag' }));
    expect(screen.getByRole('button', { name: 'Montag' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says when the organisation could not be loaded, with "Erneut versuchen"', async () => {
    renderSettings('general', { 'GET /api/v1/organization': unavailable });

    expect(await screen.findByText('Die Organisation konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------ people */

describe('People', () => {
  it('lists the people, active ones first, with role, state and the own account marked', async () => {
    renderSettings('people');

    const rows = within(await screen.findByRole('list', { name: 'Personen' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('Mara LindqvistDu@mara'), expect.stringContaining('Lene Vogt@lene'), expect.stringContaining('Sven Albers@sven')]);
    expect(rows[2]!.textContent).toContain('Deaktiviert');
    expect(rows[2]!.textContent).toContain('seit 18.09.2026');
    expect(rows[1]!.textContent).toContain('Aktiv');
    expect(within(rows[0]!).getByRole('combobox', { name: 'Rolle von Mara Lindqvist' }).textContent).toContain('Admin');
  });

  it('shows every person, also beyond the first page of 100, and asks for people only', async () => {
    const crowd = Array.from({ length: 100 }, (_, index) => person(`u_p${String(index).padStart(3, '0')}`, `Person ${index}`, `p${index}`));
    renderSettings('people', {
      'GET /api/v1/users': (_body, url) => ({
        body: url.searchParams.get('cursor') === 'next' ? { data: [lene], links: {}, meta: { next_cursor: null, total: 101 } } : { data: crowd, links: {}, meta: { next_cursor: 'next', total: 101 } },
      }),
    });

    expect(await screen.findByRole('combobox', { name: 'Rolle von Lene Vogt' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Personen' })).getAllByRole('listitem')).toHaveLength(101);
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/users')).map((call) => call.url)).toEqual(['/api/v1/users?type=person', '/api/v1/users?type=person&cursor=next']);
  });

  it('says when the people could not be loaded, and when there is nobody yet', async () => {
    const { unmount } = renderSettings('people', { 'GET /api/v1/users': unavailable });
    expect(await screen.findByText('Die Personen konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Erneut versuchen' }).length).toBeGreaterThan(0);
    unmount();
    api!.restore();

    renderSettings('people', { 'GET /api/v1/users': accounts([automation]) });
    expect(await screen.findByText('Noch niemand außer dir')).toBeTruthy();
  });

  it('lists the open invitations with their projects; a closed one and one without a link offer none', async () => {
    const user = userEvent.setup();
    renderSettings('people', {
      'GET /api/v1/invitations': () => ({
        body: list([
          invitation(),
          invitation({ id: 'inv_2', email: 'old@example.com', state: 'closed', projects: [{ project_id: 'p_gone', role: 'admin' }] }),
          invitation({ id: 'inv_3', email: 'quiet@example.com', link: null }),
        ]),
      }),
    });

    const rows = within(await screen.findByRole('list', { name: 'Offene Einladungen' })).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('Gültig bis 04.11.2026');
    expect(rows[0]!.textContent).toContain('WEB als Viewer');
    expect(rows[1]!.textContent).toContain('? als Admin');
    expect(rows[1]!.textContent).toContain('Link gilt nicht mehr');
    expect(within(rows[1]!).queryByRole('button')).toBeNull();
    expect(within(rows[2]!).queryByRole('button')).toBeNull();

    await user.click(within(rows[0]!).getByRole('button', { name: 'Link anzeigen für nora@example.com' }));
    expect((await screen.findByRole('textbox', { name: 'Einladungslink' }) as HTMLInputElement).value).toBe(invitation().link);
  });

  it('says when the invitations could not be loaded, tries again, and says when there are none', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = unavailable;
    renderSettings('people', { 'GET /api/v1/invitations': (body, url) => answer(body, url) });

    expect(await screen.findByText('Die Einladungen konnten nicht geladen werden.')).toBeTruthy();
    answer = () => ({ body: list([]) });
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText(/Keine offenen Einladungen/)).toBeTruthy();
  });

  it('invites with role and projects, and ends in the link to copy', async () => {
    const user = userEvent.setup();
    renderSettings('people', {
      'POST /api/v1/invitations': (body) => ({ status: 201, body: { link: 'https://werkbuch.example.com/invitations/new', invitation: invitation({ email: (body as { email: string }).email }) } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Person einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Person einladen' });

    await user.click(within(dialog).getByRole('button', { name: /Einladen/ }));
    expect(within(dialog).getByText('Gib die E-Mail-Adresse der Person ein.')).toBeTruthy();

    await user.type(within(dialog).getByRole('textbox', { name: 'E-Mail-Adresse' }), 'nora@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Admin' }));
    expect(within(dialog).getByText('Admins verwalten die Organisation und sehen alle Projekte, auch private.')).toBeTruthy();
    await user.click(within(dialog).getByRole('checkbox', { name: /WEB/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /APP/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /APP/ }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Rolle in WEB' }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await user.click(within(dialog).getByRole('button', { name: /Einladen/ }));

    const sent = await screen.findByRole('dialog', { name: 'Einladung ist angelegt' });
    expect(lastCall('POST', '/api/v1/invitations')!.body).toEqual({ email: 'nora@example.com', org_role: 'admin', projects: [{ project_id: 'p_web', role: 'viewer' }] });
    expect((within(sent).getByRole('textbox', { name: 'Einladungslink' }) as HTMLInputElement).value).toBe('https://werkbuch.example.com/invitations/new');
    expect(within(sent).getByText(/Für nora@example.com\./)).toBeTruthy();
    await user.click(within(sent).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a refusal of the address at the field and one without a field on top', async () => {
    const user = userEvent.setup();
    let errors: Record<string, string[]> = { email: ['Für diese Adresse gibt es schon ein Konto.'] };
    renderSettings('people', { 'POST /api/v1/invitations': () => problem(422, 'validation_failed', { errors }) });
    await user.click(await screen.findByRole('button', { name: 'Person einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Person einladen' });

    await user.type(within(dialog).getByRole('textbox', { name: 'E-Mail-Adresse' }), 'mara@feldwerk.example.com');
    await user.click(within(dialog).getByRole('button', { name: /Einladen/ }));
    expect(await within(dialog).findByText('Für diese Adresse gibt es schon ein Konto.')).toBeTruthy();

    errors = { projects: ['Mindestens ein Projekt gibt es nicht.'] };
    await user.click(within(dialog).getByRole('button', { name: /Einladen/ }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Mindestens ein Projekt gibt es nicht.');
  });

  it('changes the role of another person at once', async () => {
    const user = userEvent.setup();
    renderSettings('people', { 'PUT /api/v1/users/u_lene/role': () => ({ body: { data: { ...lene, org_role: 'admin' } } }) });

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Lene Vogt' }));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));

    await waitFor(() => expect(toastTitles()).toContain('Lene Vogt ist jetzt Admin'));
    expect(lastCall('PUT', '/api/v1/users/u_lene/role')!.body).toEqual({ org_role: 'admin' });
    expect(inertia.reload).not.toHaveBeenCalled();
  });

  it('keeps the role field focused and read-only while its call runs', async () => {
    const user = userEvent.setup();
    let answer: () => void = () => {};
    renderSettings('people', { 'PUT /api/v1/users/u_lene/role': () => ({ body: { data: { ...lene, org_role: 'admin' } } }) });
    // hold the call until the test lets it go
    const fetching = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      String(input).includes('/role') ? new Promise<Response>((resolve) => (answer = () => resolve(fetching(input, init)))) : fetching(input, init);
    const role = await screen.findByRole('combobox', { name: 'Rolle von Lene Vogt' });

    await user.click(role);
    await user.click(await screen.findByRole('option', { name: 'Admin' }));

    await waitFor(() => expect(role.getAttribute('aria-readonly')).toBe('true'));
    expect(document.activeElement).toBe(role);
    expect(role.textContent).toContain('Admin');
    answer();
    await waitFor(() => expect(role.getAttribute('aria-readonly')).toBeNull());
    expect(document.activeElement).toBe(role);
    globalThis.fetch = fetching;
  });

  it('keeps "the last active admin" on screen until it is closed, for demoting and for deactivating', async () => {
    const user = userEvent.setup();
    const lastAdmin = () => problem(409, 'last_admin', { detail: 'Das ist der letzte aktive Admin.' });
    renderSettings('people', { 'PUT /api/v1/users/u_mara/role': lastAdmin, 'POST /api/v1/users/u_mara/deactivate': lastAdmin });

    // Mara is the only admin among the people: the server decides, nobody is asked
    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Mara Lindqvist' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Mara Lindqvist ist der letzte aktive Admin');
    expect(banner.textContent).toContain('Die Rolle bleibt Admin. Eine Organisation braucht mindestens einen aktiven Admin');
    expect(currentToasts()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Deaktivieren Mara Lindqvist' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Das Konto bleibt aktiv.'));

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says in a toast when another refusal stops a change', async () => {
    const user = userEvent.setup();
    renderSettings('people', { 'PUT /api/v1/users/u_lene/role': unavailable, 'POST /api/v1/users/u_lene/deactivate': unavailable });

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Lene Vogt' }));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));
    await waitFor(() => expect(toastTitles()).toContain('Rolle von Lene Vogt nicht geändert'));

    await user.click(screen.getByRole('button', { name: 'Deaktivieren Lene Vogt' }));
    await waitFor(() => expect(toastTitles()).toContain('Lene Vogt nicht deaktiviert'));
  });

  it('deactivates another person with "Reaktivieren" in the toast, and reactivates', async () => {
    const user = userEvent.setup();
    let reactivations = 0;
    renderSettings('people', {
      'POST /api/v1/users/u_lene/deactivate': () => ({ body: { data: { ...lene, disabled_at: '2026-10-30T09:00:00.000Z' } } }),
      'POST /api/v1/users/u_lene/reactivate': () => ({ body: { data: lene } }),
      'POST /api/v1/users/u_sven/reactivate': () => (reactivations++ === 0 ? unavailable() : { body: { data: { ...sven, disabled_at: null } } }),
    });

    await user.click(await screen.findByRole('button', { name: 'Deaktivieren Lene Vogt' }));
    await waitFor(() => expect(toastTitles()).toContain('Lene Vogt ist deaktiviert'));
    expect(toastNamed('Lene Vogt ist deaktiviert').description).toBe('Tokens und Sitzungen sind widerrufen. Verlauf und Zuweisungen bleiben.');
    act(() => runToastAction(toastNamed('Lene Vogt ist deaktiviert').id));
    await waitFor(() => expect(toastTitles()).toContain('Lene Vogt ist wieder aktiv'));

    await user.click(screen.getByRole('button', { name: 'Reaktivieren Sven Albers' }));
    await waitFor(() => expect(toastTitles()).toContain('Sven Albers nicht reaktiviert'));
    act(() => runToastAction(toastNamed('Sven Albers nicht reaktiviert').id));
    await waitFor(() => expect(toastTitles()).toContain('Sven Albers ist wieder aktiv'));
  });

  it('asks before one gives up one\'s own admin rights while another admin is there, and the page follows', async () => {
    const user = userEvent.setup();
    renderSettings('people', {
      'GET /api/v1/users': accounts([mara, jonas, lene]),
      'PUT /api/v1/users/u_mara/role': () => ({ body: { data: { ...mara, org_role: 'member' } } }),
    });

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Mara Lindqvist' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    const question = await screen.findByRole('alertdialog', { name: 'Deine Admin-Rechte abgeben?' });
    await user.click(within(question).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api!.calls.some((call) => call.method === 'PUT')).toBe(false);

    await user.click(screen.getByRole('combobox', { name: 'Rolle von Mara Lindqvist' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zum Member machen' }));

    await waitFor(() => expect(toastTitles()).toContain('Mara Lindqvist ist jetzt Member'));
    expect(inertia.reload).toHaveBeenCalled();
  });

  it('asks before one deactivates oneself, and reloads so the server signs one out', async () => {
    const user = userEvent.setup();
    renderSettings('people', {
      'GET /api/v1/users': accounts([mara, jonas]),
      'POST /api/v1/users/u_mara/deactivate': () => ({ body: { data: { ...mara, disabled_at: '2026-10-30T09:00:00.000Z' } } }),
    });

    await user.click(await screen.findByRole('button', { name: 'Deaktivieren Mara Lindqvist' }));
    const question = await screen.findByRole('alertdialog', { name: 'Dein eigenes Konto deaktivieren?' });
    await user.click(within(question).getByRole('button', { name: 'Mich deaktivieren' }));

    await waitFor(() => expect(toastTitles()).toContain('Dein Konto ist deaktiviert'));
    expect(inertia.reload).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- bots */

describe('Bots', () => {
  it('suggests a handle from a name', () => {
    expect(handleFrom('  Rita Prüfer ')).toBe('rita-pruefer');
    expect(handleFrom('Ärger-Öl Süß ß Café!')).toBe('aerger-oel-suess-ss-cafe');
    // hyphens go at the start before the cut and at the end after it
    expect(handleFrom(`--${'x'.repeat(40)}`)).toBe('x'.repeat(32));
    expect(handleFrom(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31));
  });

  it('shows the default bot first, without "Deaktivieren", warns at its tokens, and names the others "Bot"', async () => {
    renderSettings('bots', { 'GET /api/v1/users': accounts([mara, rex, kira, automation]) });

    const cards = await screen.findAllByRole('article');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual(['Automation', 'Kira', 'Rex']);

    const [defaultBot, bot, disabled] = cards as [HTMLElement, HTMLElement, HTMLElement];
    expect(defaultBot.textContent).toContain('Standard-Bot');
    expect(defaultBot.textContent).toContain('Die Organisation');
    expect(defaultBot.textContent).toContain('Er lässt sich weder deaktivieren noch löschen, nur umbenennen.');
    expect(within(defaultBot).queryByRole('button', { name: /Deaktivieren/ })).toBeNull();
    expect(within(defaultBot).getByRole('note').textContent).toContain('Tokens des Standard-Bots haben Admin-Rechte');
    expect(await within(defaultBot).findByText('Noch kein Token. Ohne Token kann niemand im Namen dieses Bots arbeiten.')).toBeTruthy();

    expect(within(bot).getByText('Bot')).toBeTruthy();
    expect(bot.textContent).toContain('Mara Lindqvist');
    expect(bot.textContent).toContain('Member');
    expect(within(bot).queryByRole('note')).toBeNull();

    expect(disabled.textContent).toContain('Deaktiviert');
    expect(disabled.textContent).toContain('Niemand');
    expect(within(disabled).queryByRole('button', { name: /Token anlegen/ })).toBeNull();
    expect(await within(disabled).findByText(/Ein deaktivierter Bot hat keine Tokens/)).toBeTruthy();
  });

  it('asks for bots and for people apart, so a hundred people never push the bots out of the list', async () => {
    renderSettings('bots');

    await screen.findAllByRole('article');
    const asked = api!.calls.filter((call) => call.url.startsWith('/api/v1/users')).map((call) => call.url);
    expect(asked.sort()).toEqual(['/api/v1/users?type=bot', '/api/v1/users?type=person']);
  });

  it('keeps a responsible person who was deactivated as a choice of the bot, but offers no other deactivated one', async () => {
    const user = userEvent.setup();
    const svens = { ...kira, owner_id: 'u_sven' };
    const theo = { ...person('u_theo', 'Theo Okafor', 'theo'), disabled_at: '2026-10-01T10:00:00.000Z' };
    renderSettings('bots', { 'GET /api/v1/users': accounts([mara, sven, theo, svens]) });
    const card = (await screen.findAllByRole('article'))[0]!;
    expect(card.textContent).toContain('Sven Albers');

    await user.click(within(card).getByRole('button', { name: 'Bearbeiten Kira' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bot „Kira“ bearbeiten' });
    const owner = within(dialog).getByRole('combobox', { name: /Verantwortliche Person/ });
    expect(owner.textContent).toContain('Sven Albers');
    await user.click(owner);
    const options = () => screen.getAllByRole('option').map((option) => option.textContent);
    await screen.findAllByRole('option');
    // each with the initials of its avatar first
    expect(options()).toEqual(['MLMara Lindqvist', 'SASven Albers']);

    // away from Sven and back again in the same dialog
    await user.click(screen.getByRole('option', { name: /Mara Lindqvist/ }));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await user.click(owner);
    await screen.findAllByRole('option');
    expect(options()).toEqual(['MLMara Lindqvist', 'SASven Albers']);
  });

  it('lists the tokens of a bot with abilities, expiry and last use; an expired one says so', async () => {
    renderSettings('bots');

    const tokens = within(await screen.findByRole('list', { name: 'Tokens von Kira' })).getAllByRole('listitem', { name: undefined });
    const rows = tokens.filter((row) => row.parentElement?.getAttribute('aria-label') === 'Tokens von Kira');
    expect(rows[0]!.textContent).toContain('CI-Skript');
    expect(rows[0]!.textContent).toContain('Abgelaufen');
    expect(rows[0]!.textContent).toContain('am 30.09.2026');
    expect(rows[0]!.textContent).toContain('Zuletzt benutzt vor 30 Tagen');
    expect(rows[0]!.textContent).toContain('Angelegt am 05.10.2026');
    expect(within(rows[1]!).getByRole('list', { name: 'Fähigkeiten' }).textContent).toBe('LesenSchreibenMCP');
    expect(rows[1]!.textContent).toContain('Läuft am 01.01.2099 ab');
    expect(rows[2]!.textContent).toContain('Läuft nicht ab');
    expect(rows[2]!.textContent).toContain('Noch nie benutzt');
  });

  it('says when the bots or their tokens could not be loaded', async () => {
    const { unmount } = renderSettings('bots', { 'GET /api/v1/users': unavailable });
    expect(await screen.findByText('Die Bots konnten nicht geladen werden')).toBeTruthy();
    unmount();
    api!.restore();

    renderSettings('bots', { 'GET /api/v1/tokens': unavailable });
    await waitFor(() => expect(screen.getAllByText('Die Tokens konnten nicht geladen werden')).toHaveLength(2));
  });

  it('offers to create the first bot when there is none', async () => {
    const user = userEvent.setup();
    renderSettings('bots', { 'GET /api/v1/users': accounts([mara]) });

    expect(await screen.findByText('Noch kein Bot')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Bot anlegen' })[1]!);
    expect(await screen.findByRole('dialog', { name: 'Bot anlegen' })).toBeTruthy();
  });

  it('creates a bot whose handle follows the name until it is written by hand', async () => {
    const user = userEvent.setup();
    renderSettings('bots', { 'POST /api/v1/bots': (body) => ({ status: 201, body: { data: { ...kira, id: 'u_new', ...(body as object) } } }) });
    await user.click((await screen.findAllByRole('button', { name: 'Bot anlegen' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Bot anlegen' });

    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    expect(within(dialog).getByText('Gib dem Bot einen Namen.')).toBeTruthy();
    expect(within(dialog).getByText('Gib dem Bot ein Kürzel.')).toBeTruthy();

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Prüf Bot');
    const handle = within(dialog).getByRole('textbox', { name: 'Kürzel' }) as HTMLInputElement;
    expect(handle.value).toBe('pruef-bot');
    await user.clear(handle);
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    expect(document.activeElement).toBe(handle);
    await user.type(handle, 'pruefer');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'in');
    expect(handle.value).toBe('pruefer');
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschreibung' }), 'Prüft Pull Requests.');
    await user.click(within(dialog).getByRole('combobox', { name: /Verantwortliche Person/ }));
    await user.click(await screen.findByRole('option', { name: 'Lene Vogt' }));
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));

    await waitFor(() => expect(toastTitles()).toContain('Bot Prüf Botin ist angelegt'));
    expect(lastCall('POST', '/api/v1/bots')!.body).toEqual({ name: 'Prüf Botin', handle: 'pruefer', description: 'Prüft Pull Requests.', owner_id: 'u_lene' });
  });

  it('shows a taken handle at the field and a refusal without a field on top', async () => {
    const user = userEvent.setup();
    let errors: Record<string, string[]> = { handle: ['Dieses Kürzel ist schon vergeben.'] };
    renderSettings('bots', { 'POST /api/v1/bots': () => problem(422, 'validation_failed', { errors }) });
    await user.click((await screen.findAllByRole('button', { name: 'Bot anlegen' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Bot anlegen' });

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kira');
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    expect(await within(dialog).findByText('Dieses Kürzel ist schon vergeben.')).toBeTruthy();

    errors = { type: ['Diese Art von Konto gibt es nicht.'] };
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Diese Art von Konto gibt es nicht.');
  });

  it('renames the default bot without a responsible person', async () => {
    const user = userEvent.setup();
    renderSettings('bots', { 'PATCH /api/v1/users/u_automation': (body) => ({ body: { data: { ...automation, ...(body as object) } } }) });
    const card = (await screen.findAllByRole('article'))[0]!;

    await user.click(within(card).getByRole('button', { name: 'Bearbeiten Automation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bot „Automation“ bearbeiten' });
    expect(within(dialog).getByText('Den Standard-Bot kannst du umbenennen. Seine Rolle bleibt Admin.')).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: /Verantwortliche Person/ })).toBeNull();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Robo');
    await user.click(within(dialog).getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(toastTitles()).toContain('Robo gespeichert'));
    expect(lastCall('PATCH', '/api/v1/users/u_automation')!.body).toEqual({ name: 'Robo', handle: 'automation', description: 'Der Standard-Bot.', owner_id: null });
  });

  it('changes another bot together with its responsible person', async () => {
    const user = userEvent.setup();
    renderSettings('bots', { 'PATCH /api/v1/users/u_kira': (body) => ({ body: { data: { ...kira, ...(body as object) } } }) });
    const card = (await screen.findAllByRole('article'))[1]!;

    await user.click(within(card).getByRole('button', { name: 'Bearbeiten Kira' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bot „Kira“ bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(lastCall('PATCH', '/api/v1/users/u_kira')!.body).toEqual({ name: 'Kira', handle: 'kira', description: 'Bot von Mara.', owner_id: 'u_mara' }));
  });

  it('deactivates a bot with "Reaktivieren" in the toast, and says when either fails', async () => {
    const user = userEvent.setup();
    let fail = false;
    renderSettings('bots', {
      'POST /api/v1/users/u_kira/deactivate': () => (fail ? unavailable() : { body: { data: { ...kira, disabled_at: '2026-10-30T09:00:00.000Z' } } }),
      'POST /api/v1/users/u_kira/reactivate': () => (fail ? unavailable() : { body: { data: kira } }),
    });
    const card = (await screen.findAllByRole('article'))[1]!;

    await user.click(within(card).getByRole('button', { name: 'Deaktivieren Kira' }));
    await waitFor(() => expect(toastTitles()).toContain('Kira ist deaktiviert'));
    act(() => runToastAction(toastNamed('Kira ist deaktiviert').id));
    await waitFor(() => expect(toastTitles()).toContain('Kira ist wieder aktiv'));
    expect(toastNamed('Kira ist wieder aktiv').description).toBe('Seine Tokens sind widerrufen. Lege neue an.');

    fail = true;
    await user.click(within(card).getByRole('button', { name: 'Deaktivieren Kira' }));
    await waitFor(() => expect(toastTitles()).toContain('Kira nicht deaktiviert'));
    act(() => runToastAction(toastNamed('Kira nicht deaktiviert').id));
    await waitFor(() => expect(api!.calls.filter((call) => call.url === '/api/v1/users/u_kira/deactivate')).toHaveLength(3));
  });

  it('reactivates a deactivated bot, and offers to try again when that fails', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSettings('bots', {
      'GET /api/v1/users': accounts([mara, rex]),
      'POST /api/v1/users/u_rex/reactivate': () => (fail ? unavailable() : { body: { data: { ...rex, disabled_at: null } } }),
    });

    await user.click(await screen.findByRole('button', { name: 'Reaktivieren Rex' }));
    await waitFor(() => expect(toastTitles()).toContain('Rex nicht reaktiviert'));
    fail = false;
    act(() => runToastAction(toastNamed('Rex nicht reaktiviert').id));
    await waitFor(() => expect(toastTitles()).toContain('Rex ist wieder aktiv'));
  });

  it('revokes a token after the undo time, and brings it back with "Rückgängig"', async () => {
    const user = userEvent.setup();
    renderSettings('bots', { 'DELETE /api/v1/tokens/t_new': () => ({ status: 204 }) });
    const tokens = await screen.findByRole('list', { name: 'Tokens von Kira' });

    await user.click(within(tokens).getByRole('button', { name: 'Token „Neu“ widerrufen' }));
    expect(within(tokens).queryByText('Neu')).toBeNull();
    act(() => runToastAction(toastNamed('Token „Neu“ von Kira widerrufen').id));
    expect(await within(tokens).findByText('Neu')).toBeTruthy();

    await user.click(within(tokens).getByRole('button', { name: 'Token „Neu“ widerrufen' }));
    act(() => dismissToast(toastNamed('Token „Neu“ von Kira widerrufen').id));
    await waitFor(() => expect(lastCall('DELETE', '/api/v1/tokens/t_new')).toBeDefined());
  });
});

/* ------------------------------------------------------------------- token dialog */

describe('TokenDialog', () => {
  const created = (body: unknown) => ({
    status: 201,
    body: { token: token('t_made', { name: (body as { name: string }).name, abilities: (body as { abilities: Token['abilities'] }).abilities }), plain_text: '01jtoken|wb_secret' },
  });

  async function openFor(botName: string, overrides: Record<string, MockRoute>) {
    const user = userEvent.setup();
    renderSettings('bots', overrides);
    const card = (await screen.findAllByRole('article')).find((article) => within(article).getByRole('heading', { level: 3 }).textContent === botName)!;
    await user.click(within(card).getByRole('button', { name: `Token anlegen ${botName}` }));
    return { user, dialog: await screen.findByRole('dialog') };
  }

  it('creates a token for a bot with the chosen abilities, valid through the end of the chosen day, and shows it once', async () => {
    const { user, dialog } = await openFor('Kira', { 'POST /api/v1/tokens': created });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    expect(within(dialog).getByRole('heading', { name: 'Token für Kira anlegen' })).toBeTruthy();
    expect(within(dialog).getByText('Mit dem Token arbeitet der Bot über REST und MCP.')).toBeTruthy();
    // a bot starts with reading only
    expect(within(dialog).getByRole('checkbox', { name: /^Lesen/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('checkbox', { name: /^Schreiben/ }).getAttribute('aria-checked')).toBe('false');
    const expiry = within(dialog).getByLabelText('Ablaufdatum (optional)');
    expect(expiry.getAttribute('min')).toBe('2026-10-31');

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Deploy');
    await user.click(within(dialog).getByRole('checkbox', { name: /^MCP/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^Schreiben/ }));
    fireEvent.change(expiry, { target: { value: '2026-12-31' } });
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));

    expect(await screen.findByRole('heading', { name: 'Token angelegt' })).toBeTruthy();
    expect(lastCall('POST', '/api/v1/tokens')!.body).toEqual({ user_id: 'u_kira', name: 'Deploy', abilities: ['read', 'write', 'mcp'], expires_at: '2026-12-31T22:59:00.000Z' });
    expect(screen.getByText(/handelt im Namen von Kira\./)).toBeTruthy();
    const secret = screen.getByRole('textbox', { name: 'Token' }) as HTMLInputElement;
    expect(secret.value).toBe('01jtoken|wb_secret');
    await waitFor(() => expect(document.activeElement).toBe(secret));
    expect(screen.getByText(/claude mcp add --transport http werkbuch .*\/mcp --header "Authorization: Bearer 01jtoken\|wb_secret"/)).toBeTruthy();
    expect(screen.getByText('Im Terminal ausführen.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Token kopieren' }));
    expect(writeText).toHaveBeenCalledWith('01jtoken|wb_secret');
    expect(toastTitles()).toContain('Kopiert');
    expect(screen.getByRole('button', { name: 'Kopiert' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ich habe den Token kopiert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('warns that tokens of the default bot carry admin rights, before and after', async () => {
    const { user, dialog } = await openFor('Automation', { 'POST /api/v1/tokens': created });
    expect(within(dialog).getByRole('note').textContent).toContain('Dieser Token bekommt Admin-Rechte');

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'n8n');
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));

    expect(await screen.findByText('Dieser Token hat Admin-Rechte')).toBeTruthy();
  });

  it('asks before the plain text is closed away with Escape', async () => {
    const { user, dialog } = await openFor('Kira', { 'POST /api/v1/tokens': created });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Deploy');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('heading', { name: 'Token angelegt' });

    await user.keyboard('{Escape}');
    const question = await screen.findByRole('alertdialog', { name: 'Ohne Kopie schließen?' });
    await user.click(within(question).getByRole('button', { name: 'Schließen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the refusals of fields at them, and any other failure in a toast that tries again', async () => {
    let answer: MockRoute = () => problem(422, 'validation_failed', { errors: { name: ['Der Name darf nicht leer sein.'], abilities: ['Wähle mindestens eine Fähigkeit.'] } });
    const { user, dialog } = await openFor('Kira', { 'POST /api/v1/tokens': (body, url) => answer(body, url) });

    await user.click(within(dialog).getByRole('checkbox', { name: /^Lesen/ }));
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));
    expect(await within(dialog).findByText('Der Name darf nicht leer sein.')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain('Wähle mindestens eine Fähigkeit.');
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Name' })));

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'x');
    await user.click(within(dialog).getByRole('checkbox', { name: /^Lesen/ }));
    expect(within(dialog).queryByText('Der Name darf nicht leer sein.')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();

    answer = () => problem(422, 'validation_failed', { errors: { expires_at: ['Das Ablaufdatum muss in der Zukunft liegen.'] } });
    fireEvent.change(within(dialog).getByLabelText('Ablaufdatum (optional)'), { target: { value: '2026-10-01' } });
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));
    expect(await within(dialog).findByText('Das Ablaufdatum muss in der Zukunft liegen.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Ablaufdatum (optional)'), { target: { value: '' } });
    expect(within(dialog).queryByText('Das Ablaufdatum muss in der Zukunft liegen.')).toBeNull();

    answer = unavailable;
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));
    await waitFor(() => expect(toastTitles()).toContain('Token nicht angelegt'));
    answer = created;
    act(() => runToastAction(toastNamed('Token nicht angelegt').id));
    expect(await screen.findByRole('heading', { name: 'Token angelegt' })).toBeTruthy();
  });

  it('shows a refusal of a path the form has no field for as a notice on top, and forgets it with the next try', async () => {
    let answer: MockRoute = () => problem(422, 'validation_failed', { errors: { user_id: ['Dieses Konto darf keine Tokens haben.'], name: ['Der Name ist zu lang.'] } });
    const { user, dialog } = await openFor('Kira', { 'POST /api/v1/tokens': (body, url) => answer(body, url) });

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Deploy');
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));
    const notice = await within(dialog).findByText('Dieses Konto darf keine Tokens haben.');
    expect(notice.closest('[role="alert"]')?.textContent).toContain('Das hat nicht geklappt');
    expect(within(dialog).getByText('Der Name ist zu lang.')).toBeTruthy();

    answer = () => problem(422, 'validation_failed', { errors: { name: ['Der Name ist zu lang.'] } });
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));
    await waitFor(() => expect(within(dialog).queryByText('Dieses Konto darf keine Tokens haben.')).toBeNull());
  });

  it('selects the text when the clipboard refuses, and says so without repeating it', async () => {
    const { user, dialog } = await openFor('Kira', { 'POST /api/v1/tokens': created });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Deploy');
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));
    await screen.findByRole('heading', { name: 'Token angelegt' });

    await user.click(screen.getByRole('button', { name: 'Token kopieren' }));
    const failed = toastNamed('Kopieren hat nicht geklappt');
    expect(failed.description).toMatch(/^Der Text ist markiert: Kopiere ihn mit (⌘C|Strg\+C)\.$/);
    expect(failed.description).not.toContain('wb_secret');
    const secret = screen.getByRole('textbox', { name: 'Token' }) as HTMLInputElement;
    expect(document.activeElement).toBe(secret);

    // a snippet is no field: its text is selected as a range
    const snippet = screen.getAllByRole('button', { name: 'Kopieren' })[0]!;
    await user.click(snippet);
    expect(window.getSelection()?.toString()).toContain('claude mcp add');
  });
});
