import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createE2ePage, createE2eProject, removeE2eProject, runId, tr, variant } from '../helpers';

// Dragging pages in the wiki tree with the mouse (dnd-kit only starts after real movement: `page.mouse` in steps,
// `dragTo` does not start it). Signed in as the e2e person (org admin, English); the project and its pages are the
// spec's own and go in `finally`. The keyboard way ("Move to …") is in wiki.spec.ts.

const projectName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;

/** Drags a row of the tree by its handle: pressed, past the 5 px that start a drag, then to the row `to`, `sideways` px to the right, in steps. */
async function dragRow(page: Page, from: Locator, to: Locator, sideways: number) {
  const handle = from.locator('xpath=ancestor::li[1]').locator('[data-drag-handle]');
  await from.hover();
  const start = (await handle.boundingBox())!;
  const end = (await to.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y - 6, { steps: 4 });
  await page.mouse.move(x + sideways, end.y + end.height / 2, { steps: 20 });
  await page.mouse.up();
}

test.describe('with the mouse on a wide screen', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('drags a page into another page and the move survives a reload', async ({ page }) => {
    const project = await createE2eProject(page, projectName('wiki drag'));
    try {
      const handbook = await createE2ePage(page, project.id, { title: 'Handbook' });
      await createE2ePage(page, project.id, { title: 'Archive' });
      const processes = await createE2ePage(page, project.id, { title: 'Processes' });
      await page.goto(`/projects/${project.identifier}/wiki`);

      const tree = page.getByRole('tree', { name: tr('en', 'wiki.tree.label') });
      const row = (name: string) => tree.getByRole('treeitem', { name, exact: true });
      await expect(row('Processes')).toHaveAttribute('aria-level', '1');
      // the handle is there once the rights are known
      await expect(tree.locator('[data-drag-handle]')).toHaveCount(3);

      // one row up and pulled to the right: below Handbook, in front of Archive
      await dragRow(page, row('Processes'), row('Archive'), 24);
      await expect(page.getByRole('status').filter({ hasText: tr('en', 'wiki.move.done.title', { title: 'Processes' }) })).toBeVisible();
      await expect(row('Processes')).toHaveAttribute('aria-level', '2');
      await expect(row('Handbook')).toHaveAttribute('aria-expanded', 'true');
      await expect(tree.getByRole('treeitem')).toHaveText(['Handbook', 'Processes', 'Archive'].map((title) => new RegExp(`${title}$`)));

      await page.reload();
      await expect(row('Processes')).toHaveAttribute('aria-level', '2');
      await expect(tree.getByRole('treeitem')).toHaveText(['Handbook', 'Processes', 'Archive'].map((title) => new RegExp(`${title}$`)));
      const stored = await api(page, 'GET', `/api/v1/pages/${processes.id}`);
      expect(((await stored.json()) as { data: { parent_id: string | null } }).data.parent_id).toBe(handbook.id);
    } finally {
      await removeE2eProject(page, project.identifier);
    }
  });
});
