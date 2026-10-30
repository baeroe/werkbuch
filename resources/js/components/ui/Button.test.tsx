import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonClass, type ButtonSize, type ButtonVariant } from './Button';

describe('Button', () => {
  it.each<[ButtonVariant, string]>([
    ['primary', 'bg-accent'],
    ['secondary', 'border-line-strong'],
    ['ghost', 'hover:bg-hover'],
    ['danger', 'bg-danger'],
  ])('the %s variant carries its look', (variant, look) => {
    render(<Button variant={variant}>Speichern</Button>);

    expect(screen.getByRole('button', { name: 'Speichern' }).className).toContain(look);
  });

  it.each<[ButtonSize, string, string]>([
    ['md', 'h-11', 'md:h-8'],
    ['sm', 'h-11', 'md:h-7'],
  ])('the %s size has a 44 px touch target and its desktop height', (size, phone, desktop) => {
    render(
      <Button variant="primary" size={size}>
        Speichern
      </Button>,
    );

    const { className } = screen.getByRole('button', { name: 'Speichern' });
    expect(className).toContain(phone);
    expect(className).toContain(desktop);
  });

  it('is a plain button unless told otherwise and passes its own props on', () => {
    render(
      <Button variant="primary" className="mt-4" data-x="1">
        Speichern
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Speichern' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('mt-4');
    expect(button.getAttribute('data-x')).toBe('1');
  });

  it('shows its icon to the left of the text, hidden from screen readers', () => {
    render(
      <Button variant="secondary" icon={X}>
        Entfernen
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Entfernen' });
    const icon = button.querySelector('svg.lucide-x');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(button.firstElementChild).toBe(icon);
    expect(icon?.getAttribute('class')).toContain('text-muted');
  });

  it('shows a spinner instead of its icon while it is pending', () => {
    render(
      <Button variant="primary" icon={X} pending>
        Speichern
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Speichern' });
    expect(button.querySelector('svg.lucide-x')).toBeNull();
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    expect(button.className).toContain('cursor-progress');
  });

  it('shows its shortcut as Kbd, named in aria-keyshortcuts, and makes room for it', () => {
    render(
      <>
        <Button variant="primary" shortcut="mod+k">
          Suchen
        </Button>
        <Button variant="primary" size="sm" shortcut="c">
          Neu
        </Button>
      </>,
    );

    const search = screen.getByRole('button', { name: /Suchen/ });
    // the Kbd is part of the button, not of its name
    expect(search.getAttribute('aria-keyshortcuts')).toBe('Control+K');
    expect(search.querySelector('kbd[aria-label="Steuerung K"]')).not.toBeNull();
    expect(search.querySelector('kbd[aria-hidden="true"]')).not.toBeNull();
    expect(search.className).toContain('pr-2');
    expect(screen.getByRole('button', { name: /Neu/ }).className).toContain('pr-1.5');
  });

  it('is disabled for real with disabled, and then needs no reason', () => {
    render(
      <Button variant="primary" disabled disabledReason="Egal">
        Speichern
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Speichern' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.className).toContain('cursor-not-allowed');
    expect(button.className).toContain('opacity-50');
  });

  it('with a disabledReason it stays focusable, is aria-disabled, ignores a click and gives the reason as its description', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" disabledReason="Erst speichern." onClick={onClick}>
        Veröffentlichen
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Veröffentlichen' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(button.getAttribute('aria-describedby')).toBe(button.querySelector('span[hidden]')?.id);
    expect(button.querySelector('span[hidden]')?.textContent).toBe('Erst speichern.');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows the reason in a tooltip when the blocked button gets the focus', async () => {
    const user = userEvent.setup();
    render(
      <Button variant="primary" disabledReason="Erst speichern.">
        Veröffentlichen
      </Button>,
    );

    await user.tab();

    await waitFor(() => expect(screen.getAllByText('Erst speichern.').length).toBe(2));
    // the second one is the tooltip, the first the hidden description
    expect(document.querySelector('[data-side="top"]')?.textContent).toContain('Erst speichern.');
  });

  it('offers no tooltip while the reason is null', async () => {
    const user = userEvent.setup();
    render(
      <Button variant="primary" disabledReason={null}>
        Veröffentlichen
      </Button>,
    );

    await user.tab();

    expect(document.querySelector('[data-side]')).toBeNull();
  });

  it('buttonClass gives the same classes to a link that acts as a button', () => {
    render(
      <>
        <Button variant="danger" size="sm">
          Löschen
        </Button>
        <Button variant="secondary" pending>
          Läuft
        </Button>
        <Button variant="ghost" disabled>
          Aus
        </Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Löschen' }).className).toBe(buttonClass({ variant: 'danger', size: 'sm', state: 'idle' }, undefined));
    expect(screen.getByRole('button', { name: 'Läuft' }).className).toBe(buttonClass({ variant: 'secondary', state: 'pending' }));
    expect(screen.getByRole('button', { name: 'Aus' }).className).toBe(buttonClass({ variant: 'ghost', state: 'disabled' }));
    expect(buttonClass({ variant: 'primary' }, 'w-full')).toContain('w-full');
    expect(buttonClass({ variant: 'primary' })).toContain('cursor-pointer');
  });
});
