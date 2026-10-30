import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('is a bare textarea of three rows without label, hint and error', () => {
    const { container } = render(<Textarea aria-label="Notiz" />);

    expect(container.firstElementChild?.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'Notiz' }).getAttribute('rows')).toBe('3');
  });

  it('takes its rows from the caller', () => {
    render(<Textarea aria-label="Notiz" rows={6} />);

    expect(screen.getByRole('textbox', { name: 'Notiz' }).getAttribute('rows')).toBe('6');
  });

  it('belongs to its label', async () => {
    const onChange = vi.fn();
    render(<Textarea label="Beschreibung" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Beschreibung'), 'ab');

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('is described by its hint, and by its error instead of the hint, which also makes it invalid', () => {
    const { rerender } = render(<Textarea id="note" label="Notiz" hint="Optional." />);
    const textarea = screen.getByRole('textbox', { name: 'Notiz' });
    expect(textarea.getAttribute('aria-describedby')).toBe('note-hint');
    expect(textarea.hasAttribute('aria-invalid')).toBe(false);

    rerender(<Textarea id="note" label="Notiz" hint="Optional." error="Zu lang." />);
    expect(textarea.getAttribute('aria-describedby')).toBe('note-error');
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(textarea.className).toContain('border-danger');
  });

  it('adds a description of the caller to its own', () => {
    render(<Textarea id="note" label="Notiz" hint="Optional." aria-describedby="extra" />);

    expect(screen.getByRole('textbox', { name: 'Notiz' }).getAttribute('aria-describedby')).toBe('note-hint extra');
  });

  it('hands its ref to the textarea', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} label="Notiz" />);

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Notiz' }));
  });
});
