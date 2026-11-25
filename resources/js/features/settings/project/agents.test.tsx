/*
 * Project → Agenten (spec 10.3, 11.3) against a fake server: the repo and its base branch, GitHub not connected, the
 * status per step to read with the way to the workflow, agents off without all steps, the guard against an
 * unauthorized merge and its confirmation, readers. The flows with a real server run in e2e/tests/github.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, standard } from '@/test/fixtures';
import type { GitHubApp, GitHubRepository, GitHubStatus, Label, MergeGuard, ProjectAgents, ProjectRepository, User, Workflow } from '@/types';
import { ProjectSettings } from './ProjectSettings';

let signedIn: User = ida;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: '/projects/WEB/settings/agents' }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { visit: vi.fn(), replace: vi.fn(), reload: vi.fn(), on: () => () => {} },
}));

/* -------------------------------------------------------------------------- data */

const repo = (id: string, full_name: string, changes: Partial<GitHubRepository> = {}): GitHubRepository => ({
  id,
  installation_id: 'i_1',
  full_name,
  private: true,
  default_branch: 'main',
  html_url: `https://github.com/${full_name}`,
  removed_at: null,
  taken: false,
  project: null,
  ...changes,
});

const app: GitHubApp = {
  id: 'a_1',
  app_id: 1,
  slug: 'feldwerk-werkbuch',
  name: 'Feldwerk werkbuch',
  owner_login: 'feldwerk',
  owner_type: 'Organization',
  html_url: 'https://github.com/apps/feldwerk-werkbuch',
  install_url: 'https://github.com/apps/feldwerk-werkbuch/installations/new',
  permissions: {},
  events: [],
  created_at: null,
  installations: [{ id: 'i_1', installation_id: 1, account_login: 'feldwerk', account_type: 'Organization', repository_selection: 'all', suspended_at: null, removed_at: null }],
};

/** The app of a second GitHub account (A680) with one repo. */
const labs: GitHubApp = {
  ...app,
  id: 'a_2',
  slug: 'feldwerk-labs-werkbuch',
  name: 'feldwerk-labs werkbuch',
  owner_login: 'feldwerk-labs',
  installations: [{ ...app.installations[0]!, id: 'i_2', installation_id: 2, account_login: 'feldwerk-labs' }],
};

const github: GitHubStatus = {
  apps: [app, labs],
  repositories: [
    repo('r_web', 'feldwerk/website', { taken: true, project: { id: 'p_web', identifier: 'WEB', name: 'Website', base_branch: 'main', protected: true, guarded: false } }),
    repo('r_app', 'feldwerk/kunden-app', { default_branch: 'develop' }),
    repo('r_ops', 'feldwerk/infrastruktur', { taken: true, project: { id: 'p_ops', identifier: 'OPS', name: 'Ops', base_branch: 'main', protected: null, guarded: false } }),
    repo('r_hidden', 'feldwerk/geheim', { taken: true }),
    repo('r_gone', 'feldwerk/alt', { removed_at: '2026-11-01T00:00:00.000Z' }),
    repo('r_labs', 'feldwerk-labs/app', { installation_id: 'i_2' }),
  ],
};

const linkOf = (repository: GitHubRepository, changes: Partial<ProjectRepository> = {}): ProjectRepository => ({
  project_id: 'p_web',
  repository: { id: repository.id, full_name: repository.full_name, private: repository.private, default_branch: repository.default_branch, html_url: repository.html_url, removed_at: repository.removed_at },
  base_branch: 'main',
  protected: true,
  protected_checked_at: null,
  guard: null,
  updated_at: null,
  ...changes,
});

const guard: MergeGuard = {
  detected_at: '2026-11-20T08:15:00.000Z',
  sha: 'a41c9e7d00ff',
  branch: 'main',
  runs: [
    { run_id: 'run_1', item_id: 'i_web47', bot_id: 'u_kira' },
    { run_id: 'run_2', item_id: 'i_web47', bot_id: 'u_kira' },
    { run_id: 'run_3', item_id: 'i_web48', bot_id: 'u_kira' },
    { run_id: 'run_4', item_id: null, bot_id: null },
  ],
};

