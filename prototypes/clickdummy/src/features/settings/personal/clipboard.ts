/*
 * Copying with a way out. `navigator.clipboard.writeText` rejects when the page is not focused or the browser says no,
 * and is missing on pages without a secure context (a dev server on a LAN address). Then the text is selected instead,
 * so ⌘C / Strg+C does the rest, and the caller says so. Secrets (a token, recovery codes) never go into a toast.
 */

export type CopyResult = 'copied' | 'selected';

/** Selects everything in an element, or the value of an input or a textarea. */
function selectAll(target: HTMLElement): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    target.select();
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.addRange(range);
}

/** Writes `text` to the clipboard. When that fails, selects the content of `target` and says `selected`. */
export async function copyOrSelect(text: string, target: HTMLElement | null): Promise<CopyResult> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    if (target) selectAll(target);
    return 'selected';
  }
}
