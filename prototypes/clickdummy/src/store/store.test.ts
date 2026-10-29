import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '@/lib/theme';
import { SESSION_KEY, useSession } from './session';
import { useUiStore } from './ui';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => vi.useRealTimers());

describe('useSession', () => {
  it('starts as Mara and keeps the person across a reload under werkbuch:session', () => {
    expect(useSession.getState().userId).toBe('u_mara');

    useSession.getState().setUserId('u_ida');

    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}').state.userId).toBe('u_ida');
    useSession.getState().setUserId('u_mara');
  });

  it('switches the person when the browser refuses storage (a sandboxed frame): the choice lasts until reload', () => {
    const refuse = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    try {
      expect(() => useSession.getState().setUserId('u_ida')).not.toThrow();
      expect(useSession.getState().userId).toBe('u_ida');
      expect(() => useSession.persist.rehydrate()).not.toThrow();
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
      useSession.getState().setUserId('u_mara');
    }
  });
});

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

  it('opens and closes the peek, the create dialog, the palette and the sidebar', () => {
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
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    ui.toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
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
