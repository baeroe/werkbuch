/*
 * Local UI state: theme, sidebar, command palette, the shortcut help, the item preview, the create dialog, the
 * selection of a list and the ids that are highlighted for a moment. Server data lives in the query cache, never here.
 *
 * The theme is not persisted by this store: `applyTheme` writes the plain string `werkbuch:theme` that `index.html`
 * reads before the first paint, and `readTheme` reads it back.
 */

import { create } from 'zustand';
import { applyTheme, readTheme, type ThemeChoice } from '@/lib/theme';
import type { Priority } from '@/types';

/** What the create dialog starts with, e.g. the project and status of the column it was opened from. */
export interface CreateDefaults {
  project_id?: string;
  type_id?: string;
  state_id?: string;
  assignee_id?: string | null;
  parent_id?: string | null;
  priority?: Priority;
  title?: string;
  template_id?: string;
}

interface UiState {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** The overlay with all shortcuts (`?`). */
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  /** The item shown in the side panel; null: closed. */
  peekItemId: string | null;
  openPeek: (id: string | null) => void;
  createOpen: boolean;
  createDefaults: CreateDefaults | null;
  openCreate: (defaults?: CreateDefaults | null) => void;
  closeCreate: () => void;
  /** Ids of the selected items of the current list. */
  selection: string[];
  setSelection: (ids: string[]) => void;
  /** Ids that are highlighted for two seconds (a live change, a new item). */
  flashIds: string[];
  flash: (id: string) => void;
}

const FLASH_MS = 2000;
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUiStore = create<UiState>()((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  peekItemId: null,
  openPeek: (peekItemId) => set({ peekItemId }),
  createOpen: false,
  createDefaults: null,
  openCreate: (defaults = null) => set({ createOpen: true, createDefaults: defaults }),
  closeCreate: () => set({ createOpen: false, createDefaults: null }),
  selection: [],
  setSelection: (selection) => set({ selection }),
  flashIds: [],
  flash: (id) => {
    clearTimeout(flashTimers.get(id));
    flashTimers.set(
      id,
      setTimeout(() => {
        flashTimers.delete(id);
        set((state) => ({ flashIds: state.flashIds.filter((flashed) => flashed !== id) }));
      }, FLASH_MS),
    );
    set((state) => (state.flashIds.includes(id) ? state : { flashIds: [...state.flashIds, id] }));
  },
}));
