/*
 * The personal settings against a fake REST API (`mockApi`): every branch of the screens, the failures and refusals
 * included. The flows with a real server (the profile, the language, two-factor with a real code, a token, the password)
 * run in e2e/tests/settings-personal.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import Personal from '@/pages/Settings/Personal';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, mara, organization } from '@/test/fixtures';
import type { Token, TwoFactorStatus, User } from '@/types';
import { PersonalSettings } from './PersonalSettings';
import { groupKey } from './QrCode';

type Visit = { url: URL; method: string; prefetch: boolean; preserveUrl: boolean };
type Listener = (event: { detail: { visit: Visit } }) => boolean | void;

const inertia = vi.hoisted(() => ({ reload: vi.fn(), visit: vi.fn(), listeners: new Map<string, Set<(event: never) => unknown>>() }));
let signedIn: User | null = mara;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: {
    reload: inertia.reload,
    visit: inertia.visit,
    on: (event: string, listener: (event: never) => unknown) => {
      const set = inertia.listeners.get(event) ?? new Set();
      set.add(listener);
      inertia.listeners.set(event, set);
      return () => set.delete(listener);
    },
  },
}));

/** What Inertia does when a visit starts: asks every `before` listener; one that answers false stops it. */
function leaveTo(path: string): 'stopped' | 'goes on' {
  const visit: Visit = { url: new URL(path, window.location.origin), method: 'get', prefetch: false, preserveUrl: false };
  let answer: 'stopped' | 'goes on' = 'goes on';
  act(() => {
    const answers = [...(inertia.listeners.get('before') ?? [])].map((listener) => (listener as Listener)({ detail: { visit } }));
    if (answers.includes(false)) answer = 'stopped';
  });
  return answer;
}

/* -------------------------------------------------------------------------- data */

const SECRET = 'JBSWY3DPEHPK3PXP';
const QR = 'data:image/svg+xml;base64,PHN2Zy8+';
const CODES = Array.from({ length: 8 }, (_, index) => `code${index}aaaa-bbbbbbbbbb`);

const off: TwoFactorStatus = { enabled: false, confirmed_at: null, recovery_codes_left: 0 };
const on: TwoFactorStatus = { enabled: true, confirmed_at: '2026-10-20T08:00:00.000Z', recovery_codes_left: 5 };

const token = (id: string, changes: Partial<Token> = {}): Token => ({
  id,
  user_id: 'u_mara',
  name: `Token ${id}`,
  abilities: ['read'],
  expires_at: null,
  last_used_at: null,
  created_at: '2026-10-05T12:30:00.000Z',
  ...changes,
});

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', { detail: 'Die Eingabe ist nicht gültig.', errors });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

function routes(overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  return {
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/me/two-factor': () => ({ body: off }),
    'GET /api/v1/tokens': () => ({ body: list([]) }),
    ...overrides,
  };
}

function renderSettings(section: string, overrides: Record<string, MockRoute> = {}) {
  api = mockApi(routes(overrides));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (current: string) => (
    <QueryClientProvider client={client}>
      <PersonalSettings section={current} />
    </QueryClientProvider>
  );
  const result = render(view(section));
  return { ...result, client, rerender: (current = section) => result.rerender(view(current)) };
}

const toastTitles = () => currentToasts().map((entry) => entry.title);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title)!;
const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.startsWith(path));
const lastCall = (method: string, path: string) => calls(method, path).at(-1);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-30T09:00:00.000Z'));
  inertia.listeners.clear();
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = mara;
  inertia.reload.mockReset();
  inertia.visit.mockReset();
  resetToasts();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- frame */

