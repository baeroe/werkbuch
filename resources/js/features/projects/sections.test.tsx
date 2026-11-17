/*
 * The parts of a project (WEBU-3): the tabs Items · Wiki · Vorlagen under the header of each part, and the palette
 * commands "Wiki öffnen …" and "Vorlagen öffnen …" over every project the person sees, starred or not.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCommands, type CommandDef } from '@/lib/commands';
import { mockApi, type MockApi } from '@/test/api';
import { list, project } from '@/test/fixtures';
import { ProjectSections } from './ProjectSections';
import { useProjectPartCommands } from './projectCommands';

const inertia = vi.hoisted(() => ({ visit: vi.fn() }));

vi.mock('@inertiajs/react', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  router: { visit: inertia.visit },
}));

let api: MockApi | undefined;

afterEach(() => {
  api?.restore();
  api = undefined;
  inertia.visit.mockReset();
});

describe('ProjectSections', () => {
  const web = project('WEB', 'member', { name: 'Website-Relaunch' });
  const links = () => within(screen.getByRole('navigation', { name: 'Bereiche von Website-Relaunch' })).getAllByRole('link');

  it('leads to the items, the wiki and the templates of the project', () => {
    render(<ProjectSections project={web} current="items" />);

    expect(links().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Items', '/projects/WEB'],
      ['Wiki', '/projects/WEB/wiki'],
      ['Vorlagen', '/projects/WEB/templates'],
    ]);
  });

  it('marks the part the screen shows as the page', () => {
    render(<ProjectSections project={web} current="wiki" />);

    expect(links().map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('marks the part as the place one is in below it, on a page of the wiki or a template', () => {
    render(<ProjectSections project={web} current="templates" below />);

    expect(links().map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'true']);
  });
});

describe('useProjectPartCommands', () => {
  function Commands() {
    useProjectPartCommands();
    return null;
  }

  function renderCommands(projects: ReturnType<typeof project>[]) {
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list(projects) }) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <Commands />
      </QueryClientProvider>,
    );
  }

  const command = (id: string): CommandDef => listCommands().find((entry) => entry.id === id)!;

  it('offers the wiki and the templates of every project, archived ones too, by name', async () => {
    renderCommands([
      project('WEB', 'member', { name: 'Website-Relaunch' }),
      project('OLD', 'admin', { name: 'Altes Projekt', archived_at: '2026-09-01T10:00:00.000Z' }),
      project('APP', 'viewer', { name: 'Kunden-App' }),
    ]);

    await waitFor(() => expect(command('projects.open_wiki').when!()).toBe(true));
    const wiki = command('projects.open_wiki');
    expect(wiki.label).toBe('Wiki öffnen …');
    expect(wiki.group).toBe('Navigation');
    // "wiki web" finds it from the root of the palette
    expect(wiki.keywords).toEqual(expect.arrayContaining(['Website-Relaunch', 'WEB', 'Kunden-App', 'APP']));

    const options = wiki.subpage!().options;
    expect(options.map((option) => [option.label, option.hint])).toEqual([
      ['Altes Projekt', 'OLD, archiviert'],
      ['Kunden-App', 'APP'],
      ['Website-Relaunch', 'WEB'],
    ]);
    options[1]!.run();
    expect(inertia.visit).toHaveBeenLastCalledWith('/projects/APP/wiki');

    const templates = command('projects.open_templates');
    expect(templates.label).toBe('Vorlagen öffnen …');
    expect(templates.subpage!().placeholder).toBe('Projekt wählen …');
    templates.subpage!().options[2]!.run();
    expect(inertia.visit).toHaveBeenLastCalledWith('/projects/WEB/templates');
  });

  it('stays hidden while there is no project to offer', async () => {
    renderCommands([]);

    await waitFor(() => expect(api!.calls.some((call) => call.url.startsWith('/api/v1/projects'))).toBe(true));
    expect(command('projects.open_wiki').when!()).toBe(false);
    expect(command('projects.open_templates').subpage!().emptyText).toBe('Kein Projekt gefunden');
    command('projects.open_wiki').run();
    expect(inertia.visit).not.toHaveBeenCalled();
  });
});
