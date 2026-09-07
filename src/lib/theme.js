export const getStoredTheme = () => localStorage.getItem('f7_theme') || 'dark';

export const resolveTheme = (theme) => {
  if (theme === 'system') return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return theme === 'light' ? 'light' : 'dark';
};

export const applyTheme = (theme) => {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.body.classList.toggle('light-theme', resolved === 'light');
  localStorage.setItem('f7_theme', theme);
  return resolved;
};

