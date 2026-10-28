import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getPreferences, savePreferences } from '@/api/notifications';
import { listUsers } from '@/api/users';
import { listCommands } from '@/lib/commands';
import { renderPersonal, textbox, toastTitled, usePersonalTestSetup } from './testing';

usePersonalTestSetup();

const checkbox = (name: string) => screen.findByRole('checkbox', { name });
const isOn = (box: HTMLElement) => box.getAttribute('aria-checked') === 'true';

describe('the frame', () => {
  it('opens the profile first and links the four sections', async () => {
    renderPersonal('/me');
    const nav = await screen.findByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' });

    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Profil', 'Sicherheit', 'Benachrichtigungen', 'API & MCP']);
    expect(within(nav).getByRole('link', { name: 'Profil' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'API & MCP' }).getAttribute('href')).toBe('/me/api');
    expect(await screen.findByRole('heading', { name: 'Profil' })).toBeTruthy();
  });

  it('adds a command per section to the palette while the settings are open', async () => {
    renderPersonal('/me');
    await screen.findByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' });

    const commands = listCommands().filter((command) => command.id.startsWith('settings.me.'));
    expect(commands.map((command) => command.label)).toEqual(['Profil öffnen', 'Sicherheit öffnen', 'Benachrichtigungen öffnen', 'API & MCP öffnen']);
    expect(commands.every((command) => command.group === 'Persönliche Einstellungen')).toBe(true);
  });

  it('names the person at the top', async () => {
    renderPersonal('/me/security', 'u_theo');
    expect(await screen.findByText('Theo Okafor')).toBeTruthy();
    expect(screen.getByText('theo@feldwerk.example.com')).toBeTruthy();
  });

  it('shows a skeleton while the account loads, and an error with "Erneut versuchen" when it cannot', async () => {
    const user = userEvent.setup();
    localStorage.setItem('api:fail', '1');
    renderPersonal('/me');
    expect(screen.getByText('Persönliche Einstellungen werden geladen …')).toBeTruthy();

    expect(await screen.findByText('Dein Konto konnte nicht geladen werden')).toBeTruthy();
    localStorage.removeItem('api:fail');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { name: 'Profil' })).toBeTruthy();
  });

  it('shows an unknown section as unknown', async () => {
    renderPersonal('/me/billing');
    expect(await screen.findByText('Diesen Bereich gibt es nicht')).toBeTruthy();
  });
});

describe('Profile', () => {
  it('saves name, handle, language and time zone', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/profile', 'u_theo');

    const name = await textbox('Name');
    await user.clear(name);
    await user.type(name, 'Theo A. Okafor');
    const handle = await textbox('Kürzel');
    await user.clear(handle);
    await user.type(handle, 'theo-o');
    await user.click(screen.getByRole('combobox', { name: /^Sprache/ }));
    await user.click(await screen.findByRole('option', { name: 'English' }));
    const zone = screen.getByRole('combobox', { name: 'Zeitzone' });
    await user.clear(zone);
    await user.type(zone, 'London');
    await user.click(await screen.findByRole('option', { name: /Europe\/London/ }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(async () =>
      expect((await listUsers()).items.find((entry) => entry.id === 'u_theo')).toMatchObject({ name: 'Theo A. Okafor', handle: 'theo-o', locale: 'en', timezone: 'Europe/London' }),
    );
    expect(toastTitled('Profil gespeichert')).toBeTruthy();
  });

  it('shows a handle somebody else has at the field', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/profile', 'u_theo');
    const handle = await textbox('Kürzel');

    await user.clear(handle);
    await user.type(handle, 'mara');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Dieses Kürzel ist schon vergeben.')).toBeTruthy();
    expect(handle.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(handle));
    expect((await listUsers()).items.find((entry) => entry.id === 'u_theo')?.handle).toBe('theo');
  });

  it('keeps the e-mail address as read-only text, because it is how the person signs in', async () => {
    renderPersonal('/me/profile', 'u_theo');
    expect(await screen.findByText('E-Mail')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'E-Mail' })).toBeNull();
  });
});

