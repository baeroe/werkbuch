/*
 * The template editor against a fake REST API (`mockApi`), ported from the editor part of the clickdummy's
 * templates.test.tsx: the fields of the template's type, the title with its placeholders and the preview the server
 * renders (A335), saving only on purpose (A336: the button, mod+enter once per press, a held key once), the server's
 * refusals at their fields, leaving with unsaved changes, "Jetzt ausführen" and the viewer who reads. Inertia is a fake
 * whose address and `before` listeners the tests hold.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { listCommands } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import { expectLabelInName } from '@/test/a11y';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, labels, list, makeAttachment, makeTemplate, makeTemplateRun, makeWorkItem, mara, organization, project, properties, queryItems, theo, types } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { Project, Template, TemplateRun } from '@/types';
import { TemplatesScreen, type TemplatesScreenProps } from './TemplatesScreen';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/APP/templates/tpl_app_report';
  const listeners = new Set<() => void>();
  const before = new Set<(event: unknown) => unknown>();
  return {
    before,
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
    router: {
      visit: inertia.visit,
      replace: inertia.replace,
      reload: vi.fn(),
      on: (event: string, listener: (event: unknown) => unknown) => {
        if (event !== 'before') return () => {};
        inertia.before.add(listener);
        return () => void inertia.before.delete(listener);
      },
    },
  };
});

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

/* --------------------------------------------------------------------- fake server */

/** What the server's placeholders give at the next term, Monday 2026-11-02 (A335: only the server counts). */
const FILLED: Record<string, string> = { date: '2026-11-02', week: '45', month: '11', month_name: 'November', quarter: '4', year: '2026' };
const fill = (title: string) => title.replace(/\{([a-z_]+)\}/g, (match, name: string) => FILLED[name] ?? match);
const TERMS = ['2026-11-02T08:00:00.000Z', '2026-12-07T08:00:00.000Z', '2027-01-04T08:00:00.000Z', '2027-02-01T08:00:00.000Z', '2027-03-01T08:00:00.000Z'];

const report = makeTemplate();
/** A bug template whose required "Umgebung" has no value: a run fails until it has one. */
const certificates = makeTemplate({
  id: 'tpl_app_certs',
  name: 'Zertifikate prüfen',
  payload: { ...report.payload, type_id: 't_bug', title: 'Zertifikate prüfen', description: null, description_json: null, assignee_id: null },
  schedule: null,
  next_run_at: null,
});
const epic = makeWorkItem({ id: 'wi_app_3', project_id: 'p_app', number: 3, key: 'APP-3', type_id: 't_epic', title: 'Relaunch der App' });

/** Who is signed in: Mara is an org admin (admin everywhere), Ida a viewer of APP. */
let me = mara;
let projects: Project[];
let templates: Template[];
let runs: TemplateRun[];
let overrides: Record<string, MockRoute>;
let api: MockApi;

const unavailable = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };
const refused = (errors: Record<string, string[]>) => ({ status: 422, body: { type: 'about:blank', title: 'invalid', status: 422, reason: 'validation_failed', detail: 'Ungültig.', errors } });

/** The template as the server stores it: the description as JSON, the Markdown copy dropped. */
function stored(id: string, body: { name: string; payload: Record<string, unknown>; schedule: Template['schedule'] }): Template {
  const before = templates.find((template) => template.id === id);
  const { description_json, ...payload } = body.payload;
  return makeTemplate({
    ...before,
    id,
    name: body.name,
    payload: { ...report.payload, ...payload, description: null, description_json: description_json as Template['payload']['description_json'], values_markdown: {} } as Template['payload'],
    schedule: body.schedule,
    updated_at: '2026-11-05T10:00:00.000Z',
  });
}

function routes(): Record<string, MockRoute> {
  const base: Record<string, MockRoute> = {
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/projects/APP': () => ({ body: { data: projects[0] } }),
    'GET /api/v1/projects/p_app/templates': () => ({ body: list(templates) }),
    'GET /api/v1/projects/p_app/members': () => ({ body: list([{ project_id: 'p_app', user_id: 'u_theo', role: 'member' }, { project_id: 'p_app', user_id: 'u_ida', role: 'viewer' }]) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, theo]) }),
    'GET /api/v1/templates/tpl_app_report/runs': () => ({ body: list(runs) }),
    'GET /api/v1/templates/tpl_app_certs/runs': () => ({ body: list([]) }),
    'GET /api/v1/references': () => ({ body: { data: { items: [], pages: [] } } }),
    'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([epic], body)) }),
    'POST /api/v1/templates/preview': (body) => {
      const { schedule, title } = body as { schedule: Template['schedule'] & object; title?: string };
      return { body: { data: { runs: schedule.paused ? [] : TERMS, title: typeof title === 'string' ? fill(title) : null } } };
    },
    'PUT /api/v1/templates/tpl_app_report': (body) => {
      const saved = stored('tpl_app_report', body as never);
      templates = templates.map((template) => (template.id === saved.id ? saved : template));
      return { body: { data: saved } };
    },
    'PUT /api/v1/templates/tpl_app_certs': (body) => {
      const saved = stored('tpl_app_certs', body as never);
      templates = templates.map((template) => (template.id === saved.id ? saved : template));
      return { body: { data: saved } };
    },
    'POST /api/v1/projects/p_app/templates': (body) => {
      const saved = stored('tpl_app_new', body as never);
      templates = [...templates, saved];
      return { status: 201, body: { data: saved } };
    },
    'POST /api/v1/templates/tpl_app_report/run': () => {
      const item = makeWorkItem({ id: 'wi_app_9', project_id: 'p_app', number: 9, key: 'APP-9', title: 'Monatsbericht November 2026' });
      const run = makeTemplateRun({ id: 'tr_9', scheduled_for: null, ran_at: '2026-11-05T10:00:00.000Z', work_item_id: item.id, triggered_by: 'u_mara' });
      runs = [run, ...runs];
      return { body: { data: { run, item } } };
    },
    'DELETE /api/v1/templates/tpl_app_report': () => {
      templates = templates.filter((template) => template.id !== 'tpl_app_report');
      return { status: 204 };
    },
  };
  return new Proxy(base, { get: (target, key: string) => overrides[key] ?? target[key] });
}

