import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listInvitations, listUsers, updateUserRole } from '@/api/users';
import { qk } from '@/hooks/keys';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { useSession } from '@/store/session';
import { asUser, resetApi } from '@/test/api';
import OrgSettingsRoute from './OrgSettings';
import People from './People';

beforeEach(() => {
  resetApi();
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => resetToasts());
  Reflect.deleteProperty(navigator, 'clipboard');
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The People section on its own. */
const renderPeople = () => renderWithData(<People readOnlyReason={null} />);

/** The settings route at a path, as the router mounts it. */
function renderSettings(path: string) {
  return renderWithData(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="settings/:section?" element={<OrgSettingsRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

const stored = async (id: string) => (await listUsers()).items.find((user) => user.id === id)!;

describe('People', () => {
  it('names the last active admin in a message when deactivating them is refused', async () => {
    const user = userEvent.setup();
    renderPeople();

    // Mara is the only active admin among the people; the default bot does not count
    await user.click(await screen.findByRole('button', { name: 'Deaktivieren Mara Lindqvist' }));

    const message = await screen.findByRole('alert');
    expect(message.textContent).toContain('Mara Lindqvist ist der letzte aktive Admin');
    expect(message.textContent).toContain('Mache zuerst jemand anderen zum Admin');
    // the refusal is a message on the page, not a toast that runs out
    expect(currentToasts()).toHaveLength(0);
    expect((await stored('u_mara')).disabled_at).toBeNull();
  });

  it('lets the last admin be demoted once somebody else is an admin', async () => {
    const user = userEvent.setup();
    await updateUserRole('u_jonas', 'admin');
    renderPeople();

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Jonas Feld' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));

    await waitFor(async () => expect((await stored('u_jonas')).org_role).toBe('member'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks before the signed-in admin deactivates their own account, and carries on as the other admin', async () => {
    const user = userEvent.setup();
    await updateUserRole('u_jonas', 'admin');
    renderPeople();

    await user.click(await screen.findByRole('button', { name: 'Deaktivieren Mara Lindqvist' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Dein eigenes Konto deaktivieren?' });
    // nothing happens before the answer
    expect((await stored('u_mara')).disabled_at).toBeNull();
    await user.click(within(ask).getByRole('button', { name: 'Mich deaktivieren' }));

    // the account is out, and the demo does not stay in a session the fake API would refuse
    await waitFor(() => expect(useSession.getState().userId).toBe('u_jonas'));
    expect((await stored('u_mara')).disabled_at).not.toBeNull();
    expect(currentToasts().some((item) => item.title === 'Dein Konto ist deaktiviert')).toBe(true);
  });

  it('asks before an admin hands over their own admin rights', async () => {
    const user = userEvent.setup();
    await updateUserRole('u_jonas', 'admin');
    renderPeople();

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Mara Lindqvist' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Deine Admin-Rechte abgeben?' });
    expect((await stored('u_mara')).org_role).toBe('admin');

    await user.click(within(ask).getByRole('button', { name: 'Zum Member machen' }));
    await waitFor(async () => expect((await stored('u_mara')).org_role).toBe('member'));
  });

  it('deactivates a person and brings them back with "Reaktivieren"', async () => {
    const user = userEvent.setup();
    renderPeople();

    // Sven was deactivated in September: his row offers the way back
    await user.click(await screen.findByRole('button', { name: 'Reaktivieren Sven Albers' }));
    await waitFor(async () => expect((await stored('u_sven')).disabled_at).toBeNull());

    await user.click(await screen.findByRole('button', { name: 'Deaktivieren Sven Albers' }));
    await waitFor(async () => expect((await stored('u_sven')).disabled_at).not.toBeNull());
  });

  it('ends an invitation in a link and selects it when the clipboard refuses to copy', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('Document is not focused'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPeople();

    await user.click(await screen.findByRole('button', { name: 'Person einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Person einladen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'E-Mail-Adresse' }), 'carla@example.com');
    await user.click(within(dialog).getByRole('button', { name: /^Einladen/ }));

    // the dialog ends in the link, valid for seven days
    const link = await within(await screen.findByRole('dialog', { name: 'Einladung ist angelegt' })).findByRole<HTMLInputElement>('textbox', { name: 'Einladungslink' });
    expect(link.value).toMatch(/\/invitations\/\w+$/);
    expect((await listInvitations()).items.map((invitation) => invitation.email)).toEqual(['carla@example.com']);

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));
    expect(writeText).toHaveBeenCalledWith(link.value);
    // no clipboard: the text is marked, so one keystroke copies it, and the message says so
    expect(document.activeElement).toBe(link);
    expect([link.selectionStart, link.selectionEnd]).toEqual([0, link.value.length]);
    expect(screen.getByText(/Das Kopieren hat nicht geklappt/)).toBeTruthy();
  });

  it('says "Kopiert" when the clipboard takes the link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPeople();

    await user.click(await screen.findByRole('button', { name: 'Person einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Person einladen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'E-Mail-Adresse' }), 'carla@example.com');
    await user.click(within(dialog).getByRole('button', { name: /^Einladen/ }));
    await user.click(await screen.findByRole('button', { name: 'Link kopieren' }));

    expect(await screen.findByRole('button', { name: 'Kopiert' })).toBeTruthy();
    expect(screen.queryByText(/Das Kopieren hat nicht geklappt/)).toBeNull();
  });

  it('refuses an address that already has an account, next to the field', async () => {
    const user = userEvent.setup();
    renderPeople();

    await user.click(await screen.findByRole('button', { name: 'Person einladen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Person einladen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'E-Mail-Adresse' }), 'jonas@feldwerk.example.com');
    await user.click(within(dialog).getByRole('button', { name: /^Einladen/ }));

    expect(await within(dialog).findByText('Zu dieser Adresse gibt es schon ein Konto.')).toBeTruthy();
    expect((await listInvitations()).items).toHaveLength(0);
  });
});

describe('the settings for somebody who is not an admin', () => {
  it('tells a member that people are for admins only, with the reason', async () => {
    asUser('u_jonas');
    renderSettings('/settings/people');

    expect(await screen.findByText('Nur für Admins')).toBeTruthy();
    expect(screen.getByText(/verwalten nur Org-Admins/)).toBeTruthy();
    // nothing is offered that would be refused
    expect(screen.queryByRole('button', { name: 'Person einladen' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Rolle von/ })).toBeNull();
  });

  it('lets a member read the catalogs without a way to change them', async () => {
    asUser('u_jonas');
    renderSettings('/settings/workflows');

    expect(await screen.findByRole('heading', { name: 'Agentur-Freigabe' })).toBeTruthy();
    expect(screen.getByText('Nur lesen')).toBeTruthy();
    // one "Ansehen" per workflow instead of "Bearbeiten"
    expect(screen.getAllByRole('link', { name: /^Ansehen/ })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^Bearbeiten/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Workflow anlegen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Löschen/ })).toBeNull();
  });

  it('does not tell an admin "Nur für Admins" while the projects behind the rights are still loading', async () => {
    // the people are known (so the signed-in person is), the projects and memberships are not: the rights are not settled
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(qk.users.list({}), await listUsers());
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings/people']}>
          <Routes>
            <Route path="settings/:section?" element={<OrgSettingsRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('Nur für Admins')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Person einladen' })).toBeTruthy();
    expect(screen.queryByText('Nur für Admins')).toBeNull();
  });

  it('shows an admin the section, and never the notice for members while the rights load', async () => {
    renderSettings('/settings/people');

    // the rights are not known yet: loading, not "Nur für Admins"
    expect(screen.queryByText('Nur für Admins')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Person einladen' })).toBeTruthy();
    expect(await screen.findByRole('combobox', { name: 'Rolle von Mara Lindqvist' })).toBeTruthy();
    expect(screen.queryByText('Nur für Admins')).toBeNull();
  });
});
