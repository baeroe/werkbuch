import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listTokens } from '@/api/tokens';
import { currentToasts, dismissToast, runToastAction } from '@/components/ui/toast';
import { useSession } from '@/store/session';
import { renderPersonal, renderPersonalWithClient, toastTitled, usePersonalTestSetup } from './testing';

usePersonalTestSetup();

type User = ReturnType<typeof userEvent.setup>;

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
  window.getSelection()?.removeAllRanges();
});

/** Installs a clipboard that writes with `writeText`. */
function useClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

/** The way through the setup of the second factor; answers the list of recovery codes. */
async function switchOnTwoFactor(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
  await user.type(await screen.findByRole('textbox', { name: 'Code aus der App' }), '123456');
  await user.click(screen.getByRole('button', { name: 'Bestätigen' }));
  const codes = await screen.findByRole('list', { name: 'Recovery-Codes' });
  // the focus moves to the codes a moment after they appear; jsdom drops a selection when that happens
  await waitFor(() => expect(document.activeElement).toBe(codes));
  return codes;
}

describe('Security: password', () => {
  it('checks the new password before it changes anything, and shows each problem at its field', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    await user.type(await screen.findByLabelText('Neues Passwort'), 'kurz');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'anders');
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText('Gib dein aktuelles Passwort ein.')).toBeTruthy();
    expect(screen.getByText('Mindestens 8 Zeichen.')).toBeTruthy();
    expect(screen.getByText('Die Passwörter stimmen nicht überein.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Aktuelles Passwort')));
    expect(toastTitled('Passwort geändert')).toBeUndefined();
  });

  it('changes the password and empties the fields', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    const current = await screen.findByLabelText<HTMLInputElement>('Aktuelles Passwort');
    await user.type(current, 'altes-passwort');
    await user.type(screen.getByLabelText('Neues Passwort'), 'ein-langes-neues');
    await user.type(screen.getByLabelText('Neues Passwort wiederholen'), 'ein-langes-neues');
    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    await waitFor(() => expect(toastTitled('Passwort geändert')).toBeTruthy());
    expect(current.value).toBe('');
    expect(screen.getByLabelText<HTMLInputElement>('Neues Passwort').value).toBe('');
  });
});

