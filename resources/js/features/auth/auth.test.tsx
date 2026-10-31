import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from './ForgotPassword';
import Invitation from './Invitation';
import Login from './Login';
import ResetPassword from './ResetPassword';
import TwoFactorChallenge from './TwoFactorChallenge';

type Errors = Record<string, string | undefined>;
type Options = { onError?: (errors: Errors) => void; onSuccess?: () => void };

/** What the server answers to the next post: field errors, or nothing for success. */
let answer: Errors | null = null;
const posts: { url: string; data: Record<string, string> }[] = [];
let pageProps: Record<string, unknown> = {};

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: pageProps, url: '/invitations/inv1?signature=sig' }),
  Link: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  // the form helper of Inertia, reduced to what the screens use; post() answers with `answer`
  useForm: <T extends Record<string, string>>(initial: T) => {
    const [data, setAll] = useState(initial);
    const [errors, setErrors] = useState<Errors>({});
    return {
      data,
      errors,
      processing: false,
      setData: (field: keyof T, value: string) => setAll((current) => ({ ...current, [field]: value })),
      setError: (field: string | Errors, message?: string) =>
        setErrors((current) => ({ ...current, ...(typeof field === 'string' ? { [field]: message } : field) })),
      clearErrors: (...fields: string[]) =>
        setErrors((current) => (fields.length === 0 ? {} : Object.fromEntries(Object.entries(current).filter(([key]) => !fields.includes(key))))),
      post: (url: string, options: Options = {}) => {
        posts.push({ url, data });
        if (answer) {
          setErrors(answer);
          options.onError?.(answer);
        } else {
          options.onSuccess?.();
        }
      },
    };
  },
}));

