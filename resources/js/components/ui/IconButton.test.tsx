import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('has its label as accessible name and a hidden icon', () => {
    render(<IconButton icon={Plus} label="Neues Item" />);

    const button = screen.getByRole('button', { name: 'Neues Item' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('svg.lucide-plus')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('carries the size and the variant', () => {
    render(
      <>
        <IconButton icon={Plus} label="Klein" size="sm" />
        <IconButton icon={Plus} label="Zweitrangig" variant="secondary" />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Klein' }).className).toContain('md:size-6');
    expect(screen.getByRole('button', { name: 'Zweitrangig' }).className).toContain('md:size-7');
    expect(screen.getByRole('button', { name: 'Zweitrangig' }).className).toContain('border-line');
    expect(screen.getByRole('button', { name: 'Klein' }).className).toContain('hover:bg-hover');
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Plus} label="Neues Item" onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Neues Item' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows its label and shortcut as a tooltip on focus', async () => {
    render(<IconButton icon={Plus} label="Neues Item" shortcut="c" />);

    await userEvent.tab();

    await waitFor(() => expect(screen.getByText('Neues Item', { selector: 'span' })).toBeTruthy());
    expect(document.querySelector('[data-side="top"] kbd[aria-label="C"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Neues Item' }).getAttribute('aria-keyshortcuts')).toBe('C');
  });

  it('without a tooltip it is just the button', async () => {
    render(<IconButton icon={Plus} label="Neues Item" tooltip={false} />);

    await userEvent.tab();

    expect(document.querySelector('[data-side]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Neues Item' })).toBeTruthy();
  });

  it('is disabled for real with disabled', async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Plus} label="Neues Item" disabled onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Neues Item' });
    await userEvent.click(button);

    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.className).toContain('cursor-not-allowed');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('with a disabledReason it stays focusable, ignores a click and names the reason as description and in the tooltip', async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Plus} label="Entfernen" disabledReason="Der Lead lässt sich nicht entfernen." onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Entfernen' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBe(button.querySelector('span[hidden]')?.id);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    await userEvent.tab();

    // the tooltip names the reason instead of the label, and without the shortcut
    await waitFor(() => expect(screen.getAllByText('Der Lead lässt sich nicht entfernen.').length).toBe(2));
  });

  it('with a disabledReason and no tooltip it still explains itself on focus', async () => {
    render(<IconButton icon={Plus} label="Entfernen" tooltip={false} shortcut="x" disabledReason="Gesperrt." />);

    await userEvent.tab();

    await waitFor(() => expect(screen.getAllByText('Gesperrt.').length).toBe(2));
    expect(document.querySelector('[data-side="top"] kbd')).toBeNull();
  });
});
