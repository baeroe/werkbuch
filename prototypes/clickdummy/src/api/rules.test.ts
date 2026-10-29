/*
 * What the fake API owed after Task 3: the effects of creating an item in a later state, the notifications for the
 * other changes, notifications that follow what a person still sees, the order of a bulk edit, one answer for an
 * unknown resolution, ids of bots, the schema version, attachments to read, and uploads that find their owner.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { asUser, failure, resetApi } from '@/test/api';
import type { RichText } from '@/types';
import { getAttachment, uploadAttachment } from './attachments';
import { addComment, editComment } from './comments';
import { DB_KEY, getDb, loadDb, saveDb, SCHEMA_VERSION } from './db';
import { listNotifications } from './notifications';
import { addRelation } from './relations';
import { runTemplateNow, saveTemplate } from './templates';
import { createBot, listUsers, updateUser } from './users';
import {
  bulkUpdateWorkItems,
  changeWorkItemType,
  createWorkItem,
  getWorkItem,
  listActivity,
  transitionWorkItem,
  updateWorkItem,
} from './workItems';

beforeEach(resetApi);

const png = (name = 'skizze.png') => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
const withImage = (attachmentId: string): RichText => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Siehe Bild:' }] }, { type: 'image', attrs: { attachmentId, alt: 'Skizze' } }],
});
const events = async (itemId: string) => (await listActivity(itemId)).items.flatMap((entry) => (entry.kind === 'event' ? [entry.event] : []));
/** The fields an `item_changed` notification of the signed-in person names for an item. */
const changedFields = async (itemId: string) =>
  (await listNotifications()).items.filter((entry) => entry.event === 'item_changed' && entry.work_item_id === itemId).flatMap((entry) => entry.data.fields ?? []);

describe('creating an item in a later state', () => {
  it('runs what a move runs: the history of the move and the assignee on start', async () => {
    const started = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Gleich los', state_id: 'std_progress' });

    // WEB has "Assignee beim Start"
    expect(started.assignee_id).toBe('u_mara');
    const history = await events(started.id);
    expect(history.find((event) => event.type === 'work_item.state_changed')?.changes.state_id).toEqual({ old: 'std_backlog', new: 'std_progress' });
    expect(history.find((event) => event.type === 'work_item.assigned')).toMatchObject({ actor_id: 'u_automation', reason: 'Automatisierung: Assignee beim Start' });
  });

  it('closes the parent when the new child is its last open one', async () => {
    const db = getDb();
    db.automations.find((entry) => entry.project_id === 'p_web' && entry.key === 'close_parent')!.enabled = true;
    saveDb();
    const epic = await createWorkItem({ project_id: 'p_web', type_id: 't_epic', title: 'Kleines Epic' });

    const child = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Schon erledigt', parent_id: epic.id, state_id: 'std_done' });
    expect([child.resolution_id, child.closed_at !== null]).toEqual(['res_done', true]);
    expect((await getWorkItem(epic.id)).item.state_id).toBe('std_done');
  });
});

describe('notifications for the other changes (spec 4.14)', () => {
  it('tells the lead about a new type, a relation and a file of an item', async () => {
    // Mara changes, Ida leads WEB and hears about everything in it
    const item = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Wird ein Epic' });
    await changeWorkItemType(item.id, 't_epic');
    await addRelation(item.id, 'rt_relates', 'wi_web_47');
    await uploadAttachment('p_web', png('plan.png'), { type: 'work_item', id: item.id }, 'file');

    asUser('u_ida');
    expect(await changedFields(item.id)).toEqual(expect.arrayContaining(['type_id', 'relation', 'attachment']));
    // the other end of the relation hears about it too
    expect(await changedFields('wi_web_47')).toContain('relation');
  });

  it('a failed template run tells only those whose inbox takes it', async () => {
    // Jonas leads OPS, Mara wrote the template; Jonas switched the inbox off for failed templates
    getDb().notification_preferences.push({ user_id: 'u_jonas', event: 'template_run_failed', channel: 'inbox', enabled: false });
    saveDb();
    asUser('u_jonas');
    await runTemplateNow('tpl_ops_certs');

    const failedRuns = async () => (await listNotifications()).items.filter((entry) => entry.event === 'template_run_failed' && entry.created_at.startsWith('2026-10-28'));
    expect(await failedRuns()).toHaveLength(0);
    asUser('u_mara');
    expect(await failedRuns()).toHaveLength(1);
  });

  it('lists only notifications whose item the person can still see', async () => {
    // Mara gives Jonas an OPS item, then Jonas leaves OPS (a private project)
    await updateWorkItem('wi_ops_14', { assignee_id: 'u_jonas' });
    asUser('u_jonas');
    const about = async () => (await listNotifications()).items.filter((entry) => entry.work_item_id === 'wi_ops_14');
    expect((await about()).length).toBeGreaterThan(0);

    const db = getDb();
    db.project_members = db.project_members.filter((member) => !(member.project_id === 'p_ops' && member.user_id === 'u_jonas'));
    saveDb();
    expect(await about()).toHaveLength(0);
    const unread = await listNotifications({ unread_only: true });
    expect(unread.items.some((entry) => entry.project_id === 'p_ops')).toBe(false);
    expect(unread.total).toBe(unread.items.length);
  });
});

