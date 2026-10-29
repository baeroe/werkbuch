import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { archiveProject, getProject, updateProject } from '@/api/projects';
import { dismissToast, runToastAction } from '@/components/ui/toast';
import { listCommands } from '@/lib/commands';
import { failure } from '@/test/api';
import { renderSettings, textbox, toastTitled, useSettingsTestSetup } from './testing';

useSettingsTestSetup();

describe('the frame', () => {
  it('shows a skeleton while the project loads', () => {
    renderSettings('/projects/WEB/settings');
    expect(screen.getByText('Projekteinstellungen werden geladen …')).toBeTruthy();
  });

  it('names the cause and offers "Erneut versuchen" when the project cannot be loaded', async () => {
    const user = userEvent.setup();
    localStorage.setItem('api:fail', '1');
    renderSettings('/projects/WEB/settings');

    expect(await screen.findByText('Das Projekt konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText(/Simulierter Serverfehler/)).toBeTruthy();

    localStorage.removeItem('api:fail');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await textbox('Name')).toBeTruthy();
  });

  it('shows a project the person may not see as unknown', async () => {
    renderSettings('/projects/OPS/settings', 'u_theo');
    expect(await screen.findByText('Das Projekt OPS gibt es nicht')).toBeTruthy();
  });

  it('shows an unknown section as unknown', async () => {
    renderSettings('/projects/WEB/settings/billing');
    expect(await screen.findByText('Diesen Bereich gibt es nicht')).toBeTruthy();
  });

  it('corrects the address of a former identifier, keeping the section', async () => {
    await updateProject('p_web', { identifier: 'SITE' });
    const router = renderSettings('/projects/WEB/settings/members');

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/SITE/settings/members'));
  });

  it('adds a command per section to the palette while the settings are open', async () => {
    renderSettings('/projects/WEB/settings');
    await screen.findByRole('navigation', { name: 'Bereiche der Projekteinstellungen' });

    const commands = listCommands().filter((command) => command.id.startsWith('settings.project.'));
    expect(commands.map((command) => command.label)).toEqual(['Allgemein öffnen', 'Mitglieder öffnen', 'Workflow öffnen', 'Typen öffnen', 'Automatisierungen öffnen']);
    expect(commands.every((command) => command.group === 'Einstellungen WEB')).toBe(true);
  });

  it('links the five sections and marks the open one', async () => {
    renderSettings('/projects/WEB/settings/workflow');
    const nav = await screen.findByRole('navigation', { name: 'Bereiche der Projekteinstellungen' });

    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Allgemein', 'Mitglieder', 'Workflow', 'Typen', 'Automatisierungen']);
    expect(within(nav).getByRole('link', { name: 'Workflow' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Typen' }).getAttribute('href')).toBe('/projects/WEB/settings/types');
  });
});

describe('from one project to the next', () => {
  // The projects are in the cache after their first visit, so the screen does not wait for them and nothing remounts by itself.

  it('shows the other project its own data, not the unsaved name of the first', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    expect((await textbox('Name')).value).toBe('Kunden-App');

    await act(() => router.navigate('/projects/WEB/settings'));
    const name = await textbox('Name');
    await waitFor(() => expect(name.value).toBe('Website-Relaunch'));
    await user.type(name, ' X');

    await act(() => router.navigate('/projects/APP/settings'));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).getByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/settings'));
    await waitFor(async () => expect((await textbox('Name')).value).toBe('Kunden-App'));
    expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull();
    // Save has nothing of the other project to send
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();
    expect((await getProject('APP')).name).toBe('Kunden-App');
  });

  it('shows the other project its own types, not the unsaved choice of the first', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings/types');
    const box = (name: string) => screen.findByRole('checkbox', { name: `${name} verwenden` });
    expect((await box('Kundenwunsch')).getAttribute('aria-checked')).toBe('true');

    await act(() => router.navigate('/projects/WEB/settings/types'));
    // WEB uses Task, Bug and Epic; APP also Kundenwunsch
    await waitFor(async () => expect((await box('Kundenwunsch')).getAttribute('aria-checked')).toBe('false'));
    await user.click(await box('Epic'));

    await act(() => router.navigate('/projects/APP/settings/types'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/settings/types'));
    await waitFor(async () => expect((await box('Kundenwunsch')).getAttribute('aria-checked')).toBe('true'));
    expect((await box('Epic')).getAttribute('aria-checked')).toBe('true');
  });
});

describe('rights', () => {
  it('lets Theo read the settings of WEB, where he is a viewer, and says why he cannot change them', async () => {
    renderSettings('/projects/WEB/settings', 'u_theo');

    expect(await screen.findByText('Projekteinstellungen ändern dürfen nur Admins des Projekts WEB.')).toBeTruthy();
    expect((await textbox('Name')).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /Speichern/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Gefahrenzone' })).toBeNull();
  });

  it('lets Theo change the settings of APP, where he is an admin', async () => {
    renderSettings('/projects/APP/settings', 'u_theo');

    expect((await textbox('Name')).readOnly).toBe(false);
    expect(screen.queryByText(/dürfen nur Admins/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Gefahrenzone' })).toBeTruthy();
  });
});

describe('General', () => {
  it('says there is nothing to save instead of staying dead, and saves once something changed', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    const name = await textbox('Name');
    const save = screen.getByRole('button', { name: 'Speichern' });
    expect(save.hasAttribute('disabled')).toBe(false);

    await user.click(save);
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();
    expect(toastTitled('Einstellungen gespeichert')).toBeUndefined();

    await user.clear(name);
    await user.type(name, 'Kunden-App 2.0');
    expect(screen.queryByText('Keine Änderungen zu speichern.')).toBeNull();
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(save);

    await waitFor(async () => expect((await getProject('APP')).name).toBe('Kunden-App 2.0'));
    await waitFor(() => expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull());
    expect(toastTitled('Einstellungen gespeichert')).toBeTruthy();
  });

  it('saves with ⌘↵ from inside a field', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    const name = await textbox('Name');
    await user.type(name, ' 2');

    // the test runs where "mod" is Strg
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });

    await waitFor(async () => expect((await getProject('APP')).name).toBe('Kunden-App 2'));
  });

  it('shows the 422 of the server at the field and moves the focus there', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    const identifier = await textbox('Kennung');

    await user.clear(identifier);
    await user.type(identifier, 'web');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Diese Kennung ist schon vergeben.')).toBeTruthy();
    expect(identifier.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(identifier));
    expect((await getProject('APP')).identifier).toBe('APP');
  });

  it('explains that old keys keep working when the identifier changes, and goes on at the new address', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings/general');
    const identifier = await textbox('Kennung');
    expect(screen.queryByText('Alte Keys funktionieren weiter')).toBeNull();

    await user.clear(identifier);
    await user.type(identifier, 'kapp');
    expect(identifier.value).toBe('KAPP');
    expect(await screen.findByText('Alte Keys funktionieren weiter')).toBeTruthy();
    expect(screen.getByText(/APP-12 leitet danach auf KAPP-12 um/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/KAPP/settings/general'));
    // the old identifier still finds the project
    expect((await getProject('APP')).identifier).toBe('KAPP');
    expect(toastTitled('Kennung geändert')).toBeTruthy();
  });

  it('takes back unsaved changes with "Zurücksetzen"', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    const name = await textbox('Name');

    await user.type(name, ' neu');
    expect(name.value).toBe('Kunden-App neu');
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(name.value).toBe('Kunden-App');
  });
});

describe('unsaved changes', () => {
  it('asks before the page is left with changes, and stays when the person keeps editing', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    const name = await textbox('Name');
    await user.type(name, ' neu');

    await user.click(screen.getByRole('link', { name: 'Mitglieder' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    await user.click(within(dialog).getByRole('button', { name: 'Weiter bearbeiten' }));
    expect(router.state.location.pathname).toBe('/projects/APP/settings');
    expect(name.value).toBe('Kunden-App neu');
  });

  it('lets the person go when they let go of the changes', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    await user.type(await textbox('Name'), ' neu');

    await user.click(screen.getByRole('link', { name: 'Mitglieder' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).getByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/settings/members'));
    expect((await getProject('APP')).name).toBe('Kunden-App');
  });

  it('does not ask when nothing changed, or when the changes were saved', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    const name = await textbox('Name');
    await user.type(name, ' neu');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastTitled('Einstellungen gespeichert')).toBeTruthy());

    await user.click(screen.getByRole('link', { name: 'Mitglieder' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/settings/members'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('warns before the tab is closed or reloaded while there are changes', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    const name = await textbox('Name');
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(false);

    await user.type(name, ' neu');
    expect(closing()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(closing()).toBe(false);
  });
});

describe('DangerZone', () => {
  it('keeps "Projekt löschen" blocked until the identifier is typed exactly', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    await user.click(await screen.findByRole('button', { name: 'Projekt löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'APP löschen?' });
    // the button is drawn anew when it gets its tooltip or loses it, so it is looked up each time
    const confirm = () => within(dialog).getByRole('button', { name: 'Projekt löschen' });
    const typed = within(dialog).getByRole('textbox', { name: /Kennung/ });
    expect(confirm().getAttribute('aria-disabled')).toBe('true');

    await user.type(typed, 'app');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    await user.clear(typed);
    await user.type(typed, 'AP');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    await user.type(typed, 'P');
    expect(confirm().getAttribute('aria-disabled')).toBeNull();
  });

  it('deletes the project when the undo time of five seconds is over, not before', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    await user.click(await screen.findByRole('button', { name: 'Projekt löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'APP löschen?' });
    await user.type(within(dialog).getByRole('textbox', { name: /Kennung/ }), 'APP');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt löschen' }));

    // the person leaves the settings of a project that is on its way out
    expect(await screen.findByText('Alle Projekte')).toBeTruthy();
    const toast = toastTitled('Projekt APP gelöscht');
    expect(toast?.action?.label).toBe('Rückgängig');
    expect((await getProject('APP')).identifier).toBe('APP');

    act(() => dismissToast(toast!.id));
    await waitFor(async () => expect((await failure(getProject('APP'))).status).toBe(404));
  });

  it('leaves for the list of projects without asking about unsaved changes: the deletion is confirmed, and its undo time runs', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    await user.type(await textbox('Name'), ' neu');

    await user.click(screen.getByRole('button', { name: 'Projekt löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'APP löschen?' });
    await user.type(within(dialog).getByRole('textbox', { name: /Kennung/ }), 'APP');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt löschen' }));

    expect(await screen.findByText('Alle Projekte')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects');
    expect(screen.queryByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeNull();
    expect(toastTitled('Projekt APP gelöscht')).toBeTruthy();
  });

  it('asks about unsaved changes again once the deletion is undone', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    await user.type(await textbox('Name'), ' neu');
    await user.click(screen.getByRole('button', { name: 'Projekt löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'APP löschen?' });
    await user.type(within(dialog).getByRole('textbox', { name: /Kennung/ }), 'APP');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt löschen' }));
    await screen.findByText('Alle Projekte');

    act(() => runToastAction(toastTitled('Projekt APP gelöscht')!.id));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/settings'));

    // a form of its own: no edit of the one that was left, and the guard is back
    const name = await textbox('Name');
    expect(name.value).toBe('Kunden-App');
    await user.type(name, ' x');
    await user.click(screen.getByRole('link', { name: 'Mitglieder' }));
    expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
  });

  it('keeps the project when the deletion is undone', async () => {
    const user = userEvent.setup();
    const router = renderSettings('/projects/APP/settings');
    await user.click(await screen.findByRole('button', { name: 'Projekt löschen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'APP löschen?' });
    await user.type(within(dialog).getByRole('textbox', { name: /Kennung/ }), 'APP');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt löschen' }));
    await screen.findByText('Alle Projekte');

    act(() => runToastAction(toastTitled('Projekt APP gelöscht')!.id));

    // back where the person was, and the project is still there
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/APP/settings'));
    expect((await getProject('APP')).identifier).toBe('APP');
  });

  it('archives with five seconds of undo', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    await user.click(await screen.findByRole('button', { name: 'Archivieren' }));

    const toast = toastTitled('Projekt APP archiviert');
    expect(toast?.action?.label).toBe('Rückgängig');
    expect((await getProject('APP')).archived_at).toBeNull();

    act(() => dismissToast(toast!.id));
    await waitFor(async () => expect((await getProject('APP')).archived_at).not.toBeNull());
    // the archived project can be restored from the same place
    expect(await screen.findByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
  });

  it('does not archive when the archiving is undone', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings');
    await user.click(await screen.findByRole('button', { name: 'Archivieren' }));

    act(() => runToastAction(toastTitled('Projekt APP archiviert')!.id));
    expect((await getProject('APP')).archived_at).toBeNull();
    expect(await screen.findByRole('button', { name: 'Archivieren' })).toBeTruthy();
  });

  it('restores an archived project at once', async () => {
    const user = userEvent.setup();
    await archiveProject('p_app');
    renderSettings('/projects/APP/settings');

    expect(await screen.findByText('Dieses Projekt ist archiviert')).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(async () => expect((await getProject('APP')).archived_at).toBeNull());
  });
});
