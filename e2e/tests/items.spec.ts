import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eProject, createItem, isPhone, PEOPLE, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';
import { typeId } from '../timelineHelpers';

// The page of an item with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Each test
// works in a project of its own (`E2E …`, removed in `finally`); its items come over the API. The item commands (s, a,
// p, mod+backspace) open the palette's sub-lists or act at once; the follow-up questions give the focus back to the title.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** The id of the state named `state` in the workflow named `workflow`. */
async function stateId(page: Page, workflow: string, state: string): Promise<string> {
  const entry = (await allEntries(page, 'workflows')).find((item) => item.name === workflow) as { states: { id: string; name: string }[] } | undefined;
  const found = entry?.states.find((item) => item.name === state);
  if (!found) throw new Error(`No state "${state}" in workflow "${workflow}"`);
  return found.id;
}

/**
 * Opens the page of an item and waits until its fields can be changed and its commands act: the palette lists a
 * command only once what it reads is there (before, its key says "One moment").
 */
async function openItem(page: Page, key: string, title: string) {
  await page.goto(`/items/${key}`);
  const heading = page.getByRole('heading', { level: 1, name: title });
  await expect(heading).toBeVisible();
  const fields = page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') });
  await expect(fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.state.label')}: `) })).toBeVisible();

  await pressMod(page, 'k');
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.state')}`) })).toBeVisible();
  // "Assign …" waits for the people of the project as well
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.assignee')}`) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  return { heading, fields };
}

/**
 * Removes the project of a test, from a page outside it: the item page would load its item again after the delete
 * (a change settling, the focus coming back) and report the 404.
 */
async function cleanUp(page: Page, identifier: string) {
  await page.goto('/my-items');
  await removeE2eProject(page, identifier);
}

/** The field editor `label` with its value, as the panel names it ("Status: Done"). */
const field = (scope: Locator, label: string, value: string) =>
  scope.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label, value })}`) });

/** Opens the palette's sub-list of an item command with its key and waits until its input has the focus. */
async function subList(page: Page, key: string, label: string) {
  await page.keyboard.press(key);
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  const input = palette.getByRole('combobox', { name: tr('en', label) });
  await expect(input).toBeFocused();
  return palette;
}

test('sets a closing status with the resolution prefilled', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('closing'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Impressum aktualisieren' });
    const { heading, fields } = await openItem(page, item.key, 'E2E Impressum aktualisieren');

    await subList(page, 's', 'shortcuts.item.state');
    await page.keyboard.type('done');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: tr('en', 'items.fields.resolution.title', { subject: item.key, state: 'Done' }) });
    await expect(dialog).toBeVisible();
    const done = dialog.getByRole('radio', { name: /^Done/ });
    await expect(done).toBeChecked();
    await expect(done).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(field(fields, tr('en', 'items.fields.state.label'), 'Done')).toBeVisible();
    // a closed item names its resolution
    await expect(fields.getByText(tr('en', 'items.detail.fields.resolution'), { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('Done');
    // nothing else had the focus: it goes back to the title
    await expect(heading.getByRole('button')).toBeFocused();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('offers only allowed states in a restricted workflow', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('restricted'), { workflow: 'Agentur-Freigabe', types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Startseite freigeben', state_id: await stateId(page, 'Agentur-Freigabe', 'Todo') });
    const { fields } = await openItem(page, item.key, 'E2E Startseite freigeben');

    const palette = await subList(page, 's', 'shortcuts.item.state');
    await expect(palette.getByRole('option', { name: 'In Progress', exact: true })).toBeVisible();
    await expect(palette.getByRole('option', { name: 'Cancelled', exact: true })).toBeVisible();
    await expect(palette.getByRole('option', { name: 'Done', exact: true })).toHaveCount(0);
    await expect(palette.getByRole('option', { name: 'Review', exact: true })).toHaveCount(0);

    await page.keyboard.type('in progress');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(field(fields, tr('en', 'items.fields.state.label'), 'In Progress')).toBeVisible();
    await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.state', { state: 'In Progress' }) }))).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('changes assignee and priority with a and p', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('assignee'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Formular prüfen' });
    const { fields } = await openItem(page, item.key, 'E2E Formular prüfen');
    const assignee = tr('en', 'items.fields.assignee.label');

    if (isPhone(page)) {
      // on the phone through the fields (spec 5.1): the status, then the assignee
      await tabTo(page, field(fields, tr('en', 'items.fields.state.label'), 'Backlog'), { max: 80 });
      await page.keyboard.press('Enter');
      // typed only once the search field has the focus: before, the letters would be the page's shortcuts
      await expect(page.getByRole('combobox', { name: tr('en', 'items.fields.state.placeholder') })).toBeFocused();
      await page.keyboard.type('in progress');
      await page.keyboard.press('Enter');
      await expect(field(fields, tr('en', 'items.fields.state.label'), 'In Progress')).toBeVisible();

      await tabTo(page, field(fields, assignee, tr('en', 'items.fields.assignee.nobody')), { max: 20 });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('combobox', { name: tr('en', 'items.fields.assignee.placeholder') })).toBeFocused();
      await page.keyboard.type(PEOPLE.e2e.name);
      await page.keyboard.press('Enter');
      await expect(field(fields, assignee, PEOPLE.e2e.name)).toBeVisible();
      return;
    }

    const people = await subList(page, 'a', 'shortcuts.item.assignee');
    await page.keyboard.type(PEOPLE.e2e.name);
    await page.keyboard.press('Enter');
    // the palette is gone before the next key: while it closes, the page's keys still wait
    await expect(people).toBeHidden();
    await expect(field(fields, assignee, PEOPLE.e2e.name)).toBeVisible();
    // the server's confirmation, not only the optimistic field
    await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.assigned', { name: PEOPLE.e2e.name }) }))).toBeVisible();

    const priorities = await subList(page, 'p', 'shortcuts.item.priority');
    await page.keyboard.type('high');
    await page.keyboard.press('Enter');
    await expect(priorities).toBeHidden();
    await expect(field(fields, tr('en', 'items.fields.priority.label'), tr('en', 'priority.high'))).toBeVisible();
    await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.priority', { priority: tr('en', 'priority.high') }) }))).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('edits the title with e', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('title'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Kontaktformular sendet doppelt' });
    await openItem(page, item.key, 'E2E Kontaktformular sendet doppelt');

    await page.keyboard.press('e');
    const title = page.getByRole('textbox', { name: tr('en', 'items.detail.title.label') });
    await expect(title).toBeFocused();
    // Escape takes it back
    await page.keyboard.type(' und dreifach');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular sendet doppelt', exact: true })).toBeVisible();

    await page.keyboard.press('e');
    await expect(title).toBeFocused();
    // select all as the browser does it on the host (the page's own mod can be Ctrl on a Mac, which goes to the line start)
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('E2E Kontaktformular sendet einmal');
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular sendet einmal', exact: true });
    await expect(heading).toBeVisible();
    await expect(heading.getByRole('button')).toBeFocused();

    // stored: the page reads it again
    await page.reload();
    await expect(heading).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('archives a done item and restores it', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('archive'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Impressum erledigt', state_id: await stateId(page, 'Standard', 'Done') });
    const { heading } = await openItem(page, item.key, 'E2E Impressum erledigt');

    await tabTo(page, page.getByRole('button', { name: tr('en', 'items.detail.more') }), { max: 80 });
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'items.commands.archive') }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'items.commands.archived', { key: item.key }))).toBeVisible();

    // archived once the undo toast has run out (5 s): read-only, with the way back
    const note = page.getByRole('status').filter({ hasText: /^Archived on/ });
    await expect(note).toBeVisible({ timeout: 10_000 });
    await expect(heading.getByRole('button')).toHaveCount(0);

    await tabTo(page, note.getByRole('button', { name: tr('en', 'items.detail.restore') }), { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'items.detail.restored', { key: item.key }))).toBeVisible();
    await expect(note).toBeHidden();
    await expect(heading.getByRole('button')).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('deletes an item with mod+backspace and undoes it with mod+z', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('delete'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Altes Banner entfernen' });
    await openItem(page, item.key, 'E2E Altes Banner entfernen');

    // an open item: deleted, with the page left at once
    await pressMod(page, 'Backspace');
    await expect(page).toHaveURL(/\/my-items$/);
    await expect(page.getByText(tr('en', 'items.commands.deleted', { key: item.key }))).toBeVisible();

    await pressMod(page, 'z');
    await expect(page).toHaveURL(new RegExp(`/items/${item.key}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Altes Banner entfernen' })).toBeVisible();
    const still = await api(page, 'GET', `/api/v1/work-items/${item.id}`);
    expect(still.status()).toBe(200);
  } finally {
    await cleanUp(page, identifier);
  }
});

