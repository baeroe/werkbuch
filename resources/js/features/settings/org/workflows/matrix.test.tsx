/*
 * The transition matrix (port of the clickdummy's matrix.test.tsx): the keyboard in the grid, the diagonal, the read-only
 * matrix, and the three rules for people who cannot rely on a mouse or good eyes. Flow 7 in the editor is in
 * workflows.test.tsx.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import tokens from '../../../../../css/tokens.css?raw';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { agency } from '@/test/fixtures';
import type { State, Transition } from '@/types';
import { TransitionMatrix } from './TransitionMatrix';

afterEach(() => {
  vi.restoreAllMocks();
});

const has = (list: Transition[], from: string, to: string) => list.some(([a, b]) => a === from && b === to);
const lastChange = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0] as Transition[];

/** The cell "Von <from> nach <to>" of the grid, by the names the states have. */
const cell = (from: string, to: string) => screen.getByRole('checkbox', { name: `Von ${from} nach ${to}` });
const checked = (from: string, to: string) => cell(from, to).getAttribute('aria-checked');

/** A matrix that keeps its own transitions, as the editor does. */
function Harness({ onChange, readOnly, states = agency.states, unreachable }: { onChange: (next: Transition[]) => void; readOnly?: boolean; states?: State[]; unreachable?: ReadonlySet<string> }) {
  const [transitions, setTransitions] = useState<Transition[]>(agency.transitions);
  return (
    <TransitionMatrix
      states={states}
      transitions={transitions}
      initialStateId={agency.initial_state_id}
      readOnly={readOnly}
      unreachable={unreachable}
      onChange={(next) => {
        setTransitions(next);
        onChange(next);
      }}
    />
  );
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

    // … and Enter puts it back
    await user.keyboard('{Enter}');
    expect(checked('Backlog', 'Todo')).toBe('true');
    expect(has(lastChange(onChange), 'app_backlog', 'app_todo')).toBe(true);

    // Todo → Backlog is not allowed in the agency workflow: one row down, one column left, Space adds it
    await user.keyboard('{ArrowDown}{ArrowLeft}');
    expect(document.activeElement).toBe(cell('Todo', 'Backlog'));
    expect(checked('Todo', 'Backlog')).toBe('false');
    await user.keyboard(' ');
    expect(checked('Todo', 'Backlog')).toBe('true');
    expect(has(lastChange(onChange), 'app_todo', 'app_backlog')).toBe(true);

    // and up again; nothing else moved
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(cell('Backlog', 'Backlog'));
    expect(lastChange(onChange)).toHaveLength(agency.transitions.length + 1);
  });

  it('toggles a cell under the pointer and leaves other keys alone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(cell('Review', 'Done'));
    expect(checked('Review', 'Done')).toBe('true');
    expect(document.activeElement).toBe(cell('Review', 'Done'));
    // the row and column under the pointer stand out in the headers until it leaves the grid
    await user.hover(cell('Todo', 'Review'));
    expect(screen.getByRole('rowheader', { name: /^Todo/ }).firstElementChild!.className).toContain('font-semibold');
    await user.unhover(screen.getByRole('grid'));
    // a letter is no key of the grid: it is not taken from the page
    expect(fireEvent.keyDown(cell('Review', 'Done'), { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(cell('Review', 'Done'), { key: 'ArrowRight', altKey: true })).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole('grid').getAttribute('aria-readonly')).toBe('true');
  });

  it('marks the start and the rows the start cannot reach, and names a state without a name', () => {
    const states = agency.states.map((state) => (state.id === 'app_review' ? { ...state, name: ' ' } : state));
    render(<Harness onChange={() => {}} states={states} unreachable={new Set(['app_approval'])} />);

    expect(within(screen.getByRole('rowheader', { name: /^Backlog/ })).getByText('Start')).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: /^Kundenfreigabe/ }).textContent).toContain('Vom Startstatus aus nicht erreichbar');
    expect(screen.getByRole('rowheader', { name: /^Todo/ }).textContent).not.toContain('nicht erreichbar');
    expect(cell('In Progress', 'Unbenannter Status')).toBeTruthy();
  });

  it('draws nothing without states', () => {
    const { container } = render(<Harness onChange={() => {}} states={[]} />);

    expect(container.innerHTML).toBe('');
  });

  it('keeps the tab stop inside the grid when the states get fewer', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness onChange={() => {}} />);
    await user.tab();
    await user.keyboard('{Control>}{End}{/Control}');
    expect(document.activeElement).toBe(cell('Cancelled', 'Cancelled'));

    rerender(<Harness onChange={() => {}} states={agency.states.slice(0, 3)} />);
    expect(cell('In Progress', 'In Progress').getAttribute('tabindex')).toBe('0');
  });
});

