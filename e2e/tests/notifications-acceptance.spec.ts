import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  allEntries,
  api,
  artisan,
  artisanEval,
  channelHeld,
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

/** A websocket of a page to Reverb: every frame it received, and whether it closed. */
type SocketLog = { frames: string[]; closed: boolean };

/** Records every websocket `page` opens from now on, in the order they open. */
function recordSockets(page: Page): SocketLog[] {
  const sockets: SocketLog[] = [];
  page.on('websocket', (socket) => {
    if (!/\/app\/[^/?]+/.test(socket.url())) return;
    const log: SocketLog = { frames: [], closed: false };
    sockets.push(log);
    socket.on('framereceived', ({ payload }) => log.frames.push(String(payload)));
    socket.on('close', () => (log.closed = true));
  });
  return sockets;
}

/** The frames of `sockets` on the live channel `channel`. */
const framesOn = (sockets: SocketLog[], channel: string) => sockets.flatMap((socket) => socket.frames).filter((frame) => frame.includes(`"channel":"${channel}"`));

/** The inbox account signed in in a context of its own, on its inbox, holding its own live channel; its sockets recorded. */
async function openInbox(browser: Browser, inbox: Inbox, personId: string, channel?: string) {
  const signedIn = await signedInContext(browser, inbox);
  const other = { ...signedIn, sockets: recordSockets(signedIn.page) };
  const held = Promise.all([`presence-user.${personId}`, ...(channel ? [channel] : [])].map((name) => channelHeld(other.page, name)));
  await other.page.goto('/inbox');
  await expect(other.page.getByRole('heading', { level: 1, name: tr('en', 'inbox.title') })).toBeVisible();
  await held;
  // a mark on the document: a test can tell the page did not load again
  await other.page.evaluate(() => ((window as Window & { __accept?: boolean }).__accept = true));
  return other;
}

/**
 * The end of a test: every page leaves for My items first (live would load what goes with the project and report
 * the 404), then they close and the project goes. A page that hangs after a failure never keeps the project.
 */
async function cleanUp(page: Page, identifier: string, ...contexts: { context: BrowserContext; page: Page }[]): Promise<void> {
  try {
    for (const each of [page, ...contexts.map((other) => other.page)]) await each.goto('/my-items').catch(() => {});
    for (const other of contexts) await other.context.close().catch(() => {});
  } finally {
    await removeE2eProject(page, identifier);
  }
}