test('opens a former key at the current address', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('former'), { types: ['Task'] });
  // the same length and as unique as the identifier of the project: another first letter
  const renamed = `R${identifier.slice(1)}`;
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Umbenannt' });
    const response = await api(page, 'PATCH', `/api/v1/projects/${identifier}`, { identifier: renamed });
    expect(response.status(), await response.text()).toBe(200);

    await page.goto(`/items/${item.key}`);
    await expect(page).toHaveURL(new RegExp(`/items/${renamed}-1$`));
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Umbenannt' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: tr('en', 'items.detail.path') }).getByText(`${renamed}-1`, { exact: true })).toBeVisible();
  } finally {
    await cleanUp(page, renamed);
  }
});

test('assigns with i and a, sets a label with l and the dates with shift+d and d', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('fields'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Footer anpassen' });
    const { fields } = await openItem(page, item.key, 'E2E Footer anpassen');
    const done = (what: string) => page.getByText(tr('en', 'items.commands.done', { key: item.key, what }), { exact: true });
    const assignee = tr('en', 'items.fields.assignee.label');

    // i: to oneself at once, the server confirms
    await page.keyboard.press('i');
    await expect(done(tr('en', 'items.commands.what.assigned', { name: PEOPLE.e2e.name }))).toBeVisible();
    await expect(field(fields, assignee, PEOPLE.e2e.name)).toBeVisible();

    // a: the palette's people, nobody among them
    const people = await subList(page, 'a', 'shortcuts.item.assignee');
    await page.keyboard.type(tr('en', 'items.fields.assignee.nobody'));
    await page.keyboard.press('Enter');
    await expect(people).toBeHidden();
    await expect(done(tr('en', 'items.commands.what.unassigned'))).toBeVisible();
    await expect(field(fields, assignee, tr('en', 'items.fields.assignee.nobody'))).toBeVisible();

    // l: a label comes, and the same entry ("set") takes it away again
    const labels = await subList(page, 'l', 'shortcuts.item.labels');
    await page.keyboard.type('UX');
    await page.keyboard.press('Enter');
    await expect(labels).toBeHidden();
    await expect(done(tr('en', 'items.commands.what.label_added', { label: 'UX' }))).toBeVisible();
    await expect(fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.labels.label')}: UX`) })).toBeVisible();

    const again = await subList(page, 'l', 'shortcuts.item.labels');
    await expect(again.getByRole('option', { name: new RegExp(`^UX.*${tr('en', 'items.commands.label_set')}`) })).toBeVisible();
    await page.keyboard.type('UX');
    await page.keyboard.press('Enter');
    await expect(again).toBeHidden();
    await expect(done(tr('en', 'items.commands.what.label_removed', { label: 'UX' }))).toBeVisible();

    // shift+d and d: the start today, the due date in a week
    const start = await subList(page, 'Shift+D', 'shortcuts.item.start');
    await page.keyboard.type(tr('en', 'items.commands.date.today'));
    await page.keyboard.press('Enter');
    await expect(start).toBeHidden();
    await expect(page.getByText(new RegExp(`^${item.key}: ${tr('en', 'items.fields.date.start')} `))).toBeVisible();

    const due = await subList(page, 'd', 'shortcuts.item.due');
    await page.keyboard.type(tr('en', 'items.commands.date.week'));
    await page.keyboard.press('Enter');
    await expect(due).toBeHidden();
    await expect(page.getByText(new RegExp(`^${item.key}: ${tr('en', 'items.fields.date.due')} `))).toBeVisible();

    // stored: the server has both days, a week apart
    await expect
      .poll(async () => {
        const { data } = (await (await api(page, 'GET', `/api/v1/work-items/${item.id}`)).json()) as { data: { start_date: string | null; due_date: string | null; label_ids: string[]; assignee_id: string | null } };
        return data.start_date && data.due_date ? (Date.parse(data.due_date) - Date.parse(data.start_date)) / 86_400_000 : null;
      })
      .toBe(7);
  } finally {
    await cleanUp(page, identifier);
  }
});

