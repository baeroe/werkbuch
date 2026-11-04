import type { Browser, BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createItem, isPhone, PEOPLE, removeE2eProject, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// Live updates (spec 7.2) between two people: the e2e person (Erik Ende) changes something over the API, the inbox
// account of the variant (A289) sees it without a reload, in a context of its own. Both are members of a project of the
// test's own (`E2E …`, removed in `finally`). The change reaches the other browser through the outbox, the queue `live`
// and Reverb: the specs wait for it with `toBeVisible({ timeout })`, never with a fixed pause.

const name = (what: string) => `E2E live ${what} ${variant()} ${runId()}`;

/** How long a change may take through the queue worker and Reverb to the other browser. */
const LIVE = { timeout: 20_000 };

// a second context, the way through the queue and Reverb: more than the default 30 s may pass in a test
test.describe.configure({ timeout: 60_000 });

/** The id of a state of the default workflow. */
async function stateOf(page: Page, state: string): Promise<string> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
  return workflow.states.find((entry) => entry.name === state)!.id;
}

/** A project of the test with the inbox account of the variant as a member, and that person signed in in a context of its own. */
async function twoPeople(page: Page, browser: Browser, what: string) {
  const project = await createE2eProject(page, name(what), { types: ['Task'] });
  const inbox = PEOPLE.inbox[variant()]!;
  const user = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: user.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  const other = await signedInContext(browser, inbox);
  return { project, other };
}

/** Waits until the browser of `page` holds the live channel `channel` (its authorization answered). */
function channelHeld(page: Page, channel: string) {
  return page.waitForResponse((response) => response.url().endsWith('/broadcasting/auth') && (response.request().postData() ?? '').includes(`"${channel}"`) && response.ok());
}

