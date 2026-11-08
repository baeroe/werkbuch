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
    // the row dims the box with it, once: the box itself does not dim again
    expect(container.querySelector('label')?.className).toContain('opacity-50');
    expect(screen.getByRole('checkbox', { name: 'Alle' }).className).not.toContain('opacity-50');
  });

  it('dims a locked box without a label itself', () => {
    render(<Checkbox aria-label="Mail" disabled />);

    expect(screen.getByRole('checkbox', { name: 'Mail' }).className).toContain('data-disabled:opacity-50');
  });

  it('keeps its tab stop and says why when it is blocked by a reason, and changes neither by click nor by Space', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <>
        <Checkbox aria-label="Task verwenden" aria-describedby="note" defaultChecked disabledReason="Mindestens ein Typ bleibt aktiv." onCheckedChange={onCheckedChange} />
        <p id="note">Hinweis</p>
      </>,
    );
    const box = screen.getByRole('checkbox', { name: 'Task verwenden' });

    await user.tab();
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.hasAttribute('data-disabled')).toBe(false);
    // its own reason first, then what the caller describes it with
    const described = box.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(['Mindestens ein Typ bleibt aktiv.', 'Hinweis']);
    expect(box.className).toContain('opacity-50');
    await user.keyboard(' ');
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-checked')).toBe('true');

    // the reason goes: the same box, with the focus, switches again
    rerender(
      <>
        <Checkbox aria-label="Task verwenden" aria-describedby="note" defaultChecked disabledReason={null} onCheckedChange={onCheckedChange} />
        <p id="note">Hinweis</p>
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'Task verwenden' })).toBe(box);
    expect(box.getAttribute('aria-disabled')).toBeNull();
    expect(box.getAttribute('aria-describedby')).toBe('note');
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('dims the row of a box blocked by a reason', () => {
    const { container } = render(<Checkbox label="Alle" disabledReason="Gerade nicht." />);

    expect(container.querySelector('label')?.className).toContain('cursor-not-allowed');
    expect(container.querySelector('label')?.className).toContain('opacity-50');
  });

  it('is only the box without a label, with its larger hit area and the name of the caller', () => {
    const { container } = render(<Checkbox aria-label="Zeile wählen" />);

    expect(container.querySelector('label')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Zeile wählen' }).className).toContain('after:absolute');
  });
});
