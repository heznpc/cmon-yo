import { observeDeferred } from './observability';
import { dehydrate, type QueryClient, type Query } from '@tanstack/react-query';
import type { StreamPacket, StreamSlotName } from '../app/stream';
// Two product units only. Promise objects never pass through JSON serialization.
export function deferState(
  slot: StreamSlotName,
  pending: Promise<unknown>,
  client: QueryClient,
  select: (q: Query) => boolean,
): Promise<StreamPacket> {
  return pending.then(
    (userId) => ({
      slot,
      state: dehydrate(client, {
        shouldDehydrateQuery: (q) => q.state.status === 'success' && select(q),
      }),
      ...(slot === 'viewer' ? { userId: userId as string | null } : {}),
    }),
    () => {
      observeDeferred(slot);
      return { slot, state: { queries: [], mutations: [] }, failed: true };
    },
  );
}
