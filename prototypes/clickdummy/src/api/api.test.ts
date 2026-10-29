import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextOccurrences } from '@/domain/recurrence';
import { asUser, failure, resetApi } from '@/test/api';
import type { Filter, WorkItem } from '@/types';
import { addComment, toggleReaction } from './comments';
import { ApiError, maybeFail } from './client';
import { DB_KEY, getDb, loadDb, migrateDb } from './db';
import { listNotifications, markAllRead, markRead, markUnread } from './notifications';
import { getPage, listPageVersions, listPages, savePage } from './pages';
import { getProject, listProjects, updateProject } from './projects';
import { addRelation, removeRelation } from './relations';
import { search } from './search';
import { listTemplates } from './templates';
import { deactivateUser } from './users';
import { deleteWorkflow, listWorkflows, saveWorkflow } from './workflows';
import { listWebhooks, saveWebhook } from './webhooks';
import {
  archiveWorkItem,
  bulkUpdateWorkItems,
  changeWorkItemType,
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  getWorkItemMeta,
  listActivity,
  listWorkItems,
  transitionWorkItem,
  updateWorkItem,
} from './workItems';
import { isLiveConnected, setLiveConnected, simulateRemoteChange, subscribeLive } from './live';

const filterOf = (...conditions: Filter['conditions']): Filter => ({ version: 1, conditions });

async function itemsIn(project: string, states: string[]): Promise<WorkItem[]> {
  const page = await listWorkItems({
    filter: filterOf({ field: 'project', op: 'is', value: project }, { field: 'state', op: 'in', value: states }),
  });
  return page.items;
}

beforeEach(resetApi);

