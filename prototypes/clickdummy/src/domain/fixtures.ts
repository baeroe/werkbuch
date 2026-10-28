/*
 * Fixtures shared by the domain tests and by later tasks: the seed (Task 3) builds its workflows from here, and the
 * template tests (Task 10) reuse the schedules. All data is made up.
 */

import type { Resolution, Schedule, Workflow, WorkItem } from '@/types';

/* ------------------------------------------------------------------- workflows */

/** The default workflow: free, so every transition is allowed. */
export const standard: Workflow = {
  id: 'wf_standard',
  name: 'Standard',
  description: 'Der Standard-Workflow: Jeder Status ist von überall erreichbar.',
  is_default: true,
  is_free: true,
  initial_state_id: 'std_backlog',
  states: [
    { id: 'std_backlog', name: 'Backlog', icon: 'dashed', category: 'backlog', position: 0 },
    { id: 'std_todo', name: 'Todo', icon: 'circle', category: 'unstarted', position: 1 },
    { id: 'std_progress', name: 'In Progress', icon: 'half', category: 'started', position: 2 },
    { id: 'std_pending', name: 'Pending', icon: 'pause', category: 'started', position: 3 },
    { id: 'std_done', name: 'Done', icon: 'check', category: 'completed', position: 4 },
    { id: 'std_cancelled', name: 'Cancelled', icon: 'cross', category: 'canceled', position: 5 },
  ],
  transitions: [],
};

/** An agency workflow with an internal review and a customer approval; only listed transitions are allowed. */
export const agency: Workflow = {
  id: 'wf_agency',
  name: 'Agentur-Freigabe',
  description: 'Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.',
  is_default: false,
  is_free: false,
  initial_state_id: 'app_backlog',
  states: [
    { id: 'app_backlog', name: 'Backlog', icon: 'dashed', category: 'backlog', position: 0 },
    { id: 'app_todo', name: 'Todo', icon: 'circle', category: 'unstarted', position: 1 },
    { id: 'app_progress', name: 'In Progress', icon: 'half', category: 'started', position: 2 },
    { id: 'app_review', name: 'Review', icon: 'three-quarter', category: 'started', position: 3 },
    { id: 'app_approval', name: 'Kundenfreigabe', icon: 'pause', category: 'started', position: 4 },
    { id: 'app_done', name: 'Done', icon: 'check', category: 'completed', position: 5 },
    { id: 'app_cancelled', name: 'Cancelled', icon: 'cross', category: 'canceled', position: 6 },
  ],
  transitions: [
    ['app_backlog', 'app_todo'],
    ['app_todo', 'app_progress'],
    ['app_progress', 'app_review'],
    ['app_review', 'app_progress'],
    ['app_review', 'app_approval'],
    ['app_approval', 'app_done'],
    ['app_approval', 'app_progress'],
    // every open status can be cancelled
    ['app_backlog', 'app_cancelled'],
    ['app_todo', 'app_cancelled'],
    ['app_progress', 'app_cancelled'],
    ['app_review', 'app_cancelled'],
    ['app_approval', 'app_cancelled'],
    // reopening
    ['app_done', 'app_todo'],
    ['app_cancelled', 'app_backlog'],
  ],
};

/* ----------------------------------------------------------------- resolutions */

export const resolutions: Resolution[] = [
  { id: 'res_done', label: 'Done', default_for: 'completed', position: 0, archived_at: null },
  { id: 'res_wontdo', label: "Won't do", default_for: 'canceled', position: 1, archived_at: null },
  { id: 'res_duplicate', label: 'Duplicate', default_for: null, position: 2, archived_at: null },
  { id: 'res_cannot', label: 'Cannot reproduce', default_for: null, position: 3, archived_at: null },
];

/* ------------------------------------------------------------------- schedules */

/** Every day at 09:00. */
export const daily09: Schedule = {
  frequency: 'daily',
  interval: 1,
  time: '09:00',
  starts_on: '2026-01-01',
  ends: { type: 'never' },
  paused: false,
};

/** Every Monday and Thursday at 09:00. */
export const weeklyMonThu09: Schedule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1, 4],
  time: '09:00',
  starts_on: '2026-01-01',
  ends: { type: 'never' },
  paused: false,
};

/** The first Monday of every month at 09:00. */
export const firstMonday09: Schedule = {
  frequency: 'monthly',
  interval: 1,
  nth_weekday: { n: 1, weekday: 1 },
  time: '09:00',
  starts_on: '2026-01-01',
  ends: { type: 'never' },
  paused: false,
};

