import { expect, test } from '../fixtures';
import { api, createProjectFromSidebar, openNavigation, pressMod, runId, tabTo, tr, variant } from '../helpers';

// The main flow of Phase 2, with the keyboard only (master plan, acceptance): the e2e person (Erik Ende, org admin)
// invites somebody, copies the link, the invited person accepts it in a browser of their own, Erik creates a project
// and adds the new person to it, who then finds it among their projects. Light and dark, desktop and phone.

test('invites a person who joins, gets a project and finds it', async ({ page, browser }) => {
  const run = runId().toLowerCase();
  const email = `onboard-${variant()}-${run}@example.com`;
  const person = `Onboard ${variant()} ${run}`;
  const projectName = `E2E onboarding ${variant()} ${run}`;

  // 1. Erik invites the person under People and copies the link
  await page.goto('/settings/people');
  await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.people.invite') }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'settings.people.invite') });
  await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.people.invite_dialog.email') }));
  await page.keyboard.type(email);
  await pressMod(page, 'Enter');

  const sent = page.getByRole('dialog', { name: tr('en', 'settings.people.invite_dialog.sent_title') });
  await expect(sent).toBeVisible();
  await tabTo(page, sent.getByRole('button', { name: tr('en', 'settings.people.copy_link') }));
  await page.keyboard.press('Enter');
  await expect(sent.getByText(tr('en', 'ui.copy_field.copied'))).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/invitations\/[0-9a-z]+\?signature=/i);
  await tabTo(page, sent.getByRole('button', { name: tr('en', 'settings.people.invite_dialog.done') }));
  await page.keyboard.press('Enter');
  await expect(sent).toBeHidden();

  // 2. the person accepts in a browser of their own
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const invited = await context.newPage();
  try {
    await invited.goto(link);
    await tabTo(invited, invited.getByLabel(tr('en', 'invitation.name'), { exact: true }));
    await invited.keyboard.type(person);
    await invited.keyboard.press('Tab');
    await expect(invited.getByLabel(tr('en', 'invitation.password'), { exact: true })).toBeFocused();
    await invited.keyboard.type('e2e-onboarding-password');
    await invited.keyboard.press('Enter');
    await expect(invited).toHaveURL(/\/my-items$/);

    // 3. Erik creates a project, stars it and opens its members from the sidebar
    await page.goto('/my-items');
    const identifier = await createProjectFromSidebar(page, projectName);
    const card = page.getByRole('list', { name: tr('en', 'projects.list_label') }).getByRole('listitem').filter({ hasText: projectName });
    const star = card.getByRole('button', { name: tr('en', 'ui.favorite_star.add', { name: projectName }) });
    await expect(star).toBeEnabled();
    await tabTo(page, star, { max: 150 });
    await page.keyboard.press('Enter');
    await expect(card.getByRole('button', { name: tr('en', 'ui.favorite_star.remove', { name: projectName }) })).toBeFocused();

    try {
      const navigation = await openNavigation(page, 'en', { backwards: true });
      const entry = navigation.getByRole('button', { name: projectName });
      await tabTo(page, entry, { backwards: true, max: 150 });
      await page.keyboard.press('Enter');
      await expect(entry).toHaveAttribute('aria-expanded', 'true');
      await tabTo(page, navigation.getByRole('link', { name: tr('en', 'shell.nav.project_settings'), exact: true }));
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/projects/${identifier}/settings$`));

      await tabTo(page, page.getByRole('link', { name: tr('en', 'settings.project.section.members'), exact: true }));
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/projects/${identifier}/settings/members$`));

      // 4. Erik adds the new person as a member
      const field = page.getByRole('combobox', { name: tr('en', 'settings.project.members.person') });
      await tabTo(page, field);
      await page.keyboard.type(person);
      // the focus stays in the field; the arrow highlights the match the search left
      const option = page.getByRole('option', { name: person });
      await expect(option).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(option).toHaveAttribute('data-highlighted', '');
      await page.keyboard.press('Enter');
      await expect(field).toHaveValue(person);
      await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.project.members.add') }));
      await page.keyboard.press('Enter');
      await expect(
        page.getByText(tr('en', 'settings.project.members.role_set', { name: person, role: tr('en', 'roles.project.member'), identifier })),
      ).toBeVisible();
      await expect(page.getByRole('list', { name: tr('en', 'settings.project.members.list_of', { identifier }) })).toContainText(person);

      // 5. the new person finds the project among theirs, as a member
      await invited.keyboard.press('g');
      await invited.keyboard.press('p');
      await expect(invited).toHaveURL(/\/projects$/);
      const theirs = invited.getByRole('list', { name: tr('en', 'projects.list_label') }).getByRole('listitem').filter({ hasText: projectName });
      await expect(theirs).toContainText(`${tr('en', 'projects.your_role')} ${tr('en', 'roles.project.member')}`);
    } finally {
      // the sidebar of the e2e person stays as the other specs expect it
      const { data: project } = (await (await api(page, 'GET', `/api/v1/projects/${identifier}`)).json()) as { data: { id: string } };
      const { data: favorites } = (await (await api(page, 'GET', '/api/v1/favorites')).json()) as { data: { id: string }[] };
      if (favorites.some((favorite) => favorite.id === project.id)) await api(page, 'POST', '/api/v1/favorites/toggle', { kind: 'project', id: project.id });
    }
  } finally {
    await context.close();
  }
});
