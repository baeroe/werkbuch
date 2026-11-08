/*
 * The sections of the item detail against a fake REST API (`mockApi`): the description with its autosave, the version
 * it is based on, the conflict banner and the retry of a failed save; the children of an epic with their progress and
 * "Kind-Item"; the relations grouped by type and direction, a hidden end, adding with r and removing with undo.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { plainText, textDoc } from '@/lib/richtext';
import { qk } from '@/hooks/keys';
import { resetForUser } from '@/hooks/queryClient';
import { descriptionDraft, drafts } from '@/lib/drafts';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, relationTypes, resolutions, searchResults, standard, types, web30, web47, web48 } from '@/test/fixtures';
import type { Project, ProjectMember, RelationEntry, RichText, User, WorkItem } from '@/types';
import { DESCRIPTION_PAUSE_MS } from './Description';
import { ItemPage } from './ItemPage';
import { ItemPeek } from './ItemPeek';
import { SEARCH_PAUSE_MS } from './Relations';

const signedIn: User = lene;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: '/items/WEB-47' }),
  router: { visit: vi.fn(), replace: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

/* -------------------------------------------------------------------------- data */

const doc = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const member = (user_id: string, role: ProjectMember['role'] = 'member'): ProjectMember => ({ project_id: 'p_web', user_id, role });

/** WEB-50: a task with no relations yet. */
const web50 = makeWorkItem({ id: 'wi_web_50', number: 50, key: 'WEB-50', title: 'Impressum aktualisieren', rank: 'a6' });
/** OPS-12, in a project the fake API does not list: its line shows without a status. */
const ops12 = makeWorkItem({ id: 'wi_ops_12', project_id: 'p_ops', number: 12, key: 'OPS-12', title: 'Mail-Limits am Server erhöhen', state_id: 'std_progress' });

const relation = (id: string, type_id: string, direction: RelationEntry['direction'], other: WorkItem | null, self = 'wi_web_47'): RelationEntry => ({
  relation: {
    id,
    type_id,
    source_id: direction === 'outward' ? self : (other?.id ?? ''),
    target_id: direction === 'outward' ? (other?.id ?? '') : self,
  },
  other,
  direction,
  hidden: other === null,
});

let items: WorkItem[] = [];
/** Former keys the fake search knows, lowercase: `ALT-48` named WEB-48 before its project changed its identifier. */
let formerKeys: Record<string, string> = {};
let relations: Record<string, RelationEntry[]> = {};
let projects: Project[] = [];

const detail = (item: WorkItem) => ({
  body: {
    data: {
      ...item,
      children: items.filter((entry) => entry.parent_id === item.id),
      relations: relations[item.id] ?? [],
      type: types.find((type) => type.id === item.type_id),
      workflow: standard,
      attachments: [],
    },
  },
});
/**
 * What `GET /api/v1/search?types=items` answers from `pool` (`QuerySearch`): a key, also a former one, names its item in
 * `key_match` and puts it first; otherwise every word is a part of the title.
 */
function searchItems(pool: WorkItem[], url: URL) {
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const match = pool.find((item) => item.key.toLowerCase() === q || formerKeys[q] === item.id);
  const hits = pool.filter((item) => item.id !== match?.id && q.split(/\s+/).every((word) => item.title.toLowerCase().includes(word)));
  return { body: { data: searchResults({ items: match ? [match, ...hits] : hits, key_match: match?.id ?? null }) } };
}
const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({
  status,
  body: { type: 'about:blank', title: reason, status, reason, detail: 'Nein.', ...extra },
});

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Holds the answers to `GET /api/v1/projects` (the rights) back until `release()`. */
function holdRights() {
  const original = globalThis.fetch;
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async (input, init) => {
    if ((init?.method ?? 'GET') === 'GET' && new URL(String(input), 'https://werkbuch.test').pathname === '/api/v1/projects') await gate;
    return original(input, init);
  };
  return { release: () => act(async () => release()), restore: () => (globalThis.fetch = original) };
}

function renderWith(
  node: ReactNode,
  { routes = {}, role = 'member', client }: { routes?: Record<string, MockRoute>; role?: Project['my_role']; client?: QueryClient } = {},
) {
  const current = (id: string) => items.find((entry) => entry.id === id)!;
  if (projects.length === 0) projects = [project('WEB', role, { name: 'Website-Relaunch' })];
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list([member('u_ida', 'admin'), member('u_lene')]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/relation-types': () => ({ body: list(relationTypes) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/search': (_body, url) => searchItems([...items, ops12], url),
    ...Object.fromEntries(items.flatMap((item) => [`GET /api/v1/work-items/${item.id}`, `GET /api/v1/work-items/${item.key}`].map((path) => [path, () => detail(current(item.id))]))),
    ...Object.fromEntries(
      items.map((item) => [
        `PATCH /api/v1/work-items/${item.id}`,
        (body: unknown) => {
          const { description_json, base_description_version: _base, ...rest } = body as { description_json?: RichText | null; base_description_version?: number };
          const before = current(item.id);
          const next = {
            ...before,
            ...rest,
            ...(description_json !== undefined ? { description_json, description_version: before.description_version + 1 } : {}),
          } as WorkItem;
          items = items.map((entry) => (entry.id === item.id ? next : entry));
          return { body: { data: next } };
        },
      ]),
    ),
    // the activity reads an empty history: no error state with its own "Erneut versuchen" and alert in these screens
    ...Object.fromEntries(items.flatMap((item) => [item.id, item.key].map((ref) => [`GET /api/v1/work-items/${ref}/history`, () => ({ body: list([]) })]))),
    ...routes,
  });
  const queries = client ?? newClient();
  return render(<QueryClientProvider client={queries}>{node}</QueryClientProvider>);
}

const sent = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.split('?')[0] === path).map((call) => call.body);
const lastToast = () => currentToasts().at(-1);
const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.body) =>
  act(() => {
    on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
/** Adds text where the editor's caret is (jsdom mixes typed keys up behind existing text). */
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });

/** Lets the next PATCH wait until `release()`: a save stays on its way while something else happens. */
function holdNextPatch() {
  const original = globalThis.fetch;
  let release = () => {};
  let held = false;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'PATCH' && !held) {
      held = true;
      await new Promise<void>((resolve) => (release = resolve));
    }
    return original(input, init);
  };
  return { release: () => release(), held: () => held };
}

/** The description's editor, once the rights have loaded and it can be typed in. */
async function descriptionEditor() {
  const section = await screen.findByRole('region', { name: 'Beschreibung' });
  return { section, editor: await within(section).findByRole('textbox', { name: 'Beschreibung' }) };
}

/** What the PATCH calls of WEB-47 sent as description, as text, with the version each was based on. */
const descriptionSaves = () =>
  sent('PATCH', '/api/v1/work-items/wi_web_47').map((body) => {
    const { description_json, base_description_version } = body as { description_json: RichText | null; base_description_version: number };
    return [plainText(description_json), base_description_version];
  });

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
  items = [web30, web47, web48, web50];
  formerKeys = {};
  relations = {};
  projects = [];
});

