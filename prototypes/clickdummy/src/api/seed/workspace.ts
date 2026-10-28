/*
 * Seed: the team views and everybody's favorites, the templates with their schedules and the log of their runs.
 */

import { nextOccurrences } from '@/domain/recurrence';
import type { Display, Favorite, Filter, Schedule, Template, TemplateRun, View } from '@/types';
import { at, rt, USER_IDS, ZONE } from './helpers';
import { itemId } from './items';

/* ---------------------------------------------------------------------- views */

const filterOf = (...conditions: Filter['conditions']): Filter => ({ version: 1, conditions });

const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'due_date'];

/** Open means anything but Completed and Canceled. */
const OPEN = ['backlog', 'unstarted', 'started'];

const listByState = (): Display => ({ layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: [...FIELDS], show_sub_items: true });

export const views: View[] = [
  {
    id: 'v_due_week',
    name: 'Fällig diese Woche',
    icon: 'calendar-clock',
    filter: filterOf({ field: 'state_category', op: 'in', value: [...OPEN] }, { field: 'due_date', op: 'is', value: 'this_week' }),
    display: { layout: 'list', group_by: 'project', sort: { field: 'due_date', direction: 'asc' }, fields: [...FIELDS], show_sub_items: false },
    created_by: USER_IDS.mara,
    created_at: at('09-14 10:00'),
  },
  {
    id: 'v_prod_bugs',
    name: 'Bugs in Produktion',
    icon: 'bug',
    filter: filterOf({ field: 'type', op: 'is', value: 't_bug' }, { field: 'property:environment', op: 'is', value: 'opt_env_prod' }),
    display: { layout: 'board', group_by: 'state', sort: { field: 'priority', direction: 'asc' }, fields: ['key', 'title', 'assignee', 'priority', 'labels'], show_sub_items: false },
    created_by: USER_IDS.ida,
    created_at: at('09-21 15:30'),
  },
  {
    id: 'v_kira',
    name: 'Für Kira',
    icon: 'bot',
    filter: filterOf({ field: 'assignee', op: 'is', value: USER_IDS.kira }),
    display: listByState(),
    created_by: USER_IDS.mara,
    created_at: at('10-05 14:00'),
  },
  {
    id: 'v_nordlicht',
    name: 'Studio Nordlicht',
    icon: 'building-2',
    filter: filterOf({ field: 'property:customer', op: 'is', value: 'opt_nordlicht' }),
    display: {
      layout: 'table',
      group_by: 'none',
      sort: { field: 'key', direction: 'asc' },
      fields: ['key', 'title', 'state', 'assignee', 'due_date', 'property:customer', 'property:effort'],
      show_sub_items: true,
    },
    created_by: USER_IDS.theo,
    created_at: at('10-01 11:15'),
  },
  {
    id: 'v_roadmap',
    name: 'Roadmap',
    icon: 'route',
    filter: filterOf(),
    display: { layout: 'timeline', group_by: 'project', sort: { field: 'start_date', direction: 'asc' }, fields: ['key', 'title'], show_sub_items: false },
    created_by: USER_IDS.mara,
    created_at: at('09-28 09:45'),
  },
  {
    id: 'v_blocked',
    name: 'Blockiert',
    icon: 'octagon-alert',
    filter: filterOf({ field: 'blocked', op: 'is', value: true }),
    display: listByState(),
    created_by: USER_IDS.jonas,
    created_at: at('10-12 16:20'),
  },
];

/**
 * Mara has the first three views in the sidebar, and the three projects (the sidebar lists favorite projects; the
 * brief names only the views). The others have the projects they work in, so that "Als … ansehen" shows a sidebar.
 */
export const favorites: Favorite[] = [
  { user_id: USER_IDS.mara, kind: 'view', id: 'v_due_week', position: 0 },
  { user_id: USER_IDS.mara, kind: 'view', id: 'v_prod_bugs', position: 1 },
  { user_id: USER_IDS.mara, kind: 'view', id: 'v_kira', position: 2 },
  { user_id: USER_IDS.mara, kind: 'project', id: 'p_web', position: 3 },
  { user_id: USER_IDS.mara, kind: 'project', id: 'p_app', position: 4 },
  { user_id: USER_IDS.mara, kind: 'project', id: 'p_ops', position: 5 },
  { user_id: USER_IDS.jonas, kind: 'view', id: 'v_blocked', position: 0 },
  { user_id: USER_IDS.jonas, kind: 'project', id: 'p_ops', position: 1 },
  { user_id: USER_IDS.jonas, kind: 'project', id: 'p_web', position: 2 },
  { user_id: USER_IDS.ida, kind: 'view', id: 'v_prod_bugs', position: 0 },
  { user_id: USER_IDS.ida, kind: 'project', id: 'p_web', position: 1 },
  { user_id: USER_IDS.theo, kind: 'view', id: 'v_nordlicht', position: 0 },
  { user_id: USER_IDS.theo, kind: 'project', id: 'p_app', position: 1 },
  { user_id: USER_IDS.lene, kind: 'project', id: 'p_web', position: 0 },
  { user_id: USER_IDS.lene, kind: 'project', id: 'p_app', position: 1 },
];

