import { DiscussionReturn } from './DiscussionReturn';
import { useCommunityCommand } from './useCommunityCommand';
import { Comments } from './Comments';
import { Activity, Blocks } from './Activity';
import { Confirm, Moderation } from './Moderation';
import { useState, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  communityKey,
  communityFiltersSchema,
  postListSchema,
  postSchema,
  type Post,
} from '../../contracts/community';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { ViewerGate, AccountBoundary } from '../account/ViewerGate';
import { ProductNav } from '../../app/ProductNav';
import { Icon } from '../../app/Icon';
import { RegionSelect } from '../places/RegionSelect';
import * as styles from '../meetup/meetup.css';
export type CommunityRoute = {
  section: 'community';
  mode: 'list' | 'mine' | 'create' | 'detail' | 'discussion' | 'activity';
  id?: string;
  userId: string | null;
};
const PostEditor = lazy(() => import('./PostEditor').then((m) => ({ default: m.PostEditor })));
const sports = { walking: '걷기', running: '달리기', cycling: '자전거' };
export function CommunityPage({
  route,
  initial,
}: {
  route: CommunityRoute;
  initial?: string | null;
}) {
  return (
    <ViewerGate initial={initial}>
      {(userId) => (
        <AccountBoundary userId={userId}>
          {(ready) => (
            <CommunityContent key={userId ?? 'guest'} route={{ ...route, userId }} ready={ready} />
          )}
        </AccountBoundary>
      )}
    </ViewerGate>
  );
}
function CommunityContent({ route, ready }: { route: CommunityRoute; ready: boolean }) {
  const { mode, id, userId } = route,
    loc = useLocation(),
    nav = useNavigate();
  const embedded =
    mode === 'discussion' && new URLSearchParams(loc.search).get('surface') === 'native';
  const [editing, setEditing] = useState<Post | null>(null);
  const command = useCommunityCommand(route, ready, () => setEditing(null));
  const { pending, unknown: uncertain, notice, receipt, run: mutate } = command;
  const parsed = communityFiltersSchema.safeParse(
    Object.fromEntries([...new URLSearchParams(loc.search)].filter(([, v]) => v !== '')),
  );
  const f = parsed.success
    ? { ...parsed.data, ...(mode === 'mine' ? { mine: '1' as const } : {}) }
    : { page: 0 };
  const list = useQuery({
    queryKey: communityKey(userId, 'list', f),
    queryFn: ({ signal }) =>
      meetingRequest(
        '/api/v1/posts?' + new URLSearchParams(Object.entries(f).map(([k, v]) => [k, String(v)])),
        postListSchema,
        { signal, headers: { 'X-Cmon-User': userId ?? 'guest' } },
      ),
    enabled: ready && (mode === 'list' || (mode === 'mine' && !!userId)) && parsed.success,
    staleTime: 30000,
    retry: false,
  });
  const detail = useQuery({
    queryKey: communityKey(userId, 'post', id),
    queryFn: ({ signal }) =>
      meetingRequest('/api/v1/posts/' + id, postSchema, {
        signal,
        headers: { 'X-Cmon-User': userId ?? 'guest' },
      }),
    enabled: ready && mode === 'detail',
    staleTime: 30000,
    retry: false,
  });
  const error = detail.error || list.error,
    missing = error instanceof MeetingRequestError && error.status === 404;
  const canWrite =
    !!userId && ready && !pending && !uncertain && !detail.isError && !detail.isFetching;
  return (
    <>
      {!embedded ? <ProductNav /> : null}
      <main
        id="page-content"
        tabIndex={-1}
        className={[styles.page, embedded ? styles.embeddedPage : ''].join(' ')}
      >
        {!parsed.success ? <p role="alert">조회 조건을 확인해 주세요.</p> : null}
        {!ready ? (
          <p role="status">
            계정을 확인하는 중입니다.{' '}
            <button onClick={() => window.dispatchEvent(new Event('focus'))}>계정 다시 확인</button>
          </p>
        ) : null}
        <div hidden={!ready}>
          <h1>
            {mode === 'activity'
              ? '내 활동'
              : mode === 'create'
                ? '게시글 작성'
                : mode === 'mine'
                  ? '내 글'
                  : mode === 'discussion'
                    ? '모임 이야기'
                    : mode === 'detail'
                      ? missing
                        ? '게시글을 찾을 수 없습니다.'
                        : (detail.data?.title ?? '게시글')
                      : '동네 운동 이야기'}
          </h1>
          {notice ? <p role="status">{notice}</p> : null}
          {uncertain && !pending ? (
            <div role="alert">
              <button disabled={pending} onClick={() => void command.inspect()}>
                저장 결과 확인
              </button>
              <button disabled={pending} onClick={() => void command.retry()}>
                같은 요청 다시 보내기
              </button>
            </div>
          ) : null}
          {!userId && embedded ? (
            <p>앱에서 다시 로그인한 뒤 모임 이야기를 열어 주세요.</p>
          ) : !userId ? (
            <p>
              <Link to={'/account?returnTo=' + encodeURIComponent(loc.pathname + loc.search)}>
                로그인하고 작성하기
              </Link>
            </p>
          ) : null}
          {error ? (
            <p role="alert">
              {missing ? '삭제되었거나 볼 수 없는 글입니다.' : '불러오지 못했습니다.'}
              <button
                onClick={() => {
                  if (mode === 'detail') void detail.refetch();
                  else void list.refetch();
                }}
              >
                다시 조회
              </button>
            </p>
          ) : null}
          {mode === 'list' || mode === 'mine' ? (
            <>
              <p className={styles.lead}>동네의 운동 질문과 후기를 나누세요.</p>
              <nav className={styles.actions}>
                <Link className={styles.primary} to="/community/new">
                  <Icon name="plus" />글 쓰기
                </Link>
              </nav>
              <form
                className={styles.compactFilters}
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  const next = new URLSearchParams();
                  for (const key of ['regionCode', 'sport']) {
                    const value = String(d.get(key) ?? '');
                    if (value) next.set(key, value);
                  }
                  nav(loc.pathname + (next.size ? '?' + next : ''));
                }}
              >
                <RegionSelect name="regionCode" defaultValue={f.regionCode ?? ''} />
                <label>
                  종목
                  <select name="sport" defaultValue={f.sport ?? ''}>
                    <option value="">전체</option>
                    {Object.entries(sports).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <button>조회</button>
              </form>
              {list.data?.posts.length === 0 ? <p>아직 게시글이 없습니다.</p> : null}
              <ul>
                {list.data?.posts.map((p) => (
                  <li key={p.id}>
                    <Link className={styles.row} to={'/community/' + p.id} aria-label={p.title}>
                      <span className={styles.rowContent}>
                        <span className={styles.category}>{sports[p.sport]}</span>
                        <span className={styles.rowTitle}>{p.title}</span>
                        <span className={styles.excerpt}>{p.body}</span>
                        <span className={styles.metadata}>{p.authorName}</span>
                      </span>
                      <Icon name="chevron" />
                    </Link>
                  </li>
                ))}
              </ul>
              {f.page > 0 || f.cursor ? (
                <Link
                  to={
                    loc.pathname +
                    '?' +
                    new URLSearchParams({
                      regionCode: f.regionCode ?? '',
                      sport: f.sport ?? '',
                    })
                  }
                >
                  첫 페이지
                </Link>
              ) : null}
              {list.data?.nextPage != null ? (
                <Link
                  to={
                    loc.pathname +
                    '?' +
                    new URLSearchParams({ ...f, page: '0', cursor: list.data.nextCursor! })
                  }
                >
                  다음 페이지
                </Link>
              ) : null}
            </>
          ) : null}
          {mode === 'activity' && userId ? (
            <Activity userId={userId} ready={ready} mutate={mutate} disabled={!canWrite} />
          ) : null}
          {mode === 'create' && userId ? (
            <Suspense fallback={<p role="status">작성 양식을 불러오는 중…</p>}>
              <PostEditor
                userId={userId!}
                disabled={!canWrite}
                submit={(input) => mutate({ action: 'create', input })}
              />
            </Suspense>
          ) : null}
          {mode === 'detail' && detail.data && !missing ? (
            <>
              <p>
                {detail.data.authorName} · {sports[detail.data.sport]}
              </p>
              {editing ? (
                <Suspense fallback={<p role="status">작성 양식을 불러오는 중…</p>}>
                  <PostEditor
                    userId={userId!}
                    post={editing}
                    disabled={!canWrite}
                    submit={(input, version) =>
                      mutate({
                        action: 'edit',
                        id: id!,
                        expectedVersion: version ?? editing.version,
                        input,
                      })
                    }
                  />
                </Suspense>
              ) : (
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {detail.data.body}
                </p>
              )}
              {detail.data.placeId ? (
                <Link to={'/places/' + detail.data.placeId}>관련 시설</Link>
              ) : null}{' '}
              {detail.data.meetupId ? (
                <Link to={'/meetups/' + detail.data.meetupId}>관련 모임</Link>
              ) : null}
              {userId === detail.data.authorId ? (
                <div className={styles.actions}>
                  <button
                    disabled={!canWrite}
                    onClick={() => setEditing(editing ? null : detail.data!)}
                  >
                    {editing ? '수정 닫기' : '글 수정'}
                  </button>
                  <Confirm
                    label="글 삭제"
                    disabled={!canWrite}
                    run={() =>
                      mutate({ action: 'delete', id: id!, expectedVersion: detail.data!.version })
                    }
                  />
                </div>
              ) : userId ? (
                <Moderation
                  disabled={!canWrite}
                  authorId={detail.data.authorId}
                  target="post"
                  id={id!}
                  mutate={mutate}
                />
              ) : null}
            </>
          ) : null}
          {mode === 'discussion' || (mode === 'detail' && detail.data && !missing) ? (
            <Comments
              receipt={receipt}
              parent={mode === 'detail' ? 'post' : 'meetup'}
              id={id!}
              userId={userId}
              ready={ready}
              disabled={!canWrite}
              mutate={mutate}
            />
          ) : null}
          {mode === 'discussion' ? <DiscussionReturn id={id!} /> : null}
          {mode === 'mine' && userId ? (
            <Blocks userId={userId} disabled={!canWrite} mutate={mutate} />
          ) : null}
        </div>
      </main>
    </>
  );
}
