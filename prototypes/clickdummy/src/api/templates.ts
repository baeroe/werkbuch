/*
 * Templates and their schedules (spec 4.12). A template creates items as the default bot; a run is logged and a
 * template that is invalid at run time fails the run, tells the project lead and the template's author, and stays on.
 */

import { renderTitle } from '@/domain/placeholders';
import { nextOccurrences } from '@/domain/recurrence';
import { addDays } from '@/domain/tz';
import { today } from '@/lib/clock';
import type { Template, TemplatePayload, TemplateRun, WorkItem } from '@/types';
import { canSeeProject, requireRole, requireWritable } from './access';
import { ApiError, clone, FieldErrors, newId, notFound, paginate, read, write, type Ctx, type Page } from './client';
import type { Db } from './db';
import { linkAttachments, richValues } from './attachments';
import { notifyPeople, recordEvent } from './events';
import { createItem, defaultBot } from './itemRules';
import { findProject } from './lookup';

export type TemplateInput = Omit<Template, 'id' | 'run_count' | 'last_run_at' | 'next_run_at' | 'created_by'> & { id?: string };

/** The next planned run after now, or null for a template without a schedule or with a paused one. */
function nextRun(ctx: Ctx, template: Pick<Template, 'schedule' | 'run_count'>): string | null {
  if (!template.schedule) return null;
  const [next] = nextOccurrences(template.schedule, ctx.now, 1, ctx.db.organization.timezone, template.run_count);
  return next ? next.toISOString() : null;
}

/** The templates of one project, or of all projects the account sees. */
export function listTemplates(project_id?: string): Promise<Page<Template>> {
  return read(({ db, me }) => {
    if (project_id !== undefined) {
      const project = findProject(db, project_id);
      if (!project) throw notFound('Das Projekt');
      requireRole(db, me, project, 'viewer');
      return paginate(db.templates.filter((template) => template.project_id === project.id));
    }
    const visible = new Set(db.projects.filter((project) => canSeeProject(db, me, project)).map((project) => project.id));
    return paginate(db.templates.filter((template) => visible.has(template.project_id)));
  });
}

/** Creates (no id) or changes a template of a project. The next run is worked out from the schedule. */
export function saveTemplate(input: TemplateInput): Promise<Template> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = findProject(db, input.project_id);
    if (!project) throw notFound('Das Projekt');
    requireWritable(db, me, project, 'member', 'Vorlagen verwalten nur Member und Admins des Projekts.');
    const existing = input.id ? db.templates.find((template) => template.id === input.id) : undefined;
    if (input.id && !existing) throw notFound('Die Vorlage');

    const errors = new FieldErrors();
    if (input.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    if (input.payload.title.trim() === '') errors.add('payload.title', 'Der Titel darf nicht leer sein.');
    if (!project.enabled_type_ids.includes(input.payload.type_id)) errors.add('payload.type_id', 'Dieser Typ ist im Projekt nicht aktiviert.');
    if (input.schedule && nextOccurrences({ ...input.schedule, paused: false }, ctx.now, 1, db.organization.timezone).length === 0 && input.schedule.ends.type === 'never') {
      errors.add('schedule', 'Der Zeitplan lässt sich nicht lesen. Prüfe Beginn, Uhrzeit und Ende.');
    }
    errors.throwIfAny();

    const template: Template = {
      id: existing?.id ?? newId('tpl'),
      project_id: project.id,
      name: input.name.trim(),
      payload: clone(input.payload),
      schedule: input.schedule ? clone(input.schedule) : null,
      run_count: existing?.run_count ?? 0,
      last_run_at: existing?.last_run_at ?? null,
      next_run_at: null,
      created_by: existing?.created_by ?? me.id,
    };
    template.next_run_at = nextRun(ctx, template);
    if (existing) db.templates[db.templates.indexOf(existing)] = template;
    else db.templates.push(template);
    // uploads made before a new template had its id belong to it now (spec 4.16)
    linkAttachments(db, project.id, [template.payload.description, ...richValues(template.payload.values)], { type: 'template', id: template.id });
    return template;
  });
}

