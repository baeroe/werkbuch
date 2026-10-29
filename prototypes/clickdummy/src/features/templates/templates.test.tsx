import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/api/db';
import { currentToasts, dismissToast, resetToasts } from '@/components/ui/toast';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { TemplatesScreen } from './TemplatesScreen';

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  Element.prototype.scrollIntoView = () => {};
  await preloadEditor();
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  act(() => resetToasts());
});

function renderTemplates(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: '/projects/:identifier/templates/:templateId?', element: <TemplatesScreen /> }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

const storedTemplate = (id: string) => getDb().templates.find((template) => template.id === id);
const toastTitles = () => currentToasts().map((item) => item.title);
const save = () => screen.getByRole('button', { name: /^(Speichern|Anlegen)/ });

describe('the list of templates', () => {
  it('shows each template with its schedule in words and its next run', async () => {
    renderTemplates('/projects/APP/templates');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vorlagen' })).toBeTruthy();
    const row = (await screen.findByRole('link', { name: 'Monatsbericht' })).closest('li')!;
    expect(row.textContent).toContain('Jeden ersten Montag im Monat um 09:00');
    expect(row.textContent).toContain('02.11.2026, 09:00');
  });

  it('marks a paused schedule and names a failed last run', async () => {
    renderTemplates('/projects/OPS/templates');
    const row = (await screen.findByRole('link', { name: 'Zertifikate prüfen' })).closest('li')!;
    expect(row.textContent).toContain('Pausiert');
    expect(await within(row).findByText(/Pflicht-Property Umgebung fehlt/)).toBeTruthy();
  });
});

