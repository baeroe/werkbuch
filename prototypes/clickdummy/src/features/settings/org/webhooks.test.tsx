import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEBHOOK_EVENTS, listDeliveries, listWebhooks, saveWebhook } from '@/api/webhooks';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import { EVENT_GROUPS } from './catalog';
import { countEvents, eventsOf, selectionOf } from './events';
import { WebhookDeliveries } from './WebhookDeliveries';
import Webhooks from './Webhooks';

beforeEach(() => {
  resetApi();
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const cardOf = (name: string) => screen.findByRole('article', { name });

describe('the event tree', () => {
  it('lists the events of the spec, group by group, as the server accepts them', () => {
    expect(Object.fromEntries(EVENT_GROUPS.map((group) => [group.group, group.events.map((entry) => entry.event)]))).toEqual(
      Object.fromEntries(Object.entries(WEBHOOK_EVENTS).map(([group, events]) => [group, [...events]])),
    );
  });

  it('stores a whole group as its wildcard and single events by name', () => {
    expect(eventsOf(selectionOf(['work_item.*', 'bot.assigned']))).toEqual(['work_item.*', 'bot.assigned']);
    // all events of a group, ticked one by one, are the wildcard
    expect(eventsOf(selectionOf(['bot.mentioned', 'bot.assigned']))).toEqual(['bot.*']);
    expect(selectionOf(['comment.*']).comment).toEqual(['created', 'updated', 'deleted']);
    expect(eventsOf({})).toEqual([]);
    expect(countEvents(['work_item.*', 'bot.assigned'])).toBe(10);
  });
});

describe('Webhooks', () => {
  it('shows the secret of a new webhook once and nowhere after the dialog is closed', async () => {
    const user = userEvent.setup();
    renderWithData(<Webhooks readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Chat-Hinweise');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://chat.example.com/hooks/werkbuch');
    // one click on the group ticks all its events
    await user.click(within(form).getByRole('checkbox', { name: /^Kommentare/ }));
    await user.click(within(form).getByRole('button', { name: /^Anlegen/ }));

    const result = await screen.findByRole('dialog', { name: 'Webhook ist angelegt' });
    const secret = within(result).getByRole<HTMLInputElement>('textbox', { name: 'Geheimnis' }).value;
    expect(secret).toMatch(/^whsec_/);
    expect(within(result).getByText('Kopiere das Geheimnis jetzt')).toBeTruthy();

    await user.click(within(result).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await cardOf('Chat-Hinweise')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(secret);
    // the server hands out no secret any more, not even to its own admin
    expect(JSON.stringify((await listWebhooks()).items)).not.toContain(secret);
    expect((await listWebhooks()).items.find((webhook) => webhook.name === 'Chat-Hinweise')?.events).toEqual(['comment.*']);
  });

  it('refuses a private address next to the URL field', async () => {
    const user = userEvent.setup();
    renderWithData(<Webhooks readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Lokal');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'http://localhost:3000/hook');
    await user.click(within(form).getByRole('checkbox', { name: /^Bots/ }));
    await user.click(within(form).getByRole('button', { name: /^Anlegen/ }));

    expect(await within(form).findByText('Ziele in privaten Netzen sind gesperrt.')).toBeTruthy();
    expect((await listWebhooks()).items).toHaveLength(3);
  });

  it('marks the webhook the system switched off and turns it on again', async () => {
    const user = userEvent.setup();
    renderWithData(<Webhooks readOnlyReason={null} />);

    const crm = await cardOf('Altes CRM');
    expect(within(crm).getByText('Abgeschaltet')).toBeTruthy();
    expect(within(crm).getByText(/24 Stunden/)).toBeTruthy();
    // the ones that work say so, and show no such mark
    expect(within(await cardOf('Deploy-Bot')).queryByText('Abgeschaltet')).toBeNull();
    expect(within(await cardOf('Deploy-Bot')).getByText('Aktiv')).toBeTruthy();

    await user.click(within(crm).getByRole('button', { name: 'Wieder aktivieren' }));
    await waitFor(async () => {
      const stored = (await listWebhooks()).items.find((webhook) => webhook.id === 'wh_crm')!;
      expect([stored.active, stored.disabled_at]).toEqual([true, null]);
    });
    expect(within(await cardOf('Altes CRM')).queryByText('Abgeschaltet')).toBeNull();
    expect(within(await cardOf('Altes CRM')).getByText('Aktiv')).toBeTruthy();
  });

  it('answers a test ping with what the receiver said', async () => {
    const user = userEvent.setup();
    renderWithData(<Webhooks readOnlyReason={null} />);

    await user.click(await within(await cardOf('Deploy-Bot')).findByRole('button', { name: /^Test-Ping/ }));
    await waitFor(() => expect(currentToasts().some((item) => /Test-Ping.*Deploy-Bot/.test(item.title) && /200/.test(item.description ?? ''))).toBe(true));
    expect((await listDeliveries('wh_deploy')).items[0].event).toBe('ping');
  });
});

describe('WebhookDeliveries', () => {
  it('lists the attempts with status, duration and the cut-off answer, newest first', async () => {
    renderWithData(<WebhookDeliveries webhookId="wh_crm" onClose={() => {}} />);

    const log = await screen.findByRole('list', { name: 'Zustellungen' });
    const rows = within(log).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    // attempt 8 is the newest: HTTP 500 after 460 ms
    expect(within(rows[0]).getByText('Versuch 8')).toBeTruthy();
    expect(within(rows[0]).getByText('500')).toBeTruthy();
    expect(within(rows[0]).getByText('460 ms')).toBeTruthy();
    expect(within(rows[0]).getByText('{"error":"Internal Server Error"}')).toBeTruthy();
    // attempt 7 timed out: no status, the error says why
    expect(within(rows[1]).getByText('Keine Antwort')).toBeTruthy();
    expect(within(rows[1]).getByText('Zeitüberschreitung nach 10 s')).toBeTruthy();
  });

  it('sends a delivery again and sends a test ping, each as a new entry at the top', async () => {
    const user = userEvent.setup();
    renderWithData(<WebhookDeliveries webhookId="wh_deploy" onClose={() => {}} />);

    const log = await screen.findByRole('list', { name: 'Zustellungen' });
    expect(within(log).getAllByRole('listitem')).toHaveLength(6);

    await user.click(within(within(log).getAllByRole('listitem')[0]).getByRole('button', { name: /^Erneut senden/ }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Zustellungen' })).getAllByRole('listitem')).toHaveLength(7));

    await user.click(screen.getByRole('button', { name: /^Test-Ping/ }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Zustellungen' })).getAllByRole('listitem')).toHaveLength(8));
    expect(within(within(screen.getByRole('list', { name: 'Zustellungen' })).getAllByRole('listitem')[0]).getByText('ping')).toBeTruthy();
  });

  it('says what an empty log means and offers the test ping', async () => {
    // the seed has attempts for all three webhooks; one of its own has none
    const { webhook } = await saveWebhook({ name: 'Neu', url: 'https://neu.example.com/hook', project_id: null, events: ['page.*'], bot_id: null, active: true });
    renderWithData(<WebhookDeliveries webhookId={webhook.id} onClose={() => {}} />);

    expect(await screen.findByText('Noch keine Zustellungen')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Test-Ping/ }).length).toBeGreaterThan(0);
  });
});
