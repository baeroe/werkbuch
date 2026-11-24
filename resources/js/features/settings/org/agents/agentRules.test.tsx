/*
 * Organisation → Agenten (spec 7.3, 10.5) against a fake server: the order of the prompt, a tab per kind with the
 * contract to read, the own text and "Standard wiederherstellen" with undo, one call per kind that changed, the refusal
 * at the text of its kind, members reading. The flow with a real server runs in e2e/tests/agent-rules.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, mara, organization } from '@/test/fixtures';
import type { AgentRule, RunType, User } from '@/types';
import { OrgSettings } from '../OrgSettings';

const who = vi.hoisted(() => ({ user: null as User | null }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: who.user, permissions: [] }, organization }, url: '/settings/agents' }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

const TYPES: RunType[] = ['task', 'correction', 'conflict', 'review', 'comment'];
const standardOf = (type: RunType) => `## Standard ${type}`;
const rule = (type: RunType, own?: string): AgentRule => ({ type, body: own ?? standardOf(type), standard: own === undefined, contract: `Contract of ${type}: {key}`, standard_body: standardOf(type) });

let api: MockApi | undefined;

function renderRules({ user = mara, own = { review: 'Review gently.' } as Partial<Record<RunType, string>>, put }: { user?: User; own?: Partial<Record<RunType, string>>; put?: (type: RunType, body: string | null) => ReturnType<MockRoute> } = {}) {
  who.user = user;
  let stored = { ...own };
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: { data: [], meta: { total: 0 } } }),
    'GET /api/v1/agent-rules': () => ({ body: { data: TYPES.map((type) => rule(type, stored[type])) } }),
    ...Object.fromEntries(
      TYPES.map((type) => [
        `PUT /api/v1/agent-rules/${type}`,
        (body: unknown) => {
          const sent = (body as { body: string | null }).body;
          const refused = put?.(type, sent);
          if (refused) return refused;
          stored = { ...stored, [type]: sent ?? undefined };
          return { body: { data: rule(type, sent ?? undefined) } };
        },
      ]),
    ),
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <OrgSettings section="agents" />
    </QueryClientProvider>,
  );
}

const puts = () => api!.calls.filter((call) => call.method === 'PUT');
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail: reason, ...extra } });

afterEach(() => {
  api?.restore();
  api = undefined;
  act(() => resetToasts());
});

describe('AgentRules', () => {
  it('sits in "Betrieb", says how the prompt comes about and shows a tab per kind with its contract folded', async () => {
    const user = userEvent.setup();
    renderRules();

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByRole('link', { name: 'Agenten' }).getAttribute('aria-current')).toBe('page');
    const order = await screen.findByRole('region', { name: 'So entsteht der Prompt' });
    expect(within(order).getAllByRole('listitem')).toHaveLength(5);
    expect(within(order).getByRole('link', { name: 'Typen' }).getAttribute('href')).toBe('/settings/types');

    const tabs = await screen.findByRole('tablist', { name: 'Arbeitsregeln je Auftragstyp' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Umsetzen', 'Korrektur', 'Konflikt lösen', 'Review', 'Antwort']);
    // the own text of a kind is marked at its tab
    expect(within(within(tabs).getByRole('tab', { name: /Review/ })).getByRole('img', { name: 'eigener Text' })).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Arbeitsregeln für „Umsetzen“' }).value).toBe('## Standard task');
    expect(screen.getByText('Standard von werkbuch')).toBeTruthy();
    expect(screen.getByText('Contract of task: {key}').closest('pre')!.getAttribute('lang')).toBe('en');
    expect(screen.getByText('Gibt werkbuch immer vor („Umsetzen“)')).toBeTruthy();

    await user.click(within(tabs).getByRole('tab', { name: /Review/ }));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Arbeitsregeln für „Review“' }).value).toBe('Review gently.');
    expect(screen.getByText('Eigener Text')).toBeTruthy();
    expect(document.title).toBe('Agenten – Einstellungen – werkbuch');
  });

  it('saves only the kinds that changed, one call each, and a text equal to the standard as the standard', async () => {
    const user = userEvent.setup();
    renderRules();

    const task = await screen.findByRole('textbox', { name: 'Arbeitsregeln für „Umsetzen“' });
    await user.type(task, '\nTests zuerst.');
    await user.click(screen.getByRole('tab', { name: /Antwort/ }));
    const comment = screen.getByRole('textbox', { name: 'Arbeitsregeln für „Antwort“' });
    await user.type(comment, 'x');
    await user.type(comment, '{Backspace}');
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    await waitFor(() => expect(toastNamed('Arbeitsregeln gespeichert')).toBeTruthy());
    expect(toastNamed('Arbeitsregeln gespeichert')!.description).toBe('Sie gelten für den nächsten Auftrag in jedem Projekt.');
    expect(puts().map((call) => [call.url, call.body])).toEqual([['/api/v1/agent-rules/task', { body: '## Standard task\nTests zuerst.' }]]);

    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();

    // "Zurücksetzen" drops what was typed
    await user.click(screen.getByRole('tab', { name: /Umsetzen/ }));
    await user.type(screen.getByRole('textbox', { name: 'Arbeitsregeln für „Umsetzen“' }), '?');
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Arbeitsregeln für „Umsetzen“' }).value).not.toContain('?');
  });

  it('restores the standard of a kind with undo, the focus on the text, and saves null', async () => {
    const user = userEvent.setup();
    renderRules();

    await user.click(await screen.findByRole('tab', { name: /Review/ }));
    await user.click(screen.getByRole('button', { name: 'Standard wiederherstellen' }));
    const text = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Arbeitsregeln für „Review“' });
    expect(text.value).toBe('## Standard review');
    await waitFor(() => expect(document.activeElement).toBe(text));
    expect(screen.queryByRole('button', { name: 'Standard wiederherstellen' })).toBeNull();
    expect(toastNamed('Standard für „Review“ wiederhergestellt')!.description).toBe('Gilt nach dem Speichern.');

    act(() => runToastAction(toastNamed('Standard für „Review“ wiederhergestellt')!.id));
    expect(text.value).toBe('Review gently.');
    await user.click(screen.getByRole('button', { name: 'Standard wiederherstellen' }));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ body: null });
    await waitFor(() => expect(screen.queryByRole('img', { name: 'eigener Text' })).toBeNull());
  });

  it('opens the tab of a refused kind with the refusal at its text, and tries again after no answer', async () => {
    const user = userEvent.setup();
    let answer: 'field' | 'down' | 'ok' = 'field';
    renderRules({ put: (type) => (type === 'conflict' && answer === 'field' ? problem(422, 'validation_failed', { errors: { body: ['Höchstens 20000 Zeichen.'] } }) : answer === 'down' ? problem(503, 'service_unavailable') : undefined) });

    await user.type(await screen.findByRole('textbox', { name: 'Arbeitsregeln für „Umsetzen“' }), '!');
    await user.click(screen.getByRole('tab', { name: /Konflikt/ }));
    await user.type(screen.getByRole('textbox', { name: 'Arbeitsregeln für „Konflikt lösen“' }), '!');
    await user.click(screen.getByRole('tab', { name: /Umsetzen/ }));
    await user.click(screen.getByRole('button', { name: /Speichern/ }));

    const text = await screen.findByRole('textbox', { name: 'Arbeitsregeln für „Konflikt lösen“' });
    expect(await screen.findByText('Höchstens 20000 Zeichen.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(text));
    // the first kind is saved, the refused one waits
    expect(puts().map((call) => call.url)).toEqual(['/api/v1/agent-rules/task', '/api/v1/agent-rules/conflict']);

    await user.type(text, '?');
    expect(screen.queryByText('Höchstens 20000 Zeichen.')).toBeNull();
    answer = 'down';
    await user.click(screen.getByRole('button', { name: /Speichern/ }));
    await waitFor(() => expect(toastNamed('Arbeitsregeln nicht gespeichert')).toBeTruthy());
    answer = 'ok';
    act(() => runToastAction(toastNamed('Arbeitsregeln nicht gespeichert')!.id));
    await waitFor(() => expect(toastNamed('Arbeitsregeln gespeichert')).toBeTruthy());
  });

  it('lets a member read the rules without saving', async () => {
    renderRules({ user: ida });

    expect(await screen.findByText('Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.')).toBeTruthy();
    const text = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Arbeitsregeln für „Umsetzen“' });
    expect(text.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /Speichern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Standard wiederherstellen' })).toBeNull();
  });

  it('says when the rules could not be loaded', async () => {
    who.user = mara;
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: { data: [], meta: { total: 0 } } }), 'GET /api/v1/agent-rules': () => problem(503, 'service_unavailable') });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OrgSettings section="agents" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Die Arbeitsregeln konnten nicht geladen werden')).toBeTruthy();
  });
});
