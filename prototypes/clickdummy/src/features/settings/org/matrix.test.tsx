import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listWorkflows } from '@/api/workflows';
import { agency } from '@/domain/fixtures';
import { resetApi } from '@/test/api';
import type { Transition } from '@/types';
import { TransitionMatrix } from './TransitionMatrix';
import { WorkflowEditor } from './WorkflowEditor';

beforeEach(() => {
  resetApi();
});

const has = (list: Transition[], from: string, to: string) => list.some(([a, b]) => a === from && b === to);
const lastChange = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as Transition[];

/** The cell "Von <from> nach <to>" of the grid, by the names the states have. */
const cell = (from: string, to: string) => screen.getByRole('checkbox', { name: `Von ${from} nach ${to}` });
const checked = (from: string, to: string) => cell(from, to).getAttribute('aria-checked');

/** A matrix that keeps its own transitions, as the editor does. */
function Harness({ onChange, readOnly }: { onChange: (next: Transition[]) => void; readOnly?: boolean }) {
  const [transitions, setTransitions] = useState<Transition[]>(agency.transitions);
  return (
    <TransitionMatrix
      states={agency.states}
      transitions={transitions}
      initialStateId={agency.initial_state_id}
      readOnly={readOnly}
      onChange={(next) => {
        setTransitions(next);
        onChange(next);
      }}
    />
  );
}

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('TransitionMatrix', () => {
  it('toggling a matrix cell with the keyboard (arrow keys + space) adds and removes the transition', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // the grid is one tab stop: Tab lands on its first cell and the arrows go on from there
    await user.tab();
    expect(document.activeElement).toBe(cell('Backlog', 'Backlog'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell('Backlog', 'Todo'));
    expect(checked('Backlog', 'Todo')).toBe('true');

    // Space takes the allowed transition Backlog → Todo away …
    await user.keyboard(' ');
    expect(checked('Backlog', 'Todo')).toBe('false');
    expect(has(lastChange(onChange), 'app_backlog', 'app_todo')).toBe(false);

    // … and puts it back
    await user.keyboard(' ');
    expect(checked('Backlog', 'Todo')).toBe('true');
    expect(has(lastChange(onChange), 'app_backlog', 'app_todo')).toBe(true);

    // Todo → Backlog is not allowed in the agency workflow: one row down, one column left, Space adds it
    await user.keyboard('{ArrowDown}{ArrowLeft}');
    expect(document.activeElement).toBe(cell('Todo', 'Backlog'));
    expect(checked('Todo', 'Backlog')).toBe('false');
    await user.keyboard(' ');
    expect(checked('Todo', 'Backlog')).toBe('true');
    expect(has(lastChange(onChange), 'app_todo', 'app_backlog')).toBe(true);

    // nothing else moved
    expect(lastChange(onChange)).toHaveLength(agency.transitions.length + 1);
  });

  it('stops the arrows at the edges and leaves the diagonal alone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.tab();
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(document.activeElement).toBe(cell('Backlog', 'Backlog'));

    // End and Home run along the row, a state never leads to itself
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cell('Backlog', 'Cancelled'));
    // the right edge and the bottom edge hold as well
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cell('Backlog', 'Cancelled'));
    await user.keyboard('{Control>}{End}{/Control}{ArrowDown}');
    expect(document.activeElement).toBe(cell('Cancelled', 'Cancelled'));
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(document.activeElement).toBe(cell('Backlog', 'Backlog'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cell('Backlog', 'Backlog'));
    expect(cell('Backlog', 'Backlog').getAttribute('aria-disabled')).toBe('true');
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();

    // Tab leaves the grid instead of walking through its 49 cells
    await user.tab();
    expect(screen.getByRole('grid').contains(document.activeElement)).toBe(false);
  });

  it('shows the transitions of a read-only matrix without changing them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} readOnly />);

    await user.click(cell('Backlog', 'Todo'));
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
    expect(checked('Backlog', 'Todo')).toBe('true');
    expect(cell('Backlog', 'Todo').getAttribute('aria-readonly')).toBe('true');
  });
});

describe('WorkflowEditor', () => {
  it('removing the last transition into Review shows "Review ist vom Startstatus aus nicht erreichbar"', async () => {
    const user = userEvent.setup();
    renderWithData(<WorkflowEditor workflowId="wf_agency" onClose={() => {}} />);

    const grid = await screen.findByRole('grid', { name: 'Erlaubte Übergänge' });
    // the saved workflow is sound, so there is nothing to report yet
    expect(screen.queryByText(/nicht erreichbar/)).toBeNull();

    // In Progress → Review is the only way into Review
    const toReview = within(grid).getByRole('checkbox', { name: 'Von In Progress nach Review' });
    expect(toReview.getAttribute('aria-checked')).toBe('true');
    act(() => toReview.focus());
    await user.keyboard(' ');

    expect(await screen.findByText('Review ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    // what only Review leads to cannot be reached any more either
    expect(screen.getByText('Kundenfreigabe ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    expect(screen.getByText('Done ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    // the button stays available (a form can always be sent to see what is wrong): a click sends nothing and takes the
    // focus to the list of problems
    const save = screen.getByRole('button', { name: /^Speichern/ });
    expect(save.getAttribute('aria-disabled')).toBeNull();
    await user.click(save);
    expect(screen.getByText('Review ist vom Startstatus aus nicht erreichbar').closest('[tabindex="-1"]')).toBe(document.activeElement);
    expect((await listWorkflows()).items.find((workflow) => workflow.id === 'wf_agency')!.transitions).toContainEqual(['app_progress', 'app_review']);
  });
});