afterEach(() => {
  api?.restore();
  api = undefined;
  act(() => resetToasts());
});

/* ------------------------------------------------------------------- description */

describe('Description', () => {
  it('saves after a pause with the version it is based on', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />);
    const { section, editor } = await descriptionEditor();
    // a live region speaks only about changes it was there for
    const status = within(section).getByRole('status');
    expect(status.textContent).toBe('');
    expect(editor.textContent).toBe('Beim Absenden kommt die Mail zweimal an.');

    paste(editor, 'Nur im Chrome. ');
    // typed text the server does not have yet: leaving the page asks first
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([]);

    await waitFor(() => expect(status.textContent).toBe('Gespeichert'), { timeout: DESCRIPTION_PAUSE_MS + 2000 });
    expect(descriptionSaves()).toEqual([['Nur im Chrome. Beim Absenden kommt die Mail zweimal an.', 3]]);
    expect(within(section).getByRole('status')).toBe(status);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);

    // ⌘↵ saves at once, based on the version the first save made
    paste(editor, 'Und Safari. ');
    await waitFor(() => expect(status.textContent).toBe(''));
    press('Enter', { ctrlKey: true }, editor);
    await waitFor(() => expect(descriptionSaves()).toHaveLength(2));
    expect(descriptionSaves()[1]).toEqual(['Nur im Chrome. Und Safari. Beim Absenden kommt die Mail zweimal an.', 4]);
    await waitFor(() => expect(status.textContent).toBe('Gespeichert'));

    // leaving the editor without typing saves nothing
    fireEvent.blur(editor);
    press('Enter', { ctrlKey: true }, editor);
    expect(descriptionSaves()).toHaveLength(2);
  });

  it('shows the conflict banner and takes my version over', async () => {
    const user = userEvent.setup();
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    let conflicts = 1;
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': (body) => {
          if (conflicts-- > 0) {
            return problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs });
          }
          const { description_json } = body as { description_json: RichText };
          return { body: { data: { ...theirs, description_json, description_version: 5 } } };
        },
      },
    });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    press('Enter', { ctrlKey: true }, editor);

    const banner = await within(section).findByRole('alert');
    expect(banner.textContent).toContain('Ida Brenner hat die Beschreibung inzwischen geändert.');
    // no toast: the banner says it
    expect(currentToasts()).toEqual([]);
    // this window's text stays; typing on below the banner saves nothing until it is decided
    expect(editor.textContent).toBe('Meine Fassung. Beim Absenden kommt die Mail zweimal an.');
    paste(editor, 'Noch mehr. ');
    press('Enter', { ctrlKey: true }, editor);
    expect(descriptionSaves()).toHaveLength(1);

    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(() => expect(descriptionSaves()).toHaveLength(2));
    // the second save is based on the version the conflict named
    expect(descriptionSaves()[1]).toEqual(['Meine Fassung. Noch mehr. Beim Absenden kommt die Mail zweimal an.', 4]);
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull());
    // the button went with the banner: the focus is back in the editor
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Gespeichert'));
  });

  it('reloads the other version', async () => {
    const user = userEvent.setup();
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': () =>
          problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs }),
      },
    });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    press('Enter', { ctrlKey: true }, editor);
    const banner = await within(section).findByRole('alert');

    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
    expect(within(section).queryByRole('alert')).toBeNull();
    await waitFor(() => expect(editor.textContent).toBe('Ida hat das schon geklärt.'));
    await waitFor(() => expect(document.activeElement).toBe(editor));
    // my draft is gone: nothing left to save, and nothing asks before leaving
    fireEvent.blur(editor);
    expect(descriptionSaves()).toHaveLength(1);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });

  it('keeps the own version of an open conflict when the item closes, and offers it again', async () => {
    const user = userEvent.setup();
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    let refuse = true;
    const routes: Record<string, MockRoute> = {
      'PATCH /api/v1/work-items/wi_web_47': (body) => {
        if (refuse) return problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs });
        items = items.map((entry) => (entry.id === web47.id ? { ...theirs, description_json: (body as { description_json: RichText }).description_json, description_version: 5 } : entry));
        return { body: { data: items.find((entry) => entry.id === web47.id) } };
      },
    };
    const first = renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const { editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    press('Enter', { ctrlKey: true }, editor);
    await screen.findByRole('alert');
    // written on below the banner, then the preview closes; the server holds the other version by now
    paste(editor, 'Ergänzt. ');
    first.unmount();
    api!.restore();
    items = items.map((entry) => (entry.id === web47.id ? theirs : entry));

    refuse = false;
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const again = await descriptionEditor();
    const banner = await within(again.section).findByRole('alert');
    expect(banner.textContent).toContain('Ida Brenner hat die Beschreibung inzwischen geändert.');
    expect(again.editor.textContent).toBe('Meine Fassung. Ergänzt. Beim Absenden kommt die Mail zweimal an.');

    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(() => expect(descriptionSaves()).toEqual([['Meine Fassung. Ergänzt. Beim Absenden kommt die Mail zweimal an.', 4]]));
    await waitFor(() => expect(within(again.section).queryByRole('alert')).toBeNull());
  });

  it('keeps what was typed while saving', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />);
    const { section, editor } = await descriptionEditor();
    const gate = holdNextPatch();
    paste(editor, 'Erstens. ');
    press('Enter', { ctrlKey: true }, editor);
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(within(section).getByRole('status').textContent).toBe('Speichert …');

    // typed on while the first save is on its way; the second waits for it
    paste(editor, 'Zweitens. ');
    press('Enter', { ctrlKey: true }, editor);
    gate.release();

    // the next save takes the newest draft, based on the version the first one made
    await waitFor(() => expect(descriptionSaves()).toHaveLength(2), { timeout: DESCRIPTION_PAUSE_MS + 2000 });
    expect(descriptionSaves()).toEqual([
      ['Erstens. Beim Absenden kommt die Mail zweimal an.', 3],
      ['Erstens. Zweitens. Beim Absenden kommt die Mail zweimal an.', 4],
    ]);
    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Gespeichert'));
    expect(editor.textContent).toBe('Erstens. Zweitens. Beim Absenden kommt die Mail zweimal an.');
  });

  /**
   * PATCH of WEB-47 as the server answers it: a save based on another version than the stored one meets Erik's
   * (409 `description_conflict`), as `UpdateWorkItem` does.
   */
  const guardedPatch: MockRoute = (body) => {
    const { description_json, base_description_version } = body as { description_json: RichText | null; base_description_version: number };
    const before = items.find((entry) => entry.id === web47.id)!;
    if (base_description_version !== before.description_version) {
      return problem(409, 'description_conflict', { detail: 'Erik Ende hat die Beschreibung inzwischen geändert.', current: before });
    }
    const next = { ...before, description_json, description_version: before.description_version + 1 };
    items = items.map((entry) => (entry.id === web47.id ? next : entry));
    return { body: { data: next } };
  };
  /** Erik saves his version on the server; the window hears of it later (live: its queries load again). */
  const erikSaves = () => {
    const erik = { ...web47, description_json: doc('Von Erik. Beim Absenden kommt die Mail zweimal an.'), description_version: 4 };
    items = items.map((entry) => (entry.id === web47.id ? erik : entry));
  };

  it('keeps the text and the version of a draft when a newer description comes in while it is typed (live)', async () => {
    const client = newClient();
    renderWith(<ItemPage itemKey="WEB-47" />, { client, routes: { 'PATCH /api/v1/work-items/wi_web_47': guardedPatch } });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Von Mara. ');

    // Erik saved meanwhile; live loads the item again while Mara's text is unsaved
    erikSaves();
    const loads = sent('GET', '/api/v1/work-items/WEB-47').length;
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    await waitFor(() => expect(sent('GET', '/api/v1/work-items/WEB-47').length).toBeGreaterThan(loads));
    expect(editor.textContent).toBe('Von Mara. Beim Absenden kommt die Mail zweimal an.');

    // her save is based on the version she typed on: it meets Erik's, nothing of his is overwritten
    press('Enter', { ctrlKey: true }, editor);
    const banner = await within(section).findByRole('alert');
    expect(banner.textContent).toContain('Erik Ende hat die Beschreibung inzwischen geändert.');
    expect(descriptionSaves()).toEqual([['Von Mara. Beim Absenden kommt die Mail zweimal an.', 3]]);
    expect(plainText(items.find((entry) => entry.id === web47.id)!.description_json)).toBe('Von Erik. Beim Absenden kommt die Mail zweimal an.');
    expect(editor.textContent).toBe('Von Mara. Beim Absenden kommt die Mail zweimal an.');
  });

  it('shows a newer description from outside while nothing is typed, and saves on its version', async () => {
    const client = newClient();
    renderWith(<ItemPage itemKey="WEB-47" />, { client, routes: { 'PATCH /api/v1/work-items/wi_web_47': guardedPatch } });
    const { section, editor } = await descriptionEditor();

    erikSaves();
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    await waitFor(() => expect(editor.textContent).toBe('Von Erik. Beim Absenden kommt die Mail zweimal an.'));

    // typed on what the window shows: saved on Erik's version, without a conflict
    paste(editor, 'Von Mara. ');
    press('Enter', { ctrlKey: true }, editor);
    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Gespeichert'));
    expect(descriptionSaves()).toEqual([[plainText(items.find((entry) => entry.id === web47.id)!.description_json), 4]]);
    expect(editor.textContent).toContain('Von Erik.');
    expect(editor.textContent).toContain('Von Mara.');
    expect(within(section).queryByRole('alert')).toBeNull();
  });

  it('keeps the draft after a failed save and retries', async () => {
    let down = true;
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': (body) => {
          if (down) return problem(503, 'service_unavailable');
          const { description_json } = body as { description_json: RichText };
          const next = { ...items.find((entry) => entry.id === web47.id)!, description_json, description_version: items.find((entry) => entry.id === web47.id)!.description_version + 1 };
          items = items.map((entry) => (entry.id === web47.id ? next : entry));
          return { body: { data: next } };
        },
      },
    });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Erstens. ');
    press('Enter', { ctrlKey: true }, editor);

    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Nicht gespeichert'));
    const failed = await waitFor(() => {
      const toast = lastToast();
      expect(toast).toMatchObject({ title: 'Änderung nicht gespeichert', tone: 'error', action: { label: 'Erneut versuchen' } });
      return toast!;
    });
    // the item rolled back and loaded again: the draft stays all the same
    await waitFor(() => expect(sent('GET', '/api/v1/work-items/wi_web_47').length + sent('GET', '/api/v1/work-items/WEB-47').length).toBeGreaterThan(1));
    expect(editor.textContent).toBe('Erstens. Beim Absenden kommt die Mail zweimal an.');

    // "Erneut versuchen" sends it again; once it went through, the draft is saved and based on its version
    down = false;
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Gespeichert'));
    expect(descriptionSaves()).toEqual([
      ['Erstens. Beim Absenden kommt die Mail zweimal an.', 3],
      ['Erstens. Beim Absenden kommt die Mail zweimal an.', 3],
    ]);
    paste(editor, 'Zweitens. ');
    press('Enter', { ctrlKey: true }, editor);
    await waitFor(() => expect(descriptionSaves()).toHaveLength(3));
    expect(descriptionSaves()[2]).toEqual(['Erstens. Zweitens. Beim Absenden kommt die Mail zweimal an.', 4]);
  });

  it('forgets an open conflict once the retry of "Meine Fassung übernehmen" went through', async () => {
    const user = userEvent.setup();
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    let answers = ['conflict', 'down'];
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': (body) => {
          const next = answers.shift();
          if (next === 'conflict') return problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs });
          if (next === 'down') return problem(503, 'service_unavailable');
          return { body: { data: { ...theirs, description_json: (body as { description_json: RichText }).description_json, description_version: 5 } } };
        },
      },
    });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    press('Enter', { ctrlKey: true }, editor);
    const banner = await within(section).findByRole('alert');

    // keep mine meets a 503; its retry from the toast goes through: nothing is open anymore, leaving asks nothing
    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    const failed = await waitFor(() => {
      expect(lastToast()?.action?.label).toBe('Erneut versuchen');
      return lastToast()!;
    });
    answers = [];
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Gespeichert'));
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });

  it('saves what was typed during the last save of a view that is gone at once, and asks before leaving until then', async () => {
    const view = renderWith(<ItemPeek itemId="wi_web_47" />);
    const { editor } = await descriptionEditor();
    const gate = holdNextPatch();
    paste(editor, 'Erstens. ');
    press('Enter', { ctrlKey: true }, editor);
    await waitFor(() => expect(gate.held()).toBe(true));
    // typed on while the save is on its way, then the preview closes
    paste(editor, 'Zweitens. ');
    view.unmount();
    gate.release();

    // the rest goes at once, not after the pause: the guard never drops in between
    await waitFor(() => expect(descriptionSaves()).toHaveLength(2), { timeout: DESCRIPTION_PAUSE_MS / 2 });
    expect(descriptionSaves()[1]).toEqual(['Erstens. Zweitens. Beim Absenden kommt die Mail zweimal an.', 4]);
    await waitFor(() => {
      const after = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);
    });
  });

  it('shows no banner for a kept text while the rights load (T18-M2)', async () => {
    drafts.set(descriptionDraft('wi_web_47'), textDoc('Behalten.'));
    const rights = holdRights();
    renderWith(<ItemPage itemKey="WEB-47" />);
    try {
      const section = await screen.findByRole('region', { name: 'Beschreibung' });
      // nothing to discard by accident while the rights are on their way
      expect(within(section).queryByRole('alert')).toBeNull();
      await rights.release();

      // the rights are there: the kept text is in the editor, still unsaved
      const editor = await within(section).findByRole('textbox', { name: 'Beschreibung' });
      expect(editor.textContent).toBe('Behalten.');
      expect(within(section).queryByRole('alert')).toBeNull();
    } finally {
      rights.restore();
    }
  });

  it('keeps the typed text to copy when the item is archived meanwhile, and sends it no more', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': () => {
          // someone archived the item in between
          items = items.map((entry) => (entry.id === web47.id ? { ...entry, state_id: 'std_done', archived_at: '2026-11-01T09:00:00Z' } : entry));
          return problem(409, 'archived', { detail: 'WEB-47 ist archiviert und schreibgeschützt.' });
        },
      },
    });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Nicht verlieren. ');
    press('Enter', { ctrlKey: true }, editor);

    // the editor gives way to the stored text; the typed one stays above it, read-only, with copy and discard
    const parked = await within(section).findByRole('alert');
    expect(parked.textContent).toContain('Dein Text ist nicht gespeichert');
    expect(parked.textContent).toContain('WEB-47 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.');
    expect(parked.textContent).toContain('Nicht verlieren. Beim Absenden kommt die Mail zweimal an.');
    expect(within(section).queryByRole('textbox')).toBeNull();
    // the browser refuses the clipboard: copying selects the text instead
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(within(parked).getByRole('button', { name: 'Kopieren' }));
    expect(window.getSelection()?.toString()).toContain('Nicht verlieren.');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    // leaving the field sends nothing more: the server would refuse it
    fireEvent.blur(parked);
    expect(descriptionSaves()).toHaveLength(1);

    await user.click(within(parked).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(within(section).queryByRole('alert')).toBeNull());
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('saves what was typed after a failed save once its retry went through', async () => {
    let down = true;
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': (body) => {
          if (down) return problem(503, 'service_unavailable');
          const before = items.find((entry) => entry.id === web47.id)!;
          const next = { ...before, description_json: (body as { description_json: RichText }).description_json, description_version: before.description_version + 1 };
          items = items.map((entry) => (entry.id === web47.id ? next : entry));
          return { body: { data: next } };
        },
      },
    });
    const { editor } = await descriptionEditor();
    paste(editor, 'Erstens. ');
    press('Enter', { ctrlKey: true }, editor);
    const failed = await waitFor(() => {
      expect(lastToast()?.action?.label).toBe('Erneut versuchen');
      return lastToast()!;
    });

    // typed on, then the retry of the older text goes through: the newer one is saved on top of it
    paste(editor, 'Zweitens. ');
    down = false;
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(descriptionSaves()).toHaveLength(3), { timeout: DESCRIPTION_PAUSE_MS + 2000 });
    expect(descriptionSaves()[2]).toEqual(['Erstens. Zweitens. Beim Absenden kommt die Mail zweimal an.', 4]);
  });

  it('saves what was typed when the view goes away, and asks before leaving the page meanwhile', async () => {
    const view = renderWith(<ItemPeek itemId="wi_web_47" />);
    const { editor } = await descriptionEditor();
    const gate = holdNextPatch();
    paste(editor, 'Kurz vor dem Schließen. ');
    // the preview closes before the pause is over: the save runs all the same
    view.unmount();
    await waitFor(() => expect(gate.held()).toBe(true));
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    gate.release();
    await waitFor(() => expect(descriptionSaves()).toEqual([['Kurz vor dem Schließen. Beim Absenden kommt die Mail zweimal an.', 3]]));
    await waitFor(() => {
      const after = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);
    });
    expect(currentToasts()).toEqual([]);
  });

  it('brings back text a closed view could not save after a 500', async () => {
    let down = true;
    const routes: Record<string, MockRoute> = {
      'PATCH /api/v1/work-items/wi_web_47': (body) => {
        if (down) return problem(503, 'service_unavailable');
        const { description_json } = body as { description_json: RichText };
        const next = { ...items.find((entry) => entry.id === web47.id)!, description_json, description_version: 4 };
        items = items.map((entry) => (entry.id === web47.id ? next : entry));
        return { body: { data: next } };
      },
    };
    const first = renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const { editor } = await descriptionEditor();
    paste(editor, 'Kurz vor dem Schließen. ');
    // the preview closes: the save runs and fails
    first.unmount();
    await waitFor(() => expect(descriptionSaves()).toHaveLength(1));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Änderung nicht gespeichert', tone: 'error' }));
    // the text is not lost: leaving the page still asks
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    // the item opens again: the text that could not be saved is the draft, said to be unsaved
    const calls = api!.calls;
    api?.restore();
    down = false;
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    api!.calls.unshift(...calls);
    const again = await descriptionEditor();
    expect(again.editor.textContent).toBe('Kurz vor dem Schließen. Beim Absenden kommt die Mail zweimal an.');
    expect(within(again.section).getByRole('status').textContent).toBe('Nicht gespeichert');

    // ⌘↵ saves it, based on the version it was typed on
    press('Enter', { ctrlKey: true }, again.editor);
    await waitFor(() => expect(within(again.section).getByRole('status').textContent).toBe('Gespeichert'));
    expect(descriptionSaves()).toEqual([
      ['Kurz vor dem Schließen. Beim Absenden kommt die Mail zweimal an.', 3],
      ['Kurz vor dem Schließen. Beim Absenden kommt die Mail zweimal an.', 3],
    ]);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('keeps the text of a closed view whose save fails after the item opened again', async () => {
    // one cache for the app, as in the browser: the save of the closed view runs against it
    const client = newClient();
    const first = renderWith(<ItemPeek itemId="wi_web_47" />, { client, routes: { 'PATCH /api/v1/work-items/wi_web_47': () => problem(500, 'server_error') } });
    const { editor } = await descriptionEditor();
    const gate = holdNextPatch();
    paste(editor, 'Kurz vor dem Schließen. ');
    // the preview closes, its save is on its way; the item opens again meanwhile (the cache shows the text already)
    first.unmount();
    await waitFor(() => expect(gate.held()).toBe(true));
    renderWith(<ItemPeek itemId="wi_web_47" />, { client, routes: { 'PATCH /api/v1/work-items/wi_web_47': () => problem(500, 'server_error') } });
    const again = await descriptionEditor();
    // while that save runs, the draft stays (the view shows what the server answers meanwhile)
    expect(drafts.pending()).toEqual(['description:wi_web_47']);

    // the save fails: the text stays the draft, the open view says it is not saved, leaving asks
    gate.release();
    await waitFor(() => expect(within(again.section).getByRole('status').textContent).toBe('Nicht gespeichert'));
    expect(again.editor.textContent).toBe('Kurz vor dem Schließen. Beim Absenden kommt die Mail zweimal an.');
    expect(drafts.pending()).toEqual(['description:wi_web_47']);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it('keeps the text of a closed view whose save fails after the item opened and closed again', async () => {
    // one cache for the app, as in the browser: the save of the closed view runs against it
    const client = newClient();
    const first = renderWith(<ItemPeek itemId="wi_web_47" />, { client, routes: { 'PATCH /api/v1/work-items/wi_web_47': () => problem(500, 'server_error') } });
    const { editor } = await descriptionEditor();
    const gate = holdNextPatch();
    paste(editor, 'Kurz vor dem Schließen. ');
    first.unmount();
    await waitFor(() => expect(gate.held()).toBe(true));
    // opened and closed again without typing: that view has nothing of its own to save
    const second = renderWith(<ItemPeek itemId="wi_web_47" />, { client, routes: { 'PATCH /api/v1/work-items/wi_web_47': () => problem(500, 'server_error') } });
    await descriptionEditor();
    second.unmount();

    gate.release();
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Änderung nicht gespeichert' }));
    expect(plainText(drafts.get(descriptionDraft(web47.id)))).toBe('Kurz vor dem Schließen. Beim Absenden kommt die Mail zweimal an.');
  });

  it('forgets an open conflict and unsent text when another person signs in', async () => {
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    const routes: Record<string, MockRoute> = {
      'PATCH /api/v1/work-items/wi_web_47': () =>
        problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs }),
    };
    const view = renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const { editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    press('Enter', { ctrlKey: true }, editor);
    await screen.findByRole('alert');
    view.unmount();

    resetForUser('u_lene', 'u_ida');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);

    // the next person sees the stored description, without the banner
    api!.restore();
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const again = await descriptionEditor();
    expect(again.editor.textContent).toBe('Beim Absenden kommt die Mail zweimal an.');
    expect(within(again.section).queryByRole('alert')).toBeNull();
  });

  it('forgets text of a closed view the server holds by now', async () => {
    // a failed save of a closed view whose retry went through meanwhile: nothing left to offer
    drafts.set(descriptionDraft(web47.id), web47.description_json);
    renderWith(<ItemPeek itemId="wi_web_47" />);
    const { section, editor } = await descriptionEditor();
    expect(editor.textContent).toBe('Beim Absenden kommt die Mail zweimal an.');
    expect(within(section).getByRole('status').textContent).toBe('');
    await waitFor(() => expect(drafts.pending()).toEqual([]));
  });

  it('announces a conflict met by the save that runs as the view goes away, and opens the item with the banner', async () => {
    const user = userEvent.setup();
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    let refuse = true;
    const routes: Record<string, MockRoute> = {
      'PATCH /api/v1/work-items/wi_web_47': (body) => {
        if (refuse) return problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs });
        return { body: { data: { ...theirs, description_json: (body as { description_json: RichText }).description_json, description_version: 5 } } };
      },
    };
    const view = renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const { editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    // a link elsewhere: the view goes while its save is still to answer
    view.unmount();

    const left = await waitFor(() => {
      expect(lastToast()).toMatchObject({
        title: 'Beschreibung von WEB-47 nicht gespeichert',
        description: 'Ida Brenner hat die Beschreibung inzwischen geändert.',
        tone: 'error',
        action: { label: 'Öffnen' },
      });
      return lastToast()!;
    });
    // nothing typed is lost on the way out of the page either
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    // "Öffnen" brings the item back in the preview, with the banner and this window's text
    act(() => runToastAction(left.id));
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    api!.restore();
    items = items.map((entry) => (entry.id === web47.id ? theirs : entry));
    refuse = false;
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const again = await descriptionEditor();
    const banner = await within(again.section).findByRole('alert');
    expect(again.editor.textContent).toBe('Meine Fassung. Beim Absenden kommt die Mail zweimal an.');
    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(() => expect(descriptionSaves()).toEqual([['Meine Fassung. Beim Absenden kommt die Mail zweimal an.', 4]]));
    await waitFor(() => {
      const after = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);
    });
  });

  it('announces a conflict the banner showed as the preview closed', async () => {
    const user = userEvent.setup();
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    const routes: Record<string, MockRoute> = {
      'PATCH /api/v1/work-items/wi_web_47': () =>
        problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs }),
    };
    const view = renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const { editor } = await descriptionEditor();
    paste(editor, 'Meine Fassung. ');
    press('Enter', { ctrlKey: true }, editor);
    await screen.findByRole('alert');
    expect(currentToasts()).toEqual([]);

    view.unmount();
    expect(lastToast()).toMatchObject({ title: 'Beschreibung von WEB-47 nicht gespeichert', action: { label: 'Öffnen' } });
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    // back, the banner is there again; "Neu laden" settles it
    api!.restore();
    items = items.map((entry) => (entry.id === web47.id ? theirs : entry));
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes });
    const again = await descriptionEditor();
    await user.click(within(await within(again.section).findByRole('alert')).getByRole('button', { name: 'Neu laden' }));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('shows the banner when the retry of a failed save meets a conflict', async () => {
    const theirs = { ...web47, description_json: doc('Ida hat das schon geklärt.'), description_version: 4 };
    let answer = problem(503, 'service_unavailable');
    renderWith(<ItemPage itemKey="WEB-47" />, { routes: { 'PATCH /api/v1/work-items/wi_web_47': () => answer } });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Erstens. ');
    press('Enter', { ctrlKey: true }, editor);
    const failed = await waitFor(() => {
      expect(lastToast()?.action?.label).toBe('Erneut versuchen');
      return lastToast()!;
    });

    // somebody saved in between: the retry's 409 opens the banner, not silence
    answer = problem(409, 'description_conflict', { detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: theirs });
    act(() => runToastAction(failed.id));
    const banner = await within(section).findByRole('alert');
    expect(banner.textContent).toContain('Ida Brenner hat die Beschreibung inzwischen geändert.');
    expect(editor.textContent).toBe('Erstens. Beim Absenden kommt die Mail zweimal an.');
    await userEvent.setup().click(within(banner).getByRole('button', { name: 'Neu laden' }));
  });

  it('shows a refused text under the editor', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': () => ({
          status: 422,
          body: { type: 'about:blank', title: 'validation_failed', status: 422, reason: 'validation_failed', detail: 'Nein.', errors: { description_json: ['Die Beschreibung ist zu lang.'] } },
        }),
      },
    });
    const { section, editor } = await descriptionEditor();
    paste(editor, 'Viel zu viel. ');
    press('Enter', { ctrlKey: true }, editor);
    const message = await within(section).findByText('Die Beschreibung ist zu lang.');
    await waitFor(() => expect(editor.getAttribute('aria-invalid')).toBe('true'));
    expect(editor.getAttribute('aria-describedby')).toBe(message.id);

    // typing on takes the message away
    paste(editor, 'Kürzer. ');
    expect(within(section).queryByText('Die Beschreibung ist zu lang.')).toBeNull();
  });

  it('shows the description read-only to a viewer', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />, { role: 'viewer' });
    const section = await screen.findByRole('region', { name: 'Beschreibung' });
    await waitFor(() => expect(section.textContent).toContain('Beim Absenden kommt die Mail zweimal an.'));
    expect(within(section).queryByRole('textbox')).toBeNull();
    expect(within(section).queryByRole('status')).toBeNull();
  });

  it('says a viewer that there is no description', async () => {
    renderWith(<ItemPage itemKey="WEB-48" />, { role: 'viewer' });
    const section = await screen.findByRole('region', { name: 'Beschreibung' });
    expect(await within(section).findByText('Keine Beschreibung.')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------- children */

describe('Children', () => {
  it('shows the progress and each child with its status and assignee', async () => {
    const user = userEvent.setup();
    items = items.map((entry) => (entry.id === web48.id ? { ...web48, assignee_id: 'u_ida' } : entry));
    items.push(makeWorkItem({ id: 'wi_web_49', number: 49, key: 'WEB-49', title: 'Footer aufräumen', parent_id: 'wi_web_30', state_id: 'std_done' }));
    items = items.map((entry) => (entry.id === web30.id ? { ...web30, children_progress: { done: 1, total: 2 } } : entry));
    renderWith(<ItemPeek itemId="wi_web_30" />);

    const children = await screen.findByRole('region', { name: 'Kinder' });
    expect(within(children).getByText('2')).toBeTruthy();
    const bar = within(children).getByRole('progressbar', { name: 'Fortschritt der Kind-Items' });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    // each child with its status, key and title, and its assignee
    const rows = within(children).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('a')!.textContent)).toEqual(['WEB-48Startseite umbauen', 'WEB-49Footer aufräumen']);
    await within(rows[0]!).findByRole('img', { name: 'Status Todo' });
    expect(within(rows[1]!).getByRole('img', { name: 'Status Done' })).toBeTruthy();
    expect(await within(rows[0]!).findByRole('img', { name: 'Ida Brenner' })).toBeTruthy();
    expect(within(rows[1]!).getByRole('img', { name: 'Nicht zugewiesen' })).toBeTruthy();
    // a child opens in the preview
    await user.click(within(rows[1]!).getByRole('link', { name: /WEB-49/ }));
    expect(useUiStore.getState().peekItemId).toBe('wi_web_49');
  });

  it('opens the create dialog with the parent and the child type', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-30" />);
    const children = await screen.findByRole('region', { name: 'Kinder' });
    const button = await within(children).findByRole('button', { name: 'Kind-Item' });
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
    await user.click(button);
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: { project_id: 'p_web', parent_id: 'wi_web_30', type_id: 't_task' } });
  });

  it('says why no child can be created', async () => {
    const user = userEvent.setup();
    projects = [project('WEB', 'member', { enabled_type_ids: ['t_epic'], default_type_id: 't_epic' })];
    renderWith(<ItemPage itemKey="WEB-30" />);
    const button = await within(await screen.findByRole('region', { name: 'Kinder' })).findByRole('button', { name: 'Kind-Item' });
    await waitFor(() => expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Im Projekt ist kein Typ aktiviert, der Kind-Item sein kann.'));
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.click(button);
    expect(useUiStore.getState().createOpen).toBe(false);
  });

  it('invites an epic without children to split the work, and leaves the section out where it has nothing to show', async () => {
    items = items.filter((entry) => entry.id !== web48.id);
    const view = renderWith(<ItemPage itemKey="WEB-30" />);
    const children = await screen.findByRole('region', { name: 'Kinder' });
    expect(within(children).getByText('Noch keine Kind-Items. Teile die Arbeit auf, dann zeigt sich hier der Fortschritt.')).toBeTruthy();
    view.unmount();
    api!.restore();

    // a viewer of an epic without children, and a task: no section
    projects = [];
    renderWith(<ItemPage itemKey="WEB-30" />, { role: 'viewer' });
    await screen.findByRole('region', { name: 'Beschreibung' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Kinder' })).toBeNull());
    expect(screen.queryByRole('region', { name: 'Kinder' })).toBeNull();
  });

  it('shows no children section on a task', async () => {
    renderWith(<ItemPage itemKey="WEB-48" />);
    await screen.findByRole('region', { name: 'Relationen' });
    expect(screen.queryByRole('region', { name: 'Kinder' })).toBeNull();
  });
});

/* --------------------------------------------------------------------- relations */

describe('Relations', () => {
  it('groups by type and direction', async () => {
    relations = {
      wi_web_47: [
        relation('rel_tests', 'rt_tests', 'inward', null),
        relation('rel_relates', 'rt_relates', 'inward', web50),
        relation('rel_blocked', 'rt_blocks', 'inward', ops12),
        relation('rel_blocks', 'rt_blocks', 'outward', web48),
        relation('rel_blocks_two', 'rt_blocks', 'outward', web30),
        relation('rel_unknown', 'rt_gone', 'outward', makeWorkItem({ id: 'wi_web_60', number: 60, key: 'WEB-60', title: 'Altlast' })),
      ],
    };
    renderWith(<ItemPage itemKey="WEB-47" />);
    const section = await screen.findByRole('region', { name: 'Relationen' });
    await within(section).findByText('wird getestet von');
    // in the order of the types, outward before inward; a type that is gone reads "verknüpft mit"
    const groups = [...section.querySelectorAll(':scope > div.mt-2')].map((group) => [
      group.querySelector('p')!.textContent,
      [...group.querySelectorAll('li')].map((row) => row.textContent),
    ]);
    expect(groups).toEqual([
      ['verknüpft mit', ['WEB-60Altlast']],
      ['blockiert', ['WEB-48Startseite umbauen', 'WEB-30Relaunch Phase 1']],
      ['wird blockiert von', ['OPS-12Mail-Limits am Server erhöhen']],
      ['verwandt mit', ['WEB-50Impressum aktualisieren']],
      ['wird getestet von', ['verborgenes Item']],
    ]);
  });

  it('shows a hidden item without title and without remove', async () => {
    relations = { wi_web_47: [relation('rel_blocked', 'rt_blocks', 'inward', ops12), relation('rel_tests', 'rt_tests', 'inward', null)] };
    renderWith(<ItemPeek itemId="wi_web_47" />);
    const section = await screen.findByRole('region', { name: 'Relationen' });
    const hidden = (await within(section).findByText('verborgenes Item')).closest('li')!;
    expect(within(hidden).queryByRole('link')).toBeNull();
    expect(within(hidden).queryByRole('button')).toBeNull();
    expect(within(section).getAllByRole('button', { name: /entfernen/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Relation „wird blockiert von OPS-12“ entfernen',
    ]);
  });

  it('adds a relation found by key with r', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'POST /api/v1/work-items/wi_web_47/relations': (body) => {
          const entry = relation('rel_new', (body as { type_id: string }).type_id, 'outward', web48);
          relations = { wi_web_47: [entry] };
          return { status: 201, body: { data: entry } };
        },
      },
    });
    const section = await screen.findByRole('region', { name: 'Relationen' });
    expect(await within(section).findByText('Keine Relationen. Mit R verknüpfst du das Item, zum Beispiel „blockiert“ oder „testet“.')).toBeTruthy();

    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    expect(dialog.textContent).toContain('Wie hängt WEB-47 mit einem anderen Item zusammen?');
    // the list opens with the dialog, and the search field takes the focus
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('web-48');
    await screen.findByRole('option', { name: /Startseite umbauen/ });
    await user.keyboard('{Enter}');
    expect(within(dialog).getByRole('combobox', { name: 'Item: WEB-48 Startseite umbauen' })).toBeTruthy();
    expect(dialog.textContent).toContain('WEB-47 verwandt mit WEB-48');

    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/relations')).toEqual([{ type_id: 'rt_relates', target_id: 'wi_web_48' }]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Relation hinzufügen' })).toBeNull());
    expect(lastToast()).toMatchObject({ title: 'Relation hinzugefügt', description: 'WEB-47 verwandt mit WEB-48', tone: 'success' });
    expect(await within(section).findByRole('link', { name: /WEB-48/ })).toBeTruthy();
    // the focus goes back to "Relation"
    await waitFor(() => expect(document.activeElement).toBe(within(section).getByRole('button', { name: /^Relation(?! „)/ })));
  });

  it('searches the relation target through the search', async () => {
    const user = userEvent.setup();
    items = [...items, makeWorkItem({ id: 'wi_web_51', number: 51, key: 'WEB-51', title: 'Kontaktformular prüfen', rank: 'a7' })];
    renderWith(<ItemPage itemKey="WEB-47" />);
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('kontakt');
    expect(await screen.findByRole('option', { name: /Kontaktformular prüfen/ })).toBeTruthy();
    const searches = () => api!.calls.filter((call) => call.url.startsWith('/api/v1/search')).map((call) => call.url);
    // one request after the pause, with only the items and as many as the list shows
    expect(searches()).toEqual(['/api/v1/search?q=kontakt&types=items&limit=20']);
    expect(api!.calls.filter((call) => call.url.startsWith('/api/v1/work-items/query'))).toEqual([]);
  });

  it('shows the hits of the search as they come, also those the typed text does not spell', async () => {
    const user = userEvent.setup();
    // the search finds by the description too, and forgives a typo: the list does not narrow the hits again
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: { 'GET /api/v1/search': () => ({ body: { data: searchResults({ items: [web48, web50] }) } }) },
    });
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('startsiete');
    await screen.findByRole('option', { name: /Startseite umbauen/ });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Startseite umbauenWEB-48', 'Impressum aktualisierenWEB-50']);
  });

  it('offers no hit of an earlier query while the search answers', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />);
    // the search for the new text waits until the test lets it answer
    const original = globalThis.fetch;
    let release = () => {};
    let held = false;
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input), 'https://werkbuch.test').searchParams.get('q') === 'impressum') {
        held = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return original(input, init);
    };
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('startseite');
    expect((await screen.findByRole('option', { name: /Startseite umbauen/ })).getAttribute('aria-disabled')).not.toBe('true');

    await user.keyboard('{Backspace>10/}impressum');
    // the hits of "startseite" stay while the new text is asked, but none of them can be chosen
    const earlier = screen.getByRole('option', { name: /Startseite umbauen/ });
    expect(earlier.getAttribute('aria-disabled')).toBe('true');
    await waitFor(() => expect(held).toBe(true));
    expect(screen.getByRole('option', { name: /Startseite umbauen/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('Sucht …')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(within(dialog).getByRole('combobox', { name: 'Item: keins gewählt' })).toBeTruthy();

    await act(async () => release());
    const fresh = await screen.findByRole('option', { name: /Impressum aktualisieren/ });
    expect(fresh.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByRole('option', { name: /Startseite umbauen/ })).toBeNull();
    expect(within(dialog).queryByText('Sucht …')).toBeNull();
    await user.keyboard('{Enter}');
    expect(within(dialog).getByRole('combobox', { name: 'Item: WEB-50 Impressum aktualisieren' })).toBeTruthy();
  });

  it('asks nothing until something is typed and says what to type', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />);
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(await screen.findByText('Key oder Titel eingeben')).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 50)));
    const searches = () => api!.calls.filter((call) => call.url.startsWith('/api/v1/search'));
    expect(searches()).toEqual([]);

    // emptied again, the field forgets the hits of the last search
    await user.keyboard('impressum');
    await screen.findByRole('option', { name: /Impressum aktualisieren/ });
    await user.keyboard('{Backspace>9/}');
    expect(await screen.findByText('Key oder Titel eingeben')).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 50)));
    expect(screen.queryByRole('option')).toBeNull();
    expect(searches()).toHaveLength(1);

    // a search without hits says so
    await user.keyboard('zzz');
    expect(await screen.findByText('Kein Item passt.')).toBeTruthy();
  });

  it('offers the item of a typed former key first', async () => {
    const user = userEvent.setup();
    formerKeys = { 'alt-48': 'wi_web_48' };
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'POST /api/v1/work-items/wi_web_47/relations': () => ({ status: 201, body: { data: relation('rel_new', 'rt_relates', 'outward', web48) } }),
      },
    });
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('ALT-48');
    // the key match leads the list under its current key, and Enter takes it
    const first = await screen.findByRole('option', { name: /Startseite umbauen/ });
    expect(screen.getAllByRole('option')[0]).toBe(first);
    expect(first.textContent).toContain('WEB-48');
    await user.keyboard('{Enter}');
    expect(within(dialog).getByRole('combobox', { name: 'Item: WEB-48 Startseite umbauen' })).toBeTruthy();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/relations')).toEqual([{ type_id: 'rt_relates', target_id: 'wi_web_48' }]));
  });

  it('leaves the item itself out of the hits', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />);
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('web-47');
    expect(await screen.findByText('Kein Item passt.')).toBeTruthy();
    expect(api!.calls.some((call) => call.url === '/api/v1/search?q=web-47&types=items&limit=20')).toBe(true);
  });

  it('relates the other way round, found by title from the menu', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'POST /api/v1/work-items/wi_web_50/relations': () => ({ status: 201, body: { data: relation('rel_new', 'rt_blocks', 'outward', web47, 'wi_web_50') } }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Relation hinzufügen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('impressum');
    await user.click(await screen.findByRole('option', { name: /Impressum aktualisieren/ }));

    await user.click(within(dialog).getByRole('combobox', { name: /^Art der Relation/ }));
    await user.click(await screen.findByRole('option', { name: 'wird blockiert von' }));
    expect(dialog.textContent).toContain('WEB-47 wird blockiert von WEB-50');
    await user.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    // WEB-50 blocks WEB-47: the relation runs from it
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_50/relations')).toEqual([{ type_id: 'rt_blocks', target_id: 'wi_web_47' }]));
  });

  it('offers a candidate the person may not change only as disabled for an inward relation', async () => {
    const user = userEvent.setup();
    // OPS is a project the member only reads
    projects = [project('WEB', 'member'), project('OPS', 'viewer')];
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: { 'GET /api/v1/search': () => ({ body: { data: searchResults({ items: [web48, ops12] }) } }) },
    });
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('e');
    // outward (WEB-47 becomes the source): both can be chosen
    expect((await screen.findByRole('option', { name: /Mail-Limits/ })).getAttribute('aria-disabled')).not.toBe('true');

    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('combobox', { name: /^Art der Relation/ }));
    await user.click(await screen.findByRole('option', { name: 'wird blockiert von' }));
    // inward: the chosen item becomes the source, so it has to be one the person may change
    await user.click(within(dialog).getByRole('combobox', { name: 'Item: keins gewählt' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Key, Titel oder Text suchen …')));
    await user.keyboard('e');
    const readOnly = await screen.findByRole('option', { name: /Mail-Limits/ });
    expect(readOnly.getAttribute('aria-disabled')).toBe('true');
    expect(readOnly.textContent).toContain('Im Projekt OPS darfst du nur lesen');
    expect(screen.getByRole('option', { name: /Startseite umbauen/ }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows a duplicate at the field', async () => {
    const user = userEvent.setup();
    let answer: { status: number; body: unknown } = {
      status: 422,
      body: { type: 'about:blank', title: 'validation_failed', status: 422, reason: 'validation_failed', detail: 'Nein.', errors: { target_id: ['Diese Relation gibt es schon.'] } },
    };
    renderWith(<ItemPage itemKey="WEB-47" />, { routes: { 'POST /api/v1/work-items/wi_web_47/relations': () => answer } });
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    const submit = within(dialog).getByRole('button', { name: 'Hinzufügen' });

    // without an item the form says what is missing
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('{Escape}');
    await user.click(submit);
    expect(await within(dialog).findByText('Wähle das Item, mit dem es zusammenhängt.')).toBeTruthy();
    const trigger = within(dialog).getByRole('combobox', { name: 'Item: keins gewählt' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Key, Titel oder Text suchen …')));
    await user.keyboard('startseite');
    await user.click(await screen.findByRole('option', { name: /Startseite umbauen/ }));
    expect(within(dialog).queryByText('Wähle das Item, mit dem es zusammenhängt.')).toBeNull();
    await user.click(submit);
    expect(await within(dialog).findByText('Diese Relation gibt es schon.')).toBeTruthy();
    const chosen = within(dialog).getByRole('combobox', { name: 'Item: WEB-48 Startseite umbauen' });
    expect(chosen.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(chosen));

    // a refusal of the kind stands at the kind
    answer = { ...answer, body: { ...(answer.body as object), errors: { type_id: ['Diese Art von Relation gibt es nicht.'] } } };
    await user.click(submit);
    expect(await within(dialog).findByText('Diese Art von Relation gibt es nicht.')).toBeTruthy();

    // one without a field on top of the form
    answer = problem(409, 'archived', { detail: 'WEB-50 ist archiviert.' });
    await user.click(submit);
    expect(await within(dialog).findByText('WEB-50 ist archiviert.')).toBeTruthy();

    // the server failing: a toast with "Erneut versuchen", the dialog stays
    answer = problem(503, 'service_unavailable', { detail: 'Gerade nicht.' });
    await user.click(submit);
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Relation nicht hinzugefügt', description: 'Gerade nicht.', action: { label: 'Erneut versuchen' } }));
    expect(screen.getByRole('dialog', { name: 'Relation hinzufügen' })).toBeTruthy();
  });

  it('asks for the kind while there is none', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />, { routes: { 'GET /api/v1/relation-types': () => ({ body: list([]) }) } });
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    expect(await within(dialog).findByText('Wähle, wie die Items zusammenhängen.')).toBeTruthy();
  });

  it('shows a failed search with Try again', async () => {
    const user = userEvent.setup();
    let failing = true;
    const unavailable = 'Die Suche ist gerade nicht erreichbar. Versuch es gleich noch einmal.';
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'GET /api/v1/search': (_body, url) => (failing ? problem(503, 'search_unavailable', { detail: unavailable }) : searchItems(items, url)),
      },
    });
    await screen.findByRole('region', { name: 'Relationen' });
    press('r');
    const dialog = await screen.findByRole('dialog', { name: 'Relation hinzufügen' });
    const search = await screen.findByPlaceholderText('Key, Titel oder Text suchen …');
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(within(dialog).getByText('Key oder Titel tippen, Enter wählt.')).toBeTruthy();
    await user.keyboard('startseite');
    expect(await screen.findByText(`Die Auswahl konnte nicht geladen werden: ${unavailable}`)).toBeTruthy();
    // the hint under the field gives way to the error in the list
    expect(within(dialog).queryByText('Key oder Titel tippen, Enter wählt.')).toBeNull();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('option', { name: /Startseite umbauen/ })).toBeTruthy();
  });

  it('removes with undo', async () => {
    const user = userEvent.setup();
    relations = { wi_web_47: [relation('rel_blocks', 'rt_blocks', 'outward', web48), relation('rel_relates', 'rt_relates', 'outward', web50)] };
    let down = true;
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'DELETE /api/v1/relations/rel_blocks': () => {
          if (down) return problem(503, 'service_unavailable', { detail: 'Gerade nicht.' });
          relations = { wi_web_47: relations.wi_web_47!.filter((entry) => entry.relation.id !== 'rel_blocks') };
          return { status: 204 };
        },
      },
    });
    const section = await screen.findByRole('region', { name: 'Relationen' });
    const remove = await within(section).findByRole('button', { name: 'Relation „blockiert WEB-48“ entfernen' });

    // gone at once, with undo; the focus moves on to "Relation"
    remove.focus();
    await user.keyboard('{Enter}');
    expect(within(section).queryByRole('link', { name: /WEB-48/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(section).getByRole('button', { name: /^Relation(?! „)/ })));
    const undo = lastToast()!;
    expect(undo).toMatchObject({ title: 'Relation entfernt: blockiert WEB-48', action: { label: 'Rückgängig' } });
    act(() => runToastAction(undo.id));
    expect(await within(section).findByRole('link', { name: /WEB-48/ })).toBeTruthy();
    expect(sent('DELETE', '/api/v1/relations/rel_blocks')).toEqual([]);

    // the toast runs out: the server refuses, and the relation comes back
    await user.click(within(section).getByRole('button', { name: 'Relation „blockiert WEB-48“ entfernen' }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Relation zu WEB-48 nicht entfernt', description: 'Gerade nicht.' }));
    expect(await within(section).findByRole('link', { name: /WEB-48/ })).toBeTruthy();

    // and once more, now it goes
    down = false;
    await user.click(within(section).getByRole('button', { name: 'Relation „blockiert WEB-48“ entfernen' }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/relations/rel_blocks')).toHaveLength(2));
    await waitFor(() => expect(within(section).queryByRole('link', { name: /WEB-48/ })).toBeNull());
    expect(within(section).getByRole('link', { name: /WEB-50/ })).toBeTruthy();
  });

  it('says why a viewer cannot add a relation, and leaves an empty section out', async () => {
    relations = { wi_web_47: [relation('rel_blocks', 'rt_blocks', 'outward', web48)] };
    const view = renderWith(<ItemPage itemKey="WEB-47" />, { role: 'viewer' });
    const section = await screen.findByRole('region', { name: 'Relationen' });
    await within(section).findByRole('link', { name: /WEB-48/ });
    await waitFor(() => expect(within(section).queryByRole('button')).toBeNull());
    view.unmount();
    api!.restore();

    projects = [];
    renderWith(<ItemPage itemKey="WEB-48" />, { role: 'viewer' });
    await screen.findByRole('region', { name: 'Beschreibung' });
    expect(screen.queryByRole('region', { name: 'Relationen' })).toBeNull();
    // r says why (once the rights have loaded, the reason is the viewer's)
    await waitFor(() => {
      press('r');
      expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.', tone: 'error' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
