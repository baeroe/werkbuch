/*
 * Settings → GitHub (spec 10.2, 11.3, org admins) against a fake REST API (`mockApi`): connecting the app of a GitHub
 * account (the manifest posted to GitHub, own account or organization, the refusals), the apps (one per account, A680)
 * with their installations and repos, another app, reading again, disconnecting one app, members, loading and a failed
 * load. The flow with a real server runs in e2e/tests/github.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifestPhp from '/app/GitHub/Manifest.php?raw';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { lene, list, mara as maraUser, organization, project } from '@/test/fixtures';
import type { GitHubApp, GitHubRepository, GitHubStatus, User } from '@/types';
import { OrgSettings } from '../OrgSettings';
import { proposedName, reposByApp } from './GitHub';
import { MANIFEST_PERMISSIONS, permissionText } from './permissions';

let signedIn: User = maraUser;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

const problem = (status: number, reason: string, detail: string, errors?: Record<string, string[]>) => ({
  status,
  body: { type: 'about:blank', title: reason, status, reason, detail, ...(errors ? { errors } : {}) },
});

const repo = (full_name: string, changes: Partial<GitHubRepository> = {}): GitHubRepository => ({
  id: `r_${full_name}`,
  installation_id: 'i_feldwerk',
  full_name,
  private: true,
  default_branch: 'main',
  html_url: `https://github.com/${full_name}`,
  removed_at: null,
  taken: false,
  project: null,
  ...changes,
});

const linked = (identifier: string, changes: Partial<NonNullable<GitHubRepository['project']>> = {}): NonNullable<GitHubRepository['project']> => ({
  id: `p_${identifier.toLowerCase()}`,
  identifier,
  name: identifier,
  base_branch: 'main',
  protected: true,
  guarded: false,
  ...changes,
});

const disconnected: GitHubStatus = { apps: [], repositories: [] };

const feldwerk: GitHubApp = {
  id: 'a_1',
  app_id: 4200123,
  slug: 'feldwerk-werkbuch',
  name: 'feldwerk werkbuch',
  owner_login: 'feldwerk',
  owner_type: 'Organization',
  html_url: 'https://github.com/apps/feldwerk-werkbuch',
  install_url: 'https://github.com/apps/feldwerk-werkbuch/installations/new',
  permissions: { contents: 'write', pull_requests: 'write', checks: 'read' },
  events: ['push'],
  created_at: '2026-11-20T09:00:00.000Z',
  installations: [
    { id: 'i_feldwerk', installation_id: 55000001, account_login: 'feldwerk', account_type: 'Organization', repository_selection: 'selected', suspended_at: null, removed_at: null },
  ],
};

/** The app of a person's own account (A680: one app per account). */
const maraApp: GitHubApp = {
  ...feldwerk,
  id: 'a_2',
  app_id: 4200456,
  slug: 'mara-lindqvist-werkbuch',
  name: 'mara-lindqvist werkbuch',
  owner_login: 'mara-lindqvist',
  owner_type: 'User',
  html_url: 'https://github.com/apps/mara-lindqvist-werkbuch',
  install_url: 'https://github.com/apps/mara-lindqvist-werkbuch/installations/new',
  installations: [{ id: 'i_mara', installation_id: 55000002, account_login: 'mara-lindqvist', account_type: 'User', repository_selection: 'all', suspended_at: null, removed_at: null }],
};

const connected = (changes: Partial<GitHubStatus> = {}): GitHubStatus => ({
  apps: [feldwerk],
  repositories: [
    repo('feldwerk/website', { taken: true, project: linked('WEB') }),
    repo('feldwerk/kunden-app', { taken: true, project: linked('APP', { protected: false, base_branch: 'develop', guarded: true }) }),
    repo('feldwerk/infrastruktur', { taken: true, project: linked('OPS', { protected: null }) }),
    repo('feldwerk/geheim', { taken: true }),
    repo('feldwerk/design-tokens', { private: false }),
    repo('feldwerk/alt', { removed_at: '2026-11-21T09:00:00.000Z' }),
  ],
  ...changes,
});

const twoApps = (): GitHubStatus => connected({ apps: [feldwerk, maraApp], repositories: [...connected().repositories, repo('mara-lindqvist/notizen', { installation_id: 'i_mara' })] });

let api: MockApi | undefined;
let submitted: HTMLFormElement[] = [];

