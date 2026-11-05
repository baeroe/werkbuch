import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { firstMonday, list, makeAutomation, makeTemplate, makeTemplateRun, web47 } from '@/test/fixtures';
import { useAutomations, useSaveAutomation } from './automations';
import { qk } from './keys';
import { useDeleteTemplate, useRunTemplateNow, useSaveTemplate, useSchedulePreview, useTemplateRuns, useTemplates } from './templates';

let queryClient: QueryClient;
let api: MockApi | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  vi.useRealTimers();
});

const template = makeTemplate();
const payload = { ...template.payload, description_json: null };

describe('templates', () => {
  it('reads every page of the templates of a project or of all, and the runs of a template', async () => {
    api = mockApi({
      'GET /api/v1/projects/p_app/templates': (_body, url) => ({
        body: url.searchParams.get('cursor') === 'c1' ? list([makeTemplate({ id: 'tpl_2' })]) : { ...list([template]), meta: { next_cursor: 'c1', total: 2 } },
      }),
      'GET /api/v1/templates': () => ({ body: list([template]) }),
      'GET /api/v1/templates/tpl_app_report/runs': () => ({ body: list([makeTemplateRun()]) }),
    });

    const { result } = renderHook(() => ({ project: useTemplates('p_app'), all: useTemplates(), runs: useTemplateRuns('tpl_app_report'), idle: useTemplateRuns(null) }), { wrapper });

    await waitFor(() => expect(result.current.project.data?.items.map((entry) => entry.id)).toEqual(['tpl_app_report', 'tpl_2']));
    await waitFor(() => expect(result.current.all.data?.items).toEqual([template]));
    await waitFor(() => expect(result.current.runs.data?.items).toEqual([makeTemplateRun()]));
    expect(result.current.idle.fetchStatus).toBe('idle');
    expect(queryClient.getQueryData(qk.templates.list({ project: 'p_app' }))).toBeDefined();
    expect(queryClient.getQueryData(qk.templateRuns.list({ template: 'tpl_app_report' }))).toBeDefined();
  });

  it('makes templates, runs, items, the history and the search stale after saving, deleting and running by hand', async () => {
    api = mockApi({
      'POST /api/v1/projects/p_app/templates': () => ({ status: 201, body: { data: template } }),
      'DELETE /api/v1/templates/tpl_app_report': () => ({ status: 204 }),
      'POST /api/v1/templates/tpl_app_report/run': () => ({ body: { data: { run: makeTemplateRun(), item: web47 } } }),
    });
    const probes = [qk.templates.list({}), qk.templateRuns.list({ template: 'x' }), qk.workItems.all, qk.activity.all, qk.search.list({ q: 'x' })];
    const fill = () => probes.forEach((queryKey) => queryClient.setQueryData(queryKey, { items: [] }));
    const stale = () => probes.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated);
    const { result } = renderHook(() => ({ save: useSaveTemplate(), remove: useDeleteTemplate(), run: useRunTemplateNow() }), { wrapper });

    for (const call of [
      () => result.current.save.mutateAsync({ project_id: 'p_app', name: 'Monatsbericht', payload, schedule: firstMonday }),
      () => result.current.remove.mutateAsync('tpl_app_report'),
      () => result.current.run.mutateAsync('tpl_app_report'),
    ]) {
      fill();
      expect(stale()).toEqual([false, false, false, false, false]);
      await act(async () => void (await call()));
      expect(stale()).toEqual([true, true, true, true, true]);
    }
  });

  it('asks nothing for no schedule, and once for what was typed after a pause, keeping the last terms meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api = mockApi({
      'POST /api/v1/templates/preview': (body) => ({ body: { data: { runs: [], title: (body as { title: string }).title } } }),
    });
    const { result, rerender } = renderHook(({ input }) => useSchedulePreview(input), { wrapper, initialProps: { input: null as Parameters<typeof useSchedulePreview>[0] } });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.calls).toEqual([]);

    rerender({ input: { schedule: firstMonday, title: 'A' } });
    rerender({ input: { schedule: firstMonday, title: 'AB' } });
    rerender({ input: { schedule: firstMonday, title: 'ABC' } });
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(api.calls).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(1));
    await vi.waitFor(() => expect(result.current.data?.title).toBe('ABC'));
    expect(api.calls.map((call) => call.body)).toEqual([{ schedule: firstMonday, title: 'ABC' }]);

    rerender({ input: { schedule: firstMonday, title: 'ABCD' } });
    expect(result.current.data?.title).toBe('ABC');
    expect(queryClient.getQueryCache().findAll({ queryKey: qk.schedulePreview.all })).toHaveLength(2);
    expect(queryClient.getQueryCache().findAll({ queryKey: qk.templates.all })).toHaveLength(0);

    rerender({ input: null });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('automations', () => {
  it('reads the four automations of a project and waits without one', async () => {
    api = mockApi({ 'GET /api/v1/projects/p_web/automations': () => ({ body: { data: [makeAutomation()] } }) });

    const { result } = renderHook(() => ({ four: useAutomations('p_web'), idle: useAutomations(null) }), { wrapper });

    await waitFor(() => expect(result.current.four.data?.items).toEqual([makeAutomation()]));
    expect(result.current.idle.fetchStatus).toBe('idle');
  });

  it('saves one automation under the mutation key of its project and key, and makes the automations stale', async () => {
    api = mockApi({ 'PUT /api/v1/projects/p_web/automations/auto_archive': () => ({ body: { data: makeAutomation({ enabled: false }) } }) });
    queryClient.setQueryData(qk.automations.list({ project: 'p_web' }), { items: [] });
    const { result } = renderHook(() => useSaveAutomation('p_web', 'auto_archive'), { wrapper });

    await act(async () => void (await result.current.mutateAsync({ enabled: false, settings: { days: 30 } })));

    expect(api?.calls[0]?.body).toEqual({ enabled: false, settings: { days: 30 } });
    expect(queryClient.getQueryState(qk.automations.list({ project: 'p_web' }))?.isInvalidated).toBe(true);
    expect(qk.automations.save('p_web', 'auto_archive')).toEqual(['automations', 'save', 'p_web', 'auto_archive']);
    expect(queryClient.getMutationCache().getAll()[0]?.options.mutationKey).toEqual(qk.automations.save('p_web', 'auto_archive'));
  });
});
