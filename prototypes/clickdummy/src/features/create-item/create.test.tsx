import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/api/db';
import { createWorkItem } from '@/api/workItems';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { canUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { CreateItemDialog } from './CreateItemDialog';

// the requests the dialog sends, passed on to the fake API
vi.mock('@/api/workItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workItems')>();
  return { ...actual, createWorkItem: vi.fn(actual.createWorkItem) };
});

beforeAll(async () => {
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  act(() => resetToasts());
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const webItems = () => getDb().items.filter((item) => item.project_id === 'p_web').length;

describe('CreateItemDialog', () => {
  it('waits while a property still shows a text it refuses, and shows the refusals of the server at their fields', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithData(<CreateItemDialog open defaults={{ project_id: 'p_web', type_id: 't_bug' }} onOpenChange={onOpenChange} />);
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    const before = webItems();

    await user.type(await within(dialog).findByRole('textbox', { name: /Titel/ }), 'Formular-Fehler auf Android');
    // Aufwand takes numbers only: the field refuses "drei" and reports no value
    await user.type(await within(dialog).findByRole('textbox', { name: 'Aufwand (h)' }), 'drei');
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));

    expect(await within(dialog).findByText('Noch nicht angelegt')).toBeTruthy();
    expect(webItems()).toBe(before);
    expect(document.activeElement?.getAttribute('name')).toBe('effort');

    // valid now, but Umgebung is required for bugs: the server says so at the field
    await user.clear(within(dialog).getByRole('textbox', { name: 'Aufwand (h)' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Aufwand (h)' }), '2,5');
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    expect(await within(dialog).findByText(/„Umgebung“ ist ein Pflichtfeld/)).toBeTruthy();
    expect(webItems()).toBe(before);
    expect(within(dialog).getByRole('combobox', { name: /^Umgebung/ }).getAttribute('aria-invalid')).toBe('true');

    await user.click(within(dialog).getByRole('combobox', { name: /^Umgebung/ }));
    await user.click(await screen.findByRole('option', { name: 'Produktion' }));
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));

    await waitFor(() => expect(webItems()).toBe(before + 1));
    const created = getDb().items.at(-1)!;
    expect([created.title, created.type_id, created.values.effort, created.values.environment]).toEqual(['Formular-Fehler auf Android', 't_bug', 2.5, 'opt_env_prod']);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the structure of a rich text property while it has no text yet, and sends it as null only on create', async () => {
    const user = userEvent.setup();
    renderWithData(<CreateItemDialog open defaults={{ project_id: 'p_web', type_id: 't_bug' }} onOpenChange={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: /Titel/ }), 'Suche findet keine Umlaute');
    await user.click(within(dialog).getByRole('combobox', { name: /^Umgebung/ }));
    await user.click(await screen.findByRole('option', { name: 'Produktion' }));

    const steps = await within(dialog).findByRole('textbox', { name: 'Schritte zum Nachstellen' });
    await user.click(steps);
    await user.type(steps, '/liste');
    await user.keyboard('{Enter}');
    // a list without text is no content yet, but it stays for the first step (it used to turn back into a paragraph)
    expect(steps.querySelectorAll('ul > li')).toHaveLength(1);
    expect(steps.textContent).toBe('');

    const before = webItems();
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    await waitFor(() => expect(webItems()).toBe(before + 1));
    // without content the property goes out as "no value", not as a document with an empty list
    expect(vi.mocked(createWorkItem).mock.lastCall?.[0].values).toEqual({ environment: 'opt_env_prod', steps: null });
  });
});

/** The dialog as CreateHost mounts it: open while the store says so. */
function Host() {
  const open = useUiStore((state) => state.createOpen);
  const defaults = useUiStore((state) => state.createDefaults);
  return (
    <CreateItemDialog
      open={open}
      defaults={defaults}
      onOpenChange={(next) => {
        if (!next) useUiStore.getState().closeCreate();
      }}
    />
  );
}

const parkedToasts = () => currentToasts().filter((item) => item.title === 'Entwurf verworfen');

describe('closing the dialog with content', () => {
  it('parks the draft once, also under StrictMode: taken back with mod+z, created, then nothing is left to bring back', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openCreate({ project_id: 'p_web' }));
    renderWithData(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: /Titel/ }), 'Export als CSV');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parkedToasts().map((item) => item.description)).toEqual(['Export als CSV']);

    // mod+z presses "Rückgängig" on the toast: the dialog comes back with the draft, and parks nothing on the way
    act(() => void undoLatest());
    const restored = await screen.findByRole('dialog', { name: 'Neues Item' });
    expect((await within(restored).findByRole<HTMLInputElement>('textbox', { name: /Titel/ })).value).toBe('Export als CSV');
    expect(parkedToasts()).toEqual([]);

    const before = webItems();
    await user.click(within(restored).getByRole('button', { name: /Anlegen/ }));
    await waitFor(() => expect(webItems()).toBe(before + 1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // created: no draft parked, mod+z cannot open the dialog with it again
    expect(parkedToasts()).toEqual([]);
    expect(canUndo()).toBe(false);
  });
});
