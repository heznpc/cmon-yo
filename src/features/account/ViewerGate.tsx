import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { accountKey, accountSchema } from '../../contracts/account';
import { useAccountBoundary } from './useAccountBoundary';
export const DocumentIdentity = createContext<RefObject<string | null | undefined>>({
  current: undefined,
});
export function ViewerGate({
  initial,
  children,
}: {
  initial?: string | null;
  children: (userId: string | null) => ReactNode;
}) {
  const client = useQueryClient(),
    identity = useContext(DocumentIdentity);
  const [userId, setUserId] = useState(initial);
  const [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initial !== undefined) {
      if (identity.current === undefined) identity.current = initial;
      return;
    }
    const controller = new AbortController();
    setError(false);
    void fetch('/api/v1/me', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok && r.status !== 401) throw new Error('identity unavailable');
        const account = r.status === 401 ? { user: null } : accountSchema.parse(await r.json());
        if (controller.signal.aborted) return;
        const id = account.user?.id ?? null;
        if (identity.current !== undefined && identity.current !== id) {
          void client.cancelQueries({ queryKey: ['private'] });
          client.removeQueries({ queryKey: ['private'] });
          window.location.reload();
          return;
        }
        identity.current = id;
        client.setQueryData(accountKey(id), account);
        setUserId(id);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [initial, client, identity, attempt]);
  if (userId === undefined)
    return (
      <div role="status">
        {error ? '계정을 확인하지 못했습니다.' : '계정을 확인하는 중…'}
        {error ? <button onClick={() => setAttempt((x) => x + 1)}>계정 다시 확인</button> : null}
      </div>
    );
  return children(userId);
}
export function AccountBoundary({
  userId,
  children,
}: {
  userId: string | null;
  children: (ready: boolean) => ReactNode;
}) {
  return children(useAccountBoundary(userId));
}
