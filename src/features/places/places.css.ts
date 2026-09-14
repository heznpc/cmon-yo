import { globalStyle, style } from '@vanilla-extract/css';
import { theme } from '../../app/theme';
export const explorePage = style({ maxWidth: 1240 });
export const layout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 350px',
  gap: 28,
  alignItems: 'start',
  '@media': { 'screen and (max-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});
export const mapColumn = style({
  position: 'sticky',
  top: 100,
  minWidth: 0,
  '@media': { 'screen and (max-width: 900px)': { position: 'static' } },
});
export const map = style({
  height: 'min(58vh, 560px)',
  minHeight: 350,
  width: '100%',
  borderRadius: 20,
  border: `1px solid ${theme.line}`,
  background: '#E7EBE4',
  zIndex: 0,
  '@media': { 'screen and (max-width: 900px)': { height: 370, minHeight: 300 } },
});
export const mapMessage = style({ margin: '12px 0' });
export const mapToolbar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 12,
  fontWeight: 700,
});
export const pin = style({
  background: 'transparent',
  border: 0,
  padding: 0,
  width: 44,
  height: 52,
  minHeight: 52,
});
export const userLocation = style({
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#3655B3',
  border: '3px solid #fff',
  boxSizing: 'border-box',
});
export const locationControl = style({ fontSize: '0.8125rem' });
globalStyle(`${pin} svg`, { width: 44, height: 52, display: 'block' });
// Keep provider attribution visible and size map controls for touch input.
globalStyle(`${map} .maplibregl-ctrl-attrib`, {
  fontSize: 11,
  lineHeight: 1.5,
  padding: '2px 6px',
  maxWidth: '100%',
});
globalStyle(`${map} .maplibregl-ctrl-attrib a`, {
  display: 'inline',
  minHeight: 0,
  color: '#3655B3',
});
globalStyle(`${map} .maplibregl-ctrl-group button`, { width: 44, height: 44, minHeight: 44 });
export const selected = style({
  scrollMarginBottom: 'calc(8rem + env(safe-area-inset-bottom))',
  padding: 20,
  marginTop: 16,
  border: `1px solid ${theme.accent}`,
  borderRadius: 16,
  background: theme.soft,
});
globalStyle(`${selected} h3`, { marginBottom: 8 });
export const resultList = style({ minWidth: 0 });
globalStyle(`${resultList} ul`, { marginTop: 0 });
export const locate = style({ fontSize: '0.8125rem', marginTop: 8, padding: '6px 12px' });
export const cardActions = style({
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
});
export const favorite = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontSize: '0.8125rem',
  padding: '8px 12px',
  minHeight: 44,
  selectors: {
    '&[aria-pressed="true"]': {
      color: theme.link,
      borderColor: theme.link,
      background: theme.soft,
    },
  },
});
globalStyle(`${favorite} svg`, { width: 18, height: 18 });
export const selectedRow = style({
  borderRadius: 12,
  background: theme.soft,
  padding: '12px !important',
});
