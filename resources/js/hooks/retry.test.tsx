import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { refetchFailed, useRefetchFailed } from './retry';

/** A region of a screen with a query of its own; its retry button retries its own query first, then all failed ones. */
function Region({ name, load }: { name: string; load: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['region', name], queryFn: load });
  const retryAll = useRefetchFailed();
  if (query.isError) {
    return (
      <button
        type="button"
        onClick={() => {
          void query.refetch();
          retryAll();
        }}
        disabled={query.isFetching}
      >
        Erneut versuchen
      </button>
    );
  }
  return <p>{query.data ?? `${name} lädt …`}</p>;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('"Erneut versuchen" after an outage', () => {
  it('fetches every failed query again, not only the one of its own region, and leaves what loaded alone', async () => {
    let down = true;
    const answer = (text: string) =>
      vi.fn(async () => {
        if (down) throw new Error('Der Server antwortet nicht.');
        return text;
      });
    const sidebar = answer('Seitenleiste geladen');
    const list = answer('Liste geladen');
    const client = newClient();
    render(
      <QueryClientProvider client={client}>
        <Region name="Seitenleiste" load={sidebar} />
        <Region name="Liste" load={list} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Erneut versuchen' })).toHaveLength(2));
    // a region that loaded after the outage: no failed query, nothing to fetch again
    down = false;
    const settled = answer('Kopf geladen');
    render(
      <QueryClientProvider client={client}>
        <Region name="Kopf" load={settled} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Kopf geladen')).toBeTruthy();

    // the retry of the list
    await userEvent.click(screen.getAllByRole('button', { name: 'Erneut versuchen' })[1]!);

    expect(await screen.findByText('Liste geladen')).toBeTruthy();
    expect(await screen.findByText('Seitenleiste geladen')).toBeTruthy();
    // each failed query once more (the list's own retry is not sent twice), the loaded one not again
    expect(list).toHaveBeenCalledTimes(2);
    expect(sidebar).toHaveBeenCalledTimes(2);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('leaves a failed query alone that nothing shows any more', async () => {
    const client = newClient();
    const gone = vi.fn(async () => Promise.reject(new Error('Der Server antwortet nicht.')));
    await client.prefetchQuery({ queryKey: ['gone'], queryFn: gone });
    expect(client.getQueryState(['gone'])?.status).toBe('error');

    await refetchFailed(client);

    expect(gone).toHaveBeenCalledTimes(1);
  });
});

describe('useRefetchFailed', () => {
  it('fetches the failed queries of the surrounding client again', async () => {
    const client = newClient();
    let down = true;
    const load = vi.fn(async () => {
      if (down) throw new Error('Der Server antwortet nicht.');
      return 'da';
    });
    render(
      <QueryClientProvider client={client}>
        <Region name="Liste" load={load} />
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Erneut versuchen' });
    down = false;
    const { result } = renderHook(() => useRefetchFailed(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });

    result.current();

    expect(await screen.findByText('da')).toBeTruthy();
  });

  it('does nothing outside a QueryClientProvider', () => {
    const { result } = renderHook(() => useRefetchFailed());

    expect(() => result.current()).not.toThrow();
  });
});
