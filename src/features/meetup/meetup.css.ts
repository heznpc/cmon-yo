import { globalStyle, style } from '@vanilla-extract/css';
import { theme as t } from '../../app/theme';
globalStyle('*', { boxSizing: 'border-box' });
globalStyle('html', { scrollPaddingTop: 100 });
globalStyle('body', {
  margin: 0,
  background: '#fff',
  color: t.ink,
  fontFamily: 'Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  lineHeight: 1.6,
});
globalStyle('button, a, summary', {
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
});
globalStyle('button', {
  font: 'inherit',
  fontSize: '0.9375rem',
  fontWeight: 600,
  minHeight: 44,
  padding: '10px 18px',
  cursor: 'pointer',
  border: `1px solid ${t.line}`,
  borderRadius: 12,
  background: '#fff',
  color: t.ink,
  maxWidth: '100%',
  overflowWrap: 'anywhere',
});
globalStyle('button:hover:not(:disabled):not([aria-disabled="true"])', {
  background: t.field,
  borderColor: '#B7BFCC',
});
globalStyle('button:disabled, button[aria-disabled="true"]', {
  cursor: 'not-allowed',
  color: '#737986',
  background: t.field,
  borderColor: t.line,
});
globalStyle('a', {
  overflowWrap: 'anywhere',
  maxWidth: '100%',
  minWidth: 0,
  color: t.link,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  gap: 8,
});
globalStyle('a:hover', { textDecoration: 'underline', textUnderlineOffset: 4 });
globalStyle('svg', { flexShrink: 0 });
globalStyle(':focus-visible', { outline: `3px solid ${t.link}`, outlineOffset: 4 });
globalStyle('h1', {
  fontSize: '2rem',
  fontWeight: 750,
  letterSpacing: '-0.045em',
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
  margin: '0 0 12px',
});
globalStyle('h2', {
  fontSize: '1.25rem',
  letterSpacing: '-0.025em',
  lineHeight: 1.4,
  margin: '0 0 12px',
});
globalStyle('h3', { fontSize: '1.0625rem', margin: '0 0 10px' });
globalStyle('p, dd, li', { overflowWrap: 'anywhere' });
globalStyle('p', { margin: '8px 0 16px' });
globalStyle('dt', { color: t.muted, fontSize: '0.875rem', fontWeight: 500 });
globalStyle('dd', { margin: '2px 0 20px', fontWeight: 600 });
globalStyle('summary', { cursor: 'pointer', minHeight: 44, padding: '10px 0', fontWeight: 600 });
globalStyle('details', {
  borderTop: `1px solid ${t.line}`,
  borderBottom: `1px solid ${t.line}`,
  padding: '6px 0',
  margin: '8px 0',
});
globalStyle('details[open] > label', { margin: '12px 0' });
globalStyle('input, select, textarea', {
  font: 'inherit',
  fontSize: '1rem',
  color: t.ink,
  border: '1px solid #DDE1E8',
  borderRadius: 12,
  background: t.field,
  minHeight: 48,
  padding: '12px 14px',
  maxWidth: '100%',
  minWidth: 0,
});
globalStyle('textarea', { resize: 'vertical', lineHeight: 1.65 });
globalStyle('input::placeholder, textarea::placeholder', { color: '#767D8B' });
globalStyle('[role="alert"]:not(:empty)', {
  padding: '14px 16px',
  background: '#FFF4F2',
  color: '#8C342A',
  borderRadius: 12,
  margin: '16px 0',
  overflowWrap: 'anywhere',
});
globalStyle('[role="status"]:not(:empty)', {
  padding: '12px 16px',
  background: t.soft,
  color: t.link,
  borderRadius: 12,
  fontSize: '0.875rem',
  margin: '12px 0',
});
globalStyle('[role="alert"]:empty, [role="status"]:empty', { margin: 0 });
globalStyle('[hidden]', { display: 'none !important' });
export const page = style({
  maxWidth: 900,
  margin: '0 auto',
  padding: '120px 32px 64px',
  '@media': {
    'screen and (max-width: 760px)': {
      padding: '100px 24px calc(9rem + env(safe-area-inset-bottom))',
    },
    'screen and (max-width: 360px)': { paddingLeft: 16, paddingRight: 16 },
  },
});
globalStyle(`${page} section`, { marginBlock: 28 });
globalStyle(`${page} section section`, { marginBlock: 20 });
globalStyle(`${page} ul`, { listStyle: 'none', padding: 0, margin: '20px 0' });
globalStyle(`${page} li`, { borderBottom: `1px solid ${t.line}`, padding: '22px 0' });
globalStyle(`${page} li h2`, { marginBottom: 6 });
globalStyle(`${page} li h2 a`, { minHeight: 0, color: t.ink });
globalStyle(`${page} li > a`, { fontWeight: 650, fontSize: '1.125rem', color: t.ink });
export const embeddedPage = style({
  paddingTop: 24,
  paddingBottom: 40,
  '@media': { 'screen and (max-width: 760px)': { paddingTop: 24, paddingBottom: 40 } },
});
export const actions = style({
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBlock: 16,
});
export const note = style({ color: t.muted, fontSize: '0.875rem' });
export const lead = style({ color: t.muted, marginBottom: 28, fontSize: '1.0625rem' });
export const heading = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 20,
  flexWrap: 'wrap',
  marginBottom: 20,
});
export const primary = style({
  background: t.accent,
  color: t.accentInk,
  border: '1px solid transparent',
  borderRadius: 12,
  minHeight: 48,
  padding: '11px 20px',
  fontWeight: 700,
  justifyContent: 'center',
  selectors: {
    '&:hover:not(:disabled)': {
      background: '#8BA2FA',
      borderColor: 'transparent',
      textDecoration: 'none',
    },
    '&:disabled': { background: t.field, color: '#737986' },
  },
});
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 22,
  width: '100%',
  selectors: { '&:hover': { textDecoration: 'none' } },
  '@media': { 'screen and (max-width: 480px)': { gap: 16, alignItems: 'flex-start' } },
});
export const rowIcon = style({
  width: 80,
  height: 80,
  borderRadius: 16,
  background: t.soft,
  color: t.accentInk,
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  '@media': { 'screen and (max-width: 480px)': { width: 60, height: 60, borderRadius: 14 } },
});
globalStyle(`${rowIcon} svg`, { width: 34, height: 34 });
export const rowContent = style({ flex: 1, minWidth: 0 });
export const rowTitle = style({
  display: 'block',
  color: t.ink,
  fontWeight: 700,
  fontSize: '1.125rem',
  lineHeight: 1.45,
  marginBottom: 6,
});
export const metadata = style({
  display: 'block',
  color: t.muted,
  fontSize: '0.875rem',
  fontWeight: 400,
  lineHeight: 1.65,
});
export const excerpt = style({
  margin: '6px 0 12px',
  color: '#505866',
  fontSize: '0.9375rem',
  fontWeight: 400,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});
