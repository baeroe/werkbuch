import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, channelHeld, createE2eProject, createItem, isPhone, openProfileMenu, PEOPLE, removeE2eProject, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// signed in as the e2e person (playwright.config.ts), in English. Never sign out for real here: that ends the shared
// session of every later test.

/** The browser's note on the 404 of a place that arrives with a later phase (the 404 page shows instead). */
const notFound = (path: string) => new RegExp(`status of 404 .*\\(https?://[^/]+${path}\\)$`);

test.beforeEach(async ({ page }) => {
  await page.goto('/my-items');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('starts with "Skip to content" and lists the shortcuts with ?', async ({ page }) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: tr('en', 'shell.skip_to_content') });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: tr('en', 'shortcuts.help.title') });
  await expect(help).toBeVisible();
  await expect(help.getByText(tr('en', 'shortcuts.shell.go.inbox'), { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
});

test('goes to projects with g p', async ({ page }) => {
  await page.keyboard.press('g');
  await page.keyboard.press('p');

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'projects.title'));
});

test('shows the 404 page inside the shell', async ({ page, allowedErrors }) => {
  allowedErrors.push(notFound('/no-such-page'));
  await page.goto('/no-such-page');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'errors.page.not_found.title'));
  if (isPhone(page)) {
    await expect(page.getByRole('button', { name: tr('en', 'shell.mobile.open_navigation') })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: tr('en', 'shell.sidebar.label') })).toBeVisible();
  }

  await tabTo(page, page.getByRole('link', { name: tr('en', 'errors.page.not_found.open_my_items') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/my-items$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('reaches the other main places with their g sequences', async ({ page }) => {
  for (const [key, path, title] of [
    ['i', '/inbox', 'inbox.title'],
    ['v', '/views', 'views.title'],
    ['m', '/my-items', 'items.my.title'],
  ] as const) {
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', title));
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('opens the palette with / and from the search button, also on the phone', async ({ page }) => {
  // outside an item list: there / filters by title (list.search)
  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'projects.title'));
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  const input = palette.getByRole('combobox', { name: tr('en', 'palette.input') });

  await page.keyboard.press('/');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  // on the phone the bar's icon is the one way in; from md on the field at the head of the sidebar
  const button = isPhone(page)
    ? page.getByRole('banner').getByRole('button', { name: tr('en', 'shell.search_icon'), exact: true })
    : page.getByRole('navigation', { name: tr('en', 'shell.sidebar.label') }).getByRole('button', { name: tr('en', 'shell.search'), exact: true });
  await tabTo(page, button);
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('opens the navigation drawer on the phone', async ({ page }) => {
  test.skip(!isPhone(page), 'the drawer is the navigation below md');

  const open = page.getByRole('button', { name: tr('en', 'shell.mobile.open_navigation') });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: tr('en', 'shell.mobile.navigation') });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: tr('en', 'shell.nav.my_items') })).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  // a chosen link closes the drawer
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await tabTo(page, drawer.getByRole('link', { name: tr('en', 'shell.nav.all_projects') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(drawer).toBeHidden();
});

test('closes the drawer when its search opens the palette on the phone', async ({ page }) => {
  test.skip(!isPhone(page), 'the drawer is the navigation below md');

  const open = page.getByRole('button', { name: tr('en', 'shell.mobile.open_navigation') });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: tr('en', 'shell.mobile.navigation') });
  await expect(drawer).toBeVisible();
  await tabTo(page, drawer.getByRole('button', { name: tr('en', 'shell.search'), exact: true }));
  await page.keyboard.press('Enter');

  // one modal dialog at a time: the palette holds the focus, the drawer is gone
  const input = page.getByRole('dialog', { name: tr('en', 'palette.title') }).getByRole('combobox', { name: tr('en', 'palette.input') });
  await expect(input).toBeFocused();
  await expect(drawer).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  await expect(open).toBeFocused();
});

test('collapses the sidebar to the rail and back', async ({ page }) => {
  test.skip(isPhone(page), 'the sidebar shows from md on');

  await tabTo(page, page.getByRole('button', { name: tr('en', 'shell.sidebar.collapse') }));
  await page.keyboard.press('Enter');
  const expand = page.getByRole('button', { name: tr('en', 'shell.sidebar.expand') });
  await expect(expand).toBeVisible();

  // the rail: icons with their names, the profile behind the avatar
  const rail = page.getByRole('navigation', { name: tr('en', 'shell.sidebar.label') });
  await expect(rail.getByRole('link', { name: tr('en', 'shell.nav.my_items') })).toHaveAttribute('aria-current', 'page');
  await tabTo(page, rail.getByRole('button', { name: tr('en', 'shell.profile.label_named', { name: PEOPLE.e2e.name }) }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  await tabTo(page, expand, { backwards: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: tr('en', 'shell.sidebar.collapse') })).toBeVisible();
});

test('switches the theme from the profile menu and keeps it after reload', async ({ page }) => {
  const choose = async (theme: 'theme.dark' | 'theme.system') => {
    const menu = await openProfileMenu(page, 'en', PEOPLE.e2e.name);
    await arrowTo(page, menu.getByRole('menuitemradio', { name: tr('en', theme) }));
    await page.keyboard.press('Enter');
  };

  await choose('theme.dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await choose('theme.system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
});

test('says so in a toast when signing out fails, and stays', async ({ page, allowedErrors }) => {
  // the request never reaches the server, so the shared session lives on
  await page.route('**/logout', (route) => route.fulfill({ status: 500, body: 'down' }));
  allowedErrors.push(/status of 500 .*\/logout\)$/);

  const menu = await openProfileMenu(page, 'en', PEOPLE.e2e.name);
  await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'shell.profile.logout') }));
  await page.keyboard.press('Enter');

  await expect(page.getByText(tr('en', 'shell.profile.logout_failed'))).toBeVisible();
  await expect(page).toHaveURL(/\/my-items$/);
});

