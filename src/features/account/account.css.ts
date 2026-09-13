import { globalStyle, style } from '@vanilla-extract/css';
export const form = style({ display: 'grid', gap: 12, maxWidth: 440 });
globalStyle(`${form} label`, { display: 'grid', gap: 4 });
globalStyle(`${form} input, ${form} select, ${form} textarea`, {
  font: 'inherit',
  minHeight: 44,
  padding: 8,
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
});
globalStyle(`${form} fieldset`, { display: 'grid', gap: 12, minWidth: 0, border: 0, padding: 0 });
