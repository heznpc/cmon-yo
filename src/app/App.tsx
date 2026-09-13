import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';
import { MeetupPage, type Route } from '../features/meetup/MeetupPage';
export type InitialState = { route: Route; dehydratedState: DehydratedState };
export function App({ state, client }: { state: InitialState; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={state.dehydratedState}>
        <MeetupPage route={state.route} />
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
