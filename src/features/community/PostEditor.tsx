import { useDraft } from '../recovery/useDraft';
import { postDraftScope, postDraftSchema } from './postDraft';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { placeListSchema, placesKey } from '../../contracts/place';
import { meetingListSchema, meetingListKey } from '../../contracts/meetings';
import { postInputSchema, type Post } from '../../contracts/community';
import { meetingRequest } from '../../api/meetings';
import { form } from '../account/account.css';
import { primary } from '../meetup/meetup.css';
const sports = { walking: '걷기', running: '달리기', cycling: '자전거' };
export function PostEditor({
  userId,
  post,
  disabled,
  submit,
}: {
  userId: string;
  post?: Post;
  disabled: boolean;
  submit: (input: z.infer<typeof postInputSchema>, version: number | null) => Promise<boolean>;
}) {
  const bodyId = 'post-body-' + (post?.id ?? 'new');
  const draft = useDraft(
    userId,
    postDraftScope(post?.id),
    {
      title: post?.title ?? '',
      body: post?.body ?? '',
      sport: post?.sport ?? 'walking',
      placeId: post?.placeId ?? '',
      meetupId: post?.meetupId ?? '',
      version: post?.version ?? null,
    },
    postDraftSchema,
  );
  const { title, body, sport, placeId, meetupId } = draft.value;
  const [preview, setPreview] = useState(false),
    [error, setError] = useState('');
  const locked = disabled || !draft.hydrated;
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
        void submit(p.data, draft.value.version);
      }}
    >
      <label>
        제목
        <input
          disabled={locked}
          required
          maxLength={120}
          placeholder="제목을 입력하세요."
          value={title}
          onChange={(e) => draft.update({ ...draft.value, title: e.target.value })}
        />
      </label>
      <label>
        종목
        <select
          disabled={locked}
          value={sport}
          onChange={(e) => draft.update({ ...draft.value, sport: e.target.value as typeof sport })}
        >
          {Object.entries(sports).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={bodyId}>본문</label>
      <textarea
        id={bodyId}
        disabled={locked}
        required
        maxLength={5000}
        rows={8}
        placeholder="이웃과 나누고 싶은 이야기를 적어 주세요."
        value={body}
        onChange={(e) => draft.update({ ...draft.value, body: e.target.value })}
      />
      <details>
        <summary>관련 시설·모임 (선택)</summary>
        <label>
          관련 시설
          <select
            disabled={locked}
            value={placeId}
            onChange={(e) => draft.update({ ...draft.value, placeId: e.target.value })}
          >
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
          <select
            disabled={locked}
            value={meetupId}
            onChange={(e) => draft.update({ ...draft.value, meetupId: e.target.value })}
          >
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
      <button className={primary} disabled={locked}>
        게시글 저장
      </button>
      <button type="button" disabled={locked} onClick={draft.discard}>
        초안 폐기
      </button>
      {draft.message ? <p role="status">{draft.message}</p> : null}
      <p>
        화면 이동·새로고침 후에도 이 브라우저에서 초안을 이어 쓸 수 있습니다. 저장 성공·초안
        폐기·계정 전환 시 정리됩니다.
      </p>
    </form>
  );
}
