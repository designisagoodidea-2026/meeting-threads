// Theme color names from annotations.json, as CSS values tuned to read on both light and dark canvases.
export const THEME_COLORS: Record<string, string> = {
  teal: '#14a39a',
  violet: '#8b6cf0',
  amber: '#e0a000',
  rose: '#e8557a',
  sky: '#2b9be0',
  lime: '#73b32b',
  slate: '#7c8798',
}
export const themeColor = (name?: string) => (name && THEME_COLORS[name]) || 'var(--muted)'
