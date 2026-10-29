import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTokens } from '@/api/tokens';
import { listUsers } from '@/api/users';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import Bots from './Bots';

beforeEach(() => {
  resetApi();
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => resetToasts());
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>), client };
}

/** The card of a bot, by its name. */
const cardOf = (name: string) => screen.findByRole('article', { name });

/** Opens the token dialog of a bot, names the token, and sends it. Answers the dialog that shows the plain text. */
async function createToken(user: ReturnType<typeof userEvent.setup>, bot: string, name: string) {
  const card = await cardOf(bot);
  await user.click(within(card).getByRole('button', { name: 'Token anlegen' }));
  const dialog = await screen.findByRole('dialog', { name: `Token für ${bot} anlegen` });
  await user.type(within(dialog).getByRole('textbox', { name: 'Name des Tokens' }), name);
  await user.click(within(dialog).getByRole('button', { name: /^Token anlegen/ }));
  return screen.findByRole('dialog', { name: 'Token ist angelegt' });
}

describe('Bots', () => {
  it('shows the plain text of a new token once and nowhere after the dialog is closed', async () => {
    const user = userEvent.setup();
    renderWithData(<Bots readOnlyReason={null} />);

    const result = await createToken(user, 'Kira', 'Deploy');
    const field = within(result).getByRole<HTMLInputElement>('textbox', { name: 'Token' });
    const plain = field.value;
    expect(plain).toMatch(/^wb_[a-z0-9]{40}$/);
    expect(within(result).getByText('Kopiere den Token jetzt')).toBeTruthy();

    await user.click(within(result).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // the list knows the token by its name; the text is gone from the page and the server never gives it again
    const kira = await cardOf('Kira');
    expect(await within(kira).findByText('Deploy')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(plain);
    expect(JSON.stringify((await listTokens('u_kira')).items)).not.toContain(plain);
  });

  it('keeps the new token on a click outside and on Escape until asked, and holds it nowhere after', async () => {
    const user = userEvent.setup();
    const { client } = renderWithData(<Bots readOnlyReason={null} />);
    const dialog = await createToken(user, 'Kira', 'Deploy-Skript');
    const plain = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Token' }).value;

    await user.click(dialog.parentElement!);
    expect(screen.getByRole('dialog', { name: 'Token ist angelegt' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: 'Ohne Kopie schließen?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zurück' }));

    await user.click(within(dialog).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.innerHTML).not.toContain(plain);
    await waitFor(() => expect(JSON.stringify(client.getMutationCache().getAll().map((mutation) => mutation.state.data))).not.toContain(plain));
  });

  it('warns that tokens of the default bot have admin rights, on the card, in the dialog and after creating one', async () => {
    const user = userEvent.setup();
    renderWithData(<Bots readOnlyReason={null} />);

    const automation = await cardOf('Automation');
    expect(within(automation).getByText(/Tokens des Standard-Bots haben Admin-Rechte/)).toBeTruthy();
    // Kira is no admin: nothing to warn about
    expect(within(await cardOf('Kira')).queryByText(/Admin-Rechte/)).toBeNull();

    await user.click(within(automation).getByRole('button', { name: 'Token anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Token für Automation anlegen' });
    expect(within(form).getByText(/Admin-Rechte/)).toBeTruthy();
    await user.type(within(form).getByRole('textbox', { name: 'Name des Tokens' }), 'Skript');
    await user.click(within(form).getByRole('button', { name: /^Token anlegen/ }));

    const result = await screen.findByRole('dialog', { name: 'Token ist angelegt' });
    expect(within(result).getByText(/Dieser Token hat Admin-Rechte/)).toBeTruthy();
  });

  it('marks the default bot and offers no way to deactivate or delete it', async () => {
    renderWithData(<Bots readOnlyReason={null} />);

    const automation = await cardOf('Automation');
    expect(within(automation).getByText('Standard-Bot')).toBeTruthy();
    expect(within(automation).getByText(/weder deaktivieren noch löschen/)).toBeTruthy();
    expect(within(automation).queryByRole('button', { name: /Deaktivieren/ })).toBeNull();
    expect(within(automation).queryByRole('button', { name: /Löschen/ })).toBeNull();
    // a bot of one's own can be deactivated
    expect(within(await cardOf('Kira')).getByRole('button', { name: /Deaktivieren/ })).toBeTruthy();
  });

  it('suggests the handle from the name and refuses one that is taken, next to its field', async () => {
    const user = userEvent.setup();
    renderWithData(<Bots readOnlyReason={null} />);

    await user.click(await screen.findByRole('button', { name: 'Bot anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bot anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Rita Prüfer');
    const handle = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Kürzel' });
    expect(handle.value).toBe('rita-pruefer');

    // a handle typed by hand stays, and a taken one is refused
    await user.clear(handle);
    await user.type(handle, 'kira');
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));
    expect(await within(dialog).findByText('Dieses Kürzel ist schon vergeben.')).toBeTruthy();

    await user.clear(handle);
    await user.type(handle, 'rita');
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));
    expect(await cardOf('Rita Prüfer')).toBeTruthy();
    expect((await listUsers()).items.find((entry) => entry.handle === 'rita')?.type).toBe('bot');
  });

  it('takes a revoked token off the list at once and gives it back with "Rückgängig"', async () => {
    const user = userEvent.setup();
    renderWithData(<Bots readOnlyReason={null} />);

    const kira = await cardOf('Kira');
    const revoke = () => within(kira).queryByRole('button', { name: 'Token „Agent“ widerrufen' });
    await user.click(await within(kira).findByRole('button', { name: 'Token „Agent“ widerrufen' }));
    expect(revoke()).toBeNull();
    const toast = currentToasts().find((item) => item.action?.label === 'Rückgängig')!;
    expect(toast.title).toBe('Token „Agent“ von Kira widerrufen');

    // taken back: the token is there and was never touched
    act(() => runToastAction(toast.id));
    expect(await within(kira).findByRole('button', { name: 'Token „Agent“ widerrufen' })).toBeTruthy();
    expect((await listTokens('u_kira')).items).toHaveLength(1);

    // left alone, the toast runs out and the token is revoked for real
    await user.click(await within(kira).findByRole('button', { name: 'Token „Agent“ widerrufen' }));
    act(() => dismissToast(currentToasts().find((item) => item.action?.label === 'Rückgängig')!.id));
    await waitFor(async () => expect((await listTokens('u_kira')).items).toHaveLength(0));
  });
});
