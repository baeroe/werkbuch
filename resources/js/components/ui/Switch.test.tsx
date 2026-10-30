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