describe('work items', () => {
  it('createWorkItem numbers per project and starts in the initial state', async () => {
    const web = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Sitemap für die Suche' });
    const app = await createWorkItem({ project_id: 'p_app', type_id: 't_task', title: 'Rückmeldung einholen' });

    expect(web.key).toBe('WEB-57');
    expect(web.number).toBe(57);
    expect(web.state_id).toBe('std_backlog');
    expect(app.key).toBe('APP-25');
    expect(app.state_id).toBe('app_backlog');
    expect((await getWorkItem('WEB-57')).item.id).toBe(web.id);
  });

  it('createWorkItem directly in a non-initial state checks the transition', async () => {
    const error = await failure(
      createWorkItem({ project_id: 'p_app', type_id: 't_task', title: 'Direkt fertig', state_id: 'app_done' }),
    );

    expect(error.status).toBe(409);
    expect(error.reason).toBe('transition_not_allowed');
    // the free Standard workflow allows it and starts the item
    const started = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Gleich los', state_id: 'std_progress' });
    expect(started.state_id).toBe('std_progress');
    expect(started.started_at).not.toBeNull();
  });

  it('createWorkItem without a required property fails', async () => {
    const error = await failure(createWorkItem({ project_id: 'p_app', type_id: 't_wish', title: 'Wunsch ohne Kunde' }));

    expect(error.status).toBe(422);
    expect(error.errors?.['values.customer']).toBeTruthy();

    const created = await createWorkItem({
      project_id: 'p_app',
      type_id: 't_wish',
      title: 'Wunsch mit Kunde',
      values: { customer: 'opt_hafenkontor' },
    });
    expect(created.key).toBe('APP-25');
  });

  it('transitionWorkItem to Done sets resolution res_done and closed_at; reopening clears both', async () => {
    const done = await transitionWorkItem('wi_web_42', 'std_done');
    expect(done.state_id).toBe('std_done');
    expect(done.resolution_id).toBe('res_done');
    expect(done.closed_at).not.toBeNull();

    const reopened = await transitionWorkItem('wi_web_42', 'std_todo');
    expect(reopened.state_id).toBe('std_todo');
    expect(reopened.resolution_id).toBeNull();
    expect(reopened.closed_at).toBeNull();
  });

  it('bulkUpdateWorkItems moves allowed items and reports the rest', async () => {
    const [review] = await itemsIn('p_app', ['app_review']);
    const [todo] = await itemsIn('p_app', ['app_todo']);
    expect(review).toBeDefined();
    expect(todo).toBeDefined();

    const result = await bulkUpdateWorkItems([review.id, todo.id], { state_id: 'app_approval' });

    expect(result.updated).toEqual([review.id]);
    expect(result.rejected).toEqual([{ id: todo.id, reason: 'transition_not_allowed' }]);
    expect((await getWorkItem(review.id)).item.state_id).toBe('app_approval');
    expect((await getWorkItem(todo.id)).item.state_id).toBe('app_todo');
  });

  it('changeWorkItemType drops values the new type lacks', async () => {
    const before = (await getWorkItem('WEB-47')).item;
    expect(Object.keys(before.values).sort()).toEqual(['browser', 'customer', 'effort', 'environment', 'steps']);

    const changed = await changeWorkItemType(before.id, 't_task', {});

    expect(changed.type_id).toBe('t_task');
    expect(changed.values).not.toHaveProperty('environment');
    expect(changed.values).not.toHaveProperty('browser');
    expect(changed.values).not.toHaveProperty('steps');
    expect(changed.values.customer).toBe('opt_nordlicht');
    // the dropped values stay in the history
    const activity = await listActivity(before.id);
    const typeChange = activity.items.find((entry) => entry.kind === 'event' && 'type_id' in entry.event.changes);
    expect(typeChange?.kind === 'event' && typeChange.event.changes['values.environment']).toEqual({
      old: 'opt_env_prod',
      new: null,
    });
  });

  it('changeWorkItemType asks for the required properties of the new type', async () => {
    const error = await failure(changeWorkItemType('wi_app_14', 't_wish', {}));
    expect(error.status).toBe(422);
    expect(error.errors?.['values.customer']).toBeTruthy();
  });

  it('archiveWorkItem refuses open items with 409 not_closed', async () => {
    const error = await failure(archiveWorkItem('wi_web_42'));

    expect(error.status).toBe(409);
    expect(error.reason).toBe('not_closed');

    const closed = await archiveWorkItem('wi_web_39');
    expect(closed.archived_at).not.toBeNull();
  });

  it('updateWorkItem reports a changed description as 409 description_conflict', async () => {
    const item = (await getWorkItem('WEB-42')).item;
    const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

    const saved = await updateWorkItem(item.id, { description: paragraph('Neu') }, { base_description_version: item.description_version });
    expect(saved.description_version).toBe(item.description_version + 1);

    // a second client still edits the old version
    const error = await failure(
      updateWorkItem(item.id, { description: paragraph('Anders') }, { base_description_version: item.description_version }),
    );
    expect(error.status).toBe(409);
    expect(error.reason).toBe('description_conflict');
    expect((error.current as WorkItem).description_version).toBe(saved.description_version);
  });

  it('updateWorkItem validates the fields and returns 422 per field', async () => {
    const error = await failure(updateWorkItem('wi_web_42', { title: '  ', start_date: '2026-11-05', due_date: '2026-11-01' }));

    expect(error.status).toBe(422);
    expect(error.errors?.title).toBeTruthy();
    expect(error.errors?.due_date).toBeTruthy();
  });

  it('transitionWorkItem refuses a move the workflow does not allow', async () => {
    const [todo] = await itemsIn('p_app', ['app_todo']);
    const error = await failure(transitionWorkItem(todo.id, 'app_done'));

    expect(error.status).toBe(409);
    expect(error.reason).toBe('transition_not_allowed');
  });

  it('starting an unassigned item makes the person the assignee (automation Assignee beim Start)', async () => {
    const item = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Selbst starten' });
    const started = await transitionWorkItem(item.id, 'std_progress');

    expect(started.assignee_id).toBe('u_mara');
    const activity = await listActivity(item.id);
    const automation = activity.items.find((entry) => entry.kind === 'event' && entry.event.actor_id === 'u_automation');
    expect(automation?.kind === 'event' && automation.event.reason).toBe('Automatisierung: Assignee beim Start');
  });

  it('closing the last open child closes the parent (automation Eltern schließen)', async () => {
    const epic = await createWorkItem({ project_id: 'p_app', type_id: 't_epic', title: 'Kleines Epic' });
    const child = await createWorkItem({ project_id: 'p_app', type_id: 't_task', title: 'Einziges Kind', parent_id: epic.id });
    await transitionWorkItem(child.id, 'app_todo');
    await transitionWorkItem(child.id, 'app_progress');
    await transitionWorkItem(child.id, 'app_review');
    await transitionWorkItem(child.id, 'app_approval');
    await transitionWorkItem(child.id, 'app_done');

    // the epic is still in the start state, from where Done is not reachable: it stays open
    expect((await getWorkItem(epic.id)).item.state_id).toBe('app_backlog');
    await transitionWorkItem(epic.id, 'app_todo');
    await transitionWorkItem(epic.id, 'app_progress');
    await transitionWorkItem(epic.id, 'app_review');
    await transitionWorkItem(epic.id, 'app_approval');
    const second = await createWorkItem({ project_id: 'p_app', type_id: 't_task', title: 'Zweites Kind', parent_id: epic.id });
    for (const state of ['app_todo', 'app_progress', 'app_review', 'app_approval', 'app_done']) {
      await transitionWorkItem(second.id, state);
    }
    expect((await getWorkItem(epic.id)).item.state_id).toBe('app_done');
  });

  it('a viewer cannot create items, only an admin deletes them', async () => {
    asUser('u_theo'); // viewer in WEB
    const denied = await failure(createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Nicht erlaubt' }));
    expect(denied.status).toBe(403);

    asUser('u_jonas'); // member in WEB
    const notAdmin = await failure(deleteWorkItem('wi_web_55'));
    expect(notAdmin.status).toBe(403);

    asUser('u_mara'); // admin
    await deleteWorkItem('wi_web_55');
    expect((await failure(getWorkItem('wi_web_55'))).status).toBe(404);
  });
});

describe('the parent an item names (parent, beside parent_id)', () => {
  const relaunch = { id: 'wi_web_30', key: 'WEB-30', title: 'Relaunch Phase 1' };

  it('a list names the parent of a child by id, key and title, and none for an epic or an item without a parent', async () => {
    const page = await listWorkItems({ filter: filterOf({ field: 'project', op: 'is', value: 'p_web' }), per_page: 100 });
    const byKey = new Map(page.items.map((item) => [item.key, item]));
    expect(byKey.get('WEB-42')).toMatchObject({ parent_id: 'wi_web_30', parent: relaunch });
    expect(byKey.get('WEB-30')?.parent).toBeNull();
    expect(byKey.get('WEB-44')?.parent).toBeNull();
  });

  it('names the parent also where the filter leaves the parent out', async () => {
    const tasks = await listWorkItems({ filter: filterOf({ field: 'project', op: 'is', value: 'p_web' }, { field: 'type', op: 'is', value: 't_task' }), per_page: 100 });
    expect(tasks.items.some((item) => item.key === 'WEB-30')).toBe(false);
    expect(tasks.items.find((item) => item.key === 'WEB-42')?.parent).toEqual(relaunch);
  });

  it('the detail names the parent of the item and of its children', async () => {
    expect((await getWorkItem('WEB-42')).item.parent).toEqual(relaunch);
    const epic = await getWorkItem('WEB-30');
    expect(epic.item.parent).toBeNull();
    expect(epic.children.length).toBeGreaterThan(0);
    expect(epic.children.every((child) => child.parent?.key === 'WEB-30')).toBe(true);
  });

  it('is computed on every read, so a renamed parent shows at once, and a write answers with it', async () => {
    await updateWorkItem('wi_web_30', { title: 'Relaunch, erste Phase' });
    expect((await getWorkItem('WEB-42')).item.parent?.title).toBe('Relaunch, erste Phase');

    expect((await updateWorkItem('wi_web_44', { parent_id: 'wi_web_30' })).parent).toEqual({ ...relaunch, title: 'Relaunch, erste Phase' });
    expect((await updateWorkItem('wi_web_42', { parent_id: null })).parent).toBeNull();
    const child = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Pressebereich', parent_id: 'wi_web_30' });
    expect(child.parent?.key).toBe('WEB-30');
    // not stored: the stored item has the id only
    expect(getDb().items.find((item) => item.key === 'WEB-44')).not.toHaveProperty('parent');
  });
});

describe('visibility', () => {
  it('search hides private projects from non-members', async () => {
    const asMara = await search('Mail-Limits');
    expect(asMara.items.map((item) => item.key)).toContain('OPS-12');

    asUser('u_ida');
    const asIda = await search('Mail-Limits');
    expect(asIda.items.map((item) => item.key)).not.toContain('OPS-12');
    expect(asIda.items).toEqual([]);
  });

  it('lists only the items and projects the person may see', async () => {
    asUser('u_ida');
    const projects = await listProjects();
    expect(projects.items.map((project) => project.identifier)).toEqual(['WEB', 'APP']);

    const items = await listWorkItems({ per_page: 100 });
    expect(items.items.every((item) => item.project_id !== 'p_ops')).toBe(true);
    expect((await failure(getWorkItem('OPS-12'))).status).toBe(404);
    expect((await failure(getProject('OPS'))).status).toBe(404);
  });

  it('shows a relation to an item the person may not see as hidden, without the item', async () => {
    const asMara = await getWorkItem('WEB-47');
    expect(asMara.relations).toHaveLength(2); // blocked by OPS-12 and tested by WEB-54

    asUser('u_ida');
    const asIda = await getWorkItem('WEB-47');
    const blocker = asIda.relations.find((entry) => entry.relation.id === asMara.relations.find((r) => r.other?.key === 'OPS-12')?.relation.id);
    expect(blocker).toMatchObject({ hidden: true, other: null, direction: 'inward' });
  });

  it('does not give away the key or the id of a hidden item in the detail of an item', async () => {
    expect(JSON.stringify(await getWorkItem('WEB-47'))).toContain('wi_ops_12'); // Mara sees it
    await addRelation('wi_web_50', 'rt_blocks', 'wi_ops_14'); // WEB-50 blocks an item of OPS

    asUser('u_ida');
    for (const key of ['WEB-47', 'WEB-50']) {
      const detail = await getWorkItem(key);
      // item ids spell the key (`wi_ops_12`), so the id is as telling as the key
      expect(JSON.stringify(detail), key).not.toMatch(/wi_ops_|OPS-/i);
      const hidden = detail.relations.filter((entry) => entry.hidden);
      expect(hidden, key).toHaveLength(1);
      expect(hidden[0]).toMatchObject({ other: null, hidden: true });
    }

    // what Ida may see of the relation stays: its id and type and her own item; the other end is blanked
    const blockedBy = (await getWorkItem('WEB-47')).relations.find((entry) => entry.hidden)!;
    expect(blockedBy).toMatchObject({ direction: 'inward', relation: { type_id: 'rt_blocks', source_id: '', target_id: 'wi_web_47' } });
    expect(blockedBy.relation.id).toBeTruthy();
    const blocks = (await getWorkItem('WEB-50')).relations.find((entry) => entry.hidden)!;
    expect(blocks).toMatchObject({ direction: 'outward', relation: { type_id: 'rt_blocks', source_id: 'wi_web_50', target_id: '' } });
  });

  it('does not give away the key or the id of a hidden item in the history either', async () => {
    // Mara links WEB-50 to OPS-14 and takes the link away again
    const relation = await addRelation('wi_web_50', 'rt_relates', 'wi_ops_14');
    await removeRelation(relation.id);
    const relationEvents = async () =>
      (await listActivity('WEB-50')).items.flatMap((entry) => (entry.kind === 'event' && entry.event.type.startsWith('work_item.relation_') ? [entry.event] : []));

    // Mara sees the other item by its current key
    const seen = await relationEvents();
    expect(seen.map((event) => [event.type, event.changes.relation])).toEqual([
      ['work_item.relation_added', { old: null, new: { label: 'verwandt mit', item_id: 'wi_ops_14', key: 'OPS-14' } }],
      ['work_item.relation_removed', { old: { label: 'verwandt mit', item_id: 'wi_ops_14', key: 'OPS-14' }, new: null }],
    ]);

    asUser('u_ida');
    expect(JSON.stringify(await listActivity('WEB-50'))).not.toMatch(/wi_ops_|OPS-/i);
    const hidden = await relationEvents();
    expect(hidden.map((event) => event.changes.relation)).toEqual([
      { old: null, new: { label: 'verwandt mit', hidden: true } },
      { old: { label: 'verwandt mit', hidden: true }, new: null },
    ]);
  });

  it('names a related item in the history by its current key, also after its project got a new identifier', async () => {
    await addRelation('wi_web_50', 'rt_relates', 'wi_web_51');
    await updateProject('p_web', { identifier: 'SITE' });

    const event = (await listActivity('SITE-50')).items.flatMap((entry) => (entry.kind === 'event' ? [entry.event] : [])).find((e) => e.type === 'work_item.relation_added');

    expect(event?.changes.relation).toEqual({ old: null, new: { label: 'verwandt mit', item_id: 'wi_web_51', key: 'SITE-51' } });
    // the event itself keeps the id of the other item and no key
    const stored = getDb().events.find((entry) => entry.type === 'work_item.relation_added' && entry.subject.id === 'wi_web_50');
    expect(stored?.changes.relation).toEqual({ old: null, new: { label: 'verwandt mit', item_id: 'wi_web_51' } });
  });
});

describe('projects', () => {
  it('keeps the old identifier as an alias after a rename', async () => {
    const project = await updateProject('p_web', { identifier: 'SITE' });
    expect(project.identifier).toBe('SITE');

    const viaOldKey = await getWorkItem('WEB-47');
    expect(viaOldKey.item.key).toBe('SITE-47');
    expect((await getProject('web')).identifier).toBe('SITE');
    // the number counter continues under the new identifier
    const created = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Nach dem Umbenennen' });
    expect(created.key).toBe('SITE-57');
  });
});

describe('wiki', () => {
  it('savePage with a stale base_version returns 409 page_conflict with the current page', async () => {
    const page = await getPage('pg_web_structure');
    expect(page.version).toBe(3);

    const error = await failure(
      savePage(page.id, { title: page.title, emoji: page.emoji, content: page.content, base_version: page.version - 1 }),
    );

    expect(error.status).toBe(409);
    expect(error.reason).toBe('page_conflict');
    expect(error.current).toMatchObject({ id: page.id, version: 3, title: 'Seitenstruktur' });
  });

  it('the first save of "Seitenstruktur" reports a simulated conflict; taking my version adds a version', async () => {
    const page = await getPage('pg_web_structure');
    expect(page.simulate_conflict_once).toBe(true);
    const versionsBefore = (await listPageVersions(page.id)).total;
    expect(versionsBefore).toBe(3);

    const mine = { title: page.title, emoji: page.emoji, content: page.content, base_version: page.version };
    const conflict = await failure(savePage(page.id, mine));
    expect(conflict.reason).toBe('page_conflict');
    const foreign = conflict.current as typeof page;
    expect(foreign.version).toBe(page.version + 1);
    expect(foreign.updated_by).not.toBe('u_mara');

    // "Meine Fassung übernehmen": save again on top of the foreign version
    const saved = await savePage(page.id, { ...mine, base_version: foreign.version });
    expect(saved.version).toBe(foreign.version + 1);
    expect(saved.updated_by).toBe('u_mara');
    expect(saved.simulate_conflict_once).toBeFalsy();
    expect((await listPageVersions(page.id)).total).toBe(versionsBefore + 1);
  });

  it('lists the pages of a project as a tree: WEB 12 pages in three levels, APP 4, OPS 3', async () => {
    const count = (nodes: { children: unknown[] }[]): number =>
      nodes.reduce((sum, node) => sum + 1 + count(node.children as { children: unknown[] }[]), 0);
    const depth = (nodes: { children: unknown[] }[]): number =>
      nodes.length === 0 ? 0 : 1 + Math.max(...nodes.map((node) => depth(node.children as { children: unknown[] }[])));

    const web = await listPages('p_web');
    expect(web.total).toBe(12);
    expect(count(web.items)).toBe(12);
    expect(depth(web.items)).toBe(3);
    expect((await listPages('p_app')).total).toBe(4);
    expect((await listPages('p_ops')).total).toBe(3);
  });
});

describe('people', () => {
  it('deactivateUser refuses the last active admin', async () => {
    const error = await failure(deactivateUser('u_mara'));

    expect(error.status).toBe(409);
    expect(error.reason).toBe('last_admin');
    // the default bot is an admin as well, but it does not count and cannot be deactivated itself
    expect((await failure(deactivateUser('u_automation'))).status).toBe(409);
  });
});

describe('db', () => {
  it('db falls back to the seed on an old schema_version or broken JSON', async () => {
    localStorage.setItem(DB_KEY, '{"schema_version": 1, "users": [');
    expect(loadDb().organization.name).toBe('Feldwerk');

    const stale = JSON.parse(JSON.stringify(getDb()));
    stale.schema_version = 0;
    stale.organization.name = 'Alter Stand';
    localStorage.setItem(DB_KEY, JSON.stringify(stale));
    const reloaded = loadDb();

    expect(reloaded.organization.name).toBe('Feldwerk');
    expect(reloaded.schema_version).toBeGreaterThan(0);
    // the seed was written back, so the next start reads it as it is
    expect(JSON.parse(localStorage.getItem(DB_KEY) ?? '{}').organization.name).toBe('Feldwerk');
    expect((await listProjects()).total).toBe(3);
  });

  it('migrateDb accepts the seed and refuses a document that lacks any one of its collections', () => {
    const stored = JSON.parse(JSON.stringify(getDb()));
    expect(migrateDb(stored)).not.toBeNull();

    // every key of the document is checked, so a collection added later cannot be forgotten
    for (const key of Object.keys(stored)) {
      const { [key]: _removed, ...rest } = stored;
      expect(migrateDb(rest), `without ${key}`).toBeNull();
    }
    expect(migrateDb(null)).toBeNull();
    expect(migrateDb('{}')).toBeNull();
  });

  it('a session that points to nobody falls back to Mara, one that points to a deactivated account is refused', async () => {
    asUser('u_gone'); // e.g. stored before the seed changed
    expect((await getWorkItem('WEB-47')).subscribed).toBe(true); // Mara watches it

    asUser('u_sven');
    const error = await failure(listProjects());
    expect(error).toMatchObject({ status: 401, reason: 'account_disabled' });
  });

  it('keeps changes across a reload from localStorage', async () => {
    await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Bleibt erhalten' });

    const reloaded = loadDb();

    expect(reloaded.items.some((item) => item.title === 'Bleibt erhalten')).toBe(true);
  });

  it('a failed call leaves no half-applied change behind', async () => {
    const before = getDb().items.length;
    // the title is valid, the required property is missing: nothing may be created
    await failure(createWorkItem({ project_id: 'p_app', type_id: 't_wish', title: 'Halber Wunsch' }));

    expect(getDb().items.length).toBe(before);
    expect(getDb().counters.p_app).toBe(24);
  });
});

describe('latency', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('every function waits between 150 and 450 ms outside of tests, and not at all in tests', async () => {
    // in tests the answer comes without a timer
    vi.useFakeTimers();
    await expect(listProjects()).resolves.toMatchObject({ total: 3 });

    vi.stubEnv('MODE', 'development');
    for (const [random, wait] of [[0, 150], [0.999, 450]] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      let done = false;
      const call = listProjects().then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(wait - 2);
      expect(done, `${wait} ms: not yet`).toBe(false);
      await vi.advanceTimersByTimeAsync(3);
      await call;
      expect(done, `${wait} ms: done`).toBe(true);
      vi.restoreAllMocks();
    }
  });
});

