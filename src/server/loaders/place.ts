import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { placeKey, placeListKey, type PlaceFilters } from '../../contracts/place';
import type { PlaceService } from '../services/place';

export async function loadPlaces(
  id: string | undefined,
  service: PlaceService,
  signal: AbortSignal,
  client: QueryClient,
  filters: PlaceFilters = { page: 0 },
) {
  if (id)
    await client.fetchQuery({
      queryKey: placeKey(id),
      queryFn: () => service.info(id, signal),
      staleTime: 60_000,
    });
  else
    await client.fetchQuery({
      queryKey: placeListKey(filters),
      queryFn: () => service.list(signal, filters),
      staleTime: 60_000,
    });
  signal.throwIfAborted();
  return dehydrate(client);
}