beforeEach(() => {
  me = mara;
  projects = [project('APP', 'member', { name: 'Feldwerk-App' })];
  templates = [report, certificates];
  runs = [];
  overrides = {};
  inertia.go('/projects/APP/templates/tpl_app_report');
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  useUiStore.setState(useUiStore.getInitialState());
  api = mockApi(routes());
});

afterEach(() => {
  api.restore();
  act(() => resetToasts());
});

function renderEditor(templateId: string | null = 'tpl_app_report') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (props: Partial<TemplatesScreenProps>) => (
    <QueryClientProvider client={client}>
      <TemplatesScreen identifier="APP" templateId={templateId} {...props} />
    </QueryClientProvider>
  );
  const rendered = render(view({}));
  return { client, rerender: (next: string | null) => rendered.rerender(view({ templateId: next })) };
}

const toastTitles = () => currentToasts().map((item) => item.title);
const saveButton = () => screen.getByRole('button', { name: /^(Speichern|Anlegen)/ });
const calls = (method: string, path: string) => api.calls.filter((call) => call.method === method && call.url === path);
const puts = () => calls('PUT', '/api/v1/templates/tpl_app_report');
/** The form is there: the catalogs have loaded and the rights are known (the name can be changed). */
const ready = async () => {
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await waitFor(() => expect((name as HTMLInputElement).readOnly).toBe(false));
  return name as HTMLInputElement;
};
const modEnter = (init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true, ...init }));
  });
async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string | RegExp) {
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Holds the answers of `method path` until `release`. */
function hold(method: string, path: string) {
  const real = globalThis.fetch;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === method && new URL(String(input), window.location.origin).pathname === path) await held;
    return real(input, init);
  };
  return { release, restore: () => (globalThis.fetch = real) };
}

/* ------------------------------------------------------------------------- fields */