const kira = { ...lene, id: 'u_kira', name: 'Kira', handle: 'kira', type: 'bot' as const, owner_id: 'u_mara' };
const rita = { ...lene, id: 'u_rita', name: 'Rita', handle: 'rita', type: 'bot' as const, owner_id: 'u_mara' };
const vera = { ...lene, id: 'u_vera', name: 'Vera', handle: 'vera', type: 'bot' as const, owner_id: 'u_mara' };
const gabi = { ...lene, id: 'u_gone', name: 'Gabi', handle: 'gabi', type: 'bot' as const, owner_id: 'u_mara', disabled_at: '2026-11-01T00:00:00.000Z' };

const defaults: ProjectAgents = {
  project_id: 'p_web',
  review_bot_id: null,
  instructions: null,
  models: {},
  max_corrections: 3,
  max_conflicts: 2,
  review_person_prs: true,
  comment_on_pr: true,
  merge_method: 'squash',
  setup_command: null,
  teardown_command: null,
  bots: [
    { bot_id: 'u_kira', enabled: true, member: true, reviews: true, cli: 'claude', model: 'sonnet', models: { review: 'opus' } },
    { bot_id: 'u_rita', enabled: false, member: true, reviews: true, cli: 'claude', model: 'haiku', models: {} },
    { bot_id: 'u_vera', enabled: true, member: true, reviews: false, cli: 'codex', model: 'gpt-5-codex', models: {} },
  ],
  steps_complete: true,
  updated_at: null,
};

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail: reason, ...extra } });

/* ------------------------------------------------------------------------ server */

let api: MockApi | undefined;

function renderAgents({
  workflow = agency,
  link = linkOf(github.repositories[0]),
  status = github,
  role = 'admin' as const,
  overrides = {},
  agents = defaults,
  catalog = labels,
}: { workflow?: Workflow; link?: ProjectRepository | null; status?: GitHubStatus; role?: 'admin' | 'viewer'; overrides?: Record<string, MockRoute>; agents?: ProjectAgents; catalog?: Label[] } = {}) {
  const web = project('WEB', role, { id: 'p_web', name: 'Website-Relaunch', workflow_id: workflow.id });
  let current = link;
  let settings = agents;
  api = mockApi({
    'GET /api/v1/projects/WEB': () => ({ body: { data: web } }),
    'GET /api/v1/projects': () => ({ body: list([web]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency].map((entry) => (entry.id === workflow.id ? workflow : entry))) }),
    'GET /api/v1/github': () => ({ body: { data: status } }),
    'GET /api/v1/projects/p_web/repository': () => ({ body: { data: current } }),
    'PUT /api/v1/projects/p_web/repository': (body) => {
      const input = body as { repository_id: string | null; base_branch: string | null };
      const chosen = status.repositories.find((entry) => entry.id === input.repository_id);
      current = chosen ? linkOf(chosen, { base_branch: input.base_branch ?? chosen.default_branch }) : null;
      return { body: { data: current } };
    },
    'POST /api/v1/projects/p_web/repository/confirm-guard': () => {
      current = current ? { ...current, guard: null } : null;
      return { body: { data: current } };
    },
    'GET /api/v1/projects/p_web/agents': () => ({ body: { data: settings } }),
    'PUT /api/v1/projects/p_web/agents': (body) => {
      settings = { ...settings, ...(body as Partial<ProjectAgents>), updated_at: '2026-11-24T10:00:00.000Z' };
      return { body: { data: settings } };
    },
    'GET /api/v1/labels': () => ({ body: list(catalog) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene, kira, rita, vera, gabi]) }),
    'GET /api/v1/references': () => ({ body: { data: { items: [makeWorkItem({ id: 'i_web47', key: 'WEB-47' }), makeWorkItem({ id: 'i_web48', key: 'WEB-48' })], pages: [] } } }),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectSettings identifier="WEB" section="agents" />
    </QueryClientProvider>,
  );
}

const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = ida;
  resetToasts();
});

/* ------------------------------------------------------------------------- tests */

