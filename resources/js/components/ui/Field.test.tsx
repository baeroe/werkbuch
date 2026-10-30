import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { describedBy, Field, fieldIds } from './Field';

describe('Field', () => {
  it('names the parts after the id of the control', () => {
    expect(fieldIds('name')).toEqual({ label: 'name-label', hint: 'name-hint', error: 'name-error' });
  });

  it('points the label at the control', () => {
    render(
      <Field id="name" label="Name">
        <input id="name" />
      </Field>,
    );

    expect(screen.getByLabelText('Name').id).toBe('name');
    expect(document.getElementById('name-label')?.getAttribute('for')).toBe('name');
  });

  it('renders no label element without a label, and passes the class on', () => {
    const { container } = render(
      <Field id="name" className="mt-2">
        <input id="name" />
      </Field>,
    );

    expect(container.querySelector('label')).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain('mt-2');
  });

  it('shows the hint until there is an error, and then only the error', () => {
    const { rerender } = render(
      <Field id="name" hint="Wie auf dem Ausweis.">
        <input id="name" />
      </Field>,
    );
    expect(document.getElementById('name-hint')?.textContent).toBe('Wie auf dem Ausweis.');

    rerender(
      <Field id="name" hint="Wie auf dem Ausweis." error="Bitte einen Namen eingeben.">
        <input id="name" />
      </Field>,
    );
    expect(document.getElementById('name-hint')).toBeNull();
    expect(document.getElementById('name-error')?.textContent).toBe('Bitte einen Namen eingeben.');
    expect(document.querySelector('#name-error svg.lucide-circle-alert')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps its polite live region rendered while there is no error', () => {
    const { container } = render(
      <Field id="name">
        <input id="name" />
      </Field>,
    );

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.childElementCount).toBe(0);
  });
});

describe('describedBy', () => {
  it('names the hint, or the error instead of it', () => {
    expect(describedBy('x', { hint: 'Tipp' })).toBe('x-hint');
    expect(describedBy('x', { hint: 'Tipp', error: 'Fehler' })).toBe('x-error');
  });

  it('adds what the caller already described, and is undefined when there is nothing', () => {
    expect(describedBy('x', { hint: 'Tipp' }, 'other')).toBe('x-hint other');
    expect(describedBy('x', {}, 'other')).toBe('other');
    expect(describedBy('x', {})).toBeUndefined();
  });
});