/** The text a control is described by (its hint or error), as a screen reader reads it. */
function description(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

function shared(overrides: Record<string, unknown> = {}) {
  pageProps = { features: { mail: true, live: null }, flash: { status: null, error: null }, ...overrides };
}

beforeEach(() => {
  answer = null;
  posts.length = 0;
  shared();
});

describe('Login', () => {
  it('refuses empty fields with the texts of the clickdummy and focuses the first one', async () => {
    const user = userEvent.setup();
    render(<Login />);

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(document.activeElement).toBe(screen.getByLabelText('E-Mail'));
    expect(screen.getByText('Gib die E-Mail-Adresse deines Kontos ein.')).toBeTruthy();
    expect(screen.getByText('Gib dein Passwort ein.')).toBeTruthy();
    expect(posts).toEqual([]);

    await user.type(screen.getByLabelText('E-Mail'), 'mara@example.com');
    expect(screen.queryByText('Gib die E-Mail-Adresse deines Kontos ein.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Passwort'));
    expect(posts).toEqual([]);
  });

  it('sends the form and shows the answer of the server at the field, with the focus on it', async () => {
    const user = userEvent.setup();
    answer = { email: 'E-Mail oder Passwort stimmen nicht.' };
    render(<Login />);

    await user.type(screen.getByLabelText('E-Mail'), 'mara@example.com');
    await user.type(screen.getByLabelText('Passwort'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(posts).toEqual([{ url: '/login', data: { email: 'mara@example.com', password: 'nope' } }]);
    expect(description(screen.getByLabelText('E-Mail'))).toBe('E-Mail oder Passwort stimmen nicht.');
    expect(document.activeElement).toBe(screen.getByLabelText('E-Mail'));

    answer = { password: 'Das Passwort stimmt nicht.' };
    await user.type(screen.getByLabelText('Passwort'), 'x');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Passwort'));
  });

  it('shows the flashed status and error above the form, names the tab and links to the forgotten password', () => {
    shared({ flash: { status: 'Dein Passwort ist gesetzt.', error: 'Die Seite ist abgelaufen.' } });
    render(<Login />);

    expect(screen.getByRole('status').textContent).toContain('Dein Passwort ist gesetzt.');
    expect(screen.getByRole('alert').textContent).toContain('Die Seite ist abgelaufen.');
    expect(screen.getByRole('heading', { name: 'Willkommen zurück' })).toBeTruthy();
    expect(document.title).toBe('Willkommen zurück – werkbuch');
    expect(screen.getByRole('link', { name: 'Passwort vergessen?' }).getAttribute('href')).toBe('/forgot-password');
  });

  it('keeps the message regions in the page while they are empty', () => {
    render(<Login />);

    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('');
  });
});

describe('ForgotPassword', () => {
  it('refuses an empty address and focuses it', async () => {
    const user = userEvent.setup();
    render(<ForgotPassword />);

    await user.type(screen.getByLabelText('E-Mail'), '   ');
    await user.click(screen.getByRole('button', { name: 'Link senden' }));

    expect(document.activeElement).toBe(screen.getByLabelText('E-Mail'));
    expect(description(screen.getByLabelText('E-Mail'))).toBe('Gib die E-Mail-Adresse deines Kontos ein.');
    expect(posts).toEqual([]);
  });

  it('replaces the form with the confirmation, whatever the server knows, and focuses it', async () => {
    const user = userEvent.setup();
    // the server flashes its own answer as well; the confirmation stands for it
    shared({ flash: { status: 'Gehört die Adresse zu einem Konto, ist ein Link unterwegs.', error: null } });
    render(<ForgotPassword />);

    await user.type(screen.getByLabelText('E-Mail'), 'lene@example.com');
    await user.click(screen.getByRole('button', { name: 'Link senden' }));

    expect(posts).toEqual([{ url: '/forgot-password', data: { email: 'lene@example.com' } }]);
    const confirmation = screen.getByText(/ist der Link jetzt unterwegs/);
    expect(confirmation.textContent).toContain('Wenn es ein Konto für lene@example.com gibt, ist der Link jetzt unterwegs. Schau auch im Spam-Ordner nach.');
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('link', { name: 'Zur Anmeldung' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('link', { name: 'Zurück zur Anmeldung' })).toBeNull();
  });

  it('shows a refusal of the server at the field', async () => {
    const user = userEvent.setup();
    answer = { email: 'E-Mail muss eine gültige E-Mail-Adresse sein.' };
    render(<ForgotPassword />);

    await user.type(screen.getByLabelText('E-Mail'), 'lene');
    await user.click(screen.getByRole('button', { name: 'Link senden' }));

    expect(description(screen.getByLabelText('E-Mail'))).toBe('E-Mail muss eine gültige E-Mail-Adresse sein.');
    expect(document.activeElement).toBe(screen.getByLabelText('E-Mail'));
    expect(screen.getByRole('link', { name: 'Zurück zur Anmeldung' }).getAttribute('href')).toBe('/login');
  });

  it('names the admin command instead of the form when the instance sends no mail', () => {
    shared({ features: { mail: false, live: null } });
    render(<ForgotPassword />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Diese Instanz verschickt keine Mails/).textContent).toContain(
      'Diese Instanz verschickt keine Mails. Ein Admin setzt dein Passwort mit php artisan app:reset-password zurück.',
    );
    expect(screen.getByText('php artisan app:reset-password').tagName).toBe('CODE');
  });
});

describe('ResetPassword', () => {
  beforeEach(() => shared({ token: 'tok123', email: 'lene@example.com' }));

  it('shows the address of the link read-only', () => {
    render(<ResetPassword />);

    expect((screen.getByLabelText('E-Mail') as HTMLInputElement).value).toBe('lene@example.com');
    expect(screen.getByLabelText('E-Mail').hasAttribute('readonly')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Neues Passwort' })).toBeTruthy();
  });

  it('refuses empty fields and focuses the first one', async () => {
    const user = userEvent.setup();
    render(<ResetPassword />);

    await user.click(screen.getByRole('button', { name: 'Passwort setzen' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Neues Passwort', { selector: 'input' }));
    expect(description(screen.getByLabelText('Neues Passwort', { selector: 'input' }))).toBe('Lege ein neues Passwort fest.');
    expect(description(screen.getByLabelText('Wiederholen'))).toBe('Wiederhole das neue Passwort.');

    await user.type(screen.getByLabelText('Neues Passwort', { selector: 'input' }), 'new-password');
    await user.click(screen.getByRole('button', { name: 'Passwort setzen' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Wiederholen'));
    expect(posts).toEqual([]);
  });

  it('sends token, address and both passwords, and shows the rules of the server at the field', async () => {
    const user = userEvent.setup();
    answer = { password: 'Passwort muss mindestens 8 Zeichen lang sein.' };
    render(<ResetPassword />);

    await user.type(screen.getByLabelText('Neues Passwort', { selector: 'input' }), 'short');
    await user.type(screen.getByLabelText('Wiederholen'), 'short');
    await user.click(screen.getByRole('button', { name: 'Passwort setzen' }));

    expect(posts).toEqual([{ url: '/reset-password', data: { token: 'tok123', email: 'lene@example.com', password: 'short', password_confirmation: 'short' } }]);
    expect(document.activeElement).toBe(screen.getByLabelText('Neues Passwort', { selector: 'input' }));
    expect(description(screen.getByLabelText('Neues Passwort', { selector: 'input' }))).toBe('Passwort muss mindestens 8 Zeichen lang sein.');

    await user.type(screen.getByLabelText('Wiederholen'), 'x');
    expect(description(screen.getByLabelText('Neues Passwort', { selector: 'input' }))).toBe('Passwort muss mindestens 8 Zeichen lang sein.');
    await user.type(screen.getByLabelText('Neues Passwort', { selector: 'input' }), 'x');
    expect(description(screen.getByLabelText('Neues Passwort', { selector: 'input' }))).toBe('');
  });

  it('offers a new link when the server refuses the link', async () => {
    const user = userEvent.setup();
    answer = { email: 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an.' };
    render(<ResetPassword />);

    await user.type(screen.getByLabelText('Neues Passwort', { selector: 'input' }), 'new-password');
    await user.type(screen.getByLabelText('Wiederholen'), 'new-password');
    await user.click(screen.getByRole('button', { name: 'Passwort setzen' }));

    expect(document.activeElement).toBe(screen.getByLabelText('E-Mail'));
    expect(description(screen.getByLabelText('E-Mail'))).toMatch(/Dieser Link ist abgelaufen/);
    expect(screen.getByRole('link', { name: 'Neuen Link anfordern' }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.getByRole('link', { name: 'Zurück zur Anmeldung' }).getAttribute('href')).toBe('/login');
  });
});

describe('Invitation', () => {
  beforeEach(() => shared({ state: 'open', email: 'lea@example.com', organization: { name: 'Feldwerk' } }));

  it('names the organization and keeps the address as the user name for password managers', () => {
    render(<Invitation />);

    expect(screen.getByRole('heading', { name: 'Einladung annehmen' })).toBeTruthy();
    expect(screen.getByText(/Du wurdest zu Feldwerk eingeladen/)).toBeTruthy();
    const username = document.querySelector<HTMLInputElement>('input[autocomplete="username"]')!;
    expect(username.value).toBe('lea@example.com');
    expect(username.tabIndex).toBe(-1);
  });

  it('refuses empty fields and focuses the first one', async () => {
    const user = userEvent.setup();
    render(<Invitation />);

    await user.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    expect(description(screen.getByLabelText('Name'))).toContain('Gib deinen Namen ein, so wie ihn dein Team sehen soll.');
    expect(description(screen.getByLabelText('Passwort'))).toContain('Lege ein Passwort fest.');

    await user.type(screen.getByLabelText('Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Lea Sommer');
    await user.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Passwort'));
    expect(posts).toEqual([]);
  });

  it('posts to the address of the signed link and shows the refusals of the server at the fields', async () => {
    const user = userEvent.setup();
    answer = { password: 'Passwort muss mindestens 8 Zeichen lang sein.' };
    render(<Invitation />);

    await user.type(screen.getByLabelText('Name'), 'Lea Sommer');
    await user.type(screen.getByLabelText('Passwort'), 'short');
    await user.click(screen.getByRole('button', { name: 'Einladung annehmen' }));

    expect(posts).toEqual([{ url: '/invitations/inv1?signature=sig', data: { name: 'Lea Sommer', password: 'short' } }]);
    expect(document.activeElement).toBe(screen.getByLabelText('Passwort'));
    expect(description(screen.getByLabelText('Passwort'))).toContain('Passwort muss mindestens 8 Zeichen lang sein.');

    await user.type(screen.getByLabelText('Passwort'), 'x');
    expect(description(screen.getByLabelText('Passwort'))).not.toContain('mindestens 8 Zeichen lang');
    // the server may refuse the name as well (too long)
    answer = { name: 'Der Name darf höchstens 120 Zeichen haben.' };
    await user.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'x');
    expect(description(screen.getByLabelText('Name'))).not.toContain('höchstens 120');
  });

  it('shows what the server says about the link itself above the form, e.g. the limit', async () => {
    const user = userEvent.setup();
    answer = { invitation: 'Zu viele Versuche. Versuch es in 60 Sekunden wieder.' };
    render(<Invitation />);

    await user.type(screen.getByLabelText('Name'), 'Lea Sommer');
    await user.type(screen.getByLabelText('Passwort'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'Einladung annehmen' }));

    expect(screen.getByText('Zu viele Versuche. Versuch es in 60 Sekunden wieder.')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it.each([
    ['expired', 'Diese Einladung ist abgelaufen.'],
    ['closed', 'Dieser Einladungslink gilt nicht mehr.'],
  ])('shows a notice and the way to the sign-in instead of the form for a %s link', (state, notice) => {
    shared({ state, email: null, organization: { name: 'Feldwerk' } });
    render(<Invitation />);

    expect(screen.getByText(new RegExp(notice))).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zur Anmeldung' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/Du wurdest zu Feldwerk eingeladen/)).toBeNull();
  });
});

describe('TwoFactorChallenge', () => {
  it('has the code field focused on arrival and refuses it empty', async () => {
    const user = userEvent.setup();
    render(<TwoFactorChallenge />);

    const code = screen.getByLabelText('Code aus der App');
    expect(document.activeElement).toBe(code);
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(document.title).toBe('Anmeldung bestätigen – werkbuch');

    await user.type(code, '   ');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(description(code)).toContain('Gib den Code aus der App ein.');
    expect(posts).toEqual([]);

    await user.type(code, '1');
    expect(description(code)).not.toContain('Gib den Code aus der App ein.');
  });

  it('sends the code and shows a wrong one at the field, with the focus on it', async () => {
    const user = userEvent.setup();
    answer = { code: 'Der Code stimmt nicht. Nimm den aktuellen aus der App.' };
    render(<TwoFactorChallenge />);

    await user.type(screen.getByLabelText('Code aus der App'), '123456');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(posts).toEqual([{ url: '/two-factor-challenge', data: { code: '123456', recovery_code: '' } }]);
    expect(description(screen.getByLabelText('Code aus der App'))).toContain('Der Code stimmt nicht.');
    expect(document.activeElement).toBe(screen.getByLabelText('Code aus der App'));
  });

  it('switches to a recovery code and back, moving the focus and sending only the field in use', async () => {
    const user = userEvent.setup();
    render(<TwoFactorChallenge />);
    await user.type(screen.getByLabelText('Code aus der App'), '12');

    await user.click(screen.getByRole('button', { name: 'Recovery-Code verwenden' }));
    const recovery = screen.getByLabelText('Recovery-Code');
    expect(document.activeElement).toBe(recovery);
    expect(screen.queryByLabelText('Code aus der App')).toBeNull();
    expect(screen.getByText(/Kein Zugriff auf die App/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(description(recovery)).toContain('Gib einen deiner Recovery-Codes ein.');
    expect(document.activeElement).toBe(recovery);

    answer = { recovery_code: 'Diesen Recovery-Code gibt es nicht, oder er ist schon verbraucht.' };
    await user.type(recovery, 'abcde-fghij');
    expect(description(recovery)).not.toContain('Gib einen deiner Recovery-Codes ein.');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(posts).toEqual([{ url: '/two-factor-challenge', data: { code: '', recovery_code: 'abcde-fghij' } }]);
    expect(description(recovery)).toContain('schon verbraucht');

    await user.click(screen.getByRole('button', { name: 'Code aus der App verwenden' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Code aus der App'));
    expect((screen.getByLabelText('Code aus der App') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('link', { name: 'Zurück zur Anmeldung' }).getAttribute('href')).toBe('/login');
  });
});
