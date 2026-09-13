import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { placeListSchema, placesKey } from '../../contracts/place';
import { meetingListSchema, meetingListKey } from '../../contracts/meetings';
import { postInputSchema, type Post } from '../../contracts/community';
import { meetingRequest } from '../../api/meetings';
import { form } from '../account/account.css';
const sports = { walking: '걷기', running: '달리기', cycling: '자전거' };
export function PostEditor({
  post,
  disabled,
  submit,
}: {
  post?: Post;
  disabled: boolean;
  submit: (input: z.infer<typeof postInputSchema>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(post?.title ?? ''),
    [body, setBody] = useState(post?.body ?? ''),
    [sport, setSport] = useState(post?.sport ?? 'walking'),
    [placeId, setPlaceId] = useState(post?.placeId ?? ''),
    [meetupId, setMeetupId] = useState(post?.meetupId ?? ''),
    [preview, setPreview] = useState(false),
    [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const locked = disabled || !hydrated;
  const places = useQuery({
    queryKey: placesKey,
    queryFn: ({ signal }) => meetingRequest('/api/v1/places', placeListSchema, { signal }),
    staleTime: 30000,
    retry: false,
  });
  const meetings = useQuery({
    queryKey: meetingListKey({ regionCode: '46840', page: 0 }),
    queryFn: ({ signal }) => meetingRequest('/api/v1/meetups', meetingListSchema, { signal }),
    staleTime: 30000,
    retry: false,
  });
  return (
    <form
      className={form}
      onSubmit={(e) => {
        e.preventDefault();
        const p = postInputSchema.safeParse({
          title,
          body,
          sport,
          placeId: placeId || null,
          meetupId: meetupId || null,
        });
        if (!p.success) {
          setError('제목·본문·관련 주소를 확인해 주세요.');
          return;
        }
        void submit(p.data);
      }}
    >
      <label>
        제목
        <input
          disabled={locked}
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        종목
        <select
          disabled={locked}
          value={sport}
          onChange={(e) => setSport(e.target.value as typeof sport)}
        >
          {Object.entries(sports).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        본문
        <textarea
          disabled={locked}
          required
          maxLength={5000}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <details>
        <summary>관련 시설·모임 (선택)</summary>
        <label>
          관련 시설
          <select disabled={locked} value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            <option value="">연결하지 않음</option>
            {places.data?.places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          관련 모임
          <select disabled={locked} value={meetupId} onChange={(e) => setMeetupId(e.target.value)}>
            <option value="">연결하지 않음</option>
            {meetings.data?.meetups.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
            {meetupId && !meetings.data?.meetups.some((m) => m.id === meetupId) ? (
              <option value={meetupId}>기존에 연결한 모임</option>
            ) : null}
          </select>
        </label>
      </details>
      {places.error || meetings.error ? (
        <p role="alert">
          관련 장소·모임을 불러오지 못했습니다.{' '}
          <button
            type="button"
            onClick={() => {
              void places.refetch();
              void meetings.refetch();
            }}
          >
            관련 정보 다시 조회
          </button>
        </p>
      ) : null}
      <button type="button" onClick={() => setPreview(!preview)}>
        미리보기
      </button>
      {preview ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={locked}>게시글 저장</button>
      <p>계정 전환·화면 종료 시 초안이 지워집니다. 제출 실패 시 이 화면의 입력은 유지됩니다.</p>
    </form>
  );
}
