import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '@/lib/theme';
import { useUiStore } from './ui';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => vi.useRealTimers());

describe('useUiStore', () => {
  it('stores the theme as a plain string under werkbuch:theme and applies it at once', () => {
    useUiStore.getState().setTheme('dark');

    expect(useUiStore.getState().theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    useUiStore.getState().setTheme('system');
    expect(localStorage.getItem(THEME_KEY)).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('opens and closes the peek, the create dialog, the palette, the help and the sidebar', () => {
    const ui = useUiStore.getState();

    ui.openPeek('wi_web_47');
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    ui.openPeek(null);
    expect(useUiStore.getState().peekItemId).toBeNull();

    ui.openCreate({ project_id: 'p_app', state_id: 'app_todo' });
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: { project_id: 'p_app', state_id: 'app_todo' } });
    ui.closeCreate();
    expect(useUiStore.getState()).toMatchObject({ createOpen: false, createDefaults: null });
    ui.openCreate();
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: null });

    ui.setPaletteOpen(true);
    expect(useUiStore.getState().paletteOpen).toBe(true);
    ui.setHelpOpen(true);
    expect(useUiStore.getState().helpOpen).toBe(true);
    ui.setHelpOpen(false);
    expect(useUiStore.getState().helpOpen).toBe(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    ui.toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it('keeps the palette command while the palette closes, and forgets it when it opens plainly', () => {
    const ui = useUiStore.getState();

    ui.openPalette('item.status');
    expect(useUiStore.getState()).toMatchObject({ paletteOpen: true, paletteCommandId: 'item.status' });
    ui.setPaletteOpen(false);
    expect(useUiStore.getState()).toMatchObject({ paletteOpen: false, paletteCommandId: 'item.status' });
    ui.setPaletteOpen(true);
    expect(useUiStore.getState()).toMatchObject({ paletteOpen: true, paletteCommandId: null });
  });

  it('keeps the selection', () => {
    useUiStore.getState().setSelection(['a', 'b']);
    expect(useUiStore.getState().selection).toEqual(['a', 'b']);
  });

  it('flash highlights an id for two seconds', () => {
    vi.useFakeTimers();

    useUiStore.getState().flash('wi_web_47');
    expect(useUiStore.getState().flashIds).toEqual(['wi_web_47']);

    vi.advanceTimersByTime(1500);
    useUiStore.getState().flash('wi_web_47'); // flashing again starts the two seconds over
    vi.advanceTimersByTime(1500);
    expect(useUiStore.getState().flashIds).toEqual(['wi_web_47']);

    vi.advanceTimersByTime(600);
    expect(useUiStore.getState().flashIds).toEqual([]);
  });
});