describe('PersonalSettings', () => {
  it('opens the profile first, links the three sections and names the person at the top', async () => {
    api = mockApi(routes());
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Personal section="profile" />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Persönliche Einstellungen' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Profil', '/me/profile'],
      ['Sicherheit', '/me/security'],
      ['API & MCP', '/me/api'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Profil' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Mara Lindqvist', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('mara@feldwerk.example.com', { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Profil' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Profil – Persönliche Einstellungen – werkbuch'));
  });

  it('says when a section does not exist and keeps the list', async () => {
    renderSettings('nothing');

    expect(screen.getByText('Diesen Bereich gibt es nicht')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zum Profil' }).getAttribute('href')).toBe('/me');
    expect(screen.getByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Persönliche Einstellungen – werkbuch'));
  });

  it('shows nothing without a signed-in account', () => {
    signedIn = null;
    const { container } = renderSettings('profile');

    expect(container.textContent).toBe('');
  });
});

/* ------------------------------------------------------------------------ profile */

describe('Profile', () => {
  const saved = (body: unknown) => ({ body: { data: { ...mara, ...(body as object) } } });

  it('keeps the e-mail address and the role as text, because they are not the person’s to change here', () => {
    renderSettings('profile');

    expect(screen.getByText('E-Mail').nextElementSibling!.textContent).toBe('mara@feldwerk.example.com');
    expect(screen.getByText('Rolle').nextElementSibling!.textContent).toBe('Admin');
    expect(screen.queryByRole('textbox', { name: 'E-Mail' })).toBeNull();
  });

  it('saves only what changed, the handle without trailing blanks, and shows the answer until the page has reloaded', async () => {
    const user = userEvent.setup();
    renderSettings('profile', { 'PATCH /api/v1/users/u_mara': saved });

    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Mara Lind');
    const handle = screen.getByRole('textbox', { name: 'Kürzel' });
    await user.clear(handle);
    expect(screen.getByText(/Damit erwähnen dich andere: @kürzel\./)).toBeTruthy();
    await user.type(handle, 'MaraL ');
    expect(screen.getByText(/@maral \./)).toBeTruthy();
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(toastTitles()).toContain('Profil gespeichert'));
    expect(lastCall('PATCH', '/api/v1/users/u_mara')!.body).toEqual({ name: 'Mara Lind', handle: 'maral' });
    expect(inertia.reload).toHaveBeenCalled();
    // the shared props still carry the old name: the form shows the answer of the server
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Mara Lind');
    expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull();
  });

  it('changes language and time zone', async () => {
    const user = userEvent.setup();
    renderSettings('profile', { 'PATCH /api/v1/users/u_mara': saved });

    expect(screen.getByText(/Voreinstellung der Organisation: Europe\/Berlin\./)).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: /Sprache/ }));
    await user.click(await screen.findByRole('option', { name: 'English' }));
    const zone = screen.getByRole('combobox', { name: /Zeitzone/ });
    await user.clear(zone);
    await user.type(zone, 'Tokyo');
    await user.click(await screen.findByRole('option', { name: /Asia\/Tokyo/ }));
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(lastCall('PATCH', '/api/v1/users/u_mara')!.body).toEqual({ locale: 'en', timezone: 'Asia/Tokyo' }));
  });

  it('says there is nothing to save when nothing changed', async () => {
    const user = userEvent.setup();
    renderSettings('profile');

    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    expect(screen.getByText('Keine Änderungen zu speichern.')).toBeTruthy();
    expect(calls('PATCH', '/api/v1/users')).toEqual([]);
  });

  it('shows the refusals at their fields, and any other failure in a toast that tries again', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = () => invalid({ handle: ['Dieses Kürzel ist schon vergeben.'] });
    renderSettings('profile', { 'PATCH /api/v1/users/u_mara': (body, url) => answer(body, url) });

    const handle = screen.getByRole('textbox', { name: 'Kürzel' });
    await user.clear(handle);
    await user.type(handle, 'ida');
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    expect(await screen.findByText('Dieses Kürzel ist schon vergeben.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(handle));
    await user.type(handle, 'x');
    expect(screen.queryByText('Dieses Kürzel ist schon vergeben.')).toBeNull();

    answer = unavailable;
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(toastTitles()).toContain('Profil nicht gespeichert'));
    answer = saved;
    act(() => runToastAction(toastNamed('Profil nicht gespeichert').id));
    await waitFor(() => expect(toastTitles()).toContain('Profil gespeichert'));
    expect(lastCall('PATCH', '/api/v1/users/u_mara')!.body).toEqual({ handle: 'idax' });
  });

  it('takes the avatar away, and "Zurücksetzen" brings it back', async () => {
    const user = userEvent.setup();
    signedIn = { ...mara, avatar_url: '/media/avatar-mara' };
    renderSettings('profile');

    expect(screen.getByRole('img', { name: 'Avatar von Mara Lindqvist' }).getAttribute('src')).toBe('/media/avatar-mara');
    await user.click(screen.getByRole('button', { name: /Entfernen/ }));
    expect(screen.queryByRole('img', { name: 'Avatar von Mara Lindqvist' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Mara Lindqvist' }).textContent).toBe('ML');

    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(screen.getByRole('img', { name: 'Avatar von Mara Lindqvist' })).toBeTruthy();
  });

  it('follows the account when the shared props bring a new one', () => {
    const view = renderSettings('profile');
    signedIn = { ...mara, name: 'Mara Lindqvist-Berg' };
    view.rerender();

    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Mara Lindqvist-Berg');
  });

  it('asks before an edited profile is left', async () => {
    const user = userEvent.setup();
    renderSettings('profile');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' B');

    expect(leaveTo('/projects')).toBe('stopped');
    expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
    expect(screen.getByText(/Deine Änderungen am Profil sind nicht gespeichert/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

/* ----------------------------------------------------------------------- password */

describe('Security: password', () => {
  it('checks the fields before it asks the server, and shows each problem at its field', async () => {
    const user = userEvent.setup();
    renderSettings('security');

    await user.type(screen.getByLabelText('Neues Passwort'), 'kurz');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'anders');
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText('Gib dein aktuelles Passwort ein.')).toBeTruthy();
    expect(screen.getByText('Mindestens 8 Zeichen.')).toBeTruthy();
    expect(screen.getByText('Die Passwörter stimmen nicht überein.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Aktuelles Passwort')));
    expect(calls('PUT', '/api/v1/me/password')).toEqual([]);
    expect(screen.getByText('Wähle ein neues Passwort mit mindestens 8 Zeichen.')).toBeTruthy();
  });

  it('changes the password, empties the fields and says that the other sessions have ended', async () => {
    const user = userEvent.setup();
    renderSettings('security', { 'PUT /api/v1/me/password': () => ({ status: 204 }) });

    await user.type(screen.getByLabelText('Aktuelles Passwort'), 'alt-passwort');
    await user.type(screen.getByLabelText('Neues Passwort'), 'neues-passwort');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'neues-passwort');
    expect(leaveTo('/projects')).toBe('stopped');
    expect(await screen.findByText(/Deine Eingaben im Passwortformular sind nicht gespeichert/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    await waitFor(() => expect(toastTitles()).toContain('Passwort geändert'));
    expect(toastNamed('Passwort geändert').description).toBe('Das neue Passwort gilt ab sofort. Deine anderen Sitzungen sind abgemeldet.');
    expect(lastCall('PUT', '/api/v1/me/password')!.body).toEqual({ current_password: 'alt-passwort', password: 'neues-passwort', password_confirmation: 'neues-passwort' });
    expect((screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Neues Passwort') as HTMLInputElement).value).toBe('');
  });

  it('lets go of the passwords after the call, whether it worked or not', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = () => invalid({ current_password: ['Das aktuelle Passwort stimmt nicht.'] });
    const { client } = renderSettings('security', { 'PUT /api/v1/me/password': (body, url) => answer(body, url) });
    const held = () => client.getMutationCache().getAll().filter((mutation) => JSON.stringify(mutation.state.variables ?? null).includes('neues-passwort'));
    await user.type(screen.getByLabelText('Aktuelles Passwort'), 'alt-passwort');
    await user.type(screen.getByLabelText('Neues Passwort'), 'neues-passwort');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'neues-passwort');

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    expect(await screen.findByText('Das aktuelle Passwort stimmt nicht.')).toBeTruthy();
    await waitFor(() => expect(held()).toEqual([]));

    answer = () => ({ status: 204 });
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    await waitFor(() => expect(toastTitles()).toContain('Passwort geändert'));
    await waitFor(() => expect(held()).toEqual([]));
  });

  it('shows what the server refuses at its field, the limit of tries too, and any other failure in a toast', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = () => invalid({ current_password: ['Das aktuelle Passwort stimmt nicht.'], other: ['Ohne Feld.'] });
    renderSettings('security', { 'PUT /api/v1/me/password': (body, url) => answer(body, url) });
    const current = screen.getByLabelText('Aktuelles Passwort');
    await user.type(current, 'falsch');
    await user.type(screen.getByLabelText('Neues Passwort'), 'neues-passwort');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'neues-passwort');
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText('Das aktuelle Passwort stimmt nicht.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(current));

    answer = () => problem(429, 'too_many_requests', { errors: { current_password: ['Zu viele Versuche. Warte 60 Sekunden.'] } });
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    expect(await screen.findByText('Zu viele Versuche. Warte 60 Sekunden.')).toBeTruthy();

    answer = () => invalid({ password: ['Zu schwach.'], password_confirmation: ['Passt nicht.'] });
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    expect(await screen.findByText('Zu schwach.')).toBeTruthy();
    expect(screen.getByText('Passt nicht.')).toBeTruthy();

    answer = unavailable;
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    await waitFor(() => expect(toastTitles()).toContain('Passwort nicht geändert'));
    answer = () => ({ status: 204 });
    act(() => runToastAction(toastNamed('Passwort nicht geändert').id));
    await waitFor(() => expect(toastTitles()).toContain('Passwort geändert'));
  });
});

/* --------------------------------------------------------------------- two-factor */

describe('Security: two-factor', () => {
  /** The server of the setup: a new secret per start, the codes after a right code, the state after that. */
  function server(overrides: Record<string, MockRoute> = {}) {
    let state = off;
    let started = 0;
    return {
      'GET /api/v1/me/two-factor': () => ({ body: state }),
      'POST /api/v1/me/two-factor': () => {
        started += 1;
        return { body: { secret: started === 1 ? SECRET : 'KRSXG5CTMVRXEZLU', otpauth_url: 'otpauth://totp/werkbuch', qr_svg: QR } };
      },
      'POST /api/v1/me/two-factor/confirm': (body: unknown) => {
        if ((body as { code: string }).code !== '123456') return invalid({ code: ['Der Code stimmt nicht. Nimm den aktuellen aus der App.'] });
        state = { enabled: true, confirmed_at: '2026-10-30T09:00:00.000Z', recovery_codes_left: 8 };
        return { body: { recovery_codes: CODES } };
      },
      'DELETE /api/v1/me/two-factor': () => {
        state = off;
        return { status: 204 };
      },
      ...overrides,
    } satisfies Record<string, MockRoute>;
  }

  async function startSetup(overrides: Record<string, MockRoute> = {}) {
    const user = userEvent.setup();
    renderSettings('security', server(overrides));
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    const field = await screen.findByRole('textbox', { name: 'Code aus der App' });
    // the step moves the focus one animation frame later: let it land first, or a slow run types into where it lands
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    return { user, field };
  }

  it('shows the cause and "Erneut versuchen" when the state cannot be loaded', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = unavailable;
    renderSettings('security', { 'GET /api/v1/me/two-factor': (body, url) => answer(body, url) });

    expect(screen.getByText('Zwei-Faktor-Authentifizierung wird geladen …')).toBeTruthy();
    expect(await screen.findByText('Der Stand der Zwei-Faktor-Authentifizierung konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();

    answer = () => ({ body: off });
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('button', { name: 'Einrichten' })).toBeTruthy();
    expect(screen.getByText('Aus')).toBeTruthy();
  });

  it('shows the QR code and the key of the server, and names a wrong code at the field, where the focus stays', async () => {
    const { user, field } = await startSetup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    expect(screen.getByRole('img', { name: 'QR-Code für die Authenticator-App' }).getAttribute('src')).toBe(QR);
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.click(screen.getByRole('button', { name: 'Schlüssel kopieren' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);

    await user.type(field, '000000');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Der Code stimmt nicht. Nimm den aktuellen aus der App.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.type(field, '1');
    expect(screen.queryByText('Der Code stimmt nicht. Nimm den aktuellen aus der App.')).toBeNull();
  });

  it('switches on with the code, shows the recovery codes of the answer once, and asks before they are left', async () => {
    const { user, field } = await startSetup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    // a password half typed: while the codes show, only their question counts
    await user.type(screen.getByLabelText('Aktuelles Passwort'), 'x');

    // apps show the code with a blank in the middle
    await user.type(field, '123 456');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));

    const codes = await screen.findByRole('list', { name: 'Recovery-Codes' });
    expect(lastCall('POST', '/api/v1/me/two-factor/confirm')!.body).toEqual({ code: '123456' });
    expect(within(codes).getAllByRole('listitem').map((item) => item.textContent)).toEqual(CODES);
    expect(toastTitles()).toContain('Zwei-Faktor-Authentifizierung eingeschaltet');
    await waitFor(() => expect(document.activeElement).toBe(codes));
    expect(screen.queryByRole('img', { name: 'QR-Code für die Authenticator-App' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Alle kopieren' }));
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));

    expect(leaveTo('/projects')).toBe('stopped');
    expect(await screen.findAllByRole('alertdialog')).toHaveLength(1);
    expect(screen.getByRole('alertdialog', { name: 'Recovery-Codes gesichert?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zurück zu den Codes' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));
    expect(screen.queryByRole('list', { name: 'Recovery-Codes' })).toBeNull();
    expect(await screen.findByText('Aktiv seit 30.10.2026.')).toBeTruthy();
    expect(screen.getByText('8 von 8 Recovery-Codes sind noch übrig.')).toBeTruthy();
    expect(screen.getByText('Aktiv')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Aktiv seit 30.10.2026.').parentElement));
    // the password form asks again now that the codes are gone
    expect(leaveTo('/projects')).toBe('stopped');
    expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
  });

  it('keeps the recovery codes when the state cannot be loaded again after them', async () => {
    const user = userEvent.setup();
    let failing = false;
    renderSettings('security', server({ 'GET /api/v1/me/two-factor': () => (failing ? unavailable() : { body: off }) }));
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    const field = await screen.findByRole('textbox', { name: 'Code aus der App' });

    failing = true;
    await user.type(field, '123456');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));

    const codes = await screen.findByRole('list', { name: 'Recovery-Codes' });
    await waitFor(() => expect(calls('GET', '/api/v1/me/two-factor').length).toBeGreaterThan(1));
    expect(within(codes).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByText('Der Stand der Zwei-Faktor-Authentifizierung konnte nicht geladen werden')).toBeNull();
  });

  it('throws a setup away that is left half-way, like "Abbrechen"', async () => {
    const user = userEvent.setup();
    const view = renderSettings('security', server());
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    await screen.findByRole('textbox', { name: 'Code aus der App' });
    expect(calls('DELETE', '/api/v1/me/two-factor')).toEqual([]);

    view.unmount();

    await waitFor(() => expect(calls('DELETE', '/api/v1/me/two-factor')).toHaveLength(1));
  });

  it('leaves the server alone when the screen goes without a setup running, and stays quiet when throwing one away fails', async () => {
    const user = userEvent.setup();
    const first = renderSettings('security', server());
    await screen.findByRole('button', { name: 'Einrichten' });
    first.unmount();
    expect(calls('DELETE', '/api/v1/me/two-factor')).toEqual([]);
    api!.restore();

    const second = renderSettings('security', server({ 'DELETE /api/v1/me/two-factor': unavailable }));
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    await screen.findByRole('textbox', { name: 'Code aus der App' });
    second.unmount();

    await waitFor(() => expect(calls('DELETE', '/api/v1/me/two-factor')).toHaveLength(1));
    expect(toastTitles()).toEqual([]);
  });

  it('throws an abandoned setup away, so the next one starts anew with a new key', async () => {
    const { user } = await startSetup();
    expect(screen.getByText(groupKey(SECRET))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    const start = await screen.findByRole('button', { name: 'Einrichten' });
    await waitFor(() => expect(lastCall('DELETE', '/api/v1/me/two-factor')).toBeDefined());
    await waitFor(() => expect(document.activeElement).toBe(start));
    expect(screen.queryByText(groupKey(SECRET))).toBeNull();

    await user.click(start);
    expect(await screen.findByText('KRSX G5CT MVRX EZLU')).toBeTruthy();
    expect(calls('POST', '/api/v1/me/two-factor')).toHaveLength(2);
  });

  it('says when the setup cannot start, the abandoned one cannot be thrown away, or the code cannot be checked', async () => {
    const user = userEvent.setup();
    let start: MockRoute = unavailable;
    let discard: MockRoute = unavailable;
    let confirm: MockRoute = unavailable;
    renderSettings(
      'security',
      server({
        'POST /api/v1/me/two-factor': (body, url) => start(body, url),
        'DELETE /api/v1/me/two-factor': (body, url) => discard(body, url),
        'POST /api/v1/me/two-factor/confirm': (body, url) => confirm(body, url),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    await waitFor(() => expect(toastTitles()).toContain('Einrichtung nicht gestartet'));
    start = () => ({ body: { secret: SECRET, otpauth_url: 'otpauth://totp/werkbuch', qr_svg: QR } });
    act(() => runToastAction(toastNamed('Einrichtung nicht gestartet').id));
    const field = await screen.findByRole('textbox', { name: 'Code aus der App' });

    await user.type(field, '123456');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(toastTitles()).toContain('Der Code wurde nicht geprüft'));
    confirm = () => problem(409, 'two_factor_not_pending', { detail: 'Es läuft keine Einrichtung.' });
    act(() => runToastAction(toastNamed('Der Code wurde nicht geprüft').id));
    await waitFor(() => expect(calls('POST', '/api/v1/me/two-factor/confirm')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(toastTitles()).toContain('Angefangene Einrichtung nicht verworfen'));
    discard = () => ({ status: 204 });
    act(() => runToastAction(toastNamed('Angefangene Einrichtung nicht verworfen').id));
    await waitFor(() => expect(calls('DELETE', '/api/v1/me/two-factor')).toHaveLength(2));
  });

  it('issues new recovery codes after asking, and keeps the question when that fails', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = unavailable;
    renderSettings('security', {
      'GET /api/v1/me/two-factor': () => ({ body: on }),
      'POST /api/v1/me/two-factor/recovery-codes': (body, url) => answer(body, url),
    });

    expect(await screen.findByText('5 von 8 Recovery-Codes sind noch übrig.')).toBeTruthy();
    expect(screen.getByText('Aktiv seit 20.10.2026.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Neue Recovery-Codes' }));
    const question = await screen.findByRole('alertdialog', { name: 'Neue Recovery-Codes erzeugen?' });
    await user.click(within(question).getByRole('button', { name: 'Erzeugen' }));
    await waitFor(() => expect(toastTitles()).toContain('Keine neuen Recovery-Codes erzeugt'));
    expect(screen.getByRole('alertdialog', { name: 'Neue Recovery-Codes erzeugen?' })).toBeTruthy();

    answer = () => ({ body: { recovery_codes: CODES } });
    act(() => runToastAction(toastNamed('Keine neuen Recovery-Codes erzeugt').id));

    const codes = await screen.findByRole('list', { name: 'Recovery-Codes' });
    expect(within(codes).getAllByRole('listitem')).toHaveLength(8);
    expect(toastNamed('Neue Recovery-Codes erzeugt').description).toBe('Die alten gelten nicht mehr.');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('turns it off after asking, and says so when that fails', async () => {
    const user = userEvent.setup();
    let state = on;
    let answer: MockRoute = unavailable;
    renderSettings('security', {
      'GET /api/v1/me/two-factor': () => ({ body: state }),
      'DELETE /api/v1/me/two-factor': (body, url) => answer(body, url),
    });

    await user.click(await screen.findByRole('button', { name: 'Deaktivieren' }));
    const question = await screen.findByRole('alertdialog', { name: 'Zwei-Faktor ausschalten?' });
    expect(question.textContent).toContain('Beim Anmelden reicht danach das Passwort.');
    await user.click(within(question).getByRole('button', { name: 'Ausschalten' }));
    await waitFor(() => expect(toastTitles()).toContain('Zwei-Faktor nicht ausgeschaltet'));

    answer = () => {
      state = off;
      return { status: 204 };
    };
    act(() => runToastAction(toastNamed('Zwei-Faktor nicht ausgeschaltet').id));

    await waitFor(() => expect(toastTitles()).toContain('Zwei-Faktor-Authentifizierung ausgeschaltet'));
    const start = await screen.findByRole('button', { name: 'Einrichten' });
    await waitFor(() => expect(document.activeElement).toBe(start));
    expect(screen.getByText('Aus')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- API */

describe('API & MCP', () => {
  it('lists the own tokens with what they may do, when they were used and when they expire', async () => {
    renderSettings('api', {
      'GET /api/v1/tokens': () => ({
        body: list([
          token('t_old', { name: 'CI-Skript', abilities: ['read', 'write'], expires_at: '2026-09-30T21:59:00.000Z', last_used_at: '2026-09-29T20:15:00.000Z' }),
          token('t_mcp', { name: 'Claude Code', abilities: ['read', 'write', 'mcp'], expires_at: '2099-01-01T12:00:00.000Z' }),
          token('t_new', { name: 'Neu' }),
        ]),
      }),
    });

    expect(screen.getByText('Die Tokens werden geladen …')).toBeTruthy();
    const rows = within(await screen.findByRole('list', { name: 'Tokens' })).getAllByRole('listitem', { name: '' }).filter((row) => row.querySelector('h3'));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('LesenSchreibenAbgelaufen');
    expect(rows[0]!.textContent).toContain('Angelegt am 05.10.2026, zuletzt benutzt am 29.09.2026');
    expect(rows[0]!.textContent).toContain('Abgelaufen am 30.09.2026');
    expect(rows[1]!.textContent).toContain('LesenSchreibenMCP');
    expect(rows[1]!.textContent).toContain('Läuft ab am 01.01.2099');
    expect(rows[2]!.textContent).toContain('Angelegt am 05.10.2026, noch nie benutzt');
    expect(rows[2]!.textContent).not.toContain('Läuft ab');
    expect(lastCall('GET', '/api/v1/tokens')!.url).toBe('/api/v1/tokens?user_id=u_mara');
  });

  it('shows the cause and "Erneut versuchen" when the tokens cannot be loaded', async () => {
    renderSettings('api', { 'GET /api/v1/tokens': unavailable });

    expect(await screen.findByText('Die Tokens konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });

  it('explains an empty list, and both buttons open the dialog for a token of the own account', async () => {
    const user = userEvent.setup();
    renderSettings('api', {
      'POST /api/v1/tokens': (body) => ({ status: 201, body: { token: token('t_cc', { name: (body as { name: string }).name }), plain_text: '01jtoken|wb_secret' } }),
    });

    expect(await screen.findByText('Noch keine Tokens')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ersten Token anlegen' }));
    let dialog = await screen.findByRole('dialog', { name: 'Neuer Token' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Neuer Token' }));
    dialog = await screen.findByRole('dialog', { name: 'Neuer Token' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Claude Code');
    await user.click(within(dialog).getByRole('button', { name: /Token anlegen/ }));

    expect(await screen.findByRole('heading', { name: 'Token angelegt' })).toBeTruthy();
    expect(lastCall('POST', '/api/v1/tokens')!.body).toEqual({ user_id: 'u_mara', name: 'Claude Code', abilities: ['read', 'write', 'mcp'], expires_at: null });
    await user.click(screen.getByRole('button', { name: 'Ich habe den Token kopiert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('revokes a token when the undo time is over, and hides it meanwhile', async () => {
    const user = userEvent.setup();
    renderSettings('api', {
      'GET /api/v1/tokens': () => ({ body: list([token('t_one', { name: 'Laptop' })]) }),
      'DELETE /api/v1/tokens/t_one': () => ({ status: 204 }),
    });

    await user.click(await screen.findByRole('button', { name: 'Laptop widerrufen' }));
    expect(screen.queryByText('Laptop')).toBeNull();
    expect(screen.getByText('Noch keine Tokens')).toBeTruthy();
    act(() => dismissToast(toastNamed('Token „Laptop“ widerrufen').id));

    await waitFor(() => expect(lastCall('DELETE', '/api/v1/tokens/t_one')).toBeDefined());
  });

  it('names the MCP server and the REST API of this instance and offers the setup snippets', () => {
    renderSettings('api');

    const origin = window.location.origin;
    expect(screen.getByText('MCP-Server').nextElementSibling!.textContent).toBe(`${origin}/mcp`);
    expect(screen.getByText('REST-API').nextElementSibling!.textContent).toBe(`${origin}/api/v1`);
    expect(screen.getByText(new RegExp(`claude mcp add --transport http --scope user werkbuch ${origin}/mcp`))).toBeTruthy();
  });
});
