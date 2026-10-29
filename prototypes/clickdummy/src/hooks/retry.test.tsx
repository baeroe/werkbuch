import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from '@/components/ui/ErrorState';

/** A region of a screen with a query of its own; its error state retries only that query. */
function Region({ name, load }: { name: string; load: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['region', name], queryFn: load });
  if (query.isError) {
    return <ErrorState title={`${name} nicht geladen`} description="Der Server antwortet nicht." onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return <p>{query.data ?? `${name} lädt …`}</p>;
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    await userEvent.click(screen.getAllByRole('button', { name: 'Erneut versuchen' })[1]);

    expect(await screen.findByText('Liste geladen')).toBeTruthy();
    expect(await screen.findByText('Seitenleiste geladen')).toBeTruthy();
    // each failed query once more (the list's own retry is not sent twice), the loaded one not again
    expect(list).toHaveBeenCalledTimes(2);
    expect(sidebar).toHaveBeenCalledTimes(2);
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
