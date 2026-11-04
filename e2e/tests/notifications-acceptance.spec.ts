import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  allEntries,
  api,
  artisan,
  createE2eProject,
  createItem,
  mailpit,
  PEOPLE,
  pressMod,
  removeE2eProject,
  runId,
  signedInContext,
  tr,
  variant,
  waitForNotification,
} from '../helpers';

// The acceptance of phase 8 (success criterion 2.4 in the UI): the e2e person (Erik Ende) mentions the inbox account
// of the variant (A289) in a comment; she sees it live in her inbox, her badge counts up, and the collected mail reaches
// Mailpit once `app:send-notification-mails --now` sends it. Opening the notification reads it in her other tab too.
// Removed from a private project, she loses its live channel, its notifications and the mail she had not got yet. Each
// test works in a project of its own (`E2E …`, removed in `finally`); everything reaches the other browser through the
// outbox, the queues and Reverb, so the specs wait with timeouts, never with a fixed pause. Mailpit is shared: the
// specs only look at mails to the inbox account whose subject names their item, and never empty it (K17).

const name = (what: string) => `E2E accept ${what} ${variant()} ${runId()}`;

/** How long a change may take through the queue worker and Reverb to the other browser. */
const LIVE = { timeout: 20_000 };

// several contexts and the way through the queues: more than the default 30 s may pass
test.describe.configure({ timeout: 90_000 });

type Inbox = (typeof PEOPLE.inbox)[string];

/** A project of the test with the inbox account of the variant as a member. */
async function projectWithInbox(page: Page, what: string, visibility?: 'private') {
  const project = await createE2eProject(page, name(what), { types: ['Task'], ...(visibility && { visibility }) });
  const inbox: Inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string; handle: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  return { project, inbox, person };
}

/** The inbox account signed in in a context of its own, on its inbox, holding its own live channel. */
async function openInbox(browser: Browser, inbox: Inbox, personId: string, channel?: string) {
  const other = await signedInContext(browser, inbox);
  const held = Promise.all(
    [`presence-user.${personId}`, ...(channel ? [channel] : [])].map((name) =>
      other.page.waitForResponse(
        (response) => response.url().endsWith('/broadcasting/auth') && (response.request().postData() ?? '').includes(`"${name}"`) && response.ok(),
      ),
    ),
  );
  await other.page.goto('/inbox');
  await expect(other.page.getByRole('heading', { level: 1, name: tr('en', 'inbox.title') })).toBeVisible();
  await held;
  // a mark on the document: a test can tell the page did not load again
  await other.page.evaluate(() => ((window as Window & { __accept?: boolean }).__accept = true));
  return other;
}

async function stillTheSameDocument(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as Window & { __accept?: boolean }).__accept)).toBe(true);
}

/** The card of an item in the inbox. */
const cardOf = (page: Page, key: string) => page.getByRole('article', { name: new RegExp(`^${key}:`) });

/** The inbox link that shows (the sidebar, on the phone the top bar), named with the unread count. */
const inboxLink = (page: Page) => page.getByRole('link', { name: /^Inbox(, \d+ unread)?$/ }).filter({ visible: true });

/** The unread notifications of the signed-in person of `page`, as the server counts them. */
async function unreadCount(page: Page): Promise<number> {
  const response = await api(page, 'GET', '/api/v1/notifications?unread_only=1&per_page=1');
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { meta: { total: number } }).meta.total;
}

/** The name of the inbox link says the count, the badge shows it (none at 0). */
async function expectBadge(page: Page, count: number, options = {}): Promise<void> {
  const link = inboxLink(page);
  await expect(link).toHaveAccessibleName(count > 0 ? tr('en', 'shell.nav.inbox_unread', { count }) : tr('en', 'shell.nav.inbox'), options);
  if (count > 0) await expect(link.locator('[data-inbox-badge]')).toHaveText(count > 99 ? '99+' : String(count));
  else await expect(link.locator('[data-inbox-badge]')).toHaveCount(0);
}

