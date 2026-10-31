import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { agency, project, standard } from '@/test/fixtures';
import { assignWorkflow, deleteWorkflow, listWorkflows, saveWorkflow, type WorkflowInput } from './workflows';

let api: MockApi;

afterEach(() => api.restore());

describe('workflows', () => {
  it('lists the workflows of one page and passes the cursor', async () => {
    api = mockApi({ 'GET /api/v1/workflows': () => ({ body: { data: [standard], links: {}, meta: { next_cursor: 'c2', total: 2 } } }) });

    expect(await listWorkflows({ cursor: 'c1' })).toEqual({ items: [standard], next_cursor: 'c2', total: 2 });
    expect(await listWorkflows()).toEqual({ items: [standard], next_cursor: 'c2', total: 2 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/workflows?cursor=c1', '/api/v1/workflows']);
  });

  it('creates a workflow with POST and changes one with PUT, the state mapping in the body', async () => {
    api = mockApi({
      'POST /api/v1/workflows': (body) => ({ status: 201, body: { data: { ...agency, ...(body as object), id: 'wf_new' } } }),
      'PUT /api/v1/workflows/wf_agency': (body) => ({ body: { data: { ...agency, ...(body as object), id: 'wf_agency' } } }),
    });
    const { id: _id, ...spec } = agency;

    expect((await saveWorkflow(spec)).id).toBe('wf_new');
    expect((await saveWorkflow({ ...spec, id: 'wf_agency', name: 'Agentur' }, { state_mapping: { app_review: 'app_progress' } })).name).toBe('Agentur');
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/v1/workflows', spec],
      ['PUT', '/api/v1/workflows/wf_agency', { ...spec, name: 'Agentur', state_mapping: { app_review: 'app_progress' } }],
    ]);
  });

  it('sends new states without an id as they are', async () => {
    api = mockApi({ 'POST /api/v1/workflows': () => ({ status: 201, body: { data: standard } }) });
    const spec: WorkflowInput = { ...standard, id: undefined, states: [{ name: 'Open', icon: 'circle', category: 'unstarted', position: 0 }] };

    await saveWorkflow(spec);

    expect((api.calls[0]!.body as WorkflowInput).states).toEqual([{ name: 'Open', icon: 'circle', category: 'unstarted', position: 0 }]);
  });

  it('deletes a workflow', async () => {
    api = mockApi({ 'DELETE /api/v1/workflows/wf_agency': () => ({}) });

    await expect(deleteWorkflow('wf_agency')).resolves.toBeUndefined();
    expect(api.calls).toEqual([{ method: 'DELETE', url: '/api/v1/workflows/wf_agency', body: undefined }]);
  });

  it('switches the workflow of a project by its escaped reference', async () => {
    const web = project('WEB', 'admin', { workflow_id: 'wf_agency' });
    api = mockApi({ 'PUT /api/v1/projects/WEB%2Fx/workflow': () => ({ body: { data: web } }) });

    expect(await assignWorkflow('WEB/x', 'wf_agency', { std_todo: 'app_todo' })).toEqual(web);
    expect(api.calls[0]).toEqual({ method: 'PUT', url: '/api/v1/projects/WEB%2Fx/workflow', body: { workflow_id: 'wf_agency', mapping: { std_todo: 'app_todo' } } });
  });

  it('keeps the errors of a workflow per field', async () => {
    api = mockApi({
      'POST /api/v1/workflows': () => ({ status: 422, body: { reason: 'validation_failed', errors: { 'states.0.name': ['x'], 'transitions.2': ['y'] } } }),
    });

    await expect(saveWorkflow({ ...standard, id: undefined })).rejects.toMatchObject({ status: 422, errors: { 'states.0.name': ['x'], 'transitions.2': ['y'] } });
  });
});
