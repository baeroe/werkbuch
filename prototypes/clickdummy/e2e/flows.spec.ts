/*
 * The seven flows of the clickdummy (plan, Task 13, step 1; spec 1, success criteria 2–6). Every step runs on the
 * keyboard, only the board drag uses the mouse (dnd-kit listens to pointer events). A flow may start on a route
 * opened by its address; everything after that is typed. Beside them, one check measures the table's targets on a
 * phone.
 *
 * Every test has a fresh browser context: empty localStorage, so the seed data, Mara Lindqvist signed in and the
 * demo clock at Wednesday, 2026-10-28, 10:00 Europe/Berlin. A console error or an uncaught exception fails the flow.
 */

import type { Locator, Page } from '@playwright/test';
import { expect, openPalette, test } from './fixtures';

/**
 * Presses Tab (or Shift+Tab) until the focus is on `target` or inside it: the keyboard way there, whatever lies in
 * between. Fails when the target is not reached within `limit` presses.
 */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab', limit = 120): Promise<void> {
  const reached = () => target.evaluate((element) => element === document.activeElement || element.contains(document.activeElement));
  for (let presses = 0; presses < limit && !(await reached()); presses += 1) await page.keyboard.press(key);
  expect(await reached(), `${key} reaches ${target}`).toBe(true);
}

/**
 * Opens the versions dialog of the wiki page (back from the editor to „Versionen …“), expects `count` kept versions,
 * one radio each, and closes it again. The list may show what it loaded before for a moment, so the count is awaited.
 */
