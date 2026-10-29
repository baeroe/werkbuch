/*
 * Projects and their members (spec 4.4, 4.3). Every function that takes a project accepts its id, its identifier or
 * a former identifier (`id` below stands for any of them).
 */

import { statesInOrder } from '@/domain/workflow';
import type { Automation, Project, ProjectMember, ProjectRole, User, Workflow } from '@/types';
import { canSeeProject, isOrgAdmin, requireRole, visibleProjects } from './access';
import { conflict, FieldErrors, invalid, newId, notFound, paginate, read, sameJson, write, type Page, type PageArgs } from './client';
import type { Db } from './db';
import { recordEvent } from './events';
import { findProject } from './lookup';

const IDENTIFIER = /^[A-Z][A-Z0-9]{1,9}$/;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;

function requireProject(db: Db, me: User, ref: string): Project {
  const project = findProject(db, ref);
  if (!project || !canSeeProject(db, me, project)) throw notFound('Das Projekt');
  return project;
}

/** An identifier is taken by a project or reserved as the former identifier of one (except of `projectId`). */
function identifierTaken(db: Db, identifier: string, projectId: string | null): boolean {
  return (
    db.projects.some((project) => project.identifier === identifier && project.id !== projectId) ||
    db.project_aliases.some((alias) => alias.identifier === identifier && alias.project_id !== projectId)
  );
}

/** A switched-off automation per kind, the way a new project has them (spec 4.13: all off). */
function defaultAutomations(projectId: string, workflow: Workflow): Automation[] {
  const canceled = statesInOrder(workflow).find((state) => state.category === 'canceled');
  return [
    { id: newId('au'), project_id: projectId, key: 'auto_archive', enabled: false, settings: { days: 30 } },
    { id: newId('au'), project_id: projectId, key: 'auto_close', enabled: false, settings: { days: 90, ...(canceled ? { state_id: canceled.id } : {}) } },
    { id: newId('au'), project_id: projectId, key: 'close_parent', enabled: false, settings: {} },
    { id: newId('au'), project_id: projectId, key: 'assign_on_start', enabled: false, settings: {} },
  ];
}

export interface ListProjectsArgs extends PageArgs {
  include_archived?: boolean;
}

/** The projects the signed-in account sees; archived ones only on request. */
export function listProjects(args: ListProjectsArgs = {}): Promise<Page<Project>> {
  return read(({ db, me }) =>
    paginate(
      visibleProjects(db, me).filter((project) => args.include_archived === true || project.archived_at === null),
      args,
    ),
  );
}

export function getProject(identifier: string): Promise<Project> {
  return read(({ db, me }) => requireProject(db, me, identifier));
}

export interface CreateProjectInput {
  name: string;
  identifier: string;
  description?: string;
  image_url?: string | null;
  lead_id?: string;
  visibility?: Project['visibility'];
  workflow_id?: string;
  enabled_type_ids?: string[];
  default_type_id?: string;
}

