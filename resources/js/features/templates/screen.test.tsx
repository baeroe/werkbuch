/*
 * The templates screen against a fake REST API (`mockApi`), ported from the list part of the clickdummy's
 * templates.test.tsx: the list of a project sorted by name with its schedule in words and its next run, a paused
 * schedule, the empty list, the viewer who reads, deleting with undo and a failure, the focus after a delete, the 404,
 * the error and the skeleton; the log of a template's runs. Inertia is a fake whose address the tests move.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, list, makeTemplate, makeTemplateRun, makeWorkItem, mara, organization, project, theo, types } from '@/test/fixtures';
import type { Project, Template, TemplateRun } from '@/types';
import { TemplatesScreen, type TemplatesScreenProps } from './TemplatesScreen';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/APP/templates';
  const listeners = new Set<() => void>();
  return {
    get url() {
      return url;
    },
    go(next: string) {
      url = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    visit: vi.fn(),
    replace: vi.fn(),
  };
});

vi.mock('@inertiajs/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePage: () => ({
      props: { auth: { user: me, permissions: [] }, organization },
      url: useSyncExternalStore(inertia.subscribe, () => inertia.url),
    }),
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
    router: { visit: inertia.visit, replace: inertia.replace, reload: vi.fn(), on: () => () => {} },
  };
});

/* --------------------------------------------------------------------- fake server */

const report = makeTemplate();
const maintenance = makeTemplate({
  id: 'tpl_app_maintenance',
  name: 'Wartung',
  payload: { ...report.payload, type_id: 't_bug', title: 'Wartung KW {week}' },
  schedule: { frequency: 'weekly', interval: 1, weekdays: [1], time: '09:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: false },
  next_run_at: '2026-11-09T08:00:00.000Z',
});
const certificates = makeTemplate({
  id: 'tpl_app_certs',
  name: 'Zertifikate prüfen',
  payload: { ...report.payload, type_id: 't_gone', title: 'Zertifikate prüfen' },
  schedule: { frequency: 'monthly', interval: 1, month_day: 1, time: '07:00', starts_on: '2026-09-01', ends: { type: 'never' }, paused: true },
  next_run_at: null,
});
const byHand = makeTemplate({ id: 'tpl_app_hand', name: 'Ad hoc', schedule: null, next_run_at: null });

/** Who is signed in: Mara is an org admin (admin everywhere), Theo a member of the org. */
let me = mara;
let projects: Project[];
let templates: Template[];
let runs: TemplateRun[];
let failDelete: boolean;
let overrides: Record<string, MockRoute>;
let api: MockApi;

const unavailable = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };
const missing = { status: 404, body: { type: 'about:blank', title: 'Not Found', status: 404, reason: 'not_found' } };

function routes(): Record<string, MockRoute> {
  const base: Record<string, MockRoute> = {
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/projects/APP': () => ({ body: { data: projects[0] } }),
    'GET /api/v1/projects/p_app/templates': () => ({ body: list(templates) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, theo]) }),
    'GET /api/v1/templates/tpl_app_report/runs': () => ({ body: list(runs) }),
    'GET /api/v1/references': () => ({ body: { data: { items: [makeWorkItem({ id: 'wi_app_8', key: 'APP-8', title: 'Monatsbericht Oktober 2026' })], pages: [] } } }),
    'DELETE /api/v1/templates/tpl_app_report': () => {
      if (failDelete) return unavailable;
      templates = templates.filter((template) => template.id !== 'tpl_app_report');
      return { status: 204 };
    },
    'DELETE /api/v1/templates/tpl_app_maintenance': () => {
      templates = templates.filter((template) => template.id !== 'tpl_app_maintenance');
      return { status: 204 };
    },
  };
  return new Proxy(base, { get: (target, key: string) => overrides[key] ?? target[key] });
}

beforeEach(() => {
  me = mara;
  projects = [project('APP', 'member', { name: 'Feldwerk-App' })];
  templates = [report, maintenance, certificates];
  runs = [];
  failDelete = false;
  overrides = {};
  inertia.go('/projects/APP/templates');
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  api = mockApi(routes());
});

afterEach(() => {
  api.restore();
  act(() => resetToasts());
});

function renderTemplates(props: Partial<TemplatesScreenProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TemplatesScreen identifier="APP" templateId={null} {...props} />
    </QueryClientProvider>,
  );
  return client;
}

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('li')!;
const rightsLoaded = () => waitFor(() => expect(screen.getAllByRole('button', { name: 'Neue Vorlage' })[0].getAttribute('aria-disabled')).toBeNull());
const deletes = () => api.calls.filter((call) => call.method === 'DELETE').map((call) => call.url);
const toastOf = (title: string) => currentToasts().find((item) => item.title === title)!;

