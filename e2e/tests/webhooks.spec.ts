import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { artisanEval, createE2eProject, createE2eWebhook, createItem, isPhone, pressMod, removeE2eProject, removeE2eWebhook, runId, tabTo, tr, variant, waitForNotification } from '../helpers';
import { startReceiver, type ReceivedRequest } from '../webhookReceiver';

// Settings → Webhooks (spec 6.3) as the e2e person (Erik Ende, org admin), in English. The receiver is a small server on
// the Mac (`startReceiver()`, T11). Everything the specs make is a webhook named `E2E …` (the seeder removes what an
// aborted run left), and the demo webhooks are off in e2e (A377), so no other delivery goes anywhere. Deliveries run
// through the queue: the specs wait on the receiver and the log, never on a fixed pause (K18).

const WEBHOOK = 30_000;
// what goes through the queue (consume, deliver, notify) waits as long as the acceptance specs: locally `webhooks` comes after
// `items` and `inbox`, a delivery took up to 50 s (K18)
const QUEUED = 90_000;
// the name createE2eWebhook() gives a webhook called `what`
const name = (what: string) => `E2E ${variant()} ${runId()} ${what}`;
const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);

// the ddev calls and the queue take their time
test.describe.configure({ timeout: 240_000 });

/** Whether the signature of a request is the one the secret makes (spec 6.3: HMAC-SHA256 over "timestamp.body"). */
function signedWith(request: ReceivedRequest, secret: string): boolean {
  const timestamp = String(request.headers['x-werkbuch-timestamp']);
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${request.body}`).digest('hex')}`;
  return request.headers['x-werkbuch-signature'] === expected;
}

async function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test('creates a webhook with the keyboard, copies its secret once and pings the receiver', async ({ page }) => {
  const receiver = await startReceiver();
  const hook = name('keyboard');
  let created: string | null = null;
  try {
    await page.goto('/settings/webhooks');
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.webhooks') })).toBeVisible();

    const open = page.getByRole('button', { name: label('settings.webhooks.create') }).first();
    await tabTo(page, open, { max: 80 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: label('settings.webhooks.dialog.new_title') });
    await expect(dialog).toBeVisible();

    // name and address, then the whole group "Work items" with the space bar
    await tabTo(page, dialog.getByRole('textbox', { name: label('settings.webhooks.dialog.name') }));
    await page.keyboard.type(hook);
    await tabTo(page, dialog.getByRole('textbox', { name: label('settings.webhooks.dialog.url') }));
    await page.keyboard.type(receiver.url);
    const group = dialog.getByRole('checkbox', { name: new RegExp(label('settings.webhooks.group.work_item')) }).first();
    await tabTo(page, group, { max: 30 });
    await page.keyboard.press('Space');
    await expect(group).toBeChecked();
    await pressMod(page, 'Enter');

    // the secret is shown this one time; the button copies it
    const secretDialog = page.getByRole('dialog', { name: label('settings.webhooks.secret.created_title') });
    await expect(secretDialog).toBeVisible();
    const field = secretDialog.getByRole('textbox', { name: label('settings.webhooks.secret.label') });
    await expect(field).toHaveValue(/^whsec_\S+$/);
    await tabTo(page, secretDialog.getByRole('button', { name: label('settings.webhooks.secret.copy') }));
    await page.keyboard.press('Enter');
    // the clipboard belongs to the browser, not to the context: an earlier spec's token is still there until the copy
    const secret = await field.inputValue();
    await expect.poll(() => clipboard(page)).toBe(secret);
    await tabTo(page, secretDialog.getByRole('button', { name: label('settings.webhooks.secret.done') }));
    await page.keyboard.press('Enter');
    await expect(secretDialog).toHaveCount(0);

    // the card is in the list; gone for good after a reload: the secret is nowhere on the page any more
    const card = page.getByRole('article', { name: hook });
    await expect(card).toBeVisible();
    const found = await page.evaluate(async (title) => {
      const response = await fetch('/api/v1/webhooks', { headers: { Accept: 'application/json' } });
      return ((await response.json()) as { data: { id: string; name: string }[] }).data.find((entry) => entry.name === title)?.id ?? null;
    }, hook);
    created = found;
    await page.reload();
    await expect(page.getByRole('article', { name: hook })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secret);
    expect(await page.evaluate(async () => (await fetch('/api/v1/webhooks')).text())).not.toContain(secret);

    // the test ping
    const ping = page.getByRole('button', { name: label('settings.webhooks.ping_named', { name: hook }) });
    await tabTo(page, ping, { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('settings.webhooks.toast.arrived', { subject: label('settings.webhooks.log.subject_ping'), name: hook }))).toBeVisible({ timeout: WEBHOOK });
    await expect.poll(() => receiver.requests.filter((request) => request.headers['x-werkbuch-event'] === 'ping').length, { timeout: WEBHOOK }).toBe(1);
    const request = receiver.requests.find((entry) => entry.headers['x-werkbuch-event'] === 'ping')!;
    expect(signedWith(request, secret)).toBe(true);
    expect(signedWith(request, `${secret}x`)).toBe(false);
  } finally {
    if (created) await removeE2eWebhook(page, created);
    await receiver.close();
  }
});

