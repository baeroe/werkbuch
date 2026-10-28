import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listLabels, listRelationTypes, listResolutions } from '@/api/catalog';
import { currentToasts, dismissToast, runToastAction } from '@/components/ui/toast';
import { asUser, resetApi } from '@/test/api';
import Labels from './Labels';
import RelationTypes from './RelationTypes';
import Resolutions from './Resolutions';

beforeEach(() => {
  resetApi();
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The undo toast that is showing, if any. */
const undoToast = () => currentToasts().find((item) => item.action?.label === 'Rückgängig');

describe('Labels', () => {
  it('lists the labels with their colour and how many items carry them', async () => {
    renderWithData(<Labels readOnlyReason={null} />);

    const forms = (await screen.findByText('Formulare')).closest('li')!;
    expect(within(forms).getByText('Ocker')).toBeTruthy();
    // WEB-47 and the other items with the label: the count comes from the items, not from the label
    expect(await within(forms).findByText(/Bei \d+ Items?/)).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(8);
  });

  it('creates a label with a colour and refuses a name that exists, next to the field', async () => {
    const user = userEvent.setup();
    renderWithData(<Labels readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Label anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Label anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'ux');
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));
    expect(await within(dialog).findByText('Diesen Namen gibt es schon.')).toBeTruthy();

    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Kundenwunsch');
    await user.click(within(dialog).getByRole('radio', { name: 'Moos' }));
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));

    await waitFor(async () => expect((await listLabels()).items.find((label) => label.name === 'Kundenwunsch')?.color).toBe('moss'));
    expect(await screen.findByText('Kundenwunsch')).toBeTruthy();
  });

  it('deletes a label after the undo toast has run out, and takes it back before', async () => {
    const user = userEvent.setup();
    renderWithData(<Labels readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Label „SEO“ löschen' }));
    expect(screen.queryByText('SEO')).toBeNull();
    act(() => runToastAction(undoToast()!.id));
    expect(await screen.findByText('SEO')).toBeTruthy();
    expect((await listLabels()).items.some((label) => label.name === 'SEO')).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Label „SEO“ löschen' }));
    act(() => dismissToast(undoToast()!.id));
    await waitFor(async () => expect((await listLabels()).items.some((label) => label.name === 'SEO')).toBe(false));
  });

  it('shows a member the labels without any way to change them', async () => {
    asUser('u_jonas');
    renderWithData(<Labels readOnlyReason="Labels verwalten nur Org-Admins." />);

    expect(await screen.findByText('Formulare')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Label anlegen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /bearbeiten|löschen/ })).toBeNull();
    expect(screen.getByText('Nur lesen')).toBeTruthy();
  });
});

describe('RelationTypes', () => {
  it('marks the three built-in types and offers no way to delete them', async () => {
    renderWithData(<RelationTypes readOnlyReason={null} />);

    const blocks = (await screen.findByRole('heading', { name: 'blockiert' })).closest('li')!;
    expect(within(blocks).getByText('Mitgeliefert')).toBeTruthy();
    expect(within(blocks).getByText('wird blockiert von')).toBeTruthy();
    expect(within(blocks).queryByRole('button', { name: /löschen/ })).toBeNull();
    // the related type is symmetric: one label, no counterpart
    const relates = screen.getByRole('heading', { name: 'verwandt' }).closest('li')!;
    expect(within(relates).getByText('Symmetrisch')).toBeTruthy();
    // a type of one's own can go
    expect(screen.getByRole('button', { name: 'Relationstyp „testet“ löschen' })).toBeTruthy();
  });

  it('creates a symmetric type with one label and a directed one with both', async () => {
    const user = userEvent.setup();
    renderWithData(<RelationTypes readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Relationstyp anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Relationstyp anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'ersetzt');
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschriftung' }), 'ersetzt');
    await user.type(within(dialog).getByRole('textbox', { name: 'Beschriftung der Gegenrichtung' }), 'wird ersetzt von');
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));
    await waitFor(async () => expect((await listRelationTypes()).items.find((type) => type.name === 'ersetzt')?.inward_label).toBe('wird ersetzt von'));

    await user.click(await screen.findByRole('button', { name: 'Relationstyp anlegen' }));
    const second = await screen.findByRole('dialog', { name: 'Relationstyp anlegen' });
    await user.type(within(second).getByRole('textbox', { name: 'Name' }), 'gehört zu');
    await user.type(within(second).getByRole('textbox', { name: 'Beschriftung' }), 'gehört zu');
    await user.click(within(second).getByRole('switch', { name: /Symmetrisch/ }));
    // symmetric: there is no counterpart to name
    expect(within(second).queryByRole('textbox', { name: 'Beschriftung der Gegenrichtung' })).toBeNull();
    await user.click(within(second).getByRole('button', { name: /^Anlegen/ }));
    await waitFor(async () => expect((await listRelationTypes()).items.find((type) => type.name === 'gehört zu')?.inward_label).toBeNull());
  });
});

describe('Resolutions', () => {
  it('marks the defaults of Completed and Canceled and keeps them from being deleted', async () => {
    renderWithData(<Resolutions readOnlyReason={null} />);

    const done = (await screen.findByRole('heading', { name: 'Done' })).closest('li')!;
    expect(within(done).getByText('Standard für Completed')).toBeTruthy();
    const wontDo = screen.getByRole('heading', { name: "Won't do" }).closest('li')!;
    expect(within(wontDo).getByText('Standard für Canceled')).toBeTruthy();

    const remove = within(done).getByRole('button', { name: 'Resolution „Done“ löschen' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(remove.getAttribute('aria-describedby')!)?.textContent).toMatch(/Standard für Completed/);
    // one that is no default can go
    expect(within(screen.getByRole('heading', { name: 'Duplicate' }).closest('li')!).getByRole('button', { name: 'Resolution „Duplicate“ löschen' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('makes a new resolution the default of Canceled, which takes the mark from the old one', async () => {
    const user = userEvent.setup();
    renderWithData(<Resolutions readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Resolution anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolution anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Abgelehnt');
    await user.click(within(dialog).getByRole('combobox', { name: /^Standard für/ }));
    await user.click(await screen.findByRole('option', { name: 'Canceled' }));
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));

    await waitFor(async () => {
      const all = (await listResolutions()).items;
      expect(all.find((entry) => entry.label === 'Abgelehnt')?.default_for).toBe('canceled');
      expect(all.find((entry) => entry.label === "Won't do")?.default_for).toBeNull();
    });
    const rejected = (await screen.findByRole('heading', { name: 'Abgelehnt' })).closest('li')!;
    expect(within(rejected).getByText('Standard für Canceled')).toBeTruthy();
    expect(within(screen.getByRole('heading', { name: "Won't do" }).closest('li')!).queryByText('Standard für Canceled')).toBeNull();
  });
});
