/*
 * The one dialog for states with items (R26), on its own: the rows with their counts and proposals, the effects, the
 * held confirmation and the refusals the server marks at the rows. How the project switch and the workflow editor use
 * it runs in project.test.tsx and workflows.test.tsx, the flows with the keyboard in e2e/tests/state-mapping.spec.ts.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { isMac } from '@/lib/platform';
import { agency, standard } from '@/test/fixtures';
import type { StateUsage } from '@/types';
import { markedPaths, refusedStates, StateMappingDialog, type MappingField } from './StateMappingDialog';

const describedBy = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby')!)?.textContent;
const choice = (name: string) => screen.getByRole('combobox', { name: `Neuer Status für „${name}“` });
const sendWithShortcut = () =>
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...(isMac() ? { metaKey: true } : { ctrlKey: true }) }));
  });

function Harness({ usage, refusal, field = 'mapping', onConfirm = vi.fn(), pending = false }: { usage: StateUsage[]; refusal?: unknown; field?: MappingField; onConfirm?: (mapping: Record<string, string>) => void; pending?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <StateMappingDialog
      open={open}
      onClose={() => setOpen(false)}
      title="Zu „Agentur-Freigabe“ wechseln"
      description="Ordne jedem Status mit Items einen neuen zu."
      submitLabel="Workflow wechseln"
      usage={usage}
      from={standard.states}
      to={agency.states}
      field={field}
      pending={pending}
      refusal={refusal}
      onConfirm={onConfirm}
    />
  );
}

const used: StateUsage[] = [
  { state_id: 'std_done', items: 1 },
  { state_id: 'std_todo', items: 2 },
  { state_id: 'std_pending', items: 4 },
  { state_id: 'std_backlog', items: 0 },
];

describe('StateMappingDialog', () => {
  it('lists every state in use with its items', async () => {
    render(<Harness usage={used} />);

    const dialog = await screen.findByRole('dialog', { name: 'Zu „Agentur-Freigabe“ wechseln' });
    const rows = within(within(dialog).getByRole('list', { name: 'Status mit Items' })).getAllByRole('listitem');
    // in the order of the old workflow, without the state that has no items
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('Todo2 Items'), expect.stringContaining('Pending4 Items'), expect.stringContaining('Done1 Item')]);
  });

  it('proposes a state of the same name or category', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness usage={used} onConfirm={onConfirm} />);
    await screen.findByRole('dialog');

    // Todo and Done have namesakes, Pending none: the first state of the category Started takes it
    expect(choice('Todo').textContent).toContain('Todo');
    expect(choice('Pending').textContent).toContain('In Progress');
    expect(choice('Done').textContent).toContain('Done');
    await user.click(screen.getByRole('button', { name: /^Workflow wechseln/ }));
    expect(onConfirm).toHaveBeenCalledWith({ std_todo: 'app_todo', std_pending: 'app_progress', std_done: 'app_done' });
  });

  it('holds the confirmation until every row has a target', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    // Review has no namesake and no state of its category in the standard workflow
    render(
      <StateMappingDialog
        open
        onClose={() => {}}
        title="Status ersetzen"
        description="Wähle, welcher Status sie übernimmt."
        submitLabel="Ersetzen und speichern"
        usage={[
          { state_id: 'app_review', items: 3 },
          { state_id: 'app_done', items: 1 },
        ]}
        from={agency.states}
        to={standard.states.filter((state) => state.category !== 'started')}
        field="state_mapping"
        onConfirm={onConfirm}
      />,
    );

    const confirm = (await screen.findByRole('dialog')).querySelector<HTMLElement>('button[type="submit"]')!;
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(confirm)).toBe('Wähle einen neuen Status für „Review“.');
    expect(choice('Review').textContent).toContain('Status wählen …');
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    // ⌘↵ goes past the button: the missing choice takes the focus instead
    choice('Done').focus();
    sendWithShortcut();
    await waitFor(() => expect(document.activeElement).toBe(choice('Review')));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(choice('Review'));
    await user.click(await screen.findByRole('option', { name: 'Todo' }));
    await waitFor(() => expect(confirm.getAttribute('aria-disabled')).toBeNull());
    // a review that lands in Todo stays open: nothing else happens to it
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ app_review: 'std_todo', app_done: 'std_done' });
  });

  it('says what the mapping does to the items', async () => {
    const user = userEvent.setup();
    render(<Harness usage={[{ state_id: 'std_done', items: 2 }, { state_id: 'std_todo', items: 1 }, { state_id: 'std_cancelled', items: 3 }]} />);
    await screen.findByRole('dialog');
    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await user.click(choice('Done'));
    await user.click(await screen.findByRole('option', { name: 'Review' }));
    await user.click(choice('Todo'));
    await user.click(await screen.findByRole('option', { name: 'Cancelled' }));
    await user.click(choice('Cancelled'));
    await user.click(await screen.findByRole('option', { name: 'Done' }));

    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(3));
    expect(screen.getAllByRole('status').map((banner) => banner.textContent)).toEqual([
      '2 geschlossene Items werden wieder geöffnet.Sie verlieren ihre Resolution.',
      '1 offenes Item gilt danach als geschlossen.Es bekommt die Standard-Resolution seiner Kategorie.',
      '3 geschlossene Items wechseln zwischen Completed und Canceled.Sie bekommen die Standard-Resolution der neuen Kategorie.',
    ]);
  });

  it('marks the row of a 422', async () => {
    const user = userEvent.setup();
    const refusal = new ApiError({
      status: 422,
      reason: 'validation_failed',
      errors: { 'mapping.std_pending': ['Diesen Status gibt es im neuen Workflow nicht.'], workflow_id: ['Diesen Workflow gibt es nicht.'] },
    });
    const { rerender } = render(<Harness usage={used} pending />);
    await screen.findByRole('dialog');
    rerender(<Harness usage={used} refusal={refusal} />);

    const pending = choice('Pending');
    expect(pending.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(pending)).toBe('Diesen Status gibt es im neuen Workflow nicht.');
    expect(choice('Todo').hasAttribute('aria-invalid')).toBe(false);
    // the refused row takes the focus once the call is over
    await waitFor(() => expect(document.activeElement).toBe(pending));
    expect(markedPaths(refusal, 'mapping')).toEqual(['mapping.std_pending']);
    expect(markedPaths(refusal, 'state_mapping')).toEqual([]);

    // a new choice answers the mark
    await user.click(pending);
    await user.click(await screen.findByRole('option', { name: 'Review' }));
    await waitFor(() => expect(choice('Pending').hasAttribute('aria-invalid')).toBe(false));
  });

  it('marks the rows of states that got items meanwhile (409 `state_in_use`)', async () => {
    const refusal = new ApiError({ status: 409, reason: 'state_in_use', extensions: { states: [{ state_id: 'std_progress', name: 'In Progress', items: 2 }] } });
    expect(refusedStates(refusal)).toEqual([{ state_id: 'std_progress', items: 2 }]);
    render(<Harness usage={[...used, { state_id: 'std_progress', items: 2 }]} refusal={refusal} field="state_mapping" />);
    await screen.findByRole('dialog');

    expect(describedBy(choice('In Progress'))).toBe('Hier liegen inzwischen Items. Wähle, welcher Status sie übernimmt.');
    expect(choice('Todo').hasAttribute('aria-invalid')).toBe(false);
    // nothing to name in other refusals
    expect(refusedStates(new Error('offline'))).toEqual([]);
    expect(refusedStates(new ApiError({ status: 409, reason: 'state_in_use' }))).toEqual([]);
  });

  it('is a plain confirmation without states in use, and closes on "Abbrechen"', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness usage={[]} onConfirm={onConfirm} />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('list')).toBeNull();
    expect(within(dialog).getByText('Ordne jedem Status mit Items einen neuen zu.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /^Workflow wechseln/ }));
    expect(onConfirm).toHaveBeenCalledWith({});
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
