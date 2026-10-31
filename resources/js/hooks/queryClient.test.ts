import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient, resetForUser } from './queryClient';

const cached = () => queryClient.getQueryCache().getAll().length;

afterEach(() => queryClient.clear());

describe('queryClient', () => {
  it('does not retry, goes stale after ten seconds and leaves the window focus alone', () => {
    expect(queryClient.getDefaultOptions().queries).toEqual({ retry: false, staleTime: 10_000, refetchOnWindowFocus: false });
    expect(queryClient.getDefaultOptions().mutations).toEqual({ retry: false });
  });
});

describe('resetForUser', () => {
  it('keeps the cache while the same person is signed in', () => {
    queryClient.setQueryData(['x'], 1);

    resetForUser('a', 'a');

    expect(cached()).toBe(1);
  });

  it.each([
    ['another account', 'a', 'b'],
    ['sign-out', 'a', null],
    ['sign-in', null, 'b'],
  ])('clears the cache on %s', (_name, previous, next) => {
    queryClient.setQueryData(['x'], 1);

    resetForUser(previous, next);

    expect(cached()).toBe(0);
  });

  it('drops the queries of the old account instead of loading them again, even one that is still observed', async () => {
    // a switch of account always passes a page without the shell, so no observer of the old account is left over in
    // the app; one that was (a reset would load it again for the new person) is dropped as well
    const queryFn = vi.fn(() => Promise.resolve('Maras Projekte'));
    const observer = new QueryObserver(queryClient, { queryKey: ['projects'], queryFn });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(queryClient.getQueryData(['projects'])).toBe('Maras Projekte'));

    resetForUser('u_mara', 'u_ida');
    await Promise.resolve();

    expect(cached()).toBe(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps the cache of a guest who stays a guest', () => {
    queryClient.setQueryData(['x'], 1);

    resetForUser(null, null);

    expect(cached()).toBe(1);
  });
});
