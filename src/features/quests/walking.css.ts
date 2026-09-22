import { globalStyle, style } from '@vanilla-extract/css';
import { theme as t } from '../../app/theme';

export const board = style({ display: 'grid', gap: 24, minWidth: 0 });
export const panel = style({
  minWidth: 0,
  border: `1px solid ${t.line}`,
  borderRadius: 16,
  padding: 24,
  '@media': { 'screen and (max-width: 480px)': { padding: 16 } },
});
globalStyle(`${board} > section`, { marginBlock: 0 });
export const stats = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
  gap: 16,
  marginBlock: 20,
});
globalStyle(`${stats} dd`, { fontSize: '1.5rem', marginBottom: 0 });
export const balance = style({ fontSize: '1.75rem', fontWeight: 750, color: t.link });
export const rows = style({ display: 'grid', gap: 16 });
export const row = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'center',
  justifyContent: 'space-between',
  minWidth: 0,
});
export const progress = style({
  display: 'block',
  width: '100%',
  maxWidth: '100%',
  height: 16,
  accentColor: t.link,
  marginBlock: 12,
});
export const stage = style({ borderRadius: 12, padding: 16, minWidth: 0 });
export const locked = style({ border: `2px dashed ${t.muted}`, background: t.field });
export const available = style({ border: `2px solid ${t.link}`, background: '#fff' });
export const claimed = style({ border: `2px solid ${t.accentInk}`, background: t.soft });
export const state = style({ fontWeight: 700, color: t.accentInk });
export const forms = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  gap: 24,
  minWidth: 0,
});
export const invite = style({ fontFamily: 'monospace', fontSize: '1.125rem', letterSpacing: '0.08em' });
export const history = style({ marginTop: 24 });
export const member = style({
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'space-between',
});
export const number = style({ fontVariantNumeric: 'tabular-nums' });