async function expectVersions(page: Page, article: Locator, count: number): Promise<void> {
  await tabTo(page, article.getByRole('button', { name: 'Versionen …' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Versionen von „Seitenstruktur“' });
  await expect(dialog.getByRole('radiogroup', { name: 'Version wählen' }).getByRole('radio')).toHaveCount(count);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('Flow 1: the palette finds „kontakt“, s sets WEB-47 to Done with the resolution Done', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Meine Items' })).toBeVisible();

  const palette = await openPalette(page);
  await page.keyboard.type('kontakt');
  await expect(palette.getByRole('option', { name: /^WEB-47 Kontaktformular sendet doppelt/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/items\/WEB-47$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Kontaktformular sendet doppelt' })).toBeVisible();
  const fields = page.getByRole('complementary', { name: 'Felder' });
  await expect(fields.getByRole('combobox', { name: 'Status: In Progress' })).toBeVisible();

  await page.keyboard.press('s');
  await expect(page.getByRole('combobox', { name: 'Status ändern …' })).toBeFocused();
  await page.keyboard.type('done');
  await expect(page.getByRole('option', { name: 'Done', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  const prompt = page.getByRole('dialog', { name: 'WEB-47 auf Done setzen' });
  await expect(prompt.getByRole('radio', { name: 'Done', exact: true })).toBeChecked();
  await page.keyboard.press('Enter');

  await expect(prompt).toBeHidden();
  await expect(fields.getByRole('combobox', { name: 'Status: Done' })).toBeVisible();
  await expect(fields.locator('dt', { hasText: /^Resolution$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('Done');
});

test.describe('on a wide screen, where every column of the board is in view', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('Flow 2: an APP card dragged from Todo to Done springs back, a toast says why', async ({ page }) => {
    await page.goto('/projects/APP?layout=board');
    const todo = page.getByRole('list', { name: 'Todo', exact: true });
    const done = page.getByRole('region', { name: 'Done', exact: true });
    const card = todo.getByRole('article', { name: /^APP-11 / });
    await expect(card).toBeVisible();
    await expect(done).toBeInViewport();

    const from = (await card.boundingBox())!;
    const to = (await done.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + 20);
    await page.mouse.down();
    // past the 5 px that start a drag, then over the Done column
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + 26, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 160, { steps: 20 });
    await page.mouse.up();

    const toast = page.getByRole('status').filter({ hasText: 'APP-11 nicht verschoben' });
    await expect(toast).toContainText('Von „Todo“ nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.');
    await expect(todo.getByRole('article', { name: /^APP-11 / })).toBeVisible();
    await expect(done.getByRole('article', { name: /^APP-11 / })).toHaveCount(0);
  });
});

test('Flow 3: c in APP, a Kundenwunsch without customer is refused at the field, with one it becomes APP-25 in Backlog', async ({ page }) => {
  await page.goto('/projects/APP');
  await expect(page.getByRole('heading', { level: 1, name: 'Kunden-App' })).toBeVisible();
  // until the rights are loaded, c says „Die Rechte werden noch geladen.“; the button shows when it may
  await expect(page.getByRole('button', { name: 'Neues Item' })).toBeEnabled();

  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: 'Neues Item' });
  const title = dialog.getByRole('textbox', { name: /^Titel/ });
  await expect(title).toBeFocused();
  await page.keyboard.type('Lieferadresse im Profil speichern');

  // the type stands before the title (with the template between them, once the templates are loaded)
  await tabTo(page, dialog.getByRole('combobox', { name: /^Typ / }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'Kundenwunsch' })).toBeVisible();
  await page.keyboard.type('Kundenwunsch');
  await page.keyboard.press('Enter');
  const properties = dialog.getByRole('region', { name: 'Properties von Kundenwunsch' });
  await expect(properties).toBeVisible();

  // without a customer: the error stands at the field, and the focus goes there
  await page.keyboard.press('ControlOrMeta+Enter');
  const customer = properties.getByRole('combobox', { name: /^Kunde/ });
  await expect(properties.getByText('„Kunde“ ist ein Pflichtfeld.')).toBeVisible();
  await expect(customer).toHaveAttribute('aria-invalid', 'true');
  await expect(customer).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'Hafenkontor' })).toBeVisible();
  await page.keyboard.type('Hafenkontor');
  await page.keyboard.press('Enter');
  await expect(customer).toContainText('Hafenkontor');

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'APP-25 angelegt' })).toBeVisible();

  // the new item stands in Backlog, the start status of „Agentur-Freigabe“
  const palette = await openPalette(page);
  await page.keyboard.type('APP-25');
  await expect(palette.getByRole('option', { name: /^APP-25 Lieferadresse im Profil speichern/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/items\/APP-25$/);
  const fields = page.getByRole('complementary', { name: 'Felder' });
  await expect(fields.getByRole('combobox', { name: 'Typ: Kundenwunsch' })).toBeVisible();
  await expect(fields.getByRole('combobox', { name: 'Status: Backlog' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Properties' }).getByRole('combobox', { name: 'Kunde: Hafenkontor' })).toBeVisible();
});

test('Flow 4: a comment with @ma, Enter and mod+enter mentions Mara', async ({ page }) => {
  await page.goto('/items/WEB-47');
  await expect(page.getByRole('heading', { level: 1, name: 'Kontaktformular sendet doppelt' })).toBeVisible();

  await page.keyboard.press('m');
  const composer = page.getByRole('textbox', { name: 'Kommentar' });
  await expect(composer).toBeFocused();
  await page.keyboard.type('Bitte noch einmal prüfen, @ma');
  await expect(page.getByRole('listbox', { name: 'Personen und Bots' }).getByRole('option', { name: 'Mara Lindqvist @mara' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(page.getByRole('status').filter({ hasText: 'Kommentar gesendet' })).toBeVisible();
  const comment = page.getByRole('region', { name: 'Aktivität' }).getByRole('article', { name: 'Kommentar von Mara Lindqvist' }).last();
  await expect(comment).toContainText('Bitte noch einmal prüfen, @mara');
  await expect(comment.locator('[data-type="mention"]')).toHaveText('@mara');
});

test('Flow 5: editing „Seitenstruktur“ meets a conflict, „Meine Fassung übernehmen“ keeps one version more', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Meine Items' })).toBeVisible();
  const palette = await openPalette(page);
  await page.keyboard.type('Seitenstruktur');
  // the item WEB-31 comes first, the page right after it
  const pageEntry = palette.getByRole('option', { name: 'Seitenstruktur Wiki WEB' });
  await expect(pageEntry).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(pageEntry).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  const article = page.getByRole('article', { name: 'Seitenstruktur' });
  const editor = article.getByRole('textbox', { name: 'Inhalt der Seite' });
  await expect(editor).toBeVisible();
  // from the top of the page into the editor, then back to "Versionen …": the seed keeps three versions
  await tabTo(page, editor);
  await expectVersions(page, article, 3);

  await tabTo(page, editor);
  await page.keyboard.type('Entwurf: ');
  await page.keyboard.press('ControlOrMeta+Enter');

  const banner = article.getByRole('alert').filter({ hasText: 'hat die Seite inzwischen geändert' });
  await expect(banner).toBeVisible();
  await tabTo(page, banner.getByRole('button', { name: 'Meine Fassung übernehmen' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(banner).toBeHidden();
  await expect(article.getByRole('status').filter({ hasText: /^Gespeichert/ })).toBeVisible();
  await expect(editor).toContainText('Entwurf: Navigation');

  // the colleague's text stays as a version of its own
  await tabTo(page, editor);
  await expectVersions(page, article, 4);
});

test('Flow 6: the preview of „Monatsbericht“ shows the next five first Mondays', async ({ page }) => {
  await page.goto('/projects/APP/templates');
  await tabTo(page, page.getByRole('link', { name: 'Monatsbericht' }));
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Monatsbericht' })).toBeVisible();
  const dates = page.getByRole('list', { name: 'Nächste Termine' }).locator('time');
  await expect(dates).toHaveText([
    'Montag, 2. November 2026 um 09:00',
    'Montag, 7. Dezember 2026 um 09:00',
    'Montag, 4. Januar 2027 um 09:00',
    'Montag, 1. Februar 2027 um 09:00',
    'Montag, 1. März 2027 um 09:00',
  ]);
  // the same days as the plan writes them, in Berlin time
  const days = await dates.evaluateAll((elements) =>
    elements.map((element) =>
      new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(element.getAttribute('datetime')!)),
    ),
  );
  expect(days).toEqual(['02.11.2026', '07.12.2026', '04.01.2027', '01.02.2027', '01.03.2027']);
});

test('Flow 7: without its last transition into Review, „Agentur-Freigabe“ is refused: Review is not reachable', async ({ page }) => {
  await page.goto('/settings/workflows');
  await tabTo(page, page.getByRole('link', { name: 'Bearbeiten Agentur-Freigabe' }));
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 2, name: 'Agentur-Freigabe' })).toBeVisible();
  const matrix = page.getByRole('grid', { name: 'Erlaubte Übergänge' });
  // one stop for the whole matrix; the arrows move inside: two rows down, three columns to the right
  await tabTo(page, matrix);
  await expect(matrix.getByRole('checkbox', { name: 'Von Backlog nach Backlog' })).toBeFocused();
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key);
  const intoReview = matrix.getByRole('checkbox', { name: 'Von In Progress nach Review' });
  await expect(intoReview).toBeFocused();
  await expect(intoReview).toBeChecked();
  await page.keyboard.press('Space');
  await expect(intoReview).not.toBeChecked();

  // the check runs while editing; saving is refused, and the message stays
  await expect(page.getByText('Review ist vom Startstatus aus nicht erreichbar')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByText('3 Probleme verhindern das Speichern')).toBeVisible();
  await expect(page.getByText('Review ist vom Startstatus aus nicht erreichbar')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toHaveCount(0);
});

test.describe('on a phone (390 px), beside the flows', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the table keeps targets of at least 44 px: rows, group rows and their toggles', async ({ page }) => {
    await page.goto('/projects/WEB?layout=table');
    const table = page.getByRole('grid', { name: 'Items' });
    const rows = table.locator('tbody tr[role="row"]');
    await expect(rows.first()).toBeVisible();

    const heights = await rows.evaluateAll((elements) => elements.map((row) => row.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(5);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    // the toggle of each group row (a group row is one cell over all columns)
    const toggles = await table.locator('tbody tr[role="row"]:has(td[colspan]) button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(toggles.length).toBeGreaterThan(0);
    expect(Math.min(...toggles)).toBeGreaterThanOrEqual(44);
  });
});
