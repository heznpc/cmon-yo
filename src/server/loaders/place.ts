import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { placeKey, placesKey } from '../../contracts/place';
import type { PlaceService } from '../services/place';

export async function loadPlaces(
  id: string | undefined,
  service: PlaceService,
  signal: AbortSignal,
  client: QueryClient,
) {
  if (id)
    await client.fetchQuery({
      queryKey: placeKey(id),
      queryFn: () => service.detail(id, signal),
      staleTime: 60_000,
    });
  else
    await client.fetchQuery({
      queryKey: placesKey,
      queryFn: () => service.list(signal),
      staleTime: 60_000,
    });
  signal.throwIfAborted();
  return dehydrate(client);
}
