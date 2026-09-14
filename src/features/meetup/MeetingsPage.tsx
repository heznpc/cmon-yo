import { RegionSelect } from '../places/RegionSelect';
const AttendancePanel = lazy(() =>
  import('../attendance/AttendancePanel').then((m) => ({ default: m.AttendancePanel })),
);
import { lazy, Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  meetingDetailSchema,
  meetingListSchema,
  membershipSchema,
  myMeetingsSchema,
  meetingKey,
  meetingListKey,
  membershipKey,
  myMeetingsKey,
  type MeetingFilters,
  type Meeting,
} from '../../contracts/meetings';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { useAccountBoundary } from '../account/useAccountBoundary';
import { displayDate } from '../../contracts/date';
import * as css from './meetup.css';
import { ProductNav } from '../../app/ProductNav';
import { useMeetingCommand } from './useMeetingCommand';
let LoadedEditor: typeof import('./MeetingEditor').MeetingEditor | undefined;
const loadEditor = () =>
  import('./MeetingEditor').then((m) => ({ default: (LoadedEditor = m.MeetingEditor) }));
const LazyEditor = lazy(loadEditor);
export async function prepareEditor() {
  await loadEditor();
}
function MeetingEditor(props: Parameters<typeof import('./MeetingEditor').MeetingEditor>[0]) {
  const Component = LoadedEditor ?? LazyEditor;
  return <Component {...props} />;
}
import { StreamSlot } from '../../app/stream';
import { ViewerGate } from '../account/ViewerGate';
import { useNavigate } from 'react-router';
import { AppLink } from '../../app/navigation';
import { Icon } from '../../app/Icon';

