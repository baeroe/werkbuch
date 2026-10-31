/*
 * The command palette in the shell, with its key: `mod+k` opens it from anywhere (also while typing and over a dialog)
 * and closes it again. What it lists comes from the commands registered at the moment (`lib/commands.ts`): the shell's
 * own (`bindings.tsx`) and those of the screen.
 */

import { CommandPalette } from '@/features/palette/CommandPalette';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';

export function PaletteHost() {
  useShortcut('shell.palette', () => {
    const ui = useUiStore.getState();
    ui.setPaletteOpen(!ui.paletteOpen);
  });
  return <CommandPalette />;
}
