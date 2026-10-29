import { beforeEach, describe, expect, it } from 'vitest';
import { renderTitle } from '@/domain/placeholders';
import { asUser, failure, resetApi } from '@/test/api';
import type { Display, RichText } from '@/types';
import { listAutomations, saveAutomation } from './automations';
import { deleteAttachment, uploadAttachment } from './attachments';
import { deleteLabel, deleteRelationType, deleteResolution, saveLabel } from './catalog';
import { addComment, deleteComment, editComment } from './comments';
import { getDb } from './db';
import { addRelation, removeRelation } from './relations';
import { deleteNotification, getPreferences, listNotifications, savePreferences } from './notifications';
import { createPage, deletePage, listPages, listPageVersions, movePage, restorePageVersion, savePage, getPage } from './pages';
import {
  addMember,
  createProject,
  getProject,
  joinProject,
  listMembers,
  removeMember,
  updateMemberRole,
  updateProject,
} from './projects';
import { deleteProperty, listProperties, saveProperty } from './properties';
import { search } from './search';
import { getSystemStatus, retryFailedJobs, sendTestMail } from './system';
import { listTemplateRuns, listTemplates, runTemplateNow, saveTemplate } from './templates';
import { createToken, listTokens, revokeToken } from './tokens';
import { createBot, deactivateUser, inviteUser, listInvitations, reactivateUser, updateUser, updateUserRole } from './users';
import { deleteView, listFavorites, saveView, toggleFavorite } from './views';
import { listDeliveries, listWebhooks, pingWebhook, redeliver, saveWebhook, deleteWebhook } from './webhooks';
import { assignWorkflow } from './workflows';
import { deleteWorkItemType, saveWorkItemType } from './workItemTypes';
import { createWorkItem, getWorkItem, getWorkItemMeta, listActivity, listWorkItems, setSubscribed, transitionWorkItem, updateWorkItem } from './workItems';
import { updateOrganization } from './organization';

beforeEach(resetApi);

const DISPLAY: Display = { layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: ['key', 'title'], show_sub_items: true };

