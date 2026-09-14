import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { myMeetingsSchema, myMeetingsKey } from '../../contracts/meetings';
import {
  communityKey,
  profileSchema,
  postListSchema,
  type CommunityCommand,
} from '../../contracts/community';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { form } from '../account/account.css';
import * as styles from '../meetup/meetup.css';
import { RegionSelect } from '../places/RegionSelect';
export function Blocks({
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

export function Activity({
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
          regionCode: region || null,
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
      <RegionSelect
        label="선택 동네"
        emptyLabel="선택하지 않음"
        disabled={disabled}
        value={region}
        onChange={(e) => setRegion(e.target.value)}
      />
      <p>동네 선택은 거주 인증이 아닙니다.</p>
      <button disabled={disabled}>프로필 저장</button>
    </form>
  );
}
