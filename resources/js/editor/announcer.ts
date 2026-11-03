/*
 * What an editor says to a screen reader (F21): every editor keeps one live region for its whole life, empty at first
 * (RichTextEditor, `data-editor-announcer`; a region mounted with its text is often not read). The uploads write their
 * start, end and failure into it, the `/`, `@` and `#` lists how many entries they offer, which one is active and what
 * they say without entries.
 */

/** Says `text` in the live region of the editor around `dom`; nothing when there is none (a view, a test without it). */
export function announce(dom: Element, text: string): void {
  const region = dom.closest('.rt-editor')?.querySelector<HTMLElement>('[data-editor-announcer]');
  if (!region || text === '') return;
  // a new text node each time: the same sentence twice in a row is said twice
  region.replaceChildren(document.createTextNode(text));
}
