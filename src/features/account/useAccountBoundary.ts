import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { accountSchema } from '../../contracts/account';

// Private UI is hidden during external identity validation. Requests from the
// old document are cancelled, and late callbacks cannot mount a new account.
export function useAccountBoundary(userId: string | null) {
  const client = useQueryClient();
  const [ready, setReady] = useState(true);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | undefined;
    const clear = () => {
      setReady(false);
      void client.cancelQueries({ queryKey: ['private'] });
      client.removeQueries({ queryKey: ['private'] });
    };
    const changed = () => {
      clear();
      window.location.reload();
    };
    const verify = async () => {
      setReady(false);
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      try {
        const response = await fetch('/api/v1/me', { signal: current.signal });
        const id =
          response.status === 401
            ? null
            : response.ok
              ? (accountSchema.parse(await response.json()).user?.id ?? null)
              : undefined;
        if (!alive || current.signal.aborted) return;
        if (id === undefined) {
          clear();
          return;
        }
        if (id !== userId) changed();
        else setReady(true);
      } catch {
        if (alive && !current.signal.aborted) clear();
      }
    };
    const channel = new BroadcastChannel('cmon-account');
    channel.onmessage = changed;
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) changed();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void verify();
      else setReady(false);
    };
    window.addEventListener('focus', verify);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    setReady(true);
    return () => {
      alive = false;
      controller?.abort();
      channel.close();
      window.removeEventListener('focus', verify);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [client, userId]);
  return ready;
}
