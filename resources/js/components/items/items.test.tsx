/*
 * The building blocks of items in lists and the detail: the key, the link that covers a card or row, and the hint of a
 * blocked item, against a fake REST API (`mockApi`).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRelationTypes } from '@/hooks/catalog';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItem } from '@/hooks/workItems';
import { mockApi, type MockApi } from '@/test/api';
import { agency, list, ops12, relationTypes, standard, types, web47, web47Relations } from '@/test/fixtures';
import type { RelationEntry } from '@/types';
import { BlockedHint } from './BlockedHint';
import { ItemKey } from './ItemKey';
import { ItemLink, linkFocusRing } from './ItemLink';

const visits = vi.hoisted(() => [] as string[]);

// Inertia's link: a click that the page has not prevented is a visit
vi.mock('@inertiajs/react', () => ({
  Link: ({ href, onClick, children, ...rest }: { href: string; onClick?: (event: MouseEvent) => void; children: ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        visits.push(href);
      }}
    >
      {children}
    </a>
  ),
}));

let api: MockApi | undefined;

afterEach(() => {
  api?.restore();
  api = undefined;
  visits.length = 0;
});

describe('ItemKey', () => {
  it('writes the key in tabular figures and never translates it', () => {
    render(<ItemKey value="WEB-47" className="text-muted" />);

    const key = screen.getByText('WEB-47');
    expect(key.getAttribute('translate')).toBe('no');
    expect(key.className).toContain('tabular-nums');
    expect(key.className).toContain('text-muted');
  });
});

describe('ItemLink', () => {
  it('leads to the page of the item over paths.item', () => {
    render(
      <ItemLink item={web47} tabIndex={-1} className="after:rounded-card">
        Kontaktformular sendet doppelt
      </ItemLink>,
    );

    const link = screen.getByRole('link', { name: 'Kontaktformular sendet doppelt' });
    expect(link.getAttribute('href')).toBe('/items/WEB-47');
    expect(link.getAttribute('tabindex')).toBe('-1');
    expect(link.hasAttribute('data-item-link')).toBe(true);
    expect(linkFocusRing).toContain('[data-item-link]');

    fireEvent.click(link);
    expect(visits).toEqual(['/items/WEB-47']);
  });

  it('opens the item the way the screen wants on a plain click, and leaves a click with a modifier to the browser', () => {
    const onOpen = vi.fn();
    render(
      <ItemLink item={web47} onOpen={onOpen}>
        WEB-47
      </ItemLink>,
    );
    const link = screen.getByRole('link', { name: 'WEB-47' });

    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith('wi_web_47');
    expect(visits).toEqual([]);

    // a new tab: the page's own address
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(visits).toEqual(['/items/WEB-47', '/items/WEB-47']);
  });
});

describe('BlockedHint', () => {
  const closed = { ...ops12, id: 'wi_ops_13', key: 'OPS-13', state_id: 'std_done' };
  /** OPS-12 (open) and an item WEB-47's reader may not see block it; OPS-13 did, but it is done. */
  const relations: RelationEntry[] = [
    ...web47Relations,
    { relation: { id: 'rel_hidden', type_id: 'rt_blocks', source_id: '', target_id: 'wi_web_47' }, other: null, direction: 'inward', hidden: true },
    { relation: { id: 'rel_done', type_id: 'rt_blocks', source_id: 'wi_ops_13', target_id: 'wi_web_47' }, other: closed, direction: 'inward', hidden: false },
  ];

  function renderHint(node: ReactNode, itemRelations: RelationEntry[] = relations) {
    api = mockApi({
      'GET /api/v1/work-items/wi_web_47': () => ({ body: { data: { ...web47, children: [], relations: itemRelations, type: types[1], workflow: standard } } }),
      'GET /api/v1/relation-types': () => ({ body: list(relationTypes) }),
      'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  }

  it('says nothing about an item that is not blocked, also when it blocks others', () => {
    renderHint(
      <>
        <BlockedHint item={ops12} />
        <BlockedHint item={{ ...web47, blocked: false }} variant="banner" />
      </>,
    );

    expect(document.body.textContent).toBe('');
    // nothing to show, nothing to load
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/work-items'))).toEqual([]);
  });

  it('marks a blocked row without loading its detail', () => {
    renderHint(<BlockedHint item={web47} className="ml-1" />);

    const chip = screen.getByText('Blockiert');
    expect(chip.className).toContain('ml-1');
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/work-items'))).toEqual([]);
  });

  it('names the open blockers on a card, a hidden one without its key', async () => {
    renderHint(<BlockedHint item={web47} variant="card" />);

    // until the detail is there, the card only says that it is blocked
    expect(screen.getByText('Blockiert')).toBeTruthy();
    expect(await screen.findByText('Blockiert von OPS-12, einem verborgenen Item')).toBeTruthy();
  });

  it('lists every open blocker in the banner, each a link, and opens it the way the screen wants', async () => {
    const onOpen = vi.fn();
    renderHint(<BlockedHint item={web47} variant="banner" onOpen={onOpen} />);

    const banner = await screen.findByText('Blockiert, solange OPS-12, einem verborgenen Item offen sind');
    const box = banner.closest('div')!.parentElement!;
    const link = within(box).getByRole('link', { name: /OPS-12/ });
    expect(link.getAttribute('href')).toBe('/items/OPS-12');
    expect(within(link).getByRole('img', { name: 'Status In Progress' })).toBeTruthy();
    expect(link.textContent).toContain('Mail-Limits am Server erhöhen');
    expect(within(box).getByText('verborgenes Item')).toBeTruthy();
    // the closed blocker counts no more
    expect(within(box).queryByText(/OPS-13/)).toBeNull();

    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith('wi_ops_12');
    fireEvent.click(link, { shiftKey: true });
    expect(visits).toEqual(['/items/OPS-12']);
  });

  it('says it once for one blocker, follows the link without onOpen, and stays short when every blocker is done', async () => {
    const { unmount } = renderHint(<BlockedHint item={web47} variant="banner" />, [web47Relations[0]!]);

    const link = await screen.findByRole('link', { name: /OPS-12/ });
    expect(screen.getByText('Blockiert, solange OPS-12 offen ist')).toBeTruthy();
    fireEvent.click(link);
    expect(visits).toEqual(['/items/OPS-12']);
    unmount();

    /** Shows once everything the hint reads has loaded. */
    function Loaded() {
      const loaded = [useWorkItem('wi_web_47').data, useRelationTypes().data, useWorkflows().data];
      return loaded.every(Boolean) ? <p>geladen</p> : null;
    }
    renderHint(
      <>
        <BlockedHint item={web47} variant="banner" />
        <BlockedHint item={web47} variant="card" />
        <Loaded />
      </>,
      [relations[3]!],
    );
    await screen.findByText('geladen');
    expect(screen.getAllByText('Blockiert')).toHaveLength(2);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