describe('the fields of a template', () => {
  it('shows the fields of its type, marks a required one without a value, and follows a change of the type', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    await ready();
    expect(screen.getByRole('combobox', { name: 'Typ: Bug' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Felder des Typs Bug' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /^Kunde/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Aufwand (h)' })).toBeTruthy();
    const environment = screen.getByRole('combobox', { name: /^Umgebung/ });
    expect(document.getElementById(environment.getAttribute('aria-describedby')!.split(' ')[0])?.textContent).toBe('Pflichtfeld: Ohne Wert scheitert der Lauf.');
    expect(screen.getByRole('combobox', { name: /^Eltern-Item/ })).toBeTruthy();

    // an epic stands at the top: no parent; its type knows only "Kunde"
    await choose(user, screen.getByRole('combobox', { name: 'Typ: Bug' }), 'Epic');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /^Eltern-Item/ })).toBeNull());
    expect(screen.queryByRole('combobox', { name: /^Umgebung/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Felder des Typs Epic' })).toBeTruthy();
  });

  it('offers the active types the project has, and keeps a stored archived one with a hint', async () => {
    const user = userEvent.setup();
    const legacy = { ...types[0], id: 't_legacy', name: 'Altlast', archived_at: '2026-09-01T10:00:00.000Z' };
    overrides['GET /api/v1/work-item-types'] = () => ({ body: list([...types, legacy]) });
    projects = [project('APP', 'member', { name: 'Feldwerk-App', enabled_type_ids: ['t_task', 't_bug', 't_epic', 't_legacy'] })];
    templates = [makeTemplate({ payload: { ...report.payload, type_id: 't_legacy' } })];
    renderEditor();
    await ready();
    const type = screen.getByRole('combobox', { name: 'Typ: Altlast' });
    expect(document.getElementById(type.getAttribute('aria-describedby')!)?.textContent).toBe('Dieser Typ ist archiviert: Läufe scheitern, bis du einen aktiven Typ wählst.');
    await user.click(type);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Task', 'Bug', 'Epic', 'Altlast']);
    await user.click(screen.getByRole('option', { name: 'Task' }));
    await waitFor(() => expect(screen.queryByText(/Dieser Typ ist archiviert/)).toBeNull());
  });

  it('offers the epics of the project as the parent and saves none for an epic', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    await choose(user, screen.getByRole('combobox', { name: /^Eltern-Item/ }), /APP-3/);
    expect(screen.getByRole('combobox', { name: /^Eltern-Item/ }).textContent).toContain('APP-3');
    await choose(user, screen.getByRole('combobox', { name: /^Typ/ }), 'Epic');
    await user.click(saveButton());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toMatchObject({ payload: { type_id: 't_epic', parent_id: null } });
  });

  it('sends priority, assignee, labels, offsets and the values of the type, without empty ones', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    const name = await ready();
    await choose(user, screen.getByRole('combobox', { name: /^Priorität/ }), 'High');
    await choose(user, screen.getByRole('combobox', { name: /^Assignee/ }), 'Theo Okafor');
    await user.click(screen.getByRole('combobox', { name: /^Labels/ }));
    await user.click(await screen.findByRole('option', { name: 'UX' }));
    await user.keyboard('{Escape}');
    await user.type(screen.getByRole('textbox', { name: 'Start-Date' }), '2');
    await user.type(screen.getByRole('textbox', { name: 'Due-Date' }), '14');
    await choose(user, screen.getByRole('combobox', { name: /^Umgebung/ }), 'Produktion');
    await user.click(name);
    await user.click(saveButton());

    await waitFor(() => expect(calls('PUT', '/api/v1/templates/tpl_app_certs')).toHaveLength(1));
    expect(calls('PUT', '/api/v1/templates/tpl_app_certs')[0].body).toEqual({
      name: 'Zertifikate prüfen',
      payload: {
        type_id: 't_bug',
        title: 'Zertifikate prüfen',
        description_json: null,
        priority: 'high',
        assignee_id: 'u_theo',
        label_ids: ['lb_ux'],
        values: { environment: 'opt_env_prod' },
        parent_id: null,
        start_offset_days: 2,
        due_offset_days: 14,
      },
      schedule: null,
    });
    expect(toastTitles()).toContain('„Zertifikate prüfen“ gespeichert');
  });

  it('takes whole days from 0 to 3650 as offsets, and nothing else', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    const start = screen.getByRole('textbox', { name: 'Start-Date' });
    await user.type(start, '3651');
    expect(screen.getByText('Eine ganze Zahl von 0 bis 3650, oder leer lassen.')).toBeTruthy();
    expect(start.getAttribute('aria-invalid')).toBe('true');
    // the field still refuses its text: nothing is saved, the focus goes there
    await user.click(saveButton());
    expect(await screen.findByText('Ein Feld enthält noch eine Eingabe, die nicht passt. Korrigiere sie oder leere das Feld.')).toBeTruthy();
    expect(document.activeElement).toBe(start);
    expect(puts()).toEqual([]);

    await user.clear(start);
    expect(start.getAttribute('aria-invalid')).toBeNull();
    await user.type(start, '7');
    await user.click(saveButton());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toMatchObject({ payload: { start_offset_days: 7 } });
  });

  it('does not save while a property field still shows a text it refuses', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    await ready();
    const effort = screen.getByRole('textbox', { name: 'Aufwand (h)' });
    await user.type(effort, 'drei');
    await user.click(saveButton());

    expect(await screen.findByText('Ein Feld enthält noch eine Eingabe, die nicht passt. Korrigiere sie oder leere das Feld.')).toBeTruthy();
    expect(document.activeElement).toBe(effort);
    expect(calls('PUT', '/api/v1/templates/tpl_app_certs')).toEqual([]);

  });

  it('says the same for mod+enter in the field, which keeps the Enter of a text it refuses', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    await ready();
    const effort = screen.getByRole('textbox', { name: 'Aufwand (h)' });
    await user.type(effort, 'drei');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect((await screen.findByRole('alert')).textContent).toContain('Ein Feld enthält noch eine Eingabe, die nicht passt.');
    expect(document.activeElement).toBe(effort);
    expect(calls('PUT', '/api/v1/templates/tpl_app_certs')).toEqual([]);
  });

  it('says when the labels or the epics of the project could not be loaded, with a retry', async () => {
    const user = userEvent.setup();
    overrides['GET /api/v1/labels'] = () => unavailable;
    overrides['POST /api/v1/work-items/query'] = () => unavailable;
    renderEditor();
    await ready();
    await user.click(screen.getByRole('combobox', { name: /^Labels/ }));
    const retryLabels = await screen.findByRole('button', { name: 'Erneut versuchen' });
    delete overrides['GET /api/v1/labels'];
    await user.click(retryLabels);
    expect(await screen.findByRole('option', { name: 'UX' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('option', { name: 'UX' })).toBeNull());

    await user.click(screen.getByRole('combobox', { name: /^Eltern-Item/ }));
    const retryEpics = await screen.findByRole('button', { name: 'Erneut versuchen' });
    delete overrides['POST /api/v1/work-items/query'];
    await user.click(retryEpics);
    expect(await screen.findByRole('option', { name: /Relaunch der App/ })).toBeTruthy();
  });

  it('waits for the catalogs, and says when they could not be loaded', async () => {
    const user = userEvent.setup();
    overrides['GET /api/v1/properties'] = () => unavailable;
    renderEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Monatsbericht' })).toBeTruthy();
    expect(await screen.findByText('Das Formular ließ sich nicht laden: Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    delete overrides['GET /api/v1/properties'];
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await ready();
  });
});

/* -------------------------------------------------------------------------- title */

describe('the title', () => {
  it('previews the title at the next run and inserts a placeholder where the cursor is', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    const preview = screen.getByRole('region', { name: 'Vorschau des Titels' });
    await waitFor(() => expect(preview.textContent).toContain('Monatsbericht November 2026'));
    expect(preview.textContent).toContain('So heißt das Item beim nächsten Lauf, Mo., 02.11.2026, 09:00:');
    // the examples of the placeholders come from the server as well
    await waitFor(() => expect(within(preview).getByRole('button', { name: '{week} 45 einfügen (Kalenderwoche, Stand jetzt)' })).toBeTruthy());
    // a chip's name holds what it shows, the placeholder and its example (WCAG 2.5.3)
    const chips = within(within(preview).getByRole('group', { name: 'Platzhalter einfügen' })).getAllByRole('button');
    expect(chips).toHaveLength(6);
    for (const chip of chips) expectLabelInName(chip);

    const title = screen.getByRole('textbox', { name: /^Titel/ }) as HTMLInputElement;
    await user.click(title);
    title.setSelectionRange(14, 14);
    await user.click(within(preview).getByRole('button', { name: /^\{week\} 45 einfügen/ }));
    expect(title.value).toBe('Monatsbericht {week}{month_name} {year}');
    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe(20);
    await waitFor(() => expect(preview.textContent).toContain('Monatsbericht 45November 2026'));
  });

  it('previews the title as it would read now without a schedule, and an empty one as untitled', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    await ready();
    const preview = screen.getByRole('region', { name: 'Vorschau des Titels' });
    await waitFor(() => expect(preview.textContent).toContain('So heißt das Item, wenn die Vorlage jetzt angewendet wird:'));
    // the server rendered it at a paused schedule: no terms, so as now
    const asked = calls('POST', '/api/v1/templates/preview').map((call) => call.body as { schedule: { paused: boolean }; title: string });
    expect(asked.some((body) => body.schedule.paused && body.title === 'Zertifikate prüfen')).toBe(true);

    await user.clear(screen.getByRole('textbox', { name: /^Titel/ }));
    await waitFor(() => expect(preview.textContent).toContain('Ohne Titel'));
  });

  it('shows the title as typed while the preview fails', async () => {
    overrides['POST /api/v1/templates/preview'] = () => unavailable;
    renderEditor();
    await ready();
    const preview = screen.getByRole('region', { name: 'Vorschau des Titels' });
    await waitFor(() => expect(calls('POST', '/api/v1/templates/preview').length).toBeGreaterThan(0));
    expect(preview.textContent).toContain('Monatsbericht {month_name} {year}');
    const chip = within(preview).getByRole('button', { name: '{week} einfügen (Kalenderwoche)' });
    expectLabelInName(chip);
  });
});

