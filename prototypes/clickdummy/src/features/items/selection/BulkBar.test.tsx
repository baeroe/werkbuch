import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getWorkItem } from '@/api/workItems';
import { currentToasts } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { asUser, resetApi } from '@/test/api';
import { BulkBar } from './BulkBar';

beforeEach(() => {
  resetApi();
});

describe('the bulk bar', () => {
  it('names the refused items even when the bar is gone before the answer (Esc during the request)', async () => {
    // Theo only reads WEB, but administers APP: the WEB item is refused, the APP item changes
    asUser('u_theo');
    const items = [(await getWorkItem('WEB-50')).item, (await getWorkItem('APP-14')).item];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <BulkBar items={items} total={2} onSelectAll={() => undefined} onClear={() => undefined} onArchive={() => undefined} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    // once the rights have loaded the action is a menu (until then a button that says why it waits)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Priorität' }).getAttribute('aria-disabled')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Priorität' }));
    const urgent = await screen.findByRole('menuitem', { name: 'Urgent' });
    // choose, and in the same moment the selection goes (Esc): the bar is gone before the server answers
    fireEvent.click(urgent);
    view.unmount();

    await waitFor(() =>
      expect(currentToasts().some((entry) => entry.title === '1 von 2 Items geändert' && entry.description?.includes('WEB-50: Dafür fehlt die Berechtigung.'))).toBe(true),
    );
    expect((await getWorkItem('APP-14')).item.priority).toBe('urgent');
  });
});