/** The mail collections of a person for an item, as the server holds them (no API shows them). */
function collectionsOf(userId: string, itemId: string): { outcome: string | null; sent: boolean }[] {
  const php = `echo json_encode(App\\Models\\NotificationMail::query()->where('user_id', '${userId}')->where('scope', 'item:${itemId}')->orderBy('id')->get()->map(fn ($mail) => ['outcome' => $mail->outcome, 'sent' => $mail->sent_at !== null])->all()), PHP_EOL;`;
  return JSON.parse(artisanEval(php)) as { outcome: string | null; sent: boolean }[];
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
  const response = await api(page, 'GET', '/api/v1/notifications?filter[unread]=1&per_page=1');
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

/**
 * The badge shows what the server counts, and that count: read again until both agree, since a late notification of an
 * earlier spec may come in between (other specs leave unread ones for the account).
 */
async function serverBadge(page: Page, { timeout = 5_000 } = {}): Promise<number> {
  let count = 0;
  await expect(async () => {
    count = await unreadCount(page);
    await expectBadge(page, count, { timeout: 1_000 });
  }).toPass({ timeout });
  return count;
}

test('Erfolgskriterium 2.4: a comment mentions a person, who sees it live in the inbox and gets a mail', async ({ page, browser }) => {
  const { project, inbox, person } = await projectWithInbox(page, 'mention');
  const item = await createItem(page, { project_id: project.id, title: 'E2E Accept Kontaktformular' });
  const other = await openInbox(browser, inbox, person.id);
  try {
    // the seeder starts her with one read notification, other specs leave unread ones: the count is the server's
    const before = await serverBadge(other.page);
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
    const mention = await waitForNotification(other.page, (entry) => entry.work_item_id === item.id && entry.event === 'mentioned');
    // the server's count (a late notification of an earlier spec may have come too), and up from before
    const after = await serverBadge(other.page, LIVE);
    expect(after).toBeGreaterThan(before);
    await stillTheSameDocument(other.page);

    // the mail: collected with the notification, sent now instead of after the delay, in her language (English), with
    // the key, the link to the item and the one to her settings
    expect(mention.mailed_at).toBeNull();
    artisan('app:send-notification-mails', '--now');
    await expect.poll(() => mailpit.newTo(inbox.email, mailsBefore, item.key), { timeout: 15_000 }).not.toBeNull();
    const mail = (await mailpit.newTo(inbox.email, mailsBefore, item.key))!;
    expect(mail.subject).toBe(`[${item.key}] E2E Accept Kontaktformular`);
    expect(mail.html).toContain(`/items/${item.key}`);
    expect(mail.html).toContain('schaust du kurz drauf?');
    expect(mail.html).toContain(tr('en', 'mail.notifications.kind.mentioned', { actor: PEOPLE.e2e.name }));
    expect(mail.html).toContain(tr('en', 'mail.notifications.settings'));
    expect(mail.html).toContain('/me/notifications');
    await expect.poll(async () => (await waitForNotification(other.page, (entry) => entry.id === mention.id)).mailed_at).not.toBeNull();
  } finally {
    await cleanUp(page, project.identifier, other);
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
    await cleanUp(page, project.identifier, first, second);
  }
});

test('a removed member loses the live channel and the notifications', async ({ page, browser }) => {
  const { project, inbox, person } = await projectWithInbox(page, 'removed', 'private');
  const item = await createItem(page, { project_id: project.id, title: 'E2E Accept Vertrag' });
  const channel = `private-project.${project.id}`;
  // the mention makes her a watcher, so a status change would tell her too; its mail is collected, not sent yet
  const mentioned = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: `@${person.handle} bitte gegenlesen.` });
  expect(mentioned.status(), await mentioned.text()).toBe(201);
  // Erik holds the channel of the project too: what reaches him there would have reached her
  const erikSockets = recordSockets(page);
  const erikHeld = channelHeld(page, channel);
  await page.goto(`/projects/${project.identifier}`);
  await erikHeld;
  const other = await openInbox(browser, inbox, person.id, channel);
  try {
    await waitForNotification(other.page, (entry) => entry.work_item_id === item.id && entry.event === 'mentioned');
    expect(collectionsOf(person.id, item.id)).toEqual([{ outcome: null, sent: false }]);
    // the inbox may have loaded before the mention was there and before her channel was held: holding it loads it again
    const card = cardOf(other.page, item.key);
    await expect(card.getByRole('listitem')).toHaveCount(1, LIVE);
    await serverBadge(other.page, LIVE);
    // her one connection, holding the channel of the project
    expect(other.sockets.filter((socket) => !socket.closed)).toHaveLength(1);
    const cut = other.sockets.length;
    const old = other.sockets[cut - 1]!;
    expect(framesOn([old], channel).some((frame) => frame.includes('pusher_internal:subscription_succeeded'))).toBe(true);

    // once removed, Reverb cuts her connection (A281); the browser connects again and loads anew, the inbox without the
    // project. The list of her projects usually loads before the connection is back; if not, holding the channel of
    // the project again is refused inside the answer of /broadcasting/batch (A305), which reports no error
    const removed = await api(page, 'DELETE', `/api/v1/projects/${project.id}/members/${person.id}`);
    expect(removed.status(), await removed.text()).toBe(204);
    await expect.poll(() => old.closed, LIVE).toBe(true);
    await expect.poll(() => other.sockets.slice(cut).some((socket) => socket.frames.some((frame) => frame.includes('pusher:connection_established'))), LIVE).toBe(true);
    await expect(card).toHaveCount(0, LIVE);
    await serverBadge(other.page, LIVE);
    await stillTheSameDocument(other.page);

    // a status change of the item: Erik's channel carries it, hers does not; then a reload shows nothing either
    const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
    const moved = await api(page, 'POST', `/api/v1/work-items/${item.id}/transition`, { to_state_id: workflow.states.find((state) => state.name === 'Todo')!.id });
    expect(moved.status(), await moved.text()).toBe(200);
    await expect
      .poll(() => framesOn(erikSockets, channel).filter((frame) => frame.includes('work_item.state_changed') && frame.includes(item.id)).length, LIVE)
      .toBeGreaterThan(0);
    expect(framesOn(other.sockets.slice(cut), channel)).toEqual([]);
    await serverBadge(other.page);
    await other.page.reload();
    await expect(other.page.getByRole('heading', { level: 1, name: tr('en', 'inbox.title') })).toBeVisible();
    await expect(cardOf(other.page, item.key)).toHaveCount(0);

    // and the mail she had not got: her collection is skipped, nothing reaches Mailpit
    artisan('app:send-notification-mails', '--now');
    expect(collectionsOf(person.id, item.id)).toEqual([{ outcome: 'skipped', sent: true }]);
    expect(await mailpit.idsTo(inbox.email, item.key)).toEqual([]);
  } finally {
    await cleanUp(page, project.identifier, other);
  }
});
