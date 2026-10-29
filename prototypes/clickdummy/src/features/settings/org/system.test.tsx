import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/api/db';
import { getSystemStatus } from '@/api/system';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import System from './System';

beforeEach(() => {
  resetApi();
});

afterEach(() => {
  act(() => resetToasts());
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The text of a toast with the non-breaking spaces of counts read as plain spaces. */
const plain = (text: string | undefined) => (text ?? '').replaceAll('\u00a0', ' ');

describe('System', () => {
  it('shows the version, the queue, the search and the failed jobs with their errors', async () => {
    renderWithData(<System readOnlyReason={null} />);

    const instance = await screen.findByRole('list', { name: 'Zustand der Instanz' });
    expect(within(instance).getByText('0.1.0-dev')).toBeTruthy();
    expect(within(instance).getByText('3 Jobs warten')).toBeTruthy();
    expect(within(instance).getByText('Läuft')).toBeTruthy();

    const failed = screen.getByRole('list', { name: 'Fehlgeschlagene Jobs' });
    const jobs = within(failed).getAllByRole('listitem');
    expect(jobs).toHaveLength(2);
    expect(within(jobs[0]).getByText('App\\Jobs\\DeliverWebhook')).toBeTruthy();
    expect(within(jobs[0]).getByText(/cURL error 28/)).toBeTruthy();
  });

  it('puts the failed jobs back in the queue with "Alle erneut versuchen" and says how many', async () => {
    const user = userEvent.setup();
    renderWithData(<System readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Alle erneut versuchen' }));

    expect(await screen.findByText('Keine fehlgeschlagenen Jobs')).toBeTruthy();
    expect(currentToasts().some((item) => plain(item.title) === '2 Jobs wieder eingereiht')).toBe(true);
    await waitFor(async () => {
      const status = await getSystemStatus();
      expect([status.failed_jobs.length, status.queued_jobs]).toEqual([0, 5]);
    });
    expect(within(screen.getByRole('list', { name: 'Zustand der Instanz' })).getByText('5 Jobs warten')).toBeTruthy();
  });

  it('sends the test mail to the signed-in admin and names the address', async () => {
    const user = userEvent.setup();
    renderWithData(<System readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Testmail senden' }));

    await waitFor(() => expect(currentToasts().some((item) => item.title === 'Testmail an mara@feldwerk.example.com gesendet')).toBe(true));
  });

  it('says why the test mail cannot go out when no mail server is set up', async () => {
    getDb().system.mail_configured = false;
    renderWithData(<System readOnlyReason={null} />);

    const button = await screen.findByRole('button', { name: 'Testmail senden' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Es ist kein Mailserver eingerichtet.');
    expect(screen.getByText('Nicht eingerichtet')).toBeTruthy();
  });
});