function renderGitHub(status: GitHubStatus | MockRoute = disconnected, overrides: Record<string, MockRoute> = {}) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }),
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/github': typeof status === 'function' ? status : () => ({ body: { data: status } }),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrgSettings section="github" />
    </QueryClientProvider>,
  );
}

const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);

beforeEach(() => {
  submitted = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    submitted.push(this);
  });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = maraUser;
  resetToasts();
  vi.restoreAllMocks();
  document.body.querySelectorAll('form[hidden]').forEach((form) => form.remove());
});

describe('the rights of the app', () => {
  it('asks for what the manifest of the server asks for', () => {
    const asked = Object.fromEntries([...manifestPhp.matchAll(/'(\w+)' => '(read|write)'/g)].map((match) => [match[1], match[2]]));
    expect(MANIFEST_PERMISSIONS).toEqual(asked);
    expect(Object.keys(MANIFEST_PERMISSIONS)).toEqual(Object.keys(asked));
  });

  it('says a right werkbuch does not know as GitHub names it', () => {
    expect(permissionText('contents', 'write')).toBe('Inhalte schreiben');
    expect(permissionText('issues', 'admin')).toBe('issues admin');
  });

  it('proposes the name of the manifest within the 34 characters of GitHub', () => {
    expect(proposedName('feldwerk')).toBe('feldwerk werkbuch');
    expect(proposedName('feldwerk-gmbh-mit-einem-sehr-langen-nam')).toBe('feldwerk-gmbh-mit-einem-s werkbuch');
    expect(proposedName('feldwerk-gmbh-mit-einem-sehr-langen-nam')).toHaveLength(34);
  });

  it('gives every repo to the app whose installation reaches it', () => {
    const byApp = reposByApp({ ...twoApps(), repositories: [...twoApps().repositories, repo('nobody/lost', { installation_id: 'i_gone' })] });
    expect(byApp.get('a_1')!.map((entry) => entry.full_name)).toEqual(connected().repositories.map((entry) => entry.full_name));
    expect(byApp.get('a_2')!.map((entry) => entry.full_name)).toEqual(['mara-lindqvist/notizen']);
  });
});

