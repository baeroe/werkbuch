import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createItem, isPhone, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The board of a project with the agency workflow (Agentur-Freigabe: Backlog → Todo → In Progress → Review →
// Kundenfreigabe → Done), signed in as the e2e person (playwright.config.ts), in English. Each test works in a project
// of its own (`E2E …`, removed after it) with one or two items over the API. Moves and the quick add go with the
// keyboard only; the drags with the mouse, on a screen wide enough for every column up to Done.

const name = (what: string) => `E2E board ${what} ${variant()} ${runId()}`;

/** A project with the agency workflow and items in Todo: "Login form", then the `more` titles. */
async function boardProject(page: Page, what: string, more: string[] = []): Promise<{ identifier: string; key: string; keys: string[] }> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.name === 'Agentur-Freigabe') as { states: { id: string; name: string }[] };
  const project = await createE2eProject(page, name(what), { workflow: 'Agentur-Freigabe', types: ['Task'] });
  const todo = workflow.states.find((state) => state.name === 'Todo')!.id;
  const keys: string[] = [];
  for (const title of ['Login form', ...more]) keys.push((await createItem(page, { project_id: project.id, title, state_id: todo })).key);
  return { identifier: project.identifier, key: keys[0]!, keys };
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

test('moves the cursor to the column before and after with ← and →', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier, keys } = await boardProject(page, 'columns', ['Password reset']);
  const [login, password] = keys as [string, string];
  try {
    const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.name === 'Agentur-Freigabe') as { states: { id: string; name: string }[] };
    const response = await api(page, 'POST', `/api/v1/work-items/${password}/transition`, { to_state_id: workflow.states.find((state) => state.name === 'In Progress')!.id });
    expect(response.status(), await response.text()).toBe(200);
    await openBoard(page, identifier, login);
    // → goes past the empty columns to the next card, ← back; nothing moves
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'In Progress', password)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page, 'Todo', login)).toBeFocused();
    await page.reload();
    await expect(card(page, 'Todo', login)).toBeVisible();
    await expect(card(page, 'In Progress', password)).toBeVisible();
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

test('changes the place of a card in its column with alt+arrow and keeps the focus on it', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier, keys } = await boardProject(page, 'reorder', ['Password reset']);
  const [first, second] = keys as [string, string];
  const order = () => column(page, 'Todo').getByRole('article');
  try {
    await openBoard(page, identifier, first);
    await expect(order()).toHaveCount(2);

    // down: the card itself moves in the page and keeps the focus
    await page.keyboard.press('Alt+ArrowDown');
    await expect(order().first()).toHaveAccessibleName(new RegExp(`^${second} `));
    await expect(card(page, 'Todo', first)).toBeFocused();
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.moved.place', { key: first, place: 2, count: 2, column: 'Todo' }),
    );

    await page.keyboard.press('Alt+ArrowUp');
    await expect(order().first()).toHaveAccessibleName(new RegExp(`^${first} `));
    await expect(card(page, 'Todo', first)).toBeFocused();
    // landed before the next move goes out
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.moved.place', { key: first, place: 1, count: 2, column: 'Todo' }),
    );

    // the server has the order
    await page.keyboard.press('Alt+ArrowDown');
    await expect(card(page, 'Todo', first)).toBeFocused();
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.moved.place', { key: first, place: 2, count: 2, column: 'Todo' }),
    );
    await page.reload();
    await expect(order().first()).toHaveAccessibleName(new RegExp(`^${second} `));
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('moves a card where the ranks ran out', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier, keys } = await boardProject(page, 'ranks', ['Password reset', 'Profile page']);
  const [login, password, profile] = keys as [string, string, string];
  // Login form and Password reset leave no room between them: a rank between the two would be longer than 128 characters
  for (const [key, rank] of [
    [login, 'a0'],
    [password, `a0${'0'.repeat(125)}1`],
    [profile, 'a1'],
  ] as const) {
    const response = await api(page, 'PATCH', `/api/v1/work-items/${key}`, { rank });
    expect(response.status(), await response.text()).toBe(200);
  }
  const order = () => column(page, 'Todo').getByRole('article');
  try {
    await openBoard(page, identifier, login);
    await expect(order()).toHaveCount(3);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(card(page, 'Todo', profile)).toBeFocused();

    // the server makes room first, then the card takes its place between Login form and Password reset
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.moved.place', { key: profile, place: 2, count: 3, column: 'Todo' }),
    );
    await expect(order().nth(1)).toHaveAccessibleName(new RegExp(`^${profile} `));
    await expect(card(page, 'Todo', profile)).toBeFocused();
    await expect(page.getByText(tr('en', 'items.board.not_moved', { key: profile }))).toHaveCount(0);

    await page.reload();
    await expect(order().nth(0)).toHaveAccessibleName(new RegExp(`^${login} `));
    await expect(order().nth(1)).toHaveAccessibleName(new RegExp(`^${profile} `));
    await expect(order().nth(2)).toHaveAccessibleName(new RegExp(`^${password} `));
  } finally {
    await removeE2eProject(page, identifier);
  }
});