export function deleteTemplate(id: string): Promise<void> {
  return write(({ db, me }) => {
    const template = db.templates.find((entry) => entry.id === id);
    const project = template && db.projects.find((entry) => entry.id === template.project_id);
    if (!template || !project) throw notFound('Die Vorlage');
    requireWritable(db, me, project, 'member', 'Vorlagen verwalten nur Member und Admins des Projekts.');
    db.templates = db.templates.filter((entry) => entry.id !== id);
    db.template_runs = db.template_runs.filter((run) => run.template_id !== id);
    db.attachments = db.attachments.filter((attachment) => !(attachment.owner?.type === 'template' && attachment.owner.id === id));
  });
}

/** The reason a run failed, as the run log shows it: a missing required property is named like in the log. */
function failureText(db: Db, payload: TemplatePayload, error: unknown): string {
  if (error instanceof ApiError && error.errors) {
    const type = db.types.find((entry) => entry.id === payload.type_id);
    const missing = Object.keys(error.errors)
      .filter((path) => path.startsWith('values.'))
      .map((path) => {
        const key = path.slice('values.'.length);
        const property = db.properties.find((entry) => entry.key === key && type?.properties.some((p) => p.property_id === entry.id));
        return property?.label ?? key;
      });
    if (missing.length > 0) return `Pflicht-Property ${missing.join(', ')} fehlt`;
    return Object.values(error.errors).flat()[0] ?? error.message;
  }
  return error instanceof Error ? error.message : 'Unbekannter Fehler';
}

/**
 * Runs a template now, as the scheduler would: creates the item as the default bot. A template that cannot create
 * its item (e.g. a required property is missing) fails the run; that is logged and answered as `{ run, item: null }`.
 */
export function runTemplateNow(id: string): Promise<{ run: TemplateRun; item: WorkItem | null }> {
  return write((ctx) => {
    const { db, me, stamp, now } = ctx;
    const template = db.templates.find((entry) => entry.id === id);
    const project = template && db.projects.find((entry) => entry.id === template.project_id);
    if (!template || !project) throw notFound('Die Vorlage');
    requireWritable(db, me, project, 'member', 'Vorlagen verwalten nur Member und Admins des Projekts.');

    const bot = defaultBot(db);
    const zone = db.organization.timezone;
    const day = today(zone);
    const { payload } = template;
    const run: TemplateRun = { id: newId('run'), template_id: template.id, scheduled_for: stamp, work_item_id: null, status: 'created', error: null };

    try {
      const item = createItem(ctx, bot, {
        project_id: project.id,
        type_id: payload.type_id,
        title: renderTitle(payload.title, now, db.organization.locale, zone),
        description: payload.description,
        priority: payload.priority,
        assignee_id: payload.assignee_id,
        label_ids: payload.label_ids,
        values: payload.values,
        parent_id: payload.parent_id,
        start_date: payload.start_offset_days === null ? null : addDays(day, payload.start_offset_days),
        due_date: payload.due_offset_days === null ? null : addDays(day, payload.due_offset_days),
        template_id: template.id,
      });
      run.work_item_id = item.id;
      template.last_run_at = stamp;
      db.template_runs.push(run);
      return { run, item };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      run.status = 'failed';
      run.error = failureText(db, payload, error);
      template.last_run_at = stamp;
      db.template_runs.push(run);
      const event = recordEvent(ctx, {
        type: 'template.run_failed',
        actor_id: bot.id,
        subject: { type: 'template', id: template.id },
        project_id: project.id,
        changes: { error: { old: null, new: run.error } },
      });
      // the lead of the project and the author of the template hear about it, where their inbox takes it (spec 4.14);
      // nobody caused it, so whoever pressed "Jetzt ausführen" hears about it too. The template stays on.
      notifyPeople(ctx, {
        event: 'template_run_failed',
        project_id: project.id,
        actor_id: null,
        event_id: event.id,
        data: { template_id: template.id, error: run.error ?? undefined },
        recipients: [project.lead_id, template.created_by],
      });
      return { run, item: null };
    }
  });
}

/** The log of a template's runs, newest first. */
export function listTemplateRuns(template_id: string): Promise<Page<TemplateRun>> {
  return read(({ db, me }) => {
    const template = db.templates.find((entry) => entry.id === template_id);
    const project = template && db.projects.find((entry) => entry.id === template.project_id);
    if (!template || !project) throw notFound('Die Vorlage');
    requireRole(db, me, project, 'viewer');
    return paginate(
      db.template_runs.filter((run) => run.template_id === template_id).sort((a, b) => (a.scheduled_for < b.scheduled_for ? 1 : a.scheduled_for > b.scheduled_for ? -1 : 0)),
    );
  });
}