const paragraph = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('projects and members', () => {
  it('createProject validates the identifier, makes the creator admin and starts with every automation off', async () => {
    expect((await failure(createProject({ name: 'Kleines Ding', identifier: 'a' }))).errors?.identifier).toBeTruthy();
    expect((await failure(createProject({ name: 'Zweites Web', identifier: 'web' }))).errors?.identifier).toBeTruthy();

    asUser('u_lene');
    const project = await createProject({ name: 'Newsletter', identifier: 'news', visibility: 'private' });

    expect(project).toMatchObject({ identifier: 'NEWS', lead_id: 'u_lene', workflow_id: 'wf_standard', default_type_id: 't_task' });
    expect(getDb().project_members.find((member) => member.project_id === project.id && member.user_id === 'u_lene')?.role).toBe('admin');
    expect((await listAutomations(project.id)).items.every((automation) => !automation.enabled)).toBe(true);
    expect((await createWorkItem({ project_id: project.id, type_id: 't_task', title: 'Das erste Item' })).key).toBe('NEWS-1');
  });

  it('a former identifier stays reserved for the project that had it', async () => {
    await updateProject('p_web', { identifier: 'SITE' });

    expect((await failure(createProject({ name: 'Anderes Web', identifier: 'WEB' }))).errors?.identifier).toBeTruthy();
    // the project itself may go back; the identifier it leaves is the alias then
    expect((await updateProject('p_web', { identifier: 'WEB' })).identifier).toBe('WEB');
    expect((await getWorkItem('SITE-47')).item.key).toBe('WEB-47');
  });

  it('joinProject makes a member of a non-member in a public project; a private project stays hidden', async () => {
    asUser('u_ida');

    expect((await joinProject('APP')).role).toBe('member');
    expect((await failure(joinProject('APP'))).reason).toBe('already_member');
    expect((await failure(joinProject('OPS'))).status).toBe(404);
  });

  it('only project admins manage members, and the lead cannot be removed', async () => {
    asUser('u_jonas'); // member in WEB
    expect((await failure(addMember('p_web', 'u_automation', 'member'))).status).toBe(403);

    asUser('u_ida'); // admin and lead in WEB
    expect((await failure(addMember('p_web', 'u_theo', 'member'))).errors?.user_id).toBeTruthy(); // is a member already
    expect((await failure(addMember('p_web', 'u_sven', 'member'))).errors?.user_id).toBeTruthy(); // is deactivated
    await addMember('p_web', 'u_automation', 'member');
    expect((await updateMemberRole('p_web', 'u_automation', 'viewer')).role).toBe('viewer');
    await removeMember('p_web', 'u_automation');
    expect((await failure(removeMember('p_web', 'u_ida'))).reason).toBe('lead_cannot_leave');

    // listMembers: one project, or all projects the person sees
    expect((await listMembers('p_web')).total).toBe(6);
    expect((await listMembers()).items.some((member) => member.project_id === 'p_ops')).toBe(false);
  });

  it('assignWorkflow moves the items to the mapped states, and every used state needs one', async () => {
    const used = [...new Set((await listWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_ops' }] } })).items.map((item) => item.state_id))];
    const mapping = Object.fromEntries(used.map((state) => [state, state.replace('std_', 'app_')]));

    const error = await failure(assignWorkflow('p_ops', 'wf_agency', { ...mapping, [used[0]]: 'nope' }));
    expect(error.status).toBe(422);
    expect(Object.keys(error.errors ?? {})).toEqual([`mapping.${used[0]}`]);

    const project = await assignWorkflow('p_ops', 'wf_agency', mapping);
    expect(project.workflow_id).toBe('wf_agency');
    const { item } = await getWorkItem('OPS-12');
    expect(item.state_id).toBe('app_todo');
    expect((await getWorkItem('OPS-4')).item).toMatchObject({ state_id: 'app_done', resolution_id: 'res_done' });
    expect((await getProject('OPS')).workflow_id).toBe('wf_agency');
  });
});

describe('configuration of the organisation', () => {
  it('deleteWorkItemType archives a type that has items; an archived type takes no new items', async () => {
    expect(await deleteWorkItemType('t_bug')).toEqual({ outcome: 'archived' });

    const error = await failure(
      createWorkItem({ project_id: 'p_web', type_id: 't_bug', title: 'Noch ein Fehler', values: { environment: 'opt_env_prod' } }),
    );
    expect(error.errors?.type_id).toBeTruthy();

    // a type nobody uses is gone for good
    const idea = await saveWorkItemType({ name: 'Idee', icon: 'lightbulb', tone: 'sand', description: '', is_epic: false, properties: [] });
    expect(await deleteWorkItemType(idea.id)).toEqual({ outcome: 'deleted' });
    expect(getDb().types.some((type) => type.id === idea.id)).toBe(false);
  });

  it('saveProperty refuses the key of a core field and archives options that items use', async () => {
    const core = await failure(saveProperty({ key: 'title', label: 'Titel', field_type: 'text', help: '', default_value: null, settings: {}, options: [] }));
    expect(core.errors?.key).toBeTruthy();

    const properties = (await listProperties()).items;
    const customer = properties.find((property) => property.key === 'customer')!;
    const saved = await saveProperty({ ...customer, options: customer.options.filter((option) => option.id !== 'opt_moos') });
    expect(saved.options.find((option) => option.id === 'opt_moos')?.archived_at).not.toBeNull(); // APP-19 uses it

    const quarter = properties.find((property) => property.key === 'target_quarter')!;
    const trimmed = await saveProperty({ ...quarter, options: quarter.options.filter((option) => option.id !== 'opt_q2_2027') });
    expect(trimmed.options.map((option) => option.id)).toEqual(['opt_q4_2026', 'opt_q1_2027']); // nobody uses Q2 2027

    // key and field type are fixed once saved
    expect((await failure(saveProperty({ ...customer, key: 'client' }))).errors?.key).toBeTruthy();
    expect((await failure(saveProperty({ ...customer, field_type: 'text' }))).errors?.field_type).toBeTruthy();
  });

  it('deleteProperty takes the values off the items and the property off the types', async () => {
    const { affected_items } = await deleteProperty('pr_effort');

    expect(affected_items).toBeGreaterThan(8);
    expect(getDb().items.some((item) => 'effort' in item.values)).toBe(false);
    expect(getDb().types.some((type) => type.properties.some((entry) => entry.property_id === 'pr_effort'))).toBe(false);
  });

  it('deleteLabel takes the label off the items', async () => {
    expect((await getWorkItem('WEB-48')).item.label_ids).toEqual(['lb_ux']);

    const { affected_items } = await deleteLabel('lb_ux');

    expect(affected_items).toBeGreaterThan(2);
    expect((await getWorkItem('WEB-48')).item.label_ids).toEqual([]);
  });

  it('deleteResolution archives a resolution in use and keeps the defaults', async () => {
    expect(await deleteResolution('res_duplicate')).toEqual({ outcome: 'archived' }); // APP-21 carries it
    expect((await failure(deleteResolution('res_done'))).reason).toBe('is_default');
  });

  it('deleteRelationType keeps the built-in types and takes the relations of an own type along', async () => {
    expect((await failure(deleteRelationType('rt_blocks'))).reason).toBe('built_in');

    expect(await deleteRelationType('rt_tests')).toEqual({ affected_relations: 1 });
    expect((await getWorkItem('WEB-47')).relations).toHaveLength(1);
  });

  it('the catalogs and the organisation are for admins only, and a time zone must exist', async () => {
    asUser('u_jonas');
    expect((await failure(saveLabel({ name: 'Neu', color: 'sky' }))).status).toBe(403);
    expect((await failure(updateOrganization({ name: 'Anders' }))).status).toBe(403);

    asUser('u_mara');
    expect((await failure(updateOrganization({ timezone: 'Mars/Olympus' }))).errors?.timezone).toBeTruthy();
    expect((await updateOrganization({ week_start: 0 })).week_start).toBe(0);
  });
});

describe('views and favorites', () => {
  it('saveView creates a view of the signed-in person; only the creator or an admin changes or deletes it', async () => {
    asUser('u_lene');
    const view = await saveView({ name: 'Meine Sicht', icon: 'star', filter: { version: 1, conditions: [] }, display: DISPLAY });
    expect(view.created_by).toBe('u_lene');

    asUser('u_ida');
    expect((await failure(saveView({ ...view, name: 'Gekapert' }))).status).toBe(403);
    expect((await failure(deleteView(view.id))).status).toBe(403);

    asUser('u_mara'); // org admin
    expect((await saveView({ ...view, name: 'Umbenannt' })).name).toBe('Umbenannt');
    await deleteView(view.id);
    expect((await failure(deleteView(view.id))).status).toBe(404);
  });

  it('toggleFavorite puts a view or project into the sidebar and takes it out again', async () => {
    expect(await toggleFavorite({ kind: 'view', id: 'v_roadmap' })).toEqual({ kind: 'view', id: 'v_roadmap', favorite: true });
    expect((await listFavorites()).items.map((favorite) => favorite.id)).toContain('v_roadmap');
    expect((await toggleFavorite({ kind: 'view', id: 'v_roadmap' })).favorite).toBe(false);
    expect((await listFavorites()).items.map((favorite) => favorite.id)).not.toContain('v_roadmap');

    asUser('u_ida'); // does not see OPS
    expect((await failure(toggleFavorite({ kind: 'project', id: 'p_ops' }))).status).toBe(404);
  });
});

describe('relations and watching', () => {
  it('addRelation refuses a relation with itself and a pair that exists (a symmetric type both ways)', async () => {
    expect((await failure(addRelation('wi_web_50', 'rt_blocks', 'wi_web_50'))).errors?.target_id).toBeTruthy();

    const relation = await addRelation('wi_web_50', 'rt_relates', 'wi_web_51');
    expect((await failure(addRelation('wi_web_50', 'rt_relates', 'wi_web_51'))).errors?.target_id).toBeTruthy();
    expect((await failure(addRelation('wi_web_51', 'rt_relates', 'wi_web_50'))).errors?.target_id).toBeTruthy();
    expect((await getWorkItem('WEB-51')).relations[0]).toMatchObject({ direction: 'inward', hidden: false });

    await removeRelation(relation.id);
    expect((await getWorkItem('WEB-51')).relations).toEqual([]);
  });

  it('a blocker blocks while it is open and stops when it closes', async () => {
    await addRelation('wi_web_55', 'rt_blocks', 'wi_web_50');
    let meta = await getWorkItemMeta();
    expect(meta.blocked).toContain('wi_web_50');
    expect(meta.blocking).toContain('wi_web_55');

    await transitionWorkItem('wi_web_55', 'std_done');
    meta = await getWorkItemMeta();
    expect(meta.blocked).not.toContain('wi_web_50');
  });

  it('stopping to watch sticks: only a new mention watches again', async () => {
    expect((await getWorkItem('WEB-47')).subscribed).toBe(true);

    await setSubscribed('wi_web_47', false);
    expect((await getWorkItem('WEB-47')).subscribed).toBe(false);
    await addComment('wi_web_47', paragraph('Noch ein Gedanke von mir.')); // commenting does not bring it back
    expect((await getWorkItem('WEB-47')).subscribed).toBe(false);

    asUser('u_ida');
    await addComment('wi_web_47', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u_mara', label: 'mara' } }, { type: 'text', text: ' schau mal.' }] }] });
    asUser('u_mara');
    expect((await getWorkItem('WEB-47')).subscribed).toBe(true);
  });
});

describe('comments', () => {
  it('a viewer comments; only the author edits; an admin of the project deletes and the history notes it', async () => {
    asUser('u_theo'); // viewer in WEB
    const comment = await addComment('wi_web_50', paragraph('Gute Idee, bitte so lassen.'));
    expect((await editComment(comment.id, paragraph('Gute Idee, bitte genau so.'))).edited_at).not.toBeNull();

    asUser('u_lene'); // member
    expect((await failure(editComment(comment.id, paragraph('Meins!')))).status).toBe(403);
    expect((await failure(deleteComment(comment.id))).status).toBe(403);

    asUser('u_ida'); // admin
    await deleteComment(comment.id);
    const { items } = await listActivity('wi_web_50');
    expect(items.some((entry) => entry.kind === 'comment' && entry.comment.id === comment.id)).toBe(false);
    expect(items.some((entry) => entry.kind === 'event' && entry.event.type === 'comment.deleted')).toBe(true);
    expect((await failure(addComment('wi_web_50', paragraph('   ')))).errors?.body).toBeTruthy();
  });

  it('a mention tells the person and makes them watch the item', async () => {
    await addComment('wi_web_50', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u_jonas', label: 'jonas' } }, { type: 'text', text: ' kannst du die Seite bauen?' }] }] });

    asUser('u_jonas');
    const inbox = await listNotifications({ unread_only: true });
    expect(inbox.items.find((notification) => notification.work_item_id === 'wi_web_50')).toMatchObject({ event: 'mentioned', actor_id: 'u_mara' });
    expect((await getWorkItem('WEB-50')).subscribed).toBe(true);
  });
});

describe('attachments', () => {
  it('uploadAttachment keeps the file as a data URL and shows it on the item', async () => {
    const file = new File(['Hallo Welt'], 'hallo.txt', { type: 'text/plain' });

    const attachment = await uploadAttachment('p_web', file, { type: 'work_item', id: 'wi_web_55' }, 'file');

    expect(attachment).toMatchObject({ filename: 'hallo.txt', mime: 'text/plain', size: 10, kind: 'file', project_id: 'p_web' });
    expect(attachment.url).toMatch(/^data:text\/plain;base64,/);
    expect(atob(attachment.url.split(',')[1])).toBe('Hallo Welt');
    expect((await getWorkItem('WEB-55')).attachments.map((entry) => entry.id)).toEqual([attachment.id]);

    await deleteAttachment(attachment.id);
    expect((await getWorkItem('WEB-55')).attachments).toEqual([]);
  });

  it('uploadAttachment refuses a file the prototype cannot store (413) and a missing owner (422)', async () => {
    const big = new File([new Uint8Array(1_000_001)], 'gross.bin');
    expect((await failure(uploadAttachment('p_web', big, null, 'file'))).status).toBe(413);

    const small = new File(['x'], 'klein.txt', { type: 'text/plain' });
    expect((await failure(uploadAttachment('p_web', small, { type: 'work_item', id: 'wi_nope' }, 'file'))).errors?.owner).toBeTruthy();
    // an upload for an item that is not saved yet belongs to nobody, and createWorkItem takes it over
    const loose = await uploadAttachment('p_web', small, null, 'inline');
    expect(loose.owner).toBeNull();
    const item = await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Mit Bild', attachment_ids: [loose.id] });
    expect(getDb().attachments.find((entry) => entry.id === loose.id)?.owner).toEqual({ type: 'work_item', id: item.id });
  });
});

describe('notifications and settings', () => {
  it('getPreferences gives the defaults of the spec, savePreferences keeps what was changed', async () => {
    const defaults = await getPreferences();
    expect(defaults.filter((row) => row.channel === 'inbox').every((row) => row.enabled)).toBe(true);
    expect(defaults.filter((row) => row.channel === 'mail' && row.enabled).map((row) => row.event)).toEqual(['assigned', 'mentioned', 'comment', 'due']);

    await savePreferences([{ user_id: 'u_mara', event: 'item_changed', channel: 'mail', enabled: true }]);
    expect((await getPreferences()).find((row) => row.event === 'item_changed' && row.channel === 'mail')?.enabled).toBe(true);

    // with the inbox off for an event, nobody is told about it there
    await savePreferences([{ user_id: 'u_mara', event: 'assigned', channel: 'inbox', enabled: false }]);
    asUser('u_theo');
    await updateWorkItem('wi_app_16', { assignee_id: 'u_mara' });
    asUser('u_mara');
    expect((await listNotifications({ unread_only: true })).items.some((notification) => notification.work_item_id === 'wi_app_16')).toBe(false);
  });

  it('deleteNotification removes one of the own notifications', async () => {
    await deleteNotification('n_14');

    expect((await listNotifications()).total).toBe(13);
    expect((await failure(deleteNotification('n_14'))).status).toBe(404);
  });
});

describe('people, bots and tokens', () => {
  it('createToken answers the plain text once; people manage their own tokens and admins those of bots', async () => {
    const { token, plain_text } = await createToken({ user_id: 'u_mara', name: 'Neu', abilities: ['read'] });

    expect(plain_text).toMatch(/^wb_[a-z0-9]{40}$/);
    expect(JSON.stringify((await listTokens('u_mara')).items)).not.toContain(plain_text);
    expect((await listTokens('u_kira')).total).toBe(1); // Mara is an admin and Kira is a bot

    asUser('u_ida');
    expect((await failure(listTokens('u_mara'))).status).toBe(403);
    expect((await failure(listTokens('u_kira'))).status).toBe(403);

    asUser('u_mara');
    await revokeToken(token.id);
    expect((await listTokens('u_mara')).items.map((entry) => entry.id)).not.toContain(token.id);
    expect((await failure(createToken({ user_id: 'u_mara', name: '', abilities: [] }))).errors).toMatchObject({ name: expect.any(Array), abilities: expect.any(Array) });
  });

  it('inviteUser answers a link, replaces the earlier invitation for the address and refuses known addresses', async () => {
    const first = await inviteUser({ email: 'neu@example.com', org_role: 'member' });
    const second = await inviteUser({ email: 'NEU@example.com', org_role: 'admin' });

    expect(first.link).toContain('/invitations/');
    expect(second.link).not.toBe(first.link);
    const list = await listInvitations();
    expect(list.items.map((invitation) => [invitation.email, invitation.org_role])).toEqual([['neu@example.com', 'admin']]);
    expect(new Date(list.items[0].expires_at).getTime() - Date.parse(list.items[0].created_at)).toBe(7 * 86_400_000);
    expect((await failure(inviteUser({ email: 'ida@feldwerk.example.com', org_role: 'member' }))).errors?.email).toBeTruthy();
  });

  it('createBot checks the handle; deactivating an account revokes its tokens', async () => {
    expect((await failure(createBot({ name: 'Doppelt', handle: 'kira' }))).errors?.handle).toBeTruthy();
    expect((await failure(createBot({ name: 'Kurz', handle: 'ab' }))).errors?.handle).toBeTruthy();
    const bot = await createBot({ name: 'Release-Bot', handle: 'release-bot', description: 'Veröffentlicht.' });
    expect(bot).toMatchObject({ type: 'bot', owner_id: 'u_mara', org_role: 'member', email: null });

    expect((await deactivateUser('u_kira')).disabled_at).not.toBeNull();
    expect(getDb().tokens.some((token) => token.user_id === 'u_kira')).toBe(false);
    expect((await reactivateUser('u_kira')).disabled_at).toBeNull();
  });

  it('updateUserRole refuses to demote the last admin; people change their own profile only', async () => {
    expect((await failure(updateUserRole('u_mara', 'member'))).reason).toBe('last_admin');
    await updateUserRole('u_jonas', 'admin');
    expect((await updateUserRole('u_mara', 'member')).org_role).toBe('member');

    asUser('u_lene');
    expect((await updateUser('u_lene', { name: 'Lene V.' })).name).toBe('Lene V.');
    expect((await failure(updateUser('u_ida', { name: 'Nicht deins' }))).status).toBe(403);
    expect((await failure(updateUser('u_lene', { handle: 'mara' }))).errors?.handle).toBeTruthy();
  });

  it('the system page is for admins; retrying the failed jobs puts them back in the queue', async () => {
    asUser('u_jonas');
    expect((await failure(getSystemStatus())).status).toBe(403);

    asUser('u_mara');
    expect(await retryFailedJobs()).toEqual({ retried: 2 });
    expect(await getSystemStatus()).toMatchObject({ queued_jobs: 5, failed_jobs: [] });
    expect(await sendTestMail()).toEqual({ sent_to: 'mara@feldwerk.example.com' });
  });
});

describe('wiki', () => {
  it('createPage appends, movePage reorders and refuses a move into the own subtree, deletePage takes the subtree', async () => {
    const page = await createPage({ project_id: 'p_web', parent_id: 'pg_web_tech', title: 'Neue Seite' });
    expect(page.version).toBe(1);

    await movePage(page.id, null, 'pg_web_handbook');
    const roots = (await listPages('p_web')).items;
    expect(roots.map((node) => node.title)).toEqual(['Neue Seite', 'Projekt-Handbuch', 'Technik', 'Meetings']);

    expect((await failure(movePage('pg_web_tech', 'pg_web_contactform', null))).errors?.parent_id).toBeTruthy();
    // before a page that is not a child of the new parent: refused
    expect((await failure(movePage(page.id, 'pg_web_tech', 'pg_web_kickoff'))).errors?.before_id).toBeTruthy();

    // Technik with Kontaktformular, Hosting, Domain-Umzug and Performance-Budget
    expect(await deletePage('pg_web_tech')).toEqual({ deleted: 5 });
    expect((await listPages('p_web')).total).toBe(8);
    expect((await failure(getPage('pg_web_domain'))).status).toBe(404);
  });

  it('a version is kept after a pause or before a foreign version is overwritten, not after every quick save', async () => {
    const design = await getPage('pg_web_design'); // by Lene, long ago
    const save = (base: number) => savePage(design.id, { title: design.title, emoji: design.emoji, content: paragraph(`Stand ${base}`), base_version: base });

    asUser('u_lene');
    const second = await save(1);
    expect((await listPageVersions(design.id)).total).toBe(1); // the first version, kept after the pause
    const third = await save(second.version);
    expect((await listPageVersions(design.id)).total).toBe(1); // a quick save by the same person adds none

    asUser('u_ida');
    await save(third.version);
    expect((await listPageVersions(design.id)).items.map((version) => version.version)).toEqual([3, 1]); // Lene's version, kept before Ida's save
  });

  it('restorePageVersion makes an older text the current one, as a new version', async () => {
    const versions = (await listPageVersions('pg_web_structure')).items;
    const first = versions.find((version) => version.version === 1)!;

    const restored = await restorePageVersion('pg_web_structure', first.id);

    expect(restored.version).toBe(4);
    expect(restored.content).toEqual(first.content);
    expect(restored.updated_by).toBe('u_mara');
    expect((await failure(restorePageVersion('pg_web_structure', 'pv_nope'))).status).toBe(404);
  });
});

describe('templates and automations', () => {
  it('runTemplateNow creates the item as the default bot with the rendered title and the due date', async () => {
    const { run, item } = await runTemplateNow('tpl_web_maintenance');

    expect(run.status).toBe('created');
    expect(item).toMatchObject({
      title: 'Wartung KW 44',
      created_by: 'u_automation',
      assignee_id: 'u_jonas',
      due_date: '2026-10-30',
      template_id: 'tpl_web_maintenance',
      state_id: 'std_backlog',
    });
    expect((await listTemplateRuns('tpl_web_maintenance')).items[0].id).toBe(run.id);
  });

  it('a template that cannot create its item fails the run, logs the reason and tells the lead and the author', async () => {
    const { run, item } = await runTemplateNow('tpl_ops_certs');

    expect(item).toBeNull();
    expect(run).toMatchObject({ status: 'failed', error: 'Pflicht-Property Umgebung fehlt' });
    expect((await listNotifications({ unread_only: true })).items.some((notification) => notification.event === 'template_run_failed')).toBe(true); // Mara wrote it

    asUser('u_jonas'); // the lead of OPS
    expect((await listNotifications({ unread_only: true })).items.some((notification) => notification.event === 'template_run_failed')).toBe(true);
    // the template stays as it was
    expect((await listTemplates('p_ops')).items[0].schedule?.paused).toBe(true);
  });

  it('saveTemplate works out the next run from the schedule; a paused schedule has none', async () => {
    const template = (await listTemplates('p_web')).items[0];

    const paused = await saveTemplate({ ...template, schedule: { ...template.schedule!, paused: true } });
    expect(paused.next_run_at).toBeNull();
    const running = await saveTemplate({ ...paused, schedule: { ...paused.schedule!, paused: false } });
    expect(running.next_run_at).toBe('2026-11-02T08:00:00.000Z');
    expect(running.run_count).toBe(template.run_count);
  });

  it('the items the seed templates created carry the titles the scheduler would have rendered', async () => {
    const db = getDb();
    for (const run of db.template_runs.filter((entry) => entry.work_item_id !== null)) {
      const template = db.templates.find((entry) => entry.id === run.template_id)!;
      const item = db.items.find((entry) => entry.id === run.work_item_id)!;
      expect(item.title, run.id).toBe(renderTitle(template.payload.title, new Date(run.scheduled_for), 'de', 'Europe/Berlin'));
      expect(item.template_id).toBe(template.id);
    }
  });

  it('saveAutomation is for project admins and wants a Canceled state for auto-close', async () => {
    asUser('u_jonas'); // member in WEB
    const input = { project_id: 'p_web', key: 'auto_close', enabled: true, settings: { days: 60, state_id: 'std_cancelled' } } as const;
    expect((await failure(saveAutomation(input))).status).toBe(403);

    asUser('u_ida'); // admin in WEB
    expect((await failure(saveAutomation({ ...input, settings: { days: 60, state_id: 'std_done' } }))).errors?.['settings.state_id']).toBeTruthy();
    expect((await failure(saveAutomation({ ...input, settings: { days: 0, state_id: 'std_cancelled' } }))).errors?.['settings.days']).toBeTruthy();
    expect((await saveAutomation(input)).enabled).toBe(true);
    expect((await listAutomations('p_web')).items.filter((automation) => automation.enabled).map((automation) => automation.key).sort()).toEqual([
      'assign_on_start',
      'auto_archive',
      'auto_close',
    ]);
  });
});

describe('webhooks', () => {
  it('pingWebhook and redeliver answer 200 for a webhook that is on and 500 for the switched-off one', async () => {
    expect((await pingWebhook('wh_deploy')).status_code).toBe(200);
    expect((await pingWebhook('wh_crm')).status_code).toBe(500);
    expect((await redeliver('dl_c1')).status_code).toBe(500);

    const log = await listDeliveries('wh_deploy');
    expect(log.items[0]).toMatchObject({ event: 'ping', status_code: 200 }); // newest first
    expect(log.total).toBe(7);
  });

  it('checks the address, the events and who may manage webhooks', async () => {
    const base = { name: 'Test', url: 'https://hooks.example.com/x', project_id: null, events: ['work_item.*'], bot_id: null, active: true };

    expect((await failure(saveWebhook({ ...base, url: 'http://localhost/x' }))).errors?.url).toBeTruthy();
    expect((await failure(saveWebhook({ ...base, url: 'ftp://hooks.example.com/x' }))).errors?.url).toBeTruthy();
    expect((await failure(saveWebhook({ ...base, events: [] }))).errors?.events).toBeTruthy();
    expect((await failure(saveWebhook({ ...base, events: ['work_item.explodes'] }))).errors?.events).toBeTruthy();
    expect((await failure(saveWebhook({ ...base, bot_id: 'u_ida' }))).errors?.bot_id).toBeTruthy();

    const created = await saveWebhook(base);
    await deleteWebhook(created.webhook.id);
    expect((await listWebhooks()).items.some((webhook) => webhook.id === created.webhook.id)).toBe(false);

    asUser('u_jonas');
    expect((await failure(listWebhooks())).status).toBe(403);
  });

  it('switching a switched-off webhook on again clears the shut-off mark', async () => {
    const [, , crm] = (await listWebhooks()).items;
    expect(crm.disabled_at).not.toBeNull();

    const { webhook } = await saveWebhook({ ...crm, active: true });

    expect(webhook).toMatchObject({ active: true, disabled_at: null });
  });

  it('events reach the webhooks that listen: state changes the deploy bot, an assignment to Kira the agent', async () => {
    await transitionWorkItem('wi_web_50', 'std_progress');
    expect((await listDeliveries('wh_deploy')).total).toBe(7);

    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira' });
    const agent = await listDeliveries('wh_kira');
    expect(agent.total).toBe(5);
    expect(agent.items[0]).toMatchObject({ event: 'bot.assigned', status_code: 200 });
  });
});

describe('search', () => {
  it('finds an item by key, also under a former identifier, and people, pages, projects and views', async () => {
    expect((await search('web-47')).items[0].key).toBe('WEB-47');
    expect((await search('  ')).items).toEqual([]);

    // the page of that name first, then pages that only mention it
    const result = await search('seitenstruktur');
    expect(result.pages.map((page) => page.title).slice(0, 1)).toEqual(['Seitenstruktur']);
    expect((await search('lene')).people.map((person) => person.handle)).toEqual(['lene']);
    expect((await search('sven')).people).toEqual([]); // deactivated
    expect((await search('infra')).projects.map((project) => project.identifier)).toEqual(['OPS']);
    expect((await search('bugs')).views.map((view) => view.name)).toEqual(['Bugs in Produktion']);

    await updateProject('p_web', { identifier: 'SITE' });
    expect((await search('WEB-47')).items[0].key).toBe('SITE-47');
  });

  it('looks into descriptions and comments, and leaves archived items out', async () => {
    expect((await search('Submit-Handler')).items.map((item) => item.key)).toEqual(['WEB-47']); // a comment
    expect((await search('Hero mit Claim')).items.map((item) => item.key)).toEqual(['WEB-42']); // a description
    expect((await search('Wireframes')).items).toEqual([]); // WEB-8 is archived
  });
});
