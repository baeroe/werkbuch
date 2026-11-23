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
    // the equipment of the harness, read only: set up on the machine
    expect(within(studio).getByText('MCP: playwright, context7; 3 Skills; Plugins: superpowers')).toBeTruthy();
    expect(within(mini).getByText('Nichts eingerichtet: nur werkbuch')).toBeTruthy();
    const build = screen.getByRole('article', { name: 'build-01' });
    expect(within(build).getByText(/Agenten hätten hier einen zweiten Zugang/)).toBeTruthy();
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