describe('Security: two-factor', () => {
  it('starts off, with a way to set it up', async () => {
    renderPersonal('/me/security');
    expect(await screen.findByRole('heading', { name: 'Zwei-Faktor-Authentifizierung' })).toBeTruthy();
    expect(screen.getByText('Aus')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Einrichten' })).toBeTruthy();
  });

  it('shows a QR dummy and a key to type in, and refuses a code that is not six digits', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));

    expect(screen.getByRole('img', { name: 'QR-Code-Attrappe' })).toBeTruthy();
    expect(screen.getByText(/^([A-Z2-7]{4} ){3}[A-Z2-7]{4}$/)).toBeTruthy();

    const code = screen.getByRole('textbox', { name: 'Code aus der App' });
    await user.type(code, '12345');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));
    expect(await screen.findByText('Der Code besteht aus 6 Ziffern.')).toBeTruthy();
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('list', { name: 'Recovery-Codes' })).toBeNull();
  });

  it('takes any six digits, shows the ten recovery codes once, and keeps them from the next visit', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    const codes = await switchOnTwoFactor(user);

    expect(within(codes).getAllByRole('listitem')).toHaveLength(10);
    expect(toastTitled('Zwei-Faktor-Authentifizierung eingeschaltet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));

    expect(screen.queryByRole('list', { name: 'Recovery-Codes' })).toBeNull();
    expect(screen.getByText('Aktiv seit 28.10.2026.')).toBeTruthy();
    expect(screen.getByText('10 von 10 Recovery-Codes sind noch übrig.')).toBeTruthy();

    // away and back: the codes do not come back
    await user.click(screen.getByRole('link', { name: 'Profil' }));
    await user.click(await screen.findByRole('link', { name: 'Sicherheit' }));
    expect(await screen.findByText('Aktiv seit 28.10.2026.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Recovery-Codes' })).toBeNull();
  });

  it('asks before the page is left while the recovery codes still show', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    const codes = await switchOnTwoFactor(user);
    const first = within(codes).getAllByRole('listitem')[0].textContent!;

    await user.click(screen.getByRole('link', { name: 'Profil' }));
    const question = await screen.findByRole('alertdialog', { name: 'Recovery-Codes gesichert?' });
    await user.click(within(question).getByRole('button', { name: 'Zurück zu den Codes' }));
    expect(screen.getByRole('list', { name: 'Recovery-Codes' })).toBeTruthy();

    // once they are saved, the way is free and the codes are gone
    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));
    await user.click(screen.getByRole('link', { name: 'Profil' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.body.textContent).not.toContain(first);
  });

  it('copies all recovery codes at once', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard(writeText);
    renderPersonal('/me/security');
    const codes = await switchOnTwoFactor(user);

    await user.click(screen.getByRole('button', { name: 'Alle kopieren' }));

    const shown = within(codes).getAllByRole('listitem').map((item) => item.textContent);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shown.join('\n')));
    expect(toastTitled('Kopiert')).toBeTruthy();
    // the codes themselves never go into a toast
    expect(toastText()).not.toContain(shown[0]);
  });

  it('selects the recovery codes for copying by hand when the clipboard refuses', async () => {
    const user = userEvent.setup();
    useClipboard(vi.fn().mockRejectedValue(new DOMException('Document is not focused', 'NotAllowedError')));
    renderPersonal('/me/security');
    const codes = await switchOnTwoFactor(user);

    await user.click(screen.getByRole('button', { name: 'Alle kopieren' }));

    await waitFor(() => expect(toastTitled('Kopieren hat nicht geklappt')).toBeTruthy());
    const first = within(codes).getAllByRole('listitem')[0].textContent!;
    expect(window.getSelection()?.toString()).toContain(first);
    expect(toastTitled('Kopiert')).toBeUndefined();
  });

  it('asks before it issues new recovery codes, because the old ones stop working, and shows them once', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    const before = (await switchOnTwoFactor(user)).textContent;
    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));

    await user.click(screen.getByRole('button', { name: 'Neue Recovery-Codes' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Neue Recovery-Codes erzeugen?' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('list', { name: 'Recovery-Codes' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Neue Recovery-Codes' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Erzeugen' }));
    const after = await screen.findByRole('list', { name: 'Recovery-Codes' });
    expect(after.textContent).not.toBe(before);
    expect(within(after).getAllByRole('listitem')).toHaveLength(10);
  });

  it('moves the focus on with each step: to the code field, to the codes, to the status, and back to the start', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Code aus der App' })));

    await user.type(screen.getByRole('textbox', { name: 'Code aus der App' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));
    const codes = await screen.findByRole('list', { name: 'Recovery-Codes' });
    await waitFor(() => expect(document.activeElement).toBe(codes));

    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Aktiv seit 28.10.2026.'));

    await user.click(screen.getByRole('button', { name: 'Deaktivieren' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ausschalten' }));
    const start = await screen.findByRole('button', { name: 'Einrichten' });
    await waitFor(() => expect(document.activeElement).toBe(start));
  });

  it('asks before it switches two-factor off', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    await switchOnTwoFactor(user);
    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));

    await user.click(screen.getByRole('button', { name: 'Deaktivieren' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Zwei-Faktor ausschalten?' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByText('Aktiv seit 28.10.2026.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Deaktivieren' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ausschalten' }));
    expect(await screen.findByRole('button', { name: 'Einrichten' })).toBeTruthy();
    expect(toastTitled('Zwei-Faktor-Authentifizierung ausgeschaltet')).toBeTruthy();
  });

  it('keeps the second factor of one person away from another', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security', 'u_mara');
    await switchOnTwoFactor(user);
    await user.click(screen.getByRole('button', { name: 'Codes sind gesichert' }));
    expect(screen.getByText('Aktiv seit 28.10.2026.')).toBeTruthy();

    // "Als Theo ansehen": Theo has not set it up
    act(() => useSession.setState({ userId: 'u_theo' }));
    expect(await screen.findByRole('button', { name: 'Einrichten' })).toBeTruthy();
  });
});

/** The text of all toasts that stand, to check that a secret is in none of them. */
function toastText(): string {
  return currentToasts()
    .map((item) => `${item.title} ${item.description ?? ''}`)
    .join(' ');
}

