/*
 * The switchable automations of a project (spec 4.13). Neither the daily jobs (auto-archive, auto-close) nor the
 * clock run in the prototype; "assignee on start" and "close the parent" take effect on every move of an item.
 */

import type { Automation } from '@/types';
import { requireRole } from './access';
import { FieldErrors, newId, notFound, paginate, read, write, type Page } from './client';
import { findProject } from './lookup';

export type AutomationInput = Omit<Automation, 'id'> & { id?: string };

export function listAutomations(project_id: string): Promise<Page<Automation>> {
  return read(({ db, me }) => {
    const project = findProject(db, project_id);
    if (!project) throw notFound('Das Projekt');
    requireRole(db, me, project, 'viewer');
    return paginate(db.automations.filter((automation) => automation.project_id === project.id));
  });
}

/** Switches an automation on or off and sets its parameters (project admins). */
export function saveAutomation(input: AutomationInput): Promise<Automation> {
  return write(({ db, me }) => {
    const project = findProject(db, input.project_id);
    if (!project) throw notFound('Das Projekt');
    requireRole(db, me, project, 'admin', 'Automatisierungen ändern nur Admins des Projekts.');

    const errors = new FieldErrors();
    const { settings } = input;
    if ((input.key === 'auto_archive' || input.key === 'auto_close') && !(Number.isInteger(settings.days) && (settings.days ?? 0) >= 1)) {
      errors.add('settings.days', 'Die Tage sind eine ganze Zahl ab 1.');
    }
    if (input.key === 'auto_close') {
      const workflow = db.workflows.find((entry) => entry.id === project.workflow_id);
      const target = workflow?.states.find((state) => state.id === settings.state_id);
      if (!target || target.category !== 'canceled') errors.add('settings.state_id', 'Wähle einen Status der Kategorie Canceled.');
    }
    errors.throwIfAny();

    const existing = db.automations.find((automation) => automation.project_id === project.id && automation.key === input.key);
    const automation: Automation = { id: existing?.id ?? newId('au'), project_id: project.id, key: input.key, enabled: input.enabled, settings: { ...settings } };
    if (existing) db.automations[db.automations.indexOf(existing)] = automation;
    else db.automations.push(automation);
    return automation;
  });
}
