/*
 * The field editors of an item against a fake REST API (`mockApi`): what each picker offers, what it sends, how a
 * refusal comes back, and how a read-only field says why. From the clickdummy's `components/fields/fields.test.tsx`,
 * with the gaps of its review (assignee filtering) closed. The date and property editors have their own file
 * (`property/property.test.tsx`).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../lang/en.json';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { useWorkItems } from '@/hooks/workItems';
import { initI18n } from '@/lib/i18n';
import { mockApi, queried, type MockApi, type MockRoute } from '@/test/api';
import {
  agency,
  ida,
  labels,
  lene,
  list,
  makeWorkItem,
  mara,
  organization,
  person,
  project,
  properties,
  queryItems,
  resolutions,
  standard,
  theo,
  types,
  web30,
  web47,
  web48,
} from '@/test/fixtures';
import type { ListedItem, Organization, Project, ProjectMember, Property, User, WorkItem, WorkItemType } from '@/types';
import { AssigneePicker } from './AssigneePicker';
import { addDays, botWord, daysBetween, formatDay, formatNumber, formatPropertyValue, formatShortDay, formatWeekdayDay, relativeDay } from './format';
import { askResolution, askTypeChange, ItemDialogsHost } from './ItemDialogs';
import { projectPeople, useToday } from './itemData';
import { LabelsPicker } from './LabelsPicker';
import { NO_PARENT_OPTION, ParentPicker, parentCandidates } from './ParentPicker';
import { Picker, type PickerOption } from './Picker';
import { PRIORITY_OPTIONS, PriorityPicker } from './PriorityPicker';
import { StatePicker } from './StatePicker';
import { TypeChangeDialog, typeChangeOf, TypePicker } from './TypePicker';

let signedIn: User = lene;
let org: Organization = organization;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization: org }, url: '/items/WEB-47' }),
}));

/* -------------------------------------------------------------------------- data */

const web = project('WEB', 'member');
const app = project('APP', 'member', { workflow_id: 'wf_agency' });

const bot = (id: string, name: string, changes: Partial<User> = {}): User => ({ ...person(id, name, name.toLowerCase()), type: 'bot', email: null, ...changes });
const sven: User = { ...person('u_sven', 'Sven Roth', 'sven'), disabled_at: '2026-09-01T10:00:00.000Z' };
const pixel = bot('u_pixel', 'Pixel');
const kira = bot('u_kira', 'Kira');
const automation = bot('u_automation', 'Automation', { org_role: 'admin', is_default_bot: true });
const users = [mara, ida, lene, theo, sven, pixel, kira, automation];

const member = (user_id: string, role: ProjectMember['role'] = 'member', project_id = 'p_web'): ProjectMember => ({ project_id, user_id, role });
// Mara (org admin) is no member of WEB; Kira is a member of APP only; Sven is deactivated
const webMembers = [member('u_ida', 'admin'), member('u_lene'), member('u_theo', 'viewer'), member('u_sven'), member('u_pixel')];

const app11 = makeWorkItem({ id: 'wi_app_11', project_id: 'p_app', number: 11, key: 'APP-11', title: 'Login mit Face ID', state_id: 'app_todo' });

const problem = (status: number, reason: string, detail: string) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail } });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;


function renderWith(node: ReactNode, routes: Record<string, MockRoute> = {}, { projects = [web, app], items = [web30, web47, web48, app11] }: { projects?: Project[]; items?: WorkItem[] } = {}) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/users': () => ({ body: list(users) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list(webMembers) }),
    'GET /api/v1/projects/p_app/members': () => ({ body: list([member('u_lene', 'member', 'p_app'), member('u_kira', 'member', 'p_app')]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems(items, body)) }),
    ...routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { client, ...view };
}

/** A picker's trigger; it turns into a combobox once the rights have loaded (read-only until then). */
const picker = (name: RegExp) => screen.findByRole('combobox', { name });
/** What an element shows in words, without its decorative parts (icons, avatars with initials). */
function visibleText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent ?? '';
}
const optionTexts = async () => (await screen.findAllByRole('option')).map(visibleText);

/** Types into the search field of the open list once it has the focus (Base UI sets it a frame later). */
/** Two frames: Base UI opens a popup and sets its focus a frame after the render that asks for it. */
const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByRole('combobox', { name: /suchen …$/i });
  await user.click(input);
  await waitFor(() => expect(document.activeElement).toBe(input));
  await user.keyboard(text);
}
const sent = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path).map((call) => call.body);
const toastTitles = () => currentToasts().map((entry) => entry.title);

/** The item as the cache of a project list holds it now: an optimistic change and its rollback show there. */
function FromCache({ id, projectId, children }: { id: string; projectId: string; children: (item: ListedItem) => ReactNode }) {
  const item = useWorkItems({ project_id: projectId }).data?.items.find((entry) => entry.id === id);
  return item ? children(item) : null;
}

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = lene;
  org = organization;
  vi.useRealTimers();
  act(() => resetToasts());
});

/* ---------------------------------------------------------------------- status */

