import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';
import { MeetupPage, type Route } from '../features/meetup/MeetupPage';
import { PlacesPage } from '../features/places/PlacesPage';
export type InitialState = {
  route: Route | { section: 'places'; id?: string };
  dehydratedState: DehydratedState;
};
export function App({ state, client }: { state: InitialState; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={state.dehydratedState}>
        {'section' in state.route ? (
          <PlacesPage id={state.route.id} />
        ) : (
          <MeetupPage route={state.route} />
        )}
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