export type MeetingsRoute = {
  section: 'meetings';
  mode: 'list' | 'detail' | 'create' | 'mine';
  id?: string;
  filters: MeetingFilters;
  userId: string | null;
};
const sports = { walking: '걷기', running: '달리기', cycling: '자전거' };
function filterQuery(filters: MeetingFilters) {
  return new URLSearchParams(
    Object.entries(filters)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
function summary(m: Meeting) {
  return m.status === 'cancelled'
    ? '모임 취소'
    : new Date(m.startsAt).getTime() <= Date.now()
      ? '시작됨'
      : m.participantCount >= m.capacity
        ? '정원 마감'
        : '모집 중';
}
function Login({ returnTo }: { returnTo: string }) {
  return (
    <AppLink href={`/account?returnTo=${encodeURIComponent(returnTo)}`}>
      로그인하고 계속하기
    </AppLink>
  );
}
export function MeetingsPage({ route, ready = true }: { route: MeetingsRoute; ready?: boolean }) {
  const returnTo =
    route.mode === 'mine'
      ? '/account/meetups'
      : route.mode === 'create'
        ? `/meetups/new?${filterQuery(route.filters)}`
        : route.id
          ? `/meetups/${route.id}`
          : '/meetups';
  return (
    <>
      <ProductNav />
      <main id="page-content" tabIndex={-1} className={css.page}>
        {!ready ? (
          <div role="status">
            <p>계정을 확인하지 못했거나 확인 중입니다.</p>
            <button onClick={() => window.dispatchEvent(new Event('focus'))}>계정 다시 확인</button>
          </div>
        ) : null}
        {route.mode === 'list' ? (
          <MeetingList route={route} ready={ready} />
        ) : route.mode === 'detail' ? (
          <MeetingDetail route={route} />
        ) : route.mode === 'mine' ? (
          <MyMeetings route={route} ready={ready} />
        ) : (
          <>
            <h1>모임 만들기</h1>
            {route.userId ? (
              <div hidden={!ready}>
                <Suspense fallback={<p role="status">양식을 불러오는 중…</p>}>
                  <MeetingEditor
                    userId={route.userId}
                    placeId={route.filters.placeId}
                    ready={ready}
                  />
                </Suspense>
              </div>
            ) : (
              <Login returnTo={returnTo} />
            )}
          </>
        )}
      </main>
    </>
  );
}
function MeetingList({ route, ready }: { route: MeetingsRoute; ready: boolean }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: meetingListKey(route.filters),
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      meetingRequest(`/api/v1/meetups?${filterQuery(route.filters)}`, meetingListSchema, {
        signal,
      }),
  });
  return (
    <>
      <h1>같이 운동할 모임</h1>
      <p>정원에는 주최자도 포함됩니다.</p>
      <form
        className={css.filters}
        action="/meetups"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(
            '/meetups?' + new URLSearchParams(new FormData(e.currentTarget) as never).toString(),
          );
        }}
      >
        <RegionSelect
          key={route.filters.regionCode ?? ''}
          name="regionCode"
          defaultValue={route.filters.regionCode ?? ''}
        />
        <label>
          종목
          <select name="sport" defaultValue={route.filters.sport ?? ''}>
            <option value="">전체</option>
            {Object.entries(sports).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          날짜 · 한국 시간
          <input type="date" name="date" defaultValue={route.filters.date} />
        </label>
        {route.filters.placeId ? (
          <input type="hidden" name="placeId" value={route.filters.placeId} />
        ) : null}
        <button>조건 적용</button>
      </form>
      <AppLink
        className={css.primary}
        href={`/meetups/new${route.filters.placeId ? `?placeId=${route.filters.placeId}` : ''}`}
      >
        <Icon name="plus" />
        모임 만들기
      </AppLink>
      {query.isError ? (
        <p role="alert">모임 목록 조회에 실패했습니다. 다시 시도해 주세요.</p>
      ) : null}
      {query.data?.meetups.length === 0 ? <p>조건에 맞는 모임이 없습니다.</p> : null}
      <ul>
        {query.data?.meetups.map((m) => (
          <li key={m.id}>
            <AppLink className={css.row} href={`/meetups/${m.id}`} aria-label={m.title}>
              <span className={css.rowIcon}>
                <Icon name="meetings" />
              </span>
              <span className={css.rowContent}>
                <span className={css.category}>
                  {sports[m.sport]} · {summary(m)}
                </span>
                <span className={css.rowTitle}>{m.title}</span>
                <span className={css.metadata}>
                  {m.place.name} · {displayDate(m.startsAt)}
                </span>
                <span className={css.metadata}>
                  {m.participantCount}/{m.capacity}명 · 주최자 포함
                </span>
              </span>
              <Icon name="chevron" />
            </AppLink>
          </li>
        ))}
      </ul>
      <button disabled={!ready || query.isFetching} onClick={() => void query.refetch()}>
        모임 목록 새로고침
      </button>
      <div className={css.actions}>
        {route.filters.page > 0 ? (
          <AppLink
            href={`/meetups?${filterQuery({ ...route.filters, page: route.filters.page - 1 })}`}
          >
            이전 페이지
          </AppLink>
        ) : null}
        {query.data?.nextPage != null ? (
          <AppLink
            href={`/meetups?${filterQuery({ ...route.filters, page: query.data.nextPage })}`}
          >
            다음 페이지
          </AppLink>
        ) : null}
      </div>
    </>
  );
}
function MyMeetings({ route, ready }: { route: MeetingsRoute; ready: boolean }) {
  const query = useQuery({
    queryKey: myMeetingsKey(route.userId, route.filters.page),
    enabled: !!route.userId && ready,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const data = await meetingRequest(
        `/api/v1/me/meetups?page=${route.filters.page}`,
        myMeetingsSchema,
        { signal },
      );
      if (data.userId !== route.userId) {
        window.location.reload();
        throw new Error('계정이 변경되었습니다.');
      }
      return data;
    },
  });
  return (
    <>
      <h1>내 모임</h1>
      {!route.userId ? (
        <Login returnTo="/account/meetups" />
      ) : !ready ? (
        <p role="status">계정을 확인하는 중…</p>
      ) : (
        <>
          {query.isError ? (
            <p role="alert">내 모임을 확인하지 못했습니다. 다시 조회해 주세요.</p>
          ) : (
            <>
              {query.data?.meetups.length === 0 ? (
                <p>아직 주최하거나 참여한 모임이 없습니다.</p>
              ) : null}
              <ul>
                {query.data?.meetups.map((m) => (
                  <li key={m.id}>
                    <AppLink href={`/meetups/${m.id}`}>{m.title}</AppLink>
                    <p>
                      {m.role === 'host'
                        ? '주최'
                        : m.participationStatus === 'cancelled'
                          ? '참여 취소'
                          : '참여 중'}{' '}
                      · {summary(m)} · {displayDate(m.startsAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button disabled={query.isFetching} onClick={() => void query.refetch()}>
            내 모임 새로고침
          </button>
          {route.filters.page > 0 ? (
            <AppLink href={`/account/meetups?page=${route.filters.page - 1}`}>이전 페이지</AppLink>
          ) : null}
          {query.data?.nextPage != null ? (
            <AppLink href={`/account/meetups?page=${query.data.nextPage}`}>다음 페이지</AppLink>
          ) : null}
        </>
      )}
    </>
  );
}
function usePublicMeeting(id: string) {
  return useQuery({
    queryKey: meetingKey(id),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await meetingRequest(`/api/v1/meetups/${id}`, meetingDetailSchema, { signal });
      } catch (e) {
        if (e instanceof MeetingRequestError && e.status === 404) return null;
        throw e;
      }
    },
  });
}
function MeetingDetail({ route }: { route: MeetingsRoute }) {
  const id = route.id!,
    query = usePublicMeeting(id),
    m = query.data?.meetup;
  return (
    <>
      <AppLink href="/meetups">모임 목록으로 돌아가기</AppLink>
      <h1>{m?.title ?? '모임 상세'}</h1>
      {query.data === null ? <p role="alert">모임을 찾을 수 없습니다.</p> : null}
      {!m ? (
        <>
          <p role="status">{query.isFetching ? '모임을 불러오는 중…' : ''}</p>
          <button disabled={query.isFetching} onClick={() => void query.refetch()}>
            모임 다시 조회
          </button>
        </>
      ) : null}
      {query.isError ? (
        <p role="alert">최신 정보를 확인하지 못했습니다. 이전 정보에서는 참여할 수 없습니다.</p>
      ) : null}
      {m ? (
        <>
          <dl>
            <dt>일시 · 한국 시간</dt>
            <dd>
              {displayDate(m.startsAt)} – {displayDate(m.endsAt)}
            </dd>
            <dt>장소</dt>
            <dd>
              <AppLink href={`/places/${m.place.id}`}>{m.place.name}</AppLink>
            </dd>
            <dt>종목</dt>
            <dd>{sports[m.sport]}</dd>
            <dt>모집 상태</dt>
            <dd>
              {summary(m)} · {m.participantCount}/{m.capacity}명
            </dd>
          </dl>
          <p>{m.description || '등록된 설명이 없습니다.'}</p>
          <div className={css.actions}>
            <AppLink href={`/meetups/${m.id}/discussion`}>모임 이야기</AppLink>
          </div>
          <Suspense fallback={<p role="status">참여 상태를 확인하는 중…</p>}>
            <StreamSlot name="viewer">
              {(packet) => (
                <ViewerGate initial={packet && !packet.failed ? packet.userId : undefined}>
                  {(userId) => <MeetingActions route={{ ...route, userId }} m={m} query={query} />}
                </ViewerGate>
              )}
            </StreamSlot>
          </Suspense>
        </>
      ) : null}
    </>
  );
}
function MeetingActions({
  route,
  m,
  query,
}: {
  route: MeetingsRoute;
  m: Meeting;
  query: ReturnType<typeof usePublicMeeting>;
}) {
  const id = route.id!,
    client = useQueryClient(),
    ready = useAccountBoundary(route.userId);
  const [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState<'leave' | 'cancel' | null>(null);
  const member = useQuery({
    queryKey: membershipKey(route.userId, id),
    enabled: !!route.userId && ready,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const data = await meetingRequest(`/api/v1/meetups/${id}/membership`, membershipSchema, {
        signal,
      });
      if (data.userId !== route.userId) {
        window.location.reload();
        throw new Error('계정이 변경되었습니다.');
      }
      return data;
    },
  });
  const refresh = async () => {
    setConfirm(null);
    await Promise.all([query.refetch(), route.userId ? member.refetch() : Promise.resolve()]);
  };
  const command = useMeetingCommand(route.userId, 'membership:' + id, ready, async () => {
    await client.invalidateQueries({ queryKey: ['private', route.userId, 'meetings'] });
    await client.invalidateQueries({ queryKey: ['meetings', 'list'] });
    await refresh();
  });
  const active = m && summary(m) === '모집 중';
  const mutable = m && m.status === 'open' && new Date(m.startsAt).getTime() > Date.now();
  const safe =
    ready &&
    !query.isError &&
    !query.isFetching &&
    !member.isError &&
    !member.isFetching &&
    member.data?.version === m?.version &&
    !command.pending &&
    !command.unknown;
  const action = (name: string) => {
    if (m)
      void command.run(`/api/v1/meetups/${id}`, 'PATCH', {
        action: name,
        expectedVersion: m.version,
      });
  };
  return (
    <>
      {route.userId ? (
        <Suspense fallback={<p role="status">현장 확인 화면을 준비하는 중…</p>}>
          <AttendancePanel id={id} userId={route.userId} ready={ready} />
        </Suspense>
      ) : null}
      {!route.userId ? (
        <Login returnTo={`/meetups/${id}`} />
      ) : ready ? (
        <>
          {member.isError ? (
            <p role="alert">참여 상태를 확인하지 못했습니다. 현재 상태를 다시 조회해 주세요.</p>
          ) : null}
          {member.data?.role === 'host' ? (
            <>
              <p>내가 주최한 모임입니다.</p>
              {mutable ? (
                <div className={css.actions}>
                  <button disabled={!safe} onClick={() => setEditing(!editing)}>
                    모임 수정
                  </button>
                  <button disabled={!safe} onClick={() => setConfirm('cancel')}>
                    모임 취소
                  </button>
                </div>
              ) : null}
            </>
          ) : member.data?.role === 'participant' ? (
            <>
              <p>참여 중입니다.</p>
              {mutable ? (
                <button disabled={!safe} onClick={() => setConfirm('leave')}>
                  참여 취소
                </button>
              ) : null}
            </>
          ) : active ? (
            <button className={css.primary} disabled={!safe} onClick={() => action('join')}>
              참여하기
            </button>
          ) : null}
          {confirm ? (
            <div role="group" aria-label="취소 확인">
              <p>
                {confirm === 'cancel'
                  ? '모임을 취소하면 모든 참여자에게 취소 상태로 표시됩니다.'
                  : '참여를 취소하시겠습니까?'}
              </p>
              <button disabled={!safe} onClick={() => action(confirm)}>
                취소 확정
              </button>
              <button onClick={() => setConfirm(null)}>유지하기</button>
            </div>
          ) : null}
          {editing && member.data?.role === 'host' ? (
            <Suspense fallback={<p role="status">양식을 불러오는 중…</p>}>
              <MeetingEditor
                userId={route.userId}
                initial={m}
                ready={safe}
                onSaved={async () => {
                  setEditing(false);
                  await refresh();
                }}
              />
            </Suspense>
          ) : null}
        </>
      ) : (
        <p role="status">계정을 확인하는 중…</p>
      )}
      {command.feedback}
      <button
        disabled={!ready || query.isFetching || command.pending}
        onClick={() => void refresh()}
      >
        현재 상태 다시 조회
      </button>
    </>
  );
}