/** The colour tokens as tokens.css writes them: "oklch(0.6 0.022 258)" as [L, C, h]. */
function oklchOf(css: string, name: string, occurrence = 0): [number, number, number] {
  const found = [...css.matchAll(new RegExp(`${name}:\\s*oklch\\(([^)]+)\\)`, 'g'))][occurrence];
  if (!found) throw new Error(`token ${name} not found`);
  const [lightness, chroma, hue] = found[1]!.split('/')[0]!.trim().split(/\s+/).map(Number);
  return [lightness!, chroma!, hue!];
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
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
};

describe('TransitionMatrix for people who cannot rely on a mouse or good eyes', () => {
  it('leaves Ctrl+Enter and Ctrl+Space to the page, so the save shortcut is not swallowed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const save = vi.fn();
    const unregister = registerShortcut({ id: 'test.save', keys: 'mod+enter', scope: 'global', label: 'shortcuts.settings.save', group: 'shortcuts.group.settings', run: save });
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
      expect(fireEvent.keyDown(cell('Backlog', 'Todo'), { key: 'Enter', metaKey: true })).toBe(true);
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

    // and the token behind that class really is strong enough, where the plain line is not (read as text with `?raw`)
    const day = { ground: oklchOf(tokens, '--day-surface'), input: oklchOf(tokens, '--line-input', 0), line: oklchOf(tokens, '--day-border') };
    const night = { ground: oklchOf(tokens, '--night-surface'), input: oklchOf(tokens, '--line-input', 1), line: oklchOf(tokens, '--night-border') };
    for (const theme of [day, night]) {
      expect(contrast(theme.input, theme.ground)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.line, theme.ground)).toBeLessThan(3);
    }
  });

  it('keeps a cell that takes the focus clear of the row headers on the left and the edge on the right (WCAG 2.4.11)', async () => {
    const user = userEvent.setup();
    // jsdom has no layout: the row header is given a width, and the scroll container has to keep that much room
    let width = 152;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.matches('tbody th[scope="row"]') ? width : 0;
    });
    // and no ResizeObserver: a stand-in that reports when the header changes size
    const observed: { callback: () => void; disconnected: boolean }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { callback: () => void; disconnected: boolean };
        constructor(callback: () => void) {
          this.entry = { callback, disconnected: false };
          observed.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    // jsdom does not scroll either (and has no scrollIntoView): the cell an arrow key moves to has to be asked to scroll
    // fully into view, because focus() alone leaves a cell in place while a sliver of it shows
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    try {
      const { unmount } = render(<Harness onChange={() => {}} />);
      const scroller = screen.getByRole('grid').parentElement!;
      expect(scroller.style.getPropertyValue('--matrix-head')).toBe('160px');
      expect(scroller.className).toContain('scroll-pl-[var(--matrix-head)]');
      // the focus ring of the last column keeps its room on the right
      expect(scroller.className).toContain('scroll-pr-2');

      width = 200;
      observed[0]!.callback();
      expect(scroller.style.getPropertyValue('--matrix-head')).toBe('208px');

      await user.tab();
      await user.keyboard('{ArrowRight}{ArrowDown}');
      expect(document.activeElement).toBe(cell('Todo', 'Todo'));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      expect(scrolled).toEqual([cell('Backlog', 'Todo'), cell('Todo', 'Todo')]);

      unmount();
      expect(observed.every((entry) => entry.disconnected)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('measures the room again only when the states change, not on every render', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    const states = agency.states;
    const { rerender } = render(<TransitionMatrix states={states} transitions={[]} onChange={() => {}} />);
    const reads = spy.mock.calls.length;

    rerender(<TransitionMatrix states={states} transitions={[['app_backlog', 'app_todo']]} onChange={() => {}} />);
    expect(spy.mock.calls.length).toBe(reads);
    rerender(<TransitionMatrix states={states.slice(0, 4)} transitions={[]} onChange={() => {}} />);
    expect(spy.mock.calls.length).toBeGreaterThan(reads);
  });
});
