import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProperties } from '@/api/properties';
import { listWorkItemTypes, saveWorkItemType } from '@/api/workItemTypes';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import Properties from './Properties';
import Types from './Types';

beforeEach(() => {
  resetApi();
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => resetToasts());
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The row of a type or property, found by its heading. */
const rowOf = async (name: string) => (await screen.findByRole('heading', { name })).closest('li')!;

describe('Types', () => {
  it('lists the types with their properties and marks the epic type for the timeline', async () => {
    renderWithData(<Types readOnlyReason={null} />);

    const epic = await rowOf('Epic');
    expect(within(epic).getByText('In der Timeline')).toBeTruthy();
    const bug = await rowOf('Bug');
    // the environment is required for a bug, the browser is not
    expect(within(bug).getByText('Umgebung (Pflicht)')).toBeTruthy();
    expect(within(bug).getByText('Browser')).toBeTruthy();
    expect(within(await rowOf('Task')).queryByText('In der Timeline')).toBeNull();
  });

  it('keeps the Epic mark while items of the type have children, and says so in the dialog', async () => {
    const user = userEvent.setup();
    renderWithData(<Types readOnlyReason={null} />);

    await user.click(within(await rowOf('Epic')).getByRole('button', { name: 'Typ „Epic“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ „Epic“ bearbeiten' });
    await user.click(within(dialog).getByRole('checkbox', { name: /^Epic/ }));
    await user.click(within(dialog).getByRole('button', { name: /^Speichern/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('3 Items dieses Typs haben Kind-Items. Nur Epics können Kind-Items haben.');
    expect((await listWorkItemTypes()).items.find((type) => type.id === 't_epic')?.is_epic).toBe(true);
  });

  it('creates a type with an icon, a tone and a required property', async () => {
    const user = userEvent.setup();
    renderWithData(<Types readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Typ anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Idee');
    await user.click(within(dialog).getByRole('radio', { name: 'Glühbirne' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Pflaume' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Property zuordnen' }));
    await user.click(await screen.findByRole('option', { name: 'Kunde' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Pflicht: Kunde' }));
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));

    await waitFor(async () => {
      const created = (await listWorkItemTypes()).items.find((type) => type.name === 'Idee');
      expect([created?.icon, created?.tone, created?.is_epic]).toEqual(['lightbulb', 'plum', false]);
      expect(created?.properties).toEqual([{ property_id: 'pr_customer', required: true, position: 0 }]);
    });
    expect(await rowOf('Idee')).toBeTruthy();
  });

  it('archives a type that has items, with a way back, and deletes one that has none', async () => {
    const user = userEvent.setup();
    await saveWorkItemType({ name: 'Leer', icon: 'flag', tone: 'sand', description: '', is_epic: false, properties: [] });
    renderWithData(<Types readOnlyReason={null} />);

    // Task has items: it can only be archived, and the button says so
    await user.click(await screen.findByRole('button', { name: 'Typ „Task“ archivieren' }));
    await waitFor(async () => expect((await listWorkItemTypes()).items.find((type) => type.name === 'Task')?.archived_at).not.toBeNull());
    const task = await rowOf('Task');
    expect(await within(task).findByText('Archiviert')).toBeTruthy();
    expect(currentToasts().some((item) => item.title === 'Typ „Task“ ist archiviert')).toBe(true);

    await user.click(within(task).getByRole('button', { name: 'Typ „Task“ wiederherstellen' }));
    await waitFor(async () => expect((await listWorkItemTypes()).items.find((type) => type.name === 'Task')?.archived_at).toBeNull());

    // a type nobody uses is deleted after the undo toast
    await user.click(await screen.findByRole('button', { name: 'Typ „Leer“ löschen' }));
    const undo = currentToasts().find((item) => item.action?.label === 'Rückgängig')!;
    expect(screen.queryByRole('heading', { name: 'Leer' })).toBeNull();
    act(() => runToastAction(undo.id));
    expect(await screen.findByRole('heading', { name: 'Leer' })).toBeTruthy();
  });

  it('shows a member the types without any way to change them', async () => {
    renderWithData(<Types readOnlyReason="Typen verwalten nur Org-Admins." />);

    expect(await rowOf('Bug')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Typ anlegen|bearbeiten|archivieren|löschen/ })).toBeNull();
  });
});

describe('Properties', () => {
  it('lists the properties with key, field type and the types that use them', async () => {
    renderWithData(<Properties readOnlyReason={null} />);

    const customer = await rowOf('Kunde');
    expect(within(customer).getByText('customer')).toBeTruthy();
    expect(within(customer).getByText('Dropdown')).toBeTruthy();
    expect(within(customer).getByText(/Task, Bug, Epic, Kundenwunsch/)).toBeTruthy();
    expect(within(await rowOf('Reviewer')).getByText('Personenauswahl')).toBeTruthy();
  });

  it('locks the key and the field type of a property that exists', async () => {
    const user = userEvent.setup();
    renderWithData(<Properties readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Property „Aufwand (h)“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Property „Aufwand (h)“ bearbeiten' });

    const key = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Schlüssel' });
    expect(key.value).toBe('effort');
    expect(key.readOnly).toBe(true);
    expect(within(dialog).getByText(/nach dem Anlegen nicht mehr ändern/)).toBeTruthy();
    // the field type is a fact, not a choice
    expect(within(dialog).queryByRole('combobox', { name: /^Feldtyp/ })).toBeNull();
    expect(within(dialog).getByText('Zahl')).toBeTruthy();
  });

  it('suggests the key from the label, and a dropdown needs an option', async () => {
    const user = userEvent.setup();
    renderWithData(<Properties readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Property anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Property anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Prüfstufe (intern)');
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Schlüssel' }).value).toBe('pruefstufe_intern');

    await user.click(within(dialog).getByRole('combobox', { name: /^Feldtyp/ }));
    await user.click(await screen.findByRole('option', { name: 'Dropdown' }));
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));
    expect(await within(dialog).findByText('Ein Dropdown braucht mindestens eine Option.')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Option hinzufügen' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Label von Option 1' }), 'Entwurf');
    await user.click(within(dialog).getByRole('button', { name: 'Option hinzufügen' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Label von Option 2' }), 'Geprüft');
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));

    await waitFor(async () => {
      const created = (await listProperties()).items.find((property) => property.key === 'pruefstufe_intern');
      expect(created?.field_type).toBe('dropdown');
      expect(created?.options.map((option) => option.label)).toEqual(['Entwurf', 'Geprüft']);
    });
  });

  it('archives an option instead of deleting it, and brings it back', async () => {
    const user = userEvent.setup();
    renderWithData(<Properties readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Property „Kunde“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Property „Kunde“ bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Option „Hafenkontor“ archivieren' }));
    expect(within(dialog).getByRole('button', { name: 'Option „Hafenkontor“ wiederherstellen' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /^Speichern/ }));

    await waitFor(async () => {
      const customer = (await listProperties()).items.find((property) => property.key === 'customer')!;
      expect(customer.options.find((option) => option.label === 'Hafenkontor')?.archived_at).not.toBeNull();
      expect(customer.options.find((option) => option.label === 'Gärtnerei Moos')?.archived_at).toBeNull();
    });
  });

  it('asks before deleting and names how many items lose their value', async () => {
    const user = userEvent.setup();
    renderWithData(<Properties readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Property „Kunde“ löschen' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Property „Kunde“ löschen?' });
    // the number comes from the items; the history keeps the values
    expect(await within(confirm).findByText(/bei \d+ Items/)).toBeTruthy();
    expect(within(confirm).getByText(/History behält sie/)).toBeTruthy();

    await user.click(within(confirm).getByRole('button', { name: 'Property löschen' }));
    await waitFor(async () => expect((await listProperties()).items.some((property) => property.key === 'customer')).toBe(false));
    expect(currentToasts().some((item) => item.title === 'Property „Kunde“ gelöscht')).toBe(true);
  });
});
