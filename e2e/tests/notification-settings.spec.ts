import { expect, test } from '../fixtures';
import { api, PEOPLE, pressMod, signedInContext, tabTo, tr, variant } from '../helpers';

// Settings → Notifications (spec 4.14) of the inbox account of the variant (A289), in a context of its own: the seeder
// gives it the default preferences on every run, and the spec puts the one it changes back in `finally`, so the inbox
// and live specs keep theirs.

test('switches mail off for comments with the keyboard and keeps it after a reload', async ({ browser }) => {
  const inbox = PEOPLE.inbox[variant()]!;
  const other = await signedInContext(browser, inbox);
  const { page } = other;
  try {
    await page.goto('/me/notifications');
    const table = page.getByRole('table', { name: tr('en', 'settings.notifications.caption') });
    await expect(table).toBeVisible();
    const cell = (event: string, channel: 'inbox' | 'mail') =>
      table.getByRole('checkbox', {
        name: tr('en', 'settings.notifications.cell', {
          event: tr('en', `settings.notifications.event.${event}.label`),
          channel: tr('en', `settings.notifications.channel.${channel}`),
        }),
        exact: true,
      });
    // the defaults: mail for comments on, for state changes off
    const commentMail = cell('comment', 'mail');
    await expect(commentMail).toBeChecked();
    await expect(cell('state_changed', 'mail')).not.toBeChecked();

    // Tab to the cell, Space switches it, ⌘↵ saves
    await tabTo(page, commentMail);
    await page.keyboard.press('Space');
    await expect(commentMail).not.toBeChecked();
    await expect(page.getByText(tr('en', 'settings.frame.unsaved'))).toBeVisible();
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'settings.notifications.saved'))).toBeVisible();
    await expect(page.getByText(tr('en', 'settings.frame.unsaved'))).toBeHidden();

    // the server holds it: after a reload the cell is off, the rest as before
    await page.reload();
    await expect(commentMail).not.toBeChecked();
    await expect(cell('comment', 'inbox')).toBeChecked();
    await expect(cell('assigned', 'mail')).toBeChecked();
  } finally {
    const reset = await api(page, 'PUT', '/api/v1/notification-preferences', { preferences: [{ event: 'comment', channel: 'mail', enabled: true }] });
    expect(reset.status(), await reset.text()).toBe(200);
    await other.context.close();
  }
});