describe('StatePicker', () => {
  it('offers only the states the workflow allows from here', async () => {
    const user = userEvent.setup();
    renderWith(<StatePicker item={app11} />);

    const trigger = await picker(/^Status: Todo$/);
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('S');
    await user.click(trigger);

    // Agentur-Freigabe from Todo: on to In Progress or cancel, never straight to Done
    expect(await optionTexts()).toEqual(['In Progress', 'Cancelled']);
    expect(screen.getByRole('dialog', { name: 'Status wählen' })).toBeTruthy();
  });

  it('moves at once into an open state and gives the focus back to its trigger', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWith(<StatePicker item={app11} onDone={onDone} />, {
      'POST /api/v1/work-items/wi_app_11/transition': () => ({ body: { data: { ...app11, state_id: 'app_progress' } } }),
    });

    const trigger = await picker(/^Status/);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'In Progress' }));

    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_app_11/transition')).toEqual([{ to_state_id: 'app_progress', resolution_id: null }]));
    expect(onDone).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('asks for the resolution on the way into a closed state, with the default chosen', async () => {
    const user = userEvent.setup();
    renderWith(<StatePicker item={web47} />, {
      'POST /api/v1/work-items/wi_web_47/transition': () => ({ body: { data: { ...web47, state_id: 'std_done', resolution_id: 'res_done' } } }),
    });

    const trigger = await picker(/^Status: In Progress$/);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Done' }));

    const dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Done setzen' });
    const done = within(dialog).getByRole('radio', { name: /^Done/ });
    expect(done.getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['DoneStandard', "Won't do", 'Duplicate', 'Cannot reproduce']);
    // nothing moves before the answer
    expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([]);

    // the question takes the focus on the preselected default, so Enter takes it
    await waitFor(() => expect(document.activeElement).toBe(done));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([{ to_state_id: 'std_done', resolution_id: 'res_done' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('takes another resolution with mod+enter, and Escape cancels the move', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWith(<StatePicker item={web47} onDone={onDone} />, {
      'POST /api/v1/work-items/wi_web_47/transition': () => ({ body: { data: { ...web47, state_id: 'std_cancelled' } } }),
    });

    const trigger = await picker(/^Status/);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Done' }));
    let dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Done setzen' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /^Done/ })));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([]);

    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Cancelled' }));
    dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Cancelled setzen' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /^Won't do/ }).getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /^Won't do/ })));
    // the arrows are Base UI's; jsdom has no layout for them
    await user.click(within(dialog).getByRole('radio', { name: 'Duplicate' }));
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Duplicate' }).getAttribute('aria-checked')).toBe('true'));
    // mod+enter anywhere in the dialog takes it
    fireEvent.keyDown(within(dialog).getByText('Die Resolution hält fest, wie die Arbeit endet.'), { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([{ to_state_id: 'std_cancelled', resolution_id: 'res_duplicate' }]));
  });

  it('closes without a choice and says so, and names the dead end of a workflow', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const strict = { ...agency, transitions: agency.transitions.filter(([from]) => from !== 'app_todo') };
    renderWith(<StatePicker item={app11} onDone={onDone} onOpenChange={() => {}} />, { 'GET /api/v1/workflows': () => ({ body: list([standard, strict]) }) });

    await user.click(await picker(/^Status/));
    expect(await screen.findByText('Von „Todo“ führt im Workflow „Agentur-Freigabe“ kein Übergang weiter.')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('says when no status matches the search', async () => {
    const user = userEvent.setup();
    renderWith(<StatePicker item={web47} look="chip" />);

    const trigger = await picker(/^Status/);
    // a row's chip has no shortcut of its own
    expect(trigger.getAttribute('aria-keyshortcuts')).toBeNull();
    await user.click(trigger);
    await search(user, 'zzz');
    expect(await screen.findByText('Kein Status passt.')).toBeTruthy();
  });

  it('shows the loading of the workflow and offers to load it again after a failure', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<StatePicker item={web47} />, {
      'GET /api/v1/workflows': () => (fail ? problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') : { body: list([standard, agency]) }),
    });

    const trigger = await picker(/^Status: wird geladen$/);
    await user.click(trigger);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Die Auswahl konnte nicht geladen werden: Der Server ist gerade nicht erreichbar.');

    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await optionTexts()).toEqual(['Backlog', 'Todo', 'Pending', 'Done', 'Cancelled']);
  });

  it('rolls a refused change back with a toast', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    renderWith(<FromCache id="wi_web_47" projectId="p_web">{(item) => <StatePicker item={item} />}</FromCache>, {
      'POST /api/v1/work-items/wi_web_47/transition': () => problem(409, 'transition_not_allowed', 'Dieser Statuswechsel ist im Workflow nicht erlaubt.'),
    });
    // the answer waits, so the optimistic state shows in between
    const fetching = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/transition')) await held;
      return fetching(input, init);
    };

    await user.click(await picker(/^Status: In Progress$/));
    await user.click(await screen.findByRole('option', { name: 'Pending' }));

    expect(await picker(/^Status: Pending$/)).toBeTruthy();
    release();
    expect(await picker(/^Status: In Progress$/)).toBeTruthy();
    await waitFor(() => expect(toastTitles()).toContain('Statuswechsel nicht gespeichert'));
    expect(currentToasts().find((entry) => entry.title === 'Statuswechsel nicht gespeichert')?.description).toBe('Dieser Statuswechsel ist im Workflow nicht erlaubt.');
  });
});

/* -------------------------------------------------------------------- read-only */

describe('read-only fields', () => {
  /** The reason a read-only trigger reads out (its description). */
  const reasonOf = (trigger: HTMLElement) => document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent;

  it('shows the reason instead of the picker when the item is read-only', async () => {
    // Theo only reads WEB
    signedIn = theo;
    renderWith(
      <>
        <StatePicker item={web47} />
        <PriorityPicker item={{ ...web47, archived_at: '2026-10-30T10:00:00.000Z' }} />
      </>,
      {},
      { projects: [project('WEB', 'viewer')] },
    );

    const state = await screen.findByRole('button', { name: /^Status/ });
    expect(state.getAttribute('aria-disabled')).toBe('true');
    // until the rights have loaded the reason says so, then it names the role
    await waitFor(() => expect(reasonOf(state)).toBe('Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.'));
    expect(screen.queryByRole('combobox')).toBeNull();

    // an archived item is read-only for everybody
    const priority = screen.getByRole('button', { name: 'Priorität: Urgent' });
    expect(reasonOf(priority)).toBe('WEB-47 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.');

    // still in the tab order: the reason is there to be heard
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(state);
  });

  it('keeps the items of an archived project read-only', async () => {
    renderWith(<LabelsPicker item={web47} look="form" />, {}, { projects: [project('WEB', 'member', { archived_at: '2026-10-01T10:00:00.000Z' })] });

    const trigger = await screen.findByRole('button', { name: 'Labels: Formulare, Produktion' });
    await waitFor(() => expect(reasonOf(trigger)).toBe('Das Projekt WEB ist archiviert und schreibgeschützt.'));
  });
});

/* -------------------------------------------------------------------- assignee */