describe('simulated failures', () => {
  it('maybeFail throws 503 simulated when api:fail is set', async () => {
    expect(() => maybeFail()).not.toThrow();

    localStorage.setItem('api:fail', '1');

    let thrown: unknown;
    try {
      maybeFail();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ status: 503, reason: 'simulated' });
    // every API function fails the same way
    expect((await failure(listProjects())).reason).toBe('simulated');
    expect((await failure(getWorkItem('WEB-47'))).status).toBe(503);

    localStorage.removeItem('api:fail');
    expect((await listProjects()).total).toBe(3);
  });
});

describe('seed: the moodboard demo content', () => {
  it('has the board cards with key, type, title, state and priority', async () => {
    const expected: [key: string, type: string, title: string, state: string | null, priority: string | null][] = [
      ['WEB-51', 't_task', 'Cookie-Banner auf Consent v2 umstellen', 'std_backlog', 'low'],
      ['WEB-55', 't_task', 'Bildformate auf AVIF prüfen', 'std_backlog', 'none'],
      ['WEB-48', 't_task', 'Navigation für Mobilgeräte überarbeiten', 'std_todo', 'high'],
      ['WEB-50', 't_task', 'Fehlerseite 404 gestalten', 'std_todo', 'medium'],
      ['WEB-30', 't_epic', 'Relaunch Phase 1', 'std_progress', null],
      ['WEB-42', 't_task', 'Startseite: Hero und Teaser bauen', 'std_progress', 'high'],
      ['WEB-47', 't_bug', 'Kontaktformular sendet doppelt', 'std_progress', 'urgent'],
      ['WEB-45', 't_task', 'Texte der Leistungsseiten', 'std_pending', 'medium'],
      ['WEB-39', 't_task', 'Domain auf neuen Server umziehen', 'std_done', null],
      ['WEB-40', 't_bug', 'Favicon fehlt im Safari', 'std_done', null],
      ['APP-5', 't_epic', 'Kunden-App 2.0 Beta', 'app_progress', null],
      ['APP-12', 't_task', 'Kontaktdaten im Profil bearbeiten', null, null],
      ['OPS-3', 't_epic', 'Server-Migration', 'std_progress', null],
      ['OPS-12', 't_task', 'Mail-Limits am Server erhöhen', 'std_todo', null],
    ];

    for (const [key, type, title, state, priority] of expected) {
      const { item } = await getWorkItem(key);
      expect(item.key, key).toBe(key);
      expect(item.type_id, key).toBe(type);
      expect(item.title, key).toBe(title);
      if (state) expect(item.state_id, key).toBe(state);
      if (priority) expect(item.priority, key).toBe(priority);
    }
  });

  it('has WEB-48 and WEB-42 as children of the epic WEB-30 and the card details of the moodboard', async () => {
    const epic = await getWorkItem('WEB-30');
    expect(epic.children.map((child) => child.key)).toEqual(expect.arrayContaining(['WEB-42', 'WEB-48']));
    expect(epic.item.start_date).toBe('2026-10-01');
    expect(epic.item.due_date).toBe('2026-11-15');

    const lene = (await getWorkItem('WEB-48')).item;
    expect(lene).toMatchObject({ assignee_id: 'u_lene', label_ids: ['lb_ux'] });
    const hero = (await getWorkItem('WEB-42')).item;
    expect(hero).toMatchObject({ assignee_id: 'u_ida', due_date: '2026-10-30' });
    const pending = (await getWorkItem('WEB-45')).item;
    expect(pending.values.customer).toBe('opt_nordlicht');
  });

  it('shows WEB-47 as the side panel of the moodboard does', async () => {
    const detail = await getWorkItem('WEB-47');
    const { item } = detail;

    expect(detail.type.name).toBe('Bug');
    expect(detail.state.name).toBe('In Progress');
    expect(item).toMatchObject({
      assignee_id: 'u_jonas',
      priority: 'urgent',
      start_date: '2026-10-27',
      due_date: '2026-10-31',
    });
    expect([...item.label_ids].sort()).toEqual(['lb_forms', 'lb_production']);
    expect(item.values).toMatchObject({ customer: 'opt_nordlicht', effort: 3.5 });

    const blocker = detail.relations.find((entry) => entry.other?.key === 'OPS-12');
    expect(blocker).toMatchObject({ direction: 'inward', hidden: false });
    expect(blocker?.other?.title).toBe('Mail-Limits am Server erhöhen');

    const description = JSON.stringify(item.description);
    expect(description).toContain('Beim Absenden über Safari kommen zwei Mails an. ');
    expect(description).toContain('"type":"mention"');
    expect(description).toContain('"id":"u_mara"');
    expect(description).toContain(' kannst du prüfen, ob das mit WEB-42 zusammenhängt?');
  });

  it('has the activity of WEB-47: comment with two thumbs up, priority change, automation entry', async () => {
    const { items } = await listActivity('WEB-47');

    const comment = items.find((entry) => entry.kind === 'comment' && entry.comment.author_id === 'u_mara');
    expect(comment?.kind === 'comment' && JSON.stringify(comment.comment.body)).toContain('Kann ich reproduzieren, nur unter iOS 18.');
    expect(comment?.kind === 'comment' && comment.comment.reactions).toEqual([
      { emoji: '👍', user_ids: expect.arrayContaining(['u_ida', 'u_jonas']) },
    ]);

    const events = items.flatMap((entry) => (entry.kind === 'event' ? [entry.event] : []));
    expect(events.find((event) => event.actor_id === 'u_ida' && event.changes.priority)?.changes.priority).toEqual({
      old: 'high',
      new: 'urgent',
    });
    const automation = events.find((event) => event.actor_id === 'u_automation');
    expect(automation?.changes.assignee_id).toEqual({ old: null, new: 'u_jonas' });
    expect(automation?.reason).toBe('Automatisierung: Assignee beim Start');
  });

  it('gives the three epics of the timeline their period and progress', async () => {
    const meta = await getWorkItemMeta();
    const epics: [key: string, start: string, due: string, done: number, total: number][] = [
      ['WEB-30', '2026-10-01', '2026-11-15', 6, 10],
      ['APP-5', '2026-10-20', '2026-12-20', 2, 8],
      ['OPS-3', '2026-09-01', '2026-10-31', 9, 10],
    ];
    for (const [key, start, due, done, total] of epics) {
      const { item } = await getWorkItem(key);
      expect(item.start_date, key).toBe(start);
      expect(item.due_date, key).toBe(due);
      expect(meta.progress[item.id], key).toEqual({ done, total });
    }
  });

  it('answers the command palette query "kontakt" with the two items and the one page of the moodboard', async () => {
    const result = await search('kontakt');

    expect(result.items.map((item) => item.key)).toEqual(['WEB-47', 'APP-12']);
    expect(result.pages.map((page) => page.title)).toEqual(['Kontaktformular – Technik']);
  });

  it('has the sizes of the brief: about 70 items, 3 archived, 15 with history, 3 with attachments', async () => {
    const db = getDb();
    expect(db.items.length).toBeGreaterThanOrEqual(65);
    expect(db.items.length).toBeLessThanOrEqual(80);
    expect(db.items.filter((item) => item.archived_at !== null)).toHaveLength(3);
    expect(Math.max(...db.items.filter((i) => i.project_id === 'p_web').map((i) => i.number))).toBe(56);
    expect(Math.max(...db.items.filter((i) => i.project_id === 'p_app').map((i) => i.number))).toBe(24);
    expect(Math.max(...db.items.filter((i) => i.project_id === 'p_ops').map((i) => i.number))).toBe(15);

    const withHistory = new Set([
      ...db.comments.map((comment) => comment.work_item_id),
      ...db.events.filter((event) => event.subject.type === 'work_item').map((event) => event.subject.id),
    ]);
    expect(withHistory.size).toBe(15);
    expect(new Set(db.attachments.map((attachment) => attachment.owner?.id)).size).toBe(3);
  });

  it('has people, bots, projects and members as in the brief', async () => {
    const db = getDb();
    expect(db.organization).toMatchObject({ name: 'Feldwerk', locale: 'de', timezone: 'Europe/Berlin', week_start: 1 });
    expect(db.users.filter((user) => user.type === 'person').map((user) => user.handle)).toEqual([
      'mara',
      'jonas',
      'ida',
      'theo',
      'lene',
      'sven',
    ]);
    expect(db.users.find((user) => user.handle === 'sven')?.disabled_at).not.toBeNull();
    expect(db.users.find((user) => user.handle === 'automation')).toMatchObject({ is_default_bot: true, org_role: 'admin' });
    expect(db.users.find((user) => user.handle === 'kira')).toMatchObject({ type: 'bot', org_role: 'member', owner_id: 'u_mara' });

    const roleOf = (project: string, user: string) =>
      db.project_members.find((member) => member.project_id === project && member.user_id === user)?.role;
    expect(['u_mara', 'u_ida', 'u_jonas', 'u_lene', 'u_kira', 'u_theo'].map((u) => roleOf('p_web', u))).toEqual([
      'admin',
      'admin',
      'member',
      'member',
      'member',
      'viewer',
    ]);
    expect(['u_theo', 'u_mara', 'u_jonas', 'u_lene'].map((u) => roleOf('p_app', u))).toEqual(['admin', 'member', 'member', 'member']);
    expect(['u_jonas', 'u_mara', 'u_kira'].map((u) => roleOf('p_ops', u))).toEqual(['admin', 'member', 'member']);
    expect(db.project_members.filter((m) => m.project_id === 'p_ops')).toHaveLength(3);
    expect(db.projects.map((p) => [p.identifier, p.visibility, p.lead_id, p.workflow_id])).toEqual([
      ['WEB', 'public', 'u_ida', 'wf_standard'],
      ['APP', 'public', 'u_theo', 'wf_agency'],
      ['OPS', 'private', 'u_jonas', 'wf_standard'],
    ]);
  });

  it('has types, properties and catalogs as in the brief', async () => {
    const db = getDb();
    const propsOf = (type: string) => db.types.find((t) => t.id === type)?.properties.map((p) => p.property_id.replace('pr_', ''));
    expect(propsOf('t_task')).toEqual(['customer', 'effort']);
    expect(propsOf('t_bug')).toEqual(['customer', 'effort', 'environment', 'browser', 'steps']);
    expect(propsOf('t_epic')).toEqual(['target_quarter', 'customer']);
    expect(propsOf('t_wish')).toEqual(['customer', 'ticket_url', 'approved', 'reviewer']);
    expect(db.types.find((t) => t.id === 't_bug')?.properties.find((p) => p.property_id === 'pr_environment')?.required).toBe(true);
    expect(db.types.find((t) => t.id === 't_wish')?.properties.find((p) => p.property_id === 'pr_customer')?.required).toBe(true);
    expect(db.types.map((t) => [t.name, t.tone, t.icon, t.is_epic])).toEqual([
      ['Task', 'sky', 'square-check', false],
      ['Bug', 'ochre', 'bug', false],
      ['Epic', 'moss', 'zap', true],
      ['Kundenwunsch', 'plum', 'message-square-heart', false],
    ]);

    const property = (key: string) => db.properties.find((p) => p.key === key);
    expect(property('customer')?.options.map((o) => o.label)).toEqual(['Studio Nordlicht', 'Hafenkontor', 'Gärtnerei Moos']);
    expect(property('environment')?.options.map((o) => o.label)).toEqual(['Produktion', 'Staging', 'Lokal']);
    expect(property('target_quarter')?.options.map((o) => o.label)).toEqual(['Q4 2026', 'Q1 2027', 'Q2 2027']);
    expect(property('effort')).toMatchObject({ label: 'Aufwand (h)', field_type: 'number', settings: { decimals: 1 } });
    expect(
      ['browser', 'ticket_url', 'approved', 'reviewer', 'steps'].map((key) => property(key)?.field_type),
    ).toEqual(['text', 'url', 'boolean', 'member', 'rich_text']);

    expect(db.labels.map((l) => l.name)).toEqual([
      'UX',
      'Formulare',
      'Produktion',
      'Performance',
      'SEO',
      'Barrierefreiheit',
      'Backend',
      'Design',
    ]);
    expect(db.relation_types.map((r) => r.name)).toEqual(['blockiert', 'Duplikat', 'verwandt', 'testet']);
    expect(db.relation_types.find((r) => r.name === 'testet')).toMatchObject({
      outward_label: 'testet',
      inward_label: 'wird getestet von',
      built_in: null,
    });
    expect(db.resolutions.map((r) => r.label)).toEqual(['Done', "Won't do", 'Duplicate', 'Cannot reproduce']);
  });

  it('has the views, Maras favorites, templates, automations, notifications, webhooks, tokens and system status', async () => {
    const db = getDb();
    expect(db.views.map((v) => [v.name, v.display.layout])).toEqual([
      ['Fällig diese Woche', 'list'],
      ['Bugs in Produktion', 'board'],
      ['Für Kira', 'list'],
      ['Studio Nordlicht', 'table'],
      ['Roadmap', 'timeline'],
      ['Blockiert', 'list'],
    ]);
    expect(db.views[0].display.group_by).toBe('project');
    const maras = db.favorites.filter((f) => f.user_id === 'u_mara');
    expect(maras.filter((f) => f.kind === 'view').map((f) => db.views.find((v) => v.id === f.id)?.name)).toEqual([
      'Fällig diese Woche',
      'Bugs in Produktion',
      'Für Kira',
    ]);
    // the sidebar lists favorite projects, so the three projects are Maras favorites as well
    expect(maras.filter((f) => f.kind === 'project').map((f) => f.id)).toEqual(['p_web', 'p_app', 'p_ops']);

    const templates = (await listTemplates()).items;
    expect(templates.map((t) => [t.project_id, t.name, t.payload.title])).toEqual([
      ['p_web', 'Wöchentliche Wartung', 'Wartung KW {week}'],
      ['p_app', 'Monatsbericht', 'Monatsbericht {month_name} {year}'],
      ['p_ops', 'Zertifikate prüfen', expect.any(String)],
    ]);
    expect(templates[0].payload).toMatchObject({ assignee_id: 'u_jonas', due_offset_days: 2 });
    expect(templates[1].payload.assignee_id).toBe('u_theo');
    expect(templates[2].schedule).toMatchObject({ frequency: 'monthly', month_day: 1, time: '07:00', paused: true });
    expect(getDb().template_runs.find((run) => run.template_id === 'tpl_ops_certs' && run.status === 'failed')?.error).toBe(
      'Pflicht-Property Umgebung fehlt',
    );

    const auto = (project: string) =>
      db.automations.filter((a) => a.project_id === project && a.enabled).map((a) => a.key).sort();
    expect(auto('p_web')).toEqual(['assign_on_start', 'auto_archive']);
    expect(auto('p_app')).toEqual(['auto_close', 'close_parent']);
    expect(auto('p_ops')).toEqual([]);
    expect(db.automations.find((a) => a.project_id === 'p_web' && a.key === 'auto_archive')?.settings.days).toBe(30);
    expect(db.automations.find((a) => a.project_id === 'p_app' && a.key === 'auto_close')?.settings).toEqual({
      days: 90,
      state_id: 'app_cancelled',
    });

    const notifications = (await listNotifications()).items;
    expect(notifications).toHaveLength(14);
    expect(notifications.filter((n) => n.read_at === null)).toHaveLength(3);
    expect(new Set(notifications.map((n) => n.event))).toEqual(
      new Set(['mentioned', 'assigned', 'comment', 'state_changed', 'due', 'template_run_failed', 'webhook_disabled', 'item_changed']),
    );

    const webhooks = (await listWebhooks()).items;
    expect(webhooks.map((w) => [w.name, w.project_id, w.bot_id, w.events, w.active])).toEqual([
      ['Deploy-Bot', null, null, ['work_item.state_changed'], true],
      ['Kira-Agent', null, 'u_kira', ['bot.*'], true],
      ['Altes CRM', 'p_app', null, expect.any(Array), false],
    ]);
    expect(webhooks[2].disabled_at).not.toBeNull();
    for (const webhook of webhooks) {
      expect(db.webhook_deliveries.some((delivery) => delivery.webhook_id === webhook.id), webhook.name).toBe(true);
    }

    expect(db.tokens.map((t) => [t.user_id, t.name, t.abilities])).toEqual([
      ['u_mara', 'Claude Code', ['read', 'write', 'mcp']],
      ['u_mara', 'CI-Skript', ['read']],
      ['u_kira', 'Agent', ['read', 'write', 'mcp']],
    ]);
    expect(new Date(db.tokens[1].expires_at ?? '9999').getTime()).toBeLessThan(Date.parse('2026-10-28T09:00:00Z'));
    expect(db.system).toMatchObject({ version: '0.1.0-dev', queued_jobs: 3, search: 'ok', mail_configured: true });
    expect(db.system.failed_jobs).toHaveLength(2);
  });

  it('schedules "Monatsbericht" on the first Mondays the e2e flow expects', async () => {
    const report = (await listTemplates('p_app')).items[0];
    const now = new Date('2026-10-28T09:00:00Z');

    const next = nextOccurrences(report.schedule!, now, 5, 'Europe/Berlin', report.run_count).map((at) =>
      new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium' }).format(at),
    );

    expect(next).toEqual(['02.11.2026', '07.12.2026', '04.01.2027', '01.02.2027', '01.03.2027']);
    expect(report.next_run_at).toBe('2026-11-02T08:00:00.000Z');
  });

  it('is consistent: workflows, types, labels, parents, ranks, closing data and ids', async () => {
    const db = getDb();
    const workflows = new Map(db.workflows.map((w) => [w.id, w]));
    const keys = new Set<string>();
    const ids = new Set<string>();

    for (const item of db.items) {
      const project = db.projects.find((p) => p.id === item.project_id)!;
      const workflow = workflows.get(project.workflow_id)!;
      const state = workflow.states.find((s) => s.id === item.state_id);
      const type = db.types.find((t) => t.id === item.type_id);
      const closed = state?.category === 'completed' || state?.category === 'canceled';

      expect(state, `${item.key} state`).toBeDefined();
      expect(type, `${item.key} type`).toBeDefined();
      expect(project.enabled_type_ids, `${item.key} type enabled`).toContain(item.type_id);
      expect(item.key, item.id).toBe(`${project.identifier}-${item.number}`);
      expect(keys.has(item.key), `${item.key} unique`).toBe(false);
      expect(ids.has(item.id), `${item.id} unique`).toBe(false);
      keys.add(item.key);
      ids.add(item.id);
      expect(item.label_ids.every((id) => db.labels.some((l) => l.id === id)), `${item.key} labels`).toBe(true);
      if (item.assignee_id) expect(db.users.some((u) => u.id === item.assignee_id), `${item.key} assignee`).toBe(true);
      expect(db.users.some((u) => u.id === item.created_by), `${item.key} creator`).toBe(true);
      if (item.parent_id) {
        const parent = db.items.find((p) => p.id === item.parent_id);
        expect(parent?.project_id, `${item.key} parent in the same project`).toBe(item.project_id);
        expect(parent?.parent_id, `${item.key} no grandparents in the demo`).toBeNull();
        // two levels (correction round 2026-10-29): the parent is an epic, the child is none
        expect(db.types.find((t) => t.id === parent?.type_id)?.is_epic, `${item.key} parent is an epic`).toBe(true);
        expect(type?.is_epic, `${item.key} under a parent is no epic`).toBe(false);
      }
      // closing data goes together with the category
      expect(item.closed_at !== null, `${item.key} closed_at`).toBe(closed);
      expect(item.resolution_id !== null, `${item.key} resolution`).toBe(closed);
      if (item.archived_at) expect(closed, `${item.key} archived only when closed`).toBe(true);
      if (state?.category === 'started') expect(item.started_at, `${item.key} started_at`).not.toBeNull();
      // required properties are filled
      for (const { property_id, required } of type!.properties) {
        const key = db.properties.find((p) => p.id === property_id)!.key;
        if (required) expect(item.values[key], `${item.key} ${key}`).toBeTruthy();
      }
      // every value belongs to a property of the type
      const allowed = type!.properties.map((p) => db.properties.find((q) => q.id === p.property_id)!.key);
      expect(Object.keys(item.values).every((key) => allowed.includes(key)), `${item.key} values`).toBe(true);
      expect(item.created_at <= item.updated_at, `${item.key} dates`).toBe(true);
      expect(item.subscriber_ids.every((id) => db.users.some((u) => u.id === id)), `${item.key} subscribers`).toBe(true);
    }

    for (const project of db.projects) {
      const ranks = db.items.filter((i) => i.project_id === project.id).map((i) => i.rank);
      expect(new Set(ranks).size, `${project.identifier} ranks`).toBe(ranks.length);
      expect(db.counters[project.id]).toBe(Math.max(...db.items.filter((i) => i.project_id === project.id).map((i) => i.number)));
    }
    for (const relation of db.relations) {
      expect(db.items.some((i) => i.id === relation.source_id), relation.id).toBe(true);
      expect(db.items.some((i) => i.id === relation.target_id), relation.id).toBe(true);
      expect(db.relation_types.some((t) => t.id === relation.type_id), relation.id).toBe(true);
    }
    for (const page of db.pages) {
      expect(page.parent_id === null || db.pages.some((p) => p.id === page.parent_id), page.title).toBe(true);
    }
    for (const comment of db.comments) {
      expect(db.items.some((i) => i.id === comment.work_item_id), comment.id).toBe(true);
    }
    for (const notification of db.notifications) {
      expect(notification.user_id).toBe('u_mara');
    }
    // the three ordinary workflows of the demo validate
    expect([...workflows.keys()].sort()).toEqual(['wf_agency', 'wf_standard']);
  });
});

