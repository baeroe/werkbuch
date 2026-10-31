import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { initI18n } from '@/lib/i18n';
import en from '../../../../lang/en.json';
import { Select, type SelectOption } from './Select';

const OPTIONS: SelectOption[] = [
  { value: 'todo', label: 'Todo', icon: <span data-testid="icon-todo">T</span> },
  { value: 'doing', label: 'In Arbeit' },
  { value: 'done', label: 'Erledigt', disabled: true },
];

function Harness({ onValueChange = vi.fn(), start = null, ...rest }: { onValueChange?: (value: string | null) => void; start?: string | null } & Partial<Parameters<typeof Select>[0]>) {
  const [value, setValue] = useState<string | null>(start);
  return (
    <Select
      label="Status"
      options={OPTIONS}
      value={value}
      onValueChange={(next) => {
        onValueChange(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

describe('Select', () => {
  it('picks a value by keyboard: Enter opens, the arrows move, Enter chooses and the focus returns', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: /Status/ });
    expect(trigger.textContent).toContain('Auswählen …');

    await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('doing');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('combobox', { name: /Status/ }).textContent).toContain('In Arbeit');
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /Status/ }));
  });

  it('gives the focus back to the field as the list closes, not once it has faded out, so a Tab right after stays in place', async () => {
    const user = userEvent.setup();
    // the list fades out and never finishes: what a Tab during the animation meets
    const fading = vi.fn(() => [{ finished: new Promise(() => {}) }] as unknown as Animation[]);
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', { value: fading, configurable: true });
    onTestFinished(() => void delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations);
    render(
      <>
        <Harness />
        <button type="button">Weiter</button>
      </>,
    );
    const trigger = screen.getByRole('combobox', { name: /Status/ });

    await user.click(trigger);
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(document.activeElement).toBe(trigger);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Weiter' }));

    // closing without a choice gives it back too
    await user.click(trigger);
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
    expect(fading).toHaveBeenCalled();
  });

  it('leaves the focus on the next field when Tab leaves the open list without a choice', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <>
        <Harness onValueChange={onValueChange} />
        <button type="button">Weiter</button>
      </>,
    );

    await user.click(screen.getByRole('combobox', { name: /Status/ }));
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    await user.tab();

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Weiter' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('can be read but not changed while it is read-only, and keeps the focus', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness start="todo" readOnly onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: /Status/ });
    expect(trigger.getAttribute('aria-readonly')).toBe('true');

    await user.tab();
    await user.keyboard('{Enter}{ArrowDown}{Enter}{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain('Todo');
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the icon of the chosen option, marks it in the list and leaves a disabled option out of reach', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness start="todo" onValueChange={onValueChange} keepSide />);
    expect(screen.getAllByTestId('icon-todo')).toHaveLength(1);

    await user.click(screen.getByRole('combobox', { name: /Status/ }));
    await screen.findByRole('listbox');
    expect(screen.getAllByTestId('icon-todo')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Todo' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'Erledigt' }).getAttribute('aria-disabled')).toBe('true');

    await user.click(screen.getByRole('option', { name: 'Erledigt' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('closes on Escape without a change', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} placeholder="Status wählen" />);
    expect(screen.getByRole('combobox').textContent).toContain('Status wählen');

    await user.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('names its list in English when the page is English', () => {
    initI18n({ locale: 'en', translations: en });
    render(<Harness />);

    expect(screen.getByRole('combobox', { name: /Status/ }).textContent).toContain('Select …');
  });

  it('describes the control by its hint, or by the error that replaces it', () => {
    const { rerender } = render(<Select label="Status" hint="Der Status des Items." options={OPTIONS} value={null} onValueChange={() => {}} />);
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toContain('hint');
    expect(screen.getByRole('combobox').hasAttribute('aria-invalid')).toBe(false);

    rerender(<Select label="Status" hint="Der Status des Items." error="Wähle einen Status." options={OPTIONS} value={null} onValueChange={() => {}} />);
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toContain('error');
    expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
  });

  it('can be disabled and can carry its own id and class', () => {
    render(<Select label="Status" id="status-field" className="w-40" disabled options={OPTIONS} value={null} onValueChange={() => {}} />);

    const trigger = screen.getByRole('combobox');
    expect(trigger.id).toBe('status-field');
    expect(trigger.hasAttribute('data-disabled')).toBe(true);
  });

  it('hands only aria-label on to the DOM, so a field without a visible label has a name and no other prop leaks through', () => {
    const stray = { 'data-x': 'leak', title: 'leak' } as object;
    render(<Select aria-label="Status des Items" options={OPTIONS} value={null} onValueChange={() => {}} {...stray} />);

    const trigger = screen.getByRole('combobox', { name: 'Status des Items' });
    expect(trigger.hasAttribute('data-x')).toBe(false);
    expect(trigger.hasAttribute('title')).toBe(false);
  });
});