describe('AssigneePicker', () => {
  it('takes the assignee from the people of the project and offers me first', async () => {
    const user = userEvent.setup();
    renderWith(<AssigneePicker item={web47} />, { 'PATCH /api/v1/work-items/wi_web_47': () => ({ body: { data: { ...web47, assignee_id: 'u_lene' } } }) });

    const trigger = await picker(/^Assignee: Ida Brenner$/);
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('A');
    await user.click(trigger);

    // people first by name, then bots; Mara as org admin without membership; no deactivated account (Sven), no bot of
    // another project (Kira), no default bot that is no member (Automation)
    await waitFor(async () =>
      expect(await optionTexts()).toEqual(['Mir zuweisen', 'Nicht zugewiesen', 'Ida Brenner', 'Lene Vogt', 'Mara Lindqvist', 'Theo Okafor', 'PixelBot']),
    );

    await user.click(screen.getByRole('option', { name: 'Mir zuweisen' }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ assignee_id: 'u_lene' }]));
  });

  it('offers a member from the second page of the members', async () => {
    const user = userEvent.setup();
    // more than one page of members: Pixel and Theo come with the cursor
    renderWith(<AssigneePicker item={web47} />, {
      'GET /api/v1/projects/p_web/members': (_body, url) =>
        url.searchParams.get('cursor') === 'm2' ? { body: list(webMembers.slice(2)) } : { body: { data: webMembers.slice(0, 2), links: {}, meta: { next_cursor: 'm2', total: 5 } } },
    });

    await user.click(await picker(/^Assignee/));
    await waitFor(async () => expect(await optionTexts()).toEqual(['Mir zuweisen', 'Nicht zugewiesen', 'Ida Brenner', 'Lene Vogt', 'Mara Lindqvist', 'Theo Okafor', 'PixelBot']));
  });

  it('finds people by their handle, offers no "me" for my own item and takes the assignee away', async () => {
    const user = userEvent.setup();
    const mine = { ...web47, assignee_id: 'u_lene' };
    renderWith(<AssigneePicker item={mine} look="form" />, { 'PATCH /api/v1/work-items/wi_web_47': () => ({ body: { data: { ...mine, assignee_id: null } } }) });

    await user.click(await picker(/^Assignee: Lene Vogt$/));
    await waitFor(async () => expect((await optionTexts())[0]).toBe('Nicht zugewiesen'));
    await search(user, 'pix');
    expect(await optionTexts()).toEqual(['PixelBot']);
    await user.clear(screen.getByRole('combobox', { name: 'Person suchen …' }));
    await search(user, 'niemand');
    await user.click(await screen.findByRole('option', { name: 'Nicht zugewiesen' }));

    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ assignee_id: null }]));
  });

  it('names a bot as a bot and shows only the avatar in a row', async () => {
    renderWith(
      <>
        <AssigneePicker item={{ ...web47, assignee_id: 'u_pixel' }} />
        <AssigneePicker item={{ ...web47, id: 'wi_avatar', assignee_id: 'u_pixel' }} look="avatar" />
        <AssigneePicker item={{ ...web47, id: 'wi_nobody', assignee_id: null }} look="avatar" />
        <AssigneePicker item={{ ...web47, id: 'wi_nobody_field', assignee_id: null }} />
      </>,
    );

    await waitFor(() => expect(screen.getAllByRole('combobox', { name: 'Assignee: Pixel (Bot)' })).toHaveLength(2));
    const [field, avatar] = screen.getAllByRole('combobox', { name: 'Assignee: Pixel (Bot)' });
    expect(field!.textContent).toBe('PixelBot');
    expect(avatar!.textContent).toBe('');
    expect(screen.getAllByRole('combobox', { name: 'Assignee: Nicht zugewiesen' })).toHaveLength(2);
  });

  it('offers to load the people again after a failure', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<AssigneePicker item={web47} />, {
      'GET /api/v1/projects/p_web/members': () => (fail ? problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') : { body: list(webMembers) }),
    });

    await user.click(await picker(/^Assignee/));
    const alert = await screen.findByRole('alert');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(async () => expect(await optionTexts()).toContain('Ida Brenner'));
  });
});

describe('projectPeople', () => {
  it('offers the default bot only where it is a member itself, although it is an org admin', () => {
    const names = (people: User[]) => people.map((user) => user.name);
    expect(names(projectPeople(users, webMembers, 'p_web'))).not.toContain('Automation');
    expect(names(projectPeople(users, [...webMembers, member('u_automation')], 'p_web'))).toContain('Automation');
    // memberships of other projects do not count
    expect(names(projectPeople(users, [member('u_kira', 'member', 'p_app')], 'p_web'))).toEqual(['Mara Lindqvist']);
  });
});

/* -------------------------------------------------------------------- priority */

describe('PriorityPicker', () => {
  it('offers the priorities from Urgent to None and rolls a refused change back with a toast', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    renderWith(<FromCache id="wi_web_47" projectId="p_web">{(item) => <PriorityPicker item={item} />}</FromCache>, {
      'PATCH /api/v1/work-items/wi_web_47': () => problem(422, 'validation_failed', 'Die Eingabe ist ungültig.'),
    });
    const fetching = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'PATCH') await held;
      return fetching(input, init);
    };

    const trigger = await picker(/^Priorität: Urgent$/);
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('P');
    await user.click(trigger);
    expect(await optionTexts()).toEqual(['Urgent', 'High', 'Medium', 'Low', 'None']);
    // the icons name themselves
    expect(screen.getByRole('img', { name: 'Priorität: Urgent' })).toBeTruthy();
    await user.click(screen.getByRole('option', { name: 'Low' }));

    expect(await picker(/^Priorität: Low$/)).toBeTruthy();
    release();
    expect(await picker(/^Priorität: Urgent$/)).toBeTruthy();
    await waitFor(() => expect(toastTitles()).toContain('Änderung nicht gespeichert'));
    expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ priority: 'low' }]);
  });

  it('names the priorities in the language of the page, as Urgent … None in both', () => {
    initI18n({ locale: 'en', translations: en });
    expect(PRIORITY_OPTIONS().map((option) => option.label)).toEqual(['Urgent', 'High', 'Medium', 'Low', 'None']);
  });
});

/* ---------------------------------------------------------------------- labels */