describe('Agents: repository', () => {
  it('shows the repo, its base branch and the status per step', async () => {
    signedIn = mara;
    renderAgents();

    expect(await screen.findByRole('heading', { name: 'Repository' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Repo/ }).textContent).toContain('feldwerk/website');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ }).value).toBe('main');
    expect(screen.queryByText(/Agenten aus/)).toBeNull();

    const steps = screen.getByRole('heading', { name: 'Status je Schritt' }).closest('section')!;
    expect(within(steps).getByText('In Arbeit')).toBeTruthy();
    expect(within(steps).getByText('Sobald ein Auftrag startet. Kategorie Started.')).toBeTruthy();
    expect(within(steps).getByText('Bei CI rot, Befunden im Review, einem gescheiterten Auftrag oder der Bremse. Kategorie Unstarted oder Backlog.')).toBeTruthy();
    expect(within(steps).getAllByRole('definition').map((entry) => entry.textContent)).toEqual(['In Progress', 'Review', 'Todo', 'Done']);
    expect(within(steps).getByRole('link', { name: 'Im Workflow „Agentur-Freigabe“ bearbeiten' }).getAttribute('href')).toBe('/settings/workflows?workflow=wf_agency');
    expect(document.title).toBe('Agenten – Einstellungen WEB – werkbuch');
  });

  it('offers the repos the apps reach under the app of their account, a taken one blocked with its project', async () => {
    const user = userEvent.setup();
    renderAgents();

    await user.click(await screen.findByRole('combobox', { name: /Repo/ }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Kein Repo: Aufträge enden mit einer Zusammenfassung',
      'feldwerk/website',
      'feldwerk/kunden-app',
      'feldwerk/infrastruktur (gehört zu OPS)',
      'feldwerk/geheim (gehört zu einem anderen Projekt)',
      'feldwerk-labs/app',
    ]);
    expect(screen.getByRole('group', { name: 'App für feldwerk' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'App für feldwerk-labs' })).getByRole('option').textContent).toBe('feldwerk-labs/app');
    expect(options[3].getAttribute('aria-disabled')).toBe('true');
    expect(options[2].getAttribute('aria-disabled')).toBeNull();
  });

  it('saves another repo with its default branch and says when agents stay off', async () => {
    const user = userEvent.setup();
    signedIn = mara;
    renderAgents({ workflow: standard });

    expect(await screen.findByText('Agenten aus: der Workflow „Standard“ hat noch keine Agenten-Schritte')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Schritte im Workflow einrichten' }).getAttribute('href')).toBe('/settings/workflows?workflow=wf_standard');
    await user.click(screen.getByRole('combobox', { name: /Repo/ }));
    await user.click(await screen.findByRole('option', { name: 'feldwerk/kunden-app' }));
    const branch = screen.getByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ });
    expect(branch.value).toBe('');
    expect(branch.placeholder).toBe('develop');
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(toastNamed('Agenten gespeichert')).toBeTruthy());
    expect(toastNamed('Agenten gespeichert')!.description).toBe('Die Agenten bleiben aus, bis der Workflow „Standard“ alle Agenten-Schritte hat.');
    expect(calls('PUT', '/api/v1/projects/p_web/repository')[0].body).toEqual({ repository_id: 'r_app', base_branch: null });
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ }).value).toBe('develop'));
  });

  it('saves a base branch, says nothing to save, and goes back to the stored branch with the stored repo', async () => {
    const user = userEvent.setup();
    renderAgents();

    const branch = await screen.findByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();

    await user.clear(branch);
    await user.type(branch, ' release ');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/projects/p_web/repository')).toHaveLength(1));
    expect(calls('PUT', '/api/v1/projects/p_web/repository')[0].body).toEqual({ repository_id: 'r_web', base_branch: 'release' });
    await waitFor(() => expect(toastNamed('Agenten gespeichert')?.description).toBeUndefined());

    // a choice of another repo and back keeps the branch of the stored one
    await user.click(screen.getByRole('combobox', { name: /Repo/ }));
    await user.click(await screen.findByRole('option', { name: 'feldwerk/kunden-app' }));
    await user.click(screen.getByRole('combobox', { name: /Repo/ }));
    await user.click(await screen.findByRole('option', { name: 'feldwerk/website' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ }).value).toBe('release');
  });

  it('takes the repo away, and resets', async () => {
    const user = userEvent.setup();
    renderAgents();

    await user.click(await screen.findByRole('combobox', { name: /Repo/ }));
    await user.click(await screen.findByRole('option', { name: /Kein Repo/ }));
    const branch = screen.getByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ });
    expect(branch.readOnly).toBe(true);
    expect(screen.getByText('Erst mit einem Repo.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(screen.getByRole('combobox', { name: /Repo/ }).textContent).toContain('feldwerk/website');

    await user.click(screen.getByRole('combobox', { name: /Repo/ }));
    await user.click(await screen.findByRole('option', { name: /Kein Repo/ }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/projects/p_web/repository')[0]?.body).toEqual({ repository_id: null, base_branch: null }));
  });

  it('shows a refused branch at the field, a guard that holds the repo as a notice, and tries again after no answer', async () => {
    const user = userEvent.setup();
    let answer: 'field' | 'guard' | 'down' | 'ok' = 'field';
    renderAgents({
      overrides: {
        'PUT /api/v1/projects/p_web/repository': () => {
          if (answer === 'field') return problem(422, 'validation_failed', { errors: { base_branch: ['Ein Branch-Name, den git nimmt.'] } });
          if (answer === 'guard') return { status: 409, body: { type: 'about:blank', title: 'merge_guard_open', status: 409, reason: 'merge_guard_open', detail: 'Ein eigenmächtiger Merge hält das Projekt an.' } };
          if (answer === 'down') return problem(503, 'service_unavailable');
          return { body: { data: linkOf(github.repositories[0], { base_branch: 'ok' }) } };
        },
      },
    });

    const branch = await screen.findByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ });
    await user.type(branch, '..');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Ein Branch-Name, den git nimmt.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(branch));
    expect(screen.queryByRole('alert')).toBeNull();

    answer = 'guard';
    await user.type(branch, 'x');
    expect(screen.queryByText('Ein Branch-Name, den git nimmt.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Ein eigenmächtiger Merge hält das Projekt an.');
    await user.type(branch, 'y');
    expect(screen.queryByRole('alert')).toBeNull();

    answer = 'down';
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Agenten nicht gespeichert')).toBeTruthy());
    answer = 'ok';
    runToastAction(toastNamed('Agenten nicht gespeichert')!.id);
    await waitFor(() => expect(toastNamed('Agenten gespeichert')).toBeTruthy());
  });

  it('says GitHub is not connected, with the way to it for org admins', async () => {
    signedIn = mara;
    renderAgents({ status: { apps: [], repositories: [] }, link: null });

    expect(await screen.findByText('GitHub ist nicht verbunden')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Einstellungen → GitHub' }).getAttribute('href')).toBe('/settings/github');
    expect(screen.getByRole('combobox', { name: /Repo/ }).textContent).toContain('Kein Repo');
  });

  it('keeps a repo GitHub took away in the choice', async () => {
    const user = userEvent.setup();
    renderAgents({ link: linkOf(github.repositories[4]) });

    await user.click(await screen.findByRole('combobox', { name: /Repo/ }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toContain('feldwerk/alt');
  });
});

describe('Agents: readers', () => {
  it('reads repo, branch and steps without a form', async () => {
    signedIn = lene;
    renderAgents({ role: 'viewer', workflow: standard, status: { apps: [], repositories: [] } });

    expect(await screen.findByText('Eine Org-Admin verbindet GitHub in den Einstellungen der Organisation.')).toBeTruthy();
    expect(screen.getByText(/Die Schritte gehören zum Workflow; ein Org-Admin richtet sie dort ein\./)).toBeTruthy();
    expect(screen.getByText('Ändern lassen sie sich im Workflow „Standard“; das tun Org-Admins.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /^Repo/ })).toBeNull();
    // the stored repo, in words, though the app reaches it no more
    expect(screen.getByRole('button', { name: /Repo: feldwerk\/website/ })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Basis-Branch/ }).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
    expect(screen.getAllByText('Kein Status')).toHaveLength(4);
  });

  it('reads a project without a repo', async () => {
    signedIn = lene;
    renderAgents({ role: 'viewer', link: null });

    expect(await screen.findByRole('button', { name: /Repo: Kein Repo/ })).toBeTruthy();
  });
});

describe('Agents: unauthorized merge', () => {
  it('tells an admin what happened and confirms it', async () => {
    const user = userEvent.setup();
    renderAgents({ link: linkOf(github.repositories[0], { guard, protected: false }) });

    const banner = await screen.findByRole('alert', { name: 'Eigenmächtiger Merge erkannt: WEB pausiert' });
    // until the items are known the sentence names none, then it names them as links in one sentence
    expect(await within(banner).findByRole('link', { name: 'WEB-48' })).toBeTruthy();
    expect(within(banner).getByRole('link', { name: 'WEB-47' }).getAttribute('href')).toBe('/items/WEB-47');
    expect(calls('GET', '/api/v1/references?items=i_web47%2Ci_web48')).toHaveLength(1);
    expect(banner.textContent).toContain(
      'Am 20.11.2026, 09:15 kam auf main ein Push der App (a41c9e7), den kein Merge von werkbuch erklärt, aus dem Auftrag von WEB-47 und WEB-48. Alle Stränge des Projekts pausieren. Prüfe den Commit bei GitHub',
    );
    expect(banner.textContent).toContain('Ein Ruleset auf main (Pull Request nötig, ohne Bypass) hält solche Pushes fern.');

    await user.click(within(banner).getByRole('button', { name: 'Bestätigen und fortsetzen' }));

    await waitFor(() => expect(toastNamed('Merge bestätigt')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Repository' })));
  });

  it('says a guard without time or runs, a confirmation that failed, and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderAgents({
      link: linkOf(github.repositories[0], { guard: { detected_at: null, sha: null, branch: null, runs: [] } }),
      overrides: {
        'POST /api/v1/projects/p_web/repository/confirm-guard': () => (fail ? problem(500, 'server_error') : { body: { data: linkOf(github.repositories[0]) } }),
      },
    });

    const banner = await screen.findByRole('alert', { name: 'Eigenmächtiger Merge erkannt: WEB pausiert' });
    expect(banner.textContent).toContain('Auf  kam ein Push der App (), den kein Merge von werkbuch erklärt. Alle Stränge');
    expect(within(banner).queryByRole('link')).toBeNull();
    expect(banner.textContent).not.toContain('Ruleset');
    await user.click(within(banner).getByRole('button', { name: 'Bestätigen und fortsetzen' }));
    await waitFor(() => expect(toastNamed('Nicht bestätigt')).toBeTruthy());

    fail = false;
    runToastAction(toastNamed('Nicht bestätigt')!.id);
    await waitFor(() => expect(toastNamed('Merge bestätigt')).toBeTruthy());
  });

  it('waits for the items of its runs, then shows the whole sentence once', async () => {
    renderAgents({ link: linkOf(github.repositories[0], { guard }) });
    // the answer of the references waits until the test lets it go
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetching = globalThis.fetch;
    globalThis.fetch = (input, init) => (String(input).includes('/api/v1/references') ? gate.then(() => fetching(input, init)) : fetching(input, init));

    expect(await screen.findByRole('heading', { name: 'Repository' })).toBeTruthy();
    await waitFor(() => expect(calls('GET', '/api/v1/references?items=i_web47%2Ci_web48')).toHaveLength(0));
    expect(screen.queryByRole('alert')).toBeNull();

    // the alert region appears once, with the links in its first text
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      const alert = document.querySelector('[role="alert"]');
      if (alert && !seen.includes(alert.textContent!)) seen.push(alert.textContent!);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    release();
    const banner = await screen.findByRole('alert', { name: 'Eigenmächtiger Merge erkannt: WEB pausiert' });
    observer.disconnect();
    globalThis.fetch = fetching;
    expect(within(banner).getByRole('link', { name: 'WEB-47' })).toBeTruthy();
    expect(within(banner).getByRole('link', { name: 'WEB-48' })).toBeTruthy();
    expect(seen.every((text) => text.includes('aus dem Auftrag von WEB-47 und WEB-48. Alle Stränge des Projekts pausieren.'))).toBe(true);
  });

  it('leaves out items the reader does not see and says the sentence without runs', async () => {
    renderAgents({
      link: linkOf(github.repositories[0], { guard }),
      // WEB-47 is not in the answer (hidden or gone), WEB-48 neither: both settle as not found
      overrides: { 'GET /api/v1/references': () => ({ body: { data: { items: [], pages: [] } } }) },
    });

    const banner = await screen.findByRole('alert', { name: 'Eigenmächtiger Merge erkannt: WEB pausiert' });
    expect(banner.textContent).toContain('Am 20.11.2026, 09:15 kam auf main ein Push der App (a41c9e7), den kein Merge von werkbuch erklärt. Alle Stränge des Projekts pausieren.');
    expect(banner.textContent).not.toContain('aus dem Auftrag');
    expect(within(banner).queryByRole('link')).toBeNull();
  });

  it('tells a reader that an admin confirms', async () => {
    signedIn = lene;
    renderAgents({ role: 'viewer', link: linkOf(github.repositories[0], { guard: { ...guard, detected_at: null } }) });

    const banner = await screen.findByRole('alert', { name: 'Eigenmächtiger Merge erkannt: WEB pausiert' });
    expect(await within(banner).findByRole('link', { name: 'WEB-48' })).toBeTruthy();
    expect(banner.textContent).toContain('Auf main kam ein Push der App (a41c9e7), den kein Merge von werkbuch erklärt, aus dem Auftrag von WEB-47 und WEB-48. Alle Stränge');
    expect(banner.textContent).toContain('Ein Admin des Projekts prüft den Commit und bestätigt; danach machen die Stränge weiter.');
    expect(within(banner).queryByRole('button')).toBeNull();
  });
});

describe('Agents: states', () => {
  it('says a failed load and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderAgents({ overrides: { 'GET /api/v1/github': () => (fail ? problem(500, 'server_error') : { body: { data: github } }) } });

    expect(await screen.findByText('Die Agenten konnten nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { name: 'Repository' })).toBeTruthy();
  });

  it('says some steps are missing', async () => {
    renderAgents({ workflow: { ...agency, agent_states: { ...agency.agent_states, merged: null } } as Workflow });

    expect(await screen.findByText('Agenten aus: der Workflow „Agentur-Freigabe“ hat noch nicht alle Agenten-Schritte')).toBeTruthy();
  });
});

describe('Agents: settings (WEBU-32)', () => {
  const choose = async (user: ReturnType<typeof userEvent.setup>, field: RegExp, option: string | RegExp) => {
    await user.click(screen.getByRole('combobox', { name: field }));
    await user.click(await screen.findByRole('option', { name: option }));
  };

  it('saves merge method, review agent, switches, commands, brakes, models and the text without touching the repo', async () => {
    const user = userEvent.setup();
    signedIn = mara;
    renderAgents();

    expect(await screen.findByRole('heading', { name: 'Bremsen' })).toBeTruthy();
    expect(screen.getByText(/Ein Commit je PR auf dem Basis-Branch/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rebase' }));
    expect(screen.getByText(/einzeln auf den Basis-Branch gesetzt/)).toBeTruthy();

    // only a bot that works as an agent and may edit items here reviews
    await user.click(screen.getByRole('combobox', { name: /Review-Agent/ }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Der Bot des Strangs (PRs von Personen ohne Review)',
      'Kira',
      'Rita (arbeitet nicht als Agent)',
      'Vera (darf hier keine Items bearbeiten)',
    ]);
    expect(options[2].getAttribute('aria-disabled')).toBe('true');
    expect(options[3].getAttribute('aria-disabled')).toBe('true');
    await user.click(options[1]);

    await user.click(screen.getByRole('switch', { name: 'Kommentar am PR' }));
    await user.click(screen.getByRole('switch', { name: 'PRs von Personen reviewen' }));
    await user.click(screen.getByRole('switch', { name: 'PRs von Personen reviewen' }));
    await user.type(screen.getByRole('textbox', { name: /Setup-Befehl/ }), 'ddev start');
    const corrections = screen.getByRole<HTMLInputElement>('textbox', { name: /Korrekturen je Strang/ });
    await user.clear(corrections);
    await user.type(corrections, '5');

    // without a model of the project each agent takes its own: one model, or each by name
    expect(screen.getByRole('combobox', { name: /^Review(?!-)/ }).textContent).toContain('Wie beim Bot (Kira: opus, Vera: gpt-5-codex)');
    await choose(user, /^Review(?!-)/, 'haiku');
    expect(screen.getByText('Gilt nur für Agenten mit Claude Code.')).toBeTruthy();
    await choose(user, /^Antwort/, 'gpt-5-codex-mini');
    await choose(user, /^Antwort/, /Wie beim Bot/);
    await user.type(screen.getByRole('textbox', { name: /Projektinformationen und Regeln$/ }), 'Pest in DDEV.');

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Agenten gespeichert')).toBeTruthy());
    expect(calls('PUT', '/api/v1/projects/p_web/repository')).toHaveLength(0);
    expect(calls('PUT', '/api/v1/projects/p_web/agents')[0].body).toEqual({
      review_bot_id: 'u_kira',
      instructions: 'Pest in DDEV.',
      models: { review: 'claude:haiku' },
      max_corrections: 5,
      max_conflicts: 2,
      review_person_prs: true,
      comment_on_pr: false,
      merge_method: 'rebase',
      setup_command: 'ddev start',
      teardown_command: null,
    });
    await waitFor(() => expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull());
  });

  it('counts an org admin bot that is no member only for reviews in what the kinds inherit', async () => {
    signedIn = mara;
    renderAgents({ agents: { ...defaults, bots: [...defaults.bots, { bot_id: 'u_gone', enabled: true, member: false, reviews: true, cli: 'claude', model: 'haiku', models: {} }] } });

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Review(?!-)/ }).textContent).toContain('Wie beim Bot (Kira: opus, Vera: gpt-5-codex, Gabi: haiku)'));
    expect(screen.getByRole('combobox', { name: /^Umsetzen/ }).textContent).toContain('Wie beim Bot (Kira: sonnet, Vera: gpt-5-codex)');
  });

  it('names a deactivated saved review agent as such, and locks the review of PRs of persons without a review agent', async () => {
    const user = userEvent.setup();
    signedIn = mara;
    renderAgents({ agents: { ...defaults, review_bot_id: 'u_gone', bots: [...defaults.bots, { bot_id: 'u_gone', enabled: true, member: true, reviews: false, cli: 'claude', model: 'sonnet', models: {} }] } });

    const reviewer = await screen.findByRole('combobox', { name: /Review-Agent/ });
    await waitFor(() => expect(reviewer.textContent).toContain('Gabi (deaktiviert)'));
    const persons = screen.getByRole('switch', { name: 'PRs von Personen reviewen' });
    expect(persons.hasAttribute('data-disabled')).toBe(false);

    await user.click(reviewer);
    await user.click(await screen.findByRole('option', { name: /Der Bot des Strangs/ }));
    expect(screen.getByText(/Nur mit einem Review-Agenten des Projekts/)).toBeTruthy();
    expect(persons.hasAttribute('data-disabled')).toBe(true);
    expect(persons.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(persons.getAttribute('aria-describedby')!)!.textContent).toContain('Nur mit einem Review-Agenten des Projekts');
  });

  it('saves the repo and the settings in one press, each only once', async () => {
    const user = userEvent.setup();
    renderAgents();

    await screen.findByRole('combobox', { name: /Repo/ });
    await choose(user, /Repo/, 'feldwerk/kunden-app');
    await user.click(screen.getByRole('button', { name: 'Merge-Commit' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(toastNamed('Agenten gespeichert')).toBeTruthy());
    expect(calls('PUT', '/api/v1/projects/p_web/repository')).toHaveLength(1);
    expect(calls('PUT', '/api/v1/projects/p_web/agents')).toHaveLength(1);
  });

  it('refuses a brake out of range without a call, shows a refusal of the server at its field and tries again after no answer', async () => {
    const user = userEvent.setup();
    let answer: 'field' | 'notice' | 'down' = 'field';
    renderAgents({
      overrides: {
        'PUT /api/v1/projects/p_web/agents': () => {
          if (answer === 'field') return problem(422, 'validation_failed', { errors: { 'models.task': ['Kein Modell der Liste.'] } });
          if (answer === 'notice') return problem(422, 'validation_failed', { errors: { comment_on_pr: ['Ja oder nein.'] } });
          return problem(503, 'service_unavailable');
        },
      },
    });

    const conflicts = await screen.findByRole<HTMLInputElement>('textbox', { name: /Konflikte je Strang/ });
    await user.clear(conflicts);
    await user.type(conflicts, '11');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Eine ganze Zahl von 1 bis 10.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(conflicts));
    expect(calls('PUT', '/api/v1/projects/p_web/agents')).toHaveLength(0);

    await user.clear(conflicts);
    await user.type(conflicts, '4');
    expect(screen.queryByText('Eine ganze Zahl von 1 bis 10.')).toBeNull();
    await choose(user, /^Umsetzen/, 'opus');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Kein Modell der Liste.')).toBeTruthy();

    answer = 'notice';
    await choose(user, /^Umsetzen/, 'sonnet');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Ja oder nein.')).toBeTruthy();

    answer = 'down';
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Agenten nicht gespeichert')).toBeTruthy());
    runToastAction(toastNamed('Agenten nicht gespeichert')!.id);
    await waitFor(() => expect(calls('PUT', '/api/v1/projects/p_web/agents')).toHaveLength(4));
  });

  it('keeps the saved repo when the settings are refused after it', async () => {
    const user = userEvent.setup();
    renderAgents({ overrides: { 'PUT /api/v1/projects/p_web/agents': () => problem(422, 'validation_failed', { errors: { review_bot_id: ['Wähle einen anderen Bot.'] } }) } });

    await screen.findByRole('combobox', { name: /Repo/ });
    await choose(user, /Repo/, 'feldwerk/kunden-app');
    await choose(user, /Review-Agent/, 'Kira');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Wähle einen anderen Bot.')).toBeTruthy();
    expect(calls('PUT', '/api/v1/projects/p_web/repository')).toHaveLength(1);
    // the next press sends only the settings again
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/projects/p_web/agents')).toHaveLength(2));
    expect(calls('PUT', '/api/v1/projects/p_web/repository')).toHaveLength(1);
  });

  it('names the model labels of the organization before the models, with the way to them for org admins', async () => {
    signedIn = { ...mara };
    renderAgents({ catalog: [...labels, { id: 'lb_haiku', name: 'Haiku Agent', color: 'sky', agent_model: 'claude:haiku' }, { id: 'lb_x', name: 'Alt', color: 'moss', agent_model: 'claude:gone' }] });

    const list = await screen.findByRole('list', { name: 'Modell-Labels' });
    expect(within(list).getAllByRole('listitem').map((entry) => entry.textContent)).toEqual(['Haiku Agenthaiku', 'Altclaude:gone']);
    expect(screen.getByText(/Trägt ein Item eins davon/)).toBeTruthy();
  });

  it('says when there is no model label and an agent nobody runs', async () => {
    renderAgents({ agents: { ...defaults, bots: [] } });

    expect(await screen.findByText(/Noch kein Label mit einem Modell für Agenten/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Labels bearbeiten' })).toBeNull();
    expect(screen.getByRole('combobox', { name: /^Korrektur/ }).textContent).toContain('Wie beim Bot');
    expect(screen.getByRole('link', { name: 'Arbeitsregeln ansehen' }).getAttribute('href')).toBe('/settings/agents');
  });

  it('reads every setting without a form, and the review agent of a bot that left', async () => {
    renderAgents({
      role: 'viewer',
      agents: { ...defaults, review_bot_id: 'u_gone', models: { task: 'codex:gpt-5-codex', review: 'claude:opus' }, merge_method: 'merge', setup_command: 'ddev start', instructions: 'Markdown.' },
    });

    expect(await screen.findByRole('heading', { name: 'Bremsen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Merge-Methode: Merge-Commit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review-Agent: Jemand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Umsetzen: gpt-5-codex (Codex)' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Korrektur: Wie beim Bot (Kira: sonnet, Vera: gpt-5-codex)' })).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Setup-Befehl/ }).readOnly).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Korrekturen je Strang/ }).readOnly).toBe(true);
    expect(screen.getByRole('switch', { name: 'PRs von Personen reviewen' }).getAttribute('aria-disabled') ?? (screen.getByRole('switch', { name: 'PRs von Personen reviewen' }) as HTMLButtonElement).disabled).toBeTruthy();
  });
});
