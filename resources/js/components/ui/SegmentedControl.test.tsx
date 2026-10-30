import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Columns3, List } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';

const OPTIONS: SegmentOption<'list' | 'board' | 'timeline'>[] = [
  { value: 'list', label: 'Liste', icon: List, shortcut: '1' },
  { value: 'board', label: 'Board', icon: Columns3, shortcut: '2' },
  { value: 'timeline', label: 'Zeitleiste', disabled: true },
];

describe('SegmentedControl', () => {
  it('names the group, marks the chosen segment and shows the shortcut as a hint', () => {
    render(<SegmentedControl label="Ansicht" value="list" onValueChange={() => {}} options={OPTIONS} />);

    expect(screen.getByRole('group', { name: 'Ansicht' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Liste/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Board/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /Board/ }).getAttribute('aria-keyshortcuts')).toBe('2');
    expect(screen.getByRole('button', { name: /Board/ }).textContent).toBe('Board2');
  });

  it('the arrow keys move between the segments, Space chooses and onValueChange reports it', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<SegmentedControl label="Ansicht" value="list" onValueChange={onValueChange} options={OPTIONS} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Liste/ }));

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Board/ }));
    await user.keyboard(' ');

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('board');
  });

  it('keeps one segment chosen: pressing the chosen one again reports nothing, a disabled one cannot be chosen', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<SegmentedControl label="Ansicht" value="list" onValueChange={onValueChange} options={OPTIONS} />);

    await user.click(screen.getByRole('button', { name: /Liste/ }));
    await user.click(screen.getByRole('button', { name: /Zeitleiste/ }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('with only icons the labels are the accessible names and the shortcut hint is left out', () => {
    render(<SegmentedControl label="Ansicht" value="board" onValueChange={() => {}} options={OPTIONS} iconOnly size="sm" className="ml-2" />);

    const board = screen.getByRole('button', { name: 'Board' });
    expect(board.textContent).toBe('');
    expect(board.className).toContain('md:w-6');
    expect(screen.getByRole('group', { name: 'Ansicht' }).className).toContain('ml-2');
  });

  it('with only icons in the md size the segments are 32 px wide on desktop', () => {
    render(<SegmentedControl label="Ansicht" value="board" onValueChange={() => {}} options={OPTIONS} iconOnly />);

    expect(screen.getByRole('button', { name: 'Board' }).className).toContain('md:w-8');
  });

  it('the small size uses the small text', () => {
    render(<SegmentedControl label="Ansicht" value="list" onValueChange={() => {}} options={OPTIONS} size="sm" />);

    expect(screen.getByRole('button', { name: /Liste/ }).className).toContain('text-sm');
  });
});
