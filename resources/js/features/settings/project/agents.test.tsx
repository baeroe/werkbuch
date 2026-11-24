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
import { agency, ida, lene, list, makeWorkItem, mara, organization, project, standard } from '@/test/fixtures';
import type { GitHubRepository, GitHubStatus, MergeGuard, ProjectRepository, User, Workflow } from '@/types';
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

const app: GitHubStatus['app'] = {
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
};

const github: GitHubStatus = {
  app,
  installations: [],
  repositories: [
    repo('r_web', 'feldwerk/website', { taken: true, project: { id: 'p_web', identifier: 'WEB', name: 'Website', base_branch: 'main', protected: true, guarded: false } }),
    repo('r_app', 'feldwerk/kunden-app', { default_branch: 'develop' }),
    repo('r_ops', 'feldwerk/infrastruktur', { taken: true, project: { id: 'p_ops', identifier: 'OPS', name: 'Ops', base_branch: 'main', protected: null, guarded: false } }),
    repo('r_hidden', 'feldwerk/geheim', { taken: true }),
    repo('r_gone', 'feldwerk/alt', { removed_at: '2026-11-01T00:00:00.000Z' }),
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

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail: reason, ...extra } });

/* ------------------------------------------------------------------------ server */

let api: MockApi | undefined;

function renderAgents({
  workflow = agency,
  link = linkOf(github.repositories[0]),
  status = github,
  role = 'admin' as const,
  overrides = {},
}: { workflow?: Workflow; link?: ProjectRepository | null; status?: GitHubStatus; role?: 'admin' | 'viewer'; overrides?: Record<string, MockRoute> } = {}) {
  const web = project('WEB', role, { id: 'p_web', name: 'Website-Relaunch', workflow_id: workflow.id });
  let current = link;
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

  it('offers the repos the app reaches, a taken one blocked with its project', async () => {
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
    ]);
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
    renderAgents({ status: { app: null, installations: [], repositories: [] }, link: null });

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
    renderAgents({ role: 'viewer', workflow: standard, status: { app: null, installations: [], repositories: [] } });

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