/** On the 31st of every month at 09:00; shorter months fall back to their last day. */
export const monthDay31at09: Schedule = {
  frequency: 'monthly',
  interval: 1,
  month_day: 31,
  time: '09:00',
  starts_on: '2026-01-01',
  ends: { type: 'never' },
  paused: false,
};

/** Every other Wednesday at 09:00, counted from the week of Wednesday 2026-10-28. */
export const everyOtherWed09: Schedule = {
  frequency: 'weekly',
  interval: 2,
  weekdays: [3],
  time: '09:00',
  starts_on: '2026-10-28',
  ends: { type: 'never' },
  paused: false,
};

/* ----------------------------------------------------------------- work items */

/** A work item with sensible defaults; override what the test is about. */
export function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    project_id: 'p_web',
    number: 1,
    key: 'WEB-1',
    type_id: 't_task',
    title: 'Beispielaufgabe',
    description: null,
    description_version: 1,
    state_id: 'std_todo',
    resolution_id: null,
    assignee_id: null,
    priority: 'none',
    label_ids: [],
    start_date: null,
    due_date: null,
    parent_id: null,
    rank: 'a0',
    values: {},
    created_by: 'u_mara',
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    started_at: null,
    closed_at: null,
    archived_at: null,
    template_id: null,
    subscriber_ids: [],
    ...overrides,
  };
}

/** WEB-47: started, urgent, assigned to Jonas, due on Saturday 2026-10-31. */
export const web47: WorkItem = makeWorkItem({
  id: 'wi_web_47',
  number: 47,
  key: 'WEB-47',
  type_id: 't_bug',
  title: 'Kontaktformular sendet doppelt',
  state_id: 'std_progress',
  assignee_id: 'u_jonas',
  priority: 'urgent',
  label_ids: ['lb_forms', 'lb_production'],
  start_date: '2026-10-27',
  due_date: '2026-10-31',
  values: { customer: 'opt_nordlicht', effort: 3.5 },
  rank: 'a3',
  created_at: '2026-10-20T09:30:00.000Z',
  updated_at: '2026-10-27T08:15:00.000Z',
  started_at: '2026-10-27T08:15:00.000Z',
});

/** OPS-12 holds up WEB-47 (relation "blocks" in the demo); open itself. */
export const ops12: WorkItem = makeWorkItem({
  id: 'wi_ops_12',
  project_id: 'p_ops',
  number: 12,
  key: 'OPS-12',
  title: 'Mail-Limits am Server erhöhen',
  state_id: 'std_progress',
  assignee_id: 'u_jonas',
  priority: 'high',
  due_date: '2026-10-30',
  rank: 'a5',
  started_at: '2026-10-26T09:00:00.000Z',
});

/** Started and one day past its due date. */
export const overdueStarted: WorkItem = makeWorkItem({
  id: 'wi_web_41',
  number: 41,
  key: 'WEB-41',
  title: 'Impressum aktualisieren',
  state_id: 'std_progress',
  assignee_id: 'u_ida',
  priority: 'high',
  due_date: '2026-10-27',
  rank: 'a2',
  started_at: '2026-10-22T07:45:00.000Z',
});

/** Past its due date, but closed, so it is not overdue. */
export const overdueDone: WorkItem = makeWorkItem({
  id: 'wi_web_39',
  number: 39,
  key: 'WEB-39',
  title: 'Domain auf neuen Server umziehen',
  state_id: 'std_done',
  resolution_id: 'res_done',
  assignee_id: 'u_jonas',
  priority: 'medium',
  due_date: '2026-10-26',
  rank: 'a1',
  started_at: '2026-10-19T08:00:00.000Z',
  closed_at: '2026-10-27T15:20:00.000Z',
});

/** An epic whose type has the property `customer`, but no value for it. */
export const epicWithoutCustomer: WorkItem = makeWorkItem({
  id: 'wi_web_30',
  number: 30,
  key: 'WEB-30',
  type_id: 't_epic',
  title: 'Relaunch Phase 1',
  state_id: 'std_progress',
  start_date: '2026-10-01',
  due_date: '2026-11-15',
  values: { target_quarter: 'opt_q4_2026' },
  rank: 'a4',
  started_at: '2026-10-01T08:00:00.000Z',
});
