/*
 * The building blocks of items in lists and the detail: the key, the link that covers a card or row, the hint of a
 * blocked item, the list row and the index card, against a fake REST API (`mockApi`).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRelationTypes } from '@/hooks/catalog';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItem } from '@/hooks/workItems';
import { mockApi, type MockApi } from '@/test/api';
import {
  agency,
  ida,
  labels,
  lene,
  list,
  makeWorkItem,
  mara,
  ops12,
  organization,
  project,
  properties,
  relationTypes,
  resolutions,
  standard,
  types,
  web30,
  web47,
  web47Relations,
  web48,
} from '@/test/fixtures';
import type { Organization, Property, RelationEntry } from '@/types';
import { BlockedHint } from './BlockedHint';
import { ItemCard } from './ItemCard';
import { ItemKey } from './ItemKey';
import { ItemLink, linkFocusRing } from './ItemLink';
import { ItemRowBase, ROW_FIELDS } from './ItemRowBase';

const visits = vi.hoisted(() => [] as string[]);
const page = vi.hoisted(() => ({ organization: null as Organization | null }));

// Inertia's link: a click that the page has not prevented is a visit
vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization: page.organization }, url: '/projects/WEB' }),
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
  page.organization = organization;
  vi.useRealTimers();
});
page.organization = organization;

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

/* ------------------------------------------------------------------- rows and cards */

