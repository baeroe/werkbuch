import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listWorkflows } from '@/api/workflows';
import { getWorkItem } from '@/api/workItems';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import Workflows from './Workflows';
import { WorkflowEditor } from './WorkflowEditor';

beforeEach(() => {
  resetApi();
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode, path = '/settings/workflows') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The text of a toast with the non-breaking spaces of counts read as plain spaces. */
const plain = (text: string | undefined) => (text ?? '').replaceAll('\u00a0', ' ');
const stored = async (id: string) => (await listWorkflows()).items.find((workflow) => workflow.id === id)!;
const save = () => screen.getByRole('button', { name: /^Speichern/ });

describe('the status of a workflow', () => {
  it('asks which status takes over the items of a deleted status, then saves with that choice', async () => {
    const user = userEvent.setup();
    renderWithData(<WorkflowEditor workflowId="wf_standard" onClose={() => {}} />);

    // WEB-45 is the one item in Pending
    await user.click(await screen.findByRole('button', { name: 'Pending entfernen' }));
    await user.click(save());

    const dialog = await screen.findByRole('dialog', { name: 'Status ersetzen' });
    expect(within(dialog).getByText('1 Item in Started')).toBeTruthy();
    // a status of the same category is suggested
    expect(within(dialog).getByRole('combobox', { name: /Neuer Status für „Pending“/ }).textContent).toContain('In Progress');
    // nothing happened to the workflow before the answer
    expect((await stored('wf_standard')).states.map((state) => state.name)).toContain('Pending');

    await user.click(within(dialog).getByRole('button', { name: /^Ersetzen und speichern/ }));
    await waitFor(async () => expect((await stored('wf_standard')).states.map((state) => state.name)).not.toContain('Pending'));
    expect((await getWorkItem('WEB-45')).item.state_id).toBe('std_progress');
    expect(currentToasts().some((item) => item.title === 'Workflow „Standard“ gespeichert' && /1 Item hat einen neuen Status/.test(plain(item.description)))).toBe(true);
  });

  it('keeps the start status from being deleted and says what to do first', async () => {
    renderWithData(<WorkflowEditor workflowId="wf_standard" onClose={() => {}} />);

    const remove = await screen.findByRole('button', { name: 'Backlog entfernen' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(remove.getAttribute('aria-describedby')!)?.textContent).toMatch(/Startstatus.*anderen/);
  });

  it('flags a new status as unreachable until a transition leads into it', async () => {
    const user = userEvent.setup();
    renderWithData(<WorkflowEditor workflowId="wf_agency" onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Status hinzufügen' }));
    // the new status takes the focus, so its name can be typed at once
    const name = screen.getByRole('textbox', { name: 'Name von Status 8' });
    expect(document.activeElement).toBe(name);
    await user.type(name, 'QA');
    expect(await screen.findByText('QA ist vom Startstatus aus nicht erreichbar')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Von In Progress nach QA' }));
    expect(screen.queryByText(/nicht erreichbar/)).toBeNull();
    expect(screen.getByText('Der Workflow ist gültig')).toBeTruthy();

    await user.click(save());
    await waitFor(async () => expect((await stored('wf_agency')).states.map((state) => state.name)).toContain('QA'));
    // the new status kept its id, so the transition into it was saved with it
    const agency = await stored('wf_agency');
    const qa = agency.states.find((state) => state.name === 'QA')!;
    expect(agency.transitions).toContainEqual(['app_progress', qa.id]);
  });

  it('starts a matrix with everything allowed when a free workflow gets one', async () => {
    const user = userEvent.setup();
    renderWithData(<WorkflowEditor workflowId="wf_standard" onClose={() => {}} />);

    expect(await screen.findByText(/Der Workflow ist frei/)).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();

    await user.click(screen.getByRole('switch', { name: /^Frei/ }));
    const grid = await screen.findByRole('grid', { name: 'Erlaubte Übergänge' });
    // six statuses: every one may lead to the five others
    expect(within(grid).getAllByRole('checkbox').filter((cell) => cell.getAttribute('aria-checked') === 'true')).toHaveLength(30);
    expect(screen.getByText('Der Workflow ist gültig')).toBeTruthy();
  });
});

describe('saving a workflow', () => {
  it('saves a new workflow from the standard statuses and reports its id', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithData(<WorkflowEditor workflowId={null} onClose={() => {}} onSaved={onSaved} />);

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Wartung');
    await user.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const saved = (await listWorkflows()).items.find((workflow) => workflow.name === 'Wartung')!;
    expect(onSaved).toHaveBeenCalledWith(saved.id);
    expect(saved.states.map((state) => state.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled']);
    expect(saved.initial_state_id).toBe(saved.states[0].id);
    expect(saved.is_default).toBe(false);
  });

  it('refuses a name that exists, next to the name field', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithData(<WorkflowEditor workflowId={null} onClose={() => {}} onSaved={onSaved} />);

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Standard');
    await user.click(save());

    expect(await screen.findByText('Diesen Namen gibt es schon.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks for a name before anything is sent', async () => {
    const user = userEvent.setup();
    renderWithData(<WorkflowEditor workflowId={null} onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /^Speichern/ }));
    expect(await screen.findByText('Gib dem Workflow einen Namen.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
    expect((await listWorkflows()).items).toHaveLength(2);
  });
});

describe('the list of workflows', () => {
  it('keeps the default workflow and one that a project uses from being deleted, and says why', async () => {
    renderWithData(<Workflows readOnlyReason={null} />);

    const standard = await screen.findByRole('button', { name: /^Löschen Standard/ });
    expect(standard.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(standard.getAttribute('aria-describedby')!)?.textContent).toMatch(/Standard-Workflow lässt sich nie löschen/);

    const agency = screen.getByRole('button', { name: /^Löschen Agentur-Freigabe/ });
    expect(agency.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(agency.getAttribute('aria-describedby')!)?.textContent).toMatch(/APP benutzt ihn noch/);
    // each card names the projects that use it
    expect(within(screen.getByRole('article', { name: 'Standard' })).getByText(/WEB/)).toBeTruthy();
  });

  it('opens a copy of a workflow with new status ids, ready to be named and saved', async () => {
    const user = userEvent.setup();
    renderWithData(<Workflows readOnlyReason={null} />, '/settings/workflows?workflow=new&from=wf_agency');

    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Name' });
    expect(name.value).toBe('Agentur-Freigabe (Kopie)');
    expect(screen.getByRole('switch', { name: 'Standard-Workflow' }).getAttribute('aria-checked')).toBe('false');

    await user.click(save());
    await waitFor(async () => expect((await listWorkflows()).items).toHaveLength(3));
    const copy = (await listWorkflows()).items.find((workflow) => workflow.name === 'Agentur-Freigabe (Kopie)')!;
    const original = await stored('wf_agency');
    expect(copy.transitions).toHaveLength(original.transitions.length);
    // a workflow of its own: none of its status ids is the original's
    expect(copy.states.some((state) => original.states.some((other) => other.id === state.id))).toBe(false);
    expect(copy.states.map((state) => state.name)).toEqual(original.states.map((state) => state.name));
    expect(copy.initial_state_id).toBe(copy.states[0].id);
  });
});

describe('leaving the editor with unsaved changes', () => {
  /** The workflows section behind a data router, as the app has it, so that leaving can be stopped. */
  function renderRouted(path: string) {
    const router = createMemoryRouter([{ path: '/settings/:section?', element: <Workflows readOnlyReason={null} /> }], { initialEntries: [path] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  it('asks before a navigation throws an edited workflow away, and goes on once told to', async () => {
    const user = userEvent.setup();
    const router = renderRouted('/settings/workflows?workflow=wf_standard');

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    act(() => void router.navigate('/settings/people'));
    expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/settings/workflows');

    await user.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
    expect(router.state.location.pathname).toBe('/settings/workflows');
    // the edit is still there
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Standard neu');

    act(() => void router.navigate('/settings/people'));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/people'));
  });

  it('lets a clean editor go without a question, through the link back', async () => {
    const user = userEvent.setup();
    const router = renderRouted('/settings/workflows?workflow=wf_standard');

    await user.click(await screen.findByRole('link', { name: 'Alle Workflows' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not ask after a save, which moves a new workflow to its own address', async () => {
    const user = userEvent.setup();
    const router = renderRouted('/settings/workflows?workflow=new');

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Wartung');
    await user.click(save());

    await waitFor(() => expect(router.state.location.search).toMatch(/^\?workflow=wf_/));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((await listWorkflows()).items.some((workflow) => workflow.name === 'Wartung')).toBe(true);
  });
});
