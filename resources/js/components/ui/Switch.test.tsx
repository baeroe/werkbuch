import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is switched by the space bar and reports the new state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch label="Benachrichtigungen" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: 'Benachrichtigungen' });

    await user.tab();
    expect(document.activeElement).toBe(control);
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(control.getAttribute('aria-checked')).toBe('true');

    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('is not switched by Enter, which sends the form around it, nor by Enter with a modifier, which sends nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const onKeyDown = vi.fn((_event: { key: string }) => {});
    const { container } = render(
      <form>
        <Switch label="Archiviert" onKeyDown={onKeyDown} />
      </form>,
    );
    container.querySelector('form')!.addEventListener('submit', onSubmit);
    const control = screen.getByRole('switch', { name: 'Archiviert' });

    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(control.getAttribute('aria-checked')).toBe('false');
    // the caller's own handler still runs, for other keys too
    await user.keyboard('a');
    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual(['Enter', 'Control', 'Enter', 'a']);
  });

  it('is not switched by Enter outside a form either', async () => {
    const user = userEvent.setup();
    render(<Switch label="Archiviert" />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('switch', { name: 'Archiviert' }).getAttribute('aria-checked')).toBe('false');
  });

  it('is switched by a click on its label, and keeps its own state without a handler', async () => {
    render(<Switch label="Benachrichtigungen" />);

    await userEvent.click(screen.getByText('Benachrichtigungen'));

    expect(screen.getByRole('switch', { name: 'Benachrichtigungen' }).getAttribute('aria-checked')).toBe('true');
  });

  it('does not switch when disabled, and its row looks disabled', async () => {
    const onCheckedChange = vi.fn();
    const { container } = render(<Switch label="Benachrichtigungen" disabled onCheckedChange={onCheckedChange} />);

    await userEvent.click(screen.getByText('Benachrichtigungen'));

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(container.querySelector('label')?.className).toContain('opacity-50');
  });

  it('is only the track without a label, with its larger hit area and the name of the caller', () => {
    const { container } = render(<Switch aria-label="Aktiv" />);

    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Aktiv' }).className).toContain('after:absolute');
  });
});
