export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'training-dashboard.theme';
const THEME_COLOR: Record<'light' | 'dark', string> = { light: '#f9f9f7', dark: '#111514' };

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

// Applies the theme to the document without touching storage — used both by
// setTheme below and by index.html's inline pre-paint script (duplicated
// there in plain JS, since that script runs before any module can load).
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }

  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}

export function setTheme(theme: Theme): void {
  if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
