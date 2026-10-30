import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from './ForgotPassword';
import Login from './Login';
import ResetPassword from './ResetPassword';

type Errors = Record<string, string | undefined>;
type Options = { onError?: (errors: Errors) => void; onSuccess?: () => void };

/** What the server answers to the next post: field errors, or nothing for success. */
let answer: Errors | null = null;
const posts: { url: string; data: Record<string, string> }[] = [];
let pageProps: Record<string, unknown> = {};

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: pageProps }),
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
