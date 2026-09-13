import { globalStyle, style } from '@vanilla-extract/css';
export const form = style({ display: 'grid', gap: 12, maxWidth: 440 });
globalStyle(`${form} label`, { display: 'grid', gap: 4 });
globalStyle(`${form} input`, { font: 'inherit', minHeight: 44, padding: 8, width: '100%' });
