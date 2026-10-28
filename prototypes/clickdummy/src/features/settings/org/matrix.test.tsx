/// <reference types="node" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listWorkflows } from '@/api/workflows';
import { agency } from '@/domain/fixtures';
import { registerShortcut } from '@/lib/shortcuts/registry';
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

/** The colour tokens as tokens.css writes them: "oklch(0.6 0.022 258)" as [L, C, h]. */
function oklchOf(css: string, name: string, occurrence = 0): [number, number, number] {
  const found = [...css.matchAll(new RegExp(`${name}:\\s*oklch\\(([^)]+)\\)`, 'g'))][occurrence];
  if (!found) throw new Error(`token ${name} not found`);
  const [lightness, chroma, hue] = found[1].split('/')[0].trim().split(/\s+/).map(Number);
  return [lightness, chroma, hue];
}

/** WCAG relative luminance of an OKLCH colour, through OKLab to linear sRGB. */
function luminance([lightness, chroma, hue]: [number, number, number]): number {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const [red, green, blue] = channels.map((value) => Math.min(1, Math.max(0, value)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

describe('TransitionMatrix for people who cannot rely on a mouse or good eyes', () => {
  it('leaves Ctrl+Enter and Ctrl+Space to the page, so the save shortcut is not swallowed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const save = vi.fn();
    const unregister = registerShortcut({ id: 'test.save', keys: 'mod+enter', scope: 'global', label: 'Speichern', group: 'Test', run: save });
    try {
      render(<Harness onChange={onChange} />);
      await user.tab();
      // Backlog → Todo is allowed
      await user.keyboard('{ArrowRight}');
      expect(checked('Backlog', 'Todo')).toBe('true');

      // the page's own shortcut runs, the cell stays as it is
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(save).toHaveBeenCalledTimes(1);
      // Ctrl+Space and Ctrl+arrows belong to the system: nothing is toggled or moved, and the key is not taken away
      expect(fireEvent.keyDown(cell('Backlog', 'Todo'), { key: ' ', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(cell('Backlog', 'Todo'), { key: 'ArrowRight', ctrlKey: true })).toBe(true);
      expect(document.activeElement).toBe(cell('Backlog', 'Todo'));
      expect(onChange).not.toHaveBeenCalled();
      expect(checked('Backlog', 'Todo')).toBe('true');

      // the plain keys still work, and Ctrl+End goes on to the last corner
      await user.keyboard(' ');
      expect(checked('Backlog', 'Todo')).toBe('false');
      await user.keyboard('{Control>}{End}{/Control}');
      expect(document.activeElement).toBe(cell('Cancelled', 'Cancelled'));
    } finally {
      unregister();
    }
  });

  it('draws an unchecked cell with a line that holds 3:1 against its ground, by day and by night (WCAG 1.4.11)', () => {
    render(<Harness onChange={() => {}} />);
    const classes = cell('Backlog', 'Review').className.split(/\s+/);
    expect(classes).toContain('border-line-input');
    expect(classes).not.toContain('border-line');

    // and the token behind that class really is strong enough, where the plain line is not (Vitest hands CSS files over
    // as empty text, so the tokens are read from disk)
    const tokens = readFileSync(resolve(import.meta.dirname, '../../../styles/tokens.css'), 'utf8');
    const day = { ground: oklchOf(tokens, '--day-surface'), input: oklchOf(tokens, '--line-input', 0), line: oklchOf(tokens, '--day-border') };
    const night = { ground: oklchOf(tokens, '--night-surface'), input: oklchOf(tokens, '--line-input', 1), line: oklchOf(tokens, '--night-border') };
    for (const theme of [day, night]) {
      expect(contrast(theme.input, theme.ground)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.line, theme.ground)).toBeLessThan(3);
    }
  });

  it('keeps a cell that takes the focus clear of the row headers, which stay at the left edge (WCAG 2.4.11)', async () => {
    const user = userEvent.setup();
    // jsdom has no layout: the row header is given a width, and the scroll container has to keep that much room
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.matches('tbody th[scope="row"]') ? 152 : 0;
    });
    // jsdom does not scroll either (and has no scrollIntoView): the cell an arrow key moves to has to be asked to scroll
    // fully into view, because focus() alone leaves a cell in place while a sliver of it shows
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<Harness onChange={() => {}} />);
      const scroller = screen.getByRole('grid').parentElement!;
      expect(scroller.style.getPropertyValue('--matrix-head')).toBe('160px');
      expect(scroller.className).toContain('scroll-pl-[var(--matrix-head)]');

      await user.tab();
      await user.keyboard('{ArrowRight}{ArrowDown}');
      expect(document.activeElement).toBe(cell('Todo', 'Todo'));
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      expect(scrolled).toEqual([cell('Backlog', 'Todo'), cell('Todo', 'Todo')]);
    } finally {
      width.mockRestore();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
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