test('changes the type with t through the dialog and the parent with shift+p', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('type'), { types: ['Task', 'Bug', 'Epic'] });
  try {
    const environment = (await allEntries(page, 'properties')).find((property) => property.key === 'environment') as { options: { id: string; label: string }[] } | undefined;
    if (!environment) throw new Error('No property "environment" in the demo catalog');
    const staging = environment.options.find((option) => option.label === 'Staging')!;
    const epic = await createItem(page, { project_id: id, type_id: await typeId(page, 'Epic'), title: 'E2E Relaunch' });
    const item = await createItem(page, {
      project_id: id,
      type_id: await typeId(page, 'Bug'),
      title: 'E2E Menü springt',
      values: { environment: staging.id, browser: 'Firefox 140' },
    });
    const { fields, heading } = await openItem(page, item.key, 'E2E Menü springt');
    const type = tr('en', 'items.fields.type.label');

    // t to Task: the dialog names the values the type loses, mod+enter changes it
    const types = await subList(page, 't', 'shortcuts.item.type');
    await page.keyboard.type('Task');
    await page.keyboard.press('Enter');
    await expect(types).toBeHidden();
    const toTask = page.getByRole('dialog', { name: tr('en', 'items.fields.type.title', { key: item.key, type: 'Task' }) });
    await expect(toTask).toBeVisible();
    await expect(toTask.getByText('Firefox 140')).toBeVisible();
    await pressMod(page, 'Enter');
    await expect(toTask).toBeHidden();
    await expect(field(fields, type, 'Task')).toBeVisible();

    // t back to Bug: its required environment is asked for in the dialog
    await subList(page, 't', 'shortcuts.item.type');
    await page.keyboard.type('Bug');
    await page.keyboard.press('Enter');
    const toBug = page.getByRole('dialog', { name: tr('en', 'items.fields.type.title', { key: item.key, type: 'Bug' }) });
    await expect(toBug).toBeVisible();
    await tabTo(page, toBug.getByRole('combobox', { name: /^Umgebung/ }), { max: 10 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: tr('en', 'items.fields.property.search_option') })).toBeFocused();
    await page.keyboard.type('Staging');
    await page.keyboard.press('Enter');
    await expect(toBug.getByRole('combobox', { name: /^Umgebung: Staging/ })).toBeVisible();
    await pressMod(page, 'Enter');
    await expect(toBug).toBeHidden();
    await expect(field(fields, type, 'Bug')).toBeVisible();
    await expect(page.getByText(tr('en', 'items.fields.type.changed', { key: item.key, type: 'Bug' }))).toBeVisible();

    // shift+p: under the epic, then no parent again
    const parents = await subList(page, 'Shift+P', 'shortcuts.item.parent');
    await page.keyboard.type(epic.key);
    await expect(parents.getByRole('option', { name: new RegExp(epic.key) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(parents).toBeHidden();
    await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.parent', { parent: epic.key }) }))).toBeVisible();
    const path = page.getByRole('navigation', { name: tr('en', 'items.detail.path') });
    await expect(path.getByText(epic.key)).toBeVisible();

    const none = await subList(page, 'Shift+P', 'shortcuts.item.parent');
    await page.keyboard.type(tr('en', 'items.fields.parent.none'));
    await page.keyboard.press('Enter');
    await expect(none).toBeHidden();
    await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.no_parent') }))).toBeVisible();
    await expect(path.getByText(epic.key)).toHaveCount(0);
    await expect(heading).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});
