import { afterEach, describe, expect, it } from 'vitest';
import { textDoc } from '@/lib/richtext';
import { mockApi, type MockApi } from '@/test/api';
import { firstMonday, list, makeAutomation, makeTemplate, makeTemplateRun, web47 } from '@/test/fixtures';
import type { SchedulePreview, TemplateDraft } from '@/types';
import { listAutomations, saveAutomation } from './automations';
import { deleteTemplate, listTemplateRuns, listTemplates, previewSchedule, runTemplateNow, saveTemplate, templateDraft } from './templates';

let api: MockApi;

afterEach(() => api.restore());

const sent = () => api.calls.map(({ method, url }) => `${method} ${url}`);

describe('templates', () => {
  it('lists the templates of one project or of every project the account sees, one page at a time', async () => {
    const template = makeTemplate();
    api = mockApi({
      'GET /api/v1/projects/p_app/templates': () => ({ body: list([template]) }),
      'GET /api/v1/templates': () => ({ body: list([template], 7) }),
    });

    expect(await listTemplates('p_app', { cursor: 'c1', per_page: 20 })).toEqual({ items: [template], next_cursor: null, total: 1 });
    expect(await listTemplates()).toEqual({ items: [template], next_cursor: null, total: 7 });
    expect(sent()).toEqual(['GET /api/v1/projects/p_app/templates?cursor=c1&per_page=20', 'GET /api/v1/templates']);
  });

  it('asks for the lean templates without their texts (K24)', async () => {
    const template = makeTemplate();
    api = mockApi({ 'GET /api/v1/templates': () => ({ body: list([template]) }) });

    await listTemplates(undefined, { lean: true });
    expect(sent()).toEqual(['GET /api/v1/templates?lean=1']);
  });

  it('creates a template in its project with the description as description_json, and replaces one without an id in the body', async () => {
    const template = makeTemplate();
    api = mockApi({
      'POST /api/v1/projects/p_app/templates': () => ({ status: 201, body: { data: template } }),
      'PUT /api/v1/templates/tpl_app_report': () => ({ body: { data: template } }),
    });
    const payload = {
      type_id: 't_task',
      title: 'Bericht',
      description_json: textDoc('Text'),
      priority: 'none' as const,
      assignee_id: null,
      label_ids: [],
      values: {},
      parent_id: null,
      start_offset_days: null,
      due_offset_days: null,
    };

    expect(await saveTemplate({ project_id: 'p_app', name: 'Monatsbericht', payload, schedule: firstMonday })).toEqual(template);
    expect(await saveTemplate({ id: 'tpl_app_report', project_id: 'p_app', name: 'Monatsbericht', payload, schedule: null })).toEqual(template);

    expect(sent()).toEqual(['POST /api/v1/projects/p_app/templates', 'PUT /api/v1/templates/tpl_app_report']);
    expect(api.calls.map((call) => call.body)).toEqual([
      { name: 'Monatsbericht', payload, schedule: firstMonday },
      { name: 'Monatsbericht', payload, schedule: null },
    ]);
  });

  it('deletes a template', async () => {
    api = mockApi({ 'DELETE /api/v1/templates/tpl_app_report': () => ({ status: 204 }) });

    await deleteTemplate('tpl_app_report');

    expect(sent()).toEqual(['DELETE /api/v1/templates/tpl_app_report']);
  });

  it('runs a template now and answers the run with its item, or without when the run failed', async () => {
    const run = makeTemplateRun({ scheduled_for: null, triggered_by: 'u_ida' });
    const failed = makeTemplateRun({ id: 'tr_2', status: 'failed', work_item_id: null, error: 'Pflicht-Property Umgebung fehlt' });
    api = mockApi({
      'POST /api/v1/templates/tpl_app_report/run': () => ({ body: { data: { run, item: web47 } } }),
      'POST /api/v1/templates/tpl_ops_certs/run': () => ({ body: { data: { run: failed, item: null } } }),
    });

    expect(await runTemplateNow('tpl_app_report')).toEqual({ run, item: web47 });
    expect(await runTemplateNow('tpl_ops_certs')).toEqual({ run: failed, item: null });
  });

  it('lists the runs of a template with a term that may be null', async () => {
    const byHand = makeTemplateRun({ scheduled_for: null });
    api = mockApi({ 'GET /api/v1/templates/tpl_app_report/runs': () => ({ body: list([byHand]) }) });

    expect(await listTemplateRuns('tpl_app_report', { cursor: 'c2' })).toEqual({ items: [byHand], next_cursor: null, total: 1 });
    expect(sent()).toEqual(['GET /api/v1/templates/tpl_app_report/runs?cursor=c2']);
  });

  it('reads the draft of an item from a template', async () => {
    const draft: TemplateDraft = {
      project_id: 'p_app',
      template_id: 'tpl_app_report',
      type_id: 't_task',
      title: 'Monatsbericht November 2026',
      description: null,
      description_json: null,
      priority: 'medium',
      assignee_id: 'u_theo',
      label_ids: [],
      values: {},
      parent_id: null,
      start_date: null,
      due_date: '2026-11-16',
    };
    api = mockApi({ 'GET /api/v1/templates/tpl_app_report/draft': () => ({ body: { data: draft } }) });

    expect(await templateDraft('tpl_app_report')).toEqual(draft);
  });

  it('previews a schedule with a read POST: only what was given goes along', async () => {
    const preview: SchedulePreview = { runs: ['2026-11-02T08:00:00.000Z'], title: 'Bericht November' };
    api = mockApi({ 'POST /api/v1/templates/preview': () => ({ body: { data: preview } }) });

    expect(await previewSchedule({ schedule: firstMonday, title: 'Bericht {month_name}', run_count: 2 })).toEqual(preview);
    await previewSchedule({ schedule: firstMonday });

    expect(api.calls.map((call) => call.body)).toEqual([{ schedule: firstMonday, title: 'Bericht {month_name}', run_count: 2 }, { schedule: firstMonday }]);
  });
});

describe('automations', () => {
  it('lists the four automations of a project', async () => {
    const unsaved = makeAutomation({ id: null, key: 'close_parent', enabled: false, settings: {} });
    api = mockApi({ 'GET /api/v1/projects/p_web/automations': () => ({ body: { data: [makeAutomation(), unsaved] } }) });

    expect(await listAutomations('p_web')).toEqual({ items: [makeAutomation(), unsaved], next_cursor: null, total: 2 });
  });

  it('switches one automation by its key and sends no key or project in the body', async () => {
    const saved = makeAutomation({ key: 'auto_close', settings: { days: 14, state_id: 'st_cancelled' } });
    api = mockApi({ 'PUT /api/v1/projects/p_web/automations/auto_close': () => ({ body: { data: saved } }) });

    expect(await saveAutomation({ project_id: 'p_web', key: 'auto_close', enabled: true, settings: { days: 14, state_id: 'st_cancelled' } })).toEqual(saved);
    expect(api.calls[0]?.body).toEqual({ enabled: true, settings: { days: 14, state_id: 'st_cancelled' } });
  });
});
