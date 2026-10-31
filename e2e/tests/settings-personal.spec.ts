import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, login, PEOPLE, pressMod, runId, signedInContext, signOut, tabTo, totp, tr, variant } from '../helpers';

// The own settings of the security account of the project (Sam Security, a member; E2eSeeder sets it back every run:
// name, handle, language, password, no second factor). Each test runs in a context of its own signed in as Sam. One
// after another: the last test changes the password and signs in anew, which ends the session the others share.
test.describe.configure({ mode: 'serial' });

const NAME = 'Sam Security';

const person = () => PEOPLE.security[variant()]!;

/** A page signed in as the security account, closed at the end whatever happened. */
async function asSam(browser: Browser, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await signedInContext(browser, person());
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

/** Changes Sam's profile over the API, as Sam. */
async function updateSam(page: Page, patch: Record<string, string>): Promise<void> {
  const people = (await (await api(page, 'GET', '/api/v1/users?type=person')).json()) as { data: { id: string; email: string }[] };
  const sam = people.data.find((account) => account.email === person().email);
  expect(sam, 'Sam on the first page of people').toBeDefined();
  const response = await api(page, 'PATCH', `/api/v1/users/${sam!.id}`, patch);
  expect(response.status(), await response.text()).toBe(200);
}

/** Sets name, handle and language back, whatever the test left behind. */
const resetProfile = (page: Page) => updateSam(page, { name: NAME, handle: `security-${variant()}`, locale: 'en' });

async function openSection(page: Page, section: 'profile' | 'security' | 'api', locale: 'en' | 'de' = 'en'): Promise<void> {
  await page.goto(`/me/${section}`);
  await expect(page.getByRole('heading', { level: 1, name: tr(locale, 'settings.personal.title') })).toBeVisible();
}

/** Puts `text` into the focused field instead of what is there, with the keyboard. */
async function replaceText(page: Page, text: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

test('changes name and handle in the profile', async ({ browser }) => {
  const name = `Sam ${runId()}`;
  const handle = `sam-${runId().toLowerCase()}-${variant()}`;
  await asSam(browser, async (page) => {
    try {
      await openSection(page, 'profile');
      await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.personal.section.profile') })).toBeVisible();
      const nameField = page.getByRole('textbox', { name: tr('en', 'settings.personal.profile.name') });
      const handleField = page.getByRole('textbox', { name: tr('en', 'settings.personal.profile.handle') });

      await tabTo(page, nameField);
      await replaceText(page, name);
      await page.keyboard.press('Tab');
      await expect(handleField).toBeFocused();
      await replaceText(page, handle);
      await expect(page.getByText(`@${handle}.`, { exact: false })).toBeVisible();
      await pressMod(page, 'Enter');
      await expect(page.getByText(tr('en', 'settings.personal.profile.saved'))).toBeVisible();

      await page.reload();
      await expect(nameField).toHaveValue(name);
      await expect(handleField).toHaveValue(handle);
      // the frame names the person with the new name
      await expect(page.getByRole('main').getByText(name, { exact: true })).toBeVisible();
    } finally {
      await resetProfile(page);
    }
  });
});

test('switches the language to English and back', async ({ browser }) => {
  await asSam(browser, async (page) => {
    try {
      // Sam starts in German (the organization speaks English)
      await page.goto('/me/profile');
      await updateSam(page, { locale: 'de' });
      await openSection(page, 'profile', 'de');
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');

      for (const [locale, from, choice, key] of [
        ['en', 'de', 'settings.personal.profile.locale_en', 'ArrowDown'],
        ['de', 'en', 'settings.personal.profile.locale_de', 'ArrowUp'],
      ] as const) {
        const language = page.getByRole('combobox', { name: tr(from, 'settings.personal.profile.locale') });
        await tabTo(page, language);
        await page.keyboard.press('Enter');
        await arrowTo(page, page.getByRole('option', { name: tr(from, choice) }), key);
        await page.keyboard.press('Enter');
        await expect(language).toHaveText(tr(from, choice));
        await pressMod(page, 'Enter');

        // the page loads anew in the language of the profile
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.getByRole('heading', { level: 1, name: tr(locale, 'settings.personal.title') })).toBeVisible();
      }
    } finally {
      await resetProfile(page);
    }
  });
});

test('sets up two-factor sign-in with a real code and turns it off again', async ({ browser }) => {
  await asSam(browser, async (page) => {
    try {
      await openSection(page, 'security');
      const card = page.getByRole('region', { name: tr('en', 'settings.two_factor.title') });
      await expect(card).toContainText(tr('en', 'settings.two_factor.off'));

      await tabTo(page, card.getByRole('button', { name: tr('en', 'settings.two_factor.setup') }));
      await page.keyboard.press('Enter');
      await expect(card.getByRole('img', { name: tr('en', 'settings.two_factor.scan.qr_alt') })).toBeVisible();
      // the key of the server, in groups of four, as a person would type it into the app
      const key = (await card.locator('code').innerText()).replaceAll(' ', '');
      expect(key).toMatch(/^[A-Z2-7]{16,}$/);

      await tabTo(page, card.getByRole('textbox', { name: tr('en', 'settings.two_factor.confirm.code') }));
      await page.keyboard.type(totp(key));
      await page.keyboard.press('Enter');

      const codes = card.getByRole('list', { name: tr('en', 'settings.two_factor.codes.label') });
      await expect(codes).toBeFocused();
      await expect(codes.getByRole('listitem')).toHaveCount(8);
      await expect(page.getByText(tr('en', 'settings.two_factor.enabled'))).toBeVisible();
      await tabTo(page, card.getByRole('button', { name: tr('en', 'settings.two_factor.codes_saved') }));
      await page.keyboard.press('Enter');
      await expect(codes).toBeHidden();
      await expect(card).toContainText(tr('en', 'settings.two_factor.codes_left', { left: 8, total: 8 }));
      await expect(card).toContainText(tr('en', 'settings.two_factor.on'));

      await tabTo(page, card.getByRole('button', { name: tr('en', 'settings.two_factor.disable') }));
      await page.keyboard.press('Enter');
      const question = page.getByRole('alertdialog', { name: tr('en', 'settings.two_factor.disable_dialog.title') });
      await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.two_factor.disable_dialog.confirm') }));
      await page.keyboard.press('Enter');
      await expect(page.getByText(tr('en', 'settings.two_factor.disabled'))).toBeVisible();
      await expect(card.getByRole('button', { name: tr('en', 'settings.two_factor.setup') })).toBeFocused();
    } finally {
      // a failure halfway must not leave the second factor on for the sign-in of the last test
      expect((await api(page, 'DELETE', '/api/v1/me/two-factor')).status()).toBe(204);
    }
  });
});

test('creates a token, copies it and revokes it', async ({ browser }) => {
  const name = `Laptop ${runId()}`;
  await asSam(browser, async (page) => {
    await openSection(page, 'api');
    await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.api.new_token') }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.tokens.dialog.new_title') });
    await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.tokens.dialog.name') }));
    await page.keyboard.type(name);
    await pressMod(page, 'Enter');

    const created = page.getByRole('dialog', { name: tr('en', 'settings.tokens.dialog.created_title') });
    const secret = created.getByRole('textbox', { name: tr('en', 'settings.tokens.dialog.token') });
    await expect(secret).toBeFocused();
    const plain = await secret.inputValue();
    expect(plain).toMatch(/^[0-9a-z]+\|wb_/i);
    await tabTo(page, created.getByRole('button', { name: tr('en', 'settings.tokens.copy') }));
    await page.keyboard.press('Enter');
    await expect(created.getByRole('button', { name: tr('en', 'common.copied') })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(plain);
    await tabTo(page, created.getByRole('button', { name: tr('en', 'settings.tokens.copied_confirm') }));
    await page.keyboard.press('Enter');
    await expect(created).toBeHidden();

    const tokens = page.getByRole('list', { name: tr('en', 'settings.tokens.title') });
    const row = tokens.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(row).toContainText(tr('en', 'settings.tokens.ability.mcp'));
    await tabTo(page, row.getByRole('button', { name: tr('en', 'settings.api.revoke', { name }) }));
    const revoked = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/api/v1/tokens/'));
    await page.keyboard.press('Enter');
    await expect(row).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: tr('en', 'settings.api.revoked', { name }) })).toBeVisible();
    // the call goes out when the toast runs out
    expect((await revoked).status()).toBe(204);
  });
});