describe('Notifications', () => {
  it('shows the defaults of the spec to somebody who never chose: the inbox for everything, mail for four events', async () => {
    renderPersonal('/me/notifications', 'u_theo');
    await screen.findByRole('table', { name: 'Benachrichtigungen nach Ereignis und Kanal' });

    const events = ['Zugewiesen', 'Erwähnt', 'Neuer Kommentar', 'Statuswechsel', 'Sonstige Änderungen', 'Fällig oder überfällig', 'Neues Item im Projekt', 'Vorlage fehlgeschlagen'];
    const mailOn = new Set(['Zugewiesen', 'Erwähnt', 'Neuer Kommentar', 'Fällig oder überfällig']);
    for (const event of events) {
      expect(isOn(await checkbox(`${event}, In-App`)), `${event} in the inbox`).toBe(true);
      expect(isOn(await checkbox(`${event}, E-Mail`)), `${event} by mail`).toBe(mailOn.has(event));
    }
  });

  it('saves the cells that were changed and nothing else', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/notifications');
    const save = await screen.findByRole('button', { name: 'Speichern' });
    // nothing changed yet: the button is not dead, it says so
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();

    await user.click(await checkbox('Neuer Kommentar, E-Mail'));
    await user.click(await checkbox('Sonstige Änderungen, E-Mail'));
    expect(await screen.findByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(async () => {
      const matrix = await getPreferences();
      expect(matrix.find((row) => row.event === 'comment' && row.channel === 'mail')?.enabled).toBe(false);
      expect(matrix.find((row) => row.event === 'item_changed' && row.channel === 'mail')?.enabled).toBe(true);
    });
    expect(toastTitled('Benachrichtigungen gespeichert')).toBeTruthy();
    // the saved choice is what the page shows now
    expect(isOn(await checkbox('Neuer Kommentar, E-Mail'))).toBe(false);
  });

  it('puts the defaults back with "Standardwerte", as a change that still has to be saved', async () => {
    const user = userEvent.setup();
    await savePreferences([
      { user_id: 'u_mara', event: 'comment', channel: 'mail', enabled: false },
      { user_id: 'u_mara', event: 'assigned', channel: 'inbox', enabled: false },
    ]);
    renderPersonal('/me/notifications');
    expect(isOn(await checkbox('Neuer Kommentar, E-Mail'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Standardwerte' }));
    expect(isOn(await checkbox('Neuer Kommentar, E-Mail'))).toBe(true);
    expect(isOn(await checkbox('Zugewiesen, In-App'))).toBe(true);
    expect((await getPreferences()).find((row) => row.event === 'comment' && row.channel === 'mail')?.enabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect((await getPreferences()).find((row) => row.event === 'comment' && row.channel === 'mail')?.enabled).toBe(true));
  });

  it('shows the row about a disabled webhook only to org admins', async () => {
    renderPersonal('/me/notifications', 'u_mara');
    expect(await checkbox('Webhook abgeschaltet, In-App')).toBeTruthy();
  });

  it('leaves the row about a disabled webhook out for everybody else', async () => {
    renderPersonal('/me/notifications', 'u_theo');
    await checkbox('Zugewiesen, In-App');
    expect(screen.queryByRole('checkbox', { name: 'Webhook abgeschaltet, In-App' })).toBeNull();
  });

  it('names the cause and offers "Erneut versuchen" when the settings cannot be loaded', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    // the frame has its data; only the settings of this section fail
    await screen.findByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' });
    localStorage.setItem('api:fail', '1');
    await user.click(screen.getByRole('link', { name: 'Benachrichtigungen' }));
    expect(await screen.findByText('Die Benachrichtigungen konnten nicht geladen werden')).toBeTruthy();

    localStorage.removeItem('api:fail');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('table', { name: 'Benachrichtigungen nach Ereignis und Kanal' })).toBeTruthy();
  });
});
