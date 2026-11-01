import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, createE2eProject, createItem, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The board of a project with the agency workflow (Agentur-Freigabe: Backlog → Todo → In Progress → Review →
// Kundenfreigabe → Done), with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Each
// test works in a project of its own (`E2E …`, removed after it) with one item over the API.

const name = (what: string) => `E2E board ${what} ${variant()} ${runId()}`;

/** A project with the agency workflow and one item "Login form" in Todo. */
async function boardProject(page: Page, what: string): Promise<{ identifier: string; key: string }> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.name === 'Agentur-Freigabe') as { states: { id: string; name: string }[] };
  const project = await createE2eProject(page, name(what), { workflow: 'Agentur-Freigabe', types: ['Task'] });
  const todo = workflow.states.find((state) => state.name === 'Todo')!.id;
  const { key } = await createItem(page, { project_id: project.id, title: 'Login form', state_id: todo });
  return { identifier: project.identifier, key };
}

const column = (page: Page, state: string) => page.getByRole('region', { name: state, exact: true });
const card = (page: Page, state: string, key: string) => column(page, state).getByRole('article', { name: new RegExp(`^${key} `) });

/** Opens the board of the project and puts the focus on the card in Todo, its tab stop. */
async function openBoard(page: Page, identifier: string, key: string) {
  await page.goto(`/projects/${identifier}?layout=board`);
  await expect(card(page, 'Todo', key)).toBeVisible();
  await tabTo(page, card(page, 'Todo', key), { max: 80 });
}

test('moves a card with shift+arrow to the next allowed column', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier, key } = await boardProject(page, 'move');
  try {
    await openBoard(page, identifier, key);
    await page.keyboard.press('Shift+ArrowRight');
    // the card stands in its new column at once and keeps the focus; a status line says it
    await expect(card(page, 'In Progress', key)).toBeFocused();
    await expect(card(page, 'Todo', key)).toHaveCount(0);
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.moved.state', { key, state: 'In Progress' }),
    );

    // the server has it
    await page.reload();
    await expect(card(page, 'In Progress', key)).toBeVisible();
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('refuses a move the workflow does not allow and names it', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier, key } = await boardProject(page, 'refuse');
  try {
    await openBoard(page, identifier, key);
    // from Todo the agency workflow leads nowhere to the left
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.getByText(tr('en', 'items.board.reason.transition', { from: 'Todo', to: 'Backlog', workflow: 'Agentur-Freigabe' }))).toBeVisible();
    await expect(page.getByText(tr('en', 'items.board.not_moved', { key }))).toBeVisible();
    await expect(card(page, 'Todo', key)).toBeFocused();

    await page.reload();
    await expect(card(page, 'Todo', key)).toBeVisible();
  } finally {
    await removeE2eProject(page, identifier);
  }
});
