import type { Locator, Page } from '@playwright/test';
import { verifyWerkbuchSignature } from '../../docs/snippets/webhooks/verify.mjs';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createE2eWebhook, createItem, isPhone, pressMod, removeE2eProject, removeE2eWebhook, runId, tabTo, tr, variant } from '../helpers';
import { startReceiver, type ReceivedRequest } from '../webhookReceiver';

// The acceptance of phase 11 (success criterion 2.5 "a webhook arrives signed at the receiver", and the agent scenario of
// spec 6.3) as the e2e person (Erik Ende, org admin), in English. The receiver is the small server on the Mac
// (`startReceiver()`); the signature is checked with the Node snippet of the docs (A374). Each test works in a project of
// its own with a webhook of that project (`E2E …`, removed in `finally`). Deliveries run through the queue: the spec waits
// on the receiver and on the log, never on a fixed pause (K18).

// longer than LIVE (K18 had 30 s): locally `queue:listen` starts PHP for every job, and after specs that make many events
// (items, inbox) the backlog of consumer jobs in the queue `webhooks` (its own worker `queue-webhooks` since T16-M5;
// before, it came last behind default, live and notifications) held a delivery for more than 30 s; in CI
// (`queue:work`) it arrives within a second or two
const WEBHOOK = 90_000;
const name = (what: string) => `E2E webhook ${what} ${variant()} ${runId()}`;

// the queue takes its time locally (see WEBHOOK): the poll at the receiver and the one at the log
test.describe.configure({ timeout: 240_000 });

/** The requests of one event, in the order they came. */
const of = (requests: ReceivedRequest[], event: string) => requests.filter((request) => request.headers['x-werkbuch-event'] === event);

/** Whether the request carries the signature of the secret, checked as the docs tell a receiver to. */
function signed(request: ReceivedRequest, secret: string): boolean {
  return verifyWerkbuchSignature(secret, String(request.headers['x-werkbuch-timestamp']), request.body, String(request.headers['x-werkbuch-signature']));
}

/** Opens the page of an item and waits until its commands act (the palette lists them once what they read is there). */
async function openItem(page: Page, key: string, title: string): Promise<Locator> {
  await page.goto(`/items/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const fields = page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') });
  await expect(fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.state.label')}: `) })).toBeVisible();
  if (isPhone(page)) return fields;

  await pressMod(page, 'k');
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.state')}`) })).toBeVisible();
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.assignee')}`) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  return fields;
}

/**
 * Sets a field of the item with the keyboard: on the desktop through the command's sub-list of the palette (`key`), on the
 * phone through the field of the panel (spec 5.1). Types `value` once the search field has the focus.
 */
async function choose(page: Page, fields: Locator, what: 'state' | 'assignee', current: string, value: string) {
  if (isPhone(page)) {
    await tabTo(page, fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label: tr('en', `items.fields.${what}.label`), value: current })}`) }), { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: tr('en', `items.fields.${what}.placeholder`) })).toBeFocused();
  } else {
    await page.keyboard.press(what === 'state' ? 's' : 'a');
    const input = page.getByRole('dialog', { name: tr('en', 'palette.title') }).getByRole('combobox', { name: tr('en', `shortcuts.item.${what === 'state' ? 'state' : 'assignee'}`) });
    await expect(input).toBeFocused();
  }
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await expect(fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label: tr('en', `items.fields.${what}.label`), value })}`) })).toBeVisible();
}

/** Removes webhook, project and receiver of a test, from a page outside the project (the item page would load it again). */
async function cleanUp(page: Page, webhook: string | null, identifier: string, close: () => Promise<void>) {
  await page.goto('/my-items');
  if (webhook) await removeE2eWebhook(page, webhook);
  await removeE2eProject(page, identifier);
  await close();
}