/** Any member of the organisation may create a project; they become its admin, and the lead joins it. */
export function createProject(input: CreateProjectInput): Promise<Project> {
  return write((ctx) => {
    const { db, me } = ctx;
    const errors = new FieldErrors();

    const name = input.name?.trim() ?? '';
    if (name === '') errors.add('name', 'Der Name darf nicht leer sein.');
    else if (name.length > MAX_NAME) errors.add('name', `Der Name darf höchstens ${MAX_NAME} Zeichen haben.`);
    const description = input.description?.trim() ?? '';
    if (description.length > MAX_DESCRIPTION) errors.add('description', `Die Beschreibung darf höchstens ${MAX_DESCRIPTION} Zeichen haben.`);

    const identifier = (input.identifier ?? '').trim().toUpperCase();
    if (!IDENTIFIER.test(identifier)) errors.add('identifier', 'Die Kennung hat 2 bis 10 Großbuchstaben oder Ziffern und beginnt mit einem Buchstaben.');
    else if (identifierTaken(db, identifier, null)) errors.add('identifier', 'Diese Kennung ist schon vergeben.');

    const workflow = db.workflows.find((entry) => entry.id === (input.workflow_id ?? db.workflows.find((w) => w.is_default)?.id));
    if (!workflow) errors.add('workflow_id', 'Diesen Workflow gibt es nicht.');
    const enabled = input.enabled_type_ids ?? ['t_task', 't_bug', 't_epic'].filter((id) => db.types.some((type) => type.id === id));
    if (enabled.length === 0 || !enabled.every((id) => db.types.some((type) => type.id === id && type.archived_at === null))) {
      errors.add('enabled_type_ids', 'Mindestens ein Typ muss aktiviert sein.');
    }
    const defaultType = input.default_type_id ?? enabled[0];
    if (!enabled.includes(defaultType)) errors.add('default_type_id', 'Der Standardtyp muss aktiviert sein.');
    const leadId = input.lead_id ?? me.id;
    const lead = db.users.find((user) => user.id === leadId);
    if (!lead || lead.disabled_at !== null) errors.add('lead_id', 'Diese Person kann nicht Lead sein.');
    errors.throwIfAny();

    const project: Project = {
      id: `p_${identifier.toLowerCase()}`,
      identifier,
      name,
      description,
      image_url: input.image_url ?? null,
      lead_id: leadId,
      visibility: input.visibility ?? 'public',
      workflow_id: workflow!.id,
      enabled_type_ids: [...enabled],
      default_type_id: defaultType,
      archived_at: null,
    };
    db.projects.push(project);
    db.counters[project.id] = 0;
    db.project_members.push({ project_id: project.id, user_id: me.id, role: 'admin' });
    if (leadId !== me.id) db.project_members.push({ project_id: project.id, user_id: leadId, role: 'member' });
    db.automations.push(...defaultAutomations(project.id, workflow!));
    recordEvent(ctx, {
      type: 'project.created',
      actor_id: me.id,
      subject: { type: 'project', id: project.id },
      project_id: project.id,
      changes: { identifier: { old: null, new: identifier } },
    });
    return project;
  });
}

export type UpdateProjectPatch = Partial<
  Pick<Project, 'name' | 'description' | 'image_url' | 'lead_id' | 'visibility' | 'enabled_type_ids' | 'default_type_id' | 'identifier'>
>;

/**
 * Project settings (project admins). Changing the identifier renames all keys; the old identifier stays as an alias,
 * so `OLD-12` still finds the item (spec 4.4).
 */
export function updateProject(id: string, patch: UpdateProjectPatch): Promise<Project> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = requireProject(db, me, id);
    requireRole(db, me, project, 'admin', 'Die Einstellungen ändern nur Admins des Projekts.');
    const errors = new FieldErrors();

    if (patch.name !== undefined) {
      if (patch.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
      else if (patch.name.trim().length > MAX_NAME) errors.add('name', `Der Name darf höchstens ${MAX_NAME} Zeichen haben.`);
    }
    if (patch.description !== undefined && patch.description.length > MAX_DESCRIPTION) {
      errors.add('description', `Die Beschreibung darf höchstens ${MAX_DESCRIPTION} Zeichen haben.`);
    }
    const identifier = patch.identifier === undefined ? undefined : patch.identifier.trim().toUpperCase();
    if (identifier !== undefined && identifier !== project.identifier) {
      if (!IDENTIFIER.test(identifier)) errors.add('identifier', 'Die Kennung hat 2 bis 10 Großbuchstaben oder Ziffern und beginnt mit einem Buchstaben.');
      else if (identifierTaken(db, identifier, project.id)) errors.add('identifier', 'Diese Kennung ist schon vergeben.');
    }
    const enabled = patch.enabled_type_ids ?? project.enabled_type_ids;
    if (enabled.length === 0 || !enabled.every((id) => db.types.some((type) => type.id === id))) {
      errors.add('enabled_type_ids', 'Mindestens ein Typ muss aktiviert sein.');
    }
    if (!enabled.includes(patch.default_type_id ?? project.default_type_id)) errors.add('default_type_id', 'Der Standardtyp muss aktiviert sein.');
    if (patch.lead_id !== undefined && !db.project_members.some((member) => member.project_id === project.id && member.user_id === patch.lead_id)) {
      errors.add('lead_id', 'Die Lead-Person muss Mitglied des Projekts sein.');
    }
    errors.throwIfAny();

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const assign = (field: 'name' | 'description' | 'image_url' | 'lead_id' | 'visibility' | 'enabled_type_ids' | 'default_type_id', value: unknown) => {
      if (!sameJson(project[field], value)) {
        changes[field] = { old: project[field], new: value };
        (project as unknown as Record<string, unknown>)[field] = value;
      }
    };
    if (patch.name !== undefined) assign('name', patch.name.trim());
    if (patch.description !== undefined) assign('description', patch.description.trim());
    if (patch.image_url !== undefined) assign('image_url', patch.image_url);
    if (patch.lead_id !== undefined) assign('lead_id', patch.lead_id);
    if (patch.visibility !== undefined) assign('visibility', patch.visibility);
    if (patch.enabled_type_ids !== undefined) assign('enabled_type_ids', [...patch.enabled_type_ids]);
    if (patch.default_type_id !== undefined) assign('default_type_id', patch.default_type_id);

    if (identifier !== undefined && identifier !== project.identifier) {
      changes.identifier = { old: project.identifier, new: identifier };
      // coming back to a former identifier ends the alias
      db.project_aliases = db.project_aliases.filter((alias) => alias.identifier !== identifier);
      db.project_aliases.push({ identifier: project.identifier, project_id: project.id });
      project.identifier = identifier;
      for (const item of db.items) {
        if (item.project_id === project.id) item.key = `${identifier}-${item.number}`;
      }
    }

    if (Object.keys(changes).length > 0) {
      recordEvent(ctx, { type: 'project.updated', actor_id: me.id, subject: { type: 'project', id: project.id }, project_id: project.id, changes });
    }
    return project;
  });
}