describe('the list of templates', () => {
  it('shows each template by name with its schedule in words and its next run in the zone of the organisation', async () => {
    renderTemplates();
    expect(await screen.findByRole('heading', { level: 1, name: 'Vorlagen' })).toBeTruthy();
    const listed = await screen.findByRole('list', { name: 'Vorlagen von Feldwerk-App' });

    expect(within(listed).getAllByRole('link').map((link) => link.textContent)).toEqual(['Monatsbericht', 'Wartung', 'Zertifikate prüfen']);
    const row = rowOf('Monatsbericht');
    expect(row.textContent).toContain('Jeden ersten Montag im Monat um 09:00');
    expect(row.textContent).toContain('Monatsbericht {month_name} {year}');
    // 08:00 UTC is 09:00 in Berlin
    expect(row.querySelector('time')?.textContent).toBe('Montag, 2. November 2026 um 09:00');
    expect(row.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-02T08:00:00.000Z');
    expect(rowOf('Wartung').textContent).toContain('Wöchentlich am Montag um 09:00');
    expect(screen.getByRole('link', { name: 'Monatsbericht' }).getAttribute('href')).toBe('/projects/APP/templates/tpl_app_report');
    expect(document.title).toContain('Vorlagen APP');
  });

  it('marks a paused schedule, and one without a schedule runs only by hand', async () => {
    templates = [certificates, byHand];
    renderTemplates();
    await screen.findByRole('link', { name: 'Zertifikate prüfen' });

    const paused = rowOf('Zertifikate prüfen');
    expect(paused.textContent).toContain('Monatlich am 1. um 07:00');
    expect(within(paused).getAllByText('Pausiert')).toHaveLength(2);
    expect(rowOf('Ad hoc').textContent).toContain('Ohne Zeitplan, nur von Hand');
    expect(rowOf('Ad hoc').textContent).toContain('Keiner geplant');
  });

  it('shows the glyph of the type, and a template sign for a type it does not know', async () => {
    renderTemplates();
    await screen.findByRole('link', { name: 'Monatsbericht' });
    await waitFor(() => expect(rowOf('Wartung').querySelector('[aria-hidden="true"] svg')?.getAttribute('class')).not.toContain('lucide-layout-template'));
    expect(rowOf('Zertifikate prüfen').querySelector('.lucide-layout-template')).toBeTruthy();
  });

  it('offers "Neue Vorlage" in the empty list, the header and the palette', async () => {
    const user = userEvent.setup();
    templates = [];
    renderTemplates();
    expect(await screen.findByText('Noch keine Vorlagen')).toBeTruthy();
    await rightsLoaded();

    expect(screen.getAllByRole('button', { name: 'Neue Vorlage' })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Neue Vorlage' })[1]);
    expect(inertia.visit).toHaveBeenCalledWith('/projects/APP/templates/new');

    const command = listCommands().find((entry) => entry.id === 'templates.create')!;
    expect(command.group).toBe('Vorlagen APP');
    expect(command.when?.()).toBe(true);
  });

  it('lets a viewer read: no "Neue Vorlage", no delete, the line that says why', async () => {
    me = theo;
    projects = [project('APP', 'viewer', { name: 'Feldwerk-App' })];
    renderTemplates();
    await screen.findByRole('link', { name: 'Monatsbericht' });

    expect(await screen.findByText(/darfst du nur lesen\. Vorlagen verwalten dürfen Member und Admins\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Neue Vorlage' })).toBeNull();
    expect(screen.queryByRole('button', { name: /löschen$/ })).toBeNull();
    expect(listCommands().find((entry) => entry.id === 'templates.create')?.when?.()).toBe(false);
  });

  it('shows a skeleton while the templates load, and the error with a retry', async () => {
    const user = userEvent.setup();
    overrides['GET /api/v1/projects/p_app/templates'] = () => unavailable;
    renderTemplates();
    expect(await screen.findByText('Vorlagen werden geladen …')).toBeTruthy();

    expect(await screen.findByText('Die Vorlagen konnten nicht geladen werden')).toBeTruthy();
    delete overrides['GET /api/v1/projects/p_app/templates'];
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('link', { name: 'Monatsbericht' })).toBeTruthy();
  });
});

describe('deleting a template', () => {
  it('takes the row away at once and brings it back with undo', async () => {
    const user = userEvent.setup();
    renderTemplates();
    await screen.findByRole('link', { name: 'Monatsbericht' });
    await rightsLoaded();

    await user.click(within(rowOf('Monatsbericht')).getByRole('button', { name: 'Vorlage „Monatsbericht“ löschen' }));
    expect(screen.queryByRole('link', { name: 'Monatsbericht' })).toBeNull();
    // the focus moves on to the next row
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Wartung' })));

    const undo = toastOf('Vorlage „Monatsbericht“ gelöscht');
    expect(undo.action?.label).toBe('Rückgängig');
    act(() => runToastAction(undo.id));
    expect(await screen.findByRole('link', { name: 'Monatsbericht' })).toBeTruthy();
    expect(deletes()).toEqual([]);
  });

  it('deletes for real when the toast runs out', async () => {
    const user = userEvent.setup();
    renderTemplates();
    await screen.findByRole('link', { name: 'Monatsbericht' });
    await rightsLoaded();

    await user.click(within(rowOf('Monatsbericht')).getByRole('button', { name: 'Vorlage „Monatsbericht“ löschen' }));
    act(() => dismissToast(toastOf('Vorlage „Monatsbericht“ gelöscht').id));

    await waitFor(() => expect(deletes()).toEqual(['/api/v1/templates/tpl_app_report']));
    await waitFor(() => expect(api.calls.filter((call) => call.url === '/api/v1/projects/p_app/templates')).toHaveLength(2));
    expect(screen.queryByRole('link', { name: 'Monatsbericht' })).toBeNull();
  });

  it('brings the row back with a retry when the server fails', async () => {
    const user = userEvent.setup();
    failDelete = true;
    renderTemplates();
    await screen.findByRole('link', { name: 'Monatsbericht' });
    await rightsLoaded();

    await user.click(within(rowOf('Monatsbericht')).getByRole('button', { name: 'Vorlage „Monatsbericht“ löschen' }));
    act(() => dismissToast(toastOf('Vorlage „Monatsbericht“ gelöscht').id));

    expect(await screen.findByRole('link', { name: 'Monatsbericht' })).toBeTruthy();
    const error = await waitFor(() => toastOf('Vorlage „Monatsbericht“ nicht gelöscht'));
    expect(error.tone).toBe('error');
    expect(error.action?.label).toBe('Erneut versuchen');
  });

  it('moves the focus to the previous row after the last one, and to "Neue Vorlage" when none is left', async () => {
    const user = userEvent.setup();
    templates = [report, maintenance];
    renderTemplates();
    await screen.findByRole('link', { name: 'Wartung' });
    await rightsLoaded();

    await user.click(within(rowOf('Wartung')).getByRole('button', { name: 'Vorlage „Wartung“ löschen' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Monatsbericht' })));

    await user.click(within(rowOf('Monatsbericht')).getByRole('button', { name: 'Vorlage „Monatsbericht“ löschen' }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Neue Vorlage'));
    expect(screen.getByText('Noch keine Vorlagen')).toBeTruthy();
  });
});

describe('the screen', () => {
  it('is the 404 of a project that does not exist or that the person does not see', async () => {
    overrides['GET /api/v1/projects/APP'] = () => missing;
    renderTemplates();
    expect(await screen.findByRole('heading', { level: 1, name: 'Das Projekt APP gibt es nicht' })).toBeTruthy();
  });

  it('says when the project could not be loaded, and loads it again', async () => {
    const user = userEvent.setup();
    overrides['GET /api/v1/projects/APP'] = () => unavailable;
    renderTemplates();
    expect(await screen.findByText('Die Vorlagen konnten nicht geladen werden')).toBeTruthy();

    delete overrides['GET /api/v1/projects/APP'];
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('link', { name: 'Monatsbericht' })).toBeTruthy();
  });

  it('writes the identifier as the project has it, and follows a project renamed meanwhile', async () => {
    inertia.go('/projects/app/templates?x=1');
    overrides['GET /api/v1/projects/app'] = () => ({ body: { data: projects[0] } });
    renderTemplates({ identifier: 'app' });
    await screen.findByRole('link', { name: 'Monatsbericht' });

    expect(inertia.visit).toHaveBeenCalledWith('/projects/APP/templates?x=1', { replace: true, preserveState: true, preserveScroll: true });
  });

  it('replaces another spelling of the identifier in the address with its own', async () => {
    inertia.go('/projects/app/templates');
    renderTemplates();
    await waitFor(() => expect(inertia.replace).toHaveBeenCalledWith({ url: '/projects/APP/templates', preserveState: true, preserveScroll: true }));
  });
});

describe('one template', () => {
  it('shows its name with a link back to the list, and the log of its runs', async () => {
    runs = [
      makeTemplateRun({ id: 'tr_2', scheduled_for: null, ran_at: '2026-10-20T12:30:00.000Z', work_item_id: null, status: 'failed', error: 'Pflicht-Property Umgebung fehlt', triggered_by: 'u_ida' }),
      makeTemplateRun({ id: 'tr_1' }),
      makeTemplateRun({ id: 'tr_0', scheduled_for: '2026-09-07T07:00:00.000Z', work_item_id: 'wi_gone', triggered_by: 'u_gone' }),
    ];
    overrides['GET /api/v1/references'] = () => ({ body: { data: { items: [makeWorkItem({ id: 'wi_app_8', key: 'APP-8', title: 'Monatsbericht Oktober 2026' })], pages: [] } } });
    renderTemplates({ templateId: 'tpl_app_report' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Monatsbericht' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vorlagen' }).getAttribute('href')).toBe('/projects/APP/templates');
    const log = await screen.findByRole('list', { name: 'Läufe' });
    const entries = within(log).getAllByRole('listitem');
    expect(entries[0].textContent).toContain('Gescheitert: Pflicht-Property Umgebung fehlt');
    expect(entries[0].textContent).toContain('Di., 20.10.2026, 14:30 · von Hand von Ida Brenner');
    expect(entries[1].textContent).toContain('Mo., 05.10.2026, 09:00 · geplant');
    expect(await within(entries[1]).findByRole('link', { name: /APP-8/ })).toBeTruthy();
    expect(await within(entries[2]).findByText('Das Item gibt es nicht mehr, oder du siehst es nicht.')).toBeTruthy();
  });

  it('says that a template has not run yet', async () => {
    renderTemplates({ templateId: 'tpl_app_report' });
    expect(await screen.findByText(/^Noch keine Läufe\./)).toBeTruthy();
  });

  it('opens the item of a run in the preview', async () => {
    const user = userEvent.setup();
    runs = [makeTemplateRun()];
    renderTemplates({ templateId: 'tpl_app_report' });
    const { useUiStore } = await import('@/store/ui');

    await user.click(await screen.findByRole('link', { name: /APP-8/ }));
    expect(useUiStore.getState().peekItemId).toBe('wi_app_8');
  });

  it('reads an error without a sentence as unknown, and a run that made an item without one as gone', async () => {
    runs = [makeTemplateRun({ id: 'tr_9', status: 'failed', error: null, work_item_id: null }), makeTemplateRun({ id: 'tr_8', work_item_id: null })];
    renderTemplates({ templateId: 'tpl_app_report' });
    const log = await screen.findByRole('list', { name: 'Läufe' });

    expect(within(log).getAllByRole('listitem')[0].textContent).toContain('Gescheitert: Unbekannter Fehler');
    expect(within(log).getAllByRole('listitem')[1].textContent).toContain('Das Item gibt es nicht mehr');
  });

  it('shows the skeleton of the log while it loads, and its error with a retry', async () => {
    const user = userEvent.setup();
    overrides['GET /api/v1/templates/tpl_app_report/runs'] = () => unavailable;
    renderTemplates({ templateId: 'tpl_app_report' });
    expect(await screen.findByText('Protokoll wird geladen …')).toBeTruthy();

    expect(await screen.findByText('Das Protokoll konnte nicht geladen werden')).toBeTruthy();
    delete overrides['GET /api/v1/templates/tpl_app_report/runs'];
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText(/^Noch keine Läufe\./)).toBeTruthy();
  });

  it('says that the item of a run loads while its reference is on its way', async () => {
    runs = [makeTemplateRun()];
    // the answer of `GET /references` waits until the test lets it go
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const fetching = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/api/v1/references')) await held;
      return fetching(input, init);
    };
    try {
      renderTemplates({ templateId: 'tpl_app_report' });
      expect(await screen.findByText('Item wird geladen …')).toBeTruthy();
      release();
      expect(await screen.findByRole('link', { name: /APP-8/ })).toBeTruthy();
    } finally {
      globalThis.fetch = fetching;
    }
  });

  it('says that a template does not exist (deleted, or a wrong link), without asking for it', async () => {
    renderTemplates({ templateId: 'tpl_gone' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese Vorlage gibt es nicht' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zu den Vorlagen' }).getAttribute('href')).toBe('/projects/APP/templates');
    expect(api.calls.some((call) => call.url.startsWith('/api/v1/templates/'))).toBe(false);
  });

  it('heads a new template, and says when the templates could not be loaded', async () => {
    const user = userEvent.setup();
    renderTemplates({ templateId: 'new' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Neue Vorlage' })).toBeTruthy();

    overrides['GET /api/v1/projects/p_app/templates'] = () => unavailable;
    renderTemplates({ templateId: 'tpl_app_report' });
    expect(await screen.findByText('Die Vorlagen konnten nicht geladen werden')).toBeTruthy();
    delete overrides['GET /api/v1/projects/p_app/templates'];
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Monatsbericht' })).toBeTruthy();
  });
});
