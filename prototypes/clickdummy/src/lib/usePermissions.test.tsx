import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAIL_KEY } from '@/api/client';
import { resetApi } from '@/test/api';
import { usePermissions } from './permissions';

function Probe() {
  const { loading, can, reason } = usePermissions();
  return <p>{loading ? 'lädt' : can('item.edit', 'WEB') ? 'darf ändern' : `nein: ${reason('item.edit', 'WEB')}`}</p>;
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Probe />
    </QueryClientProvider>,
  );

beforeEach(resetApi);
afterEach(() => localStorage.removeItem(FAIL_KEY));

describe('usePermissions', () => {
  it('says that the rights still load, until they are there', async () => {
    show();
    expect(screen.getByText('lädt')).toBeTruthy();
    expect(await screen.findByText('darf ändern')).toBeTruthy();
  });

  it('stops loading when the rights cannot be loaded, and gives that as the reason', async () => {
    localStorage.setItem(FAIL_KEY, '1');
    show();
    expect(await screen.findByText('nein: Die Rechte konnten nicht geladen werden.')).toBeTruthy();
  });
});