test('renews the secret without losing the form', async ({ page }) => {
  const receiver = await startReceiver();
  // a project webhook: the new secret is proven by an event, which is not limited like the test ping (six a minute)
  const project = await createE2eProject(page, `E2E webhook renew ${variant()} ${runId()}`, { types: ['Task'] });
  const { id, secret: first } = await createE2eWebhook(page, { name: 'renew', url: receiver.url, events: ['work_item.created'], project_id: project.id });
  const named = name('renew');
  try {
    await page.goto('/settings/webhooks');
    await expect(page.getByRole('article', { name: named })).toBeVisible();
    const edit = page.getByRole('button', { name: label('settings.webhooks.edit_named', { name: named }) });
    await tabTo(page, edit, { max: 80 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: label('settings.webhooks.dialog.edit_title', { name: named }) });
    await expect(dialog).toBeVisible();

    // something typed into the form that is not saved yet
    const field = dialog.getByRole('textbox', { name: label('settings.webhooks.dialog.name') });
    await tabTo(page, field);
    await page.keyboard.press('End');
    await page.keyboard.type(' renamed');

    const renew = dialog.getByRole('button', { name: label('settings.webhooks.rotate.button') });
    await tabTo(page, renew, { max: 40 });
    await page.keyboard.press('Enter');
    const ask = page.getByRole('alertdialog', { name: label('settings.webhooks.rotate.title') });
    await expect(ask).toBeVisible();
    await tabTo(page, ask.getByRole('button', { name: label('settings.webhooks.rotate.button') }));
    await page.keyboard.press('Enter');

    const secretDialog = page.getByRole('dialog', { name: label('settings.webhooks.secret.rotated_title') });
    await expect(secretDialog).toBeVisible();
    await tabTo(page, secretDialog.getByRole('button', { name: label('settings.webhooks.secret.copy') }));
    await page.keyboard.press('Enter');
    const second = await clipboard(page);
    expect(second.length).toBeGreaterThan(16);
    expect(second).not.toBe(first);
    await tabTo(page, secretDialog.getByRole('button', { name: label('settings.webhooks.secret.done') }));
    await page.keyboard.press('Enter');
    await expect(secretDialog).toHaveCount(0);

    // the form is still there with what was typed; saving it keeps the new secret
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue(`${named} renamed`);
    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.webhooks.dialog.saved', { name: `${named} renamed` }))).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await createItem(page, { project_id: project.id, title: 'E2E webhook Geheimnis' });
    await expect.poll(() => receiver.requests.length, { timeout: QUEUED }).toBe(1);
    expect(receiver.requests[0]!.headers['x-werkbuch-event']).toBe('work_item.created');
    expect(signedWith(receiver.requests[0]!, second)).toBe(true);
    expect(signedWith(receiver.requests[0]!, first)).toBe(false);
  } finally {
    await removeE2eWebhook(page, id);
    await removeE2eProject(page, project.identifier);
    await receiver.close();
  }
});

