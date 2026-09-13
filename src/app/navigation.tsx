import {
  Link,
  useInRouterContext,
  useLocation,
  useNavigationType,
  type LinkProps,
} from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, type AnchorHTMLAttributes } from 'react';
// Real React Router links keep browser modifier keys, external links and fallback hrefs.
export function AppLink({ href = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const routed = useInRouterContext();
  return routed && href.startsWith('/') && !href.startsWith('//') ? (
    <Link to={href} {...(props as Omit<LinkProps, 'to'>)} />
  ) : (
    <a href={href} {...props} />
  );
}
let identityChanging = false;
export function markIdentityChanging() {
  identityChanging = true;
}
const positions = new Map<string, number>();
export function NavigationEffects() {
  const client = useQueryClient();
  const location = useLocation(),
    type = useNavigationType();
  const current = useRef(location.key);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    current.current = location.key;
    // Initial SSR hydration must not undo scrolling or interaction that already
    // happened before JS loaded. Restore only subsequent router navigations.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const restore = () =>
      window.scrollTo(0, type === 'POP' ? (positions.get(location.key) ?? 0) : 0);
    restore();
    // Cached lists render synchronously. A cache miss may fill on a later frame.
    const observer = new ResizeObserver(restore);
    if (type === 'POP') observer.observe(document.getElementById('root')!);
    const stop = () => observer.disconnect();
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true });
    const timeout = setTimeout(stop, 1500);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
    };
  }, [location.key, type]);
  useEffect(() => {
    const save = () => {
      positions.set(current.current, window.scrollY);
      if (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.addEventListener('scroll', save, { passive: true });
    const channel = new BroadcastChannel('cmon-account');
    channel.onmessage = () => {
      positions.clear();
      void client.cancelQueries({ queryKey: ['private'] });
      client.removeQueries({ queryKey: ['private'] });
      if (!identityChanging) window.location.reload();
    };
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) {
        client.removeQueries({ queryKey: ['private'] });
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('scroll', save);
      history.scrollRestoration = previous;
      channel.close();
      window.removeEventListener('pageshow', restore);
    };
  }, [client]);
  return null;
}
