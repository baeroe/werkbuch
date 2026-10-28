import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, FAIL_KEY } from '@/api/client';
import { getDb } from '@/api/db';
import { getWorkItem, updateWorkItem } from '@/api/workItems';
import { currentToasts, dismissToast, runToastAction } from '@/components/ui/toast';
import { plainText } from '@/lib/richtext';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import type { ActivityEntry, Comment, ItemEvent, RichText } from '@/types';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { buildTimeline } from './Activity';
import { ItemPage } from './ItemPage';
import { ItemPeek } from './ItemPeek';

/** Switches of the item API for single tests; off, every call goes to the fake API as it is. */
const api = vi.hoisted(() => ({
  /** Saves wait in `held` until released: a save stays on its way while something else happens. */
  holding: false,
  held: [] as Array<() => void>,
  /** Every item read fails with this. */
  readError: null as Error | null,
}));

vi.mock('@/api/workItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workItems')>();
  return {
    ...actual,
    updateWorkItem: vi.fn(async (...args: Parameters<typeof actual.updateWorkItem>) => {
      if (api.holding) await new Promise<void>((resolve) => api.held.push(resolve));
      return actual.updateWorkItem(...args);
    }),
    getWorkItem: vi.fn(async (...args: Parameters<typeof actual.getWorkItem>) => {
      if (api.readError) throw api.readError;
      return actual.getWorkItem(...args);
    }),
  };
});

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  Element.prototype.scrollIntoView = () => {};
  await preloadEditor();
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
  Object.assign(api, { holding: false, held: [], readError: null });
});

afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** The steps of WEB-47 as the server holds them. */
const storedSteps = () => plainText(getDb().items.find((entry) => entry.key === 'WEB-47')!.values.steps as RichText);

/** jsdom is no Mac: mod is the Control key. */
const modEnter = '{Control>}{Enter}{/Control}';

/** Adds text where the editor's caret is. Typed keys would do the same, but jsdom mixes them up behind existing text. */
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });

/** Runs `send` while the fake API is down (503), and answers the error toast it leaves. */
async function failing(send: () => Promise<void>, title: string) {
  localStorage.setItem(FAIL_KEY, '1');
  try {
    await send();
    return await waitFor(() => {
      const failed = currentToasts().find((item) => item.title === title);
      expect(failed?.action?.label).toBe('Erneut versuchen');
      return failed!;
    });
  } finally {
    localStorage.removeItem(FAIL_KEY);
  }
}

/* ----------------------------------------------------------------------------- timeline */

const event = (id: string, actor: string, at: string, changes: ItemEvent['changes'], reason: string | null = null, type = 'work_item.updated'): ActivityEntry => ({
  kind: 'event',
  id,
  at,
  event: { id, type, actor_id: actor, subject: { type: 'work_item', id: 'wi_web_47' }, project_id: 'p_web', changes, reason, occurred_at: at },
});
const comment = (id: string, author: string, at: string): ActivityEntry => ({
  kind: 'comment',
  id,
  at,
  comment: { id, work_item_id: 'wi_web_47', author_id: author, body: { type: 'doc', content: [] }, created_at: at, edited_at: null, reactions: [] } satisfies Comment,
});