describe('GitHub, not connected', () => {
  it('sits in the group "Betrieb" and offers to connect with the rights and the webhook address', async () => {
    renderGitHub();

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe('/settings/github');
    const panel = await screen.findByRole('region', { name: 'Mit GitHub verbinden' });
    expect(within(panel).getByText('Inhalte schreiben, Pull Requests schreiben, Checks lesen, Actions lesen, Commit-Status lesen, Metadaten lesen')).toBeTruthy();
    expect(within(panel).getByText(`${window.location.origin}/github/webhook`).getAttribute('translate')).toBe('no');
    // an organization by default; the name follows the login
    expect((within(panel).getByRole('radio', { name: 'Eine GitHub-Organisation' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('button', { name: 'Weitere App hinzufügen' })).toBeNull();
    expect(document.title).toBe('GitHub – Einstellungen – werkbuch');
  });

  it('posts the manifest to GitHub for the own account', async () => {
    const user = userEvent.setup();
    const manifest = { name: 'mara-lindqvist werkbuch', default_events: ['push'] };
    renderGitHub(disconnected, {
      'POST /api/v1/github/manifest': () => ({ body: { data: { url: 'https://github.com/settings/apps/new?state=abc', manifest, state: 'abc' } } }),
    });

    await user.click(await screen.findByRole('radio', { name: 'Mein GitHub-Konto' }));
    const login = screen.getByRole('textbox', { name: 'Dein GitHub-Login' });
    await user.type(login, '  mara-lindqvist ');
    expect(screen.getByText(/Vorgeschlagener Name: mara-lindqvist werkbuch\./)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mit GitHub verbinden' }));

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(calls('POST', '/api/v1/github/manifest')[0].body).toEqual({ owner: 'mara-lindqvist', owner_type: 'User' });
    const [form] = submitted;
    expect(form.method).toBe('post');
    expect(form.action).toBe('https://github.com/settings/apps/new?state=abc');
    expect(JSON.parse((form.elements.namedItem('manifest') as HTMLInputElement).value)).toEqual(manifest);
    // the page leaves: the button stays busy, a second press posts nothing more
    const button = screen.getByRole('button', { name: /Mit GitHub verbinden/ });
    expect(button.getAttribute('aria-busy') ?? button.getAttribute('aria-disabled')).toBeTruthy();
    await user.click(button);
    expect(calls('POST', '/api/v1/github/manifest')).toHaveLength(1);

    // a page shown again from memory only (another page's pageshow) keeps it busy
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    await user.click(button);
    expect(calls('POST', '/api/v1/github/manifest')).toHaveLength(1);
    // back from GitHub through the back/forward cache: the button works again
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mit GitHub verbinden' }).getAttribute('aria-busy')).not.toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Mit GitHub verbinden' }));
    await waitFor(() => expect(calls('POST', '/api/v1/github/manifest')).toHaveLength(2));
  });

  it('posts it for a GitHub organization with Enter in the field', async () => {
    const user = userEvent.setup();
    renderGitHub(disconnected, {
      'POST /api/v1/github/manifest': () => ({ body: { data: { url: 'https://github.com/organizations/feldwerk/settings/apps/new?state=abc', manifest: {}, state: 'abc' } } }),
    });

    await user.type(await screen.findByRole('textbox', { name: 'Login der Organisation' }), '  feldwerk {Enter}');

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(calls('POST', '/api/v1/github/manifest')[0].body).toEqual({ owner: 'feldwerk', owner_type: 'Organization' });
  });

  it('asks for the login before it asks the server', async () => {
    const user = userEvent.setup();
    renderGitHub();

    await user.click(await screen.findByRole('button', { name: 'Mit GitHub verbinden' }));

    const field = screen.getByRole('textbox', { name: 'Login der Organisation' });
    expect(await screen.findByText('Nenne den Login des GitHub-Kontos, dem die App gehört.')).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(calls('POST', '/api/v1/github/manifest')).toHaveLength(0);
  });

  it('shows a login GitHub does not know, a kind it does not know and an account with an app at their fields', async () => {
    const user = userEvent.setup();
    let answer = problem(422, 'validation_failed', 'Fehler', { owner: ['Nenne einen GitHub-Login.'] });
    renderGitHub(disconnected, { 'POST /api/v1/github/manifest': () => answer });

    const field = await screen.findByRole('textbox', { name: 'Login der Organisation' });
    await user.type(field, 'a--b{Enter}');

    expect(await screen.findByText('Nenne einen GitHub-Login.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(submitted).toHaveLength(0);
    await user.type(field, 'x');
    expect(screen.queryByText('Nenne einen GitHub-Login.')).toBeNull();

    answer = problem(422, 'validation_failed', 'Fehler', { owner_type: ['Wähle, ob das Konto dein eigenes oder eine Organisation ist.'] });
    await user.type(field, '{Enter}');
    expect(await screen.findByText('Wähle, ob das Konto dein eigenes oder eine Organisation ist.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Eine GitHub-Organisation' }));

    // one app per account (A680): the sentence of the server at the login
    answer = problem(409, 'github_connected', 'Das GitHub-Konto „feldwerk“ hat seine App schon.');
    await user.type(field, '{Enter}');
    expect(await screen.findByText('Das GitHub-Konto „feldwerk“ hat seine App schon.')).toBeTruthy();
    expect(document.activeElement).toBe(field);
  });

  it('says why it could not start and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderGitHub(disconnected, {
      'POST /api/v1/github/manifest': () => (fail ? problem(500, 'server_error', 'Kaputt') : { body: { data: { url: 'https://github.com/settings/apps/new?state=x', manifest: {}, state: 'x' } } }),
    });

    await user.type(await screen.findByRole('textbox', { name: 'Login der Organisation' }), 'feldwerk');
    await user.click(screen.getByRole('button', { name: 'Mit GitHub verbinden' }));
    await waitFor(() => expect(toastNamed('GitHub nicht verbunden')).toBeTruthy());
    expect(submitted).toHaveLength(0);

    fail = false;
    runToastAction(toastNamed('GitHub nicht verbunden')!.id);
    await waitFor(() => expect(submitted).toHaveLength(1));
  });
});

