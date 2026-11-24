import { expect, test } from '../fixtures';
import { createE2eProject, createE2eRunner, createE2eRunnerRow, createItem, pressMod, redeemRunnerCode, removeE2eProject, removeE2eRunner, runId, tabTo, tr, variant } from '../helpers';

// Settings → Runners (WEBU-27, spec 6.2, 8.4, 10.1) as the e2e person (Erik Ende, org admin), in English. No machine
// runs here: the spec redeems the code the dialog shows over the runner protocol, as `werkbuch-runner login` does.
// Every runner it connects is named `E2E …`; it revokes them in `finally`, the E2eSeeder revokes what an aborted run left.

const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);

test('connects a runner with the keyboard: the dialog shows the command and says when the runner is there', async ({ page }) => {
  let runner: { id: string; name: string } | null = null;
  try {
    await page.goto('/settings/runners');
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.runners') })).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: label('settings.runners.connect') }).first(), { max: 80 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: label('settings.runners.connect') });
    const command = dialog.getByRole('group', { name: label('settings.runners.pairing.command') }).locator('code');
    await expect(command).toHaveText(/\/runner\/install\.sh \| sh -s -- --code \S+$/);
    await expect(dialog.getByText(label('settings.runners.pairing.waiting'))).toBeVisible();
    const code = (await command.textContent())!.split('--code ')[1].trim();

    // the machine redeems the code; the dialog asks every two seconds and then names the runner
    runner = await redeemRunnerCode(page, code, 'connect');
    const connected = page.getByRole('dialog', { name: label('settings.runners.pairing.connected_title', { name: runner.name }) });
    await expect(connected).toBeVisible({ timeout: 15_000 });
    const done = connected.getByRole('button', { name: label('settings.runners.pairing.done') });
    await expect(done).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(connected).toHaveCount(0);
    await expect(page.getByRole('article', { name: runner.name, exact: true })).toBeVisible();
  } finally {
    if (runner) await removeE2eRunner(page, runner.id);
  }
});

test('sets the places, renames and revokes a runner with the keyboard', async ({ page }) => {
  const runner = await createE2eRunner(page, 'places');
  const renamed = `${runner.name} renamed`;
  try {
    await page.goto('/settings/runners');
    const card = page.getByRole('article', { name: runner.name, exact: true });
    await expect(card).toBeVisible();

    // the places: three numbers, ⌘↵ saves
    await tabTo(page, card.getByRole('button', { name: label('settings.runners.action.places_named', { name: runner.name }) }), { max: 80 });
    await page.keyboard.press('Enter');
    const places = page.getByRole('dialog', { name: label('settings.runners.slots.title', { name: runner.name }) });
    const total = places.getByRole('textbox', { name: label('settings.runners.pot.total') });
    await tabTo(page, total);
    await total.fill('3');
    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.runners.slots.done', { name: runner.name }))).toBeVisible();
    await expect(places).toHaveCount(0);
    await expect(card).toContainText(`${label('settings.runners.pot.total')} ${label('settings.runners.pot.count', { used: 0, total: 3 })}`);

    // the name: Enter in the field renames
    await tabTo(page, card.getByRole('button', { name: label('settings.runners.action.rename_named', { name: runner.name }) }));
    await page.keyboard.press('Enter');
    const rename = page.getByRole('dialog', { name: label('settings.runners.rename.title', { name: runner.name }) });
    const field = rename.getByRole('textbox', { name: label('settings.runners.rename.name') });
    await tabTo(page, field);
    await field.fill(renamed);
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('settings.runners.rename.done', { name: renamed }))).toBeVisible();
    const card2 = page.getByRole('article', { name: renamed, exact: true });
    await expect(card2).toBeVisible();

    // revoking asks first; the focus starts on "Cancel"
    await tabTo(page, card2.getByRole('button', { name: label('settings.runners.action.revoke_named', { name: renamed }) }));
    await page.keyboard.press('Enter');
    const question = page.getByRole('alertdialog', { name: label('settings.runners.revoke.title', { name: renamed }) });
    await tabTo(page, question.getByRole('button', { name: label('settings.runners.action.revoke') }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('settings.runners.revoke.done', { name: renamed }))).toBeVisible();
    await expect(card2).toHaveCount(0);
  } finally {
    await removeE2eRunner(page, runner.id);
  }
});

test('cancels a run on a runner with the keyboard; the focus goes to its card', async ({ page }) => {
  // a runner with a run of Kira on an item of a project of the spec, written before the first key
  const project = await createE2eProject(page, `E2E ${variant()} ${runId()} runs`);
  const item = await createItem(page, { project_id: project.id, title: 'E2E Kontaktformular prüfen' });
  const runner = createE2eRunnerRow('runs', { runs: [{ itemId: item.id, status: 'running' }] });
  const task = label('settings.runners.run.type.task');
  try {
    await page.goto('/settings/runners');
    const card = page.getByRole('article', { name: runner.name, exact: true });
    await expect(card.getByRole('link', { name: new RegExp(`^${item.key} `) })).toBeVisible();

    await tabTo(page, card.getByRole('button', { name: label('settings.runners.runs.cancel_named', { run: task, subject: item.key }) }), { max: 80 });
    await page.keyboard.press('Enter');
    const question = page.getByRole('alertdialog', { name: label('settings.runners.cancel.title', { run: task, key: item.key }) });
    await tabTo(page, question.getByRole('button', { name: label('settings.runners.cancel.confirm') }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('settings.runners.cancel.done', { key: item.key }))).toBeVisible();
    await expect(question).toHaveCount(0);
    await expect(card).toBeFocused();
    // the run on a runner is being canceled: the runner stops its CLI at its next contact
    await expect(card.getByText(`${task}, ${label('settings.runners.run.status.canceling')}`, { exact: false })).toBeVisible();
  } finally {
    await removeE2eRunner(page, runner.id);
    await removeE2eProject(page, project.identifier);
  }
});
