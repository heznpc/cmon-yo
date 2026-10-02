import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { publicAPI, PublicApiError } from '../../api/public';
import { favoritePlacesKey, type FavoritePlaces } from '../../contracts/place';

export function usePlaceFavorites(userId: string | null, ready: boolean) {
  const client = useQueryClient();
  const location = useLocation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const query = useQuery({
    queryKey: favoritePlacesKey(userId),
    enabled: ready && !!userId,
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) => publicAPI.favoritePlaces(signal, userId!),
  });
  const ids = useMemo(
    () => new Set(ready && !query.isError ? query.data?.placeIds ?? [] : []),
    [ready, query.isError, query.data?.placeIds],
  );
  useEffect(() => {
    if (!ready) active.current?.abort();
    return () => active.current?.abort();
  }, [userId, ready]);
  useEffect(() => {
    if (query.error instanceof PublicApiError && query.error.code === 'ACCOUNT_CHANGED') {
      client.removeQueries({ queryKey: ['private'] });
      window.location.reload();
    }
  }, [client, query.error]);

  async function toggle(id: string) {
    if (!ready || active.current) return;
    if (!userId) {
      setMessage('찜하려면 로그인해 주세요.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setBusyId(id);
    setMessage('');
    try {
      // A failed write may have reached the server. Resolve an invalidated
      // cache before deriving the next desired state.
      const loaded = await client.fetchQuery({
        queryKey: favoritePlacesKey(userId),
        staleTime: query.isError ? 0 : 60_000,
        queryFn: ({ signal }) => publicAPI.favoritePlaces(signal, userId),
      });
      controller.signal.throwIfAborted();
      if (loaded === null) {
        setMessage('찜하려면 로그인해 주세요.');
        return;
      }
      const next = await publicAPI.setFavorite(
        id,
        !loaded.placeIds.includes(id),
        controller.signal,
        userId,
      );
      controller.signal.throwIfAborted();
      client.setQueryData<FavoritePlaces>(favoritePlacesKey(userId), (current) => ({
        placeIds: next.favorite
          ? Array.from(new Set([...(current?.placeIds ?? []), id]))
          : (current?.placeIds ?? []).filter((placeId) => placeId !== id),
      }));
    } catch (error) {
      void client.invalidateQueries({ queryKey: favoritePlacesKey(userId), refetchType: 'none' });
      if (controller.signal.aborted) return;
      if (error instanceof PublicApiError && error.code === 'ACCOUNT_CHANGED') {
        client.removeQueries({ queryKey: ['private'] });
        window.location.reload();
        return;
      }
      setMessage(
        error instanceof Error ? error.message : '찜을 저장하지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusyId(null);
      }
    }
  }

  const known = ready && (!userId || (query.data != null && !query.isError));
  const needsVerification = query.error instanceof PublicApiError && query.error.code === 'EMAIL_NOT_VERIFIED';
  const needsLogin = !userId || query.data === null;
  return {
    ids,
    busyId,
    known,
    disabled: !known || busyId !== null,
    canRetry: ready && !!userId && query.isError && !needsVerification,
    accountHref: '/account?returnTo=' + encodeURIComponent(location.pathname + location.search),
    accountAction: needsVerification ? '이메일 인증하기' : needsLogin && (message || userId) ? '로그인하기' : null,
    retrying: query.isFetching,
    retry: () => query.refetch(),
    message: message || (needsVerification
      ? '이메일 인증을 마친 뒤 찜을 이용할 수 있습니다. 내 계정에서 인증해 주세요.'
      : query.isError
      ? '찜 목록을 확인하지 못했습니다. 다시 조회해 주세요.'
      : userId && query.data === null ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : ''),
    toggle,
  };
}
