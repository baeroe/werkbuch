import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createItem, PEOPLE, removeE2eProject, runId, signedInContext, tr, variant } from '../helpers';

// The inbox (spec 4.14) of the inbox account of the variant (A289), in a context of its own. Its notifications come
// from the e2e person (Erik Ende), who assigns, comments and mentions over the API in a project of the test's own
// (`E2E …`, removed in `finally`). They reach the inbox through the outbox and the queue `notifications`: the spec waits
// for them on `GET /api/v1/notifications`, never with a fixed pause. Other specs write into the same inbox: the spec
// only looks at the cards of its own items.

const name = (what: string) => `E2E inbox ${what} ${variant()} ${runId()}`;

// a second context and the way through the queue: more than the default 30 s may pass
test.describe.configure({ timeout: 60_000 });

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
    await other.page.getByRole('button', { name: tr('en', 'inbox.filter.unread') }).click();
    await expect(other.page).toHaveURL(/\/inbox\?unread=1$/);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText(tr('en', 'inbox.kind.comment', { actor: PEOPLE.e2e.name }));

    // and mentions only: the card of the first item goes
    await other.page.getByRole('button', { name: tr('en', 'inbox.filter.mentions') }).click();
    await expect(other.page).toHaveURL(/\/inbox\?unread=1&mentions=1$/);
    await expect(card(assigned.key)).toHaveCount(0);
    await expect(card(mentionedIn.key).getByRole('listitem')).toHaveCount(1);

    // a reload starts from the filter in the address
    await other.page.reload();
    await expect(other.page.getByRole('button', { name: tr('en', 'inbox.filter.unread') })).toHaveAttribute('aria-pressed', 'true');
    await expect(card(mentionedIn.key).getByRole('listitem')).toHaveCount(1);
    await expect(card(assigned.key)).toHaveCount(0);
  } finally {
    // away from the inbox first: live would load it again while the project goes
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});