/** Drags a card with the mouse: pressed, past the 5 px that start a drag, then over the target in steps, let go. */
async function dragCard(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 6, { steps: 4 });
  await page.mouse.move(end.x + end.width / 2, end.y + 160, { steps: 20 });
  await page.mouse.up();
}

test.describe('with the mouse on a wide screen', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('drags a card from Todo to Done and gets it back with the reason', async ({ page }) => {
    await page.goto('/my-items');
    const { identifier, key } = await boardProject(page, 'drag refuse');
    try {
      await page.goto(`/projects/${identifier}?layout=board`);
      await expect(card(page, 'Todo', key)).toBeVisible();
      await expect(column(page, 'Done')).toBeInViewport();

      // the agency workflow leads from Todo to In Progress only (Flow 2)
      await dragCard(page, card(page, 'Todo', key), column(page, 'Done'));
      const toast = page.getByRole('status').filter({ hasText: tr('en', 'items.board.not_moved', { key }) });
      await expect(toast).toContainText(tr('en', 'items.board.reason.transition', { from: 'Todo', to: 'Done', workflow: 'Agentur-Freigabe' }));
      await expect(card(page, 'Todo', key)).toBeVisible();
      await expect(card(page, 'Done', key)).toHaveCount(0);
      await expect(card(page, 'Todo', key)).toBeFocused();

      await page.reload();
      await expect(card(page, 'Todo', key)).toBeVisible();
    } finally {
      await removeE2eProject(page, identifier);
    }
  });

  test('drags a card to In Progress and keeps it there after reload', async ({ page }) => {
    await page.goto('/my-items');
    const { identifier, key } = await boardProject(page, 'drag move');
    try {
      await page.goto(`/projects/${identifier}?layout=board`);
      await expect(card(page, 'Todo', key)).toBeVisible();

      await dragCard(page, card(page, 'Todo', key), column(page, 'In Progress'));
      await expect(card(page, 'In Progress', key)).toBeVisible();
      await expect(card(page, 'Todo', key)).toHaveCount(0);
      // the card in its new column has the focus, the keys go on from there
      await expect(card(page, 'In Progress', key)).toBeFocused();
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
});

test('creates an item with the quick add of a column', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier, key } = await boardProject(page, 'quick add');
  const title = `Quick ${runId()}`;
  try {
    await page.goto(`/projects/${identifier}?layout=board`);
    await expect(card(page, 'Todo', key)).toBeVisible();
    const add = column(page, 'Todo').getByRole('button', { name: tr('en', 'items.board.quick_add.open', { column: 'Todo' }) });
    await tabTo(page, add, { max: 80 });
    await page.keyboard.press('Enter');

    const field = page.getByRole('textbox', { name: tr('en', 'items.board.quick_add.label', { column: 'Todo' }) });
    await expect(field).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    const made = column(page, 'Todo').getByRole('article', { name: new RegExp(`^${identifier}-2 ${title}`) });
    await expect(made).toBeVisible();
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.created', { key: `${identifier}-2`, column: 'Todo' }),
    );
    // ready for the next one; Escape closes it and gives the focus back to the "+"
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(add).toBeFocused();

    // the server has it, in Todo
    await page.reload();
    await expect(made).toBeVisible();
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test.describe('the wheel over a column', () => {
  /** A project with the standard workflow (six columns, wider than the screen) and 14 items in Backlog. */
  async function wideBoard(page: Page, what: string) {
    const project = await createE2eProject(page, name(what));
    for (let i = 1; i <= 14; i++) await createItem(page, { project_id: project.id, title: `Wheel item ${i}` });
    await page.goto(`/projects/${project.identifier}?layout=board`);
    const board = page.getByRole('group', { name: tr('en', 'items.board.label') });
    await expect(column(page, 'Backlog').getByRole('article').first()).toBeVisible();
    expect(await board.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const list = column(page, 'Backlog').locator('[data-board-list]');
    const box = (await list.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    return { identifier: project.identifier, board, list };
  }

  test('scrolls the board sideways with the wheel over a column', async ({ page }) => {
    test.skip(isPhone(page), 'a phone is swiped, there is no wheel');
    await page.goto('/my-items');
    const { identifier, board } = await wideBoard(page, 'wheel x');
    try {
      await page.mouse.wheel(300, 0);
      await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    } finally {
      await removeE2eProject(page, identifier);
    }
  });

  test('keeps the vertical wheel in the column', async ({ page }) => {
    test.skip(isPhone(page), 'a phone is swiped, there is no wheel');
    await page.goto('/my-items');
    const { identifier, board, list } = await wideBoard(page, 'wheel y');
    try {
      const before = await board.evaluate((el) => el.scrollLeft);
      await page.mouse.wheel(0, 300);
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await board.evaluate((el) => el.scrollLeft)).toBe(before);
    } finally {
      await removeE2eProject(page, identifier);
    }
  });
});