describe('bulk edits keep each item whole', () => {
  it('{ archived: true, priority } on an open item refuses it and changes nothing', async () => {
    const before = (await getWorkItem('WEB-43')).item;
    const result = await bulkUpdateWorkItems([before.id], { archived: true, priority: 'urgent' });

    expect(result.rejected).toEqual([{ id: before.id, reason: 'not_closed' }]);
    const after = (await getWorkItem('WEB-43')).item;
    expect([after.priority, after.archived_at, after.updated_at]).toEqual([before.priority, null, before.updated_at]);
  });

  it('{ archived: false } with a patch that is refused leaves the item archived', async () => {
    const archived = (await getWorkItem('WEB-8')).item;
    expect(archived.archived_at).not.toBeNull();
    const result = await bulkUpdateWorkItems([archived.id], { archived: false, label_ids: ['lb_gibt_es_nicht'] });

    expect(result.rejected).toEqual([{ id: archived.id, reason: 'validation_failed' }]);
    expect((await getWorkItem('WEB-8')).item.archived_at).toBe(archived.archived_at);
  });
});

describe('resolutions', () => {
  it('an unknown or archived resolution gives the same 422 in a transition and an update', async () => {
    getDb().resolutions.find((entry) => entry.id === 'res_cannot')!.archived_at = '2026-10-20T10:00:00.000Z';
    saveDb();
    for (const resolution of ['res_gibt_es_nicht', 'res_cannot']) {
      const moved = await failure(transitionWorkItem('wi_web_42', 'std_done', resolution));
      const patched = await failure(updateWorkItem('wi_web_42', { state_id: 'std_done', resolution_id: resolution }));
      expect([moved.status, moved.reason, moved.errors]).toEqual([patched.status, patched.reason, patched.errors]);
      expect(moved.status).toBe(422);
      expect(moved.errors?.resolution_id).toBeTruthy();
    }
    expect((await getWorkItem('wi_web_42')).item.state_id).not.toBe('std_done');
  });
});

describe('who can be assigned: the rule of the pickers', () => {
  const assign = (itemId: string, userId: string) => updateWorkItem(itemId, { assignee_id: userId });

  it('takes members, people and bots, and org admins who are people, also without membership', async () => {
    await assign('wi_web_50', 'u_kira');
    const db = getDb();
    db.project_members = db.project_members.filter((member) => !(member.project_id === 'p_app' && member.user_id === 'u_mara'));
    saveDb();
    await assign('wi_app_16', 'u_mara');
    expect((await getWorkItem('wi_app_16')).item.assignee_id).toBe('u_mara');
  });

  it('refuses a person who only sees a public project, a bot of another project and the default bot without membership', async () => {
    // Ida sees APP, which is public, but is no member of it
    expect((await failure(assign('wi_app_16', 'u_ida'))).errors?.assignee_id).toEqual(['Nur aktive Mitglieder des Projekts und Org-Admins können Items übernehmen.']);
    // Kira works in WEB and OPS, not in APP
    expect((await failure(assign('wi_app_16', 'u_kira'))).errors?.assignee_id).toBeTruthy();
    // Automation is an org admin, but counts only where it is a member
    expect((await failure(assign('wi_web_50', 'u_automation'))).errors?.assignee_id).toBeTruthy();
    getDb().project_members.push({ project_id: 'p_web', user_id: 'u_automation', role: 'member' });
    saveDb();
    await assign('wi_web_50', 'u_automation');
  });
});

