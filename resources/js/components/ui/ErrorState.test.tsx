import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('is an alert with the cause and a retry button', () => {
    render(<ErrorState description="Der Server antwortet gerade nicht (503)." onRetry={() => {}} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Konnte nicht geladen werden');
    expect(alert.textContent).toContain('Der Server antwortet gerade nicht (503).');
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });

  it('takes its own title and class', () => {
    render(<ErrorState title="Items nicht geladen" description="Offline." onRetry={() => {}} className="mt-6" />);

    expect(screen.getByRole('alert').textContent).toContain('Items nicht geladen');
    expect(screen.getByRole('alert').className).toContain('mt-6');
  });

  it('calls onRetry also outside a query client', async () => {
    const onRetry = vi.fn();
    render(<ErrorState description="Offline." onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the busy state while the retry runs, and ignores another press', async () => {
    const onRetry = vi.fn();
    render(<ErrorState description="Offline." onRetry={onRetry} retrying />);

    const button = screen.getByRole('button', { name: 'Erneut versuchen' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    await userEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries the other failed active queries as well', async () => {
    let down = true;
    const sidebar = vi.fn(async () => {
      if (down) throw new Error('down');
      return 'Seitenleiste geladen';
    });
    function Sidebar() {
      const query = useQuery({ queryKey: ['sidebar'], queryFn: sidebar });
      return <p>{query.data ?? (query.isError ? 'Seitenleiste fehlt' : 'lädt')}</p>;
    }
    const onRetry = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Sidebar />
        <ErrorState description="Offline." onRetry={onRetry} />
      </QueryClientProvider>,
    );
    await screen.findByText('Seitenleiste fehlt');

    down = false;
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(onRetry).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText('Seitenleiste geladen')).toBeTruthy());
    expect(sidebar).toHaveBeenCalledTimes(2);
  });
});
