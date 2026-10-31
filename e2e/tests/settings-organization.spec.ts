import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, PEOPLE, pressMod, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin; playwright.config.ts), in English. Whatever a test creates carries
// the id of the run; what it changes on shared records (the name of the organization, Lene's role) it sets back.

const ORGANIZATION = 'Feldwerk';

/** Sets the name of the organization back over the API, whatever the test left behind. */
async function resetOrganizationName(page: Page): Promise<void> {
  const response = await api(page, 'PATCH', '/api/v1/organization', { name: ORGANIZATION });
  expect(response.status(), await response.text()).toBe(200);
}

/** Makes Lene a member again over the API (a spec below signs in as her, a member). */
async function resetLeneToMember(page: Page): Promise<void> {
  const people = (await (await api(page, 'GET', '/api/v1/users?type=person')).json()) as { data: { id: string; email: string }[]; meta: { next_cursor: string | null } };
  const lene = people.data.find((person) => person.email === PEOPLE.lene.email);
  expect(lene, 'Lene on the first page of people').toBeDefined();
  const response = await api(page, 'PUT', `/api/v1/users/${lene!.id}/role`, { org_role: 'member' });
  expect(response.status(), await response.text()).toBe(200);
}

async function openSection(page: Page, section: 'general' | 'people' | 'bots'): Promise<void> {
  await page.goto(`/settings/${section}`);
  await expect(page.getByRole('heading', { level: 2, name: tr('en', `settings.org.section.${section}`) })).toBeVisible();
}

/** Puts `text` into the field instead of what is there, with the keyboard. */
async function replaceText(page: Page, text: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

test('changes the name of the organization with the keyboard', async ({ page }) => {
  const renamed = `${ORGANIZATION} ${runId()}`;
  await openSection(page, 'general');
  const name = page.getByRole('textbox', { name: tr('en', 'settings.org.general.name') });

  try {
    await tabTo(page, name);
    await replaceText(page, renamed);
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'settings.org.general.saved'))).toBeVisible();

    await page.reload();
    await expect(name).toHaveValue(renamed);

    // back to the name every other spec expects
    await tabTo(page, name);
    await replaceText(page, ORGANIZATION);
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'settings.org.general.saved'))).toBeVisible();
    await page.reload();
    await expect(name).toHaveValue(ORGANIZATION);
  } finally {
    // a failure halfway must not leave the renamed organization to the specs after it
    await resetOrganizationName(page);
  }
});

test('loads the page anew in a new default language without asking to leave', async ({ page }) => {
  // Erik has no language of his own: the organization's is his; the browser asks before a reload only when a page says so
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  try {
    await openSection(page, 'general');
    const language = page.getByRole('combobox', { name: tr('en', 'settings.org.general.locale') });
    await tabTo(page, language);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: tr('en', 'settings.org.general.locale_de') }), 'ArrowUp');
    await page.keyboard.press('Enter');
    await expect(language).toHaveText(tr('en', 'settings.org.general.locale_de'));
    await pressMod(page, 'Enter');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { level: 2, name: tr('de', 'settings.org.section.general') })).toBeVisible();
    expect(dialogs).toEqual([]);
  } finally {
    // every other spec reads the English texts
    const response = await api(page, 'PATCH', '/api/v1/organization', { locale: 'en' });
    expect(response.status(), await response.text()).toBe(200);
  }
});

test('invites a person, copies the link and shows it in the list', async ({ page }) => {
  const email = `invite-org-${variant()}-${runId().toLowerCase()}@example.com`;
  await openSection(page, 'people');

  await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.people.invite') }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'settings.people.invite') });
  await expect(dialog).toBeVisible();

  await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.people.invite_dialog.email') }));
  await page.keyboard.type(email);
  await tabTo(page, dialog.getByRole('checkbox', { name: /^WEB / }));
  await page.keyboard.press('Space');
  const role = dialog.getByRole('combobox', { name: tr('en', 'settings.people.invite_dialog.project_role', { project: 'WEB' }) });
  await tabTo(page, role);
  await page.keyboard.press('Enter');
  await arrowTo(page, page.getByRole('option', { name: tr('en', 'roles.project.viewer') }));
  await page.keyboard.press('Enter');
  // Tab right after the choice, while the list still fades out: the focus stays in the dialog
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: tr('en', 'common.cancel') })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(role).toBeFocused();
  await expect(role).toHaveText(tr('en', 'roles.project.viewer'));
  await pressMod(page, 'Enter');

  const sent = page.getByRole('dialog', { name: tr('en', 'settings.people.invite_dialog.sent_title') });
  await expect(sent).toBeVisible();
  const link = await sent.getByRole('textbox', { name: tr('en', 'settings.people.link_label') }).inputValue();
  expect(link).toMatch(/\/invitations\/[0-9a-z]+\?signature=/i);
  await tabTo(page, sent.getByRole('button', { name: tr('en', 'settings.people.copy_link') }));
  await page.keyboard.press('Enter');
  await expect(sent.getByText(tr('en', 'ui.copy_field.copied'))).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await tabTo(page, sent.getByRole('button', { name: tr('en', 'settings.people.invite_dialog.done') }));
  await page.keyboard.press('Enter');
  await expect(sent).toBeHidden();

  const row = page.getByRole('list', { name: tr('en', 'settings.people.invitations.title') }).getByRole('listitem').filter({ hasText: email });
  await expect(row).toContainText(`WEB ${tr('en', 'settings.people.invitations.as_role', { role: tr('en', 'roles.project.viewer') })}`);
  await expect(row).toContainText(tr('en', 'roles.org.member'));
});