/** Marks the document, so a test can tell that the page did not load again. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => ((window as Window & { __live?: boolean }).__live = true));
}

async function stillTheSameDocument(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as Window & { __live?: boolean }).__live)).toBe(true);
}

async function cleanUp(page: Page, context: BrowserContext | undefined, identifier: string) {
  await context?.close();
  await removeE2eProject(page, identifier);
}

test('shows a status change of the other person in the list without a reload', async ({ page, browser }) => {
  const { project, other } = await twoPeople(page, browser, 'status');
  try {
    const item = await createItem(page, { project_id: project.id, title: 'E2E Live Kontaktformular' });
    const held = channelHeld(other.page, `private-project.${project.id}`);
    await other.page.goto(`/projects/${project.identifier}`);
    const row = other.page.getByRole('group', { name: new RegExp(`^${item.key} `) });
    const state = (value: string) => row.getByRole('combobox', { name: tr('en', 'items.fields.picker.name', { label: tr('en', 'items.fields.state.label'), value }) });
    await expect(state('Backlog')).toBeVisible();
    await held;
    await markDocument(other.page);

    const moved = await api(page, 'POST', `/api/v1/work-items/${item.id}/transition`, { to_state_id: await stateOf(page, 'Todo') });
    expect(moved.status(), await moved.text()).toBe(200);

    await expect(state('Todo')).toBeVisible(LIVE);
    await stillTheSameDocument(other.page);
  } finally {
    await cleanUp(page, other.context, project.identifier);
  }
});

test('updates the comments of an open item live', async ({ page, browser }) => {
  const { project, other } = await twoPeople(page, browser, 'comments');
  try {
    const item = await createItem(page, { project_id: project.id, title: 'E2E Live Newsletter' });
    const held = channelHeld(other.page, `private-work-item.${item.id}`);
    await other.page.goto(`/items/${item.key}`);
    await expect(other.page.getByRole('heading', { level: 1, name: 'E2E Live Newsletter' })).toBeVisible();
    await held;
    await markDocument(other.page);

    const written = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: 'E2E Live: der Versand klappt wieder.' });
    expect(written.status(), await written.text()).toBe(201);

    const comment = other.page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(comment).toContainText('E2E Live: der Versand klappt wieder.', LIVE);
    await stillTheSameDocument(other.page);
  } finally {
    // away from the item page first: it would load its item again after the project went and report the 404
    await other.page.goto('/my-items');
    await cleanUp(page, other.context, project.identifier);
  }
});

test('does not apply the own change twice', async ({ page, browser }) => {
  const { project, other } = await twoPeople(page, browser, 'own');
  try {
    const item = await createItem(page, { project_id: project.id, title: 'E2E Live Footer' });
    const held = channelHeld(other.page, `private-work-item.${item.id}`);
    await other.page.goto(`/items/${item.key}`);
    await held;
    const patches: { socket: string | undefined }[] = [];
    other.page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/api/v1/work-items/')) patches.push({ socket: request.headers()['x-socket-id'] });
    });

    // the priority through its field: one PATCH of this tab
    const fields = other.page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') });
    const priority = (value: string) =>
      fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label: tr('en', 'items.fields.priority.label'), value })}`) });
    await tabTo(other.page, priority(tr('en', 'priority.none')), { max: 80 });
    await other.page.keyboard.press('Enter');
    await expect(other.page.getByRole('combobox', { name: tr('en', 'items.fields.priority.placeholder') })).toBeFocused();
    await other.page.keyboard.type('high');
    await other.page.keyboard.press('Enter');
    await expect(priority(tr('en', 'priority.high'))).toBeVisible();

    // the change of the other person comes after the own one: once it shows, the own event would have come too
    await api(page, 'PATCH', `/api/v1/work-items/${item.id}`, { title: 'E2E Live Footer neu' });
    await expect(other.page.getByRole('heading', { level: 1, name: 'E2E Live Footer neu' })).toBeVisible(LIVE);

    // the call named the tab's socket, so Reverb left this tab out (A282): one PATCH, one line of the priority
    expect(patches).toHaveLength(1);
    expect(patches[0]!.socket).toMatch(/^\d+\.\d+$/);
    const timeline = other.page.getByRole('region', { name: tr('en', 'items.activity.title') }).getByRole('list', { name: tr('en', 'items.activity.list') });
    const changed = tr('en', 'items.activity.field.priority', { old: tr('en', 'priority.none'), new: tr('en', 'priority.high') });
    await expect(timeline.getByRole('listitem').filter({ hasText: changed })).toHaveCount(1);
  } finally {
    await other.page.goto('/my-items');
    await cleanUp(page, other.context, project.identifier);
  }
});

test.describe('without Reverb', () => {
  test('shows the banner after Reverb went away and hides it when it is back', async ({ page, allowedErrors }) => {
    test.skip(isPhone(page), 'the banner is the same on every width; one run is enough');
    // pusher-js connects again with a growing pause: the banner may take up to a minute to go
    test.setTimeout(90_000);
    // Chrome reports the refused websockets (K11)
    allowedErrors.push(/WebSocket connection to .* failed/);
    // every websocket of the page to Reverb goes through this route: passed on while Reverb is "there", closed while away
    let away = false;
    let open: WebSocketRoute | null = null;
    await page.routeWebSocket(/\/app\/[^/?]+/, (ws) => {
      if (away) {
        ws.close();
        return;
      }
      ws.connectToServer();
      open = ws;
    });
    const held = page.waitForResponse((response) => response.url().endsWith('/broadcasting/auth') && (response.request().postData() ?? '').includes('presence-user.'));
    await page.goto('/my-items');
    await held;
    const banner = page.getByRole('status').filter({ hasText: tr('en', 'shell.live.paused_title') });
    await expect(banner).toBeHidden();

    // Reverb goes away: the connection drops and every new one is refused; after three seconds the banner says so
    away = true;
    await open!.close();
    await expect(banner).toBeVisible(LIVE);
    await expect(banner).toContainText(tr('en', 'shell.live.paused_description'));

    // Reverb is back: pusher-js connects again on its own, and the banner goes
    away = false;
    await expect(banner).toBeHidden({ timeout: 60_000 });
  });
});
