import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('is a bare input without label, hint and error', () => {
    const { container } = render(<Input aria-label="Suche" />);

    expect(container.firstElementChild?.tagName).toBe('INPUT');
    expect(screen.getByRole('textbox', { name: 'Suche' }).hasAttribute('aria-describedby')).toBe(false);
  });

  it('belongs to its label', async () => {
    const onChange = vi.fn();
    render(<Input label="Name" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Name'), 'Mara');

    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('keeps the id it is given', () => {
    render(<Input id="name" label="Name" />);

    expect(screen.getByLabelText('Name').id).toBe('name');
  });

  it('is described by its hint', () => {
    render(<Input label="Name" hint="Wie auf dem Ausweis." id="name" />);

    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-describedby')).toBe('name-hint');
    expect(screen.getByRole('textbox', { name: 'Name' }).hasAttribute('aria-invalid')).toBe(false);
  });

  it('is invalid and described by its error, which replaces the hint', () => {
    render(<Input label="Name" hint="Wie auf dem Ausweis." error="Bitte einen Namen eingeben." id="name" />);

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('name-error');
    expect(input.className).toContain('border-danger');
  });

  it('adds a description of the caller to its own', () => {
    render(<Input label="Name" hint="Tipp" aria-describedby="extra" id="name" />);

    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-describedby')).toBe('name-hint extra');
  });

  it('hands its ref to the input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} label="Name" />);

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Name' }));
  });

  it('can be disabled and takes a class', () => {
    render(<Input aria-label="Suche" disabled className="max-w-xs" />);

    const input = screen.getByRole('textbox', { name: 'Suche' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.className).toContain('max-w-xs');
  });
});