test('changes the role of a person and back', async ({ page }) => {
  const lene = PEOPLE.lene.name;
  await openSection(page, 'people');
  const role = page.getByRole('combobox', { name: tr('en', 'settings.people.role_of', { name: lene }) });

  try {
    for (const [next, key] of [
      ['admin', 'ArrowUp'],
      ['member', 'ArrowDown'],
    ] as const) {
      await tabTo(page, role);
      await page.keyboard.press('Enter');
      await arrowTo(page, page.getByRole('option', { name: tr('en', `roles.org.${next}`) }), key);
      await page.keyboard.press('Enter');
      await expect(page.getByText(tr('en', 'settings.people.role_changed', { name: lene, role: tr('en', `roles.org.${next}`) }))).toBeVisible();
      await expect(role).toHaveText(tr('en', `roles.org.${next}`));
      // the field stays usable while the call runs, so the keyboard focus stays on it
      await expect(role).toBeFocused();
    }
  } finally {
    await resetLeneToMember(page);
  }
});

test('creates a bot, a token for it, and revokes it', async ({ page }) => {
  const bot = `Bot ${runId()} ${variant()}`;
  const tokenName = `Deploy ${runId()}`;
  await openSection(page, 'bots');

  await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.bots.create'), exact: true }).first());
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'settings.bots.create') });
  await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.bots.dialog.name') }));
  await page.keyboard.type(bot);
  await expect(dialog.getByRole('textbox', { name: tr('en', 'settings.bots.dialog.handle') })).toHaveValue(`bot-${runId().toLowerCase()}-${variant()}`);
  await pressMod(page, 'Enter');
  await expect(page.getByText(tr('en', 'settings.bots.dialog.created', { name: bot }))).toBeVisible();

  const card = page.getByRole('article', { name: bot });
  await expect(card).toContainText(tr('en', 'settings.bots.bot_badge'));
  await expect(card).toContainText(PEOPLE.e2e.name);
  await tabTo(page, card.getByRole('button', { name: `${tr('en', 'settings.tokens.create')} ${bot}` }));
  await page.keyboard.press('Enter');
  const tokenDialog = page.getByRole('dialog', { name: tr('en', 'settings.tokens.dialog.new_title_bot', { name: bot }) });
  await tabTo(page, tokenDialog.getByRole('textbox', { name: tr('en', 'settings.tokens.dialog.name') }));
  await page.keyboard.type(tokenName);
  await pressMod(page, 'Enter');

  // the plain text, once, focused for copying
  const created = page.getByRole('dialog', { name: tr('en', 'settings.tokens.dialog.created_title') });
  const secret = created.getByRole('textbox', { name: tr('en', 'settings.tokens.dialog.token') });
  await expect(secret).toBeFocused();
  await expect(secret).toHaveValue(/^[0-9a-z]+\|wb_/i);
  await expect(created.getByText(/claude mcp add --transport http --scope user werkbuch/)).toBeVisible();
  await tabTo(page, created.getByRole('button', { name: tr('en', 'settings.tokens.copied_confirm') }));
  await page.keyboard.press('Enter');
  await expect(created).toBeHidden();

  const tokens = card.getByRole('list', { name: tr('en', 'settings.tokens.list_of', { name: bot }) });
  await expect(tokens).toContainText(tokenName);
  await expect(tokens).toContainText(tr('en', 'settings.tokens.never_used'));
  await tabTo(page, tokens.getByRole('button', { name: tr('en', 'settings.tokens.revoke', { name: tokenName }) }));
  const revoked = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/api/v1/tokens/'));
  await page.keyboard.press('Enter');
  await expect(tokens).toBeHidden();
  const undo = page.getByRole('status').filter({ hasText: tr('en', 'settings.tokens.revoked', { name: tokenName, owner: bot }) });
  await expect(undo.getByRole('button', { name: tr('en', 'common.undo'), exact: true })).toBeVisible();
  // the call goes out when the toast runs out
  expect((await revoked).status()).toBe(204);
  await expect(card).toContainText(tr('en', 'settings.tokens.bot_empty'));

  // deactivated bots move to the end of the list, so the list a later run tabs through stays short
  await tabTo(page, card.getByRole('button', { name: `${tr('en', 'settings.bots.deactivate')} ${bot}` }));
  await page.keyboard.press('Enter');
  await expect(page.getByText(tr('en', 'settings.bots.deactivated', { name: bot }))).toBeVisible();
  await expect(card).toContainText(tr('en', 'settings.bots.disabled'));
});

