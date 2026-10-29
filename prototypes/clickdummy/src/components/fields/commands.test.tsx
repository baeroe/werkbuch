/*
 * The item commands when their targets or catalogs are not what the shortcut found last: several items for `shift+p`,
 * a focus that moved into the preview of an item of another project, and a catalog that failed to load.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeekHost } from '@/app/PeekHost';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useWorkItems } from '@/hooks/workItems';
import { listCommands } from '@/lib/commands';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { useItemCommands, type ItemCommandScope } from './commands';

/** The labels can be made to fail, as a catalog that does not load. */
const labels = vi.hoisted(() => ({ failing: false }));
vi.mock('@/api/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/catalog')>();
  return {
    ...actual,
    listLabels: vi.fn(async () => {
      if (labels.failing) throw new Error('Netzwerkfehler');
      return actual.listLabels();
    }),
  };
});

beforeEach(() => {
  resetApi();
  labels.failing = false;
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  act(() => resetToasts());
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function Screen({ scope, cursor }: { scope: ItemCommandScope; cursor: string }) {
  useItemCommands({ scope, current: () => cursor });
  return null;
}

/** A list of WEB on screen, so a selection of its items is in the cache. */
function WebList() {
  const items = useWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } }).data?.items;
  return <ul aria-label="WEB">{items?.map((item) => <li key={item.id}>{item.key}</li>)}</ul>;
}

const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.body) =>
  act(() => {
    on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const command = (id: string) => listCommands().find((entry) => entry.id === id);
const lastToast = () => currentToasts().at(-1);

describe('item commands', () => {
  it('shift+p with two items selected says that the parent changes for one item only, instead of asking to wait', async () => {
    renderWithData(
      <>
        <Screen scope="list" cursor="wi_web_42" />
        <WebList />
      </>,
    );
    await within(await screen.findByRole('list', { name: 'WEB' })).findByText('WEB-50');
    act(() => useUiStore.setState({ selection: ['wi_web_42', 'wi_web_50'] }));
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für 2 Items'));
    await waitFor(() => expect(command('item.state')?.when?.()).toBe(true));

    press('P', { shiftKey: true });
    expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Typ und Eltern-Item ändern sich nur für ein Item allein.' });
  });

  it('a burst of refused shortcuts leaves one „Nicht möglich“ on screen, not one per press', async () => {
    renderWithData(
      <>
        <Screen scope="list" cursor="wi_web_42" />
        <WebList />
      </>,
    );
    await within(await screen.findByRole('list', { name: 'WEB' })).findByText('WEB-50');
    act(() => useUiStore.setState({ selection: ['wi_web_42', 'wi_web_50'] }));
    await waitFor(() => expect(command('item.state')?.when?.()).toBe(true));

    for (let pressed = 0; pressed < 6; pressed += 1) press('P', { shiftKey: true });
    expect(currentToasts().filter((item) => item.title === 'Nicht möglich')).toHaveLength(1);
  });

  it('shift+p in the preview of an item of another project offers the parents of that project', async () => {
    renderWithData(
      <>
        <Screen scope="list" cursor="wi_web_42" />
        <PeekHost />
        <CommandPalette />
      </>,
    );
    act(() => useUiStore.setState({ peekItemId: 'wi_app_11' }));
    const panel = await screen.findByRole('complementary', { name: 'Vorschau' });
    await waitFor(() => expect(listShortcuts().find((shortcut) => shortcut.id === 'item.parent')?.scope).toBe('detail'));
    // with the focus outside, the commands act on the list's cursor (WEB-42) and have loaded what it needs
    await waitFor(() => expect(command('item.parent')?.when?.()).toBe(true));

    act(() => panel.focus());
    // the focus moved into the preview: the commands follow it to APP-11 and load the items of APP
    await waitFor(() => expect(command('item.parent')?.group).toBe('Aktionen für APP-11'));
    await waitFor(() => expect(command('item.parent')?.when?.()).toBe(true));
    press('P', { shiftKey: true }, panel);

    const list = await screen.findByRole('listbox', { name: 'Eltern-Item setzen …' });
    const options = within(list).getAllByRole('option').map((option) => option.textContent ?? '');
    // APP-11 hangs under APP-5, the one epic of APP: only epics are offered
    expect(options).toEqual(['Kein Eltern-Item', expect.stringContaining('APP-5')]);
    // „Kein Eltern-Item“ carries its icon, as in the parent field
    expect(within(list).getByRole('option', { name: /Kein Eltern-Item/ }).querySelector('svg.lucide-corner-left-up')).not.toBeNull();
  });

  it('shift+p on an epic says that epics have no parent, and the palette leaves the command out', async () => {
    renderWithData(<Screen scope="list" cursor="wi_web_30" />);
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für WEB-30'));
    await waitFor(() => expect(command('item.state')?.when?.()).toBe(true));

    press('P', { shiftKey: true });

    expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Epics haben kein Eltern-Item.' });
    expect(command('item.parent')?.when?.()).toBe(false);
  });

  it('a catalog that failed to load says so with "Erneut versuchen" instead of "Einen Moment" for ever', async () => {
    labels.failing = true;
    renderWithData(<Screen scope="detail" cursor="wi_web_42" />);
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für WEB-42'));

    await waitFor(() => {
      press('s');
      expect(lastToast()).toMatchObject({ title: 'Daten nicht geladen', tone: 'error' });
    });
    expect(lastToast()?.action?.label).toBe('Erneut versuchen');

    // the labels answer again: "Erneut versuchen" loads them, and the command is there
    labels.failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(command('item.state')?.when?.()).toBe(true));
  });
});