test('loads everything from its own origin', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('data:')) foreign.push(url);
  });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
  const fonts = await page.evaluate(async () => {
    const figtree = await document.fonts.load('16px "Figtree Variable"');
    const bricolage = await document.fonts.load('700 16px "Bricolage Grotesque Variable"');
    return {
      loaded: figtree.length > 0 && bricolage.length > 0,
      figtree: document.fonts.check('16px "Figtree Variable"'),
      bricolage: document.fonts.check('700 16px "Bricolage Grotesque Variable"'),
    };
  });

  expect(fonts).toEqual({ loaded: true, figtree: true, bricolage: true });
  expect(foreign).toEqual([]);
});

test('counts a new notification up live', async ({ page, browser }) => {
  // a second context and the way through the queues and Reverb: more than the default 30 s may pass
  test.setTimeout(60_000);
  // the inbox account of the variant (A289) is a member of a project of the test's own; the e2e person writes
  const project = await createE2eProject(page, `E2E shell badge ${variant()} ${runId()}`, { types: ['Task'] });
  const inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  const other = await signedInContext(browser, inbox);
  try {
    /** The unread notifications of the inbox person, as the server holds them. */
    const unread = async () => {
      const response = await api(other.page, 'GET', '/api/v1/notifications?filter[unread]=1&per_page=100');
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as { data: { work_item_id: string | null; event: string }[]; meta: { total: number } };
    };
    const has = async (itemId: string, event: string) => (await unread()).data.some((entry) => entry.work_item_id === itemId && entry.event === event);

    // assigned: the person watches the item from then on; the notification is there before the page opens
    const item = await createItem(page, { project_id: project.id, title: 'E2E Badge Rechnung', assignee_id: person.id });
    await expect.poll(() => has(item.id, 'assigned'), { timeout: 20_000 }).toBe(true);

    const held = channelHeld(other.page, `presence-user.${person.id}`);
    await other.page.goto('/my-items');
    await held;
    await other.page.evaluate(() => ((window as Window & { __badge?: boolean }).__badge = true));
    // the inbox link that shows: in the sidebar, on the phone in the top bar
    const link = other.page.getByRole('link', { name: /^Inbox(, \S+ unread.*)?$/ }).filter({ visible: true });
    // the name holds what the badge shows: above 99 "99+" and the whole number
    const named = (count: number) => (count > 99 ? tr('en', 'shell.nav.inbox_unread_over', { shown: '99+', count }) : tr('en', 'shell.nav.inbox_unread', { count }));
    const before = (await unread()).meta.total;
    await expect(link).toHaveAccessibleName(named(before));
    await expect(link.locator('[data-inbox-badge]')).toHaveText(before > 99 ? '99+' : String(before));

    // a comment on the watched item: the badge counts up without a reload
    const commented = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: 'E2E Badge: die Rechnung ist raus.' });
    expect(commented.status(), await commented.text()).toBe(201);
    await expect.poll(() => has(item.id, 'comment'), { timeout: 20_000 }).toBe(true);
    const after = (await unread()).meta.total;
    expect(after).toBeGreaterThan(before);
    await expect(link).toHaveAccessibleName(named(after), { timeout: 20_000 });
    await expect(link.locator('[data-inbox-badge]')).toHaveText(after > 99 ? '99+' : String(after));
    expect(await other.page.evaluate(() => (window as Window & { __badge?: boolean }).__badge)).toBe(true);
  } finally {
    await other.context.close();
    await removeE2eProject(page, project.identifier);
  }
});
