import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';
import { MeetupPage, type Route } from '../features/meetup/MeetupPage';
import { PlacesPage } from '../features/places/PlacesPage';
import { AccountPage, type AccountRoute } from '../features/account/AccountPage';
export type InitialState = {
  route: Route | { section: 'places'; id?: string } | AccountRoute;
  dehydratedState: DehydratedState;
};
export function App({ state, client }: { state: InitialState; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={state.dehydratedState}>
        {'section' in state.route ? (
          state.route.section === 'account' ? (
            <AccountPage route={state.route} />
          ) : (
            <PlacesPage id={state.route.id} />
          )
        ) : (
          <MeetupPage route={state.route} />
        )}
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
