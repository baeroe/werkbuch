import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../lang/en.json';
import { initI18n } from '@/lib/i18n';
import { CopyField } from './CopyField';

const LINK = 'https://werkbuch.example.com/invite/abc123';

function withClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.useRealTimers();
});

describe('CopyField', () => {
  it('shows the value in a read-only field with its label and a copy button', () => {
    render(<CopyField label="Einladungslink" value={LINK} name="invitation_link" className="mt-2" />);

    const field = screen.getByLabelText('Einladungslink') as HTMLInputElement;
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    expect(field.name).toBe('invitation_link');
    expect(field.autocomplete).toBe('off');
    expect(screen.getByRole('button', { name: 'Kopieren' })).toBeTruthy();
  });

  it('calls a field without a name "copy", and shows a hint while nothing was copied', () => {
    render(<CopyField label="Token" value="wb_1" hint="Nur einmal sichtbar." />);

    expect((screen.getByLabelText('Token') as HTMLInputElement).name).toBe('copy');
    expect(screen.getByRole('status').textContent).toBe('Nur einmal sichtbar.');
  });

  it('names the button as the caller wants, and in the language of the page by default', () => {
    const { unmount } = render(<CopyField label="Link" value={LINK} buttonLabel="Link kopieren" />);
    expect(screen.getByRole('button', { name: 'Link kopieren' })).toBeTruthy();
    unmount();

    initI18n({ locale: 'en', translations: en });
    render(<CopyField label="Link" value={LINK} />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('copies through the clipboard API and says so, then goes back to the hint', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CopyField label="Link" value={LINK} hint="Gilt sieben Tage." />);

    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }));

    await screen.findByRole('button', { name: 'Kopiert' });
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('status').textContent).toBe('In die Zwischenablage kopiert.');

    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(screen.getByRole('button', { name: 'Kopieren' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Gilt sieben Tage.');
  });

  it('starts the reset again when copied a second time, and stops it when it goes away', async () => {
    withClipboard(async () => {});
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(<CopyField label="Link" value={LINK} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }));
    await screen.findByRole('button', { name: 'Kopiert' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    fireEvent.click(screen.getByRole('button', { name: 'Kopiert' }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    // the first timer would have run out by now
    expect(screen.getByRole('button', { name: 'Kopiert' })).toBeTruthy();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('selects the text and says to copy it by hand when there is no clipboard API', async () => {
    render(<CopyField label="Link" value={LINK} />);
    const field = screen.getByLabelText('Link') as HTMLInputElement;

    await userEvent.click(screen.getByRole('button', { name: 'Kopieren' }));

    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Das Kopieren hat nicht geklappt, der Text ist aber markiert. Drücke');
    expect(status.textContent).toContain('zum Kopieren.');
    expect(status.querySelector('kbd[aria-label="Steuerung C"]')).not.toBeNull();
    expect(status.className).toContain('font-medium');
    expect(screen.getByRole('button', { name: 'Kopieren' })).toBeTruthy();
  });

  it('does the same when the clipboard refuses', async () => {
    withClipboard(async () => {
      throw new DOMException('no permission', 'NotAllowedError');
    });
    render(<CopyField label="Link" value={LINK} />);

    await userEvent.click(screen.getByRole('button', { name: 'Kopieren' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Das Kopieren hat nicht geklappt'));
    expect(document.activeElement).toBe(screen.getByLabelText('Link'));
  });

  it('puts the shortcut where the sentence of the language wants it', async () => {
    initI18n({ locale: 'en', translations: en });
    render(<CopyField label="Link" value={LINK} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Copying did not work, but the text is selected. Press');
    expect(status.querySelector('kbd[aria-label="Control C"]')).not.toBeNull();
    expect(status.textContent?.endsWith(' to copy it.')).toBe(true);
  });

  it('selects all of the text when the field gets the focus, and shows its start', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    render(<CopyField label="Link" value={LINK} />);
    const field = screen.getByLabelText('Link') as HTMLInputElement;
    field.scrollLeft = 40;

    fireEvent.focus(field);

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
    expect(field.scrollLeft).toBe(0);
    vi.restoreAllMocks();
  });
});
