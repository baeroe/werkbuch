/*
 * Templates and their schedules (spec 4.12, REST `/api/v1/projects/{project}/templates`, `/api/v1/templates`). A
 * template creates items as the default bot at the terms of its schedule; a run is logged, one that fails tells the
 * project lead and the template's author. The names and signatures are the clickdummy's, with these deviations:
 * saving replaces a template as a whole and sends `name`, `payload` and `schedule` only (the project is in the path of
 * a new one, the id in the path of a change); the description goes as `description_json` (the answer holds it as
 * Markdown `description` and as JSON); the lists take `PageArgs` and answer one page (the hooks read to the end);
 * `templateDraft` and `previewSchedule` are what only the server counts (A335): the fields of an item made now, and
 * the next terms of a schedule.
 */

import type { RichText, Schedule, SchedulePreview, Template, TemplateDraft, TemplatePayload, TemplateRun, WorkItem } from '@/types';
import type { Page, PageArgs } from './client';
import { del, get, getPage, one, post, put } from './http';

const templatePath = (id: string) => `/templates/${encodeURIComponent(id)}`;

/** The payload as it is sent: the description as Tiptap JSON, the Markdown copies stay out. */
export type TemplatePayloadInput = Omit<TemplatePayload, 'description' | 'values_markdown'> & { description_json: RichText | null };

export interface TemplateInput {
  /** Without `id` a new template, in `project_id`; with one it replaces that template. */
  id?: string;
  project_id: string;
  name: string;
  payload: TemplatePayloadInput;
  schedule: Schedule | null;
}

/** The templates of one project (ULID or identifier), or of every project the account sees. */
export function listTemplates(project_id?: string, args: PageArgs = {}): Promise<Page<Template>> {
  return getPage<Template>(project_id === undefined ? '/templates' : `/projects/${encodeURIComponent(project_id)}/templates`, { ...args });
}

/** Creates (no `id`) or replaces a template; answers the saved one. */
export function saveTemplate({ id, project_id, ...input }: TemplateInput): Promise<Template> {
  return one(id ? put<{ data: Template }>(templatePath(id), input) : post<{ data: Template }>(`/projects/${encodeURIComponent(project_id)}/templates`, input));
}

export function deleteTemplate(id: string): Promise<void> {
  return del<void>(templatePath(id));
}

/** „Jetzt ausführen“: the run, with its item, or without when the run failed (`run.status`, `run.error`). */
export function runTemplateNow(id: string): Promise<{ run: TemplateRun; item: WorkItem | null }> {
  return one(post<{ data: { run: TemplateRun; item: WorkItem | null } }>(`${templatePath(id)}/run`));
}

/** The log of a template's runs, newest first. */
export function listTemplateRuns(template_id: string, args: PageArgs = {}): Promise<Page<TemplateRun>> {
  return getPage<TemplateRun>(`${templatePath(template_id)}/runs`, { ...args });
}

/** The fields of an item made from the template now, to take over into the create dialog. */
export function templateDraft(id: string): Promise<TemplateDraft> {
  return one(get<{ data: TemplateDraft }>(`${templatePath(id)}/draft`));
}

export interface SchedulePreviewInput {
  schedule: Schedule;
  /** A title with placeholders, rendered at the first term. */
  title?: string;
  /** The runs a schedule that ends after some has had. */
  run_count?: number;
}

/** The next terms of a schedule as the scheduler will run them (a reading `POST`, nothing is saved). */
export function previewSchedule(input: SchedulePreviewInput): Promise<SchedulePreview> {
  return one(post<{ data: SchedulePreview }>('/templates/preview', input));
}
