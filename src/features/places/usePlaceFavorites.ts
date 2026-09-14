import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { publicAPI } from '../../api/public';
import { favoritePlacesKey, type FavoritePlaces } from '../../contracts/place';

export function usePlaceFavorites() {
  const client = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: favoritePlacesKey,
    enabled: false,
    retry: false,
    queryFn: ({ signal }) => publicAPI.favoritePlaces(signal),
  });
  const ids = useMemo(() => new Set(query.data?.placeIds ?? []), [query.data?.placeIds]);

  async function toggle(id: string) {
    if (busyId) return;
    setBusyId(id);
    setMessage('');
    try {
      let loaded = query.data;
      if (loaded === undefined) {
        const result = await query.refetch();
        if (result.error) throw result.error;
        loaded = result.data;
      }
      if (loaded === null) {
        setMessage('찜하려면 로그인해 주세요.');
        return;
      }
      if (!loaded) throw new Error('찜 목록을 불러오지 못했습니다.');
      const next = await publicAPI.setFavorite(
        id,
        !loaded.placeIds.includes(id),
        new AbortController().signal,
      );
      client.setQueryData<FavoritePlaces>(favoritePlacesKey, (current) => ({
        placeIds: next.favorite
          ? Array.from(new Set([...(current?.placeIds ?? []), id]))
          : (current?.placeIds ?? []).filter((placeId) => placeId !== id),
      }));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '찜을 저장하지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return { ids, busyId, message, toggle };
}
