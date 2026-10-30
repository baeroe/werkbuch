import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/lib/i18n';
import en from '../../../../lang/en.json';
import { Combobox, type ComboboxOption } from './Combobox';

const OPTIONS: ComboboxOption[] = [
  { value: 'Europe/Berlin', label: 'Berlin', icon: <span data-testid="flag">DE</span> },
  { value: 'Europe/Lisbon', label: 'Lissabon' },
  { value: 'Europe/Paris', label: 'Paris', disabled: true },
];

function Harness({ onValueChange = vi.fn(), start = null, ...rest }: { onValueChange?: (value: string | null) => void; start?: string | null } & Partial<Parameters<typeof Combobox>[0]>) {
  const [value, setValue] = useState<string | null>(start);
  return (
    <Combobox
      label="Zeitzone"
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

describe('Combobox', () => {
  it('filters while typing and takes the first match with Enter', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Zeitzone' }));
    await user.keyboard('liss');
    const list = await screen.findByRole('listbox');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Lissabon' })).toBeTruthy();

    await user.keyboard('{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('Europe/Lisbon');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect((screen.getByRole('combobox', { name: 'Zeitzone' }) as HTMLInputElement).value).toBe('Lissabon');
  });

  it('says so when nothing matches, and the text is the one passed in', async () => {
    const user = userEvent.setup();
    render(<Harness emptyText="Keine Zeitzone gefunden" />);

    await user.click(screen.getByRole('combobox', { name: 'Zeitzone' }));
    await user.keyboard('xyz');

    expect(await screen.findByText('Keine Zeitzone gefunden')).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('says "Keine Treffer" by default, and "No matches" in an English page', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Zeitzone' }).getAttribute('placeholder')).toBe('Suchen …');
    await user.click(screen.getByRole('combobox', { name: 'Zeitzone' }));
    await user.keyboard('xyz');
    expect(await screen.findByText('Keine Treffer')).toBeTruthy();
    unmount();

    initI18n({ locale: 'en', translations: en });
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Zeitzone' }).getAttribute('placeholder')).toBe('Search …');
    await user.click(screen.getByRole('combobox', { name: 'Zeitzone' }));
    await user.keyboard('xyz');
    expect(await screen.findByText('No matches')).toBeTruthy();
  });

  it('picks with the arrow keys', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Zeitzone' }));
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(onValueChange).toHaveBeenCalledTimes(1));
    expect(onValueChange).toHaveBeenCalledWith('Europe/Lisbon');
  });

  it('shows the icon of an option in the list, keeps the side, and a disabled option cannot be picked', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} keepSide defaultOpen />);
    await screen.findByRole('listbox');
    expect(screen.getByTestId('flag')).toBeTruthy();

    await user.click(screen.getByRole('option', { name: 'Paris' }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('clears the choice with the button, which has a name', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} start="Europe/Berlin" />);
    expect((screen.getByRole('combobox', { name: 'Zeitzone' }) as HTMLInputElement).value).toBe('Berlin');

    await user.click(screen.getByRole('button', { name: 'Auswahl entfernen' }));

    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it('opens its list with the button, which has a name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Liste öffnen' }));

    expect(await screen.findByRole('listbox')).toBeTruthy();
  });

  it('gives its search input the name it is given and no autofill', () => {
    render(<Harness name="timezone" />);

    const input = screen.getByRole('combobox', { name: 'Zeitzone' });
    expect(input.getAttribute('name')).toBe('timezone');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('hands only aria-label (and the name) on to the DOM, so a field without a visible label has a name and no other prop leaks through', () => {
    const stray = { 'data-x': 'leak', title: 'leak' } as object;
    render(<Combobox aria-label="Zeitzone des Teams" options={OPTIONS} value={null} onValueChange={() => {}} {...stray} />);

    const input = screen.getByRole('combobox', { name: 'Zeitzone des Teams' });
    expect(input.hasAttribute('data-x')).toBe(false);
    expect(input.hasAttribute('title')).toBe(false);
  });

  it('describes the control by its hint or its error, and can be disabled, start filled and carry an id', () => {
    const { rerender } = render(<Combobox label="Zeitzone" hint="Für Termine." id="tz" options={OPTIONS} value={null} onValueChange={() => {}} defaultInputValue="Ber" />);
    const input = screen.getByRole('combobox', { name: 'Zeitzone' }) as HTMLInputElement;
    expect(input.id).toBe('tz');
    expect(input.value).toBe('Ber');
    expect(input.getAttribute('aria-describedby')).toContain('hint');

    rerender(<Combobox label="Zeitzone" error="Wähle eine Zeitzone." id="tz" disabled options={OPTIONS} value="Europe/Berlin" onValueChange={() => {}} className="w-60" />);
    expect(screen.getByRole('combobox', { name: 'Zeitzone' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Zeitzone' }).getAttribute('aria-describedby')).toContain('error');
    expect((screen.getByRole('combobox', { name: 'Zeitzone' }) as HTMLInputElement).disabled).toBe(true);
  });
});