describe('buildTimeline', () => {
  const entries: ActivityEntry[] = [
    event('a', 'u_ida', '2026-10-27T10:00:00Z', { priority: { old: 'high', new: 'urgent' } }),
    event('b', 'u_ida', '2026-10-27T10:04:59Z', { due_date: { old: null, new: '2026-10-31' } }),
    event('c', 'u_ida', '2026-10-27T10:05:01Z', { label_ids: { old: [], new: ['lb_ux'] } }),
    event('d', 'u_automation', '2026-10-27T10:05:02Z', { assignee_id: { old: null, new: 'u_jonas' } }, 'Automatisierung: Assignee beim Start'),
    comment('e', 'u_mara', '2026-10-27T10:06:00Z'),
    event('f', 'u_ida', '2026-10-27T10:07:00Z', { title: { old: 'A', new: 'B' } }),
  ];

  it('folds changes of one person within five minutes into one line, and starts anew after a comment', () => {
    const lines = buildTimeline(entries, 'all');
    expect(lines.map((line) => (line.kind === 'events' ? line.events.map((entry) => entry.id).join('+') : `comment ${line.key}`))).toEqual([
      // c comes 5 min 1 s after the group's first change: a line of its own
      'a+b',
      'c',
      'd',
      'comment e',
      'f',
    ]);
  });

  it('filters comments and changes, and leaves the webhook events of bots out', () => {
    const withBot: ActivityEntry[] = [...entries, event('g', 'u_mara', '2026-10-27T10:08:00Z', {}, null, 'bot.mentioned')];
    expect(buildTimeline(withBot, 'comments').map((line) => line.key)).toEqual(['e']);
    expect(buildTimeline(withBot, 'changes').map((line) => line.key)).toEqual(['a', 'c', 'd', 'f']);
  });
});

/* ------------------------------------------------------------------------------ detail */

describe('ItemPeek', () => {
  it('shows a relation to an item the reader may not see as "verborgenes Item", without a way to remove it', async () => {
    asUser('u_ida');
    renderWithData(<ItemPeek itemId="WEB-47" />);

    const relations = await screen.findByRole('region', { name: 'Relationen' });
    await within(relations).findByText('verborgenes Item');
    expect(within(relations).queryByText(/OPS-12/)).toBeNull();
    // the visible one can go, the hidden one has no button
    expect(within(relations).getAllByRole('button', { name: /entfernen/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Relation „wird getestet von WEB-54“ entfernen',
    ]);
  });

  it('a save on a stale description version shows the conflict: "Meine Fassung übernehmen" saves this text over the other', async () => {
    const user = userEvent.setup();
    const before = (await getWorkItem('WEB-47')).item;
    renderWithData(<ItemPeek itemId="WEB-47" />);

    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Beschreibungskonflikt simulieren' }));

    const banner = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(banner.textContent).toContain('hat die Beschreibung inzwischen geändert');
    // the other window's version is stored; this window still shows its own
    expect(plainText((await getWorkItem('WEB-47')).item.description)).toContain('Nachtrag aus einem zweiten Fenster');

    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(async () => {
      const stored = (await getWorkItem('WEB-47')).item;
      expect(plainText(stored.description)).toBe(plainText(before.description));
      expect(stored.description_version).toBe(before.description_version + 2);
    });
    expect(screen.queryByText(/hat die Beschreibung inzwischen geändert/)).toBeNull();
  });

  it('"Neu laden" takes the other version into the editor and drops the conflict', async () => {
    const user = userEvent.setup();
    renderWithData(<ItemPeek itemId="WEB-47" />);

    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Beschreibungskonflikt simulieren' }));
    const banner = await screen.findByRole('alert', {}, { timeout: 3000 });
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));

    expect(screen.queryByRole('alert')).toBeNull();
    const editor = screen.getByRole('textbox', { name: 'Beschreibung' });
    await waitFor(() => expect(editor.textContent).toContain('Nachtrag aus einem zweiten Fenster'));
  });

  it('keeps the own version of an open conflict when the item closes: reopened, the banner offers it again', async () => {
    const user = userEvent.setup();
    const first = renderWithData(<ItemPeek itemId="WEB-47" />);
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Beschreibungskonflikt simulieren' }));
    await screen.findByRole('alert', {}, { timeout: 3000 });
    // written on below the banner, then the preview closes
    paste(screen.getByRole('textbox', { name: 'Beschreibung' }), 'Meine Ergänzung. ');
    first.unmount();

    renderWithData(<ItemPeek itemId="WEB-47" />);
    const editor = await screen.findByRole('textbox', { name: 'Beschreibung' });
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('hat die Beschreibung inzwischen geändert');
    expect(editor.textContent).toContain('Meine Ergänzung.');
    expect(editor.textContent).not.toContain('Nachtrag aus einem zweiten Fenster');

    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(async () => expect(plainText((await getWorkItem('WEB-47')).item.description)).toContain('Meine Ergänzung.'));
    expect(plainText((await getWorkItem('WEB-47')).item.description)).not.toContain('Nachtrag aus einem zweiten Fenster');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the save state of the description in a status region that is there before the first save', async () => {
    const user = userEvent.setup();
    renderWithData(<ItemPeek itemId="WEB-47" />);
    const section = await screen.findByRole('region', { name: 'Beschreibung' });
    const editor = await within(section).findByRole('textbox', { name: 'Beschreibung' });
    // a live region speaks only about changes it was there for
    const status = within(section).getByRole('status');
    expect(status.textContent).toBe('');

    await user.click(editor);
    paste(editor, 'Kurz vor dem Release geprüft. ');
    await user.keyboard(modEnter);
    await waitFor(() => expect(status.textContent).toBe('Gespeichert'));
    expect(within(section).getByRole('status')).toBe(status);
  });
});

