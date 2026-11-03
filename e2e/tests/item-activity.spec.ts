import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eProject, createItem, isPhone, PEOPLE, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The activity of an item on its page, with the keyboard only, signed in as the e2e person in English. Each test works
// in a project of its own (`E2E …`, removed in `finally`); its items come over the API. Changes of one person within
// five minutes read as one line; a status the server moved along names its reason.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** The id of the state named `state` in the workflow named `workflow`, and the workflow's id. */
async function stateOf(page: Page, workflow: string, state: string): Promise<{ workflowId: string; stateId: string }> {
  const entry = (await allEntries(page, 'workflows')).find((item) => item.name === workflow) as { id: string; states: { id: string; name: string }[] } | undefined;
  const found = entry?.states.find((item) => item.name === state);
  if (!entry || !found) throw new Error(`No state "${state}" in workflow "${workflow}"`);
  return { workflowId: entry.id, stateId: found.id };
}

/** The timeline of the activity section, once it has loaded. */
async function timelineOf(page: Page) {
  const section = page.getByRole('region', { name: tr('en', 'items.activity.title') });
  const timeline = section.getByRole('list', { name: tr('en', 'items.activity.list') });
  await expect(timeline).toBeVisible();
  return timeline;
}

/** Removes the project from a page outside it: the item page would load its item again and report the 404. */
async function cleanUp(page: Page, identifier: string) {
  await page.goto('/my-items');
  await removeE2eProject(page, identifier);
}

test('shows the changes of an item with old and new value', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('activity'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Kontaktformular sendet doppelt' });
    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular sendet doppelt' })).toBeVisible();
    const timeline = await timelineOf(page);
    await expect(timeline.getByRole('listitem')).toHaveText([new RegExp(`${PEOPLE.e2e.name} ${tr('en', 'items.activity.created')}\\.`)]);

    // the title with e, once the fields have loaded (their commands act from then on)
    const fields = page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') });
    const priority = (value: string) =>
      fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label: tr('en', 'items.fields.priority.label'), value })}`) });
    await expect(priority(tr('en', 'priority.none'))).toBeVisible();
    await page.keyboard.press('e');
    const title = page.getByRole('textbox', { name: tr('en', 'items.detail.title.label') });
    await expect(title).toBeFocused();
    await expect(title).toHaveValue('E2E Kontaktformular sendet doppelt');
    // the caret stands at the end: take back the word "doppelt" (Ctrl+A on a Mac host moves the caret to the start)
    for (let step = 0; step < 'doppelt'.length; step += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('einmal');
    await expect(title).toHaveValue('E2E Kontaktformular sendet einmal');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular sendet einmal', exact: true })).toBeVisible();

    // the priority: with p on the desktop, through its field on the phone
    if (isPhone(page)) {
      await tabTo(page, priority(tr('en', 'priority.none')), { max: 80 });
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('p');
    }
    const search = page.getByRole('combobox', { name: isPhone(page) ? tr('en', 'items.fields.priority.placeholder') : tr('en', 'shortcuts.item.priority') });
    await expect(search).toBeFocused();
    await page.keyboard.type('high');
    await page.keyboard.press('Enter');
    await expect(priority(tr('en', 'priority.high'))).toBeVisible();

    // one line: created, the title and the priority, each with old and new value
    const changed = [
      tr('en', 'items.activity.created'),
      tr('en', 'items.activity.field.title', { old: 'E2E Kontaktformular sendet doppelt', new: 'E2E Kontaktformular sendet einmal' }),
      tr('en', 'items.activity.field.priority', { old: tr('en', 'priority.none'), new: tr('en', 'priority.high') }),
    ];
    await expect(timeline.getByRole('listitem')).toHaveText([`${PEOPLE.e2e.name} ${changed[0]}, ${changed[1]} and ${changed[2]}. today`].map((text) => new RegExp(literal(text))));
  } finally {
    await cleanUp(page, identifier);
  }
});

test('names the reason of a remapped status', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('remap'), { types: ['Task'] });
  try {
    const todo = await stateOf(page, 'Standard', 'Todo');
    const review = await stateOf(page, 'Agentur-Freigabe', 'Review');
    const item = await createItem(page, { project_id: id, title: 'E2E Startseite abstimmen', state_id: todo.stateId });
    // the project moves to the agency workflow; every state its items stand in gets a target
    const switched = await api(page, 'PUT', `/api/v1/projects/${identifier}/workflow`, { workflow_id: review.workflowId, mapping: { [todo.stateId]: review.stateId } });
    expect(switched.status(), await switched.text()).toBe(200);

    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Startseite abstimmen' })).toBeVisible();
    const timeline = await timelineOf(page);
    const lines = timeline.getByRole('listitem');
    await expect(lines).toHaveCount(2);
    // the move to Todo on creation was the person's own; the remap names why it happened
    await expect(lines.nth(0)).toContainText(tr('en', 'items.activity.field.state', { old: 'Backlog', new: 'Todo' }));
    await expect(lines.nth(1)).toContainText(tr('en', 'items.activity.field.state', { old: 'Todo', new: 'Review' }));
    await expect(lines.nth(1)).toContainText(tr('en', 'items.activity.reason.workflow_changed'));
    await expect(lines.nth(0)).not.toContainText(tr('en', 'items.activity.reason.workflow_changed'));

    // the filter "Changes" keeps the history, with the keyboard
    const filter = page.getByRole('group', { name: tr('en', 'items.activity.filter.label') });
    await tabTo(page, filter.getByRole('button', { name: tr('en', 'items.activity.filter.all'), exact: true }), { max: 120 });
    await arrowTo(page, filter.getByRole('button', { name: tr('en', 'items.activity.filter.changes'), exact: true }), 'ArrowRight', 3);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?activity=changes$/);
    await expect(lines).toHaveCount(2);
  } finally {
    await cleanUp(page, identifier);
  }
});

test('filters to comments', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('comments'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Kommentare filtern' });
    const comment = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: 'Looks good to me.' });
    expect(comment.status(), await comment.text()).toBe(201);

    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kommentare filtern' })).toBeVisible();
    const timeline = await timelineOf(page);
    const lines = timeline.getByRole('listitem');
    const card = timeline.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    // the creation, then the comment
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText(tr('en', 'items.activity.created'));
    await expect(card).toContainText('Looks good to me.');

    // "Comments" with the keyboard: only the comment stays, the address says so
    const filter = page.getByRole('group', { name: tr('en', 'items.activity.filter.label') });
    await tabTo(page, filter.getByRole('button', { name: tr('en', 'items.activity.filter.all'), exact: true }), { max: 120 });
    await arrowTo(page, filter.getByRole('button', { name: tr('en', 'items.activity.filter.comments'), exact: true }), 'ArrowRight', 3);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?activity=comments$/);
    await expect(lines).toHaveCount(1);
    await expect(card).toBeVisible();

    // "Changes": only the history
    await arrowTo(page, filter.getByRole('button', { name: tr('en', 'items.activity.filter.changes'), exact: true }), 'ArrowRight', 3);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?activity=changes$/);
    await expect(lines).toHaveCount(1);
    await expect(card).toBeHidden();
    await expect(lines.nth(0)).toContainText(tr('en', 'items.activity.created'));
  } finally {
    await cleanUp(page, identifier);
  }
});

/** A text as a literal part of a regular expression. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