test('warns at the tokens of the default bot', async ({ page }) => {
  await openSection(page, 'bots');
  const card = page.getByRole('article', { name: 'Automation' });
  await expect(card).toContainText(tr('en', 'settings.bots.default_badge'));
  await expect(card.getByRole('note')).toContainText(tr('en', 'settings.tokens.admin_warning.list'));
  await expect(card.getByRole('button', { name: new RegExp(`^${tr('en', 'settings.bots.deactivate')}`) })).toHaveCount(0);

  await tabTo(page, card.getByRole('button', { name: `${tr('en', 'settings.tokens.create')} Automation` }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'settings.tokens.dialog.new_title_bot', { name: 'Automation' }) });
  await expect(dialog.getByRole('note')).toContainText(tr('en', 'settings.tokens.admin_warning.create'));
  await expect(dialog.getByRole('note')).toContainText(tr('en', 'settings.tokens.admin_warning.text'));

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('shows members the read-only general section and no people', async ({ browser }) => {
  // Lene is a member with a German profile
  const { context, page } = await signedInContext(browser, PEOPLE.lene);
  try {
    await page.goto('/settings');
    await expect(page.getByText(tr('de', 'settings.access.read_only'), { exact: true })).toBeVisible();
    const name = page.getByRole('textbox', { name: tr('de', 'settings.org.general.name') });
    await expect(name).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: tr('de', 'settings.frame.save') })).toHaveCount(0);

    const people = page.getByRole('link', { name: new RegExp(`^${tr('de', 'settings.org.section.people')}`) });
    await expect(people).toContainText(tr('de', 'settings.frame.admins_only'));
    await tabTo(page, people);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/people$/);
    await expect(page.getByText(tr('de', 'settings.access.title'), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: tr('de', 'settings.people.invite') })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('leaves an edited form only after the question', async ({ page }) => {
  await openSection(page, 'general');
  const name = page.getByRole('textbox', { name: tr('en', 'settings.org.general.name') });
  const question = page.getByRole('alertdialog', { name: tr('en', 'settings.frame.leave_title') });

  // Tab selects the whole value: the arrow puts the caret at its end
  await tabTo(page, name);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' edited');
  // out of the field, so the keys are shortcuts again
  await page.keyboard.press('Tab');
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await expect(question).toBeVisible();
  await expect(question).toContainText(tr('en', 'settings.frame.leave_description', { what: tr('en', 'settings.org.general.leave_what') }));

  await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.frame.leave_cancel') }));
  await page.keyboard.press('Enter');
  await expect(question).toBeHidden();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(name).toHaveValue(`${ORGANIZATION} edited`);

  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.frame.leave_confirm') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
});

test('asks before Back leaves an edited form', async ({ page }) => {
  await openSection(page, 'people');
  // to General inside the app, so Back stays in the document
  await tabTo(page, page.getByRole('link', { name: tr('en', 'settings.org.section.general'), exact: true }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/general$/);
  const name = page.getByRole('textbox', { name: tr('en', 'settings.org.general.name') });
  const question = page.getByRole('alertdialog', { name: tr('en', 'settings.frame.leave_title') });

  // typing is a user activation: only after one may a page stop Back
  // Tab selects the whole value: the arrow puts the caret at its end
  await tabTo(page, name);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' edited');
  await page.evaluate(() => history.back());
  await expect(question).toBeVisible();

  await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.frame.leave_cancel') }));
  await page.keyboard.press('Enter');
  await expect(question).toBeHidden();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(name).toHaveValue(`${ORGANIZATION} edited`);

  await page.evaluate(() => history.back());
  await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.frame.leave_confirm') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/people$/);
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.people') })).toBeVisible();
});

test('says when the people could not be loaded and offers to try again', async ({ page, allowedErrors }) => {
  allowedErrors.push(/status of 503 .*\/api\/v1\/users/);
  await page.route('**/api/v1/users*', (route) => route.fulfill({ status: 503 }));
  await openSection(page, 'people');

  await expect(page.getByText(tr('en', 'settings.people.load_failed'))).toBeVisible();
  await expect(page.getByRole('button', { name: tr('en', 'common.retry'), exact: true }).first()).toBeVisible();
});
