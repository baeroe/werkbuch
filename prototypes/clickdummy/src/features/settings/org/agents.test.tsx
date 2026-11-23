/*
 * The organization's screens of WEBU-18: runners (slots in werkbuch, load, cancel, the focus after a revoke), GitHub
 * (the focus through the two steps and after a disconnect) and the model field of a label with its name suggestion.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/api/db';
import { resetToasts } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import Github from './Github';
import Labels from './Labels';
import McpServers from './McpServers';
import Runners from './Runners';

beforeEach(resetApi);
afterEach(() => act(() => resetToasts()));

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Runners', () => {
  it('shows the three pots and the load, a GPU the system does not give as „nicht verfügbar“, without projects', async () => {
    renderWithData(<Runners readOnlyReason={null} />);
    const studio = await screen.findByRole('article', { name: 'mac-studio' });
    expect(within(studio).getByText('Auslastung')).toBeTruthy();
    expect(within(studio).getByText('31 %')).toBeTruthy();
    expect(within(studio).getByText('38,2 von 64 GB belegt')).toBeTruthy();
    expect(within(studio).queryByText('Projekte')).toBeNull();
    const mini = screen.getByRole('article', { name: 'mac-mini-alt' });
    expect(within(mini).getByText('nicht verfügbar')).toBeTruthy();
    expect(within(mini).getByText(/Letzter Stand vom/)).toBeTruthy();
  });

  it('sets the slots in a dialog and refuses more per repo than in all', async () => {
    const user = userEvent.setup();
    renderWithData(<Runners readOnlyReason={null} />);
    const studio = await screen.findByRole('article', { name: 'mac-studio' });
    await user.click(within(studio).getByRole('button', { name: 'Plätze mac-studio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plätze von „mac-studio“' });
    const perRepo = within(dialog).getByRole('textbox', { name: 'Je Repo' });
    await user.clear(perRepo);
    await user.type(perRepo, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Höchstens so viele wie gesamt.')).toBeTruthy();
    await user.clear(perRepo);
    await user.type(perRepo, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(getDb().runners.find((runner) => runner.id === 'rn_studio')?.slots).toEqual({ total: 2, per_repo: 2, light: 2 }));
  });

  it('cancels a run from the card after a question', async () => {
    const user = userEvent.setup();
    renderWithData(<Runners readOnlyReason={null} />);
    const studio = await screen.findByRole('article', { name: 'mac-studio' });
    await user.click(within(studio).getByRole('button', { name: 'Abbrechen Umsetzen an WEB-51' }));
    const question = await screen.findByRole('alertdialog', { name: 'Auftrag „Umsetzen“ an WEB-51 abbrechen?' });
    await user.click(within(question).getByRole('button', { name: 'Auftrag abbrechen' }));
    await waitFor(() => expect(getDb().agent_runs.find((run) => run.id === 'run_web51_task')?.status).toBe('canceling'));
  });

  it('puts the focus on the next runner after a revoke, not on the button of the card that went', async () => {
    const user = userEvent.setup();
    renderWithData(<Runners readOnlyReason={null} />);
    const build = await screen.findByRole('article', { name: 'build-01' });
    await user.click(within(build).getByRole('button', { name: 'Widerrufen build-01' }));
    const question = await screen.findByRole('alertdialog', { name: '„build-01“ widerrufen?' });
    await user.click(within(question).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'build-01' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('article', { name: 'mac-studio' })).getByRole('button', { name: 'Plätze mac-studio' })));
  });
});

describe('GitHub', () => {
  it('moves the focus to step 2 after step 1, and to the title after a disconnect', async () => {
    const user = userEvent.setup();
    getDb().github = { agent_app: null, review_app: null, repos: [] };
    renderWithData(<Github readOnlyReason={null} />);
    await user.click((await screen.findAllByRole('button', { name: 'Bei GitHub anlegen' }))[0]);
    await waitFor(() => expect(document.activeElement?.closest('[data-github-step="2"]')).not.toBeNull());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'GitHub' })));

    await user.click(await screen.findByRole('button', { name: 'GitHub trennen' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'GitHub trennen?' })).getByRole('button', { name: 'Trennen' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'GitHub' })));
  });

  it('pauses open strands and cancels their runs on a disconnect', async () => {
    const user = userEvent.setup();
    renderWithData(<Github readOnlyReason={null} />);
    await user.click(await screen.findByRole('button', { name: 'GitHub trennen' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'GitHub trennen?' })).getByRole('button', { name: 'Trennen' }));
    await waitFor(() => expect(getDb().agent_threads.find((thread) => thread.id === 'th_web51')).toMatchObject({ status: 'paused', pause_reason: 'github' }));
    expect(getDb().agent_runs.find((run) => run.id === 'run_web51_task')?.status).toBe('canceling');
  });
});

describe('Labels', () => {
  it('suggests „Haiku Agent“ for a model and keeps a name somebody typed', async () => {
    const user = userEvent.setup();
    renderWithData(<Labels readOnlyReason={null} />);
    await user.click((await screen.findAllByRole('button', { name: 'Label anlegen' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Label anlegen' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.click(within(dialog).getByRole('button', { name: 'haiku' }));
    expect(name).toHaveProperty('value', 'Haiku Agent');
    await user.click(within(dialog).getByRole('button', { name: 'opus' }));
    expect(name).toHaveProperty('value', 'Opus Agent');
    await user.clear(name);
    await user.type(name, 'Schnell');
    await user.click(within(dialog).getByRole('button', { name: 'haiku' }));
    expect(name).toHaveProperty('value', 'Schnell');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(getDb().labels.find((label) => label.name === 'Schnell')?.agent_model).toBe('haiku'));
  });

  it('marks the model labels in the list', async () => {
    renderWithData(<Labels readOnlyReason={null} />);
    expect(await screen.findByText('Haiku Agent')).toBeTruthy();
    expect(screen.getAllByText('Modell für Agenten:')).toHaveLength(3);
  });
});

describe('MCP-Server', () => {
  it('shows a set value as „gesetzt“ with „Ersetzen“, never the value itself', async () => {
    const user = userEvent.setup();
    renderWithData(<McpServers readOnlyReason={null} />);
    const list = await screen.findByRole('list', { name: 'MCP-Server' });
    expect(within(list).getAllByText(/mac-mini-alt: Befehl nicht gefunden/, { selector: 'span' })).toHaveLength(3);
    await user.click(within(list).getByRole('button', { name: '„context7“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: '„context7“ bearbeiten' });
    expect(within(dialog).getByText('gesetzt')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('ctx7sk-demo');
    await user.click(within(dialog).getByRole('button', { name: 'Ersetzen CONTEXT7_API_KEY' }));
    const value = await within(dialog).findByLabelText('Wert von CONTEXT7_API_KEY');
    await waitFor(() => expect(document.activeElement).toBe(value));
    expect(value).toHaveProperty('value', '');
    await user.type(value, 'neu-und-geheim');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(getDb().mcp_servers.find((server) => server.name === 'context7')?.env[0].value).toBe('neu-und-geheim'));
  });

  it('names the projects that use a server before it is deleted', async () => {
    const user = userEvent.setup();
    renderWithData(<McpServers readOnlyReason={null} />);
    await user.click(await screen.findByRole('button', { name: '„playwright“ löschen' }));
    const question = await screen.findByRole('alertdialog', { name: '„playwright“ löschen?' });
    expect(within(question).getByText(/WEB nutzt ihn; die Agenten dort bekommen ihn danach nicht mehr/)).toBeTruthy();
    await user.click(within(question).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(getDb().mcp_servers.some((server) => server.name === 'playwright')).toBe(false));
    // the focus goes to the next row, not to the page
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '„sequential-thinking“ bearbeiten' })));
  });
});
