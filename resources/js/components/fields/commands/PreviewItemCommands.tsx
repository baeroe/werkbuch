import type { RefObject } from 'react';
import { useItemCommands } from './useItemCommands';

/**
 * The item commands of the preview, as `PeekHost` mounts them (with the preview): the previewed item while the focus is
 * inside `panel`, and while no item page is mounted.
 */
export function PreviewItemCommands({ panel }: { panel: RefObject<HTMLElement | null> }): null {
  useItemCommands({ scope: 'detail', panel });
  return null;
}
