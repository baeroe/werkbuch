import { expect, test } from '../fixtures';
import { mailpit, openNavigation, PEOPLE, tabTo, tr } from '../helpers';

// Settings → System (spec 5.2) as the e2e person (Erik Ende, org admin; playwright.config.ts), in English. The test mail
// goes out synchronously to his own address; it counts as arrived once Mailpit holds a mail to him it did not hold
// before (the four projects share the address, so no test looks at a particular one of the new ones).

test('opens the system page with the keyboard and sends a test mail that arrives in Mailpit', async ({ page }) => {
  const email = PEOPLE.e2e.email;
  const before = await mailpit.idsTo(email);

  await page.goto('/my-items');
  const navigation = await openNavigation(page, 'en');
  const settings = navigation.getByRole('link', { name: tr('en', 'shell.nav.organization_settings') });
  await tabTo(page, settings, { max: 150 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/general$/);

  const sections = page.getByRole('navigation', { name: tr('en', 'settings.org.nav_label') });
  const system = sections.getByRole('link', { name: tr('en', 'settings.org.section.system') });
  await tabTo(page, system);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/system$/);
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.system') })).toBeVisible();

  // the state of the instance as the server reads it: a version, the queues and a mail server (Mailpit)
  const instance = page.getByRole('list', { name: tr('en', 'settings.system.instance.label') });
  await expect(instance).toBeVisible();
  await expect(instance.getByRole('list', { name: tr('en', 'settings.system.queues.list') }).getByText('notifications', { exact: true })).toBeVisible();
  await expect(instance.getByText(tr('en', 'settings.system.mail.ok'))).toBeVisible();

  const send = page.getByRole('button', { name: tr('en', 'settings.system.test_mail.send', { email }) });
  await tabTo(page, send);
  await page.keyboard.press('Enter');
  await expect(page.getByText(tr('en', 'settings.system.test_mail.sent', { email }))).toBeVisible();

  // sent before the answer came: it is in Mailpit already or within moments
  await expect.poll(() => mailpit.newTo(email, before), { timeout: 15_000 }).not.toBeNull();
  const { html } = (await mailpit.newTo(email, before))!;
  expect(html).toContain(tr('en', 'mail.test.heading'));
});