test('Erfolgskriterium 2.4: a comment mentions a person, who sees it live in the inbox and gets a mail', async ({ page, browser }) => {
  const { project, inbox, person } = await projectWithInbox(page, 'mention');
  const item = await createItem(page, { project_id: project.id, title: 'E2E Accept Kontaktformular' });
  const other = await openInbox(browser, inbox, person.id);
  try {
    // the seeder starts her with one read notification, other specs leave unread ones: the count is the server's
    const before = await unreadCount(other.page);
    await expectBadge(other.page, before);
    const mailsBefore = await mailpit.idsTo(inbox.email);

    // Erik comments with the keyboard: m, @ and her name from the list, the text, mod+Enter
    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Accept Kontaktformular' })).toBeVisible();
    await expect(page.getByRole('button', { name: tr('en', 'items.comments.write') })).toBeVisible();
    await page.keyboard.press('m');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Hallo @Inge');
    await expect(page.getByRole('option').first()).toContainText(inbox.name);
    await page.keyboard.press('Enter');
    await page.keyboard.type('schaust du kurz drauf?');
    await pressMod(page, 'Enter');
    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();

    // her inbox: the card comes without a reload, the badge counts up
    const card = cardOf(other.page, item.key);
    await expect(card.getByRole('listitem')).toContainText(tr('en', 'inbox.kind.mentioned', { actor: PEOPLE.e2e.name }), LIVE);
    await expect(card.getByRole('listitem')).toContainText(`@${inbox.name} schaust du kurz drauf?`);
    await expect(card.getByRole('listitem')).toHaveAttribute('data-unread', 'true');
    await expectBadge(other.page, before + 1, LIVE);
    await stillTheSameDocument(other.page);

    // the mail: collected with the notification, sent now instead of after the delay, with the key and the link
    const mention = await waitForNotification(other.page, (entry) => entry.work_item_id === item.id && entry.event === 'mentioned');
    expect(mention.mailed_at).toBeNull();
    artisan('app:send-notification-mails', '--now');
    await expect.poll(() => mailpit.newTo(inbox.email, mailsBefore, item.key), { timeout: 15_000 }).not.toBeNull();
    const mail = (await mailpit.newTo(inbox.email, mailsBefore, item.key))!;
    expect(mail.subject).toBe(`[${item.key}] E2E Accept Kontaktformular`);
    expect(mail.html).toContain(`/items/${item.key}`);
    expect(mail.html).toContain('schaust du kurz drauf?');
    await expect.poll(async () => (await waitForNotification(other.page, (entry) => entry.id === mention.id)).mailed_at).not.toBeNull();
  } finally {
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('opening the notification reads it, and the other tab of the same person follows', async ({ page, browser }) => {
  const { project, inbox, person } = await projectWithInbox(page, 'tabs');
  const item = await createItem(page, { project_id: project.id, title: 'E2E Accept Newsletter' });
  const first = await openInbox(browser, inbox, person.id);
  const second = await openInbox(browser, inbox, person.id);
  try {
    const mentioned = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: `@${person.handle} der Newsletter ist fertig.` });
    expect(mentioned.status(), await mentioned.text()).toBe(201);
    const mention = await waitForNotification(first.page, (entry) => entry.work_item_id === item.id && entry.event === 'mentioned');
    const count = await unreadCount(first.page);
    await expectBadge(first.page, count, LIVE);
    await expectBadge(second.page, count, LIVE);

    // the first tab opens it in the preview, which reads it
    const row = cardOf(first.page, item.key).getByRole('listitem');
    await expect(row).toHaveAttribute('data-unread', 'true');
    await row.getByRole('link').click();
    await expect(first.page.getByRole('complementary', { name: tr('en', 'items.peek.label') }).getByText('E2E Accept Newsletter').first()).toBeVisible();
    await expect.poll(async () => (await waitForNotification(first.page, (entry) => entry.id === mention.id)).read_at).not.toBeNull();
    await expectBadge(first.page, count - 1);

    // the other tab hears it on her own channel and follows without a reload
    await expectBadge(second.page, count - 1, LIVE);
    await expect(cardOf(second.page, item.key).getByRole('listitem')).not.toHaveAttribute('data-unread');
    await stillTheSameDocument(second.page);
  } finally {
    await first.page.goto('/my-items');
    await second.page.goto('/my-items');
    await first.context.close();
    await second.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('a removed member loses the live channel and the notifications', async ({ page, browser, allowedErrors }) => {
  const { project, inbox, person } = await projectWithInbox(page, 'removed', 'private');
  const item = await createItem(page, { project_id: project.id, title: 'E2E Accept Vertrag' });
  // the mention makes her a watcher, so a status change would tell her too; its mail is collected, not sent yet
  const mentioned = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: `@${person.handle} bitte gegenlesen.` });
  expect(mentioned.status(), await mentioned.text()).toBe(201);
  const other = await openInbox(browser, inbox, person.id, `private-project.${project.id}`);
  try {
    await waitForNotification(other.page, (entry) => entry.work_item_id === item.id && entry.event === 'mentioned');
    const card = cardOf(other.page, item.key);
    await expect(card.getByRole('listitem')).toHaveCount(1);
    const before = await unreadCount(other.page);
    await expectBadge(other.page, before);

    // once removed, her browser is cut off (A281): it connects again and loads anew, the inbox without the project. The
    // list of her projects usually loads before the connection is back; if not, holding the channel of the project
    // again is refused, and the browser reports the 403 of /broadcasting/auth
    allowedErrors.push(/status of 403 .*\/broadcasting\/auth\)$/);
    // what reaches her browser on the channel of the project from now on (the socket after the cut is a new one)
    const onProject: string[] = [];
    other.page.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        if (String(payload).includes(`"private-project.${project.id}"`)) onProject.push(String(payload));
      }),
    );
    const removed = await api(page, 'DELETE', `/api/v1/projects/${project.id}/members/${person.id}`);
    expect(removed.status(), await removed.text()).toBe(204);
    await expect(card).toHaveCount(0, LIVE);
    await expectBadge(other.page, before - 1, LIVE);
    await stillTheSameDocument(other.page);

    // a status change of the item reaches her no more: the badge stays for a second (at least ten looks), and a reload
    // shows nothing
    const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
    const moved = await api(page, 'POST', `/api/v1/work-items/${item.id}/transition`, { to_state_id: workflow.states.find((state) => state.name === 'Todo')!.id });
    expect(moved.status(), await moved.text()).toBe(200);
    const seen: string[] = [];
    await expect
      .poll(
        async () => {
          seen.push(await inboxLink(other.page).innerText());
          return seen.length;
        },
        { intervals: [100], timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(10);
    expect(new Set(seen).size, seen.join(', ')).toBe(1);
    // neither a live message nor even the subscription of the channel came back
    expect(onProject).toEqual([]);
    await other.page.reload();
    await expect(other.page.getByRole('heading', { level: 1, name: tr('en', 'inbox.title') })).toBeVisible();
    await expectBadge(other.page, before - 1);
    await expect(cardOf(other.page, item.key)).toHaveCount(0);

    // and the mail she had not got: the collection is skipped, nothing reaches Mailpit
    artisan('app:send-notification-mails', '--now');
    expect(await mailpit.idsTo(inbox.email, item.key)).toEqual([]);
  } finally {
    await other.page.goto('/my-items');
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});