/** Archives a project (it becomes read-only and leaves navigation and views) or, with `false`, restores it. */
export function archiveProject(id: string, archived = true): Promise<Project> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const project = requireProject(db, me, id);
    requireRole(db, me, project, 'admin', 'Archivieren dürfen nur Admins des Projekts.');
    const previous = project.archived_at;
    project.archived_at = archived ? (previous ?? stamp) : null;
    if (previous !== project.archived_at) {
      recordEvent(ctx, {
        type: 'project.archived',
        actor_id: me.id,
        subject: { type: 'project', id: project.id },
        project_id: project.id,
        changes: { archived_at: { old: previous, new: project.archived_at } },
      });
    }
    return project;
  });
}

/** Deletes a project with everything in it (project admins). The UI asks to type the identifier first. */
export function deleteProject(id: string): Promise<void> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = requireProject(db, me, id);
    requireRole(db, me, project, 'admin', 'Projekte löschen dürfen nur Admins des Projekts.');

    const itemIds = new Set(db.items.filter((item) => item.project_id === project.id).map((item) => item.id));
    const pageIds = new Set(db.pages.filter((page) => page.project_id === project.id).map((page) => page.id));
    const templateIds = new Set(db.templates.filter((template) => template.project_id === project.id).map((template) => template.id));
    db.items = db.items.filter((item) => !itemIds.has(item.id));
    db.comments = db.comments.filter((comment) => !itemIds.has(comment.work_item_id));
    db.relations = db.relations.filter((relation) => !itemIds.has(relation.source_id) && !itemIds.has(relation.target_id));
    db.attachments = db.attachments.filter((attachment) => attachment.project_id !== project.id);
    db.events = db.events.filter((event) => event.project_id !== project.id);
    db.notifications = db.notifications.filter((notification) => notification.project_id !== project.id);
    db.pages = db.pages.filter((page) => !pageIds.has(page.id));
    db.page_versions = db.page_versions.filter((version) => !pageIds.has(version.page_id));
    db.templates = db.templates.filter((template) => !templateIds.has(template.id));
    db.template_runs = db.template_runs.filter((run) => !templateIds.has(run.template_id));
    db.automations = db.automations.filter((automation) => automation.project_id !== project.id);
    db.project_members = db.project_members.filter((member) => member.project_id !== project.id);
    db.project_aliases = db.project_aliases.filter((alias) => alias.project_id !== project.id);
    db.favorites = db.favorites.filter((favorite) => !(favorite.kind === 'project' && favorite.id === project.id));
    db.webhooks.forEach((webhook) => {
      if (webhook.project_id === project.id) webhook.project_id = null;
    });
    for (const id of itemIds) delete db.unsubscribed[id];
    delete db.counters[project.id];
    db.projects = db.projects.filter((entry) => entry.id !== project.id);
  });
}

