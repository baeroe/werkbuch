import { router } from '@inertiajs/react';
import { useQueryClient, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { isLiveConnected, subscribeLive, subscribeLiveStatus, watchItem, type LiveEvent } from '@/api/live';
import { clearLiveGone, markLiveGone } from '@/lib/liveGone';
import { subscribeUndoPending, undoPending } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import { qk } from './keys';
import { goneFromTree } from './pages';

/** How long the messages have to pause before the screens load again: a burst loads once. */
export const LIVE_BURST_MS = 300;

/** How long a steady stream of messages waits at most before the screens load anyway. */
export const LIVE_MAX_WAIT_MS = 2_000;

/** How many event ids the tab remembers to drop a message it has seen (the original and the redispatch, P10). */
const SEEN_MAX = 1000;

/**
 * How many deleted projects and items, and apart from them how many deleted pages, the tab remembers to leave their
 * queries alone (the oldest go first): a large subtree (`LiveMessage::PAGE_IDS_MAX`) pushes no project or item out.
 */
const GONE_MAX = 200;

/** The wiki of a project: the trees, the pages, their versions. */
const WIKI: readonly QueryKey[] = [qk.pages.all, qk.pageVersions.all];

/** The templates with their runs and the automations of a project (the preview of a schedule is no live data). */
const AUTOMATION: readonly QueryKey[] = [qk.templates.all, qk.templateRuns.all, qk.automations.all];

/** Everything a live message can make stale: what a screen shows again after the connection was gone. */
const EVERYTHING: readonly QueryKey[] = [qk.workItems.all, qk.activity.all, qk.comments.all, qk.projects.all, qk.members.all, qk.notifications.all, ...WIKI, ...AUTOMATION];

/** What the person's own channel carries (watching, a new project, a new org role, the inbox): stale once it is held. */
const OWN_CHANNEL: readonly QueryKey[] = [qk.notifications.all, qk.projects.all, qk.members.all, qk.workItems.all, qk.activity.all];

/** What the channel of a project carries (its items and their history, the project and its members, its wiki). */
const PROJECT_CHANNEL: readonly QueryKey[] = [qk.workItems.all, qk.activity.all, qk.projects.all, qk.members.all, ...WIKI, ...AUTOMATION];

/** The caches of the wiki and of references (a reference to a page shows its title): what waits for a check of a tree. */
const WIKI_ROOTS: readonly unknown[] = [qk.pages.all[0], qk.pageVersions.all[0], qk.references.all[0]];

/**
 * What a channel carries that Reverb holds now (`live.subscribed`): what loaded before may have missed a message sent
 * before (the inbox loaded while the mention was written), so it loads once more. The channel of an item carries its
 * comments only: their queries and the history of that item, no list.
 */
function heldKeys(event: LiveEvent): readonly QueryKey[] {
  if (event.item_id !== null) return [qk.comments.list({ item: event.item_id }), qk.activity.list({ item: event.item_id })];
  return event.project_id !== null ? PROJECT_CHANNEL : OWN_CHANNEL;
}

/**
 * The caches a message makes stale. Items and their history on `work_item.*` (also watching, on the person's own
 * channel), comments and the history on `comment.*`, projects and members on `project.*` (on `project.updated` the
 * items too: their keys carry the identifier), the templates and their runs on `template.*` (a failed run is
 * `template.run_failed`; on `template.deleted` the items too: their `template_id` goes, T14-M3), the automations on
 * `automation.*`, the templates and their runs on a `work_item.created` a run made (it names its template, T14-I1:
 * the log, the count and the next run change; an item made by hand leaves them alone), the wiki on `page.*` (on `page.updated` and `page.moved` the references
 * too: a reference shows the title of its page, K15; on `page.deleted` as well: a reference to a deleted page loads and
 * finds it missing, T18-M5), the projects on a new org role (K14: the channels follow the list; the
 * shell reloads the shared props `auth` for it, M2), the inbox on `notifications.changed`; everything after the connection was
 * back (`live.reconnected`); what a channel carries once Reverb holds it (`live.subscribed`, `heldKeys`). A refused
 * channel (`live.refused`) loads everything as well (A281: access lost; what the person may not see any more answers
 * 404 or leaves the lists, as the screen should show it), unless the project or item it is about was deleted: that is
 * decided when the burst loads, so a delete and a refusal that come together give the same whichever comes first.
 */
function keysOf(event: LiveEvent): readonly QueryKey[] {
  const group = event.type.split('.')[0];
  if (event.type === 'live.reconnected') return EVERYTHING;
  if (event.type === 'live.subscribed') return heldKeys(event);
  // decided when the burst loads (`refusalKeys`): a refused channel of something deleted loads nothing
  if (event.type === 'live.refused') return [];
  if (event.type === 'notifications.changed') return [qk.notifications.all];
  if (event.type === 'user.role_changed') return [qk.projects.all];
  // a run ends in a new item that names its template: its log, its count and its next run change
  if (event.type === 'work_item.created' && event.template_id !== null) return [qk.workItems.all, qk.activity.all, qk.templates.all, qk.templateRuns.all];
  if (group === 'work_item') return [qk.workItems.all, qk.activity.all];
  if (event.type === 'template.deleted') return [qk.templates.all, qk.templateRuns.all, qk.workItems.all];
  if (group === 'template') return [qk.templates.all, qk.templateRuns.all];
  if (group === 'automation') return [qk.automations.all];
  if (group === 'comment') return [qk.comments.all, qk.activity.all];
  // a new identifier changes the keys of the items: the lists of the project load again (T14-M6)
  if (event.type === 'project.updated') return [qk.projects.all, qk.members.all, qk.workItems.all];
  if (group === 'project') return [qk.projects.all, qk.members.all];
  if (event.type === 'page.updated' || event.type === 'page.moved' || event.type === 'page.deleted') return [...WIKI, qk.references.all];
  if (group === 'page') return WIKI;
  return [];
}

/**
 * What a message says is deleted: a project, an item or a template. Its own queries would answer 404 now (which the browser
 * reports as an error): live leaves them alone, the screen keeps what it shows until it is left (see `LiveRefresh`).
 * A refused channel (access lost, A281) is not gone: its queries load again and show that the person may not see it.
 */
function goneOf(event: LiveEvent): string | null {
  if (event.type === 'project.deleted') return event.project_id;
  if (event.type === 'work_item.deleted') return event.item_id;
  if (event.type === 'template.deleted') return event.template_id;
  return null;
}

/**
 * The pages `page.deleted` names (the subtree, the root first), and whether that is all of them: a subtree too large to
 * name comes as `null` (`LiveMessage::PAGE_IDS_MAX`), then only the root is known.
 */
function deletedPages(event: LiveEvent): { ids: string[]; complete: boolean } {
  if (Array.isArray(event.page_ids)) return { ids: event.page_ids, complete: true };
  return { ids: event.page_id === null ? [] : [event.page_id], complete: false };
}

/**
 * The ids a cached answer is about: a project, an item or a page (`id`), the item of a detail (`item.id`), the page of
 * a version (`page_id`), and the project of a page or an item (`project_id`, `item.project_id`: a page or item of a
 * deleted project would answer 404 too, N4).
 */
function dataIds(data: unknown): unknown[] {
  if (typeof data !== 'object' || data === null) return [];
  const record = data as { id?: unknown; item?: { id?: unknown; project_id?: unknown } | null; page_id?: unknown; project_id?: unknown };
  return [record.id ?? record.item?.id, record.page_id, record.project_id ?? record.item?.project_id];
}

/** Whether live updates arrive: false while the banner says they are paused. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribeLiveStatus, isLiveConnected, isLiveConnected);
}

/**
 * Loads again what live messages made stale, without ever throwing away a fetch on its way (K12, review T14 I1/I2):
 * - While a change of this tab is not stored yet (a mutation runs, or an undo toast still offers to take a change
 *   back, `undoPending`), the caches are only marked stale, so no answer replaces what the screen shows; once nothing
 *   is pending any more, what is still stale (or was being fetched when the message came) loads. What the change
 *   loaded itself after it settled is fresh and stays.
 * - A query that is being fetched when it gets stale is not cancelled and started anew: once its answer is there
 *   (which may be older than the message), it loads once more. A stream of messages thus never keeps a slow list from
 *   arriving.
 */
class LiveRefresh {
  /** Keys made stale while something was pending. */
  private readonly deferred = new Map<string, QueryKey>();
  /** Queries to load again once their running fetch ends (and nothing is pending). */
  private readonly afterFetch = new Set<string>();
  /** Deleted projects and items, and deleted pages (the last `GONE_MAX` each): their queries are not loaded again (404). */
  private readonly gone = { other: new Set<string>(), page: new Set<string>() };

  constructor(
    private readonly client: QueryClient,
    private readonly pending: () => boolean,
  ) {}

  /** Whether `id` (a project or an item) is known to be deleted. */
  isGone(id: string): boolean {
    return this.gone.other.has(id);
  }

  /** `id` (a project or an item, or with `kind` `page` a page) was deleted: it never comes back. */
  markGone(id: string, kind: 'page' | 'other' = 'other'): void {
    const ids = this.gone[kind];
    ids.delete(id);
    ids.add(id);
    if (ids.size > GONE_MAX) ids.delete(ids.values().next().value!);
  }

  apply(keys: readonly QueryKey[]): void {
    const pending = this.pending();
    for (const queryKey of keys) {
      if (pending) this.deferred.set(JSON.stringify(queryKey), queryKey);
      for (const query of this.client.getQueryCache().findAll({ queryKey })) {
        // not even stale: a screen that mounts another view of it would fetch it and get 404
        if (this.aboutGone(query)) continue;
        query.invalidate();
        if (query.state.fetchStatus === 'fetching') this.afterFetch.add(query.queryHash);
        else if (!pending) this.load(query);
      }
    }
  }

  /** Something pending may have settled: load what is left once nothing is. */
  settle(): void {
    if (this.pending()) return;
    const keys = [...this.deferred.values()];
    this.deferred.clear();
    const cache = this.client.getQueryCache();
    const stale = keys.flatMap((queryKey) => cache.findAll({ queryKey }).filter((query) => query.state.isInvalidated));
    const waiting = [...this.afterFetch].flatMap((hash) => {
      const query = cache.get(hash);
      // a query that left the cache meanwhile is fetched by whoever shows it again
      if (query === undefined) this.afterFetch.delete(hash);
      return query ?? [];
    });
    for (const query of new Set([...stale, ...waiting])) this.load(query);
  }

  /**
   * A query of the cache got the answer of a fetch (never a `setQueryData`): load it again when a message came during
   * that fetch. A fetch that was cancelled waits in `afterFetch` until `settle`.
   */
  fetched(query: Query): void {
    if (!this.afterFetch.has(query.queryHash) || query.state.fetchStatus === 'fetching' || this.pending()) return;
    this.load(query);
  }

  /**
   * Whether a query is about something gone: its key names it, or its answer is it (or a version of it). References are
   * never: they ask `GET /references`, which leaves out what is gone without a 404, so they load and stop showing it.
   */
  private aboutGone(query: Query): boolean {
    if (query.queryKey[0] === qk.references.all[0]) return false;
    const ids = dataIds(query.state.data);
    for (const id of [...this.gone.other, ...this.gone.page]) {
      if (query.queryHash.includes(id) || ids.includes(id)) return true;
    }
    return false;
  }

  /**
   * Loads a query now, or after the fetch on its way; one nobody shows stays stale until it is shown again. One about
   * something gone is not loaded (it would answer 404).
   */
  private load(query: Query): void {
    if (this.aboutGone(query)) {
      this.afterFetch.delete(query.queryHash);
      return;
    }
    if (query.state.fetchStatus === 'fetching') {
      this.afterFetch.add(query.queryHash);
      return;
    }
    this.afterFetch.delete(query.queryHash);
    if (!query.isActive()) return;
    void this.client.refetchQueries({ predicate: (candidate) => candidate === query }, { cancelRefetch: false });
  }
}

/**
 * Mount once in the shell (`LiveHost`): a live message (somebody else changed something) makes the screens that show
 * it load again and lights the changed item up for two seconds (`flash`). A message seen before (by its event) is
 * dropped; messages are collected until they pause for 300 ms (at most two seconds), then every cache they touch is
 * made stale once and loads again (`LiveRefresh`). So the channels Reverb holds on a page load (`live.subscribed`, one
 * per project) load each query once more, not once per channel.
 */
export function useLiveSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    const burst = new Map<string, QueryKey>();
    /** What the refused channels of the burst were about: a project or an item, `null` for the person's own channel. */
    const refusals: (string | null)[] = [];
    const flashes = new Set<string>();
    /** A new org role of the person in the burst: the shared props `auth` (account, rights) load again (M2). */
    let roleChanged = false;
    const refresh = new LiveRefresh(queryClient, () => queryClient.isMutating() > 0 || undoPending());
    /** Projects whose `page.deleted` could not name the pages (too many): their trees tell, when the burst loads. */
    const unnamed = new Set<string>();
    /** How many checks of trees run: meanwhile the caches of the wiki wait (they could ask for a deleted page). */
    let checking = 0;
    const waitingWiki = new Map<string, QueryKey>();
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let longest: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const markPageGone = (id: string) => {
      refresh.markGone(id, 'page');
      // the wiki page says so without asking
      markLiveGone(id, 'page');
    };

    /** The pages of the project the cache knows and its tree on the server holds no more are gone (`goneFromTree`). */
    const checkTree = async (project: string) => {
      const ids = await goneFromTree(queryClient, project);
      if (alive) ids.forEach(markPageGone);
    };

    /** Checks the trees, then loads what of the wiki waited for them, once no check runs any more. */
    const checkTrees = (projects: string[]) => {
      checking += 1;
      void Promise.all(projects.map(checkTree)).then(() => {
        checking -= 1;
        if (!alive || checking > 0) return;
        const keys = [...waitingWiki.values()];
        waitingWiki.clear();
        refresh.apply(keys);
      });
    };

    const flush = () => {
      if (quiet !== null) clearTimeout(quiet);
      if (longest !== null) clearTimeout(longest);
      quiet = null;
      longest = null;
      // a refusal is lost access (A281), unless what it is about was deleted: then the delete decides, whichever came first
      const lost = refusals.splice(0).some((id) => id === null || !refresh.isGone(id));
      const keys = lost ? EVERYTHING : [...burst.values()];
      burst.clear();
      if (unnamed.size > 0) {
        checkTrees([...unnamed]);
        unnamed.clear();
      }
      // while a tree is checked, the wiki waits (the rest of the burst loads now)
      const waits = (queryKey: QueryKey) => checking > 0 && WIKI_ROOTS.includes(queryKey[0]);
      keys.filter(waits).forEach((queryKey) => waitingWiki.set(JSON.stringify(queryKey), queryKey));
      refresh.apply(keys.filter((queryKey) => !waits(queryKey)));
      if (roleChanged) {
        roleChanged = false;
        // only the account and its rights, never the page: what it shows stays (usePermissions reads `auth`)
        router.reload({ only: ['auth'] });
      }
      flashes.forEach((id) => useUiStore.getState().flash(id));
      flashes.clear();
    };
    // a toast that runs out closes before its action starts: look once the closing is over
    const settle = () =>
      queueMicrotask(() => {
        if (alive) refresh.settle();
      });

    const stopMutations = queryClient.getMutationCache().subscribe(settle);
    const stopUndo = subscribeUndoPending(settle);
    // only an answer of a fetch ends it: `setQueryData` (`success` with `manual`) after a cancelled reload is the screen
    // changing what it shows (an item hidden for an undo window, T7-I1); what waited for that fetch loads on `settle`
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const { action } = event;
      if (action.type === 'error' || (action.type === 'success' && action.manual !== true)) refresh.fetched(event.query);
    });
    const stopLive = subscribeLive((event) => {
      if (event.event_id !== null) {
        if (seen.has(event.event_id)) return;
        seen.add(event.event_id);
        order.push(event.event_id);
        if (order.length > SEEN_MAX) seen.delete(order.shift()!);
      }
      const gone = goneOf(event);
      if (gone !== null) {
        refresh.markGone(gone);
        // the item page and the preview say so without asking (F36), the log of a template's runs asks nothing more
        markLiveGone(gone, event.type === 'template.deleted' ? 'template' : 'other');
      }
      if (event.type === 'page.deleted') {
        const { ids, complete } = deletedPages(event);
        ids.forEach(markPageGone);
        // too many to name: the tree of the project tells the rest when the burst loads
        if (!complete && event.project_id !== null) unnamed.add(event.project_id);
      }
      if (event.type === 'live.refused') refusals.push(event.project_id ?? event.item_id);
      // only the person's own channel hears it (K14): the role changed is the person's
      if (event.type === 'user.role_changed') roleChanged = true;
      for (const queryKey of keysOf(event)) burst.set(JSON.stringify(queryKey), queryKey);
      // only a change lights up, never what the browser says about a channel (`live.*`)
      if (event.item_id && !event.type.startsWith('live.')) flashes.add(event.item_id);
      if (quiet !== null) clearTimeout(quiet);
      quiet = setTimeout(flush, LIVE_BURST_MS);
      longest ??= setTimeout(flush, LIVE_MAX_WAIT_MS);
    });

    return () => {
      alive = false;
      clearLiveGone();
      stopLive();
      stopMutations();
      stopUndo();
      stopQueries();
      if (quiet !== null) clearTimeout(quiet);
      if (longest !== null) clearTimeout(longest);
    };
  }, [queryClient]);
}

/** Holds the live channel of the item while a detail (page or preview) shows it: its comments arrive there (A227). */
export function useLiveItem(itemId: string | null): void {
  useEffect(() => (itemId === null ? undefined : watchItem(itemId)), [itemId]);
}