test('shows a switched-off webhook in the inbox and turns it on again', async ({ page }) => {
  const receiver = await startReceiver({ status: 500 });
  const project = await createE2eProject(page, `E2E webhook off ${variant()} ${runId()}`, { types: ['Task'] });
  const hook = await createE2eWebhook(page, { name: 'off', url: receiver.url, events: ['work_item.created'], project_id: project.id });
  const title = name('off');
  try {
    // a webhook that has failed for 25 hours already: the next failed try switches it off
    const set = artisanEval(
      `DB::table('webhooks')->where('id', '${hook.id}')->update(['failing_since' => now()->subHours(25)->format('Y-m-d H:i:s.u')]); echo 'set';`,
    );
    expect(set).toBe('set');
    await createItem(page, { project_id: project.id, title: 'E2E webhook Ausfall' });

    const notification = await waitForNotification(page, (entry) => entry.event === 'webhook_disabled' && entry.data.webhook_id === hook.id, QUEUED);
    expect(notification.read_at).toBeNull();
    expect(receiver.requests.length).toBeGreaterThan(0);

    // the row of the inbox leads to the log of that webhook, with the way back
    await page.goto('/inbox');
    const row = page.getByRole('link', { name: new RegExp(label('inbox.kind.webhook_disabled_named', { name: title }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/settings/webhooks\\?deliveries=${hook.id}`));
    await expect(page.getByRole('heading', { name: label('settings.webhooks.deliveries_of', { name: title }) })).toBeVisible();
    await expect(page.getByText(label('settings.webhooks.reenable.title'))).toBeVisible();

    // the log holds the failed try with its status
    await expect(page.getByRole('list', { name: label('settings.webhooks.deliveries') })).toContainText('500');

    const again = page.getByRole('button', { name: label('settings.webhooks.reenable.button') });
    await tabTo(page, again, { max: 60 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('settings.webhooks.reenable.done', { name: title }))).toBeVisible();
    await expect(page.getByText(label('settings.webhooks.reenable.title'))).toHaveCount(0);
    // the button went with the notice: the heading of the log takes the focus, not the page
    await expect(page.getByRole('heading', { name: label('settings.webhooks.deliveries_of', { name: title }) })).toBeFocused();
  } finally {
    await removeE2eWebhook(page, hook.id);
    await removeE2eProject(page, project.identifier);
    await receiver.close();
  }
});

test('sends a delivery of the log again with the keyboard', async ({ page }) => {
  const receiver = await startReceiver();
  const project = await createE2eProject(page, `E2E webhook again ${variant()} ${runId()}`, { types: ['Task'] });
  const hook = await createE2eWebhook(page, { name: 'again', url: receiver.url, events: ['work_item.created'], project_id: project.id });
  const title = name('again');
  try {
    // a delivery with its first attempt, written before the first key: the test does not wait on the queue (a backlog
    // of the full run held the first delivery longer than any sensible wait); "send again" itself runs in the request
    const delivery = artisanEval(
      [
        `$delivery = App\\Models\\WebhookDelivery::create(['webhook_id' => '${hook.id}', 'event_id' => strtolower((string) Illuminate\\Support\\Str::ulid()), 'event' => 'work_item.created', 'body' => '{}', 'status' => 'succeeded', 'attempts' => 1]);`,
        `App\\Models\\WebhookAttempt::create(['delivery_id' => $delivery->id, 'webhook_id' => '${hook.id}', 'attempt' => 1, 'kind' => 'scheduled', 'status_code' => 200, 'duration_ms' => 120, 'attempted_at' => now()]);`,
        'echo $delivery->id;',
      ].join(' '),
    );
    expect(delivery).toMatch(/^[0-9a-z]{26}$/);

    await page.goto(`/settings/webhooks?deliveries=${hook.id}`);
    await expect(page.getByRole('heading', { name: label('settings.webhooks.deliveries_of', { name: title }) })).toBeVisible();
    const again = page.getByRole('button', { name: label('settings.webhooks.log.resend_named', { event: label('webhooks.event.work_item_created'), n: 1 }) });
    await tabTo(page, again, { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('settings.webhooks.toast.arrived', { subject: label('settings.webhooks.log.subject_delivery'), name: title }))).toBeVisible({ timeout: WEBHOOK });

    // the same delivery once more: its id at the receiver, a new attempt in the log
    const sent = receiver.requests.filter((request) => request.headers['x-werkbuch-event'] === 'work_item.created');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers['x-werkbuch-delivery']).toBe(delivery);
    await expect(page.getByRole('list', { name: label('settings.webhooks.deliveries') }).getByRole('listitem')).toHaveCount(2);
  } finally {
    await removeE2eWebhook(page, hook.id);
    await removeE2eProject(page, project.identifier);
    await receiver.close();
  }
});

test('lists the webhooks on the phone and pings with a tap', async ({ page }) => {
  test.skip(!isPhone(page), 'the touch screen');
  const receiver = await startReceiver();
  const { id } = await createE2eWebhook(page, { name: 'phone', url: receiver.url, events: ['work_item.*', 'bot.assigned'] });
  const hook = name('phone');
  try {
    await page.goto('/settings/webhooks');
    const card = page.getByRole('article', { name: hook });
    await expect(card).toBeVisible();
    await expect(card).toContainText(receiver.url);
    // nothing runs off the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await card.getByRole('button', { name: label('settings.webhooks.ping_named', { name: hook }) }).click();
    await expect(page.getByText(label('settings.webhooks.toast.arrived', { subject: label('settings.webhooks.log.subject_ping'), name: hook }))).toBeVisible({ timeout: WEBHOOK });
    expect(receiver.requests.filter((request) => request.headers['x-werkbuch-event'] === 'ping')).toHaveLength(1);
  } finally {
    await removeE2eWebhook(page, id);
    await receiver.close();
  }
});
