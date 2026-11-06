import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, makeDelivery, makeWebhook } from '@/test/fixtures';
import { qk } from './keys';
import { useDeleteWebhook, useDeliveries, usePingWebhook, useRedeliver, useRotateWebhookSecret, useSaveWebhook, useWebhooks } from './webhooks';

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
});

const webhook = makeWebhook();
const input = { name: webhook.name, url: webhook.url, project_id: null, events: ['work_item.*'], bot_id: null, active: true };

describe('webhooks', () => {
  it('reads the webhooks and the attempts of one, and waits without an id', async () => {
    const attempt = makeDelivery();
    api = mockApi({
      'GET /api/v1/webhooks': () => ({ body: list([webhook]) }),
      'GET /api/v1/webhooks/wh_1/deliveries': () => ({ body: list([attempt]) }),
    });
    const { result } = renderHook(() => ({ all: useWebhooks(), log: useDeliveries('wh_1'), none: useDeliveries(null) }), { wrapper });

    await waitFor(() => expect(result.current.log.isSuccess).toBe(true));
    expect(result.current.all.data?.items).toEqual([webhook]);
    expect(result.current.log.data?.items).toEqual([attempt]);
    expect(result.current.none.fetchStatus).toBe('idle');
  });

  it('makes webhooks stale after saving, renewing and deleting, and deliveries after deleting', async () => {
    api = mockApi({
      'POST /api/v1/webhooks': () => ({ status: 201, body: { data: webhook, secret: 'whsec_neu' } }),
      'POST /api/v1/webhooks/wh_1/rotate-secret': () => ({ body: { data: webhook, secret: 'whsec_rotiert' } }),
      'DELETE /api/v1/webhooks/wh_1': () => ({ status: 204 }),
    });
    const probes = [qk.webhooks.all, qk.deliveries.all, qk.projects.all];
    const stale = () => probes.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated);
    const fill = () => probes.forEach((queryKey) => queryClient.setQueryData(queryKey, 'cached'));
    const { result } = renderHook(() => ({ save: useSaveWebhook(), rotate: useRotateWebhookSecret(), remove: useDeleteWebhook() }), { wrapper });

    fill();
    expect(await act(() => result.current.save.mutateAsync(input))).toEqual({ webhook, secret: 'whsec_neu' });
    expect(stale()).toEqual([true, false, false]);

    fill();
    await act(() => result.current.rotate.mutateAsync('wh_1'));
    expect(stale()).toEqual([true, false, false]);

    fill();
    await act(() => result.current.remove.mutateAsync('wh_1'));
    expect(stale()).toEqual([true, true, false]);
  });

  it('makes deliveries and webhooks stale after a ping and after sending again (a success sets last_success_at)', async () => {
    api = mockApi({
      'POST /api/v1/webhooks/wh_1/ping': () => ({ body: { data: makeDelivery({ kind: 'ping' }) } }),
      'POST /api/v1/webhooks/wh_1/deliveries/dl_1/redeliver': () => ({ body: { data: makeDelivery({ kind: 'manual' }) } }),
    });
    const probes = [qk.webhooks.all, qk.deliveries.all];
    const stale = () => probes.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated);
    const fill = () => probes.forEach((queryKey) => queryClient.setQueryData(queryKey, 'cached'));
    const { result } = renderHook(() => ({ ping: usePingWebhook(), again: useRedeliver() }), { wrapper });

    fill();
    await act(() => result.current.ping.mutateAsync('wh_1'));
    expect(stale()).toEqual([true, true]);

    fill();
    await act(() => result.current.again.mutateAsync({ webhook_id: 'wh_1', delivery_id: 'dl_1' }));
    expect(stale()).toEqual([true, true]);
  });

  it('keeps no secret in the mutation cache once the call is reset', async () => {
    api = mockApi({
      'POST /api/v1/webhooks': () => ({ status: 201, body: { data: webhook, secret: 'whsec_geheim_1' } }),
      'POST /api/v1/webhooks/wh_1/rotate-secret': () => ({ body: { data: webhook, secret: 'whsec_geheim_2' } }),
    });
    const { result } = renderHook(() => ({ save: useSaveWebhook(), rotate: useRotateWebhookSecret() }), { wrapper });
    const cached = () => JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data ?? null));

    await act(() => result.current.save.mutateAsync(input));
    await act(() => result.current.rotate.mutateAsync('wh_1'));
    expect(cached()).toContain('whsec_geheim_');

    act(() => {
      result.current.save.reset();
      result.current.rotate.reset();
    });
    await waitFor(() => expect(cached()).not.toContain('whsec_geheim_'));
  });
});