describe('bots', () => {
  it('createBot gives an id of its own, also for a handle a person used to have', async () => {
    await updateUser('u_mara', { handle: 'mara-l' });
    const bot = await createBot({ name: 'Mara-Bot', handle: 'mara' });

    expect(bot.id).not.toBe('u_mara');
    const users = (await listUsers()).items;
    expect(users.filter((user) => user.id === bot.id)).toHaveLength(1);
    expect(users.find((user) => user.id === 'u_mara')?.type).toBe('person');
  });
});

describe('the stored document', () => {
  it('replaces a document of schema 1 (relation events still with keys) by the seed', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(1);
    const old = { ...JSON.parse(localStorage.getItem(DB_KEY)!), schema_version: 1 };
    old.items = [];
    localStorage.setItem(DB_KEY, JSON.stringify(old));

    const db = loadDb();
    expect(db.schema_version).toBe(SCHEMA_VERSION);
    expect(db.items.length).toBeGreaterThan(0);
  });
});

describe('attachments', () => {
  it('getAttachment answers an attachment of a project the person sees, and 404 otherwise', async () => {
    const uploaded = await uploadAttachment('p_ops', png(), { type: 'work_item', id: 'wi_ops_12' }, 'inline');
    expect(await getAttachment(uploaded.id)).toMatchObject({ id: uploaded.id, filename: 'skizze.png', url: uploaded.url });

    // Ida does not see OPS
    asUser('u_ida');
    expect((await failure(getAttachment(uploaded.id))).status).toBe(404);
    expect((await failure(getAttachment('att_gibt_es_nicht'))).status).toBe(404);
  });

  it('a comment that holds an upload becomes its owner, also when the upload is edited into it later', async () => {
    const first = await uploadAttachment('p_web', png('erstes.png'), null, 'inline');
    const comment = await addComment('wi_web_47', withImage(first.id));
    expect((await getAttachment(first.id)).owner).toEqual({ type: 'comment', id: comment.id });

    const second = await uploadAttachment('p_web', png('zweites.png'), null, 'inline');
    await editComment(comment.id, withImage(second.id));
    expect((await getAttachment(second.id)).owner).toEqual({ type: 'comment', id: comment.id });
  });

  it('a description or a rich text value that holds an upload makes the item its owner', async () => {
    const created = await uploadAttachment('p_web', png('neu.png'), null, 'inline');
    const steps = await uploadAttachment('p_web', png('schritte.png'), null, 'inline');
    const item = await createWorkItem({
      project_id: 'p_web',
      type_id: 't_bug',
      title: 'Mit Bildern',
      description: withImage(created.id),
      values: { environment: getDb().properties.find((entry) => entry.key === 'environment')!.options[0].id, steps: withImage(steps.id) },
    });
    expect((await getAttachment(created.id)).owner).toEqual({ type: 'work_item', id: item.id });
    expect((await getAttachment(steps.id)).owner).toEqual({ type: 'work_item', id: item.id });

    const later = await uploadAttachment('p_web', png('später.png'), null, 'inline');
    await updateWorkItem(item.id, { description: withImage(later.id) });
    expect((await getAttachment(later.id)).owner).toEqual({ type: 'work_item', id: item.id });
  });

  it('a new template becomes the owner of the uploads in its description and values', async () => {
    const upload = await uploadAttachment('p_web', png('vorlage.png'), null, 'inline');
    const template = await saveTemplate({
      project_id: 'p_web',
      name: 'Mit Bild',
      payload: { type_id: 't_task', title: 'Mit Bild', description: withImage(upload.id), priority: 'none', assignee_id: null, label_ids: [], values: {}, parent_id: null, start_offset_days: null, due_offset_days: null },
      schedule: null,
    });
    expect((await getAttachment(upload.id)).owner).toEqual({ type: 'template', id: template.id });
  });
});
