export type ThemeChoice = 'system' | 'light' | 'dark';

/** Plain string ('system' | 'light' | 'dark'); index.html reads it before the first paint. */
export const THEME_KEY = 'werkbuch:theme';

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Stores the choice and applies it at once; colours do not animate during the switch (DESIGN.md). */
export function applyTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  const root = document.documentElement;
  root.setAttribute('data-theme-switching', '');
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')));
}