test('asks before leaving an unsaved profile', async ({ browser }) => {
  await asSam(browser, async (page) => {
    await openSection(page, 'profile');
    const name = page.getByRole('textbox', { name: tr('en', 'settings.personal.profile.name') });
    const question = page.getByRole('alertdialog', { name: tr('en', 'settings.frame.leave_title') });

    // Tab selects the whole value: the arrow puts the caret at its end
    await tabTo(page, name);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(' edited');
    // back to the avatar's button, out of the fields, so the keys are shortcuts again
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(question).toContainText(tr('en', 'settings.frame.leave_description', { what: tr('en', 'settings.personal.profile.leave_what') }));

    await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.frame.leave_cancel') }));
    await page.keyboard.press('Enter');
    await expect(question).toBeHidden();
    await expect(page).toHaveURL(/\/me\/profile$/);
    await expect(name).toHaveValue(`${NAME} edited`);

    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.frame.leave_confirm') }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects$/);
  });
});

test('changes the password and signs in with the new one', async ({ browser }) => {
  const password = `new-password-${runId()}`;
  await asSam(browser, async (page) => {
    await openSection(page, 'security');
    await tabTo(page, page.getByLabel(tr('en', 'settings.security.password.current')));
    await page.keyboard.type(person().password);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(tr('en', 'settings.security.password.new'), { exact: true })).toBeFocused();
    await page.keyboard.type(password);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(tr('en', 'settings.security.password.again'))).toBeFocused();
    await page.keyboard.type(password);
    await page.keyboard.press('Enter');

    await expect(page.getByText(tr('en', 'settings.security.password.changed_description'))).toBeVisible();
    // this session stays
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: tr('en', 'settings.personal.title') })).toBeVisible();

    await signOut(page, 'en', NAME);
    await login(page, person().email, password);
    await expect(page).toHaveURL(/\/my-items$/);
  });
});
