import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createE2ePage, createE2eProject, isPhone, openNavigation, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The wiki of a project with the keyboard only, signed in as the e2e person (org admin, English). Every test makes its
// own project `E2E <variant> <run> …` with its own pages (`createE2ePage`) and removes it in `finally`; the demo wiki
// is never changed.

const projectName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;
const pageIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1)!;

test('opens the wiki from the sidebar and walks the tree with the keyboard', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki tree'));
  try {
    const handbook = await createE2ePage(page, project.id, { title: 'Handbook' });
    await createE2ePage(page, project.id, { title: 'Processes', parent_id: handbook.id });
    const tech = await createE2ePage(page, project.id, { title: 'Technology' });
    // starred, the project stands in the sidebar; on its own list it starts open with its areas
    const star = await api(page, 'POST', '/api/v1/favorites/toggle', { kind: 'project', id: project.id });
    expect(star.status()).toBe(200);
    await page.goto(`/projects/${project.identifier}`);

    const navigation = await openNavigation(page, 'en');
    await tabTo(page, navigation.getByRole('link', { name: tr('en', 'shell.nav.project_wiki'), exact: true }), { max: 120 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki$`));
    await expect(page.getByRole('heading', { level: 1, name: tr('en', 'wiki.title') })).toBeVisible();

    const tree = page.getByRole('tree', { name: tr('en', 'wiki.tree.label') });
    const row = (name: string) => tree.getByRole('treeitem', { name, exact: true });
    // one tab stop: the first page while none is open
    await tabTo(page, row('Handbook'), { max: 60 });
    await expect(row('Processes')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowDown');
    await expect(row('Processes')).toBeFocused();
    await expect(row('Processes')).toHaveAttribute('aria-level', '2');
    await page.keyboard.press('ArrowLeft');
    await expect(row('Handbook')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(row('Handbook')).toHaveAttribute('aria-expanded', 'false');
    await expect(row('Processes')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(row('Processes')).toBeVisible();
    await page.keyboard.press('End');
    await expect(row('Technology')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/${tech.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Technology');
    // from lg on the tree stays beside the page and marks it; below that the page shows alone
    if (isPhone(page)) await expect(tree).toBeHidden();
    else await expect(row('Technology')).toHaveAttribute('aria-current', 'page');
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('creates a page with the keyboard: New page, then the title typed over', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki create'));
  try {
    await page.goto(`/projects/${project.identifier}/wiki`);
    await expect(page.getByText(tr('en', 'wiki.empty.title'))).toBeVisible();
    const create = page.getByRole('main').getByRole('button', { name: tr('en', 'wiki.new'), exact: true });
    // the rights are there: the button is no longer off
    await expect(create).not.toHaveAttribute('aria-disabled', 'true');
    await tabTo(page, create, { max: 120 });
    await page.keyboard.press('Enter');

    // the new page opens; the wish to select its title leaves the address at once
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/[0-9a-z]{26}$`));
    await expect(page.getByText(tr('en', 'wiki.created.title')).first()).toBeVisible();
    const title = page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') });
    await expect(title).toBeFocused();
    await page.keyboard.type('Imprint');
    await expect(title).toHaveValue('Imprint');

    const stored = await api(page, 'GET', `/api/v1/pages/${pageIdOf(page)}`);
    expect(stored.status()).toBe(200);
    const { data } = (await stored.json()) as { data: { title: string; project_id: string; parent_id: string | null } };
    expect(data).toMatchObject({ title: tr('en', 'wiki.new_title'), project_id: project.id, parent_id: null });
    if (!isPhone(page)) await expect(page.getByRole('tree', { name: tr('en', 'wiki.tree.label') }).getByRole('treeitem', { name: tr('en', 'wiki.new_title') })).toHaveAttribute('aria-current', 'page');
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
