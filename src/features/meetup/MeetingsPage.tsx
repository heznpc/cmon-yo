import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  meetingDetailSchema,
  meetingListSchema,
  meetingInputSchema,
  membershipSchema,
  myMeetingsSchema,
  meetingKey,
  meetingListKey,
  membershipKey,
  myMeetingsKey,
  type MeetingFilters,
  type Meeting,
  type MeetingInput,
} from '../../contracts/meetings';
import { idSchema } from '../../contracts/meetup';
import { publicAPI } from '../../api/public';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { useAccountBoundary } from '../account/useAccountBoundary';
import { displayDate } from './MeetupPage';
import * as css from './meetup.css';
import { form } from '../account/account.css';

export type MeetingsRoute = {
  section: 'meetings';
  mode: 'list' | 'detail' | 'create' | 'mine';
  id?: string;
  filters: MeetingFilters;
  userId: string | null;
};
export function ProductNav() {
  return (
    <nav aria-label="주 메뉴" className={css.actions}>
      <a href="/places">둘러보기</a>
      <a href="/meetups">모임</a>
      <a href="/account/meetups">내 모임</a>
      <a href="/account">내 계정</a>
    </nav>
  );
}
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
  return <a href={`/account?returnTo=${encodeURIComponent(returnTo)}`}>로그인하고 계속하기</a>;
}
export function MeetingsPage({ route }: { route: MeetingsRoute }) {
  const ready = useAccountBoundary(route.userId);
  const returnTo =
    route.mode === 'mine'
      ? '/account/meetups'
      : route.mode === 'create'
        ? `/meetups/new?${filterQuery(route.filters)}`
        : route.id
          ? `/meetups/${route.id}`
          : '/meetups';
  return (
    <main className={css.page}>
      <ProductNav />
      {!ready ? (
        <div role="status">
          <p>계정을 확인하지 못했거나 확인 중입니다.</p>
          <button onClick={() => window.dispatchEvent(new Event('focus'))}>계정 다시 확인</button>
        </div>
      ) : null}
      {route.mode === 'list' ? (
        <MeetingList route={route} ready={ready} />
      ) : route.mode === 'detail' ? (
        <MeetingDetail route={route} ready={ready} />
      ) : route.mode === 'mine' ? (
        <MyMeetings route={route} ready={ready} />
      ) : (
        <>
          <h1>모임 만들기</h1>
          {route.userId ? (
            <div hidden={!ready}>
              <MeetingEditor userId={route.userId} placeId={route.filters.placeId} ready={ready} />
            </div>
          ) : (
            <Login returnTo={returnTo} />
          )}
        </>
      )}
    </main>
  );
}
function MeetingList({ route, ready }: { route: MeetingsRoute; ready: boolean }) {
  const query = useQuery({
    queryKey: meetingListKey(route.filters),
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      meetingRequest(`/api/v1/meetups?${filterQuery(route.filters)}`, meetingListSchema, {
        signal,
      }),
  });
  useEffect(() => {
    const y = sessionStorage.getItem(`meetings-scroll:${window.location.search}`);
    if (y) window.scrollTo(0, Number(y));
  }, []);
  return (
    <>
      <h1>같이 운동할 모임</h1>
      <p>현재 수집 지역은 무안군입니다. 정원에는 주최자도 포함됩니다.</p>
      <form className={form} action="/meetups">
        <label>
          동네
          <select name="regionCode" defaultValue={route.filters.regionCode}>
            <option value="46840">무안군</option>
          </select>
        </label>
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
      <a href={`/meetups/new${route.filters.placeId ? `?placeId=${route.filters.placeId}` : ''}`}>
        모임 만들기
      </a>
      {query.isError ? (
        <p role="alert">모임 목록 조회에 실패했습니다. 다시 시도해 주세요.</p>
      ) : null}
      {query.data?.meetups.length === 0 ? <p>조건에 맞는 모임이 없습니다.</p> : null}
      <ul>
        {query.data?.meetups.map((m) => (
          <li key={m.id}>
            <a
              href={`/meetups/${m.id}`}
              onClick={() => {
                sessionStorage.setItem(
                  `meetings-scroll:${window.location.search}`,
                  String(window.scrollY),
                );
              }}
            >
              {m.title}
            </a>
            <p>
              {m.place.name} · {sports[m.sport]} · {displayDate(m.startsAt)} · {summary(m)} ·{' '}
              {m.participantCount}/{m.capacity}명
            </p>
          </li>
        ))}
      </ul>
      <button disabled={!ready || query.isFetching} onClick={() => void query.refetch()}>
        모임 목록 새로고침
      </button>
      <div className={css.actions}>
        {route.filters.page > 0 ? (
          <a href={`/meetups?${filterQuery({ ...route.filters, page: route.filters.page - 1 })}`}>
            이전 페이지
          </a>
        ) : null}
        {query.data?.nextPage != null ? (
          <a href={`/meetups?${filterQuery({ ...route.filters, page: query.data.nextPage })}`}>
            다음 페이지
          </a>
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
                    <a href={`/meetups/${m.id}`}>{m.title}</a>
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
            <a href={`/account/meetups?page=${route.filters.page - 1}`}>이전 페이지</a>
          ) : null}
          {query.data?.nextPage != null ? (
            <a href={`/account/meetups?page=${query.data.nextPage}`}>다음 페이지</a>
          ) : null}
        </>
      )}
    </>
  );
}
function useMeetingCommand(userId: string | null, onSuccess: (id: string) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState<{
    key: string;
    path: string;
    method: string;
    body: object;
  } | null>(null);
  const alive = useRef(true);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function send(command: NonNullable<typeof unknown>) {
    if (pending || !userId) return;
    setPending(true);
    setError('');
    try {
      const result = await meetingRequest(command.path, z.object({ id: idSchema }), {
        method: command.method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.key,
          'X-Cmon-User': userId,
        },
        body: JSON.stringify(command.body),
      });
      if (!alive.current) return;
      setUnknown(null);
      await onSuccess(result.id);
    } catch (e) {
      if (!alive.current) return;
      const uncertain = !(e instanceof MeetingRequestError) || e.status >= 500;
      setUnknown(uncertain ? command : null);
      setError(
        uncertain
          ? '응답을 확인하지 못했습니다. 처리되었을 수 있으니 현재 상태를 확인해 주세요.'
          : e.message,
      );
    } finally {
      if (alive.current) setPending(false);
    }
  }
  async function inspect() {
    if (!unknown || pending) return;
    setPending(true);
    try {
      const result = await meetingRequest(
        `/api/v1/me/commands/${unknown.key}`,
        z.object({ id: idSchema.nullable() }),
      );
      if (!alive.current) return;
      if (result.id) {
        setUnknown(null);
        setError('');
        await onSuccess(result.id);
      } else
        setError('아직 처리 결과가 없습니다. 같은 요청을 다시 보내거나 내 모임에서 확인해 주세요.');
    } catch {
      if (alive.current) setError('현재 상태 조회에도 실패했습니다. 연결 후 다시 확인해 주세요.');
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return {
    pending,
    unknown,
    error,
    setError,
    run: (path: string, method: string, body: object) =>
      send({ path, method, body, key: crypto.randomUUID() }),
    feedback: (
      <>
        <p role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
        <p role="status">{pending ? '처리 중…' : ''}</p>
        {unknown ? (
          <div className={css.actions}>
            <button disabled={pending} onClick={() => void inspect()}>
              요청 처리 상태 확인
            </button>
            <button disabled={pending} onClick={() => void send(unknown)}>
              같은 요청 다시 보내기
            </button>
            <a href="/account/meetups">내 모임에서 확인</a>
          </div>
        ) : null}
      </>
    ),
  };
}
function MeetingDetail({ route, ready }: { route: MeetingsRoute; ready: boolean }) {
  const id = route.id!;
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'cancel' | null>(null);
  const query = useQuery({
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
  const command = useMeetingCommand(route.userId, async () => {
    await client.invalidateQueries({ queryKey: ['private', route.userId, 'meetings'] });
    await client.invalidateQueries({ queryKey: ['meetings', 'list'] });
    await refresh();
  });
  const m = query.data?.meetup;
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
      <a
        href="/meetups"
        onClick={(e) => {
          if (document.referrer.startsWith(window.location.origin + '/meetups?')) {
            e.preventDefault();
            history.back();
          }
        }}
      >
        모임 목록으로 돌아가기
      </a>
      <h1>{m?.title ?? '모임 상세'}</h1>
      {query.data === null ? <p role="alert">모임을 찾을 수 없습니다.</p> : null}
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
              <a href={`/places/${m.place.id}`}>{m.place.name}</a>
            </dd>
            <dt>종목</dt>
            <dd>{sports[m.sport]}</dd>
            <dt>모집 상태</dt>
            <dd>
              {summary(m)} · {m.participantCount}/{m.capacity}명
            </dd>
          </dl>
          <p>{m.description || '등록된 설명이 없습니다.'}</p>
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
                <button disabled={!safe} onClick={() => action('join')}>
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
                <MeetingEditor
                  userId={route.userId}
                  initial={m}
                  ready={safe}
                  onSaved={async () => {
                    setEditing(false);
                    await refresh();
                  }}
                />
              ) : null}
            </>
          ) : (
            <p role="status">계정을 확인하는 중…</p>
          )}
        </>
      ) : null}
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
function localTime(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function MeetingEditor({
  userId,
  initial,
  placeId,
  ready,
  onSaved,
}: {
  userId: string;
  initial?: Meeting;
  placeId?: string;
  ready: boolean;
  onSaved?: () => Promise<void>;
}) {
  const [baseVersion] = useState(initial?.version);
  const [selectedPlace, setSelectedPlace] = useState(initial?.place.id ?? placeId ?? '');
  const places = useQuery({
    queryKey: ['places'],
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) => publicAPI.places(signal),
  });
  const command = useMeetingCommand(userId, async (id) => {
    if (onSaved) await onSaved();
    else window.location.assign(`/meetups/${id}`);
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    try {
      const input: MeetingInput = meetingInputSchema.parse({
        title: data.get('title'),
        description: data.get('description'),
        sport: data.get('sport'),
        placeId: data.get('placeId'),
        startsAt: new Date(`${data.get('startDate')}T${data.get('startTime')}`).toISOString(),
        endsAt: new Date(`${data.get('endDate')}T${data.get('endTime')}`).toISOString(),
        capacity: Number(data.get('capacity')),
      });
      await command.run(
        initial ? `/api/v1/meetups/${initial.id}` : '/api/v1/meetups',
        initial ? 'PATCH' : 'POST',
        initial ? { action: 'edit', expectedVersion: baseVersion, input } : input,
      );
    } catch {
      command.setError('제목·시설·시작과 종료 시간·정원을 확인해 주세요.');
    }
  }
  return (
    <section aria-label={initial ? '모임 수정 양식' : '모임 작성 양식'}>
      <form className={form} onSubmit={(e) => void submit(e)}>
        <fieldset disabled={!ready || command.pending || !!command.unknown}>
          <legend>{initial ? '모임 수정' : '운동 약속'}</legend>
          <label>
            제목
            <input name="title" required maxLength={120} defaultValue={initial?.title} />
          </label>
          <label>
            설명
            <textarea name="description" maxLength={2000} defaultValue={initial?.description} />
          </label>
          <label>
            종목
            <select name="sport" defaultValue={initial?.sport ?? 'walking'}>
              {Object.entries(sports).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            장소
            <select
              name="placeId"
              required
              value={selectedPlace}
              onChange={(event) => setSelectedPlace(event.target.value)}
            >
              <option value="">시설 선택</option>
              {places.data?.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p>입력 시간은 이 기기의 현지 시간이며 상세에는 한국 시간으로 표시됩니다.</p>
          <label>
            시작 날짜
            <input
              name="startDate"
              type="date"
              required
              defaultValue={initial ? localTime(initial.startsAt).slice(0, 10) : undefined}
            />
          </label>
          <label>
            시작 시간
            <input
              name="startTime"
              type="time"
              required
              defaultValue={initial ? localTime(initial.startsAt).slice(11) : undefined}
            />
          </label>
          <label>
            종료 날짜
            <input
              name="endDate"
              type="date"
              required
              defaultValue={initial ? localTime(initial.endsAt).slice(0, 10) : undefined}
            />
          </label>
          <label>
            종료 시간
            <input
              name="endTime"
              type="time"
              required
              defaultValue={initial ? localTime(initial.endsAt).slice(11) : undefined}
            />
          </label>
          <label>
            정원 · 주최자 포함
            <input
              name="capacity"
              type="number"
              min={2}
              max={100}
              required
              defaultValue={initial?.capacity ?? 6}
            />
          </label>
          <button disabled={!places.data}>{initial ? '수정 저장' : '모임 생성'}</button>
        </fieldset>
      </form>
      {places.isError ? (
        <>
          <p role="alert">시설 목록을 불러오지 못했습니다. 작성한 입력은 유지됩니다.</p>
          <button onClick={() => void places.refetch()}>시설 다시 조회</button>
        </>
      ) : null}
      {command.feedback}
    </section>
  );
}