/* -------------------------------------------------------------------------- saving */

describe('saving', () => {
  it('saves only on purpose: the button, and mod+enter once for a held key', async () => {
    const user = userEvent.setup();
    renderEditor();
    const name = await ready();
    await user.clear(name);
    await user.type(name, 'Monatsbericht für Hafenkontor');
    // nothing goes out while typing (A336)
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(puts()).toEqual([]);

    await modEnter();
    await modEnter({ repeat: true });
    await modEnter({ repeat: true });
    await waitFor(() => expect(toastTitles()).toContain('„Monatsbericht für Hafenkontor“ gespeichert'));
    expect(puts()).toHaveLength(1);
    expect(currentToasts().find((item) => item.title === '„Monatsbericht für Hafenkontor“ gespeichert')?.description).toBe('Nächster Lauf: Mo., 02.11.2026, 09:00');
  });

  it('sends one call per press: a press while one is on its way does nothing', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(await ready(), ' neu');
    const held = hold('PUT', '/api/v1/templates/tpl_app_report');
    try {
      await user.click(saveButton());
      await waitFor(() => expect(saveButton().getAttribute('aria-busy')).toBe('true'));
      await modEnter();
      await user.click(saveButton());
      held.release();
      await waitFor(() => expect(toastTitles()).toContain('„Monatsbericht neu“ gespeichert'));
      expect(puts()).toHaveLength(1);
    } finally {
      held.restore();
    }
  });

  it('saves with mod+enter from a property field that takes Enter for itself', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    await ready();
    await user.type(screen.getByRole('textbox', { name: 'Aufwand (h)' }), '3');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(calls('PUT', '/api/v1/templates/tpl_app_certs')).toHaveLength(1));
    expect(calls('PUT', '/api/v1/templates/tpl_app_certs')[0].body).toMatchObject({ payload: { values: { effort: 3 } } });
  });

  it('asks for a name and a title before it sends', async () => {
    const user = userEvent.setup();
    renderEditor();
    const name = await ready();
    await user.clear(name);
    await user.clear(screen.getByRole('textbox', { name: /^Titel/ }));
    await user.click(saveButton());

    expect(await screen.findByText('Gib der Vorlage einen Namen, etwa „Wöchentliche Wartung“.')).toBeTruthy();
    expect(screen.getByText('Gib dem Item einen Titel. Platzhalter wie {week} sind erlaubt.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(puts()).toEqual([]);
    // typing takes the refusal away
    await user.type(name, 'M');
    expect(screen.queryByText('Gib der Vorlage einen Namen, etwa „Wöchentliche Wartung“.')).toBeNull();
  });

  it('shows the refusals of the server at their fields, the focus on the first: the title and the time of the schedule', async () => {
    const user = userEvent.setup();
    overrides['PUT /api/v1/templates/tpl_app_report'] = () =>
      refused({ 'payload.title': ['Der Titel kann mit Platzhaltern länger als 255 Zeichen werden.'], 'schedule.time': ['Eine Uhrzeit wie 09:00.'] });
    renderEditor();
    await user.type(await ready(), ' neu');
    await user.click(saveButton());

    const title = screen.getByRole('textbox', { name: /^Titel/ });
    expect(await screen.findByText('Der Titel kann mit Platzhaltern länger als 255 Zeichen werden.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(within(screen.getByRole('region', { name: 'Zeitplan' })).getByText('Eine Uhrzeit wie 09:00.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(title));
    // a change of the title takes its refusal away
    await user.type(title, 'x');
    expect(screen.queryByText('Der Titel kann mit Platzhaltern länger als 255 Zeichen werden.')).toBeNull();
  });

  it('puts the focus on the schedule when only it was refused, shows the refusal of a property at its field and one without a field on top', async () => {
    const user = userEvent.setup();
    overrides['PUT /api/v1/templates/tpl_app_certs'] = () => refused({ 'schedule.time': ['Eine Uhrzeit wie 09:00.'] });
    renderEditor('tpl_app_certs');
    await user.type(await ready(), ' neu');
    await user.click(saveButton());
    const schedule = screen.getByRole('region', { name: 'Zeitplan' });
    expect(await within(schedule).findByText('Eine Uhrzeit wie 09:00.')).toBeTruthy();
    await waitFor(() => expect(schedule.contains(document.activeElement)).toBe(true));

    overrides['PUT /api/v1/templates/tpl_app_certs'] = () =>
      refused({ 'schedule.time': ['Eine Uhrzeit wie 09:00.'], 'payload.values.environment': ['Diese Option gibt es nicht mehr.'], 'payload.values.gone': ['Diese Property gibt es nicht mehr.'] });
    await user.click(saveButton());
    const environment = screen.getByRole('combobox', { name: /^Umgebung/ });
    expect(await screen.findByText('Diese Option gibt es nicht mehr.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(environment));
    expect(screen.getByRole('alert').textContent).toContain('Diese Property gibt es nicht mehr.');
  });

  it('shows another refusal on top, and a failure without an answer in a toast with a retry', async () => {
    const user = userEvent.setup();
    overrides['PUT /api/v1/templates/tpl_app_report'] = () => ({ status: 409, body: { type: 'about:blank', title: 'archived', status: 409, reason: 'project_archived', detail: 'Das Projekt ist archiviert.' } });
    renderEditor();
    await user.type(await ready(), ' neu');
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Das Projekt ist archiviert.');

    overrides['PUT /api/v1/templates/tpl_app_report'] = () => unavailable;
    await user.click(saveButton());
    await waitFor(() => expect(toastTitles()).toContain('Vorlage nicht gespeichert'));
    delete overrides['PUT /api/v1/templates/tpl_app_report'];
    act(() => runToastAction(currentToasts().find((item) => item.title === 'Vorlage nicht gespeichert')!.id));
    await waitFor(() => expect(toastTitles()).toContain('„Monatsbericht neu“ gespeichert'));
  });

  it('sends nothing without a change, for the button and for mod+enter, and says so (T16-M3)', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    await user.click(saveButton());
    await modEnter();
    await waitFor(() => expect(toastTitles()).toContain('Nichts zu speichern'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(puts()).toEqual([]);
  });

  it('leaves mod+enter to the preview of an item outside the form, and saves from the form while it is open (T16-M2)', async () => {
    const user = userEvent.setup();
    renderEditor();
    const name = await ready();
    await user.type(name, ' neu');
    act(() => useUiStore.getState().openPeek('wi_app_3'));
    name.blur();
    await modEnter();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(puts()).toEqual([]);
    name.focus();
    await modEnter();
    await waitFor(() => expect(puts()).toHaveLength(1));
  });

  it('never submits the form itself (T16-M8)', async () => {
    renderEditor();
    const name = await ready();
    expect(fireEvent.submit(name.form!)).toBe(false);
  });

  it('keeps what was typed while a new template was created, unsaved in its editor (T16-I1)', async () => {
    const user = userEvent.setup();
    inertia.go('/projects/APP/templates/new');
    overrides['PUT /api/v1/templates/tpl_app_new'] = (body) => ({ body: { data: stored('tpl_app_new', body as never) } });
    const { rerender } = renderEditor('new');
    const name = await ready();
    await user.type(name, 'Release-Notizen');
    const title = screen.getByRole('textbox', { name: /^Titel/ });
    await user.type(title, 'Release-Notizen');
    const held = hold('POST', '/api/v1/projects/p_app/templates');
    try {
      await user.click(saveButton());
      await waitFor(() => expect(saveButton().getAttribute('aria-busy')).toBe('true'));
      await user.type(title, ' KW {{week}');
      held.release();
      await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/APP/templates/tpl_app_new', expect.objectContaining({ replace: true })));
    } finally {
      held.restore();
    }
    // the visit lands
    act(() => (inertia.visit.mock.calls.at(-1)?.[1] as { onFinish?: () => void } | undefined)?.onFinish?.());
    inertia.go('/projects/APP/templates/tpl_app_new');
    rerender('tpl_app_new');
    await screen.findByRole('heading', { level: 1, name: 'Release-Notizen' });
    const next = (await screen.findByRole('textbox', { name: /^Titel/ })) as HTMLInputElement;
    expect(next.value).toBe('Release-Notizen KW {week}');
    // it is not saved yet: the run waits, and leaving asks
    expect(screen.getByRole('button', { name: /Jetzt ausführen/ }).getAttribute('aria-disabled')).toBe('true');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(saveButton());
    await waitFor(() => expect(calls('PUT', '/api/v1/templates/tpl_app_new')).toHaveLength(1));
  });

  it('stays the same editor until the address of the new template has loaded: what is typed meanwhile stays, a second press saves it there (T17-I1)', async () => {
    const user = userEvent.setup();
    inertia.go('/projects/APP/templates/new');
    overrides['PUT /api/v1/templates/tpl_app_new'] = (body) => {
      const saved = stored('tpl_app_new', body as never);
      templates = templates.map((template) => (template.id === saved.id ? saved : template));
      return { body: { data: saved } };
    };
    const { rerender } = renderEditor('new');
    const name = await ready();
    await user.type(name, 'Release-Notizen');
    const title = screen.getByRole('textbox', { name: /^Titel/ });
    await user.type(title, 'Release-Notizen');
    await user.click(saveButton());
    // created: the visit to its address is on its way (it lands only below), the editor still stands
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/APP/templates/tpl_app_new', expect.objectContaining({ replace: true })));
    await user.type(title, ' KW {{week}');
    // a second press in that window creates nothing a second time: it saves the new template
    await user.click(saveButton());
    await waitFor(() => expect(calls('PUT', '/api/v1/templates/tpl_app_new')).toHaveLength(1));
    expect(calls('POST', '/api/v1/projects/p_app/templates')).toHaveLength(1);
    expect(calls('PUT', '/api/v1/templates/tpl_app_new')[0].body).toMatchObject({ payload: { title: 'Release-Notizen KW {week}' } });
    // a text a field cannot read stays as typed (T17-M2)
    const start = screen.getByRole('textbox', { name: 'Start-Date' }) as HTMLInputElement;
    await user.type(start, 'drei');

    // the visit lands
    act(() => (inertia.visit.mock.calls.at(-1)?.[1] as { onFinish?: () => void } | undefined)?.onFinish?.());
    inertia.go('/projects/APP/templates/tpl_app_new');
    rerender('tpl_app_new');
    await screen.findByRole('heading', { level: 1, name: 'Release-Notizen' });
    expect((screen.getByRole('textbox', { name: /^Titel/ }) as HTMLInputElement).value).toBe('Release-Notizen KW {week}');
    const after = screen.getByRole('textbox', { name: 'Start-Date' }) as HTMLInputElement;
    expect(after.value).toBe('drei');
    await user.click(saveButton());
    expect(await screen.findByText('Ein Feld enthält noch eine Eingabe, die nicht passt. Korrigiere sie oder leere das Feld.')).toBeTruthy();
    expect(document.activeElement).toBe(after);
    expect(calls('PUT', '/api/v1/templates/tpl_app_new')).toHaveLength(1);
    expect(calls('POST', '/api/v1/projects/p_app/templates')).toHaveLength(1);
    // leaving asks again once the visit has landed
    await user.clear(after);
    await user.type(screen.getByRole('textbox', { name: /^Titel/ }), '!');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('asks before leaving with unsaved changes, and not after saving them', async () => {
    const user = userEvent.setup();
    renderEditor();
    const name = await ready();
    const leave = () =>
      act(() => {
        for (const listener of inertia.before) listener({ detail: { visit: { url: new URL('http://localhost/projects/APP/templates'), prefetch: false, preserveUrl: false } } });
      });
    leave();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.type(name, ' neu');
    leave();
    const dialog = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    expect(dialog.textContent).toContain('Die Änderungen an „Monatsbericht“ sind nicht gespeichert.');
    await user.click(within(dialog).getByRole('button', { name: 'Weiter bearbeiten' }));
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await user.click(saveButton());
    await waitFor(() => expect(toastTitles()).toContain('„Monatsbericht neu“ gespeichert'));
    leave();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('creates a template, leads to it and gives its heading the focus', async () => {
    const user = userEvent.setup();
    inertia.go('/projects/APP/templates/new');
    const { rerender } = renderEditor('new');
    expect(await screen.findByRole('heading', { level: 1, name: 'Neue Vorlage' })).toBeTruthy();
    const name = await ready();
    expect(document.activeElement).toBe(name);
    expect(screen.queryByRole('button', { name: /Jetzt ausführen/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Typ: Task' })).toBeTruthy();
    await user.type(name, 'Release-Notizen');
    await user.type(screen.getByRole('textbox', { name: /^Titel/ }), 'Release-Notizen KW {{week}');
    await user.click(saveButton());

    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/APP/templates/tpl_app_new', expect.objectContaining({ replace: true })));
    const created = calls('POST', '/api/v1/projects/p_app/templates')[0].body as { name: string; payload: { title: string; type_id: string }; schedule: null };
    expect(created).toMatchObject({ name: 'Release-Notizen', payload: { title: 'Release-Notizen KW {week}', type_id: 't_task' }, schedule: null });
    expect(toastTitles()).toContain('„Release-Notizen“ angelegt');

    // the visit is meant: the guard lets it through, and the editor of the new template takes over with its heading
    act(() => {
      for (const listener of inertia.before) listener({ detail: { visit: { url: new URL('http://localhost/projects/APP/templates/tpl_app_new'), prefetch: false, preserveUrl: false } } });
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    (document.activeElement as HTMLElement).blur();
    inertia.go('/projects/APP/templates/tpl_app_new');
    rerender('tpl_app_new');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Release-Notizen' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('waits for an upload of the description before it saves', async () => {
    installFakeXhr();
    try {
      const user = userEvent.setup();
      renderEditor();
      await ready();
      const description = screen.getByRole('textbox', { name: 'Beschreibung' });
      fireEvent.paste(description, {
        clipboardData: { types: ['Files'], files: [new File([new Uint8Array([137, 80, 78, 71])], 'grafik.png', { type: 'image/png' })], getData: () => '' },
      });
      // into the project, without an owner: saving links it (A232)
      expect(FakeXhr.last.sent?.get('kind')).toBe('inline');
      await waitFor(() => expect(saveButton().getAttribute('aria-disabled')).toBe('true'));
      await modEnter();
      expect((await screen.findByRole('alert')).textContent).toContain('Warte, bis die Uploads fertig sind.');
      expect(puts()).toEqual([]);

      await act(async () => {
        FakeXhr.last.answer(201, { data: makeAttachment({ id: 'att_grafik', project_id: 'p_app', filename: 'grafik.png' }) });
      });
      await waitFor(() => expect(saveButton().hasAttribute('aria-disabled')).toBe(false));
      await user.click(saveButton());
      await waitFor(() => expect(puts()).toHaveLength(1));
      expect(JSON.stringify(puts()[0].body)).toContain('att_grafik');
    } finally {
      restoreFakeXhr();
    }
  });
});

/* ------------------------------------------------------------------------ running */

describe('running a template now', () => {
  it('runs the saved template: the toast leads to the new item in the preview', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    await user.click(screen.getByRole('button', { name: /Jetzt ausführen/ }));

    await waitFor(() => expect(toastTitles()).toContain('APP-9 angelegt'));
    const created = currentToasts().find((item) => item.title === 'APP-9 angelegt')!;
    expect(created.description).toBe('Monatsbericht November 2026');
    expect(created.action?.label).toBe('Öffnen');
    act(() => runToastAction(created.id));
    expect(useUiStore.getState().peekItemId).toBe('wi_app_9');
    const log = await screen.findByRole('list', { name: 'Läufe' });
    await waitFor(() => expect(within(log).getAllByRole('listitem')).toHaveLength(1));
  });

  it('says why a run failed', async () => {
    const user = userEvent.setup();
    overrides['POST /api/v1/templates/tpl_app_report/run'] = () => ({
      body: { data: { run: makeTemplateRun({ status: 'failed', work_item_id: null, error: 'Pflicht-Property Umgebung fehlt', triggered_by: 'u_mara' }), item: null } },
    });
    renderEditor();
    await ready();
    await user.click(screen.getByRole('button', { name: /Jetzt ausführen/ }));

    await waitFor(() => expect(toastTitles()).toContain('Lauf gescheitert'));
    expect(currentToasts().find((item) => item.title === 'Lauf gescheitert')?.description).toBe(
      'Pflicht-Property Umgebung fehlt. Das Protokoll hält es fest; Lead und Ersteller der Vorlage sind benachrichtigt.',
    );
  });

  it('says when the run could not be started, with a retry', async () => {
    const user = userEvent.setup();
    overrides['POST /api/v1/templates/tpl_app_report/run'] = () => unavailable;
    renderEditor();
    await ready();
    await user.click(screen.getByRole('button', { name: /Jetzt ausführen/ }));
    await waitFor(() => expect(toastTitles()).toContain('„Monatsbericht“ nicht ausgeführt'));
    delete overrides['POST /api/v1/templates/tpl_app_report/run'];
    act(() => runToastAction(currentToasts().find((item) => item.title === '„Monatsbericht“ nicht ausgeführt')!.id));
    await waitFor(() => expect(toastTitles()).toContain('APP-9 angelegt'));
  });

  it('waits for "Speichern" while there are unsaved changes, and runs from the palette', async () => {
    const user = userEvent.setup();
    renderEditor();
    const name = await ready();
    expect(listCommands().find((command) => command.id === 'template.run')?.when?.()).toBe(true);
    await user.type(name, ' neu');

    const run = screen.getByRole('button', { name: /Jetzt ausführen/ });
    expect(run.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(run.getAttribute('aria-describedby')!)?.textContent).toBe('Erst speichern: Der Lauf nimmt die gespeicherte Fassung der Vorlage.');
    expect(listCommands().find((command) => command.id === 'template.run')?.when?.()).toBe(false);

    await user.click(saveButton());
    await waitFor(() => expect(run.hasAttribute('aria-disabled')).toBe(false));
    const command = listCommands().find((entry) => entry.id === 'template.run')!;
    expect(command.group).toBe('Vorlage „Monatsbericht neu“');
    act(() => command.run());
    await waitFor(() => expect(toastTitles()).toContain('APP-9 angelegt'));
  });

  it('starts no second run while one is on its way, from the button or the palette (T16-M6)', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    const held = hold('POST', '/api/v1/templates/tpl_app_report/run');
    try {
      const run = screen.getByRole('button', { name: /Jetzt ausführen/ });
      await user.click(run);
      await waitFor(() => expect(run.getAttribute('aria-busy')).toBe('true'));
      act(() => listCommands().find((entry) => entry.id === 'template.run')!.run());
      fireEvent.click(run);
      held.release();
      await waitFor(() => expect(toastTitles()).toContain('APP-9 angelegt'));
      expect(calls('POST', '/api/v1/templates/tpl_app_report/run')).toHaveLength(1);
    } finally {
      held.restore();
    }
  });
});

/* ------------------------------------------------------------------------ deleting */

describe('deleting from the editor', () => {
  it('goes to the list, brings the template back with undo, and deletes it when the toast runs out', async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));

    expect(inertia.visit).toHaveBeenCalledWith('/projects/APP/templates');
    expect(toastTitles()).toContain('Vorlage „Monatsbericht“ gelöscht');
    // the list leaves it out while the toast runs
    rerender(null);
    expect(await screen.findByRole('link', { name: 'Zertifikate prüfen' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Monatsbericht' })).toBeNull();
    // still there until the toast runs out
    expect(calls('DELETE', '/api/v1/templates/tpl_app_report')).toEqual([]);

    // undo while the list is shown: back to the template
    window.history.pushState(null, '', '/projects/APP/templates');
    act(() => runToastAction(currentToasts().find((item) => item.title === 'Vorlage „Monatsbericht“ gelöscht')!.id));
    expect(inertia.visit).toHaveBeenLastCalledWith('/projects/APP/templates/tpl_app_report');
    window.history.pushState(null, '', '/');
    expect(await screen.findByRole('link', { name: 'Monatsbericht' })).toBeTruthy();
    rerender('tpl_app_report');
    await ready();

    // from the palette, and this time the toast runs out
    const remove = listCommands().find((command) => command.id === 'template.delete')!;
    expect(remove.label).toBe('Vorlage löschen');
    act(() => remove.run());
    act(() => dismissToast(currentToasts().find((item) => item.title === 'Vorlage „Monatsbericht“ gelöscht')!.id));
    await waitFor(() => expect(calls('DELETE', '/api/v1/templates/tpl_app_report')).toHaveLength(1));
  });

  it('says that unsaved changes go with it, and only then (T16-M5)', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    const toastOf = () => currentToasts().find((item) => item.title === 'Vorlage „Monatsbericht“ gelöscht')!;
    // saved as it is: nothing more to say
    act(() => listCommands().find((command) => command.id === 'template.delete')!.run());
    expect(toastOf().description).toBeUndefined();
    act(() => runToastAction(toastOf().id));
    await ready();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' neu');
    act(() => listCommands().find((command) => command.id === 'template.delete')!.run());
    expect(toastOf().description).toBe('Deine ungespeicherten Änderungen sind mit ihr weg; Rückgängig holt die gespeicherte Vorlage zurück.');
  });
});

/* -------------------------------------------------------------------------- viewer */

describe('a viewer', () => {
  it('reads the template, without saving, running or deleting it', async () => {
    me = ida;
    projects = [project('APP', 'viewer', { name: 'Feldwerk-App' })];
    renderEditor();
    expect(await screen.findByRole('heading', { level: 1, name: 'Monatsbericht' })).toBeTruthy();
    const name = (await screen.findByRole('textbox', { name: 'Name' })) as HTMLInputElement;
    await waitFor(() => expect(screen.getByText(/^Nur lesen: /)).toBeTruthy());
    expect(name.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
    expect(screen.getByRole('button', { name: /Jetzt ausführen/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('textbox', { name: /^Titel/ }).hasAttribute('readonly')).toBe(true);
    expect(screen.queryByRole('group', { name: 'Platzhalter einfügen' })).toBeNull();
    expect(screen.getByText('Kennzahlen des Monats zusammenstellen.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Beschreibung' })).toBeNull();
    expect(listCommands().find((command) => command.id === 'template.delete')?.when?.()).toBe(false);
    // mod+enter saves nothing
    await modEnter();
    expect(puts()).toEqual([]);
  });

  it('reads that a template has no description', async () => {
    me = ida;
    projects = [project('APP', 'viewer', { name: 'Feldwerk-App' })];
    renderEditor('tpl_app_certs');
    expect(await screen.findByText('Keine Beschreibung.')).toBeTruthy();
  });
});

/* --------------------------------------------------------------------- the schedule */

describe('the schedule', () => {
  it('says the stored schedule in words, and that a template without one runs by hand', async () => {
    renderEditor();
    await ready();
    expect(within(screen.getByRole('region', { name: 'Zeitplan' })).getByText('Jeden ersten Montag im Monat um 09:00')).toBeTruthy();
    expect(screen.getByText('Legt nach Zeitplan Items an, als Bot „Automation“. 2 Läufe bisher.')).toBeTruthy();
  });

  it('edits the schedule as part of the template and saves it with the rest, with the next terms of the server', async () => {
    const user = userEvent.setup();
    renderEditor('tpl_app_certs');
    await ready();
    const schedule = screen.getByRole('region', { name: 'Zeitplan' });
    await user.click(within(schedule).getByRole('switch', { name: 'Nach Zeitplan anlegen' }));
    await user.click(within(schedule).getByRole('button', { name: 'Monatlich' }));
    await user.click(within(schedule).getByRole('button', { name: 'Wochentag im Monat' }));
    const time = within(schedule).getByRole('textbox', { name: /^Uhrzeit/ });
    await user.clear(time);
    await user.type(time, '7');
    expect(await within(schedule).findByRole('list', { name: 'Nächste Termine' })).toBeTruthy();
    // the terms ask the same question as the title's preview
    await waitFor(() => expect(calls('POST', '/api/v1/templates/preview').some((call) => JSON.stringify(call.body).includes('"time":"07:00"'))).toBe(true));
    await user.click(saveButton());
    await waitFor(() => expect(calls('PUT', '/api/v1/templates/tpl_app_certs')).toHaveLength(1));
    expect((calls('PUT', '/api/v1/templates/tpl_app_certs')[0].body as { schedule: unknown }).schedule).toMatchObject({
      frequency: 'monthly',
      nth_weekday: { n: 1 },
      time: '07:00',
      ends: { type: 'never' },
      paused: false,
    });
  });

  it('does not save while the time shows a text it cannot read, and puts the focus there', async () => {
    const user = userEvent.setup();
    renderEditor();
    await ready();
    const time = screen.getByRole('textbox', { name: /^Uhrzeit/ });
    await user.clear(time);
    await user.type(time, '25');
    await user.click(saveButton());
    expect(await screen.findByText('Ein Feld enthält noch eine Eingabe, die nicht passt. Korrigiere sie oder leere das Feld.')).toBeTruthy();
    expect(document.activeElement).toBe(time);
    expect(puts()).toEqual([]);
    // switched off, the field goes and with it what it could not read
    await user.click(screen.getByRole('switch', { name: 'Nach Zeitplan anlegen' }));
    await user.click(saveButton());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0].body as { schedule: unknown }).schedule).toBeNull();
  });

  it('takes a refusal of the schedule away once what it names changes', async () => {
    const user = userEvent.setup();
    overrides['PUT /api/v1/templates/tpl_app_report'] = () => refused({ 'schedule.frequency': ['Wähle täglich, wöchentlich, monatlich oder jährlich.'] });
    renderEditor();
    await user.type(await ready(), ' neu');
    await user.click(saveButton());
    const schedule = screen.getByRole('region', { name: 'Zeitplan' });
    expect(await within(schedule).findByText('Wähle täglich, wöchentlich, monatlich oder jährlich.')).toBeTruthy();
    await waitFor(() => expect(schedule.querySelector('[data-refused]')).toBe(document.activeElement));
    await user.click(within(schedule).getByRole('button', { name: 'Täglich' }));
    expect(within(schedule).queryByText('Wähle täglich, wöchentlich, monatlich oder jährlich.')).toBeNull();
  });

  it('says that a paused schedule plans no runs', async () => {
    templates = [makeTemplate({ schedule: { ...report.schedule!, paused: true }, run_count: 1 })];
    renderEditor();
    await ready();
    expect(screen.getByText('Der Zeitplan ist pausiert. Von Hand lässt sich die Vorlage weiter anwenden.')).toBeTruthy();
  });

  it('counts a single run in words, and leads a template without a schedule', async () => {
    templates = [makeTemplate({ run_count: 1 }), certificates];
    const { rerender } = renderEditor();
    await ready();
    expect(screen.getByText('Legt nach Zeitplan Items an, als Bot „Automation“. Ein Lauf bisher.')).toBeTruthy();
    rerender('tpl_app_certs');
    expect(await screen.findByText('Ohne Zeitplan: Die Vorlage wird von Hand angewendet.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Zeitplan' })).getByText('Ohne Zeitplan wird die Vorlage von Hand angewendet: im Anlegen-Dialog oder mit „Jetzt ausführen“.')).toBeTruthy();
  });
});