describe('API & MCP: tokens', () => {
  it('lists the tokens with what they may do, when they were used and whether they have expired', async () => {
    renderPersonal('/me/api');
    const list = await screen.findByRole('list', { name: 'Tokens' });
    // the rows only: the abilities in each row are a list of their own
    const rows = Array.from(list.children) as HTMLElement[];

    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual(['Claude Code', 'CI-Skript']);
    expect(within(rows[0]).getAllByText(/^(Lesen|Schreiben|MCP)$/)).toHaveLength(3);
    expect(within(rows[0]).getByText(/zuletzt benutzt am 28\.10\.2026/)).toBeTruthy();
    expect(within(rows[1]).getByText('Lesen')).toBeTruthy();
    // CI-Skript ran out on 30 September
    expect(within(rows[1]).getByText('Abgelaufen')).toBeTruthy();
    expect(within(rows[1]).getByText(/Abgelaufen am 30\.09\.2026/)).toBeTruthy();
  });

  it('explains an empty list and offers the first token', async () => {
    renderPersonal('/me/api', 'u_theo');
    expect(await screen.findByText('Noch keine Tokens')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ersten Token anlegen' })).toBeTruthy();
  });

  it('creates a token, shows its plain text once, and fills the setup snippets with it', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api', 'u_theo');
    await user.click(await screen.findByRole('button', { name: 'Neuer Token' }));
    const form = await screen.findByRole('dialog', { name: 'Neuer Token' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Laptop');
    await user.click(within(form).getByRole('button', { name: 'Token anlegen' }));

    const created = await screen.findByRole('dialog', { name: 'Token angelegt' });
    const secret = within(created).getByRole<HTMLInputElement>('textbox', { name: 'Token' });
    expect(secret.readOnly).toBe(true);
    expect(secret.value).toMatch(/^wb_[a-z0-9]{40}$/);
    // the focus is on the token, and its text is selected: ⌘C is enough
    await waitFor(() => expect(document.activeElement).toBe(secret));
    expect([secret.selectionStart, secret.selectionEnd]).toEqual([0, secret.value.length]);
    // the snippet is ready to run
    expect(within(created).getByText(new RegExp(`--header "Authorization: Bearer ${secret.value}"`))).toBeTruthy();
    expect((await listTokens('u_theo')).items.map((token) => token.name)).toEqual(['Laptop']);

    await user.click(within(created).getByRole('button', { name: 'Ich habe den Token kopiert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the plain text is gone from the page, and the list has the token without it
    expect(document.body.textContent).not.toContain(secret.value);
    expect(within(await screen.findByRole('list', { name: 'Tokens' })).getByText('Laptop')).toBeTruthy();
  });

  it('keeps the new token on Escape until the person says it may go, and keeps it nowhere after', async () => {
    const user = userEvent.setup();
    const client = renderPersonalWithClient('/me/api', 'u_theo');
    await user.click(await screen.findByRole('button', { name: 'Neuer Token' }));
    const form = await screen.findByRole('dialog', { name: 'Neuer Token' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Laptop');
    await user.click(within(form).getByRole('button', { name: 'Token anlegen' }));
    const created = await screen.findByRole('dialog', { name: 'Token angelegt' });
    const secret = within(created).getByRole<HTMLInputElement>('textbox', { name: 'Token' });
    await waitFor(() => expect(document.activeElement).toBe(secret));
    const plain = secret.value;

    await user.keyboard('{Escape}');
    const question = await screen.findByRole('alertdialog', { name: 'Ohne Kopie schließen?' });
    await user.click(within(question).getByRole('button', { name: 'Zurück' }));
    expect(screen.getByRole('dialog', { name: 'Token angelegt' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Ohne Kopie schließen?' })).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.textContent).not.toContain(plain);
    // nothing holds the answer of the call any more
    await waitFor(() => expect(JSON.stringify(client.getMutationCache().getAll().map((mutation) => mutation.state.data))).not.toContain(plain));
  });

  it('gives a token the abilities that were ticked and an expiry date', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api', 'u_theo');
    await user.click(await screen.findByRole('button', { name: 'Neuer Token' }));
    const form = await screen.findByRole('dialog', { name: 'Neuer Token' });

    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Nur lesen');
    await user.click(within(form).getByRole('checkbox', { name: /^Schreiben/ }));
    await user.click(within(form).getByRole('checkbox', { name: /^MCP/ }));
    fireEvent.change(within(form).getByLabelText(/^Ablaufdatum/), { target: { value: '2026-12-31' } });
    await user.click(within(form).getByRole('button', { name: 'Token anlegen' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Token angelegt' })).getByRole('button', { name: 'Ich habe den Token kopiert' }));

    const [token] = (await listTokens('u_theo')).items;
    expect(token.abilities).toEqual(['read']);
    expect(token.expires_at?.slice(0, 10)).toBe('2026-12-31');
    expect(await screen.findByText(/Läuft ab am 31\.12\.2026/)).toBeTruthy();
  });

  it('shows what is wrong at the field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api', 'u_theo');
    await user.click(await screen.findByRole('button', { name: 'Neuer Token' }));
    const form = await screen.findByRole('dialog', { name: 'Neuer Token' });

    await user.click(within(form).getByRole('button', { name: 'Token anlegen' }));
    const name = within(form).getByRole('textbox', { name: 'Name' });
    expect(await within(form).findByText('Der Name darf nicht leer sein.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));

    await user.type(name, 'x');
    for (const ability of [/^Lesen/, /^Schreiben/, /^MCP/]) await user.click(within(form).getByRole('checkbox', { name: ability }));
    await user.click(within(form).getByRole('button', { name: 'Token anlegen' }));
    expect(await within(form).findByText('Wähle mindestens eine Fähigkeit.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Neuer Token' })).toBeTruthy();
    expect((await listTokens('u_theo')).items).toHaveLength(0);
  });

  it('revokes a token when the undo time is over, and hides the row meanwhile', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api');
    await user.click(await screen.findByRole('button', { name: 'CI-Skript widerrufen' }));

    const toast = toastTitled('Token „CI-Skript“ widerrufen');
    expect(toast?.action?.label).toBe('Rückgängig');
    expect(screen.queryByText('CI-Skript')).toBeNull();
    expect((await listTokens('u_mara')).items).toHaveLength(2);

    act(() => dismissToast(toast!.id));
    await waitFor(async () => expect((await listTokens('u_mara')).items.map((token) => token.name)).toEqual(['Claude Code']));
  });

  it('keeps the keyboard in the list when a token goes away', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api');
    const list = await screen.findByRole('list', { name: 'Tokens' });
    await user.click(await screen.findByRole('button', { name: 'CI-Skript widerrufen' }));

    await waitFor(() => expect(list.contains(document.activeElement) && document.activeElement !== list).toBe(true));
  });

  it('keeps the token when the revoking is undone', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api');
    await user.click(await screen.findByRole('button', { name: 'CI-Skript widerrufen' }));

    act(() => runToastAction(toastTitled('Token „CI-Skript“ widerrufen')!.id));
    expect(await screen.findByText('CI-Skript')).toBeTruthy();
    expect((await listTokens('u_mara')).items).toHaveLength(2);
  });
});

describe('API & MCP: setup snippets', () => {
  const snippet = () => document.querySelector('pre')?.textContent;

  it('shows the command with the address of this instance and a placeholder for the token', async () => {
    renderPersonal('/me/api');
    await screen.findByRole('heading', { name: 'Agent verbinden' });

    expect(snippet()).toBe(`claude mcp add --transport http werkbuch ${window.location.origin}/mcp --header "Authorization: Bearer <token>"`);
    expect(screen.getByText(/Ersetze <token> durch/)).toBeTruthy();
  });

  it('switches between Claude Code, Codex and JSON', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/api');
    await screen.findByRole('heading', { name: 'Agent verbinden' });

    await user.click(screen.getByRole('tab', { name: 'Codex' }));
    expect(snippet()).toContain('[mcp_servers.werkbuch]');
    await user.click(screen.getByRole('tab', { name: 'JSON' }));
    expect(JSON.parse(snippet()!).mcpServers.werkbuch.url).toBe(`${window.location.origin}/mcp`);
  });

  it('copies the snippet, and selects it for copying by hand when the clipboard refuses', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard(writeText);
    renderPersonal('/me/api');
    await screen.findByRole('heading', { name: 'Agent verbinden' });

    await user.click(screen.getByRole('button', { name: 'Kopieren' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snippet()));
    expect(toastTitled('Kopiert')).toBeTruthy();

    writeText.mockRejectedValue(new Error('denied'));
    await user.click(await screen.findByRole('button', { name: /Kopier/ }));
    await waitFor(() => expect(toastTitled('Kopieren hat nicht geklappt')).toBeTruthy());
    expect(window.getSelection()?.toString()).toBe(snippet());
  });

  it('names the cause and offers "Erneut versuchen" when the tokens cannot be loaded', async () => {
    const user = userEvent.setup();
    renderPersonal('/me/security');
    await screen.findByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' });
    localStorage.setItem('api:fail', '1');
    await user.click(screen.getByRole('link', { name: 'API & MCP' }));
    expect(await screen.findByText('Die Tokens konnten nicht geladen werden')).toBeTruthy();

    localStorage.removeItem('api:fail');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('list', { name: 'Tokens' })).toBeTruthy();
  });
});