describe('LabelsPicker', () => {
  it('switches labels on and off, keeps the list open and sorts by name', async () => {
    const user = userEvent.setup();
    renderWith(<FromCache id="wi_web_47" projectId="p_web">{(item) => <LabelsPicker item={item} />}</FromCache>, {
      'PATCH /api/v1/work-items/wi_web_47': (body) => ({ body: { data: { ...web47, ...(body as Partial<WorkItem>) } } }),
    });

    const trigger = await picker(/^Labels: Formulare, Produktion$/);
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('L');
    await user.click(trigger);
    expect(await optionTexts()).toEqual(['Formulare', 'Performance', 'Produktion', 'UX']);

    await user.click(screen.getByRole('option', { name: 'UX' }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ label_ids: ['lb_forms', 'lb_production', 'lb_ux'] }]));
    // still open for the next one
    expect(screen.getByRole('option', { name: 'Formulare' })).toBeTruthy();
  });

  it('offers to load the labels again after a failure', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<LabelsPicker item={web47} />, {
      'GET /api/v1/labels': () => (fail ? problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') : { body: list(labels) }),
    });

    // without the catalog the chosen labels have no names yet
    await user.click(await picker(/^Labels: keine$/));
    const alert = await screen.findByRole('alert');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(async () => expect(await optionTexts()).toHaveLength(4));
  });

  it('says what is there when there is nothing', async () => {
    const user = userEvent.setup();
    const bare = { ...web47, label_ids: [] };
    renderWith(
      <>
        <LabelsPicker item={bare} />
        <LabelsPicker item={{ ...bare, id: 'wi_row' }} look="chip" />
        <LabelsPicker item={{ ...web47, id: 'wi_row_chips' }} look="bare" />
      </>,
    );

    const [field, row] = await screen.findAllByRole('combobox', { name: 'Labels: keine' });
    expect(field!.textContent).toBe('Keine Labels');
    expect(row!.textContent).toBe('Label');
    expect(screen.getByRole('combobox', { name: 'Labels: Formulare, Produktion' }).textContent).toBe('FormulareProduktion');

    await user.click(field!);
    await search(user, 'zzz');
    expect(await screen.findByText('Kein Label heißt so. Labels legen Org-Admins in den Einstellungen an.')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------- parent */

describe('ParentPicker', () => {
  it('offers only epics of the project as parent, takes it away and sets another', async () => {
    const user = userEvent.setup();
    // an epic of another project and a task never show
    const opsEpic = makeWorkItem({ id: 'wi_ops_1', project_id: 'p_ops', key: 'OPS-1', type_id: 't_epic', title: 'Umzug' });
    renderWith(
      <>
        <ParentPicker item={web48} />
        <ParentPicker item={{ ...web47, parent_id: null }} look="form" />
      </>,
      { 'PATCH /api/v1/work-items/wi_web_48': () => ({ body: { data: web48 } }), 'PATCH /api/v1/work-items/wi_web_47': () => ({ body: { data: web47 } }) },
      { items: [web30, web47, web48, opsEpic] },
    );

    const withParent = await picker(/^Eltern-Item: WEB-30 Relaunch Phase 1$/);
    expect(withParent.getAttribute('aria-keyshortcuts')).toBe('Shift+P');
    // the icon of the parent's type comes with the parent itself; no list of the project is read before a list opens (A153)
    await waitFor(() => expect(withParent.querySelector('[data-tone="moss"]')).not.toBeNull());
    const projectLists = () => api!.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/work-items/query');
    expect(projectLists()).toEqual([]);
    await user.click(withParent);
    await waitFor(() => expect(projectLists()).toHaveLength(1));
    expect(await optionTexts()).toEqual(['Kein Eltern-Item', 'Relaunch Phase 1WEB-30']);
    await user.click(screen.getByRole('option', { name: 'Kein Eltern-Item' }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([{ parent_id: null }]));

    await user.click(await picker(/^Eltern-Item: keins$/));
    // searching finds the key
    await search(user, 'web-30');
    await user.click(await screen.findByRole('option', { name: /Relaunch Phase 1/ }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ parent_id: 'wi_web_30' }]));
  });

  it('reads every page of the epics of the project, so an epic on a later one is offered', async () => {
    const user = userEvent.setup();
    const epic = makeWorkItem({ id: 'wi_web_31', number: 31, key: 'WEB-31', type_id: 't_epic', title: 'Relaunch Phase 2' });
    renderWith(<ParentPicker item={{ ...web47, parent_id: null }} />, {
      'POST /api/v1/work-items/query': (body) =>
        queried(body).cursor === 'next' ? { body: list([web30]) } : { body: { data: [epic], links: {}, meta: { next_cursor: 'next', total: 2 } } },
    });

    await user.click(await picker(/^Eltern-Item/));
    expect(await optionTexts()).toEqual(['Relaunch Phase 2WEB-31', 'Relaunch Phase 1WEB-30']);
  });

  it('offers only the epics of the project as parents, read lean', async () => {
    const user = userEvent.setup();
    renderWith(<ParentPicker item={{ ...web47, parent_id: null }} />);

    await user.click(await picker(/^Eltern-Item/));
    expect(await optionTexts()).toEqual(['Relaunch Phase 1WEB-30']);
    expect(sent('POST', '/api/v1/work-items/query')).toEqual([
      {
        filter: {
          version: 1,
          conditions: [
            { field: 'project', op: 'is', value: 'p_web' },
            { field: 'epic', op: 'is', value: true },
          ],
        },
        lean: true,
      },
    ]);
  });

  it('says why there is none: the project has no epic yet, or none matches', async () => {
    const user = userEvent.setup();
    renderWith(<ParentPicker item={{ ...web47, parent_id: null }} />, {}, { items: [web47] });

    await user.click(await picker(/^Eltern-Item/));
    expect(await screen.findByText('Im Projekt gibt es noch kein Epic.')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('builds the candidates without the item itself and its descendants, the newest first', () => {
    const typeOf = (id: string) => types.find((type) => type.id === id);
    const epic = (number: number, parent_id: string | null = null) => makeWorkItem({ id: `wi_${number}`, number, key: `WEB-${number}`, type_id: 't_epic', parent_id });
    // a broken chain (epic below epic) must not let the item become its own grandchild's child
    const items = [epic(1), epic(2, 'wi_1'), epic(3, 'wi_2'), epic(4)];
    expect(parentCandidates({ id: 'wi_1', project_id: 'p_web' }, items, typeOf).map((item) => item.key)).toEqual(['WEB-4']);
    expect(parentCandidates({ id: null, project_id: 'p_web' }, items, typeOf).map((item) => item.key)).toEqual(['WEB-4', 'WEB-3', 'WEB-2', 'WEB-1']);
    // broken data with a cycle still ends
    const cycle = [epic(5, 'wi_6'), epic(6, 'wi_5')];
    expect(parentCandidates({ id: 'wi_5', project_id: 'p_web' }, cycle, typeOf)).toEqual([]);
    expect(NO_PARENT_OPTION().label).toBe('Kein Eltern-Item');
  });

  it('says when no epic matches and offers to load again after a failure', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<ParentPicker item={{ ...web47, parent_id: null }} />, {
      'POST /api/v1/work-items/query': () => (fail ? problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') : { body: list([web30]) }),
    });

    await user.click(await picker(/^Eltern-Item/));
    const alert = await screen.findByRole('alert');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('option', { name: /Relaunch/ });
    await search(user, 'zzz');
    expect(await screen.findByText('Kein Epic im Projekt passt.')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------- resolution */

describe('askResolution and ItemDialogsHost', () => {
  const done = standard.states.find((state) => state.id === 'std_done')!;

  it('asks for a command and hands the choice back', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWith(<ItemDialogsHost />);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => askResolution({ subject: '3 Items', target: done, onConfirm }));
    const dialog = await screen.findByRole('dialog', { name: '3 Items auf Done setzen' });
    expect(within(dialog).getByText('Die Resolution hält fest, wie die Arbeit endet.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /^Done/ })));
    await user.click(within(dialog).getByRole('button', { name: /^Auf Done setzen/ }));

    expect(onConfirm).toHaveBeenCalledWith('res_done');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the resolution of an item that stays in its closed category', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWith(<ItemDialogsHost />);

    act(() => askResolution({ subject: 'WEB-40', target: done, from: { category: 'completed', resolutionId: 'res_duplicate' }, onConfirm }));
    const dialog = await screen.findByRole('dialog', { name: 'WEB-40 auf Done setzen' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Duplicate' }).getAttribute('aria-checked')).toBe('true'));
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('waits for the resolutions, and without them takes the default of the server', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    let answer!: () => void;
    renderWith(<ItemDialogsHost />, { 'GET /api/v1/resolutions': () => problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') });
    const fetching = globalThis.fetch;
    const held = new Promise<void>((resolve) => (answer = resolve));
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/resolutions')) await held;
      return fetching(input, init);
    };

    act(() => askResolution({ subject: 'WEB-47', target: done, onConfirm }));
    const dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Done setzen' });
    // the outline shows after a moment, while the resolutions are held
    expect((await within(dialog).findByRole('status')).textContent).toBe('Resolutions werden geladen …');
    // the focus waits in the dialog, never on the page behind it
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    answer();
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Die Resolutions konnten nicht geladen werden. Ohne Auswahl gilt der Standard der Kategorie.',
    );
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: /^Auf Done setzen/ }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });
});

/* -------------------------------------------------------------------------- type */

describe('TypePicker and the type change', () => {
  const [task, bug, epic] = types as [WorkItemType, WorkItemType, WorkItemType];
  const approved: Property = { id: 'pr_approved', key: 'approved', label: 'Freigegeben', field_type: 'boolean', help: '', default_value: null, settings: {}, options: [] };
  // a type of the project that needs a yes/no and the environment
  const release: WorkItemType = {
    ...task,
    id: 't_release',
    name: 'Release',
    properties: [
      { property_id: 'pr_approved', required: true, position: 0 },
      { property_id: 'pr_environment', required: true, position: 1 },
    ],
  };
  const typed = (item: WorkItem): MockRoute => () => ({
    body: { data: { ...item, children: item.id === web30.id ? [web48] : [], relations: [], type: types.find((type) => type.id === item.type_id), workflow: standard, attachments: [] } },
  });
  const retyped = (item: WorkItem): MockRoute => (body) => ({ body: { data: { ...item, type_id: (body as { type_id: string }).type_id } } });
  const routes = (item: WorkItem, extra: Record<string, MockRoute> = {}): Record<string, MockRoute> => ({
    'GET /api/v1/properties': () => ({ body: list([...properties, approved]) }),
    'GET /api/v1/work-item-types': () => ({ body: list([...types, release]) }),
    [`GET /api/v1/work-items/${item.id}`]: typed(item),
    [`PUT /api/v1/work-items/${item.id}/type`]: retyped(item),
    ...extra,
  });
  const webWithRelease = project('WEB', 'member', { enabled_type_ids: ['t_task', 't_bug', 't_epic', 't_release'] });
  const typeCalls = (id: string) => sent('PUT', `/api/v1/work-items/${id}/type`);
  const refused = (errors: Record<string, string[]>) => ({ status: 422, body: { type: 'about:blank', title: 'x', status: 422, reason: 'validation_failed', errors } });

  it('offers the types of the project and changes at once when nothing is lost or needed', async () => {
    const user = userEvent.setup();
    const plain = makeWorkItem({ id: 'wi_web_60', number: 60, key: 'WEB-60', title: 'Footer prüfen', values: { customer: 'opt_moos' } });
    renderWith(<TypePicker item={plain} />, routes(plain));

    const trigger = await picker(/^Typ: Task$/);
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('T');
    await user.click(trigger);
    // Kundenwunsch is not switched on in WEB
    expect(await optionTexts()).toEqual(['Task', 'Bug', 'Epic']);
    await user.click(screen.getByRole('option', { name: 'Epic' }));

    await waitFor(() => expect(typeCalls('wi_web_60')).toEqual([{ type_id: 't_epic', values: {} }]));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(toastTitles()).toContain('WEB-60 hat jetzt den Typ Epic'));
  });

  it('says so in a toast when a change at once fails', async () => {
    const user = userEvent.setup();
    const plain = makeWorkItem({ id: 'wi_web_60', number: 60, key: 'WEB-60' });
    renderWith(<TypePicker item={plain} />, routes(plain, { 'PUT /api/v1/work-items/wi_web_60/type': () => problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') }));

    await user.click(await picker(/^Typ: Task$/));
    await user.click(await screen.findByRole('option', { name: 'Epic' }));
    await waitFor(() => expect(toastTitles()).toContain('Typ nicht geändert'));
    // trying again asks the server again
    act(() => currentToasts().at(-1)!.action!.onClick());
    await waitFor(() => expect(typeCalls('wi_web_60')).toHaveLength(2));
  });

  it('offers to load the types again after a failure', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<TypePicker item={web48} />, routes(web48, { 'GET /api/v1/properties': () => (fail ? problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') : { body: list(properties) }) }));

    await user.click(await picker(/^Typ: Task$/));
    const alert = await screen.findByRole('alert');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('option', { name: 'Epic' })).toBeTruthy();
  });

  it('names lost values before a type change and asks for the required ones', async () => {
    const user = userEvent.setup();
    renderWith(<TypePicker item={web47} />, routes(web47));

    const trigger = await picker(/^Typ: Bug$/);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Task' }));

    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-47 auf Task ändern' });
    expect(within(dialog).getByText('Die Felder von WEB-47 richten sich danach nach Task.')).toBeTruthy();
    const lost = await within(dialog).findByRole('list', { name: 'Diese Werte gehen verloren' });
    expect(within(lost).getAllByRole('listitem').map((entry) => entry.textContent)).toEqual(['UmgebungProduktion']);
    expect(within(dialog).getByText('In der History bleiben sie erhalten.')).toBeTruthy();
    // nothing changes before the answer
    expect(typeCalls('wi_web_47')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: /^Zu Task wechseln/ }));
    await waitFor(() => expect(typeCalls('wi_web_47')).toEqual([{ type_id: 't_task', values: {} }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toastTitles()).toContain('WEB-47 hat jetzt den Typ Task');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('asks for the required values of the new type with the property editors, and shows the refusal at the field', async () => {
    const user = userEvent.setup();
    let refuse = true;
    const plain = makeWorkItem({ id: 'wi_web_61', number: 61, key: 'WEB-61' });
    renderWith(
      <TypePicker item={plain} />,
      routes(plain, {
        'PUT /api/v1/work-items/wi_web_61/type': (body, url) => (refuse ? refused({ 'values.environment': ['„Umgebung“ ist ein Pflichtfeld.'] }) : retyped(plain)(body, url)),
      }),
      { projects: [webWithRelease, app] },
    );

    await user.click(await picker(/^Typ: Task$/));
    await user.click(await screen.findByRole('option', { name: 'Release' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-61 auf Release ändern' });
    const required = await within(dialog).findByRole('region', { name: 'Pflichtfelder von Release' });
    expect(within(dialog).queryByRole('list')).toBeNull();
    expect(within(required).getByText('Release braucht diese Pflichtfelder, bevor der Typ wechselt.')).toBeTruthy();
    // a required yes/no starts off, and off is what it sends (A89)
    expect(within(required).getByRole('switch', { name: 'Freigegeben' }).getAttribute('aria-checked')).toBe('false');

    // mod+Enter sends from anywhere in the dialog
    await user.keyboard('{Control>}{Enter}{/Control}');
    const environment = within(required).getByRole('combobox', { name: /^Umgebung/ });
    expect(await within(dialog).findByText('„Umgebung“ ist ein Pflichtfeld.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(environment));
    expect(typeCalls('wi_web_61')).toEqual([{ type_id: 't_release', values: { approved: false } }]);

    refuse = false;
    await user.click(environment);
    await user.click(await screen.findByRole('option', { name: 'Staging' }));
    await user.click(within(required).getByRole('switch', { name: 'Freigegeben' }));
    await user.click(within(dialog).getByRole('button', { name: /^Zu Release wechseln/ }));
    await waitFor(() => expect(typeCalls('wi_web_61').at(-1)).toEqual({ type_id: 't_release', values: { approved: true, environment: 'opt_env_staging' } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends no type change while a required value cannot be read, and puts the focus there', async () => {
    const user = userEvent.setup();
    // a type of the project that needs the effort
    const estimate: WorkItemType = { ...task, id: 't_estimate', name: 'Schätzung', properties: [{ property_id: 'pr_effort', required: true, position: 0 }] };
    const plain = makeWorkItem({ id: 'wi_web_62', number: 62, key: 'WEB-62' });
    renderWith(<TypePicker item={plain} />, { ...routes(plain), 'GET /api/v1/work-item-types': () => ({ body: list([...types, estimate]) }) }, {
      projects: [project('WEB', 'member', { enabled_type_ids: ['t_task', 't_estimate'] }), app],
    });

    await user.click(await picker(/^Typ: Task$/));
    await user.click(await screen.findByRole('option', { name: 'Schätzung' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-62 auf Schätzung ändern' });
    const effort = await within(dialog).findByRole('textbox', { name: 'Aufwand (h)' });
    await user.type(effort, 'drei');
    await user.click(within(dialog).getByRole('button', { name: /^Zu Schätzung wechseln/ }));

    expect(within(dialog).getByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(effort));
    expect(typeCalls('wi_web_62')).toEqual([]);

    // one that may still become a number says so once the dialog would send
    await user.clear(effort);
    await user.type(effort, '1,');
    await user.click(within(dialog).getByRole('button', { name: /^Zu Schätzung wechseln/ }));
    expect(within(dialog).getByText('Nur eine Zahl eingeben, zum Beispiel 3,5')).toBeTruthy();
    expect(typeCalls('wi_web_62')).toEqual([]);

    await user.type(effort, '5');
    await user.click(within(dialog).getByRole('button', { name: /^Zu Schätzung wechseln/ }));
    await waitFor(() => expect(typeCalls('wi_web_62')).toEqual([{ type_id: 't_estimate', values: { effort: 1.5 } }]));
  });

  it('shows a refusal at a value without a field in the dialog above the fields', async () => {
    const user = userEvent.setup();
    // the type made a property required after the catalog was loaded
    renderWith(<TypeChangeDialog item={web47} target={task} open onOpenChange={() => {}} />, routes(web47, { 'PUT /api/v1/work-items/wi_web_47/type': () => refused({ 'values.note': ['„Notiz“ ist ein Pflichtfeld.'] }) }));

    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-47 auf Task ändern' });
    await user.click(await within(dialog).findByRole('button', { name: /^Zu Task wechseln/ }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Typ nicht geändert„Notiz“ ist ein Pflichtfeld.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('names one required field as one', async () => {
    const user = userEvent.setup();
    renderWith(<TypePicker item={web48} />, routes(web48));

    await user.click(await picker(/^Typ: Task$/));
    await user.click(await screen.findByRole('option', { name: 'Bug' }));
    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-48 auf Bug ändern' });
    expect(await within(dialog).findByText('Bug braucht dieses Pflichtfeld, bevor der Typ wechselt.')).toBeTruthy();
  });

  it('refuses a type change that would break two levels', async () => {
    const user = userEvent.setup();
    renderWith(<TypePicker item={web30} />, routes(web30));

    await user.click(await picker(/^Typ: Epic$/));
    await user.click(await screen.findByRole('option', { name: 'Task' }));
    let dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-30 auf Task ändern' });
    expect(within(dialog).getByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Zu Task wechseln/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /^Typ behalten/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(typeCalls('wi_web_30')).toEqual([]);

    // WEB-48 hangs under WEB-30
    api!.restore();
    renderWith(<TypePicker item={web48} />, routes(web48));
    await user.click(await picker(/^Typ: Task$/));
    await user.click(await screen.findByRole('option', { name: 'Epic' }));
    dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-48 auf Epic ändern' });
    expect(within(dialog).getByText('WEB-48 hat ein Eltern-Item. Epics haben kein Eltern-Item.')).toBeTruthy();
    expect(typeCalls('wi_web_48')).toEqual([]);
  });

  it('shows a refusal of the type itself above the fields, and offers to try again after a failure', async () => {
    const user = userEvent.setup();
    let answer: { status: number; body: unknown } = refused({ type_id: ['Der Typ ist im Projekt nicht aktiviert.'] });
    renderWith(<TypeChangeDialog item={web47} target={task} open onOpenChange={() => {}} />, routes(web47, { 'PUT /api/v1/work-items/wi_web_47/type': () => answer }));

    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-47 auf Task ändern' });
    await user.click(await within(dialog).findByRole('button', { name: /^Zu Task wechseln/ }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Typ nicht geändertDer Typ ist im Projekt nicht aktiviert.');

    answer = problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.');
    await user.click(within(dialog).getByRole('button', { name: /^Zu Task wechseln/ }));
    await waitFor(() => expect(toastTitles()).toContain('Typ nicht geändert'));
    act(() => currentToasts().at(-1)!.action!.onClick());
    await waitFor(() => expect(typeCalls('wi_web_47')).toHaveLength(3));
  });

  it('counts the children of the item, never the list it embeds (A449)', async () => {
    // the embedded list ends after 100; an answer without it still says through `children_progress` that there are some
    const many = { ...web30, children_progress: { done: 0, total: 130 } };
    renderWith(<TypeChangeDialog item={many} target={task} open onOpenChange={() => {}} />, {
      ...routes(many),
      'GET /api/v1/work-items/wi_web_30': () => ({ body: { data: { ...many, children: [], relations: [], type: epic, workflow: standard, attachments: [] } } }),
    });
    expect(await screen.findByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Zu Task wechseln/ })).toBeNull();
  });

  it('says why from what the caller knows before the item has loaded', () => {
    renderWith(<TypeChangeDialog item={web30} target={task} open onOpenChange={() => {}} hasChildren />, routes(web30));
    // the first draw already says no
    expect(screen.getByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Zu Task wechseln/ })).toBeNull();
  });

  it('waits for the item when nothing is known about its children, and goes on when it fails to load', async () => {
    renderWith(<TypeChangeDialog item={web30} target={task} open onOpenChange={() => {}} />, {
      ...routes(web30),
      'GET /api/v1/work-items/wi_web_30': () => problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.'),
    });
    // a task takes no children: until the item says whether it has some, the dialog waits
    expect(screen.getByText('Item wird geladen …')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Zu Task wechseln/ })).toBeNull();
    // the item fails to load: the change is offered, the server decides
    expect(await screen.findByRole('button', { name: /^Zu Task wechseln/ })).toBeTruthy();
  });

  it('shows the fields loading', () => {
    // an epic may have children: nothing to wait for but the catalogs
    renderWith(<TypeChangeDialog item={web47} target={epic} open onOpenChange={() => {}} />, routes(web47));
    expect(screen.getByText('Felder werden geladen …')).toBeTruthy();
  });

  it('asks for a command through ItemDialogsHost', async () => {
    const user = userEvent.setup();
    renderWith(<ItemDialogsHost />, routes(web47));

    act(() => askTypeChange(web47, task));
    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-47 auf Task ändern' });
    expect(await within(dialog).findByText('In der History bleiben sie erhalten.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => askTypeChange(web30, task, true));
    expect(await screen.findByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
  });

  it('counts what a change costs in the order of the fields, and a yes/no that is off as nothing', () => {
    const item = makeWorkItem({ type_id: 't_bug', values: { environment: 'opt_env_local', effort: 2, approved: false, stray: 'x' } });
    const stray: Property = { ...approved, id: 'pr_stray', key: 'stray', label: 'Streuner', field_type: 'text' };
    const all = [...properties, approved, stray];
    expect(typeChangeOf(item, epic, all, types).lost.map((entry) => entry.property.key)).toEqual(['effort', 'environment', 'stray']);
    expect(typeChangeOf(item, bug, all, types)).toEqual({ lost: [{ property: stray, value: 'x' }], missing: [] });
    expect(typeChangeOf(makeWorkItem({ type_id: 't_unknown' }), release, all, types).missing.map((property) => property.key)).toEqual(['approved', 'environment']);
  });
});

/* ------------------------------------------------------------------------ Picker */

describe('Picker', () => {
  const many: PickerOption[] = Array.from({ length: 60 }, (_, index) => ({ value: `o${index}`, label: `Option ${index + 1}`, disabled: index === 0 }));

  it('shows the first fifty of a long list and says how to narrow it', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Picker label="Kunde" display="Option 2" displayText="Option 2" options={many} value="o1" onValueChange={onValueChange} placeholder="Suchen …" look="form" invalid pending />);

    const trigger = screen.getByRole('combobox', { name: 'Kunde: Option 2' });
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    await user.click(trigger);
    expect(await screen.findAllByRole('option')).toHaveLength(50);
    expect(screen.getByText('Die ersten 50 von 60. Tippen grenzt die Liste ein.')).toBeTruthy();

    await search(user, '5');
    // Option 5, 15, 25 … 55: 15 matches, no note
    await waitFor(() => expect(screen.queryByText(/Die ersten 50/)).toBeNull());
    await user.click(screen.getByRole('option', { name: 'Option 5' }));
    expect(onValueChange).toHaveBeenCalledWith('o4');
  });

  it('keeps the focus on the trigger when the rights arrive and the read-only trigger gives way to the picker', () => {
    const props = { label: 'Kunde', display: 'Option 2', displayText: 'Option 2', options: many.slice(0, 3), value: 'o1', onValueChange: vi.fn(), placeholder: 'Suchen …' };
    const view = render(<Picker {...props} disabledReason="Rechte laden noch." />);
    const readOnly = screen.getByRole('button', { name: 'Kunde: Option 2' });
    act(() => readOnly.focus());
    expect(document.activeElement).toBe(readOnly);

    view.rerender(<Picker {...props} />);
    const trigger = screen.getByRole('combobox', { name: 'Kunde: Option 2' });
    expect(trigger).not.toBe(readOnly);
    expect(document.activeElement).toBe(trigger);

    // and back; a trigger that never had the focus does not take it
    view.rerender(<Picker {...props} disabledReason="Im Projekt darfst du nur lesen." />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kunde: Option 2' }));
    act(() => (document.activeElement as HTMLElement).blur());
    view.rerender(<Picker {...props} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the focus when an open picker turns read-only', async () => {
    const user = userEvent.setup();
    const props = { label: 'Kunde', display: 'Option 2', displayText: 'Option 2', options: many.slice(0, 3), value: 'o1', onValueChange: vi.fn(), placeholder: 'Suchen …' };
    const view = render(<Picker {...props} />);
    await user.click(screen.getByRole('combobox', { name: 'Kunde: Option 2' }));
    const input = await screen.findByRole('combobox', { name: /suchen …$/i });
    await waitFor(() => expect(document.activeElement).toBe(input));

    // the rights go while the list is open: the list goes, the focus lands on the read-only trigger
    view.rerender(<Picker {...props} disabledReason="Im Projekt darfst du nur lesen." />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Kunde: Option 2' }));
  });

  it('tells its owner that the rights closed an open list, which stays closed when they come back', async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    const props = { label: 'Kunde', display: 'Option 2', displayText: 'Option 2', options: many.slice(0, 3), value: 'o1', onValueChange: vi.fn(), placeholder: 'Suchen …' };
    function Owned({ reason }: { reason?: string }) {
      const [open, setOpen] = useState(false);
      return (
        <Picker
          {...props}
          disabledReason={reason}
          open={open}
          onOpenChange={(next) => {
            changes.push(next);
            setOpen(next);
          }}
        />
      );
    }
    const view = render(<Owned />);
    await user.click(screen.getByRole('combobox', { name: 'Kunde: Option 2' }));
    await screen.findByRole('combobox', { name: /suchen …$/i });
    view.rerender(<Owned reason="Im Projekt darfst du nur lesen." />);
    expect(changes).toEqual([true, false]);

    view.rerender(<Owned />);
    const trigger = screen.getByRole('combobox', { name: 'Kunde: Option 2' });
    await act(nextFrames);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('combobox', { name: /suchen …$/i })).toBeNull();
  });

  it('opens a list that starts open only that first time, not again after the rights went and came back', async () => {
    const props = { label: 'Kunde', display: 'Option 2', displayText: 'Option 2', options: many.slice(0, 3), value: 'o1', onValueChange: vi.fn(), placeholder: 'Suchen …', defaultOpen: true };
    const view = render(<Picker {...props} />);
    expect(await screen.findAllByRole('option')).toHaveLength(3);
    view.rerender(<Picker {...props} disabledReason="Im Projekt darfst du nur lesen." />);
    expect(screen.getByRole('button', { name: 'Kunde: Option 2' }).getAttribute('aria-disabled')).toBe('true');

    view.rerender(<Picker {...props} />);
    const trigger = screen.getByRole('combobox', { name: 'Kunde: Option 2' });
    await act(nextFrames);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toEqual([]);
  });

  it('changes nothing when the chosen value is chosen again, and opens at once without taking the focus', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <>
        <button type="button">Davor</button>
        <Picker label="Kunde" display="Option 2" displayText="Option 2" options={many.slice(0, 3)} value="o1" onValueChange={onValueChange} placeholder="Suchen …" defaultOpen modal={false} keepSide />
      </>,
    );
    screen.getByRole('button', { name: 'Davor' }).focus();

    expect(await screen.findAllByRole('option')).toHaveLength(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Davor' }));
    await user.click(screen.getByRole('option', { name: 'Option 2' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ format */

describe('format', () => {
  it('formats days in the time zone of the organisation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 UTC: still the 30th in New York, already the 31st in Berlin
    vi.setSystemTime(new Date('2026-10-30T23:30:00.000Z'));
    function Due() {
      const { today, weekStart } = useToday();
      return (
        <p>
          {today} {relativeDay('2026-10-31', today)} {weekStart}
        </p>
      );
    }

    org = { ...organization, timezone: 'America/New_York', week_start: 0 };
    const { unmount } = renderWith(<Due />);
    expect(screen.getByText('2026-10-30 morgen 0')).toBeTruthy();
    unmount();

    org = organization;
    renderWith(<Due />);
    expect(screen.getByText('2026-10-31 heute 1')).toBeTruthy();
  });

  it('reads days, numbers and the bot word in the language of the page', () => {
    expect([formatDay('2026-10-31'), formatShortDay('2026-10-31'), formatWeekdayDay('2026-10-30')]).toEqual(['31.10.2026', '31.10.', 'Fr., 30.10.']);
    expect([addDays('2026-10-31', 1), daysBetween('2026-10-31', '2026-10-28'), relativeDay('2026-10-28', '2026-10-31')]).toEqual(['2026-11-01', -3, 'vor 3 Tagen']);
    expect([formatNumber(1500), formatNumber(1500, 0, { grouping: false }), formatNumber(3.456, 1), formatNumber(3)]).toEqual(['1.500', '1500', '3,5', '3']);
    expect([botWord(pixel), botWord(lene)]).toEqual(['Bot', undefined]);

    initI18n({ locale: 'en', translations: en });
    expect([formatDay('2026-10-31'), relativeDay('2026-11-01', '2026-10-31'), formatNumber(1500.5, 1)]).toEqual(['31/10/2026', 'tomorrow', '1,500.5']);
  });

  it('reads every kind of property value as one line', () => {
    const [customer, effort] = properties as [Property, Property];
    const of = (field_type: Property['field_type'], settings: Property['settings'] = {}): Property => ({ ...effort, field_type, settings });
    const name = (id: string) => (id === 'u_ida' ? 'Ida Brenner' : 'Unbekannt');
    const long = 'Ein sehr langer Text, der für eine Zeile in der Liste viel zu lang ist und deshalb gekürzt wird, damit es passt.';

    expect(formatPropertyValue(effort, undefined, name)).toBe('');
    expect(formatPropertyValue(effort, null, name)).toBe('');
    expect(formatPropertyValue(effort, 3.5, name)).toBe('3,5');
    expect(formatPropertyValue(of('number'), 1500, name)).toBe('1.500');
    expect(formatPropertyValue(effort, '3,5', name)).toBe('3,5');
    expect([formatPropertyValue(of('boolean'), true, name), formatPropertyValue(of('boolean'), false, name)]).toEqual(['Ja', 'Nein']);
    expect([formatPropertyValue(of('date'), '2026-10-31', name), formatPropertyValue(of('date'), 5, name)]).toEqual(['31.10.2026', '']);
    expect(formatPropertyValue({ ...customer, settings: { multiple: true } }, ['opt_moos', 'opt_gone'], name)).toBe('Gärtnerei Moos, Unbekannte Option');
    expect(formatPropertyValue(of('member'), ['u_ida', 'u_x'], name)).toBe('Ida Brenner, Unbekannt');
    expect(formatPropertyValue(of('rich_text'), { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kurz.' }] }] }, name)).toBe('Kurz.');
    expect(formatPropertyValue(of('rich_text'), { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: long }] }] }, name)).toBe(
      `${long.slice(0, 79).trimEnd()}…`,
    );
    expect([formatPropertyValue(of('text'), 'Safari', name), formatPropertyValue(of('url'), 'https://example.com', name)]).toEqual(['Safari', 'https://example.com']);
  });
});
