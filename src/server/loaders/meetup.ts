import { dehydrate, QueryClient } from '@tanstack/react-query';
import { meetupKey, staleTime } from '../../contracts/meetup';
import type { MeetupService } from '../services/meetup';
export async function loadMeetup(
  id: string,
  service: MeetupService,
  signal: AbortSignal,
  client: QueryClient,
) {
  await client.fetchQuery({
    queryKey: meetupKey(id),
    queryFn: () => service(id, signal),
    staleTime,
  });
  signal.throwIfAborted();
  return dehydrate(client);
}
export function createRequestClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}