describe('the template editor', () => {
  it('shows the next five runs with the title each one gets', async () => {
    renderTemplates('/projects/APP/templates/tpl_app_report');
    const runs = await screen.findByRole('list', { name: 'Nächste Termine' });
    const entries = within(runs).getAllByRole('listitem');

    expect(entries).toHaveLength(5);
    expect(entries[0].textContent).toContain('Montag, 2. November 2026');
    expect(entries[0].textContent).toContain('Monatsbericht November 2026');
    expect(entries[1].textContent).toContain('Montag, 7. Dezember 2026');
    expect(entries[4].textContent).toContain('Monatsbericht März 2027');
  });

  it('says the schedule in words and follows every change of it', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/APP/templates/tpl_app_report');
    const schedule = await screen.findByRole('region', { name: 'Zeitplan' });
    expect(within(schedule).getByText('Jeden ersten Montag im Monat um 09:00')).toBeTruthy();

    await user.click(within(schedule).getByRole('button', { name: 'Wöchentlich' }));
    expect(within(schedule).getByText('Wöchentlich am Montag um 09:00')).toBeTruthy();
    await user.click(within(schedule).getByRole('button', { name: 'Donnerstag' }));
    expect(within(schedule).getByText('Wöchentlich am Montag und Donnerstag um 09:00')).toBeTruthy();
    const runs = screen.getByRole('list', { name: 'Nächste Termine' });
    expect(within(runs).getAllByRole('listitem')[0].textContent).toContain('Donnerstag, 29. Oktober 2026');
  });

  it('pauses a schedule: no runs are planned then', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/APP/templates/tpl_app_report');
    const schedule = await screen.findByRole('region', { name: 'Zeitplan' });
    await user.click(within(schedule).getByRole('switch', { name: 'Pausiert' }));
    expect(screen.queryByRole('list', { name: 'Nächste Termine' })).toBeNull();
    expect(within(schedule).getByText(/legt der Zeitplan keine Items an/)).toBeTruthy();
  });

  it('previews the title with the placeholders filled and inserts a placeholder where the cursor is', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/WEB/templates/tpl_web_maintenance');
    const preview = await screen.findByRole('region', { name: 'Vorschau des Titels' });
    expect(preview.textContent).toContain('Wartung KW 45');

    const title = screen.getByRole('textbox', { name: /^Titel/ }) as HTMLInputElement;
    await user.click(title);
    title.setSelectionRange(title.value.length, title.value.length);
    await user.click(within(preview).getByRole('button', { name: /^\{year\}/ }));
    expect(title.value).toBe('Wartung KW {week}{year}');
    expect(preview.textContent).toContain('Wartung KW 452026');
  });

  it('runs a template now: the toast leads to the new item, the log shows the run', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/APP/templates/tpl_app_report');
    const log = await screen.findByRole('list', { name: 'Protokoll der Läufe' });
    expect(await within(log).findAllByRole('listitem')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Jetzt ausführen/ }));

    await waitFor(() => expect(toastTitles()).toEqual([expect.stringMatching(/^APP-\d+ angelegt$/)]));
    const created = currentToasts()[0];
    expect(created.description).toBe('Monatsbericht Oktober 2026');
    expect(created.action?.label).toBe('Öffnen');
    const item = getDb().items.find((entry) => entry.key === created.title.replace(' angelegt', ''))!;
    expect(item.template_id).toBe('tpl_app_report');
    act(() => created.action!.onClick());
    expect(useUiStore.getState().peekItemId).toBe(item.id);
    await waitFor(() => expect(within(log).getAllByRole('listitem')).toHaveLength(3));
  });

  it('logs a failed run and says why', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/OPS/templates/tpl_ops_certs');
    const log = await screen.findByRole('list', { name: 'Protokoll der Läufe' });
    expect(await within(log).findByText(/Pflicht-Property Umgebung fehlt/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Jetzt ausführen/ }));

    await waitFor(() => expect(toastTitles()).toContain('Lauf gescheitert'));
    await waitFor(() => expect(within(log).getAllByText(/Pflicht-Property Umgebung fehlt/)).toHaveLength(2));
  });

  it('offers the epics of the project as the parent, and no parent for an epic', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/WEB/templates/tpl_web_maintenance');

    await user.click(await screen.findByRole('combobox', { name: /^Eltern-Item/ }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Relaunch Phase 1WEB-30']);
    await user.click(options[0]);
    expect(screen.getByRole('combobox', { name: /^Eltern-Item/ }).textContent).toContain('WEB-30');

    // as an epic the template's item stands at the top: the field goes, and the parent is not saved
    await user.click(screen.getByRole('combobox', { name: /^Typ/ }));
    await user.click(await screen.findByRole('option', { name: 'Epic' }));
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /^Eltern-Item/ })).toBeNull());
    await user.click(save());

    await waitFor(() => expect(storedTemplate('tpl_web_maintenance')?.payload).toMatchObject({ type_id: 't_epic', parent_id: null }));
  });

  it('saves the template', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/APP/templates/tpl_app_report');
    const name = await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Monatsbericht für Hafenkontor');
    await user.click(save());

    await waitFor(() => expect(storedTemplate('tpl_app_report')!.name).toBe('Monatsbericht für Hafenkontor'));
    expect(toastTitles()).toContain('„Monatsbericht für Hafenkontor“ gespeichert');
  });

  it('fills a required property, so the next run can go through', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/OPS/templates/tpl_ops_certs');
    expect(await screen.findByText(/Ohne Wert scheitert der Lauf/)).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: /^Umgebung/ }));
    await user.click(await screen.findByRole('option', { name: 'Produktion' }));
    await user.click(save());

    await waitFor(() => expect(storedTemplate('tpl_ops_certs')!.payload.values.environment).toBeTruthy());
  });

  it('saves with mod+enter from a property field that takes Enter for itself', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/OPS/templates/tpl_ops_certs');
    await user.type(await screen.findByRole('textbox', { name: 'Aufwand (h)' }), '3');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(storedTemplate('tpl_ops_certs')!.payload.values.effort).toBe(3));
    expect(toastTitles()).toContain('„Zertifikate prüfen“ gespeichert');
  });

  it('does not save while a property field still shows a text it refuses', async () => {
    const user = userEvent.setup();
    renderTemplates('/projects/OPS/templates/tpl_ops_certs');
    await user.type(await screen.findByRole('textbox', { name: 'Aufwand (h)' }), 'drei');
    await user.click(save());

    expect(await screen.findByText(/Ein Feld enthält noch eine Eingabe, die nicht passt/)).toBeTruthy();
    expect(document.activeElement?.getAttribute('name')).toBe('effort');
    expect(storedTemplate('tpl_ops_certs')!.payload.values).toEqual({});
  });

  it('creates a template and leads to it', async () => {
    const user = userEvent.setup();
    const { router } = renderTemplates('/projects/APP/templates/new');
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Release-Notizen');
    await user.type(screen.getByRole('textbox', { name: /^Titel/ }), 'Release-Notizen KW {{week}');
    await user.click(save());

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/projects\/APP\/templates\/tpl_/));
    const created = getDb().templates.find((template) => template.name === 'Release-Notizen')!;
    expect(created.payload.title).toBe('Release-Notizen KW {week}');
    expect(created.project_id).toBe('p_app');
  });

  it('deletes a template when the undo toast runs out', async () => {
    const user = userEvent.setup();
    const { router } = renderTemplates('/projects/APP/templates/tpl_app_report');
    await screen.findByRole('list', { name: 'Nächste Termine' });
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/templates'));
    expect(toastTitles()).toContain('Vorlage „Monatsbericht“ gelöscht');
    expect(await screen.findByText('Noch keine Vorlagen')).toBeTruthy();
    expect(storedTemplate('tpl_app_report')).toBeTruthy();
    act(() => dismissToast(currentToasts().find((item) => item.title === 'Vorlage „Monatsbericht“ gelöscht')!.id));
    await waitFor(() => expect(storedTemplate('tpl_app_report')).toBeUndefined());
  });

  it('lets a viewer read the template, without saving or running it', async () => {
    asUser('u_ida');
    renderTemplates('/projects/APP/templates/tpl_app_report');
    expect(await screen.findByRole('heading', { level: 1, name: 'Monatsbericht' })).toBeTruthy();
    await screen.findByRole('list', { name: 'Nächste Termine' });
    expect(screen.getByRole('button', { name: /Jetzt ausführen/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).readOnly).toBe(true);
  });

  it('says so when a template does not exist', async () => {
    renderTemplates('/projects/APP/templates/tpl_nope');
    expect(await screen.findByText('Diese Vorlage gibt es nicht')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zu den Vorlagen' })).toBeTruthy();
  });
});

describe('uploads in a template', () => {
  it('an image in a rich text property of the template belongs to the template', async () => {
    renderTemplates('/projects/OPS/templates/tpl_ops_certs');
    const editor = await screen.findByRole('textbox', { name: 'Schritte zum Nachstellen' });
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'ablauf.png', { type: 'image/png' });

    fireEvent.paste(editor, { clipboardData: { files: [file], types: ['Files'], getData: () => '' } });
    await waitFor(() => expect(getDb().attachments.find((entry) => entry.filename === 'ablauf.png')?.owner).toEqual({ type: 'template', id: 'tpl_ops_certs' }));
  });
});
