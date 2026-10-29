import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyOrSelect } from './clipboard';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** Installs a clipboard that writes with `writeText`; `null` is a browser without one. */
function useClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

function block(text: string): HTMLPreElement {
  const element = document.createElement('pre');
  element.textContent = text;
  document.body.append(element);
  return element;
}

describe('copyOrSelect', () => {
  it('writes the text to the clipboard and leaves the selection alone', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard(writeText);
    const target = block('wb_secret');

    expect(await copyOrSelect('wb_secret', target)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('wb_secret');
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('selects the text of the block when the browser refuses to write', async () => {
    useClipboard(vi.fn().mockRejectedValue(new DOMException('Document is not focused', 'NotAllowedError')));
    const target = block('claude mcp add …');

    expect(await copyOrSelect('claude mcp add …', target)).toBe('selected');
    expect(window.getSelection()?.toString()).toBe('claude mcp add …');
  });

  it('selects the value of an input when the browser refuses to write', async () => {
    useClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const input = document.createElement('input');
    input.value = 'wb_secret';
    document.body.append(input);

    expect(await copyOrSelect('wb_secret', input)).toBe('selected');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'wb_secret'.length]);
  });

  it('selects the text when there is no clipboard at all, as on a page without a secure context', async () => {
    useClipboard(null);
    const target = block('abc-def');

    expect(await copyOrSelect('abc-def', target)).toBe('selected');
    expect(window.getSelection()?.toString()).toBe('abc-def');
  });
});