describe('views, filters and lists', () => {
  it('applies the filter of a view: "Blockiert" lists the blocked items', async () => {
    const page = await listWorkItems({ view_id: 'v_blocked' });

    expect(page.items.map((item) => item.key).sort()).toEqual(['APP-18', 'WEB-47', 'WEB-49']);
    expect(page.total).toBe(3);
    expect(page.next_cursor).toBeNull();
  });

  it('"Fällig diese Woche" lists open items due Monday to Sunday of the current week, across projects', async () => {
    const page = await listWorkItems({ view_id: 'v_due_week' });
    const projects = new Set(page.items.map((item) => item.project_id));

    expect(projects).toEqual(new Set(['p_web', 'p_app', 'p_ops']));
    expect(page.items.every((item) => item.due_date! >= '2026-10-26' && item.due_date! <= '2026-11-01')).toBe(true);
    expect(page.items.map((item) => item.key)).toContain('WEB-47');
  });

  it('"Bugs in Produktion" only lists bugs found in production', async () => {
    const page = await listWorkItems({ view_id: 'v_prod_bugs' });

    expect(page.items.length).toBeGreaterThanOrEqual(3);
    expect(page.items.every((item) => item.type_id === 't_bug' && item.values.environment === 'opt_env_prod')).toBe(true);
    expect(page.items.map((item) => item.key)).toContain('WEB-47');
  });

  it('hides archived items unless asked and paginates with a cursor', async () => {
    const all = await listWorkItems({ per_page: 100 });
    expect(all.items.some((item) => item.archived_at !== null)).toBe(false);
    const withArchived = await listWorkItems({ per_page: 100, include_archived: true });
    expect(withArchived.total).toBe(all.total + 3);

    const first = await listWorkItems({ per_page: 30 });
    expect(first.items).toHaveLength(30);
    expect(first.next_cursor).not.toBeNull();
    expect(first.total).toBe(all.total);
    const second = await listWorkItems({ per_page: 30, cursor: first.next_cursor });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.items.some((item) => first.items.some((seen) => seen.id === item.id))).toBe(false);
  });

  it('sorts by the given field and defaults to the manual order', async () => {
    const byPriority = await listWorkItems({
      filter: filterOf({ field: 'project', op: 'is', value: 'p_web' }, { field: 'state_category', op: 'is', value: 'started' }),
      sort: { field: 'priority', direction: 'asc' },
    });
    expect(byPriority.items[0].priority).toBe('urgent');

    const manual = await listWorkItems({ filter: filterOf({ field: 'project', op: 'is', value: 'p_web' }) });
    const ranks = manual.items.map((item) => item.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe('comments, notifications and sessions', () => {
  it('adds a comment, toggles a reaction and lists both in the activity', async () => {
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Danke, ist angekommen.' }] }] };
    const comment = await addComment('wi_web_42', body);
    expect(comment.author_id).toBe('u_mara');

    const reacted = await toggleReaction(comment.id, '🎉');
    expect(reacted.reactions).toEqual([{ emoji: '🎉', user_ids: ['u_mara'] }]);
    expect((await toggleReaction(comment.id, '🎉')).reactions).toEqual([]);

    const { items } = await listActivity('wi_web_42');
    expect(items.some((entry) => entry.kind === 'comment' && entry.comment.id === comment.id)).toBe(true);
    // the activity is in chronological order
    const times = items.map((entry) => entry.at);
    expect(times).toEqual([...times].sort());
  });

  it('marks notifications as read and answers the unread count', async () => {
    expect((await listNotifications({ unread_only: true })).total).toBe(3);
    expect((await listNotifications({ mentions_only: true })).items.every((n) => n.event === 'mentioned')).toBe(true);

    const [first] = (await listNotifications({ unread_only: true })).items;
    await markRead([first.id]);
    expect((await listNotifications({ unread_only: true })).total).toBe(2);
    await markAllRead();
    expect((await listNotifications({ unread_only: true })).total).toBe(0);
  });

  it('marks notifications unread again, only those of the signed-in person', async () => {
    // n_02 ("Heute fällig") is read; it joins the three unread ones in its place, newest first
    await markUnread(['n_02']);
    expect((await listNotifications({ unread_only: true })).items.map((n) => n.id)).toEqual(['n_01', 'n_02', 'n_04', 'n_03']);

    // a notification of Jonas, read by him: Mara's call leaves it alone
    asUser('u_theo');
    await updateWorkItem('wi_app_24', { assignee_id: 'u_jonas' });
    asUser('u_jonas');
    const [his] = (await listNotifications({ unread_only: true })).items;
    await markRead([his.id]);
    asUser('u_mara');
    await markUnread([his.id]);
    asUser('u_jonas');
    expect((await listNotifications({ unread_only: true })).items.map((n) => n.id)).not.toContain(his.id);
  });

  it('notifies the watchers when somebody else assigns an item to them', async () => {
    asUser('u_theo');
    await updateWorkItem('wi_app_24', { assignee_id: 'u_jonas' });

    asUser('u_jonas');
    const inbox = await listNotifications({ unread_only: true });
    expect(inbox.items.some((n) => n.event === 'assigned' && n.work_item_id === 'wi_app_24')).toBe(true);
  });
});

describe('configuration', () => {
  it('saveWorkflow refuses a workflow with an unreachable state (422)', async () => {
    const agency = (await listWorkflows()).items.find((w) => w.id === 'wf_agency')!;
    const withoutReviewEntry = { ...agency, transitions: agency.transitions.filter(([from, to]) => !(from === 'app_progress' && to === 'app_review')) };

    const error = await failure(saveWorkflow(withoutReviewEntry));

    expect(error.status).toBe(422);
    expect(error.errors?.unreachable_state?.some((message) => message.includes('Review'))).toBe(true);
    expect(error.extensions.issues).toEqual(expect.arrayContaining([{ code: 'unreachable_state', state_id: 'app_review' }]));
  });

  it('deleteWorkflow refuses a workflow in use with 409 in_use', async () => {
    const error = await failure(deleteWorkflow('wf_agency'));
    expect(error.status).toBe(409);
    expect(error.reason).toBe('in_use');
  });

  it('returns the webhook secret only when creating one', async () => {
    const created = await saveWebhook({
      name: 'Neuer Hook',
      url: 'https://hooks.example.com/neu',
      project_id: null,
      events: ['work_item.*'],
      bot_id: null,
      active: true,
    });
    expect(created.secret).toMatch(/^whsec_/);

    const listed = (await listWebhooks()).items.find((hook) => hook.id === created.webhook.id);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain('whsec_');

    const updated = await saveWebhook({ ...created.webhook, name: 'Umbenannt' });
    expect(updated.secret).toBeNull();
    const renewed = await saveWebhook({ ...created.webhook }, { renew_secret: true });
    expect(renewed.secret).toMatch(/^whsec_/);
    expect(renewed.secret).not.toBe(created.secret);
  });
});

describe('live', () => {
  it('simulateRemoteChange lets Ida change a WEB item, writes an event and tells the subscribers', async () => {
    const received: { type: string; item_id?: string; actor_id: string }[] = [];
    const unsubscribe = subscribeLive((event) => received.push(event));
    const watching = new Set(getDb().items.filter((item) => item.project_id === 'p_web').map((item) => item.id));

    const event = await simulateRemoteChange();

    expect(received).toEqual([event]);
    expect(event).toMatchObject({ actor_id: 'u_ida' });
    expect(watching.has(event!.item_id!)).toBe(true); // an item of WEB
    const { items } = await listActivity(event!.item_id!);
    // newest entries last; an automation may have followed Ida's change (assignee on start)
    const byIda = items.filter((entry) => entry.kind === 'event' && entry.event.actor_id === 'u_ida' && entry.event.occurred_at > '2026-10-28T09:00:00.000Z');
    expect(byIda).toHaveLength(1);
    unsubscribe();
    await simulateRemoteChange();
    expect(received).toHaveLength(1);
  });

  it('simulateRemoteChange prefers the items the signed-in person watches, so that the inbox has news', async () => {
    const before = (await listNotifications({ unread_only: true })).total;
    const event = await simulateRemoteChange();

    expect((await getWorkItem(event!.item_id!)).subscribed).toBe(true);
    expect((await listNotifications({ unread_only: true })).total).toBe(before + 1);
  });

  it('delivers nothing while the connection is off, then asks the subscribers to reload', async () => {
    const received: string[] = [];
    subscribeLive((event) => received.push(event.type));

    setLiveConnected(false);
    expect(isLiveConnected()).toBe(false);
    await simulateRemoteChange();
    expect(received).toEqual([]);

    setLiveConnected(true);
    expect(isLiveConnected()).toBe(true);
    expect(received).toEqual(['live.reconnected']);
  });
});