describe('rows and cards', () => {
  const web = project('WEB', 'member');
  const approved: Property = { id: 'pr_approved', key: 'approved', label: 'Freigegeben', field_type: 'boolean', help: '', default_value: null, settings: {}, options: [] };
  const reviewers: Property = { id: 'pr_reviewers', key: 'reviewers', label: 'Prüfung', field_type: 'member', help: '', default_value: null, settings: { multiple: true }, options: [] };
  const catalog = [...properties, approved, reviewers];

  function renderItems(node: ReactNode) {
    api = mockApi({
      'GET /api/v1/organization': () => ({ body: { data: page.organization } }),
      'GET /api/v1/projects': () => ({ body: list([web]) }),
      'GET /api/v1/projects/p_web/members': () => ({ body: list([{ project_id: 'p_web', user_id: 'u_ida', role: 'admin' }]) }),
      'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
      'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
      'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
      'GET /api/v1/labels': () => ({ body: list(labels) }),
      'GET /api/v1/work-item-types': () => ({ body: list(types) }),
      'GET /api/v1/properties': () => ({ body: list(catalog) }),
      'GET /api/v1/relation-types': () => ({ body: list(relationTypes) }),
      'GET /api/v1/work-items/wi_web_47': () => ({ body: { data: { ...web47, children: [], relations: web47Relations, type: types[1], workflow: standard } } }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  }

  /** The elements Tab reaches inside a container. */
  const tabStops = (root: Element) =>
    [...root.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex]')].filter((element) => element.tabIndex >= 0 && !element.hasAttribute('disabled'));

  it('names every field a row knows', () => {
    expect(Object.keys(ROW_FIELDS)).toEqual(['key', 'state', 'assignee', 'priority', 'labels', 'start_date', 'due_date', 'project', 'created_at', 'updated_at']);
  });

  it('shows the fields of the display as chips and keeps them out of the tab order', async () => {
    const item = { ...web47, values: { ...web47.values, approved: false, reviewers: ['u_ida', 'u_gone'] } };
    const fields = ['key', 'title', 'state', 'priority', 'labels', 'start_date', 'due_date', 'project', 'assignee', 'property:customer', 'property:effort', 'property:approved', 'property:reviewers', 'property:gone', 'bogus'];
    const { container } = renderItems(<ItemRowBase item={item} depth={0} fields={fields} onOpen={vi.fn()} />);
    const row = container.firstElementChild!;

    // the pickers turn from read-only into comboboxes once the rights are there
    await waitFor(() => expect(within(row as HTMLElement).getAllByRole('combobox')).toHaveLength(4));
    await within(row as HTMLElement).findByText('Studio Nordlicht');
    expect(row.textContent).toContain('Kunde: Studio Nordlicht');
    expect(row.textContent).toContain('Aufwand (h)3,5');
    // people by name, an account the reader does not know as unknown
    await waitFor(() => expect(row.textContent).toContain('PrüfungIda Brenner, Unbekannt'));
    expect(row.textContent).toContain('WEB');
    expect(row.textContent).toContain('Blockiert');
    // a yes/no field that is off reads like no value (A89); unknown fields show nothing
    expect(row.textContent).not.toContain('Freigegeben');
    // the key leads the link's name
    expect(screen.getByRole('link').textContent).toBe('WEB-47 Bug: Kontaktformular sendet doppelt');

    // one tab stop: the title; every chip is reached with the item shortcuts
    expect(tabStops(row)).toEqual([screen.getByRole('link')]);
    const controls = [...within(row as HTMLElement).getAllByRole('combobox'), ...within(row as HTMLElement).getAllByRole('button')];
    expect(controls.map((control) => control.getAttribute('aria-label') ?? control.textContent).join(' | ')).toMatch(/Start-Date.*Due-Date/);
    for (const control of controls) expect(control.tabIndex).toBe(-1);
  });

  it('makes the row the element of the cursor in a list with one, opens the page with Enter and the preview with a click', async () => {
    const onOpen = vi.fn();
    const onPeek = vi.fn();
    const child = { ...web48, children_progress: { done: 1, total: 3 }, archived_at: '2026-10-30T10:00:00.000Z' };
    renderItems(
      <>
        <ItemRowBase item={web47} depth={0} fields={[]} cursor selected onOpen={onOpen} onPeek={onPeek} lead={<span>Wahl</span>} />
        <ItemRowBase item={child} depth={1} fields={['key']} cursor={false} onOpen={onOpen} onPeek={onPeek} />
      </>,
    );

    const row = screen.getByRole('group', { name: 'WEB-47 Kontaktformular sendet doppelt, ausgewählt' });
    expect(row.tabIndex).toBe(0);
    expect(row.hasAttribute('data-nav-target')).toBe(true);
    expect(row.getAttribute('data-selected')).toBe('true');
    const other = screen.getByRole('group', { name: 'WEB-48 Startseite umbauen' });
    expect(other.tabIndex).toBe(-1);
    expect(other.style.marginLeft).toBe('1.75rem');
    expect(other.textContent).toContain('Kind-Items fertig: 1/3');
    expect(other.textContent).toContain('Archiviert');
    // the link leaves the tab order: the row is the stop
    expect(within(row).getByRole('link').tabIndex).toBe(-1);

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('wi_web_47');
    // Enter on a control inside the row is the control's
    fireEvent.keyDown(within(row).getByText('Wahl'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(within(other).getByRole('link'));
    expect(onPeek).toHaveBeenCalledWith('wi_web_48');
    expect(visits).toEqual([]);
  });

  it('a child card names its epic before its key, with key and title in its tooltip and in the name of the card', async () => {
    renderItems(<ItemCard item={web48} showParent onOpen={vi.fn()} />);

    const card = screen.getByRole('article', { name: 'WEB-48 Startseite umbauen, Teil von WEB-30 Relaunch Phase 1' });
    const crumb = card.querySelector('[data-parent-crumb]')!;
    expect(crumb.getAttribute('title')).toBe('WEB-30 Relaunch Phase 1');
    expect(crumb.textContent).toBe('Relaunch Phase 1');
    // before the tab with the key, in the same row
    const tabRow = card.querySelector('[data-tab-row]')!;
    expect(tabRow.firstElementChild).toBe(crumb);
    expect(tabRow.textContent).toContain('WEB-48');
  });

  it('adds the parts the caller names to the name of the card, before the selection', () => {
    renderItems(<ItemCard item={web30} selected nameParts={['ohne Datum', '1 von 2 erledigt']} onOpen={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'WEB-30 Relaunch Phase 1, ohne Datum, 1 von 2 erledigt, ausgewählt' })).toBeTruthy();
  });

  it('an epic and an item without a parent name none', () => {
    // a parent that does not match parent_id (an outdated answer) is no epic either
    const stale = { ...web48, id: 'wi_web_49', key: 'WEB-49', parent_id: 'wi_web_31' };
    renderItems(
      <>
        <ItemCard item={web30} showParent onOpen={vi.fn()} />
        <ItemCard item={web47} showParent onOpen={vi.fn()} />
        <ItemCard item={stale} showParent onOpen={vi.fn()} />
        <ItemCard item={web48} onOpen={vi.fn()} />
      </>,
    );

    expect(screen.getByRole('article', { name: 'WEB-30 Relaunch Phase 1' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'WEB-47 Kontaktformular sendet doppelt' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'WEB-49 Startseite umbauen' })).toBeTruthy();
    // without showParent (a board grouped by parent) the child names none
    expect(screen.getByRole('article', { name: 'WEB-48 Startseite umbauen' })).toBeTruthy();
    expect(document.querySelector('[data-parent-crumb]')).toBeNull();
  });

  it('shows labels, progress, priority and assignee of the display on a card, and opens it from the tab and the keyboard', async () => {
    const onOpen = vi.fn();
    const onPeek = vi.fn();
    renderItems(
      <>
        <ItemCard item={web47} cursor selected onOpen={onOpen} onPeek={onPeek} />
        <ItemCard item={web30} fields={['priority']} cursor={false} onOpen={onOpen} />
      </>,
    );

    const card = screen.getByRole('article', { name: 'WEB-47 Kontaktformular sendet doppelt, ausgewählt' });
    expect(card.tabIndex).toBe(0);
    expect(card.hasAttribute('data-nav-target')).toBe(true);
    expect(within(card).getByRole('img', { name: 'Priorität: Urgent' })).toBeTruthy();
    expect(within(await within(card).findByRole('list', { name: 'Labels' })).getAllByRole('listitem').map((entry) => entry.textContent)).toEqual(['Formulare', 'Produktion']);
    expect(await within(card).findByText('Blockiert von OPS-12')).toBeTruthy();
    expect(await within(card).findByText('IB')).toBeTruthy();
    // none of it is a tab stop beside the card
    expect(tabStops(card)).toEqual([]);

    const epic = screen.getByRole('article', { name: 'WEB-30 Relaunch Phase 1' });
    expect(epic.tabIndex).toBe(-1);
    expect(within(epic).getByRole('progressbar', { name: 'Kind-Items' })).toBeTruthy();
    // only the fields of the display: no due date, no assignee
    expect(epic.textContent).not.toContain('15.11.');
    expect(within(epic).queryByText('IB')).toBeNull();

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('wi_web_47');
    // the tab lies outside the title's link: a click there opens the card as the title does
    fireEvent.click(card.querySelector('[data-tab-row]')!);
    fireEvent.click(within(card).getByRole('link'));
    expect(onPeek).toHaveBeenCalledTimes(2);
    // without a preview the tab opens the page; a modifier click belongs to the browser
    fireEvent.click(epic.querySelector('[data-tab-row]')!);
    fireEvent.click(epic.querySelector('[data-tab-row]')!, { metaKey: true });
    expect(onOpen).toHaveBeenLastCalledWith('wi_web_30');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps a compact card to one line with its counts', () => {
    const archived = { ...web47, archived_at: '2026-10-30T10:00:00.000Z', children_progress: { done: 2, total: 5 } };
    renderItems(<ItemCard item={archived} compact onOpen={vi.fn()} />);

    const card = screen.getByRole('article', { name: 'WEB-47 Kontaktformular sendet doppelt' });
    expect(card.textContent).toContain('Kind-Items fertig: 2/5');
    expect(card.textContent).toContain('Blockiert');
    expect(card.textContent).toContain('Archiviert');
    expect(within(card).queryByRole('list')).toBeNull();
    expect(within(card).queryByRole('progressbar')).toBeNull();
  });

  it('shows dates in the zone of the organisation', async () => {
    // 23:30 UTC on the 27th is the 28th in Berlin and still the 27th in New York
    const late = makeWorkItem({ id: 'wi_web_9', key: 'WEB-9', created_at: '2026-10-27T23:30:00.000Z', updated_at: '2026-10-29T04:30:00.000Z' });
    const { unmount } = renderItems(<ItemRowBase item={late} depth={0} fields={['created_at', 'updated_at']} onOpen={vi.fn()} />);
    expect(document.body.textContent).toContain('erstellt28.10.');
    expect(document.body.textContent).toContain('geändert29.10.');
    unmount();

    page.organization = { ...organization, timezone: 'America/New_York' };
    renderItems(<ItemRowBase item={late} depth={0} fields={['created_at', 'updated_at']} onOpen={vi.fn()} />);
    expect(document.body.textContent).toContain('erstellt27.10.');
    expect(document.body.textContent).toContain('geändert29.10.');
  });

  it('marks overdue due dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 in Berlin on 31 October: the due day has not passed yet
    vi.setSystemTime(new Date('2026-10-31T22:30:00.000Z'));
    const first = renderItems(<ItemCard item={web47} onOpen={vi.fn()} />);
    await screen.findByText('31.10.');
    expect(screen.queryByText('überfällig')).toBeNull();
    first.unmount();

    // 00:30 in Berlin on 1 November: the 31st is gone there, while UTC still reads the 31st
    vi.setSystemTime(new Date('2026-10-31T23:30:00.000Z'));
    const done = { ...web47, id: 'wi_web_46', key: 'WEB-46', title: 'Erledigt', state_id: 'std_done' };
    renderItems(
      <>
        <ItemCard item={web47} onOpen={vi.fn()} />
        <ItemCard item={done} onOpen={vi.fn()} />
        <ItemRowBase item={web47} depth={0} fields={['due_date']} onOpen={vi.fn()} />
      </>,
    );

    const open = screen.getByRole('article', { name: 'WEB-47 Kontaktformular sendet doppelt' });
    await waitFor(() => expect(within(open).getByText('überfällig')).toBeTruthy());
    expect(open.textContent).toContain('Fällig am31.10.');
    // a closed item is never overdue
    const closed = screen.getByRole('article', { name: 'WEB-46 Erledigt' });
    expect(closed.textContent).toContain('31.10.');
    expect(within(closed).queryByText('überfällig')).toBeNull();
    // the row's chip says it too
    await waitFor(() => expect(screen.getAllByText('überfällig')).toHaveLength(2));
  });
});