/* ------------------------------------------------------------------------------ retries */

describe('a rich text property that failed to save', () => {
  it('keeps its text, also when the item is fetched again, and the next save sends it', async () => {
    const user = userEvent.setup();
    const { client } = renderWithData(<ItemPeek itemId="WEB-47" />);
    const steps = await screen.findByRole('textbox', { name: 'Schritte zum Nachstellen' });
    await user.click(steps);
    paste(steps, 'Vorher den Cache leeren. ');

    // the save fails, and so does the reload after it: the item stays on screen with the text in its editor
    await failing(() => user.keyboard(modEnter), 'Änderung nicht gespeichert');
    expect(steps.isConnected).toBe(true);
    expect(steps.textContent).toContain('Vorher den Cache leeren.');
    // the server answers again, with the old steps
    await act(() => client.invalidateQueries());
    expect(screen.getByRole('textbox', { name: 'Schritte zum Nachstellen' })).toBe(steps);
    expect(steps.textContent).toContain('Vorher den Cache leeren.');

    await user.keyboard(modEnter);
    await waitFor(async () => expect(plainText((await getWorkItem('WEB-47')).item.values.steps as RichText)).toContain('Vorher den Cache leeren.'));
  });

  it('keeps saving when "Erneut versuchen" runs while a save is on its way: what is written later reaches the server', async () => {
    const user = userEvent.setup();
    renderWithData(<ItemPeek itemId="WEB-47" />);
    const steps = await screen.findByRole('textbox', { name: 'Schritte zum Nachstellen' });
    await user.click(steps);
    paste(steps, 'Vorher den Cache leeren. ');
    const failed = await failing(() => user.keyboard(modEnter), 'Änderung nicht gespeichert');

    // the click on the toast takes the focus from the editor, whose blur saves; the retry comes while that save is out
    api.holding = true;
    act(() => steps.blur());
    await waitFor(() => expect(api.held).toHaveLength(1));
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(api.held).toHaveLength(2));
    api.holding = false;
    await act(async () => api.held.splice(0).forEach((release) => release()));
    await waitFor(() => expect(storedSteps()).toContain('Vorher den Cache leeren.'));

    await user.click(steps);
    paste(steps, 'Danach noch ergänzt. ');
    await user.keyboard(modEnter);
    await waitFor(() => expect(storedSteps()).toContain('Danach noch ergänzt.'));
  });

  it('does not take back an older text when the retry of a failed save lands after a newer save', async () => {
    const user = userEvent.setup();
    renderWithData(<ItemPeek itemId="WEB-47" />);
    const steps = await screen.findByRole('textbox', { name: 'Schritte zum Nachstellen' });
    await user.click(steps);
    paste(steps, 'Vorher den Cache leeren. ');
    const failed = await failing(() => user.keyboard(modEnter), 'Änderung nicht gespeichert');
    // written on after the failure, then "Erneut versuchen": the blur saves the newer text, the retry sends the older one
    paste(steps, 'Danach noch ergänzt. ');
    api.holding = true;
    act(() => steps.blur());
    await waitFor(() => expect(api.held).toHaveLength(1));
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(api.held).toHaveLength(2));
    const retry = vi.mocked(updateWorkItem).mock.results.at(-1)!;
    api.holding = false;

    // the newer save lands first, the retry with the older text after it
    await act(async () => api.held[0]());
    await waitFor(() => expect(storedSteps()).toContain('Danach noch ergänzt.'));
    await act(async () => {
      api.held[1]();
      await retry.value;
    });
    await waitFor(() => expect(storedSteps()).toContain('Danach noch ergänzt.'));
    expect(steps.textContent).toContain('Danach noch ergänzt.');
  });
});

