import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkItem, listWorkItems } from '@/api/workItems';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import ItemsRoute from '../routes';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/projects/:identifier', element: <ItemsRoute preset="project" /> },
      { path: '/views/:viewId', element: <ItemsRoute preset="view" /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

const column = (name: string) => screen.getByRole('region', { name });
const cardIn = (columnName: string, key: string) => within(column(columnName)).getByRole('article', { name: new RegExp(`^${key} `) });
/** A key on the focused element, as the shortcut registry hears it. */
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init }));
const lastToast = () => currentToasts().at(-1);

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
  currentToasts().forEach((entry) => dismissToast(entry.id));
  window.scrollTo = vi.fn();
});

describe('the board', () => {
  it('shows a column for every status of the workflow, empty ones included, with the cards in them', async () => {
    const router = renderAt('/projects/APP?layout=board');
    expect(await screen.findByRole('region', { name: 'Kundenfreigabe' })).toBeTruthy();
    for (const name of ['Backlog', 'Todo', 'In Progress', 'Review', 'Done', 'Cancelled']) expect(column(name)).toBeTruthy();
    expect(cardIn('Todo', 'APP-16')).toBeTruthy();
    expect(cardIn('Kundenfreigabe', 'APP-15')).toBeTruthy();
    router.dispose();
  });

  it('moves the card under the cursor to the next allowed column with ⇧→ and keeps the focus on it', async () => {
    const router = renderAt('/projects/APP?layout=board');
    await screen.findByRole('region', { name: 'Todo' });
    act(() => cardIn('Todo', 'APP-16').focus());

    press('ArrowRight', { shiftKey: true });
    await waitFor(async () => expect((await getWorkItem('APP-16')).item.state_id).toBe('app_progress'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-16')));
    router.dispose();
  });

  it('refuses ⇧← where the workflow allows no move and names the transition in a toast', async () => {
    const router = renderAt('/projects/APP?layout=board');
    await screen.findByRole('region', { name: 'Todo' });
    act(() => cardIn('Todo', 'APP-16').focus());

    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', description: 'Von „Todo“ nach „Backlog“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.' });
    expect((await getWorkItem('APP-16')).item.state_id).toBe('app_todo');
    expect(cardIn('Todo', 'APP-16')).toBe(document.activeElement);
    router.dispose();
  });

  it('asks for the resolution before a card moves into Done', async () => {
    const user = userEvent.setup();
    const router = renderAt('/projects/APP?layout=board');
    await screen.findByRole('region', { name: 'Kundenfreigabe' });
    act(() => cardIn('Kundenfreigabe', 'APP-15').focus());

    press('ArrowRight', { shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'APP-15 auf Done setzen' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: 'Done' })));
    await user.keyboard('{Enter}');

    await waitFor(async () => expect((await getWorkItem('APP-15')).item).toMatchObject({ state_id: 'app_done', resolution_id: 'res_done' }));
    router.dispose();
  });

  it('moves the cursor down a column with ↓ and into the next column with →', async () => {
    const router = renderAt('/projects/APP?layout=board');
    await screen.findByRole('region', { name: 'Todo' });
    const todo = within(column('Todo')).getAllByRole('article');
    expect(todo.length).toBeGreaterThan(1);
    act(() => todo[0].focus());

    press('ArrowDown');
    expect(document.activeElement).toBe(todo[1]);
    press('ArrowRight');
    expect(column('In Progress').contains(document.activeElement)).toBe(true);
    // one card is the tab stop
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
    router.dispose();
  });

  it('creates an item in the status of the column with its quick add', async () => {
    const router = renderAt('/projects/APP?layout=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    fireEvent.change(input, { target: { value: 'Testflug planen' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(async () => {
      const page = await listWorkItems({ filter: { version: 1, conditions: [{ field: 'title', op: 'contains', value: 'Testflug' }] } });
      expect(page.items[0]).toMatchObject({ project_id: 'p_app', state_id: 'app_todo', type_id: 't_task' });
    });
    expect(await within(column('Todo')).findByRole('article', { name: /Testflug planen/ })).toBeTruthy();
    router.dispose();
  });

  it('keeps an empty quick add open, says what is missing and puts the focus on the title', async () => {
    const router = renderAt('/projects/APP?layout=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Item in Todo anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Neues Item in Todo' });
    const send = screen.getByRole('button', { name: 'Anlegen' });
    act(() => send.focus());
    fireEvent.click(send);

    expect(await screen.findByText('Gib einen Titel ein.')).toBeTruthy();
    expect(document.activeElement).toBe(input);
    router.dispose();
  });

  it('offers no quick add in a status a new item may not start in, and says why', async () => {
    const router = renderAt('/projects/APP?layout=board');
    const add = await screen.findByRole('button', { name: 'Item in Done anlegen' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(add.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Neue Items starten in „Backlog“. Von dort nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.',
    );
    router.dispose();
  });

  it('keeps the cards of a viewer in place and says why', async () => {
    asUser('u_theo');
    const router = renderAt('/projects/WEB?layout=board');
    await screen.findByRole('region', { name: 'Todo' });
    act(() => cardIn('Todo', 'WEB-48').focus());

    press('ArrowRight', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.' });
    expect((await getWorkItem('WEB-48')).item.state_id).toBe('std_todo');
    router.dispose();
  });
});