describe('GitHub, connected', () => {
  it('shows the app, its installations and the repos with project and ruleset', async () => {
    renderGitHub(
      connected({
        apps: [
          {
            ...feldwerk,
            installations: [
              ...feldwerk.installations,
              { id: 'i_hauss', installation_id: 2, account_login: 'feldwerk', account_type: 'Organization', repository_selection: 'all', suspended_at: '2026-11-21T09:00:00.000Z', removed_at: null },
              { id: 'i_old', installation_id: 3, account_login: 'feldwerk', account_type: 'Organization', repository_selection: 'all', suspended_at: null, removed_at: '2026-11-21T09:00:00.000Z' },
            ],
          },
        ],
      }),
    );

    const panel = await screen.findByRole('region', { name: 'App für feldwerk' });
    const app = within(panel).getByRole('list', { name: 'GitHub-App für feldwerk' });
    expect(within(app).getByText('feldwerk werkbuch')).toBeTruthy();
    expect(within(app).getByText('Installiert')).toBeTruthy();
    expect(within(app).getByText('Inhalte schreiben, Pull Requests schreiben, Checks lesen. Webhooks an werkbuch. Angelegt am 20.11.2026.')).toBeTruthy();
    expect(within(app).getByRole('link', { name: 'Bei GitHub (öffnet GitHub, feldwerk werkbuch)' }).getAttribute('href')).toBe('https://github.com/apps/feldwerk-werkbuch');

    const installations = within(within(panel).getByRole('list', { name: 'Installationen der App für feldwerk' })).getAllByRole('listitem');
    expect(installations.map((row) => row.textContent)).toEqual(['feldwerkausgewählte Repos', 'feldwerkalle ReposAusgesetzt', 'feldwerkalle ReposEntfernt']);

    const repos = within(within(panel).getByRole('list', { name: 'Freigegebene Repos der App für feldwerk' })).getAllByRole('listitem');
    const row = (name: string) => repos.find((entry) => entry.textContent!.startsWith(name))!;
    expect(row('feldwerk/website').textContent).toBe('feldwerk/websiteprivatRuleset schützt mainWEB');
    expect(row('feldwerk/kunden-app').textContent).toBe('feldwerk/kunden-appprivatEigenmächtiger Merge: pausiertdevelop ohne RulesetAPP');
    expect(row('feldwerk/infrastruktur').textContent).toBe('feldwerk/infrastrukturprivatRuleset unbekanntOPS');
    expect(row('feldwerk/geheim').textContent).toBe('feldwerk/geheimprivatanderes Projekt');
    expect(row('feldwerk/design-tokens').textContent).toBe('feldwerk/design-tokensKein Projekt');
    expect(row('feldwerk/alt').textContent).toBe('feldwerk/altprivatbei GitHub entferntKein Projekt');

    // in the same tab: GitHub comes back to the settings, a second tab would keep this page with the old repos
    const change = within(panel).getByRole('link', { name: 'Repos bei GitHub ändern (App für feldwerk, führt zu GitHub)' });
    expect(change.getAttribute('href')).toBe('/github/install?app=a_1');
    expect(change.hasAttribute('target')).toBe(false);
    expect(screen.getByText('Ruleset empfohlen')).toBeTruthy();
  });

  it('shows every app with its own installations and repos', async () => {
    renderGitHub(twoApps());

    const own = await screen.findByRole('region', { name: 'App für mara-lindqvist' });
    expect(within(own).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('mara-lindqvist werkbuch'),
      'mara-lindqvistalle Repos',
      'mara-lindqvist/notizenprivatKein Projekt',
    ]);
    expect(within(screen.getByRole('region', { name: 'App für feldwerk' })).queryByText('mara-lindqvist/notizen')).toBeNull();
    expect(within(own).getByRole('link', { name: /Repos bei GitHub ändern/ }).getAttribute('href')).toBe('/github/install?app=a_2');
  });

  it('says what is missing without installation and repos', async () => {
    renderGitHub(connected({ apps: [{ ...feldwerk, installations: [], events: [], created_at: null }], repositories: [] }));

    expect(await screen.findByText(/Noch nicht installiert/)).toBeTruthy();
    expect(screen.getByText(/Noch keine Repos freigegeben/)).toBeTruthy();
    expect(screen.queryByText('Installiert')).toBeNull();
    expect(screen.getByText('Inhalte schreiben, Pull Requests schreiben, Checks lesen. Keine Webhooks.')).toBeTruthy();
  });

  it('reads the repos of every app again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderGitHub(twoApps(), {
      'POST /api/v1/github/sync': () => (fail ? problem(503, 'github_unavailable', 'GitHub antwortet nicht.') : { body: { data: twoApps() } }),
    });

    await user.click(await screen.findByRole('button', { name: 'Neu einlesen' }));
    await waitFor(() => expect(toastNamed('Repos nicht neu eingelesen')).toBeTruthy());

    fail = false;
    runToastAction(toastNamed('Repos nicht neu eingelesen')!.id);
    await waitFor(() => expect(toastNamed('Repos neu eingelesen')?.description).toBe('6 Repos sind freigegeben.'));
  });

  it('adds the app of another account in a dialog and gives the focus back when it closes', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = () => problem(409, 'github_connected', 'Das GitHub-Konto „feldwerk“ hat seine App schon.');
    renderGitHub(connected(), { 'POST /api/v1/github/manifest': (body, url) => answer(body, url) });

    const add = await screen.findByRole('button', { name: 'Weitere App hinzufügen' });
    await user.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'App eines weiteren GitHub-Kontos' });
    expect(within(dialog).getByText(/nur auf dem GitHub-Konto installieren, dem sie gehört/)).toBeTruthy();
    const field = within(dialog).getByRole('textbox', { name: 'Login der Organisation' });
    await user.type(field, 'feldwerk');
    await user.click(within(dialog).getByRole('button', { name: /Weiter zu GitHub/ }));
    expect(await within(dialog).findByText('Das GitHub-Konto „feldwerk“ hat seine App schon.')).toBeTruthy();
    expect(document.activeElement).toBe(field);

    answer = () => ({ body: { data: { url: 'https://github.com/organizations/feldwerk-labs/settings/apps/new?state=s', manifest: {}, state: 's' } } });
    await user.clear(field);
    await user.type(field, 'feldwerk-labs');
    await user.click(within(dialog).getByRole('button', { name: /Weiter zu GitHub/ }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(calls('POST', '/api/v1/github/manifest').at(-1)!.body).toEqual({ owner: 'feldwerk-labs', owner_type: 'Organization' });
  });

  it('closes the dialog without a call and gives the focus back to its button', async () => {
    const user = userEvent.setup();
    renderGitHub(connected());

    const add = await screen.findByRole('button', { name: 'Weitere App hinzufügen' });
    await user.click(add);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(document.activeElement).toBe(add));
    expect(calls('POST', '/api/v1/github/manifest')).toHaveLength(0);
  });

  it('disconnects one app after asking and gives the focus to the title', async () => {
    const user = userEvent.setup();
    let status = twoApps();
    renderGitHub(() => ({ body: { data: status } }), {
      'DELETE /api/v1/github/apps/a_2': () => {
        status = connected();
        return { body: { canceled: 2 } };
      },
    });

    const own = await screen.findByRole('region', { name: 'App für mara-lindqvist' });
    await user.click(within(own).getByRole('button', { name: 'Trennen (App für mara-lindqvist)' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'App für mara-lindqvist trennen?' });
    expect(within(dialog).getByText(/Die anderen Apps bleiben verbunden/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Trennen' }));

    await waitFor(() => expect(toastNamed('App für mara-lindqvist getrennt')).toBeTruthy());
    expect(toastNamed('App für mara-lindqvist getrennt')!.description).toBe('2 laufende Aufträge wurden abgebrochen. Lösche die App bei GitHub, wenn du sie nicht mehr brauchst.');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'App für mara-lindqvist' })).toBeNull());
    expect(screen.getByRole('region', { name: 'App für feldwerk' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'GitHub' })));
  });

  it('says a disconnect without canceled runs, one that failed, and keeps the focus on the button when asked back', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderGitHub(connected(), {
      'DELETE /api/v1/github/apps/a_1': () => (fail ? problem(500, 'server_error', 'Kaputt') : { body: { canceled: 0 } }),
    });

    const button = await screen.findByRole('button', { name: 'Trennen (App für feldwerk)' });
    await user.click(button);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(document.activeElement).toBe(button));

    await user.click(button);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Trennen' }));
    await waitFor(() => expect(toastNamed('App nicht getrennt')).toBeTruthy());

    fail = false;
    runToastAction(toastNamed('App nicht getrennt')!.id);
    await waitFor(() => expect(toastNamed('App für feldwerk getrennt')?.description).toBe('Lösche die App bei GitHub, wenn du sie nicht mehr brauchst.'));
  });
});

describe('GitHub, the states', () => {
  it('tells a member it is for admins and loads nothing', async () => {
    signedIn = lene;
    renderGitHub();

    expect(await screen.findByText(/Nur für Admins/)).toBeTruthy();
    expect(calls('GET', '/api/v1/github')).toHaveLength(0);
  });

  it('says a failed load and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderGitHub(() => (fail ? problem(500, 'server_error', 'Kaputt') : { body: { data: disconnected } }));

    expect(await screen.findByText('Die Verbindung zu GitHub konnte nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('region', { name: 'Mit GitHub verbinden' })).toBeTruthy();
  });
});
