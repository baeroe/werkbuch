import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { getDb, saveDb } from '@/api/db';
import { simulateRemoteChange } from '@/api/live';
import * as notificationsApi from '@/api/notifications';
import { listNotifications } from '@/api/notifications';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { useLiveSync } from '@/hooks/live';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { InboxScreen } from './InboxScreen';

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => resetToasts());
  vi.restoreAllMocks();
});

/** What the shell does for the screen: the live sync. */
function LiveSync() {
  useLiveSync();
  return null;
}

function renderInbox(path = '/inbox') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/inbox',
        element: (
          <>
            <LiveSync />
            <InboxScreen />
          </>
        ),
      },
      { path: '*', element: <p>anderswo</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

/** The list once its first load is over (the skeleton is gone). */
const loaded = () => screen.findByRole('heading', { level: 2, name: /WEB-42/ });

const rows = () => screen.getAllByRole('link').filter((link) => link.hasAttribute('data-item-link'));
const toastTitles = () => currentToasts().map((item) => item.title);

describe('the list', () => {
  it('stands in cards, one per item, with the notifications of the item inside', async () => {
    renderInbox();
    await loaded();

    const web47 = await screen.findByRole('article', { name: /WEB-47/ });
    expect(within(web47).getAllByRole('listitem')).toHaveLength(3);
    expect(within(web47).getByText(/hat den Status von/)).toBeTruthy();
    // 14 notifications, 11 groups: nine items, the project OPS (a failed template) and the organisation (a webhook)
    expect(screen.getAllByRole('listitem')).toHaveLength(14);
    expect(screen.getAllByRole('article')).toHaveLength(9);
    expect(screen.getByRole('heading', { level: 2, name: 'Infrastruktur' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Organisation' })).toBeTruthy();
  });

  it('says who did what, with an excerpt for mentions and comments', async () => {
    renderInbox();
    await loaded();

    const mention = screen.getByRole('link', { name: /Ida Brenner hat dich erwähnt.*Hero-Entwurf ist drin/ });
    expect(mention.textContent).toContain('„Hero-Entwurf ist drin');
    expect(screen.getByRole('link', { name: /^Ungelesen: Theo Okafor hat dir das Item zugewiesen/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Heute fällig/ })).toBeTruthy();
    // the names of the webhook and the template come with their own queries
    expect(await screen.findByRole('link', { name: /Der Webhook „Altes CRM“ wurde abgeschaltet/ })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Die Vorlage „Zertifikate prüfen“ hat kein Item angelegt/ })).toBeTruthy();
  });

  it('marks the unread ones and counts them', async () => {
    renderInbox();
    await loaded();

    expect(screen.getAllByRole('listitem').filter((row) => row.hasAttribute('data-unread'))).toHaveLength(3);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('3 ungelesen'));
    expect(screen.getByRole('link', { name: /^Ungelesen: Ida Brenner hat dich erwähnt/ })).toBeTruthy();
    // the ink-blue dot is the cue for the eye: on the unread rows only
    const dotted = screen.getAllByRole('listitem').filter((row) => row.querySelector('span[aria-hidden="true"].bg-accent'));
    expect(dotted.map((row) => row.hasAttribute('data-unread'))).toEqual([true, true, true]);
  });

  it('filters by unread and by mentions, and keeps the filter in the address', async () => {
    const user = userEvent.setup();
    const { router } = renderInbox();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Ungelesen' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(router.state.location.search).toBe('?unread=1');

    await user.click(screen.getByRole('button', { name: 'Ungelesen' }));
    await user.click(screen.getByRole('button', { name: 'Erwähnungen' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(rows().every((link) => /erwähnt/.test(link.textContent ?? ''))).toBe(true);
    expect(router.state.location.search).toBe('?mentions=1');
  });

  it('starts from the filter in the address', async () => {
    renderInbox('/inbox?unread=1&mentions=1');

    await loaded();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ungelesen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Erwähnungen' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the keys', () => {
  it('j and k move the cursor and the focus; the list is one stop in the tab order', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    const links = rows();
    // before any key: the first row is the stop
    expect(links.filter((link) => link.tabIndex === 0)).toEqual([links[0]]);

    await user.keyboard('j');
    expect(document.activeElement).toBe(links[0]);
    expect(links[0].getAttribute('aria-current')).toBe('true');
    await user.keyboard('jj');
    expect(document.activeElement).toBe(links[2]);
    expect(links.filter((link) => link.tabIndex === 0)).toEqual([links[2]]);
    await user.keyboard('k');
    expect(document.activeElement).toBe(links[1]);
    // the end of the list stays the end
    await user.keyboard('kkk');
    expect(document.activeElement).toBe(links[0]);
  });

  it('the arrow keys move the cursor while a row holds the focus', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    const links = rows();

    await user.keyboard('j{ArrowDown}');
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(links[0]);
  });

  it('e marks the notification under the cursor read, and the counter in the header follows', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('3 ungelesen'));

    await user.keyboard('j');
    expect(rows()[0].textContent).toContain('hat dich erwähnt');
    await user.keyboard('e');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 ungelesen'));
    expect(rows()[0].getAttribute('aria-current')).toBe('true');
    // a change that shows at once needs no toast (only a refusal does)
    expect(toastTitles()).toEqual([]);
    expect((await listNotifications({ unread_only: true })).items.map((entry) => entry.id)).not.toContain('n_01');
  });

  it('e shows the notification as read and counts it before the server has answered', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    // the server answers when the test says so
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const original = notificationsApi.markRead;
    vi.spyOn(notificationsApi, 'markRead').mockImplementation(async (ids) => {
      await gate;
      return original(ids);
    });
    await user.keyboard('j');
    const row = rows()[0].closest('li')!;
    expect(row.hasAttribute('data-unread')).toBe(true);

    await user.keyboard('e');

    expect(row.hasAttribute('data-unread')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('2 ungelesen');
    expect(within(row).queryByRole('button', { name: 'Als gelesen markieren' })).toBeNull();
    // the call has not even been answered
    expect((await listNotifications({ unread_only: true })).total).toBe(3);

    answer();
    await waitFor(async () => expect((await listNotifications({ unread_only: true })).total).toBe(2));
    expect(screen.getByRole('status').textContent).toBe('2 ungelesen');
  });

  it('shift+e with nothing unread says so and does not call the server', async () => {
    const user = userEvent.setup();
    const call = vi.spyOn(notificationsApi, 'markAllRead');
    renderInbox();
    await loaded();
    await user.keyboard('{Shift>}e{/Shift}');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Alles gelesen'));
    call.mockClear();
    act(() => currentToasts().forEach((item) => dismissToast(item.id)));

    await user.keyboard('{Shift>}e{/Shift}');

    expect(currentToasts().map((item) => item.title)).toEqual(['Alles gelesen']);
    expect(call).not.toHaveBeenCalled();
  });

  it('shift+e shows everything read at once as well', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const original = notificationsApi.markAllRead;
    vi.spyOn(notificationsApi, 'markAllRead').mockImplementation(async () => {
      await gate;
      return original();
    });

    await user.keyboard('{Shift>}e{/Shift}');

    expect(screen.getAllByRole('listitem').filter((row) => row.hasAttribute('data-unread'))).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('Alles gelesen');
    answer();
    await waitFor(async () => expect((await listNotifications({ unread_only: true })).total).toBe(0));
  });

  it('e shows the notification as read before the server has answered, and takes it back when the server fails', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    await user.keyboard('j');
    const row = rows()[0].closest('li')!;
    localStorage.setItem('api:fail', '1');

    await user.keyboard('e');

    // the call fails: the dot is back, the toast says why and offers to try again
    await waitFor(() => expect(currentToasts().some((item) => item.title === 'Nicht als gelesen markiert')).toBe(true));
    expect(row.hasAttribute('data-unread')).toBe(true);
    expect(currentToasts().find((item) => item.title === 'Nicht als gelesen markiert')?.action?.label).toBe('Erneut versuchen');
    expect(screen.getByRole('status').textContent).toBe('3 ungelesen');
  });

  it('e without a cursor says how to get one and changes nothing', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('e');

    expect(toastTitles()).toEqual(['Keine Benachrichtigung ausgewählt']);
    expect((await listNotifications({ unread_only: true })).total).toBe(3);
  });

  it('in the unread list e takes the cursor on to the next row before the row leaves', async () => {
    const user = userEvent.setup();
    renderInbox('/inbox?unread=1');
    await loaded();
    const [first, second] = rows();

    await user.keyboard('je');

    // the focus is on the second row before the first one is gone
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().includes(first)).toBe(false);
    expect(document.activeElement).toBe(second);
  });

  it('shift+e marks all of them read', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('{Shift>}e{/Shift}');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Alles gelesen'));
    expect(toastTitles()).toEqual([]);
    expect((await listNotifications({ unread_only: true })).total).toBe(0);
  });

  it('# deletes the row at once, "Rückgängig" brings it back and nothing is deleted', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('j#');

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(13));
    // the cursor went on to the next row
    expect(document.activeElement).toBe(rows()[0]);
    const toastItem = currentToasts().find((item) => item.title === 'Benachrichtigung gelöscht')!;
    expect(toastItem.action?.label).toBe('Rückgängig');

    act(() => runToastAction(toastItem.id));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(14));
    expect((await listNotifications()).total).toBe(14);
  });

  it('# deletes for real when the toast runs out', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('j#');
    const toastItem = currentToasts().find((item) => item.title === 'Benachrichtigung gelöscht')!;
    // the toast ending (time up, closed, pushed out) is what runs the call
    act(() => dismissToast(toastItem.id));

    await waitFor(async () => expect((await listNotifications()).total).toBe(13));
    expect((await listNotifications()).items.map((entry) => entry.id)).not.toContain('n_01');
  });

  it('a delete that fails brings the row back and says why', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('j#');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(13));
    localStorage.setItem('api:fail', '1');
    act(() => dismissToast(currentToasts().find((item) => item.title === 'Benachrichtigung gelöscht')!.id));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(14));
    const error = currentToasts().find((item) => item.tone === 'error')!;
    expect(error.title).toBe('Benachrichtigung nicht gelöscht');
    // a server failure is worth a second try
    expect(error.action?.label).toBe('Erneut versuchen');
  });

  it('Enter opens the item in the preview, does not navigate, and does not mark anything read', async () => {
    const user = userEvent.setup();
    const { router } = renderInbox();
    await loaded();

    await user.keyboard('j{Enter}');

    expect(useUiStore.getState().peekItemId).toBe('wi_web_42');
    expect(router.state.location.pathname).toBe('/inbox');
    expect((await listNotifications({ unread_only: true })).total).toBe(3);
  });

  it('a click does the same as Enter, and a click with a modifier key is left to the browser', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    const link = screen.getByRole('link', { name: /Theo Okafor hat kommentiert/ });
    // jsdom cannot navigate: the browser's part of the click is cancelled by the test
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link, { ctrlKey: true });
    expect(useUiStore.getState().peekItemId).toBeNull();

    await user.click(link);
    expect(useUiStore.getState().peekItemId).toBe('wi_app_15');
  });

  it('Enter on a button elsewhere stays that button’s Enter', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    await user.keyboard('j');

    screen.getByRole('button', { name: 'Ungelesen' }).focus();
    await user.keyboard('{Enter}');

    expect(useUiStore.getState().peekItemId).toBeNull();
    expect(screen.getByRole('button', { name: 'Ungelesen' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('what belongs to no item leads to its page on Enter', async () => {
    const user = userEvent.setup();
    const { router } = renderInbox();
    await loaded();

    (await screen.findByRole('link', { name: /Der Webhook „Altes CRM“ wurde abgeschaltet/ })).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/webhooks'));
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('lists its keys in the help, in the group Inbox', async () => {
    renderInbox();
    await loaded();

    const keys = listShortcuts()
      .filter((shortcut) => shortcut.group === 'Inbox')
      .map((shortcut) => `${shortcut.scope}:${shortcut.keys}`);
    expect(keys).toEqual(expect.arrayContaining(['list:j', 'list:k', 'list:e', 'list:shift+e', 'list:#', 'list:enter']));
  });
});

describe('a long inbox', () => {
  it('shows the newest fifty and says how many there are', async () => {
    const db = getDb();
    const template = db.notifications[0];
    for (let index = 0; index < 45; index += 1) {
      db.notifications.push({ ...template, id: `n_extra_${index}`, read_at: template.created_at, created_at: `2026-09-${String(1 + (index % 20)).padStart(2, '0')}T08:00:00.000Z` });
    }
    saveDb();
    renderInbox();
    await loaded();

    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText(/Die neuesten 50 von 59\sBenachrichtigungen/)).toBeTruthy();
  });
});

describe('the buttons', () => {
  it('"Alle als gelesen markieren" does what shift+e does and says why it is off when everything is read', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.click(screen.getByRole('button', { name: /Alle als gelesen markieren/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Alles gelesen'));

    // not dimmed away: it stays focusable and says why it does nothing
    expect(screen.getByRole('button', { name: /Alle als gelesen markieren/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('the button of a row marks that one read', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    const row = screen.getByRole('link', { name: /^Ungelesen: Theo Okafor hat dir das Item zugewiesen/ }).closest('li')!;

    await user.click(within(row).getByRole('button', { name: 'Als gelesen markieren' }));

    await waitFor(() => expect(row.hasAttribute('data-unread')).toBe(false));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 ungelesen'));
  });

  it('the menu of a row (touch screens) offers the same two actions', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();
    const row = screen.getByRole('link', { name: /Theo Okafor hat kommentiert/ }).closest('li')!;

    await user.click(within(row).getByRole('button', { name: 'Aktionen für diese Benachrichtigung' }));

    expect(await screen.findByRole('menuitem', { name: 'Als gelesen markieren' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeTruthy();
  });
});

describe('the states', () => {
  it('shows "Inbox ist leer" with the next steps for somebody without notifications', async () => {
    asUser('u_ida');
    renderInbox();

    expect(await screen.findByText('Inbox ist leer')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Benachrichtigungen einstellen/ }).getAttribute('href')).toBe('/me/notifications');
    expect(screen.getByRole('link', { name: 'Meine Items öffnen' }).getAttribute('href')).toBe('/my-items');
  });

  it('says "Alles gelesen" in the unread list when nothing is left, with the way back', async () => {
    const user = userEvent.setup();
    renderInbox('/inbox?unread=1');
    await loaded();

    await user.keyboard('{Shift>}e{/Shift}');

    expect(await screen.findByText('Alles gelesen', { selector: 'p.font-display' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Alle anzeigen' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(14));
  });

  it('shows a skeleton while the list loads', async () => {
    renderInbox();

    expect(screen.getByText('Inbox wird geladen …')).toBeTruthy();
    await loaded();
    expect(screen.queryByText('Inbox wird geladen …')).toBeNull();
  });

  it('shows the cause and "Erneut versuchen" when the server fails, and the list after the retry', async () => {
    const user = userEvent.setup();
    localStorage.setItem('api:fail', '1');
    renderInbox();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Die Inbox konnte nicht geladen werden')).toBeTruthy();
    expect(within(alert).getByText(/Simulierter Serverfehler/)).toBeTruthy();

    localStorage.removeItem('api:fail');
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    await loaded();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('live', () => {
  it('a notification caused by somebody else appears and the counters count it', async () => {
    renderInbox();
    await loaded();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('3 ungelesen'));

    // "Live-Ereignis simulieren": Ida changes an item Mara watches
    await act(async () => {
      await simulateRemoteChange();
    });

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('4 ungelesen'));
    expect(screen.getAllByRole('listitem').filter((row) => row.hasAttribute('data-unread'))).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------------ fix round 1 */

/** The server answers when the test says so. */
function held() {
  let answer!: () => void;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  return { gate, answer };
}

const focusedHref = () => (document.activeElement as HTMLAnchorElement).getAttribute('href');

describe('calls that overlap', () => {
  it('settles every e, also when a second one is sent before the first is answered', async () => {
    const user = userEvent.setup();
    const { gate, answer } = held();
    const original = notificationsApi.markRead;
    vi.spyOn(notificationsApi, 'markRead').mockImplementation(async (ids) => {
      await gate;
      return original(ids);
    });
    renderInbox('/inbox?unread=1');
    await loaded();

    // j e e: two of the three unread notifications are read, the server has answered neither
    await user.keyboard('jee');
    expect(screen.getByRole('status').textContent).toBe('1 ungelesen');

    answer();
    await waitFor(async () => expect((await listNotifications({ unread_only: true })).total).toBe(1));
    // no mark is left pending: the header counts what the server counts, and the button is not off
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 ungelesen'));
    expect(screen.getByRole('button', { name: /Alle als gelesen markieren/ }).getAttribute('aria-disabled')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('puts a notification back when its call fails after a second one was sent', async () => {
    const user = userEvent.setup();
    const { gate, answer } = held();
    const original = notificationsApi.markRead;
    let calls = 0;
    vi.spyOn(notificationsApi, 'markRead').mockImplementation(async (ids) => {
      calls += 1;
      const mine = calls;
      await gate;
      if (mine === 1) throw new ApiError({ status: 503, reason: 'simulated', detail: 'Simulierter Serverfehler.' });
      return original(ids);
    });
    renderInbox('/inbox?unread=1');
    await loaded();
    await user.keyboard('jee');

    answer();

    // the first call failed: its toast comes, and its notification is unread again; the second one is read
    await waitFor(() => expect(currentToasts().some((item) => item.title === 'Nicht als gelesen markiert')).toBe(true));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 ungelesen'));
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain('Ida Brenner hat dich erwähnt');
  });
});

describe('the cursor after a removal', () => {
  it('goes to the row that moves up, also when the group of the deleted row sorts down', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    // "Heute fällig" is the newest notification of APP-18: without it that group falls behind all the others
    await user.keyboard('jj#');

    expect(focusedHref()).toBe('/items/APP-24');
    await user.keyboard('j');
    expect(focusedHref()).toBe('/items/APP-15');
  });

  it('goes to the row that moves up in the unread list as well', async () => {
    // an older unread notification on WEB-42: once the newest is read, that group falls behind the others
    const db = getDb();
    db.notifications.push({ ...db.notifications.find((entry) => entry.id === 'n_01')!, id: 'n_old_web42', created_at: '2026-10-19T08:00:00.000Z' });
    saveDb();
    const user = userEvent.setup();
    renderInbox('/inbox?unread=1');
    await loaded();
    expect(rows()).toHaveLength(4);

    await user.keyboard('je');

    expect(focusedHref()).toBe('/items/APP-24');
    await user.keyboard('j');
    expect(focusedHref()).toBe('/items/APP-15');
  });

  it('stays on the previous row when the last one goes', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('k#');

    // the last row is the failed template run of the project OPS; the one before it is the webhook
    expect(focusedHref()).toBe('/settings/webhooks');
  });
});

describe('toasts and the undo', () => {
  it('keeps the 5 seconds of undo while read marks follow', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    // delete "Heute fällig" (undo toast), then read the three unread notifications
    await user.keyboard('jj#');
    await user.keyboard('e');
    await user.keyboard('je');
    await user.keyboard('kkke');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Alles gelesen'));
    // reading shows no toast: nothing pushed the undo out, nothing was deleted
    expect(toastTitles()).toEqual(['Benachrichtigung gelöscht']);
    expect((await listNotifications()).total).toBe(14);

    const undo = currentToasts().find((item) => item.title === 'Benachrichtigung gelöscht')!;
    act(() => runToastAction(undo.id));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(14));
    expect((await listNotifications()).total).toBe(14);
  });

  it('shows no toast for shift+e either, which is shown at once as well', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('{Shift>}e{/Shift}');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Alles gelesen'));
    expect(toastTitles()).toEqual([]);
  });

  it('shows a hint once, however often the key is pressed', async () => {
    const user = userEvent.setup();
    renderInbox();
    await loaded();

    await user.keyboard('eeee');
    expect(toastTitles()).toEqual(['Keine Benachrichtigung ausgewählt']);

    await user.keyboard('{Shift>}e{/Shift}');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Alles gelesen'));
    act(() => currentToasts().forEach((item) => dismissToast(item.id)));
    await user.keyboard('{Shift>}ee{/Shift}');
    expect(toastTitles()).toEqual(['Alles gelesen']);
  });
});
