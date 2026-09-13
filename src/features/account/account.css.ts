import { globalStyle, style } from '@vanilla-extract/css';
export const form = style({ display: 'grid', gap: 16, maxWidth: 640, marginBlock: 24 });
globalStyle(`${form} label`, { display: 'grid', gap: 7, fontWeight: 600, fontSize: '0.9375rem' });
globalStyle(`${form} input, ${form} select, ${form} textarea`, {
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  fontWeight: 400,
});
globalStyle(`${form} fieldset`, { display: 'grid', gap: 16, minWidth: 0, border: 0, padding: 0 });
globalStyle(`${form} label > span`, { fontSize: '0.8125rem', color: '#68707D', fontWeight: 400 });
