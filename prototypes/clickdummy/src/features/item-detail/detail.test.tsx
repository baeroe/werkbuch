import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getWorkItem } from '@/api/workItems';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { plainText } from '@/lib/richtext';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import type { ActivityEntry, Comment, ItemEvent } from '@/types';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { buildTimeline } from './Activity';
import { ItemPeek } from './ItemPeek';

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
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
});