/* ---------------------------------------------------------------------- members */

/** Members of one project, or of all projects the account sees when no project is given. */
export function listMembers(project?: string): Promise<Page<ProjectMember>> {
  return read(({ db, me }) => {
    if (project !== undefined) {
      const found = requireProject(db, me, project);
      return paginate(db.project_members.filter((member) => member.project_id === found.id));
    }
    const visible = new Set(visibleProjects(db, me).map((entry) => entry.id));
    return paginate(db.project_members.filter((member) => visible.has(member.project_id)));
  });
}

/** Joins a public project as a member with one click. */
export function joinProject(id: string): Promise<ProjectMember> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = requireProject(db, me, id);
    if (db.project_members.some((member) => member.project_id === project.id && member.user_id === me.id)) {
      throw conflict('already_member', `Du bist schon Mitglied von ${project.identifier}.`);
    }
    if (project.visibility !== 'public' && !isOrgAdmin(me)) throw notFound('Das Projekt');
    const member: ProjectMember = { project_id: project.id, user_id: me.id, role: 'member' };
    db.project_members.push(member);
    recordEvent(ctx, {
      type: 'project.member_added',
      actor_id: me.id,
      subject: { type: 'project', id: project.id },
      project_id: project.id,
      changes: { member: { old: null, new: { user_id: me.id, role: 'member' } } },
    });
    return member;
  });
}

const ROLES: readonly ProjectRole[] = ['admin', 'member', 'viewer'];

export function addMember(project_id: string, user_id: string, role: ProjectRole): Promise<ProjectMember> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = requireProject(db, me, project_id);
    requireRole(db, me, project, 'admin', 'Mitglieder verwalten nur Admins des Projekts.');
    const errors = new FieldErrors();
    const user = db.users.find((entry) => entry.id === user_id);
    if (!user || user.disabled_at !== null) errors.add('user_id', 'Dieses Konto gibt es nicht oder es ist deaktiviert.');
    if (!ROLES.includes(role)) errors.add('role', 'Diese Rolle gibt es nicht.');
    if (db.project_members.some((member) => member.project_id === project.id && member.user_id === user_id)) {
      errors.add('user_id', 'Dieses Konto ist schon Mitglied.');
    }
    errors.throwIfAny();

    const member: ProjectMember = { project_id: project.id, user_id, role };
    db.project_members.push(member);
    recordEvent(ctx, {
      type: 'project.member_added',
      actor_id: me.id,
      subject: { type: 'project', id: project.id },
      project_id: project.id,
      changes: { member: { old: null, new: { user_id, role } } },
    });
    return member;
  });
}

export function updateMemberRole(project_id: string, user_id: string, role: ProjectRole): Promise<ProjectMember> {
  return write(({ db, me }) => {
    const project = requireProject(db, me, project_id);
    requireRole(db, me, project, 'admin', 'Mitglieder verwalten nur Admins des Projekts.');
    const member = db.project_members.find((entry) => entry.project_id === project.id && entry.user_id === user_id);
    if (!member) throw notFound('Das Mitglied');
    if (!ROLES.includes(role)) throw invalid({ role: ['Diese Rolle gibt es nicht.'] });
    member.role = role;
    return member;
  });
}

export function removeMember(project_id: string, user_id: string): Promise<void> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = requireProject(db, me, project_id);
    requireRole(db, me, project, 'admin', 'Mitglieder verwalten nur Admins des Projekts.');
    if (!db.project_members.some((entry) => entry.project_id === project.id && entry.user_id === user_id)) throw notFound('Das Mitglied');
    if (project.lead_id === user_id) throw conflict('lead_cannot_leave', 'Die Lead-Person bleibt Mitglied. Setze zuerst eine andere Lead-Person ein.');

    db.project_members = db.project_members.filter((entry) => !(entry.project_id === project.id && entry.user_id === user_id));
    recordEvent(ctx, {
      type: 'project.member_removed',
      actor_id: me.id,
      subject: { type: 'project', id: project.id },
      project_id: project.id,
      changes: { member: { old: { user_id }, new: null } },
    });
  });
}
