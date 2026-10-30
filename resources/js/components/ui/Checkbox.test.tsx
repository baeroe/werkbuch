import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is switched by the space bar and reports the new state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Archivierte zeigen" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Archivierte zeigen' });

    await user.tab();
    expect(document.activeElement).toBe(box);
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(box.getAttribute('aria-checked')).toBe('true');

    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    expect(box.getAttribute('aria-checked')).toBe('false');
  });

  it('is switched by a click on its label, and keeps its own state without a handler', async () => {
    render(<Checkbox label="Archivierte zeigen" />);

    await userEvent.click(screen.getByText('Archivierte zeigen'));

    expect(screen.getByRole('checkbox', { name: 'Archivierte zeigen' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows a tick when checked', () => {
    const { container } = render(<Checkbox label="Alle" defaultChecked />);

    expect(container.querySelector('svg.lucide-check')).not.toBeNull();
    expect(container.querySelector('svg.lucide-minus')).toBeNull();
  });

  it('shows a dash and is "mixed" when indeterminate', () => {
    const { container } = render(<Checkbox label="Alle" indeterminate />);

    expect(screen.getByRole('checkbox', { name: 'Alle' }).getAttribute('aria-checked')).toBe('mixed');
    expect(container.querySelector('svg.lucide-minus')).not.toBeNull();
    expect(container.querySelector('svg.lucide-check')).toBeNull();
  });

  it('does not switch when disabled, and its row looks disabled', async () => {
    const onCheckedChange = vi.fn();
    const { container } = render(<Checkbox label="Alle" disabled onCheckedChange={onCheckedChange} />);

    await userEvent.click(screen.getByText('Alle'));

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(container.querySelector('label')?.className).toContain('cursor-not-allowed');
  });

  it('is only the box without a label, with its larger hit area and the name of the caller', () => {
    const { container } = render(<Checkbox aria-label="Zeile wählen" />);

    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Zeile wählen' }).className).toContain('after:absolute');
  });
});