/* ------------------------------------------------------------------- templates */

const never = { type: 'never' } as const;

const weeklyMonday: Schedule = { frequency: 'weekly', interval: 1, weekdays: [1], time: '09:00', starts_on: '2026-10-05', ends: never, paused: false };
const firstMonday: Schedule = { frequency: 'monthly', interval: 1, nth_weekday: { n: 1, weekday: 1 }, time: '09:00', starts_on: '2026-09-01', ends: never, paused: false };
/** Monthly on the 1st at 07:00. Paused since its first run failed. */
const firstOfMonth: Schedule = { frequency: 'monthly', interval: 1, month_day: 1, time: '07:00', starts_on: '2026-10-01', ends: never, paused: true };

/** The demo clock starts at 10:00 on 2026-10-28; the next planned run is counted from there. */
const DEMO_NOW = new Date('2026-10-28T09:00:00.000Z');

const nextRun = (schedule: Schedule, runCount: number): string | null =>
  nextOccurrences(schedule, DEMO_NOW, 1, ZONE, runCount)[0]?.toISOString() ?? null;

export const templates: Template[] = [
  {
    id: 'tpl_web_maintenance',
    project_id: 'p_web',
    name: 'Wöchentliche Wartung',
    payload: {
      type_id: 't_task',
      title: 'Wartung KW {week}',
      description: rt('Updates einspielen, Backups prüfen und die Logs der letzten Woche durchsehen.'),
      priority: 'medium',
      assignee_id: USER_IDS.jonas,
      label_ids: ['lb_backend'],
      values: {},
      parent_id: null,
      start_offset_days: null,
      due_offset_days: 2,
    },
    schedule: weeklyMonday,
    run_count: 4,
    last_run_at: at('10-26 09:00'),
    next_run_at: nextRun(weeklyMonday, 4),
    created_by: USER_IDS.ida,
  },
  {
    id: 'tpl_app_report',
    project_id: 'p_app',
    name: 'Monatsbericht',
    payload: {
      type_id: 't_task',
      title: 'Monatsbericht {month_name} {year}',
      description: rt('Kennzahlen des Monats zusammenstellen: Installationen, aktive Nutzer, Abstürze und Rückmeldungen.'),
      priority: 'medium',
      assignee_id: USER_IDS.theo,
      label_ids: [],
      values: {},
      parent_id: null,
      start_offset_days: null,
      due_offset_days: null,
    },
    schedule: firstMonday,
    run_count: 2,
    last_run_at: at('10-05 09:00'),
    next_run_at: nextRun(firstMonday, 2),
    created_by: USER_IDS.theo,
  },
  {
    // a Bug has a required "Umgebung", the template does not fill it: the run fails
    id: 'tpl_ops_certs',
    project_id: 'p_ops',
    name: 'Zertifikate prüfen',
    payload: {
      type_id: 't_bug',
      title: 'Zertifikate prüfen',
      description: null,
      priority: 'medium',
      assignee_id: null,
      label_ids: [],
      values: {},
      parent_id: null,
      start_offset_days: null,
      due_offset_days: null,
    },
    schedule: firstOfMonth,
    run_count: 0,
    last_run_at: at('10-01 07:00'),
    next_run_at: null,
    created_by: USER_IDS.mara,
  },
];

const created = (id: string, templateId: string, when: string, itemKey: string): TemplateRun => ({
  id,
  template_id: templateId,
  scheduled_for: at(when),
  work_item_id: itemId(itemKey),
  status: 'created',
  error: null,
});

export const templateRuns: TemplateRun[] = [
  created('run_web_1', 'tpl_web_maintenance', '10-05 09:00', 'WEB-34'),
  created('run_web_2', 'tpl_web_maintenance', '10-12 09:00', 'WEB-38'),
  created('run_web_3', 'tpl_web_maintenance', '10-19 09:00', 'WEB-46'),
  created('run_web_4', 'tpl_web_maintenance', '10-26 09:00', 'WEB-52'),
  created('run_app_1', 'tpl_app_report', '09-07 09:00', 'APP-4'),
  created('run_app_2', 'tpl_app_report', '10-05 09:00', 'APP-8'),
  { id: 'run_ops_1', template_id: 'tpl_ops_certs', scheduled_for: at('10-01 07:00'), work_item_id: null, status: 'failed', error: 'Pflicht-Property Umgebung fehlt' },
];
