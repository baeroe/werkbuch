/*
 * How many uploads the editors of a form are running (spec 4.16): a form that sends a text waits until every picture
 * and file in it is stored, since an upload still on its way is no node in the text yet. The form makes a counter and
 * hands it to the editors inside; every editor counts its own uploads into it.
 *
 *   const uploads = useUploadCounter();
 *   const pending = useUploadsPending(uploads);
 *   <UploadContext value={uploads}><RichTextEditor … /></UploadContext>
 *   <Button disabledReason={pending > 0 ? t('editor.upload.pending') : undefined}>…</Button>
 *
 * Inside the provider, `useUploadsPending()` reads the counter of the form around it. Editors outside any form count
 * nowhere.
 */

import { createContext, useContext, useState, useSyncExternalStore } from 'react';

/** The running uploads of a form. */
export class UploadCounter {
  private count = 0;
  private readonly listeners = new Set<() => void>();

  /** An upload started (1) or ended (-1). */
  add(delta: number): void {
    this.count += delta;
    this.listeners.forEach((listener) => listener());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly current = (): number => this.count;
}

export const UploadContext = createContext<UploadCounter | null>(null);

/** A counter for the editors of one form, the same on every render. */
export function useUploadCounter(): UploadCounter {
  return useState(() => new UploadCounter())[0];
}

const nothing = () => () => {};
const none = () => 0;

/** How many uploads are running: in `counter`, or else in the form around. */
export function useUploadsPending(counter?: UploadCounter): number {
  const around = useContext(UploadContext);
  const read = counter ?? around;
  return useSyncExternalStore(read?.subscribe ?? nothing, read?.current ?? none);
}
