import { myMeetingsSchema, myMeetingsKey } from '../../contracts/meetings';
import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  communityKey,
  profileSchema,
  communityFiltersSchema,
  postListSchema,
  postSchema,
  commentListSchema,
  communityResultSchema,
  type Post,
  type CommunityCommand,
} from '../../contracts/community';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { ViewerGate, AccountBoundary } from '../account/ViewerGate';
import { form } from '../account/account.css';
import { ProductNav } from '../../app/ProductNav';
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
    nav = useNavigate(),
    client = useQueryClient();
  const [editing, setEditing] = useState<Post | null>(null),
    [pending, setPending] = useState(false),
    [hydrated, setHydrated] = useState(false),
    [notice, setNotice] = useState(''),
    [receipt, setReceipt] = useState<{ key: string; body: string } | null>(null),
    [uncertain, setUncertain] = useState<{ key: string; input: CommunityCommand } | null>(null);
  const alive = useRef(true),
    active = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    setHydrated(true);
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, []);
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
  async function mutate(
    input: CommunityCommand,
    key: string = crypto.randomUUID(),
  ): Promise<boolean> {
    if (!userId || !ready || pending) return false;
    setPending(true);
    setNotice('');
    active.current = new AbortController();
    try {
      const result = await meetingRequest('/api/v1/community/commands', communityResultSchema, {
        method: 'POST',
        signal: active.current.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Cmon-User': userId,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(input),
      });
      if (!alive.current) return false;
      await completed(input, key, result.id);
      return true;
    } catch (e) {
      if (!alive.current) return false;
      if (!(e instanceof MeetingRequestError) || e.status >= 500) {
        setUncertain({ key, input });
        setNotice('응답을 확인하지 못했습니다. 저장 결과를 먼저 확인해 주세요.');
      } else setNotice(e.message);
      return false;
    } finally {
      if (alive.current) setPending(false);
    }
  }
  async function completed(input: CommunityCommand, key: string, resultId: string | null) {
    setUncertain(null);
    const affected: (readonly unknown[])[] = [];
    if (input.action === 'create' || input.action === 'edit' || input.action === 'delete') {
      affected.push(communityKey(userId, 'list'));
      if (input.action !== 'create') affected.push(communityKey(userId, 'post', input.id));
    } else if (input.action === 'comment') {
      affected.push(communityKey(userId, 'comments', input.parent, input.id));
    } else if (input.action === 'deleteComment') {
      affected.push(communityKey(userId, 'comments', mode === 'detail' ? 'post' : 'meetup', id));
    } else if (input.action === 'block' || input.action === 'profile') {
      // Visibility and author names affect cached public content for this viewer.
      for (const part of ['list', 'post', 'comments']) affected.push(communityKey(userId, part));
      affected.push(communityKey(userId, input.action === 'block' ? 'blocks' : 'profile'));
    }
    await Promise.all(affected.map((queryKey) => client.invalidateQueries({ queryKey })));
    if (!alive.current) return;
    setNotice(
      input.action === 'report' ? '신고를 접수했습니다. 운영 처리 전입니다.' : '저장했습니다.',
    );
    if (input.action === 'comment') setReceipt({ key, body: input.body });
    if (input.action === 'create') nav('/community/' + resultId);
    if (input.action === 'delete' || (input.action === 'block' && input.blocked)) nav('/community');
    if (input.action === 'edit') setEditing(null);
    if (input.action === 'profile')
      await client.invalidateQueries({ queryKey: ['private', userId, 'account'] });
  }
  async function reconcile() {
    if (!uncertain) return;
    setPending(true);
    try {
      const r = await meetingRequest(
        '/api/v1/me/community-commands/' + uncertain.key,
        communityResultSchema,
        { headers: { 'X-Cmon-User': userId! } },
      );
      if (!alive.current) return;
      if (r.id) {
        if (!alive.current) return;
        await completed(uncertain.input, uncertain.key, r.id);
      } else
        setNotice(
          '아직 저장 결과가 없습니다. 같은 요청 다시 보내기를 선택할 수 있습니다. 늦게 도착한 요청일 수 있습니다.',
        );
    } catch {
      if (alive.current) setNotice('결과 조회에 실패했습니다. 다시 확인해 주세요.');
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const error = detail.error || list.error,
    missing = error instanceof MeetingRequestError && error.status === 404;
  const canWrite =
    !!userId &&
    ready &&
    hydrated &&
    !pending &&
    !uncertain &&
    !detail.isError &&
    !detail.isFetching;
  return (
    <main className={styles.page}>
      <ProductNav />
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
        {uncertain ? (
          <div role="alert">
            <button disabled={pending} onClick={() => void reconcile()}>
              저장 결과 확인
            </button>
            <button disabled={pending} onClick={() => void mutate(uncertain.input, uncertain.key)}>
              같은 요청 다시 보내기
            </button>
          </div>
        ) : null}
        {!userId ? (
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
            <nav className={styles.actions}>
              <Link to="/community/new">글 쓰기</Link>
            </nav>
            <form
              className={form}
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                nav(
                  loc.pathname + '?' + new URLSearchParams({ sport: String(d.get('sport') ?? '') }),
                );
              }}
            >
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
            <p>무안군 · 질문과 후기를 나누세요.</p>
            {list.data?.posts.length === 0 ? <p>아직 게시글이 없습니다.</p> : null}
            <ul>
              {list.data?.posts.map((p) => (
                <li key={p.id}>
                  <Link to={'/community/' + p.id}>{p.title}</Link> · {p.authorName} ·{' '}
                  {sports[p.sport]}
                </li>
              ))}
            </ul>
            {f.page > 0 || f.cursor ? (
              <Link to={loc.pathname + '?' + new URLSearchParams({ sport: f.sport ?? '' })}>
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
                  post={editing}
                  disabled={!canWrite}
                  submit={(input) =>
                    mutate({ action: 'edit', id: id!, expectedVersion: editing.version, input })
                  }
                />
              </Suspense>
            ) : (
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.data.body}</p>
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
        {mode === 'discussion' ? <Link to={'/meetups/' + id}>모임으로 돌아가기</Link> : null}
        {mode === 'mine' && userId ? (
          <Blocks userId={userId} disabled={!canWrite} mutate={mutate} />
        ) : null}
      </div>
    </main>
  );
}
function Confirm({
  label,
  disabled,
  run,
}: {
  label: string;
  disabled: boolean;
  run: () => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span>
      {label}하시겠습니까?{' '}
      <button
        disabled={disabled}
        onClick={() =>
          void run().then((ok) => {
            if (ok) setConfirm(false);
          })
        }
      >
        {label} 확정
      </button>
      <button onClick={() => setConfirm(false)}>닫기</button>
    </span>
  ) : (
    <button disabled={disabled} onClick={() => setConfirm(true)}>
      {label}
    </button>
  );
}
function Moderation({
  target,
  id,
  authorId,
  disabled,
  mutate,
}: {
  target: 'post' | 'comment';
  id: string;
  authorId: string | null;
  disabled: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  return (
    <details>
      <summary>신고·차단</summary>
      <label>
        신고 사유
        <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button
        disabled={disabled || !reason.trim()}
        onClick={() => void mutate({ action: 'report', target, id, reason })}
      >
        신고 접수
      </button>
      {authorId ? (
        <Confirm
          label="작성자 차단"
          disabled={disabled}
          run={() => mutate({ action: 'block', id: authorId, blocked: true })}
        />
      ) : null}
    </details>
  );
}
function Comments({
  receipt,
  parent,
  id,
  userId,
  ready,
  disabled,
  mutate,
}: {
  receipt: { key: string; body: string } | null;
  parent: 'post' | 'meetup';
  id: string;
  userId: string | null;
  ready: boolean;
  disabled: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
}) {
  const [body, setBody] = useState(''),
    [page, setPage] = useState(0),
    [cursor, setCursor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (receipt) setBody((current) => (current === receipt.body ? '' : current));
  }, [receipt]);
  const q = useQuery({
    queryKey: communityKey(userId, 'comments', parent, id, cursor ?? page),
    queryFn: ({ signal }) =>
      meetingRequest(
        `/api/v1/${parent === 'post' ? 'posts' : 'meetups'}/${id}/comments?page=${page}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
        commentListSchema,
        { signal, headers: { 'X-Cmon-User': userId ?? 'guest' } },
      ),
    enabled: ready,
    staleTime: 30000,
    retry: false,
  });
  return (
    <section>
      <h2>댓글</h2>
      {q.error ? (
        <p role="alert">
          댓글을 불러오지 못했습니다.
          <button onClick={() => void q.refetch()}>댓글 다시 조회</button>
        </p>
      ) : (
        <ul>
          {q.data?.comments.map((c) => (
            <li key={c.id}>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {c.authorName}: {c.body}
              </p>
              {userId === c.authorId ? (
                <Confirm
                  label="댓글 삭제"
                  disabled={disabled}
                  run={() =>
                    mutate({ action: 'deleteComment', id: c.id, expectedVersion: c.version })
                  }
                />
              ) : userId ? (
                <Moderation
                  target="comment"
                  id={c.id}
                  authorId={c.authorId}
                  disabled={disabled}
                  mutate={mutate}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page > 0 ? (
        <button
          onClick={() => {
            setPage(0);
            setCursor(undefined);
          }}
        >
          이전 댓글
        </button>
      ) : null}
      {q.data?.nextPage != null ? (
        <button
          onClick={() => {
            setPage(q.data!.nextPage!);
            setCursor(q.data!.nextCursor!);
          }}
        >
          다음 댓글
        </button>
      ) : null}
      {userId ? (
        <form
          className={form}
          onSubmit={(e) => {
            e.preventDefault();
            void mutate({ action: 'comment', parent, id, body }).then((ok) => {
              if (ok) setBody('');
            });
          }}
        >
          <label>
            댓글 내용
            <textarea
              disabled={disabled}
              required
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button disabled={disabled || !body.trim()}>댓글 등록</button>
        </form>
      ) : null}
    </section>
  );
}
function Blocks({
  userId,
  disabled,
  mutate,
}: {
  userId: string;
  disabled: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
}) {
  const q = useQuery({
    queryKey: communityKey(userId, 'blocks'),
    queryFn: ({ signal }) =>
      meetingRequest(
        '/api/v1/me/blocks',
        z.object({ users: z.array(z.object({ id: z.string(), name: z.string() })) }),
        { signal, headers: { 'X-Cmon-User': userId ?? 'guest' } },
      ),
    retry: false,
    enabled: !disabled,
    staleTime: 30000,
  });
  return (
    <section>
      <h2>차단한 사용자</h2>
      {q.isPending ? <p role="status">차단 목록을 불러오는 중…</p> : null}
      {q.error ? (
        <p role="alert">
          차단 목록을 불러오지 못했습니다.
          <button disabled={disabled} onClick={() => void q.refetch()}>
            차단 목록 다시 조회
          </button>
        </p>
      ) : null}
      {q.data?.users.length === 0 ? <p>차단한 사용자가 없습니다.</p> : null}
      {q.data?.users.map((u) => (
        <p key={u.id}>
          {u.name}{' '}
          <button
            disabled={disabled}
            onClick={() => void mutate({ action: 'block', id: u.id, blocked: false })}
          >
            차단 해제
          </button>
        </p>
      ))}
    </section>
  );
}

function Activity({
  userId,
  ready,
  mutate,
  disabled,
}: {
  userId: string;
  ready: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
  disabled: boolean;
}) {
  const profile = useQuery({
    queryKey: communityKey(userId, 'profile'),
    queryFn: ({ signal }) =>
      meetingRequest('/api/v1/me/profile', profileSchema, {
        signal,
        headers: { 'X-Cmon-User': userId ?? 'guest' },
      }),
    enabled: ready,
    staleTime: 30000,
    retry: false,
  });
  const meetings = useQuery({
    queryKey: myMeetingsKey(userId),
    queryFn: async ({ signal }) => {
      const data = await meetingRequest('/api/v1/me/meetups', myMeetingsSchema, { signal });
      if (data.userId !== userId)
        throw new MeetingRequestError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다.');
      return data;
    },
    enabled: ready,
    staleTime: 30000,
    retry: false,
  });
  const posts = useQuery({
    queryKey: communityKey(userId, 'list', { page: 0, mine: '1' }),
    queryFn: ({ signal }) =>
      meetingRequest('/api/v1/posts?mine=1', postListSchema, {
        signal,
        headers: { 'X-Cmon-User': userId ?? 'guest' },
      }),
    enabled: ready,
    staleTime: 30000,
    retry: false,
  });
  return (
    <>
      <nav className={styles.actions}>
        <Link to="/account/meetups">모임 전체 기록</Link>
        <Link to="/account/posts">내 글 전체</Link>
        <Link to="/account">로그인·복구·탈퇴</Link>
      </nav>
      <section>
        <h2>내 일정</h2>
        {meetings.error ? (
          <p role="alert">
            내 모임을 불러오지 못했습니다.
            <button onClick={() => void meetings.refetch()}>내 일정 다시 조회</button>
          </p>
        ) : null}
        <ul>
          {meetings.data?.meetups.map((m) => (
            <li key={m.id}>
              <Link to={'/meetups/' + m.id}>{m.title}</Link> · {m.role === 'host' ? '주최' : '참여'}{' '}
              ·{' '}
              {m.status === 'cancelled'
                ? '모임 취소'
                : m.participationStatus === 'cancelled'
                  ? '참여 취소'
                  : new Date(m.endsAt).getTime() < Date.now()
                    ? '지난 모임'
                    : '예정'}
            </li>
          ))}
        </ul>
        {meetings.data?.meetups.length === 0 ? <p>참여한 모임이 없습니다.</p> : null}
      </section>
      <section>
        <h2>내 게시글</h2>
        {posts.error ? (
          <p role="alert">
            내 글을 불러오지 못했습니다.
            <button onClick={() => void posts.refetch()}>내 게시글 다시 조회</button>
          </p>
        ) : null}
        <ul>
          {posts.data?.posts.map((p) => (
            <li key={p.id}>
              <Link to={'/community/' + p.id}>{p.title}</Link>
            </li>
          ))}
        </ul>
        {posts.data?.posts.length === 0 ? <p>작성한 글이 없습니다.</p> : null}
      </section>
      <section>
        <h2>닉네임·동네</h2>
        {profile.error ? (
          <p role="alert">
            프로필을 불러오지 못했습니다.
            <button onClick={() => void profile.refetch()}>프로필 다시 조회</button>
          </p>
        ) : profile.data ? (
          <ProfileEditor
            key={profile.data.version}
            profile={profile.data}
            disabled={disabled || profile.isFetching}
            mutate={mutate}
          />
        ) : (
          <p>프로필을 불러오는 중…</p>
        )}
      </section>
      <Blocks userId={userId} disabled={disabled} mutate={mutate} />
    </>
  );
}
function ProfileEditor({
  profile,
  disabled,
  mutate,
}: {
  profile: z.infer<typeof profileSchema>;
  disabled: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
}) {
  const [name, setName] = useState(profile.name),
    [region, setRegion] = useState(profile.regionCode ?? '');
  return (
    <form
      className={form}
      onSubmit={(e) => {
        e.preventDefault();
        void mutate({
          action: 'profile',
          name,
          regionCode: region === '46840' ? '46840' : null,
          expectedVersion: profile.version,
        });
      }}
    >
      <label>
        닉네임
        <input
          disabled={disabled}
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        선택 동네
        <select disabled={disabled} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">선택하지 않음</option>
          <option value="46840">무안군</option>
        </select>
      </label>
      <p>현재 시설·모임 제공 지역은 무안군입니다. 동네 선택은 거주 인증이 아닙니다.</p>
      <button disabled={disabled}>프로필 저장</button>
    </form>
  );
}
