import {
  HydrationBoundary,
  QueryClientProvider,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';
import { lazy, Suspense, useRef, type ComponentType } from 'react';
import { Routes, Route, useLocation, useParams } from 'react-router';
import type { Route as FixtureRoute } from '../features/meetup/MeetupPage';
import { PlacesPage } from '../features/places/PlacesPage';
import type { AccountRoute } from '../features/account/AccountPage';
import type { MeetingsRoute } from '../features/meetup/MeetingsPage';
import { ViewerGate, AccountBoundary, DocumentIdentity } from '../features/account/ViewerGate';
import { meetingFiltersSchema } from '../contracts/meetings';
import { accountReturnPath } from '../contracts/account';
import { NavigationEffects } from './navigation';
import type { CommunityRoute } from '../features/community/CommunityPage';
import { StreamContext, type StreamResources, type StreamState } from './stream';
let loadedCommunity: ComponentType<{ route: CommunityRoute; initial?: string | null }> | undefined;
const loadCommunity = () =>
  import('../features/community/CommunityPage').then((m) => ({
    default: (loadedCommunity = m.CommunityPage),
  }));
const LazyCommunity = lazy(loadCommunity);
let loadedAccount: ComponentType<{ route: AccountRoute }> | undefined;
let loadedMeetings: ComponentType<{ route: MeetingsRoute; ready?: boolean }> | undefined;
let loadedFixture: ComponentType<{ route: FixtureRoute }> | undefined;
const loadAccount = () =>
  import('../features/account/AccountPage').then((m) => ({
    default: (loadedAccount = m.AccountPage),
  }));
const loadMeetings = () =>
  import('../features/meetup/MeetingsPage').then((m) => ({
    default: (loadedMeetings = m.MeetingsPage),
  }));
const loadFixture = () =>
  import('../features/meetup/MeetupPage').then((m) => ({
    default: (loadedFixture = m.MeetupPage),
  }));
const LazyAccount = lazy(loadAccount),
  LazyMeetings = lazy(loadMeetings),
  LazyFixture = lazy(loadFixture);
export async function prepareInitialRoute(state: InitialState) {
  const r = state.route;
  if (!('section' in r)) await loadFixture();
  else if (r.section === 'community') await loadCommunity();
  else if (r.section === 'account') await loadAccount();
  else if (r.section === 'meetings') {
    await loadMeetings();
    if (r.mode === 'create')
      await (await import('../features/meetup/MeetingsPage')).prepareEditor();
  }
}
export type InitialState = {
  route:
    | FixtureRoute
    | { section: 'places'; id?: string }
    | AccountRoute
    | MeetingsRoute
    | CommunityRoute;
  dehydratedState: DehydratedState;
  url?: string;
  fixture?: boolean;
  stream?: StreamState;
};
export function initialURL(state: InitialState) {
  if (state.url) return state.url;
  const r = state.route;
  if (!('section' in r)) return `/meetups/${r.id}${r.discussion ? '/discussion' : ''}`;
  if (r.section === 'places') return '/places' + (r.id ? '/' + r.id : '');
  if (r.section === 'account') return '/account';
  if (r.section === 'community') return '/community';
  return r.mode === 'mine'
    ? '/account/meetups'
    : r.mode === 'create'
      ? '/meetups/new'
      : r.id
        ? '/meetups/' + r.id
        : '/meetups';
}
export function App({
  state,
  client,
  resources = {},
}: {
  state: InitialState;
  client: QueryClient;
  resources?: StreamResources;
}) {
  const location = useLocation(),
    entry = useRef({ key: location.key, active: true });
  if (location.key !== entry.current.key) entry.current.active = false;
  const first = entry.current.active;
  const identity = useRef<string | null | undefined>(
    state.stream?.slots.includes('viewer') || ('mode' in state.route && state.route.mode === 'list')
      ? undefined
      : 'userId' in state.route
        ? state.route.userId
        : undefined,
  );
  const initial = first ? state : undefined;
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={first ? state.dehydratedState : undefined}>
        <DocumentIdentity.Provider value={identity}>
          <StreamContext.Provider
            value={first && state.stream ? { state: state.stream, resources } : null}
          >
            <NavigationEffects />
            <Suspense
              fallback={
                <main>
                  <p role="status">화면을 불러오는 중…</p>
                </main>
              }
            >
              <Routes>
                <Route path="/" element={<PlacesPage />} />
                <Route path="/places" element={<PlacesPage />} />
                <Route path="/places/:id" element={<PlaceRoute />} />
                <Route path="/meetups" element={<MeetingRoute mode="list" initial={initial} />} />
                <Route
                  path="/meetups/new"
                  element={<MeetingRoute mode="create" initial={initial} />}
                />
                <Route
                  path="/meetups/:id"
                  element={
                    state.fixture || !('section' in state.route) ? (
                      <FixturePage />
                    ) : (
                      <MeetingRoute mode="detail" initial={initial} />
                    )
                  }
                />
                <Route
                  path="/meetups/:id/discussion"
                  element={
                    state.fixture ? (
                      <FixturePage discussion />
                    ) : (
                      <CommunityRoutePage mode="discussion" initial={initial} />
                    )
                  }
                />
                <Route
                  path="/activity"
                  element={<CommunityRoutePage mode="activity" initial={initial} />}
                />
                <Route
                  path="/community"
                  element={<CommunityRoutePage mode="list" initial={initial} />}
                />
                <Route
                  path="/community/new"
                  element={<CommunityRoutePage mode="create" initial={initial} />}
                />
                <Route
                  path="/community/:id"
                  element={<CommunityRoutePage mode="detail" initial={initial} />}
                />
                <Route
                  path="/account/posts"
                  element={<CommunityRoutePage mode="mine" initial={initial} />}
                />
                <Route
                  path="/account/meetups"
                  element={<MeetingRoute mode="mine" initial={initial} />}
                />
                <Route path="/account" element={<AccountRoutePage initial={initial} />} />
                <Route
                  path="*"
                  element={
                    <main>
                      <h1>페이지를 찾을 수 없습니다.</h1>
                    </main>
                  }
                />
              </Routes>
            </Suspense>
          </StreamContext.Provider>
        </DocumentIdentity.Provider>
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
function PlaceRoute() {
  const { id } = useParams();
  return <PlacesPage key={id} id={id} />;
}
function FixturePage({ discussion = false }: { discussion?: boolean }) {
  const { id } = useParams(),
    MeetupPage = loadedFixture ?? LazyFixture;
  return <MeetupPage key={id} route={{ id: id!, discussion }} />;
}
function MeetingRoute({ mode, initial }: { mode: MeetingsRoute['mode']; initial?: InitialState }) {
  const { id } = useParams(),
    location = useLocation(),
    MeetingsPage = loadedMeetings ?? LazyMeetings;
  const parsed = meetingFiltersSchema.safeParse(
    Object.fromEntries([...new URLSearchParams(location.search)].filter(([, v]) => v !== '')),
  );
  if (!parsed.success)
    return (
      <main>
        <h1>조회 조건을 확인해 주세요.</h1>
      </main>
    );
  const known = initial && 'userId' in initial.route ? initial.route.userId : undefined;
  const route: MeetingsRoute = {
    section: 'meetings',
    mode,
    id,
    filters: parsed.data,
    userId: known ?? null,
  };
  if (mode === 'list' || mode === 'detail')
    return <MeetingsPage key={location.pathname + location.search} route={route} />;
  return (
    <ViewerGate key={location.pathname + location.search} initial={known}>
      {(userId) => (
        <AccountBoundary userId={userId}>
          {(ready) => <MeetingsPage route={{ ...route, userId }} ready={ready} />}
        </AccountBoundary>
      )}
    </ViewerGate>
  );
}
function AccountRoutePage({ initial }: { initial?: InitialState }) {
  const AccountPage = loadedAccount ?? LazyAccount;
  const location = useLocation(),
    q = new URLSearchParams(location.search);
  const existing =
    initial && 'section' in initial.route && initial.route.section === 'account'
      ? initial.route
      : undefined;
  return (
    <ViewerGate key={location.pathname + location.search} initial={existing?.userId}>
      {(userId) => (
        <AccountPage
          route={
            existing ?? {
              section: 'account',
              userId,
              mode: q.get('mode') === 'reset' ? 'reset' : 'login',
              returnTo: accountReturnPath(q.get('returnTo')),
              callbackFailed: q.has('error'),
              passwordChanged: q.has('passwordChanged'),
            }
          }
        />
      )}
    </ViewerGate>
  );
}

function CommunityRoutePage({
  mode,
  initial,
}: {
  mode: CommunityRoute['mode'];
  initial?: InitialState;
}) {
  const { id } = useParams(),
    location = useLocation(),
    Page = loadedCommunity ?? LazyCommunity;
  const known = initial && 'userId' in initial.route ? initial.route.userId : undefined;
  return (
    <Page
      key={location.pathname + location.search}
      route={{ section: 'community', mode, id, userId: known ?? null }}
      initial={known}
    />
  );
}
