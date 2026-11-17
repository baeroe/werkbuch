/*
 * The large view of the pictures of a rich text (WEBU-7): which picture of which text is open. A module store, so any
 * text (an editor, a comment, a wiki page read) opens the one viewer the shell holds (`ImageViewerHost`). The pictures
 * are those of the text in its order, so ←/→ go through them; the viewer gives the focus back to `returnFocus` (the
 * picture that opened it) when it closes.
 */

import type { Node as PmNode } from '@tiptap/pm/model';
import { useSyncExternalStore } from 'react';

/** A picture of a text: its attachment and its alternative text. */
export interface ViewerImage {
  attachmentId: string;
  alt: string | null;
}

export interface ViewerState {
  images: ViewerImage[];
  index: number;
  returnFocus: HTMLElement | null;
}

let state: ViewerState | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

/** Opens the large view at `index` of `images` (clamped into the list); nothing without pictures. */
export function openImageViewer(images: ViewerImage[], index: number, returnFocus: HTMLElement | null = null): void {
  if (images.length === 0) return;
  state = { images, index: Math.min(Math.max(index, 0), images.length - 1), returnFocus };
  tell();
}

/** Shows another picture of the same text; nothing past either end. */
export function showImage(index: number): void {
  if (!state || index < 0 || index >= state.images.length || index === state.index) return;
  state = { ...state, index };
  tell();
}

export function closeImageViewer(): void {
  if (!state) return;
  state = null;
  tell();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What is open now, read outside React (a key listener). */
export const viewerNow = (): ViewerState | null => state;

export function useImageViewer(): ViewerState | null {
  return useSyncExternalStore(subscribe, () => state);
}

/** The pictures of a document in their order, each with its position. */
export function imagesOf(doc: PmNode): (ViewerImage & { pos: number })[] {
  const found: (ViewerImage & { pos: number })[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'image' && typeof node.attrs.attachmentId === 'string') {
      found.push({ attachmentId: node.attrs.attachmentId, alt: typeof node.attrs.alt === 'string' && node.attrs.alt !== '' ? node.attrs.alt : null, pos });
    }
    return true;
  });
  return found;
}

/** Opens the large view on the picture at `pos` of a document, with all the pictures of the document. */
export function viewImageAt(doc: PmNode, pos: number, returnFocus: HTMLElement | null): void {
  const images = imagesOf(doc);
  openImageViewer(
    images.map(({ attachmentId, alt }) => ({ attachmentId, alt })),
    images.findIndex((image) => image.pos === pos),
    returnFocus,
  );
}
