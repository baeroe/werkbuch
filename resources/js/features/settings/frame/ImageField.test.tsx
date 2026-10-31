import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageField, readSquareImage } from './ImageField';

/** What the fake image reports once its source is set: its size, or that it cannot be read. */
let decoded: { width: number; height: number } | 'unreadable' = { width: 300, height: 200 };
const drawImage = vi.fn();
let context: { drawImage: typeof drawImage } | null = { drawImage };

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_url: string) {
    queueMicrotask(() => {
      if (decoded === 'unreadable') return this.onerror?.();
      this.naturalWidth = decoded.width;
      this.naturalHeight = decoded.height;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  decoded = { width: 300, height: 200 };
  context = { drawImage };
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  drawImage.mockReset();
});

const png = () => new File(['png'], 'logo.png', { type: 'image/png' });

describe('readSquareImage', () => {
  it('cuts the middle square of the picture and scales it to 128 px as a PNG data URL', async () => {
    await expect(readSquareImage(png())).resolves.toBe('data:image/png;base64,AAAA');

    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 50, 0, 200, 200, 0, 0, 128, 128);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:picture');
  });

  it('takes a picture without a size as a square of the target size', async () => {
    decoded = { width: 0, height: 0 };

    await readSquareImage(png(), 64);

    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 64, 64, 0, 0, 64, 64);
  });

  it('refuses a file that is no picture, one the browser cannot read, and a browser without a canvas', async () => {
    await expect(readSquareImage(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow('not an image');

    decoded = 'unreadable';
    await expect(readSquareImage(png())).rejects.toThrow('unreadable image');

    decoded = { width: 10, height: 10 };
    context = null;
    await expect(readSquareImage(png())).rejects.toThrow('no canvas');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe('ImageField', () => {
  const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const choose = (file?: File) => fireEvent.change(fileInput(), { target: { files: file ? [file] : [] } });

  it('shows the preview and the hint, and opens the file picker from its button', async () => {
    const user = userEvent.setup();
    render(<ImageField label="Logo" hint="Am besten quadratisch." preview={<span>Vorschau</span>} hasImage={false} onChange={vi.fn()} />);
    const click = vi.spyOn(fileInput(), 'click');

    expect(screen.getByRole('group', { name: 'Logo' }).textContent).toContain('Vorschau');
    // the name starts with the visible text and says which picture (WCAG 2.5.3)
    const button = screen.getByRole('button', { name: 'Bild wählen … Logo' });
    expect(button.getAttribute('aria-describedby')).toContain('-hint');
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();

    await user.click(button);
    expect(click).toHaveBeenCalled();
  });

  it('hands the chosen picture on as a data URL', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Logo" preview={null} hasImage={false} onChange={onChange} />);

    choose(png());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('data:image/png;base64,AAAA'));
    expect(fileInput().value).toBe('');
  });

  it('says so when the file is no picture or cannot be read, and forgets it with the next good one', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Logo" preview={null} hasImage={false} error="Vom Server" onChange={onChange} />);
    expect(screen.getByText('Vom Server')).toBeTruthy();

    choose(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Das Bild ließ sich nicht lesen. Nimm eine PNG-, JPG- oder WebP-Datei.')).toBeTruthy();
    expect(screen.queryByText('Vom Server')).toBeNull();

    decoded = 'unreadable';
    choose(png());
    await screen.findByText('Das Bild ließ sich nicht lesen. Nimm eine PNG-, JPG- oder WebP-Datei.');

    decoded = { width: 128, height: 128 };
    choose(png());
    await waitFor(() => expect(screen.queryByText(/ließ sich nicht lesen/)).toBeNull());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lets go of the server\'s word on the old picture once a new one is chosen or it is removed, and shows a new word again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ImageField label="Logo" preview={null} hasImage error="Zu groß." onChange={vi.fn()} />);

    choose(png());
    await waitFor(() => expect(screen.queryByText('Zu groß.')).toBeNull());

    rerender(<ImageField label="Logo" preview={null} hasImage error="Kein Bild." onChange={vi.fn()} />);
    expect(screen.getByText('Kein Bild.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Entfernen Logo' }));
    expect(screen.queryByText('Kein Bild.')).toBeNull();
  });

  it('does nothing when the picker closes without a file', () => {
    const onChange = vi.fn();
    render(<ImageField label="Logo" preview={null} hasImage={false} onChange={onChange} />);

    choose();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes the picture away with "Entfernen", and both buttons can be disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ImageField label="Logo" preview={null} hasImage onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Entfernen Logo' }));
    expect(onChange).toHaveBeenCalledWith(null);

    rerender(<ImageField label="Logo" preview={null} hasImage disabled onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Entfernen Logo' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Bild wählen … Logo' }).hasAttribute('disabled')).toBe(true);
  });
});
