import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createE2eTemplate, createItem, isPhone, PEOPLE, pressMod, removeE2eProject, runId, signedInContext, tr, variant, waitForNotification } from '../helpers';

// The inbox (spec 4.14) of the inbox account of the variant (A289), in a context of its own. Its notifications come
// from the e2e person (Erik Ende), who assigns, comments and mentions over the API in a project of the test's own
// (`E2E …`, removed in `finally`). They reach the inbox through the outbox and the queue `notifications`: the spec waits
// for them on `GET /api/v1/notifications`, never with a fixed pause. Other specs write into the same inbox: the spec
// only looks at the cards of its own items.

const name = (what: string) => `E2E inbox ${what} ${variant()} ${runId()}`;

// a second context and the way through the queue: more than the default 30 s may pass
test.describe.configure({ timeout: 150_000 });

interface StoredNotification {
  id: string;
  event: string;
  work_item_id: string | null;
  read_at: string | null;
}

/** The newest notifications of the signed-in person of `page`, as the server holds them. */
async function notificationsOf(page: Page): Promise<StoredNotification[]> {
  const response = await api(page, 'GET', '/api/v1/notifications?per_page=100');
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: StoredNotification[] }).data;
}

test('groups notifications by item and filters unread', async ({ page, browser }) => {
  const project = await createE2eProject(page, name('groups'), { types: ['Task'] });
  const inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string; handle: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  const other = await signedInContext(browser, inbox);
  try {
    // assigned at creation (the person watches it from then on), then a comment on it; a mention on a second item
    const assigned = await createItem(page, { project_id: project.id, title: 'E2E Inbox Kontaktformular', assignee_id: person.id });
    const commented = await api(page, 'POST', `/api/v1/work-items/${assigned.id}/comments`, { body: 'E2E Inbox: der Versand klappt wieder.' });
    expect(commented.status(), await commented.text()).toBe(201);
    const mentionedIn = await createItem(page, { project_id: project.id, title: 'E2E Inbox Newsletter' });
    const mentioned = await api(page, 'POST', `/api/v1/work-items/${mentionedIn.id}/comments`, { body: `@${person.handle} schaust du kurz drauf?` });
    expect(mentioned.status(), await mentioned.text()).toBe(201);

    const ours = async () => (await notificationsOf(other.page)).filter((entry) => [assigned.id, mentionedIn.id].includes(entry.work_item_id ?? ''));
    await expect.poll(async () => (await ours()).map((entry) => `${entry.work_item_id}:${entry.event}`).sort(), { timeout: 20_000 }).toEqual(
      [`${assigned.id}:assigned`, `${assigned.id}:comment`, `${mentionedIn.id}:mentioned`].sort(),
    );
    // the assignment is read already: the unread filter leaves it out
    const assignment = (await ours()).find((entry) => entry.event === 'assigned')!;
    const read = await api(other.page, 'POST', '/api/v1/notifications/read', { ids: [assignment.id] });
    expect(read.status(), await read.text()).toBe(200);

    await other.page.goto('/inbox');
    await expect(other.page.getByRole('heading', { level: 1, name: tr('en', 'inbox.title') })).toBeVisible();

    // one card per item, its notifications inside, newest first
    const card = (key: string) => other.page.getByRole('article', { name: new RegExp(`^${key}:`) });
    const rows = card(assigned.key).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(tr('en', 'inbox.kind.comment', { actor: PEOPLE.e2e.name }));
    await expect(rows.nth(0)).toContainText('E2E Inbox: der Versand klappt wieder.');
    await expect(rows.nth(1)).toContainText(tr('en', 'inbox.kind.assigned', { actor: PEOPLE.e2e.name }));
    await expect(card(assigned.key).getByRole('link', { name: `${assigned.key}: E2E Inbox Kontaktformular` })).toHaveAttribute('href', `/items/${assigned.key}`);
    await expect(card(mentionedIn.key).getByRole('listitem')).toHaveCount(1);
    await expect(card(mentionedIn.key)).toContainText(tr('en', 'inbox.kind.mentioned', { actor: PEOPLE.e2e.name }));

    // unread only: the read assignment leaves, the address keeps the filter
    await other.page.getByRole('button', { name: tr('en', 'inbox.filter.unread'), exact: true }).click();
    await expect(other.page).toHaveURL(/\/inbox\?unread=1$/);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText(tr('en', 'inbox.kind.comment', { actor: PEOPLE.e2e.name }));

    // and mentions only: the card of the first item goes
    await other.page.getByRole('button', { name: tr('en', 'inbox.filter.mentions'), exact: true }).click();
    await expect(other.page).toHaveURL(/\/inbox\?unread=1&mentions=1$/);
    await expect(card(assigned.key)).toHaveCount(0);
    await expect(card(mentionedIn.key).getByRole('listitem')).toHaveCount(1);

    // a reload starts from the filter in the address
    await other.page.reload();
    await expect(other.page.getByRole('button', { name: tr('en', 'inbox.filter.unread'), exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(card(mentionedIn.key).getByRole('listitem')).toHaveCount(1);
    await expect(card(assigned.key)).toHaveCount(0);
  } finally {
    // away from the inbox first: live would load it again while the project goes
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('works the inbox with the keyboard only', async ({ page, browser }) => {
  const project = await createE2eProject(page, name('keys'), { types: ['Task'] });
  const inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string; handle: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  const other = await signedInContext(browser, inbox);
  try {
    // two items assigned to the person, then a comment on the first: three unread rows, the comment the newest
    const first = await createItem(page, { project_id: project.id, title: 'E2E Inbox Tasten Rechnung', assignee_id: person.id });
    const second = await createItem(page, { project_id: project.id, title: 'E2E Inbox Tasten Angebot', assignee_id: person.id });
    const commented = await api(page, 'POST', `/api/v1/work-items/${first.id}/comments`, { body: 'E2E Inbox Tasten: bitte prüfen.' });
    expect(commented.status(), await commented.text()).toBe(201);

    const ours = async () => (await notificationsOf(other.page)).filter((entry) => [first.id, second.id].includes(entry.work_item_id ?? ''));
    await expect.poll(async () => (await ours()).length, { timeout: 20_000 }).toBe(3);
    const stored = await ours();
    const comment = stored.find((entry) => entry.event === 'comment')!;
    const assignedFirst = stored.find((entry) => entry.event === 'assigned' && entry.work_item_id === first.id)!;
    const assignedSecond = stored.find((entry) => entry.event === 'assigned' && entry.work_item_id === second.id)!;
    const readAt = async (id: string) => (await notificationsOf(other.page)).find((entry) => entry.id === id)?.read_at;

    const inboxPage = other.page;
    await inboxPage.goto('/inbox');
    const card = (key: string) => inboxPage.getByRole('article', { name: new RegExp(`^${key}:`) });
    const firstRows = card(first.key).getByRole('listitem');
    await expect(firstRows).toHaveCount(2);

    // j: the cursor and the focus on the newest row, the comment
    await inboxPage.keyboard.press('j');
    const commentLink = firstRows.nth(0).getByRole('link');
    await expect(commentLink).toBeFocused();
    await expect(commentLink).toContainText('E2E Inbox Tasten: bitte prüfen.');

    // e reads it, u takes it back; the server ends where the last key left it
    await inboxPage.keyboard.press('e');
    await expect(firstRows.nth(0)).not.toHaveAttribute('data-unread');
    await expect.poll(() => readAt(comment.id)).not.toBeNull();
    await inboxPage.keyboard.press('u');
    await expect(firstRows.nth(0)).toHaveAttribute('data-unread', 'true');
    await expect.poll(() => readAt(comment.id)).toBeNull();

    // # deletes the next row with five seconds of undo, the focus goes on; mod+z brings it back
    await inboxPage.keyboard.press('j');
    await expect(firstRows.nth(1).getByRole('link')).toBeFocused();
    await inboxPage.keyboard.press('#');
    await expect(firstRows).toHaveCount(1);
    await expect(inboxPage.getByText(tr('en', 'inbox.delete.done'))).toBeVisible();
    const secondLink = card(second.key).getByRole('listitem').getByRole('link');
    await expect(secondLink).toBeFocused();
    await pressMod(inboxPage, 'z');
    await expect(firstRows).toHaveCount(2);

    // Enter opens the item in the preview and reads the notification
    await expect(secondLink).toBeFocused();
    await inboxPage.keyboard.press('Enter');
    const preview = inboxPage.getByRole('complementary', { name: tr('en', 'items.peek.label') });
    await expect(preview.getByText('E2E Inbox Tasten Angebot').first()).toBeVisible();
    await expect.poll(() => readAt(assignedSecond.id)).not.toBeNull();
    await inboxPage.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);

    // shift+e: everything read; the toast says how many
    await inboxPage.keyboard.press('Shift+E');
    await expect(inboxPage.getByText(/notifications? marked as read$/)).toBeVisible();
    await expect.poll(async () => (await ours()).filter((entry) => entry.read_at === null).length).toBe(0);
    await expect(inboxPage.getByRole('status').filter({ hasText: tr('en', 'inbox.all_read') })).toBeVisible();
    // the undone delete never went to the server
    expect((await ours()).map((entry) => entry.id)).toContain(assignedFirst.id);

    // a delete from the palette: the focus goes on to the row that moves up, not to the page
    await expect(secondLink).toBeFocused();
    await pressMod(inboxPage, 'k');
    const input = inboxPage.getByRole('combobox', { name: tr('en', 'palette.input') });
    await expect(input).toBeFocused();
    await input.fill(tr('en', 'inbox.command.delete'));
    await inboxPage.keyboard.press('Enter');
    await expect(card(second.key)).toHaveCount(0);
    await expect(inboxPage.locator('[data-nav-target]:focus')).toHaveCount(1);
  } finally {
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('reads and deletes from the menu of a row on the phone, without opening it', async ({ page, browser }) => {
  test.skip(!isPhone(page), 'the menu of a touch screen');
  const project = await createE2eProject(page, name('menu'), { types: ['Task'] });
  const inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  const other = await signedInContext(browser, inbox);
  try {
    const item = await createItem(page, { project_id: project.id, title: 'E2E Inbox Menü Vertrag', assignee_id: person.id });
    const find = async (match: (entry: StoredNotification) => boolean) => (await notificationsOf(other.page)).find(match);
    await expect.poll(async () => (await find((entry) => entry.work_item_id === item.id))?.event, { timeout: 20_000 }).toBe('assigned');
    const assigned = (await find((entry) => entry.work_item_id === item.id))!;
    // the seeder leaves every inbox account one read notification without an item: a failed template of WEB
    const template = (await find((entry) => entry.event === 'template_run_failed'))!;
    const web = (await (await api(other.page, 'GET', '/api/v1/projects/WEB')).json()) as { data: { name: string } };

    const inboxPage = other.page;
    await inboxPage.goto('/inbox');
    const row = inboxPage.getByRole('article', { name: new RegExp(`^${item.key}:`) }).getByRole('listitem');
    await expect(row).toHaveAttribute('data-unread', 'true');

    // read from the menu: nothing opens
    await inboxPage.getByRole('button', { name: tr('en', 'inbox.row.menu', { key: item.key }) }).click();
    await inboxPage.getByRole('menuitem', { name: tr('en', 'shortcuts.inbox.read') }).click();
    await expect(row).not.toHaveAttribute('data-unread');
    // the menu closes with its item; on a slow machine its popup animates out a while longer, still with its items
    await expect(inboxPage.getByRole('menu')).toHaveCount(0);
    await expect(inboxPage.getByRole('complementary', { name: tr('en', 'items.peek.label') })).toHaveCount(0);
    await expect(inboxPage).toHaveURL(/\/inbox$/);
    await expect.poll(async () => (await find((entry) => entry.id === assigned.id))?.read_at ?? null).not.toBeNull();

    // a row without an item, which a tap would leave for its page: deleted from the menu, for real once the toast ends
    const card = inboxPage.getByRole('region', { name: new RegExp(web.data.name) });
    await card.getByRole('button', { name: tr('en', 'inbox.row.menu', { key: web.data.name }) }).click();
    // the one open menu is the card's
    await expect(inboxPage.getByRole('menu')).toHaveCount(1);
    await inboxPage.getByRole('menu').getByRole('menuitem', { name: tr('en', 'shortcuts.inbox.delete') }).click();
    await expect(card).toHaveCount(0);
    // the menu gave the focus back to its row, which left: it goes on to the row before it
    await expect(row.getByRole('link')).toBeFocused();
    await expect(inboxPage.getByText(tr('en', 'inbox.delete.done'))).toBeVisible();
    await expect(inboxPage).toHaveURL(/\/inbox$/);
    await expect.poll(async () => (await find((entry) => entry.id === template.id)) ?? null, { timeout: 15_000 }).toBeNull();
  } finally {
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('leads the row of a failed template to the template', async ({ page, browser }) => {
  const project = await createE2eProject(page, name('template'), { types: ['Task', 'Bug'] });
  const inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string };
  const types = await allEntries(page, 'work-item-types');
  const typeId = (typeName: string) => (types.find((entry) => entry.name === typeName) as { id: string }).id;
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  // the inbox person leads the project: a failed run tells the lead and the author of the template
  const led = await api(page, 'PATCH', `/api/v1/projects/${project.id}`, { lead_id: person.id });
  expect(led.status(), await led.text()).toBe(200);
  const other = await signedInContext(browser, inbox);
  try {
    const templateName = `E2E Inbox Wartung ${variant()} ${runId()}`;
    const template = await createE2eTemplate(page, project.id, { name: templateName, title: 'E2E Inbox Wartung', type: typeId('Task') });
    // its type is switched off in the project: the run cannot create its item
    const switched = await api(page, 'PATCH', `/api/v1/projects/${project.id}`, { enabled_type_ids: [typeId('Bug')], default_type_id: typeId('Bug') });
    expect(switched.status(), await switched.text()).toBe(200);
    const run = await api(page, 'POST', `/api/v1/templates/${template.id}/run`);
    expect(run.status(), await run.text()).toBe(200);
    expect(((await run.json()) as { data: { run: { status: string } } }).data.run.status).toBe('failed');
    await waitForNotification(other.page, (entry) => entry.event === 'template_run_failed' && entry.data.template_id === template.id);

    await other.page.goto('/inbox');
    const row = other.page.getByRole('region', { name: name('template') }).getByRole('link', { name: new RegExp(tr('en', 'inbox.kind.template_run_failed')) });
    await expect(row).toHaveAttribute('href', `/projects/${project.identifier}/templates/${template.id}`);
    await row.click();

    await expect(other.page).toHaveURL(new RegExp(`/projects/${project.identifier}/templates/${template.id}$`));
    await expect(other.page.getByRole('textbox', { name: tr('en', 'templates.editor.name'), exact: true })).toHaveValue(templateName);
  } finally {
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});
