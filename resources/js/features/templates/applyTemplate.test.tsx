/*
 * "Vorlage anwenden …" in the palette (spec 4.12, A215), from the clickdummy's bindings.test.tsx: the templates of the
 * projects where the person may create items, each with its project, in the order of the projects; choosing one opens
 * the create dialog with the project and the template. Without a template to apply it says why in a toast (no right
 * anywhere, templates only where the person reads, none at all, the templates did not load). It asks for the lean
 * templates (K24) and stays out of the palette while they, the projects and the rights load, and while the create
 * dialog is open.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { PaletteHost } from '@/shell/PaletteHost';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi } from '@/test/api';
import { lene, list, makeTemplate, project } from '@/test/fixtures';
import type { Project, Template } from '@/types';
import { useApplyTemplateCommand } from './applyTemplate';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] } }, url: '/my-items' }),
  router: { visit: vi.fn() },
}));

/* --------------------------------------------------------------------------- data */

/** Lene is a member of WEB and APP and reads OPS. */
const web = project('WEB', 'member', { name: 'Website-Relaunch' });
const app = project('APP', 'member', { name: 'Kunden-App' });
const ops = project('OPS', 'viewer', { name: 'Betrieb' });
const report = makeTemplate({ id: 'tpl_app_report', project_id: 'p_app', name: 'Monatsbericht' });
const wish = makeTemplate({ id: 'tpl_app_wish', project_id: 'p_app', name: 'Kundenwunsch' });
const release = makeTemplate({ id: 'tpl_web_release', project_id: 'p_web', name: 'Release-Check' });
const certs = makeTemplate({ id: 'tpl_ops_certs', project_id: 'p_ops', name: 'Zertifikate prüfen' });

let projects: Project[];
let templates: Template[];
let failing: boolean;
let api: MockApi | undefined;

function Shell() {
  useApplyTemplateCommand();
  return <PaletteHost />;
}

function renderShell() {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/templates': () =>
      failing ? { status: 503, body: { type: 'about:blank', title: 'unavailable', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } } : { body: list(templates) },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  );
}

const command = () => listCommands().find((entry) => entry.id === 'items.apply_template');
const templateCalls = () => api!.calls.filter((call) => call.url.startsWith('/api/v1/templates'));

/** mod+k (Strg+K in jsdom, which is no Mac), then the command by keyboard. */
async function chooseCommand(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  const input = await screen.findByRole('combobox');
  await waitFor(() => expect(document.activeElement).toBe(input));
  await user.keyboard('Vorlage anwenden{Enter}');
}

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
  projects = [web, app, ops];
  templates = [report, release, certs, wish];
  failing = false;
});

afterEach(() => {
  api?.restore();
  api = undefined;
  act(() => resetToasts());
});

/* -------------------------------------------------------------------------- tests */

describe('"Vorlage anwenden …"', () => {
  it('lists the templates of the projects where the person may create items, each with its project', async () => {
    const user = userEvent.setup();
    renderShell();
    // it waits for the templates, the projects and the rights
    await waitFor(() => expect(command()?.when?.()).toBe(true));
    // the lean templates: the palette names them, the draft comes from the server (K24)
    expect(templateCalls().map((call) => call.url)).toEqual(['/api/v1/templates?lean=1']);

    await chooseCommand(user);
    const listbox = await screen.findByRole('listbox', { name: 'Vorlage anwenden …' });
    // OPS, where Lene reads, is left out; the projects in their order (by name), the templates by name
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.querySelector('.flex-1')!.textContent)).toEqual(['Kundenwunsch', 'Monatsbericht', 'Release-Check']);
    expect(options[0]!.textContent).toContain('Kunden-App');
    expect(options[2]!.textContent).toContain('Website-Relaunch');
    expect(screen.getByRole('combobox').getAttribute('placeholder')).toBe('Vorlage wählen …');
  });

  it('opens the create dialog with the project and the template', async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(command()?.when?.()).toBe(true));
    await chooseCommand(user);
    await screen.findByRole('listbox', { name: 'Vorlage anwenden …' });

    // the project's name finds its templates too
    await user.keyboard('Website{Enter}');

    expect(useUiStore.getState().createOpen).toBe(true);
    expect(useUiStore.getState().createDefaults).toEqual({ project_id: 'p_web', template_id: 'tpl_web_release' });
    expect(useUiStore.getState().paletteOpen).toBe(false);
    // while the dialog is open, it has its own choice of template
    expect(command()!.when!()).toBe(false);
  });

  it('tells a viewer why, without asking for templates', async () => {
    projects = [project('WEB', 'viewer'), project('OPS', 'viewer')];
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(command()?.when?.()).toBe(true));
    await chooseCommand(user);

    expect(screen.queryByRole('listbox', { name: 'Vorlage anwenden …' })).toBeNull();
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Keine Vorlage anwendbar', description: 'Items anlegen darfst du in keinem Projekt.', tone: 'error' });
    expect(templateCalls()).toEqual([]);
  });

  it('says why when only projects the person reads have templates, with the next step', async () => {
    templates = [certs];
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(command()?.when?.()).toBe(true));
    await chooseCommand(user);

    expect(screen.queryByRole('listbox', { name: 'Vorlage anwenden …' })).toBeNull();
    expect(currentToasts().at(-1)).toMatchObject({
      title: 'Keine Vorlage anwendbar',
      description: 'In den Projekten, in denen du Items anlegen darfst, gibt es noch keine Vorlage. Vorlagen legst du im Projekt unter „Vorlagen“ an.',
    });
  });

  it('says that the templates did not load, and its "Erneut versuchen" brings the list', async () => {
    failing = true;
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(command()?.when?.()).toBe(true));
    await chooseCommand(user);

    const failure = currentToasts().at(-1)!;
    expect(failure).toMatchObject({ title: 'Vorlagen nicht geladen', description: 'Der Server ist gerade nicht erreichbar.', tone: 'error', action: { label: 'Erneut versuchen' } });

    failing = false;
    act(() => runToastAction(failure.id));
    await waitFor(() => expect(command()?.subpage).toBeDefined());
    await chooseCommand(user);
    expect(await screen.findByRole('listbox', { name: 'Vorlage anwenden …' })).toBeTruthy();
  });
});
