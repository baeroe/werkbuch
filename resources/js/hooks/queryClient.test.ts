import { afterEach, describe, expect, it } from 'vitest';
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

  it('keeps the cache of a guest who stays a guest', () => {
    queryClient.setQueryData(['x'], 1);

    resetForUser(null, null);

    expect(cached()).toBe(1);
  });
});
