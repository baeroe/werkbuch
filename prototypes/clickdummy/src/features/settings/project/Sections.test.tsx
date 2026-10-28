import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { listAutomations } from '@/api/automations';
import { createProject, getProject } from '@/api/projects';
import { assignWorkflow, saveWorkflow } from '@/api/workflows';
import { dismissToast, runToastAction } from '@/components/ui/toast';
import { itemsOf, renderSettings, roleOf, textbox, toastTitled, useSettingsTestSetup } from './testing';

useSettingsTestSetup();

describe('Members', () => {
  it('lists the people and bots of the project with their roles and marks the lead', async () => {
    renderSettings('/projects/WEB/settings/members');
    const list = await screen.findByRole('list', { name: 'Mitglieder von WEB' });

    const rows = within(list).getAllByRole('listitem');
    // admins first, then members, then viewers; by name within a role
    expect(rows.map((row) => within(row).getByText(/^@/).textContent)).toEqual(['@ida', '@mara', '@jonas', '@kira', '@lene', '@theo']);
    expect(within(rows[0]).getByText('Lead')).toBeTruthy();
    expect(within(rows[3]).getByText('Bot')).toBeTruthy();
    expect(within(rows[1]).getByText('Org-Admin')).toBeTruthy();
    expect(within(list).getByRole('combobox', { name: 'Rolle von Theo Okafor' }).textContent).toContain('Viewer');
  });

  it('changes a role at once and says so', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/members');

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Jonas Feld' }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));

    await waitFor(async () => expect(await roleOf('WEB', 'u_jonas')).toBe('viewer'));
    expect(toastTitled('Jonas Feld ist jetzt Viewer in WEB')).toBeTruthy();
  });

  it('asks before an admin takes the admin role from themselves, because that ends their access to this screen', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/APP/settings/members', 'u_theo');

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Theo Okafor' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Dir die Admin-Rechte nehmen?' });
    expect(await roleOf('APP', 'u_theo')).toBe('admin');

    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(await roleOf('APP', 'u_theo')).toBe('admin');

    await user.click(await screen.findByRole('combobox', { name: 'Rolle von Theo Okafor' }));
    await user.click(await screen.findByRole('option', { name: 'Member' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rolle ändern' }));
    await waitFor(async () => expect(await roleOf('APP', 'u_theo')).toBe('member'));
  });

  it('keeps the lead in the project and says why', async () => {
    renderSettings('/projects/WEB/settings/members');
    const remove = await screen.findByRole('button', { name: 'Ida Brenner entfernen' });

    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(remove.getAttribute('aria-describedby')!)?.textContent).toContain('Die Lead-Person bleibt Mitglied');
  });

  it('removes a member when the undo time is over, and hides the row meanwhile', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/members');
    await user.click(await screen.findByRole('button', { name: 'Lene Vogt entfernen' }));

    const toast = toastTitled('Lene Vogt aus WEB entfernt');
    expect(toast?.action?.label).toBe('Rückgängig');
    expect(screen.queryByText('@lene')).toBeNull();
    expect(await roleOf('WEB', 'u_lene')).toBe('member');

    act(() => dismissToast(toast!.id));
    await waitFor(async () => expect(await roleOf('WEB', 'u_lene')).toBeUndefined());
  });

  it('keeps the keyboard in the list when a row goes away', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/members');
    const list = await screen.findByRole('list', { name: 'Mitglieder von WEB' });
    await user.click(await screen.findByRole('button', { name: 'Lene Vogt entfernen' }));

    await waitFor(() => expect(list.contains(document.activeElement) && document.activeElement !== list).toBe(true));
  });

  it('brings the row back when the removal is undone', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/members');
    await user.click(await screen.findByRole('button', { name: 'Lene Vogt entfernen' }));

    act(() => runToastAction(toastTitled('Lene Vogt aus WEB entfernt')!.id));
    expect(await screen.findByText('@lene')).toBeTruthy();
    expect(await roleOf('WEB', 'u_lene')).toBe('member');
  });

  it('adds a bot with a role, and offers nobody who is a member already or deactivated', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/members');

    const form = await screen.findByRole('form', { name: 'Mitglied hinzufügen' });
    await user.click(within(form).getByRole('combobox', { name: 'Person oder Bot' }));
    // Sven is deactivated; everybody else is in WEB already
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Automation']);

    await user.click(screen.getByRole('option', { name: 'Automation' }));
    await user.click(within(form).getByRole('combobox', { name: /^Rolle/ }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await user.click(within(form).getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(async () => expect(await roleOf('WEB', 'u_automation')).toBe('viewer'));
    expect(toastTitled('Automation ist jetzt Viewer in WEB')).toBeTruthy();
    expect(await screen.findByText('@automation')).toBeTruthy();
  });

  it('shows the members to Theo in WEB without the controls to change them', async () => {
    renderSettings('/projects/WEB/settings/members', 'u_theo');
    const list = await screen.findByRole('list', { name: 'Mitglieder von WEB' });

    expect(within(list).getByRole('combobox', { name: 'Rolle von Jonas Feld' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /entfernen/ })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Mitglied hinzufügen' })).toBeNull();
  });
});

describe('Workflow', () => {
  it('shows the workflow of the project with its states and how they may be reached', async () => {
    renderSettings('/projects/APP/settings/workflow');

    expect(await screen.findByRole('heading', { name: 'Agentur-Freigabe' })).toBeTruthy();
    const states = screen.getByRole('list', { name: 'Status des Workflows' });
    expect(within(states).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Backlog', 'Todo', 'In Progress', 'Review', 'Kundenfreigabe', 'Done', 'Cancelled']);
    expect(screen.getByText(/14 erlaubte Übergänge/)).toBeTruthy();
  });

  it('asks for a new state for every state with items, proposes one, and rewrites the items', async () => {
    const user = userEvent.setup();
    const before = await itemsOf('p_web');
    const used = [...new Set(before.map((item) => item.state_id))];
    renderSettings('/projects/WEB/settings/workflow');

    await user.click(await screen.findByRole('combobox', { name: /^Neuer Workflow/ }));
    await user.click(await screen.findByRole('option', { name: /Agentur-Freigabe/ }));
    await user.click(screen.getByRole('button', { name: 'Workflow wechseln …' }));

    const dialog = await screen.findByRole('dialog', { name: /Agentur-Freigabe/ });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(used.length);
    // Pending waits like Kundenfreigabe does; Done stays Done
    expect(within(dialog).getByRole('combobox', { name: 'Neuer Status für Pending' }).textContent).toContain('Kundenfreigabe');
    expect(within(dialog).getByRole('combobox', { name: 'Neuer Status für Done' }).textContent).toContain('Done');

    await user.click(within(dialog).getByRole('button', { name: 'Workflow wechseln' }));

    await waitFor(async () => expect((await getProject('WEB')).workflow_id).toBe('wf_agency'));
    const after = await itemsOf('p_web');
    expect(after.every((item) => item.state_id.startsWith('app_'))).toBe(true);
    const wasPending = before.find((item) => item.state_id === 'std_pending')!;
    expect(after.find((item) => item.id === wasPending.id)?.state_id).toBe('app_approval');
    expect(toastTitled('Workflow gewechselt')).toBeTruthy();
  });

  it('lets the person choose another state, and says what that does to the items', async () => {
    const user = userEvent.setup();
    const before = await itemsOf('p_web');
    const done = before.filter((item) => item.state_id === 'std_done');
    renderSettings('/projects/WEB/settings/workflow');
    await user.click(await screen.findByRole('combobox', { name: /^Neuer Workflow/ }));
    await user.click(await screen.findByRole('option', { name: /Agentur-Freigabe/ }));
    await user.click(screen.getByRole('button', { name: 'Workflow wechseln …' }));
    const dialog = await screen.findByRole('dialog', { name: /Agentur-Freigabe/ });
    expect(within(dialog).queryByText(/wieder geöffnet/)).toBeNull();

    await user.click(within(dialog).getByRole('combobox', { name: 'Neuer Status für Done' }));
    await user.click(await screen.findByRole('option', { name: 'Todo' }));

    expect(await within(dialog).findByText(`${done.length} geschlossene Items werden wieder geöffnet.`)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Workflow wechseln' }));
    await waitFor(async () => expect((await getProject('WEB')).workflow_id).toBe('wf_agency'));
    const after = await itemsOf('p_web');
    for (const item of done) expect(after.find((entry) => entry.id === item.id)).toMatchObject({ state_id: 'app_todo', resolution_id: null });
  });

  it('has nothing to map for a project without items', async () => {
    const user = userEvent.setup();
    await createProject({ name: 'Leer', identifier: 'LEER' });
    renderSettings('/projects/LEER/settings/workflow');
    await user.click(await screen.findByRole('combobox', { name: /^Neuer Workflow/ }));
    await user.click(await screen.findByRole('option', { name: /Agentur-Freigabe/ }));
    await user.click(screen.getByRole('button', { name: 'Workflow wechseln …' }));

    const dialog = await screen.findByRole('dialog', { name: /Agentur-Freigabe/ });
    expect(within(dialog).getByText(/Das Projekt hat noch keine Items/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Workflow wechseln' }));
    await waitFor(async () => expect((await getProject('LEER')).workflow_id).toBe('wf_agency'));
  });

  it('keeps the switch from those who may not change it: Theo reads in WEB and is told why', async () => {
    renderSettings('/projects/WEB/settings/workflow', 'u_theo');
    const change = await screen.findByRole('button', { name: 'Workflow wechseln …' });

    expect(change.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(change.getAttribute('aria-describedby')!)?.textContent).toContain('dürfen nur Admins des Projekts WEB');
  });
});

describe('Types', () => {
  it('lists the types of the organisation, ticks the ones the project uses and marks its default', async () => {
    renderSettings('/projects/WEB/settings/types');
    const list = await screen.findByRole('list', { name: 'Typen der Organisation' });

    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    for (const [name, on] of [
      ['Task', true],
      ['Bug', true],
      ['Epic', true],
      ['Kundenwunsch', false],
    ] as const) {
      expect(within(list).getByRole('checkbox', { name: `${name} verwenden` }).getAttribute('aria-checked')).toBe(String(on));
    }
    expect(within(list).getByRole('radio', { name: 'Task als Standardtyp' }).getAttribute('aria-checked')).toBe('true');
    // items per type, counted from the project's own items
    const items = await itemsOf('p_web');
    const bugs = items.filter((item) => item.type_id === 't_bug').length;
    expect(within(within(list).getAllByRole('listitem')[1]).getByText(`${bugs} ${bugs === 1 ? 'Item' : 'Items'}`)).toBeTruthy();
  });

  it('enables another type and makes it the default', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/types');

    await user.click(await screen.findByRole('checkbox', { name: 'Kundenwunsch verwenden' }));
    await user.click(screen.getByRole('radio', { name: 'Kundenwunsch als Standardtyp' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(async () => expect(await getProject('WEB')).toMatchObject({ default_type_id: 't_wish', enabled_type_ids: ['t_task', 't_bug', 't_epic', 't_wish'] }));
    expect(toastTitled('Einstellungen gespeichert')).toBeTruthy();
  });

  it('moves the default on when the default type is switched off', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/types');

    await user.click(await screen.findByRole('checkbox', { name: 'Task verwenden' }));
    expect(screen.getByRole('radio', { name: 'Task als Standardtyp' }).hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByRole('radio', { name: 'Bug als Standardtyp' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(async () => expect(await getProject('WEB')).toMatchObject({ default_type_id: 't_bug', enabled_type_ids: ['t_bug', 't_epic'] }));
  });

  it('keeps the last type that is on switched on', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/types');
    await user.click(await screen.findByRole('checkbox', { name: 'Bug verwenden' }));
    await user.click(screen.getByRole('checkbox', { name: 'Epic verwenden' }));

    expect(screen.getByRole('checkbox', { name: 'Task verwenden' }).hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByText('Mindestens ein Typ bleibt aktiv.')).toBeTruthy();
  });

  it('shows Theo the types of WEB without a way to change them', async () => {
    renderSettings('/projects/WEB/settings/types', 'u_theo');

    expect((await screen.findByRole('checkbox', { name: 'Kundenwunsch verwenden' })).hasAttribute('data-disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  });
});

describe('Automations', () => {
  const switchOf = (name: string) => screen.findByRole('switch', { name });

  it('shows the four automations with the settings of the project', async () => {
    renderSettings('/projects/WEB/settings/automations');

    expect((await switchOf('Auto-Archiv')).getAttribute('aria-checked')).toBe('true');
    expect((await switchOf('Auto-Close')).getAttribute('aria-checked')).toBe('false');
    expect((await switchOf('Eltern schließen')).getAttribute('aria-checked')).toBe('false');
    expect((await switchOf('Assignee beim Start')).getAttribute('aria-checked')).toBe('true');
    // the parameters of the ones that are on
    expect((await textbox('Tage nach dem Schließen')).value).toBe('30');
    expect(screen.queryByRole('textbox', { name: 'Tage ohne Änderung' })).toBeNull();
  });

  it('turns an automation on at once and saves it', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/automations');

    await user.click(await switchOf('Eltern schließen'));

    await waitFor(async () => expect((await listAutomations('p_web')).items.find((entry) => entry.key === 'close_parent')?.enabled).toBe(true));
    expect(toastTitled('Eltern schließen eingeschaltet')).toBeTruthy();
    expect((await switchOf('Eltern schließen')).getAttribute('aria-checked')).toBe('true');
  });

  it('turns Auto-Close on with a Canceled status and the days it waits', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/automations');

    await user.click(await switchOf('Auto-Close'));

    expect((await textbox('Tage ohne Änderung')).value).toBe('90');
    expect(screen.getByRole('combobox', { name: /^Canceled-Status/ }).textContent).toContain('Cancelled');
    await waitFor(async () =>
      expect((await listAutomations('p_web')).items.find((entry) => entry.key === 'auto_close')).toMatchObject({ enabled: true, settings: { days: 90, state_id: 'std_cancelled' } }),
    );
  });

  it('saves the days with Enter, and shows a wrong number at the field', async () => {
    const user = userEvent.setup();
    renderSettings('/projects/WEB/settings/automations');
    const days = await textbox('Tage nach dem Schließen');

    await user.clear(days);
    await user.type(days, '0{Enter}');
    expect(await screen.findByText('Die Tage sind eine ganze Zahl ab 1.')).toBeTruthy();
    expect(days.getAttribute('aria-invalid')).toBe('true');
    expect((await listAutomations('p_web')).items.find((entry) => entry.key === 'auto_archive')?.settings.days).toBe(30);

    await user.clear(days);
    await user.type(days, '45{Enter}');
    await waitFor(async () => expect((await listAutomations('p_web')).items.find((entry) => entry.key === 'auto_archive')?.settings.days).toBe(45));
    await waitFor(() => expect(days.getAttribute('aria-invalid')).toBeNull());
    expect(toastTitled('Auto-Archiv gespeichert')).toBeTruthy();
  });

  it('names the states Auto-Close would skip because the workflow forbids the move to the Canceled status', async () => {
    const user = userEvent.setup();
    const strict = await saveWorkflow({
      name: 'Streng',
      description: '',
      is_default: false,
      is_free: false,
      initial_state_id: 'strict_backlog',
      // only a started item may be canceled
      transitions: [
        ['strict_backlog', 'strict_todo'],
        ['strict_todo', 'strict_progress'],
        ['strict_progress', 'strict_done'],
        ['strict_progress', 'strict_cancelled'],
      ],
      states: [
        { id: 'strict_backlog', name: 'Backlog', icon: 'dashed', category: 'backlog', position: 0 },
        { id: 'strict_todo', name: 'Todo', icon: 'circle', category: 'unstarted', position: 1 },
        { id: 'strict_progress', name: 'In Progress', icon: 'half', category: 'started', position: 2 },
        { id: 'strict_done', name: 'Done', icon: 'check', category: 'completed', position: 3 },
        { id: 'strict_cancelled', name: 'Cancelled', icon: 'cross', category: 'canceled', position: 4 },
      ],
    });
    await assignWorkflow('p_web', strict.id, {
      std_backlog: 'strict_backlog',
      std_todo: 'strict_todo',
      std_progress: 'strict_progress',
      std_pending: 'strict_progress',
      std_done: 'strict_done',
      std_cancelled: 'strict_cancelled',
    });
    renderSettings('/projects/WEB/settings/automations');

    await user.click(await switchOf('Auto-Close'));

    expect(await screen.findByText(/überspringt Items in Backlog und Todo/)).toBeTruthy();
  });

  it('switches Auto-Close off with the reason when the workflow has no Canceled status', async () => {
    const lean = await saveWorkflow({
      name: 'Schlank',
      description: '',
      is_default: false,
      is_free: true,
      initial_state_id: 'lean_todo',
      transitions: [],
      states: [
        { id: 'lean_todo', name: 'Todo', icon: 'circle', category: 'unstarted', position: 0 },
        { id: 'lean_doing', name: 'Doing', icon: 'half', category: 'started', position: 1 },
        { id: 'lean_done', name: 'Done', icon: 'check', category: 'completed', position: 2 },
      ],
    });
    await assignWorkflow('p_web', lean.id, {
      std_backlog: 'lean_todo',
      std_todo: 'lean_todo',
      std_progress: 'lean_doing',
      std_pending: 'lean_doing',
      std_done: 'lean_done',
      std_cancelled: 'lean_done',
    });
    renderSettings('/projects/WEB/settings/automations');
    const autoClose = await switchOf('Auto-Close');

    expect(autoClose.hasAttribute('data-disabled')).toBe(true);
    expect(autoClose.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Der Workflow „Schlank“ hat keinen Status der Kategorie Canceled/)).toBeTruthy();
  });

  it('shows Theo the automations of WEB, switched and unchangeable', async () => {
    renderSettings('/projects/WEB/settings/automations', 'u_theo');

    const archive = await switchOf('Auto-Archiv');
    expect(archive.getAttribute('aria-checked')).toBe('true');
    expect(archive.hasAttribute('data-disabled')).toBe(true);
    expect((await textbox('Tage nach dem Schließen')).readOnly).toBe(true);
  });
});
