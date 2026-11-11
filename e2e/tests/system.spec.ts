import { expect, test } from '../fixtures';
import { api, artisanEval, mailpit, openNavigation, PEOPLE, runId, tabTo, tr, variant } from '../helpers';

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
  const instance = page.getByRole('group', { name: tr('en', 'settings.system.instance.label') });
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

test('retries the failed jobs with the keyboard', async ({ page }) => {
  // tinker goes through ddev (seconds, more under load)
  test.setTimeout(90_000);
  // a failed job that does nothing when it runs again: the reminders of an hour three days ago remind nobody. Its message
  // is unique per run and project, so a job an aborted run left behind is never a second row with the same text.
  // "Retry all" is the flow under test and sends no ids: it also queues every other failed job of the database again.
  // In the CI each project has its own database; locally the dev database is shared, so a failed job kept there for a
  // search of a bug (a mail, a template run) runs again with this test: do not run it in the middle of such a search.
  const message = `E2E failed on purpose ${variant()} ${runId()}.`;
  const uuid = artisanEval(
    [
      '$job = new App\\Jobs\\SendDueRemindersJob(now()->utc()->subDays(3)->startOfHour()->toImmutable());',
      "$payload = (fn () => $this->createPayload($job, 'notifications'))->call(Illuminate\\Support\\Facades\\Queue::connection('database'));",
      `app('queue.failer')->log('database', 'notifications', $payload, new RuntimeException('${message}'));`,
      'echo json_decode($payload)->uuid, PHP_EOL;',
    ].join('\n'),
  );
  // whether the system page of the API still lists it among the failed jobs
  const stillFailed = async () => ((await (await api(page, 'GET', '/api/v1/system')).json()) as { data: { failed_jobs: { id: string }[] } }).data.failed_jobs.some((job) => job.id === uuid);
  await page.goto('/my-items');
  expect(await stillFailed()).toBe(true);

  await page.goto('/settings/system');
  const failed = page.getByRole('region', { name: new RegExp(`^${tr('en', 'settings.system.failed.title')}`) });
  await expect(failed.getByText(message)).toBeVisible();
  const retry = failed.getByRole('button', { name: tr('en', 'settings.system.failed.retry') });
  await tabTo(page, retry, { max: 150 });
  await page.keyboard.press('Enter');
  // queued again: the toast says how many, the list empties once the status is read anew
  await expect(page.getByText(/ queued again$/)).toBeVisible();
  await expect(failed.getByText(message)).toHaveCount(0);
  expect(await stillFailed()).toBe(false);
});
