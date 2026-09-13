import { globalStyle, style } from '@vanilla-extract/css';
globalStyle('*', { boxSizing: 'border-box' });
globalStyle('body', {
  margin: 0,
  background: '#fff',
  color: '#202124',
  // iOS 26.3 Simulator WebKit renders Korean as missing glyphs with system-ui.
  fontFamily: 'Arial, sans-serif',
  lineHeight: 1.6,
});
globalStyle('button, a', { touchAction: 'manipulation' });
globalStyle('button', {
  font: 'inherit',
  minHeight: 44,
  padding: '8px 16px',
  cursor: 'pointer',
  border: '1px solid #666',
  borderRadius: 6,
  background: '#f5f5f5',
  color: '#202124',
});
globalStyle('a', {
  overflowWrap: 'anywhere',
  maxWidth: '100%',
  minWidth: 0,
  color: '#164da8',
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
});
globalStyle(':focus-visible', { outline: '3px solid #164da8', outlineOffset: 3 });
globalStyle('h1', { fontSize: '1.8rem', lineHeight: 1.3, overflowWrap: 'anywhere' });
globalStyle('p, dd, li', { overflowWrap: 'anywhere' });
globalStyle('dt', { fontWeight: 700 });
globalStyle('dd', { margin: '0 0 16px' });
export const page = style({ maxWidth: 720, margin: '0 auto', padding: '24px 20px 48px' });
export const actions = style({ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' });
export const note = style({ color: '#50545a' });
