import { useState, useEffect, useCallback } from 'react';

const KEY = 'aprid_theme';

export function getTheme() {
  return localStorage.getItem(KEY) || 'dark';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

// apply immediately on module load to avoid a flash of the wrong theme
applyTheme(getTheme());

export function useTheme() {
  const [theme, setTheme] = useState(getTheme);
  useEffect(() => { applyTheme(theme); localStorage.setItem(KEY, theme); }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
