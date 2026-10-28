import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as projectsApi from '@/api/projects';
import { archiveProject, deleteProject, getProject, listMembers, listProjects, removeMember, updateProject } from '@/api/projects';
import { listFavorites } from '@/api/views';
import { listWorkItems } from '@/api/workItems';
import { currentToasts, dismissToast, runToastAction } from '@/components/ui/toast';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { ProjectsScreen } from './ProjectsScreen';

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
  vi.restoreAllMocks();
});

function renderProjects(path = '/projects') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/projects', element: <ProjectsScreen /> },
      { path: '/projects/:identifier', element: <p>ein Projekt</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

/** The list once the projects are there. */
const loaded = () => screen.findByRole('link', { name: 'Website-Relaunch' });
/** The card of a project. */
const cardOf = (name: string) => screen.getByRole('link', { name }).closest('li')!;
const toastTitles = () => currentToasts().map((item) => item.title);

const OPEN = ['backlog', 'unstarted', 'started'];
async function openItems(projectId: string): Promise<number> {
  const page = await listWorkItems({
    per_page: 1,
    filter: {
      version: 1,
      conditions: [
        { field: 'project', op: 'in', value: [projectId] },
        { field: 'state_category', op: 'in', value: OPEN },
      ],
    },
  });
  return page.total;
}

describe('the list', () => {
  it('shows every project with its identifier, lead, visibility and open items', async () => {
    renderProjects();
    await loaded();

    expect(screen.getByRole('heading', { level: 1, name: 'Projekte' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    const web = cardOf('Website-Relaunch');
    expect(within(web).getByText('WEB')).toBeTruthy();
    expect(within(web).getByText('Ida Brenner')).toBeTruthy();
    expect(within(web).getByText('Öffentlich')).toBeTruthy();
    expect(within(web).getByText(/Neuer Webauftritt/)).toBeTruthy();
    expect(within(cardOf('Kunden-App')).getByText('Theo Okafor')).toBeTruthy();
    expect(within(cardOf('Infrastruktur')).getByText('Jonas Feld')).toBeTruthy();
    expect(within(cardOf('Infrastruktur')).getByText('Privat')).toBeTruthy();

    // the number comes from the items themselves: the same filter, counted by the server
    for (const [name, id] of [
      ['Website-Relaunch', 'p_web'],
      ['Kunden-App', 'p_app'],
      ['Infrastruktur', 'p_ops'],
    ] as const) {
      const open = await openItems(id);
      expect(open).toBeGreaterThan(1);
      await waitFor(() => expect(within(cardOf(name)).getByText(`${open} offen`)).toBeTruthy());
    }
  });

  it('is in the order of the names', async () => {
    renderProjects();
    await loaded();

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Infrastruktur', 'Kunden-App', 'Website-Relaunch']);
  });

  it('leads to the project on a click on its name', async () => {
    const user = userEvent.setup();
    const { router } = renderProjects();
    await loaded();

    await user.click(screen.getByRole('link', { name: 'Kunden-App' }));

    expect(router.state.location.pathname).toBe('/projects/APP');
  });

  it('shows the mark of a project: its image, or its initial on the tone of the project', async () => {
    await updateProject('APP', { image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' });
    renderProjects();
    await loaded();

    expect(cardOf('Kunden-App').querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/gif/);
    expect(cardOf('Website-Relaunch').querySelector('img')).toBeNull();
    expect(within(cardOf('Website-Relaunch')).getByText('W', { selector: 'span[data-tone]' })).toBeTruthy();
  });

  it('says what the person is in each project', async () => {
    renderProjects();
    await loaded();

    // Mara: admin of WEB, member of APP and OPS (and org admin)
    await waitFor(() => expect(within(cardOf('Website-Relaunch')).getByText('Admin')).toBeTruthy());
    expect(within(cardOf('Kunden-App')).getByText('Member')).toBeTruthy();
  });
});

describe('joining', () => {
  it('offers "Beitreten" for a public project the person is not in, and for no other', async () => {
    asUser('u_ida');
    renderProjects();
    await loaded();

    // Ida: admin of WEB, not in APP (public); OPS is private and not even shown
    expect(await within(cardOf('Kunden-App')).findByRole('button', { name: 'Beitreten' })).toBeTruthy();
    expect(within(cardOf('Website-Relaunch')).queryByRole('button', { name: 'Beitreten' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Infrastruktur' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Beitreten' })).toHaveLength(1);
  });

  it('offers it to an org admin as well, who sees every project but is in none of them yet', async () => {
    await removeMember('APP', 'u_mara');
    renderProjects();
    await loaded();

    expect(await within(cardOf('Kunden-App')).findByRole('button', { name: 'Beitreten' })).toBeTruthy();
    expect(within(cardOf('Kunden-App')).getByText('Du liest nur mit.')).toBeTruthy();
  });

  it('offers nothing for a private project the org admin is not in: it is not joined, it is administered', async () => {
    await removeMember('OPS', 'u_mara');
    renderProjects();
    await loaded();

    expect(await within(cardOf('Infrastruktur')).findByText('Kein Mitglied')).toBeTruthy();
    expect(within(cardOf('Infrastruktur')).queryByRole('button', { name: 'Beitreten' })).toBeNull();
  });

  it('does not offer it to somebody who is in the project as a viewer', async () => {
    asUser('u_theo');
    renderProjects();
    await loaded();

    // Theo: a viewer in WEB, admin in APP
    await waitFor(() => expect(within(cardOf('Website-Relaunch')).getByText('Viewer')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Beitreten' })).toBeNull();
  });

  it('joins with one click: the card shows the role at once, a toast confirms it', async () => {
    const user = userEvent.setup();
    asUser('u_ida');
    renderProjects();
    await loaded();

    await user.click(await within(cardOf('Kunden-App')).findByRole('button', { name: 'Beitreten' }));

    await waitFor(() => expect(within(cardOf('Kunden-App')).getByText('Member')).toBeTruthy());
    expect(within(cardOf('Kunden-App')).queryByRole('button', { name: 'Beitreten' })).toBeNull();
    expect(toastTitles()).toContain('Du bist Kunden-App beigetreten');
    expect((await listMembers('APP')).items.some((member) => member.user_id === 'u_ida' && member.role === 'member')).toBe(true);
  });

  it('says why when it fails and offers a retry for a server failure', async () => {
    const user = userEvent.setup();
    asUser('u_ida');
    renderProjects();
    await loaded();
    const join = await within(cardOf('Kunden-App')).findByRole('button', { name: 'Beitreten' });
    localStorage.setItem('api:fail', '1');

    await user.click(join);

    await waitFor(() => expect(currentToasts().some((item) => item.tone === 'error')).toBe(true));
    const error = currentToasts().find((item) => item.tone === 'error')!;
    expect(error.title).toBe('Beitritt zu Kunden-App nicht möglich');
    expect(error.action?.label).toBe('Erneut versuchen');
    expect(within(cardOf('Kunden-App')).getByRole('button', { name: 'Beitreten' })).toBeTruthy();

    localStorage.removeItem('api:fail');
    act(() => runToastAction(error.id));
    await waitFor(() => expect(within(cardOf('Kunden-App')).getByText('Member')).toBeTruthy());
  });
});

describe('favorites', () => {
  it('puts a project into the sidebar with its star', async () => {
    const user = userEvent.setup();
    asUser('u_ida');
    renderProjects();
    await loaded();

    // Ida has WEB as a favorite, not APP
    expect(within(cardOf('Website-Relaunch')).getByRole('button', { name: '„Website-Relaunch“ aus der Seitenleiste nehmen' })).toBeTruthy();
    await user.click(within(cardOf('Kunden-App')).getByRole('button', { name: '„Kunden-App“ in die Seitenleiste legen' }));

    expect(await within(cardOf('Kunden-App')).findByRole('button', { name: '„Kunden-App“ aus der Seitenleiste nehmen' })).toBeTruthy();
    expect((await listFavorites()).items.some((favorite) => favorite.kind === 'project' && favorite.id === 'p_app')).toBe(true);
  });
});

describe('archived projects', () => {
  it('stay out of the list, and a switch shows them once there is one', async () => {
    const user = userEvent.setup();
    await archiveProject('OPS');
    renderProjects();
    await loaded();

    expect(screen.queryByRole('link', { name: 'Infrastruktur' })).toBeNull();
    await user.click(await screen.findByRole('switch', { name: 'Archivierte zeigen' }));

    const card = cardOf('Infrastruktur');
    expect(within(card).getByText('Archiviert')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Beitreten' })).toBeNull();
  });

  it('still count their open items, which only stay out of the lists', async () => {
    const before = await openItems('p_ops');
    expect(before).toBeGreaterThan(0);
    await archiveProject('OPS');
    renderProjects('/projects?archived=1');
    await screen.findByRole('link', { name: 'Infrastruktur' });

    await waitFor(() => expect(within(cardOf('Infrastruktur')).getByText(`${before} offen`)).toBeTruthy());
  });

  it('show from the address as well: ?archived=1 has the switch on', async () => {
    await archiveProject('OPS');
    renderProjects('/projects?archived=1');

    expect(await screen.findByRole('link', { name: 'Infrastruktur' })).toBeTruthy();
    expect((await screen.findByRole('switch', { name: 'Archivierte zeigen' })).getAttribute('aria-checked')).toBe('true');
  });

  it('have no switch while there is none', async () => {
    renderProjects();
    await loaded();

    expect(screen.queryByRole('switch', { name: 'Archivierte zeigen' })).toBeNull();
  });
});

describe('the dialog "Neues Projekt"', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /Neues Projekt/ }));
    return screen.findByRole('dialog', { name: 'Neues Projekt' });
  };
  const nameField = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
  const identifierField = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Kennung' }) as HTMLInputElement;

  it('opens from the button, by ?create=1 (the sidebar), and closes without a trace', async () => {
    const user = userEvent.setup();
    const { router } = renderProjects('/projects?create=1');

    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');

    await open(user);
    expect(screen.getByRole('dialog', { name: 'Neues Projekt' })).toBeTruthy();
    expect((await listProjects()).items).toHaveLength(3);
  });

  it('is open to every member', async () => {
    asUser('u_theo');
    renderProjects();
    await loaded();

    await waitFor(() => expect(screen.getByRole('button', { name: /Neues Projekt/ }).getAttribute('aria-disabled')).toBeNull());
  });

  it('fills the identifier with a suggestion for the name while the person types, and takes the taken ones into account', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Neues Portal');
    expect(identifierField(dialog).value).toBe('NEU');

    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Website-Relaunch');
    // WEB is a project already
    expect(identifierField(dialog).value).toBe('WER');

    await user.clear(nameField(dialog));
    await user.type(nameField(dialog), 'Ärzte-Portal');
    expect(identifierField(dialog).value).toBe('AER');
  });

  it('lets the person write their own identifier, which stays when the name goes on', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Zeiterfassung');
    expect(identifierField(dialog).value).toBe('ZEI');
    await user.clear(identifierField(dialog));
    await user.type(identifierField(dialog), 'zt2');
    // capital letters, as an identifier is written
    expect(identifierField(dialog).value).toBe('ZT2');

    await user.type(nameField(dialog), ' Mobil');
    expect(identifierField(dialog).value).toBe('ZT2');
  });

  it('accepts free text in the identifier and leaves the judging to the server', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Zeiterfassung');
    await user.clear(identifierField(dialog));
    // nothing is blocked while typing, not a hyphen and not a eleventh letter
    await user.type(identifierField(dialog), 'z-t2abcdefghi');
    expect(identifierField(dialog).value).toBe('Z-T2ABCDEFGHI');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));

    expect(await within(dialog).findByText('Die Kennung hat 2 bis 10 Großbuchstaben oder Ziffern und beginnt mit einem Buchstaben.')).toBeTruthy();
    expect(identifierField(dialog).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(identifierField(dialog));
  });

  it('creates the project with what the dialog holds, and shows it in the list', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Zeiterfassung');
    await user.click(within(dialog).getByRole('button', { name: 'Privat' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Epic/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const project = await getProject('ZEI');
    expect(project).toMatchObject({ name: 'Zeiterfassung', identifier: 'ZEI', visibility: 'private', lead_id: 'u_mara', workflow_id: 'wf_standard', default_type_id: 't_task' });
    expect(project.enabled_type_ids).toEqual(['t_task', 't_bug']);
    expect(await screen.findByRole('link', { name: 'Zeiterfassung' })).toBeTruthy();
    expect(toastTitles()).toContain('Projekt ZEI angelegt');
    // the new card shows for a moment, as a live change does
    expect(useUiStore.getState().flashIds).toContain('p_zei');
  });

  it('offers to open the new project in the toast', async () => {
    const user = userEvent.setup();
    const { router } = renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Zeiterfassung');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    await waitFor(() => expect(currentToasts().some((item) => item.title === 'Projekt ZEI angelegt')).toBe(true));
    const toastItem = currentToasts().find((item) => item.title === 'Projekt ZEI angelegt')!;
    expect(toastItem.action?.label).toBe('Öffnen');
    act(() => runToastAction(toastItem.id));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/ZEI'));
  });

  it('shows the error of the server at the identifier when it is taken, also by a project the person does not see', async () => {
    const user = userEvent.setup();
    asUser('u_ida');
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Operations');
    await user.clear(identifierField(dialog));
    // OPS is a private project of others: Ida sees nothing of it, only the server knows
    await user.type(identifierField(dialog), 'ops');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));

    await waitFor(() => expect(identifierField(dialog).getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('Diese Kennung ist schon vergeben.')).toBeTruthy();
    expect(document.activeElement).toBe(identifierField(dialog));
    expect(screen.getByRole('dialog', { name: 'Neues Projekt' })).toBeTruthy();

    // the error leaves with the next change of the field, and the project can be made
    await user.clear(identifierField(dialog));
    await user.type(identifierField(dialog), 'OPR');
    expect(identifierField(dialog).getAttribute('aria-invalid')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await getProject('OPR')).name).toBe('Operations');
  });

  it('shows the error at the name when it is empty, and at the types when none is chosen', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    await waitFor(() => expect(nameField(dialog).getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('Der Name darf nicht leer sein.')).toBeTruthy();
    expect(document.activeElement).toBe(nameField(dialog));

    await user.type(nameField(dialog), 'Zeiterfassung');
    for (const type of ['Task', 'Bug', 'Epic']) await user.click(within(dialog).getByRole('checkbox', { name: new RegExp(type) }));
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));

    expect(await within(dialog).findByText('Mindestens ein Typ muss aktiviert sein.')).toBeTruthy();
    expect(nameField(dialog).getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Neues Projekt' })).toBeTruthy();
  });

  it('submits with mod+enter from a field', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.type(nameField(dialog), 'Zeiterfassung');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await getProject('ZEI')).name).toBe('Zeiterfassung');
  });

  it('says why when the server is out, and keeps what was typed', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);
    await user.type(nameField(dialog), 'Zeiterfassung');
    localStorage.setItem('api:fail', '1');

    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));

    await waitFor(() => expect(currentToasts().some((item) => item.tone === 'error')).toBe(true));
    expect(currentToasts().find((item) => item.tone === 'error')?.title).toBe('Projekt nicht angelegt');
    expect(nameField(dialog).value).toBe('Zeiterfassung');
    expect(screen.getByRole('dialog', { name: 'Neues Projekt' })).toBeTruthy();
  });

  it('keeps the focus where the person types, also while two errors stand and one goes', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    // an identifier of their own that is none, and no name: two errors at once
    await user.click(identifierField(dialog));
    await user.type(identifierField(dialog), 'a-b');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    await waitFor(() => expect(nameField(dialog).getAttribute('aria-invalid')).toBe('true'));
    expect(identifierField(dialog).getAttribute('aria-invalid')).toBe('true');
    // the first error takes the focus once, right after the send
    expect(document.activeElement).toBe(nameField(dialog));

    // typing changes the error state with the first letter, and must not move the focus (WCAG 3.2.2)
    await user.type(nameField(dialog), 'Zeiterfassung');

    expect(nameField(dialog).value).toBe('Zeiterfassung');
    expect(identifierField(dialog).value).toBe('A-B');
    expect(document.activeElement).toBe(nameField(dialog));
  });

  it('takes the focus to the first error after every send that fails, not only the first', async () => {
    const user = userEvent.setup();
    renderProjects();
    await loaded();
    const dialog = await open(user);

    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    await waitFor(() => expect(document.activeElement).toBe(nameField(dialog)));
    // the name is made good, the identifier is not: the next send brings the focus to the identifier
    await user.type(nameField(dialog), 'Zeiterfassung');
    await user.clear(identifierField(dialog));
    await user.type(identifierField(dialog), 'a-b');
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));

    await waitFor(() => expect(identifierField(dialog).getAttribute('aria-invalid')).toBe('true'));
    await waitFor(() => expect(document.activeElement).toBe(identifierField(dialog)));
  });

  it('makes one project when mod+enter is pressed twice before the server answers', async () => {
    const user = userEvent.setup();
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const original = projectsApi.createProject;
    const create = vi.spyOn(projectsApi, 'createProject').mockImplementation(async (input) => {
      await gate;
      return original(input);
    });
    renderProjects();
    await loaded();
    const dialog = await open(user);
    await user.type(nameField(dialog), 'Zeiterfassung');

    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    answer();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // one call: a second would only be refused as taken, and show an error behind the closing dialog
    expect(create).toHaveBeenCalledTimes(1);
    expect((await listProjects()).items.filter((project) => project.identifier === 'ZEI')).toHaveLength(1);
    expect(toastTitles().filter((title) => title === 'Projekt ZEI angelegt')).toHaveLength(1);
  });
});

describe('the states', () => {
  it('shows a skeleton in the shape of the cards while the projects load', async () => {
    renderProjects();

    expect(screen.getByText('Projekte werden geladen …')).toBeTruthy();
    await loaded();
    expect(screen.queryByText('Projekte werden geladen …')).toBeNull();
  });

  it('explains an empty list and offers the first project', async () => {
    for (const project of (await listProjects()).items) await deleteProject(project.id);
    renderProjects();

    expect(await screen.findByText('Noch keine Projekte')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Neues Projekt/ }).length).toBeGreaterThan(0);
  });

  it('shows the cause and "Erneut versuchen" when the server fails', async () => {
    const user = userEvent.setup();
    localStorage.setItem('api:fail', '1');
    renderProjects();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Die Projekte konnten nicht geladen werden')).toBeTruthy();
    expect(within(alert).getByText(/Simulierter Serverfehler/)).toBeTruthy();

    localStorage.removeItem('api:fail');
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await loaded();
  });
});
