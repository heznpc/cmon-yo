import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';
import { MeetupPage, type Route } from '../features/meetup/MeetupPage';
import { PlacesPage } from '../features/places/PlacesPage';
import { AccountPage, type AccountRoute } from '../features/account/AccountPage';
import { MeetingsPage, type MeetingsRoute } from '../features/meetup/MeetingsPage';
export type InitialState = {
  route: Route | { section: 'places'; id?: string } | AccountRoute | MeetingsRoute;
  dehydratedState: DehydratedState;
};
export function App({ state, client }: { state: InitialState; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={state.dehydratedState}>
        {'section' in state.route ? (
          state.route.section === 'meetings' ? (
            <MeetingsPage route={state.route} />
          ) : state.route.section === 'account' ? (
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