export const category = style({
  color: t.link,
  fontSize: '0.8125rem',
  fontWeight: 600,
  display: 'block',
  marginBottom: 8,
});
export const search = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: t.field,
  borderRadius: 14,
  paddingLeft: 16,
  color: t.muted,
  marginBlock: 24,
});
globalStyle(`${search} input`, {
  width: '100%',
  background: 'transparent',
  border: 0,
  minHeight: 54,
});
export const filters = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
  marginBlock: 24,
  maxWidth: '100%',
});
globalStyle(`${filters} label`, {
  display: 'grid',
  gap: 6,
  flex: '1 1 140px',
  fontSize: '0.875rem',
  color: t.muted,
  minWidth: 0,
});
globalStyle(`${filters} select, ${filters} input`, { width: '100%' });
export const compactFilters = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
  marginBlock: 20,
});
globalStyle(`${compactFilters} label`, {
  display: 'grid',
  gap: 6,
  minWidth: 120,
  fontSize: '0.875rem',
  color: t.muted,
});
export const account = style({ maxWidth: 520, margin: '0 auto', paddingTop: 8 });
export const footer = style({
  marginTop: 32,
  paddingTop: 24,
  borderTop: `1px solid ${t.line}`,
  color: t.muted,
  fontSize: '0.8125rem',
});
export const header = style({
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 20,
  background: '#fff',
  borderBottom: `1px solid ${t.line}`,
});
export const headerInner = style({
  maxWidth: 1180,
  minHeight: 80,
  padding: '12px 28px',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 28,
  '@media': {
    'screen and (max-width: 1000px)': { gap: 16 },
    'screen and (max-width: 760px)': { minHeight: 72, padding: '10px 20px', gap: 12 },
  },
});
export const wordmark = style({
  fontSize: '1.5rem',
  letterSpacing: '-0.06em',
  fontStyle: 'italic',
  fontWeight: 800,
  color: t.link,
  whiteSpace: 'nowrap',
  selectors: { '&:hover': { textDecoration: 'none' } },
  '@media': { 'screen and (max-width: 760px)': { fontSize: '1.25rem', marginRight: 'auto' } },
});
export const primaryNav = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  '@media': {
    'screen and (max-width: 760px)': {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
      gap: 4,
      background: '#fff',
      borderTop: `1px solid ${t.line}`,
    },
  },
});
export const navLink = style({
  color: t.muted,
  padding: '10px 12px',
  borderRadius: 10,
  fontWeight: 600,
  fontSize: '0.9375rem',
  justifyContent: 'center',
  selectors: {
    '&[aria-current="page"]': { color: t.link, background: t.soft },
    '&:hover': { background: t.field, textDecoration: 'none' },
  },
  '@media': {
    'screen and (max-width: 760px)': {
      flexDirection: 'column',
      gap: 4,
      padding: '8px 2px',
      fontSize: '0.8125rem',
      lineHeight: 1.35,
      textAlign: 'center',
    },
  },
});
globalStyle(`${primaryNav} svg`, {
  display: 'none',
  '@media': { 'screen and (max-width: 760px)': { display: 'block' } },
});
export const utilityNav = style({ display: 'flex', alignItems: 'center', gap: 6 });
globalStyle(`${utilityNav} svg`, {
  display: 'none',
  '@media': { 'screen and (max-width: 1000px)': { display: 'block' } },
});
globalStyle(`${utilityNav} span`, {
  '@media': { 'screen and (max-width: 1000px)': { display: 'none' } },
});
globalStyle(`${utilityNav} a`, { padding: 10, minWidth: 44 });
export const location = style({
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  color: t.muted,
  fontSize: '0.875rem',
  whiteSpace: 'nowrap',
  '@media': { 'screen and (max-width: 480px)': { display: 'none' } },
});
export const skip = style({
  position: 'fixed',
  top: -100,
  left: 16,
  zIndex: 30,
  background: '#fff',
  padding: 12,
  selectors: { '&:focus': { top: 8 } },
});