/* --------------------------------------------------------------------------- access lost */

describe('an item the reader can no longer see (403)', () => {
  const forbidden = () => new ApiError({ status: 403, reason: 'forbidden', detail: 'Dieses Projekt siehst du nicht.' });

  it('the preview shows it as gone instead of what it had loaded', async () => {
    const { client } = renderWithData(<ItemPeek itemId="WEB-47" />);
    await screen.findByRole('textbox', { name: 'Beschreibung' });

    api.readError = forbidden();
    await act(() => client.invalidateQueries());
    expect(await screen.findByText('Dieses Item gibt es nicht mehr')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Beschreibung' })).toBeNull();
  });

  it('the page shows its 404 page instead of what it had loaded', async () => {
    const { client } = renderWithData(
      <Routes>
        <Route path="/items/:key" element={<ItemPage />} />
      </Routes>,
      '/items/WEB-47',
    );
    await screen.findByRole('textbox', { name: 'Beschreibung' });

    api.readError = forbidden();
    await act(() => client.invalidateQueries());
    expect(await screen.findByRole('heading', { level: 1, name: 'WEB-47 gibt es nicht' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Beschreibung' })).toBeNull();
  });
});

describe('"Erneut versuchen" on a comment that failed', () => {
  it('sends the comment as it reads now, also what was written after the failure', async () => {
    const user = userEvent.setup();
    renderWithData(<ItemPeek itemId="WEB-47" />);
    const { item } = await getWorkItem('WEB-47');
    await user.click(await screen.findByRole('button', { name: /Kommentar schreiben/ }));
    const editor = await screen.findByRole('textbox', { name: 'Kommentar' });
    // the editor takes the focus once it is there; keys before that would be the detail's shortcuts
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await user.keyboard('Tritt auch in Safari auf');

    const failed = await failing(() => user.keyboard(modEnter), 'Kommentar nicht gesendet');
    paste(editor, ' und in Firefox');
    act(() => runToastAction(failed.id));

    await waitFor(() => expect(currentToasts().some((entry) => entry.title === 'Kommentar gesendet')).toBe(true));
    const sent = getDb().comments.filter((entry) => entry.work_item_id === item.id);
    expect(plainText(sent.at(-1)!.body)).toBe('Tritt auch in Safari auf und in Firefox');
    // all of it went out: the composer starts empty again
    expect(await screen.findByRole('button', { name: /Kommentar schreiben/ })).toBeTruthy();
  });

  it('saves an edited comment as it reads now, also what was written after the failure', async () => {
    const user = userEvent.setup();
    renderWithData(<ItemPeek itemId="WEB-47" />);
    await user.click(await screen.findByRole('button', { name: 'Aktionen für den Kommentar von Mara Lindqvist' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));
    const editor = await screen.findByRole('textbox', { name: 'Kommentar bearbeiten' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    paste(editor, ' Auch unter iOS 17.');

    const failed = await failing(() => user.keyboard(modEnter), 'Kommentar nicht geändert');
    paste(editor, ' Und auf dem iPad.');
    act(() => runToastAction(failed.id));

    await waitFor(() => expect(currentToasts().some((entry) => entry.title === 'Kommentar geändert')).toBe(true));
    const stored = getDb().comments.find((entry) => entry.id === 'c_web47_1')!;
    expect(plainText(stored.body)).toBe('Kann ich reproduzieren, nur unter iOS 18. Auch unter iOS 17. Und auf dem iPad.');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Kommentar bearbeiten' })).toBeNull());
  });
});