test('Erfolgskriterium 2.5: a webhook arrives signed', async ({ page }) => {
  const receiver = await startReceiver();
  const project = await createE2eProject(page, name('signed'), { types: ['Task'] });
  let webhook: string | null = null;
  try {
    const hook = await createE2eWebhook(page, { name: 'signed', url: receiver.url, events: ['work_item.*'], project_id: project.id });
    webhook = hook.id;
    const item = await createItem(page, { project_id: project.id, title: 'E2E Webhook Status' });

    const fields = await openItem(page, item.key, 'E2E Webhook Status');
    await choose(page, fields, 'state', 'Backlog', 'Todo');
    // the server's confirmation of the command (the field of the phone saves without a toast; the receiver tells there)
    if (!isPhone(page)) await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.state', { state: 'Todo' }) }))).toBeVisible();

    // the change arrives at the receiver, signed with the secret of the webhook
    await expect.poll(() => of(receiver.requests, 'work_item.state_changed').length, { timeout: WEBHOOK }).toBeGreaterThan(0);
    const [request] = of(receiver.requests, 'work_item.state_changed');
    expect(signed(request!, hook.secret)).toBe(true);
    expect(signed(request!, `${hook.secret}x`)).toBe(false);
    expect(verifyWerkbuchSignature(hook.secret, String(request!.headers['x-werkbuch-timestamp']), request!.body.replace(item.key, `${item.key}0`), String(request!.headers['x-werkbuch-signature']))).toBe(false);
    const body = JSON.parse(request!.body) as { event: string; project: { identifier: string }; data: { key: string; state_id: string }; changes: { state_id: { old: string; new: string } } };
    expect(body.event).toBe('work_item.state_changed');
    expect(body.project.identifier).toBe(project.identifier);
    expect(body.data.key).toBe(item.key);
    expect(body.changes.state_id.new).toBe(body.data.state_id);
    expect(body.changes.state_id.old).not.toBe(body.changes.state_id.new);
    const delivery = String(request!.headers['x-werkbuch-delivery']);

    // the log records the try once the answer is in: then the UI shows it with the 200 of the receiver
    await expect
      .poll(
        async () => {
          const response = await api(page, 'GET', `/api/v1/webhooks/${hook.id}/deliveries`);
          const { data } = (await response.json()) as { data: { delivery_id: string; status_code: number | null }[] };
          return data.find((entry) => entry.delivery_id === delivery)?.status_code ?? null;
        },
        { timeout: WEBHOOK },
      )
      .toBe(200);
    const loaded = page.waitForResponse((response) => response.url().includes(`/api/v1/webhooks/${hook.id}/deliveries`) && response.ok());
    await page.goto(`/settings/webhooks?deliveries=${hook.id}`);
    await loaded;
    const row = page
      .getByRole('list', { name: tr('en', 'settings.webhooks.deliveries') })
      .getByRole('listitem')
      .filter({ hasText: 'work_item.state_changed' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('200');

    // exactly one: the log holds one try, and the receiver got no second request of that event (K18)
    expect(of(receiver.requests, 'work_item.state_changed')).toHaveLength(1);
    expect(receiver.requests.filter((entry) => entry.headers['x-werkbuch-delivery'] === delivery)).toHaveLength(1);
  } finally {
    await cleanUp(page, webhook, project.identifier, receiver.close);
  }
});

test('a bot assignment reaches the agent', async ({ page }) => {
  const receiver = await startReceiver();
  const project = await createE2eProject(page, name('agent'), { types: ['Task'] });
  let webhook: string | null = null;
  try {
    // Kira (a demo bot) works in the project; the agent's webhook takes every bot event of Kira there
    const kira = (await allEntries(page, 'bots')).find((bot) => bot.handle === 'kira') as { id: string; name: string } | undefined;
    if (!kira) throw new Error('No bot kira in the demo data');
    const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: kira.id, role: 'member' });
    expect(added.status(), await added.text()).toBe(201);
    const hook = await createE2eWebhook(page, { name: 'agent', url: receiver.url, events: ['bot.*'], project_id: project.id, bot_id: kira.id });
    webhook = hook.id;
    const item = await createItem(page, { project_id: project.id, title: 'E2E Webhook Agent' });

    const fields = await openItem(page, item.key, 'E2E Webhook Agent');
    await choose(page, fields, 'assignee', tr('en', 'items.fields.assignee.nobody'), kira.name);

    await expect.poll(() => of(receiver.requests, 'bot.assigned').length, { timeout: WEBHOOK }).toBeGreaterThan(0);
    const [request] = of(receiver.requests, 'bot.assigned');
    expect(signed(request!, hook.secret)).toBe(true);
    const body = JSON.parse(request!.body) as { event: string; actor: { name: string }; data: { bot: { id: string; handle: string }; item: { key: string; assignee_id: string } } };
    expect(body.event).toBe('bot.assigned');
    expect(body.data.bot).toMatchObject({ id: kira.id, handle: 'kira' });
    expect(body.data.item.key).toBe(item.key);
    expect(body.data.item.assignee_id).toBe(kira.id);
    expect(body).not.toHaveProperty('meta');
    // the bot's webhook takes only the bot events (`bot.*`): nothing else of the item came
    expect(receiver.requests.every((entry) => String(entry.headers['x-werkbuch-event']).startsWith('bot.'))).toBe(true);
  } finally {
    await cleanUp(page, webhook, project.identifier, receiver.close);
  }
});
